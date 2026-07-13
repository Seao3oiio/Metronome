import test from "node:test";
import assert from "node:assert/strict";
import {
  bpmFromTaps,
  clampBpm,
  makePattern,
  nextTrainingBpm,
  tempoName,
} from "./metronome.js";

test("tempo helpers keep practice input inside the supported range", () => {
  assert.equal(clampBpm(12), 30);
  assert.equal(clampBpm(300), 240);
  assert.equal(bpmFromTaps([0, 500, 1000, 1500]), 120);
  assert.equal(bpmFromTaps([0]), null);
  assert.equal(tempoName(120), "快板 · Allegro");
});

test("patterns and tempo training stay predictable", () => {
  assert.deepEqual(makePattern(2, 2), [2, 1, 1, 1]);
  assert.deepEqual(makePattern(2, 3, "main"), [2, 0, 0, 1, 0, 0]);
  assert.equal(nextTrainingBpm(100, 105, 3), 103);
  assert.equal(nextTrainingBpm(103, 105, 3), 105);
  assert.equal(nextTrainingBpm(120, 100, 7), 113);
});
