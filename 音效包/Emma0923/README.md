# Emma0923 · 五场景音效包

**提交标注：Emma0923｜2026-09-23｜v0.1**

供同事按需选取、试听和合并。全部交付物都在本目录内，分支 `emma0923/audio-pack`；本次没有修改已有游戏引擎、外骨骼控制或语音代码。音频设计对应仓库 5 套主题、6 条路线，共 **11 个双声道 WAV**。

## 只要声音：直接取 assets

| 场景 / 用途 | 对应主题 | 文件 | 内容 |
| --- | --- | --- | --- |
| 泰山·十八盘 | `dawn_mountain` | [taishan.wav](assets/taishan.wav) | 24 秒，风与稀疏鸟鸣，可循环 |
| 富士山·吉田线夜登 | `night_to_dawn` | [fuji.wav](assets/fuji.wav) | 24 秒，高山阵风，可循环 |
| 赛博东京·夜行 | `cyber_night` | [tokyo.wav](assets/tokyo.wav) | 24 秒，雨声与合成远处车流感，可循环 |
| 梧桐山·好汉坡 | `subtropical` | [wutong.wav](assets/wutong.wav) | 24 秒，较密鸟鸣与林间风，可循环 |
| 长坡 / 台阶训练场 | `grid` | [training.wav](assets/training.wav) | 8 秒，可选轻室内底音；默认静音 |
| 石阶脚步 | 平地 / 台阶 | [step_stone.wav](assets/step_stone.wav) | 单次触发 |
| 碎石脚步 | 富士山 | [step_gravel.wav](assets/step_gravel.wav) | 单次触发 |
| 落叶脚步 | 梧桐山 | [step_leaves.wav](assets/step_leaves.wav) | 单次触发 |
| 泥地脚步 | 备用素材 | [step_mud.wav](assets/step_mud.wav) | 单次触发，当前试听台未默认使用 |
| 通关提示 | 完成一圈 | [arrive.wav](assets/arrive.wav) | 原创合成提示音 |
| 路段提示 | 由集成方选择 | [checkpoint.wav](assets/checkpoint.wav) | 原创合成提示音 |

格式：48 kHz / 16-bit / 立体声 WAV。脚步没有混进环境底音，方便停步时立即停止。地域名称表示游戏设计方向，**不是这些地点的实地录音**。

CC0 素材与原创合成音的作者、来源、改动见 [CREDITS.md](CREDITS.md)；文件 SHA-256 和数字电平见 [manifest.json](manifest.json)。选取 WAV 时请同时保留这两份追溯文件。

## 想先听：运行试听台

在仓库根目录执行（Python 3.9+，只用标准库）：

```sh
python "音效包/Emma0923/tools/serve_soundscape.py" --port 8890
```

在运行服务器的电脑打开 `http://127.0.0.1:8890/`，点击「启用声音」。有声道检查、声画脉冲、模拟脚步、解说压低环境音和测试记录导出。不需要 Google Key、网络音频服务或麦克风权限。

要跟随同一电脑上的游戏实际进度，添加只读来源地址（8877 请换成实际游戏端口）：

```sh
python "音效包/Emma0923/tools/serve_soundscape.py" --port 8890 --source http://127.0.0.1:8877
```

随后在页面展开「跟随正在运行的游戏」并连接。只读取状态，不向外骨骼发送指令。首次连接不补播旧脚步；红灯和停止行走时不播放脚步；状态过期会停止声音。切到后台默认停止，重新启用需要用户点击。

## 想接进游戏：取播放器代码

- `audio.mjs`：循环音、脚步、渐变、解说压低环境音、音量和声道测试。
- `state.mjs`：按 `theme.style` 匹配声音；处理首次状态、换世界、乱序、跳步和断线。
- `lab.mjs` / `index.html` / `style.css`：可运行的集成参考与试听界面。
- `tools/`：本包独立服务器和音频重建脚本；`worlds/` 为设计所用场景快照。
- [接入与远程测试](docs/接入与远程测试.md)：与主服务器、峰哥解说和眼镜配合的方法。

如需复制到原游戏目录，可将本目录根部的 `*.mjs`、`index.html`、`style.css`、`manifest.json`、`CREDITS.md` 和 `assets/` 一起放入 `shellos/ui/static/soundscape/`。主服务器路由、语音开始/结束事件由相应维护人接入。当前包并未自动挂载到主游戏。

## 验证和当前边界

在本音效包目录执行：

```sh
node --test tests/soundscape-state.test.mjs
python -m unittest discover -s tests -p test_soundscape.py -v
```

5 个状态测试、3 个素材/代理检查通过。先前本地浏览器已验证五套声音解码、数字输出、训练场静音、红灯脚步抑制和连接失败停播；见 [数字检查](docs/环境音数字检查.json)。

**E06s 远程实机验收待完成**：需要在连接眼镜的电脑选择眼镜为系统音频输出，由佩戴者确认左右声道和延迟。此包不包含眼镜厂商 SDK、摄像头读取、头部追踪或所有品牌的兼容保证。

## 重新生成音频

构建阶段需要 numpy 和 ffmpeg；日常播放不需要。按 `sources.json` 中的 URL 下载原文件并按 `file` 字段命名，将 `sources.json` 复制到原素材目录；雨声和脚步 ZIP 分别解压进该目录的 `rain/`、`steps/`。然后从本包目录运行：

```sh
python tools/build_soundscape.py --sources /path/to/audio-sources
```

脚本先核对原文件 SHA-256，再生成音频和 manifest。发布前请重新执行上述检查。
