import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ClipboardPaste,
  Copy,
  Download,
  Hand,
  ListChecks,
  Mic,
  Minus,
  Pause,
  Play,
  Plus,
  Repeat2,
  Redo2,
  RotateCcw,
  Save,
  Share2,
  Square,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import * as Tone from "tone";
import {
  BEAT_UNITS,
  BPM_MAX,
  BPM_MIN,
  MAX_BEATS,
  MAX_SUBDIVISION,
  advanceMinuteDeadline,
  analyzeRhythmRecording,
  bpmFromTaps,
  clampBpm,
  compileRhythm,
  decodeRhythm,
  encodeRhythm,
  hasOffbeatSteps,
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
  removeBarSelection,
  rhythmEventIndexAtTime,
  rhythmDefaultName,
  soundForRhythmEvent,
  toggleBeatStep,
} from "./metronome.js";
import {
  FLAG_GLYPHS,
  NOTEHEAD_GLYPHS,
  REST_GLYPHS,
  TUPLET_THREE_PATH,
} from "./bravuraGlyphs.js";
import { clonePracticeRhythm, PRACTICE_PRESET_WEEKS } from "./practicePresets.js";

const RHYTHM_LIBRARY_KEY = "pulse-rhythm-library-v1";
const PRACTICE_HISTORY_KEY = "pulse-practice-history-v1";
const LEGACY_SETTINGS_KEY = "pulse-settings";
const SETTINGS_KEY = "pulse-advanced-settings-v1";
const APPEARANCE_KEY = "kessoku-beat-appearance-v1";
const TUTORIAL_PREFIX = "tutorial:";
const CHARACTER_THEMES = [
  { id: "hitori", label: "後藤ひとり", ready: true },
  { id: "nijika", label: "伊地知虹夏", ready: false },
  { id: "ryo", label: "山田リョウ", ready: false },
  { id: "kita", label: "喜多郁代", ready: false },
];
const VISUAL_STYLES = [
  { id: "poster", label: "ポスター" },
  { id: "notebook", label: "ノート" },
];
const PRACTICE_PRESETS = PRACTICE_PRESET_WEEKS.flatMap((week) =>
  week.exercises.flatMap((exercise) =>
    exercise.presets.map((preset) => ({ week, exercise, preset })),
  ),
);

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

const SETTINGS_SCHEMA_VERSION = 4;
const DEFAULT_SETTINGS = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  bpm: 96,
  beatUnit: 4,
  bars: null,
  loopBar: null,
  quickPatternId: null,
  sound: "click",
  beatTrack: true,
  rhythmTrack: true,
  trainer: false,
  startBpm: 96,
  targetBpm: 120,
  changeMode: "bars",
  changeEvery: 4,
  changeAmount: 10,
  gapClick: false,
  gapDifficulty: "medium",
  countIn: false,
  rhythmAnalysis: false,
  analysisLoop: false,
  distinguishOffbeats: true,
  volume: 100,
  muted: false,
};

function loadAppearance() {
  try {
    const saved = JSON.parse(localStorage.getItem(APPEARANCE_KEY));
    return {
      character: saved?.character === "hitori" ? saved.character : "hitori",
      style: VISUAL_STYLES.some(({ id }) => id === saved?.style) ? saved.style : "poster",
      locale: saved?.locale === "en" ? "en" : "zh",
    };
  } catch {
    return { character: "hitori", style: "poster", locale: "zh" };
  }
}

const STATUS_EN = {
  就绪: "Ready",
  已停止: "Stopped",
  "正在分析…": "Analyzing…",
  录音已取消: "Recording canceled",
  "保存的节奏已删除": "Saved rhythm deleted",
  "保存的节奏无效": "Saved rhythm is invalid",
  "切换节奏…": "Switching rhythm…",
  删除失败: "Delete failed",
  小节已排序: "Bars reordered",
  已保存到本机: "Saved on this device",
  已暂停: "Paused",
  已撤销: "Undone",
  已重做: "Redone",
  已更新选择: "Selection updated",
  已退出多选: "Multi-select closed",
  "开启声音…": "Starting audio…",
  当前浏览器不支持录音: "Recording is not supported",
  当前练习没有需要弹奏的节奏点: "This practice has no rhythm notes",
  "录音中 · 循环": "Recording · Looping",
  录音中: "Recording",
  录音已导出: "Recording exported",
  "最多保存 50 个节奏": "Up to 50 rhythms can be saved",
  本地保存失败: "Local save failed",
  点击恢复: "Tap to resume",
  点选要操作的小节: "Select bars to edit",
  "继续 Tap": "Keep tapping",
  继续播放原节奏: "Continuing the current rhythm",
  编码无效: "Invalid code",
  节奏已更新: "Rhythm updated",
  节奏已切换: "Rhythm switched",
  节奏已导入: "Rhythm imported",
  节奏编码已复制: "Rhythm code copied",
  "设置已更新 · 将从头开始": "Updated · restarting from the beginning",
  重新开始: "Restarting",
  准备录音: "Preparing to record",
  需要麦克风权限才能录音: "Microphone permission is required",
  无法开始录音: "Unable to start recording",
  请先完成录音: "Finish the recording first",
  请再次点击: "Tap again",
  请手动复制编码: "Copy the code manually",
  "请求麦克风权限…": "Requesting microphone access…",
  运行中: "Playing",
  "预备 1 小节": "Count-in · 1 bar",
  循环全部小节: "Looping all bars",
  循环所选段落: "Looping selection",
  循环所选小节: "Looping selected bar",
  循环当前小节: "Looping current bar",
  教材要求本练习不使用节拍器: "This exercise requires no metronome",
};

function localizeStatus(status, isEnglish) {
  if (!isEnglish) return status;
  if (STATUS_EN[status]) return STATUS_EN[status];

  let match = status.match(/^分析完成 · 稳定率 (\d+)%$/);
  if (match) return `Analysis complete · Stable rate ${match[1]}%`;

  match = status.match(/^分析失败：(.+)$/);
  if (match) return `Analysis failed: ${match[1]}`;

  match = status.match(/^(\d+) 个小节已删除$/);
  if (match) return `${match[1]} ${match[1] === "1" ? "bar" : "bars"} deleted`;

  match = status.match(/^已选择 (\d+) 个小节$/);
  if (match) return `${match[1]} ${match[1] === "1" ? "bar" : "bars"} selected`;

  match = status.match(/^(\d+) 个小节已复制，选择位置后粘贴$/);
  if (match) {
    return `${match[1]} ${match[1] === "1" ? "bar" : "bars"} copied · choose where to paste`;
  }

  match = status.match(/^(\d+) 个小节已粘贴$/);
  if (match) return `${match[1]} ${match[1] === "1" ? "bar" : "bars"} pasted`;

  match = status.match(/^已载入 (.+)$/);
  if (match) return `Loaded ${match[1]}`;

  match = status.match(/^MusicXML 无法导入：(.+)$/);
  if (match) {
    const reason = match[1] === "速度、拍号或细分超出高级节奏支持范围"
      ? "tempo, meter, or subdivision is outside the supported range"
      : match[1];
    return `MusicXML import failed: ${reason}`;
  }

  return status;
}

function freshSettings() {
  return { ...DEFAULT_SETTINGS, bars: [makeBar(4, 1)] };
}

function loadSettings(storageKey = LEGACY_SETTINGS_KEY, fallbackKey = null) {
  try {
    const saved = JSON.parse(
      localStorage.getItem(storageKey) ?? (fallbackKey ? localStorage.getItem(fallbackKey) : null),
    );
    const defaults = freshSettings();
    if (!saved) return defaults;

    const bars = normalizeBars(saved.bars);
    if (!bars) return defaults;
    const loopBar = normalizeLoopRange(saved.loopBar, bars.length);

    return {
      ...defaults,
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      bpm: clampBpm(saved.bpm ?? defaults.bpm),
      beatUnit: BEAT_UNITS.includes(saved.beatUnit) ? saved.beatUnit : defaults.beatUnit,
      bars,
      loopBar,
      quickPatternId: QUICK_PATTERNS.some(({ id }) => id === saved.quickPatternId)
        ? saved.quickPatternId
        : null,
      sound: SOUNDS.some(({ value }) => value === saved.sound) ? saved.sound : "click",
      beatTrack: saved.beatTrack !== false,
      rhythmTrack: saved.rhythmTrack !== false,
      startBpm: clampBpm(saved.startBpm ?? saved.bpm ?? 96),
      targetBpm: clampBpm(saved.targetBpm ?? 120),
      changeMode: saved.changeMode === "minute" ? "minute" : "bars",
      changeEvery: [1, 2, 4, 8, 16].includes(saved.changeEvery) ? saved.changeEvery : 4,
      changeAmount: [1, 2, 3, 5, 10].includes(saved.changeAmount)
        ? saved.changeAmount
        : defaults.changeAmount,
      volume:
        Number(saved.schemaVersion ?? 0) < SETTINGS_SCHEMA_VERSION &&
        Number(saved.volume) === 72
          ? defaults.volume
          : Number.isFinite(Number(saved.volume))
            ? Math.min(100, Math.max(0, Number(saved.volume)))
            : defaults.volume,
      trainer: Boolean(saved.trainer),
      gapClick: Boolean(saved.gapClick),
      countIn: Boolean(saved.countIn),
      rhythmAnalysis: Boolean(saved.rhythmAnalysis),
      analysisLoop: Boolean(saved.analysisLoop),
      distinguishOffbeats: saved.distinguishOffbeats !== false,
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

function practiceKey({ beatUnit, bars, loopBar }) {
  return JSON.stringify([beatUnit, bars, loopBar]);
}

function loadPracticeHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(PRACTICE_HISTORY_KEY));
    if (!Array.isArray(saved)) return [];
    return saved
      .filter(
        (item) =>
          typeof item?.key === "string" &&
          Number.isFinite(item?.at) &&
          Number.isFinite(item?.bpm) &&
          Number.isFinite(item?.stableRate) &&
          Number.isFinite(item?.meanAbsMs),
      )
      .slice(-200);
  } catch {
    return [];
  }
}

function TimingThumbnail({ analysis, isEnglish }) {
  return (
    <svg
      className="timing-thumbnail"
      viewBox="0 0 120 44"
      role="img"
      aria-label={isEnglish
        ? "Recording waveform and timing-deviation overview"
        : "录音波形和节奏偏差缩略图"}
      preserveAspectRatio="none"
    >
      <line className="waveform-axis" x1="0" y1="22" x2="120" y2="22" />
      {analysis.peaks.map((peak, index) => (
        <line
          className="waveform-peak"
          key={index}
          x1={index + 0.5}
          x2={index + 0.5}
          y1={22 - peak * 15}
          y2={22 + peak * 15}
        />
      ))}
      {analysis.markers.map((marker, index) => (
        <line
          className={`timing-marker is-${marker.kind}`}
          key={`${marker.kind}-${index}`}
          x1={marker.position * 120}
          x2={marker.position * 120}
          y1="3"
          y2="41"
        />
      ))}
    </svg>
  );
}

function TimingBreakdown({ analysis, isEnglish }) {
  const range = Math.max(100, analysis.toleranceMs * 3);
  return (
    <div className="bar-timing-panel">
      <div className="bar-timing-title">
        <strong>{isEnglish ? "Beat-by-beat reference" : "逐拍基准"}</strong>
        <span>{isEnglish ? "Early ← 0ms → Late" : "快 ← 0ms → 慢"}</span>
      </div>
      <div className="bar-timing-list">
        {analysis.timingBars.map((bar) => {
          const count = (kind) => bar.hits.filter((hit) => hit.kind === kind).length;
          return (
            <div className="bar-timing-group" key={bar.number}>
              <header>
                <strong>{isEnglish ? `Bar ${bar.number}` : `第 ${bar.number} 小节`}</strong>
                <span>
                  {isEnglish
                    ? `On time ${count("steady")} · Early ${count("early")} · Late ${count("late")} · Missed ${count("missed")}`
                    : `准 ${count("steady")} · 快 ${count("early")} · 慢 ${count("late")} · 漏 ${count("missed")}`}
                </span>
              </header>
              <div className="beat-timing-grid">
                {bar.hits.map((hit) => {
                  const label = isEnglish
                    ? hit.steps === 1
                      ? `Beat ${hit.beat}`
                      : `Beat ${hit.beat} · ${hit.step}/${hit.steps}`
                    : hit.steps === 1
                      ? `第 ${hit.beat} 拍`
                      : `${hit.beat} 拍 · ${hit.step}/${hit.steps}`;
                  const rounded = Math.round(hit.deviationMs ?? 0);
                  const result = hit.kind === "missed"
                    ? isEnglish ? "Missed" : "漏弹"
                    : hit.kind === "early"
                      ? `${isEnglish ? "Early" : "快"} ${Math.abs(rounded)}ms`
                      : hit.kind === "late"
                        ? `${isEnglish ? "Late" : "慢"} ${Math.abs(rounded)}ms`
                        : `${rounded > 0 ? "+" : ""}${rounded}ms`;
                  const position = hit.kind === "missed"
                    ? 50
                    : Math.min(94, Math.max(6, 50 + ((hit.deviationMs ?? 0) / range) * 44));
                  return (
                    <div
                      className={`beat-timing is-${hit.kind}`}
                      key={`${hit.beat}-${hit.step}`}
                      role="group"
                      aria-label={`${label}${isEnglish ? ", " : "，"}${result}`}
                    >
                      <div className="beat-timing-label">
                        <span>{label}</span>
                        <strong>{result}</strong>
                      </div>
                      <div className="beat-timing-track" aria-hidden="true">
                        <i style={{ "--timing-position": `${position}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProgressTrend({ history, isEnglish }) {
  if (history.length < 2) return null;
  const values = history.slice(-8);
  const points = values
    .map((item, index) => {
      const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100;
      const y = 28 - (item.stableRate / 100) * 24;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <div className="progress-trend">
      <span>
        {isEnglish ? `Stable rate · last ${values.length} sessions` : `最近 ${values.length} 次稳定率`}
      </span>
      <svg
        viewBox="0 0 100 32"
        role="img"
        aria-label={isEnglish ? "Historical stable-rate trend" : "历史稳定率趋势"}
      >
        <polyline points={points} />
        {values.map((item, index) => (
          <circle
            key={item.at}
            cx={values.length === 1 ? 50 : (index / (values.length - 1)) * 100}
            cy={28 - (item.stableRate / 100) * 24}
            r="2"
          />
        ))}
      </svg>
    </div>
  );
}

function HistoryComparison({ current, history, isEnglish }) {
  const currentIndex = current
    ? history.findIndex(({ at }) => at === current.at)
    : history.length - 1;
  const latest = currentIndex >= 0 ? history[currentIndex] : current ?? history.at(-1);
  const previous = currentIndex > 0
    ? history[currentIndex - 1]
    : currentIndex < 0
      ? history.at(-1)
      : null;
  const stableDelta = previous && latest
    ? Math.round(latest.stableRate - previous.stableRate)
    : null;
  const errorDelta = previous && latest
    ? Math.round(latest.meanAbsMs - previous.meanAbsMs)
    : null;

  return (
    <div className="history-comparison">
      <div className="history-comparison-title">
        <strong>{isEnglish ? "History comparison" : "历史对比"}</strong>
        <span>
          {isEnglish
            ? `Same rhythm · last ${history.length} sessions`
            : `同一节奏 · 最近 ${history.length} 次`}
        </span>
      </div>
      {previous && latest ? (
        <div className="history-deltas">
          <span>
            <small>{isEnglish ? "Stable rate" : "稳定率"}</small>
            <strong>{previous.stableRate}% → {latest.stableRate}%</strong>
            <em className={stableDelta >= 0 ? "is-better" : "is-worse"}>
              {stableDelta > 0 ? "+" : ""}{stableDelta}%
            </em>
          </span>
          <span>
            <small>{isEnglish ? "Mean error" : "平均误差"}</small>
            <strong>{Math.round(previous.meanAbsMs)}ms → {Math.round(latest.meanAbsMs)}ms</strong>
            <em className={errorDelta <= 0 ? "is-better" : "is-worse"}>
              {errorDelta > 0 ? "+" : ""}{errorDelta}ms
            </em>
          </span>
        </div>
      ) : (
        <p>
          {isEnglish
            ? history.length
              ? "This result is saved. Practice the same rhythm once more to see the change."
              : "Results are saved after your first practice; changes appear from the second session."
            : history.length
              ? "已记录本次成绩；再练一次相同节奏即可看到变化。"
              : "完成一次练习后开始记录，同一节奏第二次起显示变化。"}
        </p>
      )}
      <ProgressTrend history={history} isEnglish={isEnglish} />
      {history.length > 0 && (
        <ol
          className="practice-history"
          aria-label={isEnglish ? "Recent sessions for the same rhythm" : "同一节奏最近练习记录"}
        >
          {history.slice(-4).reverse().map((item) => (
            <li key={item.at}>
              <time dateTime={new Date(item.at).toISOString()}>
                {new Date(item.at).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}
              </time>
              <span>{item.bpm} BPM</span>
              <strong>{item.stableRate}%</strong>
              <span>{Math.round(item.meanAbsMs)}ms</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function cloneBeat(beat) {
  return { ...beat, steps: [...beat.steps] };
}

function cloneBar(bar) {
  return { beats: bar.beats.map(cloneBeat) };
}

function loopStart(range) {
  return range?.[0] ?? 0;
}

function barIndexesInRange(range) {
  return range
    ? Array.from({ length: range[1] - range[0] + 1 }, (_, index) => range[0] + index)
    : [];
}

function insertLoopRange(range, index, count) {
  if (!range) return null;
  const [start, end] = range;
  if (index <= start) return [start + count, end + count];
  if (index <= end + 1) return [start, end + count];
  return range;
}

function remapLoopRange(range, order) {
  if (!range) return null;
  const indexes = Array.from(
    { length: range[1] - range[0] + 1 },
    (_, offset) => order.indexOf(range[0] + offset),
  ).sort((left, right) => left - right);
  const stillContiguous = indexes.every(
    (index, position) => position === 0 || index === indexes[position - 1] + 1,
  );
  return stillContiguous ? [indexes[0], indexes.at(-1)] : range;
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
  if (!settings.gapClick) return [];
  const range = normalizeLoopRange(settings.loopBar, settings.bars.length);
  const barCount = range ? range[1] - range[0] + 1 : settings.bars.length;
  return makeGapPattern(settings.gapDifficulty, barCount);
}

function mediaTrackKey(settings, gapPattern) {
  return JSON.stringify([
    settings.bpm,
    settings.sound,
    settings.beatTrack,
    settings.rhythmTrack,
    settings.distinguishOffbeats,
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
  audio.media.volume = audio.countingIn ? 0 : audio.targetVolume;
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
    const cycles = Math.max(
      1,
      Math.ceil((120 * settings.bpm) / (60 * plan.totalTicks)),
    );
    const url = URL.createObjectURL(
      new Blob([makeClickTrackWav(settings, 12000, cycles, audio.gapPattern)], {
        type: "audio/wav",
      }),
    );
    const candidate = new Audio();
    candidate.loop = true;
    candidate.preload = "auto";
    candidate.setAttribute("playsinline", "");
    candidate.volume = audio.countingIn || audio.paused ? 0 : audio.targetVolume;
    candidate.src = url;
    audio.pendingCandidate = candidate;
    audio.pendingUrl = url;

    try {
      await candidate.play();
      if (audio.paused) candidate.pause();
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
  const [settings, setSettings] = useState(() => loadSettings(SETTINGS_KEY, LEGACY_SETTINGS_KEY));
  const [bpmDraft, setBpmDraft] = useState(String(settings.bpm));
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [status, setStatusValue] = useState("就绪");
  const [visual, setVisual] = useState({
    bar: 0,
    beat: 0,
    sub: 0,
    pulse: 0,
    hit: false,
    gap: false,
  });
  const [editorBarIndex, setEditorBarIndex] = useState(() => loopStart(settings.loopBar));
  const [selectingBars, setSelectingBars] = useState(false);
  const [selectedBarIndexes, setSelectedBarIndexes] = useState([]);
  const [barClipboard, setBarClipboard] = useState([]);
  const [toast, setToast] = useState(null);
  const setStatus = useCallback((message) => {
    setStatusValue(message);
    setToast({ id: Date.now(), message });
  }, []);
  const [historyDepth, setHistoryDepth] = useState({ undo: 0, redo: 0 });
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [showRhythmCode, setShowRhythmCode] = useState(false);
  const [rhythmCode, setRhythmCode] = useState("");
  const [savedRhythms, setSavedRhythms] = useState(loadRhythmLibrary);
  const [practiceHistory, setPracticeHistory] = useState(loadPracticeHistory);
  const [analysis, setAnalysis] = useState(null);
  const [recordingAudio, setRecordingAudio] = useState(null);
  const [recording, setRecording] = useState(false);
  const [selectedRhythmId, setSelectedRhythmId] = useState("");
  const [rhythmName, setRhythmName] = useState("");
  const [installed, setInstalled] = useState(
    () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true,
  );
  const [appearance, setAppearance] = useState(loadAppearance);
  const isEnglish = appearance.locale === "en";
  const ui = useCallback(
    (chinese, english) => (isEnglish ? english : chinese),
    [isEnglish],
  );
  const selectedTheme =
    CHARACTER_THEMES.find(({ id }) => id === appearance.character) ?? CHARACTER_THEMES[0];
  const updateAppearance = useCallback((patch) => {
    setAppearance((current) => ({ ...current, ...patch }));
  }, []);

  const settingsRef = useRef(settings);
  const playingRef = useRef(false);
  const pausedRef = useRef(false);
  const playbackIntentRef = useRef(false);
  const startingRef = useRef(false);
  const refreshingRef = useRef(false);
  const rhythmRevisionRef = useRef(0);
  const historyRef = useRef({ undo: [], redo: [] });
  const barsRef = useRef(0);
  const minuteDeadlineRef = useRef(60);
  const tapsRef = useRef([]);
  const generationRef = useRef(0);
  const audioRef = useRef(null);
  const recordingRef = useRef(null);
  const installDialogRef = useRef(null);
  const rhythmDialogRef = useRef(null);
  const isIOS = isIOSDevice();

  const replaceSettings = useCallback((next) => {
    settingsRef.current = next;
    setSettings(next);
  }, []);

  const disposeAudio = useCallback(() => {
    if (!audioRef.current) return;
    if (audioRef.current?.media) {
      audioRef.current.syncRevision = (audioRef.current.syncRevision ?? 0) + 1;
      cancelAnimationFrame(audioRef.current.raf);
      audioRef.current.countInResolve?.();
      releaseMedia(audioRef.current.countInMedia, audioRef.current.countInUrl);
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
    audioRef.current?.countInPart?.dispose();
    Object.values(audioRef.current?.instruments ?? {}).forEach((instrument) => instrument.dispose());
    audioRef.current?.output.dispose();
    audioRef.current = null;
  }, []);

  const updateSettings = useCallback((patch, recordHistory = true) => {
    if (recordingRef.current) {
      setStatus("请先完成录音");
      return;
    }
    const current = settingsRef.current;
    const quickPatternId = nextQuickPatternId(current.quickPatternId, patch);
    const rhythmChanged =
      ("bars" in patch && patch.bars !== current.bars) ||
      ("loopBar" in patch && patch.loopBar !== current.loopBar) ||
      ("beatUnit" in patch && patch.beatUnit !== current.beatUnit) ||
      quickPatternId !== current.quickPatternId;
    if (recordHistory && rhythmChanged) {
      const history = historyRef.current;
      history.undo.push({
        bars: current.bars,
        loopBar: current.loopBar,
        beatUnit: current.beatUnit,
        quickPatternId: current.quickPatternId,
      });
      if (history.undo.length > 50) history.undo.shift();
      history.redo = [];
      setHistoryDepth({ undo: history.undo.length, redo: 0 });
    }

    const next = { ...current, ...patch, quickPatternId };
    const keepsPausedPosition = Object.keys(patch).every(
      (key) => key === "volume" || key === "muted",
    );
    if (pausedRef.current && !keepsPausedPosition) {
      generationRef.current += 1;
      pausedRef.current = false;
      playbackIntentRef.current = false;
      startingRef.current = false;
      setPlaying(false);
      setPaused(false);
      setVisual({ bar: 0, beat: 0, sub: 0, pulse: 0, hit: false, gap: false });
      disposeAudio();
      setAudioSession("auto");
      setStatus("设置已更新 · 将从头开始");
    }
    if (rhythmChanged || "bpm" in patch) {
      setAnalysis(null);
    }
    settingsRef.current = next;
    setSettings(next);
    if (audioRef.current?.media && pausedRef.current) {
      const volume = next.muted ? 0 : next.volume / 100;
      audioRef.current.targetVolume = volume;
      audioRef.current.media.volume = audioRef.current.countingIn ? 0 : volume;
      if (audioRef.current.countInMedia) audioRef.current.countInMedia.volume = volume;
    }
    if (audioRef.current?.media && playingRef.current) {
      syncMediaLoop(audioRef.current, next).catch(() => {
        if (playbackIntentRef.current) setStatus("继续播放原节奏");
      });
    }
  }, [disposeAudio, setStatus]);

  const setBpm = useCallback(
    (value) => updateSettings({ bpm: clampBpm(value) }),
    [updateSettings],
  );

  const stop = useCallback(
    (message = "已停止") => {
      const recordingSession = recordingRef.current;
      if (recordingSession && !recordingSession.stopping) {
        if (recordingSession.loop && recordingSession.rhythmStartedAt) {
          recordingSession.duration = Math.max(
            0.1,
            performance.now() / 1000 - recordingSession.rhythmStartedAt,
          );
        }
        recordingSession.stopping = true;
        clearTimeout(recordingSession.timer);
        recordingRef.current = null;
        setRecording(false);
        if (recordingSession.recorder.state !== "inactive") recordingSession.recorder.stop();
        recordingSession.stream.getTracks().forEach((track) => track.stop());
        message = recordingSession.rhythmStartedAt ? "正在分析…" : "录音已取消";
      }
      generationRef.current += 1;
      playbackIntentRef.current = false;
      playingRef.current = false;
      pausedRef.current = false;
      startingRef.current = false;
      setPlaying(false);
      setPaused(false);
      setVisual({ bar: 0, beat: 0, sub: 0, pulse: 0, hit: false, gap: false });
      setStatus(message);
      disposeAudio();
      setAudioSession("auto");
    },
    [disposeAudio],
  );

  const pausePlayback = useCallback(() => {
    if (!playingRef.current || recordingRef.current || !audioRef.current) return;
    const audio = audioRef.current;
    playingRef.current = false;
    pausedRef.current = true;
    setPlaying(false);
    setPaused(true);
    if (audio.media) {
      cancelAnimationFrame(audio.raf);
      audio.paused = true;
      audio.pausedAt = performance.now() / 1000;
      audio.countInMedia?.pause();
      audio.pendingCandidate?.pause();
      audio.media.pause();
    } else {
      audio.output.gain.rampTo(0, 0.01);
      const transport = Tone.getTransport();
      if (transport.state === "started") transport.pause();
      else transport.stop();
    }
    setStatus("已暂停");
    setAudioSession("auto");
  }, [setStatus]);

  const resumePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!pausedRef.current || playingRef.current || !audio) return;
    playingRef.current = true;
    pausedRef.current = false;
    setPlaying(true);
    setPaused(false);
    setAudioSession("playback");
    try {
      if (audio.media) {
        audio.paused = false;
        const now = performance.now() / 1000;
        if (audio.pausedAt) audio.startedAt += now - audio.pausedAt;
        audio.pausedAt = null;
        if (audio.countingIn && audio.countInMedia) {
          const plays = [audio.countInMedia.play()];
          if (audio.activeRhythm && audio.media.paused) plays.push(audio.media.play());
          await Promise.all(plays);
        } else {
          await syncMediaLoop(audio, settingsRef.current);
          audio.media.volume = audio.targetVolume;
          if (audio.media.paused) await audio.media.play();
          if (audio.draw) audio.raf = requestAnimationFrame(audio.draw);
        }
      } else {
        await Tone.start();
        audio.output.gain.rampTo(
          settingsRef.current.muted ? 0 : settingsRef.current.volume / 100,
          0.03,
        );
        Tone.getTransport().start("+0.05");
      }
      setStatus(audio.countingIn ? "预备 1 小节" : "运行中");
    } catch {
      if (audio.media) {
        audio.paused = true;
        audio.pausedAt = performance.now() / 1000;
        audio.countInMedia?.pause();
        audio.pendingCandidate?.pause();
        audio.media.pause();
      } else {
        audio.output.gain.rampTo(0, 0.01);
        const transport = Tone.getTransport();
        if (transport.state === "started") transport.pause();
        else transport.stop();
      }
      playingRef.current = false;
      pausedRef.current = true;
      setPlaying(false);
      setPaused(true);
      setStatus("请再次点击");
      setAudioSession("auto");
    }
  }, [setStatus]);

  const travelHistory = (direction) => {
    const history = historyRef.current;
    const source = direction === "undo" ? history.undo : history.redo;
    const target = direction === "undo" ? history.redo : history.undo;
    const snapshot = source.pop();
    if (!snapshot) return;
    const current = settingsRef.current;
    target.push({
      bars: current.bars,
      loopBar: current.loopBar,
      beatUnit: current.beatUnit,
      quickPatternId: current.quickPatternId,
    });
    if (playbackIntentRef.current) stop(direction === "undo" ? "已撤销" : "已重做");
    updateSettings(snapshot, false);
    setEditorBarIndex((index) => Math.min(index, snapshot.bars.length - 1));
    setSelectedBarIndexes([]);
    setSelectingBars(false);
    setHistoryDepth({ undo: history.undo.length, redo: history.redo.length });
    setStatus(direction === "undo" ? "已撤销" : "已重做");
  };

  const start = useCallback(async (preserveTempo = false, practice = null) => {
    if (startingRef.current || playingRef.current) return;
    startingRef.current = true;
    pausedRef.current = false;
    setPaused(false);
    setStatus("开启声音…");
    disposeAudio();
    const run = ++generationRef.current;

    try {
      setAudioSession("playback");
      if (settingsRef.current.trainer && !preserveTempo) {
        const bpm = settingsRef.current.startBpm;
        replaceSettings({ ...settingsRef.current, bpm });
      }

      const gapPattern = practice ? [] : makeActiveGapPattern(settingsRef.current);

      let mediaAudio = null;
      if (isIOS) {
        const countingIn = Boolean(practice) || (settingsRef.current.countIn && !preserveTempo);
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
          countingIn,
          countInMedia: null,
          countInUrl: null,
          countInResolve: null,
          targetVolume: settingsRef.current.muted ? 0 : settingsRef.current.volume / 100,
          gapPattern,
          pausedAt: null,
          paused: false,
          startedAt: performance.now() / 1000,
        };
        audioRef.current = mediaAudio;
        let countInDone = null;
        let countInStarted = null;
        if (countingIn) {
          const range = normalizeLoopRange(
            settingsRef.current.loopBar,
            settingsRef.current.bars.length,
          );
          const bar = settingsRef.current.bars[range?.[0] ?? 0];
          const countInUrl = URL.createObjectURL(
            new Blob([
              makeClickTrackWav({
                ...settingsRef.current,
                bars: [makeBar(bar.beats.length, 1)],
                loopBar: null,
                beatTrack: true,
                rhythmTrack: false,
              }),
            ], { type: "audio/wav" }),
          );
          const countInMedia = new Audio(countInUrl);
          countInMedia.preload = "auto";
          countInMedia.setAttribute("playsinline", "");
          countInMedia.volume = mediaAudio.targetVolume;
          mediaAudio.countInMedia = countInMedia;
          mediaAudio.countInUrl = countInUrl;
          countInDone = new Promise((resolve, reject) => {
            mediaAudio.countInResolve = resolve;
            countInMedia.addEventListener("ended", resolve, { once: true });
            countInMedia.addEventListener("error", reject, { once: true });
          });
          countInStarted = countInMedia.play();
          playingRef.current = true;
          setPlaying(true);
          setStatus("预备 1 小节");
        }
        await syncMediaLoop(mediaAudio, settingsRef.current);
        if (run !== generationRef.current) return;
        if (!mediaAudio.activeRhythm) {
          await syncMediaLoop(mediaAudio, settingsRef.current);
          if (run !== generationRef.current || !mediaAudio.activeRhythm) return;
        }
        if (countingIn) {
          await countInStarted;
          await countInDone;
          if (run !== generationRef.current) return;
          releaseMedia(mediaAudio.countInMedia, mediaAudio.countInUrl);
          mediaAudio.countInMedia = null;
          mediaAudio.countInUrl = null;
          mediaAudio.countInResolve = null;
          mediaAudio.countingIn = false;
          mediaAudio.media.currentTime = 0;
          mediaAudio.media.loop = practice?.loop !== false;
          mediaAudio.media.volume = mediaAudio.targetVolume;
          if (!pausedRef.current && mediaAudio.media.paused) await mediaAudio.media.play();
        }
        mediaAudio.startedAt = performance.now() / 1000;
        if (!pausedRef.current) practice?.onStart?.();

        barsRef.current = 0;
        minuteDeadlineRef.current = 60;
        playingRef.current = !pausedRef.current;
        setPlaying(!pausedRef.current);
        setStatus(
          pausedRef.current
            ? "已暂停"
            : practice?.loop
              ? "录音中 · 循环"
              : practice
                ? "录音中"
                : "运行中",
        );

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
              !practice && current.trainer && current.changeMode === "minute"
                ? advanceMinuteDeadline(elapsed, minuteDeadlineRef.current)
                : null;
            const barsDue =
              !practice &&
              current.trainer &&
              current.changeMode === "bars" &&
              enteredBar &&
              barsRef.current % current.changeEvery === 0;

            if (barsDue || nextMinuteDeadline !== null) {
              if (nextMinuteDeadline !== null) minuteDeadlineRef.current = nextMinuteDeadline;
              const bpm = nextTrainingBpm(current.bpm, current.targetBpm, current.changeAmount);
              if (bpm !== current.bpm) {
                replaceSettings({ ...current, bpm });
              }
            }

            setVisual({
              bar: event.bar,
              beat: event.beat,
              sub: event.sub,
              pulse: performance.now(),
              hit: Boolean(
                !gapMuted &&
                ((current.beatTrack && event.sub === 0) || (current.rhythmTrack && step > 0)),
              ),
              gap: gapMuted,
            });
            mediaAudio.lastEvent = eventIndex;
          }
          mediaAudio.lastTime = activeMedia.currentTime;
          mediaAudio.raf = requestAnimationFrame(draw);
        };
        mediaAudio.draw = draw;
        if (!pausedRef.current) mediaAudio.raf = requestAnimationFrame(draw);
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
      const loopRange = normalizeLoopRange(
        settingsRef.current.loopBar,
        settingsRef.current.bars.length,
      );
      const countInBarIndex = loopRange?.[0] ?? 0;
      const countInBeats = practice || (settingsRef.current.countIn && !preserveTempo)
        ? settingsRef.current.bars[countInBarIndex].beats.length
        : 0;
      const countInTicks = countInBeats * transport.PPQ;
      const countInPart = countInBeats
        ? new Tone.Part(
            (time, { beat }) => {
              const current = settingsRef.current;
              const note = SOUND_NOTES[current.sound];
              instruments[current.sound].triggerAttackRelease(
                beat === 0 ? note.accent : note.normal,
                note.duration,
                time,
                beat === 0 ? 1 : 0.74,
              );
              Tone.getDraw().schedule(() => {
                if (generationRef.current !== run || !playingRef.current) return;
                setVisual({
                  bar: countInBarIndex,
                  beat,
                  sub: 0,
                  pulse: performance.now(),
                  hit: true,
                  gap: false,
                });
              }, time);
            },
            Array.from({ length: countInBeats }, (_, beat) => [
              Tone.Ticks(beat * transport.PPQ),
              { beat },
            ]),
          ).start(0)
        : null;
      const part = new Tone.Part((time, event) => {
        let current = settingsRef.current;
        const beatData = current.bars[event.bar]?.beats[event.beat];
        const step = beatData?.steps[event.sub] ?? 0;
        const enteredBar = event.beat === 0 && event.sub === 0;
        const eventGapMuted = Boolean(current.gapClick && event.gap);

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

        if (!practice && current.trainer && (barsDue || nextMinuteDeadline !== null)) {
          if (nextMinuteDeadline !== null) minuteDeadlineRef.current = nextMinuteDeadline;
          const nextBpm = nextTrainingBpm(current.bpm, current.targetBpm, current.changeAmount);
          if (nextBpm !== current.bpm) {
            current = { ...current, bpm: nextBpm };
            settingsRef.current = current;
            setBpmDraft(String(nextBpm));
            transport.bpm.setValueAtTime(nextBpm, time);
            Tone.getDraw().schedule(() => {
              if (generationRef.current === run && playingRef.current) {
                updateSettings({ bpm: nextBpm }, false);
              }
            }, time);
          }
        }

        if (!eventGapMuted && current.beatTrack && event.sub === 0) {
          const note = SOUND_NOTES[current.sound];
          instruments[current.sound].triggerAttackRelease(
            event.beat === 0 ? note.accent : note.normal,
            note.duration,
            time,
            event.beat === 0 ? 0.62 : 0.34,
          );
        }
        if (!eventGapMuted && current.rhythmTrack && step > 0) {
          const rhythmSound = soundForRhythmEvent(
            current.sound,
            current.beatTrack,
            event.sub,
            current.distinguishOffbeats,
          );
          const note = SOUND_NOTES[rhythmSound];
          instruments[rhythmSound].triggerAttackRelease(
            step === 2 ? note.accent : note.normal,
            note.duration,
            time,
            step === 2 ? 1 : 0.82,
          );
        }

        Tone.getDraw().schedule(() => {
          if (generationRef.current !== run || !playingRef.current) return;
          setVisual({
            bar: event.bar,
            beat: event.beat,
            sub: event.sub,
            pulse: performance.now(),
            hit: Boolean(
              !eventGapMuted &&
              ((current.beatTrack && event.sub === 0) || (current.rhythmTrack && step > 0)),
            ),
            gap: eventGapMuted,
          });
        }, time);

        if (enteredBar) barsRef.current += 1;
      }, plan.events.map((event) => [Tone.Ticks(event.ticks), event]));
      part.loopEnd = Tone.Ticks(plan.totalTicks);
      part.loop = practice?.loop !== false;
      part.start(Tone.Ticks(countInTicks));

      const toneAudio = {
        part,
        countInPart,
        instruments,
        output,
        countingIn: Boolean(countInTicks),
      };
      if (countInTicks || practice) {
        transport.scheduleOnce((time) => {
          toneAudio.countingIn = false;
          Tone.getDraw().schedule(() => {
            if (generationRef.current !== run || !playingRef.current) return;
            setStatus(practice?.loop ? "录音中 · 循环" : practice ? "录音中" : "运行中");
            practice?.onStart?.();
          }, time);
        }, Tone.Ticks(countInTicks));
      }

      audioRef.current = toneAudio;
      playingRef.current = true;
      setPlaying(true);
      setStatus(countInTicks ? "预备 1 小节" : "运行中");
      transport.start(countInTicks ? "+0.2" : preserveTempo ? "+0.025" : "+0.05");
    } catch {
      if (run === generationRef.current) stop("请再次点击");
    } finally {
      if (run === generationRef.current) startingRef.current = false;
    }
  }, [disposeAudio, isIOS, replaceSettings, stop, updateSettings]);

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
    if (recordingRef.current) {
      stop();
      return;
    }
    if (playingRef.current) {
      pausePlayback();
      return;
    }
    if (pausedRef.current) {
      await resumePlayback();
      return;
    }
    playbackIntentRef.current = true;
    const revision = rhythmRevisionRef.current;
    await start();
    if (playbackIntentRef.current && revision !== rhythmRevisionRef.current) {
      await refreshPlayback();
    }
  }, [pausePlayback, refreshPlayback, resumePlayback, start, stop]);

  const restartPlayback = useCallback(async () => {
    if (recordingRef.current) return;
    stop("重新开始");
    playbackIntentRef.current = true;
    await start();
  }, [start, stop]);

  const finishPracticeRecording = useCallback(() => {
    if (recordingRef.current) stop();
  }, [stop]);

  const beginPracticeRecording = useCallback(async () => {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof window.MediaRecorder !== "function"
    ) {
      setStatus("当前浏览器不支持录音");
      return;
    }

    if (playbackIntentRef.current) stop("准备录音");
    const request = ++generationRef.current;
    setAnalysis(null);
    setRecordingAudio(null);
    const snapshot = {
      bpm: settingsRef.current.bpm,
      beatUnit: settingsRef.current.beatUnit,
      bars: settingsRef.current.bars,
      loopBar: settingsRef.current.loopBar,
    };
    const plan = compileRhythm(snapshot.bars, snapshot.loopBar, 1);
    if (
      !plan.events.some(
        ({ bar, beat, sub }) => snapshot.bars[bar].beats[beat].steps[sub] > 0,
      )
    ) {
      setStatus("当前练习没有需要弹奏的节奏点");
      return;
    }
    const cycleDuration = (plan.totalTicks * 60) / snapshot.bpm;
    const loop = settingsRef.current.analysisLoop;
    const duration = loop ? 120 : Math.min(120, cycleDuration);
    setStatus("请求麦克风权限…");
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (request !== generationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const [audioTrack] = stream.getAudioTracks();
      if (audioTrack && "contentHint" in audioTrack) audioTrack.contentHint = "music";
      const recorder = new window.MediaRecorder(stream);
      const session = {
        cancelled: false,
        chunks: [],
        duration,
        key: practiceKey(snapshot),
        loop,
        recorder,
        recorderStartedAt: performance.now() / 1000,
        rhythmStartedAt: null,
        settings: snapshot,
        stopping: false,
        stream,
        timer: null,
      };

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) session.chunks.push(event.data);
      });
      recorder.addEventListener("stop", async () => {
        if (
          session.cancelled ||
          !session.rhythmStartedAt ||
          !session.chunks.length
        ) return;
        let context;
        try {
          const audioBlob = new Blob(session.chunks, {
            type: recorder.mimeType || session.chunks[0]?.type,
          });
          const recordedAt = Date.now();
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          context = new AudioContextClass();
          const buffer = await context.decodeAudioData(
            await audioBlob.arrayBuffer(),
          );
          const samples = new Float32Array(buffer.length);
          for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
            const data = buffer.getChannelData(channel);
            for (let index = 0; index < data.length; index += 1) {
              samples[index] += data[index] / buffer.numberOfChannels;
            }
          }
          const result = analyzeRhythmRecording(samples, buffer.sampleRate, {
            ...session.settings,
            rhythmStart: session.rhythmStartedAt - session.recorderStartedAt,
            duration: session.duration,
          });
          if (session.cancelled) return;
          const record = {
            actualBpm: result.actualBpm,
            at: recordedAt,
            bpm: session.settings.bpm,
            key: session.key,
            meanAbsMs: result.meanAbsMs,
            stableRate: result.stableRate,
          };
          setRecordingAudio({ at: recordedAt, blob: audioBlob });
          setAnalysis({ ...result, key: session.key, record });
          setPracticeHistory((current) => [...current, record].slice(-200));
          setStatus(`分析完成 · 稳定率 ${result.stableRate}%`);
        } catch (error) {
          if (session.cancelled) return;
          setStatus(`分析失败：${error.message}`);
        } finally {
          await context?.close();
        }
      });

      recorder.start();
      recordingRef.current = session;
      setRecording(true);
      setStatus("预备 1 小节");
      playbackIntentRef.current = true;
      await start(true, {
        loop,
        onStart: () => {
          if (session.stopping) return;
          session.rhythmStartedAt = performance.now() / 1000;
          session.timer = setTimeout(
            finishPracticeRecording,
            (loop ? 120 : duration) * 1000 + (loop ? 0 : 120),
          );
        },
      });
      if (!playingRef.current && !session.stopping) finishPracticeRecording();
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (request !== generationRef.current) return;
      recordingRef.current = null;
      setRecording(false);
      setStatus(error.name === "NotAllowedError" ? "需要麦克风权限才能录音" : "无法开始录音");
    }
  }, [finishPracticeRecording, start, stop]);

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
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Private browsing can deny storage; playback should still work.
    }

    if (audioRef.current?.media && playingRef.current) {
      syncMediaLoop(audioRef.current, settings).catch(() => {
        if (playbackIntentRef.current) setStatus("继续播放原节奏");
      });
    } else if (!audioRef.current?.media) {
      const bpm = Tone.getTransport().bpm;
      if (Math.round(bpm.value) !== settings.bpm) bpm.value = settings.bpm;
    }
  }, [settings]);

  useEffect(() => {
    document.documentElement.lang = isEnglish ? "en" : "zh-CN";
    try {
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
    } catch {
      // Appearance controls still work when private browsing denies storage.
    }
  }, [appearance, isEnglish]);

  useEffect(() => {
    try {
      localStorage.setItem(PRACTICE_HISTORY_KEY, JSON.stringify(practiceHistory));
    } catch {
      // Practice analysis still works when private browsing denies storage.
    }
  }, [practiceHistory]);

  useEffect(() => {
    if (playing) setEditorBarIndex(visual.bar);
  }, [playing, visual.bar]);

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
      const recordingSession = recordingRef.current;
      if (recordingSession) {
        recordingSession.cancelled = true;
        clearTimeout(recordingSession.timer);
        if (recordingSession.recorder.state !== "inactive") recordingSession.recorder.stop();
        recordingSession.stream.getTracks().forEach((track) => track.stop());
        recordingRef.current = null;
      }
      generationRef.current += 1;
      playbackIntentRef.current = false;
      playingRef.current = false;
      pausedRef.current = false;
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

  useEffect(() => {
    const dialog = rhythmDialogRef.current;
    if (!dialog) return;
    if (showRhythmCode && !dialog.open) dialog.showModal();
    else if (!showRhythmCode && dialog.open) dialog.close();
  }, [showRhythmCode]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const applyQuickRhythm = (patch) => {
    const resume = playingRef.current;
    if (playbackIntentRef.current && !resume) stop("节奏已更新");
    rhythmRevisionRef.current += 1;
    updateSettings(patch);
    if (!resume) return;
    setStatus("切换节奏…");
    void refreshPlayback();
  };

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

  const toggleStep = (beatIndex, sub, accent = false) => {
    updateBeat(editorBarIndex, beatIndex, (beat) => toggleBeatStep(beat, sub, accent));
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
    if (playbackIntentRef.current) stop("节奏已更新");
    const bars = [...current.bars];
    const nextIndex = editorBarIndex + 1;
    bars.splice(nextIndex, 0, cloneBar(bars[editorBarIndex]));
    setSelectingBars(false);
    setEditorBarIndex(nextIndex);
    updateSettings({ bars, loopBar: insertLoopRange(current.loopBar, nextIndex, 1) });
  };

  const deleteBars = (indexes) => {
    const current = settingsRef.current;
    const result = removeBarSelection(current.bars, indexes, current.loopBar);
    if (!result) return;
    if (
      indexes.length > 1 &&
      !window.confirm(
        ui(
          `删除选中的 ${indexes.length} 个小节？`,
          `Delete ${indexes.length} selected bars?`,
        ),
      )
    ) {
      return;
    }
    if (playbackIntentRef.current) stop("节奏已更新");
    setSelectingBars(false);
    setSelectedBarIndexes([]);
    setEditorBarIndex(result.index);
    updateSettings({ bars: result.bars, loopBar: result.loopBar });
    setStatus(`${indexes.length} 个小节已删除`);
  };

  const applyBarSelection = (indexes) => {
    const current = normalizeLoopRange(
      settingsRef.current.loopBar,
      settingsRef.current.bars.length,
    );
    if (!current) {
      setSelectedBarIndexes(indexes);
      return;
    }

    const range = loopRangeFromSelection(indexes, settingsRef.current.bars.length);
    setSelectedBarIndexes(barIndexesInRange(range));
    if (range?.[0] !== current[0] || range?.[1] !== current[1]) {
      applyQuickRhythm({ loopBar: range });
    }
  };

  const selectBar = (index, event) => {
    if (event?.shiftKey) {
      const anchor = selectingBars ? selectedBarIndexes.at(0) ?? editorBarIndex : editorBarIndex;
      const start = Math.min(anchor, index);
      const end = Math.max(anchor, index);
      const selected = Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
      setSelectingBars(true);
      applyBarSelection(selected);
      setEditorBarIndex(index);
      setStatus(`已选择 ${selected.length} 个小节`);
      return;
    }
    if (selectingBars || event?.ctrlKey || event?.metaKey) {
      setSelectingBars(true);
      const loop = normalizeLoopRange(
        settingsRef.current.loopBar,
        settingsRef.current.bars.length,
      );
      let current = selectingBars ? selectedBarIndexes : barIndexesInRange(loop);
      if (!current.length) current = [editorBarIndex];
      applyBarSelection(
        current.includes(index)
          ? current.filter((selectedIndex) => selectedIndex !== index)
          : [...current, index].sort((left, right) => left - right),
      );
      setEditorBarIndex(index);
      setStatus("已更新选择");
      return;
    }
    setEditorBarIndex(index);
  };

  const toggleBarSelection = () => {
    const next = !selectingBars;
    const range = normalizeLoopRange(
      settingsRef.current.loopBar,
      settingsRef.current.bars.length,
    );
    setSelectedBarIndexes(
      next && range
        ? barIndexesInRange(range)
        : next
          ? [editorBarIndex]
          : [],
    );
    setSelectingBars(next);
    setStatus(next ? "点选要操作的小节" : "就绪");
  };

  const copyBars = () => {
    if (!activeBarIndexes.length) return;
    setBarClipboard(activeBarIndexes.map((index) => cloneBar(settingsRef.current.bars[index])));
    setEditorBarIndex(activeBarIndexes.at(-1));
    setSelectedBarIndexes([]);
    setSelectingBars(false);
    setStatus(`${activeBarIndexes.length} 个小节已复制，选择位置后粘贴`);
  };

  const pasteBars = () => {
    const current = settingsRef.current;
    if (!barClipboard.length) return;
    const pasted = barClipboard.map(cloneBar);
    if (playbackIntentRef.current) stop("节奏已更新");
    const insertAt = Math.min((activeBarIndexes.at(-1) ?? editorBarIndex) + 1, current.bars.length);
    const bars = [...current.bars];
    bars.splice(insertAt, 0, ...pasted);
    const nextIndex = insertAt + pasted.length - 1;
    setEditorBarIndex(nextIndex);
    setSelectedBarIndexes([]);
    setSelectingBars(false);
    updateSettings({
      bars,
      loopBar: insertLoopRange(current.loopBar, insertAt, pasted.length),
    });
    setStatus(`${pasted.length} 个小节已粘贴`);
  };

  const moveSelectedBars = (direction) => {
    if (!activeBarIndexes.length) return;
    const current = settingsRef.current;
    const moved = moveBarSelection(current.bars, activeBarIndexes, direction);
    if (moved.order.every((originalIndex, index) => originalIndex === index)) return;
    if (playbackIntentRef.current) stop("节奏已排序");
    const nextEditorIndex = moved.order.indexOf(editorBarIndex);
    setEditorBarIndex(nextEditorIndex);
    setSelectedBarIndexes(
      activeBarIndexes.map((index) => moved.order.indexOf(index)).sort((left, right) => left - right),
    );
    updateSettings({
      bars: moved.bars,
      loopBar: remapLoopRange(current.loopBar, moved.order),
    });
    setStatus("小节已排序");
  };

  const toggleBarLoop = () => {
    const current = normalizeLoopRange(
      settingsRef.current.loopBar,
      settingsRef.current.bars.length,
    );
    if (selectingBars && activeBarIndexes.length) {
      const range = [activeBarIndexes[0], activeBarIndexes.at(-1)];
      const matches = current?.[0] === range[0] && current?.[1] === range[1];
      if (!matches) setSelectedBarIndexes(barIndexesInRange(range));
      applyQuickRhythm({ loopBar: matches ? null : range });
      setStatus(matches ? "循环全部小节" : "循环所选段落");
    } else {
      applyQuickRhythm({ loopBar: current ? null : [editorBarIndex, editorBarIndex] });
      setStatus(current ? "循环全部小节" : "循环当前小节");
    }
  };

  const changeQuickMeter = (beats) => {
    const current = settingsRef.current;
    const subdivision = QUICK_PATTERNS.find(({ id }) => id === current.quickPatternId);
    setEditorBarIndex(0);
    setSelectingBars(false);
    setSelectedBarIndexes([]);
    setSelectedRhythmId("");
    setRhythmName("");
    applyQuickRhythm({
      ...makeSingleBarRhythm(beats, subdivision?.steps ?? [1]),
      quickPatternId: subdivision?.id ?? null,
    });
  };

  const changeQuickBeatUnit = (beatUnit) => {
    const current = settingsRef.current;
    const index = Math.min(editorBarIndex, current.bars.length - 1);
    const subdivision = QUICK_PATTERNS.find(({ id }) => id === current.quickPatternId);
    setEditorBarIndex(0);
    setSelectingBars(false);
    setSelectedBarIndexes([]);
    setSelectedRhythmId("");
    setRhythmName("");
    applyQuickRhythm({
      beatUnit,
      ...makeSingleBarRhythm(
        current.bars[index].beats.length,
        subdivision?.steps ?? [1],
      ),
      quickPatternId: subdivision?.id ?? null,
    });
  };

  const changeQuickPattern = (option) => {
    const current = settingsRef.current;
    const index = Math.min(editorBarIndex, current.bars.length - 1);
    setEditorBarIndex(0);
    setSelectingBars(false);
    setSelectedBarIndexes([]);
    setSelectedRhythmId("");
    setRhythmName("");
    applyQuickRhythm({
      ...makeSingleBarRhythm(current.bars[index].beats.length, option.steps),
      quickPatternId: option.id,
    });
  };

  const exportRhythm = async () => {
    const code = encodeRhythm(settingsRef.current);
    setRhythmCode(code);
    try {
      await navigator.clipboard.writeText(code);
      setStatus("节奏编码已复制");
      setShowRhythmCode(false);
    } catch {
      setShowRhythmCode(true);
      setStatus("请手动复制编码");
    }
  };

  const applyImportedRhythm = (rhythm, name = "") => {
    if (playbackIntentRef.current) stop("节奏已导入");
    setEditorBarIndex(loopStart(rhythm.loopBar));
    setBpmDraft(String(rhythm.bpm));
    setSelectedRhythmId("");
    setRhythmName(name);
    updateSettings({ ...rhythm, startBpm: rhythm.bpm });
    setShowRhythmCode(false);
    setStatus("节奏已导入");
  };

  const importRhythm = () => {
    try {
      applyImportedRhythm(decodeRhythm(rhythmCode));
    } catch {
      setStatus("编码无效");
    }
  };

  const importMusicXml = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const revision = generationRef.current;
    const bpm = settingsRef.current.bpm;
    try {
      const { musicXmlToRhythm } = await import("./musicXml.js");
      const rhythm = musicXmlToRhythm(await file.text(), bpm);
      if (revision !== generationRef.current) return;
      const unsupported =
        rhythm.bpm < BPM_MIN ||
        rhythm.bpm > BPM_MAX ||
        !BEAT_UNITS.includes(rhythm.beatUnit) ||
        rhythm.bars.some((bar) =>
          bar.beats.length < 1 ||
          bar.beats.length > MAX_BEATS ||
          bar.beats.some(({ steps }) =>
            steps.length < 1 || steps.length > MAX_SUBDIVISION
          )
        );
      if (unsupported) throw new Error("速度、拍号或细分超出高级节奏支持范围");
      applyImportedRhythm(rhythm, file.name.replace(/\.(musicxml|xml)$/i, "").slice(0, 40));
    } catch (error) {
      if (revision !== generationRef.current) return;
      setStatus(`MusicXML 无法导入：${error.message}`);
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
    if (id.startsWith(TUTORIAL_PREFIX)) {
      const entry = PRACTICE_PRESETS.find(
        ({ preset }) => preset.id === id.slice(TUTORIAL_PREFIX.length),
      );
      if (!entry) return;
      const next = clonePracticeRhythm(entry.preset);
      const name = `${entry.week.label} · ${entry.exercise.label}${
        entry.exercise.presets.length > 1 ? ` · ${entry.preset.label}` : ""
      }`;
      if (playbackIntentRef.current) stop("节奏已切换");
      setEditorBarIndex(0);
      setSelectingBars(false);
      setSelectedBarIndexes([]);
      setBpmDraft(String(next.bpm));
      setRhythmName(name.slice(0, 40));
      updateSettings({ ...next, startBpm: next.bpm });
      const silent = next.bars.every((bar) =>
        bar.beats.every((beat) => beat.steps.every((step) => step === 0)),
      );
      setStatus(silent ? "教材要求本练习不使用节拍器" : `已载入 ${entry.preset.label}`);
      return;
    }
    const saved = savedRhythms.find((item) => item.id === id);
    if (!saved) return;
    try {
      const rhythm = decodeRhythm(saved.code);
      if (playbackIntentRef.current) stop("节奏已切换");
      setEditorBarIndex(loopStart(rhythm.loopBar));
      setBpmDraft(String(rhythm.bpm));
      setRhythmName(saved.name);
      updateSettings({ ...rhythm, startBpm: rhythm.bpm });
      setStatus("节奏已切换");
    } catch {
      setStatus("保存的节奏无效");
    }
  };

  const deleteLocalRhythm = () => {
    const saved = savedRhythms.find(({ id }) => id === selectedRhythmId);
    if (
      !saved ||
      !window.confirm(ui(`删除“${saved.name}”？`, `Delete “${saved.name}”?`))
    ) {
      return;
    }
    const next = savedRhythms.filter(({ id }) => id !== selectedRhythmId);
    try {
      localStorage.setItem(RHYTHM_LIBRARY_KEY, JSON.stringify(next));
      setSavedRhythms(next);
      setSelectedRhythmId("");
      setRhythmName("");
      setStatus("保存的节奏已删除");
    } catch {
      setStatus("删除失败");
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

  const editorBar = settings.bars[editorBarIndex] ?? settings.bars[0];
  const activeBarIndexes = [
    ...new Set(selectingBars ? selectedBarIndexes : [editorBarIndex]),
  ]
    .filter((index) => index >= 0 && index < settings.bars.length)
    .sort((left, right) => left - right);
  const activeBarIndexSet = new Set(activeBarIndexes);
  const loopRange = normalizeLoopRange(settings.loopBar, settings.bars.length);
  const selectedLoopRange =
    selectingBars && activeBarIndexes.length
      ? [activeBarIndexes[0], activeBarIndexes.at(-1)]
      : null;
  const selectedLoopMatches =
    selectedLoopRange &&
    loopRange?.[0] === selectedLoopRange[0] &&
    loopRange?.[1] === selectedLoopRange[1];

  const loopActionLabel = selectedLoopRange
    ? selectedLoopMatches
      ? ui("循环全部小节", "Loop all bars")
      : activeBarIndexes.length > 1
        ? ui("循环所选段落", "Loop selection")
        : ui("循环所选小节", "Loop selected bar")
    : loopRange
      ? ui("循环全部小节", "Loop all bars")
      : ui("循环当前小节", "Loop current bar");
  const canMoveBarsLeft = activeBarIndexes.some(
    (index) => index > 0 && !activeBarIndexSet.has(index - 1),
  );
  const canMoveBarsRight = activeBarIndexes.some(
    (index) => index < settings.bars.length - 1 && !activeBarIndexSet.has(index + 1),
  );
  const quickPattern = settings.quickPatternId;
  const quickHasOffbeats = hasOffbeatSteps(settings.bars);
  const matrixHeight =
    Math.max(...settings.bars.flatMap((bar) => bar.beats.map((beat) => beat.steps.length))) *
      48 +
    44;
  const visibleHistory = practiceHistory
    .filter(({ key }) => key === (analysis?.key ?? practiceKey(settings)))
    .slice(-8);
  const exportPracticeAudio = () => {
    if (!recordingAudio) return;
    const extension = recordingAudio.blob.type.includes("mp4")
      ? "m4a"
      : recordingAudio.blob.type.includes("ogg")
        ? "ogg"
        : recordingAudio.blob.type.includes("wav")
          ? "wav"
          : "webm";
    const url = URL.createObjectURL(recordingAudio.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `kessoku-beat-${new Date(recordingAudio.at).toISOString().slice(0, 19).replaceAll(":", "-")}.${extension}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("录音已导出");
  };

  useEffect(() => {
    const handleEditorShortcut = (event) => {
      if (event.target.closest?.("input, textarea, select, [contenteditable='true']")) {
        return;
      }
      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (command && key === "c") {
        event.preventDefault();
        copyBars();
      } else if (command && key === "v" && barClipboard.length) {
        event.preventDefault();
        pasteBars();
      } else if (command && key === "z" && event.shiftKey && historyDepth.redo) {
        event.preventDefault();
        travelHistory("redo");
      } else if (command && key === "z" && historyDepth.undo) {
        event.preventDefault();
        travelHistory("undo");
      } else if (command && key === "y" && historyDepth.redo) {
        event.preventDefault();
        travelHistory("redo");
      } else if (command && key === "a") {
        event.preventDefault();
        setSelectingBars(true);
        applyBarSelection(settings.bars.map((_, index) => index));
        setStatus(`已选择 ${settings.bars.length} 个小节`);
      } else if (event.key === "Escape" && selectingBars) {
        setSelectingBars(false);
        setSelectedBarIndexes([]);
        setStatus("已退出多选");
      } else if (event.key === "Delete" && settings.bars.length > 1) {
        event.preventDefault();
        deleteBars(activeBarIndexes);
      }
    };
    window.addEventListener("keydown", handleEditorShortcut);
    return () => window.removeEventListener("keydown", handleEditorShortcut);
  });

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

  const playbackActionLabel = playing
    ? ui("暂停", "Pause")
    : paused
      ? ui("继续", "Resume")
      : ui("开始", "Start");
  const displayStatus = localizeStatus(status, isEnglish);
  const themeArtUrl = `${import.meta.env.BASE_URL}themes/hitori.png`;

  return (
    <div
      className={`app-shell ${playing ? "is-playing" : ""} ${recording ? "is-recording" : ""}`}
      data-character={appearance.character}
      data-visual-style={appearance.style}
      data-locale={appearance.locale}
    >
      <header className="topbar">
        <a className="brand" href="#main" aria-label="KESSOKU BEAT">
          <span className="brand-mark" aria-hidden="true">
            <Activity strokeWidth={2.4} />
          </span>
          <span className="brand-copy">
            <strong>KESSOKU BEAT</strong>
            <small>結束バンド</small>
          </span>
        </a>

        <div className="appearance-toolbar">
          <nav
            className="character-themes"
            aria-label={ui("角色主题", "Character themes")}
          >
            {CHARACTER_THEMES.map((theme) => (
              <button
                key={theme.id}
                className={appearance.character === theme.id ? "is-selected" : ""}
                type="button"
                onClick={() => theme.ready && updateAppearance({ character: theme.id })}
                aria-disabled={!theme.ready}
                aria-pressed={appearance.character === theme.id}
                aria-label={theme.ready ? theme.label : `${theme.label} · 準備中`}
              >
                <i className={`member-dot is-${theme.id}`} aria-hidden="true" />
                <span>{theme.label}</span>
                {!theme.ready && <small>準備中</small>}
              </button>
            ))}
          </nav>

          <div
            className="visual-style-switcher"
            role="group"
            aria-label={ui("界面风格", "Visual style")}
          >
            {VISUAL_STYLES.map((style) => (
              <button
                key={style.id}
                className={appearance.style === style.id ? "is-selected" : ""}
                type="button"
                onClick={() => updateAppearance({ style: style.id })}
                aria-pressed={appearance.style === style.id}
              >
                {style.label}
              </button>
            ))}
          </div>

          <button
            className="locale-switch"
            type="button"
            onClick={() => updateAppearance({ locale: isEnglish ? "zh" : "en" })}
            aria-label={ui("切换到英文", "Switch to Chinese")}
          >
            {isEnglish ? "EN / 中" : "中 / EN"}
          </button>
        </div>

        <div className="topbar-actions">
          <div className="ready-pill" role="status" aria-live="polite">
            <span aria-hidden="true" />
            {displayStatus}
          </div>
          {(playing || paused) && (
            <button
              className="topbar-stop"
              type="button"
              onClick={recording ? finishPracticeRecording : playing ? pausePlayback : resumePlayback}
            >
              {recording
                ? <Square fill="currentColor" />
                : playing
                  ? <Pause fill="currentColor" />
                  : <Play fill="currentColor" />}
              {recording ? ui("结束录音", "End recording") : playbackActionLabel}
            </button>
          )}
        </div>
      </header>

      <main id="main" className="workspace">
        <aside className="card settings-card advanced-rhythm-card" aria-labelledby="settings-heading">
          <section className="theme-stage" aria-label={`${selectedTheme.label} テーマ`}>
            <div className="stage-color-blocks" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>
            <figure className="stage-portrait">
              <img src={themeArtUrl} alt={selectedTheme.label} />
            </figure>
            <figure className="stage-detail" aria-hidden="true">
              <img src={themeArtUrl} alt="" />
            </figure>
            <div className="stage-silhouette" aria-hidden="true">
              <img src={themeArtUrl} alt="" />
            </div>
            <div className="stage-stats">
              <span>
                <strong>{settings.bpm}</strong>
                <small>BPM</small>
              </span>
              <span>
                <strong>{editorBar.beats.length}/{settings.beatUnit}</strong>
                <small>{ui("拍号", "Meter")}</small>
              </span>
              <span className="stage-beat-lights" aria-label={ui("节拍指示", "Beat indicators")}>
                {Array.from({ length: editorBar.beats.length }, (_, index) => (
                  <i
                    className={
                      playing && !visual.gap && visual.beat === index ? "is-active" : ""
                    }
                    key={index}
                    aria-hidden="true"
                  />
                ))}
              </span>
            </div>
          </section>

          <div className="control-stack">
          <div className="settings-heading">
            <h2 id="settings-heading">{ui("节奏", "Rhythm")}</h2>
            <div className="rhythm-share-actions">
              <button
                type="button"
                onClick={exportRhythm}
                aria-label={ui("复制节奏编码", "Copy rhythm code")}
              >
                <Copy />
                <span>{ui("复制", "Copy")}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setRhythmCode("");
                  setShowRhythmCode(true);
                }}
                aria-label={ui("导入节奏编码", "Import rhythm code")}
              >
                <ClipboardPaste />
                <span>{ui("导入", "Import")}</span>
              </button>
              {!installed && (
                <button
                  type="button"
                  onClick={installApp}
                  aria-label={ui("添加到桌面", "Install app")}
                >
                  <Download />
                  <span>{ui("安装", "Install")}</span>
                </button>
              )}
            </div>
          </div>

          <div className="rhythm-library">
            <select
              value={selectedRhythmId}
              onChange={(event) => switchLocalRhythm(event.target.value)}
              aria-label={ui("切换节奏预设", "Choose rhythm preset")}
            >
              <option value="">{ui("新节奏", "New rhythm")}</option>
              {PRACTICE_PRESET_WEEKS.map((week) => (
                <optgroup key={week.id} label={`${ui("教程", "Tutorial")} / ${week.label}`}>
                  {week.exercises.flatMap((exercise) =>
                    exercise.presets.map((preset) => (
                      <option key={preset.id} value={`${TUTORIAL_PREFIX}${preset.id}`}>
                        {exercise.label}{exercise.presets.length > 1 ? ` / ${preset.label}` : ""}
                      </option>
                    )),
                  )}
                </optgroup>
              ))}
              {savedRhythms.length > 0 && (
                <optgroup label={ui("我的预设", "My presets")}>
                  {savedRhythms.map((saved) => (
                    <option key={saved.id} value={saved.id}>{saved.name}</option>
                  ))}
                </optgroup>
              )}
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
              aria-label={ui("节奏名称，可留空自动命名", "Rhythm name, optional")}
            />
            <button type="button" onClick={saveLocalRhythm}>
              <Save />
              <span>{ui("保存", "Save")}</span>
            </button>
            <button
              className="is-danger"
              type="button"
              onClick={deleteLocalRhythm}
              disabled={!savedRhythms.some(({ id }) => id === selectedRhythmId)}
              aria-label={ui("删除当前保存的节奏", "Delete saved rhythm")}
              title={ui("删除当前保存的节奏", "Delete saved rhythm")}
            >
              <Trash2 />
            </button>
          </div>

          <div className="advanced-transport">
            <button
              className="tempo-step"
              type="button"
              onClick={() => setBpm(settings.bpm - 10)}
              aria-label={ui("速度减 10 BPM", "Decrease tempo by 10 BPM")}
            >
              −10
            </button>
            <button
              className="tempo-step"
              type="button"
              onClick={() => setBpm(settings.bpm - 5)}
              aria-label={ui("速度减 5 BPM", "Decrease tempo by 5 BPM")}
            >
              −5
            </button>
            <label className="advanced-bpm">
              <span className="sr-only">{ui("每分钟节拍数", "Beats per minute")}</span>
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
              className="tempo-step"
              type="button"
              onClick={() => setBpm(settings.bpm + 5)}
              aria-label={ui("速度加 5 BPM", "Increase tempo by 5 BPM")}
            >
              +5
            </button>
            <button
              className="tempo-step"
              type="button"
              onClick={() => setBpm(settings.bpm + 10)}
              aria-label={ui("速度加 10 BPM", "Increase tempo by 10 BPM")}
            >
              +10
            </button>
            <div
              className="advanced-playback"
              role="group"
              aria-label={ui("播放控制", "Playback controls")}
            >
              <button
                className="advanced-play"
                type="button"
                onClick={togglePlayback}
                aria-label={playbackActionLabel}
                aria-keyshortcuts="Space"
                disabled={recording}
              >
                {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
                <span>{playbackActionLabel}</span>
              </button>
              <button
                className="advanced-restart"
                type="button"
                onClick={restartPlayback}
                aria-label={ui("重新开始", "Restart")}
                title={ui("重新开始", "Restart")}
                disabled={recording || (!playing && !paused)}
              >
                <RotateCcw />
                <span>{ui("重新开始", "Restart")}</span>
              </button>
            </div>
            <button
              className="advanced-tap"
              type="button"
              onClick={tapTempo}
              aria-label={ui("Tap 测速", "Tap tempo")}
              aria-keyshortcuts="T"
              disabled={recording}
            >
              <Hand />
              <span>{ui("测速", "Tap")}</span>
            </button>
          </div>

          <div className="setting-block quick-composer">
            <div className="quick-group">
              <span className="quick-caption">{ui("细分", "Subdivision")}</span>
              <div
                className="rhythm-preset-grid"
                role="group"
                aria-label={ui("细分", "Subdivision")}
              >
                {QUICK_PATTERNS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={quickPattern === option.id ? "is-selected" : ""}
                    aria-label={ui(option.label, {
                      beat: "Quarter notes",
                      eighths: "Eighth notes",
                      offbeat: "Offbeats",
                      triplet: "Triplets",
                      "triplet-rest-first": "Triplets · first rest",
                      "triplet-rest-middle": "Triplets · middle rest",
                      "triplet-rest-last": "Triplets · last rest",
                      sixteenths: "Sixteenth notes",
                    }[option.id])}
                    aria-pressed={quickPattern === option.id}
                    title={ui(option.label, {
                      beat: "Quarter notes",
                      eighths: "Eighth notes",
                      offbeat: "Offbeats",
                      triplet: "Triplets",
                      "triplet-rest-first": "Triplets · first rest",
                      "triplet-rest-middle": "Triplets · middle rest",
                      "triplet-rest-last": "Triplets · last rest",
                      sixteenths: "Sixteenth notes",
                    }[option.id])}
                    onClick={() => changeQuickPattern(option)}
                  >
                    <RhythmPatternGlyph steps={option.steps} beatUnit={4} />
                  </button>
                ))}
              </div>
            </div>

            <div className="quick-group">
              <span className="quick-caption">{ui("拍号", "Meter")}</span>
              <div className="meter-wheels" role="group" aria-label={ui("拍号", "Meter")}>
                <label>
                  <span className="sr-only">{ui("当前小节拍数", "Beats in current bar")}</span>
                  <select
                    value={editorBar.beats.length}
                    onChange={(event) => changeQuickMeter(Number(event.target.value))}
                  >
                    {Array.from({ length: MAX_BEATS }, (_, index) => index + 1).map((beats) => (
                      <option key={beats} value={beats}>{beats}</option>
                    ))}
                  </select>
                </label>
                <span aria-hidden="true">/</span>
                <label>
                  <span className="sr-only">{ui("拍号音符", "Beat unit")}</span>
                  <select
                    value={settings.beatUnit}
                    onChange={(event) => changeQuickBeatUnit(Number(event.target.value))}
                  >
                    {BEAT_UNITS.map((unit) => (
                      <option key={unit} value={unit}>{unit}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <button
              className={
                settings.distinguishOffbeats && quickHasOffbeats
                  ? "quick-toggle is-active"
                  : "quick-toggle"
              }
              type="button"
              onClick={() => updateSettings({ distinguishOffbeats: !settings.distinguishOffbeats })}
              aria-pressed={settings.distinguishOffbeats && quickHasOffbeats}
              disabled={!quickHasOffbeats}
            >
              {ui("正反拍音色区分", "Differentiate offbeat sound")}
            </button>
          </div>

          <div
            className="gap-click track-controls"
            role="group"
            aria-label={ui("播放控制", "Playback controls")}
          >
            <button
              className={settings.beatTrack ? "is-active" : ""}
              type="button"
              onClick={() => updateSettings({ beatTrack: !settings.beatTrack })}
              aria-pressed={settings.beatTrack}
              title={ui(
                "每拍固定响一次，第一拍重音",
                "Sound once per beat, with an accent on the first beat",
              )}
            >
              <i className="beat-track-mark" aria-hidden="true" />
              <span>{ui("节拍", "Beat")}</span>
            </button>
            <button
              className={settings.rhythmTrack ? "is-active" : ""}
              type="button"
              onClick={() => updateSettings({ rhythmTrack: !settings.rhythmTrack })}
              aria-pressed={settings.rhythmTrack}
              title={ui(
                "只在实际弹奏的音符起点响",
                "Sound only when a played note begins",
              )}
            >
              <i className="rhythm-track-mark" aria-hidden="true" />
              <span>{ui("节奏", "Rhythm")}</span>
            </button>
            <button
              className={settings.countIn ? "is-active" : ""}
              type="button"
              onClick={() => updateSettings({ countIn: !settings.countIn })}
              aria-pressed={settings.countIn}
              title={ui("开始前预备一小节", "Count in for one bar before starting")}
            >
              <span>{ui("预备拍", "Count-in")}</span>
            </button>
            <button
              className={settings.gapClick ? "is-active" : ""}
              type="button"
              onClick={() => changeGapClick({ gapClick: !settings.gapClick })}
              aria-pressed={settings.gapClick}
              title={ui(
                "时间轴继续，仅随机关闭声音和节拍动画",
                "Keep the timeline running while randomly muting sound and beat animation",
              )}
            >
              <VolumeX />
              <span>{ui("随机空拍", "Random gaps")}</span>
            </button>
            <div
              className="gap-levels"
              role="group"
              aria-label={ui("随机空拍难度", "Random gap difficulty")}
            >
              {GAP_DIFFICULTIES.map((option) => (
                <button
                  key={option.value}
                  className={settings.gapDifficulty === option.value ? "is-selected" : ""}
                  type="button"
                  onClick={() => changeGapClick({ gapDifficulty: option.value })}
                  disabled={!settings.gapClick}
                  aria-pressed={settings.gapDifficulty === option.value}
                  title={ui(option.title, {
                    easy: "Sound for 3–5 bars, mute for 1 bar",
                    medium: "Sound for 2–4 bars, mute for 1–2 bars",
                    hard: "Sound for 1–3 bars, mute for 2–4 bars",
                  }[option.value])}
                >
                  {ui(option.label, {
                    easy: "Easy",
                    medium: "Medium",
                    hard: "Hard",
                  }[option.value])}
                </button>
              ))}
            </div>
          </div>

          <div className="setting-block trainer-block">
            <div className="setting-label trainer-heading">
              <span>{ui("自动变速", "Tempo trainer")}</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.trainer}
                  onChange={(event) => changeTrainer({ trainer: event.target.checked })}
                  aria-label={ui("自动变速", "Tempo trainer")}
                />
                <span aria-hidden="true" />
              </label>
            </div>
            {settings.trainer && (
              <div className="trainer-grid">
                <label>
                  <span>{ui("起始", "Start")}</span>
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
                  <span>{ui("目标", "Target")}</span>
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
                  <span>{ui("间隔", "Interval")}</span>
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
                        {ui(`${bars} 小节`, `${bars} ${bars === 1 ? "bar" : "bars"}`)}
                      </option>
                    ))}
                    <option value="minute">{ui("每分钟", "Every minute")}</option>
                  </select>
                </label>
                <label>
                  <span>{ui("步长", "Step")}</span>
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

          <div className="setting-block rhythm-block">
            <div className="advanced-section-heading">
              <span>
                <strong>{ui("节奏编辑", "Rhythm editor")}</strong>
                <small>
                  {ui(
                    "增减拍数、细分与重音",
                    "Add or remove beats, subdivisions, and accents",
                  )}
                </small>
              </span>
            </div>
            <div className="rhythm-toolbar">
              <button
                className={`matrix-icon-button ${settings.loopBar !== null ? "is-active" : ""}`}
                type="button"
                onClick={toggleBarLoop}
                aria-label={loopActionLabel}
                aria-pressed={settings.loopBar !== null}
                title={loopActionLabel}
              >
                <Repeat2 />
              </button>
              <div
                className="bar-pages"
                role="tablist"
                aria-label={ui("小节", "Bars")}
                aria-multiselectable={selectingBars || undefined}
              >
                {settings.bars.map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    className={[
                      (selectingBars
                        ? selectedBarIndexes.includes(index)
                        : loopRange && index >= loopRange[0] && index <= loopRange[1])
                        ? "is-selected"
                        : "",
                      playing && !visual.gap && index === visual.bar ? "is-playing" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={(event) => selectBar(index, event)}
                    role="tab"
                    aria-selected={
                      selectingBars ? selectedBarIndexes.includes(index) : index === editorBarIndex
                    }
                    aria-label={ui(`第 ${index + 1} 小节`, `Bar ${index + 1}`)}
                  >
                    <i aria-hidden="true" />
                  </button>
                ))}
              </div>
              <button
                className="matrix-control"
                type="button"
                onClick={() => deleteBars([editorBarIndex])}
                disabled={settings.bars.length === 1}
                aria-label={ui("删除当前小节", "Delete current bar")}
                title={ui("删除当前小节", "Delete current bar")}
              >
                <Trash2 />
              </button>
              <button
                className="matrix-control"
                type="button"
                onClick={duplicateBar}
                aria-label={ui("复制当前小节", "Duplicate current bar")}
                title={ui("复制当前小节", "Duplicate current bar")}
              >
                <Plus />
              </button>
            </div>

            <div
              className="bar-actions"
              role="group"
              aria-label={ui("小节编辑", "Bar editing")}
            >
              <button
                className="matrix-icon-button"
                type="button"
                onClick={() => travelHistory("undo")}
                disabled={!historyDepth.undo}
                aria-label={ui("撤销最近的节奏修改", "Undo latest rhythm change")}
                title={ui("撤销", "Undo")}
              >
                <Undo2 />
              </button>
              <button
                className="matrix-icon-button"
                type="button"
                onClick={() => travelHistory("redo")}
                disabled={!historyDepth.redo}
                aria-label={ui("重做最近撤销的节奏修改", "Redo latest rhythm change")}
                title={ui("重做", "Redo")}
              >
                <Redo2 />
              </button>
              <button
                className={`matrix-icon-button ${selectingBars ? "is-active" : ""}`}
                type="button"
                onClick={toggleBarSelection}
                aria-label={
                  selectingBars
                    ? ui("退出多选", "Exit multi-select")
                    : ui("多选小节", "Select multiple bars")
                }
                aria-pressed={selectingBars}
                title={
                  selectingBars
                    ? ui("退出多选", "Exit multi-select")
                    : ui("多选小节", "Select multiple bars")
                }
              >
                <ListChecks />
              </button>
              <button
                className="matrix-icon-button"
                type="button"
                onClick={() => moveSelectedBars(-1)}
                disabled={!canMoveBarsLeft}
                aria-label={ui("所选小节左移", "Move selected bars left")}
                title={ui("所选小节左移", "Move selected bars left")}
              >
                <ArrowLeft />
              </button>
              <button
                className="matrix-icon-button"
                type="button"
                onClick={() => moveSelectedBars(1)}
                disabled={!canMoveBarsRight}
                aria-label={ui("所选小节右移", "Move selected bars right")}
                title={ui("所选小节右移", "Move selected bars right")}
              >
                <ArrowRight />
              </button>
              <button
                className="matrix-icon-button"
                type="button"
                onClick={() => deleteBars(activeBarIndexes)}
                disabled={settings.bars.length === 1 || !activeBarIndexes.length}
                aria-label={ui("删除所选小节", "Delete selected bars")}
                title={ui("删除所选小节", "Delete selected bars")}
              >
                <Trash2 />
              </button>
              <button
                className="matrix-icon-button"
                type="button"
                onClick={copyBars}
                disabled={!activeBarIndexes.length}
                aria-label={ui("复制所选小节", "Copy selected bars")}
                title={ui("复制所选小节", "Copy selected bars")}
              >
                <Copy />
              </button>
              <button
                className="matrix-icon-button"
                type="button"
                onClick={pasteBars}
                disabled={!barClipboard.length}
                aria-label={ui("粘贴小节", "Paste bars")}
                title={ui("粘贴小节", "Paste bars")}
              >
                <ClipboardPaste />
              </button>
            </div>

            <div
              className="rhythm-matrix"
              style={{
                "--matrix-height": `${matrixHeight}px`,
                "--beat-columns": editorBar.beats.length,
              }}
            >
              <div
                className={`matrix-body ${editorBar.beats.length > 4 ? "has-many-beats" : ""}`}
              >
                <button
                  className="matrix-control beat-control"
                  type="button"
                  onClick={() => resizeBar(-1)}
                  disabled={editorBar.beats.length === 1}
                  aria-label={ui("减少一拍", "Remove one beat")}
                  title={ui("减少一拍", "Remove one beat")}
                >
                  <Minus />
                </button>

                <div className="matrix-columns">
                  {editorBar.beats.map((beat, beatIndex) => (
                    <fieldset
                      className="rhythm-column"
                      key={beatIndex}
                    >
                      <legend className="sr-only">
                        {ui(`第 ${beatIndex + 1} 拍`, `Beat ${beatIndex + 1}`)}
                      </legend>
                      <button
                        className="matrix-control subdivision-control"
                        type="button"
                        onClick={() => resizeBeat(beatIndex, 1)}
                        disabled={beat.steps.length === MAX_SUBDIVISION}
                        aria-label={ui(
                          `增加第 ${beatIndex + 1} 拍的细分`,
                          `Increase subdivisions in beat ${beatIndex + 1}`,
                        )}
                        title={ui("增加细分", "Increase subdivisions")}
                      >
                        <Plus />
                      </button>

                      <div className="matrix-track">
                        <div className="matrix-dot-track">
                          {beat.steps.map((step, sub) => {
                            const stateName = step === 2
                              ? ui("强音", "Accent")
                              : step === 1
                                ? ui("普通", "Normal")
                                : ui("静音", "Muted");
                            return (
                              <RhythmDot
                                key={sub}
                                className={[
                                  "rhythm-dot",
                                  `state-${step}`,
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
                                style={{
                                  "--dot-position": `${(sub / beat.steps.length) * 100}%`,
                                }}
                                onPress={() => toggleStep(beatIndex, sub)}
                                onHold={() => toggleStep(beatIndex, sub, true)}
                                label={ui(
                                  `第 ${beatIndex + 1} 拍第 ${sub + 1} 格：${stateName}`,
                                  `Beat ${beatIndex + 1}, step ${sub + 1}: ${stateName}`,
                                )}
                                title={ui(
                                  `${stateName}；点击开关，长按切换强音`,
                                  `${stateName}; click to toggle, hold to switch accent`,
                                )}
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
                        aria-label={ui(
                          `减少第 ${beatIndex + 1} 拍的细分`,
                          `Decrease subdivisions in beat ${beatIndex + 1}`,
                        )}
                        title={ui("减少细分", "Decrease subdivisions")}
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
                  aria-label={ui("复制上一拍", "Duplicate previous beat")}
                  title={ui("复制上一拍", "Duplicate previous beat")}
                >
                  <Plus />
                </button>
              </div>
            </div>

            <div
              className="bar-overview"
              aria-label={ui("全部小节预览", "All bars overview")}
            >
              {settings.bars.map((bar, barIndex) => (
                <button
                  key={barIndex}
                  className={[
                    "bar-preview",
                    (selectingBars
                      ? selectedBarIndexes.includes(barIndex)
                      : loopRange && barIndex >= loopRange[0] && barIndex <= loopRange[1])
                      ? "is-selected"
                      : "",
                    playing && !visual.gap && visual.bar === barIndex ? "is-playing" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  onClick={(event) => selectBar(barIndex, event)}
                  aria-label={ui(
                    `第 ${barIndex + 1} 小节预览`,
                    `Bar ${barIndex + 1} preview`,
                  )}
                >
                  <span
                    className="bar-preview-beats"
                    style={{ "--preview-beats": bar.beats.length }}
                    aria-hidden="true"
                  >
                    {bar.beats.map((beat, beatIndex) => (
                      <span
                        key={beatIndex}
                        className="bar-preview-beat"
                        style={{ "--preview-steps": beat.steps.length }}
                      >
                        {beat.steps.map((step, sub) => (
                          <i
                            key={sub}
                            className={[
                              `state-${step}`,
                              playing &&
                              !visual.gap &&
                              visual.bar === barIndex &&
                              visual.beat === beatIndex &&
                              visual.sub === sub
                                ? "is-playing"
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          />
                        ))}
                      </span>
                    ))}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="setting-block sound-block">
            <div className="setting-label">
              <span>{ui("音色", "Sound")}</span>
            </div>
            <div className="sound-grid" aria-label={ui("节拍音色", "Metronome sound")}>
              {SOUNDS.map((sound) => (
                <button
                  key={sound.value}
                  type="button"
                  className={settings.sound === sound.value ? "is-selected" : ""}
                  aria-pressed={settings.sound === sound.value}
                  onClick={() => updateSettings({ sound: sound.value })}
                >
                  <i className={`sound-mark sound-${sound.value}`} aria-hidden="true" />
                  <span>
                    {ui(sound.label, {
                      click: "Crisp",
                      wood: "Woodblock",
                      drum: "Drum",
                      soft: "Soft",
                    }[sound.value])}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="setting-block volume-block">
            <div className="setting-label">
              <span>{ui("音量", "Volume")}</span>
              <small>{settings.muted ? ui("静音", "Muted") : `${settings.volume}%`}</small>
            </div>
            <div className="volume-control">
              <button
                className="volume-button"
                type="button"
                onClick={() => updateSettings({ muted: !settings.muted })}
                aria-label={
                  settings.muted ? ui("取消静音", "Unmute") : ui("静音", "Mute")
                }
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
                aria-label={ui("节拍音量", "Metronome volume")}
                style={{ "--range-progress": `${settings.volume}%` }}
              />
            </div>
          </div>

          <div className="setting-block analysis-setting">
            <div className="setting-label analysis-setting-heading">
              <span>
                <strong>{ui("录音分析", "Recording analysis")}</strong>
                <small>
                  {ui(
                    "对比当前高级节奏，记录练习进步",
                    "Compare with the current advanced rhythm and track your progress",
                  )}
                </small>
              </span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.rhythmAnalysis}
                  onChange={(event) =>
                    updateSettings({ rhythmAnalysis: event.target.checked })
                  }
                  disabled={recording}
                  aria-label={ui("录音分析", "Recording analysis")}
                />
                <span aria-hidden="true" />
              </label>
            </div>

            {settings.rhythmAnalysis && (
              <section
                className="practice-analysis"
                aria-label={ui("节奏录音分析", "Rhythm recording analysis")}
              >
                <p className="analysis-warning" role="note">
                  {ui(
                    "测试中 · 当前功能仍不稳定，暂不建议使用",
                    "Experimental · This feature is still unstable and not recommended yet",
                  )}
                </p>
                <div className="practice-analysis-heading">
                  <div
                    className="analysis-mode"
                    role="group"
                    aria-label={ui("节奏播放方式", "Rhythm playback mode")}
                  >
                    <button
                      className={!settings.analysisLoop ? "is-selected" : ""}
                      type="button"
                      onClick={() => updateSettings({ analysisLoop: false })}
                      disabled={recording}
                      aria-pressed={!settings.analysisLoop}
                    >
                      {ui("播放一遍", "Play once")}
                    </button>
                    <button
                      className={settings.analysisLoop ? "is-selected" : ""}
                      type="button"
                      onClick={() => updateSettings({ analysisLoop: true })}
                      disabled={recording}
                      aria-pressed={settings.analysisLoop}
                    >
                      {ui("循环播放", "Loop")}
                    </button>
                  </div>
                  <button
                    className={`record-button ${recording ? "is-active" : ""}`}
                    type="button"
                    onClick={recording ? finishPracticeRecording : beginPracticeRecording}
                  >
                    {recording ? <Square fill="currentColor" /> : <Mic />}
                    {recording
                      ? ui("停止并分析", "Stop and analyze")
                      : ui("开始录音", "Start recording")}
                  </button>
                  {recordingAudio && !recording && (
                    <button className="record-button" type="button" onClick={exportPracticeAudio}>
                      <Download />
                      {ui("导出录音", "Export recording")}
                    </button>
                  )}
                </div>

                {analysis ? (
                  <>
                    <div className="analysis-result-heading">
                      <span>
                        <strong>{ui("本次结果", "This result")}</strong>
                        <small>
                          {ui(
                            `${analysis.expectedCount} 个节奏基准点`,
                            `${analysis.expectedCount} rhythm reference ${
                              analysis.expectedCount === 1 ? "point" : "points"
                            }`,
                          )}
                        </small>
                      </span>
                    </div>
                    <div className="analysis-stats">
                      <span>
                        <strong>{analysis.stableRate}%</strong>
                        <small>{ui("稳定率", "Stability")}</small>
                      </span>
                      <span>
                        <strong>{Math.round(analysis.meanAbsMs)}ms</strong>
                        <small>{ui("平均误差", "Mean error")}</small>
                      </span>
                      <span>
                        <strong>{analysis.actualBpm ? Math.round(analysis.actualBpm) : "—"}</strong>
                        <small>{ui("实际 BPM", "Actual BPM")}</small>
                      </span>
                      <span>
                        <strong>{analysis.missed} / {analysis.extra}</strong>
                        <small>{ui("漏弹 / 多弹", "Missed / Extra")}</small>
                      </span>
                    </div>
                    <HistoryComparison
                      current={analysis.record}
                      history={visibleHistory}
                      isEnglish={isEnglish}
                    />
                    <TimingThumbnail analysis={analysis} isEnglish={isEnglish} />
                    <div
                      className="timing-legend"
                      aria-label={ui("缩略图图例", "Timing thumbnail legend")}
                    >
                      <span className="is-steady">
                        {ui(`准确 ${analysis.onTime}`, `On time ${analysis.onTime}`)}
                      </span>
                      <span className="is-early">
                        {ui(`偏快 ${analysis.early}`, `Early ${analysis.early}`)}
                      </span>
                      <span className="is-late">
                        {ui(`偏慢 ${analysis.late}`, `Late ${analysis.late}`)}
                      </span>
                      <span className="is-missed">
                        {ui(`漏弹 ${analysis.missed}`, `Missed ${analysis.missed}`)}
                      </span>
                      <span className="is-extra">
                        {ui(`多弹 ${analysis.extra}`, `Extra ${analysis.extra}`)}
                      </span>
                    </div>
                    <TimingBreakdown analysis={analysis} isEnglish={isEnglish} />
                    <p className="analysis-note">
                      {ui(
                        `已自动校正固定延迟 ${Math.round(
                          analysis.calibrationMs,
                        )}ms，允许误差 ±${Math.round(analysis.toleranceMs)}ms。`,
                        `Fixed latency of ${Math.round(
                          analysis.calibrationMs,
                        )}ms was corrected automatically; tolerance ±${Math.round(
                          analysis.toleranceMs,
                        )}ms.`,
                      )}
                    </p>
                  </>
                ) : (
                  <p className="analysis-empty">
                    {ui(
                      `一小节预备拍后开始；${
                        settings.analysisLoop
                          ? "循环播放至手动停止，最长 2 分钟。"
                          : "播放当前节奏一遍后自动分析。"
                      }`,
                      `Starts after a one-bar count-in; ${
                        settings.analysisLoop
                          ? "loops until stopped manually, for up to 2 minutes."
                          : "plays the current rhythm once, then analyzes it automatically."
                      }`,
                    )}
                  </p>
                )}
                {!analysis && (
                  <HistoryComparison
                    current={null}
                    history={visibleHistory}
                    isEnglish={isEnglish}
                  />
                )}
              </section>
            )}
          </div>

          </div>
        </aside>
      </main>
      {toast && (
        <div className="status-toast" key={toast.id} role="status" aria-live="polite">
          <Activity aria-hidden="true" />
          <span>{localizeStatus(toast.message, isEnglish)}</span>
        </div>
      )}
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
          aria-label={ui("关闭", "Close")}
        >
          <X />
        </button>
        <h2 id="rhythm-code-title">{ui("节奏编码", "Rhythm code")}</h2>
        <textarea
          value={rhythmCode}
          onChange={(event) => setRhythmCode(event.target.value.trim())}
          placeholder={ui("粘贴节奏编码", "Paste rhythm code")}
          aria-label={ui("节奏编码", "Rhythm code")}
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
                setShowRhythmCode(false);
              } catch {
                setStatus("请手动复制编码");
              }
            }}
            disabled={!rhythmCode}
          >
            <Copy />
            {ui("复制", "Copy")}
          </button>
          <button type="button" onClick={importRhythm} disabled={!rhythmCode}>
            <ClipboardPaste />
            {ui("导入", "Import")}
          </button>
        </div>
        <label className="musicxml-import">
          <span>{ui("或导入 MusicXML 乐谱", "Or import a MusicXML score")}</span>
          <input
            type="file"
            accept=".musicxml,.xml,application/vnd.recordare.musicxml+xml,application/xml,text/xml"
            onChange={importMusicXml}
          />
        </label>
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
          aria-label={ui("关闭", "Close")}
        >
          <X />
        </button>
        <span className="dialog-icon" aria-hidden="true">
          <Download />
        </span>
        <h2 id="install-title">
          {ui("添加 KESSOKU BEAT 到桌面", "Add KESSOKU BEAT to your home screen")}
        </h2>
        {isIOS ? (
          <ol className="install-steps">
            <li>
              {ui("点击 Safari 的", "Tap Safari's")} <Share2 aria-hidden="true" />{" "}
              {ui("分享", "Share button")}
            </li>
            <li>{ui("选择“添加到主屏幕”", "Choose “Add to Home Screen”")}</li>
            <li>{ui("开启“打开为 Web App”", "Turn on “Open as Web App”")}</li>
            <li>{ui("点击“添加”", "Tap “Add”")}</li>
          </ol>
        ) : (
          <p>
            {ui(
              "打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。",
              "Open your browser menu, then choose “Install app” or “Add to Home Screen”.",
            )}
          </p>
        )}
        <button className="dialog-done" type="button" onClick={() => setShowInstallHelp(false)}>
          {ui("知道了", "Got it")}
        </button>
      </dialog>
    </div>
  );
}
