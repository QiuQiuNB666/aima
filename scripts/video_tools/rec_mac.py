#!/usr/bin/env python3
"""在展位 MacBook 本机跑的连拍（那台没有 node）：纯标准库 WebSocket 连本机无头 Chrome（--remote-debugging-port=9333，Metal GPU），
Page.startScreencast 逐帧存 jpg；每帧顺手记 峰哥气泡文字 / 地形 pos / 路段 / 登顶（events.jsonl），剪辑时按气泡出现的毫秒摆同期声。
    python3 rec_mac.py <url> <outdir> <秒数> [base=http://127.0.0.1:8765 cdp=http://127.0.0.1:9333 walk=1 walkat=<ms> stopat=<ms>
                        hud=0 pre=<js> at=<ms>:<js>;… js=<表达式> q=85 width=1920 height=1080 warm=1500 ready=60000 cadence=110 autowait=1]
输出：<outdir>/f%04d.jpg + times.txt + events.jsonl；stdout 最后一行 fps=xx frames=nn
"""
import base64, json, os, socket, struct, sys, threading, time, urllib.request

url, out, secs, *kv = sys.argv[1:]
O = dict(s.split('=', 1) for s in kv)
base = O.get('base', 'http://127.0.0.1:8765'); cdp = O.get('cdp', 'http://127.0.0.1:9333')
W, H = int(O.get('width', 1920)), int(O.get('height', 1080))
os.makedirs(out, exist_ok=True)
noproxy = urllib.request.build_opener(urllib.request.ProxyHandler({})).open


def http(u, method='GET', data=None):
    req = urllib.request.Request(u, data=data, method=method, headers={'Content-Type': 'application/json'})
    with noproxy(req, timeout=10) as r:
        return json.loads(r.read() or b'null')


def post(p, body):
    try: return http(base + p, 'POST', json.dumps(body).encode())
    except Exception: return None


class WS:
    """够 CDP 用的最小 WebSocket 客户端：文本帧、分片、ping/pong；发出去的帧按协议加掩码。"""
    def __init__(self, wsurl):
        _, rest = wsurl.split('://', 1); hostport, path = rest.split('/', 1); host, port = hostport.split(':')
        self.s = socket.create_connection((host, int(port))); self.s.settimeout(None)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f'GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                        f'Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
        buf = b''
        while b'\r\n\r\n' not in buf: buf += self.s.recv(4096)
        assert b' 101 ' in buf.split(b'\r\n')[0], buf[:200]
        self.rest = buf.split(b'\r\n\r\n', 1)[1]; self.lock = threading.Lock()

    def _read(self, n):
        while len(self.rest) < n:
            d = self.s.recv(min(1 << 20, max(4096, n - len(self.rest))))
            if not d: raise ConnectionError('ws closed')
            self.rest += d
        d, self.rest = self.rest[:n], self.rest[n:]; return d

    def send(self, text):
        p = text.encode(); m = os.urandom(4); h = bytearray([0x81])
        n = len(p)
        if n < 126: h.append(0x80 | n)
        elif n < 65536: h.append(0x80 | 126); h += struct.pack('>H', n)
        else: h.append(0x80 | 127); h += struct.pack('>Q', n)
        with self.lock: self.s.sendall(bytes(h) + m + bytes(b ^ m[i % 4] for i, b in enumerate(p)))

    def recv(self):
        msg = b''
        while True:
            b0, b1 = self._read(2); op, n = b0 & 0xF, b1 & 0x7F
            if n == 126: n = struct.unpack('>H', self._read(2))[0]
            elif n == 127: n = struct.unpack('>Q', self._read(8))[0]
            mask = self._read(4) if b1 & 0x80 else b''
            d = self._read(n)
            if mask: d = bytes(b ^ mask[i % 4] for i, b in enumerate(d))
            if op == 9:
                with self.lock: self.s.sendall(bytes([0x8A, 0x80 | len(d)]) + b'\0\0\0\0' + d)
                continue
            if op == 8: raise ConnectionError('ws close')
            if op in (1, 2, 0): msg += d
            if b0 & 0x80 and op in (0, 1, 2): return msg.decode('utf-8', 'replace')


tab = http(f'{cdp}/json/new?about:blank', 'PUT'); ws = WS(tab['webSocketDebuggerUrl'])
pending = {}; seq = [0]; frames = []; state = {'rec': False, 'T0': 0, 'ev': {}}
EVJS = ("(()=>{const f=document.getElementById('fg');const t=f&&f.classList.contains('talk')?f.querySelector('span').textContent:'';"
        "return JSON.stringify({bub:t,summit:document.body.classList.contains('summit')" + (",x:(" + O['js'] + ")" if O.get('js') else '') + "})})()")


def call(method, params=None, wait=True):
    seq[0] += 1; i = seq[0]; ev = threading.Event(); pending[i] = [ev, None]
    ws.send(json.dumps({'id': i, 'method': method, 'params': params or {}}))
    if not wait: return None
    ev.wait(60); return pending.pop(i, [None, None])[1]


def evaluate(expr, aw=False):
    r = call('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': aw}) or {}
    return (r.get('result') or {}).get('value')


evf = open(os.path.join(out, 'events.jsonl'), 'w')


def reader():
    n = 0
    while True:
        try: d = json.loads(ws.recv())
        except Exception as e: print('reader end', e, file=sys.stderr); return
        if 'id' in d and d['id'] in pending:
            pending[d['id']][1] = d.get('result'); pending[d['id']][0].set(); continue
        if d.get('method') == 'Page.screencastFrame':
            p = d['params']; call('Page.screencastFrameAck', {'sessionId': p['sessionId']}, wait=False)
            if not state['rec']: continue
            t = int((time.time() - state['T0']) * 1000)
            with open(os.path.join(out, f'f{n:04d}.jpg'), 'wb') as f: f.write(base64.b64decode(p['data']))
            frames.append(t); evf.write(json.dumps({'i': n, 't': t, **state['ev']}, ensure_ascii=False) + '\n'); evf.flush(); n += 1


threading.Thread(target=reader, daemon=True).start()
call('Page.enable'); call('Emulation.setDeviceMetricsOverride', {'width': W, 'height': H, 'deviceScaleFactor': 1, 'mobile': False})
call('Page.navigate', {'url': url}); print('navigated', file=sys.stderr)
t0 = time.time(); ok = False
while time.time() - t0 < int(O.get('ready', 60000)) / 1000:
    time.sleep(0.5)
    if evaluate('document.body&&document.body.dataset.ready') == '1': ok = True; break
print(f'ready in {time.time() - t0:.1f} s' if ok else 'NOT READY (拍了再说)', file=sys.stderr)
if O.get('hud') == '0': evaluate("document.head.insertAdjacentHTML('beforeend','<style>.hud:not(#fg){display:none!important}</style>');1")
if O.get('pre'): evaluate(O['pre'], True)
walking = [False]
def set_walk(w):
    if walking[0] != w: walking[0] = w; post('/sim', {'walk': w, 'cadence': float(O.get('cadence', 110))})
if O.get('walk') == '1' and not O.get('walkat'): set_walk(True)
time.sleep(int(O.get('warm', 1500)) / 1000)
call('Page.startScreencast', {'format': 'jpeg', 'quality': int(O.get('q', 85)), 'maxWidth': W, 'maxHeight': H, 'everyNthFrame': int(O.get('every', 2))})   # 页面 60 fps，每 2 帧存 1 张 = 30 fps
state['T0'] = time.time(); state['rec'] = True
want = O.get('walk') == '1' and not O.get('walkat'); aw = O.get('autowait', '1') != '0'; fired = set()
while time.time() - state['T0'] < float(secs):
    t = (time.time() - state['T0']) * 1000
    if O.get('walkat') and t >= float(O['walkat']): want = True
    if O.get('stopat') and t >= float(O['stopat']): want = False
    for a in (O.get('at') or '').split(';'):
        if a and a.split(':', 1)[0] not in fired and t >= float(a.split(':', 1)[0]):
            fired.add(a.split(':', 1)[0]); threading.Thread(target=evaluate, args=(a.split(':', 1)[1].replace('__base__', base), True), daemon=True).start()
    try: T = http(base + '/state').get('terrain') or {}
    except Exception: T = {}
    e = {}
    try: e = json.loads(evaluate(EVJS) or '{}')
    except Exception: pass
    state['ev'] = {'pos': T.get('pos'), 'seg': T.get('segment'), 'laps': T.get('laps'), **e}
    if want: set_walk(not (aw and T.get('segment') == 'wait'))
    elif walking[0]: set_walk(False)
    time.sleep(0.2)
state['rec'] = False; call('Page.stopScreencast'); set_walk(False)
open(os.path.join(out, 'times.txt'), 'w').write('\n'.join(map(str, frames)) + '\n'); evf.close()
print(f'fps={len(frames) / float(secs):.2f} frames={len(frames)}')
try: http(f'{cdp}/json/close/{tab["id"]}')
except Exception: pass
