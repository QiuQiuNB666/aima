#!/bin/bash
R=/tmp/rec_mac.py; B=http://127.0.0.1:8765; F=/tmp/v3f
rec() { local n=$1; shift; rm -rf $F/$n; echo "== $n $(date +%H:%M:%S)"; python3 $R "$@" 2>&1 | tail -3; ls $F/$n | grep -c jpg; }
post() { curl -s -m 5 -X POST $B$1 -d "$2" >/dev/null; }
post /sim '{"walk":false}'; post /terrain '{"preset":"everest_north"}'; post /demo/reset '{}'; sleep 2
rec summit2 "$B/game?fx=off&title=0&cam=front" $F/summit2 62 walk=1 cadence=110 warm=800 stopsummit=1
post /sim '{"walk":false}'; sleep 1
rec parkour "$B/parkour" $F/parkour 10 walk=1 warm=1500 ready=30000
post /sim '{"walk":false}'; post /demo/reset '{}'
python3 /tmp/mac_encode.py $F summit2 parkour
echo "== ALL DONE $(date +%H:%M:%S)"
