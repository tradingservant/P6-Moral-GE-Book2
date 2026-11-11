import assert from "node:assert/strict";
import test from "node:test";
import bank from "../data/exercises.json" with { type: "json" };
import { evaluateAnswer, normalizeText } from "../src/scoring.js";
import { createSession } from "../src/session.js";

function item(id) {
  for (const station of bank.stations) {
    const found = station.items.find((entry) => entry.id === id);
    if (found) return found;
  }
  throw new Error(id);
}

function answered(session, id) {
  return session.getRecord(id).attempts;
}

test("normalises only the specified differences", () => {
  assert.equal(normalizeText("  Wet. "), "wet");
  assert.equal(normalizeText("WET。"), "wet");
  assert.equal(normalizeText("wet\u00A0"), "wet");
  assert.equal(normalizeText("too  dark"), "too dark");
  assert.equal(normalizeText("  IS. "), "is");
  assert.equal(normalizeText("Don’t have."), "don't have");
  assert.equal(normalizeText("Don\u2018t have"), "don't have");
  assert.equal(normalizeText("Don\u02BCt have"), "don't have");
  assert.equal(normalizeText("Don\uFF07t have"), "don't have");
  assert.equal(normalizeText("dont have"), "dont have");
  assert.notEqual(normalizeText("dont have"), normalizeText("don't have"));
  assert.equal(normalizeText("i.s"), "i.s");
  assert.notEqual(normalizeText("i.s"), "is");
  assert.equal(normalizeText("There is very little clean water."), "there is very little clean water");

  const wet = item("s2-q3");
  assert.equal(evaluateAnswer(wet, "  WET。 ").correct, true);
  assert.equal(evaluateAnswer(wet, "damp").correct, true);
  assert.equal(evaluateAnswer(wet, "wett").correct, false);
  assert.equal(evaluateAnswer(wet, "wett").blocked, false);

  const dark = item("s2-q8");
  assert.equal(evaluateAnswer(dark, "too  dark").correct, true);
  assert.equal(evaluateAnswer(dark, "too darke").correct, false);

  const verb = item("s5-q8");
  assert.equal(evaluateAnswer(verb, "Don’t have.").correct, true);
  assert.equal(evaluateAnswer(verb, "dont have").correct, false);

  const water = item("s3-q11");
  assert.equal(evaluateAnswer(water, "there is very little clean water").correct, true);
  assert.equal(evaluateAnswer(water, "There is not enough clean water.").correct, true);
  assert.equal(evaluateAnswer(water, "There are very little clean water.").correct, false);

  const choice = item("s1-q1");
  assert.equal(evaluateAnswer(choice, "An Earthquake").correct, false);
  assert.equal(evaluateAnswer(choice, "an earthquake").correct, true);
});

test("multi-select scores only an exact set and blocks the wrong count", () => {
  const two = item("s4-q3");
  const correct = [...two.answer];
  const swapped = [correct[1], correct[0]];
  const wrongPair = [two.options[0], two.options[3]];
  assert.equal(evaluateAnswer(two, correct).correct, true);
  assert.equal(evaluateAnswer(two, swapped).correct, true);
  const mismatch = evaluateAnswer(two, wrongPair);
  assert.equal(mismatch.blocked, false);
  assert.equal(mismatch.correct, false);
  assert.equal(evaluateAnswer(two, [correct[0]]).blocked, true);
  assert.equal(evaluateAnswer(two, [...correct, two.options[0]]).blocked, true);
  assert.equal(evaluateAnswer(two, []).blocked, true);

  const four = item("s6-q1");
  assert.equal(evaluateAnswer(four, [...four.answer]).correct, true);
  assert.equal(evaluateAnswer(four, four.answer.slice(0, 3)).blocked, true);
  const repeated = evaluateAnswer(four, [four.answer[0], four.answer[0], four.answer[0], four.answer[0]]);
  assert.equal(repeated.blocked, false);
  assert.equal(repeated.correct, false);
});

test("first unassisted and hinted or retry results stay separate and immutable", () => {
  const session = createSession(bank);
  const correct = item("s1-q1").answer;
  const wrong = item("s1-q1").options[0];

  session.submit("s1-q1", correct);
  assert.equal(session.summary().coreFirstUnassisted, 1);
  assert.equal(session.summary().coreHintedOrRetry, 0);
  const frozen = JSON.stringify(answered(session, "s1-q1")[0]);

  session.revealHint("s1-q1");
  session.submit("s1-q1", wrong);
  assert.equal(JSON.stringify(answered(session, "s1-q1")[0]), frozen);
  assert.equal(answered(session, "s1-q1")[0].correct, true);
  assert.equal(answered(session, "s1-q1")[0].hinted, false);
  assert.equal(session.summary().coreFirstUnassisted, 1);
  assert.equal(session.summary().coreHintedOrRetry, 0);
  assert.equal(session.classify("s1-q1"), "first-unassisted");

  session.revealHint("s1-q2");
  session.submit("s1-q2", item("s1-q2").answer);
  assert.equal(session.summary().coreFirstUnassisted, 1);
  assert.equal(session.summary().coreHintedOrRetry, 1);
  assert.equal(answered(session, "s1-q2")[0].hinted, true);
  assert.equal(session.classify("s1-q2"), "hinted-or-retry");

  session.submit("s1-q3", item("s1-q3").options[0]);
  assert.equal(answered(session, "s1-q3")[0].hinted, false);
  assert.equal(session.summary().coreFirstUnassisted, 1);
  session.revealHint("s1-q3");
  session.submit("s1-q3", item("s1-q3").answer);
  assert.equal(JSON.stringify(answered(session, "s1-q3")[0].response), JSON.stringify(item("s1-q3").options[0]));
  assert.equal(session.summary().coreFirstUnassisted, 1);
  assert.equal(session.summary().coreHintedOrRetry, 2);
  assert.equal(session.summary().coreSubmitted, 3);
  assert.equal(session.summary().coreAutoScoredSubmitted, 3);
});

test("a blocked or empty submission does not create a first result", () => {
  const session = createSession(bank);
  const blocked = session.submit("s4-q3", [item("s4-q3").answer[0]]);
  assert.equal(blocked.ok, false);
  assert.equal(answered(session, "s4-q3").length, 0);
  assert.equal(session.submit("s2-q3", "   ").ok, false);
  assert.equal(session.summary().coreSubmitted, 0);
});

test("short answers stay pending and never become formal points", () => {
  const session = createSession(bank);
  const prompt = item("s4-q4");
  const outcome = session.submit("s4-q4", `  ${prompt.answer.toUpperCase()}  `);
  assert.equal(outcome.entry.referenceMatch, true);
  assert.equal(outcome.entry.correct, false);
  assert.equal(outcome.entry.pendingTeacher, true);
  const totals = session.summary();
  assert.equal(totals.coreSubmitted, 1);
  assert.equal(totals.coreShortPending, 1);
  assert.equal(totals.coreFirstUnassisted, 0);
  assert.equal(totals.coreHintedOrRetry, 0);
  assert.equal(totals.coreAutoScoredSubmitted, 0);
  assert.equal(totals.coreComplete, false);
  assert.equal("officialScore" in totals, false);
  assert.equal("mastery" in totals, false);

  const firstText = outcome.entry.response;
  session.submit("s4-q4", "not the road");
  assert.equal(answered(session, "s4-q4")[0].response, firstText);
  assert.equal(answered(session, "s4-q4")[1].referenceMatch, false);
  assert.equal(session.summary().coreShortPending, 1);
  assert.equal(session.summary().coreFirstUnassisted, 0);
});

test("a gap-fill teacher flag is separate from short-answer review", () => {
  const session = createSession(bank);
  assert.equal(session.flagForTeacher("s2-q3").ok, false);
  session.submit("s2-q3", "wett");
  assert.equal(session.summary().coreShortPending, 0);
  assert.equal(session.summary().gapTeacherFlags, 0);
  assert.equal(session.flagForTeacher("s2-q3").ok, true);
  assert.equal(session.summary().gapTeacherFlags, 1);
  assert.equal(session.summary().coreShortPending, 0);
  assert.equal(session.summary().coreFirstUnassisted, 0);
  session.submit("s2-q3", "wet");
  assert.equal(session.summary().coreFirstUnassisted, 0);
  assert.equal(session.summary().coreHintedOrRetry, 1);
  assert.equal(session.summary().gapTeacherFlags, 1);
  assert.equal(session.flagForTeacher("s4-q4").ok, false);
});

test("optional station 8 does not change the core counts", () => {
  const session = createSession(bank);
  session.submit("s8-q1", item("s8-q1").answer);
  session.revealHint("s8-q2");
  session.submit("s8-q2", item("s8-q2").answer);
  const totals = session.summary();
  assert.equal(totals.coreSubmitted, 0);
  assert.equal(totals.coreFirstUnassisted, 0);
  assert.equal(totals.coreHintedOrRetry, 0);
  assert.equal(totals.optionalSubmitted, 2);
  assert.equal(totals.optionalFirstUnassisted, 1);
  assert.equal(totals.optionalHintedOrRetry, 1);
  assert.equal(totals.coreComplete, false);
});

test("reset and a new session both drop every result", () => {
  const session = createSession(bank);
  session.submit("s1-q1", item("s1-q1").answer);
  session.revealHint("s1-q2");
  session.flagForTeacher("s2-q3");
  session.reset();
  assert.deepEqual(session.summary(), freshSummary());
  assert.equal(answered(session, "s1-q1").length, 0);
  assert.equal(session.getRecord("s1-q2").hintSeen, false);

  const again = createSession(bank);
  again.submit("s7-q1", item("s7-q1").answer);
  assert.equal(createSession(bank).summary().coreSubmitted, 0);
  assert.equal(again.summary().coreFirstUnassisted, 1);
});

test("submitting all 57 core items is completion, not a formal score", () => {
  const session = createSession(bank);
  for (const station of bank.stations) {
    if (!station.core) continue;
    for (const entry of station.items) {
      if (entry.type === "passage") continue;
      const response = entry.type === "multi_select" ? entry.answer : entry.answer;
      const outcome = session.submit(entry.id, response);
      assert.equal(outcome.ok, true, entry.id);
    }
  }
  const totals = session.summary();
  assert.equal(totals.coreSubmitted, 57);
  assert.equal(totals.coreComplete, true);
  assert.equal(totals.coreShortPending, 4);
  assert.equal(totals.coreFirstUnassisted, 53);
  assert.equal(totals.coreHintedOrRetry, 0);
  assert.equal(totals.coreAutoScoredSubmitted, 53);
  assert.equal(totals.optionalSubmitted, 0);
  assert.equal(Object.hasOwn(totals, "officialScore"), false);
});

function freshSummary() {
  return {
    coreSubmitted: 0,
    coreTotal: 57,
    coreFirstUnassisted: 0,
    coreHintedOrRetry: 0,
    coreAutoScoredSubmitted: 0,
    coreShortPending: 0,
    coreShortTotal: 4,
    gapTeacherFlags: 0,
    coreComplete: false,
    optionalSubmitted: 0,
    optionalTotal: 5,
    optionalFirstUnassisted: 0,
    optionalHintedOrRetry: 0,
  };
}
