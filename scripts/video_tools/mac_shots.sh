#!/bin/bash
# 在 MacBook 上串行连拍全部镜头（nohup 跑，网络抖也不断）：/tmp/v3f/<名>/  日志 /tmp/v3f/shots.log
R=/tmp/rec_mac.py; B=http://127.0.0.1:8765; F=/tmp/v3f; mkdir -p $F
rec() { local n=$1; shift; rm -rf $F/$n; echo "== $n $(date +%H:%M:%S)"; python3 $R "$@" 2>&1 | tail -3; ls $F/$n | grep -c jpg; }
post() { curl -s -m 5 -X POST $B$1 -d "$2" >/dev/null; }
post /sim '{"walk":false}'; post /terrain '{"preset":"everest_north"}'; post /demo/reset '{}'; sleep 2
rec lap "$B/game?fx=off&title=0" $F/lap 100 walkat=9000 cadence=70 "at=62000:fetch('__base__/feedback',{method:'POST',body:JSON.stringify({text:'太陡了'})})"
post /sim '{"walk":false}'; post /demo/reset '{}'; sleep 1
rec summit "$B/game?fx=off&title=0&cam=front" $F/summit 60 walk=1 cadence=110 warm=800
rec parkour "$B/parkour" $F/parkour 8 warm=1500 ready=30000
post /terrain '{"preset":"tokyo_night"}'; sleep 2
rec tokyo "$B/game?fx=off&title=0" $F/tokyo 10 walk=1 cadence=70 warm=2500
post /sim '{"walk":false}'; post /terrain '{"preset":"everest_north"}'; post /demo/reset '{}'; sleep 2
rec dash "$B/" $F/dash 26 walk=1 cadence=70 ready=8000 warm=1000 "at=9000:fetch('__base__/feedback',{method:'POST',body:JSON.stringify({text:'太陡了'})})"
post /sim '{"walk":false}'
rec forge "$B/game?fx=off&title=0" $F/forge 40 warm=1500 "at=2500:fetch('__base__/world/generate',{method:'POST',body:JSON.stringify({text:'峰哥坐亡命小飞机降落卢卡拉，徒步七天到珠峰大本营'})})" 'js=document.body.className'
post /terrain '{"preset":"everest_north"}'; post /demo/reset '{}'
echo "== ALL DONE $(date +%H:%M:%S)"; du -sh $F/*
