// ==UserScript==
// @name         AI 圖片自動翻譯 V7.4 - Google Vision
// @namespace    CGL287
// @version      7.4.0
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

    // 最小翻譯框尺寸
    const MIN_OVERLAY_WIDTH = 12;
    const MIN_OVERLAY_HEIGHT = 10;

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

    const imageLayers =
        new WeakMap();

    const resizeObservers =
        new WeakMap();

    // =========================================================
    // 狀態面板
    // =========================================================

    const statusPanel =
        document.createElement("div");

    statusPanel.id =
        "gm-google-manga-status-v74";

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

            minWidth: "190px"
        }
    );

    statusPanel.textContent =
        "Google Manga Translator V7.4\n啟動中…";

    document.documentElement.appendChild(
        statusPanel
    );

    function updateStatus(message = "") {

        statusPanel.innerHTML = `
            <div style="
                font-weight:700;
                margin-bottom:4px;
            ">
                Google Manga Translator V7.4
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
            .replace(
                /&/g,
                "&amp;"
            )
            .replace(
                /</g,
                "&lt;"
            )
            .replace(
                />/g,
                "&gt;"
            )
            .replace(
                /"/g,
                "&quot;"
            )
            .replace(
                /'/g,
                "&#039;"
            );
    }

    // =========================================================
    // GM Request
    // =========================================================

    function gmRequest(details) {

        return new Promise(
            (resolve, reject) => {

                const fn =
                    typeof GM !== "undefined" &&
                    typeof GM.xmlHttpRequest ===
                        "function"

                        ? GM.xmlHttpRequest

                        : (
                            typeof GM_xmlhttpRequest ===
                                "function"

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
            }
        );
    }

    // =========================================================
    // ArrayBuffer → Base64
    // =========================================================

    function arrayBufferToBase64(
        buffer
    ) {

        let binary = "";

        const bytes =
            new Uint8Array(
                buffer
            );

        const chunkSize =
            0x8000;

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

    async function downloadImage(
        img
    ) {

        const src =
            img.currentSrc ||
            img.src;

        if (!src) {

            throw new Error(
                "Image source unavailable"
            );
        }

        updateStatus(
            "取得圖片"
        );

        const response =
            await gmRequest({
                method: "GET",

                url: src,

                responseType:
                    "arraybuffer",

                timeout:
                    IMAGE_TIMEOUT
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
    // 呼叫 Worker
    // =========================================================

    async function translateImage(
        base64
    ) {

        updateStatus(
            "送往 Worker"
        );

        const response =
            await gmRequest({

                method: "POST",

                url: WORKER_URL,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                data:
                    JSON.stringify({
                        imageBase64:
                            base64
                    }),

                responseType:
                    "text",

                timeout:
                    WORKER_TIMEOUT
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
    // 判斷圖片
    // =========================================================

    function isCandidateImage(
        img
    ) {

        if (!img) {
            return false;
        }

        if (
            img.closest(
                "#gm-google-manga-status-v74"
            )
        ) {
            return false;
        }

        const naturalWidth =
            Number(
                img.naturalWidth || 0
            );

        const naturalHeight =
            Number(
                img.naturalHeight || 0
            );

        const rect =
            img.getBoundingClientRect();

        const width =
            naturalWidth ||
            rect.width;

        const height =
            naturalHeight ||
            rect.height;

        if (
            width <
                MIN_IMAGE_WIDTH ||
            height <
                MIN_IMAGE_HEIGHT
        ) {
            return false;
        }

        const ratio =
            width / height;

        // 排除非常細長的 icon/banner
        if (
            ratio > 8 ||
            ratio < 0.125
        ) {
            return false;
        }

        return true;
    }

    // =========================================================
    // 建立圖片專屬 Overlay Layer
    //
    // 不修改圖片本身的 DOM 結構
    // Layer 直接放在 document.documentElement
    // =========================================================

    function createImageLayer(
        img
    ) {

        const oldLayer =
            imageLayers.get(img);

        if (
            oldLayer &&
            oldLayer.isConnected
        ) {
            return oldLayer;
        }

        const layer =
            document.createElement(
                "div"
            );

        layer.className =
            "gm-translation-layer-v74";

        Object.assign(
            layer.style,
            {
                position: "fixed",

                left: "0px",
                top: "0px",

                width: "0px",
                height: "0px",

                margin: "0",
                padding: "0",

                border: "0",

                pointerEvents:
                    "none",

                overflow:
                    "visible",

                zIndex:
                    "2147483646",

                display:
                    "block",

                visibility:
                    "visible",

                opacity:
                    "1",

                transform:
                    "none",

                contain:
                    "layout style",

                isolation:
                    "isolate"
            }
        );

        document.documentElement.appendChild(
            layer
        );

        imageLayers.set(
            img,
            layer
        );

        return layer;
    }

    // =========================================================
    // 移除某張圖片的翻譯
    // =========================================================

    function clearImageLayer(
        img
    ) {

        const oldLayer =
            imageLayers.get(img);

        if (
            oldLayer &&
            oldLayer.isConnected
        ) {
            oldLayer.remove();
        }

        imageLayers.delete(
            img
        );
    }

    // =========================================================
    // 更新圖片 Layer 位置
    // =========================================================

    function updateImageLayer(
        img
    ) {

        const layer =
            imageLayers.get(img);

        if (
            !layer ||
            !layer.isConnected
        ) {
            return;
        }

        const rect =
            img.getBoundingClientRect();

        if (
            rect.width <= 0 ||
            rect.height <= 0
        ) {

            layer.style.display =
                "none";

            return;
        }

        layer.style.display =
            "block";

        layer.style.left =
            `${rect.left}px`;

        layer.style.top =
            `${rect.top}px`;

        layer.style.width =
            `${rect.width}px`;

        layer.style.height =
            `${rect.height}px`;
    }

    // =========================================================
    // 設定 Overlay Layer 的 CSS
    // =========================================================

    function createTranslationBox(
        layer,
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
            Number(
                block.x || 0
            );

        const y =
            Number(
                block.y || 0
            );

        const width =
            Number(
                block.width || 0
            );

        const height =
            Number(
                block.height || 0
            );

        if (
            width <= 0 ||
            height <= 0
        ) {
            return;
        }

        // -----------------------------------------------------
        // 使用非常小的擴張
        //
        // 不再像 V7.3 那樣大幅擴張，
        // 避免遮住其他文字。
        // -----------------------------------------------------

        const expandX =
            Math.min(
                width * 0.04,
                8
            );

        const expandY =
            Math.min(
                height * 0.08,
                8
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

        if (
            boxWidth <
                MIN_OVERLAY_WIDTH ||
            boxHeight <
                MIN_OVERLAY_HEIGHT
        ) {
            return;
        }

        // -----------------------------------------------------
        // 建立翻譯框
        // -----------------------------------------------------

        const box =
            document.createElement(
                "div"
            );

        box.className =
            "gm-translation-box-v74";

        // 以圖片原始尺寸百分比定位
        box.style.position =
            "absolute";

        box.style.left =
            `${(boxX / imageWidth) * 100}%`;

        box.style.top =
            `${(boxY / imageHeight) * 100}%`;

        box.style.width =
            `${(boxWidth / imageWidth) * 100}%`;

        box.style.height =
            `${(boxHeight / imageHeight) * 100}%`;

        Object.assign(
            box.style,
            {
                boxSizing:
                    "border-box",

                margin:
                    "0",

                pointerEvents:
                    "none",

                overflow:
                    "hidden",

                background:
                    "rgba(255,255,255,0.97)",

                color:
                    "#000000",

                borderRadius:
                    "3px",

                padding:
                    "2px 4px",

                display:
                    "flex",

                alignItems:
                    "center",

                justifyContent:
                    "center",

                textAlign:
                    "center",

                fontFamily:
                    "\"Noto Sans TC\", " +
                    "\"PingFang TC\", " +
                    "\"Microsoft JhengHei\", " +
                    "-apple-system, " +
                    "BlinkMacSystemFont, " +
                    "sans-serif",

                fontWeight:
                    "600",

                lineHeight:
                    "1.1",

                whiteSpace:
                    "pre-wrap",

                wordBreak:
                    "break-word",

                overflowWrap:
                    "break-word",

                textRendering:
                    "geometricPrecision",

                transform:
                    "none",

                opacity:
                    "1",

                visibility:
                    "visible"
            }
        );

        box.textContent =
            block.translation;

        layer.appendChild(
            box
        );

        // 下一個 frame 再計算字體
        requestAnimationFrame(
            () => {
                fitTranslationText(
                    box
                );
            }
        );
    }

    // =========================================================
    // 自動縮放翻譯字體
    // =========================================================

    function fitTranslationText(
        box
    ) {

        if (
            !box ||
            !box.isConnected
        ) {
            return;
        }

        const rect =
            box.getBoundingClientRect();

        if (
            rect.width <= 2 ||
            rect.height <= 2
        ) {
            return;
        }

        /*
         * 根據實際顯示高度決定初始字體。
         *
         * 不讓中文字體超過翻譯框。
         */

        let fontSize =
            Math.max(
                10,
                Math.min(
                    36,
                    rect.height * 0.58
                )
            );

        box.style.fontSize =
            `${fontSize}px`;

        box.style.lineHeight =
            "1.1";

        for (
            let i = 0;
            i < 16;
            i++
        ) {

            const overflowY =
                box.scrollHeight >
                box.clientHeight + 2;

            const overflowX =
                box.scrollWidth >
                box.clientWidth + 2;

            if (
                !overflowX &&
                !overflowY
            ) {
                break;
            }

            fontSize *=
                0.88;

            if (
                fontSize < 8
            ) {
                fontSize = 8;
                break;
            }

            box.style.fontSize =
                `${fontSize}px`;
        }
    }

    // =========================================================
    // 建立圖片 Overlay
    // =========================================================

    function renderTranslations(
        img,
        result
    ) {

        const imageWidth =
            Number(
                result.image_width || 0
            );

        const imageHeight =
            Number(
                result.image_height || 0
            );

        const blocks =
            Array.isArray(
                result.text_blocks
            )
                ? result.text_blocks
                : [];

        if (
            !imageWidth ||
            !imageHeight
        ) {
            return;
        }

        // 先刪除舊 layer
        clearImageLayer(
            img
        );

        const layer =
            createImageLayer(
                img
            );

        // 先更新 Layer
        updateImageLayer(
            img
        );

        // 建立翻譯框
        for (
            const block of blocks
        ) {

            if (
                !block ||
                !block.translation
            ) {
                continue;
            }

            createTranslationBox(
                layer,
                block,
                imageWidth,
                imageHeight
            );
        }

        updateImageLayer(
            img
        );

        // 下一幀再做一次
        requestAnimationFrame(
            () => {

                updateImageLayer(
                    img
                );

                const boxes =
                    layer.querySelectorAll(
                        ".gm-translation-box-v74"
                    );

                boxes.forEach(
                    fitTranslationText
                );
            }
        );
    }

    // =========================================================
    // ResizeObserver
    // =========================================================

    function observeImage(
        img
    ) {

        if (
            typeof ResizeObserver ===
            "undefined"
        ) {
            return;
        }

        if (
            resizeObservers.has(img)
        ) {
            return;
        }

        const observer =
            new ResizeObserver(
                () => {

                    updateImageLayer(
                        img
                    );

                    const layer =
                        imageLayers.get(
                            img
                        );

                    if (!layer) {
                        return;
                    }

                    const boxes =
                        layer.querySelectorAll(
                            ".gm-translation-box-v74"
                        );

                    boxes.forEach(
                        fitTranslationText
                    );
                }
            );

        observer.observe(
            img
        );

        resizeObservers.set(
            img,
            observer
        );
    }

    // =========================================================
    // 滾動 / 視窗大小改變
    // =========================================================

    let updateTimer =
        null;

    function updateAllLayers() {

        if (updateTimer) {
            return;
        }

        updateTimer =
            requestAnimationFrame(
                () => {

                    updateTimer =
                        null;

                    const images =
                        document.images;

                    for (
                        const img
                        of images
                    ) {

                        if (
                            imageLayers.has(
                                img
                            )
                        ) {

                            updateImageLayer(
                                img
                            );
                        }
                    }
                }
            );
    }

    window.addEventListener(
        "scroll",
        updateAllLayers,
        {
            passive: true
        }
    );

    window.addEventListener(
        "resize",
        updateAllLayers,
        {
            passive: true
        }
    );

    // =========================================================
    // 處理單張圖片
    // =========================================================

    async function processImage(
        img
    ) {

        if (
            !isCandidateImage(img)
        ) {
            return;
        }

        const src =
            img.currentSrc ||
            img.src;

        if (!src) {
            return;
        }

        // 已經處理過同一個圖片 URL
        const previous =
            processedImages.get(
                img
            );

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
            "處理圖片"
        );

        try {

            // -------------------------------------------------
            // 1. 下載圖片
            // -------------------------------------------------

            const base64 =
                await downloadImage(
                    img
                );

            // -------------------------------------------------
            // 2. Worker
            // -------------------------------------------------

            const result =
                await translateImage(
                    base64
                );

            updateStatus(
                "Google Vision OCR 完成"
            );

            // -------------------------------------------------
            // 3. 建立 Overlay
            // -------------------------------------------------

            renderTranslations(
                img,
                result
            );

            // -------------------------------------------------
            // 4. 監控圖片尺寸
            // -------------------------------------------------

            observeImage(
                img
            );

            completedCount++;

        } catch (error) {

            console.error(
                "[Google Manga Translator V7.4]",
                error
            );

            failedCount++;

            // 失敗允許之後重新嘗試
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
    // 掃描全部圖片
    // =========================================================

    async function processAllImages() {

        // 防止同時執行兩個掃描迴圈
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

                // 等待圖片載入
                if (
                    !img.complete
                ) {

                    await new Promise(
                        resolve => {

                            let finished =
                                false;

                            function done() {

                                if (
                                    finished
                                ) {
                                    return;
                                }

                                finished =
                                    true;

                                resolve();
                            }

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
                                done,
                                5000
                            );
                        }
                    );
                }

                if (
                    !isCandidateImage(
                        img
                    )
                ) {
                    continue;
                }

                await processImage(
                    img
                );
            }

        } finally {

            scanRunning =
                false;

            updateStatus(
                "掃描完成"
            );
        }
    }

    // =========================================================
    // MutationObserver
    // =========================================================

    let mutationTimer =
        null;

    const observer =
        new MutationObserver(
            () => {

                clearTimeout(
                    mutationTimer
                );

                mutationTimer =
                    setTimeout(
                        () => {

                            totalImages =
                                document.images.length;

                            processAllImages();

                        },
                        1500
                    );
            }
        );

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

    setTimeout(
        () => {

            processAllImages();

        },
        1500
    );

})();
