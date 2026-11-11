import bank from "../data/exercises.json" with { type: "json" };
import { requiredSelectCount } from "./scoring.js";
import { createSession } from "./session.js";

const TYPE_LABEL = {
  mcq: "單選",
  gap_fill: "填充",
  multi_select: "多選",
  short_answer: "短答",
  passage: "短文",
};

const app = document.querySelector("#app");
const itemById = new Map();
for (const station of bank.stations) {
  for (const item of station.items) itemById.set(item.id, { station, item });
}

let session = createSession(bank);
let currentStationId = bank.stations[0].id;

document.addEventListener("click", onClick);
document.addEventListener("change", onChange);

render();

function onClick(event) {
  const control = event.target.closest("[data-action]");
  if (!control || control.disabled) return;
  const action = control.dataset.action;
  if (action === "station") {
    currentStationId = control.dataset.station;
    showStation(currentStationId);
    return;
  }
  if (action === "skip") {
    document.getElementById("practice")?.scrollIntoView();
    return;
  }
  if (action === "reset") {
    const confirmed = window.confirm("重設會清除這一頁的所有作答和分數，而且無法復原。要重設嗎？");
    if (!confirmed) return;
    session.reset();
    render();
    return;
  }
  const card = control.closest("[data-item]");
  if (!card) return;
  const itemId = card.dataset.item;
  const row = itemById.get(itemId);
  if (!row) return;
  if (action === "hint") {
    session.revealHint(itemId);
    paintCard(card, row);
    return;
  }
  if (action === "flag-teacher") {
    session.flagForTeacher(itemId);
    paintCard(card, row);
    paintScores();
    return;
  }
  if (action === "submit") {
    const response = readResponse(card, row.item);
    const outcome = session.submit(itemId, response);
    if (!outcome.ok) {
      paintCard(card, row);
      showBlocked(card, outcome.result);
      return;
    }
    const missedShort = row.item.type === "short_answer" && !outcome.entry.referenceMatch;
    const missedAuto = row.item.type !== "short_answer" && !outcome.entry.correct;
    if (missedShort || missedAuto) session.revealHint(itemId);
    paintCard(card, row);
    paintScores();
  }
}

function onChange(event) {
  const card = event.target.closest("[data-item]");
  if (!card) return;
  const row = itemById.get(card.dataset.item);
  if (!row || row.item.type !== "multi_select") return;
  syncMulti(card, row.item);
}

function render() {
  app.replaceChildren();
  const strip = el("div", "live-strip");
  strip.append(el("p", null, "本頁練習點數（重整或關閉就會消失）"));
  const stripLine = el("p");
  stripLine.id = "live-strip-line";
  strip.append(stripLine);
  app.append(strip);

  const wrap = el("div", "wrap");
  wrap.append(renderHero(), renderNav(), renderScoreboard(), renderStations(), renderFooter());
  app.append(wrap);
  showStation(currentStationId);
  paintScores();
  for (const card of app.querySelectorAll("[data-item]")) {
    const row = itemById.get(card.dataset.item);
    if (row && row.item.type === "multi_select") syncMulti(card, row.item);
    if (row) paintCard(card, row);
  }
}

function renderHero() {
  const hero = el("header", "hero");
  const kicker = el("p", "kicker", "香港小學六年級英語練習 · 英國英語");
  const title = el("h1", null, bank.meta.title);
  const banner = el("div", "practice-banner");
  banner.append(
    el("p", null, "這是練習，不是考試，也不是成績系統。參考答案寫在這個網頁的程式裡，不能防止偷看答案。畫面上的「首次答啱」只代表你在這一頁第一次提交的結果。"),
    el("p", null, "分數只存在這一頁的記憶體。關閉分頁、重新整理，或按「重設」，結果會全部消失。沒有雲端交卷，不用輸入姓名、電郵或學生代號。"),
  );
  const skip = el("button", "skip-button", "跳到題目");
  skip.type = "button";
  skip.dataset.action = "skip";
  hero.append(kicker, title, banner, skip);
  return hero;
}

function renderNav() {
  const nav = el("nav", "station-nav");
  nav.setAttribute("aria-label", "練習站");
  for (const station of bank.stations) {
    const button = el("button", null, station.title_zh);
    button.type = "button";
    button.dataset.action = "station";
    button.dataset.station = station.id;
    nav.append(button);
  }
  return nav;
}

function renderScoreboard() {
  const board = el("section", "scoreboard");
  board.setAttribute("aria-live", "polite");
  board.setAttribute("aria-label", "本頁練習分數");
  board.append(el("h2", null, "一邊做一邊看的分數"));
  board.append(el("p", "note", "這些數字只在這一頁。重新整理、關閉分頁或重設之後會回到零。"));

  const grid = el("div", "stat-grid");
  grid.append(
    stat("核心已提交", "core-submitted", "／57", "57 題都提交過，只表示做完，不是達標，也不是正式分數。"),
    stat("核心首次答啱（無提示）", "core-first-unassisted", "", "練習點數，每題 1。只計第一次就答對、而且之前沒有按提示的自動判分題。短答不算在這裡。"),
    stat("核心提示後或重做才正確", "core-hinted-or-retry", "", "與上一項分開計算，不會合併成一個總對題，也不會改寫首次結果。"),
    stat("已自動判分", "core-auto-submitted", " 題", "單選、填充和多選，按凍結的首次結果計。這是已評過的題數，不是得分。"),
    stat("短答待老師核對", "core-short-pending", "／4", "四題短答一律待老師在課堂核對。即使參考匹配，也不自動算掌握。"),
    stat("填充題請老師當面看", "core-gap-flags", "", "這是你自己加上的本頁標記，與短答待核對分開，不算分。錯的填充不會自動變成待核對。"),
  );
  board.append(grid);

  const disclaimer = el("p", "disclaimer", "以上不是正式 /57 總分。短答要老師在課堂看過才算數。本站沒有老師後台。");
  disclaimer.dataset.stat = "disclaimer";
  const completion = el("p", "completion", "核心已完成作答（不是達標，也不是正式分數）。");
  completion.dataset.stat = "completion";
  completion.hidden = true;
  board.append(disclaimer, completion);

  const optionalTitle = el("h3", "optional-head", "選修延伸（非核心，不計入上面的 57）");
  const optionalGrid = el("div", "stat-grid");
  optionalGrid.append(
    stat("選修已提交", "optional-submitted", "／5", "第 8 站可以略過。"),
    stat("選修首次答啱（無提示）", "optional-first-unassisted", "", "只計第 8 站，不加入核心練習點數。"),
    stat("選修提示後或重做才正確", "optional-hinted-or-retry", "", "與選修的首次答啱分開。"),
  );
  board.append(optionalTitle, optionalGrid);

  const reset = el("button", "reset-button", "重設本頁練習");
  reset.type = "button";
  reset.dataset.action = "reset";
  board.append(reset);
  return board;
}

function stat(label, name, suffix, help) {
  const article = el("article", "stat");
  article.append(el("h3", null, label));
  const line = el("p");
  const strong = el("strong", null, "0");
  strong.dataset.stat = name;
  line.append(strong, document.createTextNode(suffix));
  article.append(line);
  if (help) article.append(el("p", "note", help));
  return article;
}

function renderStations() {
  const main = el("main");
  main.id = "practice";
  for (const station of bank.stations) {
    const section = el("section", station.core ? "station" : "station station-optional");
    section.dataset.stationPanel = station.id;
    section.hidden = true;
    const heading = el("h2", null, station.title_zh);
    const english = el("p", "note");
    english.lang = "en";
    english.textContent = station.title;
    if (!station.core) {
      section.append(el("p", "badge pending", "選修／非核心，可以略過"));
    }
    section.append(heading, english, el("p", "direction", station.student_direction_zh));
    let number = 0;
    for (const item of station.items) {
      if (item.type !== "passage") number += 1;
      section.append(renderCard(item, number));
    }
    main.append(section);
  }
  return main;
}

function renderCard(item, number) {
  const card = el("article", "card");
  card.dataset.item = item.id;
  card.dataset.type = item.type;
  const header = el("header");
  const title = item.type === "passage" ? "閱讀短文（不計分）" : `第 ${number} 題　${TYPE_LABEL[item.type] || ""}`;
  header.append(el("h3", null, title));
  header.append(el("p", "item-id", `題號 ${item.id}`));
  card.append(header);

  if (item.type === "passage") {
    const passage = el("div", "passage");
    passage.append(el("p", null, item.prompt));
    const heading = el("h4", null, item.passage_title);
    heading.lang = "en";
    passage.append(heading);
    for (const paragraph of String(item.passage_text || "").split(/\n{2,}/)) {
      const p = el("p");
      p.lang = "en";
      p.textContent = paragraph.trim();
      passage.append(p);
    }
    card.append(passage);
    return card;
  }

  const prompt = el("div", "prompt");
  prompt.lang = "en";
  appendRich(prompt, item.prompt);
  card.append(prompt);

  if (item.type === "mcq" || item.type === "multi_select") {
    const choices = el("div", "choices");
    for (const option of item.options || []) {
      const label = el("label", "choice");
      const input = document.createElement("input");
      input.type = item.type === "mcq" ? "radio" : "checkbox";
      input.name = item.id;
      input.value = option;
      const span = el("span");
      span.lang = "en";
      appendRich(span, option);
      label.append(input, span);
      choices.append(label);
    }
    card.append(choices);
    if (item.type === "multi_select") {
      const note = el("p", "select-note");
      note.dataset.role = "select-note";
      card.append(note);
    }
  } else {
    const field = item.type === "short_answer" ? document.createElement("textarea") : document.createElement("input");
    if (field.tagName === "INPUT") field.type = "text";
    field.className = "text-input";
    field.dataset.field = "response";
    field.autocomplete = "off";
    field.spellcheck = true;
    field.lang = "en";
    field.setAttribute("aria-label", item.type === "short_answer" ? "短答" : "填充答案");
    card.append(field);
    const help = item.type === "short_answer"
      ? "請用完整句子（句首大寫、句號）。比對時會忽略大小寫、多餘空格、句末句號和彎直引號，但拼錯不會算對。即使和參考答案一樣，仍要等老師在課堂核對。"
      : "請寫答案。比對時會忽略大小寫、多餘空格、句末句號和彎直引號。拼錯不會自動當對。回饋仍會提醒完整、自然的英語。";
    card.append(el("p", "input-note", help));
  }

  const actions = el("div", "actions");
  const submit = el("button", null, "提交");
  submit.type = "button";
  submit.dataset.action = "submit";
  const hint = el("button", null, "提示");
  hint.type = "button";
  hint.dataset.action = "hint";
  actions.append(submit, hint);
  if (item.type === "gap_fill") {
    const flag = el("button", null, "請老師在課堂看此題");
    flag.type = "button";
    flag.dataset.action = "flag-teacher";
    flag.hidden = true;
    actions.append(flag);
  }
  card.append(actions);

  const hintBox = el("p", "hint");
  hintBox.dataset.role = "hint";
  hintBox.lang = "en";
  hintBox.hidden = true;
  const feedback = el("div", "feedback");
  feedback.dataset.role = "feedback";
  card.append(hintBox, feedback);
  return card;
}

function renderFooter() {
  const footer = el("footer", "footer-note");
  footer.append(
    el("p", null, "紙本練習和這個網上練習操練相近的內容，有些題幹會重覆，適宜分開時間做。"),
    el("p", null, "老師如要核對短答，請在課堂直接看這個畫面。學生一經重新整理或關閉，文字和分數就沒有了。"),
  );
  const reset = el("button", "reset-button", "重設本頁練習");
  reset.type = "button";
  reset.dataset.action = "reset";
  footer.append(reset);
  return footer;
}

function showStation(stationId) {
  for (const button of app.querySelectorAll("[data-action=station]")) {
    const on = button.dataset.station === stationId;
    button.setAttribute("aria-current", on ? "true" : "false");
  }
  for (const panel of app.querySelectorAll("[data-station-panel]")) {
    panel.hidden = panel.dataset.stationPanel !== stationId;
  }
}

function readResponse(card, item) {
  if (item.type === "mcq") {
    const selected = card.querySelector('input[type="radio"]:checked');
    return selected ? selected.value : "";
  }
  if (item.type === "multi_select") {
    return [...card.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
  }
  const field = card.querySelector("[data-field=response]");
  return field ? field.value : "";
}

function syncMulti(card, item) {
  const selectedCount = card.querySelectorAll('input[type="checkbox"]:checked').length;
  const need = requiredSelectCount(item);
  const note = card.querySelector("[data-role=select-note]");
  if (note) {
    note.textContent = `請剛好選滿 ${need} 項才能提交（現在選了 ${selectedCount} 項）。少選、多選或錯選都沒有部分分。`;
  }
  const submit = card.querySelector("[data-action=submit]");
  if (submit) submit.disabled = selectedCount !== need;
}

function paintScores() {
  const totals = session.summary();
  setStat("core-submitted", totals.coreSubmitted);
  setStat("core-first-unassisted", totals.coreFirstUnassisted);
  setStat("core-hinted-or-retry", totals.coreHintedOrRetry);
  setStat("core-auto-submitted", totals.coreAutoScoredSubmitted);
  setStat("core-short-pending", totals.coreShortPending);
  setStat("core-gap-flags", totals.gapTeacherFlags);
  setStat("optional-submitted", totals.optionalSubmitted);
  setStat("optional-first-unassisted", totals.optionalFirstUnassisted);
  setStat("optional-hinted-or-retry", totals.optionalHintedOrRetry);
  const completion = app.querySelector("[data-stat=completion]");
  if (completion) completion.hidden = !totals.coreComplete;
  const strip = document.getElementById("live-strip-line");
  if (strip) {
    strip.replaceChildren();
    const bits = [
      ["已提交", `${totals.coreSubmitted}／57`],
      ["首次答啱", String(totals.coreFirstUnassisted)],
      ["提示後或重做正確", String(totals.coreHintedOrRetry)],
      ["短答待核對", String(totals.coreShortPending)],
      ["選修", `${totals.optionalSubmitted}／5`],
    ];
    bits.forEach(([label, value], index) => {
      if (index > 0) strip.append(document.createTextNode(" · "));
      strip.append(document.createTextNode(`${label} `));
      strip.append(el("strong", null, value));
    });
    if (totals.coreComplete) {
      strip.append(document.createTextNode(" · 核心已完成作答（不是達標，也不是正式分數）"));
    }
  }
}

function setStat(name, value) {
  const node = app.querySelector(`[data-stat="${name}"]`);
  if (node) node.textContent = String(value);
}

function paintCard(card, row) {
  const item = row.item;
  if (item.type === "passage") return;
  const record = session.getRecord(item.id);
  const hintBox = card.querySelector("[data-role=hint]");
  if (hintBox) {
    hintBox.hidden = !record.hintSeen;
    hintBox.textContent = record.hintSeen ? `提示：${item.hint}` : "";
  }
  const flag = card.querySelector("[data-action=flag-teacher]");
  if (flag) {
    const wrongGap = item.type === "gap_fill" && record.attempts.some((attempt) => !attempt.correct);
    flag.hidden = !wrongGap;
    flag.textContent = record.askTeacher ? "取消「請老師看」標記" : "請老師在課堂看此題";
  }
  const feedback = card.querySelector("[data-role=feedback]");
  if (!feedback) return;
  feedback.replaceChildren();
  feedback.className = "feedback";
  if (record.attempts.length === 0) return;

  const first = record.attempts[0];
  const latest = record.attempts[record.attempts.length - 1];
  const bucket = session.classify(item.id);
  const firstLine = el("p");
  firstLine.dataset.role = "first-result";
  firstLine.textContent = firstResultText(item, first);
  const latestLine = el("p");
  latestLine.dataset.role = "latest-result";
  latestLine.textContent = latestResultText(item, latest, bucket);
  feedback.append(firstLine, latestLine);

  if (item.type === "short_answer") {
    feedback.classList.add("is-pending");
    const pending = el("p", null, "待老師在課堂核對，不自動算掌握。");
    pending.dataset.role = "pending-note";
    const match = el("p");
    match.dataset.role = "reference-match";
    match.textContent = latest.referenceMatch ? "參考匹配：符合參考答案" : "參考匹配：未符合參考答案";
    feedback.append(pending, match, keptText("首次提交的文字", first.response), keptText("最近一次提交的文字", latest.response));
    appendBankFeedback(feedback, item, latest.referenceMatch, latest.response);
    return;
  }

  if (latest.correct) feedback.classList.add("is-correct");
  else feedback.classList.add("is-incorrect");
  if (item.type === "gap_fill") {
    feedback.append(keptText("首次提交的文字", first.response), keptText("最近一次提交的文字", latest.response));
  }
  if (record.askTeacher) {
    feedback.append(el("p", null, "已標記：請老師在課堂看此題（只在本頁，不算分）。"));
  }
  appendBankFeedback(feedback, item, latest.correct, latest.response);
}

function firstResultText(item, first) {
  if (item.type === "short_answer") {
    return "首次結果：短答已提交，待老師在課堂核對，不自動算掌握。這項已凍結。";
  }
  if (first.correct && !first.hinted) return "首次結果：答啱（無提示）。這項已凍結。";
  if (first.correct && first.hinted) return "首次結果：答對，但提交前看過提示，所以不是「首次答啱（無提示）」。這項已凍結。";
  return "首次結果：未答對。這項已凍結。";
}

function latestResultText(item, latest, bucket) {
  if (item.type === "short_answer") {
    return latest.referenceMatch ? "這次提交：參考匹配符合參考答案。" : "這次提交：參考匹配未符合參考答案。";
  }
  if (!latest.correct) return "這次提交：未答對。可以看提示再試。重做不會改寫首次結果。";
  if (bucket === "first-unassisted") return "這次提交：答對，計入「首次答啱（無提示）」。";
  return "這次提交：答對，計入「提示後或重做才正確」。";
}

function showBlocked(card, result) {
  const feedback = card.querySelector("[data-role=feedback]");
  if (!feedback) return;
  if (!feedback.classList.contains("is-correct") && !feedback.classList.contains("is-incorrect") && !feedback.classList.contains("is-pending")) {
    feedback.className = "feedback is-blocked";
  }
  const message = el("p");
  message.dataset.role = "blocked";
  if (result.reason === "count") {
    message.textContent = `請剛好選滿 ${result.need} 項才能提交（現在選了 ${result.selectedCount} 項）。少選、多選或錯選都沒有部分分。`;
  } else {
    message.textContent = "請先作答，再按提交。";
  }
  feedback.prepend(message);
}

function keptText(label, response) {
  const p = el("p", "kept");
  const shown = Array.isArray(response) ? response.join("；") : String(response ?? "");
  p.textContent = `${label}：${shown}`;
  return p;
}

function appendBankFeedback(feedback, item, matched, response) {
  const overall = matched ? item.feedback_correct : item.feedback_incorrect;
  if (overall) {
    const p = el("p");
    p.lang = "en";
    appendRich(p, overall);
    feedback.append(p);
  }
  if (!item.feedback_by_option) return;
  const chosen = Array.isArray(response) ? response : [response];
  for (const option of chosen) {
    const note = item.feedback_by_option[option];
    if (!note) continue;
    const p = el("p");
    p.lang = "en";
    appendRich(p, note);
    feedback.append(p);
  }
}

function appendRich(parent, text) {
  const source = String(text ?? "");
  const pattern = /\*([^*]+)\*/g;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > cursor) parent.append(document.createTextNode(source.slice(cursor, match.index)));
    const em = document.createElement("em");
    em.textContent = match[1];
    parent.append(em);
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) parent.append(document.createTextNode(source.slice(cursor)));
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
