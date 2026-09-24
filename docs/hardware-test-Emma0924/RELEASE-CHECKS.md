# 发布复核 · Emma0924 · 2026-09-24

## 纳入同事 v0.8 后的最终复核

- 纳入上肢分支 `ec4dec3` 的 33 个文件更新，README/VALIDATION 两处文档冲突合并保留双方内容；运行代码使用三方合并，保留新增串口锁、角色约束和原主机时间戳修复。未修改同事分支或 main。
- Node 九套 **118/118 通过**，0 失败、0 跳过。
- Python 六组相关回归及交接工具 **171 passed、2 deselected、2 subtests passed**，退出码 0，35.89 秒。覆盖 test_device_ownership、test_hands_haptics、test_guard、test_serial_ports、test_fault、test_app 和 tools/hardware-test-Emma0924；排除两个 stress 用例。
- 独立运行器在收集测试前及每例中拒绝真实 Serial.open / Serial / 端口枚举。测试内使用 mock；跨进程测试仅操作 COM655xx 模拟锁。tmp_path 使用工作区新目录，未更改测试断言。
- 原始 32 份归档未在代码合并中修改。现场采集仍来自 v0.6，不声称已在 v0.8 重新连接或驱动设备；没有覆盖整个 aima 的所有测试或实机力反馈。

## 初始现场基线及分发包复核

- Node 页面、服务与输入回归：**93/93 通过**。使用 `node --test --test-isolation=none` 执行 package.json 中的七份测试文件，未运行真机桥接。
- Python 手部控制/采集及交接工具回归：**114/114 通过**（已有手部 40 + 交接工具 74）。真实串口构造和枚举均由验证运行器拦截，测试按需替换为假设备。
- 首次普通 pytest 执行 113 通过、1 个临时目录 fixture 权限错误；本机 Windows sandbox 无法读取 pytest 私有临时目录。复核运行器将 tmp_path 改为仓库 work/ 下的新目录，未修改测试断言，114 项全部通过。普通开发机可按 README 的 pytest 命令复跑。
- 32 份共享记录压缩前后 SHA-256 校验并解包通过；原始记录中存在 samples 的 30 份，已逐一验证样本数组完全不变。仅序列号、来源路径及新增分发用途说明有变化。
- 对解包后的 095432 回放得到 544 帧稳定末窗、左中位 −80.460°；094820 回放得到 insufficient / direction:null；095244 全零样本被稳定姿态导出器拒绝。
- 采集器无参数及 --help 不枚举/连接设备；缺少明确设备身份或离身支撑确认的 API 调用被测试验证为拒绝。
- 本轮未打开串口，没有发送 ENABLE、DISABLE 或力矩命令；最后一次硬件停用状态来自 095528 原记录。没有重新宣称当前物理设备状态。
- 此阶段尚未运行 v0.8 合并后回归；该结果已由上方最终复核补充。所有本机结果不代表 GitHub CI 或真实力反馈验收。
