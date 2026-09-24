# 五场景环境音素材与授权

2026-09-23 制作。用于 AIMA 游戏的设计混音，不是五处地点的实地录音。
下载地址、原文件 SHA-256、输出文件 SHA-256、采样格式见 manifest.json。

| 来源 | 作者 | 授权 | 使用方式 |
| --- | --- | --- | --- |
| [Birds and Wind – Ambient](https://opengameart.org/content/birds-and-wind-ambient-birds-wind-and-synth) | Spring Spring | CC0 | 选择 Ambient 版本，裁剪、交叉混合、调整增益，用于泰山/梧桐山 |
| [wind1](https://opengameart.org/content/wind1) | Luke.RUSTLTD | CC0 | 作者用 Pure Data 合成的风声；用于山地风底，不称为真实风声采样 |
| [Rain (loopable)](https://opengameart.org/content/rain-loopable) | Ylmir | CC0 | Rain OGG.zip / 1.ogg，窗口雨声录音；循环混合用于赛博东京 |
| [Different steps on wood, stone, leaves, gravel and mud](https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud) | TinyWorlds | CC0 | stone01、gravel、leaves01、mud02，电平调整与首尾淡入淡出 |

Birds and Wind 的作者页面另致谢 isaiah658、syncopika、pauliuw 的公共领域素材。
TinyWorlds 在页面说明脚步源自 pdsounds.org，并为 Minetest 编辑。
保留这些来源说明便于追溯；依据下载时资产页标注选用 CC0。

本次新增的阵风低频层、车流感低鸣、训练室底音、checkpoint/arrive 提示音由数学振荡器与滤波噪声合成，原创新增音频也按 CC0-1.0 提供。
这些并非调用 AI 音频模型生成，没有使用商业歌曲、人声或受限音效库。

[CC0 1.0 说明](https://creativecommons.org/publicdomain/zero/1.0/) · [完整法律文本](https://creativecommons.org/publicdomain/zero/1.0/legalcode)

## 成品清单

- taishan.wav：24 秒，风与稀疏鸟鸣。
- fuji.wav：24 秒，高山风，无森林鸟鸣。
- tokyo.wav：24 秒，雨声与合成远处车流低鸣。
- wutong.wav：24 秒，较密鸟鸣与林间风；未核实鸟种地域。
- training.wav：8 秒，可选室内底噪，训练场默认不播放。
- step_stone / step_gravel / step_leaves / step_mud：4 个独立脚步。
- arrive / checkpoint：2 个短提示音；checkpoint 供集成方选择触发。

均为 48 kHz / 16-bit / 双声道 WAV。环境音可循环；脚步不混入底音。
仅依据数字峰值、循环接缝与浏览器播放检查质量，仍需佩戴者对响度、舒适度和地域氛围进行试听验收。
