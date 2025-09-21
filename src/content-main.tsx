import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const GLOBAL_FLAG = "__wafidCenterHelperReactLoaded";
const DEBUG_PREFIX = "[Wafid Center Helper]";

const debug = (...args: unknown[]) => {
  if (typeof console !== "undefined") console.log(DEBUG_PREFIX, ...args);
};

if (typeof window !== "undefined" && typeof (window as any).process === "undefined") {
  (window as any).process = { env: { NODE_ENV: "production" } } as any;
  debug("Injected minimal process.env shim for compatibility");
}

const mount = () => {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if ((window as any)[GLOBAL_FLAG]) { debug("Already mounted"); return; }
  (window as any)[GLOBAL_FLAG] = true;

  const container = document.createElement("div");
  container.id = "wch-root";
  document.body?.appendChild(container);

  try {
    const root = createRoot(container);
    root.render(<App />);
    debug("Mounted");
  } catch (e) {
    console.error(DEBUG_PREFIX, "Failed to mount", e);
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => mount(), { once: true });
} else {
  mount();
}
