/**
 * In-memory practice session. Nothing here writes to browser storage,
 * cookies, or the network. Creating a new session, resetting, or reloading
 * the page starts from an empty record. The first recorded attempt is never
 * overwritten.
 */

import { evaluateAnswer, isAutoScored } from "./scoring.js";

export const CORE_TOTAL = 57;
export const OPTIONAL_TOTAL = 5;
export const SHORT_ANSWER_TOTAL = 4;

function snapshotResponse(response) {
  if (Array.isArray(response)) return Object.freeze([...response]);
  return response;
}

function indexBank(bank) {
  const byId = new Map();
  const rows = [];
  for (const station of bank.stations) {
    for (const item of station.items) {
      if (byId.has(item.id)) throw new Error(`Duplicate item id: ${item.id}`);
      const row = { station, item };
      byId.set(item.id, row);
      rows.push(row);
    }
  }
  return { byId, rows };
}

function emptySummary() {
  return {
    coreSubmitted: 0,
    coreTotal: CORE_TOTAL,
    coreFirstUnassisted: 0,
    coreHintedOrRetry: 0,
    coreAutoScoredSubmitted: 0,
    coreShortPending: 0,
    coreShortTotal: SHORT_ANSWER_TOTAL,
    gapTeacherFlags: 0,
    coreComplete: false,
    optionalSubmitted: 0,
    optionalTotal: OPTIONAL_TOTAL,
    optionalFirstUnassisted: 0,
    optionalHintedOrRetry: 0,
  };
}

export function createSession(bank) {
  const { byId, rows } = indexBank(bank);
  const coreRows = rows.filter((row) => row.item.type !== "passage" && row.station.core === true);
  const optionalRows = rows.filter((row) => row.item.type !== "passage" && row.station.core !== true);
  const passages = rows.filter((row) => row.item.type === "passage");
  if (coreRows.length !== CORE_TOTAL) {
    throw new Error(`Expected ${CORE_TOTAL} core items, found ${coreRows.length}`);
  }
  if (optionalRows.length !== OPTIONAL_TOTAL) {
    throw new Error(`Expected ${OPTIONAL_TOTAL} optional items, found ${optionalRows.length}`);
  }
  if (passages.length !== 1 || passages[0].item.id !== "s4-q0-passage") {
    throw new Error("Expected one unscored passage, s4-q0-passage");
  }
  const shortRows = coreRows.filter((row) => row.item.type === "short_answer");
  if (shortRows.length !== SHORT_ANSWER_TOTAL) {
    throw new Error(`Expected ${SHORT_ANSWER_TOTAL} short answers, found ${shortRows.length}`);
  }

  const records = new Map();

  function ensure(itemId) {
    if (!records.has(itemId)) {
      records.set(itemId, {
        hintSeen: false,
        askTeacher: false,
        attempts: [],
      });
    }
    return records.get(itemId);
  }

  function must(itemId) {
    const row = byId.get(itemId);
    if (!row) throw new Error(`Unknown item: ${itemId}`);
    return row;
  }

  function revealHint(itemId) {
    const row = must(itemId);
    if (row.item.type === "passage" || !row.item.hint) return getRecord(itemId);
    ensure(itemId).hintSeen = true;
    return getRecord(itemId);
  }

  function submit(itemId, response) {
    const row = must(itemId);
    const result = evaluateAnswer(row.item, response);
    if (result.blocked) {
      return { ok: false, result, record: getRecord(itemId) };
    }
    const rec = ensure(itemId);
    const entry = Object.freeze({
      response: snapshotResponse(response),
      correct: result.correct,
      referenceMatch: result.referenceMatch,
      hinted: rec.hintSeen,
      pendingTeacher: result.pendingTeacher,
    });
    rec.attempts.push(entry);
    return { ok: true, result, entry, record: getRecord(itemId) };
  }

  function flagForTeacher(itemId) {
    const row = must(itemId);
    if (row.item.type !== "gap_fill") return { ok: false, reason: "not-gap" };
    const rec = records.get(itemId);
    if (!rec || !rec.attempts.some((attempt) => attempt.correct === false)) {
      return { ok: false, reason: "not-incorrect" };
    }
    rec.askTeacher = !rec.askTeacher;
    return { ok: true, askTeacher: rec.askTeacher, record: getRecord(itemId) };
  }

  function getRecord(itemId) {
    const rec = records.get(itemId);
    if (!rec) {
      return { hintSeen: false, askTeacher: false, attempts: [] };
    }
    return {
      hintSeen: rec.hintSeen,
      askTeacher: rec.askTeacher,
      attempts: rec.attempts.map((attempt) => ({
        response: Array.isArray(attempt.response) ? [...attempt.response] : attempt.response,
        correct: attempt.correct,
        referenceMatch: attempt.referenceMatch,
        hinted: attempt.hinted,
        pendingTeacher: attempt.pendingTeacher,
      })),
    };
  }

  function classify(row, rec) {
    if (!rec || rec.attempts.length === 0) return "unanswered";
    if (row.item.type === "short_answer") return "pending";
    if (!isAutoScored(row.item)) return "unanswered";
    const first = rec.attempts[0];
    if (first.correct && !first.hinted) return "first-unassisted";
    if (rec.attempts.some((attempt) => attempt.correct)) return "hinted-or-retry";
    return "not-correct";
  }

  function countGroup(group, summary, prefix) {
    for (const row of group) {
      const rec = records.get(row.item.id);
      const kind = classify(row, rec);
      if (rec && rec.attempts.length > 0) summary[`${prefix}Submitted`] += 1;
      if (kind === "first-unassisted") summary[`${prefix}FirstUnassisted`] += 1;
      if (kind === "hinted-or-retry") summary[`${prefix}HintedOrRetry`] += 1;
      if (prefix === "core" && isAutoScored(row.item) && rec && rec.attempts.length > 0) {
        summary.coreAutoScoredSubmitted += 1;
      }
      if (prefix === "core" && row.item.type === "short_answer" && rec && rec.attempts.length > 0) {
        summary.coreShortPending += 1;
      }
      if (row.item.type === "gap_fill" && rec && rec.askTeacher) {
        summary.gapTeacherFlags += 1;
      }
    }
  }

  function summary() {
    const totals = emptySummary();
    countGroup(coreRows, totals, "core");
    countGroup(optionalRows, totals, "optional");
    totals.coreComplete = totals.coreSubmitted === CORE_TOTAL;
    return totals;
  }

  function reset() {
    records.clear();
  }

  return {
    bank,
    revealHint,
    submit,
    flagForTeacher,
    getRecord,
    summary,
    reset,
    classify(itemId) {
      return classify(must(itemId), records.get(itemId));
    },
  };
}
