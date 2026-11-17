// MERIDIAN TERMINAL — boot, the one loop, input wiring, deterministic captures.
// Architecture: state.js holds every number; sim.js advances it at a fixed
// 60 Hz; render.js draws it; hud.js shows it. Bots patrol, hold, investigate
// sound, attack, rotate after the plant and defuse; KITE plants the charge,
// ANVIL defends. First to 5 rounds, max 9.
import { createState, PHASES, drainEvents } from './state.js';
import { losBlocked } from './map.js';
import { createInput } from './input.js';
import { createBots } from './bots.js';
import { createHud } from './hud.js';
import { createRenderer } from './render.js';
import { createEffects } from './effects.js';
import { step, playerFire, playerReload, switchWeapon, throwGrenade } from './sim.js';
import { applyLook } from './player.js';
import { buy, startBuyPhase, startLive, restartMatch } from './round.js';
import { WEAPONS, spreadFor } from './weapons.js';

const STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

const S = createState(seed);
createBots(S);
const render = createRenderer(S);
const effects = createEffects(render.scene);
const hud = createHud();
const input = createInput(render.dom, onLockChange);
let started = false, frozen = false, buyOpen = false;
let accumulator = 0, lastTime = performance.now(), prevFiring = false;

hud.onPlay(onPlay);
hud.onBuy((id) => { if (buy(S, id)) hud.showBuy(S); });

function onPlay() {
  if (shot) return;
  if (S.phase === PHASES.MENU || S.phase === PHASES.MATCH) {
    restartMatch(S);
    started = true;
  } else if (S.phase === PHASES.OVER) {
    S.roundTime = 0.01; // skip the result dwell
  }
  hud.hideOverlay();
  input.requestLock();
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) { hud.hideOverlay(); }
  else if ((S.phase === PHASES.BUY || S.phase === PHASES.LIVE) && started) {
    hud.showOverlay('paused');
  }
}

function dispatchEvents(events) {
  hud.update(S, events);
  render.handleEvents(S, events);
  for (const ev of events) {
    if (ev.kind === 'tracer') effects.spawnTracer(ev.ax, ev.ay, ev.az, ev.bx, ev.by, ev.bz);
    else if (ev.kind === 'impact') effects.spawnImpact(ev.x, ev.y, ev.z, S.rand);
    else if (ev.kind === 'explode') effects.spawnExplosion(ev.x, ev.y, ev.z);
    else if (ev.kind === 'roundEnd') {
      hud.hideBuy();
      const award = ev.winner === 'kite' ? 3250 : 1900;
      hud.showOverlay('result', { winner: ev.winner, reason: ev.reason, scoreKite: S.scoreKite, scoreAnvil: S.scoreAnvil, award });
      input.exitLock();
    } else if (ev.kind === 'buyPhase') { buyOpen = true; }
    else if (ev.kind === 'roundStart') { hud.hideBuy(); buyOpen = false; }
  }
  if (S.phase === PHASES.MATCH) {
    hud.showOverlay('match', { matchWinner: S.matchWinner, scoreKite: S.scoreKite, scoreAnvil: S.scoreAnvil });
    input.exitLock();
  }
}

function handleKeys() {
  const p = S.player;
  if (input.wasPressed('KeyR')) playerReload(S);
  if (input.wasPressed('KeyG')) throwGrenade(S);
  if (S.phase === PHASES.BUY) {
    if (input.wasPressed('Digit1')) { if (buy(S, 'rifle')) hud.showBuy(S); }
    if (input.wasPressed('Digit2')) { if (buy(S, 'grenade')) hud.showBuy(S); }
    if (input.wasPressed('Digit3')) { if (buy(S, 'armor')) hud.showBuy(S); }
    if (input.wasPressed('Digit4')) { if (buy(S, 'ammo')) hud.showBuy(S); }
    if (input.wasPressed('Enter')) { hud.hideBuy(); buyOpen = false; startLive(S); }
    if (input.wasPressed('KeyB')) {
      buyOpen = !buyOpen;
      if (buyOpen) hud.showBuy(S); else hud.hideBuy();
    }
  } else if (S.phase === PHASES.LIVE) {
    if (input.wasPressed('Digit1')) switchWeapon(S, 'rifle');
    if (input.wasPressed('Digit2')) switchWeapon(S, 'shotgun');
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (frozen) { render.renderer.render(render.scene, render.camera); return; }
  const look = input.takeLook();
  if (input.locked || shot) applyLook(S, look.x, look.y);
  if (S.phase === PHASES.LIVE && S.player.alive) {
    const def = WEAPONS[S.player.cur];
    const edge = input.firing && !prevFiring;
    if ((def.auto && input.firing) || (!def.auto && edge)) playerFire(S, render);
  }
  prevFiring = input.firing;
  handleKeys();
  accumulator += dt;
  let steps = 0;
  while (accumulator >= STEP && steps < 5) {
    step(S, input, render, STEP);
    accumulator -= STEP;
    steps += 1;
  }
  if (accumulator > STEP * 5) accumulator = 0;
  dispatchEvents(drainEvents(S));
  const p = S.player;
  const def = WEAPONS[p.cur];
  hud.setCrosshair(4 + spreadFor(def, p.speed2d, p.speed2d > 0.5) * 320);
  effects.step(dt);
  render.sync(S, dt);
  render.renderer.render(render.scene, render.camera);
  input.clearPressed();
}

// Deterministic captures: real runtime states, same state objects and render
// path as normal play. ?shot=combat|plant|buy|result&seed=N, then
// window.__shotReady is set after two painted frames and the scene freezes.
function settle(n) { for (let i = 0; i < n; i++) step(S, input, render, STEP); }

function runShot(name) {
  restartMatch(S);
  started = true;
  if (name === 'buy') {
    S.money = 2450;
    S.player.hasRifle = false;
    S.player.x = -20; S.player.z = 0; S.player.yaw = -Math.PI / 2;
    settle(10);
    hud.hideOverlay();
    hud.showBuy(S);
  } else if (name === 'combat') {
    startLive(S);
    S.player.x = -2; S.player.z = 0; S.player.yaw = -Math.PI / 2; S.player.pitch = 0;
    S.player.hasRifle = true;
    S.player.weapons.rifle.mag = 25; S.player.weapons.rifle.reserve = 75;
    S.player.cur = 'rifle';
    const foe = S.bots.find((b) => b.team === 'anvil');
    foe.x = 9; foe.z = -1.5; foe.yaw = Math.PI / 2;
    const foe2 = S.bots.find((b) => b.team === 'anvil' && b !== foe);
    foe2.x = 12; foe2.z = 3; foe2.yaw = Math.PI / 2;
    settle(20);
    // Aim dead-on and fire once: real raycast, real hitmarker + tracer.
    const dx = foe.x - S.player.x, dz = foe.z - S.player.z;
    S.player.yaw = Math.atan2(-dx, -dz);
    S.player.pitch = Math.atan2(1.5 - S.player.eye, Math.hypot(dx, dz));
    playerFire(S, render);
    settle(6);
    hud.hideOverlay();
  } else if (name === 'plant') {
    startLive(S);
    S.player.x = 16.5; S.player.z = -12; S.player.yaw = Math.PI / 2; S.player.pitch = 0;
    S.player.hasRifle = true;
    S.player.weapons.rifle.mag = 18; S.player.weapons.rifle.reserve = 50;
    S.player.cur = 'rifle';
    S.bomb.plantP = 0.6;
    S.player.planting = 0.6;
    const ally = S.bots.find((b) => b.team === 'kite');
    ally.x = 13; ally.z = -9; ally.yaw = -Math.PI / 2;
    const foe = S.bots.find((b) => b.team === 'anvil');
    foe.x = 19; foe.z = -8.5; foe.yaw = Math.PI / 2;
    settle(10);
    hud.hideOverlay();
  } else if (name === 'result') {
    S.scoreKite = 2; S.scoreAnvil = 1;
    startLive(S);
    S.winner = 'kite';
    S.winReason = 'CHARGE DETONATED AT SITE A';
    S.phase = PHASES.OVER;
    S.scoreKite = 3;
    S.money += 3250;
    hud.showOverlay('result', { winner: 'kite', reason: S.winReason, scoreKite: 3, scoreAnvil: 1, award: 3250 });
    settle(5);
  } else {
    // start: title view down the mid lane from spawn.
    S.player.x = -20; S.player.z = 0; S.player.yaw = -Math.PI / 2;
    settle(10);
  }
  dispatchEvents(drainEvents(S));
  hud.update(S, []);
  render.sync(S, 0);
  let painted = 0;
  (function paint() {
    requestAnimationFrame(paint);
    render.sync(S, 0);
    render.renderer.render(render.scene, render.camera);
    painted += 1;
    if (painted === 2) { window.__shotReady = true; frozen = true; }
  })();
}

window.addEventListener('resize', () => render.resize());

// Small test hooks for the headless driver: they call the same step() the
// live loop calls; nothing here bypasses the sim.
window.__fps01 = {
  los(x0, y0, z0, x1, y1, z1) { return losBlocked(x0, y0, z0, x1, y1, z1); },
  state: S,
  step(n) {
    for (let i = 0; i < n; i++) step(S, input, render, STEP);
    // Keep the scene graph in sync with state: the raycast tests mesh
    // world matrices, and a headless driver advances the sim in chunks
    // between renders, so without this the meshes lag the state by seconds
    // and every aimed shot misses. The live loop renders every frame, so
    // this is a no-op there.
    render.sync(S, 0);
    render.scene.updateMatrixWorld(true);
    dispatchEvents(drainEvents(S));
  },
  simulate(seconds) { const n = Math.round(seconds / STEP); this.step(n); },
  setLook(yaw, pitch) { S.player.yaw = yaw; S.player.pitch = pitch; },
  teleport(x, z) { S.player.x = x; S.player.z = z; },
  startMatch() { if (S.phase === PHASES.MENU) { restartMatch(S); started = true; } },
  fire() { playerFire(S, render); },
  reload() { playerReload(S); },
  grenade() { throwGrenade(S); },
  keys: input.keys,
  buy(id) { return buy(S, id); },
  live() { if (S.phase === PHASES.BUY) startLive(S); },
};

render.sync(S, 0);
hud.showOverlay('start');
if (shot) runShot(shot);
else requestAnimationFrame(frame);
