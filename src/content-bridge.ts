(() => {
  const allowedOrigins = new Set(["http://localhost:3000", "https://wafid.com"]);

  const requestType = "automation-run-row";
  const responseType = "automation-result";
  const defaultTimeout = 60000;

  const isAllowedOrigin = (origin: string) => allowedOrigins.size === 0 || allowedOrigins.has(origin);

  const pendingRequests = new Map();

  window.addEventListener("message", (event) => {
    try {
      console.log(!isAllowedOrigin(event.origin), 'all or')
      // if (!isAllowedOrigin(event.origin)) {
      //   console.warn("[BRIDGE] blocked origin:", event.origin);
      //   return;
      // }
      
      const data = event.data;
      
      console.log(data, 'data')
      if (!data || typeof data !== "object" || data.type !== requestType) return;
      const {
        type: _ignoredType,
        requestId,
        index,
        row,
        timeoutMs,
        receiverTabUrl,
        autoCloseMs,
        ...forwardExtras
      } = data as {
        type?: string;
        requestId?: string;
        index?: number;
        row?: unknown;
        timeoutMs?: number;
        receiverTabUrl?: string;
        autoCloseMs?: number;
        [key: string]: unknown;
      };
      
      if (!requestId || pendingRequests.has(requestId)) return;
      
      console.log(event, 'event')
      const timerId = setTimeout(() => {
        pendingRequests.delete(requestId);
        const timeoutResponse = {
          type: responseType,
          requestId,
          ok: false,
          error: "Timeout waiting for background response",
          _via: "content-bridge-timeout",
        };
        window.postMessage(timeoutResponse, event.origin);
      }, timeoutMs ?? defaultTimeout);

      pendingRequests.set(requestId, { origin: event.origin, timerId });

      const bridgeRequest = {
        type: requestType,
        requestId,
        index,
        row,
        receiverTabUrl,
        autoCloseMs,
        ...forwardExtras,
      };

      chrome.runtime.sendMessage(bridgeRequest, (response) => {
            console.log(response, 'bridgeRequest')
        const lastError = chrome.runtime?.lastError;
        const requestEntry = pendingRequests.get(requestId);
        if (!requestEntry) return;

        clearTimeout(requestEntry.timerId);
        pendingRequests.delete(requestId);

        const payload = response && typeof response === "object"
          ? { ...response, _via: "content-bridge" }
          : {
              type: responseType,
              requestId,
              ok: !lastError,
              error: lastError?.message ?? (response == null ? "No response" : undefined),
              _via: "content-bridge",
            };

        try {
          window.postMessage(payload, requestEntry.origin);
        } catch (error) {
          console.error("[BRIDGE] postMessage back failed:", error);
        }
      });
    } catch (error) {
      try {
        const requestId = event?.data?.requestId ?? `req_${Date.now()}`;
        const errorPayload = {
          type: responseType,
          requestId,
          ok: false,
          error: String(error),
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
  } catch (error) {
    console.warn("[BRIDGE] bridge-ready post failed:", error);
  }
})();
