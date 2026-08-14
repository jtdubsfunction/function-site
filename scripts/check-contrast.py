#!/usr/bin/env python3
"""Measure every text element against its real painted background.

    python3 scripts/check-contrast.py index.html
    python3 scripts/check-contrast.py index.html --screenshot

Run from the `function site/` project root.

Renders each file headless at desktop (1280px) and mobile (420px) widths.
Pass condition: zero results below the WCAG AA floor (4.5:1 normal text,
3:1 for AA-Large: >=24px, or >=18.66px at bold/700+).

Unlike the philosophy page's checker, this one does NOT hardcode a
selector list — it walks every element with its own direct text (not just
text inherited from children) and checks whatever it finds. That means it
keeps working as index.html's markup changes across revisions, with
nothing here to update. If you add a class-based checker for a new page,
prefer this generic approach over a hardcoded SEL list.

Requires: playwright  (pip install playwright && playwright install chromium)
Already installed in this environment as of 2026-08-07.
"""
import sys, os
from playwright.sync_api import sync_playwright

JS = """() => {
  const bgOf = el => { let n = el;
    while (n) { const c = getComputedStyle(n).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)') return c; n = n.parentElement; }
    return null; };
  const out = [];
  document.querySelectorAll('body *').forEach(el => {
    const directText = Array.from(el.childNodes)
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent.trim()).join('').trim();
    if (!directText) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return;
    const bg = bgOf(el); if (!bg) return;
    out.push({tag: el.tagName, cls: (el.className && typeof el.className === 'string') ? el.className : '',
              text: directText.slice(0, 40), fg: cs.color, bg,
              size: parseFloat(cs.fontSize), weight: cs.fontWeight});
  });
  return out;
}"""

def lum(c):
    v = [int(x) / 255 for x in c[c.find('(') + 1:c.find(')')].split(',')[:3]]
    v = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in v]
    return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]

def ratio(fg, bg):
    a, b = lum(fg), lum(bg); hi, lo = max(a, b), min(a, b)
    return round((hi + .05) / (lo + .05), 2)

def main():
    args = sys.argv[1:]
    do_screenshot = '--screenshot' in args
    files = [a for a in args if not a.startswith('--')]
    if not files:
        print(__doc__); sys.exit(1)

    failures = 0
    with sync_playwright() as p:
        b = p.chromium.launch()
        for f in files:
            url = 'file://' + os.path.abspath(f)
            for width, label in ((1280, 'desktop'), (420, 'mobile')):
                pg = b.new_page(viewport={'width': width, 'height': 1000}, reduced_motion='reduce')
                pg.goto(url)
                pg.wait_for_timeout(1200)
                if do_screenshot:
                    out_dir = os.path.join(os.path.dirname(os.path.abspath(f)), 'scripts', 'output')
                    os.makedirs(out_dir, exist_ok=True)
                    name = os.path.splitext(os.path.basename(f))[0]
                    pg.screenshot(path=os.path.join(out_dir, f'{name}_{label}.png'), full_page=True)
                rows = pg.evaluate(JS)
                print(f"\n=== {os.path.basename(f)} / {label} ({width}px) ===")
                seen, file_failures = set(), 0
                for r in rows:
                    v = ratio(r['fg'], r['bg'])
                    key = (r['tag'], r['cls'], r['text'], v)
                    if key in seen: continue
                    seen.add(key)
                    large = r['size'] >= 24 or (r['size'] >= 18.66 and int(float(r['weight'])) >= 700)
                    floor = 3.0 if large else 4.5
                    if v < floor:
                        failures += 1; file_failures += 1
                        label_str = f"{r['tag'].lower()}.{r['cls']}" if r['cls'] else r['tag'].lower()
                        print(f"  FAIL {v:6}  (floor {floor})  {label_str[:36]:36}  \"{r['text']}\"")
                if not file_failures:
                    print("  ok")
                pg.close()
        b.close()
    print(f"\n{failures} failure(s).")
    sys.exit(1 if failures else 0)

if __name__ == '__main__':
    main()
