import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import bank from "../data/exercises.json" with { type: "json" };
import { evaluateAnswer, requiredSelectCount } from "../src/scoring.js";

const ITEM_HASH = "1075a5a9a47640df51a9959a1d71a235577ab352e661be2ea9080ffd2c38e8dc";

function rows() {
  const list = [];
  for (const station of bank.stations) {
    for (const item of station.items) list.push({ station, item });
  }
  return list;
}

test("question bank keeps the original stations, items, and wording", () => {
  const payload = bank.stations.map((station) => ({ id: station.id, items: station.items }));
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  assert.equal(hash, ITEM_HASH);

  assert.equal(bank.meta.title, "Module 2 online practice: Helping our world");
  assert.equal(bank.meta.core_scored_items, 57);
  assert.equal(bank.meta.optional_scored_items, 5);
  assert.equal(bank.meta.language.directions, "Formal written Traditional Chinese");
  assert.deepEqual(
    bank.stations.map((station) => station.id),
    ["station-1", "station-2", "station-3", "station-4", "station-5", "station-6", "station-7", "station-8"],
  );
  assert.deepEqual(
    bank.meta.station_counts,
    {
      "station-1": 10,
      "station-2": 8,
      "station-3": 12,
      "station-4": 7,
      "station-5": 8,
      "station-6": 6,
      "station-7": 6,
      "station-8": 5,
    },
  );

  const all = rows();
  const types = {};
  for (const { item } of all) types[item.type] = (types[item.type] || 0) + 1;
  assert.deepEqual(types, { mcq: 42, gap_fill: 14, multi_select: 2, short_answer: 4, passage: 1 });
  assert.equal(all.length, 63);

  const scored = all.filter(({ item }) => item.type !== "passage");
  assert.equal(scored.filter(({ station }) => station.core).length, 57);
  assert.equal(scored.filter(({ station }) => !station.core).length, 5);

  for (const station of bank.stations) {
    const questions = station.items.filter((item) => item.type !== "passage");
    assert.equal(questions.length, station.item_count, station.id);
    assert.equal(station.core, station.id !== "station-8");
    assert.equal(station.optional, station.id === "station-8");
  }

  const passage = all.find(({ item }) => item.id === "s4-q0-passage");
  assert.equal(passage.item.type, "passage");
  assert.equal(passage.station.id, "station-4");
  assert.equal(passage.item.passage_title, "After the Earthquake");
  assert.match(passage.item.passage_text, /Last winter, a strong earthquake shook Green Hill Village/);
  assert.equal(bank.stations[3].items[0].id, "s4-q0-passage");
  assert.deepEqual(
    bank.stations[3].items.map((item) => item.id),
    ["s4-q0-passage", "s4-q1", "s4-q2", "s4-q3", "s4-q4", "s4-q5", "s4-q6", "s4-q7"],
  );

  const ids = all.map(({ item }) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["s4-q3", "s6-q1", "s4-q4", "s4-q5", "s4-q6", "s4-q7"]) {
    assert.ok(ids.includes(id), id);
  }
  assert.deepEqual(
    all.filter(({ item }) => item.type === "short_answer").map(({ item }) => item.id),
    ["s4-q4", "s4-q5", "s4-q6", "s4-q7"],
  );

  const multiTwo = all.find(({ item }) => item.id === "s4-q3").item;
  assert.equal(multiTwo.type, "multi_select");
  assert.equal(requiredSelectCount(multiTwo), 2);
  assert.deepEqual(multiTwo.answer, [
    "B. Mr Ho thinks people can stop earthquakes from happening.",
    "C. The government is doing nothing to prepare for the next earthquake.",
  ]);
  assert.equal(multiTwo.hint, "The question asks for the statements that are NOT true. You must choose two.");

  const multiFour = all.find(({ item }) => item.id === "s6-q1").item;
  assert.equal(requiredSelectCount(multiFour), 4);
  assert.deepEqual(multiFour.answer, [
    "charity work",
    "fundraising work",
    "a charity event",
    "a fundraising event",
  ]);

  const earthquake = all.find(({ item }) => item.id === "s1-q1").item;
  assert.equal(earthquake.prompt, "The ground shakes. Houses may collapse and people may be trapped inside. What is this?");
  assert.equal(earthquake.answer, "an earthquake");
  assert.equal(earthquake.hint, "Think about the ground moving, not a wave from the sea.");
  assert.equal(earthquake.feedback_correct, "Yes. When the ground shakes and buildings fall, it is an earthquake.");
  assert.match(earthquake.feedback_by_option["a tsunami"], /booklet P\.1/);

  const quantity = all.find(({ item }) => item.id === "s3-q1").item;
  assert.match(quantity.feedback_correct, /In free writing/);
  assert.match(quantity.feedback_incorrect, /In free writing/);

  const raw = readFileSync(new URL("../data/exercises.json", import.meta.url), "utf8");
  assert.doesNotMatch(raw, /Moral|\/workspace|sheet-info|Apps Script|localStorage/i);
});

test("every published answer matches the marker and wrong choices do not", () => {
  for (const { item } of rows()) {
    if (item.type === "passage") {
      assert.equal(evaluateAnswer(item, "anything").blocked, true);
      continue;
    }
    assert.ok(item.prompt && item.hint && item.feedback_correct && item.feedback_incorrect, item.id);
    assert.ok(Array.isArray(item.acceptable_answers) && item.acceptable_answers.length > 0, item.id);

    if (item.type === "mcq") {
      assert.ok(item.options.includes(item.answer), item.id);
      assert.equal(evaluateAnswer(item, item.answer).correct, true, item.id);
      for (const option of item.options) {
        if (option === item.answer) continue;
        assert.equal(evaluateAnswer(item, option).correct, false, `${item.id} ${option}`);
      }
      if (item.feedback_by_option) {
        for (const key of Object.keys(item.feedback_by_option)) {
          assert.ok(item.options.includes(key), `${item.id} ${key}`);
        }
      }
    }

    if (item.type === "gap_fill" || item.type === "short_answer") {
      for (const phrase of item.acceptable_answers) {
        const result = evaluateAnswer(item, phrase);
        assert.equal(result.referenceMatch, true, `${item.id} :: ${phrase}`);
        assert.equal(result.correct, item.type === "gap_fill", item.id);
        assert.equal(result.pendingTeacher, item.type === "short_answer", item.id);
      }
      const typo = evaluateAnswer(item, `${item.answer}xyz`);
      assert.equal(typo.referenceMatch, false, item.id);
      assert.equal(typo.correct, false, item.id);
    }

    if (item.type === "multi_select") {
      for (const option of item.answer) assert.ok(item.options.includes(option), item.id);
      assert.equal(evaluateAnswer(item, item.answer).correct, true, item.id);
      assert.equal(evaluateAnswer(item, [...item.answer].reverse()).correct, true, item.id);
      assert.equal(evaluateAnswer(item, item.answer.slice(0, -1)).blocked, true, item.id);
    }
  }
});
