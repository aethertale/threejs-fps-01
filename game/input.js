// Keyboard, mouse and pointer lock. Keeps the raw device state; the sim reads
// it, main.js drains the look deltas once per frame. Edges (pressed this
// frame) are computed by the caller from `pressed` + a clear each frame.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set();
  let lookX = 0, lookY = 0, locked = false, firing = false;

  function onKey(e, down) {
    if (e.repeat) return;
    if (down) { keys.add(e.code); pressed.add(e.code); }
    else keys.delete(e.code);
    if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
  }
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', () => { keys.clear(); firing = false; });

  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    onLockChange(locked);
  });
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    lookX += e.movementX;
    lookY += e.movementY;
  });
  function requestLock() {
    try {
      const p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => canvas.requestPointerLock());
    } catch { try { canvas.requestPointerLock(); } catch { /* headless: no lock */ } }
  }
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) firing = true;
    if (!locked) requestLock(); // re-lock if a previous request was rejected
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    keys, pressed,
    get firing() { return firing; },
    get locked() { return locked; },
    requestLock,
    exitLock() { if (document.pointerLockElement) document.exitPointerLock(); },
    takeLook() {
      const out = { x: lookX, y: lookY };
      lookX = 0; lookY = 0;
      return out;
    },
    clearPressed() { pressed.clear(); },
    wasPressed(code) { return pressed.has(code); },
  };
}
