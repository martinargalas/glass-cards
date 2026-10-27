/**
 * A choice shared between cards on one screen (e.g. the appliance list picks what a
 * panel shows). Kept per browser tab only – nothing is stored in Home Assistant.
 */
const EVENT = "glass-select";
const key = (group: string) => `glass-select:${group}`;

/** What each group shows until something is picked (a picker's `default` / `picked_first`). */
const defaults = new Map<string, string>();

function stored(group: string): string | null {
  try {
    return sessionStorage.getItem(key(group));
  } catch {
    return null;
  }
}

export function getSelected(group: string, fallback?: string): string | undefined {
  return stored(group) ?? fallback ?? defaults.get(group);
}

/** The group's choice until one is picked: cards that rendered before it hear it too. */
export function setDefault(group: string, id: string) {
  if (defaults.get(group) === id) return;
  defaults.set(group, id);
  if (stored(group) === null) window.dispatchEvent(new CustomEvent(EVENT, { detail: { group, id } }));
}

export function setSelected(group: string, id: string) {
  try {
    sessionStorage.setItem(key(group), id);
  } catch {
    /* private mode: the event below still updates the cards on screen */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { group, id } }));
}

/** Calls `fn` whenever anything in any group is selected; returns the unsubscribe. */
export function onAnySelected(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

/** Calls `fn` whenever something in `group` is selected; returns the unsubscribe. */
export function onSelected(group: string, fn: (id: string) => void): () => void {
  const h = (e: Event) => {
    const d = (e as CustomEvent).detail;
    if (d?.group === group) fn(d.id);
  };
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}
