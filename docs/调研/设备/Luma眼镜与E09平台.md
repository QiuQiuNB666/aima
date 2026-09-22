# Luma眼镜与E09平台

> 2026-09-22 调研 · 结论后附来源

## 结论先行

1. **metastable-lab 基本是个「壳」：** GitHub org 2025-07 建，公开仓库只有 luma-core（2026-09-07 建，2 次 commit，0 issue/PR/release，1 star）。唯一贡献者 k-moonblade（Seattle，简历是 NEAR/Polkadot/x402 等 Web3 项目，非硬件背景）。查不到官网、产品页、售价、与 EvoMap/深圳黑客松的公开关联。
   - https://github.com/metastable-lab/luma-core ｜ https://github.com/k-moonblade
   - Cargo.toml 自述："Sans-IO reverse-engineered BLE wire protocol for **E09 / Watchfun-platform** smart glasses"——即第三方逆向，不是原厂 SDK。

2. **E09 是深圳白牌 ODM 通货，不是 BES/Actions 那种芯片平台名：**
   - FCC ID **2BF3Z-E09**，申请人 Shenzhen Taiyang Technology Co., Ltd（fccid.io 被 CF 拦截，仅搜索摘要可见；同 grantee 有 E03 眼镜、H5 手表、S01 睡眠眼罩）https://fccid.io/2BF3Z-E09/Test-Report/CTA26052501203-Test-Report-2-4G-WIFI-N20-9389944 ｜ https://fccid.io/2BF3Z-H5
   - "Watchfun" = Shenzhen Watch Fun Internet Technology（App 方案商，Play 上 10 款耳机/手表 App，无眼镜 App）https://play.google.com/store/apps/developer?id=Shenzhen+Watch+Fun+Internet+Technology+Co.%2C+Ltd
   - 公开硬件参数（E09c 批发页，未经独立核实）：8MP 摄像头、1080P30 视频、300 mAh、双扬声器 AAC0820、64 GB、双频 Wi-Fi 4、**无显示屏**、$26.5–32.5/副；麦克风数、重量、SoC 未标 https://newlove521.en.made-in-china.com/product/kzxRObtGqrhY/China-Lightweight-E09c-Smart-Glasses-Deliver-Smooth-Wireless-Audio-Experience.html
   - **11 KB 小图分辨率无任何公开数据**。别猜，抓一张后读 JPEG SOF0：`python3 -c "from PIL import Image;print(Image.open('look.jpg').size)"`。

3. **同款贴牌：** 零售名就叫 **"Luma"**（All-in-One AI Electrochromic），唤醒词 **"Hi Luma"**，8MP/1080P30/8 GB/300 mAh/双频 Wi-Fi 4，$49.99–54.98。与 SDK 完全吻合，即用户手里这副大概率就是这款贴牌。
   - https://kydschoice.com/products/luma-all-in-one-ai-electrochromic-smart-glasses ｜ https://www.lumaneoglass.shop/ ｜ https://www.aimiracle.ai/ai-news/luma-ai-glasses/（该文明确指出「无人独立验证过任何参数」）
   - 配套 App "Luma View"（Play，50+ 下载，2025-12-17 更新，开发者匿名）https://play.google.com/store/apps/details?id=com.lumaview.app
   - **中文唤醒、Wi-Fi 热点稳定性、BLE MTU 的社区经验：查不到**（无 Reddit/论坛讨论）。可用数据仅 SDK 自己写的：BLE 图片分块 496 B、SSID 前缀 `DH-TwI-`、AP 起来后等 2 s 再连、连不上要重试。

4. **luma-core 仓库无任何坑记录**——0 issue、0 PR、2 commit、无 release。固件兼容性只有 PROTOCOL.md 头部那一行「verified against bt 1.4.8/isp 1.3.1/hw 2」。

5. **macOS 终端蓝牙权限：**
   - 路径：系统设置 → 隐私与安全性 → 蓝牙 → `+` 加 Terminal/iTerm（用 VS Code 内置终端就加 VS Code）。权限挂在**终端宿主 App**上，不是 python/cargo 二进制。btleplug README 与 bleak 文档一致 https://github.com/deviceplug/btleplug/blob/master/README.md ｜ https://bleak.readthedocs.io/en/latest/troubleshooting.html
   - 扫不到的常见原因：①宿主未授权（bleak 报 `BleakBluetoothNotAvailableError` 或 "Bluetooth device is turned off"，其实是 unauthorized）https://github.com/hbldh/bleak/discussions/1016 ；②sudo 运行；③macOS 12.0–12.2 必须传 `service_uuids`（12.3 修复，13 上仍建议按 `AA12` 过滤）https://bleak.readthedocs.io/en/latest/backends/macos.html ；④CoreBluetooth 不给 MAC，只给本机随机 UUID，别拿 MAC 匹配；⑤被动扫描不支持。

**查不到/被拦：** Alibaba、fccid.io、fcc.report、TVCMall、Amazon 全部反爬 403，FCC 内部照片与说明书（可能含 SoC、麦克风数）无法读取。