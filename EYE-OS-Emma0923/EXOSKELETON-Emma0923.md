# EYE OS · Emma0923 · 外骨骼只读接入 v0.3

本模块读取同机 ShellOS 的状态，在设备页分开呈现 USB、服务、遥测三层证据。它不创建串口连接，不使能外骨骼，也不发送运动、阻力或急停命令。设备连接和控制继续由 ShellOS 及其 Guard 负责。

2026-09-24 核对的 aima 主分支基线为 `c4f465b8e3d7afd400ebfaafccfebb251c9f63b2`。本机 CP210x 只读枚举已执行，结果为查询成功、设备列表为空；这不构成真机已连接的证据。模拟测试和浏览器演示记录见 [VALIDATION.md](VALIDATION.md)。

## 运行

需要 Node.js 22 或以上，无需 npm 依赖。ShellOS 与 EYE OS 是两个进程，须运行在同一台电脑：

```text
设备页 → GET /api/exoskeleton → GET http://127.0.0.1:8765/state
                           ↘ Windows 只读 CP210x presence 枚举
```

1. 按 aima 自身的运行说明启动 ShellOS。真机、模拟或回放由 ShellOS 配置，本控制台不会替你启动设备。
2. 在 `EYE-OS-Emma0923/` 运行 `node server.mjs`，打开 `http://127.0.0.1:4177`。
3. 进入设备页，点击“开始读取”；每秒查询一次。“刷新”可单次检查状态，“暂停读取”仅停止网页查询，不改变设备运行状态。
4. 离开设备页会暂停读取；浏览器标签隐藏、离线或页面离开时挂起或取消请求。过期值隐藏，模拟和回放明确标记来源。

若 ShellOS 使用其他本机端口，在启动 EYE OS 前配置：

```powershell
$env:SHELLOS_PORT = '8766'
$env:PORT = '4177'
node server.mjs
```

`SHELLOS_PORT` 仅接受 1024–65535 的十进制端口；默认 8765。目标主机固定为 `127.0.0.1`，路径固定为 `/state`，不支持远程 URL 或页面查询参数。Mac/Linux 可读取同机 ShellOS，但 Windows USB 枚举返回 `supported:false`；合法的 COM、Linux tty、Mac cu/tty USB 串口可识别为硬件来源。

手机或 HTTPS 静态站点没有此本机接口时，应显示桥接不可用。手机的 `localhost` 不是电脑，不要为此移除回环或来源限制。静态站点应包含 `exoskeleton-controller.js`；完整文件清单见 [README](README.md)。

## 三层状态与新鲜度

| 层 | 成功表示什么 | 不代表什么 |
| --- | --- | --- |
| `usb.available` | Windows present 设备查询成功；`devices.length > 0` 才是发现 CP210x | 串口已打开、设备已使能或已有有效帧 |
| `shellos.reachable` / `valid` | 本机服务作出响应 / 响应符合已知状态结构 | 真机连接或正在运动 |
| `telemetry.fresh` 与 `mode` | 有效帧仍新鲜，并单独标记 hardware / simulation / replay / unknown | 佩戴安全已经验收或控制台具备运动控制能力 |

模式依据 ShellOS 的 `sim.on` 和 `link.port` 判断：`sim` 为模拟，`replay` 为回放，明确串口配合非模拟标记为硬件；字段矛盾或无法确认时为 `unknown`。USB 是否枚举到设备不参与把模拟升级为真机的判断。

`fresh` 要求左右角度帧有效、计算后帧龄不超过 200ms、上游 `t` 距本机当前时间不超过 2 秒且未超前 1 秒。帧龄计入 HTTP 传输和缓存经过时间；零角度是有效值，缺失字段保留 `null`。前端核验 checkedAt 和 sourceTime，将服务端到浏览器的传输耗时计入收到时帧龄，超过 200ms 的响应不作为新鲜采样；还要求当前处于读取状态、服务有效且上次有效响应没有超过 2.5 秒；暂停、错误或过期时不继续展示旧数值为实时值。

USB 缓存 5 秒，上游缓存 500ms，同类并发请求合并。首次查询先等待 USB（原生查询最多 6 秒），随后获取上游，避免 USB 慢读使首帧失效；后续 USB 在后台刷新，不阻塞遥测。上游单次总超时 1.2 秒、响应最多 64KiB，不跟随重定向，只接受未压缩 JSON。首次请求可能花费数秒。

## API 契约

`GET /api/exoskeleton` 无请求体、无查询参数。成功处理查询返回 HTTP 200；设备或上游不可用属于响应中的状态，不伪装为连接成功。拒绝外来 Host/Origin、跨站请求及写方法；响应 `Cache-Control: no-store`，Service Worker 不缓存 `/api`。

顶层结构：

```json
{
  "available": true,
  "checkedAt": "2026-09-24T06:00:00.000Z",
  "usb": { "supported": true, "available": true, "devices": [], "error": null },
  "shellos": { "reachable": false, "valid": false, "mode": "unknown", "error": "UPSTREAM_UNAVAILABLE" },
  "telemetry": null
}
```

此例用于说明“USB 查询成功但未发现设备、上游不可用”，不是固化的实时结果。顶层 `available:true` 只表示本 API 完成状态汇总。

| 字段 | 类型 / 含义 |
| --- | --- |
| `checkedAt` | ISO 时间，本次汇总完成时间 |
| `usb.supported` / `available` | 布尔；平台支持 / 枚举成功 |
| `usb.devices[]` | `{name, port, status, problemCode}`；固定 CP210x 名称、COM 端口或 null、状态、问题码或 null |
| `usb.error` | null、`UNSUPPORTED_PLATFORM` 或 `USB_STATE_UNAVAILABLE` |
| `shellos.reachable` / `valid` | 布尔；收到 HTTP 响应 / 有效 ShellOS 状态 |
| `shellos.mode` | `hardware`、`simulation`、`replay` 或 `unknown` |
| `shellos.error` | null 或下表固定错误码，不包含原生异常详情 |
| `telemetry` | 上游不可用或无效时为 null；有效状态但尚无帧时仍可包含安全状态，`fresh:false` |
| `telemetry.receivedAt` / `sourceTime` | 本地收到上游的 ISO 时间 / ShellOS `t` Unix 秒 |
| `telemetry.fresh` / `frameAgeMs` | 布尔 / 当前计算帧龄毫秒或 null |
| `telemetry.port` / `enabled` | 已识别串口名或 null / 设备上报的布尔或 null |
| `telemetry.angles` | `{left,right}`，度；对应 `frame.l/r`，未知为 null |
| `telemetry.angularVelocity` | `{left,right}`，度/秒；对应 `frame.ldps/rdps` |
| `telemetry.cadence` / `moving` | 步/分或 null / 布尔或 null；对应 `gait.cadence/moving` |
| `telemetry.safety` | `{state,reason,deadman,torqueLeft,torqueRight,softCap}`；对应 `safety.state/reason/deadman/sent[0]/sent[1]/cap` |

安全状态与原因均为字符串或 null；reason 最多 200 字、单行，不透传多行异常栈。其余 safety 数值未知为 null，左右力矩与 softCap 单位为 N·m。所有测量保留 ShellOS 原值，不在桥接中推算动作或调整命令。`enabled:true` 是上报状态，不是本控制台发出的动作。

只暴露上述字段，不透传 wearer、events、shots、原始数据、设备序列号、PnP instanceId 或 MAC。USB 内部只用 VID `10C4` / PID `EA60` 筛选当前 present 设备；不会把历史设备或蓝牙 COM 当作 CP210x。

## 排查

| 状态 / 错误 | 检查方向 |
| --- | --- |
| USB 查询成功但 devices 为空 | 检查 USB 线、供电、驱动；不能据此断言 ShellOS 没在模拟或回放 |
| `USB_STATE_UNAVAILABLE` | Windows PnP/CIM 或 PowerShell 不可读；失败与“无设备”分开显示 |
| `UPSTREAM_UNAVAILABLE` / `UPSTREAM_TIMEOUT` | ShellOS 是否在同机目标端口运行、是否能及时响应 |
| `JSON_REQUIRED` / `INVALID_JSON` / `INVALID_STATE` | 目标可能是别的服务，或 ShellOS 状态结构不兼容 |
| `REDIRECT_REJECTED` / `UPSTREAM_HTTP_ERROR` | 上游必须直接以 HTTP 200 返回 `/state` JSON |
| `RESPONSE_TOO_LARGE` / `ENCODING_UNSUPPORTED` | 上游响应超过 64KiB 或压缩，不会继续处理 |
| 服务可达但无有效帧、帧过期 | 检查 ShellOS 设备连接与采样状态；旧帧不会因 USB 存在而恢复“实时” |

“暂停读取”不是急停。需要控制设备时应使用原 ShellOS/硬件的既有入口；本模块没有控制替代路径。

## 测试与待验收

运行 `npm test`，覆盖原音频/显示、固定上游边界、无效/超大/重定向/超时响应、离线与模式、新鲜度、慢 USB 缓存、前端暂停和过期生命周期。测试不操作真实电机或音频。受限环境可以在 Node 测试命令中加入 `--test-isolation=none`。

配套 aima 变更只涉及 Windows `find_port` 发现逻辑及 8 项 mock 测试；Guard 和运动指令行为保持原样。真机连续遥测、断连恢复、游戏事件与声音联动、游戏画面到显示眼镜、云端地图和多人仍需分别验证或实现，不能由模拟通过推断完成。
