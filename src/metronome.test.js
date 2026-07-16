import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FLAG_GLYPHS, REST_GLYPHS } from "./bravuraGlyphs.js";
import { clonePracticeRhythm, PRACTICE_PRESET_WEEKS } from "./practicePresets.js";
import { musicXmlToRhythm } from "./musicXml.js";
import {
  BEAT_UNITS,
  advanceMinuteDeadline,
  analyzeRhythmRecording,
  applyBeatPattern,
  bpmFromTaps,
  clampBpm,
  compileRhythm,
  cycleBeatState,
  decodeRhythm,
  detectGuitarOnsets,
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

test("the PDF practice library covers all 7 weeks and 66 exercises", () => {
  const exercises = PRACTICE_PRESET_WEEKS.flatMap(({ exercises }) => exercises);
  const presets = exercises.flatMap(({ presets }) => presets);

  assert.equal(PRACTICE_PRESET_WEEKS.length, 7);
  assert.equal(exercises.length, 66);
  assert.equal(presets.length, 92);
  assert.equal(new Set(exercises.map(({ id }) => id)).size, exercises.length);
  assert.equal(new Set(presets.map(({ id }) => id)).size, presets.length);
  presets.forEach((preset) => {
    const rhythm = clonePracticeRhythm(preset);
    assert.equal(clampBpm(rhythm.bpm), rhythm.bpm);
    assert.ok(BEAT_UNITS.includes(rhythm.beatUnit));
    assert.deepEqual(normalizeBars(rhythm.bars), rhythm.bars);
  });
});

test("every catalog entry has a readable MusicXML score matching the generated preset", () => {
  const scoresRoot = new URL("../resources/scores/", import.meta.url);
  const catalog = JSON.parse(readFileSync(new URL("catalog.json", scoresRoot), "utf8"));
  const catalogExercises = catalog.flatMap(({ exercises }) => exercises);
  const catalogPresets = catalogExercises.flatMap(({ pages, presets }) =>
    presets.map((preset) => ({ ...preset, pages })),
  );
  const generatedPresets = new Map(
    PRACTICE_PRESET_WEEKS.flatMap(({ exercises }) =>
      exercises.flatMap(({ presets }) => presets.map((preset) => [preset.id, preset])),
    ),
  );

  assert.equal(catalog.length, 7);
  assert.equal(catalogExercises.length, 66);
  assert.equal(catalogPresets.length, 92);
  assert.equal(new Set(catalogPresets.map(({ id }) => id)).size, 92);
  assert.equal(new Set(catalogPresets.map(({ source }) => source)).size, 92);
  catalogExercises.forEach(({ pages }) => assert.ok(pages.length > 0));
  assert.deepEqual(catalogExercises.find(({ id }) => id === "w3-ex8").pages, [35, 36]);
  assert.deepEqual(catalogExercises.find(({ id }) => id === "w3-ex9").pages, [37]);
  catalogPresets.forEach(({ id, source, pages }) => {
    const xml = readFileSync(new URL(source, scoresRoot), "utf8");
    assert.match(xml, new RegExp(`<source>PDF pages ${pages.join(", ")}</source>`));
    const parsed = musicXmlToRhythm(xml);
    const preset = generatedPresets.get(id);
    assert.ok(preset, `missing generated preset ${id}`);
    assert.deepEqual(parsed, {
      bpm: preset.bpm,
      beatUnit: preset.beatUnit,
      bars: preset.bars,
      loopBar: preset.loopBar,
    });
  });
});

test("Qing Hua Ci triggers once per written note onset", () => {
  const preset = PRACTICE_PRESET_WEEKS[1].exercises.find(({ id }) => id === "w2-ex9").presets[0];
  const attacks = preset.bars.map((bar) =>
    bar.beats
      .flatMap(({ steps }) => steps.length === 1 ? [steps[0], 0] : steps)
      .map((step) => (step ? "x" : "-"))
      .join(""),
  );

  assert.equal(attacks.length, 16);
  assert.deepEqual(attacks.slice(0, 4), ["-----xxx", "x-xxx-xx", "xxx--xxx", "x-xxx-xx"]);
  assert.equal(attacks.at(-1), "--------");
});

test("MusicXML converts rests, durations, chords, ties, and accents to note onsets", () => {
  const xml = `<?xml version="1.0"?>
    <score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Rhythm</part-name></score-part></part-list>
      <part id="P1"><measure number="1">
        <attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <direction><sound tempo="80"/></direction>
        <note><rest/><duration>2</duration><type>quarter</type></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><notations><articulations><accent/></articulations></notations></note>
        <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type></note>
        <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type></note>
        <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>
        <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><tie type="stop"/></note>
      </measure></part>
    </score-partwise>`;

  assert.deepEqual(musicXmlToRhythm(xml), {
    bpm: 80,
    beatUnit: 4,
    bars: [{ beats: [
      { steps: [0] },
      { steps: [2, 1] },
      { steps: [1] },
      { steps: [0] },
    ] }],
    loopBar: null,
  });
});

test("MusicXML reads later tempo directions, beat units, and notation ties", () => {
  const xml = `<?xml version="1.0"?>
    <score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Rhythm</part-name></score-part></part-list>
      <part id="P1"><measure number="1">
        <attributes><divisions>2</divisions><time><beats>6</beats><beat-type>8</beat-type></time></attributes>
        <direction><direction-type><words>With energy</words></direction-type></direction>
        <direction><sound tempo="60"/></direction>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><notations><tied type="stop"/></notations></note>
        <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note>
        <note><rest/><duration>4</duration></note>
      </measure></part>
    </score-partwise>`;

  assert.deepEqual(musicXmlToRhythm(xml), {
    bpm: 120,
    beatUnit: 8,
    bars: [{ beats: [
      { steps: [0] },
      { steps: [1] },
      { steps: [0] },
      { steps: [0] },
      { steps: [0] },
      { steps: [0] },
    ] }],
    loopBar: null,
  });
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

test("guitar timing analysis detects attacks, aligns latency, and flags an extra note", () => {
  const sampleRate = 8000;
  const samples = new Float32Array(sampleRate * 3);
  [0.23, 0.42, 0.74, 1.19, 1.78].forEach((onset) => {
    const start = Math.round(onset * sampleRate);
    for (let index = 0; index < sampleRate * 0.12; index += 1) {
      const time = index / sampleRate;
      samples[start + index] +=
        0.8 * Math.exp(-time * 28) * Math.sin(2 * Math.PI * 220 * time);
    }
  });

  assert.equal(detectGuitarOnsets(samples, sampleRate).length, 5);
  const analysis = analyzeRhythmRecording(samples, sampleRate, {
    bpm: 120,
    bars: [makeBar(4, 1)],
    loopBar: null,
    rhythmStart: 0.2,
    duration: 2,
  });
  assert.equal(analysis.matchedCount, 4);
  assert.equal(analysis.extra, 1);
  assert.equal(analysis.missed, 0);
  assert.equal(Math.round(analysis.calibrationMs), 30);
  assert.equal(analysis.stableRate, 50);
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
        beatTrack: false,
        rhythmTrack: true,
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

test("compound playback separates beat pulses from written note onsets", () => {
  const sampleRate = 8000;
  const pcm = (bars, beatTrack, rhythmTrack) => new Int16Array(
    makeClickTrackWav(
      { bpm: 60, bars, loopBar: null, sound: "click", beatTrack, rhythmTrack },
      sampleRate,
    ),
    44,
  );
  const energy = (samples, start) => samples
    .subarray(start, start + 400)
    .reduce((sum, sample) => sum + Math.abs(sample), 0);

  const beatOnly = pcm([{ beats: [{ steps: [0] }, { steps: [0] }] }], true, false);
  assert.ok(energy(beatOnly, 0) > energy(beatOnly, sampleRate));
  assert.ok(energy(beatOnly, sampleRate) > 0);

  const quarter = pcm([{ beats: [{ steps: [1] }] }], false, true);
  assert.ok(energy(quarter, 0) > 0);
  assert.equal(energy(quarter, sampleRate / 2), 0);
  const both = pcm([{ beats: [{ steps: [1] }] }], true, true);
  assert.equal(both.findIndex(Boolean), beatOnly.findIndex(Boolean));
  assert.equal(both.findIndex(Boolean), quarter.findIndex(Boolean));

  const eighths = pcm([{ beats: [{ steps: [1, 1] }] }], false, true);
  assert.ok(energy(eighths, 0) > 0);
  assert.ok(energy(eighths, sampleRate / 2) > 0);

  const rest = pcm([{ beats: [{ steps: [0] }] }], false, true);
  assert.ok(rest.every((sample) => sample === 0));
});
