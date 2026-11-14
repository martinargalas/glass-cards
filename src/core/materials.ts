import { css } from "lit";
import { tint } from "./colors";

/**
 * A material for one element of a card (a button, a field, the compass's face) – chosen on
 * the element, not inherited like control_glass, so a card keeps e.g. Apple Home's dark
 * buttons while its bars follow the dashboard:
 *
 *   dark     the dark control glass of Apple Home (by night a lighter graphite)
 *   dark-liquid  the dark liquid glass of Apple Home's sidebar, white text (CSS: blurred, dark, light rims)
 *   liquid-gl, dark-liquid-gl  the same drawn by WebGL (the real lens, core/liquid); while lit or
 *            picked, and where WebGL can't draw, their CSS look
 *   liquid   clear glass with a soft highlight
 *   frosted  frosted glass, hairline edges
 *   flat     a faint tint, no blur
 *   home     Apple Home's light grey
 *   none     nothing – the content only
 *
 * `--mat-tint` (see matTint) lays a colour over any of them.
 */
export type Material = "dark" | "liquid" | "dark-liquid" | "liquid-gl" | "dark-liquid-gl" | "frosted" | "flat" | "home" | "none";

export const MATERIALS: [Material, string][] = [
  ["dark", "Dark glass (Apple Home)"],
  ["liquid", "Liquid glass (CSS)"],
  ["dark-liquid", "Dark liquid glass (CSS)"],
  ["liquid-gl", "Liquid glass (WebGL)"],
  ["dark-liquid-gl", "Dark liquid glass (WebGL)"],
  ["frosted", "Frosted glass"],
  ["flat", "No blur"],
  ["home", "Home (light grey)"],
  ["none", "None"],
];

/** The soft top highlight of a coloured button (the active controls' gradient). */
export const SHEEN = "radial-gradient(120% 90% at 30% 15%, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0) 55%)";

/** The style that tints a material with a colour (empty without one); it keeps the highlight. */
export const matTint = (color?: string, percent = 55) => (color ? `--mat-tint:${tint(color, percent)};--mat-tinted:1;--mat-sheen:${SHEEN}` : "");

export const materials = css`
  canvas.lg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: inherit;
    z-index: -2;
    pointer-events: none;
  }
  .mat-dark,
  .mat-liquid,
  .mat-dark-liquid,
  .mat-liquid-gl,
  .mat-dark-liquid-gl,
  .mat-frosted,
  .mat-flat,
  .mat-home,
  .mat-none {
    border: 0;
  }
  .mat-dark {
    color: var(--mat-dark-text);
    background: var(--mat-sheen, linear-gradient(transparent, transparent)), linear-gradient(var(--mat-tint, transparent), var(--mat-tint, transparent)), var(--glass-control-bg);
    box-shadow: var(--glass-control-shadow);
  }
  .mat-liquid,
  .mat-liquid-gl {
    color: var(--g-text);
    background:
      var(--mat-sheen, linear-gradient(transparent, transparent)),
      linear-gradient(var(--mat-tint, transparent), var(--mat-tint, transparent)),
      var(--mat-liquid-bg);
    box-shadow:
      0 4px 12px rgba(0, 0, 0, 0.1),
      inset 0 0.5px 0 rgba(255, 255, 255, 0.55),
      inset 0 0 10px rgba(255, 255, 255, 0.08);
    -webkit-backdrop-filter: blur(calc(10px * var(--glass-blur-scale, 1))) saturate(115%) brightness(1.05);
    backdrop-filter: blur(calc(10px * var(--glass-blur-scale, 1))) saturate(115%) brightness(1.05);
  }
  /* the dark liquid glass of Apple Home's sidebar: a dark, blurred glass with light rims, white text */
  .mat-dark-liquid,
  .mat-dark-liquid-gl {
    color: #fff;
    --g-text: #fff;
    --g-text-2: rgba(235, 235, 245, 0.6);
    background:
      var(--mat-sheen, linear-gradient(transparent, transparent)),
      linear-gradient(var(--mat-tint, transparent), var(--mat-tint, transparent)),
      linear-gradient(rgba(var(--glass-home-side-rgb, 22, 30, 46), var(--glass-home-side-a, 0.55)), rgba(var(--glass-home-side-rgb, 22, 30, 46), var(--glass-home-side-a, 0.55)));
    box-shadow:
      inset 0 0.5px 0 rgba(255, 255, 255, 0.4),
      inset 0 -0.5px 0 rgba(255, 255, 255, 0.12),
      inset 0 0 10px rgba(255, 255, 255, 0.06),
      0 4px 12px rgba(0, 0, 0, 0.16);
    -webkit-backdrop-filter: blur(calc(16px * var(--glass-blur-scale, 1))) saturate(150%);
    backdrop-filter: blur(calc(16px * var(--glass-blur-scale, 1))) saturate(150%);
  }
  /* WebGL: the shader's own tint off (a part's colour is passed to it), the dark one in its night mode */
  .mat-liquid-gl {
    --glass-panel-tint-a: 0;
    --glass-liquid-dark: 0;
  }
  .mat-dark-liquid-gl {
    --glass-liquid-dark: 1;
    --glass-panel-tint: var(--glass-home-side-rgb, 22, 30, 46);
    --glass-panel-tint-a: var(--glass-home-side-a, 0.45);
  }
  /* the canvas paints the glass: only the drop shadow stays */
  .mat-liquid-gl.lg-on,
  .mat-dark-liquid-gl.lg-on {
    background: none !important;
    border-color: transparent !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12) !important;
  }
  .mat-frosted {
    color: var(--g-text);
    background:
      var(--mat-sheen, linear-gradient(transparent, transparent)),
      linear-gradient(var(--mat-tint, transparent), var(--mat-tint, transparent)),
      linear-gradient(180deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.1));
    box-shadow:
      inset 0 0.5px 0 rgba(255, 255, 255, 0.55),
      inset 0 -0.5px 0 rgba(255, 255, 255, 0.15),
      0 1px 2px rgba(0, 0, 0, 0.08);
    -webkit-backdrop-filter: blur(calc(16px * var(--glass-blur-scale, 1)));
    backdrop-filter: blur(calc(16px * var(--glass-blur-scale, 1)));
  }
  .mat-flat {
    color: var(--g-text);
    background: var(--mat-sheen, linear-gradient(transparent, transparent)), linear-gradient(var(--mat-tint, color-mix(in srgb, var(--g-text) 10%, transparent)), var(--mat-tint, color-mix(in srgb, var(--g-text) 10%, transparent)));
    box-shadow: none;
  }
  .mat-home {
    color: var(--mat-home-text);
    background: var(--mat-sheen, linear-gradient(transparent, transparent)), linear-gradient(var(--mat-tint, transparent), var(--mat-tint, transparent)), linear-gradient(var(--mat-home-bg), var(--mat-home-bg));
    box-shadow: none;
  }
  /* none: the element keeps its own colour */
  .mat-none {
    background: var(--mat-sheen, linear-gradient(transparent, transparent)), linear-gradient(var(--mat-tint, transparent), var(--mat-tint, transparent));
    box-shadow: none;
  }
`;
