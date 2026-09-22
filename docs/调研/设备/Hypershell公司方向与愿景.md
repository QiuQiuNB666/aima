# Hypershell 公司方向与愿景

> 2026-09-22 调研 · 结论后附来源

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