// ==UserScript==
// @name         AI 圖片自動翻譯 V7.2 - Google Vision
// @namespace    manga-translator
// @version      7.2.0
// @description  Google Vision OCR + Google Translation 漫畫自動翻譯
// @match        *://*/*
// @grant        GM.xmlHttpRequest
// @connect      *
// @run-at       document-end
// @inject-into  content
// ==/UserScript==

(() => {
    "use strict";

    const WORKER_URL =
        "https://safari-image-translator.cgl20050126.workers.dev";

    const MIN_WIDTH = 150;
    const MIN_HEIGHT = 80;

    const ROOT_MARGIN = 1200;

    const MAX_RETRIES = 2;

    // 擴大翻譯覆蓋區域
    const EXPAND_X = 0.22;
    const EXPAND_Y = 0.28;

    const ATTR =
        "data-google-manga-v72";

    const state = {
        found: 0,
        processing: 0,
        done: 0,
        failed: 0,
        lastError: ""
    };

    let panel = null;

    // =====================================================
    // 狀態面板
    // =====================================================

    function createPanel() {

        if (panel) return;

        panel =
            document.createElement("div");

        panel.id =
            "google-manga-v72-panel";

        panel.innerHTML = `
            <div class="gmt-title">
                Google Manga Translator
            </div>

            <div class="gmt-status">
                <span class="gmt-dot"></span>
                <span id="gmt-status">
                    啟動中
                </span>
            </div>

            <div class="gmt-counts">
                <div>圖片：<b id="gmt-found">0</b></div>
                <div>處理：<b id="gmt-processing">0</b></div>
                <div>完成：<b id="gmt-done">0</b></div>
                <div>失敗：<b id="gmt-failed">0</b></div>
            </div>

            <div id="gmt-error"></div>
        `;

        document.body.appendChild(panel);

        updatePanel();
    }

    function updatePanel() {

        if (!panel) return;

        panel.querySelector(
            "#gmt-found"
        ).textContent =
            state.found;

        panel.querySelector(
            "#gmt-processing"
        ).textContent =
            state.processing;

        panel.querySelector(
            "#gmt-done"
        ).textContent =
            state.done;

        panel.querySelector(
            "#gmt-failed"
        ).textContent =
            state.failed;

        const status =
            panel.querySelector(
                "#gmt-status"
            );

        if (state.processing > 0) {

            status.textContent =
                "正在翻譯";

        } else if (state.failed > 0) {

            status.textContent =
                "部分失敗";

        } else if (state.done > 0) {

            status.textContent =
                "完成";

        } else {

            status.textContent =
                "等待圖片";
        }

        panel.querySelector(
            "#gmt-error"
        ).textContent =
            state.lastError || "";
    }

    // =====================================================
    // CSS
    // =====================================================

    const style =
        document.createElement("style");

    style.textContent = `

        #google-manga-v72-panel {

            position: fixed;

            top: 12px;
            right: 12px;

            z-index: 2147483647;

            min-width: 270px;

            padding: 14px 16px;

            border-radius: 16px;

            background:
                rgba(25,25,25,.95);

            color: white;

            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "Noto Sans TC",
                sans-serif;

            box-shadow:
                0 8px 30px
                rgba(0,0,0,.35);

            pointer-events:
                none;
        }

        .gmt-title {

            font-size: 19px;

            font-weight: 700;

            margin-bottom: 7px;
        }

        .gmt-status {

            display: flex;

            align-items: center;

            gap: 7px;

            margin-bottom: 9px;
        }

        .gmt-dot {

            width: 10px;
            height: 10px;

            border-radius: 50%;

            background: #35d26f;

            animation:
                gmt-pulse 1.2s infinite;
        }

        .gmt-counts {

            display: grid;

            grid-template-columns:
                1fr 1fr;

            gap: 4px 15px;

            font-size: 14px;
        }

        #gmt-error {

            margin-top: 8px;

            font-size: 11px;

            line-height: 1.3;

            word-break: break-word;

            color: #ff7777;
        }

        @keyframes gmt-pulse {

            0% {
                opacity: 1;
            }

            50% {
                opacity: .35;
            }

            100% {
                opacity: 1;
            }
        }

        .google-manga-v72-overlay {

            position: absolute;

            z-index: 2147483646;

            box-sizing: border-box;

            display: flex;

            align-items: center;

            justify-content: center;

            padding: 8px 12px;

            background:
                rgba(255,255,255,.97);

            color:
                #111;

            border-radius:
                8px;

            border:
                1px solid
                rgba(0,0,0,.12);

            box-shadow:
                0 1px 5px
                rgba(0,0,0,.20);

            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "Noto Sans TC",
                "Microsoft JhengHei",
                sans-serif;

            font-weight: 600;

            line-height: 1.35;

            text-align: center;

            white-space: pre-wrap;

            word-break: break-word;

            overflow: hidden;

            pointer-events: none;
        }
    `;

    document.head.appendChild(style);

    // =====================================================
    // GM Request
    // =====================================================

    function gmRequest(options) {

        if (
            typeof GM !== "undefined" &&
            typeof GM.xmlHttpRequest ===
                "function"
        ) {
            return GM.xmlHttpRequest(
                options
            );
        }

        return Promise.reject(
            new Error(
                "GM.xmlHttpRequest 不存在"
            )
        );
    }

    // =====================================================
    // 下載圖片
    // =====================================================

    async function downloadImage(img) {

        const src =
            img.currentSrc ||
            img.src;

        if (!src) {
            throw new Error(
                "圖片沒有 URL"
            );
        }

        const response =
            await gmRequest({

                method: "GET",

                url: src,

                responseType: "blob",

                timeout: 30000
            });

        if (
            !response ||
            response.status < 200 ||
            response.status >= 400
        ) {

            throw new Error(
                "圖片下載失敗 HTTP " +
                (
                    response?.status ||
                    0
                )
            );
        }

        if (!response.response) {

            throw new Error(
                "沒有取得圖片 Blob"
            );
        }

        return response.response;
    }

    // =====================================================
    // Blob → Base64
    // =====================================================

    function blobToDataURL(blob) {

        return new Promise(
            (resolve, reject) => {

                const reader =
                    new FileReader();

                reader.onload = () => {

                    if (
                        typeof reader.result !==
                            "string"
                    ) {

                        reject(
                            new Error(
                                "Base64 轉換失敗"
                            )
                        );

                        return;
                    }

                    resolve(
                        reader.result
                    );
                };

                reader.onerror = () => {

                    reject(
                        new Error(
                            "FileReader 失敗"
                        )
                    );
                };

                reader.readAsDataURL(
                    blob
                );
            }
        );
    }

    // =====================================================
    // 傳送 Worker
    // =====================================================

    async function callWorker(
        imageData,
        width,
        height
    ) {

        const body =
            JSON.stringify({

                image_data:
                    imageData,

                image_width:
                    width,

                image_height:
                    height

            });

        const response =
            await gmRequest({

                method: "POST",

                url: WORKER_URL,

                headers: {

                    "Content-Type":
                        "application/json"
                },

                data: body,

                responseType: "json",

                timeout: 120000
            });

        if (
            !response ||
            response.status < 200 ||
            response.status >= 300
        ) {

            let detail = "";

            try {

                detail =
                    response?.response
                        ? JSON.stringify(
                            response.response
                        )
                        : "";

            } catch (_) {}

            throw new Error(
                "Worker HTTP " +
                (
                    response?.status ||
                    0
                ) +
                (
                    detail
                        ? " " + detail
                        : ""
                )
            );
        }

        let data =
            response.response;

        if (
            typeof data ===
                "string"
        ) {

            try {

                data =
                    JSON.parse(data);

            } catch (_) {

                throw new Error(
                    "Worker 回傳不是 JSON"
                );
            }
        }

        if (
            !data ||
            data.error
        ) {

            throw new Error(
                data?.error ||
                "Worker 發生未知錯誤"
            );
        }

        return data;
    }

    // =====================================================
    // 建立翻譯框
    // =====================================================

    function createOverlay(
        img,
        block
    ) {

        if (
            !block ||
            !block.translation
        ) {
            return;
        }

        const naturalWidth =
            img.naturalWidth;

        const naturalHeight =
            img.naturalHeight;

        const rect =
            img.getBoundingClientRect();

        if (
            !naturalWidth ||
            !naturalHeight ||
            !rect.width ||
            !rect.height
        ) {
            return;
        }

        let x =
            Number(block.x) || 0;

        let y =
            Number(block.y) || 0;

        let width =
            Number(block.width) || 0;

        let height =
            Number(block.height) || 0;

        if (
            width <= 0 ||
            height <= 0
        ) {
            return;
        }

        // 擴大覆蓋範圍
        const extraX =
            width * EXPAND_X;

        const extraY =
            height * EXPAND_Y;

        x -= extraX;
        y -= extraY;

        width +=
            extraX * 2;

        height +=
            extraY * 2;

        // 限制在圖片內
        x =
            Math.max(
                0,
                x
            );

        y =
            Math.max(
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

        const scaleX =
            rect.width /
            naturalWidth;

        const scaleY =
            rect.height /
            naturalHeight;

        const overlay =
            document.createElement(
                "div"
            );

        overlay.className =
            "google-manga-v72-overlay";

        overlay.textContent =
            block.translation;

        overlay.style.left =
            (
                rect.left +
                x * scaleX +
                window.scrollX
            ) + "px";

        overlay.style.top =
            (
                rect.top +
                y * scaleY +
                window.scrollY
            ) + "px";

        overlay.style.width =
            (
                width * scaleX
            ) + "px";

        overlay.style.minHeight =
            (
                height * scaleY
            ) + "px";

        const fontSize =
            Math.max(
                13,
                Math.min(
                    30,
                    height *
                    scaleY *
                    0.40
                )
            );

        overlay.style.fontSize =
            fontSize + "px";

        document.body.appendChild(
            overlay
        );
    }

    // =====================================================
    // 翻譯單張圖片
    // =====================================================

    async function translateOne(img) {

        if (
            img.dataset[ATTR] ===
            "done"
        ) {
            return;
        }

        img.dataset[ATTR] =
            "processing";

        state.processing++;

        updatePanel();

        try {

            // 1. 下載圖片
            const blob =
                await downloadImage(
                    img
                );

            // 2. Base64
            const imageData =
                await blobToDataURL(
                    blob
                );

            // 3. Worker
            let data = null;

            let lastError = null;

            for (
                let attempt = 0;
                attempt <= MAX_RETRIES;
                attempt++
            ) {

                try {

                    data =
                        await callWorker(
                            imageData,
                            img.naturalWidth,
                            img.naturalHeight
                        );

                    break;

                } catch (error) {

                    lastError =
                        error;

                    if (
                        attempt <
                        MAX_RETRIES
                    ) {

                        await sleep(
                            1000 *
                            (attempt + 1)
                        );
                    }
                }
            }

            if (!data) {

                throw (
                    lastError ||
                    new Error(
                        "Worker 請求失敗"
                    )
                );
            }

            // 4. 顯示結果
            const blocks =
                Array.isArray(
                    data.text_blocks
                )
                    ? data.text_blocks
                    : [];

            for (
                const block of blocks
            ) {

                createOverlay(
                    img,
                    block
                );
            }

            img.dataset[ATTR] =
                "done";

            state.done++;

        } catch (error) {

            img.dataset[ATTR] =
                "failed";

            state.failed++;

            state.lastError =
                String(
                    error?.message ||
                    error
                );

            console.error(
                "[Google Manga V7.2]",
                error
            );

        } finally {

            state.processing--;

            updatePanel();
        }
    }

    // =====================================================
    // 等待
    // =====================================================

    function sleep(ms) {

        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    ms
                )
        );
    }

    // =====================================================
    // 找圖片
    // =====================================================

    function getImages() {

        const images =
            Array.from(
                document.querySelectorAll(
                    "img"
                )
            );

        const top =
            window.scrollY -
            ROOT_MARGIN;

        const bottom =
            window.scrollY +
            window.innerHeight +
            ROOT_MARGIN;

        return images.filter(
            img => {

                if (
                    !img.complete
                ) {
                    return false;
                }

                if (
                    img.dataset[ATTR] ===
                    "done" ||
                    img.dataset[ATTR] ===
                    "processing"
                ) {
                    return false;
                }

                if (
                    img.naturalWidth <
                    MIN_WIDTH ||
                    img.naturalHeight <
                    MIN_HEIGHT
                ) {
                    return false;
                }

                const rect =
                    img.getBoundingClientRect();

                const imageTop =
                    rect.top +
                    window.scrollY;

                const imageBottom =
                    rect.bottom +
                    window.scrollY;

                if (
                    imageBottom <
                    top ||
                    imageTop >
                    bottom
                ) {
                    return false;
                }

                return true;
            }
        );
    }

    // =====================================================
    // 一張一張處理
    // =====================================================

    let scanning = false;

    async function scanAndTranslate() {

        if (scanning) {
            return;
        }

        scanning = true;

        try {

            const images =
                getImages();

            state.found =
                images.length;

            updatePanel();

            console.log(
                "[Google Manga V7.2] 找到圖片：",
                images.length
            );

            for (
                const img of images
            ) {

                await translateOne(
                    img
                );

                await sleep(
                    300
                );
            }

        } finally {

            scanning = false;

            updatePanel();
        }
    }

    // =====================================================
    // MutationObserver
    // =====================================================

    let mutationTimer = null;

    const observer =
        new MutationObserver(
            () => {

                clearTimeout(
                    mutationTimer
                );

                mutationTimer =
                    setTimeout(
                        () => {

                            scanAndTranslate();

                        },
                        800
                    );
            }
        );

    // =====================================================
    // 滾動
    // =====================================================

    let scrollTimer = null;

    window.addEventListener(
        "scroll",
        () => {

            clearTimeout(
                scrollTimer
            );

            scrollTimer =
                setTimeout(
                    () => {

                        scanAndTranslate();

                    },
                    500
                );

        },
        {
            passive: true
        }
    );

    // =====================================================
    // 啟動
    // =====================================================

    function start() {

        createPanel();

        observer.observe(
            document.body,
            {
                childList: true,
                subtree: true
            }
        );

        setTimeout(
            scanAndTranslate,
            1000
        );
    }

    if (document.body) {

        start();

    } else {

        window.addEventListener(
            "DOMContentLoaded",
            start,
            {
                once: true
            }
        );
    }

})();
