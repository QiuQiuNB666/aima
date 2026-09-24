# EYE OS · Emma0923 合并说明

## 同事从这里开始：推荐合并路径

先审阅 [PR #3：上肢、可选单/双套与穿戴教学](https://github.com/QiuQiuNB666/aima/pull/3)，合入 `codex/eye-os-Emma0924`；再审阅 [PR #2：Emma 控制台进入主项目](https://github.com/QiuQiuNB666/aima/pull/2)，合入 `main`。先合 #3 后，#2 会自动包含本次完整代码，无需重复复制文件或再挑选一次提交。

```text
emma0924/upper-limb-improvements -- PR #3 --> codex/eye-os-Emma0924 -- PR #2 --> main
```

两份 PR 当前均保留草稿，尚未执行合并。远程实机校准数据未回传，不在当前交付内；后续单独追加带来源和用途说明的数据/校准提交。页面演练、只读检查和软件力反馈内核可先评审，硬件启动与力反馈实测状态仍以验证记录为准。

### 审阅范围与不能漏掉的依赖

| 范围 | 在哪里看 | 合并选择 |
| --- | --- | --- |
| 穿戴流程、双杆画面、操作教学 | `EYE-OS-Emma0923/` | 保持整个目录的 HTML、脚本、服务、缓存及测试版本一致 |
| 手部力反馈计算、姿态采集 | `shellos/hands/` | 与下列公共保护改动配套审阅；未开放网页电机输出 |
| 设备身份和输出所有权 | `shellos/device/ownership.py`、`serial_link.py`、`shellos/safety/guard.py`、`shellos/ui/server.py` | 不能省略：负责串口独占、Guard 互斥、固定角色与状态声明 |
| 对应回归测试 | `tests/test_device_ownership.py`、`test_hands_haptics.py`、`test_serial_ports.py` 及网页 `*.test.mjs` | 随实现一起合并 |

如同事必须挑选提交，应在已包含 `86974dc` 的 Emma 基线上按顺序使用下表。推荐直接通过 PR 合并，避免重复引入提交。`5726a8d` 不是可直接贴进任意旧版本的独立补丁。

| 顺序 | 提交 | 内容 | 依赖 |
| --- | --- | --- | --- |
| 1 | `6f711f0` | v0.5 双杆输入和独立游戏 | Emma 基线 `86974dc` |
| 2 | `8f5a817` | v0.6 手部力反馈内核与采集 | 上一项 |
| 3 | `d432055` | v0.7 单套/双套配置及控制隔离 | 前两项 |
| 4 | `5726a8d` | v0.8 穿戴自查与每款游戏教学 | 前三项 |

本节之后的版本记录仅用于追溯，历史文件数量和测试计数不是当前交付数量。当前目录为 50 个文件；当前 Node 全套为 118 项。

### 2026-09-24 合并检查

- GitHub PR #3 显示 `MERGEABLE / CLEAN`，目标确为 Emma 分支；没有修改 `main` 或实际执行合并。
- 获取最新 `main` 的 `67e6783`，用 `git merge-tree --write-tree` 对完整开发分支 `5726a8d` 做虚拟合并：无文本冲突。生成的合并树为 `885b11111feb8e49bfbeaada8f10118beae8edbd`。虚拟合并不改工作区、分支或运行中的硬件。
- 主分支相对共同基线已新增 83 个提交；双方涉及的公共文件中，主分支也修改了 `shellos/ui/server.py`。虚拟合并保留了主分支新功能与本分支 `link.role` 字段。
- 从该合并树导出隔离的源代码和场景配置后，Node **118/118** 通过，Python 相关回归 **92 passed、2 subtests passed、2 deselected**（排除无关 stress）通过，均未连接真机。不是整个主项目所有测试或完整双设备端到端验收。
- PR 文件清单没有新增录音、现场校准数据、虚拟环境、密钥配置、ZIP、海报或本机日志。GitHub 尚无自动 CI 检查结果；本地测试记录不能标为 GitHub CI 通过。

### 合并后复验（不接外骨骼）

在仓库根目录执行 Python 假设备/回放回归，在网页目录执行 Node 全套：

```text
python -m pytest tests/test_device_ownership.py tests/test_hands_haptics.py tests/test_guard.py tests/test_serial_ports.py tests/test_fault.py tests/test_app.py -q -k "not stress"
cd EYE-OS-Emma0923
npm test
```

网页需要 Node 22+，Python 依赖见仓库 `requirements.txt`。预览执行 `node server.mjs` 并打开 `http://127.0.0.1:4177/hands.html`；这不会启动 ShellOS 或打开串口。真机数据返回后继续在同一个 PR/Emma 分支追加，重新获取目标分支并检查差异，勿把本次无冲突结果视作永久保证。

## v0.8 当前增量：穿戴准备与每款游戏的操作教学

本目录现为 50 个文件。新增 `wear-core.js`、`tutorial-core.js`、两份对应测试及 [接入说明](WEAR-AND-TUTORIAL-Emma0924.md)。一起带入页面、控制器、只读 reader、服务、缓存清单和版本信息；Service Worker 为 v8。本轮相对 `d432055` 只改本目录，没有修改或运行硬件控制代码。

共用穿戴流程按单套腿部、单套双手、双套分别展示 5 / 6 / 11 项。设备检查只查询所选角色的固定本机 `/state`，不打开串口。本人自查和新鲜连接数据只解锁画面演练，不授予真实动作权限。穿戴检测传感器仍未接入。

当前已接入互动教学的游戏为本页靶场与挖掘机；原腿部游戏只提供穿戴引导及返回设备页入口，尚未改写其游戏入口。伙伴给其他游戏接入时，复用穿戴生命周期，再注册各自教学动作与判定，不能把教学完成用作硬件启动条件。Node 九套 118 项通过；本次没有重跑未改动的 Python 硬件测试，历史结果见下文。

## v0.7 增量：单套 / 双套与控制隔离（历史）

当前 `EYE-OS-Emma0923/` 为 45 个文件。新增 [DEVICE-MODES-Emma0924.md](DEVICE-MODES-Emma0924.md) 描述单套腿部、单套双手和双套配置；页面切换会清空旧输入与校准，后端只读取所选角色。双套 HTTP 服务端口和上报实体串口必须不同，手部服务必须声明 `link.role: hands`。

本轮涉及公共硬件代码：新增 `shellos/device/ownership.py` 和 `tests/test_device_ownership.py`；修改 SerialLink 的端口独占/角色/重连、Guard 的互斥/关闭生命周期、`shellos/ui/server.py` 的角色字段，以及手部 bridge/capture。请与 v0.6 手部模块一起合并，不要只取网页。原腿部主入口保持 legs 角色，手部不能借用腿部自动 ENABLE 路径。

Node 100 项通过；Python 核心 66 项 + 原腿部故障与 App 回归 26 项通过，另有 2 子测试通过、2 无关 stress 测试排除。全程仅假串口/回放，没有真机输出。合并包是覆盖文件集合，仍需基于现有 aima 仓库审阅，优先使用 PR diff。

下文 v0.3–v0.6 为历史增量记录，旧版「未改 Guard / SerialLink」不适用于 v0.7。

本交付标记为 **Emma0923**，用于区分眼镜伴随控制台与伙伴的外骨骼／游戏工程。它是独立网页应用，不是眼镜固件，也不是 EYEVUE 官方操作系统。

交付目标是现有仓库 **`QiuQiuNB666/aima`** 的 **`EYE-OS-Emma0923/`** 子目录，不另建仓库。通过独立审阅分支和 PR 提交，供伙伴逐项评估；模块仍可在该子目录执行 `node server.mjs` 独立运行。是否进入主分支以 PR 的合并状态为准。

**v0.3 已实现**：在 v0.2 的通用外接屏适配与游戏窗口共享基础上，新增 ShellOS `/state` 只读桥接和 USB / 服务 / 遥测三层界面。见 [外骨骼指南](EXOSKELETON-Emma0923.md) 与 [自动适配说明](DISPLAY-ADAPTER-Emma0923.md)。游戏事件总线、声音联动和显示眼镜真机链路仍待接入或验收。

**已于 2026-09-24 核对 `QiuQiuNB666/aima` 主分支基线 `c4f465b8e3d7afd400ebfaafccfebb251c9f63b2`。** 本模块共 39 个文件，供团队独立审阅。仓库中另有 Windows `find_port` 窄改动及 8 项 mock 测试；只调整串口发现，不改变 Guard、控制循环或运动指令行为。

## v0.6 增量

新增仓库根目录 `shellos/hands/` 与 `tests/test_hands_haptics.py`。新增代码和 `EYE-OS-Emma0923/HAPTICS-Emma0924.md` 需一起审阅；未改写既有串口、Guard、腿部启动入口或腿部游戏。`EYE-OS-Emma0923/` 现为 44 个文件。

独立 Python 控制内核产生力矩提案，显式本机 Guard 适配器可供后续台架接线；默认没有真实输出入口，网页仍只读。只读 capture 工具不调用普通 SerialLink 的握手、恢复或退出 DISABLE。现场接口/工程参数未核实前，不创建物理输出会话。见 [力反馈开发与校准说明](HAPTICS-Emma0924.md)。

## v0.5 增量

从 `codex/eye-os-Emma0924` 的 `86974dc` 继续完善双杆模块；保留 Emma0923 目录名。新增 `hands-input.js`、`hands-reader.js` 和对应输入/页面测试；修改原双手内核、控制器、页面、服务与缓存清单。仅本目录有改动，不涉及 ShellOS 控制代码。

只读手部数据源必须通过独立 `SHELLOS_HANDS_PORT` 配置；不能把普通腿部控制器直接用作上肢控制器。两台设备实际身份绑定及力反馈执行仍待实现。前端可先复用三点归一化输入与左右枪/挖掘机逻辑，详见 [双杆说明](HANDS-MODE-Emma0923.md)。Service Worker 升级 v5，部署时一起更新两个新增前端文件。七套自动测试共 93 项通过。

## v0.4 增量（历史）

新增独立浏览器双手模式模拟器，详见 [HANDS-MODE-Emma0923.md](HANDS-MODE-Emma0923.md)。没有真机动作端点，没有修改 ShellOS/Guard；与 v0.3 只读设备面板并存。新增文件均带入本目录，Service Worker 升级 v4。

## 已核对的 ShellOS 对接位置

| 现有工程 | 与本模块的关系 |
| --- | --- |
| Python `shellos/main.py`、`shellos/safety/guard.py` | 继续负责设备、控制循环和唯一串口写入口；本模块不发送外骨骼指令 |
| `shellos/ui/server.py`、Three.js `shellos/ui/static/game/` | 游戏页面为 `/game`，另有 `/worlds`、`/parkour`；默认服务端口 8765。EYE OS 在独立端口 4177 运行，用户可在浏览器共享选择器中选取已打开的游戏窗口 |
| `GET /state` | EYE OS 后端固定读取 `http://127.0.0.1:<SHELLOS_PORT>/state`（默认 8765），只映射允许的 link/frame/gait/safety 字段；浏览器从同源 `/api/exoskeleton` 读取。上游不可由页面传入，不跟随重定向，不透传 wearer/events/shots |
| `/voice/last.wav` 与游戏语音脚本 | 已有游戏解说音频；后续应约定由哪个页面播放，避免与控制台 TTS 同时播报。EYE OS 当前仍是独立试听与预设导览 |
| `shellos/glasses/luma.py` | 现有实现调用外部 `luma` 程序。仓库调研针对 Luma / E09；这里使用的 E06-003B / S30301 尚未验证协议兼容，不将两者当作同一设备，也不调用该接口拍照或查电量 |

两个页面可以分别运行：ShellOS 提供设备连接与游戏，EYE OS 已提供只读遥测、声音工具及用户授权的画面共享。共享画面走视频连接；蓝牙仍用于设备支持的音频或控制能力。下一步是场景/讲解事件适配与同源页面整合。`window.EyeDisplay` 接收流要求已打开同源输出窗口；`/api/exoskeleton` 负责独立的状态读取。

## 可以先独立运行或复用

| 范围 | 当前内容 | 合并时注意 |
| --- | --- | --- |
| 响应式前端 | 概览、声音实验室、本地资料库、设备能力页 | 原生 HTML/CSS/JavaScript；先保留独立子目录或页面。`app.js` 绑定本页 DOM，不是可直接导入的 SDK |
| 浏览器音频 | 提示音、麦克风选择、电平、录音、回听 | 需要浏览器支持与用户授权；浏览器默认音源／输出不保证是眼镜 |
| 本地媒体 | 手动导入、预览、下载、删除、IndexedDB 保存 | 数据留在当前浏览器；没有上传接口。数据库名目前固定为 `eyeos-media`，同源整合时检查命名和迁移 |
| 系统 TTS | 文字朗读、语音选择、语速、暂停／停止 | 使用系统语音，不是 AI 对话或翻译；声音和后台行为需真机验证 |
| 示例体验 | 三段预设声音旅行导览、本地运动计时 | 不含真实地图、定位、运动传感器或外骨骼控制 |
| 外骨骼状态 | 固定本机 ShellOS `/state` 白名单映射与设备页三层状态 | USB 枚举、服务在线、新鲜遥测分别判断；模拟/回放不得显示为真机 |
| PWA 外壳 | 应用清单、静态资源离线缓存 | 合并时限定 Service Worker 子路径和作用域；更新 `sw.js` 的版本，保留 `/api` 不缓存的规则 |

## Windows 本地调试桥接

`server.mjs` 与 `bridge/` 用于电脑本机音频端点、显示几何与 CP210x USB 只读查询，以及用户主动发起的 E06 测试音。ShellOS 状态读取由 Node 固定回环 GET 完成，不打开串口。默认只监听 `127.0.0.1:4177`；保留 Host/Origin 边界、请求限制和播放并发锁。不要把这些接口直接部署成公网硬件服务。

已实现接口为 `GET /api/health`、`GET /api/device`、`POST /api/audio/test`、`GET /api/displays` 与 `GET /api/exoskeleton`。见 [README.md](README.md) 及两份专门指南。端点 Active、API 完成和本人听到声音不可互相替代；同样，CP210x 枚举成功也不代表有效真机帧。本机最近一次枚举未发现 CP210x，硬件遥测尚未验收。

手机方案可以只部署静态前端到 HTTPS，音频由手机系统与已配对眼镜处理；不需要把 Windows 桥接迁到手机。具体 iPhone／Android 蓝牙输入、锁屏及后台行为仍需验证。

## 仍待接入

| 依赖 | 当前状态 |
| --- | --- |
| 厂商 SDK／协议 | 拍照、录像、眼镜媒体同步、电量、按键、固件配置仅有能力说明入口；未发送设备控制命令。先确认该型号能力和厂商授权接口 |
| AI／语音服务 | 对话、识物、语音识别、实时翻译未接入；系统 TTS 不能替代这些服务 |
| Google Maps／街景 | 没有 API 调用、地图画面或实时定位；目前导览文本为预设示例 |
| 云端多人 | 未实现登录、房间、在线相遇、语音聊天或云同步 |
| aima 游戏事件 | 已实现 ShellOS 只读状态适配；到达景点、暂停、训练结束等事件及声音联动仍待接入 |
| 显示眼镜真机 | 已实现用户授权的窗口共享；真实游戏视频到带屏眼镜的完整链路尚未验收 |

## 建议合并边界

1. 伙伴的游戏与外骨骼系统继续提供运动、方向和场景状态；本控制台已消费只读遥测，声音提示和会话事件待接入。急停、阻力限制、电机指令继续留在原系统。
2. 优先接通“到达景点 → 播放一段预设讲解”，再扩展暂停和训练结束提示。建议事件包含 `schemaVersion`、`eventId`、`sessionId`、`type`、`timestamp`、`payload`；这只是提案，当前代码没有事件订阅器。
3. 例如 `scene.poi.entered` 的 `payload` 可包含 `poiId`、`narrationText`、`locale`。消费端应去重、忽略旧会话，允许用户停止和静音，并与录音／试听互斥。旅行场景坐标不能当作用户真实位置。
4. 基于已确认的 ShellOS / Three.js 结构，再把 TTS、媒体存储和设备状态从 `app.js` 中抽成适配模块；不要直接把全局 DOM 脚本挂到伙伴的主页面。

## 文件映射

| 文件 | 用途／合并选择 |
| --- | --- |
| `index.html` | 页面结构及产品文案；独立页面入口 |
| `styles.css`、`app.css` | 两个文件均被页面加载；保留顺序，整合时检查全局样式冲突 |
| `app.js` | 前端状态、界面交互、录音、媒体、系统 TTS、预设导览及计时 |
| `icon.svg`、`manifest.webmanifest`、`sw.js` | 静态图标、PWA 元数据及离线缓存；按目标部署路径调整 |
| `server.mjs` | 无第三方依赖的 Node 本地服务、状态归一化和受限桥接 API |
| `exoskeleton-core.mjs` | 固定回环上游、超时/体积边界、USB 与上游缓存、白名单遥测映射 |
| `exoskeleton-controller.js` | 设备页只读轮询、三层状态、模拟/回放标识、暂停与过期处理 |
| `bridge/Get-GlassesAudioState.ps1` | Windows CoreAudio 只读端点快照 |
| `bridge/Test-GlassesAudio.ps1` | Windows WinMM 音频枚举、指定设备测试播放；开发调试用 |
| `bridge/Get-DisplayState.ps1` | Windows 只读显示器几何枚举 |
| `bridge/Get-ExoskeletonState.ps1` | 只枚举 Present CP210x VID 10C4 / PID EA60，不打开串口 |
| `backend.test.mjs` | 使用模拟适配器验证服务与隔离边界；不会播放真实音频 |
| `exoskeleton.test.mjs`、`exoskeleton-ui.test.mjs` | 模拟上游与前端生命周期测试，不驱动真实电机 |
| `display-*.js`、`display.html`、`display.css`、`display.test.mjs` | 用户授权的屏幕选择、共享、输出和自动化测试 |
| `package.json`、`Start-EYE-OS.cmd` | Node 启动／测试元数据、Windows 启动入口 |
| `README.md` | 运行、功能边界、手机部署与已实现 API 说明 |
| `EXOSKELETON-Emma0923.md` | 运行拓扑、状态契约、模式/新鲜度规则和故障定位 |
| `VALIDATION.md` | 已完成验证及手机／硬件／人工待验收清单 |

验证基线见 [VALIDATION.md](VALIDATION.md)。后端测试通过与响应式预览通过，均不等于手机蓝牙兼容、真实录音、稳定耳端播放或 aima 合并验收通过。
