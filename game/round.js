// Round and match flow: buy phase -> live round -> result -> next buy, until
// one team reaches 5 rounds or 9 rounds are played. Money awards and the
// buy catalogue live here with the economy; the HUD only renders them.
import {
  PHASES, BUY_TIME, ROUND_TIME, WIN_ROUNDS, MAX_ROUNDS,
  WIN_MONEY, LOSS_MONEY, KILL_MONEY, START_MONEY, pushEvent,
} from './state.js';
import { WEAPONS, GRENADE, ARMOR, AMMO_PACK, newWeaponState } from './weapons.js';
import { SPAWNS } from './map.js';
import { resetBotsForRound } from './bots.js';

export const SHOP = [
  { id: 'rifle', name: 'VECT-9 RIFLE', price: WEAPONS.rifle.price, desc: 'Auto rifle · 25 mag · precise' },
  { id: 'grenade', name: 'FLARE-6 GRENADE', price: GRENADE.price, desc: 'Frag · 6 m radius' },
  { id: 'armor', name: 'PLATE-1 ARMOR', price: ARMOR.price, desc: '100 armor · absorbs half' },
  { id: 'ammo', name: 'AMMO REFILL', price: AMMO_PACK.price, desc: 'Full reserve for both guns' },
];

export function buy(S, id) {
  const p = S.player;
  if (S.phase !== PHASES.BUY || !p.alive) return false;
  const item = SHOP.find((s) => s.id === id);
  if (!item || S.money < item.price) return false;
  if (id === 'rifle') {
    if (p.hasRifle) return false;
    p.hasRifle = true;
    p.weapons.rifle = newWeaponState('rifle');
    p.cur = 'rifle';
  } else if (id === 'grenade') {
    if (p.nades >= 1) return false;
    p.nades = 1;
  } else if (id === 'armor') {
    if (p.hasArmor) return false;
    p.hasArmor = true;
    p.armor = ARMOR.points;
  } else if (id === 'ammo') {
    for (const k of ['rifle', 'shotgun']) {
      const w = p.weapons[k];
      if (w.mag + w.reserve > 0) w.reserve = WEAPONS[k].reserveMax;
    }
  }
  S.money -= item.price;
  pushEvent(S, { kind: 'buy', item: item.name });
  return true;
}

export function startBuyPhase(S) {
  S.phase = PHASES.BUY;
  S.roundTime = BUY_TIME;
  S.winner = null;
  S.winReason = '';
  S.bomb.state = 'carry';
  S.bomb.carrier = 'player';
  S.bomb.site = null;
  S.bomb.timer = 0; S.bomb.plantP = 0; S.bomb.defuseP = 0; S.bomb.defuser = null; S.bomb.doneReason = null;
  S.nades = [];
  const p = S.player;
  const sp = SPAWNS.kite[0];
  p.x = sp[0]; p.z = sp[1]; p.yaw = -Math.PI / 2; p.pitch = 0;
  p.vx = 0; p.vz = 0; p.hp = 100; p.alive = true; p.planting = 0; p.defusing = 0;
  p.armor = p.hasArmor ? ARMOR.points : 0;
  p.weapons.rifle = p.hasRifle ? p.weapons.rifle : newWeaponState('rifle');
  if (!p.hasRifle) { p.weapons.rifle.mag = 0; p.weapons.rifle.reserve = 0; }
  p.weapons.shotgun = newWeaponState('shotgun');
  p.cur = p.hasRifle ? 'rifle' : 'shotgun';
  resetBotsForRound(S);
  pushEvent(S, { kind: 'buyPhase', round: S.round });
}

export function startLive(S) {
  S.phase = PHASES.LIVE;
  S.roundTime = ROUND_TIME;
  pushEvent(S, { kind: 'roundStart', round: S.round });
}

export function endRound(S, winner, reason) {
  if (S.phase === PHASES.OVER || S.phase === PHASES.MATCH) return;
  S.phase = PHASES.OVER;
  S.winner = winner;
  S.winReason = reason;
  S.roundTime = 4.5; // result screen dwell
  if (winner === 'kite') S.scoreKite += 1; else S.scoreAnvil += 1;
  S.money += winner === 'kite' ? WIN_MONEY : LOSS_MONEY;
  pushEvent(S, { kind: 'roundEnd', winner, reason });
  if (S.scoreKite >= WIN_ROUNDS || S.scoreAnvil >= WIN_ROUNDS || S.round >= MAX_ROUNDS) {
    S.matchWinner = S.scoreKite > S.scoreAnvil ? 'kite' : S.scoreAnvil > S.scoreKite ? 'anvil' : 'draw';
  }
}

export function stepRound(S, dt) {
  if (S.phase === PHASES.BUY) {
    S.roundTime -= dt;
    if (S.roundTime <= 0) startLive(S);
  } else if (S.phase === PHASES.LIVE) {
    S.roundTime -= dt;
    if (S.roundTime <= 0) endRound(S, 'anvil', 'TIME EXPIRED — CHARGE NEVER PLANTED');
    else {
      const kiteAlive = S.player.alive || S.bots.some((b) => b.team === 'kite' && b.alive);
      const anvilAlive = S.bots.some((b) => b.team === 'anvil' && b.alive);
      if (S.bomb.state === 'planted') {
        // Planted: elimination alone does not end the round — the bomb does.
        if (!anvilAlive) endRound(S, 'kite', 'CHARGE PLANTED — NO DEFENDERS LEFT');
      } else if (!anvilAlive) {
        endRound(S, 'kite', 'ALL ANVIL OPERATIVES DOWN');
      } else if (!kiteAlive) {
        endRound(S, 'anvil', 'ALL KITE OPERATIVES DOWN');
      }
    }
  } else if (S.phase === PHASES.OVER) {
    S.roundTime -= dt;
    if (S.roundTime <= 0) {
      if (S.matchWinner) { S.phase = PHASES.MATCH; }
      else { S.round += 1; startBuyPhase(S); }
    }
  }
}

export function restartMatch(S) {
  S.round = 1;
  S.scoreKite = 0; S.scoreAnvil = 0;
  S.matchWinner = null;
  S.money = START_MONEY;
  S.kills = 0; S.deaths = 0;
  const p = S.player;
  p.hasRifle = false; p.hasArmor = false; p.nades = 0; p.cur = 'shotgun';
  startBuyPhase(S);
}

export function awardKill(S) {
  S.kills += 1;
  S.money += KILL_MONEY;
}
