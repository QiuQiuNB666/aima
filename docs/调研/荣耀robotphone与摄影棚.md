**结论：别把主线押在 robotphone 上，把它当加分彩蛋。** 它开放的是荣耀语音助手 YOYO 的"技能"工具，不是 Android SDK，而且没有数据回传；3 台样机几百人抢。

**1. robotphone 是什么、开放了什么**
- 就是荣耀 Robot Phone：2026-08-12 发布，8-18 开售，9999 元起，钛合金云台，最高转速 360°/s。现场 3 台"样机"是什么固件版本，没查到。
- 你给的文档标题是「智能体服务-技能开放能力」，讲的是 YOYO 技能平台。环境要求 MagicOS 10.0+、YOYO 智能体 90.10.32.025+。
- 开发形态是一个技能包：SKILL.md 加 scripts、references、assets 三个文件夹，在基本信息里声明 Allowed tools（最多 20 个）。不涉及 Android Studio 工程。
- 云台相关工具：
  - `basicGimbal`：`actionType` 取 查询/打开/关闭/回前置/回后置/停止，`target` 取 云台/滑盖。
  - `operateGimbal`：三轴转动用 `angle` int[3]（[roll,pitch,yaw]，0–180°）加 `speed` int[3]（0–180°/s）；拟人化动作 `emotionType` 取 点头/摇头/打瞌睡/翻跟头。
  - `generateGimbal`：`taskQuery` 传一句自然语言，由大模型生成轨迹并执行。
  - `gimbal_operate`：含 `recognitionTarget` 参数（边转边识别），**仅实时视频通话模式可用**。
  - `face_expression`：同样仅视频通话模式可用。
- 其他工具：`camera`（打开系统相机/切模式）、`gui_task_create`（UI Agent 操控 App，部分机型）、`ble_send_command`（BLE 文本指令）。
- 能读到的只有云台/滑盖状态查询。IMU、画面帧、跟随坐标的读取接口，没查到；独立的跟随 API，没查到。
- 示例：官方打样技能 gimbal-skill（文档只讲了工具调度链路，没看到下载入口或源码）、云台运镜案例（用 `game_launcher`、`gui_task_create`、`camera`、`gimbal_operate`）。
- 权限：在开放平台创建技能后，先做安全检测，再把测试账号（手机号/邮箱/UDID）加进测试名单，就能真机测试，不用过审。发布上架才需要官方人工审核。

**2. 72 小时里多久能动起来**
- 账号和测试名单顺利的话，参照 gimbal-skill 的调度结构自己写 SKILL.md，约 2–4 小时能让它"摇头/转 30°"。
- 卡点：
  - 入口是对 YOYO 说自然语言。"我自己的 Agent 用 HTTP 或 ADB 直接驱动云台"的路径，没查到。A2A 智能体接入指南我没读，scripts 文件夹能做什么，读过的页面没说明。
  - 测试名单绑定荣耀账号，3 台共享机要来回切账号。
  - 最灵活的 `gimbal_operate` 和表情工具只能在视频通话模式下用。
  - Livehouse 噪声大，会影响触发。我假设触发靠语音；文档只写"自然语言指令"，没区分语音和文字。
  - 没有任何数据回传，视觉闭环得另外想办法。

**3. 摄影棚（Robotic-Arm Data Collection Box）**
- 是一个可折叠的固定环境采集箱：80.5×64×70 cm（±0.5），420D 镀银反光布加铁架，内置 20W 高显色 LED（≥2000 lm、5600K）和固定相机支架，$59，有货。
- 解决的问题：光照、相机位、物体位全部固定，采好的数据集和 ACT / SmolVLA / GR00T 这类策略换场地也能复用。
- 对 Livehouse 的帮助：把现场多变的灯光挡在箱外，箱内采集、箱内推理，策略才稳定。它只管箱内，机械臂面向舞台或人群的视觉它帮不上。
- 能装哪种臂：商品页没有兼容臂清单，没查到。按尺寸推断（这是我的推断，不是官方说法），SO-ARM100/101 这类桌面臂能放下，更大的臂放不下。

**4. 判断：高风险，不宜做主线**
- 3 台机对几百人，排队和切账号就会吃掉调试时间，答辩时也不一定拿得到机器。
- 能力边界窄：只有云台姿态、少量预设动作和表情，读不到数据，亮点容易和其他队撞车。
- 依赖荣耀账号、测试名单和 YOYO 版本，现场出问题不是自己能修的。
- 建议：主线用手头可控的硬件做；留出约 4 小时，用 SKILL.md 给 robotphone 做一个拟人反应的彩蛋，拿不到机器也不影响主演示。

Sources:
- https://developer.honor.com/cn/doc/guides/101776
- https://developer.honor.com/cn/doc/guides/101775
- https://developer.honor.com/cn/doc/guides/101785
- https://developer.honor.com/cn/doc/guides/101784
- https://www.seeedstudio.com/Robotic-Arm-Data-Collection-Box-p-6943.html
- https://m.ithome.com/html/988961.htm
- https://www.ithome.com/0/924/856.htm
- 开售日期（8-18）只来自搜索摘要，原文未打开：https://digi.china.com/digi/20260818/202608181943226.html

工具情况：Exa 和 Firecrawl 首次调用就限频，已停用；荣耀文档站是 SPA，WebFetch 读不到内容，最后用内置浏览器读出来的。