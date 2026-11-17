// Fixed-step simulation: one step() advances the whole match by 1/60 s.
// Order is deliberate: round clock, player, weapons, bots, grenades, objective,
// then bomb-end checks. Shooting is resolved here against the renderer's
// raycast so bots and the player share exactly one damage path.
import { PHASES, pushEvent } from './state.js';
import { WEAPONS, GRENADE, damageAt, spreadFor, stepWeapon, startReload, takeShot, throwVelocity } from './weapons.js';
import { stepPlayer } from './player.js';
import { stepBots } from './bots.js';
import { stepObjective, dropBomb } from './objective.js';
import { stepRound, endRound, awardKill } from './round.js';
import { moveCircle, RADIUS, losBlocked } from './map.js';

const STEP = 1 / 60;
const EYE = 1.5;

export function step(S, input, render, dt) {
  S.time += dt;
  for (let i = S.sounds.length - 1; i >= 0; i--) {
    if (S.time - S.sounds[i].t >= 1.5) S.sounds.splice(i, 1);
  }
  stepRound(S, dt);
  if (S.phase === PHASES.BUY || S.phase === PHASES.LIVE) {
    stepPlayer(S, input.keys, dt);
    for (const k of ['rifle', 'shotgun']) stepWeapon(S.player.weapons[k], dt);
    if (S.phase === PHASES.LIVE) {
      stepBots(S, dt, (s, bot, target, dist) => botFire(S, render, bot, target, dist));
      stepGrenades(S, dt);
      stepObjective(S, dt, input.keys.has('KeyE'));
      if (S.bomb.state === 'done' && S.bomb.doneReason) {
        const r = S.bomb.doneReason;
        S.bomb.doneReason = null;
        if (r === 'explode') endRound(S, 'kite', `CHARGE DETONATED AT SITE ${S.bomb.site}`);
        else endRound(S, 'anvil', 'CHARGE DEFUSED');
      }
    }
  }
}

// One hitscan resolution for player and bots alike. Origin and direction are
// world-space; the shooter never hits itself or a teammate.
export function resolveShot(S, render, shooter, ox, oy, oz, dx, dy, dz, def, spread) {
  const rand = S.rand;
  const results = [];
  for (let p = 0; p < (def.pellets || 1); p++) {
    const sx = dx + (rand() * 2 - 1) * spread;
    const sy = dy + (rand() * 2 - 1) * spread;
    const sz = dz + (rand() * 2 - 1) * spread;
    const hit = render.raycast(ox, oy, oz, sx, sy, sz, 90);
    const end = hit ? { x: hit.x, y: hit.y, z: hit.z } : { x: ox + sx * 90, y: oy + sy * 90, z: oz + sz * 90 };
    pushEvent(S, { kind: 'tracer', ax: ox, ay: oy, az: oz, bx: end.x, by: end.y, bz: end.z });
    if (!hit) continue;
    if (hit.kind === 'bot' || hit.kind === 'player') {
      const victim = hit.kind === 'bot' ? hit.bot : S.player;
      const vTeam = hit.kind === 'bot' ? hit.bot.team : 'kite';
      const sTeam = shooter.team;
      if (vTeam === sTeam) {
        pushEvent(S, { kind: 'impact', x: hit.x, y: hit.y, z: hit.z });
        continue;
      }
      const dmg = damageAt(def, hit.dist, hit.part === 'head');
      const killed = applyDamage(S, victim, dmg, shooter);
      pushEvent(S, { kind: 'hit', by: shooter.name, byTeam: sTeam, victim: victim.name || 'YOU', victimTeam: vTeam, dmg: Math.round(dmg), head: hit.part === 'head', killed });
      if (hit.kind === 'player') pushEvent(S, { kind: 'hurt', dmg: Math.round(dmg), from: shooter.name });
      if (killed) onKill(S, shooter, victim, hit.part === 'head');
      results.push({ hit, dmg, killed });
    } else {
      pushEvent(S, { kind: 'impact', x: hit.x, y: hit.y, z: hit.z });
    }
  }
  return results;
}

function applyDamage(S, victim, dmg, shooter) {
  let rest = dmg;
  if (victim.armor > 0) {
    const absorbed = Math.min(victim.armor, rest * 0.5);
    victim.armor -= absorbed;
    rest -= absorbed;
  }
  victim.hp -= rest;
  if (victim.hp <= 0) { victim.hp = 0; victim.alive = false; return true; }
  return false;
}

function onKill(S, shooter, victim, head) {
  const sTeam = shooter.team;
  const vTeam = victim === S.player ? 'kite' : victim.team;
  const vName = victim === S.player ? 'YOU' : victim.name;
  pushEvent(S, { kind: 'kill', by: shooter.name, byTeam: sTeam, victim: vName, victimTeam: vTeam, head });
  if ((shooter === S.player || shooter.name === 'YOU') && victim !== S.player) awardKill(S);
  if (victim === S.player) {
    S.deaths += 1;
    if (S.bomb.carrier === 'player') dropBomb(S, S.player.x, S.player.z);
  } else if (S.bomb.carrier === victim.id) {
    dropBomb(S, victim.x, victim.z);
  }
}

// Player fire: camera direction + spread from movement; recoil kicks pitch.
export function playerFire(S, render) {
  const p = S.player;
  if (!p.alive || S.phase !== PHASES.LIVE) return;
  const def = WEAPONS[p.cur];
  const w = p.weapons[p.cur];
  if (!takeShot(w, def)) return;
  const spread = spreadFor(def, p.speed2d, p.speed2d > 0.5);
  const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  const dx = -Math.sin(p.yaw) * cp, dy = sp, dz = -Math.cos(p.yaw) * cp;
  pushEvent(S, { kind: 'shot', by: 'player', x: p.x, y: p.eye, z: p.z });
  S.sounds.push({ x: p.x, z: p.z, t: S.time });
  p.recoil += def.recoilPitch;
  p.recoilYaw += (S.rand() * 2 - 1) * def.recoilYaw;
  resolveShot(S, render, { team: 'kite', name: 'YOU' }, p.x, p.eye, p.z, dx, dy, dz, def, spread);
}

function botFire(S, render, bot, target, dist) {
  const eyeY = target.kind === 'player' ? target.y : EYE;
  const dx = target.x - bot.x, dy = eyeY - EYE, dz = target.z - bot.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  const err = bot.aimErr;
  const jx = (S.rand() * 2 - 1) * err, jy = (S.rand() * 2 - 1) * err;
  pushEvent(S, { kind: 'shot', by: bot.name, x: bot.x, y: EYE, z: bot.z });
  S.sounds.push({ x: bot.x, z: bot.z, t: S.time });
  resolveShot(S, render, bot, bot.x, EYE, bot.z,
    dx / len + jx, dy / len + jy, dz / len + (S.rand() * 2 - 1) * err,
    { dmg: 12, headMult: 2.5, pellets: 1, falloffStart: 30, falloffEnd: 60 }, 0);
}

// Grenades: ballistic arc, one floor bounce, fuse, radius damage halved
// through walls.
function stepGrenades(S, dt) {
  for (let i = S.nades.length - 1; i >= 0; i--) {
    const g = S.nades[i];
    g.t -= dt;
    g.vy -= 12 * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    if (g.y < 0.12) { g.y = 0.12; g.vy *= -0.4; g.vx *= 0.7; g.vz *= 0.7; }
    if (g.t <= 0) {
      S.nades.splice(i, 1);
      pushEvent(S, { kind: 'explode', x: g.x, y: g.y, z: g.z, nade: true });
      const victims = [S.player, ...S.bots.filter((b) => b.alive)];
      for (const v of victims) {
        if (!v.alive) continue;
        const d = Math.hypot(v.x - g.x, v.z - g.z);
        if (d > GRENADE.radius) continue;
        let dmg = GRENADE.dmgMax - ((GRENADE.dmgMax - GRENADE.dmgMin) * d) / GRENADE.radius;
        if (losBlocked(g.x, 0.6, g.z, v.x, 1.2, v.z)) dmg *= 0.5;
        const killed = applyDamage(S, v, dmg, g.owner);
        if (killed) onKill(S, g.owner, v, false);
      }
    }
  }
}

export function throwGrenade(S) {
  const p = S.player;
  if (!p.alive || S.phase !== PHASES.LIVE || p.nades <= 0) return false;
  p.nades -= 1;
  const v = throwVelocity(p.yaw, p.pitch);
  S.nades.push({ x: p.x, y: p.eye - 0.2, z: p.z, vx: v.x, vy: v.y, vz: v.z, t: GRENADE.fuse, owner: { team: 'kite', name: 'YOU' } });
  pushEvent(S, { kind: 'throw', by: 'YOU' });
  return true;
}

export function playerReload(S) {
  const p = S.player;
  if (!p.alive) return;
  const def = WEAPONS[p.cur];
  if (startReload(p.weapons[p.cur], def)) pushEvent(S, { kind: 'reload', weapon: def.name });
}

export function switchWeapon(S, key) {
  const p = S.player;
  if (!p.alive) return;
  if (key === 'rifle' && p.hasRifle) p.cur = 'rifle';
  if (key === 'shotgun') p.cur = 'shotgun';
}
