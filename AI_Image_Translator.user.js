// ==UserScript==
// @name         AI 圖片自動翻譯
// @namespace    https://github.com/CGL287/safari-image-translator
// @version      5.0.0
// @description  Safari 漫畫圖片自動 OCR 並翻譯成繁體中文
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @connect      safari-image-translator.cgl20050126.workers.dev
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    /*
     * ============================================================
     * Cloudflare Worker
     * ============================================================
     */

    const WORKER_URL =
        'https://safari-image-translator.cgl20050126.workers.dev';


    /*
     * ============================================================
     * 漫畫模式設定
     * ============================================================
     */

    // 最小圖片尺寸
    const MIN_WIDTH = 150;
    const MIN_HEIGHT = 80;

    // 一次只處理一張圖片
    const MAX_CONCURRENT = 1;

    // 圖片進入可視範圍後等待時間
    const DELAY = 300;

    // 上下預先處理距離
    const ROOT_MARGIN = 800;

    // API 失敗時最多重試次數
    const MAX_RETRIES = 2;

    // 翻譯框黑色背景透明度
    const COVER_OPACITY = 0.90;


    /*
     * ============================================================
     * 狀態管理
     * ============================================================
     */

    const processed = new WeakSet();
    const processing = new WeakSet();

    let active = 0;


    /*
     * ============================================================
     * CSS
     * ============================================================
     */

    const style = document.createElement('style');

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

            background: rgba(
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

            overflow-wrap: break-word !important;

            text-shadow:
                0 1px 2px rgba(0, 0, 0, .9) !important;

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
                rgba(0, 0, 0, .82) !important;

            padding: 8px 12px !important;

            border-radius: 8px !important;

            font:
                14px
                -apple-system,
                BlinkMacSystemFont,
                sans-serif !important;

            max-width: 80% !important;

            text-align: center !important;

            white-space: nowrap !important;
        }
    `;

    document.head.appendChild(style);


    /*
     * ============================================================
     * 工具
     * ============================================================
     */

    function sleep(ms) {
        return new Promise(resolve => {
            setTimeout(resolve, ms);
        });
    }


    function isValidImage(img) {

        if (!(img instanceof HTMLImageElement)) {
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

        if (!src) {
            return false;
        }

        return true;
    }


    function getWrapper(img) {

        const parent =
            img.parentElement;

        if (!parent) {
            return null;
        }

        const position =
            getComputedStyle(parent).position;

        if (position === 'static') {
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
            .forEach(element => {
                element.remove();
            });

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
            .forEach(element => {
                element.remove();
            });
    }


    /*
     * ============================================================
     * ArrayBuffer → Base64
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


    /*
     * ============================================================
     * 下載圖片
     * ============================================================
     */

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


    /*
     * ============================================================
     * 取得圖片 Data URL
     * ============================================================
     */

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

        } catch (error) {

            console.warn(
                '[AI Image Translator] 圖片下載失敗',
                error
            );

            /*
             * 如果下載失敗，直接回傳原始 URL。
             * Worker 目前主要接受 data:image，
             * 所以這種情況仍可能失敗。
             */

            return src;
        }
    }


    /*
     * ============================================================
     * Worker API
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
                                        .slice(0, 500)
                                )
                            );

                            return;
                        }

                        try {

                            const result =
                                JSON.parse(
                                    response.responseText
                                );

                            resolve(result);

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
     * 判斷 OCR 是否有效
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

        if (
            !result.text_blocks.length
        ) {
            return false;
        }

        let useful = 0;

        for (
            const block of result.text_blocks
        ) {

            if (
                block &&
                typeof block.translation ===
                    'string' &&
                block.translation.trim() !== '' &&
                Number(block.width) > 0 &&
                Number(block.height) > 0
            ) {

                useful++;
            }
        }

        return useful > 0;
    }


    /*
     * ============================================================
     * 渲染翻譯
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
            .forEach(element => {
                element.remove();
            });

        const layer =
            document.createElement('div');

        layer.className =
            'ai-trans-layer';

        wrapper.appendChild(layer);


        /*
         * 使用圖片實際顯示尺寸
         */

        const rect =
            img.getBoundingClientRect();

        const displayWidth =
            img.clientWidth ||
            rect.width ||
            0;

        const displayHeight =
            img.clientHeight ||
            rect.height ||
            0;


        const imageWidth =
            Number(result.image_width);

        const imageHeight =
            Number(result.image_height);


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


            const bx =
                Number(block.x);

            const by =
                Number(block.y);

            const bw =
                Number(block.width);

            const bh =
                Number(block.height);


            if (
                !Number.isFinite(bx) ||
                !Number.isFinite(by) ||
                !Number.isFinite(bw) ||
                !Number.isFinite(bh)
            ) {
                continue;
            }


            if (
                bw <= 0 ||
                bh <= 0
            ) {
                continue;
            }


            const x =
                Math.max(
                    0,
                    Math.min(
                        displayWidth,
                        bx * scaleX
                    )
                );


            const y =
                Math.max(
                    0,
                    Math.min(
                        displayHeight,
                        by * scaleY
                    )
                );


            const width =
                Math.max(
                    1,
                    Math.min(
                        displayWidth - x,
                        bw * scaleX
                    )
                );


            const height =
                Math.max(
                    1,
                    Math.min(
                        displayHeight - y,
                        bh * scaleY
                    )
                );


            if (
                width < 2 ||
                height < 2
            ) {
                continue;
            }


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


            /*
             * 根據文字區域高度自動調整字體
             */

            const fontSize =
                Math.max(
                    11,
                    Math.min(
                        32,
                        height * 0.70
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
     * 單張圖片處理
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


        /*
         * 等待前一張圖片完成
         */

        while (
            active >= MAX_CONCURRENT
        ) {

            await sleep(200);
        }


        active++;


        try {

            let lastError =
                null;


            /*
             * 最多嘗試 MAX_RETRIES + 1 次
             */

            for (
                let attempt = 0;
                attempt <= MAX_RETRIES;
                attempt++
            ) {

                try {

                    if (
                        attempt === 0
                    ) {

                        showMessage(
                            img,
                            '正在 OCR＋翻譯…'
                        );

                    } else {

                        showMessage(
                            img,
                            `OCR 第 ${attempt + 1} 次嘗試…`
                        );
                    }


                    /*
                     * 取得圖片
                     */

                    const image =
                        await getImageData(img);


                    /*
                     * 呼叫 Worker
                     */

                    const result =
                        await requestTranslation(
                            image
                        );


                    /*
                     * 判斷結果
                     */

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
                            '[AI Image Translator] 翻譯完成：',
                            result.text_blocks.length,
                            '個文字區域'
                        );

                        return;
                    }


                    /*
                     * OCR 沒抓到有效文字
                     */

                    lastError =
                        new Error(
                            'OCR 沒有取得有效文字區域'
                        );


                    if (
                        attempt <
                        MAX_RETRIES
                    ) {

                        await sleep(
                            1200
                        );
                    }


                } catch (error) {

                    lastError =
                        error;

                    console.warn(
                        '[AI Image Translator] 第 ' +
                        (attempt + 1) +
                        ' 次失敗：',
                        error
                    );


                    if (
                        attempt <
                        MAX_RETRIES
                    ) {

                        await sleep(
                            1500
                        );
                    }
                }
            }


            /*
             * 所有嘗試都失敗
             */

            showMessage(
                img,
                '翻譯失敗：' +
                (
                    lastError?.message ||
                    '未知錯誤'
                )
            );


            /*
             * 不加入 processed。
             *
             * 這樣之後重新進入可視範圍時，
             * 還可以再次嘗試。
             */


        } finally {

            processing.delete(img);

            active--;
        }
    }


    /*
     * ============================================================
     * 排程
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
     * 掃描所有圖片
     * ============================================================
     */

    function scanImages() {

        const images =
            document.querySelectorAll(
                'img'
            );


        for (
            const img of images
        ) {

            if (
                !processed.has(img) &&
                !processing.has(img) &&
                isValidImage(img)
            ) {

                imageObserver.observe(
                    img
                );
            }
        }
    }


    /*
     * ============================================================
     * 監控動態載入的漫畫圖片
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
     * 監控圖片載入
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
            '[AI Image Translator V5] 已啟動'
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
