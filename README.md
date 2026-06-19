# AV Control Rack

一个用于 TouchDesigner / 现场视觉的本地控制台原型。

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

项目当前没有第三方 npm 依赖，因此克隆后不需要先运行 `npm install`。

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

在线版本可用于视觉、麦克风和 MIDI 测试。浏览器网页不能直接发送 UDP OSC 到本地 TouchDesigner；需要 OSC 时请使用下面的本地启动方式。

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
