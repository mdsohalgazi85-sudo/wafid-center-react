// background.ts — MV3 Service Worker (TypeScript)
/* eslint-disable no-console */

// -------- Types that match your bridge/content --------
type BridgeRequest = {
  type: "automation-run-row";
  requestId: string;
  index: number;
  row: unknown;
  timeoutMs?: number;
  receiverTabUrl?: string;
  autoCloseMs?: number; // optional: auto-close tab after this delay
};

type BridgeResponse = {
  type: "automation-result";
  requestId: string;
  ok: boolean;
  error?: string;
  _via?: string;
};

// -------- Small constants --------
const DEBUG_PREFIX = "[Wafid Center Helper]";
const DEFAULT_RECEIVER_URL = "https://wafid.com/book-appointment/";

// ====== Lifecycle logs ======
chrome.runtime.onInstalled.addListener((details) => {
  
  console.log(`${DEBUG_PREFIX} Installed`, details);
});

chrome.runtime.onStartup.addListener(() => {
  console.log(`${DEBUG_PREFIX} onStartup`);
});

// Optional: click on toolbar icon to wake worker & log
chrome.action?.onClicked?.addListener((tab) => {
  console.log(`${DEBUG_PREFIX} action clicked from`, tab?.url);
});

// ====== Core helper: open a tab, wait load, inject function ======
async function openAndInject(
  url: string,
  func: (row: any) => void,
  arg: any
): Promise<{ tabId: number }> {
  const created = await new Promise<chrome.tabs.Tab>((resolve, reject) => {
    chrome.tabs.create({ url }, (tab) => {
      const lastErr = chrome.runtime.lastError;
      if (lastErr || !tab || !tab.id) {
        reject(new Error(lastErr?.message || "Failed to open tab"));
      } else {
        console.log(`${DEBUG_PREFIX} created tab:`, tab);
        resolve(tab);
      }
    });
  });

  const tabId = created.id!;

  // Wait for tab to complete loading
  await new Promise<void>((resolve) => {
    const onUpdated = (updatedId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedId === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });

  // Inject the automation function
  await new Promise<void>((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        func,
        args: [arg] as [any],  // <-- correct tuple
      },
      () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      }
    );
  });

  return { tabId };
}

// ====== Main message router ======
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[BG] onMessage:", msg, "from", sender);

  // ---- Case 1: bridge-originated automation (roundtrip response expected) ----
  if (msg?.type === "automation-run-row") {
    const { requestId, row, receiverTabUrl, autoCloseMs } = msg as BridgeRequest;
    const url = receiverTabUrl || DEFAULT_RECEIVER_URL;

    (async () => {
      try {
        const { tabId } = await openAndInject(url, triggerAutomationInReceiverTab, row);

        // (Optional) auto-close the receiver tab after some delay if you want
        if (typeof autoCloseMs === "number" && autoCloseMs > 0) {
          setTimeout(() => {
            try {
              chrome.tabs.remove(tabId);
              console.log(`${DEBUG_PREFIX} closed receiver tab`, tabId);
            } catch (e) {
              console.warn(`${DEBUG_PREFIX} auto-close failed`, e);
            }
          }, autoCloseMs);
        }

        const res: BridgeResponse = {
          type: "automation-result",
          requestId,
          ok: true,
          _via: "background",
        };
        sendResponse(res);
      } catch (e: any) {
        console.error(`${DEBUG_PREFIX} automation-run-row failed:`, e);
        const res: BridgeResponse = {
          type: "automation-result",
          requestId,
          ok: false,
          error: String(e?.message || e),
          _via: "background",
        };
        sendResponse(res);
      }
    })();

    return true; // async response
  }

  // ---- Case 2: legacy API: trigger-automation-in-new-tab (fire-and-ack) ----
  if (msg?.type === "trigger-automation-in-new-tab") {
    const url: string = msg.receiverTabUrl || DEFAULT_RECEIVER_URL;
    const row = msg.row ?? {};

    (async () => {
      try {
        await openAndInject(url, triggerAutomationInReceiverTab, row);
        sendResponse({ ok: true });
      } catch (e: any) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();

    return true; // async response
  }

  // ---- Case 3: payment-found → post to backend ----
  if (msg?.type === "payment-found") {
    const payment = String(msg.payment || "");
    // TODO: replace with your real backend
    const backendUrl = "https://your-backend.example.com/api/payment";

    fetch(backendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Backend ${r.status}`);
        const data = await r.json().catch(() => ({}));
        sendResponse({ ok: true, data });
      })
      .catch((e) => {
        console.error("[BG] backend post failed:", e);
        sendResponse({ ok: false, error: String(e) });
      });

    return true; // async response
  }

  // Unknown message type—no-op
  return false;
});

// ====== The function we inject into the receiver tab ======
// Runs in the page's isolated world; has DOM access and can chrome.runtime.sendMessage back.
function triggerAutomationInReceiverTab(row: any) {
  console.log("[Receiver] automation start with row:", row);

  // Small helper to set input value and dispatch change events
  const setVal = (sel: string, val: string | undefined) => {
    if (!val) return;
    const el = document.querySelector<HTMLInputElement>(sel);
    if (!el) return;
    el.value = val;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  // TODO: map WAFID form selectors correctly for your page
  setVal("input[name='name']", (row as any)?.name);
  setVal("input[name='email']", (row as any)?.email);
  setVal("input[name='phone']", (row as any)?.phone);
  setVal("input[name='national_id']", (row as any)?.nationalId);
  setVal("input[name='passport']", (row as any)?.passport);
  setVal("input[name='city']", (row as any)?.city);
  setVal("input[name='country']", (row as any)?.country);
  setVal("input[name='appointment_date']", (row as any)?.appointmentDate);

  // Submit button
  const submitBtn =
    document.querySelector<HTMLButtonElement>("button[type='submit'], .btn-submit, [data-action='submit']");
  if (submitBtn) {
    submitBtn.click();
  } else {
    console.warn("[Receiver] submit button not found");
  }

  // Find payment id/url on the page
  const pickPayment = (): string | null => {
    const byAttr = document.querySelector<HTMLElement>("[data-payment-id]");
    if (byAttr) return byAttr.getAttribute("data-payment-id");

    const byId = document.querySelector<HTMLElement>("#paymentId, #payment, #payment-url");
    if (byId) return (byId.textContent || byId.getAttribute("href") || "").trim() || null;

    const link = document.querySelector<HTMLAnchorElement>(".payment a, a.payment, a[href*='payment']");
    if (link) return link.href;

    return null;
  };

  // If payment appears immediately
  const immediate = pickPayment();
  if (immediate) {
    try {
      chrome.runtime.sendMessage({ type: "payment-found", ok: true, payment: immediate });
    } catch (e) {
      console.warn("[Receiver] sendMessage failed:", e);
    }
    return;
  }

  // Observe DOM mutations until payment is detected
  const observer = new MutationObserver(() => {
    const p = pickPayment();
    if (p) {
      try {
        observer.disconnect();
      } catch {}
      try {
        chrome.runtime.sendMessage({ type: "payment-found", ok: true, payment: p });
      } catch (e) {
        console.warn("[Receiver] sendMessage failed:", e);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Safety timeout
  setTimeout(() => {
    try {
      observer.disconnect();
    } catch {}
    const p = pickPayment();
    if (p) {
      try {
        chrome.runtime.sendMessage({ type: "payment-found", ok: true, payment: p });
      } catch (e) {
        console.warn("[Receiver] sendMessage failed:", e);
      }
    } else {
      try {
        chrome.runtime.sendMessage({
          type: "payment-found",
          ok: false,
          error: "Payment info not found within timeout",
        });
      } catch (e) {
        console.warn("[Receiver] sendMessage failed:", e);
      }
    }
  }, 60_000);
}

// Make this a module file for MV3 type safety
export {};
