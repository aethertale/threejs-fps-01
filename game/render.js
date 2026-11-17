// Three.js scene: dusk terminal, cool slate + amber site markers + teal accent.
// All meshes are built once at boot. The sim never creates objects; it asks
// this module for one thing — raycast(origin, dir, maxDist) — and this module
// syncs every mesh from state each frame.
import * as THREE from 'three';
import { WALLS, CRATES, SITES, BOUNDS } from './map.js';

const PALETTE = {
  canvas: 0x0e1518, floor: 0x232e33, wall: 0x2c3a40, wallTop: 0x3a4a52,
  crate: 0x4a3d2c, crateTop: 0x6b5a41, accent: 0x3fd2c0, foe: 0xe0524d,
  ally: 0x4da6ff, ink: 0xe8f0ee, bomb: 0xffb02e,
};

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function createRenderer(S) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('game').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.canvas);
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 24, 62);
  const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
  scene.add(camera);

  scene.add(new THREE.HemisphereLight(0x9fc4cc, 0x1a2024, 1.2));
  const sun = new THREE.DirectionalLight(0xffd9a0, 1.75);
  sun.position.set(-18, 26, -12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 24; sun.shadow.camera.bottom = -24;
  sun.shadow.camera.far = 80;
  scene.add(sun);
  for (const [x, z, color] of [[18.5, -12, 0xffb02e], [18.5, 12, 0x3fd2c0], [0, 0, 0x6b7f88]]) {
    const pt = new THREE.PointLight(color, 14, 22);
    pt.position.set(x, 4.2, z);
    scene.add(pt);
  }

  // Floor: canvas grid texture, repeated across the terminal.
  const floorTex = canvasTexture(512, (g, s) => {
    g.fillStyle = '#232e33'; g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
      g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, s); g.stroke();
      g.beginPath(); g.moveTo(0, i * 64); g.lineTo(s, i * 64); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.03)';
    for (let i = 0; i < 300; i++) g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(6, 4);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(BOUNDS.x1 - BOUNDS.x0 + 2, BOUNDS.z1 - BOUNDS.z0 + 2),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9, metalness: 0.05 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.85, metalness: 0.1 });
  const wallTopMat = new THREE.MeshStandardMaterial({ color: PALETTE.wallTop, roughness: 0.8, metalness: 0.1 });
  const crateMat = new THREE.MeshStandardMaterial({ color: PALETTE.crate, roughness: 0.9, metalness: 0.05 });
  const shootables = [];
  function addBox(x0, z0, x1, z1, h, mat, kind) {
    const w = x1 - x0, d = z1 - z0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.kind = kind;
    scene.add(m); shootables.push(m);
    return m;
  }
  for (const [x0, z0, x1, z1, h] of WALLS) {
    addBox(x0, z0, x1, z1, h, wallMat, 'wall');
    addBox(x0, z0, x1, z1, 0.12, wallTopMat, 'wall').position.y = h + 0.06;
  }
  for (const [x0, z0, x1, z1, h] of CRATES) addBox(x0, z0, x1, z1, h, crateMat, 'crate');

  // Site floor decals + floating letter sprites.
  const siteSprites = {};
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const decal = new THREE.Mesh(
      new THREE.CircleGeometry(s.r, 28),
      new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.16 }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(s.x, 0.02, s.z);
    scene.add(decal);
    const tex = canvasTexture(128, (g) => {
      g.strokeStyle = '#fff'; g.lineWidth = 6;
      g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#fff'; g.font = 'bold 64px system-ui';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(key, 64, 68);
    });
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    spr.scale.set(2.2, 2.2, 1);
    spr.position.set(s.x, 3.1, s.z);
    scene.add(spr);
    siteSprites[key] = spr;
  }

  // Bot meshes: torso + head + gun, team-coloured, one group per bot.
  const botGroups = [];
  for (const b of S.bots) {
    const g = new THREE.Group();
    const torsoMat = new THREE.MeshStandardMaterial({ color: b.team === 'kite' ? PALETTE.ally : PALETTE.foe, roughness: 0.7 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c2226, roughness: 0.8 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.32), torsoMat);
    torso.position.y = 1.05; torso.castShadow = true;
    torso.userData = { kind: 'bot', bot: b, part: 'body' };
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), darkMat);
    head.position.y = 1.6; head.castShadow = true;
    head.userData = { kind: 'bot', bot: b, part: 'head' };
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.6), darkMat);
    gun.position.set(0.2, 1.25, -0.3);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.05),
      new THREE.MeshBasicMaterial({ color: b.team === 'kite' ? 0x9fd8ff : 0xff9a8a }));
    visor.position.set(0, 1.62, -0.16);
    g.add(torso, head, gun, visor);
    g.position.set(b.x, 0, b.z);
    scene.add(g);
    shootables.push(torso, head);
    botGroups.push({ group: g, bot: b, torso, head });
  }

  // Invisible player proxy so bots can raycast the player (opacity 0, but
  // visible=true so the raycaster still tests it).
  const proxy = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.7, 0.7),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  proxy.userData = { kind: 'player' };
  scene.add(proxy);
  shootables.push(proxy);

  // Viewmodels: rifle and shotgun, swapped by current weapon.
  function buildGun(barrelLen, barrelR, stockLen) {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x39434d, roughness: 0.5, metalness: 0.45 });
    const mid = new THREE.MeshStandardMaterial({ color: 0x4b565f, roughness: 0.45, metalness: 0.55 });
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.42), mid);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(barrelR, barrelR, barrelLen, 10), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, -0.4);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, stockLen), dark);
    stock.position.set(0, -0.02, 0.3);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.08), dark);
    sight.position.set(0, 0.09, -0.05);
    g.add(receiver, barrel, stock, sight);
    g.position.set(0.24, -0.2, -0.42);
    g.scale.setScalar(0.85); // keep the viewmodel out of the frame's centre
    camera.add(g);
    return g;
  }
  const vmRifle = buildGun(0.4, 0.025, 0.22);
  const vmShot = buildGun(0.3, 0.045, 0.26);
  vmShot.visible = false;
  // Muzzle flash: a 4-point starburst drawn once on a canvas and blended
  // additively, so the flash reads as light. The old solid square plane
  // spun into a big orange diamond and dominated the combat shot.
  const flashTex = canvasTexture(128, (g, s) => {
    const c = s / 2;
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, 'rgba(255,244,214,1)');
    grad.addColorStop(0.3, 'rgba(255,196,107,0.95)');
    grad.addColorStop(0.65, 'rgba(255,138,60,0.4)');
    grad.addColorStop(1, 'rgba(255,138,60,0)');
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const r = i % 2 === 0 ? c * 0.92 : c * 0.22;
      const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.fillStyle = grad;
    g.fill();
  });
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.17, -0.95);
  flash.rotation.z = 0.3;
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(0xffc46b, 0, 6);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);
  // Small always-on camera light so the viewmodel stays readable in the dusk.
  // Kept dim: a bright light blew the pale receiver out to a white slab.
  const vmLight = new THREE.PointLight(0xfff2dd, 1.1, 2.5);
  vmLight.position.set(0.2, 0.15, -0.3);
  camera.add(vmLight);

  // Bomb mesh + blinking beacon.
  const bombMat = new THREE.MeshStandardMaterial({ color: 0x1c2226, roughness: 0.5, metalness: 0.4 });
  const bombMesh = new THREE.Group();
  const bombBody = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.24), bombMat);
  bombBody.position.y = 0.1;
  const bombLamp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.08),
    new THREE.MeshBasicMaterial({ color: PALETTE.bomb }));
  bombLamp.position.y = 0.24;
  bombMesh.add(bombBody, bombLamp);
  bombMesh.visible = false;
  scene.add(bombMesh);

  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const dirV = new THREE.Vector3(), orgV = new THREE.Vector3();
  let flashT = 0;

  return {
    renderer, scene, camera,
    dom: renderer.domElement,
    raycast(ox, oy, oz, dx, dy, dz, maxD) {
      orgV.set(ox, oy, oz);
      dirV.set(dx, dy, dz).normalize();
      raycaster.set(orgV, dirV);
      raycaster.far = maxD;
      const hits = raycaster.intersectObjects(shootables, false);
      if (!hits.length) return null;
      const h = hits[0];
      const u = h.object.userData;
      const part = u.part || (h.point.y > 1.45 ? 'head' : 'body');
      return { dist: h.distance, x: h.point.x, y: h.point.y, z: h.point.z, kind: u.kind || 'wall', bot: u.bot || null, part };
    },
    handleEvents(S, events) {
      for (const ev of events) {
        if (ev.kind === 'shot' && ev.by === 'player') flashT = 0.06;
      }
    },
    sync(S, dt) {
      const p = S.player;
      camera.position.set(p.x, p.eye, p.z);
      camera.rotation.set(p.pitch + p.recoil, p.yaw + p.recoilYaw, 0, 'YXZ');
      proxy.position.set(p.x, 0.85, p.z);
      for (const { group, bot } of botGroups) {
        group.position.set(bot.x, 0, bot.z);
        group.rotation.y = bot.yaw;
        if (!bot.alive) {
          group.rotation.x = -Math.PI / 2;
          group.position.y = 0.25;
        } else {
          group.rotation.x = 0;
          group.position.y = Math.abs(Math.sin(S.time * 7 + bot.id.charCodeAt(1))) * 0.03;
        }
      }
      const w = p.weapons[p.cur];
      vmRifle.visible = p.cur === 'rifle' && p.alive;
      vmShot.visible = p.cur === 'shotgun' && p.alive;
      const vm = p.cur === 'rifle' ? vmRifle : vmShot;
      const kick = w ? w.kick * 0.06 : 0;
      vm.position.z = -0.42 + kick;
      vm.rotation.x = kick * 2.4 - (w && w.reload > 0 ? 0.5 : 0);
      flashT = Math.max(0, flashT - dt);
      flash.visible = flashT > 0;
      flashLight.intensity = flashT > 0 ? 14 : 0;
      // Bomb mesh: shown dropped or planted; blinks faster as the timer runs out.
      const B = S.bomb;
      const show = B.state === 'planted' || (B.state === 'carry' && B.carrier === null);
      bombMesh.visible = show;
      if (show) {
        bombMesh.position.set(B.x, 0, B.z);
        const blink = B.state === 'planted' ? (Math.sin(S.time * (B.timer < 10 ? 14 : 5)) > 0 ? 1 : 0.15) : 1;
        bombLamp.material.color.setHex(blink > 0.5 ? 0xffb02e : 0x402a08);
      }
      for (const key of ['A', 'B']) {
        siteSprites[key].position.y = 3.1 + Math.sin(S.time * 1.4 + (key === 'A' ? 0 : 2)) * 0.08;
      }
    },
    resize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    },
  };
}
