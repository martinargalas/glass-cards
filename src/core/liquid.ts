import type { ReactiveController, ReactiveControllerHost } from "lit";
import { GLASS_DEFAULTS, blurredBackdrop, getRenderer, registerJob, webglAvailable, type GlassParams } from "./liquid-gl";

/**
 * Liquid glass, modelled on Apple's material:
 *  - a convex lens: the backdrop bends only within a bezel along the edge, the
 *    centre stays undistorted (displacement grows towards the edge like the slope
 *    of a rounded surface);
 *  - almost no colour change: light blur, mild saturation (no tint of its own);
 *  - a specular rim (CSS in styles.ts).
 *
 * The lens is an SVG displacement filter referenced from `backdrop-filter`, which
 * only Chromium supports; elsewhere the surface stays frosted. The displacement
 * map is computed from the element's real size and corner radius (signed distance
 * to a rounded rectangle), at quarter resolution, and cached per size.
 */
let uid = 0;

const supported = (() => {
  try {
    return CSS.supports("backdrop-filter", "url(#a)") && /Chrome\/\d+/.test(navigator.userAgent);
  } catch {
    return false;
  }
})();

const maps = new Map<string, string>();
const SCALE = 0.25;

/** Displacement map: R/G = x/y offset (128 = none), pointing along the edge normal. */
function lensMap(w: number, h: number, r: number, bezel: number): string {
  const key = `${w}x${h}r${r}b${bezel}`;
  const hit = maps.get(key);
  if (hit) return hit;
  const cw = Math.max(2, Math.round(w * SCALE));
  const ch = Math.max(2, Math.round(h * SCALE));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(cw, ch);
  const hw = w / 2;
  const hh = h / 2;
  const rr = Math.min(r, hw, hh);
  for (let py = 0; py < ch; py++) {
    for (let px = 0; px < cw; px++) {
      const x = (px + 0.5) / SCALE - hw;
      const y = (py + 0.5) / SCALE - hh;
      // signed distance to the rounded rectangle (negative inside)
      const qx = Math.abs(x) - (hw - rr);
      const qy = Math.abs(y) - (hh - rr);
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const d = Math.min(Math.max(qx, qy), 0) + Math.hypot(ox, oy) - rr;
      const inside = -d;
      let nx = 0;
      let ny = 0;
      if (ox > 0 && oy > 0) {
        const l = Math.hypot(ox, oy) || 1;
        nx = (ox / l) * Math.sign(x);
        ny = (oy / l) * Math.sign(y);
      } else if (qx > qy) nx = Math.sign(x);
      else ny = Math.sign(y);
      // 0 at the inner end of the bezel → 1 at the edge, steepening like a lens slope
      const t = Math.min(1, Math.max(0, 1 - inside / bezel));
      const m = 1 - Math.sqrt(1 - t * t);
      const i = (py * cw + px) * 4;
      img.data[i] = 128 + Math.round(127 * m * nx);
      img.data[i + 1] = 128 + Math.round(127 * m * ny);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL("image/png");
  maps.set(key, url);
  return url;
}

interface Lens {
  id: string;
  w: number;
  h: number;
  markup: string;
}

/**
 * Attaches a lens to every element matching `selector` in the host's shadow root
 * (one filter each, sized to that element). Re-scans after each render, so chips
 * that appear or disappear get or lose their lens.
 */
/** Inside the editor preview with its glass switched off (the studio sets `glass-fast`). */
function inFastPreview(el: Element): boolean {
  for (let n: Node | null = el; n; n = n instanceof ShadowRoot ? n.host : n.parentNode) {
    if ((n as Element).hasAttribute?.("glass-fast")) return true;
  }
  return false;
}

export class LiquidController implements ReactiveController {
  private ro?: ResizeObserver;
  private svg?: SVGSVGElement;
  private lenses = new Map<HTMLElement, Lens>();
  /** WebGL path: one canvas per target, re-rendered on resize / scroll. */
  private canvases = new Map<HTMLElement, HTMLCanvasElement>();
  private unregister?: () => void;
  private settle?: number;
  /** Every connected one: re-checked when the editor's "glass in the preview" flips. */
  private static connected = new Set<LiquidController>();

  /** The editor preview's glass switch flipped (`glass-fast` on its dashboard): draw the glass anew or take it down. */
  static refreshPreview() {
    for (const c of LiquidController.connected) c.host.requestUpdate();
  }

  constructor(
    private host: ReactiveControllerHost & HTMLElement,
    private selector = ".surface",
    private strength?: number,
    private legibilitySelector?: string,
    /**
     * Glass over a picture instead of the wallpaper (a bar over a room photo): returns the
     * element whose background image is behind `el`. Whatever the glass tier, even nested.
     */
    private under?: (el: HTMLElement) => Element | null | undefined,
  ) {
    host.addController(this);
  }

  get active() {
    // in a preview without glass nothing is liquid: the CSS glass stays, its blur turned off
    if (inFastPreview(this.host)) return false;
    if (this.under) return webglAvailable || supported;
    const g = this.host.getAttribute("glass");
    // glass-less containers (glass: none) still get the legibility boost over the wallpaper
    // home panels (Apple Home sidebar) are dark liquid glass too
    // nested: the panel is the glass – unless it has none and the card asks for its own
    const own = !this.host.hasAttribute("nested") || this.host.hasAttribute("own-tile");
    const wanted = g === "liquid" || (g === "home" && !this.host.hasAttribute("nested")) || (!!this.legibilitySelector && g === "none");
    return (webglAvailable || supported) && wanted && own;
  }

  /** Light glass: its own surface, on the wallpaper (not a bar over a photo). */
  private get light() {
    const own = !this.host.hasAttribute("nested") || this.host.hasAttribute("own-tile");
    return !this.under && this.host.getAttribute("glass") === "light" && own;
  }

  hostUpdated() {
    const root = this.host.shadowRoot;
    if (!root) return;
    if (this.light) {
      this.updateFake(root);
      return;
    }
    this.dropFake();
    if (!this.active) {
      this.teardown();
      return;
    }
    if (getRenderer()) {
      this.updateGl(root);
      return;
    }
    if (!supported) return;
    const targets = new Set(root.querySelectorAll<HTMLElement>(this.selector));
    for (const el of [...this.lenses.keys()]) {
      if (!targets.has(el)) {
        this.ro?.unobserve(el);
        el.style.removeProperty("backdrop-filter");
        this.lenses.delete(el);
      }
    }
    this.ro ??= new ResizeObserver((entries) => {
      let dirty = false;
      for (const e of entries) dirty = this.measure(e.target as HTMLElement) || dirty;
      if (dirty) this.flush();
    });
    for (const el of targets) {
      if (!this.lenses.has(el)) {
        this.lenses.set(el, { id: `glass-liquid-${++uid}`, w: 0, h: 0, markup: "" });
        this.ro.observe(el);
      }
    }
  }

  hostConnected() {
    LiquidController.connected.add(this);
    // moved in the page (a container rebuilt around it): disconnecting tore the glass down,
    // and an unchanged host would not update again – draw it anew
    if ((this.host as { hasUpdated?: boolean }).hasUpdated) this.host.requestUpdate();
  }

  hostDisconnected() {
    LiquidController.connected.delete(this);
    this.teardown();
    this.dropFake();
  }

  /* ── WebGL path ─────────────────────────────────────────────────────────── */

  /** Shader parameters: defaults, overridable per dashboard / theme via --glass-liquid-* vars. */
  private params(el: HTMLElement): GlassParams {
    // the element's own --glass-liquid-* first (a bar over a photo can blur more), else inherited
    const cs = getComputedStyle(el);
    const out = { radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 24, ...GLASS_DEFAULTS } as GlassParams;
    for (const key of Object.keys(GLASS_DEFAULTS) as (keyof typeof GLASS_DEFAULTS)[]) {
      const v = parseFloat(cs.getPropertyValue(`--glass-liquid-${key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}`));
      if (!Number.isNaN(v)) out[key] = v;
    }
    // panel color tint (glass_tint on the dashboard or this panel)
    const rgb = cs.getPropertyValue("--glass-panel-tint").split(",").map((x) => parseFloat(x));
    const a = parseFloat(cs.getPropertyValue("--glass-panel-tint-a"));
    if (rgb.length === 3 && rgb.every((x) => !Number.isNaN(x)) && !Number.isNaN(a)) {
      [out.tintR, out.tintG, out.tintB] = rgb;
      out.tintA = a;
    }
    return out;
  }

  /** Re-renders the glass now – for cards animating its shape (--glass-liquid-blob-*). */
  refresh() {
    this.renderGl();
  }

  private renderGl = () => {
    const r = getRenderer();
    if (!r) return;
    for (const [el, canvas] of this.canvases) {
      const under = this.under?.(el) ?? undefined;
      if (this.under && !under) continue;
      if (r.render(el, canvas, this.params(el), under)) el.classList.add("lg-on");
    }
    // glass-less (transparent) containers still get the legibility boost
    if (this.legibilitySelector) {
      const strength = this.params(this.host).contrast;
      this.host.shadowRoot?.querySelectorAll<HTMLElement>(this.legibilitySelector).forEach((el) => r.legibility(el, strength));
    }
  };

  private updateGl(root: ShadowRoot) {
    const targets = new Set(root.querySelectorAll<HTMLElement>(this.selector));
    for (const [el, canvas] of this.canvases) {
      if (!targets.has(el)) {
        this.ro?.unobserve(el);
        canvas.remove();
        el.classList.remove("lg-on");
        this.canvases.delete(el);
      }
    }
    this.ro ??= new ResizeObserver(() => this.renderGl());
    for (const el of targets) {
      let canvas = this.canvases.get(el);
      if (!canvas || !canvas.isConnected) {
        canvas = document.createElement("canvas");
        canvas.className = "lg";
        canvas.setAttribute("aria-hidden", "true");
        el.prepend(canvas);
        this.canvases.set(el, canvas);
        this.ro.observe(el);
      }
    }
    this.unregister ??= registerJob(this.renderGl);
    this.renderGl();
    // layout settles after fonts / sibling cards load; render once more then
    clearTimeout(this.settle);
    this.settle = window.setTimeout(this.renderGl, 600);
  }

  /* ── Light glass path ───────────────────────────────────────────────────── */

  private fakes = new Set<HTMLElement>();
  private unregisterFake?: () => void;

  private updateFake(root: ShadowRoot) {
    this.teardown();
    const targets = new Set(root.querySelectorAll<HTMLElement>(this.selector));
    for (const el of this.fakes) if (!targets.has(el)) this.clearFake(el);
    this.fakes = targets;
    this.unregisterFake ??= registerJob(this.placeFake);
    this.placeFake();
    // layout settles after fonts / sibling cards load
    clearTimeout(this.settle);
    this.settle = window.setTimeout(this.placeFake, 600);
  }

  /** Puts the blurred wallpaper under each element where the real one lies. */
  private placeFake = () => {
    for (const el of this.fakes) {
      if (!el.isConnected) continue;
      const bd = blurredBackdrop(el, () => this.placeFake());
      if (!bd) continue;
      const r = el.getBoundingClientRect();
      // a scaled editor preview: the picture in the element's own px
      const k = el.offsetWidth ? r.width / el.offsetWidth : 1;
      el.style.setProperty("--fake-img", `url("${bd.url}")`);
      el.style.setProperty("--fake-size", `${bd.rect.w / k}px ${bd.rect.h / k}px`);
      el.style.setProperty("--fake-pos", `${(bd.rect.x - r.x) / k}px ${(bd.rect.y - r.y) / k}px`);
      el.classList.add("fake-on");
    }
  };

  private clearFake(el: HTMLElement) {
    el.classList.remove("fake-on");
    for (const p of ["--fake-img", "--fake-size", "--fake-pos"]) el.style.removeProperty(p);
  }

  private dropFake() {
    this.unregisterFake?.();
    this.unregisterFake = undefined;
    for (const el of this.fakes) this.clearFake(el);
    this.fakes.clear();
  }

  /** Recomputes one element's filter; returns true when it changed. */
  private measure(el: HTMLElement): boolean {
    const lens = this.lenses.get(el);
    if (!lens) return false;
    const w = Math.round(el.offsetWidth);
    const h = Math.round(el.offsetHeight);
    if (!w || !h || (w === lens.w && h === lens.h)) return false;
    lens.w = w;
    lens.h = h;
    const r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 24, w / 2, h / 2);
    const bezel = Math.max(6, Math.min(30, Math.min(w, h) / 3));
    const scale = this.strength ?? Math.round(Math.min(56, bezel * 1.9));
    // Chromatic dispersion: red, green and blue are displaced by slightly different
    // amounts (like light through a real lens), then recombined. Strength from
    // --glass-liquid-dispersion (0 = off, 1 = default ≈ 8 % spread between channels).
    const rawDisp = parseFloat(getComputedStyle(this.host).getPropertyValue("--glass-liquid-dispersion"));
    const disp = Number.isNaN(rawDisp) ? 1 : rawDisp;
    const map = `<feImage href="${lensMap(w, h, r, bezel)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>`;
    const shift = (k: number, res: string) =>
      `<feDisplacementMap in="SourceGraphic" in2="map" scale="${(scale * k).toFixed(1)}" xChannelSelector="R" yChannelSelector="G" result="${res}"/>`;
    const only = (inp: string, row: number, res: string) => {
      const m = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0];
      m[row * 5 + row] = 1;
      return `<feColorMatrix in="${inp}" type="matrix" values="${m.join(" ")}" result="${res}"/>`;
    };
    const spread = 0.08 * disp;
    const body =
      disp > 0
        ? `${map}${shift(1, "dr")}${shift(1 - spread, "dg")}${shift(1 - spread * 2, "db")}` +
          `${only("dr", 0, "r")}${only("dg", 1, "g")}${only("db", 2, "b")}` +
          `<feBlend in="r" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="b" mode="screen"/>`
        : `${map}${shift(1, "out")}`;
    lens.markup = `<filter id="${lens.id}" x="0" y="0" width="${w}" height="${h}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">${body}</filter>`;
    // Milky, slightly brightened, barely saturated – the lens and bezel do the work.
    const rest = "blur(var(--glass-liquid-blur, 6px)) saturate(var(--glass-liquid-saturate, 115%)) brightness(var(--glass-liquid-brightness, 1.06))";
    el.style.setProperty("backdrop-filter", `url(#${lens.id}) ${rest}`);
    return true;
  }

  private flush() {
    const root = this.host.shadowRoot;
    if (!root) return;
    if (!this.svg) {
      this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.svg.setAttribute("aria-hidden", "true");
      this.svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
      root.appendChild(this.svg);
    }
    this.svg.innerHTML = [...this.lenses.values()].map((l) => l.markup).join("");
  }

  private teardown() {
    this.unregister?.();
    this.unregister = undefined;
    clearTimeout(this.settle);
    for (const [el, canvas] of this.canvases) {
      canvas.remove();
      el.classList.remove("lg-on");
    }
    this.canvases.clear();
    this.ro?.disconnect();
    this.ro = undefined;
    this.svg?.remove();
    this.svg = undefined;
    for (const el of this.lenses.keys()) el.style.removeProperty("backdrop-filter");
    this.lenses.clear();
  }
}
