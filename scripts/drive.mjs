// Headless driver for MERIDIAN TERMINAL: launches the Playwright-cached Chrome
// over CDP (Node 22+ built-in WebSocket, no npm deps), loads the game, runs
// the shot modes, plays 3 rounds through the real sim (aimed fire, reload,
// grenade, collision, plant + defend, defuse, match end) and reports PASS/FAIL.
//
// Aiming rule: the driver only shoots at a bot with a clear line of sight
// (via the game's own losBlocked through __fps01.los), and aims + fires in a
// single eval so the bot cannot move between aim and shot. If every foe is
// behind a wall, the player repositions to the open plaza at (12, 0) first.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`;
const PORT = 9223;
const BASE = 'http://localhost:8080';
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail ?? '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
  return res.json();
}

class CDP {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map(); this.events = []; }
  async open() {
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && this.pending.has(d.id)) { this.pending.get(d.id)(d); this.pending.delete(d.id); }
      else if (d.method) this.events.push(d);
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res) => this.pending.set(id, res));
  }
  async eval(expr, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.result?.exceptionDetails) throw new Error(`eval failed: ${expr}\n${JSON.stringify(r.result.exceptionDetails).slice(0, 500)}`);
    return r.result?.result?.value;
  }
  async waitFor(expr, timeoutMs = 20000, pollMs = 250) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try { if (await this.eval(expr)) return true; } catch { /* page still loading */ }
      await sleep(pollMs);
    }
    return false;
  }
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) {
      writeFileSync(`/tmp/fps01-shot-${name}.png`, Buffer.from(r.result.data, 'base64'));
      return Buffer.from(r.result.data, 'base64').length;
    }
    return 0;
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox',
  '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1280,720', '--mute-audio', 'about:blank',
], { stdio: 'ignore' });

async function newPage(url) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const target = await res.json();
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return cdp;
}

async function main() {
  for (let i = 0; i < 40; i++) {
    try { await getJson('/json/version'); break; } catch { await sleep(250); }
  }

  // ---- 1. Plain load ----
  let cdp = await newPage(`${BASE}/`);
  await sleep(2500);
  const loaded = await cdp.eval(`!!window.__fps01 && !!document.querySelector('#game canvas')`);
  check('page loads, __fps01 + canvas exist', loaded);
  const gl = await cdp.eval(`(() => { const c = document.querySelector('#game canvas'); return c ? !!c.getContext('webgl2') : false; })()`);
  check('WebGL2 context alive', gl);
  const phase0 = await cdp.eval(`window.__fps01.state.phase`);
  check('initial phase is menu', phase0 === 'menu', `phase=${phase0}`);
  const botCount = await cdp.eval(`window.__fps01.state.bots.length`);
  check('6 bots created (2 KITE + 4 ANVIL)', botCount === 6, `bots=${botCount}`);
  const exc = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown');
  check('no page exceptions on load', exc.length === 0, exc.length ? JSON.stringify(exc[0]).slice(0, 300) : '');

  // ---- 2. Pointer lock: click the real #play button ----
  const btn = await cdp.eval(`(() => { const r = document.getElementById('play').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
  await sleep(800);
  const locked = await cdp.eval(`!!document.pointerLockElement`);
  check('pointer lock engages on Play click (headless)', locked, locked ? '' : 'headless may not grant lock; game still runs');
  const phaseBuy = await cdp.eval(`window.__fps01.state.phase`);
  check('match starts in buy phase', phaseBuy === 'buy', `phase=${phaseBuy}`);
  const overlayHidden = await cdp.eval(`document.getElementById('overlay').hidden`);
  check('start overlay hidden after Play', overlayHidden === true, `hidden=${overlayHidden}`);
  cdp.close();

  // ---- 3. Shot modes (deterministic captures) ----
  for (const name of ['combat', 'plant', 'buy', 'result', 'start']) {
    const p = await newPage(`${BASE}/?shot=${name}&seed=1`);
    const ready = await p.waitFor(`window.__shotReady === true`, 20000);
    check(`shot mode ${name} reaches __shotReady`, ready);
    if (ready) {
      const bytes = await p.shot(name);
      check(`shot ${name} screenshot non-blank`, bytes > 20000, `${bytes} bytes`);
    }
    p.close();
  }

  // ---- 4. Live play: 3 rounds through the real sim ----
  cdp = await newPage(`${BASE}/`);
  await sleep(2000);
  // Atomic aim+fire: pick nearest ANVIL bot with clear LOS from the player's
  // eye to the bot's head, set the look, fire in the same JS task.
  const shootOnce = `(() => {
    const S = window.__fps01.state;
    if (!S.player.alive) return { dead: true };
    const foes = S.bots.filter(b => b.team === 'anvil' && b.alive);
    if (!foes.length) return null;
    let best = null, bd = Infinity;
    for (const f of foes) {
      const d = Math.hypot(f.x - S.player.x, f.z - S.player.z);
      if (d < bd && !window.__fps01.los(S.player.x, S.player.eye, S.player.z, f.x, 1.6, f.z)) { bd = d; best = f; }
    }
    if (!best) return { blocked: true };
    const dx = best.x - S.player.x, dz = best.z - S.player.z;
    const dist = Math.hypot(dx, dz);
    window.__fps01.setLook(Math.atan2(-dx, -dz), Math.atan2(1.6 - S.player.eye, dist));
    window.__fps01.fire();
    return { id: best.id, dist: Math.round(dist * 10) / 10 };
  })()`;
  const killAll = async () => {
    for (let i = 0; i < 90; i++) {
      const t = await cdp.eval(shootOnce);
      if (!t) return true;
      if (t.blocked) {
        await cdp.eval(`window.__fps01.teleport(12, 0)`);
        await cdp.eval(`window.__fps01.simulate(0.3)`);
        continue;
      }
      if (t.dead) return false;
      await cdp.eval(`window.__fps01.simulate(0.16)`);
    }
    return (await cdp.eval(`window.__fps01.state.bots.filter(b => b.team === 'anvil' && b.alive).length`)) === 0;
  };
  const killNorth = async () => {
    // Same atomic aim+fire, but only at ANVIL bots on the north (Site A)
    // half — clears the site before a plant, as a human would.
    const shootNorth = shootOnce.replace(
      `b.team === 'anvil' && b.alive`,
      `b.team === 'anvil' && b.alive && b.z < 0`,
    );
    for (let i = 0; i < 40; i++) {
      const t = await cdp.eval(shootNorth);
      if (!t) return true;
      if (t.blocked) {
        await cdp.eval(`window.__fps01.teleport(12, 0)`);
        await cdp.eval(`window.__fps01.simulate(0.3)`);
        continue;
      }
      if (t.dead) return false;
      await cdp.eval(`window.__fps01.simulate(0.16)`);
    }
    return (await cdp.eval(`window.__fps01.state.bots.filter(b => b.team === 'anvil' && b.alive && b.z < 0).length`)) === 0;
  };
  const waitRoundEnd = async (maxSim = 40) => {
    for (let i = 0; i < maxSim; i++) {
      await cdp.eval(`window.__fps01.simulate(1)`);
      const st = await cdp.eval(`({ ph: window.__fps01.state.phase, w: window.__fps01.state.winner, r: window.__fps01.state.winReason, bs: window.__fps01.state.bomb.state })`);
      if (st.ph === 'over') return st;
    }
    return cdp.eval(`({ ph: window.__fps01.state.phase, w: window.__fps01.state.winner, r: window.__fps01.state.winReason, bs: window.__fps01.state.bomb.state })`);
  };

  // Round 1: buy rifle + grenade, fight, win by elimination.
  await cdp.eval(`window.__fps01.startMatch()`);
  await cdp.eval(`window.__fps01.buy('rifle')`);
  const moneyAfterRifle = await cdp.eval(`window.__fps01.state.money`);
  check('buy rifle: $3000 -> $300', moneyAfterRifle === 300, `$${moneyAfterRifle}`);
  await cdp.eval(`window.__fps01.buy('grenade')`);
  const nades1 = await cdp.eval(`window.__fps01.state.player.nades`);
  check('buy grenade: 1 carried, $0 left', nades1 === 1 && (await cdp.eval(`window.__fps01.state.money`)) === 0);
  await cdp.eval(`window.__fps01.live()`);
  check('round 1 live', (await cdp.eval(`window.__fps01.state.phase`)) === 'live');
  const killed = await killAll();
  check('aimed fire kills all 4 ANVIL bots', killed);
  const kills1 = await cdp.eval(`window.__fps01.state.kills`);
  check('player kills counted (4)', kills1 === 4, `kills=${kills1}`);
  const money1 = await cdp.eval(`window.__fps01.state.money`);
  check('kill money: 4 x $300 + $3250 win = $4450', money1 === 4450, `$${money1}`);
  const over1 = await cdp.eval(`({ ph: window.__fps01.state.phase, w: window.__fps01.state.winner, s: window.__fps01.state.scoreKite })`);
  check('round 1 ends KITE by elimination, score 1-0', over1.ph === 'over' && over1.w === 'kite' && over1.s === 1, JSON.stringify(over1));
  await cdp.eval(`window.__fps01.simulate(5)`);
  const r2 = await cdp.eval(`({ ph: window.__fps01.state.phase, r: window.__fps01.state.round })`);
  check('round 2 buy phase starts', r2.ph === 'buy' && r2.r === 2, JSON.stringify(r2));

  // Round 2: buy armor, then let the buy timer expire naturally (regression
  // test: the buy menu must hide when the round goes live on its own).
  await cdp.eval(`window.__fps01.buy('armor')`);
  const money2 = await cdp.eval(`window.__fps01.state.money`);
  check('buy armor: $4450 -> $3800', money2 === 3800, `$${money2}`);
  await cdp.eval(`window.__fps01.simulate(16)`);
  const live2 = await cdp.eval(`({ ph: window.__fps01.state.phase, buyHidden: document.getElementById('buy').hidden })`);
  check('buy timer expiry starts round + hides buy menu', live2.ph === 'live' && live2.buyHidden === true, JSON.stringify(live2));

  // Reload test: empty the mag, reload, check reserve.
  for (let i = 0; i < 25; i++) { await cdp.eval(`window.__fps01.fire()`); await cdp.eval(`window.__fps01.simulate(0.14)`); }
  const mag0 = await cdp.eval(`window.__fps01.state.player.weapons.rifle.mag`);
  check('rifle mag empties after 25 shots', mag0 === 0, `mag=${mag0}`);
  await cdp.eval(`window.__fps01.reload()`);
  await cdp.eval(`window.__fps01.simulate(2.5)`);
  const magR = await cdp.eval(`({ m: window.__fps01.state.player.weapons.rifle.mag, r: window.__fps01.state.player.weapons.rifle.reserve })`);
  check('reload refills mag 25, reserve 75 -> 50', magR.m === 25 && magR.r === 50, JSON.stringify(magR));

  // Grenade test.
  await cdp.eval(`window.__fps01.grenade()`);
  const nadeState = await cdp.eval(`({ n: window.__fps01.state.nades.length, carried: window.__fps01.state.player.nades })`);
  check('grenade thrown (in flight, 0 carried)', nadeState.n === 1 && nadeState.carried === 0, JSON.stringify(nadeState));
  await cdp.eval(`window.__fps01.simulate(2)`);
  const nadeGone = await cdp.eval(`window.__fps01.state.nades.length`);
  check('grenade explodes after fuse', nadeGone === 0, `in flight=${nadeGone}`);

  // Collision: face the north divider wall and walk into it.
  await cdp.eval(`window.__fps01.teleport(0, -7); window.__fps01.setLook(0, 0); window.__fps01.keys.add('KeyW')`);
  await cdp.eval(`window.__fps01.simulate(1.5)`);
  await cdp.eval(`window.__fps01.keys.delete('KeyW')`);
  const col = await cdp.eval(`({ x: window.__fps01.state.player.x, z: window.__fps01.state.player.z })`);
  check('wall collision stops player (z >= -7.7 at divider)', col.z >= -7.7 && col.z < -6.9 && Math.abs(col.x) < 0.1, JSON.stringify(col));

  // Clear Site A first (two defenders at 3 m burst a planting player down
  // in ~2 s — the plant needs 3 s), then plant and defend the plant:
  // shoot any defender that gets a line of sight, until the round resolves.
  const clearedA = await killNorth();
  check('site A defenders cleared before plant', clearedA);
  await cdp.eval(`window.__fps01.teleport(18.5, -12); window.__fps01.keys.add('KeyE')`);
  await cdp.eval(`window.__fps01.simulate(3.5)`);
  await cdp.eval(`window.__fps01.keys.delete('KeyE')`);
  const bomb = await cdp.eval(`window.__fps01.state.bomb.state`);
  check('bomb plants at Site A after 3s hold', bomb === 'planted', `bomb=${bomb}`);
  const timer = await cdp.eval(`Math.round(window.__fps01.state.bomb.timer)`);
  check('bomb timer running (~35s)', timer >= 30 && timer <= 35, `timer=${timer}`);
  let plantedEnd = null;
  for (let i = 0; i < 160; i++) {
    const st = await cdp.eval(`({ ph: window.__fps01.state.phase, w: window.__fps01.state.winner, r: window.__fps01.state.winReason, bs: window.__fps01.state.bomb.state })`);
    if (st.ph === 'over') { plantedEnd = st; break; }
    await cdp.eval(shootOnce);
    await cdp.eval(`window.__fps01.simulate(0.25)`);
  }
  if (!plantedEnd) plantedEnd = await cdp.eval(`({ ph: window.__fps01.state.phase, w: window.__fps01.state.winner, r: window.__fps01.state.winReason, bs: window.__fps01.state.bomb.state })`);
  check('planted round resolves, KITE wins', plantedEnd.ph === 'over' && plantedEnd.w === 'kite', JSON.stringify(plantedEnd));
  console.log(`    planted round ended by: ${plantedEnd.r}`);

  // Round 3: plant again, then leave the site so defenders can defuse.
  await cdp.eval(`window.__fps01.simulate(5)`);
  const r3 = await cdp.eval(`({ ph: window.__fps01.state.phase, r: window.__fps01.state.round })`);
  check('round 3 buy phase starts', r3.ph === 'buy' && r3.r === 3, JSON.stringify(r3));
  await cdp.eval(`window.__fps01.live()`);
  const clearedA3 = await killNorth();
  check('round 3: site A defenders cleared before plant', clearedA3);
  await cdp.eval(`window.__fps01.teleport(18.5, -12); window.__fps01.keys.add('KeyE')`);
  await cdp.eval(`window.__fps01.simulate(3.5)`);
  await cdp.eval(`window.__fps01.keys.delete('KeyE')`);
  const planted3 = await cdp.eval(`window.__fps01.state.bomb.state`);
  check('round 3: bomb planted again', planted3 === 'planted', `bomb=${planted3}`);
  await cdp.eval(`window.__fps01.teleport(-20, 0)`);
  const def = await waitRoundEnd(25);
  check('defenders defuse, ANVIL wins round', def.ph === 'over' && def.w === 'anvil' && /DEFUSED/.test(def.r), JSON.stringify(def));

  // Match end: set up 4-4, round 9, win one more.
  await cdp.eval(`window.__fps01.simulate(5)`);
  await cdp.eval(`window.__fps01.state.scoreKite = 4; window.__fps01.state.scoreAnvil = 4; window.__fps01.state.round = 9;`);
  await cdp.eval(`window.__fps01.live()`);
  await killAll();
  await cdp.eval(`window.__fps01.simulate(5.5)`);
  const match = await cdp.eval(`({ ph: window.__fps01.state.phase, mw: window.__fps01.state.matchWinner, s: [window.__fps01.state.scoreKite, window.__fps01.state.scoreAnvil] })`);
  check('match ends at 5-4, KITE match winner', match.ph === 'match' && match.mw === 'kite', JSON.stringify(match));

  const liveShot = await cdp.shot('live');
  check('live gameplay screenshot captured', liveShot > 20000, `${liveShot} bytes`);
  const exc2 = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown');
  check('no page exceptions during play', exc2.length === 0, exc2.length ? JSON.stringify(exc2[0]).slice(0, 300) : '');
  cdp.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) console.log('FAILED:', failed.map((f) => f.name).join(' | '));
  chrome.kill();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('DRIVER ERROR', e); chrome.kill(); process.exit(2); });
