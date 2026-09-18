// ==UserScript==
// @name         AI 圖片自動翻譯 V9.1.1 - OpenAI OCR + Google Translation
// @namespace    safari-image-translator
// @version      9.1.1
// @description  自動偵測漫畫圖片，使用 OpenAI Vision OCR + Google Translation 翻譯成繁體中文
// @match        *://*/*
// @run-at       document-end
// @inject-into  content
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @connect      safari-image-translator.cgl20050126.workers.dev
// @connect      *
// ==/UserScript==

(function () {
    "use strict";

    /*
     * =========================================================
     * Cloudflare Worker
     * =========================================================
     */

    const WORKER_URL =
        "https://safari-image-translator.cgl20050126.workers.dev";


    /*
     * =========================================================
     * OCR 設定
     * =========================================================
     */

    const TILE_HEIGHT = 900;

    const TILE_OVERLAP = 180;

    const OCR_SCALE = 2;


    /*
     * =========================================================
     * 圖片過濾
     * =========================================================
     */

    const MIN_IMAGE_WIDTH = 250;

    const MIN_IMAGE_HEIGHT = 150;


    /*
     * =========================================================
     * Worker timeout
     * =========================================================
     */

    const WORKER_TIMEOUT = 180000;


    /*
     * =========================================================
     * 狀態
     * =========================================================
     */

    let imageList = [];

    let processedCount = 0;

    let completedCount = 0;

    let failedCount = 0;

    let totalTiles = 0;

    let totalOCRBlocks = 0;

    let isRunning = false;

    let started = false;


    /*
     * =========================================================
     * Status Panel
     * =========================================================
     */

    const statusPanel =
        document.createElement("div");

    statusPanel.id =
        "gm-manga-translator-status-v911";


    Object.assign(
        statusPanel.style,
        {
            position: "fixed",

            left: "12px",

            top: "12px",

            zIndex: "2147483647",

            background:
                "rgba(0,0,0,0.90)",

            color: "#ffffff",

            padding: "10px 14px",

            borderRadius: "8px",

            fontFamily:
                "Arial, sans-serif",

            fontSize: "13px",

            lineHeight: "1.6",

            boxShadow:
                "0 3px 14px rgba(0,0,0,0.45)",

            pointerEvents:
                "none",

            minWidth: "210px",

            display: "block"
        }
    );


    statusPanel.textContent =
        "V9.1.1 啟動中...";


    /*
     * documentElement 一定存在，
     * 比 document.body 更安全。
     */

    if (
        document.documentElement
    ) {
        document.documentElement.appendChild(
            statusPanel
        );
    }


    /*
     * =========================================================
     * 更新狀態
     * =========================================================
     */

    function updateStatus(
        stage = ""
    ) {

        statusPanel.innerHTML = `
            <div>
                <b>
                    OpenAI OCR + Google Translation V9.1.1
                </b>
            </div>

            <div>
                圖片：
                ${imageList.length}
            </div>

            <div>
                處理：
                ${processedCount}
            </div>

            <div>
                完成：
                ${completedCount}
            </div>

            <div>
                失敗：
                ${failedCount}
            </div>

            <div>
                OCR切片：
                ${totalTiles}
            </div>

            <div>
                OCR區塊：
                ${totalOCRBlocks}
            </div>

            <div>
                ${stage}
            </div>
        `;
    }


    /*
     * =========================================================
     * Console 啟動訊息
     * =========================================================
     */

    console.log(
        "[GMW V9.1.1] Userscript injected"
    );


    /*
     * =========================================================
     * Sleep
     * =========================================================
     */

    function sleep(ms) {

        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    ms
                )
        );
    }


    /*
     * =========================================================
     * Clamp
     * =========================================================
     */

    function clamp(
        value,
        min,
        max
    ) {

        return Math.max(
            min,
            Math.min(
                max,
                value
            )
        );
    }


    /*
     * =========================================================
     * GM.xmlHttpRequest
     * =========================================================
     */

    function gmRequest(
        options
    ) {

        return new Promise(
            (resolve, reject) => {

                let requestFunction = null;


                /*
                 * 優先使用 Userscripts 官方新版 API
                 */

                if (
                    typeof GM !== "undefined" &&
                    typeof GM.xmlHttpRequest ===
                        "function"
                ) {

                    requestFunction =
                        GM.xmlHttpRequest;

                }


                /*
                 * 舊版 API fallback
                 */

                else if (
                    typeof GM_xmlhttpRequest ===
                    "function"
                ) {

                    requestFunction =
                        GM_xmlhttpRequest;

                }


                /*
                 * API 不存在
                 */

                if (
                    !requestFunction
                ) {

                    reject(
                        new Error(
                            "GM.xmlHttpRequest 不存在"
                        )
                    );

                    return;
                }


                let settled =
                    false;


                function success(
                    response
                ) {

                    if (
                        settled
                    ) {
                        return;
                    }

                    settled = true;

                    resolve(
                        response
                    );
                }


                function failure(
                    error
                ) {

                    if (
                        settled
                    ) {
                        return;
                    }

                    settled = true;

                    reject(
                        error
                    );
                }


                try {

                    requestFunction({

                        ...options,

                        onload:
                            success,

                        onerror:
                            failure,

                        ontimeout:
                            failure,

                        onabort:
                            failure
                    });

                } catch (
                    error
                ) {

                    failure(
                        error
                    );
                }
            }
        );
    }


    /*
     * =========================================================
     * 下載圖片
     * =========================================================
     */

    async function downloadImage(
        src
    ) {

        console.log(
            "[GMW V9.1.1] Download:",
            src
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
                    60000
            });


        if (
            !response
        ) {

            throw new Error(
                "圖片下載沒有回應"
            );
        }


        if (
            response.status < 200 ||
            response.status >= 400
        ) {

            throw new Error(
                `圖片下載失敗 HTTP ${response.status}`
            );
        }


        if (
            !response.response
        ) {

            throw new Error(
                "圖片沒有收到資料"
            );
        }


        /*
         * 嘗試從 responseHeaders
         * 取得 Content-Type
         */

        let mime =
            "image/jpeg";


        if (
            typeof response.responseHeaders ===
            "string"
        ) {

            const match =
                response.responseHeaders.match(
                    /content-type:\s*([^\r\n]+)/i
                );


            if (
                match &&
                match[1]
            ) {

                mime =
                    match[1].trim();
            }
        }


        return new Blob(
            [
                response.response
            ],
            {
                type:
                    mime
            }
        );
    }


    /*
     * =========================================================
     * Blob -> Image
     * =========================================================
     */

    function loadImage(
        blob
    ) {

        return new Promise(
            (resolve, reject) => {

                const objectURL =
                    URL.createObjectURL(
                        blob
                    );


                const img =
                    new Image();


                img.onload =
                    function () {

                        URL.revokeObjectURL(
                            objectURL
                        );

                        resolve(
                            img
                        );
                    };


                img.onerror =
                    function () {

                        URL.revokeObjectURL(
                            objectURL
                        );

                        reject(
                            new Error(
                                "圖片解碼失敗"
                            )
                        );
                    };


                img.src =
                    objectURL;
            }
        );
    }


    /*
     * =========================================================
     * Canvas -> Base64
     * =========================================================
     */

    function canvasToBase64(
        canvas
    ) {

        const dataURL =
            canvas.toDataURL(
                "image/jpeg",
                0.92
            );


        return dataURL.replace(
            /^data:image\/jpeg;base64,/,
            ""
        );
    }


    /*
     * =========================================================
     * 建立 OCR Tiles
     * =========================================================
     */

    function createOCRTiles(
        img
    ) {

        const originalWidth =
            img.naturalWidth;

        const originalHeight =
            img.naturalHeight;


        const tiles = [];


        /*
         * =====================================================
         * 短圖片
         * =====================================================
         */

        if (
            originalHeight <=
            TILE_HEIGHT
        ) {

            const canvas =
                document.createElement(
                    "canvas"
                );


            canvas.width =
                Math.round(
                    originalWidth *
                    OCR_SCALE
                );


            canvas.height =
                Math.round(
                    originalHeight *
                    OCR_SCALE
                );


            const ctx =
                canvas.getContext(
                    "2d"
                );


            ctx.imageSmoothingEnabled =
                true;


            ctx.imageSmoothingQuality =
                "high";


            ctx.drawImage(
                img,

                0,
                0,

                canvas.width,
                canvas.height
            );


            tiles.push({

                image:
                    canvasToBase64(
                        canvas
                    ),

                offsetX:
                    0,

                offsetY:
                    0,

                scale:
                    OCR_SCALE,

                pixelWidth:
                    canvas.width,

                pixelHeight:
                    canvas.height
            });


            return tiles;
        }


        /*
         * =====================================================
         * 長圖片切片
         * =====================================================
         */

        let y =
            0;


        while (
            y <
            originalHeight
        ) {

            const remaining =
                originalHeight -
                y;


            const tileOriginalHeight =
                Math.min(
                    TILE_HEIGHT,
                    remaining
                );


            const canvas =
                document.createElement(
                    "canvas"
                );


            canvas.width =
                Math.round(
                    originalWidth *
                    OCR_SCALE
                );


            canvas.height =
                Math.round(
                    tileOriginalHeight *
                    OCR_SCALE
                );


            const ctx =
                canvas.getContext(
                    "2d"
                );


            ctx.imageSmoothingEnabled =
                true;


            ctx.imageSmoothingQuality =
                "high";


            ctx.drawImage(

                img,

                0,
                y,

                originalWidth,
                tileOriginalHeight,

                0,
                0,

                canvas.width,
                canvas.height
            );


            tiles.push({

                image:
                    canvasToBase64(
                        canvas
                    ),

                offsetX:
                    0,

                offsetY:
                    y,

                scale:
                    OCR_SCALE,

                pixelWidth:
                    canvas.width,

                pixelHeight:
                    canvas.height
            });


            /*
             * 最後一片
             */

            if (
                y +
                tileOriginalHeight >=
                originalHeight
            ) {

                break;
            }


            /*
             * 保留 overlap
             */

            y +=
                TILE_HEIGHT -
                TILE_OVERLAP;
        }


        return tiles;
    }


    /*
     * =========================================================
     * 傳送 Worker
     * =========================================================
     */

    async function sendToWorker(
        tiles,
        imageWidth,
        imageHeight
    ) {

        return new Promise(
            (resolve, reject) => {

                let finished =
                    false;


                const timeout =
                    setTimeout(
                        () => {

                            if (
                                finished
                            ) {
                                return;
                            }


                            finished =
                                true;


                            reject(
                                new Error(
                                    "Worker timeout"
                                )
                            );

                        },
                        WORKER_TIMEOUT
                    );


                gmRequest({

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

                            version:
                                "V9.1.1",

                            image_width:
                                imageWidth,

                            image_height:
                                imageHeight,

                            tiles:
                                tiles
                        }),

                    timeout:
                        WORKER_TIMEOUT

                })
                .then(
                    response => {

                        if (
                            finished
                        ) {
                            return;
                        }


                        finished =
                            true;


                        clearTimeout(
                            timeout
                        );


                        if (
                            !response
                        ) {

                            reject(
                                new Error(
                                    "Worker 沒有回應"
                                )
                            );

                            return;
                        }


                        if (
                            response.status <
                                200 ||
                            response.status >=
                                300
                        ) {

                            reject(
                                new Error(
                                    `Worker HTTP ${response.status}`
                                )
                            );

                            return;
                        }


                        let data;


                        try {

                            data =
                                JSON.parse(
                                    response.responseText
                                );

                        } catch (
                            error
                        ) {

                            console.error(
                                "[GMW V9.1.1] Worker response:",
                                response.responseText
                            );


                            reject(
                                new Error(
                                    "Worker 回傳 JSON 解析失敗"
                                )
                            );

                            return;
                        }


                        if (
                            data &&
                            data.error
                        ) {

                            reject(
                                new Error(
                                    data.error
                                )
                            );

                            return;
                        }


                        resolve(
                            data
                        );
                    }
                )
                .catch(
                    error => {

                        if (
                            finished
                        ) {
                            return;
                        }


                        finished =
                            true;


                        clearTimeout(
                            timeout
                        );


                        reject(
                            error
                        );
                    }
                );
            }
        );
    }


    /*
     * =========================================================
     * 建立 Overlay
     * =========================================================
     */

    function createOverlay(
        originalImg
    ) {

        /*
         * 清掉舊 Overlay
         */

        if (
            originalImg.__gmTranslatorOverlay
        ) {

            try {

                originalImg.__gmTranslatorOverlay.remove();

            } catch (
                error
            ) {}

        }


        const overlay =
            document.createElement(
                "div"
            );


        overlay.className =
            "gm-manga-translator-overlay-v911";


        Object.assign(
            overlay.style,
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

                zIndex:
                    "2147483646"
            }
        );


        document.documentElement.appendChild(
            overlay
        );


        originalImg.__gmTranslatorOverlay =
            overlay;


        return overlay;
    }


    /*
     * =========================================================
     * 自動調整字體
     * =========================================================
     */

    function fitText(
        textElement,
        box
    ) {

        let fontSize =
            Math.max(
                10,
                Math.min(
                    28,
                    box.clientHeight *
                    0.55
                )
            );


        textElement.style.fontSize =
            `${fontSize}px`;


        let count =
            0;


        while (
            count < 25
        ) {

            const tooTall =
                textElement.scrollHeight >
                textElement.clientHeight;


            const tooWide =
                textElement.scrollWidth >
                textElement.clientWidth;


            if (
                !tooTall &&
                !tooWide
            ) {

                break;
            }


            fontSize *=
                0.88;


            if (
                fontSize < 8
            ) {

                fontSize =
                    8;

                break;
            }


            textElement.style.fontSize =
                `${fontSize}px`;


            count++;
        }
    }


    /*
     * =========================================================
     * Render 翻譯
     * =========================================================
     */

    function renderTranslations(
        originalImg,
        result
    ) {

        if (
            !result ||
            !Array.isArray(
                result.text_blocks
            )
        ) {

            return;
        }


        const imageWidth =
            Number(
                result.image_width
            ) ||
            originalImg.naturalWidth;


        const imageHeight =
            Number(
                result.image_height
            ) ||
            originalImg.naturalHeight;


        const overlay =
            createOverlay(
                originalImg
            );


        function render() {

            if (
                !document.documentElement.contains(
                    originalImg
                )
            ) {

                return;
            }


            const rect =
                originalImg.getBoundingClientRect();


            if (
                rect.width <= 0 ||
                rect.height <= 0
            ) {

                return;
            }


            Object.assign(
                overlay.style,
                {

                    left:
                        `${rect.left}px`,

                    top:
                        `${rect.top}px`,

                    width:
                        `${rect.width}px`,

                    height:
                        `${rect.height}px`
                }
            );


            overlay.innerHTML =
                "";


            for (
                const block
                of result.text_blocks
            ) {

                if (
                    !block ||
                    !block.translation
                ) {

                    continue;
                }


                const x =
                    Number(
                        block.x
                    );


                const y =
                    Number(
                        block.y
                    );


                const width =
                    Number(
                        block.width
                    );


                const height =
                    Number(
                        block.height
                    );


                if (
                    !Number.isFinite(x) ||
                    !Number.isFinite(y) ||
                    !Number.isFinite(width) ||
                    !Number.isFinite(height)
                ) {

                    continue;
                }


                if (
                    width <= 1 ||
                    height <= 1
                ) {

                    continue;
                }


                /*
                 * 原始圖片座標
                 * -> 百分比
                 */

                const left =
                    clamp(
                        x /
                        imageWidth *
                        100,

                        0,
                        100
                    );


                const top =
                    clamp(
                        y /
                        imageHeight *
                        100,

                        0,
                        100
                    );


                const boxWidth =
                    clamp(
                        width /
                        imageWidth *
                        100,

                        0.5,
                        100
                    );


                const boxHeight =
                    clamp(
                        height /
                        imageHeight *
                        100,

                        0.5,
                        100
                    );


                /*
                 * 建立中文背景框
                 */

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
                            `${left}%`,

                        top:
                            `${top}%`,

                        width:
                            `${boxWidth}%`,

                        height:
                            `${boxHeight}%`,

                        background:
                            "#ffffff",

                        color:
                            "#000000",

                        boxSizing:
                            "border-box",

                        padding:
                            "3px 6px",

                        borderRadius:
                            "4px",

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
                            '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif',

                        fontWeight:
                            "600",

                        lineHeight:
                            "1.2",

                        wordBreak:
                            "break-word",

                        overflowWrap:
                            "anywhere",

                        opacity:
                            "1"
                    }
                );


                /*
                 * 中文文字
                 */

                const text =
                    document.createElement(
                        "div"
                    );


                text.textContent =
                    block.translation;


                Object.assign(
                    text.style,
                    {

                        width:
                            "100%",

                        height:
                            "100%",

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

                        wordBreak:
                            "break-word",

                        overflowWrap:
                            "anywhere"
                    }
                );


                box.appendChild(
                    text
                );


                overlay.appendChild(
                    box
                );


                /*
                 * 字體自動縮放
                 */

                requestAnimationFrame(
                    () => {

                        fitText(
                            text,
                            box
                        );

                    }
                );
            }
        }


        /*
         * 第一次
         */

        render();


        /*
         * 圖片大小改變
         */

        if (
            typeof ResizeObserver !==
            "undefined"
        ) {

            const resizeObserver =
                new ResizeObserver(
                    () => {
                        render();
                    }
                );


            resizeObserver.observe(
                originalImg
            );


            originalImg.__gmTranslatorResizeObserver =
                resizeObserver;
        }


        /*
         * 捲動時重新定位
         */

        let rafPending =
            false;


        function updateOnScroll() {

            if (
                rafPending
            ) {

                return;
            }


            rafPending =
                true;


            requestAnimationFrame(
                () => {

                    rafPending =
                        false;

                    render();
                }
            );
        }


        window.addEventListener(
            "scroll",
            updateOnScroll,
            {
                passive:
                    true
            }
        );


        /*
         * 定期檢查漫畫閱讀器
         */

        const interval =
            setInterval(
                () => {

                    if (
                        !document.documentElement.contains(
                            originalImg
                        )
                    ) {

                        clearInterval(
                            interval
                        );


                        if (
                            originalImg.__gmTranslatorResizeObserver
                        ) {

                            originalImg.__gmTranslatorResizeObserver.disconnect();

                        }


                        window.removeEventListener(
                            "scroll",
                            updateOnScroll
                        );


                        return;
                    }


                    render();

                },
                1000
            );
    }


    /*
     * =========================================================
     * 處理單張圖片
     * =========================================================
     */

    async function processImage(
        img,
        index
    ) {

        processedCount++;


        try {

            updateStatus(
                `取得圖片 ${index + 1}/${imageList.length}`
            );


            const src =
                img.currentSrc ||
                img.src;


            if (
                !src
            ) {

                throw new Error(
                    "圖片沒有 src"
                );
            }


            if (
                src.startsWith(
                    "data:"
                )
            ) {

                throw new Error(
                    "Data URL 圖片略過"
                );
            }


            /*
             * =================================================
             * 下載
             * =================================================
             */

            const blob =
                await downloadImage(
                    src
                );


            updateStatus(
                `圖片解碼 ${index + 1}/${imageList.length}`
            );


            const decoded =
                await loadImage(
                    blob
                );


            const imageWidth =
                decoded.naturalWidth;


            const imageHeight =
                decoded.naturalHeight;


            if (
                imageWidth <
                    MIN_IMAGE_WIDTH ||
                imageHeight <
                    MIN_IMAGE_HEIGHT
            ) {

                throw new Error(
                    `圖片太小 ${imageWidth}x${imageHeight}`
                );
            }


            /*
             * =================================================
             * OCR 切片
             * =================================================
             */

            updateStatus(
                `建立 OCR 切片 ${index + 1}/${imageList.length}`
            );


            const tiles =
                createOCRTiles(
                    decoded
                );


            totalTiles +=
                tiles.length;


            console.log(
                `[GMW V9.1.1] Image ${index + 1}:`,
                imageWidth,
                "x",
                imageHeight,
                "tiles:",
                tiles.length
            );


            /*
             * =================================================
             * Worker
             * =================================================
             */

            updateStatus(
                `送往 Worker ${index + 1}/${imageList.length}`
            );


            const result =
                await sendToWorker(
                    tiles,
                    imageWidth,
                    imageHeight
                );


            /*
             * =================================================
             * OCR 結果
             * =================================================
             */

            const blockCount =
                Array.isArray(
                    result.text_blocks
                )
                    ? result.text_blocks.length
                    : 0;


            totalOCRBlocks +=
                blockCount;


            console.log(
                `[GMW V9.1.1] Image ${index + 1} OCR blocks:`,
                blockCount
            );


            updateStatus(
                `翻譯 ${index + 1}/${imageList.length}：${blockCount} 區`
            );


            /*
             * =================================================
             * 顯示翻譯
             * =================================================
             */

            renderTranslations(
                img,
                result
            );


            completedCount++;


            updateStatus(
                `完成 ${index + 1}/${imageList.length}`
            );


        } catch (
            error
        ) {

            failedCount++;


            console.error(
                "[GMW V9.1.1] Image error:",
                error
            );


            updateStatus(
                `失敗 ${index + 1}/${imageList.length}：${
                    error?.message ||
                    String(error)
                }`
            );


            /*
             * 不要讓一張圖片失敗
             * 導致整個程序停止
             */

            await sleep(
                300
            );
        }
    }


    /*
     * =========================================================
     * 搜尋漫畫圖片
     * =========================================================
     */

    function collectImages() {

        const images =
            Array.from(
                document.images
            );


        const result =
            [];


        const seen =
            new Set();


        for (
            const img
            of images
        ) {

            if (
                !img
            ) {
                continue;
            }


            const src =
                img.currentSrc ||
                img.src;


            if (
                !src
            ) {
                continue;
            }


            /*
             * 避免重複
             */

            if (
                seen.has(
                    src
                )
            ) {

                continue;
            }


            seen.add(
                src
            );


            const width =
                img.naturalWidth ||
                img.width ||
                0;


            const height =
                img.naturalHeight ||
                img.height ||
                0;


            /*
             * 太小的圖片排除
             */

            if (
                width <
                    MIN_IMAGE_WIDTH ||
                height <
                    MIN_IMAGE_HEIGHT
            ) {

                continue;
            }


            /*
             * 明顯 UI icon 排除
             */

            if (
                width < 300 &&
                height < 300
            ) {

                continue;
            }


            /*
             * 超寬 banner 排除
             */

            const ratio =
                width /
                height;


            if (
                ratio > 5 &&
                width < 1000
            ) {

                continue;
            }


            result.push(
                img
            );
        }


        return result;
    }


    /*
     * =========================================================
     * 主程序
     * =========================================================
     */

    async function run() {

        if (
            isRunning
        ) {

            return;
        }


        isRunning =
            true;


        updateStatus(
            "等待漫畫圖片..."
        );


        console.log(
            "[GMW V9.1.1] Searching images..."
        );


        /*
         * 等待網站圖片載入
         */

        await sleep(
            1500
        );


        imageList =
            collectImages();


        console.log(
            "[GMW V9.1.1] Images found:",
            imageList.length
        );


        updateStatus(
            `找到 ${imageList.length} 張圖片`
        );


        /*
         * 沒有圖片
         */

        if (
            imageList.length ===
            0
        ) {

            updateStatus(
                "沒有找到符合條件的漫畫圖片"
            );


            isRunning =
                false;


            return;
        }


        /*
         * =====================================================
         * 依序處理
         * =====================================================
         */

        for (
            let i = 0;
            i < imageList.length;
            i++
        ) {

            await processImage(
                imageList[i],
                i
            );


            /*
             * 避免連續大量請求
             */

            await sleep(
                250
            );
        }


        updateStatus(
            `全部完成：${completedCount}/${imageList.length}`
        );


        console.log(
            "[GMW V9.1.1] All done"
        );


        isRunning =
            false;
    }


    /*
     * =========================================================
     * 啟動
     * =========================================================
     */

    function startOnce() {

        if (
            started
        ) {

            return;
        }


        started =
            true;


        console.log(
            "[GMW V9.1.1] Starting..."
        );


        updateStatus(
            "Userscript 已啟動，搜尋圖片中..."
        );


        run()
            .catch(
                error => {

                    console.error(
                        "[GMW V9.1.1] Main error:",
                        error
                    );


                    updateStatus(
                        "錯誤：" +
                        (
                            error?.message ||
                            String(error)
                        )
                    );


                    isRunning =
                        false;
                }
            );
    }


    /*
     * =========================================================
     * document ready
     * =========================================================
     */

    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            () => {

                setTimeout(
                    startOnce,
                    500
                );

            },
            {
                once:
                    true
            }
        );

    } else {

        setTimeout(
            startOnce,
            500
        );
    }


    /*
     * =========================================================
     * 最後保險啟動
     * =========================================================
     */

    setTimeout(
        () => {

            if (
                !started
            ) {

                startOnce();
            }

        },
        5000
    );

})();
