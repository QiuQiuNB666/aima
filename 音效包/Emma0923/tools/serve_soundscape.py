"""Offline audio lab + optional loopback-only GET /state bridge. Python 3.9+, stdlib."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import build_opener, HTTPRedirectHandler, ProxyHandler, Request

ROOT = Path(__file__).resolve().parents[1]


def source_url(value):
    u = urlsplit(value)
    if (u.scheme != 'http' or u.hostname not in ('127.0.0.1', 'localhost', '::1')
            or u.username or u.password or u.path not in ('', '/') or u.query or u.fragment):
        raise argparse.ArgumentTypeError('source must be a loopback HTTP origin, e.g. http://127.0.0.1:8877')
    _ = u.port  # reject invalid ports
    return value.rstrip('/') + '/state'


def filtered_state(data):
    t = data.get('terrain')
    terrain = None
    if isinstance(t, dict):
        world = t.get('world') or {}
        terrain = {k:t.get(k) for k in ('preset','pos','total','laps','segment','label')}
        terrain['world'] = {'theme': {'style': (world.get('theme') or {}).get('style')}}
    return {'t': data.get('t'), 'terrain': terrain, 'gait': {'moving': (data.get('gait') or {}).get('moving')}}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Handler(SimpleHTTPRequestHandler):
    source = None
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.mjs':'text/javascript', '.wav':'audio/wav'}

    def do_GET(self):
        if urlsplit(self.path).path != '/api/state':
            return super().do_GET()
        status = 200
        try:
            if not self.source:
                raise ValueError('Start with --source http://127.0.0.1:PORT')
            opener = build_opener(ProxyHandler({}), NoRedirect())
            with opener.open(Request(self.source, headers={'Accept':'application/json'}), timeout=1) as r:
                raw = r.read(1024*1024+1)
            if len(raw) > 1024*1024:
                raise ValueError('State response too large')
            body = filtered_state(json.loads(raw))
        except Exception as e:
            status, body = 503, {'error':str(e)}
        payload = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(payload)))
        self.end_headers(); self.wfile.write(payload)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--port',type=int,default=8890)
    p.add_argument('--source',type=source_url)
    a=p.parse_args()
    Handler.source=a.source
    server=ThreadingHTTPServer(('127.0.0.1',a.port),partial(Handler,directory=str(ROOT)))
    print('Sound lab: http://127.0.0.1:%s/ (read-only; no hardware commands)' % a.port, flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()


if __name__ == '__main__':
    main()
