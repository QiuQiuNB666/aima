# Hypershell技术栈与算法口径

> 2026-09-22 调研 · 结论后附来源

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