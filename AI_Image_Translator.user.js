// ==UserScript==
// @name         AI 圖片自動翻譯 V7.5 - Google Vision
// @namespace    CGL287
// @version      7.5.0
// @description  Google Vision OCR + Google Translation 漫畫圖片自動翻譯
// @match        *://*/*
// @run-at       document-idle
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
    "use strict";

    const WORKER_URL =
        "https://safari-image-translator.cgl20050126.workers.dev";

    const MIN_IMAGE_WIDTH = 200;
    const MIN_IMAGE_HEIGHT = 200;

    const IMAGE_TIMEOUT = 30000;
    const WORKER_TIMEOUT = 60000;

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

    Object.assign(
        statusPanel.style,
        {
            position: "fixed",

            // 改到左上角
            top: "10px",
            left: "10px",

            zIndex: "2147483647",

            background:
                "rgba(20,20,20,0.92)",

            color: "#fff",

            padding:
                "9px 12px",

            borderRadius:
                "9px",

            fontSize:
                "12px",

            lineHeight:
                "1.45",

            fontFamily:
                "-apple-system, BlinkMacSystemFont, sans-serif",

            pointerEvents:
                "none",

            minWidth:
                "170px"
        }
    );

    document.documentElement.appendChild(
        statusPanel
    );

    function updateStatus(
        message = ""
    ) {

        statusPanel.innerHTML = `
            <div style="
                font-weight:700;
                margin-bottom:3px;
            ">
                Google Manga Translator V7.5
            </div>

            <div>圖片：${totalImages}</div>
            <div>處理：${processingCount}</div>
            <div>完成：${completedCount}</div>
            <div>失敗：${failedCount}</div>

            ${
                message
                    ? `
                    <div style="
                        margin-top:4px;
                        opacity:.8;
                    ">
                        ${escapeHTML(message)}
                    </div>
                    `
                    : ""
            }
        `;
    }

    function escapeHTML(
        text
    ) {

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

    function gmRequest(
        details
    ) {

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

                    onload:
                        resolve,

                    onerror:
                        () =>
                            reject(
                                new Error(
                                    "GM.xmlHttpRequest error"
                                )
                            ),

                    ontimeout:
                        () =>
                            reject(
                                new Error(
                                    "Request timeout"
                                )
                            ),

                    onabort:
                        () =>
                            reject(
                                new Error(
                                    "Request aborted"
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
    // 下載圖片
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
                method:
                    "GET",

                url:
                    src,

                responseType:
                    "arraybuffer",

                timeout:
                    IMAGE_TIMEOUT
            });

        if (
            response.status >= 400
        ) {
            throw new Error(
                "Image HTTP " +
                response.status
            );
        }

        return arrayBufferToBase64(
            response.response
        );
    }

    // =========================================================
    // Worker
    // =========================================================

    async function translateImage(
        base64
    ) {

        updateStatus(
            "送往 Worker"
        );

        const response =
            await gmRequest({

                method:
                    "POST",

                url:
                    WORKER_URL,

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
            response.status >= 400
        ) {
            throw new Error(
                "Worker HTTP " +
                response.status
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
                "Invalid Worker JSON"
            );
        }

        if (result.error) {
            throw new Error(
                result.error
            );
        }

        return result;
    }

    // =========================================================
    // 圖片判斷
    // =========================================================

    function isCandidateImage(
        img
    ) {

        if (!img) {
            return false;
        }

        const width =
            img.naturalWidth ||
            img.getBoundingClientRect().width;

        const height =
            img.naturalHeight ||
            img.getBoundingClientRect().height;

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

        if (
            ratio > 8 ||
            ratio < 0.125
        ) {
            return false;
        }

        return true;
    }

    // =========================================================
    // Image Layer
    // =========================================================

    function createImageLayer(
        img
    ) {

        const existing =
            imageLayers.get(
                img
            );

        if (
            existing &&
            existing.isConnected
        ) {
            return existing;
        }

        const layer =
            document.createElement(
                "div"
            );

        Object.assign(
            layer.style,
            {
                position:
                    "fixed",

                left:
                    "0px",

                top:
                    "0px",

                width:
                    "0px",

                height:
                    "0px",

                pointerEvents:
                    "none",

                overflow:
                    "visible",

                zIndex:
                    "2147483646",

                display:
                    "block",

                opacity:
                    "1",

                visibility:
                    "visible"
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

    function clearImageLayer(
        img
    ) {

        const layer =
            imageLayers.get(
                img
            );

        if (
            layer &&
            layer.isConnected
        ) {
            layer.remove();
        }

        imageLayers.delete(
            img
        );
    }

    function updateImageLayer(
        img
    ) {

        const layer =
            imageLayers.get(
                img
            );

        if (!layer) {
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
    // 翻譯框
    // =========================================================

    function createTranslationBox(
        layer,
        block,
        imageWidth,
        imageHeight
    ) {

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

        // 小幅擴張
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

        const box =
            document.createElement(
                "div"
            );

        Object.assign(
            box.style,
            {
                position:
                    "absolute",

                left:
                    `${boxX / imageWidth * 100}%`,

                top:
                    `${boxY / imageHeight * 100}%`,

                width:
                    `${boxWidth / imageWidth * 100}%`,

                height:
                    `${boxHeight / imageHeight * 100}%`,

                boxSizing:
                    "border-box",

                background:
                    "#ffffff",

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

                overflow:
                    "hidden",

                pointerEvents:
                    "none",

                fontFamily:
                    "\"Noto Sans TC\", " +
                    "\"PingFang TC\", " +
                    "\"Microsoft JhengHei\", " +
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

                opacity:
                    "1"
            }
        );

        box.textContent =
            block.translation;

        layer.appendChild(
            box
        );

        requestAnimationFrame(
            () => {
                fitText(
                    box
                );
            }
        );
    }

    // =========================================================
    // 字體縮放
    // =========================================================

    function fitText(
        box
    ) {

        const rect =
            box.getBoundingClientRect();

        if (
            rect.width <= 2 ||
            rect.height <= 2
        ) {
            return;
        }

        let size =
            Math.max(
                10,
                Math.min(
                    36,
                    rect.height * 0.58
                )
            );

        box.style.fontSize =
            `${size}px`;

        for (
            let i = 0;
            i < 16;
            i++
        ) {

            if (
                box.scrollHeight <=
                    box.clientHeight + 2 &&
                box.scrollWidth <=
                    box.clientWidth + 2
            ) {
                break;
            }

            size *= 0.88;

            if (
                size < 8
            ) {
                size = 8;
                break;
            }

            box.style.fontSize =
                `${size}px`;
        }
    }

    // =========================================================
    // Render
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
            result.text_blocks || [];

        if (
            !imageWidth ||
            !imageHeight
        ) {
            return;
        }

        clearImageLayer(
            img
        );

        const layer =
            createImageLayer(
                img
            );

        updateImageLayer(
            img
        );

        for (
            const block of blocks
        ) {

            if (
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
            resizeObservers.has(
                img
            )
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

                    layer
                        .querySelectorAll(
                            "div"
                        )
                        .forEach(
                            fitText
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
    // Scroll / Resize
    // =========================================================

    function updateAllLayers() {

        for (
            const img
            of document.images
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

    window.addEventListener(
        "scroll",
        updateAllLayers,
        {
            passive: true
        }
    );

    window.addEventListener(
        "resize",
        updateAllLayers
    );

    // =========================================================
    // 單張圖片
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

        if (
            processedImages.get(
                img
            ) === src
        ) {
            return;
        }

        processedImages.set(
            img,
            src
        );

        processingCount++;

        try {

            const base64 =
                await downloadImage(
                    img
                );

            const result =
                await translateImage(
                    base64
                );

            updateStatus(
                "Google Vision OCR 完成"
            );

            renderTranslations(
                img,
                result
            );

            observeImage(
                img
            );

            completedCount++;

        } catch (error) {

            console.error(
                "[GMW V7.5]",
                error
            );

            failedCount++;

            processedImages.delete(
                img
            );

        } finally {

            processingCount--;

            updateStatus(
                "翻譯完成"
            );
        }
    }

    // =========================================================
    // 全部圖片
    // =========================================================

    async function processAllImages() {

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

                if (
                    !img.complete
                ) {

                    await new Promise(
                        resolve => {

                            const done =
                                () => resolve();

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
            childList:
                true,

            subtree:
                true
        }
    );

    // =========================================================
    // 啟動
    // =========================================================

    setTimeout(
        () => {
            processAllImages();
        },
        1500
    );

})();
