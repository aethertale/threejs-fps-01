// Pooled visual effects: tracers, impact sparks and explosions. Everything is
// preallocated at boot; spawn functions only flip visibility and set transforms.
// No new objects, arrays or DOM nodes are created while a round runs.
import * as THREE from 'three';

const TRACERS = 24, IMPACTS = 16, BOOMS = 4, SPARKS = 6;

export function createEffects(scene) {
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85 });
  const tracers = [];
  for (let i = 0; i < TRACERS; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 1), tracerMat);
    m.visible = false; scene.add(m); tracers.push({ mesh: m, life: 0 });
  }
  const impactMat = new THREE.MeshBasicMaterial({ color: 0xffc46b });
  const impacts = [];
  for (let i = 0; i < IMPACTS; i++) {
    const g = new THREE.Group();
    for (let s = 0; s < SPARKS; s++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), impactMat);
      p.position.set(0, 0, 0); g.add(p);
    }
    g.visible = false; scene.add(g); impacts.push({ group: g, life: 0, vel: [] });
    for (let s = 0; s < SPARKS; s++) impacts[i].vel.push(new THREE.Vector3());
  }
  const booms = [];
  for (let i = 0; i < BOOMS; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xff8a3c, transparent: true, opacity: 0.9 });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat);
    const light = new THREE.PointLight(0xff8a3c, 0, 18);
    sphere.visible = false; light.visible = false;
    scene.add(sphere); scene.add(light);
    booms.push({ mesh: sphere, light, life: 0 });
  }
  let ti = 0, ii = 0, bi = 0;
  const mid = new THREE.Vector3(), dir = new THREE.Vector3();

  return {
    spawnTracer(ax, ay, az, bx, by, bz) {
      const t = tracers[ti]; ti = (ti + 1) % TRACERS;
      mid.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
      dir.set(bx - ax, by - ay, bz - az);
      const len = dir.length() || 0.001;
      t.mesh.position.copy(mid);
      t.mesh.lookAt(bx, by, bz);
      t.mesh.scale.set(1, 1, len);
      t.mesh.visible = true;
      t.life = 0.07;
    },
    spawnImpact(x, y, z, rand) {
      const im = impacts[ii]; ii = (ii + 1) % IMPACTS;
      im.group.position.set(x, y, z);
      im.group.visible = true;
      im.life = 0.25;
      for (let s = 0; s < SPARKS; s++) {
        const c = im.group.children[s];
        c.position.set(0, 0, 0);
        im.vel[s].set(rand() * 2 - 1, rand() * 1.2, rand() * 2 - 1).multiplyScalar(2.4);
      }
    },
    spawnExplosion(x, y, z) {
      const b = booms[bi]; bi = (bi + 1) % BOOMS;
      b.mesh.position.set(x, y, z);
      b.light.position.set(x, y + 0.5, z);
      b.mesh.visible = true; b.light.visible = true;
      b.life = 0.45;
    },
    step(dt) {
      for (const t of tracers) {
        if (t.life <= 0) continue;
        t.life -= dt;
        if (t.life <= 0) t.mesh.visible = false;
      }
      for (const im of impacts) {
        if (im.life <= 0) continue;
        im.life -= dt;
        if (im.life <= 0) { im.group.visible = false; continue; }
        for (let s = 0; s < SPARKS; s++) {
          const c = im.group.children[s];
          c.position.x += im.vel[s].x * dt;
          c.position.y += im.vel[s].y * dt;
          c.position.z += im.vel[s].z * dt;
          im.vel[s].y -= 9 * dt;
        }
      }
      for (const b of booms) {
        if (b.life <= 0) continue;
        b.life -= dt;
        const k = 1 - b.life / 0.45;
        const r = 0.4 + k * 5.2;
        b.mesh.scale.setScalar(r);
        b.mesh.material.opacity = 0.9 * (1 - k);
        b.light.intensity = 60 * (1 - k);
        if (b.life <= 0) { b.mesh.visible = false; b.light.visible = false; }
      }
    },
  };
}
