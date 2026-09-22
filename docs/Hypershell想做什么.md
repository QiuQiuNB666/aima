# Hypershell 想做什么、技术愿景是什么

> 2026-09-22 两路调研合并（公司层面 + 技术口径）。每条结论后有来源 URL；标「查不到」「推断」的照实标。
> 用途：让作品对上出题方的口味，避开他们的雷。

## 一句话

极壳把外骨骼定义为**「增强人、不替代人」的具身 AI 载体**，正押注三件事：端到端运动意图模型（HyperIntuition）、用户运动数据、AI 随行伙伴 Shelly。他们的叙事在「识别当下动作」，**个性化和记忆是空的**——这就是我们的位置：站在他们算法上面做「只属于这个人的先验」。

## 对我们作品的直接指引

**这样说对口**
- 引他原话：「外骨骼是人与物理世界的可编程接口」——我们的 Agent 是这个接口上的第一个居民
- 「增强人不是替代人」：Agent 学的是这个人的意图和偏好，不是代替他走
- 数据驱动闭环：串口采数据 → 在线学 → 力矩下发，呼应他说的「难点是找有效数据、在设备端跑」
- 「即感即动」「human-in-the-loop」「个性化」——他们 Halo 的 HyperIntuition 2.0 自己就在讲这些词，我们说自己是它上面的记忆层 / 应用层
- 主动讲安全限幅和急停——他最怕「产品力差的竞品毁掉品类」
- 展位一句话：**「你们的端到端识别的是动作，我们在它上面加了一个只属于这个人的先验——把 0.31 秒的猜，变成 0 步的记得。」**

**这样说踩雷**
- 定位成医疗器械 / 康复设备（孙宽明确说先占户外「酷」的心智，不走医疗）→ 步态体检那一层要说成「运动表现 / 个人步态签名」，临床指标只当内部依据，别写在海报上
- 「你们的自适应不准所以我重写控制律」（22 N·m 的硬件你只有 7.5 Nm，也打不过）
- 只读数据不下发动作（03 赛道评分明写「产生实际动作」，01 赛道也要「真动起来」）
- 硬编码脚本冒充 Agent
- 做上肢 / 工业搬运（他们公开表示不做）
- 提那篇 arXiv 安全论文（他们回复不接受漏洞报告）

---

## 公司层面（调研原文）

**结论**：极壳把外骨骼定义为"增强人、不替代人"的具身 AI 载体，正押注"端到端运动意图模型 + 用户数据 + AI 随行伙伴 Shelly"三件事。作品讲成"Agent 读懂人的意图、随人一起变强、在真机上产生动作"最对口；讲成医疗康复或"我的规则比你算法准"最踩雷。

**1. 基本面**
- 创始人孙宽（Kelvin Sun，1991 年生，前 LattePanda 创始人，机器人公司产品经理出身）；联合创始人 Penn Yu（余志鹏）。2021 年 4 月成立于上海，深圳设办公室，团队近 200 人、研发占比 >70%。https://news.pedaily.cn/202605/563982.shtml
- 融资：奇绩创坛天使 → Pre-A（IDG、红杉等）→ 2025-11 Pre-B+B 共 7000 万美元（光合创投、五源领投，估值近 4 亿美元）→ 2026-05 B+ 5000 万美元（蚂蚁、美团龙珠领投），B 系列合计 1.2 亿美元。https://www.dealstreetasia.com/stories/hypershell-raises-funding-464836
- 出货：2025 年全球 >3 万台，累计数万台，覆盖 70+ 国，欧美贡献主要营收；2023 Kickstarter 123 万美元、2638 backers。100+ 专利。https://www.geekpark.net/news/370150 · https://finance.sina.com.cn/stock/hkstock/hkzmt/2025-11-27/doc-infyvhsi0953755.shtml

**2. 创始人近一年原话**
- "人形机器人的终极目标是取代人，外骨骼的目标是在各种场景下增强人"；外骨骼是具身 AI 的载体；引"具身认知"：终态是用户"觉得眼前的山变矮了"而不是"走路省力"；算法要从"分段规则"进化到"即感即动"。（IF 2026 演讲）https://www.geekpark.net/news/358191
- "外骨骼本质上是人与物理世界的'可编程接口'"；"当人形机器人追求替代人类时，我们选择增强人类"。https://news.pedaily.cn/202605/563982.shtml
- "预测人的运动意图是行业最难的问题……唯一思路是通过大量运动数据训练 AI"；已准备"为这个品类持续努力 20 年"。https://news.qq.com/rain/a/20251201A08U7I00
- 2026-09 专访："和自动驾驶从 Rule Based 到数据驱动的演变一样"；难点是"怎么找到有效数据、怎么在设备端跑这套逻辑"；"我们的使命不是成为第一品牌，是让人变得更自由"；"外骨骼的终局是一个大众品类"；"能不能把产品做到像鞋子一样小"；最担心"产品力非常差"的竞品拉低品类。https://news.qq.com/rain/a/20260910A0BEJD00
- "外骨骼是人和物理世界的介质，可输入、可编程、可数字化"，"物理层面的增强现实"；上肢"动作维度太多难标准化"暂不做。https://www.ifanr.com/1632901
- 成为"第二层皮肤"还需 10–20 年。https://finance.biggo.com/news/WgXXPZ4B6tLPsnrZh5eE

**3. 产品路线**
- 2026-05 新 X 系列（Pro S/Max S/Ultra S）：HyperIntuition "端到端运动控制"，宣称 97.5% 步态同步、TÜV 认证；孙宽："超越传统 rule-based 建模"。https://www.prnewswire.com/news-releases/worlds-most-intuitive-exoskeleton-hypershell-introduces-the-new-hypershell-x-series-302777466.html
- 2026-09 IFA 发布 Halo 全腿（髋膝四关节，2.6 kg）：HyperIntuition 2.0 = MoE 网络、30+ 传感器、提前 ~200 ms 预判、2500 Hz 调整、"human-in-the-loop 强化学习"逐步个性化、1 万小时运动数据。https://hypershell.tech/blogs/media-center/hypershell-halo-flagship-full-leg-exoskeleton-built-for-all-terrain-mobility
- Shelly：自称"消费级外骨骼首个 AI 随行伙伴"，语音/文本控设备、记忆偏好、健康建议，仅新 X 系列公测；**页面未提任何开发者/API**。https://hypershell.cn/pages/hypershell-shelly
- 公开渠道无 SDK/开放平台；黑客松串口协议是唯一开发入口。

**4. 专利与招聘**
- 专利：只有"100+ 专利、Omega 单电机全球专利、AI MotionEngine"的宣传口径，具体专利号/名称公开检索未命中（Google Patents 按公司名无结果），查不到。
- 招聘（猎聘）：深圳在招"高级电机控制算法工程师"，上海"高级运动控制算法工程师 40–70k"，深圳"强化学习算法工程师"（已暂停）——投入在电机控制 + RL。https://www.liepin.com/company/21135601/

**5. 与黑客松的关系**
- 03 赛道评分专属维度含"真实系统连接度（Ghost 登陆义体——与真实硬件/外骨骼连接并产生实际动作）"（本地 官方材料摘录.md，源自选手指南 https://autogame.feishu.cn/docx/PTZsdDoymoZ7a3x3v6pcBLQInZe）。
- 为何出 Agent 赛道：合理推断是他们正做 Shelly（Agent）+ 端到端意图模型，想看 Agent 层如何驱动/理解人体，而非再造硬件。这是推断，官方没说。
- **曾泓炳：三轮中英文检索零命中，无演讲/论文/领英，查不到。**

**6. 表述建议**
对口说法：
- "外骨骼是人与物理世界的可编程接口，我们的 Agent 是接口上的第一个'居民'"——直接引他原话。
- "增强人不是替代人"：Agent 学的是这个人的意图，不是代替他走。
- 数据驱动：现场采串口数据 → 小模型在线学 → 力矩下发形成闭环，呼应"找有效数据、在设备端跑"。
- 强调"即感即动"、个性化、"human-in-the-loop"，称自己是在 HyperIntuition 之上的应用层/记忆层，不是替代品。
- 安全限幅、急停主动讲——他最怕"产品力差"毁品类。
踩雷：
- 定位成医疗器械/康复设备（孙宽明确说先占户外"酷"心智而非医疗）。
- 说"他们的自适应算法不准所以我重写控制"。
- 只读数据不下发动作（评分维度要求"产生实际动作"）。
- 硬编码脚本冒充 Agent（通用维度明列为不足档）。
- 做上肢/搬运工业方向（他们公开表示不做）。

---

## 技术口径（调研原文）

**结论**：Hypershell 的公开口径是「端到端 AI 意图识别 + 自动场景切换」，但用户端实际抱怨集中在**误判与切换迟滞**（平地当下坡、换模式要 2–3 步）。他们的叙事在"识别当下动作"，你的空档在"记住这个人"——站到他们算法**上面**做个性化层，不要替代控制律。

**1. 官方算法口径**
- 名称：一代叫 **AI MotionEngine**，X Ultra/S 系列改叫 **HyperIntuition™ (E2E)** / MotionEngine Ultra，创始人孙宽明说从 rule-based 转向"采集大量姿势运动数据训练端到端模型"，难点是"设备端跑得动"。https://www.gm7.org/archives/154660
- 传感器：仅说"12 个传感器：加速度计、气压计、陀螺仪、多个温度传感器"（引 WIRED）；**未公开 IMU 数量/位置，无足底压力**。https://hypershell.tech/en-us/pages/hypershell-x-ultra-exoskeleton
- 时延口径混乱：X 页写"0.03 s 意图识别 + 2 ms 响应"；新 S 系列页写"HyperIntuition 0.31 秒 / 97.5% 人机同步率"，未定义 0.31 s 指什么（推测是模式切换识别时间，与用户"2–3 步"体感吻合，但官网未说）。https://hypershell.tech/en-us/pages/hypershell-x-exoskeleton https://hypershell.tech/pages/new-hypershell-x-series-exoskeleton
- 模式：Max S 10 种（上/下楼、上/下坡、走、竞走、跑、骑、山地、碎石），Ultra 12 种加 Snow/Dune。"Adaptive Mode"自动识别，可关掉手动锁定；Hyper/Eco/Transparent 强度只能 App 切。https://support.hypershell.tech/en-US/how-do-i-switch-between-different-sports-modes-on-the-device-1228124
- "越用越懂你"：仅一句"adapts to your stride signature"营销语，无机制说明。

**2. 硬件（官方+arXiv）**
- Max S：M-One Ultra 双电机，峰值 1000 W，**峰值扭矩 22 N·m×2**，净重 1.7 kg，72 Wh 电池；一代 Carbon 标"32 N·m 最大持续扭矩/800 W"。持续扭矩 S 系列未公布。（你固件的 ±7.5 Nm 是黑客松限幅）
- arXiv 2603.08665 §3.2：**ESP32 主板 + 两块 STM32 电机控制器走 CAN**；BLE 走 **Nordic UART Service**，反编译 App 枚举 177 条命令（含 SET_MOTOR_CUSTOM / SET_MODE / SET_RESPONSE_SPEED），OTA 仅 CRC16；Hypershell 回复不接受漏洞报告。论文未分类命令、未给帧格式。https://arxiv.org/abs/2603.08665

**3. 用户批评（你的抓手）**
- DIYPS（Pro X 长期使用者）：自适应换模式需 **2–3 步**，楼梯平台处"僵腿踮脚"；**平地被识别成下坡**突然给阻力，最终关掉自适应只用手动 walk。https://diyps.org/2025/08/23/a-powered-exoskeleton-is-an-instrument-of-freedom-my-experience-with-the-hypershell-pro-x/
- TechRadar 跑步：误切 Transparent 险些摔倒；突遇下坡"像被抛向地面"（搜索摘要，原文被墙）。
- 爱范儿 Pro X：25% 助力爬 135 m 耗电 40%，腰部明显发热，不能边充边用。https://www.ifanr.com/1620966
- 官方 SGS：上坡 VO₂ −20.47%、心率 −21.60%，11 人样本；平路仅 −8.9% 卡路里。https://hypershell.tech/zh/pages/exoskeleton-101-effectiveness
- 身高适配、上下楼准确率：**未查到量化数据**。

**4. 固件方向** v1.4.2：温控降功率、低速稳定控制、设备锁、多用户、触觉反馈；**无学习/数据上传/新识别功能**。https://support.hypershell.tech/en-US/hypershell-firmware-update-%7C-v142-1267803

**5. 学术关系**：**查不到**任何高校合著论文或引用具体控制方法（DOFB/相位振荡器/模仿学习均无）。仅 2025-12 自发白皮书（SGS 测 VO₂/EMG）和中科院西北院青藏科考设备赞助。https://hypershell.tech/pages/exoskeleton-industry-standards

**6. 定位建议**：站**上面**。他们已有端到端"当下动作识别"，你不该重做控制律（22 N·m 硬件你只有 7.5 Nm，也打不过）。做**用户先验层**：用 200 Hz 髋角/腰 IMU 记录这个人的步态签名，学习"他的平地长什么样"，把误判率和 2–3 步切换迟滞压下去，并把参数（下坡阻力、响应速度）作为可继承的"经验"。
展位一句话：**"你们的 E2E 识别的是动作，我们在它上面加了一个只属于这个人的先验——把 0.31 秒的猜，变成 0 步的记得。"**
