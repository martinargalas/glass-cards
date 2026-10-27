# For developers: plugin API

Card packs of your own can build on the same base as the glass cards – the base class, the
styles, materials, actions and conditions – instead of shipping their own copies. Everything
is on `window.GlassCards` once the bundle has loaded:

```js
const { GlassElement, lit: { html, css }, registerCard, styles } = window.GlassCards;

class MyCard extends GlassElement {
  // the entities whose changes re-render the card
  watchedEntities(config) {
    return [config.entity];
  }
  render() {
    const st = this.hass.states[this._config.entity];
    return html`<div class="tile">${st?.state}</div>`;
  }
  static styles = [styles.tokens, styles.surface, css`.tile { padding: 16px; }`];
}

registerCard("glass-my-card", MyCard, { name: "My card", description: "What it shows." });
```

A pack that loads before Glass Cards can wait for it:

```js
window.addEventListener("glass-cards-ready", () => { /* … */ });
```

## What's there

| | |
| --- | --- |
| `GlassElement` | Base class: config, `hass` with change detection per watched entity, day / night, the card's parts (fonts, icons) |
| `lit` | `LitElement`, `html`, `css`, `svg`, `nothing` – the same Lit the cards use |
| `registerCard(tag, class, info)` | Defines the element and lists it in Home Assistant's card picker |
| `createCard(config)` | Creates any card (glass or not) from its config – for containers |
| `conditions` | `evalCondition`, `applyRules` – the [conditions](actions-and-conditions.md#conditions) |
| `format` | `displayText` (`{value}`, `{attr:…}`…), `computeValue` |
| `colors` | `cssColor` (HA colour names), `tint` |
| `actions` | `pressHandlers` (tap / hold / double tap), `runAction`, `withDefaults` |
| `styles` | `tokens`, `surface`, `control`, `animations` – the glass CSS |
| `LiquidController` | Liquid glass (WebGL refraction) on elements of your card |
| `settings` | The dashboard's current look and materials |
| `demo` | `hass(base?)`, `onChange(cb)`, `setState(id, state, attrs)` – the made-up demo home, e.g. for a page without Home Assistant |
| `version` | The bundle's version |
