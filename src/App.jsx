import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Download,
  Hand,
  Minus,
  Pause,
  Play,
  Plus,
  Share2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import * as Tone from "tone";
import {
  BPM_MAX,
  BPM_MIN,
  advanceMinuteDeadline,
  bpmFromTaps,
  clampBpm,
  makePattern,
  nextTrainingBpm,
  tempoName,
} from "./metronome.js";

const SUBDIVISIONS = [
  { value: 1, label: "主拍" },
  { value: 2, label: "八分" },
  { value: 3, label: "三连" },
  { value: 4, label: "十六" },
  { value: 5, label: "五连" },
  { value: 6, label: "六连" },
  { value: 8, label: "三十二" },
];

const SOUNDS = [
  { value: "click", label: "清脆" },
  { value: "wood", label: "木鱼" },
  { value: "drum", label: "鼓点" },
  { value: "soft", label: "柔和" },
];

const SOUND_NOTES = {
  click: { accent: 1660, main: 1080, sub: 620, duration: 0.025 },
  wood: { accent: 820, main: 610, sub: 430, duration: 0.045 },
  drum: { accent: 180, main: 120, sub: 82, duration: 0.07 },
  soft: { accent: 940, main: 720, sub: 520, duration: 0.04 },
};

const DEFAULT_SETTINGS = {
  bpm: 96,
  beats: 4,
  subdivision: 1,
  pattern: makePattern(4, 1),
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

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("pulse-settings"));
    if (!saved) return DEFAULT_SETTINGS;

    const beats = [2, 3, 4, 6].includes(saved.beats) ? saved.beats : 4;
    const subdivision = SUBDIVISIONS.some(({ value }) => value === saved.subdivision)
      ? saved.subdivision
      : 1;
    const validPattern =
      Array.isArray(saved.pattern) &&
      saved.pattern.length === beats * subdivision &&
      saved.pattern.some(Boolean) &&
      saved.pattern.every((step) => [0, 1, 2].includes(step));
    const pattern = validPattern ? saved.pattern : makePattern(beats, subdivision);
    if (!validPattern && saved.accent === false) pattern[0] = 1;

    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      bpm: clampBpm(saved.bpm),
      beats,
      subdivision,
      pattern,
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
        : DEFAULT_SETTINGS.volume,
      trainer: Boolean(saved.trainer),
      muted: Boolean(saved.muted),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
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

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [bpmDraft, setBpmDraft] = useState(String(settings.bpm));
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState("就绪");
  const [visual, setVisual] = useState({ beat: 0, sub: 0, pulse: 0, hit: false });
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [installed, setInstalled] = useState(
    () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true,
  );

  const settingsRef = useRef(settings);
  const playingRef = useRef(false);
  const startingRef = useRef(false);
  const stepRef = useRef(0);
  const barsRef = useRef(0);
  const minuteDeadlineRef = useRef(60);
  const tapsRef = useRef([]);
  const generationRef = useRef(0);
  const audioRef = useRef(null);
  const installDialogRef = useRef(null);

  const updateSettings = useCallback((patch) => {
    settingsRef.current = { ...settingsRef.current, ...patch };
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const setBpm = useCallback(
    (value) => updateSettings({ bpm: clampBpm(value) }),
    [updateSettings],
  );

  const disposeAudio = useCallback(() => {
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel(0);
    Tone.getDraw().cancel(0);
    audioRef.current?.loop.dispose();
    Object.values(audioRef.current?.instruments ?? {}).forEach((instrument) => instrument.dispose());
    audioRef.current?.output.dispose();
    audioRef.current = null;
  }, []);

  const stop = useCallback(
    (message = "已暂停") => {
      generationRef.current += 1;
      playingRef.current = false;
      setPlaying(false);
      setVisual({ beat: 0, sub: 0, pulse: 0, hit: false });
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
      await Tone.start();
      if (run !== generationRef.current) return;

      const transport = Tone.getTransport();
      if (settingsRef.current.trainer) {
        const bpm = settingsRef.current.startBpm;
        settingsRef.current = { ...settingsRef.current, bpm };
        setSettings((current) => ({ ...current, bpm }));
      }
      const output = new Tone.Gain(
        settingsRef.current.muted ? 0 : settingsRef.current.volume / 100,
      ).toDestination();
      const instruments = createInstruments(output);

      stepRef.current = 0;
      barsRef.current = 0;
      transport.position = 0;
      minuteDeadlineRef.current = 60;
      transport.bpm.value = settingsRef.current.bpm;

      const loop = new Tone.Loop((time) => {
        let current = settingsRef.current;
        const stepsPerBar = current.beats * current.subdivision;
        const stepIndex = stepRef.current % stepsPerBar;

        const nextMinuteDeadline =
          current.trainer && current.changeMode === "minute"
            ? advanceMinuteDeadline(
                transport.getSecondsAtTime(time),
                minuteDeadlineRef.current,
              )
            : null;
        const barsDue =
          current.changeMode === "bars" &&
          stepIndex === 0 &&
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

        const beat = Math.floor(stepIndex / current.subdivision);
        const sub = stepIndex % current.subdivision;
        const step = current.pattern[stepIndex] ?? 0;

        if (step > 0) {
          const note = SOUND_NOTES[current.sound];
          const frequency = step === 2 ? note.accent : sub === 0 ? note.main : note.sub;
          const velocity = step === 2 ? 1 : sub === 0 ? 0.74 : 0.4;
          instruments[current.sound].triggerAttackRelease(frequency, note.duration, time, velocity);
        }

        Tone.getDraw().schedule(() => {
          if (generationRef.current !== run || !playingRef.current) return;
          setVisual({ beat, sub, pulse: performance.now(), hit: step > 0 });
        }, time);

        stepRef.current = (stepIndex + 1) % stepsPerBar;
        if (stepRef.current === 0) barsRef.current += 1;
      }, Tone.Ticks(transport.PPQ / settingsRef.current.subdivision)).start(0);

      audioRef.current = { loop, instruments, output };
      playingRef.current = true;
      setPlaying(true);
      setStatus("运行中");
      transport.start("+0.05");
    } catch {
      stop("请再次点击");
    } finally {
      startingRef.current = false;
    }
  }, [disposeAudio, stop]);

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

    const transport = Tone.getTransport();
    transport.bpm.rampTo(settings.bpm, 0.04);
    audioRef.current?.output.gain.rampTo(
      settings.muted ? 0 : settings.volume / 100,
      0.03,
    );
  }, [settings]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.loop.interval = Tone.Ticks(
        Tone.getTransport().PPQ / settings.subdivision,
      );
    }
  }, [settings.subdivision]);

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
      if (
        document.visibilityState === "visible" &&
        playingRef.current &&
        Tone.getContext().state !== "running"
      ) {
        Tone.start()
          .then(() => setStatus("运行中"))
          .catch(() => setStatus("点击恢复"));
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

  const changeRhythm = (patch) => {
    const beats = patch.beats ?? settingsRef.current.beats;
    const subdivision = patch.subdivision ?? settingsRef.current.subdivision;
    updateSettings({ ...patch, pattern: makePattern(beats, subdivision) });
    stepRef.current = 0;
    barsRef.current = 0;
  };

  const cyclePatternStep = (index) => {
    const pattern = [...settings.pattern];
    pattern[index] = pattern[index] === 1 ? 2 : pattern[index] === 2 ? 0 : 1;
    if (!pattern.some(Boolean)) {
      setStatus("至少保留一格");
      return;
    }
    updateSettings({ pattern });
  };

  const changeTrainer = (patch) => {
    barsRef.current = 0;
    minuteDeadlineRef.current = Tone.getTransport().seconds + 60;
    updateSettings(patch);
  };

  const mainBeatColumns = settings.beats === 6 ? 3 : settings.beats;
  const patternColumns =
    settings.subdivision === 1 ? mainBeatColumns : settings.subdivision === 2 ? 2 : 1;
  const patternStepColumns =
    settings.subdivision === 8 ? 4 : settings.subdivision >= 5 ? 3 : settings.subdivision;

  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

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
                  {playing ? visual.beat + 1 : "—"} / {settings.beats}
                </span>
                {settings.trainer && (
                  <span className="trainer-target">→ {settings.targetBpm}</span>
                )}
              </div>
            </div>
          </div>

          <div className="beat-dots" aria-hidden="true">
            {Array.from({ length: settings.beats }, (_, index) => (
              <span
                key={index}
                className={[
                  settings.pattern[index * settings.subdivision] === 2 ? "is-accent" : "",
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

          <div className="setting-block">
            <div className="setting-label">
              <span>每小节</span>
            </div>
            <div className="segmented" aria-label="每小节拍数">
              {[2, 3, 4, 6].map((beats) => (
                <button
                  key={beats}
                  type="button"
                  className={settings.beats === beats ? "is-selected" : ""}
                  aria-pressed={settings.beats === beats}
                  onClick={() => changeRhythm({ beats })}
                >
                  {beats}
                </button>
              ))}
            </div>
          </div>

          <div className="setting-block">
            <div className="setting-label">
              <span>细分</span>
            </div>
            <div className="subdivision-grid" aria-label="拍内细分">
              {SUBDIVISIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={settings.subdivision === option.value ? "is-selected" : ""}
                  aria-pressed={settings.subdivision === option.value}
                  onClick={() => changeRhythm({ subdivision: option.value })}
                >
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="setting-block pattern-block">
            <div className="setting-label pattern-heading">
              <span>节奏型</span>
              <div className="pattern-actions">
                <button
                  type="button"
                  onClick={() => updateSettings({ pattern: makePattern(settings.beats, settings.subdivision) })}
                >
                  均匀
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateSettings({ pattern: makePattern(settings.beats, settings.subdivision, "main") })
                  }
                >
                  主拍
                </button>
              </div>
            </div>
            <div className="pattern-scroll">
              <div
                className="pattern-beats"
                style={{
                  "--beat-columns": patternColumns,
                }}
              >
                {Array.from({ length: settings.beats }, (_, beat) => (
                  <div
                    className="pattern-beat"
                    key={beat}
                    style={{
                      "--steps": settings.subdivision,
                      "--step-columns": patternStepColumns,
                    }}
                  >
                    <strong>{beat + 1}</strong>
                    <div className="pattern-steps">
                      {Array.from({ length: settings.subdivision }, (_, sub) => {
                        const index = beat * settings.subdivision + sub;
                        const step = settings.pattern[index] ?? 0;
                        const stateName = step === 2 ? "强音" : step === 1 ? "普通" : "静音";
                        return (
                          <button
                            key={sub}
                            type="button"
                            className={`pattern-step state-${step}`}
                            onClick={() => cyclePatternStep(index)}
                            aria-label={`第 ${beat + 1} 拍第 ${sub + 1} 格：${stateName}`}
                            title={`${stateName}，点击切换`}
                          >
                            <i aria-hidden="true" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="pattern-legend" aria-hidden="true">
              <span className="state-1"><i />普通</span>
              <span className="state-2"><i />强音</span>
              <span className="state-0"><i />静音</span>
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
