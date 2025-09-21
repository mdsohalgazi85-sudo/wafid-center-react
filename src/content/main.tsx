import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const GLOBAL_FLAG = "__wafidCenterHelperReactLoaded";
const DEBUG_PREFIX = "[Wafid Center Helper]";

const debug = (...args: unknown[]) => {
  if (typeof console !== "undefined") {
    console.log(DEBUG_PREFIX, ...args);
  }
};

if (typeof window !== "undefined" && typeof (window as unknown as Record<string, unknown>).process === "undefined") {
  (window as unknown as Record<string, unknown>).process = {
    env: { NODE_ENV: "production" }
  } as unknown;
  debug("Injected minimal process.env shim for compatibility");
}

const mount = () => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  if ((window as unknown as Record<string, unknown>)[GLOBAL_FLAG]) {
    debug("Content script already mounted, skipping duplicate load");
    return;
  }

  (window as unknown as Record<string, unknown>)[GLOBAL_FLAG] = true;

  const container = document.createElement("div");
  container.id = "wch-root";
  document.body?.appendChild(container);

  try {
    const root = createRoot(container);
    root.render(<App />);
    debug("Content script mounted");
  } catch (error) {
    console.error(DEBUG_PREFIX, "Failed to mount content script", error);
  }
};

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      debug("DOMContentLoaded event received; mounting");
      mount();
    },
    { once: true }
  );
} else {
  mount();
  debug("DOMContentLoaded already fired; mounted immediately");
}
