/**
 * Music Assistant's own API, for what Home Assistant doesn't pass on (its recommendations: the rows of
 * its home – your mixes, top picks…). One websocket per server and token, shared by the cards, opened
 * when first needed and logged in with a token made in Music Assistant (Settings → profile).
 *
 * The browser talks to Music Assistant itself: a dashboard on https can't reach a server on plain http.
 */

interface Waiting {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  partial: any[];
  timer: number;
}

class MaConnection {
  private ws?: WebSocket;
  private ready?: Promise<void>;
  private next = 1;
  private waiting = new Map<string, Waiting>();

  constructor(
    private url: string,
    private token: string,
  ) {}

  private open(): Promise<void> {
    if (this.ready && this.ws && this.ws.readyState <= WebSocket.OPEN) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${this.url.replace(/^http/, "ws").replace(/\/$/, "")}/ws`);
      this.ws = ws;
      let authed = false;
      const fail = (msg: string) => {
        reject(new Error(msg));
        for (const w of this.waiting.values()) (clearTimeout(w.timer), w.reject(new Error(msg)));
        this.waiting.clear();
        this.ready = undefined;
      };
      const timer = window.setTimeout(() => (ws.close(), fail("Music Assistant: no answer")), 8000);
      ws.onmessage = (e) => {
        let m: any;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        // the first message: the server's info – then the login
        if (!authed && m.server_id && !m.message_id) {
          ws.send(JSON.stringify({ message_id: "auth", command: "auth", args: { token: this.token } }));
          return;
        }
        if (m.message_id === "auth") {
          clearTimeout(timer);
          if (m.error_code) {
            ws.close();
            fail(`Music Assistant: ${m.details ?? "login failed"}`);
          } else {
            authed = true;
            resolve();
          }
          return;
        }
        const w = m.message_id !== undefined ? this.waiting.get(String(m.message_id)) : undefined;
        if (!w) return;
        if (m.error_code) {
          clearTimeout(w.timer);
          this.waiting.delete(String(m.message_id));
          w.reject(new Error(m.details ?? `error ${m.error_code}`));
        } else if (m.partial) w.partial.push(...(m.result ?? []));
        else {
          clearTimeout(w.timer);
          this.waiting.delete(String(m.message_id));
          w.resolve(w.partial.length ? [...w.partial, ...(m.result ?? [])] : m.result);
        }
      };
      ws.onerror = () => (clearTimeout(timer), fail("Music Assistant: can't connect"));
      ws.onclose = () => {
        clearTimeout(timer);
        if (this.ws === ws) this.ws = undefined;
        this.ready = undefined;
        for (const w of this.waiting.values()) (clearTimeout(w.timer), w.reject(new Error("Music Assistant: disconnected")));
        this.waiting.clear();
      };
    });
    return this.ready;
  }

  async command<T = any>(command: string, args?: Record<string, unknown>, timeout = 20000): Promise<T> {
    await this.open();
    const id = String(this.next++);
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`Music Assistant: ${command} timed out`));
      }, timeout);
      this.waiting.set(id, { resolve, reject, partial: [], timer });
      this.ws!.send(JSON.stringify({ message_id: id, command, ...(args ? { args } : {}) }));
    });
  }
}

const connections = new Map<string, MaConnection>();

/** A command to Music Assistant (its result), over the shared connection for this server and token. */
export function maCommand<T = any>(url: string, token: string, command: string, args?: Record<string, unknown>): Promise<T> {
  // the demo's own Music Assistant (no server behind it): only its reserved address (.invalid never resolves)
  const demo = (globalThis as { __glassMaDemo?: (c: string, a?: Record<string, unknown>) => unknown }).__glassMaDemo;
  if (demo && /^https?:\/\/[^/]*\.demo\.invalid(:\d+)?\/?$/.test(url)) return Promise.resolve(demo(command, args) as T);
  const key = `${url}|${token}`;
  let c = connections.get(key);
  if (!c) connections.set(key, (c = new MaConnection(url, token)));
  return c.command<T>(command, args);
}

/** A picture of a Music Assistant item: its URL, or through Music Assistant's image proxy. */
export function maImage(url: string, item: any): string | undefined {
  const imgs: any[] = [item?.image, ...(item?.metadata?.images ?? [])].filter(Boolean);
  const img = imgs.find((i) => i.type === "thumb") ?? imgs[0];
  if (!img?.path) return undefined;
  if (/^https?:\/\//.test(img.path) && img.remotely_accessible !== false) return img.path;
  // a picture only Music Assistant can read (a file's embedded cover): its image proxy, by the id it gave
  return img.proxy_id ? `${url.replace(/\/$/, "")}/imageproxy/${img.proxy_id}?size=256` : undefined;
}

const kinds = new Map<string, { at: number; p: Promise<Map<string, string>> }>();

/** Music Assistant's players: each one's provider (for a universal player: the protocol it plays
 *  by), by its player id – which is the unique id of its entity in Home Assistant. Kept 5 minutes. */
export function maPlayerProviders(url: string, token: string): Promise<Map<string, string>> {
  const key = `${url}|${token}`;
  const got = kinds.get(key);
  if (got && Date.now() - got.at < 300000) return got.p;
  const p = maCommand<any[]>(url, token, "players/all").then((list) => {
    const m = new Map<string, string>();
    for (const pl of list ?? []) {
      let prov: string = pl.provider;
      if (prov === "universal_player") {
        const protos: any[] = (pl.output_protocols ?? []).filter((o: any) => o?.protocol_domain);
        const best = protos.filter((o) => o.available !== false).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))[0] ?? protos[0];
        prov = best?.protocol_domain ?? prov;
      }
      m.set(String(pl.player_id), prov);
    }
    return m;
  });
  p.catch(() => kinds.delete(key));
  kinds.set(key, { at: Date.now(), p });
  return p;
}
