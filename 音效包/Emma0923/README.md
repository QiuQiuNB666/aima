# Emma0923 · 游戏环境音效包 v0.2

**2026-09-24｜依据 main 9832875｜分支 emma0923/audio-pack**

新增 **26 个音频**，原 11 个 WAV 保持不变，共 **37 个 WAV / 53.44 MB**。覆盖 **8 套声景、8 条登山与训练路线、屋顶跑酷界面**。交付仅在本目录，继续用 Emma0923 标记。

**本包提供素材、映射和试听台，尚未自动挂载主游戏。** 现有游戏合成音继续由原代码管理；接入时替换同类声音，避免叠播。

## 场景与文件

| 场景 / 用途 | assets/ 中的文件 | 内容 |
| --- | --- | --- |
| 珠峰营地 | everest_camp.wav | 24 秒，低风与炉火气流 |
| 珠峰冰川、冰壁、横梯 | everest_glacier.wav | 24 秒，开阔冷风与细雪感 |
| 北山脊、刀脊、北壁横切 | everest_ridge.wav | 24 秒，风吼与间歇尖啸 |
| 华山悬崖与栈道 | huashan_cliff.wav | 24 秒，悬崖风与松风感 |
| 屋顶跑酷 | parkour_rooftop.wav | 24 秒，屋顶风与远处车流 |
| 东京可选氛围层 | cyber_pad.wav | 24 秒，原创科幻低音垫 |
| 珠峰直升机 | helicopter_rotor.wav | 8 秒，按距离 / 转速调节的旋翼循环 |
| 新脚步 | step_snow / step_ice / step_metal / step_wood.wav | 雪、冰爪、金属梯、木板；单次 |
| 地图互动 | rope_creak / carabiner_click / chain_clink / flag_flap / yak_bell.wav | 绳索、扣锁、铁链、布料、牦牛铃 |
| 吸氧 / 可选呼吸 | oxygen_hiss / breath.wav | 气流设计音；呼吸默认不自动启用 |
| 跑酷动作 | parkour_jump / parkour_land / parkour_slide / parkour_hit / mech_hum.wav | 跳跃、落地、滑铲、碰撞、机甲低鸣 |
| 东京动作 | cyber_camo / cyber_glitch / taiko.wav | 迷彩、故障、登顶鼓点 |
| 原五套声景 | taishan / fuji / tokyo / wutong / training.wav | 原文件保持不变；训练场默认静音 |
| 原脚步 / 提示 | step_stone / step_gravel / step_leaves / step_mud / arrive / checkpoint.wav | 原文件保持不变 |

全部为 **48 kHz / 16-bit / 立体声 WAV**。7 个新循环不混入脚步、口播或固定步频；19 个新单次音随画面事件触发。新增声音为原创程序合成，按 CC0-1.0 提供，不是 AI 音频模型生成，也不是当地实地录音。旧 CC0 素材继续保留来源。

- [assets/](assets/)：直接选取音频。
- [SCENE-MAP.json](SCENE-MAP.json)：66 个路段、21 项事件、2 个额外叠层的匹配与增益。
- [manifest.json](manifest.json)：文件时长、循环标志、SHA-256、数字电平及来源。
- [CREDITS.md](CREDITS.md)：授权与改动说明。
- [接入说明](docs/接入与远程测试.md)：最新游戏代码中的替换位置与眼镜测试。
- [数字检查](docs/audio-qa-20260924.json)：37 文件的峰值、循环接缝和单声道合成检查。

选取 WAV 时请同时保留来源、manifest 与映射。worlds/ 是设计快照，不要覆盖游戏地图。

## 试听

在仓库根目录运行，Python 3.9+，仅标准库：

```sh
python "音效包/Emma0923/tools/serve_soundscape.py" --port 8890
```

打开 http://127.0.0.1:8890/ ，点击「启用声音」并选择场景 / 路段。第三块可逐个试听、下载全部素材；单项播放会停止场景混音。页面进入后台会停声。

同机跟随登山游戏：

```sh
python "音效包/Emma0923/tools/serve_soundscape.py" --port 8890 --source http://127.0.0.1:8765
```

试听台只读 /state，按珠峰 / 华山路段切换底音和脚步。初次连接、跳步、乱序、断线和换地图不补播旧脚步。**跑酷事件在前端 run 内，不能通过服务端 /state 自动跟随**；本包提供跑酷手动试听及事件映射。

选择眼镜作为系统媒体输出即可尝试播放，E06s 的实际听感和蓝牙延迟仍需佩戴者确认。

## 合并与重建

本 PR 相对 main 仅增加本目录，未修改游戏引擎、语音服务或硬件控制。直接取 assets/ 或整个目录均可；已有 v0.1 的同事更新此目录即可。主游戏接入需按接入说明替换同类合成声，并接真实解说开始 / 结束事件压低环境音。

新增素材仅依赖 numpy，可完全离线重建：

```sh
cd "音效包/Emma0923"
python tools/build_expansion.py
node tools/build_scene_map.mjs
python tools/check_assets.py
node --test tests/*.test.mjs
python -m unittest discover -s tests -p test_soundscape.py -v
```

旧 11 文件从原素材重建时，需要 numpy、ffmpeg；按 sources.json 中带 file 的条目下载原文件并校验，雨声 / 脚步 ZIP 解压为 rain/、steps/，运行 `python tools/build_soundscape.py --sources <目录>`，再执行扩展生成与映射命令。original-procedural 来源是生成器，不是下载项。

/tools/browser-check.html 可无声检查全部 WAV 的浏览器解码。数字检查不代替人耳音质或眼镜实机验收。历史 v0.1 检查保留在 docs/环境音数字检查.json。
