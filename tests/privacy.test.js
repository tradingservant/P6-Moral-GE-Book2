import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

const productFiles = [
  "index.html",
  "styles.css",
  "src/app.js",
  "src/scoring.js",
  "src/session.js",
  "data/exercises.json",
];

const forbiddenInCode = [
  /localStorage/,
  /sessionStorage/,
  /indexedDB/i,
  /document\.cookie/,
  /serviceWorker/,
  /caches\s*\./,
  /sendBeacon/,
  /XMLHttpRequest/,
  /\bfetch\s*\(/,
  /WebSocket/,
  /gtag\s*\(/,
  /google-analytics/i,
  /googletagmanager/i,
  /\/workspace/,
  /moral-ge-book2/i,
  /sheet-info/,
  /Apps Script/,
  /script\.google/,
  /https?:\/\//i,
];

function walk(dir, found = []) {
  if (!existsSync(dir)) return found;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, found);
    else found.push(full);
  }
  return found;
}

test("practice code does not store answers or call out to other sites", () => {
  for (const relative of productFiles) {
    const source = readFileSync(path.join(root, relative), "utf8");
    for (const pattern of forbiddenInCode) {
      assert.equal(pattern.test(source), false, `${relative} matches ${pattern}`);
    }
  }

  const html = readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /href="styles\.css"/);
  assert.match(html, /src="src\/app\.js"/);
  assert.doesNotMatch(html, /(?:src|href)\s*=\s*["'](?:\/|https?:)/i);
});

test("README explains the practice limits without old scoring systems", () => {
  const readme = readFileSync(path.join(root, "README.md"), "utf8");
  for (const sentence of [
    "這是課堂和家中用的練習，不是防作弊考試，也不是集中成績系統。",
    "參考答案和可接受答案都寫在前端程式裡。懂得打開開發者工具的人可以看到。",
    "「首次答啱」只表示這一頁記下的第一次提交，不能證明學生沒有事先看過答案。",
    "分數只存在這一頁的記憶體。關閉分頁或重新整理後就會消失。",
    "老師如果要核對短答，請在課堂直接看學生的螢幕，或請學生先不要重新整理。",
    "核心 57 題，選修 5 題，閱讀短文 1 則不計分。",
    "沒有正式 /57 總分。",
    "短答四題一律待老師在課堂核對。",
  ]) {
    assert.ok(readme.includes(sentence), sentence);
  }
  assert.match(readme, /\/P6-Moral-GE-Book2\//);
  assert.doesNotMatch(readme, /\/workspace|sheet-info|Apps Script|script\.google|學生代碼|老師入口/);
});

test("there is no workflow that publishes the site", () => {
  const files = walk(path.join(root, ".github"));
  const deploy = files.filter((file) => /deploy-pages|actions-gh-pages|github-pages|peaceiris/i.test(readFileSync(file, "utf8")));
  assert.deepEqual(deploy, []);
});
