# v0.2 验证记录 · 2026-09-24

代码 / 地图依据 main 9832875。验证在独立工作目录完成，未修改正在运行的主游戏或连接任何外骨骼。

## 已完成

- 37 个 WAV 全部通过 SHA-256、48 kHz / 16-bit / 双声道格式检查；26 个新文件来自本包确定性生成器，11 个旧文件保持原字节。
- 数字峰值均低于 -3 dBFS；循环接缝在检查阈值内，单次音首尾淡入淡出，没有检测到严重单声道抵消。详见 audio-qa-20260924.json。
- Node：9 个状态与映射测试通过，覆盖停步、等待、重复 / 乱序、重连、珠峰材质覆盖、华山木板、66 段映射与运行时规则一致性。
- Python：5 个素材、来源、场景快照及只读代理测试通过。
- 内嵌浏览器的 OfflineAudioContext：37 / 37 成功解码；双声道 / 采样率 / 时长均匹配。
- 试听页在总音量 0% 下验证 AudioContext running：横梯 → everest_glacier + step_metal；刀脊 → everest_ridge；华山栈道 → step_wood。
- 排队路段点击走一步显示“脚步暂停”；跑酷显示前端事件接入说明，服务端跟随按钮禁用。
- 素材下拉包含 37 项，parkour_land 下载链接与文件说明正确；停止后循环源归零。浏览器没有 error / warn 日志。

## 尚未验收

本轮浏览器播放管线测试保持静音；没有进行人耳音色评价，也未在 E06s 或其他眼镜上确认实际发声、响度舒适度或蓝牙延迟。主游戏事件接入仍由合并方按 SCENE-MAP.json 和接入说明完成；本轮没有宣称事件已在主游戏自动播放。

## 复现

在音效包目录运行：

```sh
node --test tests/*.test.mjs
python -m unittest discover -s tests -p test_soundscape.py -v
python tools/check_assets.py
python tools/serve_soundscape.py --port 8890
```

最后打开 http://127.0.0.1:8890/tools/browser-check.html ，点击“检查全部音频”。无需 Google Key、眼镜 SDK、麦克风或外骨骼。
