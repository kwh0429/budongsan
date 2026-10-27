import os
import json
import logging
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
import pandas as pd
from google import genai
from google.genai import types

# .env 로드
load_dotenv()

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 최대 16MB 업로드

# Gemini API 클라이언트 초기화
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
gemini_client = None

if GEMINI_API_KEY and GEMINI_API_KEY != "your_gemini_api_key_here":
    try:
        gemini_client = genai.Client(api_key=GEMINI_API_KEY)
        logger.info("Google Gemini Client successfully initialized.")
    except Exception as e:
        logger.error(f"Failed to initialize Gemini Client: {e}")
else:
    logger.warning("GEMINI_API_KEY is not set or using placeholder. AI insight feature will be limited.")

def standardize_dataframe(df):
    """
    한글 또는 다양한 형태의 컬럼명을 표준 컬럼명으로 매핑합니다.
    소득 컬럼이 없는 순수 부동산 가격 데이터인 경우 통계청 기준 소득을 스마트하게 결합합니다.
    """
    logger.info(f"Original uploaded columns: {list(df.columns)}")

    # 주택가격 관련 키워드
    price_keywords = ["주택가격", "평균주택가격", "매매가", "거래금액", "실거래가", "가격", "금액", "시세", "분양가", "집값", "평균가격", "매매", "price", "amount", "cost"]
    # 소득 관련 키워드
    income_keywords = ["연소득", "가구소득", "연간가구소득", "연간소득", "소득", "소득금액", "월소득", "급여", "보수", "임금", "수입", "income", "salary", "wage"]
    # 지역 관련 키워드
    region_keywords = ["지역", "권역", "시도", "시군구", "구", "동", "법정동", "소재지", "주소", "region", "city", "location"]
    # 분위 관련 키워드
    quintile_keywords = ["소득분위", "분위", "구간", "계층", "quintile", "decile", "group"]

    detected_price_col = None
    detected_income_col = None
    detected_region_col = None
    detected_quintile_col = None

    for col in df.columns:
        col_clean = str(col).strip().replace(" ", "").replace("_", "").lower()
        if not detected_price_col and any(k in col_clean for k in price_keywords):
            detected_price_col = col
        elif not detected_income_col and any(k in col_clean for k in income_keywords):
            detected_income_col = col
        elif not detected_region_col and any(k in col_clean for k in region_keywords):
            detected_region_col = col
        elif not detected_quintile_col and any(k in col_clean for k in quintile_keywords):
            detected_quintile_col = col

    rename_map = {}
    if detected_price_col:
        rename_map[detected_price_col] = "avg_housing_price_manwon"
    if detected_income_col:
        rename_map[detected_income_col] = "annual_income_manwon"
    if detected_region_col:
        rename_map[detected_region_col] = "region"
    if detected_quintile_col:
        rename_map[detected_quintile_col] = "income_quintile"

    df = df.rename(columns=rename_map)

    # 1. 주택가격 컬럼 확인 (없으면 첫 번째 숫자형 컬럼 추정 또는 에러)
    if "avg_housing_price_manwon" not in df.columns:
        # 숫자형으로 변환 가능한 컬럼 탐색
        numeric_candidates = []
        for c in df.columns:
            converted = pd.to_numeric(df[c].astype(str).str.replace(",", "").str.replace(" ", ""), errors="coerce")
            if converted.notna().sum() > len(df) * 0.5:
                numeric_candidates.append(c)
        if numeric_candidates:
            df["avg_housing_price_manwon"] = pd.to_numeric(df[numeric_candidates[-1]].astype(str).str.replace(",", ""), errors="coerce")
            logger.info(f"Auto-selected '{numeric_candidates[-1]}' as housing price column.")
        else:
            raise ValueError(f"데이터셋에서 주택가격(매매가/거래금액) 컬럼을 찾을 수 없습니다. (현재 컬럼: {list(df.columns)})")
    else:
        df["avg_housing_price_manwon"] = pd.to_numeric(df["avg_housing_price_manwon"].astype(str).str.replace(",", "").str.replace(" ", ""), errors="coerce")

    # 주택가격 단위 보정 (만약 원 단위로 되어 있어 값이 10억 이상 단위인 경우 만원으로 환산)
    if df["avg_housing_price_manwon"].median() > 10000000:
        df["avg_housing_price_manwon"] = (df["avg_housing_price_manwon"] / 10000).round()

    # 2. 소득 컬럼 처리
    # 사용자의 데이터가 실거래가 등 '소득' 정보가 없는 순수 부동산 데이터인 경우:
    # 통계청 기준 국내 소득 5분위 지표를 주택가격 분위에 맞춰 스마트 결합
    is_income_synthesized = False
    if "annual_income_manwon" not in df.columns:
        is_income_synthesized = True
        logger.info("Income column not found. Synthesizing income based on National Statistics quintiles.")
        # 주택가격을 5분위로 구분한 뒤, 문자열로 변환하여 Categorical 타입 나눗셈 오류 원천 방지
        price_ranks = pd.qcut(df["avg_housing_price_manwon"].rank(method="first"), q=5, labels=["1분위", "2분위", "3분위", "4분위", "5분위"])
        df["income_quintile"] = price_ranks.astype(str)
        income_benchmark = {
            "1분위": 2150.0,   # 하위 20% 가구 평균 연소득 (2,150만원)
            "2분위": 4180.0,   # 2분위 (4,180만원)
            "3분위": 6550.0,   # 3분위 중위 (6,550만원)
            "4분위": 9500.0,   # 4분위 (9,500만원)
            "5분위": 15200.0   # 상위 20% (1억 5,200만원)
        }
        # 순수 float 숫자로 확실하게 매핑
        df["annual_income_manwon"] = pd.to_numeric(df["income_quintile"].map(income_benchmark), errors="coerce").astype(float)
    else:
        df["annual_income_manwon"] = pd.to_numeric(df["annual_income_manwon"].astype(str).str.replace(",", "").str.replace(" ", ""), errors="coerce")
        # 월소득으로 추정되는 경우 (연소득이 1,500만원 미만이고 값이 200~1000 사이인 경우 12배 연소득 환산)
        if df["annual_income_manwon"].median() < 1200:
            df["annual_income_manwon"] = df["annual_income_manwon"] * 12

    # 중위 주택가격 보정
    if "median_housing_price_manwon" in df.columns:
        df["median_housing_price_manwon"] = pd.to_numeric(df["median_housing_price_manwon"].astype(str).str.replace(",", ""), errors="coerce")
    else:
        df["median_housing_price_manwon"] = df["avg_housing_price_manwon"]

    # 모든 수치 컬럼을 float64로 명시적 변환하여 numpy 연산 안정성 보장
    df["avg_housing_price_manwon"] = pd.to_numeric(df["avg_housing_price_manwon"], errors="coerce").astype(float)
    df["annual_income_manwon"] = pd.to_numeric(df["annual_income_manwon"], errors="coerce").astype(float)
    df["median_housing_price_manwon"] = pd.to_numeric(df["median_housing_price_manwon"], errors="coerce").astype(float)

    # 0으로 나누기 방지
    safe_income = df["annual_income_manwon"].replace(0, 1.0)

    # PIR 계산
    if "pir_ratio" not in df.columns or df["pir_ratio"].isna().all():
        df["pir_ratio"] = (df["avg_housing_price_manwon"] / safe_income).round(1)
    else:
        df["pir_ratio"] = pd.to_numeric(df["pir_ratio"], errors="coerce").fillna(
            (df["avg_housing_price_manwon"] / safe_income).round(1)
        )

    if "region" not in df.columns:
        df["region"] = "전국"
    else:
        df["region"] = df["region"].astype(str)

    if "income_quintile" not in df.columns:
        ranks = pd.qcut(df["annual_income_manwon"].rank(method="first"), q=5, labels=["1분위", "2분위", "3분위", "4분위", "5분위"])
        df["income_quintile"] = ranks.astype(str)
    else:
        df["income_quintile"] = df["income_quintile"].astype(str)

    clean_df = df.dropna(subset=["annual_income_manwon", "avg_housing_price_manwon"])
    return clean_df, is_income_synthesized


def process_housing_statistics(df):
    """
    데이터프레임으로부터 통계 지표와 시각화용 데이터를 추출합니다.
    """
    total_records = len(df)
    avg_income = int(round(df["annual_income_manwon"].mean()))
    avg_price = int(round(df["avg_housing_price_manwon"].mean()))
    median_price = int(round(df["median_housing_price_manwon"].median()))
    avg_pir = round(float(df["pir_ratio"].mean()), 1)

    # 분위별 통계 집계
    quintile_group = df.groupby("income_quintile", as_index=False).agg({
        "annual_income_manwon": "mean",
        "avg_housing_price_manwon": "mean",
        "pir_ratio": "mean"
    }).sort_values(by="annual_income_manwon")

    quintile_labels = [str(q) for q in quintile_group["income_quintile"].tolist()]
    quintile_incomes = [int(round(x)) for x in quintile_group["annual_income_manwon"].tolist()]
    quintile_prices = [int(round(x)) for x in quintile_group["avg_housing_price_manwon"].tolist()]
    quintile_pirs = [round(float(x), 1) for x in quintile_group["pir_ratio"].tolist()]

    # 격차 배율 계산 (최상위 분위 / 최하위 분위)
    income_gap_ratio = 1.0
    asset_gap_ratio = 1.0
    if len(quintile_incomes) >= 2 and quintile_incomes[0] > 0:
        income_gap_ratio = round(quintile_incomes[-1] / quintile_incomes[0], 1)
    if len(quintile_prices) >= 2 and quintile_prices[0] > 0:
        asset_gap_ratio = round(quintile_prices[-1] / quintile_prices[0], 1)

    # 산점도(Scatter)용 데이터 포인트 (소득 vs 집값)
    # 데이터가 너무 많을 경우 브라우저 렌더링 성능을 위해 최대 500개 균등 샘플링
    scatter_df = df
    if len(df) > 500:
        scatter_df = df.sample(n=500, random_state=42)

    scatter_points = []
    for _, row in scatter_df.iterrows():
        scatter_points.append({
            "x": int(row["annual_income_manwon"]),
            "y": int(row["avg_housing_price_manwon"]),
            "region": str(row["region"]),
            "quintile": str(row["income_quintile"]),
            "pir": round(float(row["pir_ratio"]), 1)
        })

    # 지역별 최고/최저 PIR
    region_group = df.groupby("region", as_index=False)["pir_ratio"].mean().sort_values(by="pir_ratio", ascending=False)
    region_pir_list = [
        {"region": str(r["region"]), "pir": round(float(r["pir_ratio"]), 1)}
        for _, r in region_group.iterrows()
    ]

    summary_stats = {
        "kpi": {
            "total_records": total_records,
            "avg_income_manwon": avg_income,
            "avg_price_manwon": avg_price,
            "median_price_manwon": median_price,
            "avg_pir": avg_pir,
            "income_gap_ratio": income_gap_ratio,
            "asset_gap_ratio": asset_gap_ratio
        },
        "quintile_chart": {
            "labels": quintile_labels,
            "incomes": quintile_incomes,
            "prices": quintile_prices,
            "pirs": quintile_pirs
        },
        "scatter_chart": scatter_points,
        "region_pir_list": region_pir_list
    }

    return summary_stats


@app.route("/favicon.ico")
def favicon():
    return ("", 204)

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/analyze", methods=["POST"])
def analyze():
    """
    데이터셋(업로드 파일 또는 기본 샘플)을 분석하여 시각화 통계 데이터를 반환합니다.
    """
    try:
        use_sample = request.form.get("use_sample", "false").lower() == "true"

        if use_sample:
            sample_path = os.path.join(app.root_path, "data", "sample_housing_income.csv")
            if not os.path.exists(sample_path):
                return jsonify({"success": False, "error": "기본 샘플 데이터셋 파일을 찾을 수 없습니다."}), 404
            logger.info("Loading sample dataset: data/sample_housing_income.csv")
            df = pd.read_csv(sample_path, encoding="utf-8-sig")
        else:
            if "file" not in request.files:
                return jsonify({"success": False, "error": "업로드된 파일이 없습니다."}), 400
            file = request.files["file"]
            if file.filename == "":
                return jsonify({"success": False, "error": "선택된 파일이 없습니다."}), 400

            filename = file.filename.lower()
            if filename.endswith(".csv"):
                try:
                    df = pd.read_csv(file, encoding="utf-8-sig")
                except UnicodeDecodeError:
                    file.seek(0)
                    df = pd.read_csv(file, encoding="cp949")
            elif filename.endswith((".xls", ".xlsx")):
                df = pd.read_excel(file)
            else:
                return jsonify({"success": False, "error": "CSV 또는 Excel(.xlsx) 형식의 파일만 지원합니다."}), 400

        # 데이터 정제 및 통계 계산
        df_standard, is_income_synthesized = standardize_dataframe(df)
        stats = process_housing_statistics(df_standard)
        stats["is_income_synthesized"] = is_income_synthesized

        notice_msg = ""
        if is_income_synthesized:
            notice_msg = "ℹ️ 업로드하신 파일에 '소득' 컬럼이 없어, 주택가격 분포를 바탕으로 [통계청 가계금융복지조사 소득 5분위 표준 지표]를 자동 매칭하여 분석했습니다."
            logger.info(notice_msg)

        logger.info(f"Data analysis complete: {stats['kpi']['total_records']} rows processed.")
        return jsonify({"success": True, "data": stats, "notice": notice_msg})

    except Exception as e:
        logger.error(f"Error during analysis: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": f"데이터 분석 중 오류가 발생했습니다: {str(e)}"}), 500


@app.route("/ai-insight", methods=["POST"])
def ai_insight():
    """
    정리된 통계 지표를 바탕으로 Gemini Flash 모델이 비전문가 눈높이의 데이터 해설 리포트를 생성합니다.
    """
    try:
        payload = request.get_json()
        if not payload or "stats" not in payload:
            return jsonify({"success": False, "error": "분석된 통계 데이터가 제공되지 않았습니다."}), 400

        stats = payload["stats"]
        kpi = stats["kpi"]
        quintile = stats["quintile_chart"]
        regions = stats["region_pir_list"][:5]

        # API 키 유효성 체크
        current_api_key = os.getenv("GEMINI_API_KEY", "").strip()
        if not current_api_key or current_api_key == "your_gemini_api_key_here":
            # API 키가 없을 때 초보자를 위한 상세 안내 모의 리포트 반환
            mock_report = f"""### ⚠️ Gemini API 키 입력 안내
`.env` 파일에 유효한 `GEMINI_API_KEY`가 설정되지 않아 **기본 통계 요약 리포트**를 표시합니다.
[Google AI Studio](https://aistudio.google.com/)에서 API 키를 발급받아 `.env` 파일에 입력하시면 Gemini 2.5 Flash가 작성한 심층 분석 리포트를 확인하실 수 있습니다.

---

### 📊 [통계 기반 간이 요약 보고서]
1. **평균 PIR(Price to Income Ratio)**: **{kpi['avg_pir']}배**
   - 가구가 소득을 단 한 푼도 쓰지 않고 모았을 때, 평균적인 주택을 구매하는 데 약 **{kpi['avg_pir']}년**이 소요됩니다.
2. **소득 격차 vs 주택 자산 격차**:
   - 최상위 분위 소득은 최하위 분위의 **{kpi['income_gap_ratio']}배**이지만, 주택 자산 가치 격차는 **{kpi['asset_gap_ratio']}배**에 달합니다.
   - 이는 소득의 차이보다 **부동산 자산의 양극화가 훨씬 심각**함을 시사합니다.
3. **가장 주거 부담이 높은 권역**:
   - **{regions[0]['region'] if regions else '수도권 주요지'}(PIR {regions[0]['pir'] if regions else '-'}배)** 등 핵심 지역의 주택 진입 장벽이 매우 높습니다.
"""
            return jsonify({"success": True, "insight": mock_report})

        # Gemini 프롬프트 구성
        prompt = f"""
당신은 대한민국 거시경제 및 부동산 정책을 분석하는 Senior 데이터 이코노미스트입니다.
아래의 [국내 소득수준별 부동산가격 분포 및 통계 데이터]를 바탕으로, 비개발자 및 일반 시민도 한눈에 이해할 수 있도록 명쾌하고 인사이트가 넘치는 데이터 분석 리포트를 마크다운(Markdown) 형식으로 작성해 주세요.

[분석 통계 데이터]
- 총 분석 표본 수: {kpi['total_records']}건
- 전체 가구 연평균 소득: {kpi['avg_income_manwon']:,}만원
- 전체 주택 평균 매매가격: {kpi['avg_price_manwon']:,}만원 (중위가격: {kpi['median_price_manwon']:,}만원)
- 전체 평균 PIR(연소득 대비 주택가격 배수): {kpi['avg_pir']}배
- 소득 5분위(최상위 20%) vs 1분위(최하위 20%) 소득 격차: {kpi['income_gap_ratio']}배
- 주택가격 5분위 vs 1분위 자산 격차: {kpi['asset_gap_ratio']}배
- 소득 분위별 PIR 현황: {dict(zip(quintile['labels'], quintile['pirs']))}
- 주요 권역별 평균 PIR 상위 지역: {[f"{r['region']}({r['pir']}배)" for r in regions]}

[작성 지침]
1. **헤드라인 & 3줄 핵심 요약**: 가장 눈에 띄는 현상을 직관적인 비유와 함께 3문장으로 요약하세요.
2. **소득 격차 vs 자산 격차의 역설**: 소득 격차({kpi['income_gap_ratio']}배)보다 주택가격 격차({kpi['asset_gap_ratio']}배)가 더 큰 현상이 우리 사회의 부의 축적에 어떤 영향을 주는지 분석하세요.
3. **PIR 지표로 본 '내 집 마련' 현실**: PIR 수치(소득을 전혀 안 쓰고 모아야 하는 기간)를 일반 직장인이나 서민의 관점에서 생생하게 해설하세요. 특히 저소득층(1분위)과 고소득층(5분위)의 PIR 차이가 의미하는 바를 짚어주세요.
4. **지역별 주거 양극화**: 상위 지역과 지방 간의 주거 사다리 격차를 지적하세요.
5. **결론 및 시사점**: 무주택자, 청년층, 정책 입안자 입장에서 고려해야 할 핵심 포인트를 2~3줄로 정리해 주세요.
6. 전문용어는 항상 알기 쉽게 풀어서 설명하고, 읽기 편한 불릿 포인트와 강조 문구를 적절히 활용하세요.
"""

        logger.info("Requesting AI insight from Gemini model...")
        client = genai.Client(api_key=current_api_key)
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )

        insight_text = response.text
        logger.info("Gemini AI insight generation completed.")
        return jsonify({"success": True, "insight": insight_text})

    except Exception as e:
        logger.error(f"Error generating AI insight: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": f"AI 분석 리포트 생성 중 오류가 발생했습니다: {str(e)}"}), 500


if __name__ == "__main__":
    logger.info("Starting Flask Server on http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=True)
