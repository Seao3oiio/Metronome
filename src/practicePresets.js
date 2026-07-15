const steps = (pattern) => [...pattern].map((step) => (step === "-" ? 0 : step === ">" ? 2 : 1));

const grid = (pattern, beats = 4) => {
  const compact = pattern.replaceAll(" ", "");
  const subdivision = compact.length / beats;
  if (!Number.isInteger(subdivision) || subdivision < 1) {
    throw new Error(`Invalid ${beats}-beat pattern: ${pattern}`);
  }
  return {
    beats: Array.from({ length: beats }, (_, index) =>
      ({ steps: steps(compact.slice(index * subdivision, (index + 1) * subdivision)) })),
  };
};

const rhythm = (id, label, bpm, patterns, beats = 4, beatUnit = 4) => ({
  id,
  label,
  bpm,
  beatUnit,
  bars: patterns.map((pattern) => grid(pattern, beats)),
  loopBar: null,
});

const Q = "xxxx";
const E = "xxxxxxxx";
const T = "xxxxxxxxxxxx";
const S = "xxxxxxxxxxxxxxxx";
const SIX = "xxxxxxxxxxxxxxxxxxxxxxxx";
const WHOLE = "x---";
const HALF = "x-x-";
const THREE = "xxx-";
const OFFBEAT = "-x-x-x-x";
const SILENT = "----";

const one = (id, label, bpm, patterns, beats = 4, beatUnit = 4) => ({
  id,
  label,
  presets: [rhythm(id, label, bpm, patterns, beats, beatUnit)],
});

const many = (id, label, presets) => ({ id, label, presets });

// Repeated score bars with the same attack pattern are collapsed to the shortest useful loop.
export const PRACTICE_PRESET_WEEKS = [
  {
    id: "w1",
    label: "第一周",
    exercises: [
      one("w1-ex1", "EX1 右手空弦下拨", 40, ["-x-x"]),
      one("w1-ex2", "EX2 左手按弦练习", 40, [Q]),
      one("w1-ex3", "EX3 1&2指纵向爬格子", 40, [Q]),
      one("w1-ex4", "EX4 1&3指纵向爬格子", 40, [Q]),
      one("w1-ex5", "EX5 1&2指全指板爬格子", 100, [Q]),
      one("w1-ex6", "EX6 1&3指全指板爬格子", 100, [Q]),
      one("w1-ex7", "EX7 第五把位C调音阶", 80, [Q]),
      one("w1-ex8", "EX8 全&二分&四分音符节奏转换", 60, [WHOLE, HALF, Q, HALF]),
      many("w1-ex9", "EX9 C调简谱视奏", [
        rhythm("w1-ex9-1", "No.1 火车", 100, [WHOLE, WHOLE, HALF, HALF, Q]),
        rhythm("w1-ex9-2", "No.2 雷格泰姆舞", 100, ["xx-x", "x-x-", WHOLE, WHOLE, "xx-x", "x-x-"]),
        rhythm("w1-ex9-3", "No.3 自新大陆交响曲", 100, ["x--x", WHOLE, "x--x", WHOLE, "x-x-", "x--x"]),
        rhythm("w1-ex9-4", "No.4 小星星", 100, [Q, "xxx-", Q, "xxx-"]),
        rhythm("w1-ex9-5", "No.5 森林之海", 80, [HALF, Q, HALF, "x--x"]),
      ]),
    ],
  },
  {
    id: "w2",
    label: "第二周",
    exercises: [
      one("w2-ex1", "EX1 单弦交替拨弦", 120, [Q, E, Q, E]),
      one("w2-ex2", "EX2 多弦交替拨弦", 120, [E]),
      one("w2-ex3", "EX3 2&3指全指板爬格子", 100, [E]),
      one("w2-ex4", "EX4 4&1指双弦爬格子", 120, [Q]),
      one("w2-ex5", "EX5 第二把位C调音阶", 80, [E]),
      one("w2-ex6", "EX6 大&小二度模唱", 40, [THREE]),
      one("w2-ex7", "EX7 二&四&八分音符节奏转换", 40, [HALF, Q, E, Q]),
      many("w2-ex8", "EX8 第二把位简谱视奏", [
        rhythm("w2-ex8-1", "No.1 雷格泰姆舞", 100, ["xx-x", "x-x-", WHOLE, WHOLE]),
        rhythm("w2-ex8-2", "No.2 自新大陆交响曲", 100, ["x--x", WHOLE, "x--x", WHOLE]),
        rhythm("w2-ex8-3", "No.3 滑稽面孔", 100, ["x-x", "xxx", "x-x", "xxx"], 3),
        rhythm("w2-ex8-4", "No.4 拔河", 100, ["xxx", "x--", "xxx", "x--"], 3),
        rhythm("w2-ex8-5", "No.5 捉人游戏", 80, ["xxxxxx-x", "xxxx-xxx", "xxxxxxxx"]),
      ]),
      one("w2-ex9", "EX9 周杰伦-青花瓷", 80, ["---xxxxx", "xxxxxx-x", "xxxxxxxx", "xxxx-xxx"]),
    ],
  },
  {
    id: "w3",
    label: "第三周",
    exercises: [
      one("w3-ex1", "EX1 单弦含16分音符的交替拨弦", 80, [Q, E, S, E]),
      one("w3-ex2", "EX2 滑弦技巧练习", 100, [Q]),
      one("w3-ex3", "EX3 4&1指全指板爬格子", 100, [Q]),
      one("w3-ex4", "EX4 双弦保留指爬格子", 80, [Q]),
      one("w3-ex5", "EX5 第一把位音阶及闷音练习", 100, [Q]),
      one("w3-ex6", "EX6 三度模唱练习", 40, [THREE]),
      one("w3-ex7", "EX7 音阶串连及反拍练习", 80, [OFFBEAT]),
      many("w3-ex8", "EX8 1&2把位简谱视奏", [
        rhythm("w3-ex8-1", "No.1 扬基歌", 100, [Q, Q, Q, "x-xx"]),
        rhythm("w3-ex8-2", "No.2 把我带回弗吉尼故乡", 100, ["xx-x", "x--x", "x-x-", "xx--"]),
        rhythm("w3-ex8-3", "No.3 都选C", 80, ["--xxxxxx", "xxxxxxxx"]),
        rhythm("w3-ex8-4", "No.4 太阳升起", 80, ["xxxxxxxx", "xxxx-x-x", "x-x-x-x-"]),
        rhythm("w3-ex8-5", "No.5 虫儿飞", 80, ["xxxxxx-x", "xxxx-xxx", "xxxxxxxx", "xx----xx"]),
      ]),
      one("w3-ex9", "EX9 许巍-蓝莲花Solo", 80, ["xxx-xxxx", "x-xxxx-x", "-xxxxxxx"]),
    ],
  },
  {
    id: "w4",
    label: "第四周",
    exercises: [
      one("w4-ex1", "EX1 单弦含三连音的交替拨弦", 80, [Q, E, T, S, T]),
      one("w4-ex2", "EX2 击弦技巧练习", 100, [Q, E, Q, E]),
      one("w4-ex3", "EX3 纵向保留指爬格子", 100, [Q]),
      one("w4-ex4", "EX4 4&3指原地交替练习", 80, [Q, E]),
      one("w4-ex5", "EX5 第四把位部分音阶及制音拨弦", 60, [S]),
      one("w4-ex6", "EX6 相对于do的音程模唱", 40, [THREE]),
      many("w4-ex7", "EX7 八分音符含休止和延音的节奏视奏", [
        rhythm("w4-ex7-1", "节奏视奏1", 60, ["xxxxxx--", "xx-xxxxx", "x--x--xx", "xxxxxxxx"]),
        rhythm("w4-ex7-2", "节奏视奏2", 60, ["xxxx-x-x", "xx-xxx-x", "xxxxxx-x"]),
        rhythm("w4-ex7-3", "节奏视奏3", 60, ["xx-xxx-x", "x--x-xxx", "x-xx-x-x"]),
        rhythm("w4-ex7-4", "节奏视奏4", 60, ["xx--x-xx", "x--xxx-x", "--x-xx--"]),
      ]),
      many("w4-ex8", "EX8 非C调简谱视奏", [
        rhythm("w4-ex8-1", "No.1 小夜曲(C调)", 100, [THREE, Q]),
        rhythm("w4-ex8-2", "No.2 小夜曲(G调)", 100, [THREE, Q]),
        rhythm("w4-ex8-3", "No.3 Five Hundred Miles", 100, ["xxxxx-x-", "xxxxxxx-", "xxxxxx--"]),
        rhythm("w4-ex8-4", "No.4 周杰伦-兰亭序", 80, ["--xxxxxx", "xxxxxxxx", "xxxx-xxx"]),
        rhythm("w4-ex8-5", "No.5 Sweet Child O'Mine", 60, ["xxxxxxxx"]),
      ]),
      one("w4-ex9", "EX9 火影忍者-剪影Solo", 100, ["xx-xxx--", "x-xxxx--", "x---x---"]),
    ],
  },
  {
    id: "w5",
    label: "第五周",
    exercises: [
      one("w5-ex1", "EX1 单弦含重音的节奏转换拨弦", 80, [">xxx", ">x>x>x>x", ">xx>xx>xx>xx", ">xxx>xxx>xxx>xxx"]),
      one("w5-ex2", "EX2 勾弦技巧练习", 100, [Q, E]),
      one("w5-ex3", "EX3 单弦横向爬格子", 120, [E]),
      one("w5-ex4", "EX4 纵向1434保留指爬格子", 120, [Q]),
      many("w5-ex5", "EX5 十六分音符少1个音的节奏视奏", [
        rhythm("w5-ex5-1", "节奏视奏1", 50, ["xxxxxxxxxxxxxxx-", "xxxxxxxxxxx-xxxx", "xxxxxxx-xxxxxxxx", "xxx-xxxxxxxxxxxx"]),
        rhythm("w5-ex5-2", "节奏视奏2", 50, ["xxx-xxx-xxx-xxx-", "xx-xxx-xxx-xxx-x", "x-xxx-xxx-xxx-xx"]),
        rhythm("w5-ex5-3", "节奏视奏3", 50, ["xxxxxxxxxxx-xxxx", "xxxxxxx-xxxxxxxx", "xxx-xxxxxxxxxxxx"]),
        rhythm("w5-ex5-4", "节奏视奏4", 50, ["xxxxx-xxxxxxxxxx", "-xxxxxxxxxxxxxxx", "xxxxxxxxxxxx-xxx"]),
      ]),
      one("w5-ex6", "EX6 AIR-鸟之诗", 80, ["xxxxxxx-", "-xxxxxxx", "x-xxxx--", "--xxxxx-"]),
      one("w5-ex7", "EX7 扫弦技巧练习", 60, [E, S, "x-x-x-x-", "x-xxx-xx"]),
      one("w5-ex8", "EX8 根音在5&6弦上的五和弦", 90, [E]),
      one("w5-ex9", "EX9 5&6弦指板音横向记忆练习（无固定节奏）", 60, [SILENT]),
      one("w5-ex10", "EX10 周杰伦-爱的飞行日记", 90, [E]),
    ],
  },
  {
    id: "w6",
    label: "第六周",
    exercises: [
      one("w6-ex1", "EX1 先上拨的单弦节奏转换拨弦", 80, [Q, E, T, S, T, E]),
      one("w6-ex2", "EX2 揉弦技巧练习", 100, [WHOLE]),
      one("w6-ex3", "EX3 单弦手指协调性练习", 60, [S]),
      one("w6-ex4", "EX4 单指连续击勾弦练习", 100, [E]),
      many("w6-ex5", "EX5 16分音符少2个音的节奏视奏", [
        rhythm("w6-ex5-1", "节奏视奏1", 50, ["xxxxxx--xxxxxx--", "xxxx--xxxx--xxxx", "xx--xx--xx--xx--"]),
        rhythm("w6-ex5-2", "节奏视奏2", 50, ["xxxxxxxxxxxxxx--", "xxxxxxxxxx--xxxx", "xxxxxx--xxxxxxxx"]),
        rhythm("w6-ex5-3", "节奏视奏3", 50, ["xxxx-xx-xxxx-xx-", "xx-xxx-xxx-xxx-x"]),
        rhythm("w6-ex5-4", "节奏视奏4", 50, ["xx--xx--xx--xx--", "x-x-x-x-x-x-x-x-"]),
        rhythm("w6-ex5-5", "节奏视奏5", 50, ["xxxx---xxxx---xx", "--xxxx---xxxx---"]),
      ]),
      one("w6-ex6", "EX6 Beyond-光辉岁月Solo", 60, ["-xxxxxxx", "xxxxxxx-", "-xxxx-xx", "x--xxx--"]),
      one("w6-ex7", "EX7 根音在三弦的C调原位三和弦", 40, [THREE, HALF]),
      one("w6-ex8", "EX8 1&2&3弦指板音横向记忆练习（无固定节奏）", 60, [SILENT]),
      one("w6-ex9", "EX9 制音移位扫弦", 60, [">xxx", "xx>x", ">xxx", "xxx>"]),
      one("w6-ex10", "EX10 轻音少女-Don't say lazy", 90, [E, "xxxxxx--"]),
    ],
  },
  {
    id: "w7",
    label: "第七周",
    exercises: [
      one("w7-ex1", "EX1 单弦含六连音的节奏转换拨弦", 60, [Q, E, T, S, SIX, S, T, E]),
      one("w7-ex2", "EX2 推弦技巧练习", 60, ["xx-xxx--"]),
      one("w7-ex3", "EX3 多弦手指协调性练习", 60, [S]),
      one("w7-ex4", "EX4 双指连续击勾弦练习", 60, ["xxxxxxxxxxxxxxxx"]),
      one("w7-ex5", "EX5 夜鹿-花上亡灵Solo", 100, ["xxxx-xxx", "-xxxxxxx", "xxx-xxxx"]),
      one("w7-ex6", "EX6 布鲁斯shuffle节奏扫弦", 60, ["x-xx-xx-xx-x"]),
      one("w7-ex7", "EX7 ZZ Top-Tush", 60, [E]),
      one("w7-ex8", "EX8 1&2&3弦指板音强化记忆练习（无固定节奏）", 60, [SILENT]),
      one("w7-ex9", "EX9 三个音的转位大&小三和弦", 50, [WHOLE]),
      one("w7-ex10", "EX10 五月天-温柔", 60, ["x-xxx---"]),
    ],
  },
];

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
