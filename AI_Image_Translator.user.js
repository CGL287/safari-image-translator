// ==UserScript==
// @name         AI 圖片自動翻譯
// @namespace    https://github.com/CGL287/safari-image-translator
// @version      6.0.0
// @description  Safari 漫畫圖片自動 OCR 並翻譯成繁體中文
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @connect      safari-image-translator.cgl20050126.workers.dev
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const WORKER_URL =
        'https://safari-image-translator.cgl20050126.workers.dev';

    /*
     * 漫畫設定
     */

    const MIN_WIDTH = 150;
    const MIN_HEIGHT = 80;

    const MAX_CONCURRENT = 1;

    const DELAY = 300;

    const ROOT_MARGIN = 900;

    const MAX_RETRIES = 2;

    /*
     * 翻譯框額外擴張比例
     *
     * 目的：
     * 避免英文從翻譯框邊緣露出。
     */

    const EXPAND_X = 0.10;
    const EXPAND_Y = 0.12;

    const processed = new WeakSet();
    const processing = new WeakSet();

    let active = 0;


    /*
     * ============================================================
     * CSS
     * ============================================================
     */

    const style =
        document.createElement('style');

    style.textContent = `

        .ai-trans-wrapper {
            position: relative !important;
        }

        .ai-trans-layer {
            position: absolute !important;

            left: 0 !important;
            top: 0 !important;

            width: 100% !important;
            height: 100% !important;

            z-index: 2147483646 !important;

            pointer-events: none !important;

            overflow: hidden !important;
        }

        .ai-trans-box {
            position: absolute !important;

            box-sizing: border-box !important;

            display: flex !important;

            align-items: center !important;
            justify-content: center !important;

            padding: 3px 6px !important;

            border-radius: 6px !important;

            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "PingFang TC",
                "Noto Sans TC",
                "Microsoft JhengHei",
                sans-serif !important;

            font-weight: 600 !important;

            line-height: 1.15 !important;

            text-align: center !important;

            white-space: normal !important;

            overflow: hidden !important;

            word-break: break-word !important;

            overflow-wrap: break-word !important;

            pointer-events: none !important;

            text-shadow: none !important;
        }

        .ai-trans-box.light {
            color: #111 !important;
            background: rgba(255,255,255,.94) !important;
        }

        .ai-trans-box.dark {
            color: #fff !important;
            background: rgba(0,0,0,.88) !important;
            text-shadow:
                0 1px 2px rgba(0,0,0,.9) !important;
        }

        .ai-trans-message {
            position: absolute !important;

            left: 50% !important;
            top: 50% !important;

            transform:
                translate(-50%,-50%) !important;

            z-index: 2147483647 !important;

            pointer-events: none !important;

            color: white !important;

            background:
                rgba(0,0,0,.82) !important;

            padding: 8px 12px !important;

            border-radius: 8px !important;

            font:
                14px
                -apple-system,
                BlinkMacSystemFont,
                sans-serif !important;

            max-width: 80% !important;

            text-align: center !important;
        }
    `;

    document.head.appendChild(style);


    /*
     * ============================================================
     * Utility
     * ============================================================
     */

    function sleep(ms) {
        return new Promise(
            resolve => setTimeout(resolve, ms)
        );
    }


    function isValidImage(img) {

        if (
            !(img instanceof HTMLImageElement)
        ) {
            return false;
        }

        const width =
            img.naturalWidth ||
            img.width ||
            0;

        const height =
            img.naturalHeight ||
            img.height ||
            0;

        if (width < MIN_WIDTH) {
            return false;
        }

        if (height < MIN_HEIGHT) {
            return false;
        }

        const src =
            img.currentSrc ||
            img.src;

        return !!src;
    }


    function getWrapper(img) {

        const parent =
            img.parentElement;

        if (!parent) {
            return null;
        }

        if (
            getComputedStyle(parent).position ===
            'static'
        ) {
            parent.style.position =
                'relative';
        }

        parent.classList.add(
            'ai-trans-wrapper'
        );

        return parent;
    }


    function showMessage(img, text) {

        const wrapper =
            getWrapper(img);

        if (!wrapper) {
            return;
        }

        wrapper
            .querySelectorAll(
                '.ai-trans-message'
            )
            .forEach(e => e.remove());

        const message =
            document.createElement('div');

        message.className =
            'ai-trans-message';

        message.textContent =
            text;

        wrapper.appendChild(message);
    }


    function removeMessage(img) {

        const wrapper =
            img.parentElement;

        if (!wrapper) {
            return;
        }

        wrapper
            .querySelectorAll(
                '.ai-trans-message'
            )
            .forEach(e => e.remove());
    }


    /*
     * ============================================================
     * Image → Base64
     * ============================================================
     */

    function arrayBufferToBase64(buffer) {

        const bytes =
            new Uint8Array(buffer);

        let binary = '';

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

            binary += String.fromCharCode(
                ...chunk
            );
        }

        return btoa(binary);
    }


    function downloadImage(url) {

        return new Promise(
            (resolve, reject) => {

                GM_xmlhttpRequest({

                    method: 'GET',

                    url: url,

                    responseType:
                        'arraybuffer',

                    timeout: 30000,

                    onload: response => {

                        if (
                            response.status >= 200 &&
                            response.status < 300
                        ) {

                            resolve(response);

                        } else {

                            reject(
                                new Error(
                                    '圖片下載 HTTP ' +
                                    response.status
                                )
                            );
                        }
                    },

                    onerror: () => {

                        reject(
                            new Error(
                                '圖片下載失敗'
                            )
                        );
                    },

                    ontimeout: () => {

                        reject(
                            new Error(
                                '圖片下載逾時'
                            )
                        );
                    }
                });
            }
        );
    }


    async function getImageData(img) {

        const src =
            img.currentSrc ||
            img.src;

        if (!src) {
            throw new Error(
                '找不到圖片來源'
            );
        }

        if (
            src.startsWith(
                'data:image/'
            )
        ) {
            return src;
        }

        const response =
            await downloadImage(src);

        const headers =
            response.responseHeaders ||
            '';

        const match =
            headers.match(
                /content-type:\s*([^\r\n]+)/i
            );

        const contentType =
            match
                ? match[1].trim()
                : 'image/jpeg';

        const encoded =
            arrayBufferToBase64(
                response.response
            );

        return (
            `data:${contentType};base64,${encoded}`
        );
    }


    /*
     * ============================================================
     * Worker request
     * ============================================================
     */

    function requestTranslation(image) {

        return new Promise(
            (resolve, reject) => {

                GM_xmlhttpRequest({

                    method: 'POST',

                    url: WORKER_URL,

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    data: JSON.stringify({
                        image: image
                    }),

                    timeout: 90000,

                    onload: response => {

                        if (
                            response.status < 200 ||
                            response.status >= 300
                        ) {

                            reject(
                                new Error(
                                    'Worker HTTP ' +
                                    response.status +
                                    ': ' +
                                    response.responseText
                                        .slice(0,500)
                                )
                            );

                            return;
                        }

                        try {

                            resolve(
                                JSON.parse(
                                    response.responseText
                                )
                            );

                        } catch {

                            reject(
                                new Error(
                                    'Worker 回傳的資料不是有效 JSON'
                                )
                            );
                        }
                    },

                    onerror: () => {

                        reject(
                            new Error(
                                '無法連線到 Cloudflare Worker'
                            )
                        );
                    },

                    ontimeout: () => {

                        reject(
                            new Error(
                                '翻譯請求逾時'
                            )
                        );
                    }
                });
            }
        );
    }


    /*
     * ============================================================
     * Validate result
     * ============================================================
     */

    function hasUsefulResult(result) {

        if (!result) {
            return false;
        }

        if (
            !Array.isArray(
                result.text_blocks
            )
        ) {
            return false;
        }

        return result.text_blocks.some(
            block =>
                block &&
                typeof block.translation ===
                    'string' &&
                block.translation.trim() !== '' &&
                Number(block.width) > 0 &&
                Number(block.height) > 0
        );
    }


    /*
     * ============================================================
     * Render
     * ============================================================
     */

    function render(img, result) {

        const wrapper =
            getWrapper(img);

        if (!wrapper) {
            return;
        }

        wrapper
            .querySelectorAll(
                '.ai-trans-layer'
            )
            .forEach(e => e.remove());


        const layer =
            document.createElement('div');

        layer.className =
            'ai-trans-layer';

        wrapper.appendChild(layer);


        const rect =
            img.getBoundingClientRect();

        const displayWidth =
            img.clientWidth ||
            rect.width;

        const displayHeight =
            img.clientHeight ||
            rect.height;


        const imageWidth =
            Number(
                result.image_width
            );

        const imageHeight =
            Number(
                result.image_height
            );


        if (
            !imageWidth ||
            !imageHeight ||
            !displayWidth ||
            !displayHeight
        ) {

            throw new Error(
                '沒有取得有效圖片尺寸'
            );
        }


        const scaleX =
            displayWidth /
            imageWidth;

        const scaleY =
            displayHeight /
            imageHeight;


        const blocks =
            Array.isArray(
                result.text_blocks
            )
                ? result.text_blocks
                : [];


        for (
            const block of blocks
        ) {

            if (
                !block ||
                !block.translation
            ) {
                continue;
            }


            let x =
                Number(block.x);

            let y =
                Number(block.y);

            let width =
                Number(block.width);

            let height =
                Number(block.height);


            if (
                !Number.isFinite(x) ||
                !Number.isFinite(y) ||
                !Number.isFinite(width) ||
                !Number.isFinite(height)
            ) {
                continue;
            }


            if (
                width <= 0 ||
                height <= 0
            ) {
                continue;
            }


            /*
             * ----------------------------------------------------
             * Expand bounding box
             * ----------------------------------------------------
             */

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


            /*
             * ----------------------------------------------------
             * Convert to display coordinates
             * ----------------------------------------------------
             */

            let displayX =
                x * scaleX;

            let displayY =
                y * scaleY;

            let displayWidthBlock =
                width * scaleX;

            let displayHeightBlock =
                height * scaleY;


            /*
             * ----------------------------------------------------
             * Clamp
             * ----------------------------------------------------
             */

            displayX =
                Math.max(
                    0,
                    Math.min(
                        displayWidth,
                        displayX
                    )
                );

            displayY =
                Math.max(
                    0,
                    Math.min(
                        displayHeight,
                        displayY
                    )
                );


            displayWidthBlock =
                Math.min(
                    displayWidth -
                    displayX,

                    displayWidthBlock
                );


            displayHeightBlock =
                Math.min(
                    displayHeight -
                    displayY,

                    displayHeightBlock
                );


            if (
                displayWidthBlock <= 2 ||
                displayHeightBlock <= 2
            ) {
                continue;
            }


            /*
             * ----------------------------------------------------
             * Create translation box
             * ----------------------------------------------------
             */

            const box =
                document.createElement('div');

            box.className =
                'ai-trans-box';


            const background =
                block.background ===
                'dark'
                    ? 'dark'
                    : 'light';


            box.classList.add(
                background
            );


            box.style.left =
                displayX + 'px';

            box.style.top =
                displayY + 'px';

            box.style.width =
                displayWidthBlock + 'px';

            box.style.height =
                displayHeightBlock + 'px';


            /*
             * ----------------------------------------------------
             * Font size
             * ----------------------------------------------------
             */

            const fontSize =
                Math.max(
                    12,
                    Math.min(
                        34,
                        displayHeightBlock *
                        0.68
                    )
                );


            box.style.fontSize =
                fontSize + 'px';


            box.textContent =
                block.translation;


            layer.appendChild(box);
        }
    }


    /*
     * ============================================================
     * Process image
     * ============================================================
     */

    async function processImage(img) {

        if (
            processed.has(img) ||
            processing.has(img) ||
            !isValidImage(img)
        ) {
            return;
        }


        processing.add(img);


        while (
            active >= MAX_CONCURRENT
        ) {

            await sleep(200);
        }


        active++;


        try {

            let lastError =
                null;


            for (
                let attempt = 0;
                attempt <= MAX_RETRIES;
                attempt++
            ) {

                try {

                    showMessage(
                        img,

                        attempt === 0
                            ? '正在 OCR＋翻譯…'
                            : `正在重新辨識… ${attempt + 1}/${MAX_RETRIES + 1}`
                    );


                    const image =
                        await getImageData(
                            img
                        );


                    const result =
                        await requestTranslation(
                            image
                        );


                    if (
                        hasUsefulResult(
                            result
                        )
                    ) {

                        removeMessage(img);

                        render(
                            img,
                            result
                        );

                        processed.add(img);


                        console.log(
                            '[AI Image Translator V6]',
                            '翻譯完成：',
                            result.text_blocks.length,
                            '個文字區域'
                        );


                        return;
                    }


                    lastError =
                        new Error(
                            'OCR 沒有取得有效文字'
                        );


                    if (
                        attempt <
                        MAX_RETRIES
                    ) {

                        await sleep(1200);
                    }


                } catch (error) {

                    lastError =
                        error;

                    console.warn(
                        '[AI Image Translator V6]',
                        error
                    );


                    if (
                        attempt <
                        MAX_RETRIES
                    ) {

                        await sleep(1500);
                    }
                }
            }


            showMessage(
                img,
                '翻譯失敗：' +
                (
                    lastError?.message ||
                    '未知錯誤'
                )
            );


        } finally {

            processing.delete(img);

            active--;
        }
    }


    /*
     * ============================================================
     * Schedule
     * ============================================================
     */

    function schedule(img) {

        if (
            processed.has(img) ||
            processing.has(img) ||
            !isValidImage(img)
        ) {
            return;
        }


        setTimeout(
            () => {

                if (
                    processed.has(img) ||
                    processing.has(img)
                ) {
                    return;
                }


                const rect =
                    img.getBoundingClientRect();


                const visible =
                    rect.bottom >
                        -ROOT_MARGIN &&
                    rect.top <
                        window.innerHeight +
                        ROOT_MARGIN;


                if (visible) {

                    processImage(img);
                }

            },

            DELAY
        );
    }


    /*
     * ============================================================
     * IntersectionObserver
     * ============================================================
     */

    const imageObserver =
        new IntersectionObserver(

            entries => {

                for (
                    const entry of entries
                ) {

                    if (
                        entry.isIntersecting
                    ) {

                        schedule(
                            entry.target
                        );
                    }
                }

            },

            {
                rootMargin:
                    `${ROOT_MARGIN}px 0px ${ROOT_MARGIN}px 0px`,

                threshold:
                    0.01
            }
        );


    /*
     * ============================================================
     * Scan images
     * ============================================================
     */

    function scanImages() {

        document
            .querySelectorAll('img')
            .forEach(img => {

                if (
                    !processed.has(img) &&
                    !processing.has(img) &&
                    isValidImage(img)
                ) {

                    imageObserver.observe(
                        img
                    );
                }
            });
    }


    /*
     * ============================================================
     * Mutation observer
     * ============================================================
     */

    const mutationObserver =
        new MutationObserver(
            () => {
                scanImages();
            }
        );


    /*
     * ============================================================
     * Image load observer
     * ============================================================
     */

    document.addEventListener(
        'load',

        event => {

            if (
                event.target instanceof
                HTMLImageElement
            ) {

                const img =
                    event.target;

                if (
                    isValidImage(img)
                ) {

                    imageObserver.observe(
                        img
                    );

                    schedule(img);
                }
            }

        },

        true
    );


    /*
     * ============================================================
     * Init
     * ============================================================
     */

    function init() {

        scanImages();


        if (document.body) {

            mutationObserver.observe(
                document.body,

                {
                    childList: true,
                    subtree: true
                }
            );
        }


        console.log(
            '[AI Image Translator V6] 已啟動'
        );
    }


    if (
        document.readyState ===
        'loading'
    ) {

        document.addEventListener(
            'DOMContentLoaded',
            init
        );

    } else {

        init();
    }

})();
