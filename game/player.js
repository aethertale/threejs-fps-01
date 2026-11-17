// Player movement: acceleration toward a wish direction, friction when the
// keys lift, crouch that lowers the eye and slows the step. Collision is the
// map's axis-separated circle slide; the sim never touches coordinates.
import { moveCircle, RADIUS } from './map.js';

const ACCEL = 42;       // m/s^2 toward wish velocity
const FRICTION = 11;    // 1/s damping with no input
const WALK = 4.6;
const CROUCH_SPEED = 2.4;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.05;

export function stepPlayer(S, keys, dt) {
  const p = S.player;
  if (!p.alive) { p.vx = 0; p.vz = 0; return; }
  const crouch = keys.has('ControlLeft') || keys.has('KeyC');
  p.crouch = crouch;
  const eyeTarget = crouch ? EYE_CROUCH : EYE_STAND;
  p.eye += (eyeTarget - p.eye) * Math.min(1, dt * 12);

  let fx = 0, fz = 0;
  if (keys.has('KeyW')) fz -= 1;
  if (keys.has('KeyS')) fz += 1;
  if (keys.has('KeyA')) fx -= 1;
  if (keys.has('KeyD')) fx += 1;
  const moving = fx !== 0 || fz !== 0;
  const maxSpeed = crouch ? CROUCH_SPEED : WALK;
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  // Forward is (-sin yaw, -cos yaw); right is (cos yaw, -sin yaw).
  const wx = (fx * cos + fz * sin) * maxSpeed;
  const wz = (-fx * sin + fz * cos) * maxSpeed;
  if (moving) {
    const k = Math.min(1, (ACCEL / maxSpeed) * dt);
    p.vx += (wx - p.vx) * k;
    p.vz += (wz - p.vz) * k;
  } else {
    const k = Math.max(0, 1 - FRICTION * dt);
    p.vx *= k; p.vz *= k;
  }
  const [nx, nz] = moveCircle(p.x, p.z, p.vx * dt, p.vz * dt, RADIUS);
  p.x = nx; p.z = nz;
  p.speed2d = Math.hypot(p.vx, p.vz);
  // Recoil decays back to zero; applied to pitch/yaw by main.js each frame.
  p.recoil *= Math.max(0, 1 - dt * 7);
  p.recoilYaw *= Math.max(0, 1 - dt * 7);
}

export function applyLook(S, dx, dy) {
  const p = S.player;
  p.yaw -= dx * 0.0021;
  p.pitch -= dy * 0.0021;
  const lim = Math.PI / 2 - 0.02;
  p.pitch = Math.max(-lim, Math.min(lim, p.pitch));
}
