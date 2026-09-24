# 手部力反馈软件 · Emma0924 · v0.6

**v0.7 接入更新**：已实现同账户串口进程锁、同连接单 Guard、固定 legs/hands 角色及关闭后旧回调隔离，并核对重连 USB 身份。`GuardedHandSession` 现在还要求 `link.role == 'hands'`。单套手部不要求第二套外骨骼；详细接线、换用途流程及剩余现场工作见 [DEVICE-MODES-Emma0924.md](DEVICE-MODES-Emma0924.md)。下文 v0.6 的「设备独占待实现」已由此轮补齐合作进程约束，真机身份和物理效果仍待验收。

本轮补齐了可在连接设备前完成的控制代码、独立 Guard 适配、只读姿态采集、三点观测整理及离线验证。未连接或驱动真实设备；现有网页仍是无电机输出的试玩页。v0.6 并不代表“只填三个角度就能上身施力”。

## 已实现的控制流程

`shellos/hands/control.py` 不含设备 I/O。输入是归一化后的左右角度/角速度、原始到达时刻/板端时间、设备身份和本机握持/固定状态；输出是 N·m 单位的力矩提案。

- **抬起**：目标从当前位置开始，按各侧工程配置中的速度向握持位置移动；到达且实际位置稳定后进入保持。跟踪误差过大、无法在期限内稳定会停止。
- **保持**：位置弹簧 + 速度反馈 + 可配置的重力补偿。无积分项，避免暂停后累积误差释放。这里的简化重力模型必须靠实际负载辨识，并非厂家模型。
- **阻尼**：与角速度相反的分量，场景强度限制在 0..1。总输出还包含主动保持/重力/脉冲，因此不把整体控制器宣传为完全被动。
- **双侧游戏脉冲**：左、右或同时触发；正弦包络、独立冷却、事件时效、单调事件编号防重放。主动脉冲方向由实测参数决定，不能从角度方向推断。
- **统一约束**：每侧独立力矩限幅，按真实控制周期计算的 N·m/s 变化率限制，位置边界禁止继续向外施力。故障时立即撤销提案；实际能否保持杆子不掉落由机械支撑方案保证。
- **暂停与故障**：松手、绑带/固定状态不符、急停、数据/握持状态过期、来源变更、重启/倒退时钟、页面之外的本机控制循环停顿均锁止。好数据恢复不自动恢复输出。切场景需重新就位。

角度和速度使用 ShellOS 已归一化的 ° / °每秒；内部控制计算转为弧度。`torque_sign` 相对于 ShellOS 归一化坐标，不是对右侧串口符号再翻一次。真正写串口时仍由现有 `SerialLink.send_torque` 应用右侧线协议符号。

## 真实输出适配的边界

`shellos/hands/bridge.py` 的 `GuardedHandSession` 只能由本机集成进程显式创建，默认拒绝物理输出。它要求：

1. purpose 为 hardware 的完整工程参数，指定设备身份、端口、固件、工程复核记录及失去力矩时的支撑/保持方案；simulation 配置不能使用。
2. 与配置一致且角色为 hands 的设备；串口已由本机操作者完成协议核验与明确使能。
3. 新建专用 Guard，不能与腿部共用 deadman；握持、固定与解绑状态来自可信本机硬件适配器，并保留原始采样时间。

它不自行打开串口、不发送 ENABLE、不自动重连、不提供网页使能入口。所有运动输出仅通过专用 Guard；故障通过 Guard 停止，重新开工需本机核实后新建会话。Guard 的返回值是发出的指令，不是测得的实际力矩。通信异常时不会宣称停机命令已到达。

这个适配器已经使用真实 Guard 类配合假设备测试，但还没有被接入腿部 `shellos.main` 或网页射击按钮；现场目前应先运行只读采集。现有腿部启动入口会自动 ENABLE/恢复，不能直接当作手部启动器。实际硬件启动器、握持传感器适配、设备独占/身份核验和动作事件接线须在确定现场接口后完成。

集成时使用单一控制线程（建议沿用项目 100Hz 控制周期），调用：

```python
sample = sample_from_frame(link.latest(), verified_hand_device_id)
# Interlocks 必须来自已核验的本机握持/固定传感器，保留其采样 at。
session.begin(sample, physical_interlocks, time.monotonic())  # 明确本机动作
session.step(next_sample, next_physical_interlocks, time.monotonic())
session.fire('left', increasing_event_id, event_monotonic_time, time.monotonic())
session.configure_game('excavator', damping=0.6)
```

上述为接线契约，不是能直接复制上身运行的脚本。不得以网页勾选框、SSH 网络心跳或键盘“始终按住”代替真实握持信号。浏览器射击事件只传左右和序号，不能传电机幅度、工程配置或绕开 Guard。

## 设备连上后的只读采集

从仓库根目录运行以下工具。Python 3.10+；采集需要仓库依赖中的 pyserial。只打开明确指定的端口，完全不发送协议命令，不自动抢占/重连；结束时也不发送 DISABLE。若无数据，工具报不足，不尝试 ENABLE。打开 USB 串口本身仍可能影响控制线，因此先按已确认方式支撑杆件，且不要与其他串口进程争用设备。

```powershell
python -m shellos.hands.capture --port COM5 --pose center --seconds 3 --output work/hand-center.json
python -m shellos.hands.capture --port COM5 --pose back --seconds 3 --output work/hand-back.json
python -m shellos.hands.capture --port COM5 --pose forward --seconds 3 --output work/hand-forward.json
python -m shellos.hands.calibration --center work/hand-center.json --back work/hand-back.json --forward work/hand-forward.json --output work/hand-observations.json
```

COM5 是语法示例，必须替换成现场已确认的手部设备端口。每次只采一个位置；不要在同一次稳定采集中来回活动。文件存在时拒绝覆盖。

输出包含 USB 身份（可读时）、原始样本、时间、左右中位数/波动/速度、流中断情况。回退的板端时间会拒绝本次采集，重复帧不计数。合并时核对端口和 USB 身份、姿态标签、稳定性、三点跨度。缺少 USB 序列号时还需现场身份确认；COM 端口名称不是设备唯一身份。

采集和合并结果始终标记 `hardwareOutput:false`、`motorLimits:false`、`hardwareReady:false`。软件生成的硬件配置模板所有待测值均为 null，解析器拒绝运行空模板。不会把舒适行程直接转为电机限位。

## 待现场填入的工程数据

| 项目 | 能否只靠角度采集得到 |
| --- | --- |
| 舒适中位、前后位置、角度变化方向 | 可以观察，不能据此认证机械行程 |
| 固件/设备唯一身份及上下肢角色 | 需设备与线缆核实 |
| 工程角度限位、速度/力矩/变化率限值 | 需厂家/工程师给定并验证 |
| 扭矩正方向、重力负载和控制增益 | 需受控台架辨识，不能从照片或纯角度推算 |
| 实际握持/解绑/固定检测、急停、失力支撑 | 需物理检测接口与机械方案 |

用户已经确认厂家支持手持玩法；这里不再重复询问能否抬杆，而是记录可执行参数和检测接口。

## 离线验证与复验

```powershell
python -m shellos.hands.preview --output work/hand-haptics.html
python -m pytest tests/test_hands_haptics.py tests/test_guard.py tests/test_serial_ports.py -q
```

preview 使用虚拟惯量/负载，输出 HTML 曲线、CSV 和空白硬件参数模板。过程包含抬起稳定、左右单独脉冲、双侧脉冲、场景切换、虚拟手部扰动和过期数据锁止，无任何串口访问。示例参数仅服务这个虚拟模型，不是推荐真机值。模型通过不等于人体佩戴验证。

2026-09-24：本轮 Python 测试 54 项通过，另有 2 个串口发现子测试通过；其中 35 项为新增手部控制、输出门槛、假设备 Guard 集成、只读采集与校准整理测试。原 Node 网页测试另行记录在 VALIDATION.md。
