/**
 * DEMOSOLAR ENERGY ERP SYSTEM - MASTER JAVASCRIPT ENGINE
 */
const KEY_USERS = "DEMOSOLAR_USERS_PALLET_FORMAT_V7";
const KEY_PRODUCTS = "DEMOSOLAR_PRODUCTS_PALLET_FORMAT_V7";
const KEY_POS = "DEMOSOLAR_POS_PALLET_FORMAT_V7";
const KEY_LOGS = "DEMOSOLAR_SYSTEM_LOGS_PALLET_FORMAT_V7";
const KEY_STOCK = "DEMOSOLAR_STOCK_PALLET_FORMAT_V7";
const KEY_DISPATCH_ARCHIVE = "DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7";
const KEY_TRANSPORTERS = "DEMOSOLAR_TRANSPORTERS_MASTER_V7";
const KEY_DRIVERS = "DEMOSOLAR_DRIVERS_MASTER_V7";
const KEY_STORE_SERIALS = "DEMOSOLAR_STORE_SERIALS_STORAGE_V1";
const KEY_SESSION = "DEMOSOLAR_ACTIVE_SESSION_V7";
const KEY_REQUESTS = "DEMOSOLAR_DELETION_REQUESTS_V1";
const KEY_REQUEST_ROUTES = "DEMOSOLAR_REQUEST_ROUTES_V1";
const KEY_STOCK_BOOKINGS = "DEMOSOLAR_STOCK_BOOKINGS_V1";
const KEY_SALES_ORDERS = "DEMOSOLAR_SALES_ORDERS_V1";
const KEY_ACCOUNT_INVOICES = "DEMOSOLAR_ACCOUNT_INVOICES_V1";
const KEY_CUSTOMERS = "DEMOSOLAR_CUSTOMERS_MASTER_V1";
const KEY_SALES_PEOPLE = "DEMOSOLAR_SALES_PEOPLE_V1";
const KEY_SALES_CO_REGISTRY = "DEMOSOLAR_SALES_CO_REGISTRY_V1";
const KEY_CO_ALLOCATIONS = "DEMOSOLAR_CO_ALLOCATIONS_V1";
const KEY_DEPARTMENTS = "DEMOSOLAR_DEPARTMENTS_MASTER_V1";
const KEY_DESIGNATIONS = "DEMOSOLAR_DESIGNATIONS_MASTER_V1";
const KEY_ROUTE_FARES = "DEMOSOLAR_ROUTE_FARES_V1";
const KEY_VEHICLE_BOOKINGS = "DEMOSOLAR_VEHICLE_BOOKINGS_V1";
const KEY_PRODUCTION_SHEET = "DEMOSOLAR_PRODUCTION_SHEET_V1";
const KEY_PRODUCTION_DAILY = "DEMOSOLAR_PRODUCTION_DAILY_V1";
const KEY_ACCOUNT_RECEIPTS = "DEMOSOLAR_ACCOUNT_RECEIPTS_V1";
const KEY_PURCHASE_VENDORS = "DEMOSOLAR_PURCHASE_VENDORS_V1";
const KEY_PURCHASE_ORDERS = "DEMOSOLAR_PURCHASE_ORDERS_V1";
const KEY_NFC_CARDS = "DEMOSOLAR_NFC_CARDS_V1";
const KEY_SIDEBAR_COLLAPSED = "DEMOSOLAR_ERP_SIDEBAR_COLLAPSED_V1";

let requestsDb = [];
let requestRoutesDb = [];
let activeDeleteMatchedManifests = [];

function applyErpSidebarState(collapsed, persist = false) {
  document.body.classList.toggle("erp-sidebar-collapsed", Boolean(collapsed));
  const toggle = document.getElementById("erpSidebarToggle");
  if (toggle) {
    toggle.textContent = collapsed ? "☰" : "‹";
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.setAttribute("aria-label", collapsed ? "Show navigation" : "Hide navigation");
    toggle.title = collapsed ? "Show navigation" : "Hide navigation";
  }
  if (persist) {
    try { localStorage.setItem(KEY_SIDEBAR_COLLAPSED, collapsed ? "1" : "0"); } catch (_) {}
  }
}

window.toggleErpSidebar = function() {
  if (document.body.classList.contains("demosolar-mobile-app")) {
    document.body.classList.toggle("demosolar-mobile-menu-open");
    return;
  }
  applyErpSidebarState(!document.body.classList.contains("erp-sidebar-collapsed"), true);
};

function initializeErpSidebar() {
  let collapsed = true;
  try {
    const saved = localStorage.getItem(KEY_SIDEBAR_COLLAPSED);
    if (saved !== null) collapsed = saved === "1";
  } catch (_) {}
  applyErpSidebarState(collapsed, false);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeErpSidebar, { once: true });
else initializeErpSidebar();

document.addEventListener("click", event => {
  if (document.body.classList.contains("demosolar-mobile-app") || !window.matchMedia("(max-width: 760px)").matches) return;
  const item = event.target?.closest?.(".sub-item");
  const directMenu = event.target?.closest?.(".menu-btn");
  if (!item && (!directMenu || directMenu.closest(".nav-block")?.querySelector(".submenu"))) return;
  window.setTimeout(() => applyErpSidebarState(true, true), 120);
});

/* =========================================================================
   ENTERPRISE TOAST & IN-PAGE MODAL ENGINE (ZERO NATIVE BROWSER POPUPS)
   ========================================================================= */

// 1. Toast Notification Engine
window.showNotification = function({ title, message, type = "info", duration = 5000 }) {
  const container = document.getElementById("erpToastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `erp-toast toast-${type}`;

  const icons = {
    success: "✓",
    warning: "📩",
    danger: "✕",
    info: "ℹ"
  };

  toast.innerHTML = `
    <div class="toast-header">
      <div class="toast-title">
        <span>${icons[type] || "ℹ"}</span>
        <span>${title}</span>
      </div>
      <button class="toast-close" onclick="this.closest('.erp-toast').remove()">✕</button>
    </div>
    <div class="toast-msg">${message}</div>
    <div class="toast-progress"><div class="toast-progress-bar"></div></div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "toastSlideOut 0.3s ease forwards";
    setTimeout(() => toast.remove(), 300);
  }, duration);
};

window.erpAlert = function(msg, title = "Notification", type = "info") {
  window.showNotification({ title, message: msg, type, duration: 5000 });
};

// 2. Custom Confirm Modal
window.showConfirmDialog = function({ title = "Confirm Action", message, confirmText = "Confirm", isDanger = false }) {
  return new Promise(resolve => {
    const overlay = document.getElementById("erpModalOverlay");
    const tEl = document.getElementById("erpModalTitle");
    const dEl = document.getElementById("erpModalDesc");
    const iGrp = document.getElementById("erpModalInputGroup");
    const bConf = document.getElementById("erpModalBtnConfirm");
    const bCanc = document.getElementById("erpModalBtnCancel");

    if (!overlay) return resolve(false);

    tEl.textContent = title;
    dEl.textContent = message;
    iGrp.style.display = "none";
    bConf.textContent = confirmText;
    bConf.className = isDanger ? "btn btn-danger" : "btn btn-primary";
    if (isDanger) {
      bConf.style.background = "#dc2626";
      bConf.style.color = "#ffffff";
    } else {
      bConf.style.background = "var(--primary)";
      bConf.style.color = "#ffffff";
    }

    overlay.style.display = "flex";

    const cleanup = () => {
      overlay.style.display = "none";
      bConf.onclick = null;
      bCanc.onclick = null;
    };

    bConf.onclick = () => { cleanup(); resolve(true); };
    bCanc.onclick = () => { cleanup(); resolve(false); };
  });
};

// 3. Custom Prompt Modal
window.showPromptDialog = function({ title = "Required Information", message, label = "Enter Reason / Note *", placeholder = "Type here...", defaultValue = "", confirmText = "Submit", isDanger = false }) {
  return new Promise(resolve => {
    const overlay = document.getElementById("erpModalOverlay");
    const tEl = document.getElementById("erpModalTitle");
    const dEl = document.getElementById("erpModalDesc");
    const iGrp = document.getElementById("erpModalInputGroup");
    const lEl = document.getElementById("erpModalInputLabel");
    const inp = document.getElementById("erpModalInput");
    const bConf = document.getElementById("erpModalBtnConfirm");
    const bCanc = document.getElementById("erpModalBtnCancel");

    if (!overlay) return resolve(null);

    tEl.textContent = title;
    dEl.textContent = message;
    lEl.textContent = label;
    inp.value = defaultValue;
    inp.placeholder = placeholder;
    iGrp.style.display = "block";

    bConf.textContent = confirmText;
    bConf.className = isDanger ? "btn btn-danger" : "btn btn-primary";
    if (isDanger) {
      bConf.style.background = "#dc2626";
      bConf.style.color = "#ffffff";
    } else {
      bConf.style.background = "var(--primary)";
      bConf.style.color = "#ffffff";
    }

    overlay.style.display = "flex";
    inp.focus();

    const cleanup = () => {
      overlay.style.display = "none";
      bConf.onclick = null;
      bCanc.onclick = null;
      inp.onkeydown = null;
    };

    const submit = () => {
      const val = inp.value.trim();
      cleanup();
      resolve(val !== "" ? val : null);
    };

    bConf.onclick = submit;
    bCanc.onclick = () => { cleanup(); resolve(null); };
    inp.onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
      else if (e.key === "Escape") { e.preventDefault(); cleanup(); resolve(null); }
    };
  });
};

const APP_MENUS = [
  { id: "dashboard", name: "Dashboard", blockId: "navBlock-dashboard", submenus: [] },
  { id: "warehouse", name: "Warehouse", blockId: "navBlock-warehouse", submenus: [] },
  {
    id: "accounts",
    name: "Accounts",
    blockId: "navBlock-accounts",
    submenus: [
      { id: "accountsDashboard", name: "Dashboard", elementId: "navSub-accountsDashboard" },
      { id: "accountsReimburse", name: "Reimburse", elementId: "navSub-accountsReimburse" },
      { id: "accountsInvoiceLogistics", name: "Invoice & Logistics", elementId: "navSub-accountsInvoiceLogistics" },
      { id: "accountsEditInvoice", name: "Edit Invoice", elementId: "navSub-accountsEditInvoice" },
      { id: "accountsDeleteInvoice", name: "Delete Invoice", elementId: "navSub-accountsDeleteInvoice" },
      { id: "accountsReceipt", name: "Receipt", elementId: "navSub-accountsReceipt" },
      { id: "accountsLedger", name: "Ledger (Customer) — Coming Soon", elementId: "navSub-accountsLedger" },
      { id: "accountsOutstandingReceivable", name: "Outstanding Receivable", elementId: "navSub-accountsOutstandingReceivable" },
      { id: "accountsAdvanceFromCustomer", name: "Advance From Customer", elementId: "navSub-accountsAdvanceFromCustomer" }
    ]
  },
  {
    id: "salesOrders",
    name: "Sales Order",
    blockId: "navBlock-salesOrders",
    submenus: [
      { id: "salesOrderDashboard", name: "Dashboard", elementId: "navSub-salesOrderDashboard" },
      { id: "customerMaster", name: "Customer Master", elementId: "navSub-customerMaster" },
      { id: "salesOrderAdd", name: "Add Sales Order Details", elementId: "navSub-salesOrderAdd" },
      { id: "salesOrderView", name: "View Sales Sheet", elementId: "navSub-salesOrderView" },
      { id: "salesOrderAllocation", name: "Allocate PO / Stock to CO", elementId: "navSub-salesOrderAllocation" },
      { id: "salesOrderSerialTracking", name: "Serial Number Tracking", elementId: "navSub-salesOrderSerialTracking" },
      { id: "salesOrderEdit", name: "Edit Order", elementId: "navSub-salesOrderEdit" },
      { id: "salesOrderDelete", name: "Delete Order", elementId: "navSub-salesOrderDelete" },
      { id: "salesPersonMaster", name: "Sales Person Master", elementId: "navSub-salesPersonMaster" }
    ]
  },
  {
    id: "purchase",
    name: "Purchase",
    blockId: "navBlock-purchase",
    submenus: [
      { id: "purchaseOrder", name: "PO > Purchase Order", elementId: "navSub-purchaseOrder" },
      { id: "purchaseOrderView", name: "PO > View PO", elementId: "navSub-purchaseOrderView" },
      { id: "purchaseOrderEdit", name: "PO > Edit PO", elementId: "navSub-purchaseOrderEdit" },
      { id: "purchaseOrderApprovals", name: "PO > Approve PO", elementId: "navSub-purchaseOrderApprovals" },
      { id: "purchaseOrderDelete", name: "PO > Delete PO", elementId: "navSub-purchaseOrderDelete" },
      { id: "purchaseVendorRegistration", name: "Vendor > Vendor Registration Form", elementId: "navSub-purchaseVendorRegistration" },
      { id: "purchaseVendorMaster", name: "Vendor > Vendor Master", elementId: "navSub-purchaseVendorMaster" },
      { id: "purchaseVendorApprovals", name: "Vendor > Vendor Approvals", elementId: "navSub-purchaseVendorApprovals" },
      { id: "purchasePartCode", name: "RM & Spares > Part Code", elementId: "navSub-purchasePartCode" }
    ]
  },
  {
    id: "production",
    name: "Production",
    blockId: "navBlock-production",
    submenus: [
      { id: "productionDashboard", name: "Dashboard", elementId: "navSub-productionDashboard" },
      { id: "productionViewSheet", name: "View Sheet", elementId: "navSub-productionViewSheet" },
      { id: "productionDailyUpdate", name: "Daily Updation", elementId: "navSub-productionDailyUpdate" },
      { id: "productionAddDetails", name: "Add Details to Sheet", elementId: "navSub-productionAddDetails" },
      { id: "productionEditSheet", name: "Edit Sheet", elementId: "navSub-productionEditSheet" },
      { id: "productionDeleteSheet", name: "Delete Sheet", elementId: "navSub-productionDeleteSheet" }
    ]
  },
  { 
    id: "storePpc", 
    name: "Store & PPC", 
    blockId: "navBlock-storePpc", 
    submenus: [
      { id: "storeCreatePo", name: "Create PO", elementId: "navSub-storeCreatePo" },
      { id: "storeEditPo", name: "Edit PO", elementId: "navSub-storeEditPo" },
      { id: "storeUploadSerial", name: "Upload Serial Number", elementId: "navSub-storeUploadSerial" },
      { id: "storeEditSerial", name: "Edit Serial Number", elementId: "navSub-storeEditSerial" },
      { id: "storeDeleteSerial", name: "Delete Serial Number", elementId: "navSub-storeDeleteSerial" },
      { id: "storeDeletePo", name: "Delete PO", elementId: "navSub-storeDeletePo" }
    ] 
  },
  {
    id: "packing",
    name: "Packing Operations",
    blockId: "navBlock-packing",
    submenus: [
      { id: "packingScan", name: "Scan & Palletize", elementId: "navSub-packingScan" },
      { id: "packingRework", name: "Rework", elementId: "navSub-packingRework" },
      { id: "packingEditPallet", name: "Edit Pallet", elementId: "navSub-packingEditPallet" },
      { id: "packingDeletePallet", name: "Delete Pallet", elementId: "navSub-packingDeletePallet" },
      { id: "packingClosePo", name: "Close PO", elementId: "navSub-packingClosePo" }  
    ]
  },
  {
    id: "dispatch",
    name: "Dispatch Operation",
    blockId: "navBlock-dispatch",
    submenus: [
      { id: "dispatchChallan", name: "PACKING LIST", elementId: "navSub-dispatchChallan" },
      { id: "dispatchBookedStock", name: "Booked Stock", elementId: "navSub-dispatchBookedStock" },
      { id: "dispatchViewList", name: "VIEW PACKING LIST", elementId: "navSub-dispatchViewList" },
      { id: "dispatchRouteFare", name: "Route Register", elementId: "navSub-dispatchRouteFare" },
      { id: "dispatchBookVehicle", name: "Book Vehicle", elementId: "navSub-dispatchBookVehicle" },
      { id: "dispatchDelete", name: "Delete Dispatch", elementId: "navSub-dispatchDelete" },
      { id: "transporterView", name: "Transporter > View Transporter", elementId: "navSub-transporterView" },
      { id: "transporterAdd", name: "Transporter > Add Transporter", elementId: "navSub-transporterAdd" },
      { id: "transporterEdit", name: "Transporter > Edit Transporter", elementId: "navSub-transporterEdit" },
      { id: "transporterDelete", name: "Transporter > Delete Transporter", elementId: "navSub-transporterDelete" },
      { id: "driverView", name: "Drivers > View Driver", elementId: "navSub-driverView" },
      { id: "driverAdd", name: "Drivers > Add Driver", elementId: "navSub-driverAdd" },
      { id: "driverEdit", name: "Drivers > Edit Driver", elementId: "navSub-driverEdit" },
      { id: "driverDelete", name: "Drivers > Delete Driver", elementId: "navSub-driverDelete" }
    ]
  },
  {
    id: "requests",
    name: "Requests",
    blockId: "navBlock-requests",
    submenus: [
      { id: "requestsTrack", name: "Track Requests", elementId: "navSub-requestsTrack" },
      { id: "requestsApprove", name: "Approve Requests", elementId: "navSub-requestsApprove" },
      { id: "requestRoutes", name: "Request Routes", elementId: "navSub-requestRoutes" }
    ]
  },
  {
    id: "products",
    name: "Products",
    blockId: "navBlock-products",
    submenus: [
      { id: "productsView", name: "View Products", elementId: "navSub-productsView" },
      { id: "productsAdd", name: "Add Product", elementId: "navSub-productsAdd" },
      { id: "productsEdit", name: "Edit Product", elementId: "navSub-productsEdit" },
      { id: "productsDelete", name: "Delete Product", elementId: "navSub-productsDelete" }
    ]
  },
  {
    id: "it",
    name: "IT",
    blockId: "navBlock-it",
    submenus: [
      { id: "adminUsers", name: "User Management > All Users", elementId: "navSub-adminUsers" },
      { id: "adminAddUser", name: "User Management > Add New User", elementId: "navSub-adminAddUser" },
      { id: "adminEditUser", name: "User Management > Edit User", elementId: "navSub-adminEditUser" },
      { id: "adminDeleteUser", name: "User Management > Delete User", elementId: "navSub-adminDeleteUser" },
      { id: "adminUserRights", name: "User Management > User Rights", elementId: "navSub-adminUserRights" },
      { id: "itSecuritySessions", name: "User Management > Security & Sessions", elementId: "navSub-itSecuritySessions" },
      { id: "itRoleTemplates", name: "User Management > Role Templates", elementId: "navSub-itRoleTemplates" },
      { id: "itEffectiveAccess", name: "User Management > Effective Access", elementId: "navSub-itEffectiveAccess" },
      { id: "itAssetDashboard", name: "Asset Management > IT Dashboard", elementId: "navSub-itAssetDashboard" },
      { id: "itAssetMaster", name: "Asset Management > Asset Master", elementId: "navSub-itAssetMaster" },
      { id: "itAssetAllocation", name: "Asset Management > Allocation / Return", elementId: "navSub-itAssetAllocation" },
      { id: "itPerformance", name: "Server Performance", elementId: "navSub-itPerformance" },
      { id: "nfcCards", name: "NFC Cards", elementId: "navSub-nfcCards" }
    ]
  },
  {
    id: "hr",
    name: "HR",
    blockId: "navBlock-hr",
    submenus: [
      { id: "departmentView", name: "Department Master > View Department", elementId: "navSub-departmentView" },
      { id: "departmentAdd", name: "Department Master > Add Department", elementId: "navSub-departmentAdd" },
      { id: "departmentEdit", name: "Department Master > Edit Department", elementId: "navSub-departmentEdit" },
      { id: "departmentDelete", name: "Department Master > Delete Department", elementId: "navSub-departmentDelete" },
      { id: "designationView", name: "Designation Master > View Designation", elementId: "navSub-designationView" },
      { id: "designationAdd", name: "Designation Master > Add Designation", elementId: "navSub-designationAdd" },
      { id: "designationEdit", name: "Designation Master > Edit Designation", elementId: "navSub-designationEdit" },
      { id: "designationDelete", name: "Designation Master > Delete Designation", elementId: "navSub-designationDelete" },
      { id: "hrEmployeeAdd", name: "Employee Master > Add Employee", elementId: "navSub-hrEmployeeAdd" },
      { id: "hrEmployeeEdit", name: "Employee Master > Edit Employee", elementId: "navSub-hrEmployeeEdit" },
      { id: "hrEmployeeDelete", name: "Employee Master > Delete Employee", elementId: "navSub-hrEmployeeDelete" },
      { id: "hrAttendanceView", name: "Attendance > View Attendance", elementId: "navSub-hrAttendanceView" },
      { id: "hrAttendanceManual", name: "Attendance > Manual Attendance", elementId: "navSub-hrAttendanceManual" },
      { id: "hrTourExpensesApprove", name: "Expense Approvals", elementId: "navSub-hrTourExpensesApprove" }
    ]
  },
  {
    id: "tripExpenses",
    name: "Expenses",
    blockId: "navBlock-tripExpenses",
    submenus: [
      { id: "hrTourExpenses", name: "Expenses > My Trips", elementId: "navSub-hrTourExpenses" },
      { id: "expensesRecharge", name: "Expenses > Recharge", elementId: "navSub-expensesRecharge" }
    ]
  },
  {
    id: "utilities",
    name: "Utilities",
    blockId: "navBlock-utilities",
    submenus: [
      { id: "utilitiesPdfStudio", name: "PDF Studio", elementId: "navSub-utilitiesPdfStudio" },
      { id: "utilitiesImageOptimizer", name: "Image Optimizer", elementId: "navSub-utilitiesImageOptimizer" },
      { id: "utilitiesCodeMaker", name: "QR & Barcode Maker", elementId: "navSub-utilitiesCodeMaker" },
      { id: "utilitiesSavedDocuments", name: "Saved Documents", elementId: "navSub-utilitiesSavedDocuments" }
    ]
  },
  {
    id: "cctv",
    name: "CCTV Monitoring",
    blockId: "navBlock-cctv",
    submenus: [
      { id: "cctvLive", name: "Live Cameras", elementId: "navSub-cctvLive" },
      { id: "cctvPlayback", name: "Recording Playback", elementId: "navSub-cctvPlayback" }
    ]
  },
  {
    id: "reports",
    name: "Reports Hub",
    blockId: "navBlock-reports",
    submenus: []
  },
  {
    id: "logs",
    name: "Logs",
    blockId: "navBlock-logs",
    submenus: []
  }
];

window.canReviewVendorApplications = function(user = currentLoggedInUser) {
  if (!user) return false;
  const role = String(user.role || "").trim().toLowerCase();
  return role === "admin" || user.rights?.purchaseVendorApprovals === true;
};

window.canApprovePurchaseOrders = function(user = currentLoggedInUser) {
  if (!user) return false;
  return String(user.role || "").trim().toLowerCase() === "admin"
    && user.rights?.purchaseOrderApprovals !== false;
};

const defaultUsers = [];
/* Demo account credentials are intentionally not included. */

const erpReadRequests = new Map();
const erpWriteRequests = new Map();
let erpCsrfToken = "";
let erpLastActionButton = null;
let erpLastActionAt = 0;

document.addEventListener("click", event => {
  const button = event.target?.closest?.("button, input[type='submit'], input[type='button'], [role='button']");
  if (!button) return;
  erpLastActionButton = button;
  erpLastActionAt = Date.now();
}, true);

async function erpFetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = options.signal;
  const abortFromExternal = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", abortFromExternal, { once: true });
  }
  try {
    const headers = new Headers(options.headers || {});
    const method = String(options.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD" && erpCsrfToken) headers.set("X-ERP-CSRF-Token", erpCsrfToken);
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
    const refreshedToken = response.headers.get("X-ERP-CSRF-Token");
    if (refreshedToken) erpCsrfToken = refreshedToken;
    return response;
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener?.("abort", abortFromExternal);
  }
}

function runDeduplicatedRead(key, readOperation) {
  if (erpReadRequests.has(key)) {
    if (window.erpPerformanceStats) window.erpPerformanceStats.readRequestsDeduplicated += 1;
    return erpReadRequests.get(key);
  }
  const request = Promise.resolve().then(readOperation).finally(() => erpReadRequests.delete(key));
  erpReadRequests.set(key, request);
  return request;
}

function erpReadResponse(key, url, options = {}, timeoutMs = 12000) {
  return runDeduplicatedRead(`read:${key}`, async () => {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await erpFetchWithTimeout(url, options, timeoutMs);
        if (response.status < 500 || attempt === 1) return response;
        lastError = new Error(`Read temporarily unavailable (${response.status})`);
      } catch (error) {
        lastError = error;
        if (attempt === 1 || !navigator.onLine) throw error;
      }
      await new Promise(resolve => window.setTimeout(resolve, 250));
    }
    throw lastError || new Error("ERP data could not be loaded.");
  });
}

function lockCurrentActionButton(scope) {
  const active = document.activeElement?.closest?.("button, input[type='submit'], input[type='button'], [role='button']");
  const button = active || (Date.now() - erpLastActionAt < 1200 ? erpLastActionButton : null);
  if (!button || button.disabled) return () => {};
  const priorDisabled = button.disabled;
  const priorBusy = button.getAttribute("aria-busy");
  const priorTitle = button.getAttribute("title");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  const slowNotice = window.setTimeout(() => {
    button.title = "Still processing securely. Please do not close or refresh this page.";
    window.showNotification?.({ title: "Still Processing", message: "The server is taking longer than usual. Your action is still running; please do not submit it again.", type: "warning", duration: 5000 });
  }, 5000);
  return () => {
    window.clearTimeout(slowNotice);
    button.disabled = priorDisabled;
    if (priorBusy === null) button.removeAttribute("aria-busy"); else button.setAttribute("aria-busy", priorBusy);
    if (priorTitle === null) button.removeAttribute("title"); else button.setAttribute("title", priorTitle);
    if (erpLastActionButton === button) erpLastActionButton = null;
  };
}

function runProtectedWrite(scope, signature, writeOperation) {
  const active = erpWriteRequests.get(scope);
  if (active) {
    if (window.erpPerformanceStats) window.erpPerformanceStats.duplicateWritesPrevented += 1;
    if (active.signature === signature) return active.promise;
    window.showNotification?.({ title: "Please Wait", message: "A save for this section is already processing. Nothing was submitted twice.", type: "warning" });
    return Promise.resolve(false);
  }
  const unlock = lockCurrentActionButton(scope);
  const promise = Promise.resolve().then(writeOperation).finally(() => {
    erpWriteRequests.delete(scope);
    unlock();
  });
  erpWriteRequests.set(scope, { signature, promise });
  return promise;
}

async function loadStorage(k, fb) {
  try {
    const res = await erpReadResponse(`storage:${k}`, `backend/api.php?key=${encodeURIComponent(k)}`, { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return fb;
    const version = res.headers.get("X-ERP-Storage-Version");
    if (version) liveSyncVersions[k] = version;
    const data = await res.json();
    return data !== null ? data : fb;
  } catch (err) {
    return fb;
  }
}

let storageBatchBuffer = null;
let storageBatchAuditBuffer = [];
let storageBatchBaseline = null;
let activeApprovalRequestId = "";
function approvalRecordKey(record, position) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  for (const field of ["id", "coNumber", "invoiceNumber", "invoice", "pallet", "poNumber", "username", "gst", "name"]) {
    const value = String(record[field] ?? "").trim();
    if (value) return `${field.toUpperCase()}:${value.slice(0, 150).toUpperCase()}`;
  }
  return null;
}
function approvalRecordIndex(rows) {
  if (!Array.isArray(rows)) return null;
  const order = [], hashes = new Map(), seen = new Set();
  for (let position = 0; position < rows.length; position += 1) {
    let key = approvalRecordKey(rows[position], position);
    if (!key) return null;
    if (seen.has(key)) key += `:${position + 1}`;
    seen.add(key); order.push(key); hashes.set(key, erpRecordHash(rows[position]));
  }
  return { order, hashes };
}
function beginStorageBatch(approvalRequestId = "") {
  storageBatchBuffer = new Map(); storageBatchAuditBuffer = []; storageBatchBaseline = new Map();
  activeApprovalRequestId = String(approvalRequestId || "").trim();
  Object.entries(ERP_MODULE_STATE).forEach(([key, state]) => {
    const index = approvalRecordIndex(state.get());
    if (index) storageBatchBaseline.set(key, index);
  });
}
function discardStorageBatch() { storageBatchBuffer = null; storageBatchAuditBuffer = []; storageBatchBaseline = null; activeApprovalRequestId = ""; }
function buildApprovalRecordPatch(key, rows) {
  return buildRecordPatchFromBaseline(storageBatchBaseline?.get(key), rows);
}
function buildRecordPatchFromBaseline(baseline, rows) {
  const current = approvalRecordIndex(rows);
  if (!baseline || !current) return null;
  const items = {};
  current.order.forEach((recordKey, position) => {
    if (baseline.hashes.get(recordKey) !== current.hashes.get(recordKey)) items[recordKey] = rows[position];
  });
  return { mode: "record-key-v1", order: current.order, items };
}
async function buildApprovalRequestPayload(payload) {
  const json = JSON.stringify(payload);
  const headers = { "Content-Type": "application/json" };
  if (json.length < 262144 || typeof CompressionStream !== "function") return { body: json, headers };
  try {
    const source = new Blob([json], { type: "application/json" }).stream();
    const compressed = await new Response(source.pipeThrough(new CompressionStream("gzip"))).blob();
    return {
      body: compressed,
      headers: { "Content-Type": "application/octet-stream", "X-ERP-Content-Encoding": "gzip" }
    };
  } catch (error) {
    console.warn("Approval request compression used the JSON fallback.", error);
    return { body: json, headers };
  }
}
async function commitStorageBatch() {
  if (!(storageBatchBuffer instanceof Map) || storageBatchBuffer.size === 0) { discardStorageBatch(); return true; }
  const unlock = lockCurrentActionButton("transaction:batch_save");
  const changes = {}, patches = {};
  const canPatch = String(currentLoggedInUser?.role || "").toLowerCase() === "admin" || currentLoggedInUser?.rights?.requestsApprove === true || currentLoggedInUser?.rights?.requestRouteAssignee === true;
  storageBatchBuffer.forEach((rows, key) => {
    const patch = canPatch ? buildApprovalRecordPatch(key, rows) : null;
    if (patch && (activeApprovalRequestId || JSON.stringify(patch).length < JSON.stringify(rows).length)) patches[key] = patch;
    else changes[key] = rows;
  });
  const expectedVersions = Object.fromEntries([...storageBatchBuffer.keys()].map(key => [key, liveSyncVersions[key] || ""]));
  const pendingKeys = [...storageBatchBuffer.keys()];
  const approvalRequestId = activeApprovalRequestId;
  activeApprovalRequestId = "";
  const pendingAudit = storageBatchAuditBuffer.slice();
  storageBatchBuffer = null; storageBatchAuditBuffer = []; storageBatchBaseline = null;
  try {
    const auditEvents = pendingAudit.map(entry => ({ department: entry.dept, actionCode: entry.action, details: entry.details }));
    const requestPayload = await buildApprovalRequestPayload({ operation:"batch_save", approvalRequestId, changes, patches, expectedVersions, auditEvents });
    const response = await erpFetchWithTimeout("backend/api.php?action=transaction", { method:"POST", headers:requestPayload.headers, credentials:"same-origin", body:requestPayload.body }, 30000);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.status !== "success") throw new Error(result?.message || "Atomic approval transaction failed.");
    Object.assign(liveSyncVersions, result?.data?.versions || {});
    pendingKeys.forEach(key => {
      const baseline = approvalRecordIndex(ERP_MODULE_STATE[key]?.get());
      if (baseline) moduleWriteBaselines.set(key, baseline); else moduleWriteBaselines.delete(key);
    });
    if (pendingKeys.includes(KEY_STOCK) || pendingKeys.includes(KEY_DISPATCH_ARCHIVE)) invalidatePackingUsageIndexes();
    return true;
  } catch (error) {
    console.error("Atomic ERP Save Error:", error);
    window.showNotification({ title:"Nothing Was Changed", message:error?.message || "The complete approval transaction was rolled back.", type:"danger" });
    return false;
  } finally {
    unlock();
  }
}
async function runStorageBatch(work) {
  if (storageBatchBuffer instanceof Map) { await work(); return true; }
  beginStorageBatch();
  try { await work(); return await commitStorageBatch(); }
  finally { if (storageBatchBuffer instanceof Map) discardStorageBatch(); }
}

async function saveStorage(k, d) {
  if (storageBatchBuffer instanceof Map) { storageBatchBuffer.set(k, JSON.parse(JSON.stringify(d))); return true; }
  if (k === KEY_REQUESTS && Array.isArray(d)) {
    const username = String(currentLoggedInUser?.username || "").trim();
    const department = String(currentLoggedInUser?.department || currentLoggedInUser?.role || "").trim();
    const userId = String(currentLoggedInUser?.id || "").trim();
    const baseline = moduleWriteBaselines.get(KEY_REQUESTS);
    d.forEach((request, position) => {
      if (!request || String(request.requestedBy || "").toLowerCase() !== username.toLowerCase()) return;
      const recordKey = approvalRecordKey(request, position);
      if (recordKey && baseline?.hashes?.has(recordKey)) return;
      if (!request.department) request.department = department;
      if (!request.requesterUserId) request.requesterUserId = userId;
    });
  }
  if (k === KEY_STOCK || k === KEY_DISPATCH_ARCHIVE) invalidatePackingUsageIndexes();
  const fullPayload = { value: d, expectedVersion: liveSyncVersions[k] || "" };
  const patch = k === KEY_USERS ? null : buildRecordPatchFromBaseline(moduleWriteBaselines.get(k), d);
  const patchPayload = patch ? { patch, expectedVersion: liveSyncVersions[k] || "" } : null;
  const fullJson = JSON.stringify(fullPayload);
  const patchJson = patchPayload ? JSON.stringify(patchPayload) : "";
  const payload = patchPayload && (k === KEY_REQUESTS || patchJson.length < fullJson.length) ? patchPayload : fullPayload;
  const signature = `${liveSyncVersions[k] || ""}:${erpRecordHash(payload)}`;
  return runProtectedWrite(`storage:${k}`, signature, async () => {
    try {
      const requestPayload = await buildApprovalRequestPayload(payload);
      const response = await erpFetchWithTimeout(`backend/api.php?key=${encodeURIComponent(k)}`, {
        method: "POST",
        headers: requestPayload.headers,
        credentials: "same-origin",
        body: requestPayload.body
      }, 30000);
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.status !== "success") throw new Error(result?.message || `Storage write failed (${response.status})`);
      if (result?.version) liveSyncVersions[k] = result.version;
      const baseline = approvalRecordIndex(d);
      if (baseline) moduleWriteBaselines.set(k, baseline); else moduleWriteBaselines.delete(k);
      return true;
    } catch (err) {
      console.error("Storage Save Error:", err);
      if (err?.name === "AbortError") {
        window.showNotification({ title: "Save Timed Out", message: "The server did not confirm the save in time. It was not automatically submitted again; refresh the data before retrying.", type: "danger" });
      } else if (err?.message?.includes("changed on another screen")) {
        window.showNotification({ title: "Live Data Changed", message: "Another user saved newer data. Refresh this screen before trying again; your entry was not saved.", type: "warning" });
      }
      return false;
    }
  });
}

async function runErpTransaction(operation, payload) {
  const body = JSON.stringify({ operation, ...payload });
  return runProtectedWrite(`transaction:${operation}`, body, async () => {
    try {
      const response = await erpFetchWithTimeout("backend/api.php?action=transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body
      }, 45000);
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.status !== "success") {
        throw new Error(result?.message || `ERP transaction failed (${response.status})`);
      }
      return result.data;
    } catch (error) {
      console.error("ERP Transaction Error:", error);
      const message = error?.name === "AbortError"
        ? "The server did not confirm this transaction in time. It was not automatically repeated; refresh before trying again."
        : (error.message || "No ERP data was changed. Refresh and try again.");
      window.showNotification({ title: "Transaction Not Saved", message, type: "danger" });
      return null;
    }
  });
}

let usersDb = [];
let productsDb = [];
let poDatabase = [];
let godownStock = [];
let dispatchArchive = [];
let auditLogs = [];
let transportersDb = [];
let driversDb = [];
let storeSerialsDb = [];

let currentLoggedInUser = null;
let activeSerials = [];
let activeMaxCapacity = 36;
let activePalletPo = "";
let activeLockedWatt = "625w - TOPCON";
let dispatchPallets = [];
let stockBookings = [];
let salesOrders = [];
let accountInvoices = [];
let accountsDashboardDetailType = "outstanding";
let productionDashboardDetailType = "orders";
let customersDb = [];
let salesPeople = [];
let salesCoRegistry = [];
let coAllocations = [];
let editingSalesOrderId = "";
let editingAccountInvoiceId = "";
let salesOrderProductLines = [];
let accountInvoiceProductLines = [];
let accountSelectedProductLineId = "";
let departmentsDb = [];
let designationsDb = [];
let routeFaresDb = [];
let vehicleBookingsDb = [];
let productionSheetDb = [];
let productionDailyDb = [];
let accountReceiptsDb = [];
let purchaseVendorsDb = [];
let purchaseOrdersDb = [];
let nfcCardsDb = [];
let selectedReceiptCustomerId = "";
let productionFormMode = "add";
let salesCertificatePaths = [];
let salesCertificateCoNumber = "";
let bookedStockDraftPallets = [];
let currentUploadedRawPhotos = [];
let currentReworkPallet = null;
let selectedReworkSerials = new Set();
let activeMultiSearchedManifests = [];
let parsedStoreExcelSerials = [];
let parsedPackingBulkSerials = [];
let currentEditSerialTarget = null;
let currentDeleteSerialTarget = null;
let selectedDeleteSerials = new Set();
let selectedDeletePallets = new Set();
let currentActiveViewId = "dashboard";
let viewNavigationSequence = 0;
let liveSyncInProgress = false;
let liveSyncVersions = {};
let liveRecordHashes = {};
let liveSyncTimer = null;
let liveSyncFailureCount = 0;
let liveSyncEmptyCount = 0;
let lastLiveSyncAt = 0;
window.erpPerformanceStats = {
  startedAt: new Date().toISOString(), liveSyncRequests: 0, liveSyncChanges: 0,
  liveSyncFailures: 0, liveSyncAverageMs: 0, liveSyncLastMs: 0,
  longTasks: 0, longestTaskMs: 0, readRequestsDeduplicated: 0,
  duplicateWritesPrevented: 0, liveRendersQueued: 0, liveRendersExecuted: 0,
  liveRendersCoalesced: 0, dashboardDomWrites: 0, dashboardDomWritesSkipped: 0
};
let palletSealInProgress = false;
let authorizedModuleKeys = new Set();
let loadedModuleKeys = new Set();
const moduleBundleInFlight = new Map();
const moduleWriteBaselines = new Map();
let pendingRequestRouteBootstrap = null;

// Central data-module registry. Every current and future department must declare
// its view dependencies here so login, navigation and live sync load only the
// records the signed-in user's server-side rights allow.
const ERP_MODULE_STATE = {
  [KEY_USERS]: { get: () => usersDb, set: value => { usersDb = Array.isArray(value) ? value : []; } },
  [KEY_NFC_CARDS]: { get: () => nfcCardsDb, set: value => { nfcCardsDb = Array.isArray(value) ? value : []; } },
  [KEY_PRODUCTS]: { get: () => productsDb, set: value => { productsDb = Array.isArray(value) ? value : []; } },
  [KEY_POS]: { get: () => poDatabase, set: value => { poDatabase = Array.isArray(value) ? value : []; } },
  [KEY_STOCK]: { get: () => godownStock, set: value => { godownStock = Array.isArray(value) ? value : []; } },
  [KEY_DISPATCH_ARCHIVE]: { get: () => dispatchArchive, set: value => { dispatchArchive = Array.isArray(value) ? value : []; } },
  [KEY_TRANSPORTERS]: { get: () => transportersDb, set: value => { transportersDb = Array.isArray(value) ? value : []; } },
  [KEY_DRIVERS]: { get: () => driversDb, set: value => { driversDb = Array.isArray(value) ? value : []; } },
  [KEY_STORE_SERIALS]: { get: () => storeSerialsDb, set: value => { storeSerialsDb = Array.isArray(value) ? value : []; } },
  [KEY_REQUESTS]: { get: () => requestsDb, set: value => { requestsDb = Array.isArray(value) ? value : []; } },
  [KEY_REQUEST_ROUTES]: { get: () => requestRoutesDb, set: value => { requestRoutesDb = Array.isArray(value) ? value : []; } },
  [KEY_STOCK_BOOKINGS]: { get: () => stockBookings, set: value => { stockBookings = Array.isArray(value) ? value : []; } },
  [KEY_SALES_ORDERS]: { get: () => salesOrders, set: value => { salesOrders = Array.isArray(value) ? value : []; } },
  [KEY_ACCOUNT_INVOICES]: { get: () => accountInvoices, set: value => { accountInvoices = Array.isArray(value) ? value : []; } },
  [KEY_CUSTOMERS]: { get: () => customersDb, set: value => { customersDb = Array.isArray(value) ? value : []; } },
  [KEY_SALES_PEOPLE]: { get: () => salesPeople, set: value => { salesPeople = Array.isArray(value) ? value : []; } },
  [KEY_SALES_CO_REGISTRY]: { get: () => salesCoRegistry, set: value => { salesCoRegistry = Array.isArray(value) ? value : []; } },
  [KEY_CO_ALLOCATIONS]: { get: () => coAllocations, set: value => { coAllocations = Array.isArray(value) ? value : []; } },
  [KEY_DEPARTMENTS]: { get: () => departmentsDb, set: value => { departmentsDb = Array.isArray(value) ? value : []; } },
  [KEY_DESIGNATIONS]: { get: () => designationsDb, set: value => { designationsDb = Array.isArray(value) ? value : []; } },
  [KEY_ROUTE_FARES]: { get: () => routeFaresDb, set: value => { routeFaresDb = Array.isArray(value) ? value : []; } },
  [KEY_VEHICLE_BOOKINGS]: { get: () => vehicleBookingsDb, set: value => { vehicleBookingsDb = Array.isArray(value) ? value : []; } },
  [KEY_PRODUCTION_SHEET]: { get: () => productionSheetDb, set: value => { productionSheetDb = Array.isArray(value) ? value : []; } },
  [KEY_PRODUCTION_DAILY]: { get: () => productionDailyDb, set: value => { productionDailyDb = Array.isArray(value) ? value : []; } },
  [KEY_ACCOUNT_RECEIPTS]: { get: () => accountReceiptsDb, set: value => { accountReceiptsDb = Array.isArray(value) ? value : []; } },
  [KEY_PURCHASE_VENDORS]: { get: () => purchaseVendorsDb, set: value => { purchaseVendorsDb = Array.isArray(value) ? value : []; } },
  [KEY_PURCHASE_ORDERS]: { get: () => purchaseOrdersDb, set: value => { purchaseOrdersDb = Array.isArray(value) ? value : []; } }
};

const COMMON_LIVE_MODULES = [KEY_USERS, KEY_REQUESTS];
const ALL_OPERATIONAL_MODULES = Object.keys(ERP_MODULE_STATE);

function getViewModuleKeys(viewId) {
  const view = String(viewId || "");
  if (view === "dashboardPacking") return [KEY_STOCK];
  if (view === "dashboardDispatch") return [KEY_STOCK, KEY_DISPATCH_ARCHIVE];
  if (view === "dashboardAdmin") return [KEY_POS, KEY_STOCK, KEY_DISPATCH_ARCHIVE];
  if (view === "warehouse") return [KEY_STOCK, KEY_STOCK_BOOKINGS, KEY_CO_ALLOCATIONS];
  if (view === "accountsDashboard") return [KEY_SALES_ORDERS, KEY_ACCOUNT_INVOICES, KEY_ACCOUNT_RECEIPTS, KEY_CUSTOMERS, KEY_SALES_PEOPLE];
  if (view === "accounts") return [KEY_SALES_ORDERS, KEY_ACCOUNT_INVOICES, KEY_CUSTOMERS, KEY_TRANSPORTERS];
  if (view === "accountsEditInvoice" || view === "accountsDeleteInvoice") return [KEY_SALES_ORDERS, KEY_ACCOUNT_INVOICES, KEY_TRANSPORTERS, KEY_DISPATCH_ARCHIVE];
  if (view === "accountsReceipt") return [KEY_SALES_ORDERS, KEY_ACCOUNT_INVOICES, KEY_ACCOUNT_RECEIPTS, KEY_CUSTOMERS, KEY_SALES_PEOPLE];
  if (["accountsReports", "accountsOutstandingReceivable", "accountsAdvanceFromCustomer"].includes(view)) return [KEY_ACCOUNT_INVOICES, KEY_ACCOUNT_RECEIPTS];
  if (view === "purchaseVendorRegistration" || view === "purchaseVendorMaster") return [KEY_PURCHASE_VENDORS];
  if (view === "purchaseOrder") return [KEY_PURCHASE_VENDORS, KEY_PURCHASE_ORDERS];
  if (view === "purchaseOrderView" || view === "purchaseOrderEdit" || view === "purchaseOrderApprovals" || view === "purchaseOrderDelete") return [KEY_PURCHASE_ORDERS];
  if (view === "purchasePartCode") return [];
  if (view === "salesOrderSerialTracking") return [KEY_PRODUCTS, KEY_POS, KEY_STORE_SERIALS, KEY_STOCK, KEY_DISPATCH_ARCHIVE, KEY_SALES_ORDERS, KEY_ACCOUNT_INVOICES, KEY_CUSTOMERS, KEY_SALES_PEOPLE, KEY_CO_ALLOCATIONS];
  if (view.startsWith("salesOrder") || view === "customerMaster" || view === "salesPersonMaster") return [KEY_PRODUCTS, KEY_SALES_ORDERS, KEY_CUSTOMERS, KEY_SALES_PEOPLE, KEY_SALES_CO_REGISTRY, KEY_CO_ALLOCATIONS, KEY_DISPATCH_ARCHIVE, KEY_ACCOUNT_INVOICES];
  if (view === "storeDeleteSerial") return [KEY_PRODUCTS, KEY_POS, KEY_STORE_SERIALS, KEY_STOCK, KEY_DISPATCH_ARCHIVE, KEY_PRODUCTION_SHEET];
  if (view.startsWith("store")) return [KEY_PRODUCTS, KEY_POS, KEY_STORE_SERIALS, KEY_STOCK, KEY_PRODUCTION_SHEET];
  if (view.startsWith("packing")) return [KEY_PRODUCTS, KEY_POS, KEY_STORE_SERIALS, KEY_STOCK, KEY_DISPATCH_ARCHIVE, KEY_PRODUCTION_SHEET, KEY_STOCK_BOOKINGS];
  if (view.startsWith("transporter")) return [KEY_TRANSPORTERS];
  if (view.startsWith("driver")) return [KEY_DRIVERS, KEY_TRANSPORTERS];
  if (view.startsWith("dispatch")) return [KEY_PRODUCTS, KEY_POS, KEY_STOCK, KEY_DISPATCH_ARCHIVE, KEY_STOCK_BOOKINGS, KEY_TRANSPORTERS, KEY_DRIVERS, KEY_ROUTE_FARES, KEY_VEHICLE_BOOKINGS, KEY_SALES_ORDERS, KEY_ACCOUNT_INVOICES, KEY_SALES_CO_REGISTRY, KEY_CO_ALLOCATIONS];
  if (view.startsWith("production")) return [KEY_POS, KEY_STORE_SERIALS, KEY_STOCK, KEY_DISPATCH_ARCHIVE, KEY_SALES_ORDERS, KEY_PRODUCTION_SHEET, KEY_PRODUCTION_DAILY];
  // The approval inbox itself needs only request records. The affected
  // department modules are loaded when an approver opens one specific action.
  if (view === "requestRoutes") return [KEY_REQUEST_ROUTES, KEY_USERS, KEY_DEPARTMENTS, KEY_DESIGNATIONS];
  if (view === "requestsApprove") return [KEY_REQUESTS];
  if (view.startsWith("requests")) return [KEY_REQUESTS];
  if (view.startsWith("department")) return [KEY_DEPARTMENTS];
  if (view.startsWith("designation")) return [KEY_DESIGNATIONS, KEY_DEPARTMENTS];
  if (view.startsWith("products")) return [KEY_PRODUCTS];
  if (view === "adminNfcCards") return [KEY_NFC_CARDS];
  if (view.startsWith("admin")) return [KEY_USERS, KEY_DEPARTMENTS, KEY_DESIGNATIONS];
  if (view === "logs") return [KEY_LOGS];
  if (view === "reportsPacking" || view === "reportsCustom") return [KEY_STOCK, KEY_DISPATCH_ARCHIVE];
  if (view === "reportsDispatch") return [KEY_DISPATCH_ARCHIVE];
  // The Reports Hub landing page uses a compact SQL aggregate. Detailed
  // operational modules are loaded only after a department is selected.
  if (view === "reportsHub") return [KEY_DEPARTMENTS];
  if (view.startsWith("reports")) return ALL_OPERATIONAL_MODULES;
  return [];
}

function approvalModuleKeys(request) {
  const type = String(request?.type || "").toUpperCase();
  if (["DELETE_SERIALS_MULTI", "DELETE_SERIAL"].includes(type)) return [KEY_STORE_SERIALS, KEY_STOCK, KEY_DISPATCH_ARCHIVE, KEY_POS];
  if (["EDIT_PALLET", "DELETE_PALLETS_MULTI", "DELETE_PALLET"].includes(type)) return [KEY_STOCK, KEY_STOCK_BOOKINGS, KEY_POS];
  if (["DELETE_DISPATCH_PALLETS_MULTI", "DELETE_DISPATCH_FULL", "DELETE_DISPATCH_BULK"].includes(type)) return [KEY_STOCK, KEY_DISPATCH_ARCHIVE, KEY_ACCOUNT_INVOICES, KEY_SALES_ORDERS, KEY_STOCK_BOOKINGS];
  if (type === "ALLOCATE_PO_TO_CO") return [KEY_SALES_ORDERS, KEY_CO_ALLOCATIONS, KEY_SALES_CO_REGISTRY];
  if (["EDIT_ACCOUNT_RECEIPT", "DELETE_ACCOUNT_RECEIPT"].includes(type)) return [KEY_ACCOUNT_RECEIPTS];
  if (["EDIT_ACCOUNT_INVOICE", "DELETE_ACCOUNT_INVOICE"].includes(type)) return [KEY_ACCOUNT_INVOICES, KEY_SALES_ORDERS, KEY_DISPATCH_ARCHIVE, KEY_VEHICLE_BOOKINGS];
  if (["EDIT_SALES_ORDER", "DELETE_SALES_ORDER"].includes(type)) return [KEY_SALES_ORDERS, KEY_CO_ALLOCATIONS, KEY_SALES_CO_REGISTRY, KEY_ACCOUNT_INVOICES, KEY_DISPATCH_ARCHIVE];
  if (["EDIT_PRODUCTION_SHEET", "DELETE_PRODUCTION_SHEET"].includes(type)) return [KEY_PRODUCTION_SHEET];
  if (type === "DELETE_PO") return [KEY_POS, KEY_STORE_SERIALS, KEY_STOCK, KEY_DISPATCH_ARCHIVE, KEY_PRODUCTION_SHEET, KEY_STOCK_BOOKINGS];
  return [];
}

async function ensureApprovalRequestModules(request) {
  const needed = approvalModuleKeys(request).filter(key => !loadedModuleKeys.has(key) && (!authorizedModuleKeys.size || authorizedModuleKeys.has(key)));
  if (needed.length) await loadModuleBundle(needed);
}

function getGlobalNotificationModuleKeys(user) {
  const role = String(user?.role || "").toLowerCase();
  const rights = user?.rights || {};
  return role === "admin" || rights.purchaseOrder === true || rights.purchaseOrderApprovals === true
    ? [KEY_PURCHASE_ORDERS]
    : [];
}

function getUserDashboardView(user) {
  const role = String(user?.role || "").toLowerCase();
  if (role === "packing") return "dashboardPacking";
  if (role === "dispatch") return "dashboardDispatch";
  if (role === "warehouse") return "warehouse";
  if (role === "purchase" || role === "procurement") return "purchaseVendorMaster";
  return "dashboardAdmin";
}

function applyModulePayload(key, value) {
  if (key === KEY_LOGS) return;
  ERP_MODULE_STATE[key]?.set(value);
  const baseline = approvalRecordIndex(value);
  if (baseline) moduleWriteBaselines.set(key, baseline); else moduleWriteBaselines.delete(key);
  if (key === KEY_STOCK || key === KEY_DISPATCH_ARCHIVE) invalidatePackingUsageIndexes();
}

function applyRequestRouteBootstrap(bootstrap) {
  if (!bootstrap || typeof bootstrap !== "object" || !bootstrap.modules) { pendingRequestRouteBootstrap = null; return; }
  pendingRequestRouteBootstrap = bootstrap;
  Object.assign(liveSyncVersions, bootstrap.versions || {});
  Object.entries(bootstrap.modules || {}).forEach(([key, value]) => {
    if (!ERP_MODULE_STATE[key]) return;
    applyModulePayload(key, value);
    loadedModuleKeys.add(key);
    authorizedModuleKeys.add(key);
  });
}

const ERP_CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function erpRecordHash(record) {
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  let crc = 0xffffffff;
  for (const byte of bytes) crc = ERP_CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

async function loadIncrementalModuleChange(key) {
  const current = ERP_MODULE_STATE[key]?.get();
  const runtimeHashes = Array.isArray(liveRecordHashes[key]) ? liveRecordHashes[key] : null;
  const hashes = runtimeHashes || (Array.isArray(current) ? current.map(erpRecordHash) : null);
  try {
    const response = await erpReadResponse(`module-delta:${key}`, "backend/api.php?action=module_delta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ key, hashes, hashMode: runtimeHashes ? "sha256-runtime-v1" : "crc32-client-v1" })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.status !== "success") throw new Error(result?.message || `Incremental module refresh failed (${response.status})`);
    if (Array.isArray(result.hashes)) liveRecordHashes[key] = result.hashes;
    if (result.mode === "full") return { value: result.value, version: result.version };
    if (result.mode !== "indexed-v1" || !Array.isArray(current) || !Number.isInteger(Number(result.length)) || Number(result.length) < 0) {
      throw new Error("The server returned an invalid incremental module response.");
    }
    const length = Number(result.length);
    const next = current.slice(0, length);
    Object.entries(result.items || {}).forEach(([rawIndex, record]) => {
      const index = Number(rawIndex);
      if (Number.isInteger(index) && index >= 0 && index < length) next[index] = record;
    });
    if (next.length !== length || next.some(record => typeof record === "undefined")) {
      throw new Error("The incremental module response was incomplete.");
    }
    return { value: next, version: result.version };
  } catch (error) {
    console.warn(`Incremental refresh for ${key} used the safe full-module fallback:`, error);
    await loadModuleBundle([key]);
    return { value: ERP_MODULE_STATE[key]?.get(), version: liveSyncVersions[key] };
  }
}

function applyAuthorizedKeys(keys) {
  authorizedModuleKeys = new Set(Array.isArray(keys) ? keys : []);
  [...loadedModuleKeys].forEach(key => {
    if (authorizedModuleKeys.has(key)) return;
    ERP_MODULE_STATE[key]?.set([]);
    moduleWriteBaselines.delete(key);
    loadedModuleKeys.delete(key);
    delete liveSyncVersions[key];
  });
}

async function loadModuleBundle(keys) {
  const requested = [...new Set((keys || []).filter(Boolean))];
  if (!requested.length) return new Set();
  const signature = requested.slice().sort().join("|");
  if (moduleBundleInFlight.has(signature)) return moduleBundleInFlight.get(signature);
  const task = (async () => {
    const response = await erpReadResponse(`module-bundle:${signature}`, "backend/api.php?action=module_bundle", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ keys: requested })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.status !== "success") throw new Error(result?.message || "ERP modules could not be loaded.");
    applyAuthorizedKeys(result.allowedKeys);
    Object.assign(liveSyncVersions, result.versions || {});
    Object.assign(liveRecordHashes, result.recordHashes || {});
    const loaded = new Set();
    Object.entries(result.modules || {}).forEach(([key, value]) => {
      applyModulePayload(key, value);
      loadedModuleKeys.add(key);
      loaded.add(key);
    });
    return loaded;
  })().finally(() => moduleBundleInFlight.delete(signature));
  moduleBundleInFlight.set(signature, task);
  return task;
}

async function ensureViewModules(viewId) {
  const commonModules = viewId === "requestRoutes" ? [KEY_USERS] : COMMON_LIVE_MODULES;
  const needed = [...new Set([...commonModules, ...getViewModuleKeys(viewId)])]
    .filter(key => !loadedModuleKeys.has(key) && (!authorizedModuleKeys.size || authorizedModuleKeys.has(key)));
  if (!needed.length) return;
  await loadModuleBundle(needed);
}

function getLiveSubscribedKeys() {
  // Keep already visited modules cached for fast back-navigation, but only poll
  // the active page's dependencies plus the two global notification modules.
  return [...new Set([...COMMON_LIVE_MODULES, ...getGlobalNotificationModuleKeys(currentLoggedInUser), ...getViewModuleKeys(currentActiveViewId)])]
    .filter(key => loadedModuleKeys.has(key) && (!authorizedModuleKeys.size || authorizedModuleKeys.has(key)));
}

// Maintain O(1) browser lookups for packed serials and pallet numbers. The old
// implementation rescanned every pallet for every serial and became quadratic
// for PPC batches containing thousands of rows.
function normalizePackingId(value) {
  return String(value || "").trim().toUpperCase();
}

let packingUsageIndexes = null;
function invalidatePackingUsageIndexes() { packingUsageIndexes = null; }
function getPackingUsageIndexes() {
  if (packingUsageIndexes) return packingUsageIndexes;
  const serials = new Map(), pallets = new Map();
  const collect = (items, location) => {
    for (const pallet of items || []) {
      const palletKey = normalizePackingId(pallet?.pallet);
      if (palletKey && !pallets.has(palletKey)) pallets.set(palletKey, { pallet: pallet?.pallet || palletKey, location });
      const values = pallet?.serials || (pallet?.fullRows || []).map(row => typeof row === "object" ? row.serial : row);
      for (const value of values || []) {
        const serialKey = normalizePackingId(value);
        if (serialKey && !serials.has(serialKey)) serials.set(serialKey, { pallet: pallet?.pallet || "UNKNOWN", location });
      }
    }
  };
  collect(godownStock, "Warehouse stock");
  for (const manifest of dispatchArchive || []) collect(manifest?.pallets || [], "Dispatch history");
  packingUsageIndexes = { serials, pallets };
  return packingUsageIndexes;
}

function findSerialUsage(serial) {
  const needle = normalizePackingId(serial);
  return needle ? (getPackingUsageIndexes().serials.get(needle) || null) : null;
}

function palletNumberAlreadyUsed(palletNumber) {
  const needle = normalizePackingId(palletNumber);
  return needle ? getPackingUsageIndexes().pallets.has(needle) : false;
}

window.performLogin = async function() {
  const u = (document.getElementById("txtUser")?.value || "").trim();
  const p = document.getElementById("txtPass")?.value || "";
  const err = document.getElementById("loginErrorMsg");
  let response, result;
  try {
    response = await erpFetchWithTimeout("backend/api.php?action=login", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ username: u, password: p })
    }, 15000);
    result = await response.json();
  } catch (error) { result = { message: "The secure ERP server is not reachable." }; }
  if (!response?.ok || result?.status !== "success" || !result?.user) {
    if (err) { err.textContent = result?.message || "Invalid username or password."; err.style.display = "block"; }
    return;
  }

  if (err) err.style.display = "none";
  applyRequestRouteBootstrap(result.requestRouteBootstrap);
  // Authentication is complete at this point. Open the ERP immediately and
  // hydrate larger dashboard modules plus legacy data repairs in the background.
  currentLoggedInUser = result.user;
  applySignedInUser(result.user);
  window.warmErpLibrariesForUser?.(result.user);
  const welcomeName = String(currentLoggedInUser.name || currentLoggedInUser.username || "User").trim();
  window.showNotification({
    title: `Welcome Back, ${welcomeName}!`,
    message: "Your workspace is ready.",
    type: "success"
  });
  window.setTimeout(() => {
    void initDatabase(result.user, { navigate: false }).catch(error => {
      console.error("Post-login ERP initialization failed:", error);
      window.showNotification({
        title: "Some Data Is Still Loading",
        message: "You are signed in. Refresh once if a dashboard section does not finish loading.",
        type: "warning"
      });
    });
  }, 150);
};

async function initDatabase(serverSessionUser = null, options = {}) {
  serverSessionUser = serverSessionUser || await getServerSession();
  if (!serverSessionUser) {
    currentLoggedInUser = null;
    usersDb = [];
    sessionStorage.removeItem(KEY_SESSION);
    return false;
  }
  const showFastDashboard = options.navigate !== false;
  if (showFastDashboard) {
    applySignedInUser(serverSessionUser, false);
    await window.goToUserDashboard?.();
  }
  loadedModuleKeys = new Set();
  authorizedModuleKeys = new Set();
  liveSyncVersions = {};
  moduleWriteBaselines.clear();
  if (pendingRequestRouteBootstrap) applyRequestRouteBootstrap(pendingRequestRouteBootstrap);
  const startupKeys = [...new Set([...COMMON_LIVE_MODULES, ...getGlobalNotificationModuleKeys(serverSessionUser), ...getViewModuleKeys(getUserDashboardView(serverSessionUser))])]
    .filter(key => !loadedModuleKeys.has(key));
  if (startupKeys.length) await loadModuleBundle(startupKeys);
  let usersNeedRightsUpdate = false;
  usersDb.forEach(user => {
    if (user.rights && user.rights.dispatchBookedStock === undefined) {
      user.rights.dispatchBookedStock = user.rights.dispatch !== false;
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.dispatchRouteFare === undefined) {
      user.rights.dispatchRouteFare = user.rights.dispatch !== false;
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.dispatchBookVehicle === undefined) {
      user.rights.dispatchBookVehicle = user.rights.dispatch !== false;
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.salesOrders === undefined) {
      const isAdmin = user.role === "admin" || String(user.username || "").toUpperCase() === "IT";
      const isSales = isAdmin || String(user.role || "").toLowerCase() === "sales" || /\b(sales|marketing)\b/i.test(String(user.department || ""));
      user.rights.salesOrders = isSales;
      user.rights.salesOrderDashboard = isSales;
      user.rights.salesOrderAdd = isSales;
      user.rights.salesOrderView = isSales;
      user.rights.salesOrderEdit = isSales;
      user.rights.salesOrderDelete = isSales;
      user.rights.salesPersonMaster = isSales;
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.accounts === undefined) {
      const role = String(user.role || "").toLowerCase();
      const enabled = role === "admin" || role === "accounts" || /\b(account|accounts|finance)\b/i.test(String(user.department || ""));
      user.rights.accounts = enabled;
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.accountsInvoiceLogistics === undefined) {
      user.rights.accountsInvoiceLogistics = Boolean(user.rights.accounts);
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.accountsDashboard === undefined) {
      user.rights.accountsDashboard = Boolean(user.rights.accounts);
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.accountsReceipt === undefined) {
      user.rights.accountsReceipt = Boolean(user.rights.accounts);
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.accountsReimburse === undefined) {
      user.rights.accountsReimburse = Boolean(user.rights.accounts);
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.accountsEditInvoice === undefined) {
      user.rights.accountsEditInvoice = Boolean(user.rights.accounts);
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.accountsDeleteInvoice === undefined) {
      user.rights.accountsDeleteInvoice = Boolean(user.rights.accounts);
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.accountsReports === undefined) {
      user.rights.accountsReports = Boolean(user.rights.accounts);
      usersNeedRightsUpdate = true;
    }
    if (user.rights) {
      ["accountsLedger", "accountsOutstandingReceivable", "accountsAdvanceFromCustomer"].forEach(right => {
        if (user.rights[right] === undefined) {
          user.rights[right] = Boolean(user.rights.accountsReports ?? user.rights.accounts);
          usersNeedRightsUpdate = true;
        }
      });
    }
    if (user.rights && user.rights.salesOrders !== undefined && user.rights.salesOrderDashboard === undefined) {
      user.rights.salesOrderDashboard = Boolean(user.rights.salesOrders);
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.customerMaster === undefined) {
      user.rights.customerMaster = Boolean(user.rights.salesOrders);
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.salesOrders !== undefined && user.rights.salesOrderEdit === undefined) {
      user.rights.salesOrderEdit = Boolean(user.rights.salesOrders);
      user.rights.salesOrderDelete = Boolean(user.rights.salesOrders);
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.salesOrders !== undefined && user.rights.salesOrderAllocation === undefined) {
      user.rights.salesOrderAllocation = Boolean(user.rights.salesOrders);
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.salesOrders !== undefined && user.rights.salesOrderSerialTracking === undefined) {
      user.rights.salesOrderSerialTracking = Boolean(user.rights.salesOrders);
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.purchase === undefined) {
      const role = String(user.role || "").toLowerCase();
      const enabled = role === "admin" || role === "purchase" || /\b(purchase|procurement)\b/i.test(String(user.department || ""));
      user.rights.purchase = enabled;
      user.rights.purchaseVendorApprovals = role === "admin";
      user.rights.purchaseVendorRegistration = enabled;
      user.rights.purchaseVendorMaster = enabled;
      user.rights.purchasePartCode = enabled;
      user.rights.purchaseOrder = enabled;
      user.rights.purchaseOrderView = enabled;
      user.rights.purchaseOrderEdit = enabled;
      user.rights.purchaseOrderDelete = enabled;
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.purchase !== undefined && user.rights.purchaseVendorMaster === undefined) {
      user.rights.purchaseVendorRegistration = Boolean(user.rights.purchase);
      user.rights.purchaseVendorMaster = Boolean(user.rights.purchase);
      user.rights.purchasePartCode = Boolean(user.rights.purchase);
      user.rights.purchaseOrder = Boolean(user.rights.purchase);
      user.rights.purchaseOrderView = Boolean(user.rights.purchase);
      user.rights.purchaseOrderEdit = Boolean(user.rights.purchase);
      user.rights.purchaseOrderDelete = Boolean(user.rights.purchase);
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.purchaseVendorApprovals === undefined) {
      const role = String(user.role || "").toLowerCase();
      user.rights.purchaseVendorApprovals = role === "admin";
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.purchaseVendorRegistration === undefined) {
      user.rights.purchaseVendorRegistration = Boolean(user.rights.purchaseVendorMaster || user.rights.purchase);
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.purchaseOrderApprovals === undefined) {
      user.rights.purchaseOrderApprovals = String(user.role || "").toLowerCase() === "admin";
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.purchaseOrderView === undefined) {
      user.rights.purchaseOrderView = Boolean(user.rights.purchaseOrder || user.rights.purchase);
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.purchaseOrderEdit === undefined) {
      user.rights.purchaseOrderEdit = Boolean(user.rights.purchaseOrder || user.rights.purchase);
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.purchaseOrderDelete === undefined) {
      user.rights.purchaseOrderDelete = Boolean(user.rights.purchaseOrder || user.rights.purchase);
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.production === undefined) {
      const role = String(user.role || "").toLowerCase();
      const enabled = role === "admin" || role === "production" || /\bproduction\b/i.test(String(user.department || ""));
      user.rights.production = enabled;
      user.rights.productionDashboard = enabled;
      user.rights.productionAddDetails = enabled;
      user.rights.productionViewSheet = enabled;
      user.rights.productionDailyUpdate = enabled;
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.productionEditSheet === undefined) {
      const role = String(user.role || "").toLowerCase();
      user.rights.productionEditSheet = role === "admin" || role === "production" || /\bproduction\b/i.test(String(user.department || ""));
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.productionDeleteSheet === undefined) {
      const role = String(user.role || "").toLowerCase();
      user.rights.productionDeleteSheet = role === "admin" || role === "production" || /\bproduction\b/i.test(String(user.department || ""));
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.hr === undefined) {
      const role = String(user.role || "").toLowerCase();
      user.rights.hr = role === "admin" || role === "hr" || /\bhr\b|human resources?/i.test(String(user.department || ""));
      usersNeedRightsUpdate = true;
    }
    if (user.rights) {
      const role = String(user.role || "").toLowerCase();
      const hrMasterEnabled = role === "admin" || role === "hr" || /\bhr\b|human resources?/i.test(String(user.department || ""));
      ["departmentView", "departmentAdd", "departmentEdit", "departmentDelete", "designationView", "designationAdd", "designationEdit", "designationDelete"].forEach(right => {
        if (user.rights[right] === undefined) {
          user.rights[right] = hrMasterEnabled;
          usersNeedRightsUpdate = true;
        }
      });
      if (["departmentView", "departmentAdd", "departmentEdit", "departmentDelete", "designationView", "designationAdd", "designationEdit", "designationDelete"].some(right => user.rights[right] === true) && user.rights.hr !== true) {
        user.rights.hr = true;
        usersNeedRightsUpdate = true;
      }
    }
    if (user.rights && user.rights.hrEmployeeAdd === undefined) {
      user.rights.hrEmployeeAdd = Boolean(user.rights.hrEmployeeMaster ?? user.rights.hr);
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.hrEmployeeEdit === undefined) {
      user.rights.hrEmployeeEdit = Boolean(user.rights.hrEmployeeMaster ?? user.rights.hr);
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.hrEmployeeDelete === undefined) {
      user.rights.hrEmployeeDelete = Boolean(user.rights.hrEmployeeMaster ?? user.rights.hr);
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.hrAttendanceView === undefined) {
      user.rights.hrAttendanceView = Boolean(user.rights.hrAttendance ?? user.rights.hr);
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.hrAttendanceManual === undefined) {
      user.rights.hrAttendanceManual = Boolean(user.rights.hrAttendance ?? user.rights.hr);
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.hrTourExpenses === undefined) {
      // Employees can always create and view their own trips; the API scopes
      // this access to the signed-in username.
      user.rights.hrTourExpenses = true;
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.expensesRecharge === undefined) {
      user.rights.expensesRecharge = true;
      usersNeedRightsUpdate = true;
    }
    if (user.rights) {
      const role = String(user.role || "").toLowerCase();
      const hrEnabled = role === "admin" || role === "hr" || /\bhr\b|human resources?/i.test(String(user.department || ""));
      ["hrTourExpensesViewAll", "hrTourExpensesApprove", "hrTourExpensesExport"].forEach(right => {
        if (user.rights[right] === undefined) {
          user.rights[right] = hrEnabled;
          usersNeedRightsUpdate = true;
        }
      });
      const hasTripExpenseAccess = ["hrTourExpenses", "expensesRecharge", "hrTourExpensesViewAll", "hrTourExpensesApprove", "hrTourExpensesExport"]
        .some(right => user.rights[right] === true);
      if (user.rights.tripExpenses === undefined) {
        user.rights.tripExpenses = hasTripExpenseAccess;
        usersNeedRightsUpdate = true;
      }
    }
    if (user.rights) {
      const isAdmin = String(user.role || "").toLowerCase() === "admin";
      ["itSecuritySessions", "itRoleTemplates", "itEffectiveAccess", "itAssetDashboard", "itAssetMaster", "itAssetAllocation", "itPerformance"].forEach(right => {
        if (user.rights[right] === undefined) {
          user.rights[right] = isAdmin;
          usersNeedRightsUpdate = true;
        }
      });
    }
    const hasItChildAccess = user.rights && (
        user.rights.adminUsers === true
        || user.rights.adminAddUser === true
        || user.rights.adminEditUser === true
        || user.rights.adminDeleteUser === true
        || user.rights.adminUserRights === true
        || user.rights.itSecuritySessions === true
        || user.rights.itRoleTemplates === true
        || user.rights.itEffectiveAccess === true
        || user.rights.itAssetDashboard === true
        || user.rights.itAssetMaster === true
        || user.rights.itAssetAllocation === true
        || user.rights.itPerformance === true
      );
    if (user.rights && (user.rights.it === undefined || (user.rights.it !== true && hasItChildAccess))) {
      user.rights.it = String(user.role || "").toLowerCase() === "admin"
        || user.rights.adminUsers === true
        || user.rights.adminAddUser === true
        || user.rights.adminEditUser === true
        || user.rights.adminDeleteUser === true
        || user.rights.adminUserRights === true
        || user.rights.itSecuritySessions === true
        || user.rights.itRoleTemplates === true
        || user.rights.itEffectiveAccess === true
        || user.rights.itAssetDashboard === true
        || user.rights.itAssetMaster === true
        || user.rights.itAssetAllocation === true
        || user.rights.itPerformance === true;
      usersNeedRightsUpdate = true;
    }
    if (user.rights && user.rights.cctv === undefined) {
      const isAdmin = String(user.role || "").toLowerCase() === "admin";
      user.rights.cctv = isAdmin;
      user.rights.cctvLive = isAdmin;
      user.rights.cctvPlayback = isAdmin;
      user.rights.cctvAdmin = isAdmin;
      usersNeedRightsUpdate = true;
    }
  });
  // A non-Administrator receives only their own public user record and must
  // never try to replace the complete server-side user list during defaults migration.
  if (usersNeedRightsUpdate && String(serverSessionUser.role || "").toLowerCase() === "admin") {
    const rightsSaved = await saveStorage(KEY_USERS, usersDb);
    if (rightsSaved !== false) authorizedModuleKeys.add(KEY_PURCHASE_VENDORS);
  }
  // --- PERMANENT AUTO-HEAL: Normalizes and saves missing PO records on startup ---
  let stockNeedsSave = false;
  godownStock.forEach(p => {
    if (!p.po || p.po === "-" || p.po.trim() === "") {
      if (p.fullRows && p.fullRows.length > 0 && p.fullRows[0].po) {
        p.po = p.fullRows[0].po;
        stockNeedsSave = true;
      } else if (p.pallet && p.pallet.startsWith("A") && p.pallet.includes("-")) {
        p.po = p.pallet.split("-")[0].substring(1);
        stockNeedsSave = true;
      }
    }
  });
  if (stockNeedsSave) {
    await saveStorage(KEY_STOCK, godownStock);
  }
  // -------------------------------------------------------------------------------

  // Permanent audit history is loaded page-by-page only when Logs is open.
  auditLogs = [];
  // Existing requests are the login baseline. Only requests created after this
  // point should raise a "new approval request" notification for approvers.
  localSeenRequestStates = Object.fromEntries((requestsDb || []).map(request => [request.id, request.status]));
  localSeenPurchaseOrderStates = Object.fromEntries((purchaseOrdersDb || []).map(order => [order.id, String(order.status || "DRAFT").toUpperCase()]));
  window.updatePurchaseOrderApprovalBadge?.();

  // An approved Sales Order deletion is a permanent tombstone for that exact
  // record ID. This prevents an older browser/session from resurrecting the
  // deleted record and incorrectly reserving its CO number again.
  const loadedSalesOrderCount = salesOrders.length;
  const loadedAllocationCount = coAllocations.length;
  const approvedDeletedSalesOrderIds = getApprovedDeletedSalesOrderIds(requestsDb);
  salesOrders = removeApprovedDeletedSalesOrderGhosts(salesOrders, requestsDb);
  coAllocations = (coAllocations || []).filter(allocation =>
    !approvedDeletedSalesOrderIds.has(String(allocation.salesOrderId || "").trim())
  );
  if (salesOrders.length !== loadedSalesOrderCount) {
    await saveStorage(KEY_SALES_ORDERS, salesOrders);
  }
  if (coAllocations.length !== loadedAllocationCount) {
    await saveStorage(KEY_CO_ALLOCATIONS, coAllocations);
  }

  // The CO registry represents only currently existing Sales Orders. Deleted CO
  // numbers must not remain reserved, because they are allowed to be reused.
  const activeCoNumbers = [...new Set((salesOrders || [])
    .map(order => String(order.coNumber || "").trim().toUpperCase())
    .filter(Boolean))];
  const registryCoNumbers = [...new Set((salesCoRegistry || [])
    .map(co => String(co || "").trim().toUpperCase())
    .filter(Boolean))];
  const registryUpdated = activeCoNumbers.length !== registryCoNumbers.length ||
    activeCoNumbers.some(co => !registryCoNumbers.includes(co));
  if (registryUpdated) {
    salesCoRegistry = activeCoNumbers;
    await saveStorage(KEY_SALES_CO_REGISTRY, salesCoRegistry);
  }

  // Existing lifetime records are re-evaluated at startup so older completed COs
  // become either Awaiting Certificate or Closed without removing any record.
  await syncSalesOrderDispatchTotals();

  const sessionUser = usersDb.find(user => String(user.id) === String(serverSessionUser.id)) || serverSessionUser;
  applySignedInUser(sessionUser, options.navigate !== false && !showFastDashboard);
  if (showFastDashboard || window.isFastDashboardView?.(currentActiveViewId)) {
    window.refreshDashboardFromFullData?.(currentActiveViewId);
  }
  return true;

  const savedSession = sessionStorage.getItem(KEY_SESSION);
  if (savedSession) {
    try {
      const parsed = JSON.parse(savedSession);
      const match = usersDb.find(u => u.id === parsed.id || u.username.toLowerCase() === parsed.username.toLowerCase());
      if (match && match.status === "ACTIVE") {
        currentLoggedInUser = match;
        document.getElementById("topUserName").textContent = currentLoggedInUser.name.toUpperCase();
        document.getElementById("topUserRole").textContent = String(currentLoggedInUser.department || currentLoggedInUser.role).toUpperCase() + " DEPARTMENT";
        document.getElementById("topUserAvatar").textContent = currentLoggedInUser.name.charAt(0).toUpperCase();
        document.getElementById("dropUsername").textContent = currentLoggedInUser.username;

        applyUserRightsToSidebar(currentLoggedInUser);
        document.getElementById("loginOverlay").style.display = "none";
        goToUserDashboard();
      } else {
        sessionStorage.removeItem(KEY_SESSION);
      }
    } catch (e) {
      sessionStorage.removeItem(KEY_SESSION);
    }
  }
}

let localSeenRequestStates = {};
let localSeenPurchaseOrderStates = {};

function refreshLiveSignedInUser(latestUsers) {
  if (!currentLoggedInUser) return;
  const latestUser = (latestUsers || []).find(user => String(user.id) === String(currentLoggedInUser.id));
  if (!latestUser || latestUser.status !== "ACTIVE") {
    sessionStorage.removeItem(KEY_SESSION);
    currentLoggedInUser = null;
    const loginOverlay = document.getElementById("loginOverlay");
    if (loginOverlay) loginOverlay.style.display = "flex";
    window.showNotification({ title: "Session Ended", message: "Your account was changed or disabled by Administrator. Please sign in again.", type: "warning" });
    return;
  }

  currentLoggedInUser = latestUser;
  sessionStorage.setItem(KEY_SESSION, JSON.stringify(latestUser));
  const topUserName = document.getElementById("topUserName");
  const topUserRole = document.getElementById("topUserRole");
  const topUserAvatar = document.getElementById("topUserAvatar");
  const dropUsername = document.getElementById("dropUsername");
  if (topUserName) topUserName.textContent = String(latestUser.name || "-").toUpperCase();
  if (topUserRole) topUserRole.textContent = String(latestUser.department || latestUser.role || "-").toUpperCase() + " DEPARTMENT";
  if (topUserAvatar) topUserAvatar.textContent = String(latestUser.name || "-").charAt(0).toUpperCase();
  if (dropUsername) dropUsername.textContent = latestUser.username || "-";
  applyUserRightsToSidebar(latestUser);
  window.updatePurchaseOrderApprovalBadge?.();
}

async function getServerSession() {
  try {
    const response = await erpReadResponse("session", "backend/api.php?action=session", { credentials: "same-origin", cache: "no-store" });
    const data = response.ok ? await response.json() : null;
    if (data?.requestRouteBootstrap) pendingRequestRouteBootstrap = data.requestRouteBootstrap;
    return data?.authenticated && data?.user ? data.user : null;
  } catch (error) {
    return null;
  }
}

function applySignedInUser(user, navigate = true) {
  if (!user) return;
  currentLoggedInUser = user;
  // This is display-only. The authoritative session is the server HttpOnly cookie.
  sessionStorage.setItem(KEY_SESSION, JSON.stringify({ id: user.id, username: user.username }));
  document.getElementById("topUserName").textContent = user.name.toUpperCase();
  document.getElementById("topUserRole").textContent = String(user.department || user.role).toUpperCase() + " DEPARTMENT";
  document.getElementById("topUserAvatar").textContent = user.name.charAt(0).toUpperCase();
  document.getElementById("dropUsername").textContent = user.username;
  applyUserRightsToSidebar(user);
  window.updatePurchaseOrderApprovalBadge?.();
  document.getElementById("loginOverlay").style.display = "none";
  scheduleLiveSync(100);
  window.startNotificationLiveUpdates?.();
  if (navigate) goToUserDashboard();
  const canApproveRequests = String(user.role || "").toLowerCase() === "admin" || user.rights?.requestsApprove === true || user.rights?.requestRouteAssignee === true;
  const pendingApprovalCount = canApproveRequests
    ? (requestsDb || []).filter(request => request.status === "PENDING").length
    : 0;
  if (pendingApprovalCount > 0) {
    window.setTimeout(() => window.showNotification({
      title: "Pending Approval Requests",
      message: `${pendingApprovalCount} request${pendingApprovalCount === 1 ? " is" : "s are"} waiting for your review. Open Approve Requests to continue.`,
      type: "warning",
      duration: 9000
    }), 250);
  }
  const pendingPurchaseOrderCount = window.canApprovePurchaseOrders?.(user) === true
    ? (purchaseOrdersDb || []).filter(order => String(order.status || "DRAFT").toUpperCase() === "PENDING_APPROVAL").length
    : 0;
  if (pendingPurchaseOrderCount > 0) {
    window.setTimeout(() => window.showNotification({
      title: "Purchase Orders Awaiting Approval",
      message: `${pendingPurchaseOrderCount} Purchase Order${pendingPurchaseOrderCount === 1 ? " is" : "s are"} waiting in Purchase > Approve PO.`,
      type: "warning",
      duration: 10000
    }), 450);
  }
}

function refreshLiveCurrentView(isTyping) {
  const view = currentActiveViewId;
  const activeElement = document.activeElement;
  const activelyEditingCurrentView = Boolean(activeElement?.closest?.(`#view-${view}`)) && ["INPUT", "TEXTAREA", "SELECT"].includes(activeElement?.tagName || "");
  const productionDailyDraftActive = view === "productionDailyUpdate" && [
    "productionDailyQty", "productionDailyStatus", "productionDailyDelayDays",
    "productionDailyGradeA", "productionDailyGradeB", "productionDailyGradeR",
    "productionDailyCellReject", "productionDailyModuleReject", "productionDailyDelayReason"
  ].some(id => String(document.getElementById(id)?.value ?? "").trim() !== "");

  // The one-second sync must update data variables, but it must never rebuild
  // the Daily Production form while an operator is entering a draft. Rebuilding
  // calls populateProductionDailyContext(), which correctly clears fields only
  // for a deliberate PO/date change—not for a background sync.
  if (view === "productionDailyUpdate" && (isTyping || activelyEditingCurrentView || productionDailyDraftActive)) return;

  const deleteInvoiceSelectionActive = view === "accountsDeleteInvoice"
    && Boolean(String(document.getElementById("deleteInvoiceSelect")?.value || "").trim());

  // Keep live data updating in memory, but do not rebuild the Delete Invoice
  // selector while its dropdown is open or an invoice is selected. The submit
  // and approval handlers always validate against the latest synced records.
  if (view === "accountsDeleteInvoice" && (isTyping || activelyEditingCurrentView || deleteInvoiceSelectionActive)) return;

  const refreshers = {
    warehouse: () => renderWarehouseTable(),
    dashboardAdmin: () => refreshAdminDashboard(),
    dashboardPacking: () => refreshPackingDashboard(),
    dashboardDispatch: () => refreshDispatchDashboard(),
    requestsTrack: () => window.renderTrackRequestsTable?.(),
    requestsApprove: () => window.renderApproveRequestsTable?.(),
    requestRoutes: () => window.renderRequestRoutesTable?.(),
    hrTourExpenses: () => { window.renderHrDepartmentApprovals?.(); window.updateHrUnifiedApprovalBadge?.(); },
    dispatchBookedStock: () => window.renderBookedStockView?.(),
    dispatchRouteFare: () => window.renderRouteFareTable?.(),
    dispatchBookVehicle: () => { window.populateVehicleBookingCoDropdown?.(); window.populateVehicleSettlementDropdown?.(); window.renderVehicleBookingTable?.(); },
    salesOrderDashboard: () => renderSalesOrderDashboard(),
    salesOrderView: () => renderSalesOrdersTable(),
    salesOrderAllocation: () => { window.populateCoAllocationCoSelect?.(); window.populateCo360Search?.(); window.renderCoAllocationTable?.(); window.renderCo360?.(); },
    salesOrderSerialTracking: () => window.refreshSalesSerialTracking?.(),
    salesOrderEdit: () => populateSalesOrderEditSelect(),
    salesOrderDelete: () => populateSalesOrderDeleteSelect(),
    accounts: () => { populateAccountCoDropdown(); populateAccountTransporterDropdown(); renderAccountInvoiceTable(); },
    accountsDashboard: () => window.renderAccountsDashboard?.(),
    accountsEditInvoice: () => populateEditInvoiceSelect(),
    accountsDeleteInvoice: () => populateDeleteInvoiceSelect(),
    accountsReceipt: () => { populateReceiptPartyDropdown(); renderAccountReceiptTable(); },
    salesPersonMaster: () => renderSalesPeopleTable(),
    customerMaster: () => { populateSalesCustomerDropdown(); renderCustomerMasterTable(); },
    purchaseVendorRegistration: () => resetPurchaseVendorForm(),
    purchaseVendorMaster: () => renderPurchaseVendorMaster(),
    purchaseOrder: () => window.refreshPurchaseOrderView?.(),
    purchaseOrderView: () => window.renderSavedPurchaseOrders?.(),
    purchaseOrderEdit: () => window.preparePurchaseOrderEditPage?.(),
    purchaseOrderApprovals: () => window.renderPurchaseOrderApprovalQueue?.(),
    purchaseOrderDelete: () => window.renderPurchaseOrderDeleteList?.(),
    transporterView: () => renderTransporterTable(),
    driverView: () => renderDriverTable(),
    departmentView: () => renderDepartmentsTable(),
    designationView: () => window.renderDesignationsTable?.(),
    productsView: () => renderProductsViewTable(),
    adminUsers: () => renderUsersTable(),
    logs: () => renderAllLogsTables(),
    reportsDailyDept: () => window.renderDailyDeptReport?.(),
    reportsHub: () => window.renderReportsHub?.(),
    productionEditSheet: () => window.populateProductionEditSheetSelect?.(),
    productionDeleteSheet: () => window.populateProductionDeleteSheetSelect?.(),
    productionViewSheet: () => window.renderProductionSheet?.(),
    productionDailyUpdate: () => window.populateProductionDailyPoSelect?.()
  };
  refreshers[view]?.();

  // Keep live form sources current only before a transaction starts. This
  // protects unfinished Create, Scan, Edit and Dispatch work from being reset.
  if (isTyping) return;
  if (view === "packingScan") {
    const packingDraftActive = activeSerials.length > 0
      || Boolean(String(activePalletPo || "").trim())
      || Boolean(String(document.getElementById("pPoSelectStation")?.value || "").trim())
      || Boolean(String(document.getElementById("pPalletNoInput")?.value || "").trim())
      || Boolean(String(document.getElementById("packingBulkPasteText")?.value || "").trim())
      || Boolean(document.getElementById("packingBulkExcelFile")?.files?.length);
    if (!packingDraftActive) {
      populatePackingModelDropdown();
      populatePoDropdowns();
    }
  } else if (view === "dispatchChallan" && dispatchPallets.length === 0) {
    const invoiceSelect = document.getElementById("dAccountInvoiceSelect");
    const coSelect = document.getElementById("dCoSelect");
    const poSelect = document.getElementById("dPoSelect");
    const previousInvoice = invoiceSelect?.value || "";
    const previousCo = coSelect?.value || "";
    const previousPo = poSelect?.value || "";
    populateDispatchCoDropdown();
    if (coSelect && [...coSelect.options].some(option => option.value === previousCo)) coSelect.value = previousCo;
    populateDispatchInvoiceDropdown(coSelect?.value || "");
    populatePoDropdowns();
    populateDispatchTransportersDropdown();
    if (invoiceSelect && [...invoiceSelect.options].some(option => option.value === previousInvoice)) invoiceSelect.value = previousInvoice;
    if (poSelect && [...poSelect.options].some(option => option.value === previousPo)) poSelect.value = previousPo;
  }
}

let pendingLiveViewRender = 0;
let pendingLiveViewTyping = false;
function scheduleLiveCurrentViewRefresh(isTyping = false) {
  const stats = window.erpPerformanceStats;
  stats.liveRendersQueued += 1;
  pendingLiveViewTyping = pendingLiveViewTyping || Boolean(isTyping);
  if (pendingLiveViewRender) {
    stats.liveRendersCoalesced += 1;
    return;
  }
  const scheduleFrame = window.requestAnimationFrame || (callback => window.setTimeout(callback, 16));
  pendingLiveViewRender = scheduleFrame(() => {
    pendingLiveViewRender = 0;
    const protectDraft = pendingLiveViewTyping;
    pendingLiveViewTyping = false;
    if (document.visibilityState === "hidden" || !currentLoggedInUser) return;
    stats.liveRendersExecuted += 1;
    refreshLiveCurrentView(protectDraft);
  });
}

function setLiveSyncStatus(state, label, detail = "") {
  const badge = document.getElementById("erpLiveSyncStatus");
  if (!badge) return;
  badge.className = `erp-sync-status ${state}`;
  badge.textContent = label;
  badge.title = detail || label;
}

function scheduleLiveSync(delay = 1500) {
  if (liveSyncTimer) window.clearTimeout(liveSyncTimer);
  liveSyncTimer = null;
  if (document.visibilityState === "hidden") return;
  // Spread clients across a small window so 150 signed-in users do not all
  // poll MariaDB on the same millisecond after login, focus or a data change.
  const jitter = Math.min(2500, Math.max(100, delay * 0.2));
  liveSyncTimer = window.setTimeout(runLiveSync, Math.max(100, delay + Math.random() * jitter));
}

// Adaptive delta synchronization: instant while data is moving, slower while
// idle, paused in hidden tabs, and exponentially backed off after failures.
async function runLiveSync() {
  liveSyncTimer = null;
  if (!currentLoggedInUser) {
    setLiveSyncStatus("paused", "STANDBY", "Live synchronization starts after sign-in.");
    scheduleLiveSync(3000);
    return;
  }
  if (document.visibilityState === "hidden") {
    setLiveSyncStatus("paused", "PAUSED", "Synchronization is paused while this tab is hidden.");
    return;
  }
  if (!navigator.onLine) {
    setLiveSyncStatus("offline", "OFFLINE", "Network unavailable. Changes will refresh after reconnection.");
    scheduleLiveSync(10000);
    return;
  }
  if (liveSyncInProgress) {
    scheduleLiveSync(500);
    return;
  }
  liveSyncInProgress = true;
  setLiveSyncStatus("syncing", "SYNCING", "Checking for changed ERP records.");
  const syncStartedAt = performance.now();
  let syncSucceeded = false;
  let changedKeyCount = 0;
  const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
  const isTyping = (activeTag === "input" || activeTag === "textarea" || activeTag === "select");

  try {
    const abortController = new AbortController();
    const abortTimer = window.setTimeout(() => abortController.abort(), 12000);
    let syncResponse;
    try {
      syncResponse = await erpFetchWithTimeout("backend/api.php?action=live_sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        signal: abortController.signal,
        body: JSON.stringify({ versions: liveSyncVersions, keys: getLiveSubscribedKeys(), deltaMode: "indexed-v1" })
      }, 12000);
    } finally {
      window.clearTimeout(abortTimer);
    }
    if (!syncResponse.ok) throw new Error(`Live sync unavailable (${syncResponse.status})`);
    const syncResult = await syncResponse.json();
    if (syncResult?.status !== "success") throw new Error(syncResult?.message || "Live sync failed");
    applyAuthorizedKeys(syncResult.allowedKeys);
    const serverVersions = syncResult.versions || {};
    const pendingChanges = syncResult.changes || {};
    const changedKeys = Object.keys(pendingChanges);
    changedKeyCount = changedKeys.length;
    liveSyncEmptyCount = changedKeys.length ? 0 : liveSyncEmptyCount + 1;
    if (changedKeys.length === 0) {
      Object.assign(liveSyncVersions, serverVersions);
      syncSucceeded = true;
      liveSyncFailureCount = 0;
      lastLiveSyncAt = Date.now();
      return;
    }

    // Resolve only changed modules. The delta endpoint returns changed indexes;
    // it automatically sends a full module if that is safer or more compact.
    const resolvedEntries = await Promise.all(changedKeys.map(async key => {
      const pending = pendingChanges[key];
      if (pending?.__deltaPending !== true) return [key, pending, serverVersions[key]];
      const incremental = await loadIncrementalModuleChange(key);
      return [key, incremental.value, incremental.version || serverVersions[key]];
    }));
    const changed = Object.fromEntries(resolvedEntries.map(([key, value]) => [key, value]));
    resolvedEntries.forEach(([key, , version]) => { if (version) liveSyncVersions[key] = version; });
    Object.entries(serverVersions).forEach(([key, version]) => {
      if (!changedKeys.includes(key)) liveSyncVersions[key] = version;
    });
    syncSucceeded = true;
    liveSyncFailureCount = 0;
    lastLiveSyncAt = Date.now();

    const latestRequests = changed[KEY_REQUESTS] ?? requestsDb;
    if (changedKeys.includes(KEY_REQUESTS)) latestRequests.forEach(req => {
      const requestWasSeen = Object.prototype.hasOwnProperty.call(localSeenRequestStates, req.id);
      const prevStatus = localSeenRequestStates[req.id];
      const isAuthor = currentLoggedInUser && currentLoggedInUser.username.toLowerCase() === (req.requestedBy || "").toLowerCase();
      const canApproveRequests = currentLoggedInUser && (
        String(currentLoggedInUser.role || "").toLowerCase() === "admin"
        || currentLoggedInUser.rights?.requestsApprove === true
        || currentLoggedInUser.rights?.requestRouteAssignee === true
      );
      if (!requestWasSeen && req.status === "PENDING" && canApproveRequests && !isAuthor) {
        window.showNotification({
          title: "New Approval Request",
          message: `@${req.requestedBy || "USER"} submitted ${String(req.type || "REQUEST").replace(/_/g, " ")} for "${req.targetId || "-"}. Open Approve Requests to review it.`,
          type: "warning",
          duration: 9000
        });
      }
      if (prevStatus && prevStatus !== req.status) {
        if (isAuthor) {
          if (req.status === "APPROVED") {
            window.showNotification({
              title: "Request Approved",
              message: `Your request (${req.type.replace(/_/g, ' ')}) for "${req.targetId}" was APPROVED by @${req.reviewedBy}.`,
              type: "success"
            });
          } else if (req.status === "REJECTED") {
            window.showNotification({
              title: "Request Declined",
              message: `Your request for "${req.targetId}" was DECLINED: ${req.adminRemark}`,
              type: "danger"
            });
          }
        }
      }
      localSeenRequestStates[req.id] = req.status;
    });

    const latestPurchaseOrders = changed[KEY_PURCHASE_ORDERS] ?? purchaseOrdersDb;
    if (changedKeys.includes(KEY_PURCHASE_ORDERS)) latestPurchaseOrders.forEach(order => {
      const status = String(order.status || "DRAFT").toUpperCase();
      const previousStatus = localSeenPurchaseOrderStates[order.id];
      const username = String(currentLoggedInUser?.username || "").toLowerCase();
      const isCreator = username !== "" && username === String(order.createdBy || "").toLowerCase();
      const isAdminApprover = String(currentLoggedInUser?.role || "").toLowerCase() === "admin"
        && currentLoggedInUser?.rights?.purchaseOrderApprovals !== false;
      if (status === "PENDING_APPROVAL" && previousStatus !== "PENDING_APPROVAL" && isAdminApprover && !isCreator) {
        window.showNotification({
          title: "PO Awaiting Approval",
          message: `${order.poNumber || "A Purchase Order"} from @${order.submittedBy || order.createdBy || "PURCHASE"} is waiting in Purchase > Approve PO.`,
          type: "warning",
          duration: 10000
        });
      }
      if (previousStatus && previousStatus !== status && isCreator) {
        if (status === "APPROVED") window.showNotification({ title: "Purchase Order Approved", message: `${order.poNumber} was approved by @${order.approvedBy || "ADMIN"} and is ready to issue.`, type: "success", duration: 9000 });
        if (status === "REJECTED") window.showNotification({ title: "Purchase Order Rejected", message: `${order.poNumber} was rejected: ${order.approvalRemark || "No remark provided."}`, type: "danger", duration: 10000 });
      }
      localSeenPurchaseOrderStates[order.id] = status;
    });

    changedKeys.forEach(key => {
      if (key === KEY_LOGS) return;
      const value = key === KEY_SALES_ORDERS
        ? removeApprovedDeletedSalesOrderGhosts(changed[key], latestRequests)
        : changed[key];
      applyModulePayload(key, value);
      loadedModuleKeys.add(key);
    });

    if (changedKeys.includes(KEY_USERS)) refreshLiveSignedInUser(usersDb);
    if (changed[KEY_LOGS]?.__paginated === true && currentActiveViewId === "logs") await loadAuditLogsPage();
    const activeDependencies = new Set(getViewModuleKeys(currentActiveViewId));
    const visibleDataChanged = changedKeys.some(key => activeDependencies.has(key));
    if (currentLoggedInUser && visibleDataChanged) scheduleLiveCurrentViewRefresh(isTyping);
    if (changedKeys.includes(KEY_PURCHASE_ORDERS)) window.updatePurchaseOrderApprovalBadge?.();
  } catch (e) {
    liveSyncFailureCount += 1;
    liveSyncEmptyCount = 0;
    window.erpPerformanceStats.liveSyncFailures += 1;
    if (liveSyncFailureCount === 1 || liveSyncFailureCount % 5 === 0) console.warn("Live ERP sync deferred:", e);
  } finally {
    const duration = Math.max(0, performance.now() - syncStartedAt);
    const stats = window.erpPerformanceStats;
    stats.liveSyncRequests += 1;
    stats.liveSyncChanges += changedKeyCount;
    stats.liveSyncLastMs = Math.round(duration);
    stats.liveSyncAverageMs = Math.round(((stats.liveSyncAverageMs * (stats.liveSyncRequests - 1)) + duration) / stats.liveSyncRequests);
    liveSyncInProgress = false;
    if (syncSucceeded) {
      setLiveSyncStatus("live", "LIVE", `Last synchronized ${new Date(lastLiveSyncAt).toLocaleTimeString()} in ${Math.round(duration)} ms.`);
      const nextDelay = changedKeyCount ? 1500 : liveSyncEmptyCount > 10 ? 10000 : liveSyncEmptyCount > 3 ? 5000 : 2500;
      scheduleLiveSync(nextDelay);
    } else {
      const retryDelay = Math.min(30000, 1500 * (2 ** Math.min(liveSyncFailureCount, 5)));
      setLiveSyncStatus("offline", "RETRYING", `Live synchronization is temporarily unavailable. Retrying automatically in ${Math.ceil(retryDelay / 1000)} seconds.`);
      scheduleLiveSync(retryDelay);
    }
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    if (liveSyncTimer) window.clearTimeout(liveSyncTimer);
    liveSyncTimer = null;
    setLiveSyncStatus("paused", "PAUSED", "Synchronization is paused while this tab is hidden.");
  } else {
    scheduleLiveSync(100);
  }
});
window.addEventListener("online", () => scheduleLiveSync(100));
window.addEventListener("offline", () => {
  if (liveSyncTimer) window.clearTimeout(liveSyncTimer);
  liveSyncTimer = null;
  setLiveSyncStatus("offline", "OFFLINE", "Network unavailable. Waiting to reconnect.");
});

if ("PerformanceObserver" in window) {
  try {
    const longTaskObserver = new PerformanceObserver(list => {
      list.getEntries().forEach(entry => {
        window.erpPerformanceStats.longTasks += 1;
        window.erpPerformanceStats.longestTaskMs = Math.max(window.erpPerformanceStats.longestTaskMs, Math.round(entry.duration));
      });
    });
    longTaskObserver.observe({ type: "longtask", buffered: true });
  } catch (error) { /* Long Task API is optional. */ }
}
window.getErpPerformanceReport = () => ({ ...window.erpPerformanceStats, activeView: currentActiveViewId, loadedModules: [...loadedModuleKeys], lastLiveSyncAt: lastLiveSyncAt ? new Date(lastLiveSyncAt).toISOString() : null });
scheduleLiveSync(500);

async function logEvent(dept, action, details, options = {}) {
  if (storageBatchBuffer instanceof Map) { storageBatchAuditBuffer.push({ dept, action, details, options }); return true; }
  try {
    const response = await erpFetchWithTimeout("backend/api.php?action=audit_event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ department: dept, actionCode: action, details })
    }, 15000);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.status !== "success" || !result?.entry) throw new Error(result?.message || "Audit event was not saved.");
    if (currentActiveViewId === "logs") window.setTimeout(() => loadAuditLogsPage(), 150);
  } catch (error) {
    console.error("Audit Log Error:", error);
    if (!options.silent) window.showNotification({ title: "Audit Log Error", message: "The action completed, but its audit record could not be confirmed. Contact IT.", type: "danger" });
  }
}

let logsCurrentPage = 1;
const LOGS_PAGE_SIZE = 100;
let logsTotalRecords = 0;
let logsTotalPages = 1;
let logsAvailableDepartments = [];
let logsLoadSequence = 0;

function escapeAuditHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function auditDepartmentLabel(value) {
  const labels = { STORE: "Store & PPC", PACKING: "Packing", DISPATCH: "Dispatch", SALES: "Sales", ACCOUNTS: "Accounts", PURCHASE: "Purchase", PRODUCTION: "Production", SYSTEM: "System & Admin", WAREHOUSE: "Warehouse" };
  const code = String(value || "SYSTEM").toUpperCase();
  return labels[code] || code.replaceAll("_", " ");
}

function currentUserAuditDepartment() {
  const role = String(currentLoggedInUser?.role || "").toLowerCase();
  const department = String(currentLoggedInUser?.department || "").toLowerCase();
  const source = `${role} ${department}`;
  if (/\b(account|accounts|finance)\b/.test(source)) return "ACCOUNTS";
  if (/\bdispatch\b/.test(source)) return "DISPATCH";
  if (/\bpacking\b/.test(source)) return "PACKING";
  if (/\b(store|ppc)\b/.test(source)) return "STORE";
  if (/\b(sales|marketing)\b/.test(source)) return "SALES";
  if (/\b(purchase|procurement)\b/.test(source)) return "PURCHASE";
  if (/\bproduction\b/.test(source)) return "PRODUCTION";
  if (/\bwarehouse\b/.test(source)) return "WAREHOUSE";
  return String(currentLoggedInUser?.department || currentLoggedInUser?.role || "SYSTEM").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "") || "SYSTEM";
}

function populateLogsDepartmentFilter() {
  const select = document.getElementById("logsDepartmentFilter");
  if (!select) return;
  const isAdmin = String(currentLoggedInUser?.role || "").toLowerCase() === "admin";
  if (!isAdmin) {
    const ownDepartment = currentUserAuditDepartment();
    select.innerHTML = `<option value="${escapeAuditHtml(ownDepartment)}">${escapeAuditHtml(auditDepartmentLabel(ownDepartment))} — My Department</option>`;
    select.value = ownDepartment;
    select.disabled = true;
    select.title = "Department users can view only their own department's permanent logs.";
    return;
  }
  select.disabled = false;
  select.title = "Administrators can view all departments.";
  const selected = select.value || "ALL";
  const departments = [...new Set(logsAvailableDepartments.map(code => String(code || "SYSTEM").toUpperCase()))].sort((a, b) => auditDepartmentLabel(a).localeCompare(auditDepartmentLabel(b)));
  select.innerHTML = `<option value="ALL">All Departments</option>${departments.map(code => `<option value="${escapeAuditHtml(code)}">${escapeAuditHtml(auditDepartmentLabel(code))}</option>`).join("")}`;
  select.value = departments.includes(selected) || selected === "ALL" ? selected : "ALL";
}

async function loadAuditLogsPage() {
  const tbody = document.getElementById("logsAuditBody");
  if (!tbody || !currentLoggedInUser) return;
  const requestSequence = ++logsLoadSequence;
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:28px; color:var(--muted);">Loading audit records from the database…</td></tr>`;
  const parameters = new URLSearchParams({
    action: "audit_logs",
    page: String(logsCurrentPage),
    pageSize: String(LOGS_PAGE_SIZE),
    department: document.getElementById("logsDepartmentFilter")?.value || (String(currentLoggedInUser.role || "").toLowerCase() === "admin" ? "ALL" : currentUserAuditDepartment()),
    period: document.getElementById("logsPeriodFilter")?.value || "ALL",
    from: document.getElementById("logsFromDate")?.value || "",
    to: document.getElementById("logsToDate")?.value || ""
  });
  try {
    const response = await erpReadResponse(`audit-logs:${parameters.toString()}`, `backend/api.php?${parameters.toString()}`, { credentials: "same-origin", cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.status !== "success") throw new Error(result?.message || "Audit logs could not be loaded.");
    if (requestSequence !== logsLoadSequence) return;
    auditLogs = Array.isArray(result.records) ? result.records : [];
    logsTotalRecords = Number(result.total) || 0;
    logsCurrentPage = Number(result.page) || 1;
    logsTotalPages = Number(result.pages) || 1;
    logsAvailableDepartments = Array.isArray(result.departments) ? result.departments : [];
    if (result.version) liveSyncVersions[KEY_LOGS] = result.version;
    renderAllLogsTables();
  } catch (error) {
    console.error("Paginated audit load failed:", error);
    if (requestSequence !== logsLoadSequence) return;
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:28px; color:#b91c1c;">${escapeAuditHtml(error.message || "Audit logs could not be loaded.")}</td></tr>`;
  }
}

function renderAllLogsTables() {
  const tbody = document.getElementById("logsAuditBody");
  if (!tbody) return;
  populateLogsDepartmentFilter();
  logsCurrentPage = Math.min(Math.max(1, logsCurrentPage), logsTotalPages);
  tbody.innerHTML = auditLogs.length ? auditLogs.map(log => `
    <tr>
      <td style="font-family:monospace; font-size:11px; white-space:nowrap;">${escapeAuditHtml(log.timestamp)}</td>
      <td><span style="font-size:11px; font-weight:800; color:#0369a1;">${escapeAuditHtml(auditDepartmentLabel(log.dept))}</span></td>
      <td><strong>${escapeAuditHtml(log.operator)}</strong></td>
      <td><span style="font-size:11px; font-weight:700; background:#f1f5f9; padding:3px 7px; border-radius:4px; white-space:nowrap;">${escapeAuditHtml(log.action)}</span></td>
      <td>${escapeAuditHtml(log.details)}</td>
    </tr>
  `).join("") : `<tr><td colspan="5" style="color:var(--muted); text-align:center; padding:28px;">No audit logs match the selected department and date period.</td></tr>`;
  const first = logsTotalRecords ? ((logsCurrentPage - 1) * LOGS_PAGE_SIZE) + 1 : 0;
  const last = Math.min(logsCurrentPage * LOGS_PAGE_SIZE, logsTotalRecords);
  const summary = document.getElementById("logsResultSummary");
  if (summary) summary.textContent = `${logsTotalRecords.toLocaleString("en-IN")} permanent log entries${logsTotalRecords ? ` — showing ${first.toLocaleString("en-IN")} to ${last.toLocaleString("en-IN")}` : ""}`;
  const label = document.getElementById("logsPageLabel");
  if (label) label.textContent = `Page ${logsCurrentPage} of ${logsTotalPages}`;
  const previous = document.getElementById("logsPrevPage");
  const next = document.getElementById("logsNextPage");
  if (previous) previous.disabled = logsCurrentPage <= 1;
  if (next) next.disabled = logsCurrentPage >= logsTotalPages;
}

async function openLogsHubView(button) {
  logsCurrentPage = 1;
  const opened = await switchView("logs", button, "AUDIT LOGS");
  if (opened === false) return;
  await loadAuditLogsPage();
}
window.openLogsHubView = openLogsHubView;

window.onLogsFilterChanged = async function() {
  logsCurrentPage = 1;
  await loadAuditLogsPage();
};

window.onLogsPeriodChanged = function() {
  const custom = document.getElementById("logsPeriodFilter")?.value === "CUSTOM";
  const range = document.getElementById("logsCustomDateRange");
  if (range) range.style.display = custom ? "grid" : "none";
  if (custom && !document.getElementById("logsFromDate")?.value) {
    const today = new Date();
    const from = new Date(today); from.setDate(from.getDate() - 30);
    const inputDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    document.getElementById("logsFromDate").value = inputDate(from);
    document.getElementById("logsToDate").value = inputDate(today);
  }
  window.onLogsFilterChanged();
};

window.changeLogsPage = async function(direction) {
  logsCurrentPage = Math.min(logsTotalPages, Math.max(1, logsCurrentPage + (Number(direction) || 0)));
  await loadAuditLogsPage();
};

window.exportLogsCsv = function() {
  const currentPageRows = auditLogs;
  if (!currentPageRows.length) {
    window.showNotification({ title: "Export Warning", message: "No logs available to export.", type: "warning" });
    return;
  }
  let csv = "Timestamp,Operator,Department,Action,Details\n";
  currentPageRows.forEach(r => {
    const cell = value => String(value ?? "").replace(/"/g, '""');
    csv += `"${cell(r.timestamp)}","${cell(r.operator)}","${cell(r.dept)}","${cell(r.action)}","${cell(r.details)}"\n`;
  });
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `demosolar_audit_logs_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  logEvent("SYSTEM", "EXPORT_LOGS", `Exported ${currentPageRows.length} audit log records from page ${logsCurrentPage}.`);
};

// Always install the current security service worker without relying on the
// browser's HTTP cache. Its activate handler removes every older ERP cache.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js?v=20261030-fast-dashboard-v2", { updateViaCache: "none" })
      .then(registration => registration.update())
      .catch(error => console.warn("ERP service worker update failed.", error));
  }, { once: true });
}

