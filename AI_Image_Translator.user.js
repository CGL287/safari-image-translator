// ==UserScript==
// @name         AI 圖片自動翻譯 V7.2 - Google Vision
// @namespace    manga-translator
// @version      7.2.0
// @description  Google Vision OCR + Google Translation 漫畫自動翻譯
// @match        *://*/*
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @connect      *
// @inject-into  content
// @run-at       document-end
// ==/UserScript==

(() => {
    "use strict";

    // =========================================================
    // 設定
    // =========================================================

    const WORKER_URL =
        "https://safari-image-translator.cgl20050126.workers.dev";

    const MIN_WIDTH = 150;
    const MIN_HEIGHT = 80;

    // 一次只處理一張
    const DELAY_BETWEEN_IMAGES = 300;

    // 重新掃描間隔
    const SCAN_DELAY = 1000;

    // 最多重試
    const MAX_RETRIES = 2;

    // 翻譯框擴大
    const EXPAND_X = 0.20;
    const EXPAND_Y = 0.25;

    // 避免同一圖片重複處理
    const processedImages =
        new WeakSet();

    const processingImages =
        new WeakSet();

    // =========================================================
    // 狀態
    // =========================================================

    let allImages = [];
    let processingCount = 0;
    let completedCount = 0;
    let failedCount = 0;

    let currentStatus =
        "初始化";

    let currentDetail =
        "";

    // =========================================================
    // UI
    // =========================================================

    const panel =
        document.createElement("div");

    panel.id =
        "google-manga-status";

    panel.innerHTML = `
        <div class="gm-title">
            Google Manga Translator
        </div>

        <div class="gm-status">
            <span class="gm-dot"></span>
            <span class="gm-status-text">
                初始化
            </span>
        </div>

        <div class="gm-detail"></div>

        <div class="gm-stats">
            <div>
                圖片：
                <b class="gm-total">0</b>
            </div>

            <div>
                處理：
                <b class="gm-processing">0</b>
            </div>

            <div>
                完成：
                <b class="gm-completed">0</b>
            </div>

            <div>
                失敗：
                <b class="gm-failed">0</b>
            </div>
        </div>
    `;

    const style =
        document.createElement("style");

    style.textContent = `

        #google-manga-status {

            position: fixed;

            top: 18px;
            right: 18px;

            z-index: 2147483647;

            width: 330px;

            padding: 20px 24px;

            box-sizing: border-box;

            border-radius: 20px;

            background:
                rgba(20, 20, 20, 0.94);

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
                blur(10px);

            -webkit-backdrop-filter:
                blur(10px);

            pointer-events:
                none;
        }

        #google-manga-status
        .gm-title {

            font-size: 22px;

            font-weight: 700;

            margin-bottom: 12px;
        }

        #google-manga-status
        .gm-status {

            display: flex;

            align-items: center;

            gap: 10px;

            font-size: 18px;

            margin-bottom: 6px;
        }

        #google-manga-status
        .gm-dot {

            width: 14px;
            height: 14px;

            border-radius: 50%;

            background: #62d27c;

            flex: 0 0 auto;
        }

        #google-manga-status
        .gm-dot.processing {

            background: #4da3ff;

            animation:
                gm-pulse 1s infinite;
        }

        #google-manga-status
        .gm-dot.error {

            background: #ff5c5c;
        }

        #google-manga-status
        .gm-dot.done {

            background: #62d27c;
        }

        #google-manga-status
        .gm-detail {

            min-height: 20px;

            margin-bottom: 12px;

            font-size: 14px;

            color:
                rgba(255,255,255,0.72);

            word-break: break-word;
        }

        #google-manga-status
        .gm-stats {

            display: grid;

            grid-template-columns:
                1fr 1fr;

            gap: 8px 20px;

            font-size: 17px;
        }

        @keyframes gm-pulse {

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

        .google-manga-translation {

            position: absolute;

            z-index: 2147483646;

            box-sizing: border-box;

            display: flex;

            align-items: center;

            justify-content: center;

            padding:
                8px 12px;

            background:
                rgba(255,255,255,0.97);

            color:
                #111;

            border:
                1px solid
                rgba(0,0,0,0.15);

            border-radius:
                8px;

            box-shadow:
                0 2px 8px
                rgba(0,0,0,0.25);

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

            word-break:
                break-word;

            overflow:
                hidden;

            pointer-events:
                none;
        }
    `;

    document.head.appendChild(style);
    document.body.appendChild(panel);

    // =========================================================
    // UI 更新
    // =========================================================

    function updateStatus(
        status,
        detail = "",
        mode = "normal"
    ) {

        currentStatus = status;
        currentDetail = detail;

        const statusText =
            panel.querySelector(
                ".gm-status-text"
            );

        const detailText =
            panel.querySelector(
                ".gm-detail"
            );

        const dot =
            panel.querySelector(
                ".gm-dot"
            );

        statusText.textContent =
            status;

        detailText.textContent =
            detail;

        dot.className =
            "gm-dot";

        if (mode === "processing") {
            dot.classList.add(
                "processing"
            );
        }

        if (mode === "error") {
            dot.classList.add(
                "error"
            );
        }

        if (mode === "done") {
            dot.classList.add(
                "done"
            );
        }

        panel.querySelector(
            ".gm-total"
        ).textContent =
            allImages.length;

        panel.querySelector(
            ".gm-processing"
        ).textContent =
            processingCount;

        panel.querySelector(
            ".gm-completed"
        ).textContent =
            completedCount;

        panel.querySelector(
            ".gm-failed"
        ).textContent =
            failedCount;
    }

    // =========================================================
    // Sleep
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
    // GM Request
    // =========================================================

    function gmRequest(options) {

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

            return Promise.reject(
                new Error(
                    "Userscripts 不支援 GM.xmlHttpRequest"
                )
            );
        }

        return new Promise(
            (resolve, reject) => {

                fn({

                    ...options,

                    onload:
                        response => {
                            resolve(response);
                        },

                    onerror:
                        error => {
                            reject(
                                new Error(
                                    "GM Request 失敗"
                                )
                            );
                        },

                    ontimeout:
                        () => {
                            reject(
                                new Error(
                                    "GM Request Timeout"
                                )
                            );
                        }
                });
            }
        );
    }

    // =========================================================
    // ArrayBuffer → Data URL
    // =========================================================

    async function arrayBufferToDataURL(
        buffer,
        contentType
    ) {

        const blob =
            new Blob(
                [buffer],
                {
                    type:
                        contentType ||
                        "image/jpeg"
                }
            );

        return await new Promise(
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
                            "圖片 Base64 轉換失敗"
                        )
                    );

                reader.readAsDataURL(
                    blob
                );
            }
        );
    }

    // =========================================================
    // 使用 GM.xmlHttpRequest 取得圖片
    // =========================================================

    async function getImageData(img) {

        const src =
            img.currentSrc ||
            img.src;

        if (!src) {

            throw new Error(
                "圖片沒有 src"
            );
        }

        updateStatus(
            "取得圖片",
            src.slice(0, 120),
            "processing"
        );

        const response =
            await gmRequest({

                method: "GET",

                url: src,

                responseType:
                    "arraybuffer",

                timeout:
                    30000
            });

        if (
            response.status < 200 ||
            response.status >= 300
        ) {

            throw new Error(
                "漫畫圖片 HTTP " +
                response.status
            );
        }

        let contentType =
            "image/jpeg";

        const headers =
            response.responseHeaders ||
            "";

        const match =
            headers.match(
                /content-type:\s*([^\r\n;]+)/i
            );

        if (match) {
            contentType =
                match[1].trim();
        }

        return await arrayBufferToDataURL(
            response.response,
            contentType
        );
    }

    // =========================================================
    // Worker POST
    // =========================================================

    async function sendToWorker(
        imageData,
        img
    ) {

        updateStatus(
            "送往 Worker",
            "正在送往 Cloudflare Worker...",
            "processing"
        );

        const payload =
            JSON.stringify({

                image_data:
                    imageData,

                image_width:
                    img.naturalWidth,

                image_height:
                    img.naturalHeight
            });

        const response =
            await gmRequest({

                method: "POST",

                url:
                    WORKER_URL,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                data:
                    payload,

                responseType:
                    "text",

                timeout:
                    90000
            });

        if (
            response.status < 200 ||
            response.status >= 300
        ) {

            let message =
                "Worker HTTP " +
                response.status;

            try {

                const errorData =
                    JSON.parse(
                        response.responseText
                    );

                if (errorData.error) {
                    message +=
                        ": " +
                        errorData.error;
                }

            } catch (_) {}

            throw new Error(
                message
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
                "Worker 回傳不是 JSON"
            );
        }

        if (data.error) {

            throw new Error(
                data.error
            );
        }

        return data;
    }

    // =========================================================
    // 清除圖片附近舊翻譯
    // =========================================================

    function removeOldOverlays(img) {

        const rect =
            img.getBoundingClientRect();

        const overlays =
            document.querySelectorAll(
                ".google-manga-translation"
            );

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
            rect.width <= 0 ||
            rect.height <= 0
        ) {
            return;
        }

        let x =
            Number(block.x) || 0;

        let y =
            Number(block.y) || 0;

        let width =
            Number(block.width) || 1;

        let height =
            Number(block.height) || 1;

        // -------------------------
        // 擴大範圍
        // -------------------------

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

        // -------------------------
        // 限制在圖片內
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
            x * scaleX +
            window.scrollX;

        const top =
            rect.top +
            y * scaleY +
            window.scrollY;

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
            "google-manga-translation";

        overlay.textContent =
            block.translation;

        overlay.style.left =
            `${left}px`;

        overlay.style.top =
            `${top}px`;

        overlay.style.width =
            `${cssWidth}px`;

        overlay.style.minHeight =
            `${cssHeight}px`;

        const fontSize =
            Math.max(
                14,
                Math.min(
                    28,
                    cssHeight * 0.40
                )
            );

        overlay.style.fontSize =
            `${fontSize}px`;

        document.body.appendChild(
            overlay
        );
    }

    // =========================================================
    // 處理單張圖片
    // =========================================================

    async function processImage(
        img,
        index,
        total
    ) {

        if (
            processingImages.has(img) ||
            processedImages.has(img)
        ) {
            return false;
        }

        processingImages.add(img);
        processingCount++;

        updateStatus(
            `處理第 ${index + 1} / ${total} 張`,
            "準備開始...",
            "processing"
        );

        try {

            // ----------------------
            // 1. 取得圖片
            // ----------------------

            const imageData =
                await getImageData(
                    img
                );

            // ----------------------
            // 2. Worker
            // ----------------------

            const data =
                await sendToWorker(
                    imageData,
                    img
                );

            // ----------------------
            // 3. Google OCR
            // ----------------------

            updateStatus(
                `處理第 ${index + 1} / ${total} 張`,
                "Google Vision OCR 完成，正在建立翻譯...",
                "processing"
            );

            removeOldOverlays(img);

            const blocks =
                Array.isArray(
                    data.text_blocks
                )
                    ? data.text_blocks
                    : [];

            // ----------------------
            // 4. 顯示翻譯
            // ----------------------

            for (
                const block of blocks
            ) {

                createOverlay(
                    img,
                    block
                );
            }

            processedImages.add(
                img
            );

            completedCount++;

            updateStatus(
                `完成 ${completedCount} / ${total}`,
                blocks.length
                    ? `偵測到 ${blocks.length} 個文字區域`
                    : "這張圖片沒有偵測到英文文字",
                "done"
            );

            return true;

        } catch (error) {

            failedCount++;

            console.error(
                "[Google Manga Translator]",
                error
            );

            updateStatus(
                `第 ${index + 1} 張失敗`,
                error?.message ||
                    String(error),
                "error"
            );

            return false;

        } finally {

            processingImages.delete(
                img
            );

            processingCount--;
        }
    }

    // =========================================================
    // 找圖片
    // =========================================================

    function findMangaImages() {

        const images =
            Array.from(
                document.querySelectorAll(
                    "img"
                )
            );

        const valid = [];

        for (
            const img of images
        ) {

            if (
                processedImages.has(img)
            ) {
                continue;
            }

            if (
                processingImages.has(img)
            ) {
                continue;
            }

            const width =
                img.naturalWidth;

            const height =
                img.naturalHeight;

            if (
                width < MIN_WIDTH ||
                height < MIN_HEIGHT
            ) {
                continue;
            }

            valid.push(img);
        }

        return valid;
    }

    // =========================================================
    // 連續處理
    // =========================================================

    async function processAll() {

        const images =
            findMangaImages();

        if (!images.length) {

            updateStatus(
                "等待圖片",
                "目前沒有新的漫畫圖片"
            );

            return;
        }

        allImages =
            images;

        completedCount = 0;
        failedCount = 0;

        updateStatus(
            "開始翻譯",
            `找到 ${images.length} 張漫畫圖片`,
            "processing"
        );

        // =====================================================
        // 重要：
        // 不使用 Queue
        // 一張完成後才處理下一張
        // =====================================================

        for (
            let i = 0;
            i < images.length;
            i++
        ) {

            await processImage(
                images[i],
                i,
                images.length
            );

            if (
                i <
                images.length - 1
            ) {
                await sleep(
                    DELAY_BETWEEN_IMAGES
                );
            }
        }

        updateStatus(
            "本輪完成",
            `完成 ${completedCount} 張，失敗 ${failedCount} 張`,
            failedCount
                ? "error"
                : "done"
        );
    }

    // =========================================================
    // 掃描
    // =========================================================

    let scanTimer = null;

    function scheduleScan() {

        clearTimeout(
            scanTimer
        );

        scanTimer =
            setTimeout(
                processAll,
                SCAN_DELAY
            );
    }

    // =========================================================
    // 初始啟動
    // =========================================================

    updateStatus(
        "啟動中",
        "正在掃描漫畫圖片..."
    );

    setTimeout(
        processAll,
        1200
    );

    // =========================================================
    // MutationObserver
    // =========================================================

    const observer =
        new MutationObserver(
            () => {

                scheduleScan();
            }
        );

    observer.observe(
        document.body,
        {
            childList: true,
            subtree: true
        }
    );

    // =========================================================
    // 滾動後重新掃描
    // =========================================================

    let scrollTimer = null;

    window.addEventListener(
        "scroll",
        () => {

            clearTimeout(
                scrollTimer
            );

            scrollTimer =
                setTimeout(
                    processAll,
                    800
                );

        },
        {
            passive: true
        }
    );

})();
