// Packs every assets/sounds/*.mp3 into assets/sounds.js (base64) so the game also runs from file://.
import fs from 'node:fs';
import path from 'node:path';
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'assets', 'sounds');
const out = {};
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.mp3')).sort()) out[f.slice(0, -4)] = fs.readFileSync(path.join(dir, f)).toString('base64');
const dest = path.join(dir, '..', 'sounds.js');
fs.writeFileSync(dest, '// Recorded CC0 / CC-BY sounds (see assets/sounds/CREDITS.md), embedded so file:// works\nwindow.FC_SOUNDS = ' + JSON.stringify(out) + ';\n');
console.log('wrote', dest, Object.keys(out).length, 'sounds', (fs.statSync(dest).size / 1024).toFixed(0) + ' KB');
