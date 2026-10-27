import { css, svg, type SVGTemplateResult } from "lit";

/**
 * Own weather icon set (no external assets). Shapes share gradients from
 * `weatherDefs`, which every card using icons renders once.
 * Animated variants only move when `.animated` is on an ancestor.
 */
export const weatherDefs = svg`<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <radialGradient id="wi-sun" cx="40%" cy="35%" r="70%">
      <stop offset="0" stop-color="#fff3b0"/><stop offset=".45" stop-color="#ffd60a"/><stop offset="1" stop-color="#ff9f0a"/>
    </radialGradient>
    <linearGradient id="wi-ray" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ffe066"/><stop offset="1" stop-color="#ffb020"/></linearGradient>
    <linearGradient id="wi-moon" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#fdfcf0"/><stop offset="1" stop-color="#c9cfe0"/></linearGradient>
    <linearGradient id="wi-cloud" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:var(--wi-cloud-top, #ffffff)"/><stop offset="1" style="stop-color:var(--wi-cloud-bottom, #dbe4f0)"/></linearGradient>
    <linearGradient id="wi-cloud-back" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:var(--wi-cloud-back-top, #eef2f8)"/><stop offset="1" style="stop-color:var(--wi-cloud-back-bottom, #b9c4d4)"/></linearGradient>
    <linearGradient id="wi-cloud-dark" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#a7b0bf"/><stop offset="1" stop-color="#6b7486"/></linearGradient>
    <linearGradient id="wi-drop" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#9fd8ff"/><stop offset="1" stop-color="#2f8cff"/></linearGradient>
    <linearGradient id="wi-bolt" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff07a"/><stop offset="1" stop-color="#ffb000"/></linearGradient>
    <filter id="wi-soft" x="-20%" y="-20%" width="140%" height="160%">
      <feDropShadow dx="0" dy="2.5" stdDeviation="2.2" flood-color="#1b2a4a" flood-opacity=".22"/>
    </filter>
  </defs>
</svg>`;

const CLOUD = "M19 47h27a10 10 0 0 0 1.3-19.9A14 14 0 0 0 20.6 24.4 11.4 11.4 0 0 0 19 47z";

const sun = (t = "") => svg`<g transform=${t}>
  <g class="rays">${[0, 45, 90, 135, 180, 225, 270, 315].map(
    (a) => svg`<rect x="30.6" y="6" width="2.8" height="8" rx="1.4" fill="url(#wi-ray)" transform="rotate(${a} 32 32)"/>`,
  )}</g>
  <circle cx="32" cy="32" r="12.5" fill="url(#wi-sun)" filter="url(#wi-soft)"/>
</g>`;

// Animated groups never carry a transform attribute themselves: a CSS animation
// would replace it. Position on the outer group, animate the inner one.
const moon = (t = "") => svg`<g transform=${t}><g class="moon">
  <path d="M38.5 14.5a17 17 0 1 0 11 27.8A14 14 0 0 1 38.5 14.5z" fill="url(#wi-moon)" filter="url(#wi-soft)"/>
</g></g>`;

const cloud = (fill = "wi-cloud", t = "", cls = "cloud") =>
  svg`<g transform=${t}><g class=${cls}><path d=${CLOUD} fill="url(#${fill})" filter="url(#wi-soft)"/></g></g>`;

const drops = (n: number) =>
  svg`<g class="drops">${Array.from({ length: n }, (_, i) => {
    const x = 22 + i * (20 / Math.max(1, n - 1));
    return svg`<path class="drop" style="animation-delay:${i * 0.23}s" d="M${x} 50.5l-2 5.5a2.1 2.1 0 1 0 4 0z" fill="url(#wi-drop)"/>`;
  })}</g>`;

const flakes = (n: number) =>
  svg`<g class="flakes">${Array.from({ length: n }, (_, i) => {
    const x = 23 + i * (18 / Math.max(1, n - 1));
    return svg`<circle class="flake" style="animation-delay:${i * 0.4}s" cx=${x} cy="54" r="2.1" fill="#fff" stroke="#c7d6ea" stroke-width=".6"/>`;
  })}</g>`;

const bolt = svg`<path class="bolt" d="M33 44l-6 10h5l-3 8 9-12h-5l3-6z" fill="url(#wi-bolt)" filter="url(#wi-soft)"/>`;

const fog = svg`<g class="fog" stroke="#e8eef6" stroke-width="3" stroke-linecap="round">
  <line x1="14" y1="51" x2="50" y2="51"/><line x1="18" y1="57" x2="46" y2="57"/>
</g>`;

const wind = svg`<g class="wind" fill="none" stroke="#eef4fb" stroke-width="3" stroke-linecap="round">
  <path d="M10 26h28a6 6 0 1 0-6-6"/><path d="M10 34h38a6 6 0 1 1-6 6"/><path d="M10 42h18"/>
</g>`;

export function weatherIcon(condition: string | undefined, night = false): SVGTemplateResult {
  let body: SVGTemplateResult;
  const small = (t: string) => (night ? moon(t) : sun(t));
  switch (condition) {
    case "sunny":
      body = night ? moon() : sun();
      break;
    case "clear-night":
      body = moon();
      break;
    case "partlycloudy":
      body = svg`${small("translate(-7 -8) scale(.82)")}${cloud("wi-cloud", "translate(4 5)")}`;
      break;
    case "cloudy":
      body = svg`${cloud("wi-cloud-back", "translate(9 -7) scale(.8)", "cloud back")}${cloud("wi-cloud", "translate(-2 2)")}`;
      break;
    case "fog":
      body = svg`${cloud("wi-cloud", "translate(0 -6)")}${fog}`;
      break;
    case "rainy":
      body = svg`${cloud("wi-cloud", "translate(0 -6)")}${drops(3)}`;
      break;
    case "pouring":
      body = svg`${cloud("wi-cloud-dark", "translate(0 -6)")}${drops(5)}`;
      break;
    case "snowy":
      body = svg`${cloud("wi-cloud", "translate(0 -6)")}${flakes(3)}`;
      break;
    case "snowy-rainy":
      body = svg`${cloud("wi-cloud", "translate(0 -6)")}${drops(2)}${flakes(2)}`;
      break;
    case "hail":
      body = svg`${cloud("wi-cloud-dark", "translate(0 -6)")}${flakes(4)}`;
      break;
    case "lightning":
      body = svg`${cloud("wi-cloud-dark", "translate(0 -8)")}${bolt}`;
      break;
    case "lightning-rainy":
      body = svg`${cloud("wi-cloud-dark", "translate(0 -8)")}${drops(2)}${bolt}`;
      break;
    case "windy":
      body = wind;
      break;
    case "windy-variant":
      body = svg`${cloud("wi-cloud", "translate(4 -8) scale(.85)")}${wind}`;
      break;
    default:
      body = svg`<circle cx="32" cy="32" r="14" fill="none" stroke="#fff" stroke-width="3"/><path d="M32 24v10M32 38v2" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`;
  }
  return svg`<svg class="wi" viewBox="0 0 64 64" role="img" aria-label=${condition ?? ""}>${body}</svg>`;
}

export const weatherIconStyles = css`
  .wi {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .animated .wi .rays {
    animation: wi-spin 24s linear infinite;
    transform-origin: 32px 32px;
  }
  .animated .wi .cloud:not(.back) {
    animation: wi-drift 7s ease-in-out infinite alternate;
  }
  .animated .wi .back {
    animation: wi-drift 9s ease-in-out infinite alternate-reverse;
  }
  .animated .wi .drop {
    animation: wi-fall 1.1s linear infinite;
  }
  .animated .wi .flake {
    animation: wi-snow 2.4s linear infinite;
  }
  .animated .wi .bolt {
    animation: wi-flash 3s steps(1) infinite;
  }
  .animated .wi .moon {
    animation: wi-tilt 8s ease-in-out infinite alternate;
    transform-origin: 32px 32px;
  }
  .animated .wi .fog,
  .animated .wi .wind {
    animation: wi-drift 4s ease-in-out infinite alternate;
  }
  @keyframes wi-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes wi-drift {
    from {
      transform: translateX(-1.5px);
    }
    to {
      transform: translateX(1.5px);
    }
  }
  @keyframes wi-fall {
    0% {
      transform: translateY(-4px);
      opacity: 0;
    }
    30% {
      opacity: 1;
    }
    100% {
      transform: translateY(6px);
      opacity: 0;
    }
  }
  @keyframes wi-snow {
    0% {
      transform: translate(0, -4px);
      opacity: 0;
    }
    30% {
      opacity: 1;
    }
    100% {
      transform: translate(2px, 7px);
      opacity: 0;
    }
  }
  @keyframes wi-flash {
    0%,
    100% {
      opacity: 1;
    }
    92% {
      opacity: 0.2;
    }
    96% {
      opacity: 1;
    }
  }
  @keyframes wi-tilt {
    from {
      transform: rotate(-6deg);
    }
    to {
      transform: rotate(6deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .animated .wi * {
      animation: none !important;
    }
  }
`;
