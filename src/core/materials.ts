import { css } from "lit";
import { tint } from "./colors";

/**
 * A material for one element of a card (a button, a field, the compass's face) – chosen on
 * the element, not inherited like control_glass, so a card keeps e.g. Apple Home's dark
 * buttons while its bars follow the dashboard:
 *
 *   dark     the dark control glass of Apple Home (by night a lighter graphite)
 *   liquid   clear glass with a soft highlight
 *   frosted  frosted glass, hairline edges
 *   flat     a faint tint, no blur
 *   home     Apple Home's light grey
 *   none     nothing – the content only
 *
 * `--mat-tint` (see matTint) lays a colour over any of them.
 */
export type Material = "dark" | "liquid" | "frosted" | "flat" | "home" | "none";

export const MATERIALS: [Material, string][] = [
  ["dark", "Dark glass (Apple Home)"],
  ["liquid", "Liquid glass"],
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
  .mat-dark,
  .mat-liquid,
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
  .mat-liquid {
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
