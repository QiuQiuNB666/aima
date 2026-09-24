#!/bin/bash
# 展位 MacBook 网络会抖（Tailscale 中继，隔几分钟连不上一阵）：ssh / scp / rsync 一律走这个重试壳，最多等 10 min。
#   mac.sh ssh '<远端命令>'   |  mac.sh scp <本地> <远端路径>  |  mac.sh rsync <远端目录/> <本地目录/>
H=zhongrenfei@100.112.252.66; O=(-o ConnectTimeout=15 -o BatchMode=yes -o ServerAliveInterval=10 -o ServerAliveCountMax=3)
t0=$(date +%s)
while :; do
  case $1 in
    ssh)   ssh "${O[@]}" $H "$2" && exit 0 ;;
    scp)   scp "${O[@]}" "$2" "$H:$3" && exit 0 ;;
    rsync) rsync -a --partial --info=stats2 -e "ssh ${O[*]}" "$H:$2" "$3" && exit 0 ;;
  esac
  rc=$?; [ $rc -ne 255 ] && [ "$1" != rsync ] && exit $rc         # 255 = ssh 连不上才重试；命令本身失败直接返回
  [ $(( $(date +%s) - t0 )) -gt 600 ] && { echo "mac.sh: 10 min 连不上 MacBook" >&2; exit 255; }
  sleep 20
done
