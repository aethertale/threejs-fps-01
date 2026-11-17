// Weapon data and state transitions. No raycasting here: the sim resolves a
// shot against the renderer's scene and applies the damage this module
// computes. Two guns with genuinely different behavior: the VECT-9 rifle is
// a precise automatic; the MAUL-12 shotgun fires a 6-pellet spread with a
// pump delay and heavy falloff. The FLARE-6 is a thrown frag grenade.
export const WEAPONS = {
  rifle: {
    name: 'VECT-9', kind: 'rifle', price: 2700,
    magSize: 25, reserveMax: 75, fireGap: 0.11, auto: true,
    reloadTime: 2.1, dmg: 34, headMult: 3, pellets: 1,
    spreadStill: 0.003, spreadMove: 0.030, spreadAir: 0.05,
    recoilPitch: 0.011, recoilYaw: 0.004, falloffStart: 30, falloffEnd: 60,
  },
  shotgun: {
    name: 'MAUL-12', kind: 'shotgun', price: 0,
    magSize: 6, reserveMax: 24, fireGap: 0.9, auto: false,
    reloadTime: 2.6, dmg: 14, headMult: 1.6, pellets: 6,
    spreadStill: 0.045, spreadMove: 0.06, spreadAir: 0.08,
    recoilPitch: 0.028, recoilYaw: 0.012, falloffStart: 10, falloffEnd: 22,
  },
};
export const GRENADE = { name: 'FLARE-6', price: 300, radius: 6, dmgMax: 120, dmgMin: 20, fuse: 1.6 };
export const ARMOR = { name: 'PLATE-1', price: 650, points: 100 };
export const AMMO_PACK = { name: 'AMMO', price: 200 };

export function newWeaponState(key) {
  const def = WEAPONS[key];
  return { defKey: key, mag: def.magSize, reserve: def.reserveMax, cool: 0, reload: 0, kick: 0 };
}

export function spreadFor(def, speed2d, moving) {
  const base = speed2d > 0.5 ? def.spreadMove : def.spreadStill;
  return moving ? base * 1.35 : base;
}

// Damage at distance: full inside falloffStart, linear to 40% at falloffEnd.
export function damageAt(def, dist, head) {
  let d = def.dmg * (head ? def.headMult : 1);
  if (dist > def.falloffStart) {
    const t = Math.min(1, (dist - def.falloffStart) / (def.falloffEnd - def.falloffStart));
    d *= 1 - 0.6 * t;
  }
  return d;
}

export function weaponReady(w) {
  return w.mag > 0 && w.cool <= 0 && w.reload <= 0;
}

export function stepWeapon(w, dt) {
  w.cool = Math.max(0, w.cool - dt);
  w.kick += (0 - w.kick) * Math.min(1, dt * 12);
  if (w.reload > 0) {
    w.reload = Math.max(0, w.reload - dt);
    if (w.reload === 0) {
      const def = WEAPONS[w.defKey];
      const need = def.magSize - w.mag;
      const take = Math.min(need, w.reserve);
      w.mag += take; w.reserve -= take;
    }
  }
}

export function startReload(w, def) {
  if (w.reload > 0 || w.mag >= def.magSize || w.reserve <= 0) return false;
  w.reload = def.reloadTime;
  return true;
}

export function takeShot(w, def) {
  if (!weaponReady(w)) return false;
  w.mag -= 1;
  w.cool = def.fireGap;
  w.kick = 1;
  return true;
}

// Grenade throw: initial velocity from the thrower's look direction.
export function throwVelocity(yaw, pitch) {
  const speed = 13;
  return {
    x: -Math.sin(yaw) * Math.cos(pitch) * speed,
    y: Math.sin(pitch) * speed + 2.4,
    z: -Math.cos(yaw) * Math.cos(pitch) * speed,
  };
}
