import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Shell } from "./components/Shell";
import { registerServiceWorker } from "./lib/push";
import "./styles.css";

registerServiceWorker();

// A tab left open across a reinstall still runs the previous build, whose lazy pages were deleted: load the new
// build instead of a blank page. Once per minute at most, so a page that really fails to load cannot loop.
const RELOADED_AT = "jarvis-reloaded-at";
window.addEventListener("vite:preloadError", (event) => {
  const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
  if (Date.now() - last < 60_000) return;
  event.preventDefault();
  sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  window.location.reload();
});

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <Shell />
    </QueryClientProvider>
  </StrictMode>,
);
