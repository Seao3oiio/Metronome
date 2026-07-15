import test from "node:test";
import assert from "node:assert/strict";
import { FLAG_GLYPHS, REST_GLYPHS } from "./bravuraGlyphs.js";
import {
  advanceMinuteDeadline,
  applyBeatPattern,
  bpmFromTaps,
  clampBpm,
  compileRhythm,
  cycleBeatState,
  decodeRhythm,
  encodeRhythm,
  makeClickTrackWav,
  makeGapPattern,
  makeBar,
  moveBarSelection,
  normalizeBars,
  normalizeLoopRange,
  nextTrainingBpm,
  rhythmEventIndexAtTime,
  rhythmDefaultName,
  removeBarSelection,
  tempoName,
  toggleBeatStep,
} from "./metronome.js";

test("notation glyphs cover every supported note value", () => {
  assert.deepEqual(Object.keys(FLAG_GLYPHS), ["1", "2", "3", "4"]);
  assert.deepEqual(Object.keys(REST_GLYPHS), ["2", "4", "8", "16", "32", "64"]);
});

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
      { steps: [2, 1] },
      { steps: [1, 1] },
    ],
  });
  assert.deepEqual(normalizeBars([{ beats: [{ enabled: false, steps: [0, 2] }] }]), [
    { beats: [{ steps: [0, 0] }] },
  ]);
  assert.equal(normalizeBars(Array.from({ length: 80 }, () => makeBar(1))).length, 80);
  assert.deepEqual(normalizeLoopRange([4, 2], 6), [2, 4]);
  assert.equal(normalizeLoopRange([2, 6], 6), null);
  const removed = removeBarSelection(
    [makeBar(1), makeBar(2), makeBar(3), makeBar(4)],
    [1, 2],
    [1, 3],
  );
  assert.deepEqual(removed, {
    bars: [makeBar(1), makeBar(4)],
    loopBar: [1, 1],
    index: 1,
  });
  assert.deepEqual(removeBarSelection([makeBar(2)], [0], [0, 0]), {
    bars: [makeBar(4, 1)],
    loopBar: null,
    index: 0,
  });
  assert.equal(nextTrainingBpm(100, 105, 3), 103);
  assert.equal(nextTrainingBpm(103, 105, 3), 105);
  assert.equal(nextTrainingBpm(120, 100, 7), 113);
  assert.equal(advanceMinuteDeadline(59.9, 60), null);
  assert.equal(advanceMinuteDeadline(60, 60), 120);
  assert.equal(advanceMinuteDeadline(185, 60), 240);

  const accent = cycleBeatState({ steps: [0, 1] });
  const normal = cycleBeatState(accent);
  assert.deepEqual(accent, { steps: [0, 2] });
  assert.deepEqual(normal, { steps: [0, 1] });
  assert.deepEqual(toggleBeatStep({ steps: [0, 0] }, 1), { steps: [0, 1] });
  assert.deepEqual(applyBeatPattern([accent, normal], [1, 1, 1], 3), [
    { steps: [2, 1, 1] },
    { steps: [1, 1, 1] },
    { steps: [1, 1, 1] },
  ]);
});

test("selected bars move together without changing their order", () => {
  assert.deepEqual(moveBarSelection(["a", "b", "c", "d"], [1, 3], -1), {
    bars: ["b", "a", "d", "c"],
    order: [1, 0, 3, 2],
  });
  assert.deepEqual(moveBarSelection(["a", "b", "c", "d"], [1, 2], 1), {
    bars: ["a", "d", "b", "c"],
    order: [0, 3, 1, 2],
  });
});

test("mixed subdivisions return to exact beat and bar boundaries", () => {
  const bars = [
    {
      beats: [
        { steps: Array(7).fill(1) },
        { steps: Array(11).fill(1) },
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
  assert.equal(compileRhythm(bars, [1, 1], 192).totalTicks, 576);
  assert.deepEqual(
    [...new Set(compileRhythm([makeBar(1), makeBar(2), makeBar(3)], [1, 2], 1).events.map(({ bar }) => bar))],
    [1, 2],
  );
  assert.equal(rhythmEventIndexAtTime(0.5, 120, compileRhythm([makeBar(2, 1)], null, 1)), 1);
});

test("rhythm codes round-trip and reject malformed data", () => {
  const rhythm = {
    bpm: 108,
    beatUnit: 8,
    bars: [makeBar(2, 3), makeBar(4, 1)],
    loopBar: [0, 1],
  };
  assert.deepEqual(decodeRhythm(encodeRhythm(rhythm)), rhythm);
  const longRhythm = {
    ...rhythm,
    bars: Array.from({ length: 400 }, () => makeBar(1)),
    loopBar: [120, 319],
  };
  assert.deepEqual(decodeRhythm(encodeRhythm(longRhythm)), longRhythm);
  const oldCode = btoa(JSON.stringify({ v: 1, bpm: 96, bars: [makeBar(4, 1)], loopBar: null }));
  assert.throws(() => decodeRhythm(oldCode));
  assert.throws(() => decodeRhythm("not-a-rhythm"));
});

test("new rhythms have a useful 4/4 default name", () => {
  assert.equal(rhythmDefaultName({ bpm: 96, bars: [makeBar(4, 1)] }), "4/4 · 四分 · 96 BPM");
  assert.equal(
    rhythmDefaultName({ bpm: 120, beatUnit: 8, bars: [makeBar(3, 2), makeBar(2, 3)] }),
    "2 小节 · 自定义 · 120 BPM",
  );
  assert.equal(
    rhythmDefaultName({ bpm: 80, beatUnit: 8, bars: [makeBar(6, 2)] }),
    "6/8 · 十六分 · 80 BPM",
  );
});

test("gap click starts with sound and keeps each difficulty inside its ranges", () => {
  const ranges = {
    easy: { sound: [3, 5], mute: [1, 1] },
    medium: { sound: [2, 4], mute: [1, 2] },
    hard: { sound: [1, 3], mute: [2, 4] },
  };

  for (const [difficulty, limits] of Object.entries(ranges)) {
    for (let barCount = 1; barCount <= 8; barCount += 1) {
      const pattern = makeGapPattern(difficulty, barCount, () => 0);
      assert.deepEqual(pattern.slice(0, 2), [false, false]);
      assert.equal(pattern.length % barCount, 0);
      assert.equal(pattern.at(-1), true);

      const runs = pattern.reduce((result, muted) => {
        const last = result.at(-1);
        if (last?.muted === muted) last.length += 1;
        else result.push({ muted, length: 1 });
        return result;
      }, []);
      runs.forEach((run, index) => {
        const [min, max] = run.muted ? limits.mute : limits.sound;
        assert.ok(run.length >= (index === 0 ? Math.max(2, min) : min));
        assert.ok(run.length <= max);
      });
    }
  }

  assert.equal(makeGapPattern("medium", 50_000, () => 0.5).length, 50_000);

  const plan = compileRhythm([makeBar(1, 1)], null, 1, [false, true]);
  assert.equal(plan.totalTicks, 2);
  assert.deepEqual(plan.events.map(({ gap }) => gap), [false, true]);
});

test("click tracks are valid looping PCM WAV files", () => {
  const partialBeat = new Int16Array(
    makeClickTrackWav(
      {
        bpm: 120,
        bars: [{ beats: [{ steps: [0, 1] }] }],
        loopBar: null,
        sound: "click",
      },
      8000,
      1,
    ),
    44,
  );
  assert.ok(partialBeat.subarray(0, 2000).every((sample) => sample === 0));
  assert.ok(partialBeat.subarray(2000).some(Boolean));

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

  const gapWav = makeClickTrackWav(
    { bpm: 240, bars: [makeBar(1, 12)], loopBar: null, sound: "drum" },
    8000,
    1,
    [false, true],
  );
  const samples = new Int16Array(gapWav, 44);
  assert.ok(samples.subarray(0, 2000).some(Boolean));
  assert.ok(samples.subarray(2000).every((sample) => sample === 0));
});
