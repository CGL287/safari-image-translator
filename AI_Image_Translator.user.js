// ==UserScript==
// @name         AI 圖片自動翻譯 V7 - Google Vision
// @namespace    manga-translator
// @version      7.0.0
// @description  Google Vision OCR + Google Translation 漫畫自動翻譯
// @match        *://*/*
// @grant        none
// ==/UserScript==

(() => {
    "use strict";

    // ==============================
    // 設定
    // ==============================

    const WORKER_URL =
        "https://safari-image-translator.cgl20050126.workers.dev";

    const MIN_WIDTH = 150;
    const MIN_HEIGHT = 80;

    const MAX_CONCURRENT = 1;

    const DELAY = 250;

    const ROOT_MARGIN = 1000;

    const MAX_RETRIES = 2;

    // 擴大 Google Vision 回傳的文字區域
    const EXPAND_X = 0.20;
    const EXPAND_Y = 0.25;

    const PROCESSED_ATTR =
        "data-google-manga-translated";

    // ==============================
    // 狀態
    // ==============================

    let running = 0;

    const queue = [];

    const queued =
        new WeakSet();

    // ==============================
    // 延遲
    // ==============================

    function sleep(ms) {
        return new Promise(
            resolve => setTimeout(resolve, ms)
        );
    }

    // ==============================
    // 圖片轉 Base64
    // ==============================

    async function imageToBase64(img) {

        const src =
            img.currentSrc ||
            img.src;

        if (!src) {
            throw new Error(
                "圖片沒有 src"
            );
        }

        const response =
            await fetch(src, {
                credentials: "include"
            });

        if (!response.ok) {
            throw new Error(
                "圖片 HTTP " +
                response.status
            );
        }

        const blob =
            await response.blob();

        return await new Promise(
            (resolve, reject) => {

                const reader =
                    new FileReader();

                reader.onload = () =>
                    resolve(reader.result);

                reader.onerror = reject;

                reader.readAsDataURL(blob);
            }
        );
    }

    // ==============================
    // 建立翻譯框
    // ==============================

    function createOverlay(
        img,
        block
    ) {

        const naturalWidth =
            img.naturalWidth;

        const naturalHeight =
            img.naturalHeight;

        if (
            !naturalWidth ||
            !naturalHeight
        ) {
            return;
        }

        const displayedWidth =
            img.getBoundingClientRect().width;

        const displayedHeight =
            img.getBoundingClientRect().height;

        if (
            !displayedWidth ||
            !displayedHeight
        ) {
            return;
        }

        const scaleX =
            displayedWidth /
            naturalWidth;

        const scaleY =
            displayedHeight /
            naturalHeight;

        // --------------------------
        // 原始座標
        // --------------------------

        let x = block.x;
        let y = block.y;

        let width = block.width;
        let height = block.height;

        // --------------------------
        // 擴大覆蓋範圍
        // --------------------------

        const expandX =
            width * EXPAND_X;

        const expandY =
            height * EXPAND_Y;

        x -= expandX;
        y -= expandY;

        width +=
            expandX * 2;

        height +=
            expandY * 2;

        // 不超出圖片
        x = Math.max(
            0,
            x
        );

        y = Math.max(
            0,
            y
        );

        width =
            Math.min(
                width,
                naturalWidth - x
            );

        height =
            Math.min(
                height,
                naturalHeight - y
            );

        // --------------------------
        // Overlay
        // --------------------------

        const overlay =
            document.createElement(
                "div"
            );

        overlay.className =
            "google-manga-translation";

        overlay.textContent =
            block.translation;

        // --------------------------
        // 位置
        // --------------------------

        const rect =
            img.getBoundingClientRect();

        const left =
            rect.left +
            x * scaleX;

        const top =
            rect.top +
            y * scaleY;

        const cssWidth =
            width * scaleX;

        const cssHeight =
            height * scaleY;

        overlay.style.left =
            `${left + window.scrollX}px`;

        overlay.style.top =
            `${top + window.scrollY}px`;

        overlay.style.width =
            `${cssWidth}px`;

        overlay.style.minHeight =
            `${cssHeight}px`;

        // --------------------------
        // 字體
        // --------------------------

        const baseFont =
            Math.max(
                14,
                Math.min(
                    28,
                    cssHeight * 0.42
                )
            );

        overlay.style.fontSize =
            `${baseFont}px`;

        // --------------------------
        // 加到頁面
        // --------------------------

        document.body.appendChild(
            overlay
        );
    }

    // ==============================
    // 清除舊 Overlay
    // ==============================

    function removeOldOverlays(img) {

        const overlays =
            document.querySelectorAll(
                ".google-manga-translation"
            );

        for (
            const overlay of overlays
        ) {

            const rect =
                img.getBoundingClientRect();

            const oRect =
                overlay.getBoundingClientRect();

            const overlap =
                !(
                    oRect.right < rect.left ||
                    oRect.left > rect.right ||
                    oRect.bottom < rect.top ||
                    oRect.top > rect.bottom
                );

            if (overlap) {
                overlay.remove();
            }
        }
    }

    // ==============================
    // 翻譯圖片
    // ==============================

    async function translateImage(
        img
    ) {

        if (
            img.dataset[
                PROCESSED_ATTR
            ]
        ) {
            return;
        }

        if (
            img.naturalWidth <
            MIN_WIDTH ||
            img.naturalHeight <
            MIN_HEIGHT
        ) {
            return;
        }

        img.dataset[
            PROCESSED_ATTR
        ] = "processing";

        try {

            const imageData =
                await imageToBase64(img);

            const payload = {

                image_data:
                    imageData,

                image_width:
                    img.naturalWidth,

                image_height:
                    img.naturalHeight
            };

            let lastError =
                null;

            for (
                let attempt = 0;
                attempt <= MAX_RETRIES;
                attempt++
            ) {

                try {

                    const response =
                        await fetch(
                            WORKER_URL,
                            {
                                method: "POST",

                                headers: {
                                    "Content-Type":
                                        "application/json"
                                },

                                body:
                                    JSON.stringify(
                                        payload
                                    )
                            }
                        );

                    const data =
                        await response.json();

                    if (!response.ok) {

                        throw new Error(
                            data.error ||
                            `Worker HTTP ${response.status}`
                        );
                    }

                    // ----------------------
                    // 清除舊翻譯
                    // ----------------------

                    removeOldOverlays(img);

                    // ----------------------
                    // 顯示翻譯
                    // ----------------------

                    const blocks =
                        data.text_blocks || [];

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
                            block
                        );
                    }

                    img.dataset[
                        PROCESSED_ATTR
                    ] = "done";

                    return;

                } catch (error) {

                    lastError =
                        error;

                    await sleep(
                        500 *
                        (attempt + 1)
                    );
                }
            }

            throw lastError ||
                new Error(
                    "翻譯失敗"
                );

        } catch (error) {

            console.error(
                "[Google Manga Translator]",
                error
            );

            img.dataset[
                PROCESSED_ATTR
            ] = "error";

        } finally {

            running--;

            processQueue();
        }
    }

    // ==============================
    // Queue
    // ==============================

    function enqueue(img) {

        if (
            !img ||
            queued.has(img)
        ) {
            return;
        }

        queued.add(img);

        queue.push(img);

        processQueue();
    }

    function processQueue() {

        while (
            running <
                MAX_CONCURRENT &&
            queue.length
        ) {

            const img =
                queue.shift();

            if (!img) {
                continue;
            }

            running++;

            translateImage(
                img
            );
        }
    }

    // ==============================
    // 找漫畫圖片
    // ==============================

    function scanImages() {

        const images =
            document.querySelectorAll(
                "img"
            );

        const viewportTop =
            window.scrollY -
            ROOT_MARGIN;

        const viewportBottom =
            window.scrollY +
            window.innerHeight +
            ROOT_MARGIN;

        for (
            const img of images
        ) {

            if (
                img.dataset[
                    PROCESSED_ATTR
                ] === "done" ||
                img.dataset[
                    PROCESSED_ATTR
                ] === "processing"
            ) {
                continue;
            }

            if (
                !img.complete
            ) {
                continue;
            }

            if (
                img.naturalWidth <
                MIN_WIDTH ||
                img.naturalHeight <
                MIN_HEIGHT
            ) {
                continue;
            }

            const rect =
                img.getBoundingClientRect();

            const top =
                rect.top +
                window.scrollY;

            const bottom =
                rect.bottom +
                window.scrollY;

            if (
                bottom < viewportTop ||
                top > viewportBottom
            ) {
                continue;
            }

            enqueue(img);
        }
    }

    // ==============================
    // Overlay CSS
    // ==============================

    const style =
        document.createElement(
            "style"
        );

    style.textContent = `

        .google-manga-translation {

            position: absolute;

            z-index: 2147483647;

            box-sizing: border-box;

            display: flex;

            align-items: center;

            justify-content: center;

            padding: 8px 12px;

            background:
                rgba(255,255,255,0.96);

            color:
                #111;

            border-radius:
                8px;

            border:
                1px solid
                rgba(0,0,0,0.12);

            box-shadow:
                0 1px 4px
                rgba(0,0,0,0.20);

            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "Noto Sans TC",
                "Microsoft JhengHei",
                sans-serif;

            font-weight:
                600;

            line-height:
                1.35;

            text-align:
                center;

            white-space:
                pre-wrap;

            overflow:
                hidden;

            pointer-events:
                none;

            word-break:
                break-word;

        }

    `;

    document.head.appendChild(
        style
    );

    // ==============================
    // 初次掃描
    // ==============================

    setTimeout(
        scanImages,
        1000
    );

    // ==============================
    // 滾動
    // ==============================

    let scrollTimer = null;

    window.addEventListener(
        "scroll",
        () => {

            clearTimeout(
                scrollTimer
            );

            scrollTimer =
                setTimeout(
                    scanImages,
                    DELAY
                );
        },
        {
            passive: true
        }
    );

    // ==============================
    // 新圖片
    // ==============================

    const observer =
        new MutationObserver(
            () => {

                clearTimeout(
                    window.__googleMangaScanTimer
                );

                window.__googleMangaScanTimer =
                    setTimeout(
                        scanImages,
                        300
                    );
            }
        );

    observer.observe(
        document.body,
        {
            childList: true,
            subtree: true
        }
    );

})();
