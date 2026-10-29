/* Specimen tags — each hangs from a pin on a linen loop.
   Swing: a damped physical pendulum (period ~0.5 s) the pointer can brush.
   Turn:  rest the pointer on a tag and it turns over to show the note on the back;
          leave, and the twisted loop turns it home with a small overshoot. */
(function () {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const PIVOT = { x: 50.2, y: 8.9 };             // css px inside the 100x180 tag box
  const CARD = { x0: 10, x1: 90, y0: 26.7, y1: 172.7 };
  const W0 = 2 * Math.PI / 1.25, ZETA = 0.15;    // swing: slow, and card loses it to the air within a sway or two
  const K_T = 2 * Math.PI / 2.0, ZETA_T = 0.62;  // turn: about a second, one small overshoot (~15 deg)
  const DWELL = 380;                             // ms of resting before it turns over
  const MAX = 0.24;                              // rad, a soft limit for a firm brush

  const tags = [...document.querySelectorAll('.spec-tag')].map((el, i) => ({
    el, card: el.closest('.situation'),
    swing: el.querySelector('.t-swing'), twist: el.querySelector('.t-twist'),
    shadow: el.querySelector('.t-shadow'), faces: el.querySelectorAll('.t-face'),
    rest: parseFloat(el.style.getPropertyValue('--rest')) * Math.PI / 180 || 0,
    th: 0, om: 0, ph: 0, phv: 0, target: 0, over: 0, inside: false, held: false, hid: false, i,
  }));
  if (!tags.length) return;

  let ptr = null, last = null, raf = 0, prevT = 0;

  function local(t, x, y) {          // page point -> unrotated tag coordinates
    const r = t.el.getBoundingClientRect();
    const px = x - r.left - PIVOT.x, py = y - r.top - PIVOT.y, a = -(t.rest + t.th);
    return { x: PIVOT.x + px * Math.cos(a) - py * Math.sin(a), y: PIVOT.y + px * Math.sin(a) + py * Math.cos(a) };
  }
  const onCard = (p, pad = 0) => p.x > CARD.x0 - pad && p.x < CARD.x1 + pad && p.y > CARD.y0 - pad && p.y < CARD.y1 + pad;

  function draw(t) {
    t.swing.style.transform = `rotate(${t.rest + t.th}rad)`;
    const c = Math.cos(t.ph), s = Math.abs(Math.sin(t.ph));
    t.twist.style.transform = `rotateY(${t.ph}rad)`;
    // the card stands off the board as it turns: its shadow narrows and slides away from the light
    t.shadow.style.transform = `translate(${(s * 4).toFixed(2)}px,${(s * 4.5).toFixed(2)}px) scaleX(${Math.max(Math.abs(c), 0.03).toFixed(3)})`;
    t.shadow.style.opacity = (0.34 + 0.12 * s).toFixed(3);
    // a turning face catches less of the upper-left light
    const lum = (1 - 0.16 * s - 0.05 * Math.sin(t.ph)).toFixed(3);
    t.faces.forEach(f => f.style.filter = `brightness(${lum})`);
  }

  function step(now) {
    const dt = Math.min(0.033, (now - (prevT || now)) / 1000) || 0.016; prevT = now;
    let busy = false;
    for (const t of tags) {
      // brushing: while the pointer is over the card it drags the card along with it
      if (ptr && last && t.inside) {
        const p = local(t, ptr.x, ptr.y), lever = Math.max(18, p.y - PIVOT.y);
        const vx = (ptr.x - last.x) / Math.max(dt, 1e-3);           // px/s
        const vCard = -t.om * lever;                  // css rotate(+) is clockwise: the card swings left
        t.om -= Math.max(-12, Math.min(12, (vx - vCard) * 0.75 / lever)) * dt * 1.4;   // momentum builds, it isn't handed over
      }
      const acc = -W0 * W0 * Math.sin(t.th) - 2 * ZETA * W0 * t.om;
      t.om += acc * dt; t.th += t.om * dt;
      if (Math.abs(t.th) > MAX) t.om -= Math.sign(t.th) * (Math.abs(t.th) - MAX) * 60 * dt;   // the loop goes taut
      // turning over
      if (t.inside && ptr && now - t.over > DWELL && Math.abs(t.om) < 0.35) t.target = Math.PI;
      if (!t.inside && !t.held) { t.target = 0; t.hid = false; t.card.classList.remove('tag-reading'); }
      // once it has turned, hide the pointer so it doesn't sit on the note; it returns on the next move
      // and stays visible for the rest of this look
      else if (t.target && !t.hid && Math.abs(t.ph - Math.PI) < 0.6) { t.hid = true; t.card.classList.add('tag-reading'); }
      const accT = -K_T * K_T * (t.ph - t.target) - 2 * ZETA_T * K_T * t.phv;
      t.phv += accT * dt; t.ph += t.phv * dt;
      draw(t);
      const moving = Math.abs(t.om) > 0.01 || Math.abs(t.th) > 0.003 || Math.abs(t.ph - t.target) > 0.004 || Math.abs(t.phv) > 0.01;
      const waiting = t.inside && !t.target;          // counting the dwell before it turns
      if (moving || waiting) busy = true;
    }
    last = ptr && { ...ptr };
    raf = busy ? requestAnimationFrame(step) : 0;
    if (!busy) prevT = 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(step); };

  if (reduce) { tags.forEach(draw); return; }

  if (fine) {
    const hit = () => {
      for (const t of tags) {
        const p = local(t, ptr.x, ptr.y), was = t.inside;
        t.inside = onCard(p, was ? 4 : 0);
        if (t.inside && !was) t.over = performance.now();
        if (t.inside) {
          const v = last ? Math.hypot(ptr.x - last.x, ptr.y - last.y) : 0;
          if (v > 3) { t.over = performance.now(); t.card.classList.remove('tag-reading'); }  // the dwell starts once the hand rests
        }
      }
      kick();
    };
    addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      ptr = { x: e.clientX, y: e.clientY }; hit();
    }, { passive: true });
    // the page can move under a still mouse (wheel, keys): the tags under it change
    addEventListener('scroll', () => { if (ptr) { last = { ...ptr }; hit(); } }, { passive: true });
    document.addEventListener('pointerleave', () => { ptr = null; tags.forEach(t => t.inside = false); kick(); });
  } else {
    // touch: a tap on the tag turns it over instead of following the link
    tags.forEach(t => t.card.addEventListener('click', e => {
      const p = local(t, e.clientX, e.clientY);
      if (!onCard(p, 6)) return;
      e.preventDefault();
      t.held = !t.held; t.target = t.held ? Math.PI : 0;
      t.om += 0.3; kick();
      const back = () => { t.held = false; t.target = 0; kick(); };
      clearTimeout(t.timer); if (t.held) t.timer = setTimeout(back, 4200);
    }));
  }

  // the drawer has just been opened: each tag is still settling when it comes into view
  const io = new IntersectionObserver(es => es.forEach(en => {
    if (!en.isIntersecting) return;
    const t = tags.find(x => x.el === en.target); io.unobserve(en.target);
    setTimeout(() => { t.om += (t.i % 2 ? -1 : 1) * (0.14 + 0.06 * Math.sin(t.i * 7.1)); kick(); }, 120 + t.i * 90);
  }), { threshold: 0.6 });
  tags.forEach(t => { draw(t); io.observe(t.el); });
  // keyboard focus on a situation gives its tag a small nudge
  tags.forEach(t => t.card.addEventListener('focus', () => { t.om += 0.2; kick(); }));
})();
