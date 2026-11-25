/**
 * A search typed in one card (a pop-up header's search field), heard by the cards beside it
 * (the media library in the same pop-up). The scope is the Bubble Card pop-up both sit in;
 * cards outside any pop-up share one scope of their own.
 */
const GLOBAL = {};
const last = new WeakMap<object, string>();
export const searchBus = new EventTarget();

/** The pop-up a card sits in (across shadow roots), else the dashboard's shared scope. */
export function searchScope(el: Element): object {
  let n: Node | null = el;
  for (let i = 0; i < 40 && n; i++) {
    n = (n as Element).parentElement ?? ((n.getRootNode() as ShadowRoot).host as Node | undefined) ?? null;
    if (n && (n as Element).tagName === "BUBBLE-CARD") return n;
  }
  return GLOBAL;
}

export interface SearchDetail {
  scope: object;
  text: string;
}

export function sendSearch(from: Element, text: string) {
  const scope = searchScope(from);
  last.set(scope, text);
  searchBus.dispatchEvent(new CustomEvent<SearchDetail>("search", { detail: { scope, text } }));
}

/** What was last typed where this card sits (for a card that shows up after the typing). */
export function lastSearch(el: Element): string {
  return last.get(searchScope(el)) ?? "";
}
