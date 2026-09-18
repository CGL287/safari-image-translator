// ==UserScript==
// @name         GMW Test
// @namespace    gmw-test
// @version      1.0.0
// @match        https://asurascans.com/*
// @grant        GM.xmlHttpRequest
// @connect      safari-image-translator.cgl20050126.workers.dev
// @connect      *
// @inject-into  content
// @run-at       document-end
// ==/UserScript==

(() => {
    "use strict";

    const box = document.createElement("div");

    box.textContent =
        "GMW TEST：正在測試 Userscripts API";

    box.style.cssText = `
        position:fixed;
        top:10px;
        left:10px;
        z-index:2147483647;
        padding:12px;
        background:#222;
        color:white;
        font-size:16px;
        border-radius:8px;
    `;

    document.body.appendChild(box);

    console.log(
        "[GMW TEST]",
        typeof GM,
        typeof GM?.xmlHttpRequest
    );

    if (
        typeof GM === "undefined" ||
        typeof GM.xmlHttpRequest !== "function"
    ) {
        box.textContent =
            "❌ GMW TEST：GM.xmlHttpRequest 不存在";

        return;
    }

    box.textContent =
        "● GMW TEST：GM.xmlHttpRequest 存在，測試 Worker";

    GM.xmlHttpRequest({

        method: "GET",

        url:
            "https://safari-image-translator.cgl20050126.workers.dev",

        responseType: "text",

        timeout: 15000,

        onload(response) {

            box.textContent =
                "✅ GMW TEST：Worker 可連線 HTTP " +
                response.status;

            console.log(
                "[GMW TEST] response",
                response
            );
        },

        onerror(error) {

            box.textContent =
                "❌ GMW TEST：Worker 連線失敗";

            console.error(
                "[GMW TEST] error",
                error
            );
        },

        ontimeout() {

            box.textContent =
                "❌ GMW TEST：Worker 連線逾時";
        }
    });
})();
