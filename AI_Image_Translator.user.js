// ==UserScript==
// @name         AI 圖片自動翻譯 V7.3 - Google Vision
// @namespace    cgl287
// @version      7.3
// @description  Google Vision OCR + Google Translation + Image Relative Overlay
// @match        *://*/*
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
    "use strict";

    // =========================================================
    // 設定
    // =========================================================

    const WORKER_URL =
        "https://safari-image-translator.cgl20050126.workers.dev";

    const MIN_IMAGE_WIDTH = 200;
    const MIN_IMAGE_HEIGHT = 200;

    const MAX_IMAGE_COUNT = 80;

    // =========================================================
    // 狀態
    // =========================================================

    let processLoopRunning = false;

    let totalImages = 0;
    let processingCount = 0;
    let completedCount = 0;
    let failedCount = 0;

    const processedImages =
        new WeakSet();

    const imageRecords =
        new Set();

    // =========================================================
    // Status Panel
    // =========================================================

    const panel =
        document.createElement("div");

    panel.id = "gm-translator-panel";

    Object.assign(panel.style, {
        position: "fixed",
        top: "10px",
        right: "10px",

        zIndex: "2147483647",

        background: "rgba(0,0,0,0.85)",
        color: "#fff",

        padding: "10px 12px",

        borderRadius: "8px",

        fontFamily:
            "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",

        fontSize: "13px",
        lineHeight: "1.5",

        minWidth: "190px",

        boxShadow:
            "0 2px 12px rgba(0,0,0,0.4)",

        pointerEvents: "none"
    });

    panel.innerHTML =
        `<b>Google Manga Translator</b>
         <div id="gm-status">初始化...</div>`;

    document.documentElement.appendChild(panel);

    const statusElement =
        panel.querySelector("#gm-status");

    function updateStatus(message = "") {

        statusElement.innerHTML =
            `圖片：${totalImages}
             處理：${processingCount}
             完成：${completedCount}
             失敗：${failedCount}
             <br>${message}`;
    }

    // =========================================================
    // GM.xmlHttpRequest 包裝
    // =========================================================

    function gmRequest(details) {

        return new Promise((resolve, reject) => {

            const handler =
                typeof GM !== "undefined" &&
                typeof GM.xmlHttpRequest === "function"
                    ? GM.xmlHttpRequest
                    : GM_xmlhttpRequest;

            handler({
                ...details,

                onload: resolve,

                onerror: reject,

                ontimeout: reject
            });
        });
    }

    // =========================================================
    // ArrayBuffer → Base64
    // =========================================================

    function arrayBufferToBase64(buffer) {

        const bytes =
            new Uint8Array(buffer);

        let binary = "";

        const chunkSize = 0x8000;

        for (
            let i = 0;
            i < bytes.length;
            i += chunkSize
        ) {

            const chunk =
                bytes.subarray(
                    i,
                    Math.min(
                        i + chunkSize,
                        bytes.length
                    )
                );

            binary +=
                String.fromCharCode(
                    ...chunk
                );
        }

        return btoa(binary);
    }

    // =========================================================
    // 取得圖片
    // =========================================================

    async function getImageBase64(img) {

        const src =
            img.currentSrc ||
            img.src;

        if (!src) {
            throw new Error(
                "Image source unavailable."
            );
        }

        const response =
            await gmRequest({
                method: "GET",

                url: src,

                responseType:
                    "arraybuffer",

                timeout: 30000
            });

        if (
            !response ||
            response.status < 200 ||
            response.status >= 400
        ) {

            throw new Error(
                `Image HTTP ${response?.status || 0}`
            );
        }

        return arrayBufferToBase64(
            response.response
        );
    }

    // =========================================================
    // 呼叫 Worker
    // =========================================================

    async function sendToWorker(base64) {

        const response =
            await gmRequest({

                method: "POST",

                url: WORKER_URL,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                data: JSON.stringify({
                    image: base64
                }),

                timeout: 120000
            });

        if (
            !response ||
            response.status < 200 ||
            response.status >= 300
        ) {

            throw new Error(
                `Worker HTTP ${response?.status || 0}`
            );
        }

        let data;

        try {

            data =
                JSON.parse(
                    response.responseText
                );

        } catch (error) {

            throw new Error(
                "Worker returned invalid JSON."
            );
        }

        if (data.error) {

            throw new Error(
                data.message ||
                data.details ||
                data.error
            );
        }

        return data;
    }

    // =========================================================
    // 建立圖片 Overlay Layer
    // =========================================================

    function createImageLayer(img) {

        const layer =
            document.createElement("div");

        layer.className =
            "gm-translation-layer";

        Object.assign(layer.style, {

            position: "fixed",

            left: "0",
            top: "0",

            width: "0",
            height: "0",

            pointerEvents: "none",

            zIndex: "2147483000"
        });

        document.documentElement.appendChild(
            layer
        );

        const record = {
            img,
            layer,
            boxes: [],

            imageWidth: 0,
            imageHeight: 0
        };

        imageRecords.add(record);

        return record;
    }

    // =========================================================
    // 重新定位所有翻譯框
    // =========================================================

    function updateRecord(record) {

        const img =
            record.img;

        if (
            !img ||
            !img.isConnected
        ) {
            return;
        }

        const rect =
            img.getBoundingClientRect();

        if (
            rect.width <= 0 ||
            rect.height <= 0
        ) {
            return;
        }

        const naturalWidth =
            record.imageWidth;

        const naturalHeight =
            record.imageHeight;

        if (
            !naturalWidth ||
            !naturalHeight
        ) {
            return;
        }

        const scaleX =
            rect.width /
            naturalWidth;

        const scaleY =
            rect.height /
            naturalHeight;

        for (const item of record.boxes) {

            const box =
                item.box;

            const overlay =
                item.element;

            let left =
                rect.left +
                box.x * scaleX;

            let top =
                rect.top +
                box.y * scaleY;

            let width =
                box.width *
                scaleX;

            let height =
                box.height *
                scaleY;

            // -------------------------------------------------
            // 小幅擴張，讓中文不容易露出原文
            // -------------------------------------------------

            const extraX =
                Math.min(
                    width * 0.08,
                    12
                );

            const extraY =
                Math.min(
                    height * 0.12,
                    8
                );

            left -= extraX;
            top -= extraY;

            width += extraX * 2;
            height += extraY * 2;

            // -------------------------------------------------
            // 避免超出圖片
            // -------------------------------------------------

            const imageLeft =
                rect.left;

            const imageTop =
                rect.top;

            const imageRight =
                rect.right;

            const imageBottom =
                rect.bottom;

            if (left < imageLeft) {

                width -=
                    imageLeft - left;

                left =
                    imageLeft;
            }

            if (top < imageTop) {

                height -=
                    imageTop - top;

                top =
                    imageTop;
            }

            if (
                left + width >
                imageRight
            ) {

                width =
                    imageRight - left;
            }

            if (
                top + height >
                imageBottom
            ) {

                height =
                    imageBottom - top;
            }

            // -------------------------------------------------
            // CSS
            // -------------------------------------------------

            Object.assign(
                overlay.style,
                {
                    left:
                        `${left}px`,

                    top:
                        `${top}px`,

                    width:
                        `${Math.max(width, 1)}px`,

                    minHeight:
                        `${Math.max(height, 1)}px`
                }
            );

            // -------------------------------------------------
            // 根據 OCR 高度決定中文字大小
            // -------------------------------------------------

            const fontSize =
                Math.max(
                    12,
                    Math.min(
                        height * 0.78,
                        32
                    )
                );

            overlay.style.fontSize =
                `${fontSize}px`;
        }
    }

    // =========================================================
    // 全部重新定位
    // =========================================================

    function updateAllRecords() {

        for (const record of imageRecords) {

            if (
                !record.img.isConnected
            ) {

                record.layer.remove();

                imageRecords.delete(
                    record
                );

                continue;
            }

            updateRecord(record);
        }
    }

    // =========================================================
    // 建立翻譯文字
    // =========================================================

    function renderTranslations(
        img,
        data
    ) {

        const record =
            createImageLayer(img);

        record.imageWidth =
            Number(data.image_width);

        record.imageHeight =
            Number(data.image_height);

        const blocks =
            Array.isArray(data.text_blocks)
                ? data.text_blocks
                : [];

        for (const block of blocks) {

            if (
                !block.translation ||
                !block.translation.trim()
            ) {
                continue;
            }

            const overlay =
                document.createElement("div");

            overlay.className =
                "gm-translation-overlay";

            overlay.textContent =
                block.translation;

            Object.assign(
                overlay.style,
                {

                    position: "fixed",

                    boxSizing:
                        "border-box",

                    padding:
                        "2px 4px",

                    margin: "0",

                    overflow:
                        "hidden",

                    display:
                        "flex",

                    alignItems:
                        "center",

                    justifyContent:
                        "center",

                    textAlign:
                        "center",

                    whiteSpace:
                        "pre-wrap",

                    wordBreak:
                        "break-word",

                    overflowWrap:
                        "anywhere",

                    background:
                        "rgba(255,255,255,0.96)",

                    color:
                        "#000",

                    fontFamily:
                        "'Noto Sans TC', 'Microsoft JhengHei', sans-serif",

                    fontWeight:
                        "500",

                    lineHeight:
                        "1.15",

                    borderRadius:
                        "2px",

                    pointerEvents:
                        "none",

                    userSelect:
                        "none",

                    zIndex:
                        "2147483001"
                }
            );

            record.layer.appendChild(
                overlay
            );

            record.boxes.push({
                box: {
                    x:
                        Number(block.x) || 0,

                    y:
                        Number(block.y) || 0,

                    width:
                        Number(block.width) || 1,

                    height:
                        Number(block.height) || 1
                },

                element:
                    overlay
            });
        }

        updateRecord(record);

        return record;
    }

    // =========================================================
    // 處理單張圖片
    // =========================================================

    async function processImage(img) {

        if (
            processedImages.has(img)
        ) {
            return;
        }

        processedImages.add(img);

        processingCount++;

        updateStatus(
            "取得圖片..."
        );

        try {

            // ---------------------------------------------
            // 等圖片載入
            // ---------------------------------------------

            if (!img.complete) {

                await new Promise(
                    resolve => {

                        const timer =
                            setTimeout(
                                resolve,
                                10000
                            );

                        img.addEventListener(
                            "load",
                            () => {

                                clearTimeout(
                                    timer
                                );

                                resolve();
                            },
                            {
                                once: true
                            }
                        );
                    }
                );
            }

            if (
                !img.naturalWidth ||
                !img.naturalHeight
            ) {

                throw new Error(
                    "Image has no natural size."
                );
            }

            if (
                img.naturalWidth <
                    MIN_IMAGE_WIDTH ||
                img.naturalHeight <
                    MIN_IMAGE_HEIGHT
            ) {

                processingCount--;
                return;
            }

            // ---------------------------------------------
            // 取得 Base64
            // ---------------------------------------------

            const base64 =
                await getImageBase64(img);

            updateStatus(
                "送往 Worker..."
            );

            // ---------------------------------------------
            // Google Vision + Translation
            // ---------------------------------------------

            const result =
                await sendToWorker(
                    base64
                );

            updateStatus(
                "Google Vision OCR 完成..."
            );

            // ---------------------------------------------
            // 顯示翻譯
            // ---------------------------------------------

            renderTranslations(
                img,
                result
            );

            completedCount++;

        } catch (error) {

            console.error(
                "[Google Manga Translator]",
                error
            );

            failedCount++;

        } finally {

            processingCount--;

            updateStatus(
                completedCount > 0
                    ? "完成"
                    : "等待處理"
            );
        }
    }

    // =========================================================
    // 掃描圖片
    // =========================================================

    function collectImages() {

        const images =
            Array.from(
                document.images
            );

        const valid =
            images.filter(img => {

                if (
                    !img.isConnected
                ) {
                    return false;
                }

                if (
                    processedImages.has(img)
                ) {
                    return false;
                }

                if (
                    img.naturalWidth <
                        MIN_IMAGE_WIDTH ||
                    img.naturalHeight <
                        MIN_IMAGE_HEIGHT
                ) {
                    return false;
                }

                return true;
            });

        totalImages =
            images.filter(img => {

                return (
                    img.isConnected &&
                    img.naturalWidth >=
                        MIN_IMAGE_WIDTH &&
                    img.naturalHeight >=
                        MIN_IMAGE_HEIGHT
                );

            }).length;

        return valid.slice(
            0,
            MAX_IMAGE_COUNT
        );
    }

    // =========================================================
    // 單一處理迴圈
    // =========================================================

    async function processAll() {

        if (processLoopRunning) {
            return;
        }

        processLoopRunning = true;

        try {

            const images =
                collectImages();

            for (const img of images) {

                await processImage(
                    img
                );

                // 避免連續打 API 太快
                await sleep(150);
            }

        } finally {

            processLoopRunning = false;

            updateStatus(
                completedCount > 0
                    ? "目前頁面處理完成"
                    : "等待圖片"
            );
        }
    }

    // =========================================================
    // sleep
    // =========================================================

    function sleep(ms) {

        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    ms
                )
        );
    }

    // =========================================================
    // Scroll / Resize
    // =========================================================

    window.addEventListener(
        "scroll",
        updateAllRecords,
        {
            passive: true
        }
    );

    window.addEventListener(
        "resize",
        updateAllRecords,
        {
            passive: true
        }
    );

    // =========================================================
    // ResizeObserver
    // =========================================================

    if (
        typeof ResizeObserver !==
        "undefined"
    ) {

        const observer =
            new ResizeObserver(
                () => {
                    updateAllRecords();
                }
            );

        observer.observe(
            document.documentElement
        );
    }

    // =========================================================
    // MutationObserver
    // =========================================================

    let mutationTimer = null;

    const mutationObserver =
        new MutationObserver(() => {

            clearTimeout(
                mutationTimer
            );

            mutationTimer =
                setTimeout(() => {

                    processAll();

                }, 1200);
        });

    mutationObserver.observe(
        document.body,
        {
            childList: true,
            subtree: true
        }
    );

    // =========================================================
    // 初始啟動
    // =========================================================

    setTimeout(
        () => {

            updateStatus(
                "掃描圖片..."
            );

            processAll();

        },
        1500
    );

})();
