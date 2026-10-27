// 전역 차트 인스턴스 관리 객체
let chartInstances = {
    quintileComparison: null,
    pir: null,
    scatter: null
};

// 현재 로드된 AI 리포트 원본 텍스트
let currentAiReportRaw = "";

document.addEventListener("DOMContentLoaded", () => {
    // DOM 요소 참조
    const fileInput = document.getElementById("csvFileInput");
    const selectedFileName = document.getElementById("selectedFileName");
    const fileChipsContainer = document.getElementById("fileChipsContainer");
    const btnUploadAnalyze = document.getElementById("btnUploadAnalyze");
    const btnSampleAnalyze = document.getElementById("btnSampleAnalyze");

    const loadingIndicator = document.getElementById("loadingIndicator");
    const loadingMessage = document.getElementById("loadingMessage");
    const errorBanner = document.getElementById("errorBanner");
    const errorMessage = document.getElementById("errorMessage");
    const btnDismissError = document.getElementById("btnDismissError");

    const resultSection = document.getElementById("resultSection");
    const aiLoading = document.getElementById("aiLoading");
    const aiReportContent = document.getElementById("aiReportContent");
    const btnCopyReport = document.getElementById("btnCopyReport");
    const btnDownloadReport = document.getElementById("btnDownloadReport");

    // 파일 다중 선택 이벤트
    fileInput.addEventListener("change", (e) => {
        const files = e.target.files;
        fileChipsContainer.innerHTML = "";

        if (files && files.length > 0) {
            hideError();
            if (files.length === 1) {
                selectedFileName.textContent = `선택됨: ${files[0].name}`;
                fileChipsContainer.classList.add("hidden");
            } else {
                selectedFileName.textContent = `📁 총 ${files.length}개 파일 선택됨 (자동 병합 분석)`;
                fileChipsContainer.classList.remove("hidden");

                Array.from(files).forEach((file) => {
                    const chip = document.createElement("span");
                    chip.className = "file-chip";
                    chip.innerHTML = `📄 ${file.name} <small>(${(file.size / 1024).toFixed(0)}KB)</small>`;
                    fileChipsContainer.appendChild(chip);
                });
            }
        } else {
            selectedFileName.textContent = "선택된 파일 없음";
            fileChipsContainer.classList.add("hidden");
        }
    });

    // 에러 닫기 버튼
    btnDismissError.addEventListener("click", hideError);

    // 샘플 데이터로 즉시 분석 클릭
    btnSampleAnalyze.addEventListener("click", () => {
        executeAnalysis({ useSample: true });
    });

    // 파일 데이터 분석 클릭 (다중 파일 지원)
    btnUploadAnalyze.addEventListener("click", () => {
        if (!fileInput.files || fileInput.files.length === 0) {
            showError("분석할 CSV 또는 Excel(.xlsx) 파일을 하나 이상 선택해 주세요.");
            return;
        }
        executeAnalysis({ files: fileInput.files });
    });

    // 리포트 클립보드 복사
    btnCopyReport.addEventListener("click", async () => {
        if (!currentAiReportRaw) return;
        try {
            await navigator.clipboard.writeText(currentAiReportRaw);
            const originalText = btnCopyReport.textContent;
            btnCopyReport.textContent = "✅ 복사 완료!";
            setTimeout(() => {
                btnCopyReport.textContent = originalText;
            }, 2000);
        } catch (err) {
            alert("클립보드 복사에 실패했습니다. 브라우저 권한을 확인해 주세요.");
        }
    });

    // 리포트 마크다운(.md) 다운로드
    btnDownloadReport.addEventListener("click", () => {
        if (!currentAiReportRaw) return;
        const blob = new Blob([currentAiReportRaw], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const dateStr = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `부동산_소득분포_AI분석리포트_${dateStr}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    /**
     * 데이터 분석 요청 실행 (다중 파일 지원)
     */
    async function executeAnalysis({ useSample = false, files = null, file = null }) {
        hideError();

        const formData = new FormData();
        if (useSample) {
            showLoading("기본 샘플 데이터를 정제하고 소득 분위 및 PIR 지표를 산출하는 중입니다...");
            formData.append("use_sample", "true");
        } else if (files && files.length > 0) {
            const count = files.length;
            showLoading(`${count}개의 파일을 병합 및 정제하여 통합 분석을 수행하는 중입니다...`);
            for (let i = 0; i < count; i++) {
                formData.append("files", files[i]);
            }
        } else if (file) {
            showLoading("데이터를 정제하고 소득 분위 및 PIR 지표를 산출하는 중입니다...");
            formData.append("files", file);
        } else {
            showError("분석할 파일이 제공되지 않았습니다.");
            return;
        }

        try {
            const response = await fetch("/analyze", {
                method: "POST",
                body: formData
            });

            const resData = await response.json();
            if (!response.ok || !resData.success) {
                throw new Error(resData.error || "데이터 분석 중 알 수 없는 오류가 발생했습니다.");
            }

            // 분석 결과 화면 렌더링
            renderDashboard(resData.data);
            hideLoading();

            if (resData.notice) {
                showNotice(resData.notice);
            }

            // 백그라운드로 AI 인사이트 리포트 비동기 요청
            fetchAiInsight(resData.data);

        } catch (err) {
            hideLoading();
            showError(err.message);
        }
    }

    /**
     * KPI 및 차트 대시보드 렌더링
     */
    function renderDashboard(data) {
        resultSection.classList.remove("hidden");

        // 1. KPI 지표 채우기
        const kpi = data.kpi;
        document.getElementById("kpiTotalRecords").textContent = kpi.total_records.toLocaleString();
        document.getElementById("kpiAvgPir").textContent = kpi.avg_pir;
        document.getElementById("kpiAvgIncome").textContent = kpi.avg_income_manwon.toLocaleString();
        document.getElementById("kpiAvgPrice").textContent = kpi.avg_price_manwon.toLocaleString();
        document.getElementById("kpiMedianPrice").textContent = kpi.median_price_manwon.toLocaleString();
        document.getElementById("kpiIncomeGap").textContent = kpi.income_gap_ratio;
        document.getElementById("kpiAssetGap").textContent = kpi.asset_gap_ratio;

        // 2. 인터랙티브 차트 3종 렌더링
        renderQuintileChart(data.quintile_chart);
        renderPirChart(data.quintile_chart);
        renderScatterChart(data.scatter_chart);

        // 결과 영역으로 부드럽게 스크롤
        resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    /**
     * 차트 1: 분위별 연소득 vs 주택가격 (Bar Chart)
     */
    function renderQuintileChart(qData) {
        const ctx = document.getElementById("quintileComparisonChart").getContext("2d");
        if (chartInstances.quintileComparison) {
            chartInstances.quintileComparison.destroy();
        }

        chartInstances.quintileComparison = new Chart(ctx, {
            type: "bar",
            data: {
                labels: qData.labels,
                datasets: [
                    {
                        label: "평균 가구소득 (만원)",
                        data: qData.incomes,
                        backgroundColor: "rgba(59, 130, 246, 0.8)",
                        borderRadius: 6
                    },
                    {
                        label: "평균 주택가격 (만원)",
                        data: qData.prices,
                        backgroundColor: "rgba(239, 68, 68, 0.8)",
                        borderRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: "top" },
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.dataset.label}: ${context.raw.toLocaleString()} 만원`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: (val) => `${(val / 10000).toFixed(0)}억`
                        }
                    }
                }
            }
        });
    }

    /**
     * 차트 2: 분위별 PIR 배수 (Bar Chart)
     */
    function renderPirChart(qData) {
        const ctx = document.getElementById("pirChart").getContext("2d");
        if (chartInstances.pir) {
            chartInstances.pir.destroy();
        }

        chartInstances.pir = new Chart(ctx, {
            type: "bar",
            data: {
                labels: qData.labels,
                datasets: [
                    {
                        label: "PIR (소득 대비 집값 배수, 연)",
                        data: qData.pirs,
                        backgroundColor: "rgba(139, 92, 246, 0.85)",
                        borderColor: "rgba(139, 92, 246, 1)",
                        borderWidth: 1,
                        borderRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => `PIR: ${context.raw}배 (소득 전액 저축 시 ${context.raw}년 소요)`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: "배수 (년수)" }
                    }
                }
            }
        });
    }

    /**
     * 차트 3: 소득 vs 주택가격 산점도 (Scatter Plot)
     */
    function renderScatterChart(scatterData) {
        const ctx = document.getElementById("scatterChart").getContext("2d");
        if (chartInstances.scatter) {
            chartInstances.scatter.destroy();
        }

        chartInstances.scatter = new Chart(ctx, {
            type: "scatter",
            data: {
                datasets: [
                    {
                        label: "소득-주택가격 표본",
                        data: scatterData,
                        backgroundColor: "rgba(37, 99, 235, 0.65)",
                        borderColor: "rgba(37, 99, 235, 1)",
                        pointRadius: 6,
                        pointHoverRadius: 9
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const pt = context.raw;
                                return [
                                    `지역: ${pt.region}`,
                                    `분위: ${pt.quintile}`,
                                    `연소득: ${pt.x.toLocaleString()}만원`,
                                    `주택가격: ${pt.y.toLocaleString()}만원`,
                                    `PIR: ${pt.pir}배`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: "연간 가구소득 (만원)" },
                        ticks: {
                            callback: (val) => `${val.toLocaleString()}만`
                        }
                    },
                    y: {
                        title: { display: true, text: "평균 주택가격 (만원)" },
                        ticks: {
                            callback: (val) => `${(val / 10000).toFixed(0)}억원`
                        }
                    }
                }
            }
        });
    }

    /**
     * Gemini AI 심층 인사이트 리포트 비동기 호출
     */
    async function fetchAiInsight(statsData) {
        aiLoading.classList.remove("hidden");
        aiReportContent.innerHTML = "";
        currentAiReportRaw = "";

        try {
            const response = await fetch("/ai-insight", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ stats: statsData })
            });

            const resData = await response.json();
            if (!response.ok || !resData.success) {
                throw new Error(resData.error || "AI 리포트 생성에 실패했습니다.");
            }

            currentAiReportRaw = resData.insight;
            // Marked.js로 마크다운을 HTML로 파싱하여 렌더링
            aiReportContent.innerHTML = marked.parse(resData.insight);

        } catch (err) {
            aiReportContent.innerHTML = `
                <div class="error-banner">
                    <span class="error-icon">⚠️</span>
                    <span>AI 리포트 호출 실패: ${err.message}</span>
                </div>
            `;
        } finally {
            aiLoading.classList.add("hidden");
        }
    }

    function showLoading(msg) {
        loadingMessage.textContent = msg;
        loadingIndicator.classList.remove("hidden");
    }

    function hideLoading() {
        loadingIndicator.classList.add("hidden");
    }

    function showError(msg) {
        errorMessage.textContent = msg;
        errorBanner.style.backgroundColor = "var(--danger-light)";
        errorBanner.style.borderColor = "#fca5a5";
        errorBanner.style.color = "#b91c1c";
        errorBanner.querySelector(".error-icon").textContent = "⚠️";
        errorBanner.classList.remove("hidden");
    }

    function showNotice(msg) {
        errorMessage.textContent = msg;
        errorBanner.style.backgroundColor = "var(--primary-light)";
        errorBanner.style.borderColor = "#bfdbfe";
        errorBanner.style.color = "#1d4ed8";
        errorBanner.querySelector(".error-icon").textContent = "ℹ️";
        errorBanner.classList.remove("hidden");
    }

    function hideError() {
        errorBanner.classList.add("hidden");
    }
});
