// 전역 상태 관리
let fileQueue = [];
let chartInstances = {
    quintileCompare: null,
    regionPir: null,
    savingsYears: null,
    scatterPlot: null,
    mobilityGap: null
};
let currentReportMarkdown = "";
let latestAnalysisStats = null; // 현재 분석된 최신 데이터셋 통계 보관

document.addEventListener("DOMContentLoaded", () => {
    // DOM 요소 캐싱
    const dropZone = document.getElementById("dropZone");
    const csvFileInput = document.getElementById("csvFileInput");
    const fileQueueSection = document.getElementById("fileQueueSection");
    const fileCardsList = document.getElementById("fileCardsList");
    const queueCount = document.getElementById("queueCount");
    const btnClearQueue = document.getElementById("btnClearQueue");

    const btnUploadAnalyze = document.getElementById("btnUploadAnalyze");
    const btnSampleAnalyze = document.getElementById("btnSampleAnalyze");

    const loadingIndicator = document.getElementById("loadingIndicator");
    const loadingTitle = document.getElementById("loadingTitle");
    const loadingMessage = document.getElementById("loadingMessage");

    const noticeBanner = document.getElementById("noticeBanner");
    const noticeIcon = document.getElementById("noticeIcon");
    const noticeMessage = document.getElementById("noticeMessage");
    const btnDismissNotice = document.getElementById("btnDismissNotice");

    const resultSection = document.getElementById("resultSection");
    const tabButtons = document.querySelectorAll(".tab-btn");
    const tabPanes = document.querySelectorAll(".tab-pane");

    const aiLoadingIndicator = document.getElementById("aiLoadingIndicator");
    const reportContentArea = document.getElementById("reportContentArea");
    const btnCopyReport = document.getElementById("btnCopyReport");
    const btnDownloadReport = document.getElementById("btnDownloadReport");
    const previewTableBody = document.getElementById("previewTableBody");

    // 시뮬레이터 관련 DOM 요소
    const simIncomeInput = document.getElementById("simIncomeInput");
    const simMonthlyIncomeDisplay = document.getElementById("simMonthlyIncomeDisplay");
    const simTargetRegion = document.getElementById("simTargetRegion");
    const simSavingsRate = document.getElementById("simSavingsRate");
    const savingsRateDisplay = document.getElementById("savingsRateDisplay");
    const simMonthlySavingsEstimate = document.getElementById("simMonthlySavingsEstimate");
    const simCurrentSavings = document.getElementById("simCurrentSavings");
    const btnCalculateAffordability = document.getElementById("btnCalculateAffordability");

    // 시뮬레이터 결과 DOM 요소
    const simDifficultyBadge = document.getElementById("simDifficultyBadge");
    const simRealYearsResult = document.getElementById("simRealYearsResult");
    const simDurationSub = document.getElementById("simDurationSub");
    const simAvgPriceResult = document.getElementById("simAvgPriceResult");
    const simCustomPirResult = document.getElementById("simCustomPirResult");
    const simAnnualSavingsResult = document.getElementById("simAnnualSavingsResult");
    const simLoanAssistedResult = document.getElementById("simLoanAssistedResult");
    const simAdviceText = document.getElementById("simAdviceText");

    // AI Q&A 채팅 관련 DOM 요소
    const chatMessagesContainer = document.getElementById("chatMessagesContainer");
    const chatInputText = document.getElementById("chatInputText");
    const btnSendChat = document.getElementById("btnSendChat");
    const quickChips = document.querySelectorAll(".quick-chip");

    /* ================= 1. 파일 누적 업로드 & 드래그 앤 드롭 ================= */

    // 드롭존 클릭 시 파일 선택창 열기
    dropZone.addEventListener("click", () => {
        csvFileInput.click();
    });

    // 파일 input change (1개 또는 여러 개 선택 시 큐에 계속 누적)
    csvFileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files.length > 0) {
            addFilesToQueue(e.target.files);
            csvFileInput.value = ""; // 동일 파일 재선택 허용
        }
    });

    // 드래그 앤 드롭 이벤트
    ["dragenter", "dragover"].forEach((eventName) => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add("dragover");
        });
    });

    ["dragleave", "drop"].forEach((eventName) => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove("dragover");
        });
    });

    dropZone.addEventListener("drop", (e) => {
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length > 0) {
            addFilesToQueue(dt.files);
        }
    });

    function addFilesToQueue(newFiles) {
        let addedCount = 0;
        Array.from(newFiles).forEach((file) => {
            const ext = file.name.split(".").pop().toLowerCase();
            if (!["csv", "xlsx", "xls"].includes(ext)) {
                showNotice(`지원되지 않는 형식입니다: ${file.name} (.csv 또는 .xlsx 파일만 가능)`, "warning");
                return;
            }
            // 중복 파일명 체크
            const exists = fileQueue.some((f) => f.name === file.name && f.size === file.size);
            if (!exists) {
                fileQueue.push(file);
                addedCount++;
            }
        });

        if (addedCount > 0) {
            renderFileQueue();
            hideNotice();
        }
    }

    function renderFileQueue() {
        if (fileQueue.length === 0) {
            fileQueueSection.classList.add("hidden");
            queueCount.textContent = "0";
            fileCardsList.innerHTML = "";
            return;
        }

        fileQueueSection.classList.remove("hidden");
        queueCount.textContent = fileQueue.length;
        fileCardsList.innerHTML = "";

        fileQueue.forEach((file, index) => {
            const ext = file.name.split(".").pop().toUpperCase();
            const sizeStr = file.size > 1024 * 1024
                ? (file.size / (1024 * 1024)).toFixed(1) + "MB"
                : (file.size / 1024).toFixed(0) + "KB";

            const card = document.createElement("div");
            card.className = "file-card-item";
            card.innerHTML = `
                <span class="file-badge">${ext}</span>
                <span class="file-name" title="${file.name}">${file.name}</span>
                <span class="file-size">${sizeStr}</span>
                <button class="btn-remove-file" title="이 파일 제거" data-index="${index}">&times;</button>
            `;
            fileCardsList.appendChild(card);
        });

        // 개별 파일 삭제 버튼 이벤트
        fileCardsList.querySelectorAll(".btn-remove-file").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute("data-index"), 10);
                fileQueue.splice(idx, 1);
                renderFileQueue();
            });
        });
    }

    // 큐 전체 비우기
    btnClearQueue.addEventListener("click", () => {
        fileQueue = [];
        renderFileQueue();
    });

    // 알림 배너 닫기
    btnDismissNotice.addEventListener("click", hideNotice);

    /* ================= 2. 탭 전환 제어 ================= */
    tabButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            tabButtons.forEach((b) => b.classList.remove("active"));
            tabPanes.forEach((p) => p.classList.remove("active"));

            btn.classList.add("active");
            const targetId = btn.getAttribute("data-tab");
            const targetPane = document.getElementById(targetId);
            if (targetPane) {
                targetPane.classList.add("active");
            }
        });
    });

    /* ================= 3. 분석 요청 트리거 ================= */

    // 샘플 데이터 분석
    btnSampleAnalyze.addEventListener("click", () => {
        executeConsolidatedAnalysis({ useSample: true });
    });

    // 업로드 파일 통합 분석
    btnUploadAnalyze.addEventListener("click", () => {
        if (fileQueue.length === 0) {
            showNotice("분석할 CSV 또는 Excel 데이터 파일을 하나 이상 추가해 주세요.", "warning");
            dropZone.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
        }
        executeConsolidatedAnalysis({ useSample: false, files: fileQueue });
    });

    /* ================= 4. 비동기 분석 실행 ================= */
    async function executeConsolidatedAnalysis({ useSample = false, files = [] }) {
        hideNotice();
        showLoading(
            useSample ? "기본 검증 데이터 정제 중" : `총 ${files.length}개 파일 병합 및 정제 중`,
            useSample
                ? "표준 데이터셋을 파싱하고 소득 분위별 PIR 지표를 계산하고 있습니다..."
                : `${files.length}개의 데이터셋을 하나의 통합 프레임으로 결합하여 다각도 실증 분석을 수행합니다...`
        );

        const formData = new FormData();
        if (useSample) {
            formData.append("use_sample", "true");
        } else {
            files.forEach((file) => {
                formData.append("files", file);
            });
        }

        try {
            const response = await fetch("/analyze", {
                method: "POST",
                body: formData
            });

            const resData = await response.json();
            if (!response.ok || !resData.success) {
                throw new Error(resData.error || "데이터 분석 중 예기치 않은 오류가 발생했습니다.");
            }

            hideLoading();
            renderDashboardView(resData.data);

            if (resData.notice) {
                showNotice(resData.notice, "info");
            }

            // AI 리포트 자동 호출
            fetchAiEconometricReport(resData.data);

        } catch (err) {
            hideLoading();
            showNotice(err.message, "danger");
        }
    }

    /* ================= 5. 대시보드 뷰 렌더링 ================= */
    function renderDashboardView(data) {
        latestAnalysisStats = data;
        resultSection.classList.remove("hidden");

        const kpi = data.kpi;
        document.getElementById("kpiTotalRecords").textContent = kpi.total_records.toLocaleString();
        document.getElementById("kpiFileSummary").textContent = `병합된 파일 ${data.file_count || 1}개 기준 통계`;
        document.getElementById("kpiAvgPir").textContent = kpi.avg_pir;
        document.getElementById("kpiAvgIncome").textContent = kpi.avg_income_manwon.toLocaleString();
        document.getElementById("kpiMonthlyIncome").textContent = Math.round(kpi.avg_income_manwon / 12).toLocaleString();
        document.getElementById("kpiAvgPrice").textContent = kpi.avg_price_manwon.toLocaleString();
        document.getElementById("kpiMedianPrice").textContent = kpi.median_price_manwon.toLocaleString();
        document.getElementById("kpiIncomeGap").textContent = kpi.income_gap_ratio;
        document.getElementById("kpiAssetGap").textContent = kpi.asset_gap_ratio;

        // 4종 차트 렌더링
        renderChartQuintileCompare(data.quintile_chart);
        renderChartRegionPir(data.region_pir_list);
        renderChartSavingsYears(data.quintile_chart);
        renderChartScatterPlot(data.scatter_chart);

        // 원본 데이터 미리보기 표 렌더링
        renderPreviewTable(data.table_preview || []);

        // 시뮬레이터 지역 드롭다운 옵션 자동 채우기 및 최초 1회 계산
        populateSimulatorRegions(data.region_pir_list);
        executeSimulatorCalculation();
        executeMobilitySimulation(); // 추격 시뮬레이터 최초 1회 자동 계산

        // 첫 번째 탭 활성화 & 스크롤 이동
        document.querySelector('.tab-btn[data-tab="tabOverview"]').click();
        resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    /* ================= 6. Chart.js 4종 프로페셔널 차트 ================= */

    // 차트 1: 분위별 소득 vs 집값 복합 막대 차트
    function renderChartQuintileCompare(qData) {
        const ctx = document.getElementById("chartQuintileCompare").getContext("2d");
        if (chartInstances.quintileCompare) chartInstances.quintileCompare.destroy();

        chartInstances.quintileCompare = new Chart(ctx, {
            type: "bar",
            data: {
                labels: qData.labels,
                datasets: [
                    {
                        label: "연간 가구소득 (만원)",
                        data: qData.incomes,
                        backgroundColor: "rgba(37, 99, 235, 0.85)",
                        borderRadius: 6,
                        order: 2
                    },
                    {
                        label: "평균 주택가격 (만원)",
                        data: qData.prices,
                        backgroundColor: "rgba(239, 68, 68, 0.85)",
                        borderRadius: 6,
                        order: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: "top", labels: { font: { weight: "bold" } } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${ctx.raw.toLocaleString()} 만원 (${(ctx.raw / 10000).toFixed(1)}억원)`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: (v) => `${(v / 10000).toFixed(0)}억`
                        }
                    }
                }
            }
        });
    }

    // 차트 2: 권역별 주거 부담 PIR 수평 바 차트
    function renderChartRegionPir(regions) {
        const ctx = document.getElementById("chartRegionPir").getContext("2d");
        if (chartInstances.regionPir) chartInstances.regionPir.destroy();

        const topRegions = (regions || []).slice(0, 7);
        const labels = topRegions.map((r) => r.region);
        const pirs = topRegions.map((r) => r.pir);
        const colors = pirs.map((val) => (val >= 12.0 ? "rgba(239, 68, 68, 0.85)" : "rgba(99, 102, 241, 0.85)"));

        chartInstances.regionPir = new Chart(ctx, {
            type: "bar",
            data: {
                labels: labels,
                datasets: [
                    {
                        label: "PIR 배수 (년)",
                        data: pirs,
                        backgroundColor: colors,
                        borderRadius: 6
                    }
                ]
            },
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `평균 PIR: ${ctx.raw}배 (적정 기준 5배 대비 ${(ctx.raw / 5.0).toFixed(1)}배 부담)`
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        title: { display: true, text: "PIR (소득 대비 주택가격 배수)" }
                    }
                }
            }
        });
    }

    // 차트 3: 소요 연수 비교 (PIR 이론치 vs 실질 저축 25%)
    function renderChartSavingsYears(qData) {
        const ctx = document.getElementById("chartSavingsYears").getContext("2d");
        if (chartInstances.savingsYears) chartInstances.savingsYears.destroy();

        const theoreticalPirs = qData.pirs;
        const realSavingsYears = theoreticalPirs.map((p) => Math.round((p / 0.25) * 10) / 10);

        chartInstances.savingsYears = new Chart(ctx, {
            type: "bar",
            data: {
                labels: qData.labels,
                datasets: [
                    {
                        label: "이론적 PIR (소득 100% 저축 시)",
                        data: theoreticalPirs,
                        backgroundColor: "rgba(148, 163, 184, 0.7)",
                        borderRadius: 6
                    },
                    {
                        label: "실질 내 집 마련 기간 (평균 저축률 25% 가정)",
                        data: realSavingsYears,
                        backgroundColor: "rgba(245, 158, 11, 0.85)",
                        borderRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: "top", labels: { font: { weight: "bold" } } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${ctx.raw}년 소요`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: "소요 연수 (년)" }
                    }
                }
            }
        });
    }

    // 차트 4: 소득-집값 산점도
    function renderChartScatterPlot(scatterData) {
        const ctx = document.getElementById("chartScatterPlot").getContext("2d");
        if (chartInstances.scatterPlot) chartInstances.scatterPlot.destroy();

        chartInstances.scatterPlot = new Chart(ctx, {
            type: "scatter",
            data: {
                datasets: [
                    {
                        label: "가구 소득-주택가격 표본",
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
                                    `지역: ${pt.region} (${pt.quintile})`,
                                    `연소득: ${pt.x.toLocaleString()}만원`,
                                    `주택가격: ${pt.y.toLocaleString()}만원 (${(pt.y / 10000).toFixed(1)}억)`,
                                    `PIR: ${pt.pir}배`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: "연간 가구소득 (만원)" },
                        ticks: { callback: (v) => `${(v / 1000).toFixed(0)}천만` }
                    },
                    y: {
                        title: { display: true, text: "평균 주택가격 (만원)" },
                        ticks: { callback: (v) => `${(v / 10000).toFixed(0)}억` }
                    }
                }
            }
        });
    }

    /* ================= 7. 원본 데이터 미리보기 표 ================= */
    function renderPreviewTable(rows) {
        previewTableBody.innerHTML = "";
        if (!rows || rows.length === 0) {
            previewTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px;">데이터가 없습니다.</td></tr>`;
            return;
        }

        rows.forEach((r, idx) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${idx + 1}</td>
                <td><strong>${r.region}</strong></td>
                <td>${r.quintile}</td>
                <td>${r.income.toLocaleString()} 만원</td>
                <td>${r.price.toLocaleString()} 만원</td>
                <td><strong style="color: var(--danger);">${r.pir}배</strong></td>
            `;
            previewTableBody.appendChild(tr);
        });
    }

    /* ================= 8. AI 심층 리포트 통신 및 렌더링 ================= */
    async function fetchAiEconometricReport(statsData) {
        aiLoadingIndicator.classList.remove("hidden");
        reportContentArea.innerHTML = "";
        currentReportMarkdown = "";

        try {
            const res = await fetch("/ai-insight", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ stats: statsData })
            });

            const resData = await res.json();
            if (!res.ok || !resData.success) {
                throw new Error(resData.error || "심층 리포트 생성 실패");
            }

            currentReportMarkdown = resData.insight;
            reportContentArea.innerHTML = marked.parse(resData.insight);

        } catch (err) {
            reportContentArea.innerHTML = `
                <div class="alert-banner">
                    <span class="alert-icon">⚠️</span>
                    <span class="alert-text">리포트 생성 중 문제가 발생했습니다: ${err.message}</span>
                </div>
            `;
        } finally {
            aiLoadingIndicator.classList.add("hidden");
        }
    }

    // 리포트 클립보드 복사
    btnCopyReport.addEventListener("click", async () => {
        if (!currentReportMarkdown) return;
        try {
            await navigator.clipboard.writeText(currentReportMarkdown);
            const orig = btnCopyReport.textContent;
            btnCopyReport.textContent = "✅ 복사 완료!";
            setTimeout(() => { btnCopyReport.textContent = orig; }, 2000);
        } catch {
            alert("클립보드 접근 권한을 확인해 주세요.");
        }
    });

    // 리포트 마크다운(.md) 파일 저장
    btnDownloadReport.addEventListener("click", () => {
        if (!currentReportMarkdown) return;
        const blob = new Blob([currentReportMarkdown], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const dateStr = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `대한민국_소득부동산_심층경제분석보고서_${dateStr}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    /* ================= 9. 유틸리티 알림 함수 ================= */
    function showLoading(title, msg) {
        loadingTitle.textContent = title;
        loadingMessage.textContent = msg;
        loadingIndicator.classList.remove("hidden");
    }

    function hideLoading() {
        loadingIndicator.classList.add("hidden");
    }

    function showNotice(msg, type = "info") {
        noticeMessage.textContent = msg;
        if (type === "warning") {
            noticeBanner.style.backgroundColor = "var(--warning-light)";
            noticeBanner.style.borderColor = "#fde68a";
            noticeBanner.style.color = "#92400e";
            noticeIcon.textContent = "⚠️";
        } else if (type === "danger") {
            noticeBanner.style.backgroundColor = "var(--danger-light)";
            noticeBanner.style.borderColor = "#fca5a5";
            noticeBanner.style.color = "#991b1b";
            noticeIcon.textContent = "🚨";
        } else {
            noticeBanner.style.backgroundColor = "var(--brand-primary-light)";
            noticeBanner.style.borderColor = "#bfdbfe";
            noticeBanner.style.color = "#1e40af";
            noticeIcon.textContent = "ℹ️";
        }
        noticeBanner.classList.remove("hidden");
    }

    function hideNotice() {
        noticeBanner.classList.add("hidden");
    }

    /* ================= 10. 맞춤형 내 집 마련 시뮬레이터 로직 ================= */

    function populateSimulatorRegions(regions) {
        simTargetRegion.innerHTML = `<option value="전국">전체 평균 기준</option>`;
        if (regions && regions.length > 0) {
            regions.forEach((r) => {
                const opt = document.createElement("option");
                opt.value = r.region;
                opt.textContent = `${r.region} (평균 PIR ${r.pir}배)`;
                simTargetRegion.appendChild(opt);
            });
        }
    }

    // 소득 입력 시 월 환산액 동적 갱신
    simIncomeInput.addEventListener("input", () => {
        const income = parseFloat(simIncomeInput.value) || 0;
        simMonthlyIncomeDisplay.textContent = Math.round(income / 12).toLocaleString();
        updateSavingsEstimate();
    });

    // 저축률 슬라이더 실시간 갱신
    simSavingsRate.addEventListener("input", () => {
        savingsRateDisplay.textContent = simSavingsRate.value;
        updateSavingsEstimate();
    });

    function updateSavingsEstimate() {
        const income = parseFloat(simIncomeInput.value) || 0;
        const rate = parseFloat(simSavingsRate.value) || 30;
        const monthlySavings = Math.round((income * (rate / 100)) / 12);
        simMonthlySavingsEstimate.textContent = monthlySavings.toLocaleString();
    }

    // 시뮬레이션 계산 실행
    btnCalculateAffordability.addEventListener("click", executeSimulatorCalculation);

    async function executeSimulatorCalculation() {
        if (!latestAnalysisStats) return;

        const income = parseFloat(simIncomeInput.value) || 6000;
        const targetRegion = simTargetRegion.value;
        const savingsRate = parseFloat(simSavingsRate.value) || 30;
        const currentSavings = parseFloat(simCurrentSavings.value) || 0;

        btnCalculateAffordability.disabled = true;
        btnCalculateAffordability.textContent = "계산 중...";

        try {
            const res = await fetch("/simulate-affordability", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    annual_income: income,
                    target_region: targetRegion,
                    savings_rate: savingsRate,
                    current_savings: currentSavings,
                    stats: latestAnalysisStats
                })
            });

            const resData = await res.json();
            if (!res.ok || !resData.success) {
                throw new Error(resData.error || "시뮬레이션 연산 실패");
            }

            const r = resData.result;
            // 결과 화면 업데이트
            simRealYearsResult.textContent = r.time_text;
            simDurationSub.textContent = `매월 ${r.monthly_savings_manwon.toLocaleString()}만원씩 한 푼도 빼놓지 않고 순수 저축 시`;
            simAvgPriceResult.textContent = `${r.avg_price_manwon.toLocaleString()}만원 (${(r.avg_price_manwon / 10000).toFixed(1)}억원)`;
            simCustomPirResult.textContent = `${r.custom_pir}배`;
            simAnnualSavingsResult.textContent = `${(r.monthly_savings_manwon * 12).toLocaleString()}만원`;
            simLoanAssistedResult.textContent = `약 ${r.loan_time_text} (대출 ${r.loan_limit_manwon.toLocaleString()}만원 활용 시)`;

            simDifficultyBadge.textContent = r.difficulty_level;
            simDifficultyBadge.className = `badge ${r.difficulty_badge}`;

            // AI 진단 코멘트
            if (r.real_years <= 6) {
                simAdviceText.textContent = `🎉 [매우 긍정적] 현재 설정하신 연소득(${income.toLocaleString()}만원)과 저축률(${savingsRate}%)은 목표 지역 주택 진입에 매우 유리한 안정권입니다. 시드머니(${currentSavings.toLocaleString()}만원)를 기반으로 우수한 입지를 선점할 수 있는 여력이 충분합니다.`;
            } else if (r.real_years <= 14) {
                simAdviceText.textContent = `📊 [현실적 궤도] 순수 저축 시 ${r.time_text}가 소요되지만, DSR 40% 한도 내 정책 모기지(최대 약 ${r.loan_limit_manwon.toLocaleString()}만원)를 전략적으로 병행할 경우 내 집 마련 소요 기간을 [${r.loan_time_text}] 수준으로 획기적으로 단축할 수 있습니다.`;
            } else {
                simAdviceText.textContent = `⚠️ [주거 과부담 경고] 목표 지역의 평균 주택 가격이 현재 소득 수준 대비 매우 높아 자력 진입에 ${r.time_text}의 장기 소요가 예상됩니다. 무리한 영끌보다는 인근의 실속형 거주지나 공공분양 청약(지분적립형 등)을 우선 탐색하는 포트폴리오 다변화를 권장합니다.`;
            }

        } catch (err) {
            alert(`시뮬레이션 오류: ${err.message}`);
        } finally {
            btnCalculateAffordability.disabled = false;
            btnCalculateAffordability.textContent = "⏱️ 실질 소요 기간 및 금융 시뮬레이션 계산";
        }
    }

    /* ================= 11. AI 자연어 질의응답 (Q&A) 로직 ================= */

    // 추천 질문 칩 클릭
    quickChips.forEach((chip) => {
        chip.addEventListener("click", () => {
            const q = chip.getAttribute("data-question");
            chatInputText.value = q;
            sendChatMessage();
        });
    });

    // 질문 전송 버튼 및 엔터 키
    btnSendChat.addEventListener("click", sendChatMessage);
    chatInputText.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }
    });

    async function sendChatMessage() {
        const question = chatInputText.value.trim();
        if (!question) return;

        // 1. 사용자 말풍선 추가
        appendChatBubble("user", "나의 질문", question);
        chatInputText.value = "";

        // 2. 로딩 말풍선 추가
        const loadingId = "loadingBubble_" + Date.now();
        appendChatBubble("ai", "AI 데이터 이코노미스트", `<div class="spinner-small" style="display:inline-block; margin-right:8px;"></div>데이터셋을 분석하여 답변을 구성하고 있습니다...`, loadingId);

        try {
            const res = await fetch("/ask-ai", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    question: question,
                    stats: latestAnalysisStats || {}
                })
            });

            const resData = await res.json();
            if (!res.ok || !resData.success) {
                throw new Error(resData.error || "답변을 가져오지 못했습니다.");
            }

            // 로딩 말풍선을 실제 답변으로 교체
            const loadingBubble = document.getElementById(loadingId);
            if (loadingBubble) {
                const senderEl = loadingBubble.querySelector(".bubble-sender");
                const bodyEl = loadingBubble.querySelector(".bubble-body");
                const modelBadge = resData.model ? ` <span class="badge" style="font-size:0.72rem; padding:2px 7px; background:var(--brand-accent-light); color:var(--brand-accent); font-weight:700;">${resData.model}</span>` : "";
                senderEl.innerHTML = `AI 데이터 이코노미스트${modelBadge}`;
                bodyEl.innerHTML = marked.parse(resData.answer);
            }

        } catch (err) {
            const loadingBubble = document.getElementById(loadingId);
            if (loadingBubble) {
                const bodyEl = loadingBubble.querySelector(".bubble-body");
                bodyEl.innerHTML = `<span style="color:var(--danger);">⚠️ 오류: ${err.message}</span>`;
            }
        } finally {
            chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
        }
    }

    /* ================= 12. 소득 vs 집값 추격 시뮬레이터 로직 ================= */
    const mobIncomeInput = document.getElementById("mobIncomeInput");
    const mobIncomeGrowth = document.getElementById("mobIncomeGrowth");
    const mobIncomeGrowthDisplay = document.getElementById("mobIncomeGrowthDisplay");
    const mobTargetHousePrice = document.getElementById("mobTargetHousePrice");
    const mobHouseGrowth = document.getElementById("mobHouseGrowth");
    const mobHouseGrowthDisplay = document.getElementById("mobHouseGrowthDisplay");
    const mobSavingsRate = document.getElementById("mobSavingsRate");
    const mobSavingsRateDisplay = document.getElementById("mobSavingsRateDisplay");
    const mobCurrentWealth = document.getElementById("mobCurrentWealth");
    const mobSimYears = document.getElementById("mobSimYears");
    const btnRunMobilitySim = document.getElementById("btnRunMobilitySim");

    const mobVerdictBanner = document.getElementById("mobVerdictBanner");
    const mobVerdictBadge = document.getElementById("mobVerdictBadge");
    const mobVerdictTitle = document.getElementById("mobVerdictTitle");
    const mobSpreadVal = document.getElementById("mobSpreadVal");
    const mobGapChangeVal = document.getElementById("mobGapChangeVal");
    const mobInitialGap = document.getElementById("mobInitialGap");
    const mobFinalGap = document.getElementById("mobFinalGap");
    const mobCrossoverVal = document.getElementById("mobCrossoverVal");
    const mobAnalysisSummary = document.getElementById("mobAnalysisSummary");

    // 슬라이더 실시간 갱신
    if (mobIncomeGrowth) {
        mobIncomeGrowth.addEventListener("input", () => {
            mobIncomeGrowthDisplay.textContent = parseFloat(mobIncomeGrowth.value).toFixed(1);
        });
    }
    if (mobHouseGrowth) {
        mobHouseGrowth.addEventListener("input", () => {
            mobHouseGrowthDisplay.textContent = parseFloat(mobHouseGrowth.value).toFixed(1);
        });
    }
    if (mobSavingsRate) {
        mobSavingsRate.addEventListener("input", () => {
            mobSavingsRateDisplay.textContent = mobSavingsRate.value;
        });
    }

    if (btnRunMobilitySim) {
        btnRunMobilitySim.addEventListener("click", executeMobilitySimulation);
    }

    async function executeMobilitySimulation() {
        if (!latestAnalysisStats) return;

        const income = parseFloat(mobIncomeInput.value) || 6500;
        const incomeGrowth = parseFloat(mobIncomeGrowth.value) || 5.0;
        const targetPrice = parseFloat(mobTargetHousePrice.value) || 150000;
        const houseGrowth = parseFloat(mobHouseGrowth.value) || 7.0;
        const savingsRate = parseFloat(mobSavingsRate.value) || 35.0;
        const currentWealth = parseFloat(mobCurrentWealth.value) || 5000;
        const simYears = parseInt(mobSimYears.value, 10) || 15;

        btnRunMobilitySim.disabled = true;
        btnRunMobilitySim.textContent = "시뮬레이션 연산 중...";

        try {
            const res = await fetch("/simulate-mobility-gap", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    start_income: income,
                    income_growth_rate: incomeGrowth,
                    target_house_price: targetPrice,
                    house_growth_rate: houseGrowth,
                    savings_rate: savingsRate,
                    current_wealth: currentWealth,
                    sim_years: simYears,
                    stats: latestAnalysisStats
                })
            });

            const resData = await res.json();
            if (!res.ok || !resData.success) {
                throw new Error(resData.error || "추격 시뮬레이션 실패");
            }

            const r = resData.result;

            // 1. 상태 배너 및 배지 업데이트
            mobVerdictBadge.textContent = r.status_verdict;
            mobVerdictBadge.className = `verdict-badge ${r.status_badge}`;
            mobVerdictBanner.className = `verdict-banner ${r.status_badge}`;

            if (r.status_badge === "success") {
                mobVerdictBanner.querySelector(".verdict-icon").textContent = "🎉";
                mobVerdictTitle.textContent = `축하합니다! 약 ${r.crossover_year}년차에 목표 상위 부동산을 자력 취득할 수 있습니다`;
            } else if (r.status_badge === "danger") {
                mobVerdictBanner.querySelector(".verdict-icon").textContent = "🚨";
                mobVerdictTitle.textContent = `상위 자산 상승 속도(r)가 소득 증가 속도(g)를 압도하여 격차가 계속 확대됩니다`;
            } else {
                mobVerdictBanner.querySelector(".verdict-icon").textContent = "⏳";
                mobVerdictTitle.textContent = `격차가 좁혀지고 있으나, 관측 기간 내 완전한 골든 크로스에는 도달하지 못했습니다`;
            }

            // 2. KPI 요약 수치
            mobSpreadVal.textContent = (r.r_minus_g > 0 ? `+${r.r_minus_g}` : `${r.r_minus_g}`);
            mobGapChangeVal.textContent = `${r.gap_change_ratio}배`;
            mobInitialGap.textContent = `${(r.initial_gap / 10000).toFixed(1)}억`;
            mobFinalGap.textContent = `${(r.final_gap / 10000).toFixed(1)}억`;
            mobCrossoverVal.textContent = r.crossover_year ? `${r.crossover_year}년차 도달` : "도달 불가";

            // 3. 차트 렌더링 (Chart.js 복합 시계열 차트)
            renderChartMobilityGap(r);

            // 4. 학술적 총평 마크다운 렌더링
            mobAnalysisSummary.innerHTML = marked.parse(r.analysis_summary);

        } catch (err) {
            alert(`추격 시뮬레이션 오류: ${err.message}`);
        } finally {
            btnRunMobilitySim.disabled = false;
            btnRunMobilitySim.textContent = "⚡ 시계열 상관관계 시뮬레이션 재연산";
        }
    }

    function renderChartMobilityGap(rData) {
        const ctx = document.getElementById("chartMobilityGap").getContext("2d");
        if (chartInstances.mobilityGap) chartInstances.mobilityGap.destroy();

        chartInstances.mobilityGap = new Chart(ctx, {
            type: "line",
            data: {
                labels: rData.years_labels,
                datasets: [
                    {
                        type: "line",
                        label: "목표 상위 주택가격 (만원)",
                        data: rData.house_prices,
                        borderColor: "rgba(239, 68, 68, 1)",
                        backgroundColor: "rgba(239, 68, 68, 0.1)",
                        borderWidth: 3,
                        pointRadius: 4,
                        pointHoverRadius: 7,
                        tension: 0.2,
                        order: 1
                    },
                    {
                        type: "line",
                        label: "내 누적 순자산 형성선 (만원)",
                        data: rData.wealth,
                        borderColor: "rgba(37, 99, 235, 1)",
                        backgroundColor: "rgba(37, 99, 235, 0.15)",
                        borderWidth: 3,
                        pointRadius: 4,
                        pointHoverRadius: 7,
                        tension: 0.2,
                        fill: true,
                        order: 2
                    },
                    {
                        type: "bar",
                        label: "필요 추가 자산 갭 (만원)",
                        data: rData.gaps.map(g => Math.max(0, g)),
                        backgroundColor: "rgba(148, 163, 184, 0.4)",
                        borderRadius: 4,
                        order: 3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: "index",
                    intersect: false
                },
                plugins: {
                    legend: { position: "top", labels: { font: { weight: "bold" } } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const val = ctx.raw;
                                return `${ctx.dataset.label}: ${val.toLocaleString()}만원 (${(val / 10000).toFixed(1)}억원)`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: (v) => `${(v / 10000).toFixed(0)}억`
                        }
                    }
                }
            }
        });
    }
});

