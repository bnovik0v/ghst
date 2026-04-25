// Click-through via X11 input-shape (Electron BrowserWindow.setShape).
//
// We push the bounding rects of every visible interactive zone to main. Main
// calls setShape(rects) which tells the X server to:
//   - render only inside those rects (everything outside is fully transparent
//     to the compositor)
//   - route mouse events outside the rects to whatever is underneath
//
// Triggered by:
//   - ResizeObserver on #root (window resize, element size changes)
//   - MutationObserver on #root subtree (elements appearing/disappearing,
//     [hidden] attribute toggles, class changes)
//   - explicit refresh hook (settings open/close, etc.)
// Coalesced with requestAnimationFrame so we never push more than once per
// frame.
//
// When the settings panel is open, the shape covers the entire window so
// click-outside-to-close keeps working — the .settings layer needs to
// receive clicks across its full rect, not just where the panel is drawn.

type Rect = { x: number; y: number; width: number; height: number };
type CommandSink = (cmd: { kind: "set-shape"; rects: Rect[] }) => void;

// Selectors that should always capture mouse when visible. The :not()
// modifiers below filter at rect-collection time; the underlying elements
// are observed regardless so we still notice when they become visible.
const COLLECT_SELECTORS = [
  ".pod",
  ".ribbon:not([hidden])",
  ".self-line:not([hidden])",
  ".card__slot:not(:empty)",
  ".prep:not([hidden])",
];
const OBSERVE_SELECTORS = [
  ".pod",
  ".ribbon",
  ".self-line",
  ".card__slot",
  ".prep",
];

// Pad each rect generously so:
//   1. Soft drop-shadows (extend ~30px past the element via box-shadow blur)
//      aren't clipped by the shape — clipping makes the corner look hard.
//   2. Rounded corners aren't visually cut where the bounding rect just
//      barely contains the curved edge.
//   3. Hover-triggered widening (e.g. .pod buttons revealing their label on
//      :hover) has slack before a ResizeObserver fires on the next frame.
const PAD = 28;

function snap(rect: DOMRect): Rect {
  // setShape takes integer device-independent pixels.
  const x = Math.floor(rect.left - PAD);
  const y = Math.floor(rect.top - PAD);
  const right = Math.ceil(rect.right + PAD);
  const bottom = Math.ceil(rect.bottom + PAD);
  return { x, y, width: right - x, height: bottom - y };
}

function fullWindowRect(): Rect {
  return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
}

function collectRects(root: HTMLElement): Rect[] {
  // Settings open → capture everywhere so click-outside-to-close fires.
  const settings = document.getElementById("settings");
  if (settings && !settings.hidden) return [fullWindowRect()];

  const rects: Rect[] = [];
  for (const sel of COLLECT_SELECTORS) {
    for (const el of root.querySelectorAll<HTMLElement>(sel)) {
      // Skip zero-size elements (display:none ancestors, empty slots).
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      rects.push(snap(r));
    }
  }
  // setShape on an empty list disappears the window entirely on Linux X11
  // (issue electron/electron#31642). Always keep at least a sentinel rect —
  // the pod is the only element guaranteed to exist, so fall back to a 1×1
  // off-screen pixel if even that is missing somehow.
  if (rects.length === 0) rects.push({ x: -1, y: -1, width: 1, height: 1 });
  return rects;
}

function rectsEqual(a: Rect[], b: Rect[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].x !== b[i].x || a[i].y !== b[i].y ||
        a[i].width !== b[i].width || a[i].height !== b[i].height) return false;
  }
  return true;
}

export function installClickThrough(send: CommandSink): { refresh: () => void } {
  const root = document.getElementById("root") as HTMLElement;
  let lastRects: Rect[] = [];
  let scheduled = false;

  function flush(): void {
    scheduled = false;
    const next = collectRects(root);
    if (rectsEqual(next, lastRects)) return;
    lastRects = next;
    send({ kind: "set-shape", rects: next });
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(flush);
  }

  // Watch the size of every interactive element individually. Observing only
  // #root would miss intra-element growth (e.g. .pod widening when a key
  // button reveals its label on :hover) because #root is fixed to the window.
  const ro = new ResizeObserver(schedule);
  ro.observe(root);
  const observed = new Set<Element>();
  function rebindResizeObservers(): void {
    const next = new Set<Element>();
    for (const sel of OBSERVE_SELECTORS) {
      for (const el of root.querySelectorAll(sel)) next.add(el);
    }
    for (const el of observed) if (!next.has(el)) ro.unobserve(el);
    for (const el of next) if (!observed.has(el)) ro.observe(el);
    observed.clear();
    for (const el of next) observed.add(el);
  }
  rebindResizeObservers();

  // Watch visibility / structural changes anywhere in the tree. Anytime the
  // tree changes, also rebind the per-element ResizeObservers in case new
  // interactive elements were added (e.g. cards arriving) or old ones removed.
  const mo = new MutationObserver(() => {
    rebindResizeObservers();
    schedule();
  });
  mo.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["hidden", "class"],
  });

  // Window resize fires before ResizeObserver in some compositors; belt-and-
  // braces.
  window.addEventListener("resize", schedule);

  // Initial push as soon as layout has settled.
  schedule();

  return { refresh: schedule };
}
