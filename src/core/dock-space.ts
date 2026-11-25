/**
 * Room down to the dock: how tall a card can be from its top to the navigation dock at the screen's
 * bottom (a glass-dock, or Bubble Card's horizontal buttons stack) – or to the screen's bottom.
 */

/** The docks on screen (through shadow roots). */
export function findDocks(root: Document | ShadowRoot = document, depth = 0, out: Element[] = []): Element[] {
  for (const el of root.querySelectorAll("*")) {
    if ((el.localName === "glass-dock" || el.classList.contains("horizontal-buttons-stack-card")) && el.getBoundingClientRect().height > 0) out.push(el);
    if (el.shadowRoot && depth < 12) findDocks(el.shadowRoot, depth + 1, out);
  }
  return out;
}

/** The dock on screen, if any. */
export function findDock(): Element | undefined {
  return findDocks()[0];
}

/** The nearest box around the element that scrolls (a pop-up, Glass Studio's phone), if any. */
function clipBox(el: Element): Element | undefined {
  let n: Node | null = el;
  while (n) {
    const p: Node | null = (n as Element).assignedSlot ?? n.parentNode ?? ((n as ShadowRoot).host as Node | undefined) ?? null;
    if (p instanceof Element && p !== document.documentElement && p !== document.body) {
      const o = getComputedStyle(p).overflowY;
      // a box that scrolls (a pop-up, Studio's phone screen) – not one sized by what's in it
      if (o === "auto" || o === "scroll") return p;
    }
    n = p;
  }
  return undefined;
}

/**
 * From the element's top down to the dock (16 px above it), else the bottom of what it's in (a pop-up,
 * Glass Studio's phone) or the screen's – in CSS px, also in a preview drawn smaller.
 */
export function roomToDock(el: Element, min = 320, gap = 16): number {
  const rect = el.getBoundingClientRect();
  const h = (el as HTMLElement).offsetHeight;
  const scale = h > 0 && rect.height > 0 ? rect.height / h : 1;
  const top = rect.top;
  let bottom = window.innerHeight;
  const box = clipBox(el);
  if (box) {
    const r = box.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(box).paddingBottom) || 0;
    if (r.height) bottom = Math.min(bottom, r.bottom - pad * scale);
  }
  bottom -= gap * scale;
  // a dock under the card (below its top, across its width, on the same screen – Studio may show
  // another dashboard's dock elsewhere)
  for (const d of findDocks()) {
    const r = d.getBoundingClientRect();
    if (r.top > top + 100 && r.top < bottom + gap * scale && r.left < rect.right && r.right > rect.left) bottom = Math.min(bottom, r.top - gap * scale);
  }
  return Math.max(min, Math.round((bottom - top) / scale));
}
