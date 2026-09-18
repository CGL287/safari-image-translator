// ==UserScript==
// @name         AI 圖片自動翻譯
// @namespace    https://github.com/CGL287/safari-image-translator
// @version      4.0.0
// @description  Safari 自動 OCR 圖片並翻譯成繁體中文
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @connect      YOUR-WORKER.workers.dev
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    /*
     * ============================================================
     * Cloudflare Worker 網址
     * ============================================================
     *
     * 等我們建立 Worker 後，把下面網址改成你的 Worker 網址。
     *
     * 例如：
     *
     * https://safari-image-translator.你的帳號.workers.dev
     *
     */

    const WORKER_URL =
        'https://YOUR-WORKER.workers.dev';


    /*
     * ============================================================
     * 基本設定
     * ============================================================
     */

    const MIN_WIDTH = 180;
    const MIN_HEIGHT = 100;

    const MAX_CONCURRENT = 2;

    const DELAY = 700;

    const COVER_OPACITY = 0.90;


    /*
     * ============================================================
     * 狀態
     * ============================================================
     */

    const processed =
        new WeakSet();

    const processing =
        new WeakSet();

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

            padding: 2px 4px !important;

            color: white !important;

            background:
                rgba(
                    0,
                    0,
                    0,
                    ${COVER_OPACITY}
                ) !important;

            border-radius: 3px !important;

            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "PingFang TC",
                "Noto Sans TC",
                "Microsoft JhengHei",
                sans-serif !important;

            font-weight: 500 !important;

            line-height: 1.15 !important;

            text-align: center !important;

            white-space: normal !important;

            overflow: hidden !important;

            word-break: break-word !important;

            text-shadow:
                0 1px 2px rgba(0,0,0,.9) !important;

            pointer-events: none !important;
        }

        .ai-trans-message {

            position: absolute !important;

            left: 50% !important;
            top: 50% !important;

            transform:
                translate(-50%, -50%) !important;

            z-index: 2147483647 !important;

            pointer-events: none !important;

            color: white !important;

            background:
                rgba(0,0,0,.80) !important;

            padding:
                8px 12px !important;

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
     * 工具
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
            img.width;

        const height =
            img.naturalHeight ||
            img.height;

        if (
            width < MIN_WIDTH ||
            height < MIN_HEIGHT
        ) {
            return false;
        }

        return !!(
            img.currentSrc ||
            img.src
        );

    }


    function getWrapper(img) {

        const parent =
            img.parentElement;

        if (!parent) {
            return null;
        }

        if (
            getComputedStyle(parent)
                .position === 'static'
        ) {

            parent.style.position =
                'relative';

        }

        parent.classList.add(
            'ai-trans-wrapper'
        );

        return parent;

    }


    function showMessage(
        img,
        text
    ) {

        const wrapper =
            getWrapper(img);

        if (!wrapper) {
            return;
        }

        wrapper
            .querySelectorAll(
                '.ai-trans-message'
            )
            .forEach(
                e => e.remove()
            );

        const message =
            document.createElement('div');

        message.className =
            'ai-trans-message';

        message.textContent =
            text;

        wrapper.appendChild(
            message
        );

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
            .forEach(
                e => e.remove()
            );

    }


    /*
     * ============================================================
     * 將圖片轉成 Base64
     * ============================================================
     */

    function arrayBufferToBase64(
        buffer
    ) {

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

            binary +=
                String.fromCharCode(
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

                    timeout:
                        30000,

                    onload:
                        response => {

                            if (
                                response.status >= 200 &&
                                response.status < 300
                            ) {

                                resolve(
                                    response
                                );

                            }
                            else {

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

        try {

            const response =
                await downloadImage(
                    src
                );

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
                'data:' +
                contentType +
                ';base64,' +
                encoded
            );

        }
        catch (error) {

            /*
             * 如果網站阻擋圖片下載，
             * 讓 Worker 嘗試使用原始 URL。
             */

            return src;

        }

    }


    /*
     * ============================================================
     * 傳給 Cloudflare Worker
     * ============================================================
     */

    function requestTranslation(
        image
    ) {

        return new Promise(
            (resolve, reject) => {

                GM_xmlhttpRequest({

                    method: 'POST',

                    url:
                        WORKER_URL,

                    headers: {

                        'Content-Type':
                            'application/json'

                    },

                    data:
                        JSON.stringify({

                            image: image

                        }),

                    timeout:
                        60000,

                    onload:
                        response => {

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
                                            .slice(0, 300)
                                    )
                                );

                                return;

                            }

                            try {

                                const result =
                                    JSON.parse(
                                        response.responseText
                                    );

                                resolve(
                                    result
                                );

                            }
                            catch {

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
     * 顯示翻譯
     * ============================================================
     */

    function render(
        img,
        result
    ) {

        const wrapper =
            getWrapper(img);

        if (!wrapper) {
            return;
        }

        wrapper
            .querySelectorAll(
                '.ai-trans-layer'
            )
            .forEach(
                e => e.remove()
            );

        const layer =
            document.createElement('div');

        layer.className =
            'ai-trans-layer';

        wrapper.appendChild(
            layer
        );


        const displayWidth =
            img.clientWidth ||
            img.getBoundingClientRect()
                .width;

        const displayHeight =
            img.clientHeight ||
            img.getBoundingClientRect()
                .height;


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
            !imageHeight
        ) {

            throw new Error(
                '沒有取得圖片尺寸'
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
            const block
            of blocks
        ) {

            if (
                !block.translation ||
                block.width <= 0 ||
                block.height <= 0
            ) {

                continue;

            }


            const x =
                Math.max(
                    0,
                    Math.min(
                        displayWidth,
                        block.x * scaleX
                    )
                );


            const y =
                Math.max(
                    0,
                    Math.min(
                        displayHeight,
                        block.y * scaleY
                    )
                );


            const width =
                Math.max(
                    1,
                    Math.min(
                        displayWidth - x,
                        block.width * scaleX
                    )
                );


            const height =
                Math.max(
                    1,
                    Math.min(
                        displayHeight - y,
                        block.height * scaleY
                    )
                );


            const box =
                document.createElement('div');

            box.className =
                'ai-trans-box';


            box.style.left =
                x + 'px';

            box.style.top =
                y + 'px';

            box.style.width =
                width + 'px';

            box.style.height =
                height + 'px';


            const fontSize =
                Math.max(
                    12,
                    Math.min(
                        30,
                        height * 0.72
                    )
                );


            box.style.fontSize =
                fontSize + 'px';


            box.textContent =
                block.translation;


            layer.appendChild(
                box
            );

        }

    }


    /*
     * ============================================================
     * 處理單張圖片
     * ============================================================
     */

    async function processImage(img) {

        if (
            processed.has(img) ||
            processing.has(img)
        ) {

            return;

        }


        if (!isValidImage(img)) {
            return;
        }


        processing.add(img);


        while (
            active >= MAX_CONCURRENT
        ) {

            await sleep(300);

        }


        active++;


        try {

            showMessage(
                img,
                '正在 OCR＋翻譯…'
            );


            const image =
                await getImageData(
                    img
                );


            const result =
                await requestTranslation(
                    image
                );


            removeMessage(img);


            if (
                result &&
                Array.isArray(
                    result.text_blocks
                ) &&
                result.text_blocks.length
            ) {

                render(
                    img,
                    result
                );

            }


            processed.add(img);

        }
        catch (error) {

            console.error(
                '[AI Image Translator]',
                error
            );

            showMessage(
                img,
                '翻譯失敗：' +
                (
                    error.message ||
                    '未知錯誤'
                )
            );

        }
        finally {

            processing.delete(img);

            active--;

        }

    }


    /*
     * ============================================================
     * IntersectionObserver
     * ============================================================
     */

    function schedule(img) {

        if (
            processed.has(img) ||
            processing.has(img)
        ) {

            return;

        }


        if (!isValidImage(img)) {
            return;
        }


        setTimeout(
            () => {

                const rect =
                    img.getBoundingClientRect();


                const visible =
                    rect.bottom > -400 &&
                    rect.top <
                    window.innerHeight + 400;


                if (visible) {

                    processImage(
                        img
                    );

                }

            },
            DELAY
        );

    }


    const imageObserver =
        new IntersectionObserver(

            entries => {

                for (
                    const entry
                    of entries
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
                    '400px 0px 400px 0px',

                threshold:
                    0.01

            }

        );


    /*
     * ============================================================
     * 掃描網頁圖片
     * ============================================================
     */

    function scanImages() {

        document
            .querySelectorAll('img')
            .forEach(
                img => {

                    if (
                        !processed.has(img) &&
                        !processing.has(img)
                    ) {

                        imageObserver.observe(
                            img
                        );

                    }

                }
            );

    }


    /*
     * ============================================================
     * 動態網頁監控
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
     * 初始化
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
            '[AI Image Translator V4] 已啟動'
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

    }
    else {

        init();

    }

})();
