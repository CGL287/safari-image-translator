// ==UserScript==
// @name         AI 圖片自動翻譯 V9 - OpenAI OCR + Google Translation
// @namespace    CGL287
// @version      9.0.0
// @description  OpenAI Vision OCR + Google Translation manga translator
// @match        *://*/*
// @run-at       document-idle
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {

    "use strict";


    const WORKER_URL =
        "https://safari-image-translator.cgl20050126.workers.dev";


    const MIN_IMAGE_WIDTH = 200;
    const MIN_IMAGE_HEIGHT = 200;

    const IMAGE_TIMEOUT = 30000;
    const WORKER_TIMEOUT = 180000;


    /*
     * OCR
     */

    const TILE_HEIGHT = 900;
    const TILE_OVERLAP = 180;

    /*
     * OpenAI Vision 不一定需要 2×，
     * 但保留目前 V8 的放大策略。
     */

    const OCR_SCALE = 2;


    /*
     * 狀態
     */

    let scanRunning = false;

    let totalImages = 0;
    let processingCount = 0;
    let completedCount = 0;
    let failedCount = 0;

    let ocrTiles = 0;
    let ocrBlocks = 0;


    const processedImages =
        new WeakMap();

    const imageLayers =
        new WeakMap();

    const resizeObservers =
        new WeakMap();


    /*
     * ============================================================
     * Status
     * ============================================================
     */

    const status =
        document.createElement(
            "div"
        );


    Object.assign(
        status.style,
        {

            position:
                "fixed",

            top:
                "10px",

            left:
                "10px",

            zIndex:
                "2147483647",

            background:
                "rgba(20,20,20,.92)",

            color:
                "#fff",

            padding:
                "9px 12px",

            borderRadius:
                "9px",

            fontSize:
                "12px",

            lineHeight:
                "1.45",

            fontFamily:
                "-apple-system, BlinkMacSystemFont, sans-serif",

            pointerEvents:
                "none",

            minWidth:
                "200px"
        }
    );


    document.documentElement
        .appendChild(
            status
        );


    function updateStatus(
        message = ""
    ) {

        status.innerHTML = `

            <b>
                OpenAI OCR + Google Translation V9
            </b>

            <br>

            圖片：
            ${totalImages}

            <br>

            處理：
            ${processingCount}

            <br>

            完成：
            ${completedCount}

            <br>

            失敗：
            ${failedCount}

            <br>

            OCR切片：
            ${ocrTiles}

            <br>

            OCR區塊：
            ${ocrBlocks}

            ${
                message
                    ? `<br><small>${escapeHTML(message)}</small>`
                    : ""
            }
        `;
    }


    function escapeHTML(
        text
    ) {

        return String(text)
            .replace(
                /&/g,
                "&amp;"
            )
            .replace(
                /</g,
                "&lt;"
            )
            .replace(
                />/g,
                "&gt;"
            )
            .replace(
                /"/g,
                "&quot;"
            );
    }


    /*
     * ============================================================
     * GM Request
     * ============================================================
     */

    function gmRequest(
        details
    ) {

        return new Promise(
            (
                resolve,
                reject
            ) => {

                const fn =

                    typeof GM !==
                        "undefined" &&

                    typeof GM.xmlHttpRequest ===
                        "function"

                        ? GM.xmlHttpRequest

                        :

                    (
                        typeof GM_xmlhttpRequest ===
                            "function"

                            ? GM_xmlhttpRequest

                            : null
                    );


                if (!fn) {

                    reject(
                        new Error(
                            "GM.xmlHttpRequest unavailable"
                        )
                    );

                    return;
                }


                fn({

                    ...details,

                    onload:
                        resolve,

                    onerror:
                        () =>
                            reject(
                                new Error(
                                    "GM request error"
                                )
                            ),

                    ontimeout:
                        () =>
                            reject(
                                new Error(
                                    "GM request timeout"
                                )
                            ),

                    onabort:
                        () =>
                            reject(
                                new Error(
                                    "GM request aborted"
                                )
                            )
                });
            }
        );
    }


    /*
     * ============================================================
     * Image
     * ============================================================
     */

    function bufferToBlob(
        buffer
    ) {

        return new Blob(
            [buffer],
            {
                type:
                    "image/jpeg"
            }
        );
    }


    function blobToImage(
        blob
    ) {

        return new Promise(
            (
                resolve,
                reject
            ) => {

                const url =
                    URL.createObjectURL(
                        blob
                    );

                const image =
                    new Image();


                image.onload =
                    () => {

                        URL.revokeObjectURL(
                            url
                        );

                        resolve(
                            image
                        );
                    };


                image.onerror =
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


                image.src =
                    url;
            }
        );
    }


    function canvasToBase64(
        canvas
    ) {

        return new Promise(
            (
                resolve,
                reject
            ) => {

                canvas.toBlob(
                    blob => {

                        if (!blob) {

                            reject(
                                new Error(
                                    "Canvas toBlob failed"
                                )
                            );

                            return;
                        }


                        const reader =
                            new FileReader();


                        reader.onload =
                            () => {

                                resolve(
                                    String(
                                        reader.result
                                    ).split(",")[1]
                                );
                            };


                        reader.onerror =
                            () => {

                                reject(
                                    new Error(
                                        "FileReader failed"
                                    )
                                );
                            };


                        reader.readAsDataURL(
                            blob
                        );

                    },

                    "image/jpeg",

                    0.92
                );
            }
        );
    }


    async function downloadImage(
        img
    ) {

        const src =
            img.currentSrc ||
            img.src;


        if (!src) {

            throw new Error(
                "No image source"
            );
        }


        updateStatus(
            "取得原圖"
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
                    IMAGE_TIMEOUT
            });


        if (
            response.status >= 400
        ) {

            throw new Error(
                "Image HTTP " +
                response.status
            );
        }


        return response.response;
    }


    /*
     * ============================================================
     * Tiles
     * ============================================================
     */

    async function createTiles(
        buffer
    ) {

        const blob =
            bufferToBlob(
                buffer
            );

        const image =
            await blobToImage(
                blob
            );


        const width =
            image.naturalWidth;

        const height =
            image.naturalHeight;


        const tiles = [];


        /*
         * 短圖
         */

        if (
            height <=
            TILE_HEIGHT
        ) {

            const scale =
                Math.min(
                    OCR_SCALE,

                    Math.max(
                        1,

                        1024 /
                        Math.max(
                            width,
                            height
                        )
                    )
                );


            const canvas =
                document.createElement(
                    "canvas"
                );


            canvas.width =
                Math.round(
                    width * scale
                );

            canvas.height =
                Math.round(
                    height * scale
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

                image,

                0,
                0,
                width,
                height,

                0,
                0,
                canvas.width,
                canvas.height
            );


            const base64 =
                await canvasToBase64(
                    canvas
                );


            tiles.push({

                id:
                    0,

                imageBase64:
                    base64,

                offsetX:
                    0,

                offsetY:
                    0,

                scale
            });


            return {
                tiles,
                width,
                height
            };
        }


        /*
         * 長圖
         */

        let y = 0;
        let id = 0;


        while (
            y < height
        ) {

            const tileHeight =
                Math.min(
                    TILE_HEIGHT,
                    height - y
                );


            const scale =
                OCR_SCALE;


            const canvas =
                document.createElement(
                    "canvas"
                );


            canvas.width =
                Math.round(
                    width * scale
                );

            canvas.height =
                Math.round(
                    tileHeight * scale
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

                image,

                0,
                y,
                width,
                tileHeight,

                0,
                0,
                canvas.width,
                canvas.height
            );


            const base64 =
                await canvasToBase64(
                    canvas
                );


            tiles.push({

                id,

                imageBase64:
                    base64,

                offsetX:
                    0,

                offsetY:
                    y,

                scale
            });


            id++;


            if (
                y +
                tileHeight >=
                height
            ) {

                break;
            }


            y +=
                TILE_HEIGHT -
                TILE_OVERLAP;
        }


        return {
            tiles,
            width,
            height
        };
    }


    /*
     * ============================================================
     * Worker
     * ============================================================
     */

    async function sendTiles(
        tiles
    ) {

        updateStatus(
            "OpenAI Vision OCR"
        );


        ocrTiles +=
            tiles.length;


        const response =
            await gmRequest({

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
                        tiles
                    }),

                responseType:
                    "text",

                timeout:
                    WORKER_TIMEOUT
            });


        if (
            response.status >= 400
        ) {

            throw new Error(
                "Worker HTTP " +
                response.status
            );
        }


        let result;


        try {

            result =
                JSON.parse(
                    response.responseText
                );

        } catch {

            throw new Error(
                "Invalid Worker JSON"
            );
        }


        if (
            result.error
        ) {

            throw new Error(
                result.error
            );
        }


        ocrBlocks +=
            (
                result.text_blocks ||
                []
            ).length;


        return result;
    }


    /*
     * ============================================================
     * Overlay
     * ============================================================
     */

    function createLayer(
        img
    ) {

        const old =
            imageLayers.get(
                img
            );


        if (
            old &&
            old.isConnected
        ) {

            return old;
        }


        const layer =
            document.createElement(
                "div"
            );


        Object.assign(
            layer.style,
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

                zIndex:
                    "2147483646",

                pointerEvents:
                    "none",

                overflow:
                    "visible"
            }
        );


        document.documentElement
            .appendChild(
                layer
            );


        imageLayers.set(
            img,
            layer
        );


        return layer;
    }


    function updateLayer(
        img
    ) {

        const layer =
            imageLayers.get(
                img
            );


        if (!layer) {
            return;
        }


        const rect =
            img.getBoundingClientRect();


        layer.style.left =
            `${rect.left}px`;

        layer.style.top =
            `${rect.top}px`;

        layer.style.width =
            `${rect.width}px`;

        layer.style.height =
            `${rect.height}px`;
    }


    /*
     * ============================================================
     * Font
     * ============================================================
     */

    function fitText(
        box
    ) {

        const rect =
            box.getBoundingClientRect();


        if (
            rect.width <= 2 ||
            rect.height <= 2
        ) {

            return;
        }


        let size =
            Math.max(
                9,

                Math.min(
                    36,
                    rect.height * 0.55
                )
            );


        box.style.fontSize =
            `${size}px`;


        for (
            let i = 0;
            i < 20;
            i++
        ) {

            if (

                box.scrollHeight <=
                    box.clientHeight + 2 &&

                box.scrollWidth <=
                    box.clientWidth + 2

            ) {

                break;
            }


            size *=
                0.88;


            if (
                size < 8
            ) {

                size = 8;

                break;
            }


            box.style.fontSize =
                `${size}px`;
        }
    }


    /*
     * ============================================================
     * Render
     * ============================================================
     */

    function render(
        img,
        result,
        width,
        height
    ) {

        const old =
            imageLayers.get(
                img
            );


        if (
            old &&
            old.isConnected
        ) {

            old.remove();
        }


        const layer =
            createLayer(
                img
            );


        updateLayer(
            img
        );


        const blocks =
            result.text_blocks ||
            [];


        for (
            const block
            of blocks
        ) {

            if (
                !block.translation
            ) {

                continue;
            }


            const box =
                document.createElement(
                    "div"
                );


            const x =
                Number(
                    block.x
                );

            const y =
                Number(
                    block.y
                );

            const w =
                Number(
                    block.width
                );

            const h =
                Number(
                    block.height
                );


            Object.assign(
                box.style,
                {

                    position:
                        "absolute",

                    left:
                        `${x / width * 100}%`,

                    top:
                        `${y / height * 100}%`,

                    width:
                        `${w / width * 100}%`,

                    height:
                        `${h / height * 100}%`,

                    boxSizing:
                        "border-box",

                    background:
                        "#ffffff",

                    color:
                        "#000000",

                    padding:
                        "3px 5px",

                    borderRadius:
                        "3px",

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
                        "\"Noto Sans TC\", \"PingFang TC\", \"Microsoft JhengHei\", sans-serif",

                    fontWeight:
                        "600",

                    lineHeight:
                        "1.1",

                    whiteSpace:
                        "pre-wrap",

                    wordBreak:
                        "break-word"
                }
            );


            box.textContent =
                block.translation;


            layer.appendChild(
                box
            );


            requestAnimationFrame(
                () =>
                    fitText(
                        box
                    )
            );
        }
    }


    /*
     * ============================================================
     * Observer
     * ============================================================
     */

    function observeImage(
        img
    ) {

        if (
            typeof ResizeObserver ===
            "undefined"
        ) {

            return;
        }


        if (
            resizeObservers.has(
                img
            )
        ) {

            return;
        }


        const observer =
            new ResizeObserver(
                () =>
                    updateLayer(
                        img
                    )
            );


        observer.observe(
            img
        );


        resizeObservers.set(
            img,
            observer
        );
    }


    /*
     * ============================================================
     * Scroll / resize
     * ============================================================
     */

    window.addEventListener(
        "scroll",
        () => {

            for (
                const img
                of document.images
            ) {

                if (
                    imageLayers.has(
                        img
                    )
                ) {

                    updateLayer(
                        img
                    );
                }
            }
        },
        {
            passive:
                true
        }
    );


    window.addEventListener(
        "resize",
        () => {

            for (
                const img
                of document.images
            ) {

                if (
                    imageLayers.has(
                        img
                    )
                ) {

                    updateLayer(
                        img
                    );
                }
            }
        }
    );


    /*
     * ============================================================
     * Process image
     * ============================================================
     */

    async function processImage(
        img
    ) {

        if (
            !isCandidateImage(
                img
            )
        ) {

            return;
        }


        const src =
            img.currentSrc ||
            img.src;


        if (!src) {
            return;
        }


        if (
            processedImages.get(
                img
            ) === src
        ) {

            return;
        }


        processedImages.set(
            img,
            src
        );


        processingCount++;


        try {

            /*
             * 取得原圖
             */

            const buffer =
                await downloadImage(
                    img
                );


            /*
             * 切片 + 放大
             */

            updateStatus(
                "切割 / 放大圖片"
            );


            const prepared =
                await createTiles(
                    buffer
                );


            /*
             * OpenAI OCR
             * +
             * Google Translation
             */

            const result =
                await sendTiles(
                    prepared.tiles
                );


            /*
             * Overlay
             */

            updateStatus(
                "翻譯完成"
            );


            render(

                img,

                result,

                prepared.width,

                prepared.height
            );


            observeImage(
                img
            );


            completedCount++;


        } catch (
            error
        ) {

            console.error(
                "[GMW V9]",
                error
            );


            failedCount++;


            processedImages.delete(
                img
            );


        } finally {

            processingCount--;


            updateStatus(
                "翻譯完成"
            );
        }
    }


    /*
     * ============================================================
     * Candidate
     * ============================================================
     */

    function isCandidateImage(
        img
    ) {

        if (!img) {
            return false;
        }


        const width =
            img.naturalWidth ||
            0;

        const height =
            img.naturalHeight ||
            0;


        if (
            width <
                MIN_IMAGE_WIDTH ||

            height <
                MIN_IMAGE_HEIGHT
        ) {

            return false;
        }


        const ratio =
            width /
            height;


        return (
            ratio <= 8 &&
            ratio >= 0.125
        );
    }


    /*
     * ============================================================
     * Process all
     * ============================================================
     */

    async function processAllImages() {

        if (
            scanRunning
        ) {

            return;
        }


        scanRunning =
            true;


        try {

            const images =
                Array.from(
                    document.images
                );


            totalImages =
                images.length;


            updateStatus(
                "掃描圖片"
            );


            for (
                const img
                of images
            ) {

                if (
                    !img.complete
                ) {

                    await new Promise(
                        resolve => {

                            const done =
                                () =>
                                    resolve();


                            img.addEventListener(
                                "load",
                                done,
                                {
                                    once:
                                        true
                                }
                            );


                            img.addEventListener(
                                "error",
                                done,
                                {
                                    once:
                                        true
                                }
                            );


                            setTimeout(
                                resolve,
                                5000
                            );
                        }
                    );
                }


                await processImage(
                    img
                );
            }


        } finally {

            scanRunning =
                false;


            updateStatus(
                "掃描完成"
            );
        }
    }


    /*
     * ============================================================
     * Dynamic images
     * ============================================================
     */

    let mutationTimer =
        null;


    const observer =
        new MutationObserver(
            () => {

                clearTimeout(
                    mutationTimer
                );


                mutationTimer =
                    setTimeout(
                        () => {

                            totalImages =
                                document.images.length;


                            processAllImages();

                        },
                        1500
                    );
            }
        );


    observer.observe(
        document.documentElement,
        {
            childList:
                true,

            subtree:
                true
        }
    );


    /*
     * ============================================================
     * Start
     * ============================================================
     */

    setTimeout(
        () =>
            processAllImages(),
        1500
    );

})();
