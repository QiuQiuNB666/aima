#!/bin/bash
# 完整介绍视频（约 3 min 20 s，1080p30 H.264 + AAC）：复用 scripts/cut_demo.sh 的函数（seg / card_seg / final / png），只换镜头表。
#   scripts/cut_intro.sh            # → $MAT/intro_3min.mp4 + intro_3min_720p.mp4，同时拷到 docs/提交/视频素材/
#   FORCE=1 scripts/cut_intro.sh    # 重建本片新增的 I* / J* 片段（R02 / R03 / R04 / R09 / R10 / R13 / R07L / R08 沿用 v3 已建片段）
# 旁白：vo/n01–n16（峰哥克隆声，scratchpad/intro_vo_lines.txt → gen_vo.sh）+ v3 的 00 / 02b / 02 / 03 / 03b / 05 / 06a / 06c / 06d / 07a–c / 08 / 11 / 11b。
# 华山 / 泰山 / 富士没有连拍（开发机 swiftshader 0.1 fps 抓不动），用 docs/提交/截图 静帧 Ken Burns。
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source "$ROOT/scripts/cut_demo.sh" lib
OUT=$MAT/intro_3min.mp4

# stack_seg <id> <秒> <标题> <副题> <行…> <高亮行> <旁白>：分层架构卡
stack_seg() {
  local id=$1 s=$2; echo "$s" > "$B/meta/$id.dur"; echo "$7" > "$B/meta/$id.vo"; : > "$B/meta/$id.sync"
  if [ -s "$B/seg/$id.mp4" ] && [ -z "${FORCE:-}" ]; then echo "  = ${id}（已有）"; return; fi
  echo "  > $id 分层图"; png stack "$B/cap/$id.png" "$3" "$4" "$5" "$6"; cardv "$B/cap/$id.png" "$s" "$B/src/$id.mp4"
  ffmpeg -y -v error -i "$B/src/$id.mp4" -vf "fade=t=in:d=$FADE,fade=t=out:st=$(python3 -c "print(max(0,$s-$FADE))"):d=$FADE" "${ENC[@]}" "$B/seg/$id.mp4"
}
at() { python3 -c "print($1)"; }

echo "== 片段（完整介绍版）"
png badge "$B/cap/tag.png" "峰哥 · AI 复刻音色 · 本人授权" tr
png badge "$B/cap/wm.png"  "模拟外骨骼演示" br
# ① 定位
card_seg J00 3 "峰哥亡命天涯" "屏幕上的坡，真变成腿上的力" "消费级髋外骨骼 × 自研控制软件 ShellOS × 大模型蜂群 · 团队 PRX" - ""
seg I01 5.5 "VR 只有视觉反馈 · 我们做腿上的物理反馈" "峰哥：VR 只骗眼睛，这玩意儿骗腿" 1 "00@0.3" "clip|lap|$(at ${T_WALK:-9}+0.7)|$(at ${T_WALK:-9}+6.2)|1||all"
seg I02 13.5 "画面 + 手柄震动，腿是空的 · 几乎没人做物理反馈" "消费级髋外骨骼 Hypershell X MaxS · 原地迈步 · 屏幕里的你在爬珠峰北坡" 1 "n01@0.2 n02@7.4" "clip|lap|$(at ${T_WALK:-9}+6.2)|$(at ${T_WALK:-9}+19.7)|1||all"
seg I03 11.5 "游戏是载体 · 主角是自研控制软件 ShellOS" "官方 App 禁用了这个型号 · 从串口协议起全是自己写的" 1 "n03@0.2" "clip|dash|0|8|1||all" "img|3.5|ui_dashboard.png|fit|in"
# ② ShellOS 五层 + 安全层
stack_seg I04 13 "ShellOS · 跑在笔记本上的外骨骼控制软件" "五层，安全层是唯一能写串口的地方" "第 4 层 界面：登山游戏 /game（Three.js，离线可用）· 选山 / 造山 · 操作员仪表盘|第 3 层 地形控制律：世界是一份 JSON，按路段在步态相位上打髋力矩脉冲|第 2 层 步态估计：183 Hz 髋角 → 极角相位，12 段真机录制扫 1080 档门限|第 1 层 安全层 Guard：软限 4 Nm · 斜率限 · 死人开关 · 看门狗 · 只认本机|第 0 层 设备：真机串口 / 模拟外骨骼 / 录制回放，同一个接口" 3 "n04@0.2 n05@9.3"
seg I05 11.5 "安全层 Guard：软限 4 Nm（固件硬限 7.5 永远不用满）· 斜率 50 Nm/s" "死人开关 · 步态置信度 < 0.5 出力为零 · 看门狗 100 ms 发 0 / 1 s DISABLE · 急停后手动上膛 · 控制 POST 只认本机" 0 "n06@0.2" "img|6|ui_estop.png|cover|in" "img|5.5|ui_play_force.png|cover|out"
seg I07 10 "地形控制律：上坡 = 推（+3.0）· 上台阶 = 沉（−3.6）· 红灯 = 拉" "步态 183 Hz 髋角算相位 · 坐 / 站假周期 13 → 0 · 覆盖率 0.25 → 0.44 · 摆动期为 0" 0 "02@0.2 03@3.0 03b@5.4" "img|4.5|脉冲-上台阶-阻力.png|fit|in" "clip|lap|${T_PULSE:-11}|$(at ${T_PULSE:-11}+5.5)|1|820:300:20:760"
# ③ 珠峰北坡一圈（R02 / R03 / R04 / R09 / R10 沿用 v3 片段）
seg R02 5 "峰哥导游：进山先讲一段" "固定话术 · 峰哥克隆声 · 本人授权" 1 "" "clip|lap|${T_GUIDE:-1}|$(at ${T_GUIDE:-1}+5)|1||先顺着"
seg R03 7 "屏幕上的坡 → 腿上的助力 / 阻力" "珠峰北坡 · 大本营 5200 m · ShellOS 控制 Hypershell" 1 "02b@0.2" "clip|lap|${T_HELI:-14}|$(at ${T_HELI:-14}+7)|1||牦牛"
seg R04 4 "冰川上坡 · 牦牛让路 · 经幡猛风" "上坡 = 绿脉冲，有人在后面推" 1 "" "clip|${SUMMIT_DIR:-summit}|${Y_A:-1.5}|$(at ${Y_A:-1.5}+4)"
seg I09 7 "北坳冰壁：台阶 = 支撑期阻力脉冲 · 软限 4 Nm" "珠峰北坡 67 步 · 5200 → 8848.86 m · 北坳吸氧红灯：站稳 2 s 才放行" 1 "" "clip|lap|${T_OXY:-30}|$(at ${T_OXY:-30}+7)"
seg I10 8.5 "横梯 · 刀脊 · 横切：三段悬崖" "横梯走太快 / 站太久会晃 · 刀脊 1 m 宽两侧 60° · 失足 2.5 s 黑场计一次 · ×2" 1 "n09@0.2" "clip|lap|${T_LAD:-40}|$(at ${T_LAD:-40}+17)|2"
seg R09 4 "×4 · 旁边的影子是上一位" "" 1 "08@0.3" "clip|lap|${T_RIDGE:-48}|$(at ${T_RIDGE:-48}+16)|4"
seg R10 8 "登顶 8848.86 m · 你是下一位的影子" "" 1 "g_summit@${S_G:-3.2}" "clip|${SUMMIT_DIR:-summit}|${S_A:-0}|$(at ${S_A:-0}+8)|1||all"
# ④ Agent 蜂群
seg R13 3 "蜂群：教练 / 记忆员 / 安全员 / 地形导演" "旁白只说「大模型」· 模型名以时间线为准" 1 "06d@0.2" "img|3|仪表盘-蜂群.png|fit|in"
card_seg I11 2.5 "评委说：「太陡了」" "" "" - "05@0.3"
seg R07L 8 "教练 → 记忆员 → 安全员 → 生效" "强度 3.0 → 2.5 · 删卡 = 回退 · 恢复" 1 "06a@0.3 06c@3.9" "clip|dash|${D_A:-7}|$(at ${D_A:-7}+8)"
seg I12 6 "经验卡：穿戴者 · 控制律 · 步频区间 · 参数差值 · 原话" "换人走满 6 步、步频稳定就自动套用 · 删掉已套用的卡 = 参数立即反向回退" 0 "" "img|6|ui_ai_card.png|cover|in"
seg R08 8 "一句话 → 大模型出路线 → 安全员裁剪" "台阶不过半 · 红灯 ≤ 2 · 起步平地" 1 "07a@0.3 07b@2.3 07c@5.8" "clip|forge|${F_A:-0}|$(at ${F_A:-0}+8)"
seg I13 8.5 "安全员是硬代码 · 故意不交给大模型" "超软限就裁 · 30 s 同一参数最多改 3 次 · 急停一律否决 · 造山起步平地 / 台阶不过半 / 红灯 ≤ 2 / 总长 20–80 步" 0 "n11@0.2" "img|8.5|仪表盘-蜂群.png|fit|out"
# ⑤ 其它世界
seg I14 12 "8 个世界 · 一份 JSON 加一座山" "赛博东京 · 华山长空栈道 · 泰山十八盘 · 富士山吉田线 · 屋顶跑酷（步频 = 跑速，高抬腿跳，下蹲滑铲）" 1 "n12@0.2" "clip|tokyo|${K_A:-0}|$(at ${K_A:-0}+3)|1||all" "img|2.5|huashan_plank.png|cover|in" "img|2.5|游戏-泰山台阶-峰哥v2.jpg|cover|out" "img|2|地图-富士.jpg|cover|in" "clip|parkour|1|3|1||all"
# ⑥ 峰哥导游与授权
seg I15 8 "化身是峰哥本人 · 低多边形身体 · 照片正投影的脸" "7 套装备按地图自动换 · 进图先听峰哥导游 · 登顶 / 红灯 / 横梯 / 造山时大模型按峰哥口吻现写一句" 0 "n13@0.2" "img|8|fengge_r2_sheet.png|fit|in"
card_seg I16 9 "肖像 · 口吻 · AI 复刻音色" "峰哥本人 9/23 在现场当面口头同意本次黑客松展示使用" "他改主意，一个参数就能把头像、贴脸、气泡和音色全关掉|照片 · 口吻 · 参考音频分别来自 MIT / Apache-2.0 仓库 · 断网也有 11 句预生成语录|素材清单见仓库 docs/提交/素材授权.md · 代码全部开源 · 不做医疗器械定位" - "n14@0.2"
# ⑦ 验证数字 + 局限
card_seg I17 11 "验证数字（每条标来源）" "真机 9/22 · 回放 · 模拟 · 单测 · 大模型实连 9/23" "真机：PING → VERSION → ENABLE · 183 Hz 数据流 · 控制循环最大间隔 12 ms · 2 次 DISARMED 都是看门狗按设计触发|回放：12 段真机录制 0 DISARM · 0 Traceback · 假周期 13 → 0 · 故障注入 11 / 11|模拟：五路段脉冲核对全过 · 27 组参数边界扫描 0 组不过 · 1080p 50–58 fps|大模型：教练 23 / 23（p50 1.6 s）· 造山 10 / 10（p50 7.0 s）· 导游压测 20 / 20 · 单测 tests/test_swarm.py 4 条" - "n15@0.2"
card_seg I18 9 "照实写的局限" "" "真机录制只有 1 个人约 170 s · 真人的步只被接住约 44%|上坡 / 下坡 · 跑酷的跳和滑铲还没穿在人身上试|蒙眼二选一（2AFC）≥ 9/10 之前不说「能分辨坡度」· 不说「首个腿部力反馈」" - "n16@0.2"
# ⑧ 片尾
card_seg J99 7 "峰哥亡命天涯" "骗腿，不骗眼睛 · AI 出主意，硬代码说了算" "团队 PRX · 球球 / 艾玛 · $REPO_URL|峰哥 · AI 复刻音色（本人授权）· 软限 4 Nm · 死人开关 · 看门狗|配乐 Our Story Begins · Kevin MacLeod (incompetech.com) · CC BY 4.0" "$QR" "11b@0.2 11@3.3"

echo "== 拼接 + 混音"
final "$OUT" J00 I01 I02 I03 I04 I05 I07 R02 R03 R04 I09 I10 R09 R10 R13 I11 R07L I12 R08 I13 I14 I15 I16 I17 I18 J99
ffmpeg -y -v error -i "$OUT" -vf scale=1280:720 -c:v libx264 -preset veryfast -crf 23 -maxrate 2M -bufsize 4M -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "${OUT%.mp4}_720p.mp4"
cp "${OUT%.mp4}_720p.mp4" "$ROOT/docs/提交/视频素材/"
for f in "$OUT" "${OUT%.mp4}_720p.mp4"; do echo "$f $(ffprobe -v error -show_entries format=duration,size -of csv=p=0 "$f")"; done
