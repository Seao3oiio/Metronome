import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Download,
  Hand,
  Minus,
  Pause,
  Play,
  Plus,
  Repeat2,
  Share2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import * as Tone from "tone";
import {
  BPM_MAX,
  BPM_MIN,
  MAX_BARS,
  MAX_BEATS,
  MAX_SUBDIVISION,
  advanceMinuteDeadline,
  bpmFromTaps,
  clampBpm,
  compileRhythm,
  makeClickTrackWav,
  makeBar,
  normalizeBars,
  nextTrainingBpm,
  rhythmEventIndexAtTime,
  tempoName,
} from "./metronome.js";

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
  bars: null,
  loopBar: null,
  sound: "click",
  trainer: false,
  startBpm: 96,
  targetBpm: 120,
  changeMode: "bars",
  changeEvery: 4,
  changeAmount: 2,
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

    const legacyBeats = Number.isInteger(saved.beats)
      ? Math.min(MAX_BEATS, Math.max(1, saved.beats))
      : 4;
    const legacySubdivision = Number.isInteger(saved.subdivision)
      ? Math.min(MAX_SUBDIVISION, Math.max(1, saved.subdivision))
      : 1;
    const validLegacyPattern =
      Array.isArray(saved.pattern) &&
      saved.pattern.length === legacyBeats * legacySubdivision &&
      saved.pattern.every((step) => [0, 1, 2].includes(step));
    const legacyBar = makeBar(legacyBeats, legacySubdivision);
    if (validLegacyPattern) {
      legacyBar.beats = legacyBar.beats.map((beat, index) => ({
        ...beat,
        steps: saved.pattern.slice(
          index * legacySubdivision,
          (index + 1) * legacySubdivision,
        ),
      }));
    } else if (saved.accent === false) {
      legacyBar.beats[0].steps[0] = 1;
    }
    const bars = normalizeBars(saved.bars) ?? [legacyBar];
    const loopBar =
      Number.isInteger(saved.loopBar) && saved.loopBar >= 0 && saved.loopBar < bars.length
        ? saved.loopBar
        : null;
    const {
      beats: _legacyBeats,
      subdivision: _legacySubdivision,
      pattern: _legacyPattern,
      accent: _legacyAccent,
      ...savedSettings
    } = saved;

    return {
      ...defaults,
      ...savedSettings,
      schemaVersion: 2,
      bpm: clampBpm(saved.bpm ?? defaults.bpm),
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
      muted: Boolean(saved.muted),
    };
  } catch {
    return freshSettings();
  }
}

function cloneBeat(beat) {
  return { ...beat, steps: [...beat.steps] };
}

function cloneBar(bar) {
  return { beats: bar.beats.map(cloneBeat) };
}

function RhythmDot({ className, label, title, onPress, onHold, style }) {
  const timerRef = useRef(null);
  const heldRef = useRef(false);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const startHold = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    heldRef.current = false;
    timerRef.current = setTimeout(() => {
      heldRef.current = true;
      onHold?.();
    }, 480);
  };
  const clearHold = () => clearTimeout(timerRef.current);

  return (
    <button
      className={className}
      type="button"
      style={style}
      aria-label={label}
      title={title}
      onPointerDown={startHold}
      onPointerUp={clearHold}
      onPointerCancel={clearHold}
      onPointerLeave={clearHold}
      onClick={(event) => {
        if (heldRef.current) {
          event.preventDefault();
          heldRef.current = false;
        } else {
          onPress();
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!heldRef.current) onHold?.();
        heldRef.current = false;
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

function mediaTrackKey(settings) {
  return JSON.stringify([settings.bpm, settings.sound, settings.loopBar, settings.bars]);
}

async function syncMediaLoop(audio, settings) {
  audio.media.volume = settings.muted ? 0 : settings.volume / 100;
  const key = mediaTrackKey(settings);
  if (audio.mediaKey === key) return;

  const url = URL.createObjectURL(
    new Blob([makeClickTrackWav(settings)], { type: "audio/wav" }),
  );
  const previousUrl = audio.url;
  audio.media.src = url;
  audio.mediaKey = key;
  audio.lastEvent = -1;
  audio.lastTime = -1;
  audio.plan = compileRhythm(settings.bars, settings.loopBar, 1);
  audio.url = url;
  await audio.media.play();
  if (previousUrl) URL.revokeObjectURL(previousUrl);
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [bpmDraft, setBpmDraft] = useState(String(settings.bpm));
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState("就绪");
  const [visual, setVisual] = useState({ bar: 0, beat: 0, sub: 0, pulse: 0, hit: false });
  const [editorBarIndex, setEditorBarIndex] = useState(() => settings.loopBar ?? 0);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [installed, setInstalled] = useState(
    () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true,
  );

  const settingsRef = useRef(settings);
  const playingRef = useRef(false);
  const startingRef = useRef(false);
  const barsRef = useRef(0);
  const minuteDeadlineRef = useRef(60);
  const tapsRef = useRef([]);
  const generationRef = useRef(0);
  const audioRef = useRef(null);
  const installDialogRef = useRef(null);
  const isIOS = isIOSDevice();

  const updateSettings = useCallback((patch) => {
    settingsRef.current = { ...settingsRef.current, ...patch };
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const setBpm = useCallback(
    (value) => updateSettings({ bpm: clampBpm(value) }),
    [updateSettings],
  );

  const disposeAudio = useCallback(() => {
    if (!audioRef.current) return;
    if (audioRef.current?.media) {
      cancelAnimationFrame(audioRef.current.raf);
      audioRef.current.media.pause();
      audioRef.current.media.removeAttribute("src");
      if (audioRef.current.url) URL.revokeObjectURL(audioRef.current.url);
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
      playingRef.current = false;
      setPlaying(false);
      setVisual({ bar: 0, beat: 0, sub: 0, pulse: 0, hit: false });
      setStatus(message);
      disposeAudio();
      setAudioSession("auto");
    },
    [disposeAudio],
  );

  const start = useCallback(async () => {
    if (startingRef.current || playingRef.current) return;
    startingRef.current = true;
    setStatus("开启声音…");
    disposeAudio();
    const run = ++generationRef.current;

    try {
      setAudioSession("playback");
      if (settingsRef.current.trainer) {
        const bpm = settingsRef.current.startBpm;
        settingsRef.current = { ...settingsRef.current, bpm };
        setSettings((current) => ({ ...current, bpm }));
      }

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
          startedAt: performance.now() / 1000,
        };
        audioRef.current = mediaAudio;
        await syncMediaLoop(mediaAudio, settingsRef.current);
        if (run !== generationRef.current) return;
        mediaAudio.startedAt = performance.now() / 1000;

        barsRef.current = 0;
        minuteDeadlineRef.current = 60;
        playingRef.current = true;
        setPlaying(true);
        setStatus("运行中");

        const draw = () => {
          if (generationRef.current !== run || !playingRef.current) return;
          const current = settingsRef.current;
          const eventIndex = rhythmEventIndexAtTime(
            media.currentTime,
            current.bpm,
            mediaAudio.plan,
          );
          const wrapped = mediaAudio.lastTime >= 0 && media.currentTime < mediaAudio.lastTime;

          if (eventIndex !== mediaAudio.lastEvent || wrapped) {
            const event = mediaAudio.plan.events[eventIndex];
            const beatData = current.bars[event.bar]?.beats[event.beat];
            const step = beatData?.steps[event.sub] ?? 0;
            const enteredBar =
              mediaAudio.lastEvent >= 0 && event.beat === 0 && event.sub === 0;
            if (enteredBar) barsRef.current += 1;
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
              hit: beatData?.enabled && step > 0,
            });
            mediaAudio.lastEvent = eventIndex;
          }
          mediaAudio.lastTime = media.currentTime;
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
      transport.bpm.value = settingsRef.current.bpm;

      const plan = compileRhythm(
        settingsRef.current.bars,
        settingsRef.current.loopBar,
        transport.PPQ,
      );
      const part = new Tone.Part((time, event) => {
        let current = settingsRef.current;
        const beatData = current.bars[event.bar]?.beats[event.beat];
        const step = beatData?.steps[event.sub] ?? 0;
        const enteredBar = event.beat === 0 && event.sub === 0;

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

        if (beatData?.enabled && step > 0) {
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
            hit: Boolean(beatData?.enabled && step > 0),
          });
        }, time);

        if (enteredBar) barsRef.current += 1;
      }, plan.events.map((event) => [Tone.Ticks(event.ticks), event]));
      part.loop = true;
      part.loopEnd = Tone.Ticks(plan.totalTicks);
      part.start(0);

      audioRef.current = { part, instruments, output };
      playingRef.current = true;
      setPlaying(true);
      setStatus("运行中");
      transport.start("+0.05");
    } catch {
      stop("请再次点击");
    } finally {
      startingRef.current = false;
    }
  }, [disposeAudio, isIOS, stop]);

  const togglePlayback = useCallback(() => {
    if (playingRef.current) stop();
    else start();
  }, [start, stop]);

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
    setBpmDraft(String(settings.bpm));
    try {
      localStorage.setItem("pulse-settings", JSON.stringify(settings));
    } catch {
      // Private browsing can deny storage; playback should still work.
    }

    if (audioRef.current?.media) {
      syncMediaLoop(audioRef.current, settings).catch(() => setStatus("点击恢复"));
    } else {
      Tone.getTransport().bpm.rampTo(settings.bpm, 0.04);
    }
    audioRef.current?.output?.gain.rampTo(
      settings.muted ? 0 : settings.volume / 100,
      0.03,
    );
  }, [settings]);

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
        setBpm(settingsRef.current.bpm + (event.shiftKey ? 5 : 1));
      } else if (["ArrowDown", "ArrowLeft"].includes(event.key)) {
        event.preventDefault();
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
      playingRef.current = false;
      disposeAudio();
      setAudioSession("auto");
    },
    [disposeAudio],
  );

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

  const updateBeat = (barIndex, beatIndex, updater, structural = false) => {
    if (structural && playingRef.current) stop("节奏已更新");
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
    if (playingRef.current) stop("节奏已更新");
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
    if (playingRef.current) stop("节奏已更新");
    const bars = [...current.bars];
    const nextIndex = editorBarIndex + 1;
    bars.splice(nextIndex, 0, cloneBar(bars[editorBarIndex]));
    setEditorBarIndex(nextIndex);
    updateSettings({ bars, loopBar: current.loopBar === null ? null : nextIndex });
  };

  const deleteBar = () => {
    const current = settingsRef.current;
    if (current.bars.length === 1) return;
    if (playingRef.current) stop("节奏已更新");
    const bars = current.bars.filter((_, index) => index !== editorBarIndex);
    const nextIndex = Math.min(editorBarIndex, bars.length - 1);
    setEditorBarIndex(nextIndex);
    updateSettings({ bars, loopBar: current.loopBar === null ? null : nextIndex });
  };

  const selectBar = (index) => {
    const current = settingsRef.current;
    if (current.loopBar !== null && current.loopBar !== index) {
      if (playingRef.current) stop("循环已更新");
      updateSettings({ loopBar: index });
    }
    setEditorBarIndex(index);
  };

  const toggleBarLoop = () => {
    if (playingRef.current) stop("循环已更新");
    updateSettings({ loopBar: settingsRef.current.loopBar === null ? editorBarIndex : null });
  };

  const changeTrainer = (patch) => {
    barsRef.current = 0;
    minuteDeadlineRef.current = audioRef.current?.media
      ? performance.now() / 1000 - audioRef.current.startedAt + 60
      : Tone.getTransport().seconds + 60;
    updateSettings(patch);
  };

  const editorBar = settings.bars[editorBarIndex] ?? settings.bars[0];
  const displayBar = settings.bars[playing ? visual.bar : editorBarIndex] ?? editorBar;
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

      <main id="main" className="workspace">
        <section className="card stage-card" aria-labelledby="tempo-heading">
          <div className="section-kicker">
            <span>BPM</span>
            <span className="tempo-name">{tempoName(settings.bpm)}</span>
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
                  {playing ? visual.beat + 1 : "—"} / {displayBar.beats.length}
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
                  playing && index === visual.beat ? "is-active" : "",
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
              value={settings.bpm}
              onChange={(event) => setBpm(event.target.value)}
              aria-label="速度"
              style={{
                "--range-progress": `${((settings.bpm - BPM_MIN) / (BPM_MAX - BPM_MIN)) * 100}%`,
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

        <aside className="card settings-card" aria-labelledby="settings-heading">
          <div className="settings-heading">
            <h2 id="settings-heading">设置</h2>
            {!installed && (
              <button className="install-button" type="button" onClick={installApp}>
                <Download />
                添加到桌面
              </button>
            )}
          </div>

          <div className="setting-block rhythm-block">
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
                      playing && index === visual.bar ? "is-playing" : "",
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
                        onClick={() => resizeBeat(beatIndex, -1)}
                        disabled={beat.steps.length === 1}
                        aria-label={`减少第 ${beatIndex + 1} 拍的细分`}
                        title="减少细分"
                      >
                        <Minus />
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
                        onClick={() => resizeBeat(beatIndex, 1)}
                        disabled={beat.steps.length === MAX_SUBDIVISION}
                        aria-label={`增加第 ${beatIndex + 1} 拍的细分`}
                        title="增加细分"
                      >
                        <Plus />
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

          <div className="setting-block">
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

          <div className="setting-block trainer-block">
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

          <div className="setting-block volume-block">
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
