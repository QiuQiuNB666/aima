# 音频包主线合并报告 · 2026-09-24

本次将环境音包 v0.2 合并到 main：37 个 WAV、8 套声景、8 条路线、66 个路段映射，以及播放器、独立试听台、来源说明和测试。音频专项验证通过，可供同事同步使用。

## 合并范围

- 主线基准：`7d05a93dfc45325725a22c03c6112a7d06b10852`。
- 音频源提交：`0a362c88455fffb22bfc367c34930b28ba57fb65`，本地分支 `emma0924/scene-audio-update`。
- 保留旧音频分支历史，使用正常双亲 merge；自动合并无冲突。
- 相对主线仅新增 `音效包/Emma0923/`。游戏、语音服务、硬件控制、根目录测试和依赖文件均没有改动。
- 本次是包入库；`mainGameAutoIntegrated` 仍为 false。主游戏自动触发、解说事件联动及跑酷事件接线尚未完成。其他功能包不在本次范围内。

## 合并后验证

| 检查 | 结果 |
| --- | --- |
| Node 状态与地图映射测试 | 9 / 9 通过 |
| Python 素材、来源、场景与代理测试 | 5 / 5 通过 |
| 文件 SHA-256、格式、时长 | 37 / 37 通过，48 kHz / 16-bit / 双声道 |
| 电平、循环接缝、单声道抵消、单次音首尾 | 37 / 37 通过，见 audio-qa-20260924.json |
| Edge 无头浏览器实际播放器 | 37 个 WAV 解码成功，8 套声景通过，页面错误 0 |
| 训练场 / 停止 | 默认训练场数字输出为 0；停止后数字输出为 0 |
| 解说压低 | 环境增益约 0.22，效果增益约 0.45 |
| 主线代码差异 / 冲突 | 主线代码无改动；冲突 0 |

浏览器在合并工作区独立 HTTP 服务上运行，数字输出数据见 [MERGE-BROWSER-20260924.json](MERGE-BROWSER-20260924.json)。这是播放管线验证，不代表人耳听感或眼镜实机验收。

## 主线回归的已知问题

全量 `pytest -q` 首轮结果：130 passed、9 failed、1 skipped。Windows 默认 GBK 导致其中 5 项失败；设置 `PYTHONUTF8=1` 后重跑这 9 项，结果为 5 passed、4 failed。

剩余 4 项在独立、未经音频合并的原主线 `7d05a93` 上逐项复现，失败一致：

1. `tests/test_gait.py::test_gamepad_nudge_and_cycle`：DOFC 控制律下测试读取不存在的 `tl` 参数，报 KeyError。
2. `tests/test_swarm.py::test_fengge_speaks_on_summit_and_red_offline`：等待后峰哥事件仍为空。
3. `tests/test_swarm.py::test_fengge_talks_on_new_segment_with_global_gap`：等待后峰哥事件仍为空。
4. `tests/test_fault.py::test_stress_stack_end_to_end`：干净检出缺少 `data/recordings/synthetic-walk.csv`，回放子进程 FileNotFoundError。

这些失败不是本次音频包引入；本次不修改它们。项目全量测试仍不能标记为全绿。

## 同事同步与验证

主线工作区没有未提交改动时：

```sh
git fetch origin
git switch main
git pull --ff-only origin main
```

在自己的功能分支继续开发时，保存现有工作后：

```sh
git fetch origin
git merge origin/main
```

仅需要素材时取 `音效包/Emma0923/assets/`，同时保留 `manifest.json`、`CREDITS.md`。需要播放器和试听台时取整个包。

```sh
cd "音效包/Emma0923"
node --test tests/soundscape-state.test.mjs
python -m unittest discover -s tests -p test_soundscape.py -v
python tools/check_assets.py
python tools/serve_soundscape.py --port 8890
```

检查素材电平的脚本需要 numpy；试听服务器仅依赖 Python 标准库。在浏览器打开 `http://127.0.0.1:8890/` 并点击启用声音；无声解码检查入口为 `/tools/browser-check.html`。Windows 跑主线 Python 测试时建议设置 `PYTHONUTF8=1`。

主游戏接线参见 [接入与远程测试.md](接入与远程测试.md)。待验收包括真实游戏事件联动、现有合成声音替换与叠播检查，以及眼镜实际发声、听感、蓝牙延迟。
