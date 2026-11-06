import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { WakeBanner } from "./components/WakeBanner";
import { ApiError, isColdStartError } from "./lib/api/errors";
import { api } from "./lib/api/instance";
import { ThemeProvider } from "./theme/ThemeProvider";
import { ThemedToaster } from "./components/ThemedToaster";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429) return false;
        // The API client already retried a cold start for ~100 s; don't stack another loop on top.
        if (isColdStartError(err)) return count < 1;
        return count < 2;
      },
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
        <ThemedToaster />
        <WakeBanner />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);

// Start waking a sleeping free-tier API while the visitor reads the page or types their password.
api.warmUp();

// Service worker: static app shell only (see public/sw.js). Production builds only, so dev/HMR is unaffected.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
