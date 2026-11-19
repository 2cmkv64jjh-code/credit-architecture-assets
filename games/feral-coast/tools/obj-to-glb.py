#!/usr/bin/env python3
"""Converts an OBJ + MTL (diffuse colours and an optional diffuse texture) into a binary glTF (.glb).
Usage: python3 obj-to-glb.py in.obj out.glb"""
import json, os, struct, sys

def parse_mtl(path):
    mats, cur = {}, None
    if not os.path.exists(path):
        return mats
    for line in open(path, encoding='utf-8', errors='ignore'):
        p = line.strip().split()
        if not p:
            continue
        if p[0] == 'newmtl':
            cur = mats.setdefault(' '.join(p[1:]), {'kd': [0.8, 0.8, 0.8], 'map': None})
        elif cur is not None and p[0] == 'Kd':
            cur['kd'] = [float(x) for x in p[1:4]]
        elif cur is not None and p[0] == 'map_Kd':
            cur['map'] = os.path.join(os.path.dirname(path), ' '.join(p[1:]))
    return mats

def main(src, dst):
    V, VT, VN, groups, mtllib, mat = [], [], [], {}, None, '__default'
    for line in open(src, encoding='utf-8', errors='ignore'):
        p = line.strip().split()
        if not p:
            continue
        t = p[0]
        if t == 'v': V.append([float(x) for x in p[1:4]])
        elif t == 'vt': VT.append([float(p[1]), 1 - float(p[2])])
        elif t == 'vn': VN.append([float(x) for x in p[1:4]])
        elif t == 'mtllib': mtllib = os.path.join(os.path.dirname(src), ' '.join(p[1:]))
        elif t == 'usemtl': mat = ' '.join(p[1:])
        elif t == 'f':
            idx = []
            for c in p[1:]:
                s = c.split('/')
                vi = int(s[0]); vi = vi - 1 if vi > 0 else len(V) + vi
                ti = int(s[1]) - 1 if len(s) > 1 and s[1] else -1
                ni = int(s[2]) - 1 if len(s) > 2 and s[2] else -1
                idx.append((vi, ti, ni))
            for i in range(1, len(idx) - 1):
                groups.setdefault(mat, []).extend([idx[0], idx[i], idx[i + 1]])
    mats = parse_mtl(mtllib) if mtllib else {}
    bin_ = bytearray(); bviews, accs, prims, gmats, images, textures = [], [], [], [], [], []
    def add_view(data, target=None):
        while len(bin_) % 4: bin_.append(0)
        off = len(bin_); bin_.extend(data)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target: v['target'] = target
        bviews.append(v); return len(bviews) - 1
    import math
    for name, tris in groups.items():
        m = mats.get(name, {'kd': [0.8, 0.8, 0.8], 'map': None})
        pos, nrm, uv = [], [], []
        for k in range(0, len(tris), 3):
            a, b, c = (V[t[0]] for t in tris[k:k + 3])
            ux, uy, uz = b[0]-a[0], b[1]-a[1], b[2]-a[2]; vx, vy, vz = c[0]-a[0], c[1]-a[1], c[2]-a[2]
            fn = [uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx]; l = math.sqrt(sum(x*x for x in fn)) or 1; fn = [x/l for x in fn]
            for t in tris[k:k + 3]:
                pos.append(V[t[0]]); nrm.append(VN[t[2]] if t[2] >= 0 and t[2] < len(VN) else fn)
                uv.append(VT[t[1]] if t[1] >= 0 and t[1] < len(VT) else [0, 0])
        n = len(pos)
        mn = [min(p[i] for p in pos) for i in range(3)]; mx = [max(p[i] for p in pos) for i in range(3)]
        pa = add_view(struct.pack('<%df' % (n*3), *[x for p in pos for x in p]), 34962)
        na = add_view(struct.pack('<%df' % (n*3), *[x for p in nrm for x in p]), 34962)
        ta = add_view(struct.pack('<%df' % (n*2), *[x for p in uv for x in p]), 34962)
        accs.append({'bufferView': pa, 'componentType': 5126, 'count': n, 'type': 'VEC3', 'min': mn, 'max': mx})
        accs.append({'bufferView': na, 'componentType': 5126, 'count': n, 'type': 'VEC3'})
        accs.append({'bufferView': ta, 'componentType': 5126, 'count': n, 'type': 'VEC2'})
        pbr = {'baseColorFactor': [*m['kd'], 1.0], 'metallicFactor': 0.0, 'roughnessFactor': 0.85}
        if m['map'] and os.path.exists(m['map']):
            iv = add_view(open(m['map'], 'rb').read())
            images.append({'bufferView': iv, 'mimeType': 'image/png' if m['map'].lower().endswith('png') else 'image/jpeg'})
            textures.append({'source': len(images) - 1})
            pbr['baseColorTexture'] = {'index': len(textures) - 1}; pbr['baseColorFactor'] = [1, 1, 1, 1]
        gmats.append({'name': name, 'pbrMetallicRoughness': pbr})
        prims.append({'attributes': {'POSITION': len(accs)-3, 'NORMAL': len(accs)-2, 'TEXCOORD_0': len(accs)-1}, 'material': len(gmats)-1})
    while len(bin_) % 4: bin_.append(0)
    g = {'asset': {'version': '2.0', 'generator': 'feral-coast obj-to-glb'}, 'scene': 0, 'scenes': [{'nodes': [0]}],
         'nodes': [{'mesh': 0, 'name': os.path.splitext(os.path.basename(src))[0]}], 'meshes': [{'primitives': prims}],
         'materials': gmats, 'accessors': accs, 'bufferViews': bviews, 'buffers': [{'byteLength': len(bin_)}]}
    if images: g['images'] = images; g['textures'] = textures
    js = json.dumps(g).encode(); js += b' ' * ((4 - len(js) % 4) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bin_), 0x004E4942) + bytes(bin_)
    open(dst, 'wb').write(out); print(dst, len(out) // 1024, 'KB', 'bounds', [round(x, 2) for x in mn], [round(x, 2) for x in mx])

main(sys.argv[1], sys.argv[2])
