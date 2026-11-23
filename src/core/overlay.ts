/**
 * Where a card's copy over the whole page goes (Alarm ringing, the calendar's large view): an open
 * dialog the card is in – Dashboard Studio, HA's card editor; they sit in the browser's top layer,
 * over anything in the page – else the page itself.
 */
export function layerFor(el: Element): Element {
  let n: Node | null = el;
  for (let i = 0; n && i < 60; i++) {
    if ((n as Element).localName === "dialog" && (n as HTMLDialogElement).open) return n as Element;
    n = (n as Element).parentNode ?? ((n as unknown as ShadowRoot).host ?? null);
  }
  return document.body;
}

/** Inside an editor: HA's card dialog or Glass Dashboard Studio. */
export function inEditor(el: Element): boolean {
  let n: Node | null = el;
  for (let i = 0; n && i < 60; i++) {
    const name = (n as Element).localName;
    if (name === "hui-card-preview" || name === "hui-dialog-edit-card" || name === "hui-card-element-editor" || name === "glass-studio" || name === "hui-card-picker") return true;
    n = (n as Element).parentNode ?? ((n as unknown as ShadowRoot).host ?? null);
  }
  return false;
}
