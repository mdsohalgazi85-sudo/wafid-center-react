import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { CENTER_GROUPS, type Center } from "./centers";

const SELECTOR_PREFERENCES = [
  'select[id*="center"]','select[name*="center"]','select[id*="medical"]','select[name*="medical"]','select[id*="clinic"]','select[name*="clinic"]'
];
const GROUP_ATTR = "data-wch-group";
const OPTION_ATTR = "data-wch-option";
const CHANGE_EVENTS: Array<keyof DocumentEventMap> = ["input","change"];
const DEBUG_PREFIX = "[Wafid Center Helper]";
const SUPPORTED_PATH_PREFIXES = ["/appointment", "/book-appointment"];

const debug = (...args: unknown[]) => { if (typeof console !== "undefined") console.log(DEBUG_PREFIX, ...args); };

const ensureBangladeshManualOverride = () => {
  if (typeof window === "undefined") return false;
  let updated = false;
  const globals = window as unknown as Record<string, any>;
  const normalize = (v: any) => (Array.isArray(v) ? v : null);

  let manual = normalize(globals.MANUAL_MEDICAL_CENTER_COUNTRIES);
  if (!manual) { manual = []; (globals as any).MANUAL_MEDICAL_CENTER_COUNTRIES = manual; updated = true; }
  if (manual && !manual.includes("BD")) { manual.push("BD"); updated = true; }

  let free = normalize(globals.FREE_MEDICAL_CENTER_COUNTRIES);
  if (!free) { free = []; (globals as any).FREE_MEDICAL_CENTER_COUNTRIES = free; }
  if (free) {
    const filtered = free.filter((c: string) => !["BD","Bangladesh","bd"].includes((c||"").toString()));
    if (filtered.length !== free.length) { free.splice(0, free.length, ...filtered); updated = true; }
  }
  return updated;
};

const computeCityPanelCenters = (): Center[] => {
  if (typeof window === "undefined") return [];
  const citySelect = document.getElementById("id_city") as HTMLSelectElement | null;
  const destSelect = document.getElementById("id_traveled_country") as HTMLSelectElement | null;
  const apptRadio = document.querySelector('input[name="appointment_type"]:checked') as HTMLInputElement | null;
  const cityValue = citySelect?.value?.trim();
  const destValue = destSelect?.value?.trim();
  if (!cityValue || !destValue) return [];

  const globals = window as any;
  const datasetKey = apptRadio?.value === "premium" ? "CITY_PREMIUM_MEDICAL_CENTERS" : "CITY_MEDICAL_CENTERS";
  const dataset = (globals[datasetKey] as Record<string, any> | undefined) ?? undefined;
  if (!dataset) return [];
  const raw = dataset[cityValue] as unknown;
  if (!Array.isArray(raw)) return [];

  const normDest = destValue.toUpperCase();
  const unique = new Map<string,string>();
  raw.forEach((entry) => {
    if (!Array.isArray(entry) || entry.length < 4) return;
    const value = entry[0];
    const label = entry[1];
    const entryDest = String(entry[3] ?? "").toUpperCase();
    if (entryDest !== normDest) return;
    const valueString = value == null ? "" : String(value);
    if (!valueString || typeof label !== "string") return;
    if (!unique.has(valueString)) unique.set(valueString, label);
  });
  return Array.from(unique.entries()).map(([value, name]) => ({ value, name }));
};

const describeSelect = (select: HTMLSelectElement | null) => (!select ? { id:null, name:null, optionCount:0 }
  : { id: select.id || null, name: select.name || null, optionCount: select.options.length });

const inSupportedContext = (): boolean => {
  if (typeof window === "undefined") return false;
  const { hostname, pathname } = window.location;
  return hostname === "wafid.com" && SUPPORTED_PATH_PREFIXES.some((p) => pathname.startsWith(p));
};

const scoreSelect = (select: HTMLSelectElement): number => {
  if (!select || select.disabled) return 0;
  const tokens = `${select.id||""} ${select.name||""}`.toLowerCase();
  let score = 0;
  if (tokens.includes("center")) score += 5;
  if (tokens.includes("medical")) score += 3;
  if (tokens.includes("clinic")) score += 2;
  const options = Array.from(select.options||[]);
  const numeric = options.filter((o)=>/^\d{3,}$/.test(o.value.trim())).length;
  if (numeric > 5) score += 3; else if (numeric > 0) score += 1;
  if (options.length > 30) score += 1;
  const style = window.getComputedStyle(select);
  if (style.display === "none" || style.visibility === "hidden") score -= 2;
  const rect = select.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 10) score -= 1;
  return score;
};

const collectCenterSelects = (): HTMLSelectElement[] => {
  const seen = new Set<HTMLSelectElement>();
  SELECTOR_PREFERENCES.forEach((sel) => {
    document.querySelectorAll<HTMLSelectElement>(sel).forEach((s)=>{ if(!seen.has(s)) seen.add(s); });
  });
  document.querySelectorAll<HTMLSelectElement>('select[name="medical_center"], select[name="premium_medical_center"]').forEach((s)=>{
    if(!seen.has(s)) seen.add(s);
  });
  return Array.from(seen);
};

const findCenterSelect = (): HTMLSelectElement | null => {
  const candidates = collectCenterSelects();
  if (!candidates.length) return null;
  const scored = candidates.map((s)=>({select:s, score:scoreSelect(s)})).filter(e=>e.score>0).sort((a,b)=>b.score-a.score);
  return scored.length ? scored[0].select : candidates[0];
};

const waitForSelect = (timeoutMs=15000): Promise<HTMLSelectElement|null> => {
  const existing = findCenterSelect(); if (existing) return Promise.resolve(existing);
  return new Promise((resolve)=>{
    let resolved = false;
    const timeout = window.setTimeout(()=>{ resolved = true; obs.disconnect(); resolve(null); }, timeoutMs);
    const obs = new MutationObserver(()=>{
      const found = findCenterSelect();
      if (found && !resolved){ resolved = true; window.clearTimeout(timeout); obs.disconnect(); resolve(found); }
    });
    obs.observe(document.body||document.documentElement, { childList:true, subtree:true });
  });
};

const ensureCenterInSelect = (select: HTMLSelectElement, _groupLabel: string, center: Center): HTMLOptionElement => {
  const val = String(center.value).trim();
  const existing = Array.from(select.options).find((o)=>o.value===val);
  if (existing){ existing.textContent = center.name; existing.setAttribute(OPTION_ATTR,"true"); return existing; }
  const opt = document.createElement("option"); opt.value=val; opt.textContent=center.name; opt.setAttribute(OPTION_ATTR,"true"); select.appendChild(opt); return opt;
};
const ensureSelectUsable = (select: HTMLSelectElement) => {
  const needs = select.disabled || select.hasAttribute("disabled") || select.style.display==="none" || select.style.visibility==="hidden" || select.dataset.wchUnlocked!=="true";
  if (!needs) return;
  select.disabled = false; select.removeAttribute("disabled");
  if (select.style.display==="none"){ select.style.removeProperty("display"); select.style.display="block"; }
  if (select.style.visibility==="hidden"){ select.style.visibility="visible"; }
  const wrappers = new Set<HTMLElement>();
  const w1 = select.closest<HTMLElement>(".medical-center-field"); if (w1) wrappers.add(w1);
  const w2 = select.closest<HTMLElement>(".field"); if (w2) wrappers.add(w2);
  if (select.parentElement instanceof HTMLElement) wrappers.add(select.parentElement);
  wrappers.forEach((w)=>{
    w.classList.remove("disabled","readonly","is-disabled");
    if (w.style.display==="none"){ w.style.removeProperty("display"); w.style.display="block"; }
    const label = w.querySelector<HTMLElement>("label"); if (label){ label.style.opacity="1"; label.style.removeProperty("opacity"); }
    w.querySelectorAll<HTMLElement>(".info-icon, .assigned-message, .auto-assign-note").forEach(n=>{ n.style.display="none"; n.classList.add("wch-hidden-by-extension"); });
  });
  select.dataset.wchUnlocked="true";
};
const augmentSelect = (select: HTMLSelectElement) => {
  const prev = select.value;
  const staticOptions = Array.from(select.options).filter((o)=>{
    const p = o.parentElement;
    return !o.hasAttribute(OPTION_ATTR) && !(p instanceof HTMLOptGroupElement && p.getAttribute(GROUP_ATTR));
  });
  select.querySelectorAll(`[${OPTION_ATTR}], optgroup[${GROUP_ATTR}]`).forEach((n)=>n.remove());
  staticOptions.forEach((o)=>o.removeAttribute(OPTION_ATTR));
  const cityCenters = computeCityPanelCenters();
  const fallbackCenters = CENTER_GROUPS.flatMap((g)=>g.centers);
  const centers = cityCenters.length ? cityCenters : fallbackCenters;
  if (!centers.length) return;
  const seen = new Set(Array.from(select.options).map(o=>o.value));
  centers.forEach((c)=>{
    if (seen.has(c.value)) return;
    const opt = document.createElement("option"); opt.value=c.value; opt.textContent=c.name; opt.setAttribute(OPTION_ATTR,"true"); select.appendChild(opt); seen.add(c.value);
  });
  if (prev && select.querySelector(`option[value="${prev}"]`)) select.value = prev;
};

const augmentAllSelects = () => {
  const selects = collectCenterSelects();
  selects.forEach((sel)=>{ if (sel.name==="medical_center" || sel.id==="id_medical_center") ensureSelectUsable(sel); augmentSelect(sel); });
  return selects;
};
const dispatchSelectEvents = (select: HTMLSelectElement) => {
  CHANGE_EVENTS.forEach((e)=> select.dispatchEvent(new Event(e, {bubbles:true})));
};
const highlightSelection = (select: HTMLSelectElement) => {
  const bg = select.style.backgroundColor;
  select.style.transition = select.style.transition || "background-color .3s ease";
  select.style.backgroundColor = "#fff2b6";
  window.setTimeout(()=>{ select.style.backgroundColor = bg; }, 600);
};

const useOutsideClose = (ref: RefObject<HTMLElement|null>, onClose: ()=>void, active: boolean) => {
  useEffect(()=>{
    if(!active) return;
    const onClick = (e: MouseEvent)=>{
      const node = ref.current; if (!node) return;
      // @ts-ignore - composedPath exists at runtime
      if (!e.composedPath().includes(node)) onClose();
    };
    const onEsc = (e: KeyboardEvent)=>{ if (e.key==="Escape") onClose(); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return ()=>{ document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onEsc); };
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

  const syncSelectRefs = useCallback(()=>{
    ensureBangladeshManualOverride();
    const selects = augmentAllSelects();
    if (selects.length){
      if (!selectRef.current || !selects.includes(selectRef.current)) selectRef.current = selects[0];
      setSelectReady(true);
    } else { selectRef.current = null; setSelectReady(false); }
    setPanelCenters(computeCityPanelCenters());
    return selects;
  }, []);

  useEffect(()=>{
    if(!supported) return;
    let cancelled = false;
    const update = ()=>{ if(!cancelled) syncSelectRefs(); };
    update();
    waitForSelect().then(()=>{ if(!cancelled) update(); });
    const id = window.setInterval(update, 4000);
    return ()=>{ cancelled = true; window.clearInterval(id); };
  }, [supported, syncSelectRefs]);

  useEffect(()=>{
    if(!supported) return;
    const onChange = (e: Event)=>{
      const t = e.target as HTMLElement | null; if (!t) return;
      if (t.matches('select[name="country"], select[name="city"], select[name="medical_center"], select[name="premium_medical_center"], input[name="appointment_type"]')) {
        window.setTimeout(()=> syncSelectRefs(), 0);
      }
    };
    document.addEventListener("change", onChange, true);
    return ()=> document.removeEventListener("change", onChange, true);
  }, [supported, syncSelectRefs]);

  useEffect(()=>{
    if(!supported) return;
    const attempt = ()=>{
      if (ensureBangladeshManualOverride()) syncSelectRefs();
      else setPanelCenters(computeCityPanelCenters());
    };
    attempt();
    const id = window.setInterval(attempt, 3000);
    return ()=> window.clearInterval(id);
  }, [supported, syncSelectRefs]);

  useEffect(()=>{
    if(!supported) return;
    const onSubmit = (event: Event)=>{
      const form = event.target as HTMLFormElement | null;
      if (!form || !form.matches("form.booking-appointment-form")) return;

      const countrySelect = document.getElementById("id_country") as HTMLSelectElement | null;
      const medicalSelect = document.getElementById("id_medical_center") as HTMLSelectElement | null;
      const countryValue = countrySelect?.value?.trim();
      const selectedValue = medicalSelect?.value?.trim();

      if (ensureBangladeshManualOverride()) syncSelectRefs();

      const isBangladesh = countryValue === "BD";
      const hasManualSelection = !!selectedValue && selectedValue.toLowerCase() !== "auto assign";

      if (isBangladesh && hasManualSelection) {
        event.preventDefault(); event.stopImmediatePropagation();
        Array.from(form.querySelectorAll<HTMLButtonElement>("button[type='submit'], input[type='submit']")).forEach((b)=> b.disabled=false);
        if (medicalSelect) { medicalSelect.disabled=false; medicalSelect.removeAttribute("disabled"); medicalSelect.value=selectedValue; medicalSelect.setAttribute("value", selectedValue); medicalSelect.dataset.wchUnlocked="true"; }
        form.querySelectorAll(".medical-center-field .field-error-message").forEach((n)=>{
          const text = n.textContent || ""; if (text.includes("auto-assign countries")) n.remove();
        });
        window.setTimeout(()=>{
          const snapshot = new FormData(form);
          Array.from(snapshot.entries()).forEach(([key, value])=> debug("FormData entry", {key, value}));
          const isValid = typeof form.reportValidity === "function" ? form.reportValidity() : (form as any).checkValidity?.() ?? true;
          if (!isValid) { debug("reportValidity failed"); return; }
          HTMLFormElement.prototype.submit.call(form);
        }, 0);
      }
    };
    document.addEventListener("submit", onSubmit, true);
    return ()=> document.removeEventListener("submit", onSubmit, true);
  }, [supported, syncSelectRefs]);

  useOutsideClose(panelRef, ()=> setIsPanelOpen(false), isPanelOpen);

  const filteredGroups = useMemo(()=>{
    const groups = panelCenters.length ? [{ label:"Selected City", centers: panelCenters }] : CENTER_GROUPS;
    const term = searchTerm.trim().toLowerCase();
    return groups.map((g)=>({ label:g.label, centers:g.centers.filter((c)=> (`${c.value} ${c.name}`).toLowerCase().includes(term))})).filter((g)=>g.centers.length>0);
  }, [panelCenters, searchTerm]);

  const handleSelect = (center: Center, groupLabel: string) => {
    const select = selectRef.current; if (!select) return;
    const option = ensureCenterInSelect(select, groupLabel, center);
    select.value = option.value; option.selected = true; dispatchSelectEvents(select); highlightSelection(select);
    setIsPanelOpen(false);
  };
  const handleTogglePanel = () => {
    const selects = syncSelectRefs();
    if (!selectRef.current && !selects.length) return;
    setIsPanelOpen((p)=>!p);
  };
  if (!supported) return null;

  return (
    <div className="wch-container" ref={panelRef}>
      <button type="button" onClick={handleTogglePanel} disabled={!selectReady} className="wch-toggle">
        {selectReady ? "Centers" : "Preparing centers..."}
      </button>
      {isPanelOpen && (
        <div className="wch-panel">
          <div className="wch-panel-header">
            <h2 className="wch-panel-title">Bangladesh Centers</h2>
            <button type="button" className="wch-close" aria-label="Close center list" onClick={()=> setIsPanelOpen(false)}>×</button>
          </div>
          <div className="wch-panel-body">
            <input type="search" className="wch-search" placeholder="Search by name or code..." value={searchTerm} onChange={(e)=> setSearchTerm(e.target.value)} />
            <div className="wch-groups">
              {filteredGroups.length === 0 ? (<p className="wch-empty">No centers found.</p>) : (
                filteredGroups.map((group)=>(
                  <section className="wch-group" key={group.label}>
                    <header className="wch-group-title">{group.label}</header>
                    <div className="wch-group-list">
                      {group.centers.map((center)=>(
                        <button key={center.value} type="button" className="wch-center-button" onClick={()=> handleSelect(center, group.label)}>
                          <span className="wch-center-name">{center.name}</span>
                          <span className="wch-center-code">{center.value}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))
              )}
            </div>
            <p className="wch-footnote">Picking a center fills the official WAFID field and triggers their validation events.</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========= AUTOMATION LAYER (added, non-breaking) ========= */
const a_sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function a_qs<T extends Element = Element>(sel: string, root: Document | Element = document): T | null { return root.querySelector(sel) as T | null; }
function a_qsa<T extends Element = Element>(sel: string, root: Document | Element = document): T[] { return Array.from(root.querySelectorAll(sel)) as T[]; }
function a_setInput(el: HTMLInputElement | HTMLTextAreaElement | null, val?: string | number){ if (!el) return; el.value = (val??'').toString(); el.dispatchEvent(new Event("input",{bubbles:true})); el.dispatchEvent(new Event("change",{bubbles:true})); }
function a_setSelectByValue(el: HTMLSelectElement | null, val?: string | number){ if(!el) return false; const v=(val??'').toString().trim(); const opt=Array.from(el.options).find((o)=>(o.value??'').toString().trim()===v); if (opt){ el.value=opt.value; el.dispatchEvent(new Event("change",{bubbles:true})); return true; } return false; }
function a_setRadioByValue(name: string, val?: string | number){ const v=(val??'').toString().trim().toLowerCase(); const radios=a_qsa<HTMLInputElement>(`input[type=radio][name="${name}"]`); for(const r of radios){ const rv=(r.value??'').toString().trim().toLowerCase(); if (rv===v){ r.click(); return true; } } return false; }
function a_ensureOverlay(){ let over = a_qs<HTMLDivElement>("#wch-auto-overlay"); if (over) return over; over = document.createElement("div"); over.id="wch-auto-overlay"; Object.assign(over.style,{position:"fixed",inset:"0",background:"rgba(17,24,39,.6)",display:"none",zIndex:"999999",alignItems:"center",justifyContent:"center"} as CSSStyleDeclaration); const panel=document.createElement("div"); Object.assign(panel.style,{background:"#fff",color:"#111827",borderRadius:"12px",padding:"18px",width:"min(520px,92%)",boxShadow:"0 10px 24px rgba(0,0,0,.2)",fontFamily:"ui-sans-serif, system-ui"} as CSSStyleDeclaration); panel.innerHTML=`
  <div style="font-weight:700;font-size:16px;margin-bottom:8px">Solve CAPTCHA (if any), then submit</div>
  <div style="font-size:14px;line-height:1.5;margin-bottom:12px">CAPTCHA থাকলে এখন দিন। রেডি হলে <b>Resume & Submit</b> চাপুন।</div>
  <div style="display:flex;gap:10px;justify-content:flex-end">
    <button id="wch-auto-hide" style="border:1px solid #d1d5db;border-radius:8px;padding:8px 12px;background:#fff;color:#111827;cursor:pointer">Hide</button>
    <button id="wch-auto-resume" style="border:1px solid #d1d5db;border-radius:8px;padding:8px 12px;background:#111827;color:#fff;cursor:pointer">Resume & Submit</button>
  </div>`; over.appendChild(panel); document.body.appendChild(over);
  (a_qs<HTMLButtonElement>("#wch-auto-hide", over)!).onclick = () => (over!.style.display = "none");
  (a_qs<HTMLButtonElement>("#wch-auto-resume", over)!).onclick = async () => { over!.style.display = "none"; await a_submit(); };
  return over;
}
const a_showOverlay = () => (a_ensureOverlay().style.display = "flex");

type WchRow = {
  country?: string; city?: string | number; traveled_country?: string;
  appointment_type?: string; medical_center?: string; premium_medical_center?: string;
  appointment_date?: string; first_name?: string; last_name?: string; dob?: string;
  nationality?: string | number; gender?: string; marital_status?: string;
  passport?: string; confirm_passport?: string;
  passport_issue_date?: string; passport_issue_place?: string; passport_expiry_on?: string;
  visa_type?: string; email?: string; phone?: string; national_id?: string; applied_position?: string | number;
};

async function a_fillBasics(row: WchRow){
  a_setSelectByValue(a_qs<HTMLSelectElement>('#id_country, select[name="country"]'), row.country);
  a_setSelectByValue(a_qs<HTMLSelectElement>('#id_city, select[name="city"]'), row.city);
  a_setSelectByValue(a_qs<HTMLSelectElement>('#id_traveled_country, select[name="traveled_country"]'), row.traveled_country);
  if (row.appointment_type){
    const ok = a_setRadioByValue("appointment_type", row.appointment_type);
    if (!ok) a_setSelectByValue(a_qs<HTMLSelectElement>('#appointment_type, select[name="appointment_type"]'), row.appointment_type);
  }
  const map: Record<string, string[]> = {
    first_name:['input[name="first_name"]', "#first_name"],
    last_name:['input[name="last_name"]', "#last_name"],
    dob:['input[name="dob"]', '#dob','input[type="date"][name="dob"]'],
    nationality:['select[name="nationality"]', "#nationality"],
    gender:['select[name="gender"]', "#gender"],
    marital_status:['select[name="marital_status"]', "#marital_status"],
    passport:['input[name="passport"]', "#passport"],
    confirm_passport:['input[name="confirm_passport"]', "#confirm_passport"],
    passport_issue_date:['input[name="passport_issue_date"]', "#passport_issue_date"],
    passport_issue_place:['input[name="passport_issue_place"]', "#passport_issue_place"],
    passport_expiry_on:['input[name="passport_expiry_on"]', "#passport_expiry_on"],
    visa_type:['select[name="visa_type"]', "#visa_type"],
    email:['input[name="email"]', "#email"],
    phone:['input[name="phone"]', "#phone"],
    national_id:['input[name="national_id"]', "#national_id"],
    applied_position:['select[name="applied_position"]', "#applied_position"],
    appointment_date:['input[name="appointment_date"]', '#appointment_date','input[type="date"][name="appointment_date"]'],
  };
  for (const [k, sels] of Object.entries(map)){
    const v = (row as any)[k]; if (v==null || v==="") continue;
    for (const s of sels){
      const el = a_qs<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(s);
      if (!el) continue;
      if (el instanceof HTMLSelectElement){
        if (a_setSelectByValue(el, v)) break;
        const opt = Array.from(el.options).find((o)=> (o.text??"").toString().trim().toLowerCase() === (v??"").toString().trim().toLowerCase());
        if (opt){ el.value = opt.value; el.dispatchEvent(new Event("change",{bubbles:true})); break; }
      } else if ((el as HTMLInputElement).type === "radio"){
        if (a_setRadioByValue((el as HTMLInputElement).name, v)) break;
      } else {
        a_setInput(el as HTMLInputElement, v as any); break;
      }
    }
  }
}
async function a_setCentersFromCodes(row: WchRow){
  const mcSel = (document.getElementById("id_medical_center") as HTMLSelectElement) || a_qs<HTMLSelectElement>('select[name="medical_center"]');
  const pmcSel = (document.getElementById("id_premium_medical_center") as HTMLSelectElement) || a_qs<HTMLSelectElement>('select[name="premium_medical_center"]');
  if (row.medical_center){
    const ok = a_setSelectByValue(mcSel, row.medical_center);
    if (!ok) throw new Error(`medical_center code not found: ${row.medical_center}`);
  }
  if (row.premium_medical_center) a_setSelectByValue(pmcSel, row.premium_medical_center);
}
async function a_submit(){
  const btn = a_qs<HTMLButtonElement>('button[type="submit"]') || a_qs<HTMLInputElement>('input[type="submit"]') || a_qsa<HTMLButtonElement>("button").find((b)=>/submit|book|confirm/i.test(b.textContent||""));
  if (!btn) throw new Error("Submit button not found"); (btn as HTMLButtonElement).click();
}
async function a_waitSuccess(timeout=25000){
  const start = Date.now();
  while (Date.now()-start < timeout){
    const ok = a_qs(".alert-success, .success, .booking-number, [data-status='success']") ||
      a_qsa("*").find((n)=>/success|confirmed|booking/i.test(n.textContent||""));
    if (ok) return true;
    await a_sleep(600);
  } return false;
}
async function a_runOne(row: WchRow, opts?: { pauseForCaptcha?: boolean }){
  try{
    ensureBangladeshManualOverride?.();
    await a_fillBasics(row);
    await a_sleep(400);
    await a_setCentersFromCodes(row);
    if (opts?.pauseForCaptcha){ a_showOverlay(); return { ok:true, paused:true }; }
    await a_submit();
    const ok = await a_waitSuccess(30000);
    return { ok };
  }catch(e:any){ return { ok:false, error:e?.message||String(e) }; }
}

// WebView2
// @ts-ignore
if (window?.chrome?.webview?.addEventListener){
  // @ts-ignore
  window.chrome.webview.addEventListener("message", async (e:any)=>{
    const msg = e?.data || e;
    if (msg?.type === "automation-run-row"){
      const { requestId, row, options } = msg;
      const res = await a_runOne(row as WchRow, options);
      // @ts-ignore
      window.chrome.webview.postMessage({ type:"automation-result", requestId, ...res });
    }
  });
}
// chrome.runtime
// @ts-ignore
if (window?.chrome?.runtime?.onMessage){
  // @ts-ignore
  window.chrome.runtime.onMessage.addListener((msg:any, _sender:any, sendResponse:(r:any)=>void)=>{
    if (msg?.type === "automation-run-row"){
      (async ()=>{ const res = await a_runOne(msg.row as WchRow, msg.options); sendResponse({ type:"automation-result", requestId: msg.requestId, ...res }); })();
      return true;
    }
  });
}
// window bridge (dev)
window.addEventListener("message", async (e)=>{
  const msg = (e as MessageEvent)?.data;
  if (msg?.type === "automation-run-row"){
    const res = await a_runOne(msg.row as WchRow, msg.options);
    window.postMessage({ type:"automation-result", requestId: msg.requestId, ...res }, "*");
  }
});
// quick helper
// @ts-ignore
(window as any).wchRunRow = (row: any, options?: any) => a_runOne(row, options);
