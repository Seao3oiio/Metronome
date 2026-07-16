import { XMLParser, XMLValidator } from "fast-xml-parser";

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  parseTagValue: true,
});

const named = (nodes, name) =>
  (nodes ?? []).filter((node) => Object.hasOwn(node, name));

const body = (node, name) => node?.[name] ?? [];
const text = (nodes, name) => body(named(nodes, name)[0], name)[0]?.["#text"];
const attr = (node, name) => node?.[":@"]?.[`@_${name}`];
const has = (nodes, name) => named(nodes, name).length > 0;
const NOTE_QUARTER_LENGTH = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  "16th": 0.25,
  "32nd": 0.125,
  "64th": 0.0625,
};

function readPart(partNode) {
  let divisions = 1;
  let beats = 4;
  let beatUnit = 4;
  let tempo = null;

  return named(body(partNode, "part"), "measure").map((measureNode) => {
    const items = body(measureNode, "measure");
    const repeatDirections = items.flatMap((item) =>
      named(item.barline, "repeat").map((repeat) => attr(repeat, "direction")),
    );
    let cursor = 0;
    let chordStart = 0;
    const events = [];

    for (const item of items) {
      if (item.attributes) {
        divisions = Number(text(item.attributes, "divisions") ?? divisions);
        const timeNode = named(item.attributes, "time")[0];
        if (timeNode) {
          beats = Number(text(timeNode.time, "beats") ?? beats);
          beatUnit = Number(text(timeNode.time, "beat-type") ?? beatUnit);
        }
      } else if (item.direction && tempo == null) {
        const sound = named(item.direction, "sound")[0];
        const soundTempo = Number(attr(sound, "tempo"));
        const directionType = named(item.direction, "direction-type")[0];
        const metronome = named(directionType?.["direction-type"], "metronome")[0];
        const writtenTempo = Number(text(metronome?.metronome, "per-minute"));
        const writtenUnit = text(metronome?.metronome, "beat-unit");
        const dots = named(metronome?.metronome, "beat-unit-dot").length;
        const dotMultiplier = Array.from({ length: dots }, (_, index) => 1 / (2 ** (index + 1)))
          .reduce((sum, value) => sum + value, 1);
        const writtenQuarterLength = NOTE_QUARTER_LENGTH[writtenUnit] * dotMultiplier;
        if (Number.isFinite(soundTempo)) tempo = soundTempo;
        else if (Number.isFinite(writtenTempo) && Number.isFinite(writtenQuarterLength)) {
          tempo = writtenTempo * writtenQuarterLength;
        }
      } else if (item.backup) {
        cursor -= Number(text(item.backup, "duration") ?? 0) / divisions;
      } else if (item.forward) {
        cursor += Number(text(item.forward, "duration") ?? 0) / divisions;
      } else if (item.note) {
        const duration = Number(text(item.note, "duration") ?? 0) / divisions;
        const chord = has(item.note, "chord");
        const onset = chord ? chordStart : cursor;
        if (!chord) chordStart = cursor;
        const notations = named(item.note, "notations")[0];
        const tieStop = named(item.note, "tie").some((tie) => attr(tie, "type") === "stop") ||
          named(notations?.notations, "tied").some((tie) => attr(tie, "type") === "stop");
        if (!has(item.note, "rest") && !tieStop) {
          const articulations = named(notations?.notations, "articulations")[0];
          events.push({
            onset,
            accent: has(articulations?.articulations, "accent") ||
              has(articulations?.articulations, "strong-accent"),
          });
        }
        if (!chord) cursor += duration;
      }
    }

    return {
      beats,
      beatUnit,
      tempo,
      events,
      startsRepeat: repeatDirections.includes("forward"),
      endsRepeat: repeatDirections.includes("backward"),
    };
  });
}

function subdivisionFor(positions) {
  for (let subdivision = 1; subdivision <= 12; subdivision += 1) {
    if (positions.every((position) => Math.abs(position * subdivision - Math.round(position * subdivision)) < 1e-7)) {
      return subdivision;
    }
  }
  throw new Error("MusicXML contains a subdivision finer than 12 parts per beat");
}

export function musicXmlToRhythm(xml, fallbackBpm = 96) {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new Error(validation.err.msg);

  const document = parser.parse(xml);
  const score = named(document, "score-partwise")[0];
  if (!score) throw new Error("Only score-partwise MusicXML is supported");
  const parts = named(score["score-partwise"], "part").map(readPart);
  if (parts.length === 0 || parts[0].length === 0) throw new Error("MusicXML has no measures");

  const beatUnit = parts[0][0].beatUnit;
  const measureCount = Math.max(...parts.map((part) => part.length));
  const bars = Array.from({ length: measureCount }, (_, measureIndex) => {
    const source = parts.find((part) => part[measureIndex])?.[measureIndex];
    if (source.beatUnit !== beatUnit) throw new Error("Changing beat units are not supported");
    const quarterLength = 4 / beatUnit;
    const events = parts.flatMap((part) => part[measureIndex]?.events ?? []);

    return {
      beats: Array.from({ length: source.beats }, (_, beatIndex) => {
        const beatEvents = events
          .map((event) => ({ ...event, position: event.onset / quarterLength - beatIndex }))
          .filter(({ position }) => position >= -1e-7 && position < 1 - 1e-7);
        const subdivision = subdivisionFor(beatEvents.map(({ position }) => position));
        const steps = Array(subdivision).fill(0);
        beatEvents.forEach(({ position, accent }) => {
          const index = Math.round(position * subdivision);
          steps[index] = Math.max(steps[index], accent ? 2 : 1);
        });
        return { steps };
      }),
    };
  });

  const quarterTempo = parts.flat().find(({ tempo }) => Number.isFinite(tempo))?.tempo;
  const tempo = quarterTempo == null ? fallbackBpm : quarterTempo * beatUnit / 4;
  const loopStart = parts[0].findIndex(({ startsRepeat }) => startsRepeat);
  const loopEnd = parts[0].findIndex(
    ({ endsRepeat }, index) => endsRepeat && index >= Math.max(0, loopStart),
  );
  const loopBar = loopEnd < 0 ? null : [Math.max(0, loopStart), loopEnd];
  return { bpm: Math.round(tempo), beatUnit, bars, loopBar };
}
