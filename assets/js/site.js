/* Function — shared site script: the small-screen menu, the
   scrollable specialty sub-nav, and analytics click events.
   Without JS the menu and sub-nav still work. */
(function () {
  // Small screens: the specialty sub-nav scrolls sideways. Keep the current
  // page in view (re-measured once web fonts load, since they change widths),
  // keep keyboard focus in view, and fade whichever edge has more links beyond it.
  var sub = document.querySelector('.subnav ul');
  if (sub) {
    var cur = sub.querySelector('a[aria-current="page"]');
    var edges = function () {
      var max = sub.scrollWidth - sub.clientWidth;
      sub.classList.toggle('more-l', max > 1 && sub.scrollLeft > 1);
      sub.classList.toggle('more-r', max > 1 && sub.scrollLeft < max - 1);
    };
    var place = function () {
      if (cur && sub.scrollWidth > sub.clientWidth) {
        var li = cur.parentElement, left = li.offsetLeft - sub.offsetLeft;
        var lead = left - 56;                                   // a little context on the left
        var fit = left + li.offsetWidth - sub.clientWidth + 56; // clear of the right fade
        sub.scrollLeft = Math.max(0, Math.max(lead, fit));
      }
      edges();
    };
    place();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    window.addEventListener('load', place);
    window.addEventListener('resize', edges);
    sub.addEventListener('scroll', edges, { passive: true });
    sub.addEventListener('focusin', function (e) {
      e.target.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    });
  }

  var btn = document.querySelector('.menu-toggle');
  var nav = document.getElementById('site-nav');
  if (!btn || !nav) return;

  function isOpen() { return btn.getAttribute('aria-expanded') === 'true'; }
  function setOpen(open) {
    nav.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Close' : 'Menu';
  }
  btn.addEventListener('click', function () { setOpen(!isOpen()); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) { setOpen(false); btn.focus(); }
  });
  // Close after following a link, or on a tap anywhere outside the menu.
  nav.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('click', function (e) {
    if (isOpen() && !nav.contains(e.target) && !btn.contains(e.target)) setOpen(false);
  });
})();

// Analytics: GA4 doesn't count mailto: clicks on its own, so log them, and
// LinkedIn clicks by profile. Does nothing if GA isn't on the page.
(function () {
  document.addEventListener('click', function (e) {
    if (typeof gtag !== 'function') return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    if (a.protocol === 'mailto:') {
      gtag('event', 'email_click', {
        link_location: a.closest('header') ? 'header' : a.closest('footer') ? 'footer' : 'body'
      });
    } else if (/(^|\.)linkedin\.com$/.test(a.hostname)) {
      gtag('event', 'linkedin_click', { profile: a.pathname.indexOf('/in/') === 0 ? 'john' : 'company' });
    }
  });
})();
