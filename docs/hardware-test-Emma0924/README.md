# 外骨骼现场测试交接 · Emma0924

2026-09-24。**可以测试网页演练、控制器模拟与历史遥测回放；真实手部行程标定未通过，尚不能启用实机自动抬杆、阻尼或后坐力。** 本轮发布保留当前现场测试基线，不替换同事后续开发。

## 版本与合并

- 本交接分支：`codex/hardware-handoff-Emma0924`，完整源代码以已实测的 `emma0924/upper-limb-improvements` 提交 `8f5a817dab9c576a5aa7046d0fa09888168f6812`（v0.6）为基线。
- 已知同事分支随后更新到 `ec4dec3`（v0.8）。本次交接以独立增量 PR 供其合并，不回退或覆盖该分支，不直接合入 main。
- 本次增量：修复 Windows 相同主机时刻下不同设备帧被误拒的问题；新增便携诊断/离线观察工具、测试、32 份去标识记录及交接说明。`shellos/hands/capture.py` 只放宽相同主机时刻，仍拒绝时间倒退并过滤重复设备帧。
- 同事继续 v0.8 时，应合并交接增量，保留其串口所有权、设备角色和教学流程。不要将 v0.6 整目录覆盖到 v0.8。既有 PR #3 → PR #2 的合并顺序保持不变。

## 当前证据

| 项目 | 已确认 | 尚未确认 |
| --- | --- | --- |
| USB / 串口 | 本机 COM6、CP210x 10C4:EA60、3 Mbps；固件应答 2.9.99.1 | COM6 不是其他电脑的默认端口 |
| 遥测 | 工作态下约 180 Hz，两路角度/速度有响应；右侧已按 ShellOS 归一化 | 通道与实际动作方向的完整标定；角度零点/跨使能参考是否保持 |
| 左杆最后两点 | 起点 −80.460°，上抬标签终点 −78.252°，末 3 秒均稳定 | 差 +2.208°，不足现有 3°软件分辨门槛，与此前方向趋势不一致，不能应用标定 |
| 右杆 | 存在活动记录 | 独立起点和上抬工作终点未完成 |
| 全零 | 持续四项关节全零时提前终止并拒绝标定 | 不能只凭全零判定关机、待机或传感器故障 |
| 控制 | 每次 ENABLE 采集结束均记录 DISABLE 应答与串口关闭；未发送 T 力矩命令 | 无实际力矩回读；没有阻尼、抬杆或穿戴施力验收 |

最后一次实机采集为 `telemetry-10s-20260924-095528.json`，已停用并关闭串口。本次整理、回放和发布不连接设备。

用户后补视频显示杆件相对圆形关节确有明显转动；视频与上述采集不同时，不能拿画面直接对应 2.208°差值，更不能据此断定编码器故障。镜头移动，未做视觉测角或从镜头左右推定设备左右。视频和照片未上传。

## 同事先跑这一版

在仓库根目录运行；Python 3.10+、Node 22+。已有开发环境可直接复用，工具只需 `pyserial`，测试需 `pytest`；完整项目依赖见根 `requirements.txt`。

```powershell
cd EYE-OS-Emma0923
npm test
node server.mjs
```

打开 <http://127.0.0.1:4177/hands.html>，使用页面模拟输入试玩靶场/挖掘机。该网页不自动打开串口或驱动电机。本地 4188 是现场端口设置，不是项目默认值；尚未部署常驻手部遥测桥，历史文件也没有伪装成实时设备数据。

回到仓库根目录，执行离线回归与数据解包：

```powershell
python -m pytest tests/test_hands_haptics.py tools/hardware-test-Emma0924/ -q
python tools/hardware-test-Emma0924/unpack-recordings-Emma0924.py --output work/hardware-test-Emma0924/replay
python tools/hardware-test-Emma0924/prepare-hand-observation-Emma0924.py --source work/hardware-test-Emma0924/replay/telemetry-10s-20260924-095432.json --pose center --output work/hardware-test-Emma0924/center-review.json
python tools/hardware-test-Emma0924/analyze-single-lift-Emma0924.py --source work/hardware-test-Emma0924/replay/telemetry-20s-20260924-094820.json --target left --output work/hardware-test-Emma0924/lift-review.json
```

预期：095432 静态窗口通过稳定性；094820 为 `insufficient`、`direction:null`。这是正确拒绝不充分数据，不是程序故障。所有输出拒绝覆盖，复跑时换新的输出目录/文件名。

## 数据如何使用

`manifest.json` 列出 32 份记录及压缩前后 SHA-256；`recordings/*.json.gz` 包含所有本轮 JSON，解包先校验完整性。已逐份验证 30 个样本数组的数值和时间未变（含连通性记录的 1 个空数组，即 29 个非空数组）；另两份为汇总分析。

- USB 序列号统一替换为 `device-Emma0924-A`，本机绝对来源路径改为解包目录中的文件名。别名只关联这一批记录，不能用于识别真实设备。
- 这是已解析并归一化的遥测，不是串口原始字节。**不得再对右侧取反。** 未插值、缩放、平移角度或改时间。
- `passed` 在早期采集器仅指通信流程通过；新 guarded 版增加全零拒绝，但也不保证整段样本覆盖或完整无间断。必须继续使用离线窗口、时间跨度与间隔校验，不能直接当作标定有效标志。
- `stable:true` 仅表示该窗口稳定；`pose:upper` 是操作者动作标签，不证明方向、行程或机械极限。095528 保留缺少人工用途标记的原始观察，未补写成通过。
- `GUIDED-CALIBRATION.md` 和 `TEST-REPORT.md` 为按轮次保留的历史过程；当前产品意图是逐侧“舒适起点 → 舒适上抬终点”的 0–100% 单方向输入，无需低于起点。既有网页仍为三点输入流程，两点映射工具目前仅离线，尚未接入 UI。

优先复现以下记录：

| 文件后缀 | 用途 / 预期 |
| --- | --- |
| 091734、091836 | 左/右活动历史；另一侧也有变化，不认证隔离或方向 |
| 094820 | 20 秒左杆对照；右侧稳定，目标终点不稳，拒绝确定方向 |
| 095244 | 约 2 秒四项持续全零，提前终止，禁止导出标定 |
| 095432、095528 | 左侧两个稳定点；跨度不足，不能合并成有效输入标定 |

## 现场采集工具的边界

`tools/hardware-test-Emma0924/capture-ten-seconds-guarded-Emma0924.py --help` 只显示说明。运行必须显式提供 `--port`、`--serial`、`--seconds 10|20` 及 `--confirm-off-body-supported-enable`。API 也拒绝缺少参数或确认的调用；没有默认真实设备身份，未配置不访问串口。

此工具只匹配 CP210x 10C4:EA60 和固件 2.9.99.1，设置 DTR/RTS 为 false，发送白名单 PING、VERSION、ENABLE、DISABLE；没有 T 或自动重连。**ENABLE 同时使能电机，不能叫作纯只读采集**。现场必须整机离身、可靠支撑并有可用停机措施；先关闭其他持有串口的程序。诊断脚本是独立工具，尚未接入同事 v0.7 的合作进程锁。错误时尝试停用并记录应答，失去通信不能保证设备停用成功。

两点合并工具 `combine-hand-lift-input-Emma0924.py` 为离线检查：每侧独立起点/终点、同源身份/板时、人工用途标记、稳定性及至少 3°跨度。输出始终禁止硬件就绪/输出，不能把舒适端点转成电机限位。三点 `combine-hand-elevation` 留作旧流程和校验依赖。

下一步先做同步动作标记/角度显示核对，再采左右各自起点、上抬终点和回位重复性。力矩方向、工程限位、增益、负载与物理握持检测需另行台架确认；这批数据不包含这些参数。

## 验证记录

本次工具移植后，74 项假串口/离线工具测试通过。现场版本已有 Node 93 项、Python 手部 40 项通过；发布复核结果另见本目录 `RELEASE-CHECKS.md`。这些是本机验证，不冒充 GitHub CI 或实机力反馈测试。
