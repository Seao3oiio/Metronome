# Pulse 节拍器

面向 PC、iPad 和手机的响应式练习节拍器。使用 Tone.js 的 Web Audio 时钟提供稳定节拍，设置会自动保存在当前浏览器。

在线使用：https://seao3oiio.github.io/Metronome/

```bash
npm install
npm run dev
```

可用控制：

- BPM `30–240`、Tap Tempo、每小节 `2/3/4/6` 拍
- `1/2/3/4/5/6/8` 拍内细分，以及整小节强音、普通、静音节奏格
- 清脆、木鱼、鼓点、柔和四种音色
- 按目标 BPM、间隔小节与步长自动加速或减速
- 音量、静音、设置记忆，以及支持 Audio Session API 的 iPhone/iPad 锁屏播放

键盘支持 `Space` 开始或暂停、`T` Tap Tempo、方向键调速。

## 安装到桌面

生产构建包含 Web App Manifest、离线 Service Worker 和 iOS 图标。通过 HTTPS 打开后点击“添加到桌面”：支持安装提示的浏览器会直接安装；iPhone/iPad 会显示 Safari 的“分享 → 添加到主屏幕”步骤。

锁屏继续播放依赖 iOS 17+ 的 Audio Session API；系统电话、其他独占音频或较旧 iOS 仍可能中断声音。
