// HUD and menus: one DOM update pass per frame, touching a node only when its
// text or width actually changed. The buy menu and overlays are built once;
// showing or hiding them never rebuilds the DOM.
import { SHOP } from './round.js';
import { SITES } from './map.js';

function el(id) { return document.getElementById(id); }

export function createHud() {
  const refs = {
    cross: el('crosshair'), hit: el('hitmarker'), dmg: el('dmg'),
    obj: el('objective'), timer: el('timer'), score: el('scoreboard'),
    feed: el('killfeed'), banner: el('banner'),
    hpNum: el('hp-num'), hpFill: el('hp-fill'), arNum: el('armor-num'),
    money: el('money'), ammoMag: el('ammo-mag'), ammoRes: el('ammo-reserve'),
    wName: el('weapon-name'), nades: el('grenades'),
    bombbar: el('bombbar'), bombLabel: el('bombbar-label'), bombFill: el('bombbar-fill'),
    buy: el('buy'), buyMoney: el('buy-money'), buyItems: el('buy-items'),
    overlay: el('overlay'), ovTitle: el('ov-title'), ovCopy: el('ov-copy'),
    ovSub: el('ov-sub'), play: el('play'),
  };
  const last = {};
  let hitT = null, dmgT = null, bannerT = null;
  let playCb = null, buyCb = null;

  function set(node, key, value) {
    if (last[key] !== value) { last[key] = value; node.textContent = value; }
  }
  function setW(node, key, value) {
    if (last[key] !== value) { last[key] = value; node.style.width = value; }
  }
  function fmtTime(s) {
    s = Math.max(0, Math.ceil(s));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  function killfeed(html) {
    const div = document.createElement('div');
    div.className = 'feed-line';
    div.innerHTML = html;
    refs.feed.prepend(div);
    while (refs.feed.children.length > 5) refs.feed.lastChild.remove();
    setTimeout(() => div.remove(), 5200);
  }
  function showBanner(text, ms) {
    refs.banner.textContent = text;
    refs.banner.classList.add('on');
    clearTimeout(bannerT);
    bannerT = setTimeout(() => refs.banner.classList.remove('on'), ms || 2600);
  }

  // Buy menu rows, built once.
  for (const item of SHOP) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'buy-item';
    b.dataset.id = item.id;
    b.innerHTML = `<b>${item.name}</b><span>${item.desc}</span><em>$${item.price}</em>`;
    b.addEventListener('click', () => { if (buyCb) buyCb(item.id); });
    refs.buyItems.appendChild(b);
  }
  refs.play.addEventListener('click', () => { if (playCb) playCb(); });

  function objectiveText(S) {
    if (S.phase === 'buy') return 'BUY PHASE — GEAR UP, THEN PLANT THE CHARGE';
    if (S.bomb.state === 'planted') return `BOMB PLANTED AT ${S.bomb.site} — DEFUSE BEFORE ${fmtTime(S.bomb.timer)}`;
    if (S.bomb.state === 'carry' && S.bomb.carrier === null) return 'CHARGE DROPPED — RECOVER IT';
    if (S.phase === 'live') return 'PLANT THE CHARGE AT A — TICKET HALL, OR B — PLATFORM';
    if (S.phase === 'over') return S.winReason;
    return 'MERIDIAN TERMINAL';
  }

  return {
    onPlay(cb) { playCb = cb; },
    onBuy(cb) { buyCb = cb; },
    setCrosshair(gap) {
      const g = Math.round(gap);
      if (last.gap !== g) { last.gap = g; refs.cross.style.setProperty('--gap', `${g}px`); }
    },
    hitmarker(kill) {
      refs.hit.classList.toggle('kill', !!kill);
      refs.hit.classList.add('on');
      clearTimeout(hitT);
      hitT = setTimeout(() => refs.hit.classList.remove('on'), kill ? 220 : 110);
    },
    damageFlash() {
      refs.dmg.classList.add('on');
      clearTimeout(dmgT);
      dmgT = setTimeout(() => refs.dmg.classList.remove('on'), 160);
    },
    banner: showBanner,
    showBuy(S) {
      refs.buy.hidden = false;
      set(refs.buyMoney, 'buymoney', `$${S.money}`);
      for (const b of refs.buyItems.children) {
        const id = b.dataset.id;
        const owned = (id === 'rifle' && S.player.hasRifle) || (id === 'armor' && S.player.hasArmor) ||
          (id === 'grenade' && S.player.nades >= 1);
        const afford = S.money >= SHOP.find((s) => s.id === id).price;
        b.classList.toggle('owned', owned);
        b.classList.toggle('poor', !owned && !afford);
      }
    },
    hideBuy() { refs.buy.hidden = true; },
    showOverlay(kind, data) {
      const o = refs.overlay;
      o.hidden = false;
      if (kind === 'start') {
        refs.ovTitle.textContent = 'MERIDIAN TERMINAL';
        refs.ovCopy.textContent = 'KITE attacks, ANVIL defends. Plant the charge at Ticket Hall or Platform — or clear the site by force.';
        refs.ovSub.textContent = '';
        refs.play.textContent = 'Click to play';
      } else if (kind === 'paused') {
        refs.ovTitle.textContent = 'PAUSED';
        refs.ovCopy.textContent = 'Pointer lock released. Click to resume.';
        refs.ovSub.textContent = '';
        refs.play.textContent = 'Resume';
      } else if (kind === 'result') {
        refs.ovTitle.textContent = data.winner === 'kite' ? 'ROUND WON' : 'ROUND LOST';
        refs.ovCopy.textContent = data.reason;
        refs.ovSub.textContent = `KITE ${data.scoreKite} — ${data.scoreAnvil} ANVIL · +$${data.award}`;
        refs.play.textContent = 'Next round';
      } else if (kind === 'match') {
        refs.ovTitle.textContent = data.matchWinner === 'kite' ? 'MATCH WON' : data.matchWinner === 'anvil' ? 'MATCH LOST' : 'MATCH DRAWN';
        refs.ovCopy.textContent = `Final score — KITE ${data.scoreKite} : ${data.scoreAnvil} ANVIL`;
        refs.ovSub.textContent = '';
        refs.play.textContent = 'Play again';
      }
    },
    hideOverlay() { refs.overlay.hidden = true; },
    update(S, events) {
      const p = S.player;
      set(refs.timer, 'timer', fmtTime(S.roundTime));
      set(refs.score, 'score', `KITE ${S.scoreKite} — ${S.scoreAnvil} ANVIL · ROUND ${S.round}`);
      set(refs.obj, 'obj', objectiveText(S));
      set(refs.hpNum, 'hp', String(Math.max(0, Math.ceil(p.hp))));
      setW(refs.hpFill, 'hpf', `${Math.max(0, p.hp)}%`);
      set(refs.arNum, 'ar', p.armor > 0 ? `ARMOR ${Math.ceil(p.armor)}` : '');
      set(refs.money, 'money', `$${S.money}`);
      const w = p.weapons[p.cur];
      set(refs.ammoMag, 'mag', String(w.mag));
      set(refs.ammoRes, 'res', `/ ${w.reserve}`);
      set(refs.wName, 'wn', p.cur === 'rifle' ? 'VECT-9' : 'MAUL-12');
      set(refs.nades, 'nd', p.nades > 0 ? '● FLARE-6' : '○ FLARE-6');
      const showBar = p.planting > 0 || S.bomb.defuseP > 0;
      refs.bombbar.hidden = !showBar;
      if (showBar) {
        const planting = p.planting > 0;
        set(refs.bombLabel, 'bl', planting ? 'PLANTING CHARGE…' : 'DEFUSE IN PROGRESS…');
        setW(refs.bombFill, 'bf', `${Math.round((planting ? p.planting : S.bomb.defuseP) * 100)}%`);
      }
      for (const ev of events) {
        if (ev.kind === 'hit') this.hitmarker(ev.killed);
        else if (ev.kind === 'hurt') this.damageFlash();
        else if (ev.kind === 'kill') {
          killfeed(`<b class="${ev.byTeam}">${ev.by}</b> ▸ <b class="${ev.victimTeam}">${ev.victim}</b>${ev.head ? ' <i>HEADSHOT</i>' : ''}`);
        } else if (ev.kind === 'planted') showBanner(`BOMB PLANTED — SITE ${ev.site} · ${SITES[ev.site].name}`, 3000);
        else if (ev.kind === 'defused') showBanner('BOMB DEFUSED — ANVIL HOLDS', 3000);
        else if (ev.kind === 'explode') showBanner('CHARGE DETONATED', 3000);
        else if (ev.kind === 'roundStart') showBanner(`ROUND ${ev.round} — PLANT THE CHARGE`, 2600);
        else if (ev.kind === 'buyPhase') { showBanner('BUY PHASE', 2000); this.showBuy(S); }
      }
    },
  };
}
