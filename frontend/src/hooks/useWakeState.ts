import { useSyncExternalStore } from "react";
import { wakeStore, type WakeState } from "@/lib/api/wake";

/** Live "waking up the server" state from the API client. */
export function useWakeState(): WakeState {
  return useSyncExternalStore(wakeStore.subscribe, wakeStore.get, wakeStore.get);
}
