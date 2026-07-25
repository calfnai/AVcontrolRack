# AV Control Rack

一个纯网页 3D 音频响应视觉原型，也保留本地 OSC 控制台能力。

当前视觉方向是低成本的 `Range Echo 3D`：Three.js 实例化柱阵、Web Audio FFT、低频扩散波、高频粒子/流星感。线上版本可以直接打开试玩；本地版本额外可以把控制参数通过 OSC 发给 TouchDesigner。

## 在另一台电脑运行

准备：

- Git
- Node.js 18 或更高版本

```bash
git clone https://github.com/calfnai/AVcontrolRack.git
cd AVcontrolRack
npm start
```

然后打开：

```text
http://localhost:4173
```

项目当前没有本地 npm 依赖，因此克隆后不需要先运行 `npm install`。Three.js 已放在 `vendor/three.min.js`，直接打开 `index.html` 或使用 GitHub Pages 都可以加载 3D 舞台。

## 在另一台电脑用 Codex 共同开发

先在另一台电脑安装并登录 GitHub、Codex，然后让 Codex 打开克隆后的 `AVcontrolRack` 文件夹。仓库根目录的 `AGENTS.md` 会向 Codex 提供项目结构、开发约束和验证要求。

首次使用：

```bash
git clone https://github.com/calfnai/AVcontrolRack.git
cd AVcontrolRack
```

以后每次换电脑继续开发前：

```bash
git pull --rebase
```

开发完成后，让 Codex 提交并推送到 GitHub；另一台电脑再次执行 `git pull --rebase` 就能接着开发。GitHub 同步代码和 `AGENTS.md`，但不会同步两个 Codex 对话的聊天记录，因此重要决定应写进仓库文档。

## 在线版本

```text
https://calfnai.github.io/AVcontrolRack/
```

在线版本可用于 3D 视觉、麦克风和 MIDI 测试。浏览器网页不能直接发送 UDP OSC 到本地 TouchDesigner；需要 OSC 时请使用下面的本地启动方式。

## 启动

```bash
npm start
```

打开：

```text
http://localhost:4173
```

## TouchDesigner 连接

默认 OSC 输出到：

```text
127.0.0.1:7000
```

在 TouchDesigner 里添加 `OSC In CHOP` 或 `OSC In DAT`，端口设为 `7000`。控制台会发送这些地址：

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
/av/blackout
/av/freeze
```

如果要改 OSC 目标：

```bash
OSC_HOST=127.0.0.1 OSC_PORT=7000 PORT=4173 npm start
```

## MIDI 映射

浏览器支持 Web MIDI 时，控制台会自动尝试连接 MIDI 控制器。

```text
CC 1  -> speed
CC 2  -> density
CC 3  -> feedback
CC 4  -> warp
CC 5  -> size
CC 6  -> audioGain
CC 7  -> hue
CC 8  -> intensity
Note 36-43 -> scene A-H
```

## 音频

点击 `MIC` 后，浏览器会请求麦克风权限。音频分析会驱动画面里的 bass / mid / high，并显示在左下角读数里。

如果 `MIC` 失败，状态栏会显示具体原因：

```text
MIC DENIED      浏览器或系统拒绝了麦克风权限
NO MIC          没有可用输入设备
MIC BUSY        麦克风被系统或其他应用占用
MIC NEEDS HTTPS 当前浏览器环境不允许调用麦克风
```

本地调试优先使用 Chrome / Safari 打开 GitHub Pages 或 `http://localhost:<port>`。如果浏览器环境不允许麦克风，可以点 `AUDIO` 选择本地音频文件，页面会用该音频文件驱动同一套 bass / mid / high 分析。

当前 3D 映射：

```text
bass -> 地面扩散波、柱阵整体冲击
mid  -> 柱阵波形和扭曲
high -> 高频粒子、亮边和闪烁
```

不打开麦克风时，页面会用一组轻微的 idle 信号保持动画可看。

## Particleify

控制台提供一个轻量版 Particleify 面板：

```text
TEXT  -> 把输入框里的文字转成 3D 柱阵轮廓
IMAGE -> 上传图片，用图片亮度生成 3D 柱阵轮廓
CLEAR -> 回到完整音域网格
```

Particleify 轮廓只是视觉 mask；音频、场景、速度、密度、反馈、扭曲、尺寸、色相和强度滑杆仍然会继续影响 3D 舞台。
