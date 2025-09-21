type BridgeRequest = {
  type: "automation-run-row";
  requestId: string;
  index: number;
  row: unknown;
  timeoutMs?: number;
};

type BridgeResponse = {
  type: "automation-result";
  requestId: string;
  ok: boolean;
  error?: string;
  _via?: string;
};

(() => {
  const ALLOWED_ORIGINS = new Set<string>([
    "http://localhost:3000", // Allowed origins for the message
  ]);

  const REQ_TYPE = "automation-run-row";
  const RES_TYPE = "automation-result";
  const DEFAULT_TIMEOUT = 60_000;

  const isAllowedOrigin = (origin: string) =>
    ALLOWED_ORIGINS.size === 0 || ALLOWED_ORIGINS.has(origin);

  const pending = new Map<
    string,
    { origin: string; timerId: ReturnType<typeof setTimeout> }
  >();

  console.log("[BRIDGE] loaded on", location.origin);

  window.addEventListener("message", (event: MessageEvent) => {
    console.log("[BRIDGE] window.message", {
      origin: event.origin,
      data: event.data,
    });

    try {
      if (!isAllowedOrigin(event.origin)) {
        console.warn("[BRIDGE] blocked origin:", event.origin);
        return;
      }

      const data = event.data as BridgeRequest;
      if (!data || typeof data !== "object") return;
      if (data.type !== REQ_TYPE) return;

      const { requestId, index, row, timeoutMs } = data;
      if (!requestId) return;
      if (pending.has(requestId)) return;

      const timerId = setTimeout(() => {
        pending.delete(requestId);
        const payload: BridgeResponse = {
          type: RES_TYPE,
          requestId,
          ok: false,
          error: "Timeout waiting for background response",
          _via: "content-bridge-timeout",
        };
        try {
          window.postMessage(payload, event.origin);
        } catch (e) {
          console.error("[BRIDGE] postMessage timeout notify failed:", e);
        }
      }, timeoutMs ?? DEFAULT_TIMEOUT);

      pending.set(requestId, { origin: event.origin, timerId });

      chrome.runtime.sendMessage(
        { type: REQ_TYPE, requestId, index, row },
        (res?: BridgeResponse) => {
          const lastErr = chrome.runtime?.lastError;
          const entry = pending.get(requestId);
          if (!entry) return;

          clearTimeout(entry.timerId);
          pending.delete(requestId);

          const payload: BridgeResponse =
            res && typeof res === "object"
              ? { ...res, _via: "content-bridge" }
              : {
                  type: RES_TYPE,
                  requestId,
                  ok: !lastErr,
                  error:
                    lastErr?.message ??
                    (res == null ? "No response" : undefined),
                  _via: "content-bridge",
                };

          try {
            console.log("[BRIDGE] posting back to page:", payload);
            window.postMessage(payload, entry.origin);
          } catch (e) {
            console.error("[BRIDGE] postMessage back failed:", e);
          }
        }
      );
    } catch (err) {
      try {
        const reqId =
          (event?.data as BridgeRequest)?.requestId ?? `req_${Date.now()}`;
        const errorPayload: BridgeResponse = {
          type: RES_TYPE,
          requestId: reqId,
          ok: false,
          error: String(err),
          _via: "content-bridge-catch",
        };
        console.error("[BRIDGE] exception:", errorPayload);
        window.postMessage(errorPayload, event.origin || "*");
      } catch (e) {
        console.error("[BRIDGE] exception notify failed:", e);
      }
    }
  });

  try {
    window.postMessage({ type: "bridge-ready", at: Date.now() }, "*");
  } catch (e) {
    console.warn("[BRIDGE] bridge-ready post failed:", e);
  }
})();
