// 전역 상태 관리
let fileQueue = [];
let chartInstances = {
    quintileCompare: null,
    regionPir: null,
    savingsYears: null,
    scatterPlot: null
};
let currentReportMarkdown = "";

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
});
