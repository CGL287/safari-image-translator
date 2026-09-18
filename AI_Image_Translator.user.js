// ==UserScript==
// @name         AI 圖片自動翻譯 V7.3 - Google Vision
// @namespace    CGL287
// @version      7.3.0
// @description  Google Vision OCR + Google Translation 漫畫圖片自動翻譯
// @match        *://*/*
// @run-at       document-idle
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

    const IMAGE_TIMEOUT = 30000;
    const WORKER_TIMEOUT = 60000;

    // =========================================================
    // 狀態
    // =========================================================

    let scanRunning = false;

    let totalImages = 0;
    let processingCount = 0;
    let completedCount = 0;
    let failedCount = 0;

    const processedImages =
        new WeakMap();

    const overlayRecords = [];

    // =========================================================
    // 狀態面板
    // =========================================================

    const statusPanel =
        document.createElement("div");

    statusPanel.id =
        "gm-google-manga-status";

    Object.assign(
        statusPanel.style,
        {
            position: "fixed",
            top: "10px",
            right: "10px",

            zIndex: "2147483647",

            background:
                "rgba(20,20,20,0.92)",

            color: "#ffffff",

            padding: "10px 14px",

            borderRadius: "10px",

            fontSize: "13px",

            lineHeight: "1.5",

            fontFamily:
                "-apple-system, BlinkMacSystemFont, " +
                "\"Segoe UI\", sans-serif",

            boxShadow:
                "0 4px 16px rgba(0,0,0,0.35)",

            pointerEvents: "none",

            minWidth: "180px"
        }
    );

    statusPanel.textContent =
        "Google Manga Translator\n啟動中…";

    document.documentElement.appendChild(
        statusPanel
    );

    function updateStatus(message = "") {
        statusPanel.innerHTML = `
            <div style="font-weight:700;margin-bottom:4px;">
                Google Manga Translator
            </div>

            <div>
                圖片：${totalImages}
            </div>

            <div>
                處理：${processingCount}
            </div>

            <div>
                完成：${completedCount}
            </div>

            <div>
                失敗：${failedCount}
            </div>

            ${
                message
                    ? `
                    <div style="
                        margin-top:5px;
                        opacity:.8;
                        font-size:12px;
                    ">
                        ${escapeHTML(message)}
                    </div>
                    `
                    : ""
            }
        `;
    }

    function escapeHTML(text) {
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // =========================================================
    // GM.xmlHttpRequest
    // =========================================================

    function gmRequest(details) {
        return new Promise((resolve, reject) => {

            const fn =
                typeof GM !== "undefined" &&
                typeof GM.xmlHttpRequest === "function"
                    ? GM.xmlHttpRequest
                    : (
                        typeof GM_xmlhttpRequest === "function"
                            ? GM_xmlhttpRequest
                            : null
                    );

            if (!fn) {
                reject(
                    new Error(
                        "GM.xmlHttpRequest unavailable"
                    )
                );
                return;
            }

            fn({
                ...details,

                onload: resolve,

                onerror: () =>
                    reject(
                        new Error(
                            "GM.xmlHttpRequest error"
                        )
                    ),

                ontimeout: () =>
                    reject(
                        new Error(
                            "GM.xmlHttpRequest timeout"
                        )
                    ),

                onabort: () =>
                    reject(
                        new Error(
                            "GM.xmlHttpRequest aborted"
                        )
                    )
            });
        });
    }

    // =========================================================
    // ArrayBuffer → Base64
    // =========================================================

    function arrayBufferToBase64(buffer) {
        let binary = "";

        const bytes =
            new Uint8Array(buffer);

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

    async function downloadImage(img) {

        const src =
            img.currentSrc ||
            img.src;

        if (!src) {
            throw new Error(
                "Image source unavailable"
            );
        }

        updateStatus("取得圖片");

        const response =
            await gmRequest({
                method: "GET",
                url: src,
                responseType: "arraybuffer",
                timeout: IMAGE_TIMEOUT
            });

        if (
            response.status &&
            response.status >= 400
        ) {
            throw new Error(
                "Image HTTP " +
                response.status
            );
        }

        if (!response.response) {
            throw new Error(
                "Empty image response"
            );
        }

        return arrayBufferToBase64(
            response.response
        );
    }

    // =========================================================
    // 呼叫 Cloudflare Worker
    // =========================================================

    async function translateImage(
        base64
    ) {

        updateStatus("送往 Worker");

        const response =
            await gmRequest({
                method: "POST",

                url: WORKER_URL,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                data: JSON.stringify({
                    imageBase64: base64
                }),

                responseType: "text",

                timeout: WORKER_TIMEOUT
            });

        if (
            response.status &&
            response.status >= 400
        ) {
            throw new Error(
                "Worker HTTP " +
                response.status +
                ": " +
                response.responseText
            );
        }

        let result;

        try {
            result =
                JSON.parse(
                    response.responseText
                );
        } catch {
            throw new Error(
                "Worker returned invalid JSON"
            );
        }

        if (result.error) {
            throw new Error(
                result.error +
                (
                    result.detail
                        ? ": " +
                          JSON.stringify(
                              result.detail
                          )
                        : ""
                )
            );
        }

        return result;
    }

    // =========================================================
    // 清除某張圖片原本的 Overlay
    // =========================================================

    function removeImageOverlays(img) {

        for (
            let i =
                overlayRecords.length - 1;
            i >= 0;
            i--
        ) {
            const record =
                overlayRecords[i];

            if (record.img === img) {

                if (
                    record.element &&
                    record.element.isConnected
                ) {
                    record.element.remove();
                }

                overlayRecords.splice(
                    i,
                    1
                );
            }
        }
    }

    // =========================================================
    // 建立翻譯 Overlay
    // =========================================================

    function createOverlay(
        img,
        block,
        imageWidth,
        imageHeight
    ) {

        if (
            !imageWidth ||
            !imageHeight
        ) {
            return;
        }

        const x =
            Number(block.x || 0);

        const y =
            Number(block.y || 0);

        const width =
            Number(block.width || 0);

        const height =
            Number(block.height || 0);

        if (
            width <= 0 ||
            height <= 0
        ) {
            return;
        }

        // -----------------------------------------------------
        // 小幅擴張，讓原文不會從邊緣漏出
        // -----------------------------------------------------

        const expandX =
            Math.min(
                width * 0.08,
                20
            );

        const expandY =
            Math.min(
                height * 0.15,
                20
            );

        const boxX =
            Math.max(
                0,
                x - expandX
            );

        const boxY =
            Math.max(
                0,
                y - expandY
            );

        const boxRight =
            Math.min(
                imageWidth,
                x + width + expandX
            );

        const boxBottom =
            Math.min(
                imageHeight,
                y + height + expandY
            );

        const boxWidth =
            boxRight - boxX;

        const boxHeight =
            boxBottom - boxY;

        // -----------------------------------------------------
        // Overlay
        // -----------------------------------------------------

        const overlay =
            document.createElement("div");

        overlay.className =
            "gm-translation-overlay-v73";

        Object.assign(
            overlay.style,
            {
                position: "fixed",

                boxSizing: "border-box",

                overflow: "hidden",

                pointerEvents: "none",

                zIndex: "2147483646",

                background:
                    "rgba(255,255,255,0.97)",

                color: "#000000",

                borderRadius: "4px",

                padding:
                    "2px 5px",

                display: "flex",

                alignItems: "center",

                justifyContent: "center",

                textAlign: "center",

                fontFamily:
                    "\"Noto Sans TC\", " +
                    "\"PingFang TC\", " +
                    "-apple-system, " +
                    "BlinkMacSystemFont, " +
                    "\"Microsoft JhengHei\", " +
                    sans-serif,

                fontWeight: "600",

                lineHeight: "1.12",

                whiteSpace: "pre-wrap",

                wordBreak: "break-word",

                overflowWrap: "break-word",

                textRendering:
                    "geometricPrecision"
            }
        );

        overlay.textContent =
            block.translation;

        document.body.appendChild(
            overlay
        );

        const record = {
            img,
            overlay,

            imageWidth,
            imageHeight,

            x: boxX,
            y: boxY,

            width: boxWidth,
            height: boxHeight
        };

        overlayRecords.push(record);

        updateOverlayPosition(
            record
        );

        fitOverlayText(
            record
        );
    }

    // =========================================================
    // Overlay 定位
    // =========================================================

    function updateOverlayPosition(
        record
    ) {

        const {
            img,
            overlay,
            imageWidth,
            imageHeight,
            x,
            y,
            width,
            height
        } = record;

        if (
            !img ||
            !overlay ||
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
            overlay.style.display =
                "none";

            return;
        }

        overlay.style.display =
            "flex";

        const scaleX =
            rect.width /
            imageWidth;

        const scaleY =
            rect.height /
            imageHeight;

        const left =
            rect.left +
            x * scaleX;

        const top =
            rect.top +
            y * scaleY;

        const displayWidth =
            width * scaleX;

        const displayHeight =
            height * scaleY;

        overlay.style.left =
            `${left}px`;

        overlay.style.top =
            `${top}px`;

        overlay.style.width =
            `${displayWidth}px`;

        overlay.style.height =
            `${displayHeight}px`;
    }

    // =========================================================
    // 根據 OCR 框大小調整中文字體
    // =========================================================

    function fitOverlayText(
        record
    ) {

        const overlay =
            record.overlay;

        const rect =
            overlay.getBoundingClientRect();

        if (
            rect.width <= 0 ||
            rect.height <= 0
        ) {
            return;
        }

        /*
         * 先從 OCR 框高度估算
         * 不再使用巨大頁面座標。
         */

        let fontSize =
            Math.max(
                12,
                Math.min(
                    42,
                    rect.height * 0.58
                )
            );

        overlay.style.fontSize =
            `${fontSize}px`;

        // 最多縮小 12 次
        for (
            let i = 0;
            i < 12;
            i++
        ) {

            if (
                overlay.scrollHeight <=
                    overlay.clientHeight + 2 &&
                overlay.scrollWidth <=
                    overlay.clientWidth + 2
            ) {
                break;
            }

            fontSize *= 0.88;

            if (fontSize < 10) {
                fontSize = 10;
                break;
            }

            overlay.style.fontSize =
                `${fontSize}px`;
        }
    }

    // =========================================================
    // 更新所有 Overlay
    // =========================================================

    function updateAllOverlays() {

        for (
            const record of overlayRecords
        ) {
            updateOverlayPosition(
                record
            );

            fitOverlayText(
                record
            );
        }
    }

    window.addEventListener(
        "scroll",
        updateAllOverlays,
        {
            passive: true
        }
    );

    window.addEventListener(
        "resize",
        updateAllOverlays,
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

        const resizeObserver =
            new ResizeObserver(() => {
                updateAllOverlays();
            });

        // 後面處理圖片時加入觀察
        window.__gmResizeObserver =
            resizeObserver;
    }

    // =========================================================
    // 判斷是不是值得處理的圖片
    // =========================================================

    function isCandidateImage(img) {

        if (!img) {
            return false;
        }

        if (
            img.closest(
                "#gm-google-manga-status"
            )
        ) {
            return false;
        }

        const rect =
            img.getBoundingClientRect();

        const width =
            img.naturalWidth ||
            rect.width;

        const height =
            img.naturalHeight ||
            rect.height;

        if (
            width < MIN_IMAGE_WIDTH ||
            height < MIN_IMAGE_HEIGHT
        ) {
            return false;
        }

        const ratio =
            width / height;

        // 排除非常細長的 icon / banner
        if (
            ratio > 8 ||
            ratio < 0.125
        ) {
            return false;
        }

        return true;
    }

    // =========================================================
    // 處理單張圖片
    // =========================================================

    async function processImage(
        img
    ) {

        if (!isCandidateImage(img)) {
            return;
        }

        const src =
            img.currentSrc ||
            img.src;

        if (!src) {
            return;
        }

        const previous =
            processedImages.get(img);

        // 同一張圖片不重複處理
        if (
            previous === src
        ) {
            return;
        }

        processedImages.set(
            img,
            src
        );

        processingCount++;

        updateStatus(
            "取得圖片"
        );

        try {

            // -------------------------------------------------
            // 1. 下載原圖
            // -------------------------------------------------

            const base64 =
                await downloadImage(
                    img
                );

            // -------------------------------------------------
            // 2. Worker → Vision → Translation
            // -------------------------------------------------

            const result =
                await translateImage(
                    base64
                );

            updateStatus(
                "Google Vision OCR 完成"
            );

            // -------------------------------------------------
            // 3. 清除舊 Overlay
            // -------------------------------------------------

            removeImageOverlays(
                img
            );

            const imageWidth =
                Number(
                    result.image_width || 0
                );

            const imageHeight =
                Number(
                    result.image_height || 0
                );

            const blocks =
                result.text_blocks || [];

            // -------------------------------------------------
            // 4. 建立翻譯
            // -------------------------------------------------

            for (
                const block of blocks
            ) {

                if (
                    !block.translation
                ) {
                    continue;
                }

                createOverlay(
                    img,
                    block,
                    imageWidth,
                    imageHeight
                );
            }

            // -------------------------------------------------
            // 5. ResizeObserver
            // -------------------------------------------------

            if (
                window.__gmResizeObserver
            ) {
                window.__gmResizeObserver.observe(
                    img
                );
            }

            completedCount++;

        } catch (error) {

            console.error(
                "[Google Manga Translator V7.3]",
                error
            );

            failedCount++;

            // 讓下一輪可以重新嘗試
            processedImages.delete(
                img
            );

        } finally {

            processingCount--;

            updateStatus(
                completedCount > 0
                    ? "翻譯完成"
                    : ""
            );
        }
    }

    // =========================================================
    // 掃描圖片
    // =========================================================

    async function processAllImages() {

        // -----------------------------------------------------
        // 防止 MutationObserver / 初始掃描同時啟動
        // -----------------------------------------------------

        if (scanRunning) {
            return;
        }

        scanRunning = true;

        try {

            const images =
                Array.from(
                    document.images
                );

            totalImages =
                images.length;

            updateStatus(
                "掃描圖片"
            );

            for (
                const img of images
            ) {

                // 如果圖片尚未載入
                if (
                    !img.complete
                ) {

                    await new Promise(
                        resolve => {

                            const done =
                                () => {
                                    resolve();
                                };

                            img.addEventListener(
                                "load",
                                done,
                                {
                                    once: true
                                }
                            );

                            img.addEventListener(
                                "error",
                                done,
                                {
                                    once: true
                                }
                            );

                            setTimeout(
                                resolve,
                                5000
                            );
                        }
                    );
                }

                if (
                    !isCandidateImage(img)
                ) {
                    continue;
                }

                await processImage(
                    img
                );
            }

        } finally {

            scanRunning = false;

            updateStatus(
                "掃描完成"
            );
        }
    }

    // =========================================================
    // MutationObserver
    // =========================================================

    let mutationTimer = null;

    const observer =
        new MutationObserver(() => {

            clearTimeout(
                mutationTimer
            );

            mutationTimer =
                setTimeout(() => {

                    totalImages =
                        document.images.length;

                    processAllImages();

                }, 1500);
        });

    observer.observe(
        document.documentElement,
        {
            childList: true,
            subtree: true
        }
    );

    // =========================================================
    // 初始啟動
    // =========================================================

    setTimeout(() => {

        processAllImages();

    }, 1500);

})();
