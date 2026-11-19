// Converts self-contained .gltf files (buffers as data: URIs) into compact binary .glb files.
// Usage: node gltf-to-glb.mjs <in.gltf> <out.glb>
import fs from 'node:fs';
const [inp, out] = process.argv.slice(2);
const j = JSON.parse(fs.readFileSync(inp, 'utf8'));
const bufs = j.buffers.map((b) => {
  if (!b.uri || !b.uri.startsWith('data:')) throw new Error('only data: URI buffers are supported');
  return Buffer.from(b.uri.split(',')[1], 'base64');
});
// merge all buffers into one, rebasing bufferViews
const offsets = []; let total = 0;
for (const b of bufs) { offsets.push(total); total += Math.ceil(b.length / 4) * 4; }
const bin = Buffer.alloc(total);
bufs.forEach((b, i) => b.copy(bin, offsets[i]));
for (const v of j.bufferViews) { v.byteOffset = (v.byteOffset || 0) + offsets[v.buffer]; v.buffer = 0; }
j.buffers = [{ byteLength: total }];
let js = Buffer.from(JSON.stringify(j), 'utf8');
const pad = (4 - (js.length % 4)) % 4; js = Buffer.concat([js, Buffer.alloc(pad, 0x20)]);
const len = 12 + 8 + js.length + 8 + bin.length;
const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(len, 8);
const c0 = Buffer.alloc(8); c0.writeUInt32LE(js.length, 0); c0.writeUInt32LE(0x4e4f534a, 4);
const c1 = Buffer.alloc(8); c1.writeUInt32LE(bin.length, 0); c1.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(out, Buffer.concat([h, c0, js, c1, bin]));
console.log(out, (len / 1024).toFixed(0) + ' KB');
