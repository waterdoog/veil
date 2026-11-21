import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import type { AiBackend } from "./ai/backend";
import { initFirebase, isConfigured, loadRuntimeConfig, RC_DEFAULTS, watchUser, type RuntimeConfig } from "./firebase";
import "./styles.css";

// The simulated backend exists only in `vite dev` (import.meta.env.DEV is false in production builds,
// so this branch and its import are removed from the bundle).
const simulated = import.meta.env.DEV && new URLSearchParams(location.search).has("sim");

function Root() {
  const [backend, setBackend] = useState<AiBackend | null>(null);
  const [cfg, setCfg] = useState<RuntimeConfig>(RC_DEFAULTS);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let off = () => {};
    (async () => {
      if (simulated) {
        const [{ SimBackend }, { allAnswerKeys }] = await Promise.all([import("./ai/sim"), import("./sample")]);
        setBackend(new SimBackend(allAnswerKeys()));
        return;
      }
      if (!isConfigured) return;
      initFirebase();
      off = watchUser((u) => setUserId(u?.uid ?? null));
      const c = await loadRuntimeConfig();
      setCfg(c);
      const { FirebaseBackend } = await import("./ai/backend");
      setBackend(new FirebaseBackend(c.cloudModel));
    })();
    return () => off();
  }, []);

  return <App backend={backend} cfg={cfg} userId={userId} configured={isConfigured} simulated={simulated} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
