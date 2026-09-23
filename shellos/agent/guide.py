"""峰哥导游：进每张地图、按住 R2 之前，峰哥讲一段这个景区。固定话术，不走大模型。
一句一个气泡，一句一个 wav：在主工作区跑 `python3 -m shellos.agent.guide --tts`，用 brain/tts.py 的峰哥复刻音色预生成进 data/voice/
（和兜底语录同一个缓存、按文字命名，不进 git；key 由 tts.py 自己从 brain/.env 读），deploy.sh 顺带同步到 MacBook。
游戏页读 GET /guide/<world>.json、/guide/<world>/<i>.wav（server.py，只读缓存，不现场合成）。
事实拿不准的不写；口吻：短句、辩证反转、「这是个好事儿啊」。不碰两性、政治。
"""
import os
import threading

GUIDE = {
    "tokyo_night": [
        "兄弟，欢迎来东京，今晚我当导游。",
        "先过涩谷十字路口，一个绿灯，几个方向的人一起过。",
        "人多是好事儿啊，挤着挤着就把你推到对面了。",
        "终点是爱宕神社，门口八十六级石阶，叫出世石段。",
        "传说江户时代有个武士骑着马冲上去，一战成名。",
        "你没马，恰恰相反，腿是自己的，更靠谱。",
        "按住 R2，原地踏步，开始爬。",
    ],
    "taishan_18pan": [
        "到泰山了，五岳之首，咱从中天门开始。",
        "前面就是十八盘，一千六百多级台阶。",
        "慢十八，不紧不慢又十八，紧十八，越往上越陡。",
        "爬完了就是南天门，再往上是玉皇顶。",
        "杜甫当年说会当凌绝顶，他写完了，你得爬完。",
        "腿软是好事儿啊，说明台阶是真的。",
        "按住 R2，开始爬。",
    ],
    "fuji_yoshida": [
        "富士山，吉田线，从五合目出发，海拔两千三百多。",
        "山顶三千七百七十六米，日本最高。",
        "很多人半夜打着头灯往上走，就为了等山顶日出，叫御来光。",
        "路上一截一截的山小屋，累了能歇脚。",
        "天黑是好事儿啊，看不见还有多远，就不害怕了。",
        "按住 R2，开始爬。",
    ],
    "everest_north": [
        "兄弟，珠峰北坡，大本营海拔五千二。",
        "先顺着东绒布冰川走到前进营地，再挂着绳子上北坳。",
        "最难的是第二台阶，一九六〇年中国登山队在这儿搭人梯，第一次从北坡登顶。",
        "一九七五年又在崖上架了一架金属梯，后来都叫它中国梯。",
        "顶上是八千八百四十八点八六米，空气只有平地三分之一。",
        "喘不上气是好事儿啊，说明你真在往上走。",
        "按住 R2，开始爬。",
    ],
    "everest_north_fx": [          # 珠峰地标台词（E 线 lines.js 同序；客户端走 /guide/everest_north_fx/<i>.wav）
        "坐亡命小飞机来的，这是个好事儿啊。",
        "牦牛给我让路？恰恰相反，是我挡了它的道。",
        "吸氧不丢人，恰恰相反，不吸才丢命。",
        "排队是好事儿啊，前面的人替我试过梯子了。",
        "旗靠风吹开，恰恰相反，人得自己走上来。",
    ],
    "wutong_haohan": [
        "回深圳了，梧桐山，深圳最高峰，鹏城第一峰。",
        "山脚一段缓坡，然后是一长溜石阶，叫好汉坡。",
        "好汉坡，好汉坡，爬不上去也别急着认怂。",
        "顶上是大梧桐，九百多米，天好的时候半个深圳都在脚下。",
        "明天下班就能去，恰恰相反，今天先在这儿练好。",
        "按住 R2，开始爬。",
    ],
    "huashan_plank": [
        "华山，西岳，自古华山一条路。",
        "从玉泉院上山，过了回心石，前面就是千尺幢，拉着铁链往上爬。",
        "再走苍龙岭，一条窄山脊，两边都是悬崖。",
        "长空栈道，几块木板钉在绝壁上，必须系安全带，全程扣在铁索上。",
        "最后到南峰，两千一百五十四米，华山最高。",
        "只有一条路是好事儿啊，没得选，就不纠结了。",
        "按住 R2，开始爬。",
    ],
    "train_stairs": [
        "训练场，台阶。",
        "上台阶腿会发沉，下台阶落脚那一下，身子往下一沉。",
        "按住 R2，原地踏步就行，松手立刻没力。",
    ],
    "train_slope": [
        "训练场，长坡。",
        "上坡像有人在后面推你，下坡腿会被拖住一点。",
        "按住 R2，原地踏步就行，松手立刻没力。",
    ],
}


def lines(world_id):
    return GUIDE.get(world_id, [])


def missing():
    """缓存里还没有语音的句子：[(world, i, 句子)]（按 voice.path 查 data/voice/）。"""
    from . import voice
    return [(w, i, s) for w, ls in GUIDE.items() for i, s in enumerate(ls) if not os.path.isfile(voice.path(s))]


def check(fill=False):
    """ShellOS 启动时调一次：打印缺语音的清单。fill=True 在后台线程向 brain/tts.py 要（隧道通着就补进缓存，断着就算了，不卡启动）。
    客户端那边缺的句子只出气泡、按字数估时长，不会卡住。"""
    miss = missing()
    if not miss:
        print(f"[导游] 语音齐全：{sum(map(len, GUIDE.values()))} 句")
        return miss
    print(f"[导游] 缺 {len(miss)} 句语音（开发机主工作区跑 python3 -m shellos.agent.guide --tts 补，再 ./deploy.sh）：")
    for w, i, s in miss:
        print(f"  {w}/{i} {s}")
    if fill:
        def run():
            from . import voice
            got = sum(bool(voice.get(s)) for _, _, s in miss)
            print(f"[导游] 向 TTS 补了 {got}/{len(miss)} 句")
        threading.Thread(target=run, name="guide-fill", daemon=True).start()
    return miss


if __name__ == "__main__":        # 字数 / 时长 / 费用：python3 -m shellos.agent.guide；--tts 预生成语音（已缓存的不花钱）；--check 查缓存齐不齐（缺了退出码 1）
    import sys
    if "--check" in sys.argv:
        sys.exit(1 if check() else 0)
    n = 0
    for w, ls in GUIDE.items():
        c = sum(len(s) for s in ls)
        n += c
        print(f"{w:16s} {len(ls)} 句 {c:4d} 字  约 {c / 4.5:.0f} s")
    print(f"合计 {n} 字（MiniMax 计费字符约是它的 1.7 倍：汉字按 2 算、标点按 1 算），speech-2.8-hd 3.5 元 / 万计费字符")
    if "--tts" in sys.argv:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "brain"))
        import tts
        tts.MM_TIMEOUT, tts.MM_BACKOFF_S = 60.0, 0.0      # 离线预生成：慢点没关系，一句失败别连累后面的
        for w, ls in GUIDE.items():
            for s in ls:
                _, keep = tts.get(s)
                print("ok" if keep else "say（MiniMax 失败，没缓存）", w, s)
