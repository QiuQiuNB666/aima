"""VRM 瘦身：缩略图 / 法线图换成 1×1 占位，其余贴图 ≤ MAX px 重新编码；重排 BIN。只动 images，网格 / 骨骼 / 动画原样。
用法：python3 shrink.py in.vrm out.vrm [MAX=1024]
     python3 shrink.py --anim-only in.glb out.glb   # 只留动画（去 mesh / skin / material），给 Xbot 用
"""
import json, struct, sys, io
from PIL import Image

def read_glb(p):
    with open(p, 'rb') as f:
        magic, ver, ln = struct.unpack('<4sII', f.read(12))
        chunks = []
        while f.tell() < ln:
            cl, ct = struct.unpack('<II', f.read(8)); chunks.append((ct, f.read(cl)))
    return json.loads(chunks[0][1].decode('utf-8')), chunks[1][1]

def write_glb(p, js, bin_):
    j = json.dumps(js, separators=(',', ':')).encode('utf-8')
    j += b' ' * ((4 - len(j) % 4) % 4)
    bin_ += b'\0' * ((4 - len(bin_) % 4) % 4)
    with open(p, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(j) + 8 + len(bin_)))
        f.write(struct.pack('<II', len(j), 0x4E4F534A)); f.write(j)
        f.write(struct.pack('<II', len(bin_), 0x004E4942)); f.write(bin_)

def rebuild(js, bin_, replace, keep=None):
    """replace: {bufferView index: new bytes}；keep: 要保留的 bufferView 集合（None = 全部）。返回新 bin，并原地改 bufferViews。"""
    out = bytearray(); bvs = js['bufferViews']
    for i, bv in enumerate(bvs):
        if keep is not None and i not in keep:
            bv['byteOffset'] = 0; bv['byteLength'] = 0; continue
        off = bv.get('byteOffset', 0)
        data = replace.get(i, bin_[off:off + bv['byteLength']])
        while len(out) % 4: out.append(0)
        bv['byteOffset'] = len(out); bv['byteLength'] = len(data); out += data
    js['buffers'] = [{'byteLength': len(out)}]
    return bytes(out)

def png(img):
    b = io.BytesIO(); img.save(b, 'PNG', optimize=True); return b.getvalue()

def shrink(src, dst, mx=1024):
    js, bin_ = read_glb(src); rep = {}
    flat_nml = png(Image.new('RGB', (1, 1), (128, 128, 255)))
    blank = png(Image.new('RGBA', (1, 1), (0, 0, 0, 0)))
    for im in js.get('images', []):
        bv = im['bufferView']; name = im.get('name', '')
        if name == 'Thumbnail': rep[bv] = blank; im['mimeType'] = 'image/png'; continue
        if name.endswith('_nml') or 'normal' in name.lower(): rep[bv] = flat_nml; im['mimeType'] = 'image/png'; continue
        v = js['bufferViews'][bv]; off = v.get('byteOffset', 0)
        img = Image.open(io.BytesIO(bin_[off:off + v['byteLength']]))
        if max(img.size) > mx:
            img = img.resize((max(1, img.width * mx // max(img.size)), max(1, img.height * mx // max(img.size))), Image.LANCZOS)
        rep[bv] = png(img); im['mimeType'] = 'image/png'
    write_glb(dst, js, rebuild(js, bin_, rep))

def anim_only(src, dst):
    js, bin_ = read_glb(src)
    for n in js['nodes']: n.pop('mesh', None); n.pop('skin', None)
    for k in ('meshes', 'skins', 'materials', 'textures', 'images', 'samplers'): js.pop(k, None)
    js['animations'] = [a for a in js.get('animations', []) if a.get('name') in ('idle', 'walk', 'run')]
    used_acc = set()
    for a in js.get('animations', []):
        for s in a['samplers']: used_acc.add(s['input']); used_acc.add(s['output'])
    # 只保留动画用到的 accessor：把 accessors 压缩重编号
    old2new = {}; accs = []
    for i, a in enumerate(js['accessors']):
        if i in used_acc: old2new[i] = len(accs); accs.append(a)
    js['accessors'] = accs
    for a in js.get('animations', []):
        for s in a['samplers']: s['input'] = old2new[s['input']]; s['output'] = old2new[s['output']]
    keep = {a['bufferView'] for a in accs if 'bufferView' in a}
    write_glb(dst, js, rebuild(js, bin_, {}, keep))

if __name__ == '__main__':
    a = sys.argv[1:]
    if a[0] == '--anim-only': anim_only(a[1], a[2])
    else: shrink(a[0], a[1], int(a[2]) if len(a) > 2 else 1024)
