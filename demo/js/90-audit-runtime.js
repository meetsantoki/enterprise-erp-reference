/*
 * GLOBAL AUTOMATIC AUDIT ENGINE
 * Event delegation means controls and pages added in the future are covered
 * without adding a separate logEvent() call to every new button or form.
 */
let automaticAuditQueue = Promise.resolve();
let lastAutomaticAuditSignature = "";
let lastAutomaticAuditAt = 0;
const automaticAuditLastBySignature = new Map();

function auditDepartmentFromView(viewId = currentActiveViewId) {
  const value = String(viewId || "").toLowerCase();
  if (value.includes("account") || value.includes("receipt")) return "ACCOUNTS";
  if (value.includes("purchase") || value.includes("vendor") || value.includes("partcode")) return "PURCHASE";
  if (value.includes("dispatch") || value.includes("transporter") || value.includes("driver") || value.includes("route") || value.includes("vehicle")) return "DISPATCH";
  if (value.includes("packing")) return "PACKING";
  if (value.includes("store") || value.includes("serial") || value.includes("po")) return "STORE";
  if (value.includes("sale") || value.includes("customer") || value.includes("allocation")) return "SALES";
  if (value.includes("production")) return "PRODUCTION";
  if (value.includes("warehouse") || value.includes("product")) return "WAREHOUSE";
  return "SYSTEM";
}

function auditDepartmentFromElement(element) {
  const viewId = element?.closest?.(".view-panel")?.id?.replace(/^view-/, "") || currentActiveViewId;
  return auditDepartmentFromView(viewId);
}

function automaticAuditElementLabel(element) {
  if (!element) return "Unknown control";
  const explicit = element.getAttribute?.("data-audit-label") || element.getAttribute?.("aria-label") || element.getAttribute?.("title");
  const labelled = element.labels?.[0]?.textContent;
  const text = explicit || labelled || element.textContent || element.getAttribute?.("placeholder") || element.name || element.id || element.tagName;
  return String(text || "Unknown control").replace(/\s+/g, " ").trim().slice(0, 180);
}

function automaticAuditFieldValue(field) {
  const identity = `${field?.type || ""} ${field?.name || ""} ${field?.id || ""}`.toLowerCase();
  if (/password|passcode|secret|token|credential|otp|pin/.test(identity)) return "[REDACTED]";
  if (field?.type === "file") return `${field.files?.length || 0} file(s) selected; file contents and local paths not recorded`;
  if (field?.type === "checkbox" || field?.type === "radio") return field.checked ? "checked" : "unchecked";
  if (field?.tagName === "SELECT") return `selected ${String(field.options?.[field.selectedIndex]?.text || field.value || "blank").trim().slice(0, 160)}`;
  if (["date", "datetime-local", "month", "week", "time", "number", "range"].includes(String(field?.type || "").toLowerCase())) return `value ${String(field.value || "blank").slice(0, 80)}`;
  const length = String(field?.value || "").length;
  return `updated (${length} character${length === 1 ? "" : "s"}); content not copied to the audit log`;
}

function recordAutomaticAudit(department, action, details) {
  if (!currentLoggedInUser) return;
  const signature = `${department}|${action}|${details}`;
  const now = Date.now();
  if (signature === lastAutomaticAuditSignature && now - lastAutomaticAuditAt < 400) return;
  // Navigation can re-enter the same renderer during live refresh. One page
  // audit per minute is sufficient and avoids turning UI activity into DB load.
  const prior = automaticAuditLastBySignature.get(signature) || 0;
  if (action === "PAGE_OPENED" && now - prior < 60000) return;
  automaticAuditLastBySignature.set(signature, now);
  if (automaticAuditLastBySignature.size > 500) {
    for (const [key, timestamp] of automaticAuditLastBySignature) if (now - timestamp > 3600000) automaticAuditLastBySignature.delete(key);
  }
  lastAutomaticAuditSignature = signature;
  lastAutomaticAuditAt = now;
  automaticAuditQueue = automaticAuditQueue
    .catch(() => undefined)
    .then(() => logEvent(department, action, details, { silent: true }));
}

document.addEventListener("click", event => {
  if (!currentLoggedInUser) return;
  const control = event.target?.closest?.("button, a, [role='button'], .menu-btn, .sub-item");
  // Business actions already write explicit immutable audit events. Generic
  // clicks are recorded only when a control is deliberately marked important.
  if (!control || control.hasAttribute("data-no-audit") || control.disabled || !control.hasAttribute("data-audit-important")) return;
  recordAutomaticAudit(
    auditDepartmentFromElement(control),
    "UI_CONTROL_ACTIVATED",
    `Activated ${control.tagName.toLowerCase()} control: ${automaticAuditElementLabel(control)}; page: ${currentActiveViewId}.`
  );
});

document.addEventListener("change", event => {
  if (!currentLoggedInUser) return;
  const field = event.target;
  if (!field?.matches?.("input, select, textarea") || field.hasAttribute("data-no-audit") || !field.hasAttribute("data-audit-important")) return;
  recordAutomaticAudit(
    auditDepartmentFromElement(field),
    "FIELD_CHANGED",
    `Changed field ${automaticAuditElementLabel(field)}: ${automaticAuditFieldValue(field)}; page: ${currentActiveViewId}.`
  );
});

document.addEventListener("submit", event => {
  if (!currentLoggedInUser) return;
  const form = event.target;
  if (form?.hasAttribute?.("data-no-audit")) return;
  recordAutomaticAudit(
    auditDepartmentFromElement(form),
    "FORM_SUBMITTED",
    `Submitted form: ${automaticAuditElementLabel(form)}; page: ${currentActiveViewId}.`
  );
});

setInterval(() => {
  if (!currentLoggedInUser || document.visibilityState !== "visible") return;
  recordAutomaticAudit(
    auditDepartmentFromView(),
    "SESSION_ACTIVE",
    `Authenticated session active on page ${currentActiveViewId}; minute heartbeat.`
  );
}, 900000);

  // Dynamic Navbar Date & Time Clock
function startNavbarClock() {
  const clockEl = document.getElementById("navbarDateTimeDisplay");
  if (!clockEl) return;

  const updateClock = () => {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    const secs = String(now.getSeconds()).padStart(2, '0');
    
    clockEl.textContent = `📅 ${day}/${month}/${year} | ⏰ ${hours}:${mins}:${secs}`;
  };

  updateClock();
  setInterval(updateClock, 1000);
}

// GLOBAL GRADE COLOUR ENGINE
function getGradeColourClass(value) {
  const grade = String(value || "").trim().toUpperCase();

  if (grade === "B" || grade.startsWith("B GRADE")) return "grade-b";
  if (grade === "R" || grade.startsWith("R GRADE")) return "grade-r";
  return "grade-a";
}

function applyGlobalGradeColours(root = document) {
  // Colour grade dropdowns
  root.querySelectorAll("#pGradeSelect, #editPalletNewGrade").forEach(select => {
    select.classList.remove("grade-a", "grade-b", "grade-r");
    select.classList.add(getGradeColourClass(select.value));
  });

  // Colour text such as A GRADE, B GRADE, R GRADE in all pages
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        if (
          parent.closest("script, style, option, svg, .grade-label") ||
          !/\b[ABR]\s*GRADE\b/i.test(node.nodeValue)
        ) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  textNodes.forEach(node => {
    const fragment = document.createDocumentFragment();
    const parts = node.nodeValue.split(/\b([ABR]\s*GRADE)\b/ig);

    parts.forEach(part => {
      if (/^[ABR]\s*GRADE$/i.test(part)) {
        const label = document.createElement("span");
        label.className = `grade-label ${getGradeColourClass(part)}`;
        label.textContent = part.toUpperCase();
        fragment.appendChild(label);
      } else {
        fragment.appendChild(document.createTextNode(part));
      }
    });

    node.parentNode.replaceChild(fragment, node);
  });
}

document.addEventListener("change", event => {
  if (event.target.matches("#pGradeSelect, #editPalletNewGrade")) {
    applyGlobalGradeColours(document);
  }
});

document.addEventListener("DOMContentLoaded", () => {
  applyGlobalGradeColours(document);
  const pendingGradeRoots = new Set();
  let gradeColourFrame = 0;
  const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      const containsGradeText = [...mutation.addedNodes].some(node => /\b[ABR]\s*GRADE\b/i.test(String(node.textContent || node.nodeValue || "")));
      if (containsGradeText && mutation.target?.nodeType === Node.ELEMENT_NODE) pendingGradeRoots.add(mutation.target);
    });
    if (!pendingGradeRoots.size || gradeColourFrame) return;
    gradeColourFrame = window.requestAnimationFrame(() => {
      gradeColourFrame = 0;
      const roots = [...pendingGradeRoots];
      pendingGradeRoots.clear();
      roots.filter(root => root.isConnected).forEach(root => applyGlobalGradeColours(root));
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
});

// Initialize clock on script load
startNavbarClock();

// Android enterprise shell integration. The native application supplies
// camera scanning, Android printing and network status while this web layer
// remains the single permission-aware source of ERP workflows.
window.onDemoSolarMobileReady = function() {
  document.body.classList.add("demosolar-mobile-app");
};

window.onDemoSolarMobileMenu = function() {
  document.body.classList.toggle("demosolar-mobile-menu-open");
};

window.onDemoSolarMobileScan = function(scannedValue) {
  const value = String(scannedValue || "").trim();
  if (!value) return;
  const activeView = document.querySelector(".view-panel.active");
  const scanTargets = ["gunInput", "reworkScanInput", "searchEditSerialInput", "searchDispatchDeleteInput"];
  const input = scanTargets.map(id => document.getElementById(id)).find(element => element && activeView?.contains(element) && !element.disabled);
  if (!input) {
    window.showNotification?.({ title: "Scanner", message: "Open a supported scanning screen first.", type: "warning" });
    return;
  }
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
};

window.onDemoSolarMobileNetwork = function(isOnline) {
  document.body.classList.toggle("demosolar-mobile-offline", !isOnline);
  let badge = document.getElementById("demosolarMobileNetworkBadge");
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "demosolarMobileNetworkBadge";
    document.body.appendChild(badge);
  }
  badge.textContent = isOnline ? "ONLINE" : "OFFLINE — reconnecting";
  badge.className = isOnline ? "online" : "offline";
};

document.addEventListener("click", event => {
  if (document.body.classList.contains("demosolar-mobile-app") && event.target.closest(".menu-btn, .sub-item")) {
    document.body.classList.remove("demosolar-mobile-menu-open");
  }
});
