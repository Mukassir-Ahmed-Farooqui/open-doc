import { ApiClient } from "./client";
import { tokenStore } from "@/auth/tokenStore";

/** App-wide client. Reads the token per request; a 401 clears the session. */
export const api = new ApiClient({
  getToken: () => tokenStore.get(),
  onUnauthorized: () => tokenStore.clear("expired"),
});
