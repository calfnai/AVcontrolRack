# AV Control Rack / Range Echo

一个可独立运行的 Three.js 音频视觉作品，同时保留 Web MIDI 和本地 OSC 控制能力。

当前版本以这台 MacBook Pro（Apple M1、8 核 GPU、16GB 内存）作为性能上限：

- 160×160 GPU 粒子针阵，共 25,600 个核心点。
- M1 默认档增加 8,000 个氛围/流星点，总量 33,600。
- 高画质档总量 49,600，低于 65,536 个粒子的硬上限。
- 中低频从盘面中心向四周生成涟漪。
- 重低音在随机位置产生不可见落点的冲击反馈。
- 高频触发最多三条流星，落地后转为盘面冲击。
- 图片、SVG、文字和音频盘面复用同一个核心粒子池。

## 在线试玩

```text
https://calfnai.github.io/AVcontrolRack/
```

GitHub Pages 使用 HTTPS，可以在用户点击 `MIC` 后请求麦克风权限。浏览器网页不能直接发送 UDP OSC；需要 OSC 时使用本地启动方式。

## 本地启动

需要 Node.js 18 或更高版本。项目没有第三方 npm 依赖。

```bash
git clone https://github.com/calfnai/AVcontrolRack.git
cd AVcontrolRack
npm start
```

打开：

```text
http://127.0.0.1:4173
```

macOS 也可以双击 `Open AV Control Rack.command`。只要对应的 Terminal 窗口仍然运行，本地地址就不会出现 `127.0.0.1 refused to connect`；停止服务请按 `Control-C`。

直接打开 `index.html` 仍可观看画面、导入图片和播放本地音频文件。麦克风是否允许取决于浏览器对 `file://` 的安全策略，因此麦克风测试优先使用 localhost 或 GitHub Pages。

## 在另一台电脑继续

```bash
git clone https://github.com/calfnai/AVcontrolRack.git
cd AVcontrolRack
npm start
```

以后换电脑继续开发前先运行 `git pull --rebase`。GitHub 同步代码和仓库内的开发说明，不同步两个 Codex 对话的聊天记录。

## 操作

首屏是全屏视觉作品。右上角 `CONTROL` 打开控制抽屉：

- `MIC`：请求麦克风。
- `AUDIO`：选择本地音频文件。
- `ECHO`：启用或暂停中低频扩散波。
- `BLACK`：黑场。
- `FREEZE`：冻结视觉状态。
- `RND`：在受控范围内随机化参数。
- `A–H`：八组紫粉色系场景。

舞台左侧可以切换：

- `RANGE FIELD`：160×160 音频盘面。
- `PARTICLE FORM`：文字、图片或 SVG 粒子形态。

Particle Form 效果：

- `MORPH`：保持目标形态。
- `SCATTER`：沿粒子方向散开。
- `VORTEX`：围绕形态中心旋转。
- `PULSE`：整体呼吸。
- `WAVE`：形态表面行波。

## M1 性能档位

页面启动后会采样约三秒帧时间：

| 档位 | 核心点 | 氛围点 | DPR 上限 | 辉光 |
| --- | ---: | ---: | ---: | --- |
| STABLE | 25,600 | 3,000 | 1.0 | 关闭 |
| M1 | 25,600 | 8,000 | 1.25 | 半分辨率单次合成 |
| HIGH | 25,600 | 24,000 | 1.25 | 半分辨率单次合成 |

连续两秒低于 52 FPS 时会逐级降档；不会自动升档。HIGH 只能由用户手动选择。

控制抽屉会显示 FPS、P95 帧时间、当前粒子总数和 DPR。开发测试还可从控制台调用：

```js
window.__AV_TEST__.metrics()
window.__AV_TEST__.stress(true)
window.__AV_TEST__.stress(false)
```

## 音频映射

实时 FFT 的主要响应范围是 0–3.5 kHz：

```text
20–55 Hz      -> 重低音候选
55–165 Hz     -> 低频力量
165–620 Hz    -> 中心涟漪主触发
620–3500 Hz   -> 盘面纹理和形变
3500–9500 Hz  -> 流星和空气粒子
```

歌曲没有明显重低音时，会根据最近数秒的低频动态范围选择更明显的低频瞬态作为替代冲击。BPM 使用中低频触发间隔的中位数估计，只控制旋转基准速度。

事件触发不使用固定音量门槛：每个频段分别维护动态噪声底，并直接读取未经慢速平滑的瞬态。中低频、重低音和高频也各自设置事件密度下限；当音乐过于平缓或输入接近静音时，会自动过渡到较轻的空闲运动，避免画面长时间没有新事件。

麦克风失败时状态栏会显示：

```text
MIC DENIED      浏览器或系统拒绝权限
NO MIC          没有输入设备
MIC BUSY        输入设备正被占用
MIC NEEDS HTTPS 当前页面环境不允许调用麦克风
```

## TouchDesigner / OSC

本地 Node 服务默认把参数发送到：

```text
127.0.0.1:7000
```

可用环境变量：

```bash
OSC_HOST=127.0.0.1 OSC_PORT=7000 PORT=4173 npm start
```

OSC 地址保持兼容：

```text
/av/scene
/av/speed
/av/density
/av/feedback
/av/warp
/av/size
/av/audioGain
/av/hue
/av/intensity
/av/echo
/av/blackout
/av/freeze
```

MIDI 映射保持不变：

```text
CC 1-8       -> speed, density, feedback, warp, size, audioGain, hue, intensity
Note 36-43   -> scene A-H
```
