// Minimal subset of the Home Assistant frontend types the cards rely on.
// Kept small on purpose so cards stay decoupled from HA internals.

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
  last_updated: string;
}

export type HassEntities = Record<string, HassEntity>;

export interface HassConnection {
  subscribeMessage<T>(callback: (msg: T) => void, msg: Record<string, unknown>): Promise<() => Promise<void>>;
}

export interface HomeAssistant {
  states: HassEntities;
  connection: HassConnection;
  language?: string;
  user?: { id: string; name?: string; is_admin?: boolean };
  locale?: { language: string; number_format?: string; time_format?: string };
  themes?: { darkMode?: boolean; themes?: Record<string, Record<string, any>> };
  config?: { time_zone?: string; unit_system?: { temperature?: string }; latitude?: number; longitude?: number };
  callService(domain: string, service: string, data?: Record<string, unknown>, target?: Record<string, unknown>): Promise<unknown>;
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
  callApi?<T>(method: "GET" | "POST", path: string, data?: Record<string, unknown>): Promise<T>;
  formatEntityState?(stateObj: HassEntity, state?: string): string;
  localize?(key: string, ...args: unknown[]): string;
}

export interface ActionConfig {
  action: string;
  [key: string]: any;
}

/** none = no glass at all: no fill, border, shadow or blur – just the content. */
/** light: frosted look from a pre-blurred wallpaper, no live blur; solid: opaque, nothing to compose. */
export type GlassMode = "auto" | "liquid" | "frosted" | "light" | "flat" | "solid" | "none" | "home";

export interface BaseCardConfig {
  type: string;
  glass?: GlassMode;
  view_layout?: Record<string, any>;
  /** The night look: any of the settings again, used while it is dark (core/night). */
  dark?: Record<string, any>;
  [key: string]: any;
}

/** Placement hints a container (panel / dashboard) reads from a child config. */
export interface ChildLayout {
  grow?: number;
  shrink?: number;
  basis?: string;
  align?: "start" | "center" | "end" | "stretch";
  span?: number;
  row_span?: number;
  /** Own height, e.g. `auto` for a panel that should only be as tall as its content in a column. */
  height?: string;
  /** Own width in a column, e.g. "50%" or "240px" (in a row: `basis`). */
  width?: string;
  /** Margin, e.g. "0 11px" to inset a card from the panel's edges. */
  margin?: string | number;
  /** Visual order inside the container (CSS order), e.g. per mode via `responsive`. */
  order?: number;
  /** Stacking above later siblings (a drop-down over the next card). */
  z_index?: number;
  /** CSS inside the card's shadow root (a third-party card's own background, …). */
  shadow_css?: string;
  /** A tap anywhere on the card picks `id` in `group` – panel cards show for it (visibility `condition: select`). */
  select?: { group: string; id: string };
}
