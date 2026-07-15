import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  Hand,
  Minus,
  Pause,
  Play,
  Plus,
  Repeat2,
  Save,
  Share2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import * as Tone from "tone";
import {
  BEAT_UNITS,
  BPM_MAX,
  BPM_MIN,
  MAX_BARS,
  MAX_BEATS,
  MAX_SUBDIVISION,
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
  normalizeBars,
  nextTrainingBpm,
  rhythmEventIndexAtTime,
  rhythmDefaultName,
  tempoName,
} from "./metronome.js";
import {
  FLAG_GLYPHS,
  NOTEHEAD_GLYPHS,
  REST_GLYPHS,
  TUPLET_THREE_PATH,
} from "./bravuraGlyphs.js";

const RHYTHM_LIBRARY_KEY = "pulse-rhythm-library-v1";

const QUICK_PATTERNS = [
  { id: "beat", label: "每拍一次", steps: [1] },
  { id: "eighths", label: "每拍二等分", steps: [1, 1] },
  { id: "offbeat", label: "仅后半拍", steps: [0, 1] },
  { id: "triplet", label: "三连音", steps: [1, 1, 1] },
  { id: "triplet-rest-first", label: "三连音第一格休止", steps: [0, 1, 1] },
  { id: "triplet-rest-middle", label: "三连音第二格休止", steps: [1, 0, 1] },
  { id: "triplet-rest-last", label: "三连音第三格休止", steps: [1, 1, 0] },
  { id: "sixteenths", label: "每拍四等分", steps: [1, 1, 1, 1] },
];

const GAP_DIFFICULTIES = [
  { value: "easy", label: "轻", title: "响 3–5 小节，空 1 小节" },
  { value: "medium", label: "中", title: "响 2–4 小节，空 1–2 小节" },
  { value: "hard", label: "难", title: "响 1–3 小节，空 2–4 小节" },
];

const SOUNDS = [
  { value: "click", label: "清脆" },
  { value: "wood", label: "木鱼" },
  { value: "drum", label: "鼓点" },
  { value: "soft", label: "柔和" },
];

const SOUND_NOTES = {
  click: { accent: 1660, normal: 1080, duration: 0.025 },
  wood: { accent: 820, normal: 610, duration: 0.045 },
  drum: { accent: 180, normal: 120, duration: 0.07 },
  soft: { accent: 940, normal: 720, duration: 0.04 },
};

const DEFAULT_SETTINGS = {
  schemaVersion: 2,
  bpm: 96,
  beatUnit: 4,
  bars: null,
  loopBar: null,
  sound: "click",
  trainer: false,
  startBpm: 96,
  targetBpm: 120,
  changeMode: "bars",
  changeEvery: 4,
  changeAmount: 2,
  gapClick: false,
  gapDifficulty: "medium",
  volume: 72,
  muted: false,
};

function freshSettings() {
  return { ...DEFAULT_SETTINGS, bars: [makeBar(4, 1)] };
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("pulse-settings"));
    const defaults = freshSettings();
    if (!saved) return defaults;

    const bars = normalizeBars(saved.bars);
    if (!bars) return defaults;
    const loopBar =
      Number.isInteger(saved.loopBar) && saved.loopBar >= 0 && saved.loopBar < bars.length
        ? saved.loopBar
        : null;

    return {
      ...defaults,
      schemaVersion: 2,
      bpm: clampBpm(saved.bpm ?? defaults.bpm),
      beatUnit: BEAT_UNITS.includes(saved.beatUnit) ? saved.beatUnit : defaults.beatUnit,
      bars,
      loopBar,
      sound: SOUNDS.some(({ value }) => value === saved.sound) ? saved.sound : "click",
      startBpm: clampBpm(saved.startBpm ?? saved.bpm ?? 96),
      targetBpm: clampBpm(saved.targetBpm ?? 120),
      changeMode: saved.changeMode === "minute" ? "minute" : "bars",
      changeEvery: [1, 2, 4, 8, 16].includes(saved.changeEvery) ? saved.changeEvery : 4,
      changeAmount: [1, 2, 3, 5, 10].includes(saved.changeAmount)
        ? saved.changeAmount
        : 2,
      volume: Number.isFinite(Number(saved.volume))
        ? Math.min(100, Math.max(0, Number(saved.volume)))
        : defaults.volume,
      trainer: Boolean(saved.trainer),
      gapClick: Boolean(saved.gapClick),
      gapDifficulty: GAP_DIFFICULTIES.some(({ value }) => value === saved.gapDifficulty)
        ? saved.gapDifficulty
        : defaults.gapDifficulty,
      muted: Boolean(saved.muted),
    };
  } catch {
    return freshSettings();
  }
}

function loadRhythmLibrary() {
  try {
    const saved = JSON.parse(localStorage.getItem(RHYTHM_LIBRARY_KEY));
    if (!Array.isArray(saved)) return [];
    return saved.slice(0, 50).filter((item) => {
      if (
        typeof item?.id !== "string" ||
        typeof item?.name !== "string" ||
        !item.name.trim() ||
        item.name.length > 40 ||
        typeof item?.code !== "string"
      ) {
        return false;
      }
      try {
        decodeRhythm(item.code);
        return true;
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function cloneBeat(beat) {
  return { ...beat, steps: [...beat.steps] };
}

function cloneBar(bar) {
  return { beats: bar.beats.map(cloneBeat) };
}

function plainSteps(beat) {
  return beat.steps.map((step) => (step === 2 ? 1 : step));
}

function NoteSymbol({ x, denominator, standalone }) {
  const beams = Math.max(0, Math.log2(denominator) - 2);
  return (
    <g className="notation-note">
      <path
        className="notation-fill"
        d={denominator === 2 ? NOTEHEAD_GLYPHS.half : NOTEHEAD_GLYPHS.black}
        transform={`translate(${x - 8.1} 42) scale(.055 -.055)`}
      />
      <path className="note-stem" d={`M${x + 7.7} 42V16`} />
      {standalone && beams > 0 && (
        <path
          className="notation-fill"
          d={FLAG_GLYPHS[beams]}
          transform={`translate(${x + 7.7} 16) scale(.037 -.037)`}
        />
      )}
    </g>
  );
}

function RestSymbol({ x, denominator }) {
  const glyph = REST_GLYPHS[denominator];
  return (
    <path
      className="notation-fill"
      d={glyph.path}
      transform={`translate(${x - (glyph.width * glyph.scale) / 2} ${glyph.y}) scale(${glyph.scale} ${-glyph.scale})`}
    />
  );
}

function RhythmPatternGlyph({ steps, beatUnit }) {
  const positions = {
    1: [48],
    2: [30, 66],
    3: [22, 48, 74],
    4: [18, 38, 58, 78],
  }[steps.length];
  const denominator = beatUnit * (steps.length === 1 ? 1 : steps.length === 4 ? 4 : 2);
  const beams = Math.max(0, Math.log2(denominator) - 2);
  const runs = [];
  steps.forEach((step, index) => {
    if (!step) return;
    const previous = runs.at(-1);
    if (previous?.end === index - 1) previous.end = index;
    else runs.push({ start: index, end: index });
  });

  return (
    <svg className="music-glyph" viewBox="0 0 96 54" aria-hidden="true" focusable="false">
      {steps.length === 3 && (
        <>
          <path className="tuplet-bracket" d="M8 12V7H39M57 7H88V12" />
          <path
            className="notation-fill"
            d={TUPLET_THREE_PATH}
            transform="translate(43.9 12) scale(.027 -.027)"
          />
        </>
      )}
      {steps.map((step, index) =>
        step ? (
          <NoteSymbol
            key={index}
            x={positions[index]}
            denominator={denominator}
            standalone={runs.some((run) => run.start === index && run.end === index)}
          />
        ) : (
          <RestSymbol key={index} x={positions[index]} denominator={denominator} />
        ),
      )}
      {runs.flatMap((run, runIndex) =>
        run.end > run.start
          ? Array.from({ length: beams }, (_, beam) => (
              <path
                className="note-beam"
                d={`M${positions[run.start] + 7.7} ${16 + beam * 6}H${positions[run.end] + 7.7}`}
                key={`${runIndex}-${beam}`}
              />
            ))
          : [],
      )}
    </svg>
  );
}

function BeatStateGlyph({ beatUnit }) {
  return (
    <svg className="music-glyph" viewBox="0 0 96 54" aria-hidden="true" focusable="false">
      <NoteSymbol x={48} denominator={beatUnit} standalone />
    </svg>
  );
}

function RhythmDot({ className, label, title, onPress, onHold, style }) {
  const timerRef = useRef(null);
  const heldRef = useRef(false);
  const pressedRef = useRef(false);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const startHold = (event) => {
    if (event.button !== undefined && event.button !== 0) {
      pressedRef.current = false;
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pressedRef.current = true;
    heldRef.current = false;
    timerRef.current = setTimeout(() => {
      heldRef.current = true;
      onHold?.();
    }, 480);
  };
  const cancelHold = () => clearTimeout(timerRef.current);

  const finishPress = () => {
    cancelHold();
    if (!pressedRef.current) return;
    pressedRef.current = false;
    if (heldRef.current) {
      heldRef.current = false;
      return;
    }
    onPress();
  };

  const cancelPress = () => {
    cancelHold();
    pressedRef.current = false;
  };

  return (
    <button
      className={className}
      type="button"
      style={style}
      aria-label={label}
      title={title}
      onPointerDown={startHold}
      onPointerUp={finishPress}
      onPointerCancel={cancelPress}
      onClick={(event) => event.detail === 0 && onPress()}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!heldRef.current) onHold?.();
        heldRef.current = true;
      }}
    >
      <i aria-hidden="true" />
    </button>
  );
}

function createInstruments(output) {
  return {
    click: new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.001, decay: 0.025, sustain: 0, release: 0.012 },
      volume: -5,
    }).connect(output),
    wood: new Tone.MembraneSynth({
      pitchDecay: 0.008,
      octaves: 1.6,
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.055, sustain: 0, release: 0.02 },
      volume: -4,
    }).connect(output),
    drum: new Tone.MembraneSynth({
      pitchDecay: 0.04,
      octaves: 3.5,
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.035 },
      volume: -6,
    }).connect(output),
    soft: new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.002, decay: 0.045, sustain: 0, release: 0.025 },
      volume: -8,
    }).connect(output),
  };
}

function setAudioSession(type) {
  try {
    if ("audioSession" in navigator) navigator.audioSession.type = type;
  } catch {
    // Unsupported browsers keep their default audio policy.
  }
}

function isIOSDevice() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function makeActiveGapPattern(settings) {
  if (!settings.gapClick || window.location.hash !== "#rhythm") return [];
  const barCount = settings.loopBar === null ? settings.bars.length : 1;
  return makeGapPattern(settings.gapDifficulty, barCount);
}

function mediaTrackKey(settings, gapPattern) {
  return JSON.stringify([
    settings.bpm,
    settings.sound,
    settings.loopBar,
    settings.bars,
    settings.gapClick,
    settings.gapDifficulty,
    gapPattern,
  ]);
}

function releaseMedia(media, url) {
  if (media) {
    media.pause();
    media.removeAttribute("src");
  }
  if (url) URL.revokeObjectURL(url);
}

async function syncMediaLoop(audio, settings) {
  audio.targetVolume = settings.muted ? 0 : settings.volume / 100;
  audio.media.volume = audio.targetVolume;
  const key = mediaTrackKey(settings, audio.gapPattern);
  if (audio.mediaKey === key) return;
  if (audio.pendingKey === key) return audio.pendingSync;

  const revision = (audio.syncRevision ?? 0) + 1;
  audio.syncRevision = revision;
  releaseMedia(audio.pendingCandidate, audio.pendingUrl);
  audio.pendingCandidate = null;
  audio.pendingUrl = null;
  const pending = (async () => {
    const plan = compileRhythm(settings.bars, settings.loopBar, 1, audio.gapPattern);
    const url = URL.createObjectURL(
      new Blob([makeClickTrackWav(settings, 12000, 1, audio.gapPattern)], {
        type: "audio/wav",
      }),
    );
    const candidate = new Audio();
    candidate.loop = true;
    candidate.preload = "auto";
    candidate.setAttribute("playsinline", "");
    candidate.volume = 0;
    candidate.src = url;
    audio.pendingCandidate = candidate;
    audio.pendingUrl = url;

    try {
      await candidate.play();
    } catch (error) {
      if (audio.pendingCandidate === candidate) {
        audio.pendingCandidate = null;
        audio.pendingUrl = null;
      }
      releaseMedia(candidate, url);
      if (audio.syncRevision !== revision) return false;
      throw error;
    }

    if (audio.syncRevision !== revision) {
      releaseMedia(candidate, url);
      return false;
    }

    const previousMedia = audio.media;
    const previousUrl = audio.url;
    try {
      candidate.currentTime = 0;
    } catch {
      // A freshly started local WAV is already at its beginning.
    }
    candidate.volume = audio.targetVolume;
    audio.media = candidate;
    audio.mediaKey = key;
    audio.lastEvent = -1;
    audio.lastTime = -1;
    audio.plan = plan;
    audio.activeRhythm = {
      bpm: settings.bpm,
      bars: settings.bars,
      loopBar: settings.loopBar,
    };
    audio.url = url;
    audio.pendingCandidate = null;
    audio.pendingUrl = null;
    releaseMedia(previousMedia, previousUrl);
    return true;
  })();

  audio.pendingKey = key;
  audio.pendingSync = pending;
  try {
    return await pending;
  } finally {
    if (audio.pendingSync === pending) {
      audio.pendingKey = null;
      audio.pendingSync = null;
    }
  }
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [bpmDraft, setBpmDraft] = useState(String(settings.bpm));
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState("就绪");
  const [visual, setVisual] = useState({
    bar: 0,
    beat: 0,
    sub: 0,
    pulse: 0,
    hit: false,
    gap: false,
  });
  const [editorBarIndex, setEditorBarIndex] = useState(() => settings.loopBar ?? 0);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [showRhythmCode, setShowRhythmCode] = useState(false);
  const [rhythmCode, setRhythmCode] = useState("");
  const [savedRhythms, setSavedRhythms] = useState(loadRhythmLibrary);
  const [selectedRhythmId, setSelectedRhythmId] = useState("");
  const [rhythmName, setRhythmName] = useState("");
  const [advancedRhythm, setAdvancedRhythm] = useState(
    () => window.location.hash === "#rhythm",
  );
  const [installed, setInstalled] = useState(
    () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true,
  );

  const settingsRef = useRef(settings);
  const playingRef = useRef(false);
  const playbackIntentRef = useRef(false);
  const startingRef = useRef(false);
  const refreshingRef = useRef(false);
  const rhythmRevisionRef = useRef(0);
  const barsRef = useRef(0);
  const minuteDeadlineRef = useRef(60);
  const tapsRef = useRef([]);
  const bpmEditingRef = useRef(false);
  const generationRef = useRef(0);
  const audioRef = useRef(null);
  const installDialogRef = useRef(null);
  const rhythmDialogRef = useRef(null);
  const isIOS = isIOSDevice();

  const updateSettings = useCallback((patch) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings((current) => ({ ...current, ...patch }));
    if (audioRef.current?.media && playingRef.current) {
      syncMediaLoop(audioRef.current, next).catch(() => {
        if (playbackIntentRef.current) setStatus("继续播放原节奏");
      });
    }
  }, []);

  const setBpm = useCallback(
    (value) => updateSettings({ bpm: clampBpm(value) }),
    [updateSettings],
  );

  const disposeAudio = useCallback(() => {
    if (!audioRef.current) return;
    if (audioRef.current?.media) {
      audioRef.current.syncRevision = (audioRef.current.syncRevision ?? 0) + 1;
      cancelAnimationFrame(audioRef.current.raf);
      releaseMedia(audioRef.current.pendingCandidate, audioRef.current.pendingUrl);
      releaseMedia(audioRef.current.media, audioRef.current.url);
      audioRef.current = null;
      return;
    }
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel(0);
    Tone.getDraw().cancel(0);
    audioRef.current?.part.dispose();
    Object.values(audioRef.current?.instruments ?? {}).forEach((instrument) => instrument.dispose());
    audioRef.current?.output.dispose();
    audioRef.current = null;
  }, []);

  const stop = useCallback(
    (message = "已暂停") => {
      generationRef.current += 1;
      playbackIntentRef.current = false;
      playingRef.current = false;
      startingRef.current = false;
      setPlaying(false);
      setVisual({ bar: 0, beat: 0, sub: 0, pulse: 0, hit: false, gap: false });
      setStatus(message);
      disposeAudio();
      setAudioSession("auto");
    },
    [disposeAudio],
  );

  const start = useCallback(async (preserveTempo = false) => {
    if (startingRef.current || playingRef.current) return;
    startingRef.current = true;
    setStatus("开启声音…");
    disposeAudio();
    const run = ++generationRef.current;

    try {
      setAudioSession("playback");
      if (settingsRef.current.trainer && !preserveTempo) {
        const bpm = settingsRef.current.startBpm;
        settingsRef.current = { ...settingsRef.current, bpm };
        setSettings((current) => ({ ...current, bpm }));
      }

      const gapPattern = makeActiveGapPattern(settingsRef.current);

      let mediaAudio = null;
      if (isIOS) {
        const media = new Audio();
        media.loop = true;
        media.preload = "auto";
        media.setAttribute("playsinline", "");
        mediaAudio = {
          media,
          mediaKey: null,
          url: null,
          raf: 0,
          lastEvent: -1,
          lastTime: -1,
          plan: null,
          activeRhythm: null,
          pendingKey: null,
          pendingSync: null,
          pendingCandidate: null,
          pendingUrl: null,
          syncRevision: 0,
          targetVolume: settingsRef.current.muted ? 0 : settingsRef.current.volume / 100,
          gapPattern,
          startedAt: performance.now() / 1000,
        };
        audioRef.current = mediaAudio;
        await syncMediaLoop(mediaAudio, settingsRef.current);
        if (run !== generationRef.current) return;
        if (!mediaAudio.activeRhythm) {
          await syncMediaLoop(mediaAudio, settingsRef.current);
          if (run !== generationRef.current || !mediaAudio.activeRhythm) return;
        }
        mediaAudio.startedAt = performance.now() / 1000;

        barsRef.current = 0;
        minuteDeadlineRef.current = 60;
        playingRef.current = true;
        setPlaying(true);
        setStatus("运行中");

        const draw = () => {
          if (generationRef.current !== run || !playingRef.current) return;
          const current = settingsRef.current;
          const activeRhythm = mediaAudio.activeRhythm;
          const activeMedia = mediaAudio.media;
          const eventIndex = rhythmEventIndexAtTime(
            activeMedia.currentTime,
            activeRhythm.bpm,
            mediaAudio.plan,
          );
          const wrapped =
            mediaAudio.lastTime >= 0 && activeMedia.currentTime < mediaAudio.lastTime;

          if (eventIndex !== mediaAudio.lastEvent || wrapped) {
            const event = mediaAudio.plan.events[eventIndex];
            const beatData = activeRhythm.bars[event.bar]?.beats[event.beat];
            const step = beatData?.steps[event.sub] ?? 0;
            const enteredBar =
              mediaAudio.lastEvent >= 0 && event.beat === 0 && event.sub === 0;
            if (enteredBar) barsRef.current += 1;
            const gapMuted = Boolean(event.gap);
            const elapsed = performance.now() / 1000 - mediaAudio.startedAt;
            const nextMinuteDeadline =
              current.trainer && current.changeMode === "minute"
                ? advanceMinuteDeadline(elapsed, minuteDeadlineRef.current)
                : null;
            const barsDue =
              current.trainer &&
              current.changeMode === "bars" &&
              enteredBar &&
              barsRef.current % current.changeEvery === 0;

            if (barsDue || nextMinuteDeadline !== null) {
              if (nextMinuteDeadline !== null) minuteDeadlineRef.current = nextMinuteDeadline;
              const bpm = nextTrainingBpm(current.bpm, current.targetBpm, current.changeAmount);
              if (bpm !== current.bpm) {
                settingsRef.current = { ...current, bpm };
                setSettings((previous) => ({ ...previous, bpm }));
              }
            }

            setVisual({
              bar: event.bar,
              beat: event.beat,
              sub: event.sub,
              pulse: performance.now(),
              hit: !gapMuted && beatData?.enabled && step > 0,
              gap: gapMuted,
            });
            mediaAudio.lastEvent = eventIndex;
          }
          mediaAudio.lastTime = activeMedia.currentTime;
          mediaAudio.raf = requestAnimationFrame(draw);
        };
        mediaAudio.raf = requestAnimationFrame(draw);
        return;
      }

      await Tone.start();
      if (run !== generationRef.current) return;

      const transport = Tone.getTransport();
      const output = new Tone.Gain(
        settingsRef.current.muted ? 0 : settingsRef.current.volume / 100,
      ).toDestination();
      const instruments = createInstruments(output);

      barsRef.current = 0;
      transport.position = 0;
      minuteDeadlineRef.current = 60;
      transport.bpm.cancelScheduledValues(0);
      transport.bpm.setValueAtTime(settingsRef.current.bpm, 0);

      const plan = compileRhythm(
        settingsRef.current.bars,
        settingsRef.current.loopBar,
        transport.PPQ,
        gapPattern,
      );
      const part = new Tone.Part((time, event) => {
        let current = settingsRef.current;
        const beatData = current.bars[event.bar]?.beats[event.beat];
        const step = beatData?.steps[event.sub] ?? 0;
        const enteredBar = event.beat === 0 && event.sub === 0;
        const eventGapMuted = Boolean(
          current.gapClick && window.location.hash === "#rhythm" && event.gap,
        );

        const nextMinuteDeadline =
          current.trainer && current.changeMode === "minute"
            ? advanceMinuteDeadline(
                transport.getSecondsAtTime(time),
                minuteDeadlineRef.current,
              )
            : null;
        const barsDue =
          current.changeMode === "bars" &&
          enteredBar &&
          barsRef.current > 0 &&
          barsRef.current % current.changeEvery === 0;

        if (current.trainer && (barsDue || nextMinuteDeadline !== null)) {
          if (nextMinuteDeadline !== null) minuteDeadlineRef.current = nextMinuteDeadline;
          const nextBpm = nextTrainingBpm(current.bpm, current.targetBpm, current.changeAmount);
          if (nextBpm !== current.bpm) {
            current = { ...current, bpm: nextBpm };
            settingsRef.current = current;
            transport.bpm.setValueAtTime(nextBpm, time);
            Tone.getDraw().schedule(() => {
              if (generationRef.current === run) {
                setSettings((previous) => ({ ...previous, bpm: nextBpm }));
              }
            }, time);
          }
        }

        if (!eventGapMuted && beatData?.enabled && step > 0) {
          const note = SOUND_NOTES[current.sound];
          const frequency = step === 2 ? note.accent : note.normal;
          const velocity = step === 2 ? 1 : 0.74;
          instruments[current.sound].triggerAttackRelease(frequency, note.duration, time, velocity);
        }

        Tone.getDraw().schedule(() => {
          if (generationRef.current !== run || !playingRef.current) return;
          setVisual({
            bar: event.bar,
            beat: event.beat,
            sub: event.sub,
            pulse: performance.now(),
            hit: Boolean(!eventGapMuted && beatData?.enabled && step > 0),
            gap: eventGapMuted,
          });
        }, time);

        if (enteredBar) barsRef.current += 1;
      }, plan.events.map((event) => [Tone.Ticks(event.ticks), event]));
      part.loopEnd = Tone.Ticks(plan.totalTicks);
      part.loop = true;
      part.start(0);

      audioRef.current = { part, instruments, output };
      playingRef.current = true;
      setPlaying(true);
      setStatus("运行中");
      transport.start(preserveTempo ? "+0.025" : "+0.05");
    } catch {
      if (run === generationRef.current) stop("请再次点击");
    } finally {
      if (run === generationRef.current) startingRef.current = false;
    }
  }, [disposeAudio, isIOS, stop]);

  const refreshPlayback = useCallback(
    async () => {
      if (!playbackIntentRef.current || startingRef.current || refreshingRef.current) return;
      refreshingRef.current = true;
      try {
        let revision;
        do {
          revision = rhythmRevisionRef.current;
          if (isIOS) {
            try {
              if (audioRef.current?.media) {
                audioRef.current.gapPattern = makeActiveGapPattern(settingsRef.current);
                await syncMediaLoop(audioRef.current, settingsRef.current);
              }
              if (playbackIntentRef.current) setStatus("运行中");
            } catch {
              if (playbackIntentRef.current) setStatus("继续播放原节奏");
            }
          } else {
            playingRef.current = false;
            disposeAudio();
            await start(true);
          }
        } while (playbackIntentRef.current && revision !== rhythmRevisionRef.current);
      } finally {
        refreshingRef.current = false;
      }
    },
    [disposeAudio, isIOS, start],
  );

  const togglePlayback = useCallback(async () => {
    if (playbackIntentRef.current) {
      stop();
      return;
    }
    playbackIntentRef.current = true;
    const revision = rhythmRevisionRef.current;
    await start();
    if (playbackIntentRef.current && revision !== rhythmRevisionRef.current) {
      await refreshPlayback();
    }
  }, [refreshPlayback, start, stop]);

  const tapTempo = useCallback(() => {
    const now = performance.now();
    const previous = tapsRef.current.at(-1);
    if (!previous || now - previous > 2000) tapsRef.current = [];
    tapsRef.current = [...tapsRef.current, now].slice(-5);
    const measured = bpmFromTaps(tapsRef.current);
    if (measured) {
      setBpm(measured);
      setStatus(`${measured} BPM`);
    } else {
      setStatus("继续 Tap");
    }
  }, [setBpm]);

  const commitBpm = useCallback(() => {
    setBpm(bpmDraft || settings.bpm);
    setBpmDraft(String(clampBpm(bpmDraft || settings.bpm)));
  }, [bpmDraft, setBpm, settings.bpm]);

  useEffect(() => {
    settingsRef.current = settings;
    if (!bpmEditingRef.current) setBpmDraft(String(settings.bpm));
    try {
      localStorage.setItem("pulse-settings", JSON.stringify(settings));
    } catch {
      // Private browsing can deny storage; playback should still work.
    }

    if (audioRef.current?.media) {
      syncMediaLoop(audioRef.current, settings).catch(() => {
        if (playbackIntentRef.current) setStatus("继续播放原节奏");
      });
    } else {
      const bpm = Tone.getTransport().bpm;
      if (Math.round(bpm.value) !== settings.bpm) bpm.value = settings.bpm;
    }
  }, [settings]);

  useEffect(() => {
    if (advancedRhythm && playing) setEditorBarIndex(visual.bar);
  }, [advancedRhythm, playing, visual.bar]);

  useEffect(() => {
    audioRef.current?.output?.gain.rampTo(
      settings.muted ? 0 : settings.volume / 100,
      0.03,
    );
  }, [settings.muted, settings.volume]);

  useEffect(() => {
    const handleKey = (event) => {
      if (event.target.closest("input, button, select, textarea, [contenteditable='true']")) return;
      if ((event.key === " " || event.key.toLowerCase() === "t") && event.repeat) return;

      if (event.key === " ") {
        event.preventDefault();
        togglePlayback();
      } else if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        tapTempo();
      } else if (["ArrowUp", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        if (event.repeat) return;
        setBpm(settingsRef.current.bpm + (event.shiftKey ? 5 : 1));
      } else if (["ArrowDown", "ArrowLeft"].includes(event.key)) {
        event.preventDefault();
        if (event.repeat) return;
        setBpm(settingsRef.current.bpm - (event.shiftKey ? 5 : 1));
      }
    };

    const restoreAudio = () => {
      if (document.visibilityState !== "visible" || !playingRef.current) return;
      if (audioRef.current?.media?.paused) {
        audioRef.current.media
          .play()
          .then(() => setStatus("运行中"))
          .catch(() => setStatus("点击恢复"));
      }
      if (!audioRef.current?.media && Tone.getContext().state !== "running") {
        Tone.start().catch(() => setStatus("点击恢复"));
      }
    };

    window.addEventListener("keydown", handleKey);
    document.addEventListener("visibilitychange", restoreAudio);
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.removeEventListener("visibilitychange", restoreAudio);
    };
  }, [setBpm, tapTempo, togglePlayback]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      playbackIntentRef.current = false;
      playingRef.current = false;
      disposeAudio();
      setAudioSession("auto");
    },
    [disposeAudio],
  );

  useEffect(() => {
    const syncPage = () => {
      setAdvancedRhythm(window.location.hash === "#rhythm");
      if (playbackIntentRef.current && settingsRef.current.gapClick) {
        rhythmRevisionRef.current += 1;
        void refreshPlayback();
      }
    };
    window.addEventListener("hashchange", syncPage);
    return () => window.removeEventListener("hashchange", syncPage);
  }, [refreshPlayback]);

  useEffect(() => {
    const captureInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const markInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setShowInstallHelp(false);
    };

    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  useEffect(() => {
    const dialog = installDialogRef.current;
    if (!dialog) return;
    if (showInstallHelp && !dialog.open) dialog.showModal();
    else if (!showInstallHelp && dialog.open) dialog.close();
  }, [showInstallHelp]);

  useEffect(() => {
    const dialog = rhythmDialogRef.current;
    if (!dialog) return;
    if (showRhythmCode && !dialog.open) dialog.showModal();
    else if (!showRhythmCode && dialog.open) dialog.close();
  }, [showRhythmCode]);

  const updateBeat = (barIndex, beatIndex, updater, structural = false) => {
    if (structural && playbackIntentRef.current) stop("节奏已更新");
    const bars = settingsRef.current.bars.map((bar, currentBar) =>
      currentBar === barIndex
        ? {
            beats: bar.beats.map((beat, currentBeat) =>
              currentBeat === beatIndex ? updater(beat) : beat,
            ),
          }
        : bar,
    );
    barsRef.current = 0;
    updateSettings({ bars });
  };

  const resizeBeat = (beatIndex, amount) => {
    const length = settingsRef.current.bars[editorBarIndex].beats[beatIndex].steps.length;
    if ((amount < 0 && length === 1) || (amount > 0 && length === MAX_SUBDIVISION)) return;
    updateBeat(
      editorBarIndex,
      beatIndex,
      (beat) => ({
        ...beat,
        steps:
          amount > 0
            ? [...beat.steps, 1]
            : beat.steps.slice(0, Math.max(1, beat.steps.length - 1)),
      }),
      true,
    );
  };

  const toggleBeat = (beatIndex) => {
    updateBeat(editorBarIndex, beatIndex, (beat) => ({ ...beat, enabled: !beat.enabled }));
  };

  const toggleStep = (beatIndex, sub, accent = false) => {
    updateBeat(editorBarIndex, beatIndex, (beat) => {
      const steps = [...beat.steps];
      steps[sub] = accent ? (steps[sub] === 2 ? 1 : 2) : steps[sub] === 0 ? 1 : 0;
      return { ...beat, steps };
    });
  };

  const resizeBar = (amount) => {
    const bars = settingsRef.current.bars;
    const bar = bars[editorBarIndex];
    if ((amount < 0 && bar.beats.length === 1) || (amount > 0 && bar.beats.length === MAX_BEATS)) {
      return;
    }
    if (playbackIntentRef.current) stop("节奏已更新");
    const beats =
      amount > 0
        ? [...bar.beats, cloneBeat(bar.beats.at(-1))]
        : bar.beats.slice(0, -1);
    updateSettings({
      bars: bars.map((current, index) => (index === editorBarIndex ? { beats } : current)),
    });
  };

  const duplicateBar = () => {
    const current = settingsRef.current;
    if (current.bars.length === MAX_BARS) return;
    if (playbackIntentRef.current) stop("节奏已更新");
    const bars = [...current.bars];
    const nextIndex = editorBarIndex + 1;
    bars.splice(nextIndex, 0, cloneBar(bars[editorBarIndex]));
    setEditorBarIndex(nextIndex);
    updateSettings({ bars, loopBar: current.loopBar === null ? null : nextIndex });
  };

  const deleteBar = () => {
    const current = settingsRef.current;
    if (current.bars.length === 1) return;
    if (playbackIntentRef.current) stop("节奏已更新");
    const bars = current.bars.filter((_, index) => index !== editorBarIndex);
    const nextIndex = Math.min(editorBarIndex, bars.length - 1);
    setEditorBarIndex(nextIndex);
    updateSettings({ bars, loopBar: current.loopBar === null ? null : nextIndex });
  };

  const selectBar = (index) => {
    const current = settingsRef.current;
    if (current.loopBar !== null && current.loopBar !== index) {
      if (playbackIntentRef.current) stop("循环已更新");
      updateSettings({ loopBar: index });
    }
    setEditorBarIndex(index);
  };

  const toggleBarLoop = () => {
    if (playbackIntentRef.current) stop("循环已更新");
    updateSettings({ loopBar: settingsRef.current.loopBar === null ? editorBarIndex : null });
  };

  const applyQuickRhythm = (patch) => {
    const resume = playbackIntentRef.current;
    rhythmRevisionRef.current += 1;
    updateSettings(patch);
    if (!resume) return;
    setStatus("切换节奏…");
    void refreshPlayback();
  };

  const changeQuickMeter = (beats) => {
    const bar = settingsRef.current.bars[0];
    const pattern = plainSteps(bar.beats[0]);
    setEditorBarIndex(0);
    applyQuickRhythm({
      bars: [{ beats: applyBeatPattern(bar.beats, pattern, beats) }],
      loopBar: null,
    });
  };

  const changeQuickPattern = (pattern) => {
    const bar = settingsRef.current.bars[0];
    setEditorBarIndex(0);
    applyQuickRhythm({
      bars: [{ beats: applyBeatPattern(bar.beats, pattern, bar.beats.length) }],
      loopBar: null,
    });
  };

  const cycleQuickBeat = (beatIndex) => {
    if (settingsRef.current.bars.length !== 1) return;
    const bar = settingsRef.current.bars[0];
    applyQuickRhythm({
      bars: [{
        beats: bar.beats.map((beat, index) =>
          index === beatIndex ? cycleBeatState(beat) : beat,
        ),
      }],
    });
  };

  const exportRhythm = async () => {
    const code = encodeRhythm(settingsRef.current);
    setRhythmCode(code);
    setShowRhythmCode(true);
    try {
      await navigator.clipboard.writeText(code);
      setStatus("节奏编码已复制");
    } catch {
      setStatus("请手动复制编码");
    }
  };

  const importRhythm = () => {
    try {
      const rhythm = decodeRhythm(rhythmCode);
      if (playbackIntentRef.current) stop("节奏已导入");
      setEditorBarIndex(rhythm.loopBar ?? 0);
      setBpmDraft(String(rhythm.bpm));
      setSelectedRhythmId("");
      setRhythmName("");
      updateSettings({ ...rhythm, startBpm: rhythm.bpm });
      setShowRhythmCode(false);
      setStatus("节奏已导入");
    } catch {
      setStatus("编码无效");
    }
  };

  const saveLocalRhythm = () => {
    const existingIndex = savedRhythms.findIndex(({ id }) => id === selectedRhythmId);
    if (existingIndex < 0 && savedRhythms.length >= 50) {
      setStatus("最多保存 50 个节奏");
      return;
    }

    const id =
      existingIndex >= 0
        ? selectedRhythmId
        : crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const baseName = (rhythmName.trim() || rhythmDefaultName(settingsRef.current)).slice(0, 40);
    const usedNames = new Set(
      savedRhythms.filter((item) => item.id !== id).map((item) => item.name),
    );
    let name = baseName;
    let suffix = 2;
    while (usedNames.has(name)) {
      const ending = ` (${suffix++})`;
      name = `${baseName.slice(0, 40 - ending.length)}${ending}`;
    }

    const item = { id, name, code: encodeRhythm(settingsRef.current) };
    const next =
      existingIndex >= 0
        ? savedRhythms.map((saved) => (saved.id === id ? item : saved))
        : [...savedRhythms, item];
    try {
      localStorage.setItem(RHYTHM_LIBRARY_KEY, JSON.stringify(next));
      setSavedRhythms(next);
      setSelectedRhythmId(id);
      setRhythmName(name);
      setStatus("已保存到本机");
    } catch {
      setStatus("本地保存失败");
    }
  };

  const switchLocalRhythm = (id) => {
    setSelectedRhythmId(id);
    if (!id) {
      setRhythmName("");
      return;
    }
    const saved = savedRhythms.find((item) => item.id === id);
    if (!saved) return;
    try {
      const rhythm = decodeRhythm(saved.code);
      if (playbackIntentRef.current) stop("节奏已切换");
      setEditorBarIndex(rhythm.loopBar ?? 0);
      setBpmDraft(String(rhythm.bpm));
      setRhythmName(saved.name);
      updateSettings({ ...rhythm, startBpm: rhythm.bpm });
      setStatus("节奏已切换");
    } catch {
      setStatus("保存的节奏无效");
    }
  };

  const changeTrainer = (patch) => {
    barsRef.current = 0;
    minuteDeadlineRef.current = audioRef.current?.media
      ? performance.now() / 1000 - audioRef.current.startedAt + 60
      : Tone.getTransport().seconds + 60;
    updateSettings(patch);
  };

  const changeGapClick = (patch) => {
    applyQuickRhythm(patch);
  };

  const commitSliderBpm = (event) => {
    bpmEditingRef.current = false;
    setBpm(event.currentTarget.value);
  };

  const editorBar = settings.bars[editorBarIndex] ?? settings.bars[0];
  const displayBar = settings.bars[playing ? visual.bar : editorBarIndex] ?? editorBar;
  const previewBpm = clampBpm(bpmDraft || settings.bpm);
  const quickBar = settings.bars[0];
  const quickSteps = plainSteps(quickBar.beats[0]);
  const simpleRhythm =
    settings.bars.length === 1 &&
    quickBar.beats.every((beat) => JSON.stringify(plainSteps(beat)) === JSON.stringify(quickSteps));
  const quickPattern = simpleRhythm
    ? QUICK_PATTERNS.find(({ steps }) => JSON.stringify(steps) === JSON.stringify(quickSteps))?.id
    : "";
  const matrixHeight =
    Math.max(...editorBar.beats.map((beat) => beat.steps.length)) * 48 + 44;

  const installApp = async () => {
    if (isIOS || !installPrompt) {
      setShowInstallHelp(true);
      return;
    }

    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      if (choice.outcome === "accepted") setInstalled(true);
    } catch {
      setInstallPrompt(null);
      setShowInstallHelp(true);
    }
  };

  return (
    <div className={`app-shell ${playing ? "is-playing" : ""}`}>
      <header className="topbar">
        <a className="brand" href="#main" aria-label="Pulse 节拍器首页">
          <span className="brand-mark" aria-hidden="true">
            <Activity strokeWidth={2.4} />
          </span>
          <strong>Pulse</strong>
        </a>
        <div className="topbar-actions">
          <div className="ready-pill" role="status" aria-live="polite">
            <span aria-hidden="true" />
            {status}
          </div>
          {playing && (
            <button className="topbar-stop" type="button" onClick={() => stop()}>
              <Pause fill="currentColor" />
              暂停
            </button>
          )}
        </div>
      </header>

      <main
        id="main"
        className={`workspace ${advancedRhythm ? "is-rhythm-page" : ""}`}
      >
        <section
          className="card stage-card"
          aria-labelledby="tempo-heading"
          hidden={advancedRhythm}
        >
          <div className="section-kicker">
            <span>BPM</span>
            <span className="tempo-name">{tempoName(previewBpm)}</span>
          </div>

          <h1 id="tempo-heading" className="sr-only">
            节拍器速度
          </h1>

          <div className="tempo-stage">
            <div className="orbit" aria-hidden="true">
              {playing && visual.hit && <span key={visual.pulse} className="pulse-flare" />}
              <span className="orbit-track" />
            </div>
            <div className="tempo-readout">
              <label className="sr-only" htmlFor="bpm-input">
                每分钟节拍数
              </label>
              <div className="bpm-line">
                <input
                  id="bpm-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={bpmDraft}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => {
                    if (/^\d{0,3}$/.test(event.target.value)) setBpmDraft(event.target.value);
                  }}
                  onBlur={commitBpm}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  aria-describedby="bpm-unit"
                />
                <span id="bpm-unit">BPM</span>
              </div>
              <div className="tempo-meta" aria-hidden="true">
                <span className="beat-count">
                  {playing && !visual.gap ? visual.beat + 1 : "—"} / {displayBar.beats.length}
                </span>
                {settings.trainer && (
                  <span className="trainer-target">→ {settings.targetBpm}</span>
                )}
              </div>
            </div>
          </div>

          <div className="beat-dots" aria-hidden="true">
            {displayBar.beats.map((beat, index) => (
              <span
                key={index}
                className={[
                  beat.steps[0] === 2 ? "is-accent" : "",
                  !beat.enabled ? "is-muted" : "",
                  playing && !visual.gap && index === visual.beat ? "is-active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
            ))}
          </div>

          <div className="tempo-control">
            <button
              className="icon-button"
              type="button"
              onClick={() => setBpm(settings.bpm - 1)}
              aria-label="速度减 1 BPM"
            >
              <Minus />
            </button>
            <input
              className="tempo-slider"
              type="range"
              min={BPM_MIN}
              max={BPM_MAX}
              step="1"
              value={previewBpm}
              onChange={(event) => {
                setBpmDraft(event.currentTarget.value);
                if (!bpmEditingRef.current) setBpm(event.currentTarget.value);
              }}
              onPointerDown={() => {
                bpmEditingRef.current = true;
              }}
              onPointerUp={commitSliderBpm}
              onPointerCancel={commitSliderBpm}
              onKeyDown={() => {
                bpmEditingRef.current = true;
              }}
              onKeyUp={commitSliderBpm}
              onBlur={commitSliderBpm}
              aria-label="速度"
              style={{
                "--range-progress": `${((previewBpm - BPM_MIN) / (BPM_MAX - BPM_MIN)) * 100}%`,
              }}
            />
            <button
              className="icon-button"
              type="button"
              onClick={() => setBpm(settings.bpm + 1)}
              aria-label="速度加 1 BPM"
            >
              <Plus />
            </button>
          </div>

          <div className="transport-row">
            <button
              className="play-button"
              type="button"
              onClick={togglePlayback}
              aria-pressed={playing}
              aria-keyshortcuts="Space"
            >
              {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
              <span>{playing ? "暂停" : "开始"}</span>
            </button>
            <button className="tap-button" type="button" onClick={tapTempo} aria-keyshortcuts="T">
              <Hand />
              <span>Tap</span>
            </button>
          </div>
        </section>

        <aside
          className={`card settings-card ${advancedRhythm ? "advanced-rhythm-card" : ""}`}
          aria-labelledby="settings-heading"
        >
          <div className="settings-heading">
            {advancedRhythm ? (
              <a className="rhythm-back" href="#main" aria-label="返回设置">
                <ArrowLeft />
              </a>
            ) : (
              <h2 id="settings-heading">设置</h2>
            )}
            {advancedRhythm && <h2 id="settings-heading">高级节奏</h2>}
            {advancedRhythm && (
              <div className="rhythm-share-actions">
                <button type="button" onClick={exportRhythm} aria-label="复制节奏编码">
                  <Copy />
                  <span>复制</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRhythmCode("");
                    setShowRhythmCode(true);
                  }}
                  aria-label="导入节奏编码"
                >
                  <ClipboardPaste />
                  <span>导入</span>
                </button>
              </div>
            )}
            {!advancedRhythm && !installed && (
              <button className="install-button" type="button" onClick={installApp}>
                <Download />
                添加到桌面
              </button>
            )}
          </div>

          <div className="quick-rhythm" hidden={advancedRhythm}>
            <div className="setting-block quick-composer">
              <div className="quick-group">
                <span className="quick-caption">拍号</span>
                <div className="meter-wheels" role="group" aria-label="拍号">
                  <label>
                    <span className="sr-only">每小节拍数</span>
                    <select
                      value={settings.bars.length === 1 ? quickBar.beats.length : ""}
                      onChange={(event) => changeQuickMeter(Number(event.target.value))}
                    >
                      {settings.bars.length !== 1 && <option value="">—</option>}
                      {Array.from({ length: MAX_BEATS }, (_, index) => index + 1).map((beats) => (
                        <option key={beats} value={beats}>{beats}</option>
                      ))}
                    </select>
                  </label>
                  <span aria-hidden="true">/</span>
                  <label>
                    <span className="sr-only">拍号音符</span>
                    <select
                      value={settings.beatUnit}
                      onChange={(event) => updateSettings({ beatUnit: Number(event.target.value) })}
                    >
                      {BEAT_UNITS.map((unit) => (
                        <option key={unit} value={unit}>{unit}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="quick-group">
                <span className="quick-caption">每拍</span>
                <div
                  className={`beat-state-grid ${quickBar.beats.length > 4 ? "has-many-beats" : ""}`}
                  role="group"
                  aria-label="每拍重音和静音"
                  style={{ "--quick-beats": quickBar.beats.length }}
                >
                  {quickBar.beats.map((beat, index) => {
                    const state = !beat.enabled
                      ? "muted"
                      : beat.steps.includes(2)
                        ? "accent"
                        : "normal";
                    const stateLabel = { normal: "普通", accent: "重音", muted: "静音" }[state];
                    return (
                      <button
                        key={index}
                        className={[
                          `is-${state}`,
                          playing && !visual.gap && visual.bar === 0 && visual.beat === index
                            ? "is-playing"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        type="button"
                        onClick={() => cycleQuickBeat(index)}
                        disabled={settings.bars.length !== 1}
                        aria-label={`第 ${index + 1} 拍：${stateLabel}；点击切换`}
                        title={stateLabel}
                      >
                        <BeatStateGlyph beatUnit={settings.beatUnit} />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="quick-group">
                <span className="quick-caption">细分</span>
                <div className="rhythm-preset-grid" role="group" aria-label="常用节奏型">
                  {QUICK_PATTERNS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={quickPattern === option.id ? "is-selected" : ""}
                      aria-label={option.label}
                      aria-pressed={quickPattern === option.id}
                      title={option.label}
                      onClick={() => changeQuickPattern(option.steps)}
                    >
                      <RhythmPatternGlyph steps={option.steps} beatUnit={settings.beatUnit} />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <a
              className={`advanced-rhythm-link ${quickPattern ? "" : "is-active"}`}
              href="#rhythm"
            >
              <span>高级节奏</span>
              <ChevronRight />
            </a>
          </div>

          <div className="rhythm-library" hidden={!advancedRhythm}>
            <select
              value={selectedRhythmId}
              onChange={(event) => switchLocalRhythm(event.target.value)}
              aria-label="切换本地节奏"
            >
              <option value="">新节奏</option>
              {savedRhythms.map((saved) => (
                <option key={saved.id} value={saved.id}>{saved.name}</option>
              ))}
            </select>
            <input
              type="text"
              value={rhythmName}
              onChange={(event) => setRhythmName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveLocalRhythm();
              }}
              maxLength={40}
              placeholder={rhythmDefaultName(settings)}
              aria-label="节奏名称，可留空自动命名"
            />
            <button type="button" onClick={saveLocalRhythm}>
              <Save />
              <span>保存</span>
            </button>
          </div>

          <div className="advanced-transport" hidden={!advancedRhythm}>
            <button
              type="button"
              onClick={() => setBpm(settings.bpm - 1)}
              aria-label="速度减 1 BPM"
            >
              <Minus />
            </button>
            <label className="advanced-bpm">
              <span className="sr-only">每分钟节拍数</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={bpmDraft}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  if (/^\d{0,3}$/.test(event.target.value)) setBpmDraft(event.target.value);
                }}
                onBlur={commitBpm}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
              <em>BPM</em>
            </label>
            <button
              type="button"
              onClick={() => setBpm(settings.bpm + 1)}
              aria-label="速度加 1 BPM"
            >
              <Plus />
            </button>
            <button
              className="advanced-play"
              type="button"
              onClick={togglePlayback}
              aria-pressed={playing}
            >
              {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
              <span>{playing ? "暂停" : "开始"}</span>
            </button>
          </div>

          <div className="gap-click" hidden={!advancedRhythm}>
            <button
              className={settings.gapClick ? "is-active" : ""}
              type="button"
              onClick={() => changeGapClick({ gapClick: !settings.gapClick })}
              aria-pressed={settings.gapClick}
              title="时间轴继续，仅随机关闭声音和节拍动画"
            >
              <VolumeX />
              <span>随机空拍</span>
            </button>
            <div className="gap-levels" role="group" aria-label="随机空拍难度">
              {GAP_DIFFICULTIES.map((option) => (
                <button
                  key={option.value}
                  className={settings.gapDifficulty === option.value ? "is-selected" : ""}
                  type="button"
                  onClick={() => changeGapClick({ gapDifficulty: option.value })}
                  disabled={!settings.gapClick}
                  aria-pressed={settings.gapDifficulty === option.value}
                  title={option.title}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="setting-block rhythm-block" hidden={!advancedRhythm}>
            <div className="rhythm-toolbar">
              <button
                className={`matrix-icon-button ${settings.loopBar !== null ? "is-active" : ""}`}
                type="button"
                onClick={toggleBarLoop}
                aria-label={settings.loopBar === null ? "循环当前小节" : "循环全部小节"}
                aria-pressed={settings.loopBar !== null}
                title={settings.loopBar === null ? "循环当前小节" : "循环全部小节"}
              >
                <Repeat2 />
              </button>
              <div className="bar-pages" role="tablist" aria-label="小节">
                {settings.bars.map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    className={[
                      index === editorBarIndex ? "is-current" : "",
                      playing && !visual.gap && index === visual.bar ? "is-playing" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => selectBar(index)}
                    role="tab"
                    aria-selected={index === editorBarIndex}
                    aria-label={`第 ${index + 1} 小节`}
                  >
                    <i aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>

            <div
              className="rhythm-matrix"
              style={{
                "--matrix-height": `${matrixHeight}px`,
                "--beat-columns": editorBar.beats.length,
              }}
            >
              <button
                className="matrix-control bar-control"
                type="button"
                onClick={deleteBar}
                disabled={settings.bars.length === 1}
                aria-label="删除当前小节"
                title="删除当前小节"
              >
                <Minus />
              </button>

              <div
                className={`matrix-body ${editorBar.beats.length > 4 ? "has-many-beats" : ""}`}
              >
                <button
                  className="matrix-control beat-control"
                  type="button"
                  onClick={() => resizeBar(-1)}
                  disabled={editorBar.beats.length === 1}
                  aria-label="减少一拍"
                  title="减少一拍"
                >
                  <Minus />
                </button>

                <div className="matrix-columns">
                  {editorBar.beats.map((beat, beatIndex) => (
                    <fieldset
                      className={`rhythm-column ${beat.enabled ? "" : "is-disabled"}`}
                      key={beatIndex}
                    >
                      <legend className="sr-only">第 {beatIndex + 1} 拍</legend>
                      <button
                        className="matrix-control subdivision-control"
                        type="button"
                        onClick={() => resizeBeat(beatIndex, 1)}
                        disabled={beat.steps.length === MAX_SUBDIVISION}
                        aria-label={`增加第 ${beatIndex + 1} 拍的细分`}
                        title="增加细分"
                      >
                        <Plus />
                      </button>

                      <div className="matrix-track">
                        <div className="matrix-dot-track">
                          {beat.steps.map((step, sub) => {
                            const stateName = step === 2 ? "强音" : step === 1 ? "普通" : "静音";
                            const isTitle = sub === 0;
                            return (
                              <RhythmDot
                                key={sub}
                                className={[
                                  "rhythm-dot",
                                  `state-${step}`,
                                  isTitle ? "beat-title" : "",
                                  playing &&
                                  !visual.gap &&
                                  visual.bar === editorBarIndex &&
                                  visual.beat === beatIndex &&
                                  visual.sub === sub
                                    ? "is-playing"
                                    : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                style={{ "--dot-position": `${(sub / beat.steps.length) * 100}%` }}
                                onPress={
                                  isTitle
                                    ? () => toggleBeat(beatIndex)
                                    : () => toggleStep(beatIndex, sub)
                                }
                                onHold={() => toggleStep(beatIndex, sub, true)}
                                label={
                                  isTitle
                                    ? `第 ${beatIndex + 1} 拍：${beat.enabled ? "开启" : "静音"}`
                                    : `第 ${beatIndex + 1} 拍第 ${sub + 1} 格：${stateName}`
                                }
                                title={
                                  isTitle
                                    ? "点击开关整拍，长按切换强音"
                                    : `${stateName}；点击开关，长按切换强音`
                                }
                              />
                            );
                          })}
                        </div>
                      </div>

                      <button
                        className="matrix-control subdivision-control"
                        type="button"
                        onClick={() => resizeBeat(beatIndex, -1)}
                        disabled={beat.steps.length === 1}
                        aria-label={`减少第 ${beatIndex + 1} 拍的细分`}
                        title="减少细分"
                      >
                        <Minus />
                      </button>

                    </fieldset>
                  ))}
                </div>

                <button
                  className="matrix-control beat-control"
                  type="button"
                  onClick={() => resizeBar(1)}
                  disabled={editorBar.beats.length === MAX_BEATS}
                  aria-label="复制上一拍"
                  title="复制上一拍"
                >
                  <Plus />
                </button>
              </div>

              <button
                className="matrix-control bar-control"
                type="button"
                onClick={duplicateBar}
                disabled={settings.bars.length === MAX_BARS}
                aria-label="复制当前小节"
                title="复制当前小节"
              >
                <Plus />
              </button>
            </div>
          </div>

          <div className="setting-block" hidden={advancedRhythm}>
            <div className="setting-label">
              <span>音色</span>
            </div>
            <div className="sound-grid" aria-label="节拍音色">
              {SOUNDS.map((sound) => (
                <button
                  key={sound.value}
                  type="button"
                  className={settings.sound === sound.value ? "is-selected" : ""}
                  aria-pressed={settings.sound === sound.value}
                  onClick={() => updateSettings({ sound: sound.value })}
                >
                  <i className={`sound-mark sound-${sound.value}`} aria-hidden="true" />
                  <span>{sound.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="setting-block trainer-block" hidden={advancedRhythm}>
            <div className="setting-label trainer-heading">
              <span>自动变速</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.trainer}
                  onChange={(event) => changeTrainer({ trainer: event.target.checked })}
                  aria-label="自动变速"
                />
                <span aria-hidden="true" />
              </label>
            </div>
            {settings.trainer && (
              <div className="trainer-grid">
                <label>
                  <span>起始</span>
                  <span className="field-with-unit">
                    <input
                      key={settings.startBpm}
                      type="number"
                      min={BPM_MIN}
                      max={BPM_MAX}
                      defaultValue={settings.startBpm}
                      onBlur={(event) => {
                        const value = clampBpm(event.currentTarget.value);
                        event.currentTarget.value = value;
                        changeTrainer({ startBpm: value });
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                    <em>BPM</em>
                  </span>
                </label>
                <label>
                  <span>目标</span>
                  <span className="field-with-unit">
                    <input
                      key={settings.targetBpm}
                      type="number"
                      min={BPM_MIN}
                      max={BPM_MAX}
                      defaultValue={settings.targetBpm}
                      onBlur={(event) => {
                        const value = clampBpm(event.currentTarget.value);
                        event.currentTarget.value = value;
                        changeTrainer({ targetBpm: value });
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                    <em>BPM</em>
                  </span>
                </label>
                <label>
                  <span>间隔</span>
                  <select
                    value={
                      settings.changeMode === "minute"
                        ? "minute"
                        : `bars-${settings.changeEvery}`
                    }
                    onChange={(event) => {
                      const value = event.target.value;
                      changeTrainer(
                        value === "minute"
                          ? { changeMode: "minute" }
                          : { changeMode: "bars", changeEvery: Number(value.slice(5)) },
                      );
                    }}
                  >
                    {[1, 2, 4, 8, 16].map((bars) => (
                      <option key={bars} value={`bars-${bars}`}>
                        {bars} 小节
                      </option>
                    ))}
                    <option value="minute">每分钟</option>
                  </select>
                </label>
                <label>
                  <span>步长</span>
                  <select
                    value={settings.changeAmount}
                    onChange={(event) => changeTrainer({ changeAmount: Number(event.target.value) })}
                  >
                    {[1, 2, 3, 5, 10].map((amount) => (
                      <option key={amount} value={amount}>
                        {amount} BPM
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>

          <div className="setting-block volume-block" hidden={advancedRhythm}>
            <div className="setting-label">
              <span>音量</span>
              <small>{settings.muted ? "静音" : `${settings.volume}%`}</small>
            </div>
            <div className="volume-control">
              <button
                className="volume-button"
                type="button"
                onClick={() => updateSettings({ muted: !settings.muted })}
                aria-label={settings.muted ? "取消静音" : "静音"}
                aria-pressed={settings.muted}
              >
                {settings.muted ? <VolumeX /> : <Volume2 />}
              </button>
              <input
                type="range"
                min="0"
                max="100"
                value={settings.volume}
                onChange={(event) =>
                  updateSettings({ volume: Number(event.target.value), muted: false })
                }
                aria-label="节拍音量"
                style={{ "--range-progress": `${settings.volume}%` }}
              />
            </div>
          </div>
        </aside>
      </main>
      <dialog
        ref={rhythmDialogRef}
        className="install-dialog rhythm-code-dialog"
        aria-labelledby="rhythm-code-title"
        onClose={() => setShowRhythmCode(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setShowRhythmCode(false);
        }}
      >
        <button
          className="dialog-close"
          type="button"
          onClick={() => setShowRhythmCode(false)}
          aria-label="关闭"
        >
          <X />
        </button>
        <h2 id="rhythm-code-title">节奏编码</h2>
        <textarea
          value={rhythmCode}
          onChange={(event) => setRhythmCode(event.target.value.trim())}
          placeholder="粘贴节奏编码"
          aria-label="节奏编码"
          maxLength={12000}
          autoFocus
          spellCheck="false"
        />
        <div className="rhythm-code-actions">
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(rhythmCode);
                setStatus("节奏编码已复制");
              } catch {
                setStatus("请手动复制编码");
              }
            }}
            disabled={!rhythmCode}
          >
            <Copy />
            复制
          </button>
          <button type="button" onClick={importRhythm} disabled={!rhythmCode}>
            <ClipboardPaste />
            导入
          </button>
        </div>
      </dialog>
      <dialog
        ref={installDialogRef}
        className="install-dialog"
        aria-labelledby="install-title"
        onClose={() => setShowInstallHelp(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setShowInstallHelp(false);
        }}
      >
        <button
          className="dialog-close"
          type="button"
          onClick={() => setShowInstallHelp(false)}
          aria-label="关闭"
        >
          <X />
        </button>
        <span className="dialog-icon" aria-hidden="true">
          <Download />
        </span>
        <h2 id="install-title">添加 Pulse 到桌面</h2>
        {isIOS ? (
          <ol className="install-steps">
            <li>
              点击 Safari 的 <Share2 aria-hidden="true" /> 分享
            </li>
            <li>选择“添加到主屏幕”</li>
            <li>开启“打开为 Web App”</li>
            <li>点击“添加”</li>
          </ol>
        ) : (
          <p>打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。</p>
        )}
        <button className="dialog-done" type="button" onClick={() => setShowInstallHelp(false)}>
          知道了
        </button>
      </dialog>
    </div>
  );
}
