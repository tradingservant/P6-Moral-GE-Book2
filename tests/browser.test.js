import assert from "node:assert/strict";
import { createReadStream, existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import puppeteer from "puppeteer-core";
import bank from "../data/exercises.json" with { type: "json" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chrome = [process.env.CHROME_PATH, "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/local/bin/google-chrome"]
  .filter(Boolean)
  .find((file) => existsSync(file));

let browser;
let server;
let base;

function startServer() {
  const listener = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const file = path.resolve(root, relative);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403);
      response.end();
      return;
    }
    const stream = createReadStream(file);
    stream.on("error", () => {
      response.writeHead(404);
      response.end();
    });
    stream.once("open", () => {
      const types = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
      };
      response.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      stream.pipe(response);
    });
  });
  return new Promise((resolve) => {
    listener.listen(0, "127.0.0.1", () => resolve(listener));
  });
}

async function installSpy(page) {
  await page.evaluateOnNewDocument(() => {
    window.__privacyHits = [];
    const mark = (name) => window.__privacyHits.push(name);
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      mark("setItem");
      return setItem.apply(this, arguments);
    };
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function () {
      mark("getItem");
      return getItem.apply(this, arguments);
    };
    try {
      const desc = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
      Object.defineProperty(Document.prototype, "cookie", {
        configurable: true,
        get() {
          mark("cookie-read");
          return desc.get.call(this);
        },
        set(value) {
          mark("cookie-write");
          return desc.set.call(this, value);
        },
      });
    } catch {
      mark("cookie-spy-failed");
    }
    if (window.indexedDB?.open) {
      const open = window.indexedDB.open.bind(window.indexedDB);
      window.indexedDB.open = function () {
        mark("indexedDB");
        return open.apply(this, arguments);
      };
    }
    if (navigator.serviceWorker?.register) {
      const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = function () {
        mark("serviceWorker");
        return register.apply(this, arguments);
      };
    }
    const originalFetch = window.fetch;
    window.fetch = function () {
      mark("fetch");
      return originalFetch.apply(this, arguments);
    };
    const OriginalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function () {
      mark("xhr");
      return new OriginalXHR();
    };
    window.XMLHttpRequest.prototype = OriginalXHR.prototype;
    if (navigator.sendBeacon) {
      navigator.sendBeacon = function () {
        mark("beacon");
        return true;
      };
    }
    window.layoutAudit = () => {
      const root = document.documentElement;
      const overflow = root.scrollWidth > root.clientWidth + 1;
      const offenders = [];
      const small = [];
      const targets = [];
      for (const el of document.body.querySelectorAll("*")) {
        if (el.closest("[hidden]") || el.hidden) continue;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        if (rect.left < -1 || rect.right > window.innerWidth + 1) {
          offenders.push({ tag: el.tagName, cls: String(el.className).slice(0, 80), left: Math.round(rect.left), right: Math.round(rect.right) });
        }
      }
      for (const el of document.querySelectorAll("body, button, input, textarea, p, li, h1, h2, h3, h4, label, .prompt, .choice span")) {
        if (el.closest("[hidden]") || el.hidden) continue;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const size = parseFloat(style.fontSize);
        if (size < 18) small.push({ tag: el.tagName, cls: String(el.className).slice(0, 80), size, text: (el.innerText || "").slice(0, 40) });
      }
      for (const el of document.querySelectorAll("button, .choice")) {
        if (el.closest("[hidden]") || el.hidden) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        if (rect.height < 44 || rect.width < 44) {
          targets.push({ cls: String(el.className).slice(0, 80), h: Math.round(rect.height), w: Math.round(rect.width), text: (el.innerText || "").slice(0, 24) });
        }
      }
      return {
        overflow,
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        offenders: offenders.slice(0, 6),
        small: small.slice(0, 6),
        targets: targets.slice(0, 6),
      };
    };
  });
}

async function openPractice(viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage();
  const badRequests = [];
  const pageErrors = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["GET", "HEAD"].includes(request.method())) badRequests.push(`${request.method()} ${request.url()}`);
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) badRequests.push(request.url());
  });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.setViewport(viewport);
  await installSpy(page);
  await page.goto(base, { waitUntil: "networkidle0", timeout: 20000 });
  await page.waitForSelector("[data-stat=core-submitted]");
  await page.waitForFunction(() => document.querySelectorAll("[data-item]").length === 63);
  return { page, badRequests, pageErrors };
}

async function stats(page) {
  return page.evaluate(() => {
    const read = (name) => document.querySelector(`[data-stat="${name}"]`).textContent.trim();
    return {
      submitted: read("core-submitted"),
      first: read("core-first-unassisted"),
      retry: read("core-hinted-or-retry"),
      auto: read("core-auto-submitted"),
      pending: read("core-short-pending"),
      flags: read("core-gap-flags"),
      optional: read("optional-submitted"),
      optionalFirst: read("optional-first-unassisted"),
      optionalRetry: read("optional-hinted-or-retry"),
      completionHidden: document.querySelector("[data-stat=completion]").hidden,
      disclaimer: document.querySelector("[data-stat=disclaimer]").textContent.trim(),
    };
  });
}

async function cardText(page, id) {
  return page.$eval(`[data-item="${id}"]`, (card) => card.innerText);
}

describe("headless browser practice", { concurrency: 1 }, () => {
  before(async () => {
    assert.ok(chrome, "Chrome is required for browser tests");
    server = await startServer();
    base = `http://127.0.0.1:${server.address().port}/`;
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
  });

  after(async () => {
    try {
      if (browser) await browser.close();
    } finally {
      if (server) await new Promise((resolve) => server.close(() => resolve()));
    }
  });

  test("shows live practice copy, zero scores, and no identity or network submission", async () => {
    const { page, badRequests, pageErrors } = await openPractice();
    try {
      const text = await page.$eval("body", (body) => body.innerText);
      assert.match(text, /這是練習，不是考試/);
      assert.match(text, /沒有雲端交卷/);
      assert.match(text, /不用輸入姓名、電郵或學生代號/);
      assert.equal((await stats(page)).disclaimer, "以上不是正式 /57 總分。短答要老師在課堂看過才算數。本站沒有老師後台。");
      assert.doesNotMatch(text, /官方總分|上載成績|代碼登入|老師入口|學生代號輸入/);
      assert.equal(text.split("總分").length - 1, 1);
      const initial = await stats(page);
      assert.equal(initial.submitted, "0");
      assert.equal(initial.first, "0");
      assert.equal(initial.retry, "0");
      assert.equal(initial.pending, "0");
      assert.equal(initial.optional, "0");
      assert.equal(initial.completionHidden, true);
      const station8 = await page.$eval('[data-station="station-8"]', (button) => button.textContent);
      assert.match(station8, /非核心/);
      const fields = await page.$$eval("input, textarea", (elements) => elements.map((element) => ({
        type: element.type,
        label: `${element.getAttribute("aria-label") || ""} ${element.placeholder || ""}`,
      })));
      assert.equal(fields.some((field) => /email|password/i.test(field.type) || /姓名|電郵|學生代號/.test(field.label)), false);
      assert.deepEqual(await page.evaluate(() => window.__privacyHits), []);
      assert.deepEqual(badRequests, []);
      assert.deepEqual(pageErrors, []);
    } finally {
      await page.close();
    }
  });

  test("places the unscored passage before the station 4 questions", async () => {
    const { page } = await openPractice();
    try {
      await page.evaluate(() => document.querySelector('[data-station="station-4"]').click());
      const ids = await page.$$eval('[data-station-panel="station-4"] [data-item]', (cards) => cards.map((card) => card.dataset.item));
      assert.deepEqual(ids, ["s4-q0-passage", "s4-q1", "s4-q2", "s4-q3", "s4-q4", "s4-q5", "s4-q6", "s4-q7"]);
      const passage = await cardText(page, "s4-q0-passage");
      assert.match(passage, /閱讀短文（不計分）/);
      assert.match(passage, /After the Earthquake/);
      assert.match(passage, /Green Hill Village/);
      const hasSubmit = await page.$eval('[data-item="s4-q0-passage"]', (card) => Boolean(card.querySelector("[data-action=submit]")));
      assert.equal(hasSubmit, false);
    } finally {
      await page.close();
    }
  });

  test("keeps first unassisted results separate from hinted and retry results", async () => {
    const { page } = await openPractice({ width: 414, height: 896 });
    try {
      await page.$eval('[data-item="s1-q1"] .choice', (element) => element.scrollIntoView({ block: "center" }));
      await page.click('[data-item="s1-q1"] input[value="an earthquake"]');
      await page.click('[data-item="s1-q1"] [data-action="submit"]');
      assert.deepEqual(await stats(page), expectStats({ submitted: "1", first: "1", auto: "1" }));
      assert.match(await cardText(page, "s1-q1"), /首次結果：答啱（無提示）。這項已凍結。/);

      await page.evaluate(() => {
        const card = document.querySelector('[data-item="s1-q2"]');
        card.querySelector('[data-action="hint"]').click();
        [...card.querySelectorAll("input")].find((input) => input.value === "a tsunami").click();
        card.querySelector('[data-action="submit"]').click();
      });
      assert.equal((await stats(page)).first, "1");
      assert.equal((await stats(page)).retry, "1");
      assert.match(await cardText(page, "s1-q2"), /不是「首次答啱（無提示）」/);
      assert.match(await cardText(page, "s1-q2"), /提示後或重做才正確/);

      await page.evaluate(() => {
        const card = document.querySelector('[data-item="s1-q3"]');
        [...card.querySelectorAll("input")].find((input) => input.value === "a flood").click();
        card.querySelector('[data-action="submit"]').click();
      });
      assert.match(await cardText(page, "s1-q3"), /No rain, dry land, no crops/);
      assert.equal((await stats(page)).first, "1");
      assert.equal((await stats(page)).retry, "1");
      const frozen = await page.$eval('[data-item="s1-q3"] [data-role="first-result"]', (element) => element.textContent);
      await page.evaluate(() => {
        const card = document.querySelector('[data-item="s1-q3"]');
        [...card.querySelectorAll("input")].find((input) => input.value === "a drought").click();
        card.querySelector('[data-action="submit"]').click();
      });
      assert.equal(await page.$eval('[data-item="s1-q3"] [data-role="first-result"]', (element) => element.textContent), frozen);
      assert.match(frozen, /首次結果：未答對/);
      assert.equal((await stats(page)).first, "1");
      assert.equal((await stats(page)).retry, "2");
      assert.equal((await stats(page)).submitted, "3");

      await page.evaluate(() => {
        const card = document.querySelector('[data-item="s1-q1"]');
        [...card.querySelectorAll("input")].find((input) => input.value === "a tsunami").click();
        card.querySelector('[data-action="submit"]').click();
      });
      assert.match(await cardText(page, "s1-q1"), /首次結果：答啱（無提示）。這項已凍結。/);
      assert.equal((await stats(page)).first, "1");
      assert.equal((await stats(page)).retry, "2");
    } finally {
      await page.close();
    }
  });

  test("multi-select blocks a short selection and scores only the exact set", async () => {
    const { page } = await openPractice();
    try {
      await page.evaluate(() => document.querySelector('[data-station="station-4"]').click());
      await page.evaluate(() => {
        const card = document.querySelector('[data-item="s4-q3"]');
        card.querySelectorAll("input")[1].click();
      });
      const blockedUi = await page.$eval('[data-item="s4-q3"]', (card) => ({
        disabled: card.querySelector("[data-action=submit]").disabled,
        note: card.querySelector("[data-role=select-note]").textContent,
      }));
      assert.equal(blockedUi.disabled, true);
      assert.match(blockedUi.note, /請剛好選滿 2 項/);
      await page.evaluate(() => {
        const submit = document.querySelector('[data-item="s4-q3"] [data-action="submit"]');
        submit.disabled = false;
        submit.click();
      });
      assert.match(await cardText(page, "s4-q3"), /請剛好選滿 2 項才能提交/);
      assert.equal((await stats(page)).submitted, "0");

      await page.evaluate(() => {
        const card = document.querySelector('[data-item="s4-q3"]');
        const boxes = [...card.querySelectorAll("input")];
        boxes[1].click();
        boxes[0].click();
        boxes[3].click();
        card.querySelector("[data-action=submit]").click();
      });
      assert.equal((await stats(page)).submitted, "1");
      assert.equal((await stats(page)).first, "0");
      assert.match(await cardText(page, "s4-q3"), /首次結果：未答對/);
      assert.match(await cardText(page, "s4-q3"), /You must choose two/);

      await page.evaluate(() => {
        const card = document.querySelector('[data-item="s4-q3"]');
        const boxes = [...card.querySelectorAll("input")];
        boxes[0].click();
        boxes[3].click();
        boxes[1].click();
        boxes[2].click();
        card.querySelector("[data-action=submit]").click();
      });
      assert.equal((await stats(page)).first, "0");
      assert.equal((await stats(page)).retry, "1");
      assert.match(await cardText(page, "s4-q3"), /首次結果：未答對。這項已凍結。/);

      await page.evaluate(() => document.querySelector('[data-station="station-6"]').click());
      await page.evaluate(() => {
        const card = document.querySelector('[data-item="s6-q1"]');
        const boxes = [...card.querySelectorAll("input")];
        boxes[0].click();
        boxes[1].click();
        boxes[2].click();
      });
      assert.equal(await page.$eval('[data-item="s6-q1"] [data-action="submit"]', (button) => button.disabled), true);
      await page.evaluate(() => {
        const card = document.querySelector('[data-item="s6-q1"]');
        card.querySelectorAll("input")[3].click();
        card.querySelector("[data-action=submit]").click();
      });
      assert.equal((await stats(page)).first, "1");
      assert.equal((await stats(page)).retry, "1");
      assert.equal((await stats(page)).submitted, "2");
    } finally {
      await page.close();
    }
  });

  test("accepts normalised gap answers and rejects a real typo", async () => {
    const { page } = await openPractice();
    try {
      await page.evaluate(() => {
        const card = document.querySelector('[data-item="s2-q3"]');
        card.querySelector("[data-field=response]").value = "  WET。 ";
        card.querySelector("[data-action=submit]").click();
        const verb = document.querySelector('[data-item="s5-q8"]');
        verb.querySelector("[data-field=response]").value = "dont have";
        verb.querySelector("[data-action=submit]").click();
      });
      assert.equal((await stats(page)).first, "1");
      assert.equal((await stats(page)).retry, "0");
      assert.match(await cardText(page, "s5-q8"), /do not have/);
      await page.evaluate(() => {
        const verb = document.querySelector('[data-item="s5-q8"]');
        verb.querySelector("[data-field=response]").value = "Don’t have.";
        verb.querySelector("[data-action=submit]").click();
        const now = document.querySelector('[data-item="s5-q6"]');
        now.querySelector("[data-field=response]").value = "  IS. ";
        now.querySelector("[data-action=submit]").click();
        const small = document.querySelector('[data-item="s2-q4"]');
        small.querySelector("[data-field=response]").value = "wett";
        small.querySelector("[data-action=submit]").click();
      });
      assert.equal((await stats(page)).first, "2");
      assert.equal((await stats(page)).retry, "1");
      assert.match(await cardText(page, "s5-q8"), /首次結果：未答對/);
      assert.match(await cardText(page, "s2-q4"), /首次結果：未答對/);
      assert.match(await cardText(page, "s2-q3"), /首次結果：答啱（無提示）/);
    } finally {
      await page.close();
    }
  });

  test("keeps matched short answers pending for the classroom teacher", async () => {
    const { page } = await openPractice();
    try {
      await page.evaluate(() => {
        const card = document.querySelector('[data-item="s4-q4"]');
        card.querySelector("[data-field=response]").value = "  THE MAIN ROAD CRACKED, SO RESCUE VANS COULD NOT REACH SOME FAMILIES AT FIRST. ";
        card.querySelector("[data-action=submit]").click();
      });
      const totals = await stats(page);
      assert.equal(totals.submitted, "1");
      assert.equal(totals.pending, "1");
      assert.equal(totals.first, "0");
      assert.equal(totals.retry, "0");
      assert.equal(totals.auto, "0");
      assert.equal(totals.completionHidden, true);
      const text = await cardText(page, "s4-q4");
      assert.match(text, /參考匹配：符合參考答案/);
      assert.match(text, /待老師在課堂核對，不自動算掌握。/);
      assert.doesNotMatch(text, /計入「首次答啱（無提示）」/);
      assert.match(text, /THE MAIN ROAD CRACKED, SO RESCUE VANS COULD NOT REACH SOME FAMILIES AT FIRST/);
      const visible = await page.$eval("body", (body) => body.innerText);
      assert.equal(visible.split("總分").length - 1, 1);
      assert.doesNotMatch(visible, /官方總分|正式分數\s*[:：]\s*\d+\s*[/／]\s*57/);

      await page.evaluate(() => {
        const gap = document.querySelector('[data-item="s2-q3"]');
        gap.querySelector("[data-field=response]").value = "wett";
        gap.querySelector("[data-action=submit]").click();
        gap.querySelector('[data-action="flag-teacher"]').click();
      });
      const afterFlag = await stats(page);
      assert.equal(afterFlag.pending, "1");
      assert.equal(afterFlag.flags, "1");
      assert.equal(afterFlag.first, "0");
      assert.match(await cardText(page, "s2-q3"), /已標記：請老師在課堂看此題（只在本頁，不算分）。/);
    } finally {
      await page.close();
    }
  });

  test("reset and reload both clear scores", async () => {
    const { page } = await openPractice();
    try {
      await page.evaluate(() => {
        const card = document.querySelector('[data-item="s1-q1"]');
        [...card.querySelectorAll("input")].find((input) => input.value === "an earthquake").click();
        card.querySelector("[data-action=submit]").click();
      });
      assert.equal((await stats(page)).first, "1");

      page.once("dialog", (dialog) => dialog.dismiss());
      await page.evaluate(() => document.querySelector(".scoreboard .reset-button").click());
      assert.equal((await stats(page)).first, "1");
      assert.match(await cardText(page, "s1-q1"), /首次結果：答啱（無提示）/);

      page.once("dialog", (dialog) => dialog.accept());
      await page.evaluate(() => document.querySelector(".scoreboard .reset-button").click());
      const cleared = await stats(page);
      assert.equal(cleared.submitted, "0");
      assert.equal(cleared.first, "0");
      assert.equal(cleared.retry, "0");
      assert.equal(cleared.pending, "0");
      const empty = await page.$eval('[data-item="s1-q1"]', (card) => card.querySelector("[data-role=first-result]") === null && card.querySelector("input:checked") === null);
      assert.equal(empty, true);

      await page.evaluate(() => {
        const card = document.querySelector('[data-item="s1-q1"]');
        [...card.querySelectorAll("input")].find((input) => input.value === "an earthquake").click();
        card.querySelector("[data-action=submit]").click();
      });
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForSelector("[data-stat=core-submitted]");
      assert.equal((await stats(page)).submitted, "0");
      assert.equal((await stats(page)).first, "0");
      assert.deepEqual(await page.evaluate(() => window.__privacyHits), []);
    } finally {
      await page.close();
    }
  });

  test("stays readable at 414px and on a desktop width", async () => {
    for (const viewport of [{ width: 414, height: 896 }, { width: 1280, height: 800 }]) {
      const { page } = await openPractice(viewport);
      try {
        const stations = bank.stations.map((station) => station.id);
        for (const stationId of stations) {
          await page.evaluate((id) => document.querySelector(`[data-station="${id}"]`).click(), stationId);
          const audit = await page.evaluate(() => window.layoutAudit());
          assert.equal(audit.overflow, false, `${viewport.width} ${stationId} scroll ${audit.scrollWidth}/${audit.clientWidth}`);
          assert.deepEqual(audit.offenders, [], `${viewport.width} ${stationId} ${JSON.stringify(audit.offenders)}`);
          assert.deepEqual(audit.small, [], `${viewport.width} ${stationId} ${JSON.stringify(audit.small)}`);
          assert.deepEqual(audit.targets, [], `${viewport.width} ${stationId} ${JSON.stringify(audit.targets)}`);
        }
        await page.evaluate(() => {
          const field = document.querySelector('[data-item="s4-q4"] [data-field="response"]');
          field.value = "abcdefghij".repeat(30);
          document.querySelector('[data-station="station-4"]').click();
        });
        const afterTyping = await page.evaluate(() => window.layoutAudit());
        assert.equal(afterTyping.overflow, false, JSON.stringify(afterTyping.offenders));
        assert.deepEqual(afterTyping.offenders, []);
      } finally {
        await page.close();
      }
    }
  });

  test("finishing every core item is completion, not mastery or an official score", async () => {
    const { page, badRequests } = await openPractice();
    try {
      const plan = [];
      for (const station of bank.stations) {
        if (!station.core) continue;
        for (const entry of station.items) {
          if (entry.type === "passage") continue;
          plan.push({ id: entry.id, type: entry.type, value: entry.answer });
        }
      }
      assert.equal(plan.length, 57);
      await page.evaluate((items) => {
        for (const item of items) {
          const card = document.querySelector(`[data-item="${item.id}"]`);
          if (item.type === "mcq") {
            [...card.querySelectorAll("input")].find((input) => input.value === item.value).click();
          } else if (item.type === "multi_select") {
            for (const value of item.value) {
              [...card.querySelectorAll("input")].find((input) => input.value === value).click();
            }
          } else {
            card.querySelector("[data-field=response]").value = item.value;
          }
          const submit = card.querySelector("[data-action=submit]");
          if (submit.disabled) throw new Error(`disabled ${item.id}`);
          submit.click();
        }
      }, plan);
      const totals = await stats(page);
      assert.equal(totals.submitted, "57");
      assert.equal(totals.first, "53");
      assert.equal(totals.retry, "0");
      assert.equal(totals.auto, "53");
      assert.equal(totals.pending, "4");
      assert.equal(totals.optional, "0");
      assert.equal(totals.completionHidden, false);
      const text = await page.$eval("body", (body) => body.innerText);
      assert.match(text, /核心已完成作答（不是達標，也不是正式分數）/);
      assert.match(text, /以上不是正式 \/57 總分/);
      assert.doesNotMatch(text, /官方總分/);
      const short = await cardText(page, "s4-q7");
      assert.match(short, /待老師在課堂核對，不自動算掌握。/);
      assert.match(short, /參考匹配：符合參考答案/);
      assert.doesNotMatch(short, /計入「首次答啱（無提示）」/);
      assert.deepEqual(await page.evaluate(() => window.__privacyHits), []);
      assert.deepEqual(badRequests, []);
    } finally {
      await page.close();
    }
  });
});

function expectStats(overrides) {
  return {
    submitted: "0",
    first: "0",
    retry: "0",
    auto: "0",
    pending: "0",
    flags: "0",
    optional: "0",
    optionalFirst: "0",
    optionalRetry: "0",
    completionHidden: true,
    disclaimer: "以上不是正式 /57 總分。短答要老師在課堂看過才算數。本站沒有老師後台。",
    ...overrides,
  };
}
