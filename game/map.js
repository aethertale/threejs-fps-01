// MERIDIAN TERMINAL — an abandoned transit terminal at dusk. Three lanes run
// west (KITE spawn) to east (two sites): the north Concourse lane to Site A
// (Ticket Hall), the open mid Plaza, and the south Service lane to Site B
// (Platform). Two chokepoints guard the east wing: the mid gap at x=6 and the
// site entrances at x=14. Walls are [x0,z0,x1,z1,height]; crates are low cover
// (block movement, not sightlines above 1.25 m).
export const BOUNDS = { x0: -23, x1: 23, z0: -16, z1: 16 };
export const RADIUS = 0.38; // player/bot collision radius

// Full-height walls (h >= 2.4 block line of sight), then low cover.
export const WALLS = [
  // outer shell
  [-23.6, -16.6, -23, 16.6, 3.2], [23, -16.6, 23.6, 16.6, 3.2],
  [-23.6, -16.6, 23.6, -16, 3.2], [-23.6, 16, 23.6, 16.6, 3.2],
  // lane dividers: gaps west (x < -8) and east (x > 10)
  [-8, -8.6, 10, -8, 3.2], [-8, 8, 10, 8.6, 3.2],
  // mid wall at x=6: two segments, one central chokepoint z in [-2, 2]
  [6, -6, 6.6, -2, 3.2], [6, 2, 6.6, 6, 3.2],
  // site A room (NE): west wall leaves entrance gap z in [-11, -8]
  [14, -16, 14.6, -11, 3.2],
  // site B room (SE): west wall leaves entrance gap z in [8, 11]
  [14, 11, 14.6, 16, 3.2],
  // plaza pillars
  [-1.5, -5.5, -0.5, -4.5, 3.2], [-1.5, 4.5, -0.5, 5.5, 3.2],
];
export const CRATES = [
  [-18, -2, -16.5, -0.5, 1.25], [-4, -3, -2, -1, 1.25], [0, 1, 2, 3, 1.25],
  [-2, 4, -0.5, 5.5, 1.25], [2, -14, 3.5, -12.5, 1.25], [10, -13, 12, -11.5, 1.25],
  [2, 12.5, 3.5, 14, 1.25], [10, 11.5, 12, 13, 1.25],
  [18, -16, 19, -13, 1.25], [18, 13, 19, 16, 1.25],
  [8.5, -1, 9.5, 1, 1.1], [-12, -1, -11, 1, 1.1],
];
export const BOXES = WALLS.concat(CRATES);

export const SITES = {
  A: { name: 'TICKET HALL', x: 18.5, z: -12, r: 3.4, color: 0xffb02e },
  B: { name: 'PLATFORM', x: 18.5, z: 12, r: 3.4, color: 0x3fd2c0 },
};
export const SPAWNS = {
  kite: [[-20, 0], [-21, -2], [-21, 2]],
  anvil: [[20, 0], [19, -3], [19, 3], [16, -12], [16, 12]],
};
export const HOLD_POSTS = {
  A: [[16, -13, -Math.PI / 2], [19.5, -9.5, Math.PI * 0.75]],
  B: [[16, 13, -Math.PI / 2], [19.5, 9.5, -Math.PI * 0.75]],
};

// Waypoint graph for bot routing. Nodes are open floor; links cross only open gaps.
// Nodes 5/6 sit IN the site-entrance gaps (z -9.5 / +9.5), not behind the
// site west walls: the old (13,-11.5)/(13,11.5) made links 5->7 and 6->8 cut
// straight through those walls, so any bot rotating to a site got stuck
// sliding on the wall face and never reached the bomb to defuse it.
export const NODES = [
  [-20, 0], [-14, -11.5], [-14, 11.5], [-4, -11.5], [-4, 11.5],
  [13, -9.5], [13, 9.5], [18.5, -12], [18.5, 12], [-10, 0],
  [0, 0], [6, 0], [12, 0], [20, 0],
];
export const LINKS = [
  [0, 1], [0, 2], [0, 9], [1, 3], [2, 4], [3, 5], [4, 6],
  [5, 7], [6, 8], [9, 10], [10, 11], [11, 12], [12, 13],
  [9, 1], [9, 2], [12, 5], [12, 6], [13, 5], [13, 6],
];
const ADJ = NODES.map(() => []);
for (const [a, b] of LINKS) { ADJ[a].push(b); ADJ[b].push(a); }

export function nearestNode(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < NODES.length; i++) {
    const dx = NODES[i][0] - x, dz = NODES[i][1] - z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Breadth-first path of node indices from (x0,z0) to (x1,z1). No allocation
// beyond the returned array; callers reuse it as a queue of waypoints.
export function findPath(x0, z0, x1, z1) {
  const start = nearestNode(x0, z0), goal = nearestNode(x1, z1);
  if (start === goal) return [goal];
  const prev = new Int16Array(NODES.length).fill(-1);
  const queue = [start];
  prev[start] = start;
  for (let qi = 0; qi < queue.length; qi++) {
    const n = queue[qi];
    if (n === goal) break;
    for (const m of ADJ[n]) if (prev[m] === -1) { prev[m] = n; queue.push(m); }
  }
  if (prev[goal] === -1) return [goal];
  const path = [goal];
  for (let n = goal; prev[n] !== n; n = prev[n]) path.unshift(prev[n]);
  return path;
}

// Axis-separated circle vs AABB slide: move x, resolve, then z. Returns the
// corrected position; the caller keeps its own velocity.
export function moveCircle(x, z, dx, dz, r) {
  let nx = x + dx;
  for (const b of BOXES) {
    if (nx + r > b[0] && nx - r < b[2] && z + r > b[1] && z - r < b[3]) {
      if (dx > 0) nx = b[0] - r;
      else if (dx < 0) nx = b[2] + r;
      else nx = x;
    }
  }
  nx = Math.max(BOUNDS.x0 + r, Math.min(BOUNDS.x1 - r, nx));
  let nz = z + dz;
  for (const b of BOXES) {
    if (nx + r > b[0] && nx - r < b[2] && nz + r > b[1] && nz - r < b[3]) {
      if (dz > 0) nz = b[1] - r;
      else if (dz < 0) nz = b[3] + r;
      else nz = z;
    }
  }
  nz = Math.max(BOUNDS.z0 + r, Math.min(BOUNDS.z1 - r, nz));
  return [nx, nz];
}

// Segment vs wall AABBs in 2D with a height check at the crossing point.
// Only full-height walls block sight; low crates do not.
export function losBlocked(x0, y0, z0, x1, y1, z1) {
  const dx = x1 - x0, dz = z1 - z0, dy = y1 - y0;
  for (const b of WALLS) {
    if (b[4] < 2.4) continue;
    let t0 = 0, t1 = 1;
    let hit = true;
    for (let axis = 0; axis < 2; axis++) {
      const o = axis === 0 ? x0 : z0, d = axis === 0 ? dx : dz;
      // Wall format is [x0, z0, x1, z1, h]: the x interval is b[0],b[2],
      // the z interval is b[1],b[3] — NOT b[2],b[4] (that reads x1 and
      // the height as a z range, which made LOS wrong: bots were seen
      // through walls on one side of the map and invisible through open
      // gaps on the other).
      const lo = axis === 0 ? b[0] : b[1], hi = axis === 0 ? b[2] : b[3];
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { hit = false; break; } }
      else {
        let ta = (lo - o) / d, tb = (hi - o) / d;
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) { hit = false; break; }
      }
    }
    if (hit && y0 + dy * t0 < b[4] - 0.05) return true;
  }
  return false;
}

export function inSite(x, z, site) {
  const s = SITES[site];
  const dx = x - s.x, dz = z - s.z;
  return dx * dx + dz * dz < s.r * s.r;
}
