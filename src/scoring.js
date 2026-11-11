/**
 * Marking rules for the static practice page.
 * Gap-fill and short-answer comparison is normalised only as specified:
 * trim, collapse whitespace, ignore a trailing full stop, ignore case,
 * and treat curly and straight apostrophes as the same.
 * There is no fuzzy spelling match.
 * Multi-select scores only on an exact set match.
 */

const APOSTROPHES = /[\u2019\u2018\u02BC\uFF07]/g;

export function normalizeText(value) {
  if (typeof value !== "string") return "";
  let text = value.replace(APOSTROPHES, "'");
  text = text.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  text = text.replace(/[.。]+$/g, "").trim();
  return text.toLowerCase();
}

export function isAutoScored(item) {
  return item.type === "mcq" || item.type === "gap_fill" || item.type === "multi_select";
}

export function isScoredType(item) {
  return item.type === "mcq" || item.type === "gap_fill" || item.type === "multi_select" || item.type === "short_answer";
}

function acceptedPhrases(item) {
  const phrases = [];
  if (typeof item.answer === "string" && item.answer.trim()) phrases.push(item.answer);
  if (Array.isArray(item.acceptable_answers)) {
    for (const entry of item.acceptable_answers) {
      if (typeof entry === "string" && entry.trim()) phrases.push(entry);
    }
  }
  return phrases;
}

function acceptedSets(item) {
  const sets = [];
  if (Array.isArray(item.answer) && item.answer.every((entry) => typeof entry === "string")) {
    sets.push(item.answer);
  }
  if (Array.isArray(item.acceptable_answers)) {
    for (const entry of item.acceptable_answers) {
      if (Array.isArray(entry) && entry.every((part) => typeof part === "string")) sets.push(entry);
    }
  }
  return sets;
}

export function requiredSelectCount(item) {
  if (!item || item.type !== "multi_select") return 0;
  if (Array.isArray(item.answer)) return item.answer.length;
  const sets = acceptedSets(item);
  return sets.length ? sets[0].length : 0;
}

function sameMembers(left, right) {
  if (left.length !== right.length) return false;
  const pool = [...right];
  for (const value of left) {
    const index = pool.indexOf(value);
    if (index === -1) return false;
    pool.splice(index, 1);
  }
  return pool.length === 0;
}

function block(reason, extra = {}) {
  return {
    blocked: true,
    reason,
    correct: false,
    referenceMatch: false,
    pendingTeacher: false,
    ...extra,
  };
}

export function evaluateAnswer(item, response) {
  if (!item || item.type === "passage") return block("unscored");

  if (item.type === "mcq") {
    if (typeof response !== "string" || response.length === 0) return block("empty");
    const correct = acceptedPhrases(item).some((phrase) => phrase === response);
    return {
      blocked: false,
      reason: "",
      correct,
      referenceMatch: correct,
      pendingTeacher: false,
    };
  }

  if (item.type === "multi_select") {
    if (!Array.isArray(response) || response.some((entry) => typeof entry !== "string")) {
      return block("empty");
    }
    const need = requiredSelectCount(item);
    if (response.length !== need) {
      return block("count", { need, selectedCount: response.length });
    }
    const correct = acceptedSets(item).some((set) => sameMembers(set, response));
    return {
      blocked: false,
      reason: "",
      correct,
      referenceMatch: correct,
      pendingTeacher: false,
      need,
      selectedCount: response.length,
    };
  }

  if (item.type === "gap_fill" || item.type === "short_answer") {
    if (typeof response !== "string" || normalizeText(response).length === 0) return block("empty");
    const student = normalizeText(response);
    const referenceMatch = acceptedPhrases(item).some((phrase) => normalizeText(phrase) === student);
    if (item.type === "short_answer") {
      return {
        blocked: false,
        reason: "",
        correct: false,
        referenceMatch,
        pendingTeacher: true,
      };
    }
    return {
      blocked: false,
      reason: "",
      correct: referenceMatch,
      referenceMatch,
      pendingTeacher: false,
    };
  }

  return block("unknown");
}
