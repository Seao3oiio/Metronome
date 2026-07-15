import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceMinuteDeadline,
  bpmFromTaps,
  clampBpm,
  compileRhythm,
  decodeRhythm,
  encodeRhythm,
  makeClickTrackWav,
  makeBar,
  normalizeBars,
  nextTrainingBpm,
  rhythmEventIndexAtTime,
  tempoName,
} from "./metronome.js";

test("tempo helpers keep practice input inside the supported range", () => {
  assert.equal(clampBpm(12), 30);
  assert.equal(clampBpm(300), 240);
  assert.equal(bpmFromTaps([0, 500, 1000, 1500]), 120);
  assert.equal(bpmFromTaps([0]), null);
  assert.equal(tempoName(120), "快板 · Allegro");
});

test("rhythm data and tempo training stay predictable", () => {
  assert.deepEqual(makeBar(2, 2), {
    beats: [
      { enabled: true, steps: [2, 1] },
      { enabled: true, steps: [1, 1] },
    ],
  });
  assert.deepEqual(normalizeBars([{ beats: [{ enabled: false, steps: [0, 2] }] }]), [
    { beats: [{ enabled: false, steps: [0, 2] }] },
  ]);
  assert.equal(nextTrainingBpm(100, 105, 3), 103);
  assert.equal(nextTrainingBpm(103, 105, 3), 105);
  assert.equal(nextTrainingBpm(120, 100, 7), 113);
  assert.equal(advanceMinuteDeadline(59.9, 60), null);
  assert.equal(advanceMinuteDeadline(60, 60), 120);
  assert.equal(advanceMinuteDeadline(185, 60), 240);
});

test("mixed subdivisions return to exact beat and bar boundaries", () => {
  const bars = [
    {
      beats: [
        { enabled: true, steps: Array(7).fill(1) },
        { enabled: true, steps: Array(11).fill(1) },
      ],
    },
    makeBar(3, 1),
  ];
  const all = compileRhythm(bars, null, 192);
  const secondBeat = all.events.find((event) => event.bar === 0 && event.beat === 1);
  const secondBar = all.events.find((event) => event.bar === 1);

  assert.equal(secondBeat.ticks, 192);
  assert.equal(secondBar.ticks, 384);
  assert.equal(all.totalTicks, 960);
  assert.equal(compileRhythm(bars, 1, 192).totalTicks, 576);
  assert.equal(rhythmEventIndexAtTime(0.5, 120, compileRhythm([makeBar(2, 1)], null, 1)), 1);
});

test("rhythm codes round-trip and reject malformed data", () => {
  const rhythm = { bpm: 108, bars: [makeBar(2, 3), makeBar(4, 1)], loopBar: 1 };
  assert.deepEqual(decodeRhythm(encodeRhythm(rhythm)), rhythm);
  assert.throws(() => decodeRhythm("not-a-rhythm"));
});

test("click tracks are valid looping PCM WAV files", () => {
  const wav = makeClickTrackWav(
    { bpm: 120, bars: [makeBar(2, 1)], loopBar: null, sound: "click" },
    8000,
    2,
  );
  const view = new DataView(wav);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), "RIFF");
  assert.equal(view.getUint32(24, true), 8000);
  assert.equal(view.getUint32(40, true), 32000);
  assert.ok(new Int16Array(wav, 44).some(Boolean));
});
