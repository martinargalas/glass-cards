// Stand-ins for the HA frontend elements the cards use, for a page without HA:
// <ha-icon> draws Material Design Icons fetched one by one from the CDN (cached).
const cache = new Map<string, Promise<string>>();
const CDN = "https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/";

function path(icon: string): Promise<string> {
  const name = (icon || "mdi:help-circle-outline").replace(/^mdi:/, "");
  let p = cache.get(name);
  if (!p) {
    p = fetch(`${CDN}${name}.svg`)
      .then((r) => (r.ok ? r.text() : ""))
      .then((svg) => svg.match(/ d="([^"]+)"/)?.[1] ?? "")
      .catch(() => "");
    cache.set(name, p);
  }
  return p;
}

class HaIcon extends HTMLElement {
  static observedAttributes = ["icon"];
  private _icon = "";
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML =
      `<style>:host{display:inline-flex;width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px);vertical-align:middle}svg{width:100%;height:100%;fill:currentColor}</style><svg viewBox="0 0 24 24"><path/></svg>`;
  }
  set icon(v: string) {
    if (v === this._icon) return;
    this._icon = v;
    const want = v;
    void path(v).then((d) => {
      if (this._icon === want) this.shadowRoot!.querySelector("path")!.setAttribute("d", d);
    });
  }
  get icon() {
    return this._icon;
  }
  attributeChangedCallback(_n: string, _o: string, v: string) {
    this.icon = v;
  }
}
customElements.define("ha-icon", HaIcon);

const DOMAIN_ICONS: Record<string, string> = {
  light: "mdi:lightbulb",
  switch: "mdi:toggle-switch",
  media_player: "mdi:cast",
  cover: "mdi:window-shutter",
  climate: "mdi:thermostat",
  sensor: "mdi:eye",
};
class HaStateIcon extends HaIcon {
  set stateObj(s: { entity_id: string; attributes?: { icon?: string } }) {
    this.icon = s.attributes?.icon ?? DOMAIN_ICONS[s.entity_id.split(".")[0]] ?? "mdi:eye";
  }
  set hass(_h: unknown) {}
}
customElements.define("ha-state-icon", HaStateIcon);
