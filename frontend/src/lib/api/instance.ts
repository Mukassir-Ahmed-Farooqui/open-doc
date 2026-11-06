import { ApiClient } from "./client";
import { tokenStore } from "@/auth/tokenStore";

/** App-wide client. Reads the token per request; a 401 clears the session. */
export const api = new ApiClient({
  getToken: () => tokenStore.get(),
  onUnauthorized: () => tokenStore.clear("expired"),
  // Unit tests mock fetch and assert single calls; the cold-start backoff would only slow them down.
  retry: import.meta.env.MODE === "test" ? false : undefined,
});
