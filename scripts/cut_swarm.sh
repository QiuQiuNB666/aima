#!/bin/bash
# 蜂群拆解视频（约 4.5 min，1080p30 H.264 + AAC）：我们的 Agent 蜂群 × 主办方 EvoMap × Hermes Agent。说明 / 对比 / 分镜 / 旁白全文见 docs/蜂群-拆解.md。
#   scripts/cut_swarm.sh            # → $MAT/swarm_breakdown.mp4 + _720p.mp4，同时拷到 docs/提交/视频素材/
#   FORCE=1 scripts/cut_swarm.sh    # 重建全部 W* 片段（旁白 wav 已有就复用；改了某句旁白就删掉 $MAT/vo/swNN.wav 再跑）
# 复用 scripts/cut_demo.sh 的 png / clip / still / cardv / card_seg / final；本片新增的图卡 / 字幕 / 录屏合成在 scripts/video_tools/swarm_png.py。
# 旁白：docs/蜂群-拆解.md 第 7 节表格 → brain/tts.py（127.0.0.1:8791）。讲解 = MiniMax 预设 presenter_male（中性男声，语速 1.1）；峰哥 = 复刻音色，只用在峰哥语录两句。
# 录屏：$MAT/frames/swarm_{off,on}{A,B}（scripts/video_tools/rec_swarm.mjs 连拍本机 --sim 的仪表盘；A = 1× 全屏 + 发动作，B = 2× 被动，裁局部用；
#       plan 在各 A 目录里；A 的第 0 秒 = B 的第 OFF 秒）。off = 大脑离线（SHELLOS_BRAIN 指向死端口），on = 本机 8790 的真大脑（MiniMax-M3）。
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source "$ROOT/scripts/cut_demo.sh" lib
export WIND=${WIND:-0} MUSICVOL=${MUSICVOL:-0.4}     # 讲解片：不要风声垫底，配乐再压一点
OUT=$MAT/swarm_breakdown.mp4
S=$B/sw; mkdir -p "$S"
SW=(python3 "$ROOT/scripts/video_tools/swarm_png.py")
FR=$MAT/frames
OFF_OFF=6.205; OFF_ON=7.077        # swarm_offA / swarm_onA 的第 0 秒在 B 里的秒数（t0.txt 相减）
CROP_SWARM=2852:200:976:960        # 2× 帧里：右列「蜂群」面板
CROP_MEM=2852:1180:976:632         # 2× 帧里：右列「记忆 · 经验卡」面板
BOX_SWARM=1030:96:780:767; BOX_MEM=1010:190:820:531
at() { python3 -c "print(round($1,3))"; }

# ---------- 1. 旁白（表格 → wav；讲解用预设男声，峰哥用复刻声；拒收 say 女声兜底） ----------
echo "== 旁白"
"${SW[@]}" lines "$ROOT/docs/蜂群-拆解.md" "$S/lines.tsv"
while IFS=$'\t' read -r id who text; do
  f=$MAT/vo/$id.wav; [ -s "$f" ] && continue
  if [ "$who" = 峰哥 ]; then body=$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1]}))' "$text")
  else body=$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1], "voice": {"voice_id": "presenter_male", "speed": 1.1}}))' "$text"); fi
  h=$(curl -s --noproxy '*' -m 90 -D - -X POST "$TTS/tts" -H 'Content-Type: application/json' --data "$body" -o "$f.tmp" | tr -d '\r')
  if grep -qi 'no-store' <<< "$h" || [ ! -s "$f.tmp" ]; then echo "  ! $id 合成失败 / say 兜底，没存"; rm -f "$f.tmp"; exit 1; fi
  mv "$f.tmp" "$f"; echo "  + $id $who $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f") s"
done < "$S/lines.tsv"
vlen() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$MAT/vo/$1.wav"; }
text_of() { awk -F'\t' -v k="$1" '$1 == k {print $3}' "$S/lines.tsv"; }
LEAD=0.4; GAP=0.35; TAIL=0.6
# dur_of "<id…>" [最短秒]：这几句旁白 + 前后留白要多长
dur_of() { local t=$LEAD id; for id in $1; do t=$(at "$t+$(vlen "$id")+$GAP"); done; at "max($t-$GAP+$TAIL, ${2:-0})"; }

# ---------- 2. 片段：画面 → 逐句字幕 + 淡入淡出 → $B/seg/<id>.mp4，旁白偏移写进 meta 给 final ----------
# sseg <id> <画面mp4> "<旁白 id…>" [角标png]
sseg() {
  local id=$1 src=$2 vos=$3 badge=${4:-} t=$LEAD dur v n=1 in fc last=0 vo="" o l
  dur=$(dur_of "$vos"); echo "$dur" > "$B/meta/$id.dur"; : > "$B/meta/$id.sync"
  in=(-i "$src"); fc="[0:v]tpad=stop_mode=clone:stop_duration=$dur[s0]"
  for v in $vos; do
    l=$(vlen "$v"); "${SW[@]}" sub "$S/sub_$v.png" "$(text_of "$v")"
    in+=(-i "$S/sub_$v.png"); fc="$fc;[s$last][$n:v]overlay=0:0:enable='between(t,$t,$(at "$t+$l+0.15"))'[s$n]"
    vo="$vo $v@$t"; last=$n; n=$((n + 1)); t=$(at "$t+$l+$GAP")
  done
  if [ -n "$badge" ]; then in+=(-i "$badge"); fc="$fc;[s$last][$n:v]overlay=0:0[s$n]"; last=$n; fi
  fc="$fc;[s$last]fade=t=in:d=$FADE,fade=t=out:st=$(at "max(0,$dur-$FADE)"):d=$FADE[f]"
  echo "${vo# }" > "$B/meta/$id.vo"
  ffmpeg -y -v error "${in[@]}" -filter_complex "$fc" -map "[f]" -t "$dur" "${ENC[@]}" "$B/seg/$id.mp4"
  echo "  > $id ${dur} s  ($vos)"
}
spec() { local n=$1; cat > "$S/$n.json"; "${SW[@]}" spec "$S/$n.json" "$S/$n.png"; }
# 图卡 → 静帧慢推（cut_demo 的 still：先放到 4K 再 zoompan，不抖）
cardshot() { local n=$1 vos=$2; still "$S/$n.png" "$(dur_of "$vos")" "$S/$n.mp4" fit "${3:-in}"; }
# recshot <名> <frames目录名> <B 秒起> <crop> <box> "<旁白>"：录屏局部放进图卡 $S/<名>.png 的框
recshot() { local n=$1 fr=$2 a=$3 crop=$4 box=$5 d; d=$(dur_of "$6"); "${SW[@]}" rec "$FR/$fr" "$a" "$(at "$a+$d")" "$S/$n.mp4" "$d" "$crop" "$S/$n.png" "$box"; }

png badge "$B/cap/tag.png" "峰哥 · AI 复刻音色 · 本人授权" tr
echo "== 片段"
# ① 冷开场：展位 MacBook 30 fps 仪表盘，评委说「太陡了」（第 9 s 发出）；造山大屏 forge 的「AI 造好了」剖面在 F_A+2 ~ F_A+6.5 s
d=$(dur_of "sw01 sw02"); clip dash "${D_A:-7}" "$(at "${D_A:-7}+$d")" 1 "$S/W01.raw.mp4" "$S/W01.sync" "" all; fit "$S/W01.raw.mp4" "$d" "$S/W01.mp4"
sseg W01 "$S/W01.mp4" "sw01 sw02"
png card "$S/W02.png" $W $H "Agent 蜂群拆解" "一句人话 → 安全地改真机力矩" "对照：主办方 EvoMap · Nous Research 的 Hermes Agent|峰哥亡命天涯 · 团队 PRX · EvoTavern 深圳站 01 CYBERBODY" - "#e8e5f5"
cardshot W02 sw03; sseg W02 "$S/W02.mp4" sw03

spec W03 <<'J'
{"kind":"cards","kicker":"① 蜂群怎么设计","title":"四个角色，一条时间线","sub":"大模型负责听懂人话，安全员负责不管听成什么都不许越线","lsize":30,
 "items":[{"name":"教练","tag":"大模型","color":"#60a5fa","lines":["一句话 → 参数差值提议","参数名只能从当前控制律里选","单次改动裁到范围的 15%"],"foot":"离线：规则表"},
          {"name":"地形导演","tag":"大模型","color":"#a78bfa","lines":["一句话 → 路线草稿","路段 · 步数 · 地名 · 画面风格"],"foot":"离线：关键词模板"},
          {"name":"记忆员","tag":"代码","color":"#f472b6","lines":["写卡时对照同步频段旧卡","换人走满 6 步检索、取平均","删卡 = 参数反向回退"],"foot":"本来就是代码"},
          {"name":"安全员","tag":"硬代码","color":"#f87171","lines":["超软限 4 Nm 就裁","30 s 同一参数最多改 3 次","急停中一律否决","造山路线硬裁剪"],"foot":"故意不交给大模型"}]}
J
cardshot W03 "sw04 sw05"; sseg W03 "$S/W03.mp4" "sw04 sw05"

spec W04 <<'J'
{"kind":"flow","kicker":"① 蜂群怎么设计","title":"一条时间线：评委说「太陡了」","nsize":26,
 "lanes":[{"name":"教练","tag":"大模型","color":"#60a5fa"},{"name":"记忆员","tag":"代码","color":"#f472b6"},{"name":"安全员","tag":"硬代码","color":"#f87171"}],
 "ncols":5,"nodes":[{"lane":0,"col":0,"text":"「太陡了」→ strength −0.5","verdict":"提议"},{"lane":1,"col":1,"text":"同一步频段已有卡：同向几张、反向几张","verdict":"同意"},
 {"lane":2,"col":2,"text":"软限内 · 30 s 内 < 3 次 · 没急停","verdict":"放行"},{"lane":0,"col":3,"text":"参数生效","verdict":"生效"},{"lane":1,"col":4,"text":"存成经验卡 · 步频 ±10","verdict":"记住"}],
 "foot":"时间线 = shellos/main.py App.say()；地形导演走同一条线（造山时出草稿 → 安全员裁剪 → 生效）；峰哥解说也写在这条线上"}
J
cardshot W04 sw06; sseg W04 "$S/W04.mp4" sw06

spec W05 <<'J'
{"kind":"panel","kicker":"① 实录 · 大模型在线","title":"教练提议，安全员放行","sub":"本机模拟外骨骼 + 本机大脑（MiniMax-M3）",
 "bullets":["教练：「太陡了，腿有点跟不上」→ strength −0.5，理由写在时间线上","记忆员：和 #1 #2 方向相反 —— 人跟人的腿不一样，新卡照写","安全员：幅度在软限以内，放行","经验卡 #4 生效"],
 "box":[1030,96,780,767],"label":"实录 · 仪表盘「蜂群」面板 · 最新一条在最上面"}
J
recshot W05 swarm_onB "$(at "$OFF_ON+2.0")" $CROP_SWARM $BOX_SWARM sw07; sseg W05 "$S/W05.mp4" sw07

spec W06 <<'J'
{"kind":"panel","kicker":"① 记忆员 · 检索","title":"换人：走满 6 步再检索","sub":"同一控制律 + 同一步频区间（写卡时步频 ±10）",
 "bullets":["换人「评委-04」→ 参数回缺省","走满 6 步、步频稳定 → 检索一次","命中 #1 #2 #4 → 按参数取平均套用","检索和回退记在「事件」栏与经验卡面板"],
 "box":[1010,190,820,531],"label":"实录 · 仪表盘「记忆 · 经验卡」面板"}
J
recshot W06 swarm_onB "$(at "$OFF_ON+12.5")" $CROP_MEM $BOX_MEM sw08; sseg W06 "$S/W06.mp4" sw08

spec W07 <<'J'
{"kind":"panel","kicker":"① 记忆员 · 回退","title":"删卡 = 参数立刻回退","sub":"不是写死的剧本",
 "bullets":["删掉已套用的 #3「太陡了」","strength 3.5 → 4.0（减掉整张卡的差值）","卡片变灰，可以一键恢复（下次检索生效）"],
 "box":[1010,190,820,531],"label":"实录 · 大脑离线 · 经验卡面板"}
J
recshot W07 swarm_offB "$(at "$OFF_OFF+31.0")" $CROP_MEM $BOX_MEM sw09; sseg W07 "$S/W07.mp4" sw09

# ② 安全员三连：同一张图卡，逐条高亮
for k in 0 1 2; do
  spec W08$k <<J
{"kind":"panel","kicker":"① 安全员 · 硬代码","kcolor":"#f87171","title":"整套设计的底线","sub":"规则写死、单测覆盖，谁说都不改","hi":$k,
 "bullets":["力矩参数超软限 4 Nm 就裁：想到 4.50，裁到 4.00，不生效","30 s 内同一参数最多改 3 次：第 4 次否决，防几个人来回拉锯","急停中一律否决：谁说什么都不改"],
 "box":[1030,96,780,767],"label":"实录 · 大脑离线 → 规则兜底 · 展位同参数（软限 4 Nm）"}
J
done
recshot W080 swarm_offB "$(at "$OFF_OFF+13.2")" $CROP_SWARM $BOX_SWARM sw10; sseg W08a "$S/W080.mp4" sw10
recshot W081 swarm_offB "$(at "$OFF_OFF+26.2")" $CROP_SWARM $BOX_SWARM sw11; sseg W08b "$S/W081.mp4" sw11
recshot W082 swarm_offB "$(at "$OFF_OFF+40.2")" $CROP_SWARM $BOX_SWARM sw12; sseg W08c "$S/W082.mp4" sw12

spec W09 <<'J'
{"kind":"panel","kicker":"① 地形导演 · 大模型在线","kcolor":"#a78bfa","title":"一句话造山，安全员硬裁剪","sub":"「先平路热身，然后全是台阶的天梯一百五十步，中间来五个红绿灯，最后冲顶」",
 "bullets":["地形导演：约 4 s 出草稿「峰哥夜登十八盘」39 步","安全员：红灯超过 2 个，多的删掉 ×3","安全员：两段台阶改成坡 —— 台阶不超过一半","起步平地 · 单段 ≤ 20 步 · 总长 20–80 步 · 未知路段丢弃"],
 "box":[1030,96,780,767],"label":"实录 · 仪表盘「蜂群」面板 · 本机大脑 MiniMax-M3"}
J
recshot W09 swarm_onB "$(at "$OFF_ON+22.5")" $CROP_SWARM $BOX_SWARM "sw13 sw14"; sseg W09 "$S/W09.mp4" "sw13 sw14"
d=$(dur_of sw15); clip forge "$(at "${F_A:-0}+1.8")" "$(at "${F_A:-0}+1.8+$d")" 1 "$S/W10.raw.mp4" "$S/W10.sync" "" all; fit "$S/W10.raw.mp4" "$d" "$S/W10.mp4"
sseg W10 "$S/W10.mp4" sw15

spec W11 <<'J'
{"kind":"panel","kicker":"① 大脑离线","title":"大模型挂了，照样跑","sub":"面板顶上一行：大脑离线 → 造山和「学」走规则模板",
 "bullets":["教练：规则表（卡片来源标 rule）","地形导演：关键词模板，路线检查照样过","峰哥解说：内置语录","腿上的安全链路本来就不依赖大脑"],
 "box":[1030,96,780,767],"label":"实录 · 大脑指向不通的端口"}
J
recshot W11 swarm_offB "$(at "$OFF_OFF+48.5")" $CROP_SWARM $BOX_SWARM "sw16 sw16f"; sseg W11 "$S/W11.mp4" "sw16 sw16f" "$B/cap/tag.png"

spec W12 <<'J'
{"kind":"flow","kicker":"① 最关键的一条","title":"大模型永远不在力矩的写路径上","x0":330,"nsize":25,
 "lanes":[{"name":"大模型","tag":"只出提议","color":"#60a5fa"},{"name":"代码","tag":"可测试","color":"#f472b6"},{"name":"硬代码","tag":"100% 复现","color":"#f87171"}],
 "ncols":6,"nodes":[{"lane":0,"col":0,"text":"教练 / 地形导演：参数差值 · 路线草稿","verdict":"提议"},{"lane":1,"col":1,"text":"参数白名单 · 单次 ≤ 范围 15%"},
 {"lane":2,"col":2,"text":"安全员：软限 · 30 s 3 次 · 急停否决","verdict":"裁决"},{"lane":1,"col":3,"text":"控制律：夹到参数范围 · 固定形状脉冲"},
 {"lane":2,"col":4,"text":"Guard：软限 · 斜率限 · 死人开关 · 置信度 · 看门狗","verdict":"唯一"},{"lane":2,"col":5,"text":"串口力矩","verdict":"写"}],
 "foot":"大模型调用都不在 100 Hz 控制循环里；大脑进程整个挂掉，Guard 这条链照样工作（shellos/safety/guard.py）"}
J
cardshot W12 "sw17 sw18"; sseg W12 "$S/W12.mp4" "sw17 sw18"

spec W13 <<'J'
{"kind":"cards","kicker":"① 证据","title":"实测与单测","sub":"口径同提交表单：大模型实连 MiniMax-M3（9/23）· 单测 9/25 实跑","nsize":52,"lsize":34,
 "items":[{"name":"教练","tag":"23 / 23","color":"#60a5fa","lines":["23 句参数和方向全对","延迟 p50 1.6 s"]},
          {"name":"造山","tag":"10 / 10","color":"#a78bfa","lines":["10 句都由模型生成","p50 7.0 s","被裁剪的 2 句里有 1 句故意刁难"]},
          {"name":"单测","tag":"6 passed","color":"#f87171","lines":["tests/test_swarm.py","裁剪 · 限次 · 急停否决","假提议 +9.0 只剩 +0.45","离线造山能走 · 离线解说有声"]}]}
J
cardshot W13 sw19; sseg W13 "$S/W13.mp4" sw19

# ③ EvoMap
spec W14 <<'J'
{"kind":"cards","kicker":"② 主办方 EvoMap","kcolor":"#34d399","title":"AI 自进化基础设施","sub":"基因组进化协议 GEP：Agent 跨模型、跨地区共享、验证并继承能力 · 「一个 Agent 学会，百万 Agent 继承」","nsize":40,"lsize":27,
 "items":[{"name":"Gene 基因","tag":"可复用策略","color":"#34d399","lines":["响应哪些信号","按什么步骤做","守什么约束、怎么验证"]},
          {"name":"Capsule 胶囊","tag":"一次验证过的成功","color":"#34d399","lines":["触发条件 · 用了哪个 Gene","置信度 · 影响范围 · 结果分","和 Gene 打包发布，sha256 做 ID"]},
          {"name":"Hub","tag":"自然选择","color":"#34d399","lines":["发布 → 候选 → GDI 打分 → 晋升","别的 agent 检索、继承","用完回报验证结果"]}],
 "foot":"来源：evomap.ai 官方文档（llms.txt · skill.md · GEP 协议）· 9/25 Hub：约 503 万资产、38 万节点"}
J
cardshot W14 "sw20 sw21 sw22"; sseg W14 "$S/W14.mp4" "sw20 sw21 sw22"

spec W15 <<'J'
{"kind":"cards","kicker":"② 区别","kcolor":"#34d399","title":"两件不同的事","nsize":42,"lsize":28,
 "items":[{"name":"EvoMap","tag":"agent 之间","color":"#34d399","lines":["经验怎么在 agent 之间传播","怎么被验证、被自然选择","质量门槛面向代码：validation 只许 node / npm / npx"]},
          {"name":"我们的蜂群","tag":"人话 → 真机力矩","color":"#b176ff","lines":["一句人话怎么安全地改动髋关节力矩","经验卡只在本地：按步频检索、删卡回退","每一次改动都过硬代码安全员"]}],
 "foot":"Hypershell 创始人孙宽的观点（投资界 2026-05-18 转述）：外骨骼本质上是人与物理世界的「可编程接口」—— 蜂群是这个接口上的应用层和记忆层"}
J
cardshot W15 "sw23 sw24"; sseg W15 "$S/W15.mp4" "sw23 sw24"

spec W16 <<'J'
{"kind":"flow","kicker":"② 接入设想 · 未实现","kcolor":"#fbbf24","title":"经验卡接上 EvoMap","x0":330,"nsize":23,
 "lanes":[{"name":"本地记忆员","tag":"代码","color":"#f472b6"},{"name":"EvoMap Hub","tag":"GEP / A2A","color":"#34d399"},{"name":"安全员","tag":"硬代码","color":"#f87171"}],
 "ncols":7,"nodes":[{"lane":0,"col":0,"text":"卡被 ≥ 3 人命中、没被删"},{"lane":0,"col":1,"text":"Gene 写约束 + Capsule 写触发"},
 {"lane":1,"col":2,"text":"/a2a/validate 试发 → publish"},{"lane":1,"col":3,"text":"GDI 打分晋升"},{"lane":1,"col":4,"text":"新展位 search / fetch"},
 {"lane":2,"col":5,"text":"当新提议重新过安全员","verdict":"必须"},{"lane":0,"col":6,"text":"套用；删卡 → report 失败"}],
 "foot":"signals：exoskeleton · hip_torque · cadence_80_100 · 约束：软限 4 Nm、30 s ≤ 3 次 · 9/25 Hub 按信号检索 exoskeleton：0 条"}
J
cardshot W16 "sw25 sw27 sw28 sw29"; sseg W16 "$S/W16.mp4" "sw25 sw27 sw28 sw29"

# ④ Hermes
spec W17 <<'J'
{"kind":"cards","kicker":"③ Hermes Agent","kcolor":"#fbbf24","title":"通用自进化 agent 运行时","sub":"Nous Research · MIT 开源 · 最新 v0.21.5（2026-09-24）· 按这个理解，其它 Hermes 候选见文档","nsize":40,"lsize":27,
 "items":[{"name":"记忆","tag":"给模型读的文本","color":"#fbbf24","lines":["MEMORY.md + USER.md","会话开头注入","历史会话全文检索（SQLite FTS5）"]},
          {"name":"技能","tag":"自己写","color":"#fbbf24","lines":["做成功的流程写成技能","兼容 agentskills.io","每轮之后后台复盘"]},
          {"name":"工具与安全","tag":"模型自己动手","color":"#fbbf24","lines":["直接调工具、跑终端","危险命令审批 · 硬黑名单","容器沙箱"]}],
 "foot":"来源：github.com/NousResearch/hermes-agent（README · docs · Releases v2026.9.24）"}
J
cardshot W17 "sw30 sw31 sw32"; sseg W17 "$S/W17.mp4" "sw30 sw31 sw32"

spec W18 <<'J'
{"kind":"cards","kicker":"③ 区别","kcolor":"#fbbf24","title":"执行者 vs 提议者","nsize":42,"lsize":28,
 "items":[{"name":"Hermes","tag":"通用 · 模型是执行者","color":"#fbbf24","lines":["大模型自己调工具、写记忆、建技能","安全靠审批、黑名单、沙箱框住动作","记忆是给模型读的文本"]},
          {"name":"我们的蜂群","tag":"窄域 · 模型是提议者","color":"#b176ff","lines":["大模型关在「提议」这一层","嵌在实时安全控制回路里","经验卡是结构化参数差值，删一张精确回退"]}]}
J
cardshot W18 sw33; sseg W18 "$S/W18.mp4" sw33

spec W19 <<'J'
{"kind":"table","kicker":"④ 三方对比","title":"同样叫 Agent，解决三件不同的事","c0":200,"csize":26,"hl":1,
 "cols":["","我们 · 蜂群","EvoMap","Hermes Agent"],
 "rows":[["定位","嵌在实时安全回路里的窄域蜂群","AI 自进化基础设施 · agent 经验网络","通用自进化 agent 运行时"],
         ["谁能改什么","大模型只出提议；安全员放行才进参数；只有 Guard 写力矩","agent 发布 Gene + Capsule；Hub 打分晋升，别人继承","大模型直接调工具、写记忆和技能"],
         ["安全边界","硬代码安全员 + Guard（软限 4 Nm、斜率限、死人开关、看门狗）","发布质量门槛、内容哈希、声誉与验证报告","命令审批、硬黑名单、容器沙箱"],
         ["记忆与进化","本地经验卡 · 按步频检索取平均 · 删卡回退","跨节点继承 · GDI 自然选择","MEMORY / USER 文件 · 会话检索 · 自写技能"],
         ["离线能力","全离线：规则表 · 模板 · 内置语录","发布与继承走 Hub","可接本地模型"],
         ["适用场景","会伤到人的实时物理控制","多 agent 复用已验证的解法","个人 / 团队通用助理与自动化"]]}
J
cardshot W19 sw35; sseg W19 "$S/W19.mp4" sw35

png card "$S/W20.png" $W $H "AI 出主意，硬代码说了算" "峰哥亡命天涯 · Agent 蜂群" "团队 PRX · $REPO_URL|没有外骨骼也能 --sim 跑起整套蜂群 · 说明与对比：docs/蜂群-拆解.md|讲解音色 MiniMax 预设 · 峰哥 AI 复刻音色（本人授权）|配乐 Our Story Begins · Kevin MacLeod (incompetech.com) · CC BY 4.0" - "#e8e5f5"
cardshot W20 "sw36 sw37" out; sseg W20 "$S/W20.mp4" "sw36 sw37" "$B/cap/tag.png"

echo "== 拼接 + 混音"
final "$OUT" W01 W02 W03 W04 W05 W06 W07 W08a W08b W08c W09 W10 W11 W12 W13 W14 W15 W16 W17 W18 W19 W20
ffmpeg -y -v error -i "$OUT" -vf scale=1280:720 -c:v libx264 -preset veryfast -crf 23 -maxrate 2M -bufsize 4M -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "${OUT%.mp4}_720p.mp4"
cp "${OUT%.mp4}_720p.mp4" "$ROOT/docs/提交/视频素材/"
for f in "$OUT" "${OUT%.mp4}_720p.mp4"; do echo "$f $(ffprobe -v error -show_entries format=duration,size -of csv=p=0 "$f")"; done
