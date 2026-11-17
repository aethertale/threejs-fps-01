// MERIDIAN TERMINAL — all mutable match state lives here, in one place.
// Modules read and write this object; none of them keeps a second copy of
// round, player, bot, weapon or economy numbers.
export function mulberry32(initial) {
  let a = initial | 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PHASES = { MENU: 'menu', BUY: 'buy', LIVE: 'live', OVER: 'over', MATCH: 'match' };
export const TEAMS = { KITE: 'kite', ANVIL: 'anvil' };
export const WIN_ROUNDS = 5;      // first to 5
export const MAX_ROUNDS = 9;
export const BUY_TIME = 15;       // seconds of buy phase
export const ROUND_TIME = 100;    // seconds of live round
export const BOMB_TIME = 35;      // seconds from plant to detonation
export const PLANT_TIME = 3.0;    // seconds holding E to plant
export const DEFUSE_TIME = 5.0;   // seconds holding E to defuse
export const START_MONEY = 3000;
export const WIN_MONEY = 3250;
export const LOSS_MONEY = 1900;
export const KILL_MONEY = 300;
export const PLANT_MONEY = 300;

export function createState(seed) {
  return {
    seed,
    rand: mulberry32(seed),
    time: 0,
    phase: PHASES.MENU,
    round: 1,
    scoreKite: 0,
    scoreAnvil: 0,
    roundTime: 0,
    winner: null,          // 'kite' | 'anvil'
    winReason: '',
    matchWinner: null,
    money: START_MONEY,
    kills: 0,
    deaths: 0,
    player: {
      x: -20, z: 0, yaw: -Math.PI / 2, pitch: 0,
      vx: 0, vz: 0, eye: 1.62, crouch: false,
      hp: 100, armor: 0, alive: true,
      cur: 'shotgun', hasRifle: false, hasArmor: false, nades: 0,
      recoil: 0, recoilYaw: 0, planting: 0, defusing: 0,
      weapons: {
        rifle: { defKey: 'rifle', mag: 0, reserve: 0, cool: 0, reload: 0, kick: 0 },
        shotgun: { defKey: 'shotgun', mag: 6, reserve: 24, cool: 0, reload: 0, kick: 0 },
      },
    },
    bots: [],
    bomb: {
      state: 'carry',      // carry | planted | dropped | done
      carrier: 'player',   // 'player' | bot id | null
      site: null,          // 'A' | 'B'
      x: 0, z: 0, timer: 0, plantP: 0, defuseP: 0, defuser: null,
    },
    nades: [],
    events: [],
    _evOut: [],
    sounds: [],
  };
}

export function pushEvent(S, ev) {
  if (S.events.length < 64) S.events.push(ev);
}

export function drainEvents(S) {
  // Reuses one scratch array: no allocation per frame in the hot loop.
  const out = S._evOut;
  out.length = 0;
  for (let i = 0; i < S.events.length; i++) out.push(S.events[i]);
  S.events.length = 0;
  return out;
}
