# assistant_val · 峰哥的助理「Phoenix / 菲尼克斯」模型来源与授权

2026-09-24 球球拍板：助理 NPC 换成《无畏契约》（VALORANT）里的男性角色，选了 **Phoenix（菲尼克斯）**。

## 文件

| 文件 | 内容 | 大小 |
|---|---|---|
| `phoenix_cs.glb` | 角色选择界面版模型（`CS_Phoenix_S0`）：1 个蒙皮网格 5 段共 53,120 三角、248 根骨骼（Riot 自家骨架：Pelvis / Spine1–4 / L_Hip / L_Knee / L_Shoulder / L_Elbow / Head…）、3 段自带动画（`CS_Phoenix_S0_Idle` 13.1 s 角色选择待机、`CS_Phoenix_S0_CharSelect_Intro` 12.9 s 出场、`Idle` = A-pose 定格）。Blender glTF I/O 3.6.28 导出，贴图不内嵌 | 5.9 MB |
| `df.png` | 身体漫反射贴图 2048² RGBA（材质 `CS_Phoenix_S0_Body_MI`） | 3.4 MB |
| `hair_df.png` | 头发漫反射 1024² RGBA（`CS_Phoenix_S0_Hair_MI`） | 0.35 MB |
| `eye_df.png` | 眼睛 512×256（`TP_Core_Eye_MI`，各角色共用） | 0.05 MB |

没下的：`em.png`（自发光）、`orm.png`（AO / 粗糙 / 金属）、`nm.png`（法线）各 2–3 MB——游戏里用 Lambert + 贴图当自发光打底（同 npc_jifeng.js 的做法），用不上。总计 9.7 MB。

## 来源

- 站点：**Kingdom Archives**（https://kingdomarchives.com/models ，VALORANT 粉丝资料库：台词、邮件、终端、模型），模型页 https://kingdomarchives.com/modelviewer/phoenix
- 直链：`https://kingdomarchives.com/uploads/models/agents/phoenix/phoenix_cs.glb`、`…/phoenix/textures/df.png`、`…/phoenix/textures/hair_df.png`、`…/agents/eye_df.png`（无需登录，2026-09-24 09:10 下载）
- 站点页脚原文：*"© 2022-2026 Kingdom Archives. All Rights Reserved. Kingdom Archives was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project."*
- 也就是说：这**不是粉丝自己建的模型，是从游戏里提取的官方资产**（Riot 自家骨架 + 角色选择动画），由粉丝站按 Riot 的 Legal Jibber Jabber 政策（https://www.riotgames.com/en/legal ，允许非商业粉丝项目使用 Riot 素材，须注明 Riot 不为其背书）托管。

## 授权与使用范围

- **角色 IP、模型、贴图、动画均属 Riot Games**。本项目按 Riot「Legal Jibber Jabber」政策的粉丝项目条款使用：非商业、黑客松致敬展示，**不上市、不销售、不收费**。
- 署名：*Phoenix © Riot Games, Inc. VALORANT and Riot Games are trademarks or registered trademarks of Riot Games, Inc. This project isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties.*（Legal Jibber Jabber 要求的声明，展位 / 海报 / 提交材料的素材授权表照抄）
- 同 `models/jett/` 的处理：**模型和贴图不进 git、不上 GitHub**（本目录 `.gitignore`），只由 `deploy.sh` 的 rsync 同步到展位机；仓库里只有本说明和加载代码。
- 我们做的改动：加载时缩放到峰哥身高 × 0.96、脚底落地、转向 +X；材质换成 Lambert（漫反射贴图 + 同一张当自发光打底，夜景看得清）；站着播自带的 `CS_Phoenix_S0_Idle`，走 / 跑用程序化摆腿（骨骼按名字匹配）。文件本身没改。

## 备用

`?npcvrm=AvatarSample_B`（或其它 `models/assistant_q/` 里的 7 个）仍可切回二次元 VRM 版（VRoid 样例条款 / CC0，见 `models/assistant_q/LICENSE.txt`）。
