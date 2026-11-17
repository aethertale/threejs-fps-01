// Bots: a small state machine over a waypoint graph — patrol, hold, investigate
// (sound / last-known position), attack, rotate after the plant, plant, defuse,
// fetch a dropped bomb. Perception is distance + field of view + line of
// sight; aim is imperfect (reaction delay, burst fire, error that grows with
// target speed and range). Shooting itself is injected by the sim so this
// module never touches the renderer.
import { findPath, losBlocked, moveCircle, NODES, RADIUS, HOLD_POSTS, SPAWNS } from './map.js';

const BOT_GUN = { dmg: 12, headMult: 2.5, magSize: 25, fireGap: 0.13, reloadTime: 2.2 };
const EYE = 1.5, SEE_DIST = 26, FOV = 1.0, WALK = 3.4, AIM_SPEED = 6;
const NAMES = {
  kite: ['VEX', 'JUNO'],
  anvil: ['BRICK', 'MOSS', 'TALON', 'ORIN'],
};
const PATROLS = {
  kite: [[0, 9, 10, 11, 12, 5, 7], [0, 9, 10, 11, 12, 6, 8]],
  anvil: [[13, 12, 11, 10, 9, 1, 3, 5, 13], [13, 12, 11, 10, 9, 2, 4, 6, 13]],
};

export function createBots(S) {
  const bots = [];
  for (let i = 0; i < 2; i++) {
    bots.push(makeBot(S, `k${i}`, 'kite', NAMES.kite[i], SPAWNS.kite[i + 1], 'patrol'));
  }
  for (let i = 0; i < 4; i++) {
    const post = i < 2 ? HOLD_POSTS.A[i] : HOLD_POSTS.B[i - 2];
    bots.push(makeBot(S, `a${i}`, 'anvil', NAMES.anvil[i], SPAWNS.anvil[i], 'hold', post));
  }
  S.bots = bots;
  return bots;
}

function makeBot(S, id, team, name, spawn, mode, post) {
  return {
    id, team, name, x: spawn[0], z: spawn[1], yaw: team === 'kite' ? -Math.PI / 2 : Math.PI / 2,
    pitch: 0, hp: 100, alive: true, mode, post: post || null,
    path: [], pathI: 0, patrolI: 0, patrol: PATROLS[team][team === 'kite' ? (id === 'k0' ? 0 : 1) : (id === 'a0' || id === 'a2' ? 0 : 1)],
    enemy: null, lastSeen: null, reactT: 0, burstLeft: 0, burstT: 0, cool: 0,
    mag: BOT_GUN.magSize, reload: 0, scanT: Math.random() * 0.15, repathT: 0,
    strafe: 0, strafeT: 0, aimErr: 0, lookT: 0, speed: 0, plantT: 0, defuseT: 0,
    fetchBomb: false, yawTarget: 0,
  };
}

function angleTo(b, x, z) {
  return Math.atan2(-(x - b.x), -(z - b.z));
}
function turnToward(b, target, rate, dt) {
  let d = target - b.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const step = Math.max(-rate * dt, Math.min(rate * dt, d));
  b.yaw += step;
  return Math.abs(d) < 0.05;
}

function canSee(S, b, tx, ty, tz) {
  const dx = tx - b.x, dz = tz - b.z, dist = Math.hypot(dx, dz);
  if (dist > SEE_DIST) return false;
  const ang = Math.atan2(-dx, -dz);
  let d = ang - b.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) > FOV) return false;
  return !losBlocked(b.x, EYE, b.z, tx, ty, tz);
}

function enemiesOf(S, b) {
  const out = [];
  if (b.team === 'anvil') {
    if (S.player.alive) out.push({ kind: 'player', x: S.player.x, z: S.player.z, y: S.player.eye, ref: S.player });
    for (const o of S.bots) if (o.team === 'kite' && o.alive) out.push({ kind: 'bot', x: o.x, z: o.z, y: EYE, ref: o });
  } else {
    for (const o of S.bots) if (o.team === 'anvil' && o.alive) out.push({ kind: 'bot', x: o.x, z: o.z, y: EYE, ref: o });
  }
  return out;
}

function scan(S, b) {
  b.enemy = null;
  let best = Infinity;
  for (const e of enemiesOf(S, b)) {
    const d = Math.hypot(e.x - b.x, e.z - b.z);
    if (d < best && canSee(S, b, e.x, e.y, e.z)) { best = d; b.enemy = e; }
  }
  if (b.enemy) {
    b.lastSeen = { x: b.enemy.x, z: b.enemy.z, t: S.time };
    if (b.mode !== 'attack') { b.mode = 'attack'; b.reactT = 0.35 + S.rand() * 0.25; b.burstLeft = 0; }
  }
}

function followPath(S, b, dt, speed) {
  if (!b.path.length || b.pathI >= b.path.length) return true;
  const n = NODES[b.path[b.pathI]];
  const dx = n[0] - b.x, dz = n[1] - b.z, d = Math.hypot(dx, dz);
  if (d < 0.7) { b.pathI += 1; return b.pathI >= b.path.length; }
  const vx = (dx / d) * speed, vz = (dz / d) * speed;
  const [nx, nz] = moveCircle(b.x, b.z, vx * dt, vz * dt, RADIUS);
  b.x = nx; b.z = nz;
  b.yawTarget = angleTo(b, n[0], n[1]);
  turnToward(b, b.yawTarget, AIM_SPEED, dt);
  b.speed = speed;
  return false;
}

function setPath(S, b, tx, tz) {
  b.path = findPath(b.x, b.z, tx, tz);
  b.pathI = 0;
}

function hear(S, b) {
  for (const s of S.sounds) {
    if (S.time - s.t > 1.2) continue;
    const d = Math.hypot(s.x - b.x, s.z - b.z);
    if (d < 18) return { x: s.x, z: s.z };
  }
  return null;
}

export function stepBots(S, dt, fire) {
  for (const b of S.bots) {
    if (!b.alive) continue;
    b.speed = 0;
    b.scanT -= dt;
    if (b.scanT <= 0) { b.scanT = 0.12 + S.rand() * 0.06; scan(S, b); }
    const heard = b.mode !== 'attack' ? hear(S, b) : null;
    if (heard && b.mode !== 'investigate' && b.mode !== 'plant' && b.mode !== 'defuse') {
      b.mode = 'investigate'; b.lastSeen = { x: heard.x, z: heard.z, t: S.time };
      setPath(S, b, heard.x, heard.z);
    }
    // After the plant: defenders rotate to the planted site, attackers hold it.
    if (S.bomb.state === 'planted' && (b.mode === 'hold' || b.mode === 'patrol' || b.mode === 'investigate')) {
      b.mode = 'rotate';
      setPath(S, b, 18.5, S.bomb.site === 'A' ? -12 : 12);
    }
    switch (b.mode) {
      case 'patrol': {
        const route = b.patrol;
        const node = route[b.patrolI % route.length];
        if (followPath(S, b, dt, WALK)) {
          // Arrived at the route node: advance the patrol loop.
          b.patrolI += 1;
          const next = route[b.patrolI % route.length];
          setPath(S, b, NODES[next][0], NODES[next][1]);
        } else if (!b.path.length) {
          setPath(S, b, NODES[node][0], NODES[node][1]);
        }
        break;
      }
      case 'hold': {
        if (!b.path.length && b.post) {
          // Walk to the hold post once, then scan from it.
          if (Math.hypot(b.post[0] - b.x, b.post[1] - b.z) > 0.5) setPath(S, b, b.post[0], b.post[1]);
          else { b.yawTarget = b.post[2]; turnToward(b, b.yawTarget, 2, dt); }
        } else if (b.path.length) {
          if (followPath(S, b, dt, WALK)) b.path = [];
        } else if (b.post) {
          // Slow sweep while holding.
          b.yawTarget = b.post[2] + Math.sin(S.time * 0.5 + b.id.charCodeAt(1)) * 0.7;
          turnToward(b, b.yawTarget, 1.2, dt);
        }
        break;
      }
      case 'investigate': {
        if (b.lastSeen && followPath(S, b, dt, WALK)) {
          b.lookT += dt;
          b.yaw += dt * 1.5;
          if (b.lookT > 2) {
            b.lookT = 0;
            b.mode = b.team === 'anvil' ? 'hold' : 'patrol';
            b.path = [];
          }
        }
        break;
      }
      case 'rotate': {
        if (S.bomb.state !== 'planted') { b.mode = b.team === 'anvil' ? 'hold' : 'patrol'; b.path = []; break; }
        if (followPath(S, b, dt, WALK)) {
          // At the planted site: defenders defuse, attackers guard.
          b.mode = b.team === 'anvil' ? 'defuse' : 'hold';
          b.path = [];
        }
        break;
      }
      case 'attack': {
        const e = b.enemy;
        if (!e || (e.kind === 'player' ? !S.player.alive : !e.ref.alive)) { b.enemy = null; b.mode = b.team === 'anvil' ? 'hold' : 'patrol'; b.path = []; break; }
        const dist = Math.hypot(e.x - b.x, e.z - b.z);
        const eyeY = e.kind === 'player' ? e.y : EYE;
        if (!canSee(S, b, e.x, eyeY, e.z)) {
          // Lost sight: chase the last known position.
          b.mode = 'investigate';
          if (b.lastSeen) setPath(S, b, b.lastSeen.x, b.lastSeen.z);
          break;
        }
        b.lastSeen = { x: e.x, z: e.z, t: S.time };
        // Aim with error that grows with range and target speed.
        const tSpeed = e.kind === 'player' ? S.player.speed2d : e.ref.speed;
        b.aimErr = 0.012 + dist * 0.0011 + tSpeed * 0.004;
        const desired = angleTo(b, e.x, e.z);
        turnToward(b, desired, AIM_SPEED, dt);
        b.pitch = Math.atan2(eyeY - EYE, dist) * 0.7;
        // Range keeping + strafe.
        b.strafeT -= dt;
        if (b.strafeT <= 0) { b.strafeT = 1 + S.rand(); b.strafe = S.rand() < 0.5 ? -1 : 1; }
        let mx = 0, mz = 0;
        if (dist > 15) { mx = e.x - b.x; mz = e.z - b.z; }
        else if (dist < 6) { mx = b.x - e.x; mz = b.z - e.z; }
        const ml = Math.hypot(mx, mz) || 1;
        const px = -mz / ml, pz = mx / ml; // perpendicular
        const vx = (mx / ml) * 2.2 + px * b.strafe * 1.6;
        const vz = (mz / ml) * 2.2 + pz * b.strafe * 1.6;
        const [nx, nz] = moveCircle(b.x, b.z, vx * dt, vz * dt, RADIUS);
        b.x = nx; b.z = nz;
        b.speed = Math.hypot(vx, vz);
        // Burst fire after the reaction delay.
        b.reactT -= dt;
        if (b.reactT <= 0) {
          b.cool -= dt;
          if (b.burstLeft <= 0) {
            b.burstT -= dt;
            if (b.burstT <= 0) { b.burstLeft = 3 + Math.floor(S.rand() * 3); b.burstT = 0.7 + S.rand() * 0.4; }
          } else if (b.cool <= 0) {
            if (b.reload > 0) { b.reload -= dt; if (b.reload <= 0) b.mag = BOT_GUN.magSize; }
            else if (b.mag <= 0) { b.reload = BOT_GUN.reloadTime; }
            else {
              b.mag -= 1; b.cool = BOT_GUN.fireGap; b.burstLeft -= 1;
              fire(S, b, e, dist);
            }
          }
        }
        break;
      }
      case 'plant': case 'fetch': {
        // Walk the assigned path (to a site, or to a dropped bomb); the
        // objective module advances plant progress / pickup on arrival.
        if (b.path.length) followPath(S, b, dt, WALK);
        break;
      }
      case 'defuse': break; // stands at the bomb; objective.js advances defuse
    }
    // Soft separation so bots never stack on each other or the player.
    for (const o of S.bots) {
      if (o === b || !o.alive) continue;
      const dx = b.x - o.x, dz = b.z - o.z, d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 0.8) { b.x += (dx / d) * 0.05; b.z += (dz / d) * 0.05; }
    }
    if (S.player.alive) {
      const dx = b.x - S.player.x, dz = b.z - S.player.z, d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 0.8) { b.x += (dx / d) * 0.05; b.z += (dz / d) * 0.05; }
    }
  }
}

export function resetBotsForRound(S) {
  let ki = 1;
  for (const b of S.bots) {
    if (b.team === 'kite') {
      const sp = SPAWNS.kite[ki++];
      b.x = sp[0]; b.z = sp[1];
      b.yaw = -Math.PI / 2;
    } else {
      // Defenders start the round already at their hold posts.
      b.x = b.post[0]; b.z = b.post[1];
      b.yaw = b.post[2];
    }
    b.pitch = 0; b.hp = 100; b.alive = true;
    b.mode = b.team === 'kite' ? 'patrol' : 'hold';
    b.path = []; b.pathI = 0; b.enemy = null; b.lastSeen = null;
    b.mag = BOT_GUN.magSize; b.reload = 0; b.cool = 0; b.burstLeft = 0;
    b.fetchBomb = false; b.plantT = 0; b.defuseT = 0;
  }
}

export { BOT_GUN };
