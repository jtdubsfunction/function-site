/* Plate loupe — a hand lens for the natural-history plates.
   Lingering on the plate's hidden intrusion prints a new figure number
   onto the plate and adds its entry to the caption legend.
   Everything is drawn at the source image's resolution (1920px), so the
   lens magnifies the added marks exactly as it magnifies the printed ones. */
(function () {
  const plate = document.querySelector('[data-loupe]');
  if (!plate) return;

  const img = plate.querySelector('img');
  const mount = plate.querySelector('.plate-mount');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

  // ---------- configuration (source-image coordinates, 1920 × 1031) ----------
  const SRC = { url: plate.dataset.loupeSrc, w: 1920, h: 1031 };
  const LENS_CSS = 196;            // lens diameter, css px
  const INK = [28, 24, 14];        // sampled from the plate's own figure numerals
  // the intrusion, traced in source pixels: the handset grip as a capsule, the earpiece, and the base with its dial
  const TARGET = {
    capsules: [[1250, 132, 1420, 178, 38], [1420, 178, 1492, 318, 40]],   // x0, y0, x1, y1, radius
    circles: [[1505, 362, 62]],
    boxes: [[1290, 590, 1560, 722]],
  };
  const DWELL_MS = 650;          // counted only while the lens is nearly still
  // the new figure: numeral in the empty paper to the upper right, ruled leader to the grip
  const FIG = { x: 1661, y: 141, size: 22, label: '4' };
  const LEADER = { x0: 1644, y0: 133, x1: 1375, y1: 140 };   // drawn from the numeral toward the specimen
  const KEY = 'fn-plate-lviii-fig4';

  // ---------- state ----------
  let src, composite, cctx, ink, ictx;
  let found = false, dwell = 0, inkT = 0, legendT = 0;
  let pos = { x: 0, y: 0 }, goal = { x: 0, y: 0 }, lift = 0, liftGoal = 0;
  let last = 0, raf = 0, active = false;

  // ---------- DOM ----------
  const lens = document.createElement('div');
  lens.className = 'loupe';
  lens.setAttribute('aria-hidden', 'true');
  // Layers rendered in Blender (see loupe.blend): the shadow and the light the lens gathers onto
  // the page, the live magnified view, the window's glint on the glass, and the brass bezel on top.
  const ASSET = plate.dataset.loupeAssets || '';
  // (image sources are set on first use, so a visitor who never looks downloads none of it)
  lens.innerHTML =
    `<div class="loupe-cast"><img class="loupe-shadow" data-src="${ASSET}loupe-shadow.webp" alt=""><img class="loupe-caustic" data-src="${ASSET}loupe-caustic.webp" alt=""></div>` +
    `<canvas class="loupe-glass"></canvas>` +
    `<img class="loupe-glint" data-src="${ASSET}loupe-glint.webp" alt="">` +
    `<img class="loupe-bezel" data-src="${ASSET}loupe-bezel.webp" alt="">`;
  mount.appendChild(lens);
  const glass = lens.querySelector('.loupe-glass');
  const cast = lens.querySelector('.loupe-cast');

  const inkLayer = document.createElement('canvas');
  inkLayer.className = 'plate-ink';
  inkLayer.setAttribute('aria-hidden', 'true');
  inkLayer.style.display = 'none';   // shown once recomposite() has sized and placed it
  img.insertAdjacentElement('afterend', inkLayer);

  const legend = plate.querySelector('.platecap-fig');

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const D = Math.round(LENS_CSS * dpr);
  glass.width = glass.height = D;
  const gctx = glass.getContext('2d');
  const buf = document.createElement('canvas'); buf.width = buf.height = D;
  const bctx = buf.getContext('2d', { willReadFrequently: true });

  // ---------- lens optics, measured in Blender ----------
  // A biconvex BK7 lens (R = 12 cm, 6.9 cm above the page) was rendered looking at a plane coloured by
  // its own coordinates, once each for red, green and blue light. rho(u)/u = polyval(coef, u^2) says
  // where a point at fraction u of the clear aperture actually looks. 2.42× at the centre, 2.68× at the rim.
  const OPTICS = {
    r: [-0.0180968, 0.0384274, -0.0325980, -0.0295732, 0.4170007],
    g: [-0.0186673, 0.0396204, -0.0334974, -0.0297095, 0.4141955],
    b: [-0.0187169, 0.0396884, -0.0336805, -0.0305016, 0.4079478],
  };
  const CLEAR = 0.92;                                   // clear aperture as a fraction of the bezel's outer radius
  const poly = (c, x) => c.reduce((acc, k) => acc * x + k, 0);
  // A quality loupe is an achromatic doublet: it cancels most of a single lens's colour error.
  // Keep a fifth of the measured red/blue difference, so only a trace of fringing remains at the rim.
  const ACHROMAT = 0.2;
  const rho = (ch, u) => {
    const g = u * poly(OPTICS.g, u * u);
    return ch === 'g' ? g : g + ACHROMAT * (u * poly(OPTICS[ch], u * u) - g);
  };
  const RHO_MAX = Math.max(rho('r', 1), rho('g', 1), rho('b', 1)) * 1.01;
  const R = D / 2, RC = R * CLEAR;                      // device px
  const mapG = new Int32Array(D * D), mapR = new Int32Array(D * D), mapB = new Int32Array(D * D);
  const vign = new Float32Array(D * D);
  async function buildMaps() {
    // the buffer holds the plate from -RHO_MAX to +RHO_MAX clear radii around the lens centre
    const k = R / RHO_MAX;
    let t0 = performance.now();
    const at = (dx, dy, u, ch) => {
      const s = u > 0 ? rho(ch, u) / u : 1 / 2.42;
      const sx = Math.min(D - 1, Math.max(0, Math.round(R + dx / RC * s * k)));
      const sy = Math.min(D - 1, Math.max(0, Math.round(R + dy / RC * s * k)));
      return sy * D + sx;
    };
    for (let y = 0; y < D; y++) {
      for (let x = 0; x < D; x++) {
        const i = y * D + x, dx = x + 0.5 - R, dy = y + 0.5 - R, u = Math.hypot(dx, dy) / RC;
        if (u > 1.015) { mapG[i] = mapR[i] = mapB[i] = -1; continue; }   // under the bezel
        mapR[i] = at(dx, dy, u, 'r'); mapG[i] = at(dx, dy, u, 'g'); mapB[i] = at(dx, dy, u, 'b');
        vign[i] = 1 - 0.1 * Math.pow(Math.min(1, u), 8);   // the bezel's shade just inside its lip
      }
      if (performance.now() - t0 > 8) { await new Promise(r => setTimeout(r)); t0 = performance.now(); }
    }
  }

  // ---------- ink: the new figure, printed in the plate's own manner ----------
  // A fixed noise field so the "printing" is irregular but identical every time.
  function noise(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
  let grain;
  const GRAIN = { x: 1330, y: 96, w: 400, h: 70 };   // covers the numeral and the leader, nothing else
  function makeGrain(w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'), d = x.createImageData(w, h), rnd = noise(7);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = rnd();
      d.data[i] = d.data[i + 1] = d.data[i + 2] = 0;
      d.data[i + 3] = v < 0.05 ? 150 : v < 0.16 ? 45 : 0;   // where ink failed to take
    }
    x.putImageData(d, 0, 0); return c;
  }

  // the leader: a ruled line that swells slightly in the middle and tapers at both ends
  function leaderPath(c, t) {
    const { x0, y0, x1, y1 } = LEADER;
    const len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / len, uy = (y1 - y0) / len, nx = -uy, ny = ux;
    const steps = 60, end = t;
    const pts = [], rnd = noise(11);
    for (let i = 0; i <= steps; i++) {
      const u = (i / steps) * end, along = u * len;
      const taper = Math.min(1, u / 0.1, (1 - u) / 0.06);
      const wob = 1 + (rnd() - 0.5) * 0.18;
      const w = Math.max(0.35, 0.92 * Math.max(0.3, taper) * wob);
      pts.push([x0 + ux * along, y0 + uy * along, w]);
    }
    c.beginPath();
    pts.forEach(([x, y, w], i) => (i ? c.lineTo : c.moveTo).call(c, x + nx * w, y + ny * w));
    for (let i = pts.length - 1; i >= 0; i--) { const [x, y, w] = pts[i]; c.lineTo(x - nx * w, y - ny * w); }
    c.closePath();
  }

  function drawInk(t) {
    // t: 0 → 1 over the whole reveal. The numeral sets first (0–.4), then the rule travels to the specimen (.25–1).
    ictx.clearRect(0, 0, SRC.w, SRC.h);
    if (t <= 0) return;
    const nt = clamp(t / 0.4), lt = ease(clamp((t - 0.25) / 0.75));
    ictx.save();
    ictx.fillStyle = `rgb(${INK})`;
    if (lt > 0) { ictx.filter = 'blur(0.35px)'; leaderPath(ictx, lt); ictx.fill(); ictx.filter = 'none'; }
    if (nt > 0) {
      // ink surfaces: soft and pale first, then sharp and full
      ictx.globalAlpha = Math.min(1, nt * 1.6);
      ictx.filter = `blur(${(1 - easeOut(nt)) * 1.6 + 0.5}px)`;
      ictx.font = `700 ${FIG.size}px "Old Standard TT", "Libre Caslon Text", Georgia, serif`;
      ictx.textBaseline = 'alphabetic'; ictx.textAlign = 'center';
      ictx.fillText(FIG.label, FIG.x, FIG.y);
      ictx.lineWidth = 0.4; ictx.strokeStyle = ictx.fillStyle; ictx.strokeText(FIG.label, FIG.x, FIG.y);
      ictx.filter = 'none'; ictx.globalAlpha = 1;
    }
    // knock out a little ink where the paper didn't take it
    ictx.globalCompositeOperation = 'destination-out';
    ictx.drawImage(grain, GRAIN.x, GRAIN.y);
    ictx.restore();
    ictx.globalCompositeOperation = 'source-over';
  }

  function recomposite() {
    if (composite) {
    cctx.globalCompositeOperation = 'source-over';
    cctx.drawImage(src, 0, 0, SRC.w, SRC.h);
    cctx.globalCompositeOperation = 'multiply';
    cctx.globalAlpha = 0.94;
    cctx.drawImage(ink, 0, 0);
    cctx.globalAlpha = 1;
    cctx.globalCompositeOperation = 'source-over';
    }
    // on-page ink layer, at display resolution
    const r = img.getBoundingClientRect();
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (inkLayer.width !== w || inkLayer.height !== h) { inkLayer.width = w; inkLayer.height = h; }
    Object.assign(inkLayer.style, { left: img.offsetLeft + 'px', top: img.offsetTop + 'px', width: r.width + 'px', height: r.height + 'px' });
    const l = inkLayer.getContext('2d');
    l.clearRect(0, 0, w, h);
    l.drawImage(ink, 0, 0, w, h);
    inkLayer.style.display = '';
  }

  // ---------- lens rendering ----------
  let drawn = '';
  function renderLens() {
    const r = img.getBoundingClientRect();
    const key = `${pos.x.toFixed(2)},${pos.y.toFixed(2)},${r.width.toFixed(1)},${inkT}`;
    if (key === drawn) return;
    drawn = key;
    const scale = SRC.w / r.width;                    // source px per css px
    const radiusSrc = (LENS_CSS / 2) * CLEAR * RHO_MAX * scale;   // source px the glass can see
    const cx = pos.x * scale, cy = pos.y * scale;
    bctx.fillStyle = getComputedStyle(mount).backgroundColor;
    bctx.fillRect(0, 0, D, D);
    bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(composite, cx - radiusSrc, cy - radiusSrc, radiusSrc * 2, radiusSrc * 2, 0, 0, D, D);
    const a = bctx.getImageData(0, 0, D, D), o = gctx.createImageData(D, D);
    const s = a.data, d = o.data;
    for (let i = 0, n = D * D; i < n; i++) {
      const g = mapG[i]; if (g < 0) continue;
      const v = vign[i], j = i * 4;
      d[j] = s[mapR[i] * 4] * v; d[j + 1] = s[g * 4 + 1] * v; d[j + 2] = s[mapB[i] * 4 + 2] * v; d[j + 3] = 255;
    }
    gctx.putImageData(o, 0, 0);
  }

  function place() {
    // the lens is held a little above the paper; light comes from the upper left,
    // so the shadow falls down and right and grows as the lens lifts
    lens.style.left = img.offsetLeft + 'px'; lens.style.top = img.offsetTop + 'px';
    lens.style.transform = `translate(${pos.x - LENS_CSS / 2}px, ${pos.y - LENS_CSS / 2}px) scale(${0.94 + 0.06 * lift})`;
    lens.style.opacity = Math.min(1, lift * 1.6);
    cast.style.transform = `translate(${(lift - 1) * 32}px, ${(lift - 1) * 33}px) scale(${0.9 + 0.1 * lift})`;
    cast.style.opacity = lift;
  }

  // ---------- discovery ----------
  function segDist(px, py, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, t = clamp(((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy));
    return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
  }
  function inTarget(x, y) {
    return TARGET.capsules.some(([a, b, c, d, r]) => segDist(x, y, a, b, c, d) <= r) ||
      TARGET.circles.some(([a, b, r]) => Math.hypot(x - a, y - b) <= r) ||
      TARGET.boxes.some(([a, b, c, d]) => x >= a && x <= c && y >= b && y <= d);
  }

  let revealStart = 0;
  function reveal() {
    if (found) return;
    found = true;
    try { sessionStorage.setItem(KEY, '1'); } catch (e) {}
    plate.classList.add('is-found');
    revealStart = performance.now();
    if (reduce) { inkT = 1; drawInk(1); recomposite(); drawn = ''; if (active) renderLens(); }
    legend && legend.removeAttribute('aria-hidden');
  }

  // ---------- loop ----------
  function tick() {
    if (!composite) { raf = 0; ready && ready.then(wake); return; }
    const now = performance.now();   // one clock for everything, including revealStart
    const dt = Math.min(48, now - (last || now)); last = now;
    // critically damped follow: a little weight, never floaty
    const f = reduce ? 1 : 1 - Math.exp(-dt / 55);
    pos.x += (goal.x - pos.x) * f; pos.y += (goal.y - pos.y) * f;
    lift += (liftGoal - lift) * (reduce ? 1 : 1 - Math.exp(-dt / 90));

    if (found && inkT < 1) {
      inkT = Math.min(1, (now - revealStart) / 1700);
      drawInk(inkT); recomposite();
    }
    if (found && legend && legendT < 1) {
      legendT = reduce ? 1 : clamp((now - revealStart - 1500) / 700);
      const e = easeOut(legendT);
      legend.style.opacity = e; legend.style.transform = `translateY(${(1 - e) * 3}px)`;
    }
    if (active && !found) {
      const r = img.getBoundingClientRect(), sc = SRC.w / r.width;
      const still = Math.hypot(goal.x - pos.x, goal.y - pos.y) < 6;
      if (inTarget(pos.x * sc, pos.y * sc)) { if (still) { dwell += dt; if (dwell > DWELL_MS) reveal(); } }
      else dwell = Math.max(0, dwell - dt);
    }
    if (lift > 0.01) { renderLens(); place(); }
    else { lens.style.opacity = 0; }

    const settled = Math.abs(goal.x - pos.x) < 0.1 && Math.abs(goal.y - pos.y) < 0.1 && Math.abs(liftGoal - lift) < 0.005 && (!found || (inkT >= 1 && legendT >= 1));
    const r2 = active && !found ? img.getBoundingClientRect() : null;
    const counting = r2 && inTarget(pos.x * SRC.w / r2.width, pos.y * SRC.w / r2.width);
    raf = settled && !counting ? 0 : requestAnimationFrame(tick);
  }
  function wake() { if (!raf) { last = 0; raf = requestAnimationFrame(tick); } }

  function toLocal(e) { const r = img.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }; }
  function inside(p) { return p.x >= 0 && p.y >= 0 && p.x <= p.w && p.y <= p.h; }

  // ---------- input ----------
  function start() {
    if (finePointer) {
      img.parentElement.addEventListener('pointermove', (e) => {
        const p = toLocal(e);
        if (!inside(p)) { if (active) { active = false; liftGoal = 0; mount.classList.remove('is-looking'); wake(); } return; }
        if (!active) { active = true; pos = { x: p.x, y: p.y }; mount.classList.add('is-looking'); }
        goal = { x: p.x, y: p.y }; liftGoal = 1; wake();
      });
      img.parentElement.addEventListener('pointerleave', () => { active = false; liftGoal = 0; mount.classList.remove('is-looking'); wake(); });
    } else {
      // touch: tap to hold the lens over a spot for a moment, raised clear of the finger
      let t;
      img.parentElement.addEventListener('click', (e) => {
        const p = toLocal(e); if (!inside(p)) return;
        const r = img.getBoundingClientRect(), half = LENS_CSS / 2 + 6;
        const hdr = document.querySelector('.site-header'), top = hdr ? Math.max(0, hdr.getBoundingClientRect().bottom) : 0;
        pos = goal = {
          x: clamp(p.x, half - r.left, innerWidth - half - r.left),
          y: clamp(p.y - 70, top + half - r.top, innerHeight - half - r.top),
        };
        active = true; liftGoal = 1; wake();
        clearTimeout(t); t = setTimeout(() => { active = false; liftGoal = 0; wake(); }, 2200);
      });
    }
    // keyboard: focus the plate, then move the lens with the arrow keys
    plate.tabIndex = 0;
    plate.addEventListener('focus', () => {
      const r = img.getBoundingClientRect();
      if (!active) { pos = goal = { x: r.width * 0.3, y: r.height * 0.45 }; }
      active = true; liftGoal = 1; wake();
    });
    plate.addEventListener('blur', () => { active = false; liftGoal = 0; wake(); });
    plate.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 48 : 16, r = img.getBoundingClientRect();
      const m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!m) { if (e.key === 'Escape' && active) { active = false; liftGoal = 0; wake(); } return; }
      e.preventDefault();
      if (!active) { active = true; liftGoal = 1; }
      goal = { x: clamp(goal.x + m[0], 0, r.width), y: clamp(goal.y + m[1], 0, r.height) }; wake();
    });
    addEventListener('resize', () => { if (ink) { recomposite(); drawn = ''; } });
  }

  // ---------- helpers ----------
  function clamp(v, a = 0, b = 1) { return Math.min(b, Math.max(a, v)); }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  // ---------- boot ----------
  // Nothing heavy loads until someone reaches for the lens. If the figure was already found this
  // visit, only the printed figure is drawn (no plate image, no optics) until the lens is used.
  try { found = sessionStorage.getItem(KEY) === '1'; } catch (e) {}
  let inkReady = null, ready = null;
  function bootInk() {
    return inkReady || (inkReady = document.fonts.load(`700 ${FIG.size}px "Old Standard TT"`).then(() => {
      ink = document.createElement('canvas'); ink.width = SRC.w; ink.height = SRC.h;
      ictx = ink.getContext('2d');
      grain = makeGrain(GRAIN.w, GRAIN.h);
      if (found) { inkT = legendT = 1; drawInk(1); plate.classList.add('is-found'); legend && (legend.removeAttribute('aria-hidden'), legend.style.opacity = 1); recomposite(); }
    }));
  }
  function boot() {
    if (ready) return ready;
    lens.querySelectorAll('img[data-src]').forEach(i => { i.src = i.dataset.src; });
    const im = new Image();
    im.decoding = 'async';
    im.src = SRC.url;
    return (ready = Promise.all([im.decode(), bootInk()]).then(buildMaps).then(() => {
      src = im;
      composite = document.createElement('canvas'); composite.width = SRC.w; composite.height = SRC.h;
      cctx = composite.getContext('2d');
      recomposite();
    }));
  }
  // the plate is named by its caption (it takes focus for the keyboard lens)
  const cap = plate.querySelector('figcaption');
  if (cap) { cap.id = cap.id || 'plate-caption'; plate.setAttribute('aria-labelledby', cap.id); }
  start();
  if (found) bootInk();
  const go = () => boot();
  const zone = img.parentElement;
  zone.addEventListener('pointerenter', go, { once: true });
  zone.addEventListener('pointerdown', go, { once: true });
  plate.addEventListener('focus', go, { once: true });
})();
