export const BPM_MIN = 30;
export const BPM_MAX = 240;

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

export function makePattern(beats, subdivision, mode = "even") {
  return Array.from({ length: beats * subdivision }, (_, index) => {
    if (mode === "main") return index % subdivision === 0 ? (index === 0 ? 2 : 1) : 0;
    return index === 0 ? 2 : 1;
  });
}

export function nextTrainingBpm(current, target, step) {
  const direction = Math.sign(target - current);
  if (!direction) return current;
  const next = current + direction * Math.max(1, step);
  return direction > 0 ? Math.min(next, target) : Math.max(next, target);
}
