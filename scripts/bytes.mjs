// Byte counter for the threejs-fps-01 source cap: same rule as the dossier —
// .html/.js/.mjs/.css/.glsl/.vert/.frag/.wgsl/.json under game/, except
// vendor/ and *.min.js. Hard cap 163,840 bytes; target 145,000–150,000.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)), 'game');
const COUNTED = new Set(['.html', '.js', '.mjs', '.css', '.glsl', '.vert', '.frag', '.wgsl', '.json']);
const CAP = 163840;
const TARGET = 150000;

function walk(dir, rel) {
  let rows = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'vendor') continue;
      rows = rows.concat(walk(p, r));
    } else if (COUNTED.has(name.slice(name.lastIndexOf('.'))) && !name.endsWith('.min.js')) {
      rows.push([r, st.size]);
    }
  }
  return rows;
}

const rows = walk(root, '').sort((a, b) => b[1] - a[1]);
const total = rows.reduce((s, r) => s + r[1], 0);
for (const [name, size] of rows) console.log(`${String(size).padStart(7)}  ${name}`);
console.log('─'.repeat(40));
console.log(`${String(total).padStart(7)}  TOTAL  (cap ${CAP}, target ≤ ${TARGET})`);
console.log(total <= CAP ? `OK — ${CAP - total} bytes of headroom` : `OVER CAP by ${total - CAP} bytes`);
process.exit(total <= CAP ? 0 : 1);
