import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { CENTER_GROUPS, type Center } from "./centers";

const SELECTOR_PREFERENCES = [
  'select[id*="center"]',
  'select[name*="center"]',
  'select[id*="medical"]',
  'select[name*="medical"]',
  'select[id*="clinic"]',
  'select[name*="clinic"]'
];

const GROUP_ATTR = "data-wch-group";
const OPTION_ATTR = "data-wch-option";
const CHANGE_EVENTS: Array<keyof DocumentEventMap> = ["input", "change"];
const DEBUG_PREFIX = "[Wafid Center Helper]";
const SUPPORTED_PATH_PREFIXES = ["/appointment", "/book-appointment"];

const debug = (...args: unknown[]) => {
  if (typeof console !== "undefined") {
    console.log(DEBUG_PREFIX, ...args);
  }
};

const ensureBangladeshManualOverride = () => {
  if (typeof window === "undefined") {
    return false;
  }

  let updated = false;
  const globals = window as unknown as Record<string, unknown>;

  const normalize = (value: unknown) => (Array.isArray(value) ? value : null);

  let manual = normalize(globals.MANUAL_MEDICAL_CENTER_COUNTRIES);
  if (!manual) {
    manual = [];
    (globals as Record<string, unknown>).MANUAL_MEDICAL_CENTER_COUNTRIES = manual;
    debug("Initialized MANUAL_MEDICAL_CENTER_COUNTRIES array");
    updated = true;
  }
  if (manual && !manual.includes("BD")) {
    manual.push("BD");
    debug("Added BD to MANUAL_MEDICAL_CENTER_COUNTRIES", manual);
    updated = true;
  }

  let free = normalize(globals.FREE_MEDICAL_CENTER_COUNTRIES);
  if (!free) {
    free = [];
    (globals as Record<string, unknown>).FREE_MEDICAL_CENTER_COUNTRIES = free;
    debug("Initialized FREE_MEDICAL_CENTER_COUNTRIES array");
  }
  if (free) {
    const filtered = free.filter((code) => code !== "BD" && code !== "Bangladesh" && code !== "bd");
    if (filtered.length !== free.length) {
      free.splice(0, free.length, ...filtered);
      debug("Removed BD from FREE_MEDICAL_CENTER_COUNTRIES", filtered);
      updated = true;
    }
  }

  debug("Bangladesh override check", {
    updated,
    manual: normalize(globals.MANUAL_MEDICAL_CENTER_COUNTRIES),
    free: normalize(globals.FREE_MEDICAL_CENTER_COUNTRIES),
  });

  if (updated) {
    debug("Bangladesh override applied", {
      manual: normalize(globals.MANUAL_MEDICAL_CENTER_COUNTRIES),
      free: normalize(globals.FREE_MEDICAL_CENTER_COUNTRIES),
    });
  }

  return updated;
};

const computeCityPanelCenters = (): Center[] => {
  if (typeof window === "undefined") {
    return [];
  }

  const citySelect = document.getElementById("id_city") as HTMLSelectElement | null;
  const destinationSelect = document.getElementById("id_traveled_country") as HTMLSelectElement | null;
  const appointmentTypeRadio = document.querySelector(
    'input[name="appointment_type"]:checked'
  ) as HTMLInputElement | null;

  const cityValue = citySelect?.value?.trim();
  const destinationValue = destinationSelect?.value?.trim();
  if (!cityValue || !destinationValue) {
    return [];
  }

  const globals = window as unknown as Record<string, unknown>;
  const datasetKey = appointmentTypeRadio?.value === "premium"
    ? "CITY_PREMIUM_MEDICAL_CENTERS"
    : "CITY_MEDICAL_CENTERS";

  const dataset = (globals[datasetKey] as Record<string, unknown> | undefined) ?? undefined;
  if (!dataset) {
    return [];
  }

  const rawEntries = dataset[cityValue] as unknown;
  if (!Array.isArray(rawEntries)) {
    return [];
  }

  const normalizedDestination = destinationValue.toUpperCase();
  const unique = new Map<string, string>();

  rawEntries.forEach((entry) => {
    if (!Array.isArray(entry) || entry.length < 4) {
      return;
    }

    const value = entry[0];
    const label = entry[1];
    const entryDestination = String(entry[3] ?? "").toUpperCase();

    if (entryDestination !== normalizedDestination) {
      return;
    }

    const valueString = value === undefined || value === null ? "" : String(value);
    if (!valueString) {
      return;
    }

    if (typeof label !== "string") {
      return;
    }

    if (!unique.has(valueString)) {
      unique.set(valueString, label);
    }
  });

  return Array.from(unique.entries()).map(([value, name]) => ({ value, name }));
};

const describeSelect = (select: HTMLSelectElement | null) => {
  if (!select) {
    return { id: null, name: null, optionCount: 0 };
  }
  return {
    id: select.id || null,
    name: select.name || null,
    optionCount: select.options.length,
  };
};

const inSupportedContext = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  const { hostname, pathname } = window.location;
  return hostname === "wafid.com" && SUPPORTED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
};

const scoreSelect = (select: HTMLSelectElement): number => {
  if (!select || select.disabled) {
    return 0;
  }

  const tokens = `${select.id || ""} ${select.name || ""}`.toLowerCase();
  let score = 0;

  if (tokens.includes("center")) score += 5;
  if (tokens.includes("medical")) score += 3;
  if (tokens.includes("clinic")) score += 2;

  const options = Array.from(select.options || []);
  const numericOptions = options.filter((opt) => /^(\d{3,})$/.test(opt.value.trim())).length;
  if (numericOptions > 5) {
    score += 3;
  } else if (numericOptions > 0) {
    score += 1;
  }

  if (options.length > 30) {
    score += 1;
  }

  const style = window.getComputedStyle(select);
  if (style.display === "none" || style.visibility === "hidden") {
    score -= 2;
  }

  const rect = select.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 10) {
    score -= 1;
  }

  return score;
};

const collectCenterSelects = (): HTMLSelectElement[] => {
  const seen = new Set<HTMLSelectElement>();

  SELECTOR_PREFERENCES.forEach((selector) => {
    document.querySelectorAll<HTMLSelectElement>(selector).forEach((select) => {
      if (!seen.has(select)) {
        seen.add(select);
      }
    });
  });

  document
    .querySelectorAll<HTMLSelectElement>('select[name="medical_center"], select[name="premium_medical_center"]')
    .forEach((select) => {
      if (!seen.has(select)) {
        seen.add(select);
      }
    });

  return Array.from(seen);
};

const findCenterSelect = (): HTMLSelectElement | null => {
  const candidates = collectCenterSelects();
  if (!candidates.length) {
    return null;
  }

  const scored = candidates
    .map((select) => ({ select, score: scoreSelect(select) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.length ? scored[0].select : candidates[0];
};

const waitForSelect = (timeoutMs = 15_000): Promise<HTMLSelectElement | null> => {
  debug("Waiting for medical center <select>...");
  const existing = findCenterSelect();
  if (existing) {
    debug("Found select immediately", describeSelect(existing));
    return Promise.resolve(existing);
  }

  return new Promise((resolve) => {
    let resolved = false;

    const timeout = window.setTimeout(() => {
      resolved = true;
      observer.disconnect();
      resolve(null);
    }, timeoutMs);

    const observer = new MutationObserver(() => {
      const found = findCenterSelect();
      if (found && !resolved) {
        resolved = true;
        window.clearTimeout(timeout);
        observer.disconnect();
        debug("Found select via observer", describeSelect(found));
        resolve(found);
      }
    });

    const target = document.body || document.documentElement;
    if (!target) {
      window.clearTimeout(timeout);
      resolve(null);
      return;
    }

    observer.observe(target, { childList: true, subtree: true });
  });
};

const ensureCenterInSelect = (
  select: HTMLSelectElement,
  groupLabel: string,
  center: Center
): HTMLOptionElement => {
  const normalizedValue = String(center.value).trim();
  const existing = Array.from(select.options).find((opt) => opt.value === normalizedValue);
  if (existing) {
    existing.textContent = center.name;
    existing.setAttribute(OPTION_ATTR, "true");
    return existing;
  }

  const option = document.createElement("option");
  option.value = normalizedValue;
  option.textContent = center.name;
  option.setAttribute(OPTION_ATTR, "true");
  select.appendChild(option);
  return option;
};

const ensureSelectUsable = (select: HTMLSelectElement) => {
  const needsUnlock =
    select.disabled ||
    select.hasAttribute("disabled") ||
    select.style.display === "none" ||
    select.style.visibility === "hidden" ||
    select.dataset.wchUnlocked !== "true";

  if (!needsUnlock) {
    return;
  }

  select.disabled = false;
  select.removeAttribute("disabled");

  if (select.style.display === "none") {
    select.style.removeProperty("display");
    select.style.display = "block";
  }

  if (select.style.visibility === "hidden") {
    select.style.visibility = "visible";
  }

  const wrappers = new Set<HTMLElement>();
  const primaryWrapper = select.closest<HTMLElement>(".medical-center-field");
  if (primaryWrapper) {
    wrappers.add(primaryWrapper);
  }

  const fieldWrapper = select.closest<HTMLElement>(".field");
  if (fieldWrapper) {
    wrappers.add(fieldWrapper);
  }

  if (select.parentElement instanceof HTMLElement) {
    wrappers.add(select.parentElement);
  }

  wrappers.forEach((wrapper) => {
    wrapper.classList.remove("disabled", "readonly", "is-disabled");
    if (wrapper.style.display === "none") {
      wrapper.style.removeProperty("display");
      wrapper.style.display = "block";
    }

    const label = wrapper.querySelector<HTMLElement>("label");
    if (label) {
      label.style.opacity = "1";
      label.style.removeProperty("opacity");
    }

    wrapper
      .querySelectorAll<HTMLElement>(".info-icon, .assigned-message, .auto-assign-note")
      .forEach((node) => {
        node.style.display = "none";
        node.classList.add("wch-hidden-by-extension");
      });
  });

  select.dataset.wchUnlocked = "true";
  debug("Unlocked medical center select", describeSelect(select));
};

const augmentSelect = (select: HTMLSelectElement) => {
  const previousValue = select.value;

  const staticOptions = Array.from(select.options).filter((option) => {
    const parent = option.parentElement;
    return (
      !option.hasAttribute(OPTION_ATTR) &&
      !(parent instanceof HTMLOptGroupElement && parent.getAttribute(GROUP_ATTR))
    );
  });

  select
    .querySelectorAll(`[${OPTION_ATTR}], optgroup[${GROUP_ATTR}]`)
    .forEach((node) => node.remove());

  staticOptions.forEach((option) => {
    option.removeAttribute(OPTION_ATTR);
  });

  const cityCenters = computeCityPanelCenters();
  const fallbackCenters = CENTER_GROUPS.flatMap((group) => group.centers);
  const centersToInject = cityCenters.length ? cityCenters : fallbackCenters;

  if (!centersToInject.length) {
    debug("No centers available to inject", describeSelect(select));
    return;
  }

  const seen = new Set(Array.from(select.options).map((opt) => opt.value));

  centersToInject.forEach((center) => {
    if (seen.has(center.value)) {
      return;
    }
    const option = document.createElement("option");
    option.value = center.value;
    option.textContent = center.name;
    option.setAttribute(OPTION_ATTR, "true");
    select.appendChild(option);
    seen.add(center.value);
  });

  if (previousValue && select.querySelector(`option[value="${previousValue}"]`)) {
    select.value = previousValue;
  }

  debug("Injected city-specific centers", {
    optionCount: select.options.length,
    cityCenters: cityCenters.length,
  });
};

const augmentAllSelects = () => {
  const selects = collectCenterSelects();
  selects.forEach((select) => {
    if (select.name === "medical_center" || select.id === "id_medical_center") {
      ensureSelectUsable(select);
    }
    augmentSelect(select);
  });
  return selects;
};

const dispatchSelectEvents = (select: HTMLSelectElement) => {
  CHANGE_EVENTS.forEach((eventName) => {
    const event = new Event(eventName, { bubbles: true });
    select.dispatchEvent(event);
  });
};

const highlightSelection = (select: HTMLSelectElement) => {
  const originalBg = select.style.backgroundColor;
  select.style.transition = select.style.transition || "background-color 0.3s ease";
  select.style.backgroundColor = "#fff2b6";
  window.setTimeout(() => {
    select.style.backgroundColor = originalBg;
  }, 600);
};

const useOutsideClose = (
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  active: boolean
) => {
  useEffect(() => {
    if (!active) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      const node = ref.current;
      if (!node) {
        return;
      }

      if (!event.composedPath().includes(node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [active, onClose, ref]);
};

export default function App() {
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectReady, setSelectReady] = useState(false);
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const supported = inSupportedContext();
  const [panelCenters, setPanelCenters] = useState<Center[]>([]);

  const syncSelectRefs = useCallback(() => {
    ensureBangladeshManualOverride();
    const selects = augmentAllSelects();
    if (selects.length) {
      if (!selectRef.current || !selects.includes(selectRef.current)) {
        selectRef.current = selects[0];
      }
      setSelectReady(true);
    } else {
      selectRef.current = null;
      setSelectReady(false);
    }
    setPanelCenters(computeCityPanelCenters());
    return selects;
  }, []);

  useEffect(() => {
    if (!supported) {
      debug("Not on supported domain, skipping render");
      return;
    }

    let cancelled = false;

    const update = () => {
      if (cancelled) {
        return;
      }
      syncSelectRefs();
    };

    update();

    waitForSelect().then((select) => {
      if (cancelled) {
        return;
      }
      if (select) {
        debug("Select prepared", describeSelect(select));
      }
      update();
    });

    const intervalId = window.setInterval(update, 4_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [supported, syncSelectRefs]);

  useEffect(() => {
    if (!supported) {
      return;
    }

    const handleChange = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      if (
        target.matches(
          'select[name="country"], select[name="city"], select[name="medical_center"], select[name="premium_medical_center"], input[name="appointment_type"]'
        )
      ) {
        window.setTimeout(() => {
          syncSelectRefs();
        }, 0);
      }
    };

    document.addEventListener("change", handleChange, true);

    return () => {
      document.removeEventListener("change", handleChange, true);
    };
  }, [supported, syncSelectRefs]);

  useEffect(() => {
    if (!supported) {
      return;
    }

    const attemptOverride = () => {
      if (ensureBangladeshManualOverride()) {
        debug("Ensured Bangladesh behaves as manual medical center country");
        syncSelectRefs();
      } else {
        setPanelCenters(computeCityPanelCenters());
      }
    };

    attemptOverride();
    const interval = window.setInterval(attemptOverride, 3_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [supported, syncSelectRefs]);

  useEffect(() => {
    if (!supported) {
      return;
    }

    const handleSubmitCapture = (event: Event) => {
      const form = event.target as HTMLFormElement | null;
      if (!form || !form.matches("form.booking-appointment-form")) {
        return;
      }

      const countrySelect = document.getElementById("id_country") as HTMLSelectElement | null;
      const medicalSelect = document.getElementById("id_medical_center") as HTMLSelectElement | null;
      const countryValue = countrySelect?.value?.trim();
      const selectedValue = medicalSelect?.value?.trim();

      if (ensureBangladeshManualOverride()) {
        debug("Override re-applied just before submit");
        syncSelectRefs();
      }

      const isBangladesh = countryValue === "BD";
      const hasManualSelection = !!selectedValue && selectedValue.toLowerCase() !== "auto assign";

      if (isBangladesh && hasManualSelection) {
        debug("Bypassing auto-assign restriction for Bangladesh", {
          countryValue,
          selectedValue,
        });

        event.preventDefault();
        event.stopImmediatePropagation();

        Array.from(form.querySelectorAll<HTMLButtonElement>("button[type='submit'], input[type='submit']")).forEach((button) => {
          button.disabled = false;
        });

        if (medicalSelect) {
          medicalSelect.disabled = false;
          medicalSelect.removeAttribute("disabled");
          medicalSelect.value = selectedValue;
          medicalSelect.setAttribute("value", selectedValue);
          medicalSelect.dataset.wchUnlocked = "true";
        }

        form.querySelectorAll(".medical-center-field .field-error-message").forEach((node) => {
          const text = node.textContent || "";
          if (text.includes("auto-assign countries")) {
            node.remove();
          }
        });

        window.setTimeout(() => {
          const snapshot = new FormData(form);
       Array.from(snapshot.entries()).map(([key, value]) =>
  debug("FormData entry", { key, value })
);

         
         

          const isValid = typeof form.reportValidity === "function" ? form.reportValidity() : form.checkValidity?.() ?? true;
          if (!isValid) {
            debug("Form failed built-in validity check; aborting manual submit");
            return;
          }
          debug("Submitting form natively for Bangladesh manual selection");
          HTMLFormElement.prototype.submit.call(form);
        }, 0);
      }
    };

    document.addEventListener("submit", handleSubmitCapture, true);

    return () => {
      document.removeEventListener("submit", handleSubmitCapture, true);
    };
  }, [supported, syncSelectRefs]);

  useOutsideClose(panelRef, () => setIsPanelOpen(false), isPanelOpen);

  const filteredGroups = useMemo(() => {
    const groups = panelCenters.length
      ? [{ label: "Selected City", centers: panelCenters }]
      : CENTER_GROUPS;

    const term = searchTerm.trim().toLowerCase();

    return groups
      .map((group) => ({
        label: group.label,
        centers: group.centers.filter((center) => {
          const composite = `${center.value} ${center.name}`.toLowerCase();
          return !term || composite.includes(term);
        }),
      }))
      .filter((group) => group.centers.length > 0);
  }, [panelCenters, searchTerm]);

  const handleSelect = (center: Center, groupLabel: string) => {
    const select = selectRef.current;
    if (!select) {
      return;
    }

    const option = ensureCenterInSelect(select, groupLabel, center);
    select.value = option.value;
    option.selected = true;
    dispatchSelectEvents(select);
    highlightSelection(select);
    setIsPanelOpen(false);
    debug("Center selected", { value: center.value, name: center.name, group: groupLabel });
  };

  const handleTogglePanel = () => {
    const selects = syncSelectRefs();
    if (!selectRef.current && !selects.length) {
      debug("No medical center select found when toggling panel");
      return;
    }

    setIsPanelOpen((prev) => !prev);
  };

  if (!supported) {
    return null;
  }

  return (
    <div className="wch-container" ref={panelRef}>
      <button
        type="button"
        onClick={handleTogglePanel}
        disabled={!selectReady}
        className="wch-toggle"
      >
        {selectReady ? "Centers" : "Preparing centers..."}
      </button>

      {isPanelOpen && (
        <div className="wch-panel">
          <div className="wch-panel-header">
            <h2 className="wch-panel-title">Bangladesh Centers</h2>
            <button
              type="button"
              className="wch-close"
              aria-label="Close center list"
              onClick={() => setIsPanelOpen(false)}
            >
              ×
            </button>
          </div>

          <div className="wch-panel-body">
            <input
              type="search"
              className="wch-search"
              placeholder="Search by name or code..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />

            <div className="wch-groups">
              {filteredGroups.length === 0 ? (
                <p className="wch-empty">No centers found.</p>
              ) : (
                filteredGroups.map((group) => (
                  <section className="wch-group" key={group.label}>
                    <header className="wch-group-title">{group.label}</header>
                    <div className="wch-group-list">
                      {group.centers.map((center) => (
                        <button
                          key={center.value}
                          type="button"
                          className="wch-center-button"
                          onClick={() => handleSelect(center, group.label)}
                        >
                          <span className="wch-center-name">{center.name}</span>
                          <span className="wch-center-code">{center.value}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))
              )}
            </div>

            <p className="wch-footnote">
              Picking a center fills the official WAFID field and triggers their validation events.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
