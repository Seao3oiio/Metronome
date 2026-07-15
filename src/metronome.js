export const BPM_MIN = 30;
export const BPM_MAX = 240;
export const MAX_BEATS = 6;
export const MAX_SUBDIVISION = 12;
export const BEAT_UNITS = [2, 4, 8, 16];

const TRACK_SOUNDS = {
  click: { accent: 1660, normal: 1080, duration: 0.025 },
  wood: { accent: 820, normal: 610, duration: 0.045 },
  drum: { accent: 180, normal: 120, duration: 0.07 },
  soft: { accent: 940, normal: 720, duration: 0.04 },
};

export const RHYTHM_TRACK_SOUNDS = {
  click: "drum",
  wood: "soft",
  drum: "click",
  soft: "wood",
};

const GAP_RANGES = {
  easy: { sound: [3, 5], mute: [1, 1] },
  medium: { sound: [2, 4], mute: [1, 2] },
  hard: { sound: [1, 3], mute: [2, 4] },
};

export function clampBpm(value) {
  return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(Number(value) || 0)));
}

export function bpmFromTaps(taps) {
  if (taps.length < 2) return null;
  const intervals = taps.slice(1).map((tap, index) => tap - taps[index]);
  return clampBpm(60000 / (intervals.reduce((sum, gap) => sum + gap, 0) / intervals.length));
}

export function tempoName(bpm) {
  if (bpm < 45) return "庄板 · Grave";
  if (bpm < 60) return "广板 · Largo";
  if (bpm < 76) return "柔板 · Adagio";
  if (bpm < 108) return "行板 · Andante";
  if (bpm < 120) return "中板 · Moderato";
  if (bpm < 168) return "快板 · Allegro";
  if (bpm < 200) return "急板 · Presto";
  return "最急板 · Prestissimo";
}

export function makeBeat(subdivision = 1, accent = false) {
  const requested = Number(subdivision);
  const length = Number.isFinite(requested)
    ? Math.min(MAX_SUBDIVISION, Math.max(1, Math.round(requested)))
    : 1;
  return { steps: Array.from({ length }, (_, index) => (index === 0 && accent ? 2 : 1)) };
}

export function makeBar(beats = 4, subdivision = 1) {
  const requested = Number(beats);
  const length = Number.isFinite(requested)
    ? Math.min(MAX_BEATS, Math.max(1, Math.round(requested)))
    : 4;
  return {
    beats: Array.from({ length }, (_, index) => makeBeat(subdivision, index === 0)),
  };
}

export function applyBeatPattern(beats, pattern, count = beats.length) {
  const cleanPattern = pattern.slice(0, MAX_SUBDIVISION).map((step) => (step ? 1 : 0));
  return Array.from({ length: Math.min(MAX_BEATS, Math.max(1, count)) }, (_, index) => {
    const previous = beats[index];
    const steps = [...cleanPattern];
    const accent = previous ? previous.steps.includes(2) : index === 0;
    const firstSound = steps.findIndex(Boolean);
    if (accent && firstSound >= 0) steps[firstSound] = 2;
    return { steps };
  });
}

export function cycleBeatState(beat) {
  const accented = beat.steps.includes(2);
  const steps = beat.steps.map((step) => (step === 2 ? 1 : step));
  if (!accented) {
    const firstSound = steps.findIndex(Boolean);
    if (firstSound >= 0) steps[firstSound] = 2;
  }
  return { steps };
}

export function toggleBeatStep(beat, index, accent = false) {
  const steps = [...beat.steps];
  steps[index] = accent ? (steps[index] === 2 ? 1 : 2) : steps[index] === 0 ? 1 : 0;
  return { steps };
}

export function moveBarSelection(bars, selectedIndexes, direction) {
  const selected = new Set(selectedIndexes);
  const entries = bars.map((bar, index) => ({ bar, index }));

  if (direction < 0) {
    for (let index = 1; index < entries.length; index += 1) {
      if (selected.has(entries[index].index) && !selected.has(entries[index - 1].index)) {
        [entries[index - 1], entries[index]] = [entries[index], entries[index - 1]];
      }
    }
  } else {
    for (let index = entries.length - 2; index >= 0; index -= 1) {
      if (selected.has(entries[index].index) && !selected.has(entries[index + 1].index)) {
        [entries[index], entries[index + 1]] = [entries[index + 1], entries[index]];
      }
    }
  }

  return {
    bars: entries.map(({ bar }) => bar),
    order: entries.map(({ index }) => index),
  };
}

export function normalizeBars(value) {
  if (!Array.isArray(value)) return null;

  const bars = value.flatMap((rawBar, barIndex) => {
    const rawBeats = Array.isArray(rawBar?.beats)
      ? rawBar.beats
      : Array.isArray(rawBar)
        ? rawBar
        : [];
    if (!rawBeats.length) return [];

    const beats = rawBeats.slice(0, MAX_BEATS).map((rawBeat, beatIndex) => {
      const steps = Array.isArray(rawBeat?.steps) ? rawBeat.steps : [];
      const validSteps =
        steps.length >= 1 &&
        steps.length <= MAX_SUBDIVISION &&
        steps.every((step) => [0, 1, 2].includes(step));
      return validSteps
        ? { steps: rawBeat.enabled === false ? steps.map(() => 0) : [...steps] }
        : makeBeat(
            Number(rawBeat?.subdivision) || 1,
            barIndex === 0 && beatIndex === 0,
          );
    });

    return beats.length ? [{ beats }] : [];
  });

  return bars.length ? bars : null;
}

export function normalizeLoopRange(value, barCount) {
  if (value === null || value === undefined) return null;
  const range = Number.isInteger(value) ? [value, value] : value;
  if (
    !Array.isArray(range) ||
    range.length !== 2 ||
    !range.every(Number.isInteger)
  ) {
    return null;
  }
  const start = Math.min(...range);
  const end = Math.max(...range);
  return start >= 0 && end < barCount ? [start, end] : null;
}

export function removeBarSelection(bars, selectedIndexes, loopBar) {
  const selected = [...new Set(selectedIndexes)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < bars.length)
    .sort((left, right) => left - right);
  if (!selected.length) return null;
  if (selected.length === bars.length) {
    return { bars: [makeBar(4, 1)], loopBar: null, index: 0 };
  }

  let range = normalizeLoopRange(loopBar, bars.length);
  let remaining = bars.length;
  for (const index of [...selected].reverse()) {
    remaining -= 1;
    if (!range) continue;
    const [start, end] = range;
    if (index < start) range = [start - 1, end - 1];
    else if (index <= end) {
      const next = Math.min(index, remaining - 1);
      range = start < end ? [start, end - 1] : [next, next];
    }
  }

  const selectedSet = new Set(selected);
  const nextBars = bars.filter((_, index) => !selectedSet.has(index));
  return {
    bars: nextBars,
    loopBar: range,
    index: Math.min(selected[0], nextBars.length - 1),
  };
}

export function encodeRhythm({ bpm, beatUnit = 4, bars, loopBar }) {
  return btoa(JSON.stringify({ v: 3, bpm, beatUnit, bars, loopBar }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function decodeRhythm(code) {
  const value = String(code).trim();
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid rhythm code");
  }
  const payload = JSON.parse(
    atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=")),
  );
  const bars = normalizeBars(payload.bars);
  const loopBar = normalizeLoopRange(payload.loopBar, bars?.length ?? 0);
  if (
    payload.v !== 3 ||
    clampBpm(payload.bpm) !== payload.bpm ||
    !BEAT_UNITS.includes(payload.beatUnit) ||
    !bars ||
    JSON.stringify(bars) !== JSON.stringify(payload.bars) ||
    (payload.loopBar !== null && !loopBar)
  ) {
    throw new Error("Invalid rhythm code");
  }
  return { bpm: payload.bpm, beatUnit: payload.beatUnit, bars, loopBar };
}

export function rhythmDefaultName({ bpm, beatUnit = 4, bars }) {
  const bar = bars.length === 1 ? bars[0] : null;
  const subdivision =
    bar && bar.beats.every((beat) => beat.steps.length === bar.beats[0].steps.length)
      ? bar.beats[0].steps.length
      : null;
  const subdivisionName =
    { 3: "三连", 5: "五连", 6: "六连" }[subdivision] ??
    {
      2: "二分",
      4: "四分",
      8: "八分",
      16: "十六分",
      32: "三十二分",
      64: "六十四分",
      128: "一百二十八分",
    }[beatUnit * subdivision];
  const shape = bar ? `${bar.beats.length}/${beatUnit}` : `${bars.length} 小节`;
  return `${shape} · ${subdivisionName ?? "自定义"} · ${bpm} BPM`;
}

export function makeGapPattern(difficulty = "medium", barCount = 1, random = Math.random) {
  const ranges = GAP_RANGES[difficulty] ?? GAP_RANGES.medium;
  const rhythmBars = Math.max(1, Math.round(Number(barCount) || 1));
  const target = rhythmBars * Math.ceil(16 / rhythmBars);
  const options = [];
  for (let sound = ranges.sound[0]; sound <= ranges.sound[1]; sound += 1) {
    for (let mute = ranges.mute[0]; mute <= ranges.mute[1]; mute += 1) {
      options.push({ sound, mute });
    }
  }

  const shuffledOptions = () =>
    options
      .map((option) => ({ option, order: random() }))
      .sort((left, right) => left.order - right.order)
      .map(({ option }) => option);
  const stack = [{ remaining: target, first: true, options: shuffledOptions(), cursor: 0 }];
  const chunks = [];

  while (stack.length) {
    const frame = stack.at(-1);
    if (frame.cursor === frame.options.length) {
      stack.pop();
      if (stack.length) chunks.pop();
      continue;
    }

    const option = frame.options[frame.cursor++];
    const remaining = frame.remaining - option.sound - option.mute;
    if (remaining < 0 || (frame.first && option.sound < 2)) continue;
    chunks.push(option);
    if (remaining === 0) break;
    stack.push({ remaining, first: false, options: shuffledOptions(), cursor: 0 });
  }

  return chunks.flatMap(({ sound, mute }) => [
    ...Array(sound).fill(false),
    ...Array(mute).fill(true),
  ]);
}

export function compileRhythm(bars, loopBar, ppq, gapPattern = []) {
  const range = normalizeLoopRange(loopBar, bars.length) ?? [0, bars.length - 1];
  const selectedBars = bars
    .slice(range[0], range[1] + 1)
    .map((bar, index) => [bar, range[0] + index]);
  const scheduledBars = gapPattern.length
    ? gapPattern.map((gap, index) => [...selectedBars[index % selectedBars.length], gap])
    : selectedBars.map((bar) => [...bar, false]);
  const events = [];
  const barSpans = [];
  let cursor = 0;

  scheduledBars.forEach(([bar, barIndex, gap]) => {
    const startTicks = cursor;
    bar.beats.forEach((beat, beatIndex) => {
      const beatStart = cursor + beatIndex * ppq;
      beat.steps.forEach((_, sub) => {
        events.push({
          ticks: beatStart + (sub * ppq) / beat.steps.length,
          bar: barIndex,
          beat: beatIndex,
          sub,
          gap,
        });
      });
    });
    cursor += bar.beats.length * ppq;
    barSpans.push({ startTicks, endTicks: cursor, gap });
  });

  return { events, totalTicks: cursor, barSpans };
}

export function nextTrainingBpm(current, target, step) {
  const direction = Math.sign(target - current);
  if (!direction) return current;
  const next = current + direction * Math.max(1, step);
  return direction > 0 ? Math.min(next, target) : Math.max(next, target);
}

export function advanceMinuteDeadline(elapsed, deadline) {
  if (elapsed < deadline) return null;
  return deadline + (Math.floor((elapsed - deadline) / 60) + 1) * 60;
}

export function rhythmEventIndexAtTime(seconds, bpm, plan) {
  const tick = ((seconds * bpm) / 60) % plan.totalTicks;
  let index = 0;
  while (index + 1 < plan.events.length && plan.events[index + 1].ticks <= tick) index += 1;
  return index;
}

export function makeClickTrackWav(settings, sampleRate = 12000, cycles = 1, gapPattern = []) {
  const {
    bpm,
    bars,
    loopBar,
    sound = "click",
    beatTrack = true,
    rhythmTrack = true,
  } = settings;
  const beatSound = TRACK_SOUNDS[sound] ? sound : "click";
  const rhythmSound = RHYTHM_TRACK_SOUNDS[beatSound];
  const plan = compileRhythm(bars, loopBar, 1, gapPattern);
  const beatSeconds = 60 / bpm;
  const frames = Math.ceil(cycles * plan.totalTicks * beatSeconds * sampleRate);
  const samples = new Float32Array(frames);

  const renderClick = (start, trackSound, frequency, velocity) => {
    const note = TRACK_SOUNDS[trackSound];
    const length = Math.ceil(note.duration * sampleRate);
    for (let index = 0; index < length; index += 1) {
      const time = index / sampleRate;
      const phase = 2 * Math.PI * frequency * time;
      const wave =
        trackSound === "click"
          ? (2 / Math.PI) * Math.asin(Math.sin(phase))
          : trackSound === "wood"
            ? (Math.sin(phase) + 0.35 * Math.sin(phase * 3)) / 1.35
            : Math.sin(
                trackSound === "drum"
                  ? phase * (1.8 - 0.8 * time / note.duration)
                  : phase,
              );
      const envelope = Math.min(1, time / 0.001) * Math.exp(-6 * time / note.duration);
      samples[(start + index) % frames] += wave * envelope * velocity * 0.75;
    }
  };

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    for (const event of plan.events) {
      if (event.gap) continue;
      const beat = bars[event.bar]?.beats[event.beat];
      const step = beat?.steps[event.sub] ?? 0;
      const start = Math.round(
        (cycle * plan.totalTicks + event.ticks) * beatSeconds * sampleRate,
      );
      if (beatTrack && event.sub === 0) {
        const note = TRACK_SOUNDS[beatSound];
        renderClick(
          start,
          beatSound,
          event.beat === 0 ? note.accent : note.normal,
          event.beat === 0 ? 1 : 0.74,
        );
      }
      if (rhythmTrack && step > 0) {
        const note = TRACK_SOUNDS[rhythmSound];
        renderClick(
          start,
          rhythmSound,
          step === 2 ? note.accent : note.normal,
          step === 2 ? 0.58 : 0.46,
        );
      }
    }
    for (const span of plan.barSpans) {
      if (!span.gap) continue;
      const start = Math.round(
        (cycle * plan.totalTicks + span.startTicks) * beatSeconds * sampleRate,
      );
      const end = Math.min(
        frames,
        Math.round((cycle * plan.totalTicks + span.endTicks) * beatSeconds * sampleRate),
      );
      samples.fill(0, start, end);
    }
  }

  const wav = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(wav);
  const text = (offset, value) =>
    [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * 2, true);
  samples.forEach((sample, index) =>
    view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true),
  );
  return wav;
}
