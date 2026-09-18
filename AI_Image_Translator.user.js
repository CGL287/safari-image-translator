// ==UserScript==
// @name         AI 圖片自動翻譯 V7.1 - Google Vision
// @namespace    manga-translator
// @version      7.1.0
// @description  Google Vision OCR + Google Translation 漫畫自動翻譯
// @match        *://*/*
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-end
// ==/UserScript==

(() => {
    "use strict";

    const WORKER_URL =
        "https://safari-image-translator.cgl20050126.workers.dev";

    const MIN_WIDTH = 150;
    const MIN_HEIGHT = 80;

    const MAX_CONCURRENT = 1;
    const MAX_RETRIES = 2;

    const ROOT_MARGIN = 1200;
    const SCAN_DELAY = 500;

    const EXPAND_X = 0.20;
    const EXPAND_Y = 0.25;

    const PROCESSED_ATTR =
        "data-google-manga-translated";

    let running = 0;
    const queue = [];
    const queued = new WeakSet();

    // =========================================================
    // 狀態面板
    // =========================================================

    const stats = {
        found: 0,
        queued: 0,
        processing: 0,
        success: 0,
        failed: 0,
        ocrBlocks: 0
    };

    function createStatusPanel() {
        if (document.getElementById(
            "google-manga-status"
        )) {
            return;
        }

        const panel =
            document.createElement("div");

        panel.id =
            "google-manga-status";

        panel.innerHTML = `
            <div id="gm-status-title">
                Google Manga Translator
            </div>

            <div id="gm-status-state">
                ● 啟動中
            </div>

            <div id="gm-status-detail">
                圖片：0　處理：0
            </div>
        `;

        panel.style.cssText = `
            position: fixed;
            top: 12px;
            right: 12px;
            z-index: 2147483647;

            padding: 10px 13px;

            background: rgba(20,20,20,.92);
            color: white;

            border-radius: 10px;

            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "Noto Sans TC",
                sans-serif;

            font-size: 13px;

            line-height: 1.45;

            box-shadow:
                0 3px 12px
                rgba(0,0,0,.35);

            pointer-events: none;
        `;

        document.documentElement.appendChild(
            panel
        );
    }

    function updateStatus(
        state = null
    ) {
        const panel =
            document.getElementById(
                "google-manga-status"
            );

        if (!panel) return;

        if (state) {
            const stateEl =
                document.getElementById(
                    "gm-status-state"
                );

            if (stateEl) {
                stateEl.textContent =
                    state;
            }
        }

        const detail =
            document.getElementById(
                "gm-status-detail"
            );

        if (detail) {
            detail.textContent =
                `圖片：${stats.found}　` +
                `處理：${stats.processing}　` +
                `完成：${stats.success}　` +
                `失敗：${stats.failed}`;
        }
    }

    // =========================================================
    // 延遲
    // =========================================================

    function sleep(ms) {
        return new Promise(
            resolve => setTimeout(
                resolve,
                ms
            )
        );
    }

    // =========================================================
    // GM XHR
    // =========================================================

    function gmRequest(details) {

        const gm =
            typeof GM !== "undefined" &&
            typeof GM.xmlHttpRequest ===
                "function"
                ? GM.xmlHttpRequest
                : typeof GM_xmlhttpRequest ===
                    "function"
                    ? GM_xmlhttpRequest
                    : null;

        if (!gm) {
            return Promise.reject(
                new Error(
                    "Userscripts 不支援 GM.xmlHttpRequest"
                )
            );
        }

        return new Promise(
            (resolve, reject) => {

                let finished = false;

                const options = {
                    ...details,

                    onload: response => {
                        if (finished) return;

                        finished = true;
                        resolve(response);
                    },

                    onerror: error => {
                        if (finished) return;

                        finished = true;

                        reject(
                            new Error(
                                "GM XHR error"
                            )
                        );
                    },

                    ontimeout: () => {
                        if (finished) return;

                        finished = true;

                        reject(
                            new Error(
                                "GM XHR timeout"
                            )
                        );
                    },

                    onabort: () => {
                        if (finished) return;

                        finished = true;

                        reject(
                            new Error(
                                "GM XHR aborted"
                            )
                        );
                    }
                };

                gm(options);
            }
        );
    }

    // =========================================================
    // Blob → Data URL
    // =========================================================

    function blobToDataURL(blob) {

        return new Promise(
            (resolve, reject) => {

                const reader =
                    new FileReader();

                reader.onload =
                    () => resolve(
                        reader.result
                    );

                reader.onerror =
                    () => reject(
                        new Error(
                            "FileReader 失敗"
                        )
                    );

                reader.readAsDataURL(
                    blob
                );
            }
        );
    }

    // =========================================================
    // 取得圖片
    //
    // 第一優先：GM.xmlHttpRequest
    // 第二優先：普通 fetch
    // =========================================================

    async function imageToBase64(img) {

        const src =
            img.currentSrc ||
            img.src;

        if (!src) {
            throw new Error(
                "圖片沒有 src"
            );
        }

        updateStatus(
            "● 正在取得漫畫圖片"
        );

        // -----------------------------------------------------
        // 方法 1：GM.xmlHttpRequest
        // -----------------------------------------------------

        try {

            const response =
                await gmRequest({
                    method: "GET",
                    url: src,
                    responseType: "blob",
                    timeout: 20000
                });

            if (
                response.status >= 200 &&
                response.status < 300 &&
                response.response
            ) {

                const blob =
                    response.response;

                if (
                    blob instanceof Blob &&
                    blob.size > 0
                ) {

                    return await blobToDataURL(
                        blob
                    );
                }
            }

        } catch (error) {

            console.warn(
                "[Google Manga] GM圖片取得失敗：",
                error
            );
        }

        // -----------------------------------------------------
        // 方法 2：普通 fetch
        // -----------------------------------------------------

        try {

            const response =
                await fetch(
                    src,
                    {
                        credentials:
                            "include"
                    }
                );

            if (!response.ok) {
                throw new Error(
                    `圖片 HTTP ${response.status}`
                );
            }

            const blob =
                await response.blob();

            if (!blob.size) {
                throw new Error(
                    "圖片內容為空"
                );
            }

            return await blobToDataURL(
                blob
            );

        } catch (error) {

            throw new Error(
                "無法取得漫畫圖片：" +
                error.message
            );
        }
    }

    // =========================================================
    // 呼叫 Worker
    // =========================================================

    async function callWorker(
        imageData,
        img
    ) {

        updateStatus(
            "● 正在送往 Google Vision..."
        );

        const payload = {
            image_data:
                imageData,

            image_width:
                img.naturalWidth,

            image_height:
                img.naturalHeight
        };

        // -----------------------------------------------------
        // 優先使用普通 fetch
        // Worker 已經設定 CORS
        // -----------------------------------------------------

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

            const text =
                await response.text();

            let data;

            try {
                data =
                    JSON.parse(text);
            } catch {
                throw new Error(
                    "Worker 回傳非 JSON：" +
                    text.slice(0, 300)
                );
            }

            if (!response.ok) {

                throw new Error(
                    data.error ||
                    `Worker HTTP ${response.status}`
                );
            }

            return data;

        } catch (fetchError) {

            console.warn(
                "[Google Manga] fetch Worker 失敗，嘗試 GM XHR",
                fetchError
            );

            // -------------------------------------------------
            // fallback：GM XHR
            // -------------------------------------------------

            const response =
                await gmRequest({

                    method: "POST",

                    url: WORKER_URL,

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    data:
                        JSON.stringify(
                            payload
                        ),

                    responseType:
                        "text",

                    timeout: 60000
                });

            const text =
                response.responseText ||
                response.response ||
                "";

            let data;

            try {
                data =
                    JSON.parse(text);
            } catch {
                throw new Error(
                    "Worker 回傳非 JSON：" +
                    text.slice(0, 300)
                );
            }

            if (
                response.status < 200 ||
                response.status >= 300
            ) {

                throw new Error(
                    data.error ||
                    `Worker HTTP ${response.status}`
                );
            }

            return data;
        }
    }

    // =========================================================
    // 清除指定圖片附近的舊 Overlay
    // =========================================================

    function removeOldOverlays(img) {

        const overlays =
            document.querySelectorAll(
                ".google-manga-translation"
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

        // -----------------------------------------------------
        // 擴大覆蓋範圍
        // -----------------------------------------------------

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

        x = Math.max(
            0,
            x
        );

        y = Math.max(
            0,
            y
        );

        width = Math.min(
            width,
            naturalWidth - x
        );

        height = Math.min(
            height,
            naturalHeight - y
        );

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

        // -----------------------------------------------------
        // Overlay
        // -----------------------------------------------------

        const overlay =
            document.createElement(
                "div"
            );

        overlay.className =
            "google-manga-translation";

        overlay.textContent =
            block.translation;

        overlay.style.left =
            `${left + window.scrollX}px`;

        overlay.style.top =
            `${top + window.scrollY}px`;

        overlay.style.width =
            `${cssWidth}px`;

        overlay.style.minHeight =
            `${cssHeight}px`;

        // -----------------------------------------------------
        // 字體
        // -----------------------------------------------------

        const fontSize =
            Math.max(
                13,
                Math.min(
                    28,
                    cssHeight * 0.40
                )
            );

        overlay.style.fontSize =
            `${fontSize}px`;

        // -----------------------------------------------------
        // 多行
        // -----------------------------------------------------

        overlay.style.lineHeight =
            "1.30";

        overlay.style.padding =
            `${Math.max(
                5,
                cssHeight * 0.08
            )}px ${Math.max(
                8,
                cssWidth * 0.05
            )}px`;

        document.body.appendChild(
            overlay
        );
    }

    // =========================================================
    // 翻譯單張圖片
    // =========================================================

    async function translateImage(img) {

        if (
            img.dataset[
                PROCESSED_ATTR
            ] === "done"
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

        stats.processing++;
        updateStatus(
            "● 開始處理圖片"
        );

        try {

            const imageData =
                await imageToBase64(
                    img
                );

            let data = null;
            let lastError = null;

            // -------------------------------------------------
            // Worker 重試
            // -------------------------------------------------

            for (
                let attempt = 0;
                attempt <= MAX_RETRIES;
                attempt++
            ) {

                try {

                    data =
                        await callWorker(
                            imageData,
                            img
                        );

                    break;

                } catch (error) {

                    lastError =
                        error;

                    console.error(
                        "[Google Manga] Worker:",
                        error
                    );

                    if (
                        attempt <
                        MAX_RETRIES
                    ) {

                        updateStatus(
                            `● 翻譯失敗，重試 ${
                                attempt + 1
                            }/${MAX_RETRIES}`
                        );

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
                        "Worker 沒有回應"
                    )
                );
            }

            const blocks =
                Array.isArray(
                    data.text_blocks
                )
                    ? data.text_blocks
                    : [];

            stats.ocrBlocks +=
                blocks.length;

            updateStatus(
                `● Google OCR 找到 ${blocks.length} 個文字區域`
            );

            removeOldOverlays(
                img
            );

            // -------------------------------------------------
            // 顯示翻譯
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
                    block
                );
            }

            img.dataset[
                PROCESSED_ATTR
            ] = "done";

            stats.success++;

            updateStatus(
                `✓ 完成：${blocks.length} 個文字區域`
            );

        } catch (error) {

            console.error(
                "[Google Manga Translator]",
                error
            );

            img.dataset[
                PROCESSED_ATTR
            ] = "error";

            stats.failed++;

            updateStatus(
                "❌ " +
                error.message
            );

        } finally {

            stats.processing =
                Math.max(
                    0,
                    stats.processing - 1
                );

            running--;

            updateStatus();

            processQueue();
        }
    }

    // =========================================================
    // Queue
    // =========================================================

    function enqueue(img) {

        if (
            !img ||
            queued.has(img)
        ) {
            return;
        }

        queued.add(img);

        queue.push(img);

        stats.queued++;

        processQueue();
    }

    function processQueue() {

        while (
            running <
                MAX_CONCURRENT &&
            queue.length > 0
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

    // =========================================================
    // 掃描圖片
    // =========================================================

    function scanImages() {

        const images =
            document.querySelectorAll(
                "img"
            );

        const top =
            window.scrollY -
            ROOT_MARGIN;

        const bottom =
            window.scrollY +
            window.innerHeight +
            ROOT_MARGIN;

        for (
            const img of images
        ) {

            const status =
                img.dataset[
                    PROCESSED_ATTR
                ];

            if (
                status === "done" ||
                status === "processing"
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

            const imageTop =
                rect.top +
                window.scrollY;

            const imageBottom =
                rect.bottom +
                window.scrollY;

            if (
                imageBottom < top ||
                imageTop > bottom
            ) {
                continue;
            }

            stats.found++;

            enqueue(img);
        }

        updateStatus(
            `● 找到 ${stats.found} 張漫畫圖片`
        );
    }

    // =========================================================
    // CSS
    // =========================================================

    const style =
        document.createElement(
            "style"
        );

    style.textContent = `

        .google-manga-translation {

            position: absolute;

            z-index: 2147483646;

            box-sizing: border-box;

            display: flex;

            align-items: center;

            justify-content: center;

            background:
                rgba(255,255,255,.96);

            color:
                #111;

            border-radius:
                7px;

            border:
                1px solid
                rgba(0,0,0,.10);

            box-shadow:
                0 2px 7px
                rgba(0,0,0,.20);

            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "Noto Sans TC",
                "Microsoft JhengHei",
                sans-serif;

            font-weight:
                600;

            text-align:
                center;

            white-space:
                pre-wrap;

            word-break:
                break-word;

            overflow:
                hidden;

            line-height:
                1.30;

            pointer-events:
                none;

        }

        #google-manga-status {

            user-select:
                none;

        }

    `;

    document.head.appendChild(
        style
    );

    // =========================================================
    // 啟動
    // =========================================================

    createStatusPanel();

    updateStatus(
        "✓ Userscript 已啟動"
    );

    setTimeout(
        scanImages,
        1200
    );

    // =========================================================
    // 滾動
    // =========================================================

    let scanTimer = null;

    window.addEventListener(
        "scroll",
        () => {

            clearTimeout(
                scanTimer
            );

            scanTimer =
                setTimeout(
                    scanImages,
                    SCAN_DELAY
                );

        },
        {
            passive: true
        }
    );

    // =========================================================
    // 動態載入圖片
    // =========================================================

    const observer =
        new MutationObserver(
            () => {

                clearTimeout(
                    window.__googleMangaScanTimer
                );

                window.__googleMangaScanTimer =
                    setTimeout(
                        scanImages,
                        500
                    );
            }
        );

    if (document.body) {

        observer.observe(
            document.body,
            {
                childList: true,
                subtree: true
            }
        );
    }

})();
