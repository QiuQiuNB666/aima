# static/models/cyber/ — 来源与许可

东京攻壳致敬版（`game/themes/cyber_night/models.js`）用的开源模型。2026-09-24 从 Poly Pizza 下载，球球在 M2 对话框里同意下载。
glb 原文件没改；加载时做了合并几何、转顶点色、换颜色、缩放和摆放（见下面每条的改动说明）。

## MechQuadruped — CC BY 3.0（需要署名）

- 文件：`mech_quadruped.glb`（3,215,544 字节，59,644 个三角面）
- 作者：**3Donimus**
- 来源：https://poly.pizza/m/5x1hRpbmdfo
- 许可：Creative Commons Attribution 3.0 Unported（CC BY 3.0）— https://creativecommons.org/licenses/by/3.0/
- 署名："MechQuadruped" by 3Donimus (https://poly.pizza/m/5x1hRpbmdfo), licensed under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/).
- 改动：运行时把 11 个材质的网格合并成 2 块顶点色几何（橙色件 / 半透明件改成自发光），放大 1.25 倍，做成神社参道两侧的一对「电子狛犬」。原作者没有为本作品背书。

## Quaternius — Cyberpunk Game Kit — CC0 1.0（公有领域）

- 作者：**Quaternius**（https://quaternius.com/packs/cyberpunkgamekit.html），从 Poly Pizza 的套件镜像下载：https://poly.pizza/bundle/Cyberpunk-Game-Kit-Hkfxa8K8zF
- 许可：CC0 1.0 Universal Public Domain Dedication — https://creativecommons.org/publicdomain/zero/1.0/（不需要署名，这里照样注明来源）

| 文件 | 套件里的名字 | Poly Pizza 页面 | 字节 | 用在哪 / 改动 |
|---|---|---|---|---|
| `drone.glb` | Robot Enemy Flying | https://poly.pizza/m/lF3jeRJwiH | 298,324 | 街道上空的 2 架巡逻无人机；外壳改成枪灰色，眼睛改成红色自发光，播放模型自带的 Idle 动画 |
| `signs.glb` | Cyberpunk Signs | https://poly.pizza/m/rsZJjigt1X | 402,680 | 拆成单块招牌，平贴在临街楼面上（模型自带的贴图没改） |
| `ac_stacked.glb` | Ac Stacked | https://poly.pizza/m/vzpyRsDOP1 | 31,756 | 楼面空调外机（缩放 0.6，按楼染深浅） |
| `ac.glb` | Air Conditioner | https://poly.pizza/m/0MdE89Ijtt | 32,568 | 楼面空调外机（并排两台，缩放 0.44，按楼染深浅） |
| `antenna.glb` | Antenna | https://poly.pizza/m/l5Oc9swvKk | 6,452 | 屋顶天线（重新着色成灰色） |
| `cable_long.glb` | Cable Long | https://poly.pizza/m/WNfAG8VSD5 | 15,912 | 从楼顶垂下来的电缆束（重新着色成近黑色） |

合计 4,003,236 字节（约 3.8 MB）。

## 没用的

- Sketchfab「CC0 - Neon Sign Open」（plaggy）：要登录 Sketchfab 才能下载，没下。接口显示的许可是「CC Attribution」，跟标题里的 CC0 对不上。
