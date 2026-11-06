/**
 * "Waking up the server" signal. The hosted API runs on a free tier that sleeps after ~15 min idle and
 * takes about a minute to start again. While a request is slow or being retried, the UI shows a calm
 * waking state instead of an error. Plain module store (no React) so the API client can drive it.
 */
export interface WakeState {
  /** True while at least one request is slow (> SLOW_MS) or waiting to retry. */
  waking: boolean;
  /** When the current waking period started (ms epoch), or null. */
  since: number | null;
  /** Retry attempts made during the current waking period. */
  attempts: number;
}

type Listener = (s: WakeState) => void;

/** A request pending longer than this flips the UI into the waking state. */
export const SLOW_MS = 4000;

let state: WakeState = { waking: false, since: null, attempts: 0 };
const listeners = new Set<Listener>();
const slow = new Set<symbol>();

function emit(next: WakeState) {
  state = next;
  listeners.forEach((l) => l(state));
}

function begin() {
  if (!state.waking) emit({ waking: true, since: Date.now(), attempts: state.attempts });
}

export const wakeStore = {
  get: () => state,
  subscribe(l: Listener) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  /** Track one in-flight request; flips to waking if it is still pending after SLOW_MS. */
  track(): { done: (ok: boolean) => void } {
    const id = Symbol("req");
    const timer = setTimeout(() => {
      slow.add(id);
      begin();
    }, SLOW_MS);
    return {
      done(ok) {
        clearTimeout(timer);
        slow.delete(id);
        if (ok) wakeStore.awake();
      },
    };
  },
  /** A retry is about to be scheduled because the server didn't answer. */
  retrying() {
    begin();
    emit({ ...state, attempts: state.attempts + 1 });
  },
  /** Any successful response means the server is up. */
  awake() {
    if (state.waking || state.attempts) emit({ waking: false, since: null, attempts: 0 });
  },
  /** Test helper. */
  reset() {
    slow.clear();
    emit({ waking: false, since: null, attempts: 0 });
  },
};

export interface RetryPolicy {
  /** Max attempts including the first. */
  attempts: number;
  /** Delay before retry n (1-based), in ms. */
  delay: (n: number) => number;
  /** Give up once this much time has passed since the first attempt. */
  budgetMs: number;
}

/** About 100 s of retries with backoff: long enough for a free-tier cold start (~60 s). */
export const COLD_START_POLICY: RetryPolicy = {
  attempts: 8,
  delay: (n) => Math.min(10_000, 1000 * 2 ** (n - 1)) + Math.floor(Math.random() * 400),
  budgetMs: 100_000,
};

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
