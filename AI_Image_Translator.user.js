// ==UserScript==
// @name         AI 圖片自動翻譯 V7.1 - Google Vision
// @namespace    manga-translator
// @version      7.1.0
// @description  Google Vision OCR + Google Translation 漫畫自動翻譯
// @match        *://*/*
// @grant        GM.xmlHttpRequest
// @connect      *
// @run-at       document-end
// @inject-into  content
// ==/UserScript==

(() => {
    "use strict";

    // =========================================================
    // 設定
    // =========================================================

    const WORKER_URL =
        "https://safari-image-translator.cgl20050126.workers.dev";

    // 最小漫畫圖片尺寸
    const MIN_WIDTH = 150;
    const MIN_HEIGHT = 80;

    // 一次只處理一張
    const MAX_CONCURRENT = 1;

    // 圖片之間稍微間隔
    const DELAY = 300;

    // 視窗上下各多掃描多少 px
    const ROOT_MARGIN = 1200;

    // 失敗重試
    const MAX_RETRIES = 2;

    // 翻譯框額外擴大
    const EXPAND_X = 0.22;
    const EXPAND_Y = 0.28;

    // 本版本專用標記
    const PROCESSED_ATTR =
        "data-google-manga-v71";

    // =========================================================
    // 狀態
    // =========================================================

    const state = {
        found: 0,
        processing: 0,
        done: 0,
        failed: 0,
        lastError: "",
        started: false
    };

    const queue = [];

    const queued =
        new WeakSet();

    let running = 0;

    // =========================================================
    // 狀態面板
    // =========================================================

    let panel = null;

    function createPanel() {

        if (panel) {
            return;
        }

        panel =
            document.createElement("div");

        panel.id =
            "google-manga-translator-panel";

        panel.innerHTML = `
            <div class="gmt-title">
                Google Manga Translator
            </div>

            <div class="gmt-status">
                <span class="gmt-dot"></span>
                <span id="gmt-status-text">
                    初始化
                </span>
            </div>

            <div class="gmt-counts">
                <span>
                    圖片：
                    <b id="gmt-found">0</b>
                </span>

                <span>
                    處理：
                    <b id="gmt-processing">0</b>
                </span>

                <span>
                    完成：
                    <b id="gmt-done">0</b>
                </span>

                <span>
                    失敗：
                    <b id="gmt-failed">0</b>
                </span>
            </div>

            <div
                id="gmt-error"
                class="gmt-error"
            ></div>
        `;

        document.body.appendChild(panel);

        updatePanel();
    }

    function updatePanel() {

        if (!panel) {
            return;
        }

        const found =
            panel.querySelector(
                "#gmt-found"
            );

        const processing =
            panel.querySelector(
                "#gmt-processing"
            );

        const done =
            panel.querySelector(
                "#gmt-done"
            );

        const failed =
            panel.querySelector(
                "#gmt-failed"
            );

        const status =
            panel.querySelector(
                "#gmt-status-text"
            );

        const error =
            panel.querySelector(
                "#gmt-error"
            );

        if (found) {
            found.textContent =
                state.found;
        }

        if (processing) {
            processing.textContent =
                state.processing;
        }

        if (done) {
            done.textContent =
                state.done;
        }

        if (failed) {
            failed.textContent =
                state.failed;
        }

        if (status) {

            if (state.processing > 0) {

                status.textContent =
                    "正在翻譯";

            } else if (
                queue.length > 0
            ) {

                status.textContent =
                    "等待處理";

            } else if (
                state.done > 0 &&
                state.failed === 0
            ) {

                status.textContent =
                    "完成";

            } else if (
                state.failed > 0
            ) {

                status.textContent =
                    "部分失敗";

            } else {

                status.textContent =
                    "等待圖片";
            }
        }

        if (error) {

            if (state.lastError) {

                error.textContent =
                    state.lastError;

            } else {

                error.textContent =
                    "";
            }
        }
    }

    // =========================================================
    // CSS
    // =========================================================

    const style =
        document.createElement("style");

    style.textContent = `

        #google-manga-translator-panel {

            position: fixed;

            top: 14px;
            right: 14px;

            z-index: 2147483647;

            min-width: 280px;

            max-width: 90vw;

            padding: 16px 18px;

            border-radius: 18px;

            background:
                rgba(25,25,25,0.94);

            color: white;

            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "Noto Sans TC",
                "Microsoft JhengHei",
                sans-serif;

            box-shadow:
                0 8px 30px
                rgba(0,0,0,0.35);

            backdrop-filter:
                blur(12px);

            -webkit-backdrop-filter:
                blur(12px);

            pointer-events:
                none;

        }

        #google-manga-translator-panel
        .gmt-title {

            font-size: 20px;

            font-weight: 600;

            margin-bottom: 8px;

        }

        #google-manga-translator-panel
        .gmt-status {

            display: flex;

            align-items: center;

            gap: 8px;

            font-size: 16px;

            margin-bottom: 10px;

        }

        #google-manga-translator-panel
        .gmt-dot {

            width: 12px;

            height: 12px;

            border-radius: 50%;

            background:
                #36d26f;

            display: inline-block;

            animation:
                gmt-pulse 1.2s infinite;

        }

        #google-manga-translator-panel
        .gmt-counts {

            display: grid;

            grid-template-columns:
                repeat(2, 1fr);

            gap: 5px 14px;

            font-size: 15px;

        }

        #google-manga-translator-panel
        .gmt-error {

            margin-top: 8px;

            max-width: 360px;

            font-size: 12px;

            line-height: 1.35;

            color:
                #ff7777;

            word-break: break-word;

        }

        @keyframes gmt-pulse {

            0% {
                opacity: 1;
            }

            50% {
                opacity: 0.35;
            }

            100% {
                opacity: 1;
            }

        }

        .google-manga-translation-v71 {

            position: absolute;

            z-index: 2147483646;

            box-sizing: border-box;

            display: flex;

            align-items: center;

            justify-content: center;

            padding: 8px 12px;

            background:
                rgba(255,255,255,0.97);

            color:
                #111;

            border-radius:
                8px;

            border:
                1px solid
                rgba(0,0,0,0.12);

            box-shadow:
                0 1px 5px
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

    document.head.appendChild(style);

    // =========================================================
    // 工具
    // =========================================================

    function sleep(ms) {

        return new Promise(
            resolve =>
                setTimeout(resolve, ms)
        );
    }

    // =========================================================
    // GM.xmlHttpRequest
    // =========================================================

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

        if (
            typeof GM_xmlhttpRequest ===
                "function"
        ) {

            return new Promise(
                (resolve, reject) => {

                    GM_xmlhttpRequest({

                        ...options,

                        onload:
                            resolve,

                        onerror:
                            reject,

                        ontimeout:
                            reject
                    });

                }
            );
        }

        return Promise.reject(
            new Error(
                "Userscripts 不支援 GM.xmlHttpRequest"
            )
        );
    }

    // =========================================================
    // 取得漫畫圖片
    // =========================================================

    async function getImageBlob(img) {

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
                "圖片下載 HTTP " +
                (
                    response?.status ||
                    0
                )
            );
        }

        if (!response.response) {

            throw new Error(
                "沒有取得圖片資料"
            );
        }

        return response.response;
    }

    // =========================================================
    // Blob → Base64
    // =========================================================

    function blobToDataURL(blob) {

        return new Promise(
            (resolve, reject) => {

                const reader =
                    new FileReader();

                reader.onload =
                    () => {

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

                reader.onerror =
                    () => {

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

    // =========================================================
    // POST Worker
    // =========================================================

    async function sendToWorker(
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

                if (
                    response?.response
                ) {

                    detail =
                        typeof response.response ===
                            "string"

                            ? response.response

                            : JSON.stringify(
                                response.response
                            );
                }

            } catch (_) {}

            throw new Error(
                "Worker HTTP " +
                (
                    response?.status ||
                    0
                ) +
                (
                    detail
                        ? " - " + detail
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
                "Worker 沒有正常回應"
            );
        }

        return data;
    }

    // =========================================================
    // 清除圖片附近舊翻譯
    // =========================================================

    function removeOldOverlays(img) {

        const overlays =
            document.querySelectorAll(
                ".google-manga-translation-v71"
            );

        const rect =
            img.getBoundingClientRect();

        for (
            const overlay of overlays
        ) {

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

    // =========================================================
    // 建立翻譯框
    // =========================================================

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

        if (
            !naturalWidth ||
            !naturalHeight
        ) {

            return;
        }

        const rect =
            img.getBoundingClientRect();

        if (
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

        // -------------------------
        // 擴大覆蓋區域
        // -------------------------

        const extraX =
            width *
            EXPAND_X;

        const extraY =
            height *
            EXPAND_Y;

        x -= extraX;
        y -= extraY;

        width +=
            extraX * 2;

        height +=
            extraY * 2;

        // -------------------------
        // 限制在圖片範圍
        // -------------------------

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

        // -------------------------
        // 尺寸比例
        // -------------------------

        const scaleX =
            rect.width /
            naturalWidth;

        const scaleY =
            rect.height /
            naturalHeight;

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

        // -------------------------
        // 建立元素
        // -------------------------

        const overlay =
            document.createElement(
                "div"
            );

        overlay.className =
            "google-manga-translation-v71";

        overlay.textContent =
            block.translation;

        overlay.style.left =
            (
                left +
                window.scrollX
            ) + "px";

        overlay.style.top =
            (
                top +
                window.scrollY
            ) + "px";

        overlay.style.width =
            cssWidth + "px";

        overlay.style.minHeight =
            cssHeight + "px";

        // -------------------------
        // 字體
        // -------------------------

        const fontSize =
            Math.max(
                13,
                Math.min(
                    30,
                    cssHeight * 0.40
                )
            );

        overlay.style.fontSize =
            fontSize + "px";

        document.body.appendChild(
            overlay
        );
    }

    // =========================================================
    // 翻譯一張圖片
    // =========================================================

    async function translateImage(
        img
    ) {

        img.dataset[
            PROCESSED_ATTR
        ] = "processing";

        state.processing++;
        updatePanel();

        try {

            // -------------------------
            // 下載圖片
            // -------------------------

            const blob =
                await getImageBlob(
                    img
                );

            // -------------------------
            // Base64
            // -------------------------

            const imageData =
                await blobToDataURL(
                    blob
                );

            // -------------------------
            // Worker
            // -------------------------

            let data = null;

            let lastError = null;

            for (
                let attempt = 0;
                attempt <= MAX_RETRIES;
                attempt++
            ) {

                try {

                    data =
                        await sendToWorker(
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
                            800 *
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

            // -------------------------
            // 清除舊框
            // -------------------------

            removeOldOverlays(
                img
            );

            // -------------------------
            // 顯示翻譯
            // -------------------------

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

            img.dataset[
                PROCESSED_ATTR
            ] = "done";

            state.done++;

        } catch (error) {

            img.dataset[
                PROCESSED_ATTR
            ] = "failed";

            state.failed++;

            state.lastError =
                String(
                    error?.message ||
                    error
                );

            console.error(
                "[Google Manga Translator V7.1]",
                error
            );

        } finally {

            state.processing--;

            running--;

            updatePanel();

            await sleep(DELAY);

            processQueue();
        }
    }

    // =========================================================
    // Queue
    // =========================================================

    function enqueue(img) {

        if (!img) {
            return;
        }

        if (
            queued.has(img)
        ) {

            return;
        }

        if (
            img.dataset[
                PROCESSED_ATTR
            ] === "done" ||
            img.dataset[
                PROCESSED_ATTR
            ] === "processing"
        ) {

            return;
        }

        queued.add(img);

        queue.push(img);

        processQueue();
    }

    function processQueue() {

        if (
            running >=
            MAX_CONCURRENT
        ) {

            updatePanel();

            return;
        }

        const img =
            queue.shift();

        if (!img) {

            updatePanel();

            return;
        }

        running++;

        updatePanel();

        // 不 await，避免阻塞 Queue
        translateImage(
            img
        );
    }

    // =========================================================
    // 掃描圖片
    // =========================================================

    function scanImages() {

        const images =
            Array.from(
                document.querySelectorAll(
                    "img"
                )
            );

        let count = 0;

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
                !img ||
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
                bottom <
                viewportTop ||
                top >
                viewportBottom
            ) {

                continue;
            }

            count++;

            enqueue(img);
        }

        state.found =
            count;

        updatePanel();
    }

    // =========================================================
    // MutationObserver
    // =========================================================

    let scanTimer = null;

    const observer =
        new MutationObserver(
            () => {

                clearTimeout(
                    scanTimer
                );

                scanTimer =
                    setTimeout(
                        scanImages,
                        500
                    );
            }
        );

    // =========================================================
    // 啟動
    // =========================================================

    function start() {

        createPanel();

        state.started =
            true;

        updatePanel();

        // 初次掃描
        setTimeout(
            scanImages,
            800
        );

        // 監控新增漫畫圖片
        observer.observe(
            document.body,
            {
                childList: true,
                subtree: true
            }
        );

        // 捲動後繼續掃描
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
                        400
                    );

            },
            {
                passive: true
            }
        );

        // 窗口大小改變後重新掃描
        window.addEventListener(
            "resize",
            () => {

                clearTimeout(
                    scrollTimer
                );

                scrollTimer =
                    setTimeout(
                        scanImages,
                        400
                    );
            }
        );
    }

    if (
        document.body
    ) {

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
