import { css, unsafeCSS } from "lit";

/**
 * The dashboard's look by day (the room tiles) and by night (darker glass, graphite tiles…):
 * the dashboard sets them for every card inside it; a glass card outside one (HA's own
 * dashboards, the card editor) sets them itself – [standalone] – so it looks the same there.
 */
export const dayVars = unsafeCSS(`
    --glass-room-bg: linear-gradient(rgba(246, 246, 248, 0.8), rgba(246, 246, 248, 0.8));
    --glass-room-fg: #1c1c1e;
    --glass-room-fg-2: rgba(60, 60, 67, 0.68);
    --glass-room-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    --glass-room-solid: rgba(246, 246, 248, 0.94);
    --glass-room-level-filter: brightness(0.72) saturate(1.4);
`);
export const nightVars = unsafeCSS(`
    --glass-surface: rgba(18, 20, 30, 0.38);
    --glass-surface-nested: rgba(255, 255, 255, 0.06);
    --glass-border: rgba(255, 255, 255, 0.12);
    --glass-rim: rgba(255, 255, 255, 0.08);
    --glass-sheen: rgba(255, 255, 255, 0.18);
    --glass-shadow: 0 18px 30px rgba(0, 0, 0, 0.3);
    --glass-control: rgba(255, 255, 255, 0.06);
    --glass-control-border: rgba(255, 255, 255, 0.14);
    --glass-text-secondary: rgba(235, 235, 245, 0.86);
    /* liquid glass: no milk – tinted by the wallpaper (shader), lighter frosting
       on tiles and controls, edge light a bit softer */
    --glass-liquid-dark: 1;
    /* the liquid panels' bright rim, quieter at night: no brighter than the tiles' edges */
    --glass-liquid-rim-light: 0.22;
    --glass-liquid-specular: 0.15;
    --glass-image-k: 0.9;
    /* room photos that are off: a room in the dusk – darker, half the colour, no grey fog */
    --glass-image-off: 0.9;
    --glass-image-off-brightness: 0.65;
    --glass-image-grey: 0.55;
    --glass-edge-k: 0.8;
    --glass-liquid-tile: linear-gradient(180deg, rgba(255, 255, 255, 0.13), rgba(255, 255, 255, 0.05) 55%, rgba(255, 255, 255, 0.08));
    --glass-liquid-control: linear-gradient(180deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.07));
    --glass-frosted-tile: linear-gradient(180deg, rgba(255, 255, 255, 0.11), rgba(255, 255, 255, 0.04));
    --glass-frosted-panel: linear-gradient(180deg, rgba(20, 24, 36, 0.38), rgba(20, 24, 36, 0.5));
    --glass-liquid-pill: linear-gradient(180deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.08));
    --glass-liquid-pill-hover: linear-gradient(180deg, rgba(255, 255, 255, 0.27), rgba(255, 255, 255, 0.11));
    /* the liquid bars on tiles (thermostat, light): smoked glass on the metal, not a white one */
    --glass-bar: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.05) 55%, rgba(255, 255, 255, 0.09));
    --glass-bar-shadow: inset 0 0.5px 0 rgba(255, 255, 255, 0.38), inset 0 -0.5px 0 rgba(255, 255, 255, 0.12), inset 0 0 12px rgba(255, 255, 255, 0.06), 0 4px 14px rgba(0, 0, 0, 0.22);
    /* segmented quick choices: a smoked track, the current one softly lit */
    --glass-seg-bg: rgba(0, 0, 0, 0.18);
    --glass-seg-cur: linear-gradient(180deg, rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0.12));
    --glass-seg-ring: rgba(255, 255, 255, 0.85);
    /* glass: home at night – graphite tiles and chips with white text (Apple Home
       dark); the sidebar keeps its daytime blue-grey glass */
    /* dark graphite tiles (Apple Home at night): calm, darker than the panels' glass,
       a fine top edge instead of a metal sheen */
    --glass-home-surface: rgba(29, 32, 39, 0.86);
    --glass-home-tile: rgba(44, 48, 57, 0.82);
    --glass-home-border: rgba(255, 255, 255, 0.07);
    --glass-home-fill: linear-gradient(180deg, rgba(38, 42, 51, 0.84), rgba(26, 29, 36, 0.88));
    --glass-home-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.09), 0 8px 22px rgba(0, 0, 0, 0.35);
    /* panels: smoky glass, a shade darker so they don't outshine the tiles */
    --glass-panel-tint: 22, 24, 30;
    --glass-panel-tint-a: 0.58;
    /* a panel in the bars' material (a pop-up's big panel): graphite too, not white smoke */
    --glass-panel-bar: linear-gradient(180deg, rgba(36, 39, 47, 0.82), rgba(26, 29, 36, 0.86));
    /* the dark sidebar glass (Apple Home): graphite instead of blue-grey */
    --glass-home-side-rgb: 24, 26, 32;
    --glass-home-side-a: 0.6;
    --glass-room-bg: var(--glass-home-fill);
    --glass-room-fg: rgba(255, 255, 255, 0.86);
    --glass-room-fg-2: rgba(235, 235, 245, 0.62);
    --glass-room-shadow: var(--glass-home-shadow);
    --glass-room-solid: rgba(29, 32, 39, 0.95);
    --glass-room-level-filter: brightness(1.15);
    --glass-home-saturate: 110%;
    --glass-home-text: rgba(255, 255, 255, 0.86);
    --glass-home-text-2: rgba(235, 235, 245, 0.62);
    /* buttons that are off: quiet rings; only what is on lights up */
    --glass-home-control: rgba(255, 255, 255, 0.08);
    --glass-home-icon: rgba(255, 255, 255, 0.76);
    /* white softened by night: text, the sidebar's text and the weather's hour dots */
    --glass-home-side-text: rgba(255, 255, 255, 0.86);
    --glass-home-side-bar: rgba(255, 255, 255, 0.5);
    --glass-home-active: #fff;
    --glass-home-cloud-top: #ffffff;
    --glass-home-cloud-bottom: #dbe4f0;
    --glass-home-cloud-back-top: #eef2f8;
    --glass-home-cloud-back-bottom: #b9c4d4;
`);

/**
 * Design tokens. Every value is a theme variable with a default, so users restyle
 * cards from their theme YAML (or `styles:` in card config) instead of card_mod.
 */
export const tokens = css`
  :host {
    /* a control (button, picked tab, period): dark glass by day; by night that reads as
       switched off, so it turns to a lighter graphite glass there – a step above the tiles */
    --glass-control-bg: linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0) 60%),
      rgba(var(--glass-home-side-rgb, 22, 30, 46), 0.62);
    --glass-control-shadow: inset 0 0.5px 0 rgba(255, 255, 255, 0.45), inset 0 -0.5px 0 rgba(255, 255, 255, 0.12),
      0 2px 8px rgba(0, 0, 0, 0.12);
  }
  /* the materials (core/materials): set on every card itself, by day and by night, so a
     material looks the same on the dashboard, in a pop-up, in a sidebar and in the editor –
     not re-tinted by what it sits in (night values = the dashboard's at night) */
  :host {
    --mat-dark-text: #fff;
    --mat-liquid-bg: linear-gradient(180deg, rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0.08));
    --mat-home-bg: rgba(118, 118, 128, 0.16);
    --mat-home-text: rgba(60, 60, 67, 0.85);
  }
  :host([dark]) {
    --mat-dark-text: rgba(255, 255, 255, 0.86);
    --mat-liquid-bg: linear-gradient(180deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.07));
    --mat-home-bg: rgba(255, 255, 255, 0.08);
    --mat-home-text: rgba(255, 255, 255, 0.76);
  }
  :host([standalone]) {
    ${dayVars}
  }
  :host([dark][standalone]) {
    ${nightVars}
  }
  :host([dark]) {
    --glass-control-bg: linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0) 60%),
      rgba(var(--glass-control-night-rgb, 74, 79, 92), 0.7);
    --glass-control-shadow: inset 0 0.5px 0 rgba(255, 255, 255, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.06), 0 2px 10px rgba(0, 0, 0, 0.3);
  }
  :host {
    --g-radius: var(--glass-radius, 26px);
    --g-radius-lg: var(--glass-radius-large, 34px);
    --g-surface: var(--glass-surface, rgba(255, 255, 255, 0.07));
    --g-surface-nested: var(--glass-surface-nested, rgba(255, 255, 255, 0.1));
    --g-border: var(--glass-border, rgba(255, 255, 255, 0.24));
    --g-shadow: var(--glass-shadow, 0 15px 25px rgba(0, 0, 0, 0.08));
    --g-shadow-nested: var(--glass-shadow-nested, 0 10px 25px rgba(0, 0, 0, 0.08));
    --g-sheen: var(--glass-sheen, rgba(255, 255, 255, 0.45));
    --g-rim: var(--glass-rim, rgba(255, 255, 255, 0.18));
    --g-blur: var(--glass-blur, 30px);
    --g-saturate: var(--glass-saturate, 170%);
    --g-text: var(--glass-text, #fff);
    --g-text-2: var(--glass-text-secondary, rgba(255, 255, 255, 0.84));
    --g-text-shadow: var(--glass-text-shadow, 0 1px 2px rgba(0, 0, 0, 0.16), 0 0 12px rgba(0, 0, 0, 0.08));
    --g-icon-shadow: var(--glass-icon-shadow, drop-shadow(0 2px 6px rgba(0, 0, 0, 0.35)));
    --g-font: var(--glass-font-family, Roboto, "SF Pro Display", -apple-system, system-ui, sans-serif);
    --g-control: var(--glass-control, rgba(255, 255, 255, 0.08));
    --g-control-border: var(--glass-control-border, rgba(255, 255, 255, 0.22));
    font-family: var(--g-font);
    color: var(--g-text);
    -webkit-tap-highlight-color: transparent;
  }
`;

/**
 * The sidebar's colours: white text, accent icons, monochrome weather, quiet dividers.
 * Shared by home panels and by the side column of the other looks (liquid, frosted).
 */
export const sideVars = unsafeCSS(`
    --glass-text: var(--glass-home-side-text, #fff);
    --glass-text-secondary: var(--glass-home-side-text-2, rgba(235, 235, 245, 0.6));
    --glass-text-shadow: none;
    --glass-icon-shadow: none;
    --glass-accent-icon: var(--glass-home-side-icon, #ff9f0a);
    /* weather icons: monochrome in the accent colour, like the sidebar icons */
    --glass-mono-icons: 1;
    /* quiet separators, no extra colours */
    --glass-divider-color: rgba(255, 255, 255, 0.28);
    --glass-divider-size: 2px;
    --glass-bar-mono: var(--glass-home-side-bar, rgba(255, 255, 255, 0.92));
`);

/**
 * The side column of the light looks (liquid, frosted) by day: the glass stays light,
 * so the white text and icons get a firmer shadow.
 */
export const sideDayVars = unsafeCSS(`
    --glass-text: #fff;
    --glass-text-secondary: rgba(255, 255, 255, 0.86);
    --glass-text-shadow: 0 1px 2px rgba(0, 0, 0, 0.32), 0 0 10px rgba(0, 0, 0, 0.18);
    --glass-icon-shadow: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3));
    --glass-mono-icons: 1;
    --glass-divider-color: rgba(255, 255, 255, 0.5);
    --glass-divider-size: 2px;
    --glass-bar-mono: #fff;
    /* rows, chips and buttons inside: white too, on a smoky translucent pill – the
       milky Apple Home one would swallow the white text */
    --glass-home-text: #fff;
    --glass-home-text-2: rgba(255, 255, 255, 0.86);
    --glass-home-icon: #fff;
    --glass-home-surface: rgba(22, 30, 46, 0.22);
    --glass-home-fill: initial;
    --glass-home-shadow: none;
    --glass-home-border: rgba(255, 255, 255, 0.22);
    --glass-home-control: rgba(22, 30, 46, 0.2);
`)

/**
 * Light looks' side column, day and night: icons and graph lines white like the text;
 * orange is left for what runs (the heating spans in a graph, lit buttons).
 */
export const sideMonoVars = unsafeCSS(`
    --glass-accent-icon: var(--glass-side-icon, #fff);
    --glass-graph-color: #fff;
    --glass-graph-accent: #ff9f0a;
    --glass-graph-span: 0.28;
`);

/**
 * Frosted side column by day: the milky glass swallows white, so graphite text,
 * icons and graph lines (macOS vibrancy), never pure black. Night stays white.
 */
export const sideFrostedVars = unsafeCSS(`
    --glass-text: var(--glass-side-frosted-text, #2c2c2e);
    --glass-text-secondary: rgba(60, 60, 67, 0.7);
    --glass-text-shadow: none;
    --glass-icon-shadow: none;
    --glass-accent-icon: rgba(44, 44, 46, 0.85);
    --glass-graph-color: rgba(44, 44, 46, 0.5);
    --glass-divider-color: rgba(44, 44, 46, 0.16);
    /* big or bold things (clock, temperature, the weather icon, bars) a step lighter,
       or the graphite turns heavy */
    --glass-bar-mono: rgba(44, 44, 46, 0.4);
    --glass-bar-track: rgba(44, 44, 46, 0.1);
    --gt-time-color: rgba(44, 44, 46, 0.72);
    --gt-temperature-color: rgba(44, 44, 46, 0.78);
    --glass-weather-icon-color: rgba(44, 44, 46, 0.62);
    --glass-figure-color: rgba(44, 44, 46, 0.82);
    /* the energy flow card (solar-arc) writes on coloured flows: white stays there */
    --glass-energy-text: #fff;
    --glass-energy-text-2: rgba(255, 255, 255, 0.88);
    --glass-energy-pill: rgba(44, 44, 46, 0.32);
    --glass-home-text: #2c2c2e;
    --glass-home-text-2: rgba(60, 60, 67, 0.7);
    --glass-home-icon: rgba(44, 44, 46, 0.85);
    /* graphite text: the chips keep their milky Apple Home pill */
    --glass-home-surface: initial;
    --glass-home-fill: initial;
    --glass-home-shadow: initial;
    --glass-home-border: initial;
    --glass-home-control: initial;
`);

/** Cards that pick a view (view_layout.select) and the one picked: a quiet white ring. */
export const selectable = css`
  [glass-selectable] {
    cursor: pointer;
  }
  [glass-selected] {
    border-radius: var(--g-radius);
    box-shadow: 0 0 0 2px var(--glass-select-ring, rgba(255, 255, 255, 0.9));
    transition: box-shadow 0.25s ease;
  }
`;

/**
 * The glass surface. One class, three tiers:
 *   flat     – translucent fill + sheen, no blur (cheapest, used for anything nested)
 *   frosted  – + single backdrop blur
 *   liquid   – + SVG refraction (Chromium only, added by LiquidController)
 * Nested surfaces never blur: the container behind them already did.
 */
export const surface = css`
  /* a card that has no tile of its own, given its own glass (GlassElement.tile) */
  .surface.own-glass {
    padding: var(--glass-tile-padding, 14px);
  }
  /* squircle corners where the dashboard asks for them (styles: corner_shape: squircle) */
  .surface {
    corner-shape: var(--glass-corner-shape, round);
  }
  .surface {
    position: relative;
    box-sizing: border-box;
    border-radius: var(--g-radius);
    background: var(--g-surface);
    border: 1px solid var(--g-border);
    box-shadow:
      var(--g-shadow),
      inset 0 1px 2px rgba(255, 255, 255, 0.12);
    isolation: isolate;
  }
  .surface::before,
  .surface::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    z-index: -1;
  }
  /* diagonal sheen */
  .surface::before {
    background: linear-gradient(120deg, var(--g-sheen), rgba(255, 255, 255, 0.1) 30%, rgba(255, 255, 255, 0.02) 60%, transparent 75%);
    opacity: 0.35;
  }
  /* inner rim light */
  .surface::after {
    box-shadow:
      inset 0 0 0 1px var(--g-rim),
      inset 0 1px 0 rgba(255, 255, 255, 0.38),
      inset 0 0 20px rgba(255, 255, 255, 0.06);
  }
  :host([glass="frosted"]:not([nested])) .surface,
  :host([glass="frosted"][own-tile]) .surface,
  :host([glass="liquid"]:not([nested])) .surface,
  :host([glass="liquid"][own-tile]) .surface {
    -webkit-backdrop-filter: blur(calc(var(--g-blur) * var(--glass-blur-scale, 1))) saturate(var(--g-saturate));
    backdrop-filter: blur(calc(var(--g-blur) * var(--glass-blur-scale, 1))) saturate(var(--g-saturate));
  }
  :host(:not([nested])) .surface,
  :host([own-tile]) .surface {
    background:
      linear-gradient(var(--glass-tint, transparent), var(--glass-tint, transparent)),
      var(--g-surface);
  }
  :host([nested]:not([own-tile])) .surface {
    background: var(--g-surface-nested);
    box-shadow:
      var(--g-shadow-nested),
      inset 0 1px 1px rgba(255, 255, 255, 0.1);
  }
  /* Frosted cards inside a panel: same quiet macOS language as the liquid ones –
     soft fill brighter at the top, hairline highlights instead of a rim, no tint. */
  /* Frosted panels: macOS frosting – milky, calm colours (the plain 170 % saturation
     turned a blue wallpaper neon) */
  :host([glass="frosted"]:not([nested])) .surface,
  :host([glass="frosted"][own-tile]) .surface {
    -webkit-backdrop-filter: blur(calc(var(--g-blur) * var(--glass-blur-scale, 1))) saturate(var(--glass-frosted-saturate, 120%));
    backdrop-filter: blur(calc(var(--g-blur) * var(--glass-blur-scale, 1))) saturate(var(--glass-frosted-saturate, 120%));
  }
  :host([glass="frosted"]:not([nested])) .surface,
  :host([glass="frosted"][own-tile]) .surface,
  :host([glass="light"]:not([nested])) .surface,
  :host([glass="light"][own-tile]) .surface {
    background:
      linear-gradient(var(--glass-tint, transparent), var(--glass-tint, transparent)),
      var(--glass-frosted-panel, linear-gradient(180deg, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0.16)));
  }
  /* light glass: the frosted fill over a copy of the wallpaper blurred once (LiquidController
     places it under the element) – it looks frosted, the browser blurs nothing live */
  :host([glass="light"]:not([nested])) .surface.fake-on,
  :host([glass="light"][own-tile]) .surface.fake-on {
    background:
      linear-gradient(var(--glass-tint, transparent), var(--glass-tint, transparent)),
      var(--glass-frosted-panel, linear-gradient(180deg, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0.16))),
      /* the colour (glass_tint / tile_tint) over the picture – under it, the picture would hide it */
      linear-gradient(rgba(var(--glass-fake-tint), var(--glass-fake-tint-a, 0)), rgba(var(--glass-fake-tint), var(--glass-fake-tint-a, 0))),
      var(--fake-img) var(--fake-pos, 0 0) / var(--fake-size, cover) no-repeat;
  }
  /* as the tint rule below: a surface of its own reads the panel tint */
  :host([glass="light"]:not([nested])) .surface.fake-on,
  :host([glass="light"][own-tile]) .surface.fake-on {
    --glass-fake-tint: var(--glass-panel-tint, 255, 255, 255);
    --glass-fake-tint-a: var(--glass-panel-tint-a, 0);
  }
  :host([glass="frosted"][nested]:not([own-tile])) .surface,
  :host([glass="light"][nested]:not([own-tile])) .surface {
    border: 0;
    background: var(--glass-frosted-tile, linear-gradient(180deg, rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0.12)));
    box-shadow:
      0 6px 18px rgba(0, 0, 0, 0.08),
      0 1px 3px rgba(0, 0, 0, 0.04);
  }
  :host([glass="frosted"][nested]:not([own-tile])) .surface::before,
  :host([glass="light"][nested]:not([own-tile])) .surface::before {
    opacity: 0.12;
  }
  :host([glass="frosted"][nested]:not([own-tile])) .surface::after,
  :host([glass="light"][nested]:not([own-tile])) .surface::after {
    box-shadow:
      inset 0 0.5px 0 rgba(255, 255, 255, calc(0.6 * var(--glass-edge-k, 1))),
      inset 0 -0.5px 0 rgba(255, 255, 255, calc(0.2 * var(--glass-edge-k, 1))),
      inset 0 0 0 0.5px rgba(255, 255, 255, calc(0.12 * var(--glass-edge-k, 1)));
  }
  /* ── Liquid glass (macOS 26 look) ───────────────────────────────────────
     Thick luminous bezel: a bright rim, a specular edge top-left and a weaker
     one bottom-right (light from the top left), a milky glow along the inside
     of the edge and a darker bottom edge for thickness. The lens (refraction)
     is added by LiquidController. */
  :host([glass="liquid"]:not([nested])) .surface,
  :host([glass="liquid"][own-tile]) .surface {
    border: 0;
    background:
      linear-gradient(var(--glass-tint, transparent), var(--glass-tint, transparent)),
      linear-gradient(180deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.07) 55%, rgba(255, 255, 255, 0.11));
    box-shadow:
      0 12px 32px rgba(0, 0, 0, 0.14),
      0 2px 6px rgba(0, 0, 0, 0.06);
  }
  :host([glass="liquid"]:not([nested])) .surface::after,
  :host([glass="liquid"][own-tile]) .surface::after {
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.42),
      inset 2px 2.5px 1.5px -1.5px rgba(255, 255, 255, 0.95),
      inset -2px -2.5px 1.5px -1.5px rgba(255, 255, 255, 0.55),
      inset 0 0 18px 1px rgba(255, 255, 255, 0.26),
      inset 0 -16px 24px -18px rgba(0, 0, 0, 0.18);
  }
  :host([glass="liquid"]:not([nested])) .surface::before,
  :host([glass="liquid"][own-tile]) .surface::before {
    opacity: 0.1;
  }
  /* WebGL glass: the canvas paints refraction, tint and rim; CSS keeps only the lift */
  canvas.lg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: inherit;
    z-index: -2;
    pointer-events: none;
  }
  .surface.lg-on {
    background: none !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
    border-color: transparent !important;
  }
  .surface.lg-on::before {
    opacity: 0 !important;
  }
  .surface.lg-on::after {
    box-shadow: none !important;
  }
  /* tiles on a liquid panel: same bezel, lighter, no backdrop of their own */
  :host([glass="liquid"][nested]:not([own-tile])) .surface {
    /* no border: the edge light/dark lines must sit exactly on the outer edge */
    border: 0;
    background: var(--glass-liquid-tile, linear-gradient(180deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.06) 55%, rgba(255, 255, 255, 0.1)));
    box-shadow:
      0 8px 22px rgba(0, 0, 0, 0.1),
      0 1px 3px rgba(0, 0, 0, 0.05);
  }
  :host([glass="liquid"][nested]:not([own-tile])) .surface::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    z-index: -1;
    /* white line on top/bottom edge, strongest mid-edge, fading to the corners,
       with a soft blue tint just inside it (macOS edge light) */
    background:
      linear-gradient(90deg, transparent 6%, rgba(255, 255, 255, calc(0.75 * var(--glass-edge-k, 1))) 50%, transparent 94%) top / 100% 1.5px no-repeat,
      linear-gradient(90deg, transparent 10%, rgba(255, 255, 255, calc(0.5 * var(--glass-edge-k, 1))) 50%, transparent 90%) bottom / 100% 1.5px no-repeat,
      radial-gradient(100% 50% at 0% 50%, rgba(var(--glass-edge-dark, 8, 12, 24), 0.06), transparent) left / 6px 100% no-repeat,
      radial-gradient(100% 50% at 100% 50%, rgba(var(--glass-edge-dark, 8, 12, 24), 0.06), transparent) right / 6px 100% no-repeat;
    /* light ring on top/bottom: with no side border it tapers to nothing down the
       corner arcs, where the dark side ring (::before) takes over */
    border: solid transparent;
    border-width: 1.5px 0;
    /* narrower than the card by the dark side line (1.5px) plus 1px, so in the
       corner arcs the light line runs just inside the dark one and ends a pixel
       clear of it */
    inset: 0 2.5px;
    border-top-color: rgba(255, 255, 255, calc(0.45 * var(--glass-edge-k, 1)));
    border-bottom-color: rgba(255, 255, 255, calc(0.3 * var(--glass-edge-k, 1)));
    background-origin: border-box;
    /* blue glow under the top line / over the bottom one; an inset shadow follows
       the rounded outline, so it runs the whole length of the light edge, arcs included */
    box-shadow:
      inset 0 7px 8px -4px rgba(var(--glass-edge-light, 160, 200, 255), calc(0.85 * var(--glass-edge-k, 1))),
      inset 0 -7px 8px -4px rgba(var(--glass-edge-light, 160, 200, 255), calc(0.65 * var(--glass-edge-k, 1))),
      inset 0 0 14px rgba(255, 255, 255, calc(0.07 * var(--glass-edge-k, 1)));
  }
  /* round buttons, chips: light edges only, no dark sides */
  :host([control-glass="liquid"]) .control::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    z-index: -1;
    background:
      linear-gradient(90deg, transparent 6%, rgba(255, 255, 255, calc(0.75 * var(--glass-edge-k, 1))) 50%, transparent 94%) top / 100% 1.5px no-repeat,
      linear-gradient(90deg, transparent 10%, rgba(255, 255, 255, calc(0.5 * var(--glass-edge-k, 1))) 50%, transparent 90%) bottom / 100% 1.5px no-repeat,
      radial-gradient(50% 100% at 50% 0%, rgba(var(--glass-edge-light, 160, 200, 255), calc(0.62 * var(--glass-edge-k, 1))), transparent) top / 100% 12px no-repeat,
      radial-gradient(50% 100% at 50% 100%, rgba(var(--glass-edge-light, 160, 200, 255), calc(0.45 * var(--glass-edge-k, 1))), transparent) bottom / 100% 12px no-repeat;
    box-shadow:
      inset 0 0 0 0.5px rgba(255, 255, 255, calc(0.1 * var(--glass-edge-k, 1))),
      inset 0 0 14px rgba(255, 255, 255, calc(0.07 * var(--glass-edge-k, 1)));
  }
  /* active (coloured) controls: keep the white edge lines, drop the blue tint –
     it would muddy the fill colour */
  :host([control-glass="liquid"]) .control.active::after {
    background:
      linear-gradient(90deg, transparent 6%, rgba(255, 255, 255, calc(0.75 * var(--glass-edge-k, 1))) 50%, transparent 94%) top / 100% 1.5px no-repeat,
      linear-gradient(90deg, transparent 10%, rgba(255, 255, 255, calc(0.5 * var(--glass-edge-k, 1))) 50%, transparent 90%) bottom / 100% 1.5px no-repeat;
  }
  /* dark side ring (glass thickness): the mirror image of the light one – full
     width mid-side, tapering to nothing up and down the corner arcs */
  :host([glass="liquid"][nested]:not([own-tile])) .surface::before {
    background: none;
    opacity: 1;
    border: solid transparent;
    border-width: 0 1.5px;
    border-left-color: rgba(var(--glass-edge-dark, 8, 12, 24), 0.42);
    border-right-color: rgba(var(--glass-edge-dark, 8, 12, 24), 0.42);
  }
  /* color tint (glass_tint / tile_tint): a colored layer under the glass fill.
     Liquid panels get it from the shader instead. */
  :host(:not([nested]):not([glass="none"])) .surface:not(.lg-on),
  :host([own-tile]:not([glass="none"])) .surface:not(.lg-on) {
    background-color: rgba(var(--glass-panel-tint, 255, 255, 255), var(--glass-panel-tint-a, 0)) !important;
  }
  :host([nested]:not([own-tile]):not([glass="none"])) .surface {
    background-color: rgba(var(--glass-tile-tint, 255, 255, 255), var(--glass-tile-tint-a, 0)) !important;
  }
  /* glass: none – no glass at all, only the content */
  /* ── glass: solid (performance) ───────────────────────────────────────
     Opaque slate surfaces: no blur, no transparency, no sheen or rim layers – nothing
     for the browser to compose; white text as on the glass. */
  :host([glass="solid"]) .surface {
    /* image layers, so the tint rules (background-color) cannot wipe them: the colour
       (glass_tint / tile_tint) over the opaque fill */
    background: linear-gradient(rgba(var(--glass-panel-tint, 255, 255, 255), var(--glass-panel-tint-a, 0)), rgba(var(--glass-panel-tint, 255, 255, 255), var(--glass-panel-tint-a, 0))), linear-gradient(var(--glass-solid-surface, rgb(44, 50, 64)), var(--glass-solid-surface, rgb(44, 50, 64))) !important;
    border: 0 !important;
    box-shadow: var(--glass-solid-shadow, 0 2px 6px rgba(0, 0, 0, 0.12)) !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }
  :host([glass="solid"][nested]:not([own-tile])) .surface {
    /* image layers, so the tint rules (background-color) cannot wipe them: the colour
       (glass_tint / tile_tint) over the opaque fill */
    background: linear-gradient(rgba(var(--glass-tile-tint, 255, 255, 255), var(--glass-tile-tint-a, 0)), rgba(var(--glass-tile-tint, 255, 255, 255), var(--glass-tile-tint-a, 0))), linear-gradient(var(--glass-solid-tile, rgb(58, 65, 82)), var(--glass-solid-tile, rgb(58, 65, 82))) !important;
    box-shadow: none !important;
  }
  :host([dark][glass="solid"]) .surface {
    /* image layers, so the tint rules (background-color) cannot wipe them: the colour
       (glass_tint / tile_tint) over the opaque fill */
    background: linear-gradient(rgba(var(--glass-panel-tint, 255, 255, 255), var(--glass-panel-tint-a, 0)), rgba(var(--glass-panel-tint, 255, 255, 255), var(--glass-panel-tint-a, 0))), linear-gradient(var(--glass-solid-surface-night, rgb(30, 33, 41)), var(--glass-solid-surface-night, rgb(30, 33, 41))) !important;
  }
  :host([dark][glass="solid"][nested]:not([own-tile])) .surface {
    /* image layers, so the tint rules (background-color) cannot wipe them: the colour
       (glass_tint / tile_tint) over the opaque fill */
    background: linear-gradient(rgba(var(--glass-tile-tint, 255, 255, 255), var(--glass-tile-tint-a, 0)), rgba(var(--glass-tile-tint, 255, 255, 255), var(--glass-tile-tint-a, 0))), linear-gradient(var(--glass-solid-tile-night, rgb(44, 48, 58)), var(--glass-solid-tile-night, rgb(44, 48, 58))) !important;
  }
  :host([glass="solid"]) .surface::before,
  :host([glass="solid"]) .surface::after {
    display: none;
  }
  :host([control-glass="solid"]) .control:not(.active) {
    border: 0;
    /* control_tint over the opaque fill, as layers (the tint rule only sets the colour) */
    background: linear-gradient(rgba(var(--glass-control-tint, 255, 255, 255), var(--glass-control-tint-a, 0)), rgba(var(--glass-control-tint, 255, 255, 255), var(--glass-control-tint-a, 0))), linear-gradient(var(--glass-solid-control, rgb(78, 86, 106)), var(--glass-solid-control, rgb(78, 86, 106))) !important;
    box-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  :host([control-glass="solid"]) .control::before,
  :host([control-glass="solid"]) .control::after {
    display: none;
  }
  :host([glass="none"]) .surface {
    background: none !important;
    border: 0 !important;
    box-shadow: none !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }
  :host([glass="none"]) .surface::before,
  :host([glass="none"]) .surface::after {
    display: none;
  }
  /* ── glass: home (Apple Home) ──────────────────────────────────────────
     Matte frosted tiles, no rims or refraction. Light by default; the dashboard's
     dark appearance swaps the --glass-home-* tokens for the dark set. */
  :host([glass="home"]) .surface {
    --g-text: var(--glass-home-text, #1c1c1e);
    --g-text-2: var(--glass-home-text-2, rgba(60, 60, 67, 0.68));
    --g-text-shadow: none;
    --g-icon-shadow: none;
    color: var(--g-text);
    /* white weather clouds would vanish on a light tile */
    --wi-cloud-top: var(--glass-home-cloud-top, #eef1f6);
    --wi-cloud-bottom: var(--glass-home-cloud-bottom, #b7c1cf);
    --wi-cloud-back-top: var(--glass-home-cloud-back-top, #dde2ea);
    --wi-cloud-back-bottom: var(--glass-home-cloud-back-bottom, #9eaabb);
  }
  :host([glass="home"]) .surface {
    border: 0.5px solid var(--glass-home-border, rgba(255, 255, 255, 0.35)) !important;
    /* as an image layer, so the tint rules (background-color) cannot wipe it;
       --glass-home-fill may replace the flat colour with a gradient (metal at night) */
    background: var(--glass-home-fill, linear-gradient(var(--glass-home-surface, rgba(246, 246, 248, 0.8)), var(--glass-home-surface, rgba(246, 246, 248, 0.8)))) !important;
    box-shadow: var(--glass-home-shadow, 0 4px 16px rgba(0, 0, 0, 0.1)) !important;
    -webkit-backdrop-filter: blur(calc(var(--glass-home-blur, 24px) * var(--glass-blur-scale, 1))) saturate(var(--glass-home-saturate, 100%)) !important;
    backdrop-filter: blur(calc(var(--glass-home-blur, 24px) * var(--glass-blur-scale, 1))) saturate(var(--glass-home-saturate, 100%)) !important;
  }
  /* a home panel is the Apple Home sidebar: dark, wallpaper-tinted frosting with
     white text and orange icons, in light and dark appearance alike */
  :host([glass="home"]:not([nested])) {
    ${sideVars}
    /* dark liquid glass: the shader's night mode plus the sidebar tint */
    --glass-liquid-dark: 1;
    --glass-panel-tint: var(--glass-home-side-rgb, 22, 30, 46);
    --glass-panel-tint-a: var(--glass-home-side-a, 0.45);
    /* chips, people and buttons inside: dark translucent, white text – like the sidebar */
    --glass-home-surface: rgba(255, 255, 255, 0.12);
    --glass-home-fill: initial;
    --glass-home-shadow: initial;
    --glass-home-border: rgba(255, 255, 255, 0.1);
    --glass-home-text: #fff;
    --glass-home-text-2: rgba(235, 235, 245, 0.6);
    --glass-home-control: rgba(255, 255, 255, 0.14);
    --glass-home-icon: rgba(255, 255, 255, 0.9);
  }
  /* the WebGL canvas paints the glass; the CSS frosting is only the fallback */
  :host([glass="home"]:not([nested])) .surface.lg-on {
    background: none !important;
    border-color: transparent !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }
  :host([glass="home"]:not([nested])) .surface {
    --g-text: var(--glass-text);
    --g-text-2: var(--glass-text-secondary);
    --g-text-shadow: none;
    --g-icon-shadow: none;
    color: var(--g-text);
  }
  :host([glass="home"]:not([nested])) .surface {
    background: linear-gradient(var(--glass-home-side, rgba(30, 42, 62, 0.42)), var(--glass-home-side, rgba(30, 42, 62, 0.42))) !important;
    border: 0.5px solid rgba(255, 255, 255, 0.1) !important;
    -webkit-backdrop-filter: blur(calc(var(--glass-home-side-blur, 40px) * var(--glass-blur-scale, 1))) saturate(150%) !important;
    backdrop-filter: blur(calc(var(--glass-home-side-blur, 40px) * var(--glass-blur-scale, 1))) saturate(150%) !important;
  }
  /* a home tile on a home panel: one step lighter, so the tiles stand out
     (the panel hands --glass-home-on-panel down to everything inside it) */
  :host([glass="home"]:not([nested])) {
    --glass-home-on-panel: linear-gradient(var(--glass-home-tile, rgba(255, 255, 255, 0.85)), var(--glass-home-tile, rgba(255, 255, 255, 0.85)));
  }
  :host([glass="home"][nested]) .surface {
    /* glass_tint: a colour layer over the fill (the fill is an image layer, background-color can't show) */
    background:
      linear-gradient(rgba(var(--glass-tile-tint, 255, 255, 255), var(--glass-tile-tint-a, 0)), rgba(var(--glass-tile-tint, 255, 255, 255), var(--glass-tile-tint-a, 0))),
      var(
        --glass-home-on-panel,
        var(--glass-home-fill, linear-gradient(var(--glass-home-surface, rgba(246, 246, 248, 0.8)), var(--glass-home-surface, rgba(246, 246, 248, 0.8))))
      ) !important;
  }
  :host([glass="home"]) .surface::before,
  :host([glass="home"]) .surface::after {
    display: none;
  }
`;

/**
 * The liquid glass bar on a tile (thermostat, light): clear, a bright rim along
 * the top, a fainter one below, a soft inner sheen – whatever the control glass.
 * Night (dashboard): smoked glass via --glass-bar / --glass-bar-shadow.
 */
export const liquidBar = css`
  :host([control-glass]:not([nested])) .lbar.control,
  :host([control-glass][on-bare]) .lbar.control {
    border: 0 !important;
    background: var(--glass-bar, linear-gradient(180deg, rgba(255, 255, 255, 0.62), rgba(255, 255, 255, 0.22) 55%, rgba(255, 255, 255, 0.34))) !important;
    box-shadow: var(
      --glass-bar-shadow,
      inset 0 1px 0 rgba(255, 255, 255, 0.95),
      inset 0 -1px 0 rgba(255, 255, 255, 0.45),
      inset 0 0 14px rgba(255, 255, 255, 0.35),
      0 1px 2px rgba(0, 0, 0, 0.06),
      0 6px 18px rgba(0, 0, 0, 0.08)
    ) !important;
    -webkit-backdrop-filter: blur(calc(10px * var(--glass-blur-scale, 1))) saturate(170%) brightness(1.04);
    backdrop-filter: blur(calc(10px * var(--glass-blur-scale, 1))) saturate(170%) brightness(1.04);
  }
  .lbar.control {
    cursor: inherit;
    overflow: visible;
  }
  .lbar.control:active {
    transform: translateZ(0);
  }
`;

/** Round / pill control without its own blur (sits on a surface). */
export const control = css`
  .control {
    position: relative;
    box-sizing: border-box;
    border-radius: 999px;
    background: var(--bg, var(--g-control));
    border: 1px solid var(--g-control-border);
    box-shadow:
      0 10px 25px var(--shadow, rgba(0, 0, 0, 0.1)),
      inset 0 1px 1px rgba(255, 255, 255, 0.12);
    color: var(--fg, var(--g-text));
    transition:
      background 0.3s ease,
      box-shadow 0.3s ease,
      transform 0.18s ease,
      opacity 0.3s ease;
    overflow: hidden;
    isolation: isolate;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    touch-action: manipulation;
  }
  .control::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(120deg, var(--g-sheen), rgba(255, 255, 255, 0.1) 30%, rgba(255, 255, 255, 0.02) 60%);
    opacity: 0.35;
    pointer-events: none;
    z-index: -1;
  }
  .control {
    transform: translateZ(0);
    backface-visibility: hidden;
  }
  .control:active {
    transform: translateZ(0) scale(0.94);
  }
  .control.active {
    --shadow: color-mix(in srgb, var(--accent, transparent) 38%, transparent);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.28), rgba(255, 255, 255, 0) 55%),
      var(--bg);
    border-color: color-mix(in srgb, var(--accent, #fff) 45%, rgba(255, 255, 255, 0.5));
    box-shadow:
      0 6px 18px var(--shadow),
      inset 0 1px 0 rgba(255, 255, 255, 0.5),
      inset 0 -1px 2px rgba(0, 0, 0, 0.08);
  }
  :host([control-glass="liquid"]) .control {
    border: 0;
    background: var(--bg, var(--glass-liquid-control, var(--mat-liquid-bg)));
    box-shadow:
      0 4px 12px rgba(0, 0, 0, 0.1),
      inset 0 0 10px rgba(255, 255, 255, 0.08);
  }
  /* frosted buttons / chips: the same pill as the liquid ones, hairline edges only */
  :host([control-glass="frosted"]) .control:not(.active),
  :host([control-glass="light"]) .control:not(.active) {
    border: 0;
    background: var(--bg, var(--glass-liquid-control, var(--mat-liquid-bg)));
    box-shadow:
      inset 0 0.5px 0 rgba(255, 255, 255, calc(0.55 * var(--glass-edge-k, 1))),
      inset 0 -0.5px 0 rgba(255, 255, 255, calc(0.15 * var(--glass-edge-k, 1))),
      0 1px 2px rgba(0, 0, 0, 0.08),
      0 4px 12px rgba(0, 0, 0, 0.06);
  }
  :host([control-glass="frosted"]) .control::before,
  :host([control-glass="light"]) .control::before {
    opacity: 0.1;
  }
  :host([control-glass="liquid"]) .control::before {
    opacity: 0.1;
  }
  :host([control-glass="liquid"]) .control.active {
    background:
      radial-gradient(120% 90% at 30% 15%, rgba(255, 255, 255, 0.45), rgba(255, 255, 255, 0) 55%),
      var(--bg);
    box-shadow:
      0 6px 18px var(--shadow),
      inset 0 1px 0 rgba(255, 255, 255, 0.55),
      inset 0 -1px 0 rgba(255, 255, 255, 0.3),
      inset 0 2px 3px -2px rgba(255, 255, 255, 0.3);
  }
  /* free-standing controls (chips, people) carry their own glass in liquid mode */
  :host([glass="liquid"]:not([nested])) .control.glass {
    -webkit-backdrop-filter: blur(calc(10px * var(--glass-blur-scale, 1))) saturate(115%) brightness(1.05);
    backdrop-filter: blur(calc(10px * var(--glass-blur-scale, 1))) saturate(115%) brightness(1.05);
  }
  .control:focus-visible {
    outline: 2px solid var(--g-text);
    outline-offset: 2px;
  }
  ha-icon {
    filter: var(--g-icon-shadow);
  }
  /* control_tint: colored layer under inactive buttons / chips / people */
  :host(:not([control-glass="none"])) .control:not(.active) {
    background-color: rgba(var(--glass-control-tint, 255, 255, 255), var(--glass-control-tint-a, 0)) !important;
  }
  /* control glass: none – no glass circle / pill; an active control shows its colour on the icon */
  :host([control-glass="none"]) .control {
    background: none !important;
    border: 0 !important;
    box-shadow: none !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }
  :host([control-glass="none"]) .control::before,
  :host([control-glass="none"]) .control::after {
    display: none;
  }
  :host([control-glass="none"]) .control.active {
    color: var(--accent, var(--g-text));
  }
  /* control glass: home – grey circle when off, white with a coloured icon when on */
  :host([control-glass="home"]) .control {
    border: 0 !important;
    background: linear-gradient(var(--glass-home-control, rgba(118, 118, 128, 0.16)), var(--glass-home-control, rgba(118, 118, 128, 0.16))) !important;
    box-shadow: none !important;
    color: var(--glass-home-icon, rgba(60, 60, 67, 0.85));
  }
  :host([control-glass="home"]) .control::before,
  :host([control-glass="home"]) .control::after {
    display: none;
  }
  :host([control-glass="home"]) .control.glass {
    background: var(--glass-home-fill, linear-gradient(var(--glass-home-surface, rgba(246, 246, 248, 0.8)), var(--glass-home-surface, rgba(246, 246, 248, 0.8)))) !important;
    color: var(--glass-home-text, #1c1c1e);
    -webkit-backdrop-filter: blur(calc(var(--glass-home-blur, 24px) * var(--glass-blur-scale, 1))) saturate(var(--glass-home-saturate, 100%));
    backdrop-filter: blur(calc(var(--glass-home-blur, 24px) * var(--glass-blur-scale, 1))) saturate(var(--glass-home-saturate, 100%));
  }
  /* on: the coloured fill of the liquid buttons (with their soft top highlight) */
  :host([control-glass="home"]) .control.active {
    background:
      radial-gradient(120% 90% at 30% 15%, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0) 55%),
      var(--bg) !important;
    color: var(--fg, #fff);
    box-shadow:
      0 4px 14px var(--shadow, rgba(0, 0, 0, 0.15)),
      inset 0 1px 0 rgba(255, 255, 255, 0.5) !important;
  }
`;

/**
 * Animation library. Apply `anim-<name>` on the element, or `icon-<name>` for
 * icon-only motion. All motion stops for users preferring reduced motion.
 */
export const animations = css`
  /* first so that a running state animation (anim-*) takes precedence */
  .appear {
    animation: g-appear 0.45s cubic-bezier(0.2, 1.3, 0.4, 1) both;
  }
  .anim-pulse {
    animation: g-pulse 1.6s ease-in-out infinite;
  }
  .anim-glow {
    animation: g-glow 3s ease-out infinite;
  }
  .anim-blink {
    animation: g-blink 1s linear infinite;
  }
  .anim-breathe {
    animation: g-breathe 2.4s ease-in-out infinite;
  }
  .anim-bounce {
    animation: g-bounce 1.2s ease-in-out infinite;
  }
  .anim-shake {
    animation: g-shake 0.6s ease-in-out infinite;
  }
  .anim-ping {
    animation: g-ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;
  }
  .anim-spin ha-icon,
  .icon-spin {
    animation: g-spin 2s linear infinite;
  }
  .anim-flicker ha-icon {
    animation: g-flicker 2.2s linear infinite;
  }
  @keyframes g-pulse {
    50% {
      transform: scale(1.06);
    }
  }
  /* --g-base-shadow: the element's own shadows (edge hairlines…), kept while it glows */
  @keyframes g-glow {
    0% {
      box-shadow: var(--g-base-shadow, 0 0 transparent), 0 0 0 color-mix(in srgb, var(--glow, #fff) 60%, transparent);
    }
    50% {
      box-shadow: var(--g-base-shadow, 0 0 transparent), 0 0 25px color-mix(in srgb, var(--glow, #fff) 55%, transparent);
    }
    100% {
      box-shadow: var(--g-base-shadow, 0 0 transparent), 0 0 60px color-mix(in srgb, var(--glow, #fff) 0%, transparent);
    }
  }
  @keyframes g-blink {
    50% {
      opacity: 0.25;
    }
  }
  @keyframes g-breathe {
    50% {
      opacity: 0.55;
    }
  }
  @keyframes g-bounce {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-4px);
    }
  }
  @keyframes g-shake {
    0%,
    100% {
      transform: rotate(0);
    }
    25% {
      transform: rotate(-6deg);
    }
    75% {
      transform: rotate(6deg);
    }
  }
  @keyframes g-ping {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--glow, #fff) 70%, transparent);
    }
    100% {
      box-shadow: 0 0 0 14px color-mix(in srgb, var(--glow, #fff) 0%, transparent);
    }
  }
  @keyframes g-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes g-flicker {
    0%,
    100% {
      opacity: 1;
    }
    45% {
      opacity: 0.85;
    }
    50% {
      opacity: 0.55;
    }
    55% {
      opacity: 0.9;
    }
  }
  @keyframes g-appear {
    from {
      transform: scale(0.4);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    [class*="anim-"],
    [class*="anim-"] ha-icon,
    .icon-spin,
    .appear {
      animation: none !important;
    }
  }
`;

export const ANIMATIONS = ["pulse", "glow", "blink", "breathe", "bounce", "shake", "ping", "spin", "flicker"] as const;

/** Normalises `animation: glow` / `{ type: glow, color: red }` into class + style. */
export function animationOf(a: unknown): { cls: string; glow?: string } {
  if (!a || a === "none") return { cls: "" };
  if (typeof a === "string") return { cls: `anim-${a}` };
  if (typeof a === "object") {
    const o = a as Record<string, string>;
    return { cls: o.type ? `anim-${o.type}` : "", glow: o.color };
  }
  return { cls: "" };
}

/** Large editor: the lines between a grid's columns / rows (`.grid-grip.col` / `.row`), in the middle of the gap. */
export const gridGrips = css`
      /* large editor: the lines between the layout's columns / rows, in the middle of the gap */
      .grid-grip {
        position: absolute;
        z-index: 4;
        touch-action: none;
      }
      .grid-grip.col {
        top: 0;
        bottom: 0;
        left: calc(var(--grip-gap, var(--gap, 16px)) / -2 - 6px);
        width: 12px;
        cursor: col-resize;
      }
      .grid-grip.row {
        left: 0;
        right: 0;
        top: calc(var(--grip-gap, var(--gap, 16px)) / -2 - 6px);
        height: 12px;
        cursor: row-resize;
      }
      .grid-grip::after {
        content: "";
        position: absolute;
        border-radius: 2px;
        background: var(--primary-color, #03a9f4);
        opacity: 0;
        transition: opacity 0.15s;
      }
      .grid-grip.col::after {
        top: 0;
        bottom: 0;
        left: 4px;
        width: 4px;
      }
      .grid-grip.row::after {
        left: 0;
        right: 0;
        top: 4px;
        height: 4px;
      }
      .grid-grip:hover::after,
      .grid-grip.on::after {
        opacity: 0.9;
      }
`;
