// Bomb objective: carry, plant (hold E in a site), planted countdown, defuse
// (hold E at the bomb), dropped pickup. Plant/defuse progress only advances
// while the actor stands in the zone holding E; moving out or dying resets it.
// The carrier is the player by default; a KITE bot fetches a dropped bomb and
// plants it at the nearer site. Defenders defuse when they reach the bomb.
import { SITES, inSite, findPath, NODES } from './map.js';
import { PLANT_TIME, DEFUSE_TIME, BOMB_TIME, PLANT_MONEY, pushEvent } from './state.js';

export function nearestSite(x, z) {
  const da = Math.hypot(x - SITES.A.x, z - SITES.A.z);
  const db = Math.hypot(x - SITES.B.x, z - SITES.B.z);
  return da < db ? 'A' : 'B';
}

function carrierBot(S) {
  return S.bots.find((b) => b.alive && b.team === 'kite' && S.bomb.carrier === b.id) || null;
}

export function stepObjective(S, dt, holdingE) {
  const B = S.bomb;
  if (B.state === 'carry') {
    // Dropped-bomb pickup by the player or the nearest KITE bot.
    if (B.carrier === null) {
      const p = S.player;
      if (p.alive && Math.hypot(p.x - B.x, p.z - B.z) < 1.2) {
        B.carrier = 'player';
        pushEvent(S, { kind: 'pickup', by: 'player' });
      } else {
        for (const b of S.bots) {
          if (b.team === 'kite' && b.alive && Math.hypot(b.x - B.x, b.z - B.z) < 1.2) {
            B.carrier = b.id;
            pushEvent(S, { kind: 'pickup', by: b.name });
            break;
          }
        }
      }
      // Send the nearest living KITE bot to fetch it.
      if (B.carrier === null) {
        let best = null, bd = Infinity;
        for (const b of S.bots) {
          if (b.team !== 'kite' || !b.alive) continue;
          const d = Math.hypot(b.x - B.x, b.z - B.z);
          if (d < bd) { bd = d; best = b; }
        }
        if (best && best.mode !== 'fetch') {
          best.mode = 'fetch';
          best.path = findPath(best.x, best.z, B.x, B.z);
          best.pathI = 0;
        }
      }
    }
    // Planting: carrier stands in a site holding E.
    const carrier = B.carrier === 'player' ? S.player : carrierBot(S);
    if (carrier && carrier.alive !== false) {
      const site = inSite(carrier.x, carrier.z, 'A') ? 'A' : inSite(carrier.x, carrier.z, 'B') ? 'B' : null;
      const wantsPlant = B.carrier === 'player' ? holdingE : true;
      if (site && wantsPlant) {
        B.plantP += dt / PLANT_TIME;
        if (B.carrier === 'player') S.player.planting = B.plantP;
        if (B.plantP >= 1) plant(S, site);
      } else {
        B.plantP = 0;
        if (B.carrier === 'player') S.player.planting = 0;
      }
      // A carrier bot that is not at a site walks to the nearer one.
      if (B.carrier !== 'player' && carrier && !site) {
        const bot = carrierBot(S);
        if (bot && bot.mode !== 'plant') {
          bot.mode = 'plant';
          const s = nearestSite(bot.x, bot.z);
          bot.path = findPath(bot.x, bot.z, SITES[s].x, SITES[s].z);
          bot.pathI = 0;
          bot.plantSite = s;
        }
      }
    }
  } else if (B.state === 'planted') {
    B.timer -= dt;
    // Defuse: an ANVIL bot stands at the bomb. (The player is KITE and
    // never defuses; only ANVIL bots do.)
    let defuser = null;
    for (const b of S.bots) {
      if (b.team === 'anvil' && b.alive && Math.hypot(b.x - B.x, b.z - B.z) < 1.6) { defuser = b; break; }
    }
    if (defuser) {
      B.defuseP += dt / DEFUSE_TIME;
      B.defuser = defuser.id;
      defuser.mode = 'defuse';
      if (B.defuseP >= 1) {
        B.state = 'done';
        B.doneReason = 'defuse';
        pushEvent(S, { kind: 'defused', by: defuser.name });
      }
    } else {
      B.defuseP = Math.max(0, B.defuseP - dt / DEFUSE_TIME);
      B.defuser = null;
    }
    if (B.timer <= 0 && B.state === 'planted') {
      B.state = 'done';
      B.doneReason = 'explode';
      pushEvent(S, { kind: 'explode', site: B.site, x: B.x, z: B.z });
    }
  }
}

function plant(S, site) {
  const B = S.bomb;
  B.state = 'planted';
  B.site = site;
  B.x = SITES[site].x; B.z = SITES[site].z;
  B.timer = BOMB_TIME;
  B.plantP = 0;
  S.player.planting = 0;
  if (B.carrier === 'player') S.money += PLANT_MONEY;
  pushEvent(S, { kind: 'planted', site });
  // Carrier bots stand guard; defenders get the rotate order in bots.js.
  for (const b of S.bots) {
    if (b.team === 'kite' && b.mode === 'plant') { b.mode = 'hold'; b.path = []; b.post = [B.x, B.z, 0]; }
    if (b.team === 'kite' && b.mode === 'fetch') { b.mode = 'patrol'; b.path = []; }
  }
}

export function dropBomb(S, x, z) {
  const B = S.bomb;
  if (B.state !== 'carry') return;
  B.carrier = null;
  B.x = x; B.z = z;
  B.plantP = 0;
  pushEvent(S, { kind: 'drop', x, z });
}

// Where the bomb blip renders: carried (carrier pos), dropped, or planted.
export function bombPos(S) {
  const B = S.bomb;
  if (B.state === 'planted' || (B.state === 'carry' && B.carrier === null)) return { x: B.x, z: B.z };
  if (B.carrier === 'player') return { x: S.player.x, z: S.player.z };
  const bot = carrierBot(S);
  return bot ? { x: bot.x, z: bot.z } : { x: B.x, z: B.z };
}
