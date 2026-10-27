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
    단일 또는 다중 데이터셋 파일을 병합 분석하여 통합 통계 및 시각화 데이터를 반환합니다.
    """
    try:
        use_sample = request.form.get("use_sample", "false").lower() == "true"
        all_dfs = []
        is_any_income_synthesized = False
        uploaded_file_names = []

        if use_sample:
            sample_path = os.path.join(app.root_path, "data", "sample_housing_income.csv")
            if not os.path.exists(sample_path):
                return jsonify({"success": False, "error": "기본 샘플 데이터셋 파일을 찾을 수 없습니다."}), 404
            logger.info("Loading sample dataset: data/sample_housing_income.csv")
            raw_df = pd.read_csv(sample_path, encoding="utf-8-sig")
            clean_df, is_synth = standardize_dataframe(raw_df)
            all_dfs.append(clean_df)
            uploaded_file_names.append("sample_housing_income.csv")
        else:
            # 다중 파일 수신 지원 ('files' 또는 단일 'file')
            uploaded_files = request.files.getlist("files")
            if not uploaded_files or (len(uploaded_files) == 1 and uploaded_files[0].filename == ""):
                if "file" in request.files and request.files["file"].filename != "":
                    uploaded_files = [request.files["file"]]
                else:
                    return jsonify({"success": False, "error": "업로드된 파일이 없습니다. 하나 이상의 파일을 선택해 주세요."}), 400

            for file in uploaded_files:
                if not file or file.filename == "":
                    continue
                filename = file.filename
                uploaded_file_names.append(filename)
                fname_lower = filename.lower()

                # 파일 파싱 (CSV 또는 Excel)
                if fname_lower.endswith(".csv"):
                    try:
                        raw_df = pd.read_csv(file, encoding="utf-8-sig")
                    except UnicodeDecodeError:
                        file.seek(0)
                        raw_df = pd.read_csv(file, encoding="cp949")
                elif fname_lower.endswith((".xls", ".xlsx")):
                    raw_df = pd.read_excel(file)
                else:
                    return jsonify({"success": False, "error": f"지원하지 않는 파일 형식입니다: {filename} (CSV 또는 Excel 파일만 지원)"}), 400

                clean_df, is_synth = standardize_dataframe(raw_df)
                if is_synth:
                    is_any_income_synthesized = True
                all_dfs.append(clean_df)

        if not all_dfs:
            return jsonify({"success": False, "error": "유효한 데이터 행이 포함된 파일이 없습니다."}), 400

        # 여러 개의 데이터프레임을 하나로 통합 병합
        combined_df = pd.concat(all_dfs, ignore_index=True)
        stats = process_housing_statistics(combined_df)
        stats["is_income_synthesized"] = is_any_income_synthesized
        stats["file_count"] = len(uploaded_file_names)
        stats["file_names"] = uploaded_file_names

        notice_msg = ""
        if len(uploaded_file_names) > 1:
            notice_msg = f"📁 총 {len(uploaded_file_names)}개의 데이터 파일({', '.join(uploaded_file_names[:3])}{' 등' if len(uploaded_file_names) > 3 else ''})을 성공적으로 병합하여 통합 분석했습니다."
        if is_any_income_synthesized:
            prefix = " " if notice_msg else ""
            notice_msg += f"{prefix}ℹ️ 소득 컬럼이 없는 파일의 경우 [통계청 가계금융복지조사 표준 소득 5분위 지표]를 자동 매칭하여 종합 산출했습니다."

        logger.info(f"Consolidated analysis complete: {stats['kpi']['total_records']} total rows across {len(uploaded_file_names)} files.")
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

        # Gemini 프롬프트 구성 (전문 거시경제/부동산 리서치 보고서 수준)
        prompt = f"""
당신은 한국개발연구원(KDI) 및 한국은행 거시경제/부동산 금융팀의 수석 연구위원(Chief Economist)입니다.
제공된 [소득 분위별 국내 부동산 가격 분포 및 통합 통계 데이터]를 심층 분석하여, 최고 수준의 전문성과 실용성을 갖춘 **「대한민국 소득수준별 주택가격 분포 및 자산 양극화 심층 경제분석 보고서」**를 마크다운(Markdown) 형식으로 작성해 주십시오.

=========================================
[통합 실증 분석 통계 데이터]
- 총 분석 표본 수: {kpi['total_records']}건 (분석 대상 파일 수: {stats.get('file_count', 1)}개)
- 전체 가구 연평균 소득: {kpi['avg_income_manwon']:,}만원
- 전체 주택 평균 매매가격: {kpi['avg_price_manwon']:,}만원 (중위 매매가격: {kpi['median_price_manwon']:,}만원)
- 전체 평균 PIR (연소득 대비 주택가격 배수): {kpi['avg_pir']}배
- 소득 5분위 배율 (최상위 20% 소득 / 최하위 20% 소득): {kpi['income_gap_ratio']}배
- 주택 자산 5분위 배율 (최상위 20% 주택가 / 최하위 20% 주택가): {kpi['asset_gap_ratio']}배
- 분위별 세부 PIR 지표: {dict(zip(quintile['labels'], quintile['pirs']))}
- 분위별 평균 소득: {dict(zip(quintile['labels'], [f"{x:,}만원" for x in quintile['incomes']]))}
- 분위별 평균 주택가: {dict(zip(quintile['labels'], [f"{x:,}만원" for x in quintile['prices']]))}
- 권역별 PIR 랭킹 상위 지역: {[f"{r['region']} (PIR {r['pir']}배)" for r in regions]}
=========================================

[보고서 작성 가이드라인 및 필수 구성 항목]

반드시 아래 6대 섹션 체계를 엄격히 유지하고, 데이터에 제시된 정확한 통계 수치를 풍부하게 인용하여 전문적이고 학술적인 품격과 가독성을 갖추어 서술하십시오:

### 1. 📌 총괄 요약 (Executive Summary)
- 현재 데이터가 보여주는 대한민국 주택 시장의 본질을 날카로운 통찰력으로 진단하는 **핵심 요약 3개 문장**을 볼드체 불릿으로 제시하십시오.
- 현재의 PIR 수준({kpi['avg_pir']}배)과 자산 양극화의 위험도(Level)를 명확히 판정하십시오.

### 2. 🌐 PIR(Price to Income Ratio) 지표의 국제 비교 및 주거 진입 장벽 진단
- UN-Habitat 및 세계은행(World Bank)의 적정 권고 기준치(PIR 3.0~5.0배)와 비교하여, 현재 평균 PIR {kpi['avg_pir']}배가 의미하는 경제적 무게를 해석하십시오.
- 특히 가구가 연소득을 한 푼도 쓰지 않고 모아야 하는 기간({kpi['avg_pir']}년)이 실제 소비 성향(평균 저축률 25~30% 가정)을 감안할 때 실질적으로 **몇 년의 자산 형성 기간(최소 {round(kpi['avg_pir'] / 0.3, 1)}년 이상)**을 요구하는지 현실적인 관점에서 수치로 입증하십시오.

### 3. ⚖️ 소득 불평등 vs 자산 양극화의 '디커플링(Decoupling)' 구조 분석
- 소득 격차({kpi['income_gap_ratio']}배) 대비 주택 자산 격차({kpi['asset_gap_ratio']}배)의 불일치 현상을 지적하십시오.
- "근로소득의 차이보다 부동산 자산 상승에 따른 부의 축적 속도가 압도적인 현상"이 어떻게 계층 간 '주거 사다리'를 단절시키고 있는지 자본수익률(r)과 경제성장률(g)의 관점을 접목하여 심층 논증하십시오.

### 4. 🗺️ 공간적 불평등: 권역별 PIR 격차와 주거 양극화
- 상위 권역({regions[0]['region'] if regions else '수도권 핵심지'}, PIR {regions[0]['pir'] if regions else '-'}배)과 하위 권역 간의 격차를 대비하십시오.
- 핵심 지역의 진입 장벽이 청년층 및 신규 진입 가구의 공간적 이동성을 어떻게 제한하고 지역 간 자산 격차를 영착화하는지 분석하십시오.

### 5. 📉 거시경제 및 가계 건전성에 미치는 파급 효과
- 고금리 및 DSR(총부채원리금상환비율) 규제 환경 하에서 가계의 원리금 상환 부담(Debt Burden)이 민간 소비를 위축시키는 메커니즘을 짚으십시오.
- 과도한 주거 비용이 청년층의 결혼 기피, 출산율 저하, 가계 유동성 경직성으로 전이되는 사회경제적 비용을 진단하십시오.

### 6. 💡 정책 제언 및 가계 경제 실행 전략
- **정부 및 정책 당국**: 공급 정책, 주거 사다리 복원, 금융 및 조세 정책 측면의 핵심 과제 2가지 제시.
- **실수요자 및 무주택 가계**: 무리한 영끌 지양, 분위별 현실적 자산 형성 경로 및 내 집 마련 로드맵 조언.

[문체 요건]
- 객관적이고 신뢰감 있는 경제 리포트 문체(~함, ~로 분석됨, ~가 요구됨 등 전문적 평서체)를 유지하십시오.
- 표나 인용 블록(blockquote), 굵은 글씨를 적재적소에 활용하여 시각적 보고서 완성도를 극대화하십시오.
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
