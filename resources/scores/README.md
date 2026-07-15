# 教程谱面数据

这里保存 PDF 教程中 7 周、66 个练习对应的 92 个 MusicXML 4.0 文件。
`catalog.json` 记录周次、练习、PDF 页码和谱面文件之间的关系；应用中的教程预设由这些文件生成。

当前文件是用于节拍器的 rhythmic reduction：保留拍号、速度、音符起音位置和重音，音高统一写成无固定音高的打击乐音符。原谱的休止与 tie continuation 都归一为“没有新 onset”，因此这些文件能准确重建节拍器事件，但不是包含 pitch、指法和演奏技法的原谱复刻。

重新生成应用数据：

```sh
npm run generate-presets
```

不要直接修改 `src/practicePresets.generated.js`；应修改对应 `.musicxml` 后重新生成。普通 `score-partwise` MusicXML 也可以由 `src/musicXml.js` 读取并转换成节奏；其中 rest、chord、tie stop 和 accent 会按乐谱语义处理，pitch 不参与节拍器事件生成。
