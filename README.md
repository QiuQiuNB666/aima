# aima

EvoTavern 进化酒馆黑客松 · 深圳站（2026-09-21~24）· 01 具身与穿戴硬件赛道。

## ShellOS：外骨骼主机端控制栈

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/pytest -q                                   # 安全层 + DOFC 单元测试

# 第一次插上外骨骼（开机、进入工作态、插 Type-C）
.venv/bin/python scripts/probe.py                     # PING → VERSION → ENABLE → 看 3 秒数据 → DISABLE
.venv/bin/python scripts/probe.py --torque 0.5        # 再发 0.5 Nm 两秒，记下正值是伸展还是屈曲

# 跑控制栈（手柄 USB 直连；按住 R2 才有力，× 急停，○ 重新上膛；键盘：空格 / Esc / R）
.venv/bin/python -m shellos.main --ctl transparent    # 先透明模式，只录数据
.venv/bin/python -m shellos.main --ctl dofc --cap 2   # DOFC 助力，软限 2 Nm

# 没设备：对着录制数据跑
.venv/bin/python -m shellos.main --replay data/recordings/synthetic-walk.csv --ctl dofc --force-deadman
```

已做：设备层（串口 / 回放 / 录制）、安全层（软限、斜率限、扳机死人开关、看门狗、退出必 DISABLE）、透明 + DOFC 控制律、手柄与键盘输入。
没做：步态估计、相位控制律、网页仪表盘、经验库与大模型改参、EvoMap。分层与建法见 [docs/架构.md](docs/架构.md)。

**真机第一次跑要确认的**：`probe.py` 报 200 Hz 左右；`--torque 0.5` 时力的方向（正值 = 伸展还是屈曲，决定 DOFC 的 gain 取正还是负）；手柄在 pygame 里 R2 是不是 axis 5（不是就改 `shellos/input/gamepad.py` 顶部常量）。

## 资料

| 想干什么 | 读这个 |
|---|---|
| **ShellOS 控制栈架构：分层、线程、安全层、44 h 建法** | [docs/架构.md](docs/架构.md) |
| **Hypershell 想做什么、怎么说对口、什么踩雷** | [docs/Hypershell想做什么.md](docs/Hypershell想做什么.md) |
| **外骨骼能往哪做：六个方向 + 建议组合** | [docs/外骨骼开发方向.md](docs/外骨骼开发方向.md) |
| **8 件设备各能做什么、怎么接** | [docs/技术可行清单.md](docs/技术可行清单.md) |
| 外骨骼串口协议全文、眼镜 SDK、云台手机、手柄、Seeed 小件 | [docs/已领设备-资料对照.md](docs/已领设备-资料对照.md) |
| 评分表、时间线、设备清单、奖项 | [docs/官方材料摘录.md](docs/官方材料摘录.md) |
| 7 分钟内怎么演出「它学会了」 | [docs/调研/闭环学习怎么演.md](docs/调研/闭环学习怎么演.md) |
| 外骨骼控制律与调参依据 | [docs/调研/设备/外骨骼步态相位与助力调参.md](docs/调研/设备/外骨骼步态相位与助力调参.md) |
| 视觉 + 外骨骼先例、临床步态指标 | [docs/调研/设备/视觉+外骨骼先例与步态指标.md](docs/调研/设备/视觉+外骨骼先例与步态指标.md) |
| Luma 眼镜出身与 macOS 蓝牙权限 | [docs/调研/设备/Luma眼镜与E09平台.md](docs/调研/设备/Luma眼镜与E09平台.md) |
| 手柄、麦阵、小屏、灯阵接口细节 | [docs/调研/设备/手柄与Seeed小件接口核实.md](docs/调研/设备/手柄与Seeed小件接口核实.md) |

## 硬节点

- 9/24 11:00 作品封板（官网提交：项目介绍、GitHub 仓库、成员、赛道）
- 9/24 13:00–16:00 游园评审，每位评委约 7 分钟（4 介绍 + 3 问答），至少 3 位评委打分
- 每晚 20:00–08:00 主场馆不进不出

## 读的时候记住

- 标了「估计」「未核实」「没验证」的都没核过，用之前要核
- 外骨骼力矩加在人身上：从 1 Nm 起试，扳机松手即 `DISABLE`
