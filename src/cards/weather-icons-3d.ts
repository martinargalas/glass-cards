import { css, svg, type SVGTemplateResult } from "lit";

/**
 * "Realistic" weather icons for the big icon: a glowing sun, volumetric clouds
 * (overlapping puffs sharing one light gradient, shaded underside, soft shadow),
 * glossy rain drops, a moon with halo. Pure SVG, no assets. Gradients and filters
 * come from `weather3dDefs`, rendered once per card. Motion only with `.animated`
 * on an ancestor.
 */
export const weather3dDefs = svg`<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <radialGradient id="wr-sun" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#fffbe0"/>
      <stop offset=".72" stop-color="#ffef94"/><stop offset="1" stop-color="#ffd23c"/>
    </radialGradient>
    <radialGradient id="wr-corona">
      <stop offset="0" stop-color="#fff2a8" stop-opacity=".95"/><stop offset=".35" stop-color="#ffd23f" stop-opacity=".55"/>
      <stop offset=".7" stop-color="#ffa500" stop-opacity=".16"/><stop offset="1" stop-color="#ff9500" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="wr-ray" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#ffe680" stop-opacity="0"/><stop offset="1" stop-color="#fff3b0" stop-opacity=".75"/>
    </linearGradient>
    <filter id="wr-soft-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.5"/></filter>
    <filter id="wr-bloom" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="7"/></filter>
    <filter id="wr-edge" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation=".45"/></filter>
    <mask id="wr-puffs" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><g fill="#fff">
      <circle cx="30" cy="54" r="15"/><circle cx="48" cy="42" r="20"/><circle cx="67" cy="52" r="15"/>
      <rect x="16" y="50" width="66" height="20" rx="10"/></g></mask>
    <radialGradient id="wr-moon" cx="38%" cy="34%" r="75%">
      <stop offset="0" stop-color="#fffef6"/><stop offset=".6" stop-color="#eceee6"/><stop offset="1" stop-color="#b9bfcf"/>
    </radialGradient>
    <radialGradient id="wr-moon-halo">
      <stop offset="0" stop-color="#dfe8ff" stop-opacity=".45"/><stop offset="1" stop-color="#dfe8ff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="wr-cloud" gradientUnits="userSpaceOnUse" cx="38" cy="34" r="52">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#f6f8fc"/>
      <stop offset=".8" stop-color="#d4dcea"/><stop offset="1" stop-color="#b3bfd2"/>
    </radialGradient>
    <radialGradient id="wr-cloud-dark" gradientUnits="userSpaceOnUse" cx="38" cy="34" r="52">
      <stop offset="0" stop-color="#d9dfea"/><stop offset=".5" stop-color="#a9b3c4"/>
      <stop offset="1" stop-color="#6e7a90"/>
    </radialGradient>
    <linearGradient id="wr-under" gradientUnits="userSpaceOnUse" x1="0" y1="48" x2="0" y2="72">
      <stop offset="0" stop-color="#5b6b8a" stop-opacity="0"/><stop offset="1" stop-color="#5b6b8a" stop-opacity=".38"/>
    </linearGradient>
    <linearGradient id="wr-drop" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#d4efff"/><stop offset=".5" stop-color="#6cbcff"/><stop offset="1" stop-color="#1f7cff"/>
    </linearGradient>
    <linearGradient id="wr-bolt" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#fff7b0"/><stop offset=".5" stop-color="#ffd23f"/><stop offset="1" stop-color="#ff9f0a"/>
    </linearGradient>
    <filter id="wr-shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#14223f" flood-opacity=".28"/>
    </filter>
    <filter id="wr-glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="2.5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="wr-blur" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter>
    <!-- HTC Sense style: glossy sun with lens flare, fluffy lit clouds -->
    <radialGradient id="wh-sun" cx="40%" cy="36%" r="64%">
      <stop offset="0" stop-color="#fffef2"/><stop offset=".18" stop-color="#fff59a"/>
      <stop offset=".5" stop-color="#ffcc11"/><stop offset=".82" stop-color="#ff9500"/><stop offset="1" stop-color="#f06a00"/>
    </radialGradient>
    <radialGradient id="wh-glow">
      <stop offset="0" stop-color="#fff3b0" stop-opacity=".95"/><stop offset=".3" stop-color="#ffcf40" stop-opacity=".55"/>
      <stop offset=".65" stop-color="#ff9d00" stop-opacity=".18"/><stop offset="1" stop-color="#ff8a00" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="wh-spec" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="wh-streak" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#fff6c8" stop-opacity="0"/><stop offset=".5" stop-color="#fffbe8" stop-opacity=".95"/>
      <stop offset="1" stop-color="#fff6c8" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="wh-puff" cx="42%" cy="30%" r="70%">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#f3f6fb"/><stop offset="1" stop-color="#c6d1e2"/>
    </radialGradient>
    <radialGradient id="wh-puff-dark" cx="42%" cy="30%" r="70%">
      <stop offset="0" stop-color="#d3d9e4"/><stop offset=".55" stop-color="#9aa5b8"/><stop offset="1" stop-color="#5f6a80"/>
    </radialGradient>
    <linearGradient id="wh-cloud-shade" gradientUnits="userSpaceOnUse" x1="0" y1="44" x2="0" y2="74">
      <stop offset="0" stop-color="#4d5f86" stop-opacity="0"/><stop offset="1" stop-color="#4d5f86" stop-opacity=".42"/>
    </linearGradient>
    <filter id="wh-fluff" x="-20%" y="-20%" width="140%" height="150%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="3.5"/><feOffset dy="5"/>
      <feComponentTransfer><feFuncA type="linear" slope=".32"/></feComponentTransfer>
      <feFlood flood-color="#13213f"/><feComposite operator="in" in2="SourceAlpha" result="unused"/>
      <feGaussianBlur in="SourceAlpha" stdDeviation="3.5" result="b"/><feOffset in="b" dy="5" result="o"/>
      <feFlood flood-color="#13213f" flood-opacity=".3"/><feComposite in2="o" operator="in" result="sh"/>
      <feGaussianBlur in="SourceGraphic" stdDeviation=".35" result="soft"/>
      <feMerge><feMergeNode in="sh"/><feMergeNode in="soft"/></feMerge>
    </filter>
    <mask id="wh-cloud-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><g fill="#fff">
      <circle cx="26" cy="58" r="12"/><circle cx="38" cy="47" r="15"/><circle cx="54" cy="40" r="18"/>
      <circle cx="69" cy="50" r="13"/><circle cx="78" cy="60" r="10"/><rect x="18" y="52" width="66" height="19" rx="9.5"/></g></mask>
    <!-- HTC weather look: soft yellow sun with fuzzy spiky corona, photo-like wispy clouds -->
    <radialGradient id="hs-ball" cx="42%" cy="34%" r="70%">
      <stop offset="0" stop-color="#fffbd6"/><stop offset=".35" stop-color="#ffe45c"/>
      <stop offset=".75" stop-color="#ffc21f"/><stop offset="1" stop-color="#f5a300"/>
    </radialGradient>
    <radialGradient id="hs-corona">
      <stop offset=".35" stop-color="#ffd93a" stop-opacity=".95"/><stop offset=".6" stop-color="#ffc21a" stop-opacity=".45"/>
      <stop offset="1" stop-color="#ffb000" stop-opacity="0"/>
    </radialGradient>
    <filter id="hs-fuzz" x="-40%" y="-40%" width="180%" height="180%">
      <feTurbulence type="fractalNoise" baseFrequency=".18" numOctaves="2" seed="7" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feGaussianBlur in="d" stdDeviation="2.2"/>
    </filter>
    <linearGradient id="hc-body" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#e9edf3"/><stop offset="1" stop-color="#9ea8b8"/>
    </linearGradient>
    <linearGradient id="hc-body-dark" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#d7dbe2"/><stop offset=".55" stop-color="#9097a5"/><stop offset="1" stop-color="#4e5566"/>
    </linearGradient>
    <filter id="hc-tex" x="-25%" y="-30%" width="150%" height="170%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency=".032" numOctaves="4" seed="11" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="10" xChannelSelector="R" yChannelSelector="G" result="disp"/>
      <feGaussianBlur in="disp" stdDeviation="1.3" result="shape"/>
      <feDiffuseLighting in="noise" surfaceScale="2.2" lighting-color="#ffffff" result="light">
        <feDistantLight azimuth="240" elevation="58"/>
      </feDiffuseLighting>
      <feComposite in="shape" in2="light" operator="arithmetic" k1=".55" k2=".55" k3="0" k4="0" result="lit"/>
      <feComposite in="lit" in2="shape" operator="in" result="cloud"/>
      <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="sb"/><feOffset in="sb" dy="4" result="so"/>
      <feFlood flood-color="#0f1c38" flood-opacity=".28"/><feComposite in2="so" operator="in" result="shadow"/>
      <feMerge><feMergeNode in="shadow"/><feMergeNode in="cloud"/></feMerge>
    </filter>
    <!-- glossy set (DW-style): amber sphere with fiery corona, soft glowing clouds, blue night orb -->
    <radialGradient id="gs-ball" cx="50%" cy="62%" r="62%">
      <stop offset="0" stop-color="#fff4a3"/><stop offset=".4" stop-color="#ffd43b"/>
      <stop offset=".8" stop-color="#ffa412"/><stop offset="1" stop-color="#e57a00"/>
    </radialGradient>
    <linearGradient id="gs-gloss" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".85"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="gs-fire">
      <stop offset=".45" stop-color="#ffcf33" stop-opacity="1"/><stop offset=".62" stop-color="#ff9d0a" stop-opacity=".7"/>
      <stop offset=".85" stop-color="#ff7a00" stop-opacity=".18"/><stop offset="1" stop-color="#ff6a00" stop-opacity="0"/>
    </radialGradient>
    <filter id="gs-flame" x="-40%" y="-40%" width="180%" height="180%">
      <feTurbulence type="fractalNoise" baseFrequency=".09" numOctaves="3" seed="4" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feGaussianBlur in="d" stdDeviation="1.6"/>
    </filter>
    <radialGradient id="gs-orb" cx="45%" cy="40%" r="62%">
      <stop offset="0" stop-color="#9fe2ff"/><stop offset=".45" stop-color="#2fa6ff"/>
      <stop offset=".85" stop-color="#0a5fd6"/><stop offset="1" stop-color="#063f9e"/>
    </radialGradient>
    <radialGradient id="gs-orb-glow">
      <stop offset=".5" stop-color="#3aa8ff" stop-opacity=".55"/><stop offset="1" stop-color="#3aa8ff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="gc-shade" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#f4f6fa"/><stop offset="1" stop-color="#a9b2c2"/>
    </linearGradient>
    <linearGradient id="gc-shade-dark" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#dfe3ea"/><stop offset=".5" stop-color="#9aa2b2"/><stop offset="1" stop-color="#4b5263"/>
    </linearGradient>
    <filter id="gc-soft" x="-30%" y="-40%" width="160%" height="180%">
      <feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="3" seed="2" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="6" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feGaussianBlur in="d" stdDeviation="1.5"/>
    </filter>
    <filter id="gc-mist" x="-30%" y="-40%" width="160%" height="180%"><feGaussianBlur stdDeviation="4"/></filter>
    <filter id="gc-hl" x="-30%" y="-40%" width="160%" height="180%"><feGaussianBlur stdDeviation="1.4"/></filter>
    <linearGradient id="gb-bolt" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#f6d8ff"/><stop offset="1" stop-color="#b44dff"/>
    </linearGradient>
  </defs>
</svg>`;

/** Glossy amber sphere (lit from below, glass sheen on top) in a fiery corona. */
const sun = (t = "") => svg`<g transform=${t}>
  <g class="halo"><circle cx="50" cy="50" r="40" fill="url(#gs-fire)" filter="url(#gs-flame)"/></g>
  <circle cx="50" cy="50" r="24" fill="url(#gs-ball)"/>
  <circle cx="50" cy="50" r="17" fill="none" stroke="#fff3b0" stroke-opacity=".28" stroke-width="1.2"/>
  <ellipse cx="50" cy="38" rx="17" ry="10" fill="url(#gs-gloss)" opacity=".75"/>
</g>`;

/** Night: a glossy blue glass orb with a glow. */
const moon = (t = "") => svg`<g transform=${t}>
  <circle cx="50" cy="50" r="38" fill="url(#gs-orb-glow)"/>
  <g class="moon">
    <circle cx="50" cy="50" r="24" fill="url(#gs-orb)"/>
    <ellipse cx="50" cy="37" rx="16" ry="9" fill="url(#gs-gloss)" opacity=".7"/>
    <circle cx="40" cy="60" r="4" fill="#bfe9ff" opacity=".18"/>
  </g>
</g>`;

/** Soft glowing cloud: a blurred grey-white mass, lighter puffs on top and a
 *  bright highlight – soft edges, no hard outline. */
const BODY = "M22 70c-8 0-12-6-10-12 2-5 7-7 12-6 0-9 8-15 16-13 3-9 12-14 21-11 8 2 13 10 12 18 7-1 13 4 13 11 0 7-6 13-13 13z";
const cloud = (t = "", dark = false, cls = "cloud") => svg`<g transform=${t}><g class=${cls}>
  <path d=${BODY} fill=${dark ? "#3c4252" : "#7d8698"} opacity=".4" filter="url(#gc-mist)" transform="translate(0 4)"/>
  <path d=${BODY} fill=${dark ? "url(#gc-shade-dark)" : "url(#gc-shade)"} filter="url(#gc-soft)"/>
  <g fill="#fff" opacity=${dark ? 0.35 : 0.9} filter="url(#gc-hl)">
    <ellipse cx="57" cy="40" rx="11" ry="7"/><ellipse cx="40" cy="47" rx="9" ry="5.5"/><ellipse cx="72" cy="53" rx="7" ry="4.5"/>
  </g>
</g></g>`;

const drops = (n: number, dark = false) =>
  svg`<g class="drops">${Array.from({ length: n }, (_, i) => {
    const x = 34 + i * (32 / Math.max(1, n - 1));
    const y = 72 + (i % 2) * 6;
    return svg`<g class="drop" style="animation-delay:${i * 0.21}s">
      <path d="M${x} ${y}c-3.9 6-6 9.6-6 12.6a6 6 0 0 0 12 0c0-3-2.1-6.6-6-12.6z" fill="url(#wr-drop)" opacity=${dark ? 0.97 : 0.93} filter="url(#wr-shadow)"/>
      <ellipse cx=${x - 2} cy=${y + 10.5} rx="1.3" ry="2.4" fill="#fff" opacity=".75"/>
    </g>`;
  })}</g>`;

const flakes = (n: number, hail = false) =>
  svg`<g class="flakes">${Array.from({ length: n }, (_, i) => {
    const x = 34 + i * (32 / Math.max(1, n - 1));
    const y = 82 + (i % 2) * 5;
    return hail
      ? svg`<circle class="flake" style="animation-delay:${i * 0.3}s" cx=${x} cy=${y} r="3.2" fill="#f4f9ff" stroke="#b8c9e0" stroke-width=".8"/>`
      : svg`<g class="flake" style="animation-delay:${i * 0.4}s" stroke="#fff" stroke-width="1.1" stroke-linecap="round" filter="url(#wr-glow)">
          ${[0, 60, 120].map((a) => svg`<line x1=${x - 3.4} y1=${y} x2=${x + 3.4} y2=${y} transform="rotate(${a} ${x} ${y})"/>`)}
        </g>`;
  })}</g>`;

const bolt = svg`<g class="bolt" fill="none" stroke="url(#gb-bolt)" stroke-linecap="round" stroke-linejoin="round" filter="url(#wr-glow)">
  <path d="M52 58l-7 13 8 3-10 18" stroke-width="3"/><path d="M45 71l-8 7" stroke-width="1.8"/><path d="M53 74l8 8" stroke-width="1.6"/><path d="M47 83l-5 3" stroke-width="1.2"/>
</g>`;

const fog = svg`<g class="fog" filter="url(#wr-blur)" stroke="#f2f6fb" stroke-linecap="round" stroke-width="4.5" opacity=".9">
  <line x1="20" y1="78" x2="80" y2="78"/><line x1="28" y1="88" x2="72" y2="88"/>
</g>`;

const wind = svg`<g class="wind" fill="none" stroke="#f2f6fb" stroke-width="4.5" stroke-linecap="round" opacity=".92" filter="url(#wr-shadow)">
  <path d="M14 42h44a9 9 0 1 0-9-9"/><path d="M14 56h58a9 9 0 1 1-9 9"/><path d="M14 70h28"/>
</g>`;

export function weatherIcon3d(condition: string | undefined, night = false): SVGTemplateResult {
  let body: SVGTemplateResult;
  const orb = (t: string) => (night ? moon(t) : sun(t));
  switch (condition) {
    case "sunny":
      body = night ? moon() : sun();
      break;
    case "clear-night":
      body = moon();
      break;
    case "partlycloudy":
      body = svg`${orb("translate(-10 -14) scale(.85)")}${cloud("translate(2 10) scale(1.02)")}`;
      break;
    case "cloudy":
      body = svg`${cloud("translate(24 -4) scale(.72)", false, "cloud back")}${cloud("translate(0 12)")}`;
      break;
    case "fog":
      body = svg`${cloud("translate(0 -4)")}${fog}`;
      break;
    case "rainy":
      body = svg`${cloud("translate(0 -6)")}${drops(3)}`;
      break;
    case "pouring":
      body = svg`${cloud("translate(0 -8)", true)}${drops(5, true)}`;
      break;
    case "snowy":
      body = svg`${cloud("translate(0 -6)")}${flakes(3)}`;
      break;
    case "snowy-rainy":
      body = svg`${cloud("translate(0 -6)")}${drops(2)}${flakes(2)}`;
      break;
    case "hail":
      body = svg`${cloud("translate(0 -8)", true)}${flakes(4, true)}`;
      break;
    case "lightning":
      body = svg`${cloud("translate(0 -10)", true)}${bolt}`;
      break;
    case "lightning-rainy":
      body = svg`${cloud("translate(0 -10)", true)}${drops(2, true)}${bolt}`;
      break;
    case "windy":
      body = wind;
      break;
    case "windy-variant":
      body = svg`${cloud("translate(10 -12) scale(.8)")}${wind}`;
      break;
    default:
      body = svg`<circle cx="50" cy="50" r="22" fill="none" stroke="#fff" stroke-width="4"/><path d="M50 38v15M50 59v3" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`;
  }
  return svg`<svg class="wi wi3d" viewBox="0 0 100 100" role="img" aria-label=${condition ?? ""}>${body}</svg>`;
}

/** mdi icon names HA uses for weather conditions. */
export function weatherMdi(condition: string | undefined, night = false): string {
  const map: Record<string, string> = {
    "clear-night": "mdi:weather-night",
    cloudy: "mdi:weather-cloudy",
    exceptional: "mdi:alert-circle-outline",
    fog: "mdi:weather-fog",
    hail: "mdi:weather-hail",
    lightning: "mdi:weather-lightning",
    "lightning-rainy": "mdi:weather-lightning-rainy",
    partlycloudy: night ? "mdi:weather-night-partly-cloudy" : "mdi:weather-partly-cloudy",
    pouring: "mdi:weather-pouring",
    rainy: "mdi:weather-rainy",
    snowy: "mdi:weather-snowy",
    "snowy-rainy": "mdi:weather-snowy-rainy",
    sunny: night ? "mdi:weather-night" : "mdi:weather-sunny",
    windy: "mdi:weather-windy",
    "windy-variant": "mdi:weather-windy-variant",
  };
  return map[condition ?? ""] ?? "mdi:weather-cloudy";
}

export const weather3dStyles = css`
  .wi3d {
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .animated .wi3d .halo {
    transform-origin: 50px 50px;
    animation: wr-halo 5s ease-in-out infinite;
  }
  .animated .wi3d .rays {
    transform-origin: 50px 50px;
    animation: wr-spin 60s linear infinite;
  }
  .animated .wi3d .cloud {
    animation: wr-drift 7s ease-in-out infinite;
  }
  .animated .wi3d .cloud.back {
    animation-duration: 9s;
    animation-direction: reverse;
  }
  .animated .wi3d .drop {
    animation: wr-fall 1.3s linear infinite;
  }
  .animated .wi3d .flake {
    animation: wr-snow 2.6s linear infinite;
  }
  .animated .wi3d .bolt {
    animation: wr-flash 3.2s ease-in-out infinite;
  }
  .animated .wi3d .fog {
    animation: wr-drift 5s ease-in-out infinite;
  }
  @keyframes wr-halo {
    50% {
      transform: scale(1.08);
      opacity: 0.85;
    }
  }
  @keyframes wr-flare {
    50% {
      opacity: 0.7;
      transform: scaleX(1.06);
    }
  }
  @keyframes wr-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes wr-drift {
    50% {
      transform: translateX(3px);
    }
  }
  @keyframes wr-fall {
    0% {
      transform: translateY(-4px);
      opacity: 0;
    }
    25% {
      opacity: 1;
    }
    100% {
      transform: translateY(9px);
      opacity: 0;
    }
  }
  @keyframes wr-snow {
    0% {
      transform: translate(0, -4px);
      opacity: 0;
    }
    30% {
      opacity: 1;
    }
    100% {
      transform: translate(3px, 8px);
      opacity: 0;
    }
  }
  @keyframes wr-flash {
    0%,
    60%,
    100% {
      opacity: 1;
    }
    64%,
    70% {
      opacity: 0.25;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .animated .wi3d * {
      animation: none !important;
    }
  }
`;
