import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FLAG_GLYPHS, REST_GLYPHS } from "./bravuraGlyphs.js";
import { clonePracticeRhythm, PRACTICE_PRESET_WEEKS } from "./practicePresets.js";
import { musicXmlToRhythm } from "./musicXml.js";
import {
  BEAT_UNITS,
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
  makeSingleBarRhythm,
  loopRangeFromSelection,
  moveBarSelection,
  normalizeBars,
  normalizeLoopRange,
  nextQuickPatternId,
  nextTrainingBpm,
  playbackVisualMarkers,
  rhythmEventIndexAtTime,
  rhythmDefaultName,
  removeBarSelection,
  rhythmVoiceForStep,
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

test("Du Xuan C keeps its pickup and loops the following two bars", () => {
  const preset = PRACTICE_PRESET_WEEKS[2].exercises
    .find(({ id }) => id === "w3-ex8")
    .presets.find(({ id }) => id === "w3-ex8-3");

  assert.deepEqual(preset.bars.map(({ beats }) => beats.map(({ steps }) => steps)), [
    [[0], [0], [0, 1], [1, 1]],
    [[1], [1, 1], [1, 1], [1, 1]],
    [[1, 1], [1, 1], [0, 1], [1, 1]],
  ]);
  assert.deepEqual(preset.loopBar, [1, 2]);
});

test("Five Hundred Miles preserves its eighth notes and tied continuations", () => {
  const preset = PRACTICE_PRESET_WEEKS[3].exercises
    .find(({ id }) => id === "w4-ex8")
    .presets.find(({ id }) => id === "w4-ex8-3");

  assert.deepEqual(preset.bars.map(({ beats }) => beats.map(({ steps }) => steps)), [
    [[1], [1], [1], [0, 1]],
    [[1], [1], [1], [0]],
    [[1], [1], [1], [0, 1]],
    [[1, 1], [0], [1], [0]],
    [[1], [1], [1], [0, 1]],
    [[1, 1], [0], [1], [0, 1]],
    [[1], [1], [0], [1]],
    [[0], [0], [0], [0]],
  ]);
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

test("playback markers update only the active visual elements", () => {
  assert.deepEqual(playbackVisualMarkers({ bar: 2, beat: 1, sub: 3, gap: false }, 2), [
    { target: "stage-beat", value: 1, className: "is-active" },
    { target: "bar-preview", value: 2, className: "is-playing" },
    { target: "preview-step", value: "2:1:3", className: "is-playing" },
    { target: "editor-step", value: "1:3", className: "is-playing" },
  ]);
  assert.equal(
    playbackVisualMarkers({ bar: 2, beat: 1, sub: 3, gap: false }, 0)
      .some(({ target }) => target === "editor-step"),
    false,
  );
  assert.deepEqual(playbackVisualMarkers({ bar: 2, beat: 1, sub: 3, gap: true }, 2), []);
});

test("quick subdivision selection yields to manual rhythm edits", () => {
  assert.equal(nextQuickPatternId("eighths", { bpm: 120 }), "eighths");
  assert.equal(nextQuickPatternId("eighths", { loopBar: [0, 0] }), "eighths");
  assert.equal(nextQuickPatternId("eighths", { bars: [] }), null);
  assert.equal(nextQuickPatternId("eighths", { beatUnit: 8 }), null);
  assert.equal(nextQuickPatternId("eighths", { quickPatternId: null }), null);
  assert.equal(nextQuickPatternId("eighths", { bars: [], quickPatternId: "triplet" }), "triplet");
});

test("quick meter and subdivision choices rebuild a single bar", () => {
  assert.deepEqual(makeSingleBarRhythm(3, [1, 1]), {
    bars: [{
      beats: [
        { steps: [2, 1] },
        { steps: [1, 1] },
        { steps: [1, 1] },
      ],
    }],
    loopBar: null,
  });
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
  assert.deepEqual(loopRangeFromSelection([3, 1, 3], 5), [1, 3]);
  assert.equal(loopRangeFromSelection([], 5), null);
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
  const normalStep = toggleBeatStep({ steps: [2] }, 0);
  const mutedStep = toggleBeatStep(normalStep, 0);
  const accentedStep = toggleBeatStep(mutedStep, 0);
  assert.deepEqual(normalStep, { steps: [1] });
  assert.deepEqual(mutedStep, { steps: [0] });
  assert.deepEqual(accentedStep, { steps: [2] });
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
        beatTrack: true,
        rhythmTrack: false,
        distinguishOffbeats: true,
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

test("rhythm playback only follows written note onsets", () => {
  const sampleRate = 8000;
  const pcm = (steps, legacy = {}) => new Int16Array(
    makeClickTrackWav(
      {
        bpm: 60,
        bars: [{ beats: [{ steps }] }],
        loopBar: null,
        sound: "click",
        ...legacy,
      },
      sampleRate,
    ),
    44,
  );
  const energy = (samples, start) => samples
    .subarray(start, start + 400)
    .reduce((sum, sample) => sum + Math.abs(sample), 0);

  const quarter = pcm([1]);
  assert.ok(energy(quarter, 0) > 0);
  assert.equal(energy(quarter, sampleRate / 2), 0);

  const eighths = pcm([1, 1]);
  assert.ok(energy(eighths, 0) > 0);
  assert.ok(energy(eighths, sampleRate / 2) > 0);

  const offbeat = pcm([0, 1]);
  assert.ok(offbeat.subarray(0, sampleRate / 2).every((sample) => sample === 0));
  assert.ok(energy(offbeat, sampleRate / 2) > 0);

  const rest = pcm([0]);
  assert.ok(rest.every((sample) => sample === 0));

  const legacyDisabled = pcm([1], {
    beatTrack: false,
    rhythmTrack: false,
    distinguishOffbeats: true,
  });
  assert.ok(legacyDisabled.some(Boolean));
});

test("rhythm voices keep the selected sound on onbeats and offbeats", () => {
  const voices = {
    click: { normal: 1080, accent: 1660, duration: 0.025 },
    wood: { normal: 610, accent: 820, duration: 0.045 },
    drum: { normal: 120, accent: 180, duration: 0.07 },
    soft: { normal: 720, accent: 940, duration: 0.04 },
  };
  for (const [sound, note] of Object.entries(voices)) {
    assert.equal(rhythmVoiceForStep(sound, 0), null);
    assert.deepEqual(rhythmVoiceForStep(sound, 1), {
      sound,
      frequency: note.normal,
      duration: note.duration,
      velocity: 0.82,
    });
    assert.deepEqual(rhythmVoiceForStep(sound, 2), {
      sound,
      frequency: note.accent,
      duration: note.duration,
      velocity: 1,
    });
  }
  assert.equal(rhythmVoiceForStep("unknown", 1).sound, "click");

  const pcm = (steps, sound = "click") => new Int16Array(
    makeClickTrackWav(
      {
        bpm: 60,
        bars: [{ beats: [{ steps }] }],
        loopBar: null,
        sound,
      },
      8000,
    ),
    44,
  );
  const energy = (samples) => samples.reduce((sum, sample) => sum + Math.abs(sample), 0);

  const dividedBeat = pcm([1, 1]);
  assert.ok(dividedBeat.subarray(250, 500).every((sample) => sample === 0));
  assert.ok(dividedBeat.subarray(4050, 4150).some(Boolean));

  const signatures = Object.keys(voices).map((sound) => {
    const divided = pcm([1, 1], sound);
    const onbeat = [...divided.subarray(0, 600)];
    const offbeat = [...divided.subarray(4000, 4600)];
    assert.deepEqual(onbeat, offbeat);

    const accented = pcm([2, 1], sound);
    assert.ok(
      energy(accented.subarray(0, 600)) >
        energy(accented.subarray(4000, 4600)),
    );
    return onbeat;
  });
  signatures.forEach((signature) => assert.ok(signature.some(Boolean)));
  for (let left = 0; left < signatures.length; left += 1) {
    for (let right = left + 1; right < signatures.length; right += 1) {
      assert.notDeepEqual(signatures[left], signatures[right]);
    }
  }

  const withRest = pcm([1, 0, 1]);
  assert.ok(withRest.subarray(300, 5200).every((sample) => sample === 0));
});

test("audio worklet schedules samples, visuals, pause, and live updates", async () => {
  const previous = {
    AudioWorkletProcessor: globalThis.AudioWorkletProcessor,
    registerProcessor: globalThis.registerProcessor,
    sampleRate: globalThis.sampleRate,
    currentTime: globalThis.currentTime,
  };
  let registeredName = null;
  let RegisteredProcessor = null;

  class MockAudioWorkletProcessor {
    constructor() {
      this.port = {
        messages: [],
        onmessage: null,
        postMessage: (message) => this.port.messages.push(message),
      };
    }
  }

  try {
    globalThis.AudioWorkletProcessor = MockAudioWorkletProcessor;
    globalThis.registerProcessor = (name, Processor) => {
      registeredName = name;
      RegisteredProcessor = Processor;
    };
    globalThis.sampleRate = 8;
    globalThis.currentTime = 0;
    await import(`./metronome-processor.js?test=${Date.now()}`);

    assert.equal(registeredName, "kessoku-metronome");
    assert.deepEqual(RegisteredProcessor.parameterDescriptors, [
      {
        name: "bpm",
        defaultValue: 96,
        minValue: 30,
        maxValue: 240,
        automationRate: "k-rate",
      },
    ]);
    const processor = new RegisteredProcessor();
    const sampleBank = {
      "click:accent": new Float32Array([1, 0.5]),
      "click:normal": new Float32Array([0.5, 0.25]),
      "wood:accent": new Float32Array([0.75, 0.25]),
      "wood:normal": new Float32Array([0.25, 0.1]),
    };
    const events = [
      { ticks: 0, bar: 0, beat: 0, sub: 0, gap: false, step: 2 },
      { ticks: 0.5, bar: 0, beat: 0, sub: 1, gap: false, step: 1 },
    ];
    processor.port.onmessage({
      data: {
        type: "configure",
        bpm: 240,
        sound: "click",
        ppq: 1,
        totalTicks: 1,
        events,
        sampleBank,
        countInBeats: 0,
      },
    });
    assert.equal(processor.port.messages[0].type, "ready");

    const first = [new Float32Array(4)];
    assert.equal(processor.process([], [first]), true);
    assert.deepEqual(
      [...first[0]].map((sample) => Number(sample.toFixed(2))),
      [1, 0.41, 1, 0.41],
    );
    const visuals = processor.port.messages.filter(({ type }) => type === "visual");
    assert.equal(visuals.length, 4);
    assert.deepEqual(visuals[0].visual, {
      bar: 0,
      beat: 0,
      sub: 0,
      hit: true,
      gap: false,
    });
    assert.equal(visuals[0].audioTime, 0);

    processor.port.onmessage({ data: { type: "pause" } });
    const paused = [new Float32Array(2)];
    processor.process([], [paused]);
    assert.ok(paused[0].every((sample) => sample === 0));

    processor.port.onmessage({ data: { type: "update", sound: "wood" } });
    processor.port.onmessage({ data: { type: "resume" } });
    const scalarUpdate = [new Float32Array(1)];
    processor.process([], [scalarUpdate]);
    assert.equal(scalarUpdate[0][0], 0.75);

    processor.port.onmessage({ data: { type: "pause" } });
    processor.port.onmessage({
      data: {
        type: "update",
        sound: "wood",
        totalTicks: 1,
        events: [{ ...events[0], step: 1 }],
      },
    });
    processor.port.onmessage({ data: { type: "resume" } });
    globalThis.currentTime = 0.5;
    const updated = [new Float32Array(2)];
    processor.process([], [updated]);
    assert.equal(updated[0][0], 0);
    assert.equal(Number(updated[0][1].toFixed(3)), 0.205);

    const stressProcessor = new RegisteredProcessor();
    stressProcessor.port.onmessage({
      data: {
        type: "configure",
        bpm: 96,
        sound: "click",
        ppq: 4,
        totalTicks: 4,
        events: [
          { ticks: 0, bar: 0, beat: 0, sub: 0, gap: false, step: 2 },
          { ticks: 1, bar: 0, beat: 0, sub: 1, gap: false, step: 1 },
          { ticks: 2, bar: 0, beat: 0, sub: 2, gap: false, step: 1 },
          { ticks: 3, bar: 0, beat: 0, sub: 3, gap: false, step: 1 },
        ],
        sampleBank,
        countInBeats: 0,
      },
    });
    let previousVisualCount = 0;
    for (const bpm of [30, 240, 60, 180, 45, 220, 96]) {
      const channels = [new Float32Array(32)];
      stressProcessor.process([], [channels], {
        bpm: new Float32Array([bpm]),
      });
      assert.ok(
        channels[0].some((sample) => sample !== 0),
        `${bpm} BPM should keep producing PCM`,
      );
      const visualCount = stressProcessor.port.messages.filter(
        ({ type }) => type === "visual",
      ).length;
      assert.ok(
        visualCount > previousVisualCount,
        `${bpm} BPM should keep producing visual events`,
      );
      previousVisualCount = visualCount;
      assert.equal(stressProcessor.bpm, bpm);
      assert.equal(stressProcessor.lastRequestedBpm, bpm);
    }

    stressProcessor.port.onmessage({
      data: { type: "update", bpm: 30 },
    });
    assert.equal(
      stressProcessor.bpm,
      96,
      "message updates must not change the AudioParam-controlled BPM",
    );

    const trainerProcessor = new RegisteredProcessor();
    trainerProcessor.port.onmessage({
      data: {
        type: "configure",
        bpm: 120,
        sound: "click",
        trainer: true,
        changeMode: "bars",
        changeEvery: 1,
        changeAmount: 10,
        targetBpm: 130,
        ppq: 1,
        totalTicks: 1,
        events: [
          { ticks: 0, bar: 0, beat: 0, sub: 0, gap: false, step: 2 },
        ],
        sampleBank,
        countInBeats: 0,
      },
    });
    trainerProcessor.process(
      [],
      [[new Float32Array(6)]],
      { bpm: new Float32Array([120]) },
    );
    assert.equal(trainerProcessor.bpm, 130);
    assert.equal(trainerProcessor.lastRequestedBpm, 120);
    assert.ok(
      trainerProcessor.port.messages.some(
        ({ type, bpm }) => type === "tempo" && bpm === 130,
      ),
    );
    trainerProcessor.process(
      [],
      [[new Float32Array(4)]],
      { bpm: new Float32Array([120]) },
    );
    assert.equal(
      trainerProcessor.bpm,
      130,
      "an unchanged AudioParam must not undo an internal trainer change",
    );
    trainerProcessor.process(
      [],
      [[new Float32Array(1)]],
      { bpm: new Float32Array([130]) },
    );
    assert.equal(trainerProcessor.lastRequestedBpm, 130);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});
