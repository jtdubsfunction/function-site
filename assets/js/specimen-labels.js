/* Specimen labels on /brand-dysfunction/ — the loose pile can be brushed.
   A hand moving across a label drags it a little: it turns about its centre and slides,
   then settles back where it lay. Lifting (hover/focus) is CSS: scale + shadow crossfade.
   The page script rebuilds the pile on every collect, so labels are found by data-sid each frame. */
(function () {
  'use strict';
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const field = document.getElementById('field');
  if (!field) return;

  const W_R = 2 * Math.PI / 1.6, Z_R = 0.45;   // turn: settles in about a second, one soft overshoot
  const W_X = 2 * Math.PI / 1.2, Z_X = 0.9;    // slide: eases home without bouncing
  const MAX_R = 7 * Math.PI / 180, MAX_X = 10; // a firm brush, not a throw
  const state = new Map();                     // sid -> { th, om, x, y, vx, vy }
  let ptr = null, last = null, lastT = 0, under = null, raf = 0, prevT = 0;

  const get = sid => state.get(sid) || (state.set(sid, { th: 0, om: 0, x: 0, y: 0, vx: 0, vy: 0 }), state.get(sid));
  const soft = (v, m) => m * Math.tanh(v / m);

  function step(now) {
    const dt = Math.min(0.033, (now - (prevT || now)) / 1000) || 0.016; prevT = now;
    let busy = false;
    for (const [sid, s] of state) {
      const el = field.querySelector('.stag[data-sid="' + sid + '"]');
      if (!el) { state.delete(sid); continue; }
      if (ptr && last && under === sid && now - lastT < 60) {
        const r = el.getBoundingClientRect();
        const rx = ptr.x - (r.left + r.width / 2), ry = ptr.y - (r.top + r.height / 2);
        const pvx = ptr.vx, pvy = ptr.vy;                          // px/s
        // velocity of the card under the hand, so a label already moving with the hand isn't pushed again
        const cvx = s.vx - s.om * ry, cvy = s.vy + s.om * rx;
        const ux = pvx - cvx, uy = pvy - cvy;
        const I = (r.width * r.width + r.height * r.height) / 12;
        // a light touch barely moves it; only a quick pass reaches the limit
        const k = Math.min(1, Math.sqrt(Math.hypot(ux, uy) / 1600));
        s.om += (rx * uy - ry * ux) / I * 0.9 * k * dt;
        s.vx += ux * 2.2 * k * dt; s.vy += uy * 2.2 * k * dt;
      }
      s.om += (-W_R * W_R * s.th - 2 * Z_R * W_R * s.om) * dt; s.th += s.om * dt;
      s.vx += (-W_X * W_X * s.x - 2 * Z_X * W_X * s.vx) * dt; s.x += s.vx * dt;
      s.vy += (-W_X * W_X * s.y - 2 * Z_X * W_X * s.vy) * dt; s.y += s.vy * dt;
      const th = soft(s.th, MAX_R), x = soft(s.x, MAX_X), y = soft(s.y, MAX_X);
      el.style.setProperty('--br', (th * 180 / Math.PI).toFixed(3) + 'deg');
      el.style.setProperty('--bx', x.toFixed(2) + 'px');
      el.style.setProperty('--by', y.toFixed(2) + 'px');
      // asleep once nothing moves by a visible amount (~0.2 px at the corners)
      const moving = Math.abs(s.om) > 0.01 || Math.abs(s.th) > 0.0015 || Math.hypot(s.vx, s.vy) > 1 || Math.hypot(s.x, s.y) > 0.2;
      if (moving || (under === sid && performance.now() - lastT < 60)) busy = true;   // a resting hand doesn't keep the loop awake
      else if (!moving) { el.style.removeProperty('--br'); el.style.removeProperty('--bx'); el.style.removeProperty('--by'); state.delete(sid); }
    }
    raf = busy ? requestAnimationFrame(step) : 0;
    if (!busy) prevT = 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(step); };

  field.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const now = performance.now(), dt = Math.max(8, now - (lastT || now - 16)) / 1000;
    const p = { x: e.clientX, y: e.clientY, vx: 0, vy: 0 };
    if (ptr && now - lastT < 100) { p.vx = (p.x - ptr.x) / dt; p.vy = (p.y - ptr.y) / dt; }
    last = ptr; ptr = p; lastT = now;
    const t = e.target.closest('.stag');
    under = t ? t.getAttribute('data-sid') : null;
    if (under) { get(under); kick(); }
  }, { passive: true });
  field.addEventListener('pointerleave', () => { under = null; ptr = last = null; kick(); });
})();
