/**
 * WebGL liquid glass.
 *
 * Instead of backdrop-filter (Chromium-only SVG lens, no dispersion, costs every
 * frame), each glass element gets a <canvas> behind its content into which a small
 * shader renders the *wallpaper* that is behind it: refracted through a convex
 * lens along the edge (signed distance field of the rounded rect), with chromatic
 * dispersion, milky tint, specular rim and inner glow. Rendered only when size or
 * position changes, so idle cost is zero, and it works in every browser with WebGL.
 *
 * The wallpaper is taken from HA's `hui-view-background` (position: fixed, the
 * theme's `lovelace-background`), mirroring its background-size/position exactly
 * so the glass lines up with what is really behind it. A bar over a picture (a
 * room photo) passes that element instead: its background image, placed and
 * filtered (greyscale…) as on screen.
 *
 * Approach inspired by dashersw/liquid-glass-js (MIT), which samples the page via
 * html2canvas; sampling the static wallpaper directly is what makes it cheap here.
 */

/**
 * Refraction model and defaults follow dashersw/liquid-glass-js: the sampling
 * offset (in wallpaper UV) is the sum of an edge term, a sharp rim term, an
 * optional centre warp, a corner boost and a ripple along the edge, each with its
 * own exponential falloff from the edge (distances per px). On top of that: RGB
 * dispersion and a specular highlight from the top left.
 */
export interface GlassParams {
  radius: number;
  edgeIntensity: number;
  rimIntensity: number;
  baseIntensity: number;
  edgeDistance: number;
  rimDistance: number;
  baseDistance: number;
  cornerBoost: number;
  ripple: number;
  tint: number;
  dispersion: number;
  specular: number;
  /** Uniform white edge line: brightness (0 = off) and width in px. */
  rimLight: number;
  rimWidth: number;
  blur: number;
  /** Corner shape as CSS `corner-shape: superellipse(1 + squircle)`: 0 = circular arcs, 1 = squircle, 0.5 ≈ Apple's continuous corner. */
  squircle: number;
  /** 0 = light (milky) glass, 1 = dark (smoky) glass for night. */
  dark: number;
  /** A drop budding off the glass (CSS px from the element's top left): the body starts
   *  `shapeLeft` px in, the drop is a circle at blobX/blobY, radius blobR (0 = none), melted
   *  into the body over blobK px. Animated by the cards, never set by a theme. */
  shapeLeft: number;
  blobX: number;
  blobY: number;
  blobR: number;
  blobK: number;
  /** Auto legibility over bright wallpaper: 0 = off, 1 = default strength. */
  contrast: number;
  /** Color tint of the glass (0–255 each) and its strength (0–1). */
  tintR?: number;
  tintG?: number;
  tintB?: number;
  tintA?: number;
}

/**
 * Tuned against macOS Control Center: visible lens along the edge, clean centre,
 * subtle colour fringe, no hard white line. (liquid-glass-js defaults were
 * rim 0.05 / 0.8, edge 0.01 / 0.15, base 0.01, ripple 0.1 – too sharp a rim
 * and almost no edge lens for large panels.)
 */
export const GLASS_DEFAULTS: Omit<GlassParams, "radius"> = {
  edgeIntensity: 0.06,
  rimIntensity: 0.06,
  baseIntensity: 0,
  edgeDistance: 0.12,
  rimDistance: 0.3,
  baseDistance: 0.1,
  cornerBoost: 0.03,
  ripple: 0,
  tint: 0.3,
  dispersion: 0.45,
  specular: 0.3,
  rimLight: 0.45,
  rimWidth: 1.25,
  blur: 6,
  squircle: 0,
  dark: 0,
  contrast: 1,
  shapeLeft: 0,
  blobX: 0,
  blobY: 0,
  blobR: 0,
  blobK: 0,
};

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2((a_pos.x + 1.0) * 0.5, (1.0 - a_pos.y) * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
uniform sampler2D u_bg;
uniform vec2 u_size;
uniform vec2 u_origin;
uniform vec4 u_bgRect;
uniform float u_radius;
uniform float u_px;   // one device pixel in CSS px (1 / devicePixelRatio)
uniform float u_sq;
uniform float u_edgeI, u_rimI, u_baseI, u_edgeD, u_rimD, u_baseD, u_corner, u_ripple, u_tint, u_disp, u_spec, u_rimL, u_rimW, u_dark, u_shade, u_tintA;
uniform vec3 u_tintC;
uniform vec4 u_blob;  // drop: centre (px from top left), radius (0 = none), melt
uniform float u_shL;  // body starts this many px from the left
varying vec2 v_uv;

float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  // corner: |x|^n + |y|^n = 1 with n = 2^(1 + u_sq) – CSS superellipse(1 + u_sq): a circle at 0, a squircle at 1
  vec2 o = max(q, 0.0) / max(r, 1e-3);
  float n = pow(2.0, 1.0 + u_sq);
  float corner = r * pow(pow(o.x, n) + pow(o.y, n), 1.0 / n);
  return min(max(q.x, q.y), 0.0) + corner - r;
}
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / max(k, 1e-3);
  return min(a, b) - h * h * k * 0.25;
}
// the glass's outline: the body (from u_shL on), with a drop melted into it while one buds off
float sdShape(vec2 c, vec2 b, float r) {
  if (u_blob.z <= 0.0 && u_shL <= 0.0) return sdRoundRect(c, b, r);
  vec2 bb = vec2(b.x - u_shL * 0.5, b.y);
  float d = sdRoundRect(c - vec2(u_shL * 0.5, 0.0), bb, min(r, min(bb.x, bb.y)));
  if (u_blob.z > 0.0) d = smin(d, length(c + b - u_blob.xy) - u_blob.z, u_blob.w);
  return d;
}
vec4 bg(vec2 uv) { return texture2D(u_bg, uv); }

void main() {
  vec2 coord = v_uv;
  vec2 p = coord * u_size;
  vec2 b = u_size * 0.5;
  vec2 c = p - b;
  float r = min(u_radius, min(b.x, b.y));
  float sd = sdShape(c, b, r);
  // anti-alias over one device pixel only – crisp edge on Retina
  float mask = 1.0 - smoothstep(-u_px, u_px, sd);
  if (mask <= 0.0) discard;

  // page (wallpaper) UV of this pixel
  vec2 uv = (u_origin + p - u_bgRect.xy) / u_bgRect.zw;

  float d = max(-sd, 0.0);                       // px from the edge
  vec2 n = normalize(coord - 0.5 + 1e-5);       // radial normal (as liquid-glass-js)
  float minRes = min(u_size.x, u_size.y);

  float baseK = (1.0 - exp(-d * u_baseD)) * u_baseI;
  float edgeK = exp(-d * u_edgeD) * u_edgeI;
  float rimF = exp(-d * u_rimD);
  vec2 refr = n * (baseK + edgeK + rimF * u_rimI);

  float cx = min(coord.x, 1.0 - coord.x);
  float cy = min(coord.y, 1.0 - coord.y);
  refr += n * exp(-max(cx, cy) * minRes * 0.3) * u_corner;

  vec2 perp = vec2(-n.y, n.x);
  refr += perp * sin(d / minRes * 25.0) * u_ripple * rimF;

  // chromatic dispersion: red bends a little more, blue a little less
  vec3 col = vec3(
    bg(uv + refr * (1.0 + u_disp)).r,
    bg(uv + refr).g,
    bg(uv + refr * (1.0 - u_disp)).b);

  // tint: white→grey vertical gradient, then a hint of the wallpaper's own colours.
  // Night (u_dark): no milk – the glass takes the wallpaper's colour behind it,
  // slightly lifted and saturated like macOS, just a touch darker towards the bottom.
  vec2 cuv = (u_origin + b - u_bgRect.xy) / u_bgRect.zw;
  vec2 dy = vec2(0.0, u_size.y * 0.4 / u_bgRect.w);
  vec3 sampled = coord.y < 0.5
    ? mix(bg(cuv - dy).rgb, bg(cuv).rgb, coord.y * 2.0)
    : mix(bg(cuv).rgb, bg(cuv + dy).rgb, coord.y * 2.0 - 1.0);
  float lum = dot(sampled, vec3(0.299, 0.587, 0.114));
  vec3 vivid = clamp(mix(vec3(lum), sampled, 1.25) * 1.12 + 0.04, 0.0, 1.0);
  vec3 nightGrad = vivid * mix(1.0, 0.82, coord.y);
  vec3 grad = mix(mix(vec3(1.0), vec3(0.7), coord.y), nightGrad, u_dark);
  col = mix(col, grad, mix(u_tint, 0.35, u_dark));
  col = mix(col, sampled, u_tint * 0.3 * (1.0 - u_dark));
  // bright wallpaper behind: less milk and a slightly deeper glass, so white
  // text keeps its contrast (u_shade, from the wallpaper's luminance)
  col = mix(col, col * vec3(0.74, 0.76, 0.8), u_shade);
  // user color tint: colours the glass, the wallpaper still shows through
  col = mix(col, u_tintC, u_tintA);

  // specular highlight from the top left along the edge (not in liquid-glass-js)
  vec2 sn = normalize(vec2(
    sdShape(c + vec2(0.75, 0.0), b, r) - sdShape(c - vec2(0.75, 0.0), b, r),
    sdShape(c + vec2(0.0, 0.75), b, r) - sdShape(c - vec2(0.0, 0.75), b, r)) + 1e-5);
  vec2 L = normalize(vec2(-0.55, -0.83));
  float edgeBand = exp(-d * 0.12) * smoothstep(0.0, 3.0, d);
  col += u_spec * edgeBand * (pow(max(dot(sn, L), 0.0), 2.0) * 0.6 + pow(max(dot(sn, -L), 0.0), 2.0) * 0.25);

  // Edge light like macOS. Left/right: a dark (blue) line on the outer edge –
  // the glass thickness – running into the corner arcs and fading out there as
  // the edge turns horizontal. A white line runs just inside it and moves out to
  // the very edge past the corners, where it becomes the top/bottom line:
  // strongest mid-edge with a soft blue tint below it.
  float rimL = u_rimL * mix(1.0, 0.85, u_dark);
  float alongX = 1.0 - smoothstep(0.0, 1.0, abs(coord.x - 0.5) * 2.0);
  float alongY = 1.0 - smoothstep(0.0, 1.0, abs(coord.y - 0.5) * 2.0);
  float side = smoothstep(0.25, 0.95, abs(sn.x));          // 1 on the sides, 0 top/bottom
  float darkW = u_rimW * 1.0;
  float darkLine = 1.0 - smoothstep(darkW - u_px, darkW + u_px, d);
  float darkShade = exp(-max(d - darkW, 0.0) / 4.0) * (1.0 - darkLine);
  vec3 dark = vec3(0.03, 0.045, 0.08);   // near black
  col = mix(col, dark, clamp(rimL * (0.85 * darkLine + 0.12 * darkShade) * side, 0.0, 1.0));

  // the light line runs along the outer edge through the corner arcs, then slips
  // inside (under) the dark side line and ends there
  float wOff = darkW * smoothstep(0.3, 0.85, abs(sn.x));
  float lineW = u_rimW * 1.5;
  float core = smoothstep(wOff - u_px, wOff + u_px, d) * (1.0 - smoothstep(wOff + lineW - u_px, wOff + lineW + u_px, d));
  float whiteW = mix(0.55, 1.0, alongX) * (1.0 - smoothstep(0.55, 0.98, abs(sn.x)));
  float tintBand = exp(-max(d - lineW, 0.0) / 6.0) * (1.0 - core);
  // glow takes its hue from the wallpaper behind, always light (towards white)
  vec3 envG = bg(uv).rgb;
  vec3 glowCol = mix(vec3(1.0), envG / max(max(envG.r, max(envG.g, envG.b)), 0.01), 0.42);
  col = mix(col, glowCol, clamp(rimL * 1.4 * tintBand * abs(sn.y) * alongX, 0.0, 1.0));
  // the line picks up the colours behind it: white over light areas, a bright
  // shade of the wallpaper over saturated ones
  vec3 env = bg(uv).rgb;
  vec3 lineCol = mix(vec3(1.0), min(env * 1.35 + 0.3, vec3(1.0)), 0.55);
  col = mix(col, lineCol, clamp(rimL * 1.6 * core * whiteW, 0.0, 1.0));

  gl_FragColor = vec4(min(col, vec3(1.0)) * mask, mask);
}`;

interface Backdrop {
  url: string;
  rect: { x: number; y: number; w: number; h: number };
  /** CSS filter of the element (a room photo in greyscale), baked into the texture. */
  filter?: string;
}

/**
 * Puts a wallpaper on HA's view background (over the theme's), so a dashboard
 * whose day / night follows the sun can switch it too; undefined = the theme's.
 */
/**
 * An address of a picture that may come with the cards: `glass:<name>` is one of the bundled
 * wallpapers (wallpapers/<name>.jpg next to the bundle), `glass:<folder>/<file>` any other
 * bundled file (the demo home's photos: glass:demo/laundry.jpg); anything else as it is.
 */
export function wallpaperUrl(url: string | undefined): string | undefined {
  const m = url?.match(/^glass:([\w-]+(?:\/[\w.-]+)?)$/);
  if (!m) return url;
  // the bundle's own address in a variable: Vite would turn `new URL(…, import.meta.url)` into a lookup of files beside the source
  const bundle = import.meta.url;
  return new URL(m[1].includes("/") ? `./${m[1]}` : `./wallpapers/${m[1]}.jpg`, bundle).href;
}
export const assetUrl = wallpaperUrl;

export function setWallpaper(url: string | undefined) {
  url = wallpaperUrl(url);
  const el = deepFind(document, "hui-view-background") as HTMLElement | null;
  if (!el) return false;
  // the whole picture's placing too: the theme is only a plain colour (no flash of the day picture)
  const fit: [string, string][] = [
    ["background-size", "cover"],
    ["background-position", "center"],
    ["background-repeat", "no-repeat"],
    ["background-attachment", "fixed"],
  ];
  if (url) {
    el.style.setProperty("background-image", `url("${url}")`, "important");
    for (const [k, v] of fit) el.style.setProperty(k, v, "important");
  } else {
    el.style.removeProperty("background-image");
    for (const [k] of fit) el.style.removeProperty(k);
  }
  return true;
}

/** HA's wallpaper element – as `under` for glass that sits on the wallpaper but is nested (a compact room strip). */
export const wallpaperElement = () => deepFind(document, "hui-view-background");

/** Finds the wallpaper element HA paints behind the view and maps its image into viewport px. */
function findBackdrop(): Backdrop | undefined {
  const el = deepFind(document, "hui-view-background");
  return el ? backdropOf(el) : undefined;
}

/** The editor preview's own wallpaper when `el` sits in one, else HA's. */
function backdropFor(el: Element): Backdrop | undefined {
  for (let n: Node | null = el; n; n = n instanceof ShadowRoot ? n.host : n.parentNode) {
    if (n instanceof HTMLElement && n.classList.contains("pv-frame")) return n.classList.contains("bg") ? backdropOf(n) : findBackdrop();
  }
  return findBackdrop();
}

/** An element's background image (cover / contain / natural size, background-position), in viewport px. */
function backdropOf(el: Element): Backdrop | undefined {
  const s = getComputedStyle(el);
  const m = s.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
  if (!m) return undefined;
  const box = el.getBoundingClientRect();
  const img = images.get(m[1])?.img;
  if (!img || !img.naturalWidth) return { url: m[1], rect: { x: box.x, y: box.y, w: box.width, h: box.height } };
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  let w = iw;
  let h = ih;
  const size = s.backgroundSize;
  if (size === "cover" || size === "contain") {
    const k = size === "cover" ? Math.max(box.width / iw, box.height / ih) : Math.min(box.width / iw, box.height / ih);
    w = iw * k;
    h = ih * k;
  }
  const [px, py] = s.backgroundPosition.split(" ").map((v) => (v.endsWith("%") ? parseFloat(v) / 100 : NaN));
  const x = box.x + (Number.isNaN(px) ? 0.5 : px) * (box.width - w);
  const y = box.y + (Number.isNaN(py) ? 0.5 : py) * (box.height - h);
  const filter = s.filter && s.filter !== "none" ? s.filter : undefined;
  return { url: m[1], rect: { x, y, w, h }, filter };
}

let cachedBg: Element | null = null;
function deepFind(root: Document | ShadowRoot, tag: string): Element | null {
  if (cachedBg?.isConnected) return cachedBg;
  const stack: (Document | ShadowRoot)[] = [root];
  while (stack.length) {
    const r = stack.pop()!;
    const hit = r.querySelector(tag);
    if (hit) return (cachedBg = hit);
    r.querySelectorAll("*").forEach((e) => e.shadowRoot && stack.push(e.shadowRoot));
  }
  return null;
}

const images = new Map<string, { img: HTMLImageElement; ready: Promise<void> }>();

/** 48×48 copy of a picture (filtered as on screen), for averaging colours under an element. */
const thumbs = new Map<string, Uint8ClampedArray>();
function thumbOf(img: HTMLImageElement, filter?: string): Uint8ClampedArray {
  const key = `${img.src}|${filter ?? ""}`;
  let d = thumbs.get(key);
  if (!d) {
    const t = document.createElement("canvas");
    t.width = t.height = 48;
    const ctx = t.getContext("2d", { willReadFrequently: true })!;
    if (filter) ctx.filter = filter;
    ctx.drawImage(img, 0, 0, 48, 48);
    d = ctx.getImageData(0, 0, 48, 48).data;
    thumbs.set(key, d);
  }
  return d;
}
function loadImage(url: string) {
  let entry = images.get(url);
  if (!entry) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const ready = new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = rej;
    });
    img.src = url;
    entry = { img, ready };
    images.set(url, entry);
  }
  return entry;
}

/**
 * Light glass: the wallpaper (as `el` sees it) blurred once into a small picture, and where
 * that picture lies in viewport px – the element shows it under its frosted fill instead of
 * blurring live. Undefined while it loads or without a wallpaper.
 */
const blurredPics = new Map<string, string | null>();
export function blurredBackdrop(el: Element, done: () => void): { url: string; rect: { x: number; y: number; w: number; h: number } } | undefined {
  const bd = backdropFor(el);
  if (!bd) return undefined;
  const key = `${bd.url}|${bd.filter ?? ""}`;
  const pic = blurredPics.get(key);
  if (pic) return { url: pic, rect: bd.rect };
  if (pic === undefined) {
    blurredPics.set(key, null);
    const { img, ready } = loadImage(bd.url);
    ready
      .then(() => {
        // small: it is blurred anyway – a 30 px blur over a viewport-wide picture
        const w = 480;
        const h = Math.max(1, Math.round((w * img.naturalHeight) / img.naturalWidth));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d")!;
        ctx.filter = `${bd.filter ?? ""} blur(${Math.round((w / Math.max(1, bd.rect.w)) * 30)}px) saturate(120%)`.trim();
        // drawn a little larger, so the blur does not fade out at the edges
        const m = w * 0.04;
        ctx.drawImage(img, -m, -m * (h / w), w + 2 * m, h + 2 * m * (h / w));
        c.toBlob((b) => {
          if (!b) return;
          blurredPics.set(key, URL.createObjectURL(b));
          done();
        });
      })
      .catch(() => blurredPics.delete(key));
  }
  return undefined;
}

class Renderer {
  private canvas = document.createElement("canvas");
  private gl: WebGLRenderingContext | null;
  private prog?: WebGLProgram;
  /** Uploaded pictures (the wallpaper, room photos), each pre-blurred and filtered once. */
  private texs = new Map<string, { tex: WebGLTexture; thumb: Uint8ClampedArray }>();
  /** 48×48 copy of the current picture for averaging colours under an element. */
  private thumb?: Uint8ClampedArray;
  private loc: Record<string, WebGLUniformLocation | null> = {};

  constructor() {
    this.gl = this.canvas.getContext("webgl", { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    if (this.gl) this.init(this.gl);
  }

  get ok() {
    return !!this.gl && !!this.prog;
  }

  private init(gl: WebGLRenderingContext) {
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    try {
      const p = gl.createProgram()!;
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link");
      gl.useProgram(p);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const a = gl.getAttribLocation(p, "a_pos");
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      for (const u of ["u_bg", "u_size", "u_origin", "u_bgRect", "u_radius", "u_edgeI", "u_rimI", "u_baseI", "u_edgeD", "u_rimD", "u_baseD", "u_corner", "u_ripple", "u_tint", "u_disp", "u_spec", "u_rimL", "u_rimW", "u_px", "u_dark", "u_shade", "u_tintA", "u_tintC", "u_sq", "u_blob", "u_shL"]) {
        this.loc[u] = gl.getUniformLocation(p, u);
      }
      this.prog = p;
    } catch (e) {
      console.warn("glass-cards: WebGL liquid glass unavailable", e);
    }
  }

  /** Uploads a picture, pre-blurred (blur in viewport px → image px) and filtered once, and binds it. */
  private texture(img: HTMLImageElement, bgW: number, blur: number, filter?: string) {
    const gl = this.gl!;
    const maxSide = 2048;
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k);
    const h = Math.round(img.naturalHeight * k);
    const blurPx = Math.max(0, (blur * w) / bgW);
    const key = `${img.src}|${w}|${blurPx.toFixed(1)}|${filter ?? ""}`;
    let entry = this.texs.get(key);
    if (!entry) {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      const f = [blurPx > 0.3 ? `blur(${blurPx}px)` : "", filter ?? ""].join(" ").trim();
      if (f) ctx.filter = f;
      ctx.drawImage(img, 0, 0, w, h);
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      entry = { tex, thumb: thumbOf(img, filter) };
      this.texs.set(key, entry);
      // a few wallpapers and room photos (on / off / night each) – drop the oldest beyond that
      if (this.texs.size > 40) {
        const [old, e] = this.texs.entries().next().value!;
        gl.deleteTexture(e.tex);
        this.texs.delete(old);
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    this.thumb = entry.thumb;
  }

  /**
   * Sets --glass-edge-light on `target` from the wallpaper colour behind it: its
   * hue at full brightness, well over half-way to white. Nested tiles and controls inherit
   * it for their CSS edge glow.
   */
  private edgeLight(target: HTMLElement, r: DOMRect, bg: { x: number; y: number; w: number; h: number }): number {
    const d = this.thumb;
    if (!d) return 0;
    const x0 = Math.max(0, Math.floor(((r.left - bg.x) / bg.w) * 48));
    const x1 = Math.min(47, Math.ceil(((r.right - bg.x) / bg.w) * 48));
    const y0 = Math.max(0, Math.floor(((r.top - bg.y) / bg.h) * 48));
    const y1 = Math.min(47, Math.ceil(((r.bottom - bg.y) / bg.h) * 48));
    let R = 0, G = 0, B = 0, n = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = (y * 48 + x) * 4;
        R += d[i];
        G += d[i + 1];
        B += d[i + 2];
        n++;
      }
    if (!n) return 0;
    const m = Math.max(R, G, B, 1);
    const c = [R, G, B].map((v) => Math.round(255 * (0.58 + (0.42 * v) / m)));
    target.style.setProperty("--glass-edge-light", c.join(", "));
    return (0.299 * R + 0.587 * G + 0.114 * B) / (n * 255);
  }

  /**
   * Legibility over bright wallpaper: from the luminance behind `target`, a
   * 0…1 shade (0 below ~55 %, 1 from ~85 %), and a stronger text / icon shadow
   * for everything inside (inherited --glass-text-shadow / --glass-icon-shadow).
   */
  contrast(target: HTMLElement, lum: number, strength: number): number {
    const t = Math.min(1, Math.max(0, (lum - 0.55) / 0.3));
    const k = t * t * (3 - 2 * t) * strength;
    if (k < 0.02) {
      target.style.removeProperty("--glass-text-shadow");
      target.style.removeProperty("--glass-icon-shadow");
      return 0;
    }
    const a = (x: number) => x.toFixed(3);
    target.style.setProperty(
      "--glass-text-shadow",
      `0 1px 2px rgba(0, 0, 0, ${a(0.16 + 0.22 * k)}), 0 0 ${Math.round(12 + 10 * k)}px rgba(0, 0, 0, ${a(0.08 + 0.22 * k)})`,
    );
    target.style.setProperty("--glass-icon-shadow", `drop-shadow(0 2px ${Math.round(6 + 4 * k)}px rgba(0, 0, 0, ${a(0.35 + 0.2 * k)}))`);
    return k;
  }

  /** Contrast only (no glass), for transparent panels such as the date header. */
  legibility(target: HTMLElement, strength = 1) {
    const bd = backdropFor(target);
    if (!bd) return;
    // the wallpaper's colours, not the last room photo's
    const entry = images.get(bd.url);
    if (!entry?.img.naturalWidth) return;
    this.thumb = thumbOf(entry.img);
    const r = target.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const d = this.thumb;
    const x0 = Math.max(0, Math.floor(((r.left - bd.rect.x) / bd.rect.w) * 48));
    const x1 = Math.min(47, Math.ceil(((r.right - bd.rect.x) / bd.rect.w) * 48));
    const y0 = Math.max(0, Math.floor(((r.top - bd.rect.y) / bd.rect.h) * 48));
    const y1 = Math.min(47, Math.ceil(((r.bottom - bd.rect.y) / bd.rect.h) * 48));
    let L = 0, n = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = (y * 48 + x) * 4;
        L += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        n++;
      }
    if (n) this.contrast(target, L / (n * 255), strength);
  }

  /**
   * Renders the glass for `target` into `out` – over the wallpaper, or over `under`'s
   * background image (a room photo). Returns false when it can't (no picture yet…).
   */
  render(target: HTMLElement, out: HTMLCanvasElement, p: GlassParams, under?: Element): boolean {
    if (!this.ok) return false;
    // glass straight on the wallpaper (a compact room, people, the dock) passes HA's wallpaper:
    // in the editor preview that is the preview's own one
    if (under && under === wallpaperElement()) under = undefined;
    const bd = under ? backdropOf(under) : backdropFor(target);
    if (!bd) return false;
    const entry = loadImage(bd.url);
    if (!entry.img.complete || !entry.img.naturalWidth) {
      entry.ready.then(() => scheduleAll()).catch(() => {});
      return false;
    }
    const gl = this.gl!;
    const r = target.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    // scaled ancestors (HA edit mode, editor preview zoom): the shape is drawn in
    // screen px, so CSS-px sizes (corner radius, rim width) scale with it
    const k = target.offsetWidth ? r.width / target.offsetWidth : 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(r.width * dpr);
    const H = Math.round(r.height * dpr);
    this.texture(entry.img, bd.rect.w, (p.blur / 2) ** 2, bd.filter);
    const shade = this.contrast(target, this.edgeLight(target, r, bd.rect) ?? 0, p.contrast);
    this.canvas.width = W;
    this.canvas.height = H;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1i(this.loc.u_bg, 0);
    gl.uniform2f(this.loc.u_size, r.width, r.height);
    gl.uniform2f(this.loc.u_origin, r.x, r.y);
    gl.uniform4f(this.loc.u_bgRect, bd.rect.x, bd.rect.y, bd.rect.w, bd.rect.h);
    const set = (name: string, v: number) => gl.uniform1f(this.loc[name], v);
    // the lens offsets are in picture UV: over a picture smaller than the wallpaper, scale
    // them so the glass bends as many px as a panel's over the wallpaper
    const wall = under ? backdropFor(target)?.rect.w : undefined;
    const bend = wall ? wall / bd.rect.w : 1;
    set("u_radius", p.radius * k);
    set("u_edgeI", p.edgeIntensity * bend);
    set("u_rimI", p.rimIntensity * bend);
    set("u_baseI", p.baseIntensity * bend);
    set("u_edgeD", p.edgeDistance);
    set("u_rimD", p.rimDistance);
    set("u_baseD", p.baseDistance);
    set("u_corner", p.cornerBoost * bend);
    set("u_ripple", p.ripple);
    set("u_tint", p.tint);
    // the colour fringe is the same px as on a panel, but a smooth wallpaper hides it where a
    // detailed photo shows every edge as a rainbow – a third of it over a picture
    set("u_disp", p.dispersion * (under && under !== wallpaperElement() ? 0.3 : 1));
    set("u_spec", p.specular);
    set("u_rimL", p.rimLight);
    set("u_rimW", p.rimWidth * k);
    set("u_dark", p.dark);
    set("u_sq", p.squircle);
    set("u_shL", p.shapeLeft * k);
    gl.uniform4f(this.loc.u_blob, p.blobX * k, p.blobY * k, p.blobR * k, p.blobK * k);
    set("u_shade", shade);
    set("u_tintA", p.tintA ?? 0);
    gl.uniform3f(this.loc.u_tintC, (p.tintR ?? 255) / 255, (p.tintG ?? 255) / 255, (p.tintB ?? 255) / 255);
    set("u_px", 1 / dpr);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (out.width !== W) out.width = W;
    if (out.height !== H) out.height = H;
    const ctx = out.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.canvas, 0, 0);
    return true;
  }
}

let renderer: Renderer | undefined;
export function getRenderer(): Renderer | undefined {
  renderer ??= new Renderer();
  return renderer.ok ? renderer : undefined;
}

export const webglAvailable = (() => {
  try {
    return !!document.createElement("canvas").getContext("webgl");
  } catch {
    return false;
  }
})();

/* ── global re-render scheduling (resize, scroll, wallpaper load) ─────────── */
const jobs = new Set<() => void>();
let frame = 0;
export function scheduleAll() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    jobs.forEach((j) => j());
  });
}
export function registerJob(job: () => void) {
  if (!jobs.size) {
    window.addEventListener("resize", scheduleAll, { passive: true });
    window.addEventListener("scroll", scheduleAll, { passive: true, capture: true });
  }
  jobs.add(job);
  return () => {
    jobs.delete(job);
    if (!jobs.size) {
      window.removeEventListener("resize", scheduleAll);
      window.removeEventListener("scroll", scheduleAll, { capture: true });
    }
  };
}
