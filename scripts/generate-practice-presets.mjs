import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { musicXmlToRhythm } from "../src/musicXml.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scoresRoot = path.join(root, "resources", "scores");
const catalog = JSON.parse(await readFile(path.join(scoresRoot, "catalog.json"), "utf8"));

const weeks = [];
for (const week of catalog) {
  const exercises = [];
  for (const exercise of week.exercises) {
    const presets = [];
    for (const preset of exercise.presets) {
      const xml = await readFile(path.join(scoresRoot, preset.source), "utf8");
      presets.push({ ...preset, ...musicXmlToRhythm(xml) });
    }
    exercises.push({ ...exercise, presets });
  }
  weeks.push({ ...week, exercises });
}

const output = `// Generated from resources/scores/*.musicxml. Do not edit by hand.\nexport const PRACTICE_PRESET_WEEKS = ${JSON.stringify(weeks, null, 2)};\n`;
await writeFile(path.join(root, "src", "practicePresets.generated.js"), output);
