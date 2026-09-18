// ==UserScript==
// @name         AI 圖片自動翻譯 V9.1 - OpenAI OCR + Google Translation
// @namespace    safari-image-translator
// @version      9.1.0
// @description  自動偵測漫畫圖片，使用 OpenAI Vision OCR + Google Translation 翻譯成繁體中文
// @match        *://*/*
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
    "use strict";

    /*
     * =========================================================
     * Configuration
     * =========================================================
     */

    const WORKER_URL =
        "https://safari-image-translator.cgl20050126.workers.dev";

    const TILE_HEIGHT = 900;
    const TILE_OVERLAP = 180;
    const OCR_SCALE = 2;

    const MIN_IMAGE_WIDTH = 250;
    const MIN_IMAGE_HEIGHT = 150;

    const MAX_CONCURRENT_IMAGES = 1;

    const WORKER_TIMEOUT = 180000;

    /*
     * =========================================================
     * State
     * =========================================================
     */

    let imageList = [];
    let processedCount = 0;
    let completedCount = 0;
    let failedCount = 0;

    let totalTiles = 0;
    let totalOCRBlocks = 0;

    let isRunning = false;

    /*
     * =========================================================
     * Status panel
     * =========================================================
     */

    const statusPanel =
        document.createElement("div");

    statusPanel.id =
        "gm-manga-translator-status";

    Object.assign(
        statusPanel.style,
        {
            position: "fixed",
            left: "12px",
            top: "12px",
            zIndex: "2147483647",
            background:
                "rgba(0,0,0,0.88)",
            color: "#fff",
            padding: "10px 14px",
            borderRadius: "8px",
            fontFamily:
                "Arial, sans-serif",
            fontSize: "13px",
            lineHeight: "1.6",
            boxShadow:
                "0 3px 14px rgba(0,0,0,0.4)",
            pointerEvents:
                "none",
            minWidth: "190px"
        }
    );

    statusPanel.textContent =
        "OpenAI OCR + Google Translation V9.1";

    document.documentElement.appendChild(
        statusPanel
    );


    function updateStatus(
        stage = ""
    ) {
        statusPanel.innerHTML = `
            <div>
                <b>
                    OpenAI OCR + Google Translation V9.1
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
     * Utility
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
     * GM.xmlHttpRequest wrapper
     * =========================================================
     */

    function gmRequest(
        options
    ) {
        return new Promise(
            (resolve, reject) => {

                const requestFunction =
                    typeof GM !== "undefined" &&
                    typeof GM.xmlHttpRequest ===
                        "function"
                        ? GM.xmlHttpRequest
                        : typeof GM_xmlhttpRequest ===
                          "function"
                        ? GM_xmlhttpRequest
                        : null;

                if (!requestFunction) {
                    reject(
                        new Error(
                            "GM.xmlHttpRequest unavailable"
                        )
                    );

                    return;
                }

                requestFunction({
                    ...options,

                    onload:
                        response => {
                            resolve(
                                response
                            );
                        },

                    onerror:
                        error => {
                            reject(
                                error
                            );
                        },

                    ontimeout:
                        error => {
                            reject(
                                error
                            );
                        }
                });
            }
        );
    }


    /*
     * =========================================================
     * Download image
     * =========================================================
     */

    async function downloadImage(
        src
    ) {
        const response =
            await gmRequest({
                method: "GET",
                url: src,
                responseType:
                    "arraybuffer",
                timeout:
                    60000
            });

        if (
            !response ||
            response.status < 200 ||
            response.status >= 400
        ) {
            throw new Error(
                `Image download failed: ${response?.status}`
            );
        }

        const blob =
            new Blob(
                [
                    response.response
                ],
                {
                    type:
                        response.responseHeaders
                            ?.match(
                                /content-type:\s*([^\r\n]+)/i
                            )?.[1] ||
                        "image/jpeg"
                }
            );

        return blob;
    }


    /*
     * =========================================================
     * Blob -> HTMLImageElement
     * =========================================================
     */

    function loadImage(
        blob
    ) {
        return new Promise(
            (resolve, reject) => {

                const url =
                    URL.createObjectURL(
                        blob
                    );

                const img =
                    new Image();

                img.onload =
                    () => {
                        URL.revokeObjectURL(
                            url
                        );

                        resolve(img);
                    };

                img.onerror =
                    () => {
                        URL.revokeObjectURL(
                            url
                        );

                        reject(
                            new Error(
                                "Image decode failed"
                            )
                        );
                    };

                img.src = url;
            }
        );
    }


    /*
     * =========================================================
     * Canvas -> JPEG Base64
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

        return dataURL
            .replace(
                /^data:image\/jpeg;base64,/,
                ""
            );
    }


    /*
     * =========================================================
     * Create OCR tiles
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
         * -----------------------------------------------------
         * Short image
         * -----------------------------------------------------
         */

        if (
            originalHeight <= TILE_HEIGHT
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

                offsetX: 0,
                offsetY: 0,

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
         * -----------------------------------------------------
         * Long image
         * -----------------------------------------------------
         */

        let y = 0;

        while (
            y < originalHeight
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

                offsetX: 0,
                offsetY: y,

                scale:
                    OCR_SCALE,

                pixelWidth:
                    canvas.width,

                pixelHeight:
                    canvas.height
            });

            /*
             * Move forward while keeping overlap.
             */

            if (
                y +
                tileOriginalHeight >=
                originalHeight
            ) {
                break;
            }

            y +=
                TILE_HEIGHT -
                TILE_OVERLAP;
        }

        return tiles;
    }


    /*
     * =========================================================
     * Send OCR request to Worker
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
                    method: "POST",

                    url:
                        WORKER_URL,

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    data:
                        JSON.stringify({
                            version:
                                "V9.1",

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
                                !response ||
                                response.status <
                                    200 ||
                                response.status >=
                                    300
                            ) {
                                reject(
                                    new Error(
                                        `Worker HTTP ${response?.status}`
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
                                reject(
                                    new Error(
                                        "Worker JSON parse failed"
                                    )
                                );

                                return;
                            }

                            if (
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
     * Create image-relative overlay
     * =========================================================
     */

    function createOverlay(
        originalImg
    ) {
        const old =
            originalImg.__gmTranslatorOverlay;

        if (old) {
            old.remove();
        }

        const overlay =
            document.createElement(
                "div"
            );

        overlay.className =
            "gm-manga-translator-overlay";

        Object.assign(
            overlay.style,
            {
                position: "fixed",
                left: "0",
                top: "0",
                width: "0",
                height: "0",
                pointerEvents:
                    "none",
                zIndex:
                    "2147483646"
            }
        );

        document.body.appendChild(
            overlay
        );

        originalImg.__gmTranslatorOverlay =
            overlay;

        return overlay;
    }


    /*
     * =========================================================
     * Render translation blocks
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

                /*
                 * Original-image pixels
                 * -> percentages.
                 */

                const left =
                    clamp(
                        Number(
                            block.x
                        ) /
                        imageWidth *
                        100,

                        0,
                        100
                    );

                const top =
                    clamp(
                        Number(
                            block.y
                        ) /
                        imageHeight *
                        100,

                        0,
                        100
                    );

                const width =
                    clamp(
                        Number(
                            block.width
                        ) /
                        imageWidth *
                        100,

                        0,
                        100
                    );

                const height =
                    clamp(
                        Number(
                            block.height
                        ) /
                        imageHeight *
                        100,

                        0,
                        100
                    );


                const box =
                    document.createElement(
                        "div"
                    );

                box.className =
                    "gm-manga-translator-box";


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
                            `${width}%`,

                        height:
                            `${height}%`,

                        background:
                            "#ffffff",

                        color:
                            "#000000",

                        overflow:
                            "hidden",

                        display:
                            "flex",

                        alignItems:
                            "center",

                        justifyContent:
                            "center",

                        textAlign:
                            "center",

                        boxSizing:
                            "border-box",

                        padding:
                            "3px 6px",

                        borderRadius:
                            "4px",

                        fontFamily:
                            `"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif",

                        fontWeight:
                            "600",

                        lineHeight:
                            "1.2",

                        wordBreak:
                            "break-word",

                        overflowWrap:
                            "anywhere",

                        pointerEvents:
                            "none",

                        opacity:
                            "1",

                        textShadow:
                            "none"
                    }
                );


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
                 * Auto font sizing.
                 */

                fitText(
                    text,
                    box
                );
            }
        }


        render();


        /*
         * Re-render when image
         * position/size changes.
         */

        const resizeObserver =
            new ResizeObserver(
                () => render()
            );

        resizeObserver.observe(
            originalImg
        );

        /*
         * Keep overlay aligned
         * during page scrolling.
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
                passive: true
            }
        );


        /*
         * Periodic check for manga
         * readers that reposition images
         * without triggering ResizeObserver.
         */

        const interval =
            setInterval(
                () => {

                    if (
                        !document.body.contains(
                            originalImg
                        )
                    ) {
                        clearInterval(
                            interval
                        );

                        resizeObserver.disconnect();

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
     * Automatic font fitting
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


        let guard = 0;

        while (
            guard < 20 &&
            (
                textElement.scrollHeight >
                    textElement.clientHeight ||
                textElement.scrollWidth >
                    textElement.clientWidth
            )
        ) {
            fontSize *= 0.88;

            if (
                fontSize < 8
            ) {
                fontSize = 8;
                break;
            }

            textElement.style.fontSize =
                `${fontSize}px`;

            guard++;
        }
    }


    /*
     * =========================================================
     * Process one image
     * =========================================================
     */

    async function processImage(
        img,
        index
    ) {
        try {

            processedCount++;

            updateStatus(
                `取得圖片 ${index + 1}/${imageList.length}`
            );


            const src =
                img.currentSrc ||
                img.src;

            if (
                !src ||
                src.startsWith(
                    "data:"
                ) ||
                src.startsWith(
                    "blob:"
                )
            ) {
                throw new Error(
                    "Invalid image source"
                );
            }


            /*
             * -------------------------------------------------
             * Download original image
             * -------------------------------------------------
             */

            const blob =
                await downloadImage(
                    src
                );


            updateStatus(
                `解析圖片 ${index + 1}/${imageList.length}`
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
                    "Image too small"
                );
            }


            /*
             * -------------------------------------------------
             * Create OCR tiles
             * -------------------------------------------------
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


            /*
             * -------------------------------------------------
             * Send to Worker
             * -------------------------------------------------
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


            const blockCount =
                Array.isArray(
                    result.text_blocks
                )
                    ? result.text_blocks.length
                    : 0;

            totalOCRBlocks +=
                blockCount;


            updateStatus(
                `Google 翻譯完成 ${index + 1}/${imageList.length}`
            );


            /*
             * -------------------------------------------------
             * Render
             * -------------------------------------------------
             */

            renderTranslations(
                img,
                result
            );


            completedCount++;


            updateStatus(
                `完成 ${index + 1}/${imageList.length}`
            );

        } catch (error) {

            failedCount++;

            console.error(
                "[GMW V9.1]",
                error
            );

            updateStatus(
                `失敗 ${index + 1}/${imageList.length}: ${
                    error?.message ||
                    String(error)
                }`
            );
        }
    }


    /*
     * =========================================================
     * Find manga images
     * =========================================================
     */

    function collectImages() {

        const images =
            Array.from(
                document.images
            );

        const result = [];

        for (
            const img
            of images
        ) {

            if (
                !img ||
                !img.src
            ) {
                continue;
            }

            /*
             * Ignore tiny images.
             */

            const width =
                img.naturalWidth ||
                img.width;

            const height =
                img.naturalHeight ||
                img.height;

            if (
                width <
                    MIN_IMAGE_WIDTH ||
                height <
                    MIN_IMAGE_HEIGHT
            ) {
                continue;
            }


            /*
             * Ignore obvious UI icons.
             */

            const ratio =
                width / height;

            if (
                width < 300 &&
                height < 300
            ) {
                continue;
            }

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
     * Main runner
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
            "搜尋漫畫圖片..."
        );


        /*
         * Wait for dynamic manga
         * readers to finish loading.
         */

        await sleep(
            1500
        );


        imageList =
            collectImages();


        updateStatus(
            `找到 ${imageList.length} 張圖片`
        );


        /*
         * -----------------------------------------------------
         * Sequential processing
         * -----------------------------------------------------
         */

        for (
            let i = 0;
            i < imageList.length;
            i++
        ) {

            const img =
                imageList[i];

            await processImage(
                img,
                i
            );

            /*
             * Small delay prevents
             * browser/network overload.
             */

            await sleep(
                200
            );
        }


        updateStatus(
            `全部完成：${completedCount}/${imageList.length}`
        );

        isRunning =
            false;
    }


    /*
     * =========================================================
     * Mutation observer
     * =========================================================
     *
     * Manga readers often load images
     * dynamically. Start once the page
     * is sufficiently ready.
     * =========================================================
     */

    let started =
        false;


    function startOnce() {

        if (
            started
        ) {
            return;
        }

        started =
            true;

        run();
    }


    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            () => {
                setTimeout(
                    startOnce,
                    1000
                );
            },
            {
                once: true
            }
        );

    } else {

        setTimeout(
            startOnce,
            1000
        );
    }


    /*
     * =========================================================
     * Safety fallback
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
