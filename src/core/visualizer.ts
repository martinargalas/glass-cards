/**
 * A visualizer in place of a cover: the cover's own colours moving to the music.
 *
 * Home Assistant never hands a card the sound (a Sonos plays it, not the browser), so there is no
 * spectrum to measure. The visualizer plays its own: a beat, a snare, hi-hats and a melody, seeded by
 * the song (the same song moves the same way) and set by where in the song it is (a seek, a pause, the
 * start and the end of the song show). The colours are the cover's: every block, bar and dot is drawn
 * from a pixel of it – and drawing a picture needs no reading of it, so covers from another origin
 * (without CORS) work too.
 */

export type VizStyle = "ring" | "bars" | "orbit";
export const VIZ_STYLES: VizStyle[] = ["ring", "bars", "orbit"];

/** What plays: from where (seconds at `at`, ms), whether it moves on, how long, which song. */
export interface VizTrack {
  playing: boolean;
  pos: number;
  at: number;
  dur: number;
  seed: string;
}

/** Bands of the made-up spectrum, low to high. */
const N = 48;
/** The cover, small: one pixel a block. */
const S = 32;

const TAU = Math.PI * 2;
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** Smooth noise: 0–1, gliding between random values at whole numbers. */
const noise = (x: number, s: number) => {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i + s * 57.3) * (1 - u) + hash(i + 1 + s * 57.3) * u;
};
const seedOf = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 7.3;
};

/** A cover's pictures, shared by the visualizers showing it: the picture and its tiny copies. */
interface Art {
  img?: HTMLImageElement;
  /** S × S: a pixel per block */
  px: HTMLCanvasElement;
  /** its light, soft round the edges: the glow behind the orbit */
  glow: HTMLCanvasElement;
}
const arts = new Map<string, Promise<Art>>();

/** Colours for no cover: the card's accent, else a calm palette. */
function plainArt(accent?: string): Art {
  const px = document.createElement("canvas");
  px.width = px.height = S;
  const g = px.getContext("2d")!;
  const cols = accent && !accent.includes("var(") ? [accent, "#ffffff", accent] : ["#5b8def", "#b06ee6", "#ef7a6b"];
  const gr = g.createLinearGradient(0, 0, S, S);
  cols.forEach((c, i) => gr.addColorStop(i / (cols.length - 1), c));
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return { px, glow: glowOf(px) };
}

function glowOf(px: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = true;
  g.drawImage(px, 0, 0, S, S, 0, 0, 96, 96);
  g.globalCompositeOperation = "destination-in";
  const r = g.createRadialGradient(48, 48, 6, 48, 48, 48);
  r.addColorStop(0, "rgba(0,0,0,1)");
  r.addColorStop(0.55, "rgba(0,0,0,0.55)");
  r.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 96, 96);
  return c;
}

/**
 * A dark (or washed-out) cover would draw blocks of black: its dull pixels take the colour of the
 * nearest lively one, a shade darker – the cover's colours where they were. A picture from another
 * origin can't be read: it stays as it is.
 */
function vivid(g: CanvasRenderingContext2D) {
  let im: ImageData;
  try {
    im = g.getImageData(0, 0, S, S);
  } catch {
    return;
  }
  const d = im.data;
  const good: number[] = [];
  const dull: number[] = [];
  for (let i = 0; i < S * S; i++) {
    const r = d[i * 4],
      gr = d[i * 4 + 1],
      b = d[i * 4 + 2];
    const mx = Math.max(r, gr, b);
    const mn = Math.min(r, gr, b);
    const sat = mx ? (mx - mn) / mx : 0;
    // lively: bright enough and coloured, or a clear light grey
    ((mx > 105 && sat > 0.28) || (mx > 175 && mn < 238) ? good : dull).push(i);
  }
  if (good.length < 12 || !dull.length) return;
  for (const i of dull) {
    const x = i % S,
      y = (i / S) | 0;
    let best = good[0],
      bd = Infinity;
    for (const j of good) {
      const dx = (j % S) - x,
        dy = ((j / S) | 0) - y;
      const dd = dx * dx + dy * dy;
      if (dd < bd) ((bd = dd), (best = j));
    }
    const k = 0.85;
    d[i * 4] = d[best * 4] * k;
    d[i * 4 + 1] = d[best * 4 + 1] * k;
    d[i * 4 + 2] = d[best * 4 + 2] * k;
  }
  g.putImageData(im, 0, 0);
}

function loadArt(url: string): Promise<Art> {
  let p = arts.get(url);
  if (p) return p;
  p = new Promise<Art>((resolve) => {
    // with CORS when the server allows it (its pixels can then be read: vivid), else without
    const load = (cors: boolean) => {
      const img = new Image();
      if (cors) img.crossOrigin = "anonymous";
      img.onload = () => {
        const px = document.createElement("canvas");
        px.width = px.height = S;
        const g = px.getContext("2d")!;
        // the middle square of it, as a cover shows (background-size: cover)
        const m = Math.min(img.naturalWidth, img.naturalHeight) || 1;
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = "high";
        g.drawImage(img, (img.naturalWidth - m) / 2, (img.naturalHeight - m) / 2, m, m, 0, 0, S, S);
        vivid(g);
        resolve({ img, px, glow: glowOf(px) });
      };
      img.onerror = () => {
        if (cors) return load(false);
        arts.delete(url);
        resolve(plainArt());
      };
      img.src = url;
    };
    load(new URL(url, location.href).origin !== location.origin);
  });
  arts.set(url, p);
  if (arts.size > 24) arts.delete(arts.keys().next().value!);
  return p;
}

interface Flying {
  th: number;
  r: number;
  v: number;
  life: number;
  sx: number;
  sy: number;
  spin: number;
}

export class Visualizer {
  private ctx: CanvasRenderingContext2D;
  private art: Art = plainArt();
  /** the cover's pixels made to stand out of the card: lighter over a dark one, darker over a light */
  private lit?: HTMLCanvasElement;
  private litOf?: HTMLCanvasElement;
  private onLight = false;
  private artUrl?: string;
  private accent?: string;
  private track: VizTrack = { playing: false, pos: 0, at: 0, dur: 0, seed: "" };
  private seed = 0;
  private bpm = 112;
  private four = true;
  private style: VizStyle = "ring";
  /** the bands as drawn (eased toward the made-up spectrum) */
  private bands = new Float32Array(N);
  private target = new Float32Array(N);
  private peaks = new Float32Array(N);
  private kick = 0;
  private lastKick = 0;
  /** how much it moves: up when playing, down to a breath when paused */
  private energy = 0;
  private rot = 0;
  private flying: Flying[] = [];
  private raf = 0;
  private last = 0;
  private size = 0;
  private dpr = 1;
  private visible = true;
  private ro: ResizeObserver;
  private io: IntersectionObserver;
  private calm = matchMedia("(prefers-reduced-motion: reduce)");

  constructor(private cv: HTMLCanvasElement) {
    this.ctx = cv.getContext("2d")!;
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(cv);
    this.io = new IntersectionObserver((e) => {
      this.visible = e.some((x) => x.isIntersecting);
      this.wake();
    });
    this.io.observe(cv);
    document.addEventListener("visibilitychange", this.wake);
    this.fit();
    this.wake();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ro.disconnect();
    this.io.disconnect();
    document.removeEventListener("visibilitychange", this.wake);
  }

  setStyle(s: VizStyle) {
    if (s === this.style) return;
    this.style = s;
    this.flying = [];
    this.peaks.fill(0);
  }

  setArt(url: string | undefined, accent?: string) {
    if (url === this.artUrl && accent === this.accent) return;
    this.artUrl = url;
    this.accent = accent;
    if (!url) {
      this.art = plainArt(accent);
      return;
    }
    void loadArt(url).then((a) => {
      if (this.artUrl === url) this.art = a.img ? a : plainArt(accent);
    });
  }

  /** Whether the card behind is light (its text dark): the colours then darken a little, else lighten. */
  setInk(onLight: boolean) {
    if (onLight !== this.onLight) ((this.onLight = onLight), (this.litOf = undefined));
  }

  /** The cover's small copy, lit for the card behind (made again for a new cover or tone). */
  private px(): HTMLCanvasElement {
    const src = this.art.px;
    if (this.litOf === src && this.lit) return this.lit;
    const c = this.lit ?? document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d")!;
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, S, S);
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = this.onLight ? "multiply" : "screen";
    g.fillStyle = this.onLight ? "rgb(150,150,150)" : "rgba(255,255,255,0.26)";
    g.fillRect(0, 0, S, S);
    this.lit = c;
    this.litOf = src;
    return c;
  }

  setTrack(t: VizTrack) {
    if (t.seed !== this.track.seed) {
      this.seed = seedOf(t.seed);
      // a song's own pace and beat: 84–132 bpm, mostly four to the floor
      this.bpm = 84 + Math.floor(hash(this.seed) * 48);
      this.four = hash(this.seed + 1) > 0.3;
    }
    this.track = t;
    this.wake();
  }

  private wake = () => {
    if (!this.raf && this.visible && !document.hidden && this.cv.isConnected) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  private fit() {
    const r = this.cv.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.size = Math.max(1, Math.min(r.width, r.height));
    const w = Math.round(r.width * this.dpr);
    const h = Math.round(r.height * this.dpr);
    if (this.cv.width !== w || this.cv.height !== h) {
      this.cv.width = w;
      this.cv.height = h;
    }
  }

  /** Where in the song it is now (seconds). */
  private now(): number {
    const t = this.track;
    const p = t.pos + (t.playing ? (Date.now() - t.at) / 1000 : 0);
    return t.dur > 0 ? Math.min(p, t.dur) : p;
  }

  /** The made-up spectrum at a second of the song. */
  private sim(t: number) {
    const beat = (t * this.bpm) / 60;
    const nb = Math.floor(beat);
    const bt = beat - nb;
    const inBar = ((nb % 4) + 4) % 4;
    const bar = Math.floor(nb / 4);
    // eight bars a part, each its own: a break (quiet, no kick), a drop (everything, hi-hats on
    // the sixteenths), or in between; quieter in and out of the song
    const part = Math.floor(nb / 32);
    const kind = hash(part + this.seed * 5);
    const isBreak = part > 0 && kind < 0.14;
    const drop = kind > 0.72;
    let level = isBreak ? 0.42 : drop ? 1 : 0.72 + 0.2 * hash(part + this.seed * 3);
    level *= Math.min(1, 0.45 + t / 4);
    const dur = this.track.dur;
    if (dur > 0) level *= Math.max(0.12, Math.min(1, (dur - t) / 8));
    // each beat hit a little differently
    const accent = 0.75 + 0.25 * hash(nb * 1.7 + this.seed);
    // the kick on every beat (or on one and three, and a half after two), short and hard; none in a break
    const kickOn = !isBreak && (this.four || inBar === 0 || inBar === 2);
    let kick = kickOn ? Math.exp(-bt * 11) * accent : 0;
    if (!isBreak && !this.four && inBar === 2 && bt > 0.5) kick = Math.max(kick, Math.exp(-(bt - 0.5) * 12) * 0.8);
    // the snare on two and four – a roll on the last beat of every fourth bar
    const n16 = Math.floor(beat * 4);
    const p16 = beat * 4 - n16;
    const roll = bar % 4 === 3 && inBar === 3;
    const snare = roll ? Math.exp(-p16 * 9) * (0.6 + (0.4 * (n16 % 4)) / 3) : inBar % 2 === 1 ? Math.exp(-bt * 12) * accent : 0;
    // hi-hats on the eighths (sixteenths in a drop), the off-beat open
    const hatGrid = drop ? 4 : 2;
    const nh = Math.floor(beat * hatGrid);
    const ph = beat * hatGrid - nh;
    const hat = Math.exp(-ph * (nh % 2 ? 9 : 18)) * (0.55 + 0.45 * hash(nh + this.seed * 2));
    // the melody: notes on the sixteenths, each band group its own pattern (the lows sparser),
    // ringing a moment after each
    const G = 8;
    const notes = new Float32Array(G);
    for (let g = 0; g < G; g++) {
      const dense = 0.42 + 0.4 * (g / (G - 1)) + (drop ? 0.08 : 0) - (isBreak ? 0.15 : 0);
      let v = 0;
      for (let k = 0; k < 4; k++) {
        const n = n16 - k;
        // a pattern that repeats every bar – music does – and changes with the part
        const on = hash((((n % 16) + 16) % 16) * 3.1 + g * 13.7 + part * 5.3 + this.seed);
        if (on < dense) continue;
        const vel = 0.55 + 0.45 * hash(n * 0.37 + g * 2.9 + this.seed);
        v = Math.max(v, vel * Math.exp(-(k + p16) * (1.4 + g * 0.18)));
      }
      notes[g] = v;
    }
    for (let i = 0; i < N; i++) {
      const f = i / (N - 1);
      const x = f * (G - 1);
      const g0 = Math.floor(x);
      const gk = x - g0;
      const mel = notes[g0] * (1 - gk) + notes[Math.min(G - 1, g0 + 1)] * gk;
      // a little shimmer of its own per band, so neighbours never move as one
      const jit = 0.85 + 0.3 * noise(t * 7 + i * 1.3, this.seed + i);
      const low = Math.max(0, 1 - f / 0.22) * (0.08 + 1.15 * kick);
      const mid = Math.exp(-((f - 0.45) ** 2) / 0.03) * snare * 0.85;
      const high = f ** 1.2 * hat * 0.6;
      this.target[i] = Math.min(1, (low + mid + high + mel * (0.85 - 0.3 * f)) * level * jit);
    }
    this.kick = kick * level;
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (!this.visible || document.hidden || !this.cv.isConnected) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const playing = this.track.playing;
    const slow = this.calm.matches ? 0.35 : 1;
    const t = this.now();
    if (playing) this.sim(t);
    else {
      // paused: a slow breath, the song's shape kept faintly
      const b = 0.5 + 0.5 * Math.sin(now / 1400);
      for (let i = 0; i < N; i++) this.target[i] = 0.1 + 0.09 * b * noise(i * 0.4 + now / 4000, this.seed);
      this.kick = 0;
    }
    this.energy += ((playing ? 1 : 0) - this.energy) * (1 - Math.exp(-dt * 2.5));
    // quick up, slower down – as a meter does
    const up = 1 - Math.exp(-dt * 55 * slow);
    const down = 1 - Math.exp(-dt * 15 * slow);
    for (let i = 0; i < N; i++) {
      const d = this.target[i] - this.bands[i];
      this.bands[i] += d * (d > 0 ? up : down);
    }
    this.rot += dt * (0.06 + this.kick * 0.5) * slow;
    this.draw(dt, t);
    // settled and paused: a few frames a second are enough
    if (!playing && this.energy < 0.02 && !this.flying.length) window.setTimeout(this.wake, 90);
    else this.raf = requestAnimationFrame(this.frame);
  };

  private draw(dt: number, t: number) {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.cv.width, this.cv.height);
    if (this.style === "bars") this.drawBars(g, dt);
    else if (this.style === "orbit") this.drawOrbit(g, t);
    else this.drawRing(g, dt, t);
  }

  /** A band for an angle: low at the top and the bottom, high at the sides – mirrored. */
  private bandAt(th: number): number {
    const a = ((th % TAU) + TAU) % TAU;
    const m = a < Math.PI ? a / Math.PI : (TAU - a) / Math.PI; // 0 at the top, 1 at the bottom
    const f = Math.abs(m - 0.5) * 2; // 1 at top and bottom, 0 at the sides
    const x = (1 - f) * (N - 1);
    const i = Math.floor(x);
    const k = x - i;
    return this.bands[i] * (1 - k) + this.bands[Math.min(N - 1, i + 1)] * k;
  }

  /** Blocks round the middle, stacked out by the sound, each the colour of the cover under it. */
  private drawRing(g: CanvasRenderingContext2D, dt: number, t: number) {
    const d = this.dpr;
    const w = this.cv.width / d;
    const h = this.cv.height / d;
    const cx = w / 2;
    const cy = h / 2;
    const size = this.size;
    const A = 56;
    const r0 = size * 0.2 * (1 + this.kick * 0.07);
    const bs = size * 0.046;
    const gap = bs * 0.2;
    const px = this.px();
    g.imageSmoothingEnabled = false;
    const ring = (th: number, r: number, wd: number, ht: number, sx: number, sy: number, alpha: number) => {
      const c = Math.cos(th);
      const s = Math.sin(th);
      const x = cx + s * r;
      const y = cy - c * r;
      g.globalAlpha = alpha;
      g.setTransform(d * c, d * s, -d * s, d * c, d * x, d * y);
      g.drawImage(px, Math.max(0, Math.min(S - 1, sx)), Math.max(0, Math.min(S - 1, sy)), 1, 1, -wd / 2, -ht / 2, wd, ht);
    };
    for (let k = 0; k < A; k++) {
      const th = this.rot + (k / A) * TAU;
      // each spoke a little its own: some taller, some shorter, changing slowly
      const v = Math.min(1, this.bandAt(th - this.rot) * (0.7 + 0.6 * noise(k * 0.83 + t * 0.5, this.seed + 7)));
      const n = 1 + v * 5;
      const full = Math.floor(n);
      const push = v * bs * 1.3 + this.kick * bs * 0.8;
      for (let j = 0; j <= full && j < 7; j++) {
        const part = j < full ? 1 : n - full;
        if (part < 0.08) continue;
        const r = r0 + push + j * (bs + gap);
        const wd = ((TAU * r) / A) * 0.84;
        // the cover's pixel at that angle, further out for blocks further out
        const rr = 0.16 + j * 0.055;
        const sx = Math.floor((0.5 + Math.sin(th) * rr) * S);
        const sy = Math.floor((0.5 - Math.cos(th) * rr) * S);
        ring(th, r, wd, bs, sx, sy, (j === 0 ? 0.95 : 1 - j * 0.09) * Math.min(1, part * 1.4) * (0.7 + 0.3 * this.energy));
      }
      // a strong beat throws a block out of a tall spoke
      if (this.track.playing && !this.calm.matches && this.kick > 0.55 && this.lastKick <= 0.55 && v > 0.55 && hash(k + t * 13.7) > 0.86) {
        this.flying.push({
          th,
          r: r0 + push + full * (bs + gap),
          v: size * (0.25 + 0.3 * hash(k + t)),
          life: 1,
          sx: Math.floor((0.5 + Math.sin(th) * 0.45) * S),
          sy: Math.floor((0.5 - Math.cos(th) * 0.45) * S),
          spin: (hash(k * 3 + t) - 0.5) * 3,
        });
      }
    }
    this.lastKick = this.kick;
    for (const f of this.flying) {
      f.r += f.v * dt;
      f.v *= Math.exp(-dt * 1.6);
      f.life -= dt * 0.85;
      f.th += f.spin * dt * 0.05;
      const r = f.r;
      ring(f.th, r, bs * 0.95, bs * 0.95, f.sx, f.sy, Math.max(0, f.life) * 0.9);
    }
    this.flying = this.flying.filter((f) => f.life > 0 && f.r < size * 0.75);
    if (this.flying.length > 40) this.flying.splice(0, this.flying.length - 40);
    g.globalAlpha = 1;
  }

  /**
   * Bars from a middle line, up and down alike – the lows in the middle, the highs out to the sides –
   * each a column of the cover from its top to its bottom; a cap rides the top and falls back slowly.
   */
  private drawBars(g: CanvasRenderingContext2D, dt: number) {
    const d = this.dpr;
    const w = this.cv.width / d;
    const h = this.cv.height / d;
    const size = this.size;
    const half = 8;
    const B = half * 2 + 1;
    const span = size * 0.86;
    const step = span / B;
    const bw = step * 0.7;
    const left = w / 2 - span / 2;
    const cy = h / 2;
    const maxH = size * 0.66;
    const px = this.px();
    g.setTransform(d, 0, 0, d, 0, 0);
    g.imageSmoothingEnabled = true;
    const round = (x: number, y: number, ww: number, hh: number) => {
      g.beginPath();
      if (g.roundRect) g.roundRect(x, y, ww, hh, Math.min(ww / 2, hh / 2));
      else g.rect(x, y, ww, hh);
    };
    for (let b = 0; b < B; b++) {
      const o = Math.abs(b - half); // 0 in the middle
      // more bars for the lows and mids, as an ear hears it
      const lo = Math.floor((o / (half + 1)) ** 1.4 * N);
      const hi = Math.max(lo + 1, Math.floor(((o + 1) / (half + 1)) ** 1.4 * N));
      let v = 0;
      for (let i = lo; i < hi && i < N; i++) v = Math.max(v, this.bands[i]);
      // the two sides not quite the same
      v = Math.min(1, v * (b < half ? 0.92 + 0.08 * Math.sin(this.rot * 7 + b) : 1));
      const bh = Math.max(bw, v * maxH * (0.55 + 0.45 * Math.max(this.energy, 0.2)));
      const x = left + b * step + (step - bw) / 2;
      const col = Math.min(S - 1, Math.floor(((b + 0.5) / B) * S));
      g.save();
      g.globalAlpha = 0.95;
      round(x, cy - bh / 2, bw, bh);
      g.clip();
      g.drawImage(px, col, 0, 1, S, x, cy - bh / 2, bw, bh);
      g.restore();
      // the cap above each bar: up with the peak, down slowly (only on top – the bottom half mirrors the bars alone)
      const p = (this.peaks[b] = Math.max(this.peaks[b] - dt * 0.55, bh / maxH));
      const off = (p * maxH) / 2 + bw * 0.55;
      const ch = bw * 0.38;
      g.globalAlpha = 0.85;
      const y = cy - off - ch;
      g.save();
      round(x, y, bw, ch);
      g.clip();
      g.drawImage(px, col, S >> 1, 1, 1, x, y, bw, ch);
      g.restore();
    }
    g.globalAlpha = 1;
  }

  /** The cover in a round that breathes with the sound, its light behind, dots of it in orbit. */
  private drawOrbit(g: CanvasRenderingContext2D, t: number) {
    const px = this.px();
    const d = this.dpr;
    const w = this.cv.width / d;
    const h = this.cv.height / d;
    const cx = w / 2;
    const cy = h / 2;
    const size = this.size;
    const R = size * 0.27 * (1 + this.kick * 0.09);
    g.setTransform(d, 0, 0, d, 0, 0);
    g.imageSmoothingEnabled = true;
    // the glow: the cover's light, turning slowly, brighter with the sound
    g.save();
    g.translate(cx, cy);
    g.rotate(this.rot * 0.6);
    g.globalAlpha = Math.min(1, 0.6 + 0.4 * this.energy * (0.6 + this.kick * 0.8));
    const gs = R * (3.1 + this.kick * 0.25);
    g.drawImage(this.art.glow, -gs / 2, -gs / 2, gs, gs);
    g.restore();
    // the outline: a smooth round pushed out by the bands
    const P = 72;
    const pts: [number, number][] = [];
    for (let k = 0; k < P; k++) {
      const th = (k / P) * TAU;
      const v = (this.bandAt(th) + this.bandAt(th + TAU / P) + this.bandAt(th - TAU / P)) / 3;
      const r = R * (1 + v * 0.42 * (0.4 + 0.6 * this.energy));
      pts.push([cx + Math.sin(th) * r, cy - Math.cos(th) * r]);
    }
    const path = () => {
      g.beginPath();
      for (let k = 0; k <= P; k++) {
        const a = pts[k % P];
        const b = pts[(k + 1) % P];
        const mx = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        if (k === 0) g.moveTo(mx, my);
        else g.quadraticCurveTo(a[0], a[1], mx, my);
      }
      g.closePath();
    };
    g.save();
    path();
    g.clip();
    g.globalAlpha = 1;
    const img = this.art.img;
    const cs = R * 2.5;
    if (img) {
      const m = Math.min(img.naturalWidth, img.naturalHeight) || 1;
      g.drawImage(img, (img.naturalWidth - m) / 2, (img.naturalHeight - m) / 2, m, m, cx - cs / 2, cy - cs / 2, cs, cs);
    } else g.drawImage(this.art.px, 0, 0, S, S, cx - cs / 2, cy - cs / 2, cs, cs);
    g.restore();
    path();
    g.lineWidth = 1.2;
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.stroke();
    // dots in orbit: two rings turning their own ways, each dot the cover's colour at its angle
    g.imageSmoothingEnabled = false;
    for (const [n, rr, dir, sz] of [
      [36, 1.3, 1, 0.03],
      [24, 1.56, -0.7, 0.022],
    ] as const) {
      for (let k = 0; k < n; k++) {
        const th = (k / n) * TAU + this.rot * dir;
        const v = this.bandAt(th - this.rot * dir);
        const r = R * rr + v * R * 0.28 * this.energy;
        const s = size * sz * (0.55 + v * 1.3);
        const x = cx + Math.sin(th) * r;
        const y = cy - Math.cos(th) * r;
        const sx = Math.max(0, Math.min(S - 1, Math.floor((0.5 + Math.sin(th) * 0.42) * S)));
        const sy = Math.max(0, Math.min(S - 1, Math.floor((0.5 - Math.cos(th) * 0.42) * S)));
        g.globalAlpha = Math.min(1, (0.5 + 0.8 * v) * (0.55 + 0.45 * this.energy) * (0.8 + 0.2 * noise(k + t, this.seed)));
        g.save();
        g.beginPath();
        g.arc(x, y, s / 2, 0, TAU);
        g.clip();
        g.drawImage(px, sx, sy, 1, 1, x - s / 2, y - s / 2, s, s);
        g.restore();
      }
    }
    g.globalAlpha = 1;
  }
}
