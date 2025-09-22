(() => {
  const allowedOrigins = new Set(["http://localhost:3000", "https://wafid.com"]);

  const requestType = "automation-run-row";
  const responseType = "automation-result";
  const defaultTimeout = 60000;

  const isAllowedOrigin = (origin: string) => allowedOrigins.size === 0 || allowedOrigins.has(origin);

  const pendingRequests = new Map();

window.addEventListener("message", (event) => {
  try {
    // console.log("Received message event:", event);

    const data = event.data;

    // // Handle different request types
    // const isInvalidData =
    //   !data ||
    //   typeof data !== "object" ||
    //   data === null ||
    //   !(data.type === requestType || data.type === "trigger-automation-in-new-tab");

    // console.log("Invalid data check (should be false if valid):", isInvalidData);
    // console.log("Data received:", data);
    // console.log("Is data an object?:", typeof data === "object" && data !== null);
    // console.log("Expected request type:", requestType);
    // console.log("Does data.type match requestType or 'trigger-automation-in-new-tab'?:", data.type);

    // if (isInvalidData) {
    //   console.warn("Invalid data format or type mismatch. Ignoring message.");
    //   return; // If the data is invalid, exit early
    // }

    // Proceed with the logic for valid data
    const { requestId, index, row, timeoutMs } = data;

    // Ensure requestId is present and requestId is not already pending
    if (!requestId || pendingRequests.has(requestId)) {
      console.warn("Invalid or duplicate requestId:", requestId);
      return; // If no requestId or requestId is already pending, exit early
    }

    // Set a timeout for the response
    const timerId = setTimeout(() => {
      pendingRequests.delete(requestId);
      const timeoutResponse = {
        type: responseType,
        requestId,
        ok: false,
        error: "Timeout waiting for background response",
        _via: "content-bridge-timeout",
      };
      try {
        window.postMessage(timeoutResponse, event.origin);
      } catch (error) {
        console.error("[BRIDGE] postMessage timeout notify failed:", error);
      }
    }, timeoutMs ?? defaultTimeout);

    // Store the pending request
    pendingRequests.set(requestId, { origin: event.origin, timerId });

    // Send the message to the background script (via chrome.runtime.sendMessage)
    chrome.runtime.sendMessage(
      { type: data.type, requestId, index, row },
      (response) => {
        const lastError = chrome.runtime?.lastError;
        const requestEntry = pendingRequests.get(requestId);
        if (!requestEntry) return;

        clearTimeout(requestEntry.timerId);
        pendingRequests.delete(requestId);

        // Prepare the response to send back to the content script
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
      }
    );
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
