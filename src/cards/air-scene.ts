import { css, svg, type SVGTemplateResult } from "lit";

/**
 * Animated landscape for the air quality tile, in the style of the dashboard's
 * wallpaper (blue hills): clear sky, sun, drifting clouds and birds when the air
 * is good; haze settling between the hills, a village on the hill whose chimneys
 * smoke more and darker as it gets worse, and at the worst a factory belching smoke. Pure SVG + CSS (transform / opacity only), still for reduced motion.
 *
 * level: 0 good … 5 hazardous; dark: night (moon, darker hills).
 */

/** Per level: sky top / bottom (day, night), sun opacity, haze, sun tint. */
const SKY_DAY = [
  ["#7fb8f2", "#dcecfb"],
  ["#93bde6", "#e6edf0"],
  ["#a7bccd", "#e7e3d6"],
  ["#a4a69f", "#d8cfbd"],
  ["#8f857a", "#cbb89e"],
  ["#6f6056", "#a88f77"],
];
const SKY_NIGHT = [
  ["#14213d", "#3a5584"],
  ["#18243c", "#435673"],
  ["#1d2638", "#4d5566"],
  ["#22252c", "#55534d"],
  ["#262220", "#5c4f42"],
  ["#241c18", "#57463a"],
];
const SUN = [1, 0.9, 0.7, 0.45, 0.3, 0.18];
const HAZE = [0, 0.18, 0.36, 0.55, 0.72, 0.85];
const SUN_DAY = ["#fff4c2", "#fff0bd", "#ffe3a8", "#ffcf8f", "#ffb877", "#ff9f66"];

/** Hill layers (back → front): path and day / night colour. */
const HILLS: [string, string, string][] = [
  ["M0 92 C30 78 55 80 80 88 C105 96 130 74 160 76 C180 78 192 84 200 86 V140 H0Z", "#a9c1df", "#2f4268"],
  ["M0 104 C25 94 50 92 78 100 C104 108 128 92 152 94 C172 96 188 102 200 100 V140 H0Z", "#86a6cf", "#27375a"],
  ["M0 118 C30 108 60 110 92 116 C122 122 150 108 176 110 C188 111 196 114 200 115 V140 H0Z", "#6489ba", "#1e2c4a"],
];

/** A cloud drifting across from left to right, `dur` s per pass, starting `phase` (0–1) into it. */
const cloud = (y: number, k: number, dur: number, phase: number) =>
  svg`<g class="cloud" style="--dur:${dur}s;--delay:${-phase * dur}s">
    <g transform="translate(0 ${y}) scale(${k})">
      <ellipse cx="0" cy="0" rx="14" ry="6"></ellipse>
      <ellipse cx="9" cy="-4" rx="9" ry="7"></ellipse>
      <ellipse cx="-8" cy="-2" rx="7" ry="5"></ellipse>
    </g>
  </g>`;

const bird = (x: number, y: number, d: number) =>
  svg`<g class="bird" style="--d:${d}s" transform="translate(${x} ${y})">
    <path class="wing" d="M-3 0 Q-1.5 -1.6 0 0 Q1.5 -1.6 3 0"></path>
  </g>`;

/** Smoke per level: how many of the houses smoke, its colour (day / night), peak opacity and how far it swells. */
const SMOKE: { houses: number; day: string; night: string; op: number; k: number }[] = [
  { houses: 0, day: "#ffffff", night: "#9aa3b5", op: 0, k: 1 },
  { houses: 2, day: "#bcc2ca", night: "#9aa3b5", op: 0.8, k: 2.4 },
  { houses: 3, day: "#a9a49c", night: "#8f939c", op: 0.8, k: 2.8 },
  { houses: 5, day: "#9a9389", night: "#7f7f82", op: 0.8, k: 3.2 },
  { houses: 5, day: "#7a7369", night: "#6c6866", op: 0.85, k: 3.6 },
  { houses: 5, day: "#5a534c", night: "#5a5552", op: 0.9, k: 4 },
]

/** Puffs rising from a chimney top at (x, y), drifting right with the wind. */
const smoke = (x: number, y: number, n: number, r: number, delay: number, rise = 22) =>
  svg`${Array.from({ length: n }, (_, i) => svg`<circle class="puff" cx=${x} cy=${y} r=${r} style="--delay:${-(delay + (i * 4.8) / n)}s;--rise:${-rise}px;--drift:${rise * 0.5}px"></circle>`)}`;

/** The village on the middle hill: x, ground y, size. */
// right of the middle, clear of the value in the bottom-left corner and the title above
const HOUSES: [number, number, number][] = [
  [81, 101.4, 0.95],
  [89, 102.5, 1.15],
  [97, 102.6, 1],
  [105, 101.7, 1.1],
  [113, 100.3, 0.9],
];
const SMOKE_ORDER = [1, 3, 0, 2, 4];

const house = (x: number, y: number, size: number, smoking: boolean, l: number, dark: boolean) => {
  const k = size * 1.25;
  const w = 3.6 * k;
  const h = 3.4 * k;
  const roof = 2.8 * k;
  const cx = x + w * 0.45;
  const top = y - h - roof * 0.75;
  return svg`<g>
    <rect class="chim" x=${cx} y=${top} width=${0.9 * k} height=${roof}></rect>
    <rect class="wall" x=${x - w} y=${y - h} width=${w * 2} height=${h + 1}></rect>
    <path class="roof" d="M${x - w - 0.6} ${y - h + 0.2} L${x} ${y - h - roof} L${x + w + 0.6} ${y - h + 0.2}Z"></path>
    ${dark ? svg`<rect class="win" x=${x - 0.6 * k} y=${y - h * 0.6} width=${1.2 * k} height=${1.1 * k}></rect>` : null}
    ${smoking ? smoke(cx + 0.45 * k, top - 0.6, 4, 1.5 + l * 0.2, x * 0.07, 16 + l * 3) : null}
  </g>`;
};

/** A factory on the back hill (level 4: one stack, 5: two, both belching). */
const factory = (l: number) => {
  const stacks: [number, number][] = l >= 5 ? [[113, 22], [121, 17]] : [[115, 18]];
  // on the back hill behind the trees, away from the village
  return svg`<g class="factory" transform="translate(56 -2)">
    ${stacks.map(([x, h]) => svg`<rect class="stack" x=${x - 1.3} y=${81 - h} width="2.6" height=${h}></rect>
      <rect class="band" x=${x - 1.3} y=${81 - h + 2} width="2.6" height="1.4"></rect>`)}
    <path class="hall" d="M104 82 V75.5 L108 73 V75.5 L112 73 V75.5 L116 73 V75.5 L120 73 V75.5 L124 73 V82Z"></path>
    ${stacks.map(([x, h], i) => smoke(x, 79 - h, 9, l >= 5 ? 2.6 : 2.1, i * 0.9, 30))}
  </g>`;
};

export function airScene(level: number, dark: boolean): SVGTemplateResult {
  const l = Math.min(5, Math.max(0, level));
  const [top, bottom] = (dark ? SKY_NIGHT : SKY_DAY)[l];
  const haze = HAZE[l];
  const hazeColor = dark ? "#6b6a66" : l >= 3 ? "#b9ab92" : "#e8eef2";
  const sm = SMOKE[l];
  return svg`<svg class="air-scene" viewBox="0 0 200 140" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="as-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color=${top}></stop>
        <stop offset="1" stop-color=${bottom}></stop>
      </linearGradient>
      <radialGradient id="as-glow">
        <stop offset="0" stop-color=${dark ? "#f4f1e0" : SUN_DAY[l]} stop-opacity="0.9"></stop>
        <stop offset="1" stop-color=${dark ? "#f4f1e0" : SUN_DAY[l]} stop-opacity="0"></stop>
      </radialGradient>
      <linearGradient id="as-haze" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color=${hazeColor} stop-opacity="0"></stop>
        <stop offset="0.5" stop-color=${hazeColor} stop-opacity="1"></stop>
        <stop offset="1" stop-color=${hazeColor} stop-opacity="0.6"></stop>
      </linearGradient>
      <radialGradient id="as-smoke">
        <stop offset="0" stop-color=${dark ? sm.night : sm.day} stop-opacity="1"></stop>
        <stop offset="0.55" stop-color=${dark ? sm.night : sm.day} stop-opacity="0.7"></stop>
        <stop offset="1" stop-color=${dark ? sm.night : sm.day} stop-opacity="0"></stop>
      </radialGradient>
      <radialGradient id="as-fsmoke">
        <stop offset="0" stop-color=${dark ? "#5c5856" : l >= 5 ? "#38332f" : "#59534d"} stop-opacity="1"></stop>
        <stop offset="0.55" stop-color=${dark ? "#5c5856" : l >= 5 ? "#38332f" : "#59534d"} stop-opacity="0.7"></stop>
        <stop offset="1" stop-color=${dark ? "#5c5856" : l >= 5 ? "#38332f" : "#59534d"} stop-opacity="0"></stop>
      </radialGradient>
    </defs>
    <rect width="200" height="140" fill="url(#as-sky)"></rect>
    ${dark
      ? svg`<g class="stars" style="opacity:${Math.max(0, 1 - l * 0.3)}">
          ${[
            [20, 14],
            [48, 26],
            [70, 10],
            [112, 20],
            [140, 8],
            [176, 24],
            [96, 34],
          ].map(([x, y], i) => svg`<circle class="star" cx=${x} cy=${y} r="0.8" style="--delay:${i * 0.7}s"></circle>`)}
        </g>`
      : null}
    <g class="sun" style="opacity:${SUN[l]}">
      <circle cx="150" cy="36" r="26" fill="url(#as-glow)"></circle>
      ${dark
        ? svg`<mask id="as-crescent">
              <circle cx="150" cy="36" r="8" fill="#fff"></circle>
              <circle cx="153.5" cy="33" r="7.5" fill="#000"></circle>
            </mask>
            <circle cx="150" cy="36" r="8" fill="#f2eedd" mask="url(#as-crescent)"></circle>`
        : svg`<circle cx="150" cy="36" r="10" fill=${SUN_DAY[l]}></circle>`}
    </g>
    <g class="clouds" fill=${dark ? "#55627d" : l >= 3 ? "#cfc6b4" : "#ffffff"} style="opacity:${dark ? 0.45 : 0.85 - l * 0.08}">
      ${cloud(30, 1, 90, 0.25)}${cloud(22, 0.8, 110, 0.75)}${cloud(48, 0.7, 70, 0.55)}${cloud(40, 0.6, 80, 0.05)}
    </g>
    ${l <= 1 && !dark ? svg`<g class="birds">${bird(30, 54, 0)}${bird(38, 50, 0.3)}${bird(25, 47, 0.6)}</g>` : null}
    ${HILLS.map(
      ([d, day, night], i) => svg`
        <path d=${d} fill=${dark ? night : day}></path>
        ${i === 0 && l >= 4 ? factory(l) : null}

        <rect class="haze h${i}" x="-40" y=${70 + i * 14} width="280" height="70" fill="url(#as-haze)" style="opacity:${haze * (0.55 + i * 0.2)}"></rect>
        ${i === 1
          ? svg`<g class="village ${dark ? "night" : l >= 3 ? "dull" : ""}" style="--op:${sm.op};--k:${sm.k}">
              ${HOUSES.map(([x, y, k], j) => house(x, y, k, SMOKE_ORDER.indexOf(j) < sm.houses, l, dark))}
            </g>`
          : null}`,
    )}
    <g class="trees" fill=${dark ? "#14203a" : l >= 3 ? "#6f7a82" : "#3f6a8f"}>
      ${[
        [140, 96.5, 1.1],
        [147, 95, 1.35],
        [154, 94.5, 1],
        [170, 96.5, 1.25],
        [177, 97.5, 0.95],
      ].map(
        ([x, y, k], i) =>
          svg`<g transform="translate(${x} ${y}) scale(${k})"><g class="tree" style="--delay:${i * 0.5}s"><path d="M0 -10 L3.6 0 H-3.6Z"></path><rect x="-0.6" y="0" width="1.2" height="2.6"></rect></g></g>`,
      )}
    </g>
  </svg>`;
}

export const airSceneStyles = css`
  .air-scene {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .air-scene .cloud {
    animation: as-drift var(--dur) linear infinite;
    animation-delay: var(--delay);
  }
  @keyframes as-drift {
    from {
      transform: translateX(-40px);
    }
    to {
      transform: translateX(240px);
    }
  }
  .air-scene .bird {
    animation: as-fly 24s linear infinite;
    animation-delay: calc(var(--d) * -1);
  }
  .air-scene .wing {
    fill: none;
    stroke: #2b4466;
    stroke-width: 0.7;
    stroke-linecap: round;
    transform-box: fill-box;
    transform-origin: center;
    animation: as-flap 0.9s ease-in-out infinite;
    animation-delay: var(--d);
  }
  @keyframes as-fly {
    from {
      translate: -40px 4px;
    }
    50% {
      translate: 90px -6px;
    }
    to {
      translate: 220px 2px;
    }
  }
  @keyframes as-flap {
    0%,
    100% {
      transform: scaleY(1);
    }
    50% {
      transform: scaleY(-0.6);
    }
  }
  .air-scene .haze {
    animation: as-haze 18s ease-in-out infinite alternate;
  }
  .air-scene .haze.h1 {
    animation-duration: 24s;
  }
  @keyframes as-haze {
    from {
      transform: translateX(-14px);
    }
    to {
      transform: translateX(14px);
    }
  }
  .air-scene .village .wall {
    fill: #eef1f4;
  }
  .air-scene .village .roof {
    fill: #9a6556;
  }
  .air-scene .village .chim {
    fill: #7c5a50;
  }
  .air-scene .village.dull .wall {
    fill: #d5d0c6;
  }
  .air-scene .village.dull .roof,
  .air-scene .village.dull .chim {
    fill: #6e5f58;
  }
  .air-scene .village.night .wall {
    fill: #2c3a5c;
  }
  .air-scene .village.night .roof,
  .air-scene .village.night .chim {
    fill: #1a2440;
  }
  .air-scene .village .win {
    fill: #ffd98a;
  }
  .air-scene .factory .hall,
  .air-scene .factory .stack {
    fill: #6f747c;
  }
  .air-scene .factory .band {
    fill: #b5574a;
  }
  /* soft-edged puffs that melt into a plume */
  .air-scene .village .puff {
    fill: url(#as-smoke);
  }
  .air-scene .factory .puff {
    fill: url(#as-fsmoke);
  }
  .air-scene .factory {
    --op: 0.75;
    --k: 4.2;
  }
  .air-scene .puff {
    opacity: 0;
    transform-box: fill-box;
    transform-origin: center;
    animation: as-puff 4.8s ease-out infinite;
    animation-delay: var(--delay);
  }
  @keyframes as-puff {
    0% {
      opacity: 0;
      transform: translate(0, 0) scale(0.6);
    }
    15% {
      opacity: var(--op, 0.7);
    }
    100% {
      opacity: 0;
      transform: translate(var(--drift, 10px), var(--rise, -22px)) scale(var(--k, 2.6));
    }
  }
  .air-scene .tree {
    transform-box: fill-box;
    transform-origin: bottom center;
    animation: as-sway 5s ease-in-out infinite alternate;
    animation-delay: var(--delay);
  }
  @keyframes as-sway {
    from {
      transform: rotate(-2deg);
    }
    to {
      transform: rotate(2deg);
    }
  }
  .air-scene .star {
    fill: #fff;
    animation: as-twinkle 3s ease-in-out infinite alternate;
    animation-delay: var(--delay);
  }
  @keyframes as-twinkle {
    from {
      opacity: 0.25;
    }
    to {
      opacity: 0.9;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .air-scene * {
      animation: none !important;
    }
  }
`;
