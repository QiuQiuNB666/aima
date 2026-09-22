# 荣耀 Robot Phone：adb 摸底（2026-09-22 19:30）

只做了只读查询（getprop / pm / service list / dumpsys / query-services），没有调用任何服务、没有反编译、没有改设置。

## 设备

| 项 | 值 |
|---|---|
| 型号 | APH-AN00，营销名「荣耀Robot Phone」 |
| 系统 | MagicOS 10.0.0，Android 16（SDK 36），版本号 10.0.0.112(C00E110R201P4) |
| 构建 | user（量产版），ro.debuggable=0，不可 root |
| 云台 | `msc.gimbal.supported = 1` |
| 序列号 | ABSS016525000007 |

满足官方「YOYO 技能」文档要求的 MagicOS 10.0+。YOYO 智能体的具体版本没查。

## 和云台/机器人相关的系统组件

| 组件 | 类型 | 说明 |
|---|---|---|
| `GimbalProvider` | 系统 binder 服务，接口 `com.hihonor.gimbal.IGimbalProvider` | 云台的系统级服务 |
| `vendor.honor.hardware.camera.gimbal.IGimbalCfgSvr/default` | 厂商 HAL | 云台配置 |
| `vendor.honor.hardware.motion.IMotion/default` | 厂商 HAL | 运动 |
| `com.honor.robotservice`（v100.1.1.065） | 系统应用 | 暴露 `RobotService`，action `com.honor.robotservice.BIND_ROBOT_SERVICE` |
| `com.hihonor.motionservice`、`com.hihonor.visionengine`、`com.honor.yoyocards`、`com.hihonor.assistant` | 系统应用 | 运动服务、视觉引擎、YOYO 相关 |

## 关键发现

**`RobotService` 是 `exported=true`、`permission=null`**：任何装在这台手机上的普通 App，都能用 `BIND_ROBOT_SERVICE` 绑定它。这是一条不经过 YOYO、从自己的 App 直接驱动机器人能力的潜在路径。

**但接口没有公开文档**：它的 AIDL 方法（能调什么、参数是什么）我们不知道。要知道只有两条路：
1. 问荣耀现场工程师有没有这个服务的接口文档 / 示例（首选）
2. 反编译系统 APK 读接口——属于对厂商私有软件的逆向，**没征得同意前不做**

## 建议

- 明天去荣耀 / Seeed 展位问：「`com.honor.robotservice.RobotService` 有没有给开发者的 AIDL 或 SDK？黑客松样机能不能用？」
- 问不到就回到官方路径：YOYO 技能包（SKILL.md + `operateGimbal` 等工具），需要开放平台账号和测试名单
- 手机不能带走，所以这条线只能在现场推进；优先级仍低于外骨骼

## 复现命令

```bash
adb shell getprop | grep -i gimbal
adb shell service list | grep -i -E "gimbal|robot|motion"
adb shell cmd package query-services -a com.honor.robotservice.BIND_ROBOT_SERVICE
```
