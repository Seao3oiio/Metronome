export { PRACTICE_PRESET_WEEKS } from "./practicePresets.generated.js";

export function clonePracticeRhythm(preset) {
  return {
    bpm: preset.bpm,
    beatUnit: preset.beatUnit,
    bars: preset.bars.map((bar) => ({
      beats: bar.beats.map((beat) => ({ steps: [...beat.steps] })),
    })),
    loopBar: preset.loopBar,
  };
}
