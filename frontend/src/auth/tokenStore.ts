const KEY = "opendoc.session";

interface Session {
  token: string;
  expiresAt: number;
}

type Reason = "logout" | "expired";
type Listener = (token: string | null, reason?: Reason) => void;

const listeners = new Set<Listener>();

function read(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s.token || typeof s.expiresAt !== "number") return null;
    if (Date.now() >= s.expiresAt) {
      localStorage.removeItem(KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

/** JWT session storage with expiry (from the login response's expires_in). */
export const tokenStore = {
  get(): string | null {
    return read()?.token ?? null;
  },
  expiresAt(): number | null {
    return read()?.expiresAt ?? null;
  },
  set(token: string, expiresInSeconds: number) {
    const session: Session = { token, expiresAt: Date.now() + expiresInSeconds * 1000 };
    localStorage.setItem(KEY, JSON.stringify(session));
    listeners.forEach((l) => l(token));
  },
  clear(reason: Reason = "logout") {
    const had = localStorage.getItem(KEY) !== null;
    localStorage.removeItem(KEY);
    if (had) listeners.forEach((l) => l(null, reason));
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
