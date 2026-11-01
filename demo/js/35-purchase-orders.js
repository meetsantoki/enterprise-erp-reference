const PURCHASE_ORDER_COMPANY = Object.freeze({
  company: "DEMOSOLAR INDUSTRIES PVT. LTD. - DEMO UNIT",
  address: "Demo Industrial Park, Ahmedabad-380001, Gujarat, INDIA",
  gst: "24AAAAA0000A1Z5",
  pan: "AAAAA0000A"
});

const PURCHASE_ORDER_BILL_TO = Object.freeze({ ...PURCHASE_ORDER_COMPANY, contactName: "Aarav Mehta", mobile: "9000000001", email: "purchase@example.test" });
const PURCHASE_ORDER_SHIP_TO = Object.freeze({ ...PURCHASE_ORDER_COMPANY, contactName: "Rohan Kapoor", mobile: "9000000002", email: "scm@example.test" });
const PURCHASE_ORDER_IMPORT_SHIP_TO = Object.freeze({ ...PURCHASE_ORDER_COMPANY, contactName: "Neha Sharma", mobile: "9000000003", email: "info@example.test" });
const PURCHASE_ORDER_GST_RATES = [5, 12, 18, 28];
const PURCHASE_ORDER_UOMS = ["NOS", "KG", "LTR", "MTR", "SQM", "FEET", "SET"];
const PURCHASE_ORDER_UPLOADS = Object.freeze([
  { category: "PI", inputId: "purchaseOrderUploadPi", statusId: "purchaseOrderUploadPiStatus" },
  { category: "SPARE_PART_IMAGE", inputId: "purchaseOrderUploadSparePart", statusId: "purchaseOrderUploadSparePartStatus" },
  { category: "DATASHEET", inputId: "purchaseOrderUploadDatasheet", statusId: "purchaseOrderUploadDatasheetStatus" },
  { category: "OTHER_DOCUMENTS", inputId: "purchaseOrderUploadOther", statusId: "purchaseOrderUploadOtherStatus" }
]);

let purchaseOrderDraftItems = [];
let activeSavedPurchaseOrderId = "";
let editingPurchaseOrderId = "";
let purchaseOrderLogoCache = "";
let purchaseOrderStampCache = "";
const purchaseOrderPdfAssetCache = new Map();
let activePurchaseOrderApprovalId = "";

function purchaseOrderStatus(order) {
  const status = String(order?.status || "DRAFT").toUpperCase();
  return status === "SAVED" ? "DRAFT" : status;
}

function purchaseOrderStatusLabel(status) {
  return ({ DRAFT: "DRAFT", PENDING_APPROVAL: "PENDING APPROVAL", APPROVED: "APPROVED", REJECTED: "REJECTED" })[String(status || "").toUpperCase()] || String(status || "DRAFT").replace(/_/g, " ");
}

function purchaseOrderStatusBadge(order) {
  const status = purchaseOrderStatus(order);
  const colors = { DRAFT: ["#e2e8f0", "#334155"], PENDING_APPROVAL: ["#fef3c7", "#92400e"], APPROVED: ["#dcfce7", "#166534"], REJECTED: ["#fee2e2", "#991b1b"] };
  const [background, color] = colors[status] || colors.DRAFT;
  return `<span style="display:inline-block;padding:4px 8px;border-radius:999px;background:${background};color:${color};font-size:10px;font-weight:900;white-space:nowrap;">${purchaseOrderStatusLabel(status)}</span>`;
}

function purchaseOrderDeleteStatus(order) {
  return String(order?.deleteRequest?.status || "NONE").toUpperCase();
}

function purchaseOrderDeleteStatusBadge(order) {
  const status = purchaseOrderDeleteStatus(order);
  const styles = { PENDING: ["#fef3c7", "#92400e"], REJECTED: ["#fee2e2", "#991b1b"] };
  if (!styles[status]) return `<span style="color:#64748b;font-size:10px;font-weight:800;">NOT REQUESTED</span>`;
  const [background, color] = styles[status];
  return `<span style="display:inline-block;padding:4px 8px;border-radius:999px;background:${background};color:${color};font-size:10px;font-weight:900;white-space:nowrap;">${status === "PENDING" ? "PENDING ADMIN" : "REJECTED"}</span>`;
}

function purchaseOrderSignatureHtml(label, signature, fallbackName, autographPath = "", fixedSignerName = "") {
  const signer = fixedSignerName || signature?.signerName || fallbackName || signature?.signer || "SYSTEM";
  const signed = Boolean(signature?.signedAt);
  const autograph = signed && autographPath ? `<img class="po-live-autograph" src="${purchaseOrderEscape(autographPath)}" alt="${purchaseOrderEscape(signer)} signature">` : "";
  const artwork = signed
    ? `<img class="po-live-stamp" src="assets/demo-stamp.svg" alt="${purchaseOrderEscape(label)} stamp">${autograph}`
    : `<div style="height:100%;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:10px;font-weight:800;">AWAITING SIGNATURE</div>`;
  return `<div class="po-live-signature-art">${artwork}</div><strong>${label}<br>${signed ? purchaseOrderEscape(signer) : "Pending"}</strong>`;
}

function purchaseOrderEscape(value) {
  return typeof escapeSalesHtml === "function"
    ? escapeSalesHtml(String(value ?? ""))
    : String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function purchaseOrderCurrency(poType = purchaseOrderFieldValue("purchaseOrderType"), selectedCode = "") {
  if (!purchaseOrderIsImport(poType)) return { code: "INR", symbol: "₹", words: "Rupees", locale: "en-IN" };
  const fieldCode = String(document.getElementById("purchaseOrderImportCurrency")?.value || "").toUpperCase();
  const code = ["USD", "RMB"].includes(String(selectedCode || "").toUpperCase()) ? String(selectedCode).toUpperCase() : ["USD", "RMB"].includes(fieldCode) ? fieldCode : "USD";
  return code === "RMB"
    ? { code: "RMB", symbol: "¥", words: "Chinese Yuan", locale: "en-US" }
    : { code: "USD", symbol: "$", words: "US Dollars", locale: "en-US" };
}

function purchaseOrderRecordCurrency(order) {
  const fallback = purchaseOrderIsImport(order?.poType) ? "USD" : "INR";
  return purchaseOrderCurrency(order?.poType, order?.currency || fallback).code;
}

function purchaseOrderMoney(value, poType = purchaseOrderFieldValue("purchaseOrderType"), selectedCode = "") {
  const currency = purchaseOrderCurrency(poType, selectedCode);
  return `${currency.symbol}${Number(value || 0).toLocaleString(currency.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function purchaseOrderPdfMoney(value, poType = purchaseOrderFieldValue("purchaseOrderType"), selectedCode = "") {
  const currency = purchaseOrderCurrency(poType, selectedCode);
  const prefix = currency.code === "USD" ? "$" : "Rs. ";
  if (currency.code === "RMB") return `¥${Number(value || 0).toLocaleString(currency.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${prefix}${Number(value || 0).toLocaleString(currency.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function purchaseOrderAmountInWords(value, poType = purchaseOrderFieldValue("purchaseOrderType"), selectedCode = "") {
  const currency = purchaseOrderCurrency(poType, selectedCode);
  const amountWords = currency.code === "USD" ? purchaseOrderInternationalNumberWords(value) : purchaseOrderNumberWords(value);
  return `${currency.words} ${amountWords} Only`;
}

function selectedPurchaseOrderVendor() {
  const selected = String(document.getElementById("purchaseOrderVendor")?.value || "");
  return (purchaseVendorsDb || []).find(vendor => String(vendor.id || vendor.vendorCode || "") === selected) || null;
}

function purchaseOrderVendorAddress(vendor) {
  if (!vendor) return "";
  const office = [vendor.officeAddressLine1, vendor.officeAddressLine2, vendor.officeCity, vendor.officeState, vendor.officeCountry, vendor.officePostalCode].filter(Boolean).join(", ");
  const factory = [vendor.factoryAddressLine1, vendor.factoryAddressLine2, vendor.factoryCity, vendor.factoryState, vendor.factoryCountry, vendor.factoryPostalCode].filter(Boolean).join(", ");
  return office || factory || vendor.address || "";
}

function purchaseOrderIsImport(poType = purchaseOrderFieldValue("purchaseOrderType")) {
  return String(poType || "").toUpperCase() === "IMPORT";
}

function purchaseOrderShipTo(poType = purchaseOrderFieldValue("purchaseOrderType")) {
  return { ...(purchaseOrderIsImport(poType) ? PURCHASE_ORDER_IMPORT_SHIP_TO : PURCHASE_ORDER_SHIP_TO) };
}

function purchaseOrderTaxMode(vendor = selectedPurchaseOrderVendor(), poType = purchaseOrderFieldValue("purchaseOrderType")) {
  if (purchaseOrderIsImport(poType)) return "IMPORT";
  const gst = String(vendor?.gst || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (gst.length !== 15) return "";
  return gst.slice(0, 2) === "24" ? "INTRA" : "INTER";
}

function syncPurchaseOrderCurrencyField() {
  const wrapper = document.getElementById("purchaseOrderImportCurrencyField");
  const select = document.getElementById("purchaseOrderImportCurrency");
  const isImport = purchaseOrderIsImport();
  if (select && isImport && !["USD", "RMB"].includes(String(select.value || "").toUpperCase())) select.value = "USD";
  if (wrapper) wrapper.classList.toggle("show", isImport);
}

window.handlePurchaseOrderCurrencyChange = function() {
  activeSavedPurchaseOrderId = "";
  renderPurchaseOrderItems();
  refreshPurchaseOrderCalculations();
};

function newPurchaseOrderItem() {
  return { id: `POITEM-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, itemCode: "", description: "", hsn: "", qty: "", uom: "NOS", rate: "", gstRate: "" };
}

function purchaseOrderItemAmounts(item, taxMode = purchaseOrderTaxMode()) {
  const qty = Number(item?.qty || 0);
  const rate = Number(item?.rate || 0);
  const gstRate = Number(item?.gstRate || 0);
  const taxable = qty * rate;
  const tax = taxMode === "IMPORT" ? 0 : taxable * gstRate / 100;
  return { taxable, cgst: taxMode === "INTRA" ? tax / 2 : 0, sgst: taxMode === "INTRA" ? tax / 2 : 0, igst: taxMode === "INTER" ? tax : 0, total: taxable + tax };
}

function purchaseOrderRoundToNearestRupee(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return amount >= 0
    ? Math.floor(amount + 0.5 + Number.EPSILON)
    : Math.ceil(amount - 0.5 - Number.EPSILON);
}

function purchaseOrderTotals(items = purchaseOrderDraftItems, taxMode = purchaseOrderTaxMode()) {
  const totals = (items || []).reduce((sum, item) => {
    const amount = purchaseOrderItemAmounts(item, taxMode);
    sum.subtotal += amount.taxable; sum.cgst += amount.cgst; sum.sgst += amount.sgst; sum.igst += amount.igst;
    return sum;
  }, { subtotal: 0, cgst: 0, sgst: 0, igst: 0 });
  const beforeRound = totals.subtotal + totals.cgst + totals.sgst + totals.igst;
  totals.grandTotal = purchaseOrderRoundToNearestRupee(beforeRound);
  totals.roundOff = totals.grandTotal - beforeRound;
  return totals;
}

function populatePurchaseOrderVendors() {
  const select = document.getElementById("purchaseOrderVendor");
  if (!select) return;
  const previous = select.value;
  const vendors = (purchaseVendorsDb || []).filter(vendor => String(vendor.status || "ACTIVE").toUpperCase() !== "INACTIVE");
  const codeOptions = document.getElementById("purchaseOrderVendorCodeOptions");
  const nameOptions = document.getElementById("purchaseOrderVendorNameOptions");
  if (codeOptions) codeOptions.innerHTML = vendors.map(vendor => `<option value="${purchaseOrderEscape(vendor.vendorCode || "")}" label="${purchaseOrderEscape(vendor.name || "")}"></option>`).join("");
  if (nameOptions) nameOptions.innerHTML = vendors.map(vendor => `<option value="${purchaseOrderEscape(vendor.name || "")}" label="${purchaseOrderEscape(vendor.vendorCode || "")}"></option>`).join("");
  const selected = vendors.find(vendor => String(vendor.id || vendor.vendorCode || "") === previous);
  select.value = selected ? String(selected.id || selected.vendorCode || "") : "";
  const codeField = document.getElementById("purchaseOrderVendorCodeSearch");
  const nameField = document.getElementById("purchaseOrderVendorNameSearch");
  if (selected) {
    if (codeField) codeField.value = selected.vendorCode || "";
    if (nameField) nameField.value = selected.name || "";
  }
}

window.handlePurchaseOrderVendorSearch = function(source) {
  const select = document.getElementById("purchaseOrderVendor");
  const codeField = document.getElementById("purchaseOrderVendorCodeSearch");
  const nameField = document.getElementById("purchaseOrderVendorNameSearch");
  if (!select || !codeField || !nameField) return;
  const vendors = (purchaseVendorsDb || []).filter(vendor => String(vendor.status || "ACTIVE").toUpperCase() !== "INACTIVE");
  const searchValue = String(source === "code" ? codeField.value : nameField.value).trim().toLowerCase();
  const selected = vendors.find(vendor => String(source === "code" ? vendor.vendorCode || "" : vendor.name || "").trim().toLowerCase() === searchValue);
  if (selected) {
    select.value = String(selected.id || selected.vendorCode || "");
    codeField.value = selected.vendorCode || "";
    nameField.value = selected.name || "";
  } else {
    select.value = "";
    if (source === "code") nameField.value = "";
    else codeField.value = "";
  }
  window.handlePurchaseOrderVendorChange();
};

function renderPurchaseOrderVendorSummary() {
  const vendor = selectedPurchaseOrderVendor();
  const summary = document.getElementById("purchaseOrderVendorSummary");
  const badge = document.getElementById("purchaseOrderTaxModeBadge");
  const mode = purchaseOrderTaxMode(vendor);
  if (!vendor) {
    if (summary) { summary.innerHTML = ""; summary.style.display = "none"; }
    if (badge) badge.textContent = "Select a vendor to determine GST";
    return;
  }
  const contactName = vendor.salesPersonName || vendor.contactPerson || "-";
  const mobile = vendor.salesPersonMobile || vendor.contactNumber || "-";
  const email = vendor.salesPersonEmail || vendor.email || "-";
  if (summary) { summary.style.display = "grid"; summary.innerHTML = `
    <div><strong>Vendor Code</strong>${purchaseOrderEscape(vendor.vendorCode || "-")}</div>
    <div><strong>Vendor Name</strong>${purchaseOrderEscape(vendor.name || "-")}</div>
    <div><strong>GSTIN</strong>${purchaseOrderEscape(vendor.gst || "GSTIN unavailable")}</div>
    <div><strong>PAN</strong>${purchaseOrderEscape(vendor.pan || "-")}</div>
    <div style="grid-column:span 2;"><strong>Address</strong>${purchaseOrderEscape(purchaseOrderVendorAddress(vendor) || "-")}</div>
    <div><strong>Contact Name / Mobile</strong>${purchaseOrderEscape(contactName)} / ${purchaseOrderEscape(mobile)}</div>
    <div><strong>Email</strong>${purchaseOrderEscape(email)}</div>`; }
  if (badge) badge.textContent = mode === "IMPORT" ? "Import PO: No GST" : mode === "INTRA" ? "GST Mode: CGST + SGST" : mode === "INTER" ? "GST Mode: IGST" : "Valid GSTIN required";
}

window.handlePurchaseOrderVendorChange = function() {
  activeSavedPurchaseOrderId = "";
  const exportButton = document.getElementById("purchaseOrderExportButton");
  if (exportButton) exportButton.disabled = true;
  renderPurchaseOrderVendorSummary();
  renderPurchaseOrderItems();
  refreshPurchaseOrderCalculations();
};

window.addPurchaseOrderItem = function() {
  purchaseOrderDraftItems.push(newPurchaseOrderItem());
  renderPurchaseOrderItems();
  refreshPurchaseOrderCalculations();
};

window.removePurchaseOrderItem = function(id) {
  purchaseOrderDraftItems = purchaseOrderDraftItems.filter(item => item.id !== id);
  if (!purchaseOrderDraftItems.length) purchaseOrderDraftItems.push(newPurchaseOrderItem());
  renderPurchaseOrderItems();
  refreshPurchaseOrderCalculations();
};

window.updatePurchaseOrderItem = function(id, field, value) {
  const item = purchaseOrderDraftItems.find(row => row.id === id);
  if (!item) return;
  item[field] = ["qty", "rate", "gstRate"].includes(field) ? value.replace(/[^0-9.]/g, "") : value;
  activeSavedPurchaseOrderId = "";
  const exportButton = document.getElementById("purchaseOrderExportButton");
  if (exportButton) exportButton.disabled = true;
  refreshPurchaseOrderCalculations();
};

function renderPurchaseOrderItems() {
  const head = document.getElementById("purchaseOrderItemsHead");
  const body = document.getElementById("purchaseOrderItemsBody");
  if (!head || !body) return;
  const mode = purchaseOrderTaxMode();
  const isImport = mode === "IMPORT";
  const taxLabel = mode === "INTRA" ? "CGST / SGST Amount" : mode === "INTER" ? "IGST Amount" : "Tax Amount";
  head.innerHTML = "";
  body.innerHTML = purchaseOrderDraftItems.map((item, index) => {
    const amounts = purchaseOrderItemAmounts(item, mode);
    const uomOptions = PURCHASE_ORDER_UOMS.map(code => `<option value="${code}" ${item.uom === code ? "selected" : ""}>${code}</option>`).join("");
    const gstOptions = `<option value="">Select</option>${PURCHASE_ORDER_GST_RATES.map(rate => `<option value="${rate}" ${Number(item.gstRate) === rate ? "selected" : ""}>${rate}%</option>`).join("")}`;
    const taxCell = mode === "INTRA"
      ? `<div class="po-readonly-cell purchase-order-tax-pair"><div><span>CGST</span><strong id="poItemCgst-${item.id}">${purchaseOrderMoney(amounts.cgst)}</strong></div><div><span>SGST</span><strong id="poItemSgst-${item.id}">${purchaseOrderMoney(amounts.sgst)}</strong></div></div>`
      : `<div class="po-readonly-cell" id="poItemIgst-${item.id}">${purchaseOrderMoney(amounts.igst)}</div>`;
    const gstField = isImport ? "" : `<div class="purchase-order-item-field"><label>GST %</label><select onchange="updatePurchaseOrderItem('${item.id}','gstRate',this.value)">${gstOptions}</select></div>`;
    const taxableField = isImport ? "" : `<div class="purchase-order-item-field"><label>Taxable Value</label><div class="po-readonly-cell" id="poItemTaxable-${item.id}">${purchaseOrderMoney(amounts.taxable)}</div></div>`;
    const taxField = isImport ? "" : `<div class="purchase-order-item-field"><label>${taxLabel}</label>${taxCell}</div>`;
    return `<article class="purchase-order-item-card${isImport ? " purchase-order-import-item" : ""}">
      <div class="purchase-order-item-card-row po-item-primary-grid">
        <div class="purchase-order-item-field"><label>Sr.</label><div class="purchase-order-item-number">${index + 1}</div></div>
        <div class="purchase-order-item-field"><label>Item Code</label><input value="${purchaseOrderEscape(item.itemCode)}" oninput="updatePurchaseOrderItem('${item.id}','itemCode',this.value)" placeholder="Code"></div>
        <div class="purchase-order-item-field"><label>Description of Goods</label><input value="${purchaseOrderEscape(item.description)}" oninput="updatePurchaseOrderItem('${item.id}','description',this.value)" placeholder="Item description"></div>
        <div class="purchase-order-item-field"><label>HSN/SAC</label><input value="${purchaseOrderEscape(item.hsn)}" oninput="updatePurchaseOrderItem('${item.id}','hsn',this.value)" placeholder="HSN/SAC"></div>
        <div class="purchase-order-item-field"><label>Qty</label><input value="${purchaseOrderEscape(item.qty)}" oninput="updatePurchaseOrderItem('${item.id}','qty',this.value)" inputmode="decimal" placeholder="0"></div>
        <div class="purchase-order-item-field"><label>UOM</label><select onchange="updatePurchaseOrderItem('${item.id}','uom',this.value)">${uomOptions}</select></div>
      </div>
      <div class="purchase-order-item-card-row po-item-secondary-grid">
        <div class="purchase-order-item-field"><label>Rate</label><input value="${purchaseOrderEscape(item.rate)}" oninput="updatePurchaseOrderItem('${item.id}','rate',this.value)" inputmode="decimal" placeholder="0.00"></div>
        ${gstField}
        ${taxableField}
        ${taxField}
        <div class="purchase-order-item-field"><label>Total</label><div class="po-readonly-cell" id="poItemTotal-${item.id}">${purchaseOrderMoney(amounts.total)}</div></div>
        <div class="purchase-order-item-field purchase-order-item-remove-field"><label>Remove</label><button type="button" class="purchase-order-remove" onclick="removePurchaseOrderItem('${item.id}')" title="Remove item">×</button></div>
      </div>
    </article>`;
  }).join("");
}

function refreshPurchaseOrderCalculations() {
  const mode = purchaseOrderTaxMode();
  purchaseOrderDraftItems.forEach(item => {
    const amounts = purchaseOrderItemAmounts(item, mode);
    const values = { [`poItemTaxable-${item.id}`]: amounts.taxable, [`poItemCgst-${item.id}`]: amounts.cgst, [`poItemSgst-${item.id}`]: amounts.sgst, [`poItemIgst-${item.id}`]: amounts.igst, [`poItemTotal-${item.id}`]: amounts.total };
    Object.entries(values).forEach(([id, value]) => { const cell = document.getElementById(id); if (cell) cell.textContent = purchaseOrderMoney(value); });
  });
  const totals = purchaseOrderTotals();
  const display = { purchaseOrderSubtotal: totals.subtotal, purchaseOrderCgst: totals.cgst, purchaseOrderSgst: totals.sgst, purchaseOrderIgst: totals.igst, purchaseOrderRoundOff: totals.roundOff, purchaseOrderGrandTotal: totals.grandTotal };
  Object.entries(display).forEach(([id, value]) => { const element = document.getElementById(id); if (element) element.textContent = purchaseOrderMoney(value); });
  const cgstRow = document.getElementById("purchaseOrderCgstRow"), sgstRow = document.getElementById("purchaseOrderSgstRow"), igstRow = document.getElementById("purchaseOrderIgstRow");
  if (cgstRow) cgstRow.style.display = mode === "INTRA" ? "flex" : "none";
  if (sgstRow) sgstRow.style.display = mode === "INTRA" ? "flex" : "none";
  if (igstRow) igstRow.style.display = mode === "INTER" ? "flex" : "none";
  const sectionLabel = document.getElementById("purchaseOrderItemsSectionLabel");
  if (sectionLabel) sectionLabel.textContent = mode === "IMPORT" ? "2. ITEMS AND TOTAL" : "2. ITEMS, GST AND TOTAL";
  window.renderPurchaseOrderLivePreview?.();
}

function purchaseOrderFieldValue(id) { return String(document.getElementById(id)?.value || "").trim(); }

function purchaseOrderFinancialYear(dateValue) {
  const match = String(dateValue || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getFullYear();
  const month = match ? Number(match[2]) : now.getMonth() + 1;
  const startYear = month >= 4 ? year : year - 1;
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

function nextPurchaseOrderNumber(dateValue = purchaseOrderFieldValue("purchaseOrderDate")) {
  const financialYear = purchaseOrderFinancialYear(dateValue);
  const matcher = /^DEMOU2\/PO\/(\d{2}-\d{2})\/(\d+)$/i;
  const highestSerial = (purchaseOrdersDb || []).reduce((highest, order) => {
    const match = String(order?.poNumber || "").trim().match(matcher);
    return match && match[1] === financialYear ? Math.max(highest, Number(match[2]) || 0) : highest;
  }, 0);
  return `DEMOU2/PO/${financialYear}/${String(highestSerial + 1).padStart(4, "0")}`;
}

function refreshPurchaseOrderNumber(force = false) {
  const field = document.getElementById("purchaseOrderNumber");
  if (!field || (!force && field.value)) return;
  field.value = nextPurchaseOrderNumber();
}

window.updatePurchaseOrderUploadStatus = function(category) {
  const config = PURCHASE_ORDER_UPLOADS.find(item => item.category === category);
  if (!config) return;
  const files = Array.from(document.getElementById(config.inputId)?.files || []);
  const status = document.getElementById(config.statusId);
  if (status) status.textContent = files.length ? `${files.length} file(s): ${files.map(file => file.name).join(", ")}` : "No file selected";
};

function clearPurchaseOrderUploads() {
  PURCHASE_ORDER_UPLOADS.forEach(config => {
    const input = document.getElementById(config.inputId);
    const status = document.getElementById(config.statusId);
    if (input) input.value = "";
    if (status) status.textContent = "No file selected";
  });
}

async function uploadPurchaseOrderDocuments(poNumber) {
  const uploaded = [];
  for (const config of PURCHASE_ORDER_UPLOADS) {
    const files = Array.from(document.getElementById(config.inputId)?.files || []);
    for (const file of files) {
      const form = new FormData();
      form.append("poNumber", poNumber);
      form.append("category", config.category);
      form.append("file", file, file.name);
      const response = await erpFetchWithTimeout("backend/api.php?action=upload_purchase_order_document", { method: "POST", credentials: "same-origin", body: form }, 30 * 60 * 1000);
      const result = await response.json().catch(() => ({ status: "error", message: "The server returned an invalid upload response." }));
      if (!response.ok || String(result.status || "").toLowerCase() !== "success") throw new Error(result.message || `Could not upload ${file.name}.`);
      uploaded.push(result.document);
    }
  }
  return uploaded;
}

window.handlePurchaseOrderDateChange = function() {
  activeSavedPurchaseOrderId = "";
  const exportButton = document.getElementById("purchaseOrderExportButton");
  if (exportButton) exportButton.disabled = true;
  if (!editingPurchaseOrderId) refreshPurchaseOrderNumber(true);
  window.renderPurchaseOrderLivePreview?.();
};

window.handlePurchaseOrderDetailChange = function() {
  activeSavedPurchaseOrderId = "";
  syncPurchaseOrderCurrencyField();
  renderPurchaseOrderVendorSummary();
  renderPurchaseOrderItems();
  refreshPurchaseOrderCalculations();
};

function purchaseOrderPreviewDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : text || "-";
}

function purchaseOrderMetaLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "-";
  return text.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function purchaseOrderPreviewHtml(order = null) {
  const vendor = order?.vendor || selectedPurchaseOrderVendor();
  const fieldValue = (id, key) => order ? String(order[key] || "") : purchaseOrderFieldValue(id);
  const poType = fieldValue("purchaseOrderType", "poType");
  const currencyCode = order ? purchaseOrderRecordCurrency(order) : purchaseOrderCurrency(poType, purchaseOrderFieldValue("purchaseOrderImportCurrency")).code;
  const mode = purchaseOrderIsImport(poType) ? "IMPORT" : order?.taxMode || purchaseOrderTaxMode(vendor, poType);
  const items = order?.items || purchaseOrderDraftItems;
  const totals = order?.totals || purchaseOrderTotals(items, mode);
  const billTo = order?.billTo || PURCHASE_ORDER_BILL_TO;
  const shipTo = purchaseOrderIsImport(poType) ? purchaseOrderShipTo(poType) : order?.shipTo || purchaseOrderShipTo(poType);
  const safe = purchaseOrderEscape;
  const vendorName = vendor?.name || "Select Vendor";
  const vendorCode = vendor?.vendorCode || "-";
  const vendorAddress = (order ? vendor?.address : purchaseOrderVendorAddress(vendor)) || "-";
  const vendorGst = vendor?.gst || "-";
  const vendorPan = vendor?.pan || "-";
  const vendorContact = vendor?.contactName || vendor?.salesPersonName || vendor?.contactPerson || "-";
  const vendorMobile = vendor?.mobile || vendor?.salesPersonMobile || vendor?.contactNumber || "-";
  const vendorEmail = vendor?.email || vendor?.salesPersonEmail || "-";
  const gstHead = mode === "IMPORT" ? "" : "<th>GST %</th>";
  const taxableHead = mode === "IMPORT" ? "" : "<th>Taxable</th>";
  const taxHead = mode === "IMPORT" ? "" : mode === "INTRA" ? "<th>CGST</th><th>SGST</th>" : `<th>${mode === "INTER" ? "IGST" : "Tax"}</th>`;
  const columnWidths = mode === "IMPORT" ? [5,11,31,11,8,9,12,13] : mode === "INTRA" ? [4,7,17,7,5,6,8,6,10,8,8,14] : [4,8,20,8,6,7,9,7,11,8,12];
  const colgroup = `<colgroup>${columnWidths.map(width => `<col style="width:${width}%">`).join("")}</colgroup>`;
  const renderedItemRows = items.map((item, index) => {
    const amount = purchaseOrderItemAmounts(item, mode);
    const taxCells = mode === "IMPORT" ? "" : mode === "INTRA"
      ? `<td>${purchaseOrderMoney(amount.cgst, poType, currencyCode)}</td><td>${purchaseOrderMoney(amount.sgst, poType, currencyCode)}</td>`
      : `<td>${purchaseOrderMoney(amount.igst, poType, currencyCode)}</td>`;
    const gstCell = mode === "IMPORT" ? "" : `<td>${item.gstRate ? `${safe(item.gstRate)}%` : ""}</td>`;
    const taxableCell = mode === "IMPORT" ? "" : `<td>${purchaseOrderMoney(amount.taxable, poType, currencyCode)}</td>`;
    return `<tr><td>${index + 1}</td><td>${safe(item.itemCode || "")}</td><td class="description">${safe(item.description || "")}</td><td>${safe(item.hsn || "")}</td><td>${safe(item.qty || "")}</td><td>${safe(item.uom || "")}</td><td>${purchaseOrderMoney(item.rate, poType, currencyCode)}</td>${gstCell}${taxableCell}${taxCells}<td>${purchaseOrderMoney(amount.total, poType, currencyCode)}</td></tr>`;
  });
  const blankCellCount = mode === "IMPORT" ? 8 : mode === "INTRA" ? 12 : 11;
  const itemRows = renderedItemRows.length ? renderedItemRows.join("") : `<tr>${Array.from({ length: blankCellCount }, (_, index) => `<td>${index === 0 ? "&nbsp;" : ""}</td>`).join("")}</tr>`;
  const taxRows = mode === "IMPORT" ? "" : mode === "INTRA"
    ? `<div class="po-live-totals-row"><span>CGST</span><span>${purchaseOrderMoney(totals.cgst, poType, currencyCode)}</span></div><div class="po-live-totals-row"><span>SGST</span><span>${purchaseOrderMoney(totals.sgst, poType, currencyCode)}</span></div>`
    : `<div class="po-live-totals-row"><span>${mode === "INTER" ? "IGST" : "Tax"}</span><span>${purchaseOrderMoney(totals.igst, poType, currencyCode)}</span></div>`;
  const partyRow = (label, value) => `<div class="po-live-party-row"><strong>${label}:</strong><span>${safe(value)}</span></div>`;
  const partyBlock = (title, party) => `<div class="po-live-block"><div class="po-live-bar">${title}</div><div class="po-live-lines">${partyRow("Company", party.company)}${partyRow("Address", party.address)}${partyRow("GSTIN", party.gst)}${partyRow("PAN", party.pan)}${partyRow("Contact Name", party.contactName)}${partyRow("Mobile", party.mobile)}${partyRow("Email", party.email)}</div></div>`;
  return `
    <div class="po-live-top"><div class="po-live-logo"><img src="assets/demo-logo.svg" alt="DemoSolar Industries"></div><div class="po-live-heading"><svg viewBox="0 0 340 54" role="img" aria-label="Purchase Order"><defs><linearGradient id="poTitleGradient" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#0c4a6e"></stop><stop offset="52%" stop-color="#0781a6"></stop><stop offset="100%" stop-color="#22c55e"></stop></linearGradient></defs><text x="0" y="39" text-anchor="start" fill="url(#poTitleGradient)">PURCHASE ORDER</text></svg></div><div class="po-live-iso"><div class="po-live-iso-inner"><div class="po-live-iso-row"><strong>Document No.:</strong><span>DEMOU2/PUR/F/01</span></div><div class="po-live-iso-row"><strong>Issue Date:</strong><span>03.09.2025</span></div><div class="po-live-iso-row"><strong>Rev:</strong><span>00</span></div></div></div></div>
    <div class="po-live-details">
      <div class="po-live-detail-column po-live-lines po-live-supplier-lines">${partyRow("Supplier Code", vendorCode)}${partyRow("Supplier Name", vendorName)}${partyRow("Address", vendorAddress)}${partyRow("GSTIN", vendorGst)}${partyRow("PAN", vendorPan)}${partyRow("Contact Name", vendorContact)}${partyRow("Mobile", vendorMobile)}${partyRow("Email", vendorEmail)}</div>
      <div class="po-live-detail-column po-live-lines po-live-document-lines">${partyRow("PO Date", purchaseOrderPreviewDate(fieldValue("purchaseOrderDate", "poDate")))}${partyRow("PO No.", fieldValue("purchaseOrderNumber", "poNumber") || "-")}${partyRow("PO Type", purchaseOrderMetaLabel(fieldValue("purchaseOrderType", "poType")))}${partyRow("Material Type", purchaseOrderMetaLabel(fieldValue("purchaseOrderMaterialType", "materialType")))}${partyRow("Currency", currencyCode)}</div>
    </div>
    <div class="po-live-two">${partyBlock("BILL TO", billTo)}${partyBlock("SHIP TO", shipTo)}</div>
    <table class="po-live-items">${colgroup}<thead><tr><th>Sr.</th><th>Item</th><th>Description of Goods</th><th>HSN/SAC</th><th>Qty</th><th>UOM</th><th>Rate</th>${gstHead}${taxableHead}${taxHead}<th>Total</th></tr></thead><tbody>${itemRows}</tbody></table>
    <div class="po-live-summary"><div class="po-live-remarks"><div class="po-live-bar">REMARKS</div><div class="po-live-remarks-content">${safe(fieldValue("purchaseOrderRemarks", "remarks") || "")}</div></div><div class="po-live-totals"><div class="po-live-totals-row"><span>Subtotal</span><span>${purchaseOrderMoney(totals.subtotal, poType, currencyCode)}</span></div>${taxRows}<div class="po-live-totals-row"><span>Round Off</span><span>${purchaseOrderMoney(totals.roundOff, poType, currencyCode)}</span></div><div class="po-live-totals-row"><span>Grand Total</span><span>${purchaseOrderMoney(totals.grandTotal, poType, currencyCode)}</span></div></div></div>
    <div class="po-live-amount-words"><div class="po-live-bar">AMOUNT IN WORDS</div><div class="po-live-amount-value">${purchaseOrderAmountInWords(totals.grandTotal, poType, currencyCode)}</div></div>
    <div class="po-live-bar po-live-other-information-bar" style="text-align:center;">OTHER INFORMATION</div>
    <div class="po-live-info"><div><strong>SHIP VIA</strong><span>${safe(fieldValue("purchaseOrderShipVia", "shipVia") || "-")}</span></div><div><strong>SHIPPING TERMS</strong><span>${safe(fieldValue("purchaseOrderShippingTerms", "shippingTerms") || "-")}</span></div><div><strong>PAYMENT TERMS</strong><span>${safe(fieldValue("purchaseOrderPaymentTerms", "paymentTerms") || "-")}</span></div><div><strong>DELIVERY DATE</strong><span>${safe(purchaseOrderPreviewDate(fieldValue("purchaseOrderDeliveryDate", "deliveryDate")))}</span></div></div>
    <div class="po-live-signatures"><div class="po-live-signature">${purchaseOrderSignatureHtml("PREPARED BY", order?.preparedSignature, order?.preparedName || order?.preparedBy, "assets/demo-signature.svg?v=20261022-signature-v2", "Rohan Kapoor (Purchase Manager)")}</div><div class="po-live-signature">${purchaseOrderSignatureHtml("APPROVED BY", order?.approvedSignature, order?.approvedName || order?.approvedBy, "assets/demo-signature.svg", "Aarav Mehta (Chief Procurement Officer)")}</div></div>`;
}

window.renderPurchaseOrderLivePreview = function() {
  const preview = document.getElementById("purchaseOrderLivePreview");
  if (!preview) return;
  preview.innerHTML = purchaseOrderPreviewHtml();
};

function setPurchaseOrderEditMode(order = null) {
  editingPurchaseOrderId = order?.id || "";
  const banner = document.getElementById("purchaseOrderEditBanner");
  const title = document.getElementById("purchaseOrderFormTitle");
  const saveButton = document.getElementById("purchaseOrderSaveButton");
  if (banner) {
    banner.style.display = order ? "block" : "none";
    banner.textContent = order ? `Editing ${order.poNumber}. Saving changes returns this PO to Draft and fresh Administrator approval will be required.` : "";
  }
  if (title) title.textContent = order ? `Edit Purchase Order — ${order.poNumber}` : "Purchase Order";
  if (saveButton) saveButton.textContent = order ? "💾 Update PO" : "💾 Save Draft";
}

window.resetPurchaseOrderForm = function() {
  ["purchaseOrderNumber", "purchaseOrderType", "purchaseOrderMaterialType", "purchaseOrderImportCurrency", "purchaseOrderShipVia", "purchaseOrderShippingTerms", "purchaseOrderPaymentTerms", "purchaseOrderDeliveryDate", "purchaseOrderRemarks"].forEach(id => { const field = document.getElementById(id); if (field) field.value = ""; });
  const vendor = document.getElementById("purchaseOrderVendor"); if (vendor) vendor.value = "";
  const vendorCode = document.getElementById("purchaseOrderVendorCodeSearch"); if (vendorCode) vendorCode.value = "";
  const vendorName = document.getElementById("purchaseOrderVendorNameSearch"); if (vendorName) vendorName.value = "";
  clearPurchaseOrderUploads();
  const date = document.getElementById("purchaseOrderDate"); if (date) date.value = new Date().toISOString().slice(0, 10);
  refreshPurchaseOrderNumber(true);
  purchaseOrderDraftItems = [newPurchaseOrderItem()]; activeSavedPurchaseOrderId = ""; setPurchaseOrderEditMode();
  const exportButton = document.getElementById("purchaseOrderExportButton"); if (exportButton) exportButton.disabled = true;
  syncPurchaseOrderCurrencyField(); renderPurchaseOrderVendorSummary(); renderPurchaseOrderItems(); refreshPurchaseOrderCalculations();
};

window.openPurchaseOrderCreateView = async function(button) {
  window.resetPurchaseOrderForm();
  await window.switchView("purchaseOrder", button, "Purchase > PO > Purchase Order");
};

function validatePurchaseOrderDraft() {
  const vendor = selectedPurchaseOrderVendor();
  if (!vendor) return "Select a vendor.";
  if (!purchaseOrderFieldValue("purchaseOrderNumber")) return "Enter the Purchase Order number.";
  if (!purchaseOrderFieldValue("purchaseOrderDate")) return "Select the Purchase Order date.";
  const poType = purchaseOrderFieldValue("purchaseOrderType");
  if (!["DOMESTIC", "IMPORT"].includes(poType)) return "Select Domestic or Import as the PO type.";
  if (purchaseOrderIsImport(poType) && !["USD", "RMB"].includes(purchaseOrderFieldValue("purchaseOrderImportCurrency"))) return "Select Dollar (USD) or Renminbi (RMB) as the Import PO currency.";
  if (!purchaseOrderIsImport(poType) && !purchaseOrderTaxMode(vendor, poType)) return "The selected vendor must have a valid 15-character GSTIN before tax can be calculated.";
  if (!["RM", "SPARES", "SERVICE", "CAPITAL_GOODS", "CONSUMABLES"].includes(purchaseOrderFieldValue("purchaseOrderMaterialType"))) return "Select a valid material type.";
  if (!purchaseOrderDraftItems.length) return "Add at least one item.";
  for (let index = 0; index < purchaseOrderDraftItems.length; index += 1) {
    const item = purchaseOrderDraftItems[index];
    if (!String(item.description || "").trim()) return `Enter the description for item ${index + 1}.`;
    if (!(Number(item.qty) > 0)) return `Enter a quantity greater than zero for item ${index + 1}.`;
    if (!(Number(item.rate) >= 0) || String(item.rate).trim() === "") return `Enter the rate for item ${index + 1}.`;
    if (!purchaseOrderIsImport(poType) && !PURCHASE_ORDER_GST_RATES.includes(Number(item.gstRate))) return `Select 5%, 12%, 18% or 28% GST for item ${index + 1}.`;
    if (!PURCHASE_ORDER_UOMS.includes(item.uom)) return `Select a valid UOM for item ${index + 1}.`;
  }
  const poNumber = purchaseOrderFieldValue("purchaseOrderNumber").toLowerCase();
  if ((purchaseOrdersDb || []).some(order => String(order.id) !== String(editingPurchaseOrderId) && String(order.poNumber || "").trim().toLowerCase() === poNumber)) return "This Purchase Order number already exists.";
  return "";
}

window.savePurchaseOrder = async function() {
  const editingOrder = editingPurchaseOrderId ? (purchaseOrdersDb || []).find(order => String(order.id) === String(editingPurchaseOrderId)) : null;
  if (editingPurchaseOrderId && !editingOrder) {
    window.showNotification({ title: "PO Not Found", message: "The Purchase Order being edited is no longer available. Refresh Edit PO and try again.", type: "danger" });
    return null;
  }
  if (!editingOrder) refreshPurchaseOrderNumber(!activeSavedPurchaseOrderId);
  const validation = validatePurchaseOrderDraft();
  if (validation) { window.showNotification({ title: "Purchase Order Incomplete", message: validation, type: "warning" }); return null; }
  const vendor = selectedPurchaseOrderVendor();
  const poType = purchaseOrderFieldValue("purchaseOrderType");
  const mode = purchaseOrderTaxMode(vendor, poType);
  const items = purchaseOrderDraftItems.map(item => ({ ...item, qty: Number(item.qty), rate: Number(item.rate), gstRate: purchaseOrderIsImport(poType) ? 0 : Number(item.gstRate), ...purchaseOrderItemAmounts(item, mode) }));
  const record = {
    id: editingOrder?.id || `PURCHASE-ORDER-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    poNumber: purchaseOrderFieldValue("purchaseOrderNumber"), poDate: purchaseOrderFieldValue("purchaseOrderDate"), poType: purchaseOrderFieldValue("purchaseOrderType"), materialType: purchaseOrderFieldValue("purchaseOrderMaterialType"),
    vendorId: String(vendor.id || vendor.vendorCode), vendor: { id: vendor.id || "", vendorCode: vendor.vendorCode || "", name: vendor.name || "", gst: String(vendor.gst || "").toUpperCase(), pan: String(vendor.pan || "").toUpperCase(), address: purchaseOrderVendorAddress(vendor), contactName: vendor.salesPersonName || vendor.contactPerson || "", mobile: vendor.salesPersonMobile || vendor.contactNumber || "", email: vendor.salesPersonEmail || vendor.email || "" },
    taxMode: mode, currency: purchaseOrderCurrency(poType).code, items, billTo: { ...PURCHASE_ORDER_BILL_TO }, shipTo: purchaseOrderShipTo(poType),
    shipVia: purchaseOrderFieldValue("purchaseOrderShipVia"), shippingTerms: purchaseOrderFieldValue("purchaseOrderShippingTerms"), paymentTerms: purchaseOrderFieldValue("purchaseOrderPaymentTerms"), deliveryDate: purchaseOrderFieldValue("purchaseOrderDeliveryDate"), remarks: purchaseOrderFieldValue("purchaseOrderRemarks"),
    totals: purchaseOrderTotals(items, mode), status: "DRAFT", createdAt: editingOrder?.createdAt || new Date().toISOString(), createdBy: editingOrder?.createdBy || currentLoggedInUser?.username || "SYSTEM",
    documents: Array.isArray(editingOrder?.documents) ? [...editingOrder.documents] : [], preparedSignature: null, approvedSignature: null
  };
  if (editingOrder) {
    try {
      const uploadedDocuments = await uploadPurchaseOrderDocuments(record.poNumber);
      if (uploadedDocuments.length) record.documents.push(...uploadedDocuments);
      const updated = await runPurchaseOrderWorkflow("EDIT", record.id, "", record);
      activeSavedPurchaseOrderId = updated.id;
      setPurchaseOrderEditMode(updated);
      if (uploadedDocuments.length) clearPurchaseOrderUploads();
      renderSavedPurchaseOrders();
      window.preparePurchaseOrderEditPage?.();
      logEvent("PURCHASE", "PURCHASE_ORDER_EDITED", `Updated Purchase Order ${updated.poNumber}; status returned to Draft for fresh approval.`);
      window.showNotification({ title: "Purchase Order Updated", message: `${updated.poNumber} was updated and returned to Draft. Send it for Administrator approval when ready.`, type: "success", duration: 9000 });
      return updated;
    } catch (error) {
      window.showNotification({ title: "PO Update Failed", message: error?.message || "The Purchase Order was not changed.", type: "danger" });
      return null;
    }
  }
  purchaseOrdersDb.unshift(record);
  const saved = await saveStorage(KEY_PURCHASE_ORDERS, purchaseOrdersDb);
  if (saved === false) { purchaseOrdersDb = purchaseOrdersDb.filter(order => order.id !== record.id); return null; }
  activeSavedPurchaseOrderId = record.id;
  const exportButton = document.getElementById("purchaseOrderExportButton"); if (exportButton) exportButton.disabled = true;
  logEvent("PURCHASE", "PURCHASE_ORDER_DRAFT_SAVED", `Saved draft Purchase Order ${record.poNumber} for ${record.vendor.name}.`);
  renderSavedPurchaseOrders();
  let uploadedDocuments = [];
  try {
    uploadedDocuments = await uploadPurchaseOrderDocuments(record.poNumber);
    if (uploadedDocuments.length) {
      record.documents = uploadedDocuments;
      const documentsSaved = await saveStorage(KEY_PURCHASE_ORDERS, purchaseOrdersDb);
      if (documentsSaved === false) throw new Error("The uploaded document details could not be linked to the Purchase Order.");
      clearPurchaseOrderUploads();
      logEvent("PURCHASE", "PURCHASE_ORDER_DOCUMENTS_UPLOADED", `Uploaded ${uploadedDocuments.length} document(s) for ${record.poNumber}.`);
      renderSavedPurchaseOrders();
    }
  } catch (error) {
    window.showNotification({ title: "PO Saved - Upload Incomplete", message: `${record.poNumber} was saved, but a document could not be uploaded: ${error?.message || "Unknown upload error"}`, type: "warning" });
    return record;
  }
  window.showNotification({ title: "Purchase Order Draft Saved", message: `${record.poNumber} was saved as Draft${uploadedDocuments.length ? ` with ${uploadedDocuments.length} document(s)` : ""}. Send it for Administrator approval when ready.`, type: "success" });
  return record;
};

function renderSavedPurchaseOrders() {
  const body = document.getElementById("purchaseOrderSavedBody"), count = document.getElementById("purchaseOrderSavedCount");
  if (!body) return;
  const rows = Array.isArray(purchaseOrdersDb) ? purchaseOrdersDb : [];
  if (count) count.textContent = `${rows.length} saved`;
  body.innerHTML = rows.length ? rows.map(order => { const approved = purchaseOrderStatus(order) === "APPROVED"; const currencyCode = purchaseOrderRecordCurrency(order); const taxModeLabel = purchaseOrderIsImport(order.poType) || order.taxMode === "IMPORT" ? `No GST (Import · ${currencyCode})` : order.taxMode === "INTRA" ? "CGST + SGST" : "IGST"; return `<tr data-purchase-order-id="${purchaseOrderEscape(order.id)}"><td data-label="PO Number"><strong>${purchaseOrderEscape(order.poNumber)}</strong></td><td data-label="Date">${purchaseOrderEscape(order.poDate)}</td><td data-label="Vendor">${purchaseOrderEscape(order.vendor?.name || "-")}</td><td data-label="GST Mode">${taxModeLabel}</td><td data-label="Items">${Number(order.items?.length || 0)}</td><td data-label="Grand Total"><strong>${purchaseOrderMoney(order.totals?.grandTotal, order.poType, currencyCode)}</strong></td><td data-label="Created By">${purchaseOrderEscape(order.createdBy || "-")}</td><td data-label="Status">${purchaseOrderStatusBadge(order)}</td><td data-label="Action">${approved ? `<div style="display:flex;gap:6px;align-items:center;white-space:nowrap;"><button type="button" class="btn btn-secondary" style="padding:6px 9px;font-size:10px;" onclick="exportPurchaseOrderPdf('${purchaseOrderEscape(order.id)}')">Export PDF</button><button type="button" class="btn btn-primary" style="padding:6px 9px;font-size:10px;" onclick="printPurchaseOrder('${purchaseOrderEscape(order.id)}')">Print PO</button></div>` : `<span style="font-size:10px;color:#64748b;font-weight:800;">Approval required</span>`}</td></tr>`; }).join("") : `<tr><td colspan="9" style="text-align:center;padding:22px;color:var(--muted);">No purchase orders saved yet.</td></tr>`;
}

window.renderSavedPurchaseOrders = renderSavedPurchaseOrders;
window.preparePurchaseOrderViewPage = function() {
  renderSavedPurchaseOrders();
};

function canEditPurchaseOrderRecord(order) {
  const status = purchaseOrderStatus(order);
  if (status === "PENDING_APPROVAL" || purchaseOrderDeleteStatus(order) === "PENDING") return false;
  if (String(currentLoggedInUser?.role || "").toLowerCase() === "admin") return true;
  return String(order?.createdBy || "").toLowerCase() === String(currentLoggedInUser?.username || "").toLowerCase();
}

window.preparePurchaseOrderEditPage = function() {
  const select = document.getElementById("purchaseOrderEditSelect");
  const count = document.getElementById("purchaseOrderEditCount");
  if (!select) return;
  const selected = select.value;
  const editable = (purchaseOrdersDb || []).filter(canEditPurchaseOrderRecord);
  select.innerHTML = `<option value="">Select Purchase Order</option>${editable.map(order => `<option value="${purchaseOrderEscape(order.id)}">${purchaseOrderEscape(order.poNumber)} — ${purchaseOrderEscape(order.vendor?.name || "-")} — ${purchaseOrderStatusLabel(purchaseOrderStatus(order))}</option>`).join("")}`;
  if (editable.some(order => String(order.id) === String(selected))) select.value = selected;
  if (count) count.textContent = `${editable.length} editable`;
};

window.loadPurchaseOrderForEdit = async function() {
  const orderId = purchaseOrderFieldValue("purchaseOrderEditSelect");
  const order = (purchaseOrdersDb || []).find(record => String(record.id) === String(orderId));
  if (!order) {
    window.showNotification({ title: "Select Purchase Order", message: "Choose the Purchase Order you want to edit.", type: "warning" });
    return;
  }
  if (!canEditPurchaseOrderRecord(order)) {
    window.showNotification({ title: "PO Locked", message: "This Purchase Order cannot be edited while approval or deletion approval is pending.", type: "warning" });
    window.preparePurchaseOrderEditPage();
    return;
  }
  if (purchaseOrderStatus(order) === "APPROVED") {
    const confirmed = await window.showConfirmDialog({ title: "Edit Approved Purchase Order", message: `Editing ${order.poNumber} will remove its existing approval and signatures. The updated PO must be sent for Administrator approval again.`, confirmText: "Open for Editing", isDanger: true });
    if (!confirmed) return;
  }
  activeSavedPurchaseOrderId = order.id;
  setPurchaseOrderEditMode(order);
  const opened = await window.switchView("purchaseOrder", document.getElementById("navSub-purchaseOrderEdit"), "Purchase > PO > Edit PO");
  if (opened === false) return;
  const latestOrder = (purchaseOrdersDb || []).find(record => String(record.id) === String(order.id)) || order;
  setPurchaseOrderEditMode(latestOrder);
  const setValue = (id, value) => { const field = document.getElementById(id); if (field) field.value = value ?? ""; };
  const vendor = (purchaseVendorsDb || []).find(item => String(item.id || item.vendorCode) === String(latestOrder.vendorId) || String(item.vendorCode || "") === String(latestOrder.vendor?.vendorCode || "")) || latestOrder.vendor || {};
  setValue("purchaseOrderVendor", vendor.id || vendor.vendorCode || latestOrder.vendorId);
  setValue("purchaseOrderVendorCodeSearch", vendor.vendorCode || latestOrder.vendor?.vendorCode || "");
  setValue("purchaseOrderVendorNameSearch", vendor.name || latestOrder.vendor?.name || "");
  setValue("purchaseOrderNumber", latestOrder.poNumber);
  setValue("purchaseOrderType", latestOrder.poType);
  setValue("purchaseOrderMaterialType", latestOrder.materialType);
  setValue("purchaseOrderDate", latestOrder.poDate);
  setValue("purchaseOrderImportCurrency", purchaseOrderRecordCurrency(latestOrder));
  setValue("purchaseOrderShipVia", latestOrder.shipVia);
  setValue("purchaseOrderShippingTerms", latestOrder.shippingTerms);
  setValue("purchaseOrderPaymentTerms", latestOrder.paymentTerms);
  setValue("purchaseOrderDeliveryDate", latestOrder.deliveryDate);
  setValue("purchaseOrderRemarks", latestOrder.remarks);
  purchaseOrderDraftItems = (latestOrder.items || []).map((item, index) => ({
    ...item,
    id: `POEDIT-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    uom: item.uom === "SQMTR" ? "SQM" : item.uom === "PCS" ? "NOS" : item.uom
  }));
  if (!purchaseOrderDraftItems.length) purchaseOrderDraftItems = [newPurchaseOrderItem()];
  clearPurchaseOrderUploads();
  syncPurchaseOrderCurrencyField();
  renderPurchaseOrderVendorSummary();
  renderPurchaseOrderItems();
  refreshPurchaseOrderCalculations();
  const exportButton = document.getElementById("purchaseOrderExportButton"); if (exportButton) exportButton.disabled = true;
};

window.renderPurchaseOrderDeleteList = function() {
  const body = document.getElementById("purchaseOrderDeleteBody"), count = document.getElementById("purchaseOrderDeleteCount");
  if (!body) return;
  const rows = Array.isArray(purchaseOrdersDb) ? purchaseOrdersDb : [];
  if (count) count.textContent = `${rows.length} record${rows.length === 1 ? "" : "s"}`;
  body.innerHTML = rows.length ? rows.map(order => {
    const deleteStatus = purchaseOrderDeleteStatus(order);
    const poStatus = purchaseOrderStatus(order);
    const unavailable = poStatus === "PENDING_APPROVAL";
    const action = deleteStatus === "PENDING"
      ? `<span style="font-size:10px;color:#92400e;font-weight:800;">Awaiting Administrator</span>`
      : unavailable
        ? `<span style="font-size:10px;color:#64748b;font-weight:800;">Complete PO approval first</span>`
        : `<button type="button" class="btn btn-danger" style="padding:6px 9px;font-size:10px;" onclick="requestPurchaseOrderDeletion('${purchaseOrderEscape(order.id)}')">${deleteStatus === "REJECTED" ? "Request Again" : "Request Deletion"}</button>`;
    return `<tr><td data-label="PO Number"><strong>${purchaseOrderEscape(order.poNumber)}</strong></td><td data-label="Date">${purchaseOrderEscape(order.poDate)}</td><td data-label="Vendor">${purchaseOrderEscape(order.vendor?.name || "-")}</td><td data-label="Grand Total"><strong>${purchaseOrderMoney(order.totals?.grandTotal, order.poType, purchaseOrderRecordCurrency(order))}</strong></td><td data-label="PO Status">${purchaseOrderStatusBadge(order)}</td><td data-label="Delete Status">${purchaseOrderDeleteStatusBadge(order)}</td><td data-label="Action">${action}</td></tr>`;
  }).join("") : `<tr><td colspan="7" style="text-align:center;padding:22px;color:var(--muted);">No Purchase Orders are available.</td></tr>`;
  window.updatePurchaseOrderApprovalBadge?.();
};

window.preparePurchaseOrderDeletePage = function() {
  window.renderPurchaseOrderDeleteList();
};

async function runPurchaseOrderWorkflow(operation, orderId, remark = "", editedOrder = null) {
  const response = await erpFetchWithTimeout("backend/api.php?action=purchase_order_workflow", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ operation, orderId, remark, order: editedOrder, expectedVersion: liveSyncVersions[KEY_PURCHASE_ORDERS] || "" })
  }, 30000);
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.status !== "success") throw new Error(result?.message || `Purchase Order workflow failed (${response.status})`);
  const index = purchaseOrdersDb.findIndex(order => String(order.id) === String(orderId));
  if (result.deleted === true) {
    purchaseOrdersDb = purchaseOrdersDb.filter(order => String(order.id) !== String(orderId));
    if (String(activeSavedPurchaseOrderId) === String(orderId)) activeSavedPurchaseOrderId = "";
    if (String(activePurchaseOrderApprovalId) === String(orderId)) activePurchaseOrderApprovalId = "";
  } else if (index >= 0) purchaseOrdersDb[index] = result.order;
  else purchaseOrdersDb.unshift(result.order);
  if (result.version) liveSyncVersions[KEY_PURCHASE_ORDERS] = String(result.version);
  if (result.deleted !== true) localSeenPurchaseOrderStates[result.order.id] = purchaseOrderStatus(result.order);
  else delete localSeenPurchaseOrderStates[orderId];
  renderSavedPurchaseOrders();
  window.renderPurchaseOrderDeleteList?.();
  window.renderPurchaseOrderApprovalQueue?.();
  window.updatePurchaseOrderApprovalBadge?.();
  return result.order;
}

window.requestPurchaseOrderDeletion = async function(id) {
  const order = (purchaseOrdersDb || []).find(record => String(record.id) === String(id));
  if (!order) return;
  const reason = await window.showPromptDialog({ title: "Request PO Deletion", message: `${order.poNumber} will remain active until a different Administrator approves its deletion.`, label: "Reason for Deletion *", placeholder: "Example: duplicate PO, incorrect vendor, cancelled requirement...", confirmText: "Send for Admin Approval", isDanger: true });
  if (!reason) return;
  try {
    await runPurchaseOrderWorkflow("REQUEST_DELETE", order.id, reason);
    window.showNotification({ title: "Deletion Approval Requested", message: `${order.poNumber} remains active and is now waiting in Purchase > PO > Approve PO.`, type: "warning", duration: 9000 });
  } catch (error) {
    window.showNotification({ title: "Deletion Request Failed", message: error?.message || "The deletion request was not saved.", type: "danger" });
  }
};

window.sendPurchaseOrderForApproval = async function() {
  let order = (purchaseOrdersDb || []).find(record => String(record.id) === String(activeSavedPurchaseOrderId));
  if (!order) order = await window.savePurchaseOrder();
  if (!order) return;
  const status = purchaseOrderStatus(order);
  if (!["DRAFT", "REJECTED"].includes(status)) {
    window.showNotification({ title: "Cannot Submit PO", message: `${order.poNumber} is already ${purchaseOrderStatusLabel(status)}.`, type: "warning" });
    return;
  }
  const confirmed = await window.showConfirmDialog({ title: "Send PO for Approval", message: `Digitally sign ${order.poNumber} as Prepared By and send it to the Administrator approval queue?`, confirmText: "Send for Approval" });
  if (!confirmed) return;
  try {
    order = await runPurchaseOrderWorkflow("SUBMIT", order.id);
    const exportButton = document.getElementById("purchaseOrderExportButton"); if (exportButton) exportButton.disabled = true;
    window.showNotification({ title: "PO Sent for Approval", message: `${order.poNumber} was digitally signed by you and sent to Purchase > Approve PO. It cannot be issued until Administrator approval.`, type: "success", duration: 9000 });
  } catch (error) {
    window.showNotification({ title: "PO Submission Failed", message: error?.message || "The Purchase Order was not submitted.", type: "danger" });
  }
};

window.updatePurchaseOrderApprovalBadge = function() {
  const badge = document.getElementById("purchaseOrderApprovalBadge");
  const deleteBadge = document.getElementById("purchaseOrderDeleteBadge");
  const approvalCount = (purchaseOrdersDb || []).filter(order => purchaseOrderStatus(order) === "PENDING_APPROVAL").length;
  const deleteCount = (purchaseOrdersDb || []).filter(order => purchaseOrderDeleteStatus(order) === "PENDING").length;
  if (badge) {
    badge.textContent = String(approvalCount + deleteCount);
    badge.style.display = approvalCount + deleteCount > 0 && window.canApprovePurchaseOrders?.(currentLoggedInUser) === true ? "inline-block" : "none";
  }
  if (deleteBadge) {
    deleteBadge.textContent = String(deleteCount);
    deleteBadge.style.display = deleteCount > 0 ? "inline-block" : "none";
  }
};

window.renderPurchaseOrderApprovalQueue = function() {
  const body = document.getElementById("purchaseOrderApprovalBody");
  const count = document.getElementById("purchaseOrderPendingCount");
  const empty = document.getElementById("purchaseOrderApprovalEmpty");
  const tableWrap = document.getElementById("purchaseOrderApprovalTableWrap");
  if (!body) return;
  const pending = (purchaseOrdersDb || []).filter(order => purchaseOrderStatus(order) === "PENDING_APPROVAL");
  if (count) count.textContent = `${pending.length} pending`;
  if (empty) empty.style.display = pending.length ? "none" : "flex";
  if (tableWrap) tableWrap.style.display = pending.length ? "block" : "none";
  body.innerHTML = pending.map(order => `<tr data-purchase-order-id="${purchaseOrderEscape(order.id)}"><td data-label="PO Number"><strong>${purchaseOrderEscape(order.poNumber)}</strong></td><td data-label="Submitted">${purchaseOrderEscape(order.submittedAt ? new Date(order.submittedAt).toLocaleString("en-IN") : "-")}</td><td data-label="Vendor">${purchaseOrderEscape(order.vendor?.name || "-")}</td><td data-label="Amount"><strong>${purchaseOrderMoney(order.totals?.grandTotal, order.poType, purchaseOrderRecordCurrency(order))}</strong></td><td data-label="Prepared By">${purchaseOrderEscape(order.preparedName || order.preparedBy || order.createdBy || "-")}</td><td data-label="Status">${purchaseOrderStatusBadge(order)}</td><td data-label="Action"><button type="button" class="btn btn-primary" style="padding:6px 10px;font-size:10px;" onclick="openPurchaseOrderApprovalReview('${purchaseOrderEscape(order.id)}')">Review PO</button></td></tr>`).join("");
  window.renderPurchaseOrderDeleteApprovalQueue?.();
  window.updatePurchaseOrderApprovalBadge();
};

window.renderPurchaseOrderDeleteApprovalQueue = function() {
  const body = document.getElementById("purchaseOrderDeleteApprovalBody"), count = document.getElementById("purchaseOrderDeletePendingCount");
  const empty = document.getElementById("purchaseOrderDeleteApprovalEmpty"), tableWrap = document.getElementById("purchaseOrderDeleteApprovalTableWrap");
  if (!body) return;
  const pending = (purchaseOrdersDb || []).filter(order => purchaseOrderDeleteStatus(order) === "PENDING");
  if (count) count.textContent = `${pending.length} pending`;
  if (empty) empty.style.display = pending.length ? "none" : "flex";
  if (tableWrap) tableWrap.style.display = pending.length ? "block" : "none";
  body.innerHTML = pending.map(order => `<tr><td data-label="PO Number"><strong>${purchaseOrderEscape(order.poNumber)}</strong></td><td data-label="Requested">${purchaseOrderEscape(order.deleteRequest?.requestedAt ? new Date(order.deleteRequest.requestedAt).toLocaleString("en-IN") : "-")}</td><td data-label="Vendor">${purchaseOrderEscape(order.vendor?.name || "-")}</td><td data-label="Requested By">${purchaseOrderEscape(order.deleteRequest?.requestedName || order.deleteRequest?.requestedBy || "-")}</td><td data-label="Reason">${purchaseOrderEscape(order.deleteRequest?.reason || "-")}</td><td data-label="Action"><div style="display:flex;gap:6px;flex-wrap:wrap;"><button type="button" class="btn btn-danger" style="padding:6px 9px;font-size:10px;" onclick="decidePurchaseOrderDeletion('${purchaseOrderEscape(order.id)}','REJECT_DELETE')">Reject</button><button type="button" class="btn btn-success" style="padding:6px 9px;font-size:10px;" onclick="decidePurchaseOrderDeletion('${purchaseOrderEscape(order.id)}','APPROVE_DELETE')">Approve Delete</button></div></td></tr>`).join("");
};

window.decidePurchaseOrderDeletion = async function(id, decision) {
  if (window.canApprovePurchaseOrders?.(currentLoggedInUser) !== true) { window.showNotification({ title: "Access Denied", message: "Only an Administrator can decide PO deletion requests.", type: "danger" }); return; }
  const order = (purchaseOrdersDb || []).find(record => String(record.id) === String(id));
  if (!order || purchaseOrderDeleteStatus(order) !== "PENDING") return;
  const approve = decision === "APPROVE_DELETE";
  let remark = "";
  if (!approve) {
    remark = await window.showPromptDialog({ title: "Reject PO Deletion", message: `Keep ${order.poNumber} and reject its deletion request?`, label: "Administrator Reason *", placeholder: "Explain why the PO must be retained...", confirmText: "Reject Deletion" });
    if (!remark) return;
  } else {
    const confirmed = await window.showConfirmDialog({ title: "Approve Permanent PO Deletion", message: `Permanently delete ${order.poNumber}? The PO record will be removed and the action will remain in the audit log.`, confirmText: "Approve & Delete", isDanger: true });
    if (!confirmed) return;
  }
  try {
    await runPurchaseOrderWorkflow(decision, order.id, remark);
    window.showNotification({ title: approve ? "Purchase Order Deleted" : "Deletion Request Rejected", message: approve ? `${order.poNumber} was deleted after Administrator approval.` : `${order.poNumber} remains active.`, type: approve ? "success" : "warning", duration: 9000 });
  } catch (error) {
    window.showNotification({ title: "Deletion Decision Failed", message: error?.message || "The deletion decision was not completed.", type: "danger" });
  }
};

window.preparePurchaseOrderApprovals = function() {
  activePurchaseOrderApprovalId = "";
  const review = document.getElementById("purchaseOrderApprovalReview"); if (review) review.style.display = "none";
  window.renderPurchaseOrderApprovalQueue();
};

window.openPurchaseOrderApprovalReview = function(id) {
  const order = (purchaseOrdersDb || []).find(record => String(record.id) === String(id));
  if (!order || purchaseOrderStatus(order) !== "PENDING_APPROVAL") return;
  activePurchaseOrderApprovalId = order.id;
  const title = document.getElementById("purchaseOrderApprovalReviewTitle"); if (title) title.textContent = `REVIEW ${order.poNumber}`;
  const preview = document.getElementById("purchaseOrderApprovalPreview"); if (preview) preview.innerHTML = purchaseOrderPreviewHtml(order);
  const remark = document.getElementById("purchaseOrderApprovalRemark"); if (remark) remark.value = "";
  const review = document.getElementById("purchaseOrderApprovalReview"); if (review) { review.style.display = "block"; review.scrollIntoView({ behavior: "smooth", block: "start" }); }
};

window.closePurchaseOrderApprovalReview = function() {
  activePurchaseOrderApprovalId = "";
  const review = document.getElementById("purchaseOrderApprovalReview"); if (review) review.style.display = "none";
};

window.decidePurchaseOrder = async function(decision) {
  if (window.canApprovePurchaseOrders?.(currentLoggedInUser) !== true) {
    window.showNotification({ title: "Access Denied", message: "Only an Administrator can approve or reject a Purchase Order.", type: "danger" }); return;
  }
  const order = (purchaseOrdersDb || []).find(record => String(record.id) === String(activePurchaseOrderApprovalId));
  if (!order) return;
  const remark = purchaseOrderFieldValue("purchaseOrderApprovalRemark");
  if (decision === "REJECT" && !remark) { window.showNotification({ title: "Remark Required", message: "Enter the reason for rejection.", type: "warning" }); return; }
  const approved = decision === "APPROVE";
  const confirmed = await window.showConfirmDialog({ title: approved ? "Approve Purchase Order" : "Reject Purchase Order", message: approved ? `Approve and digitally sign ${order.poNumber}? This will unlock its official PDF.` : `Reject ${order.poNumber} and return it to Purchase?`, confirmText: approved ? "Approve & Sign" : "Reject PO", isDanger: !approved });
  if (!confirmed) return;
  try {
    const updated = await runPurchaseOrderWorkflow(decision, order.id, remark);
    window.closePurchaseOrderApprovalReview();
    window.showNotification({ title: approved ? "Purchase Order Approved" : "Purchase Order Rejected", message: approved ? `${updated.poNumber} is digitally approved and ready to issue.` : `${updated.poNumber} was returned to Purchase with your remark.`, type: approved ? "success" : "warning", duration: 9000 });
  } catch (error) {
    window.showNotification({ title: "PO Decision Failed", message: error?.message || "The Purchase Order was not changed.", type: "danger" });
  }
};

window.refreshPurchaseOrderView = function() {
  populatePurchaseOrderVendors(); renderPurchaseOrderVendorSummary(); renderSavedPurchaseOrders(); refreshPurchaseOrderNumber(!activeSavedPurchaseOrderId); refreshPurchaseOrderCalculations();
  const activeOrder = (purchaseOrdersDb || []).find(order => String(order.id) === String(activeSavedPurchaseOrderId));
  const exportButton = document.getElementById("purchaseOrderExportButton"); if (exportButton) exportButton.disabled = purchaseOrderStatus(activeOrder) !== "APPROVED";
};

window.preparePurchaseOrderPage = function() {
  populatePurchaseOrderVendors();
  const date = document.getElementById("purchaseOrderDate"); if (date && !date.value) date.value = new Date().toISOString().slice(0, 10);
  refreshPurchaseOrderNumber(!activeSavedPurchaseOrderId);
  if (!purchaseOrderDraftItems.length) purchaseOrderDraftItems = [newPurchaseOrderItem()];
  syncPurchaseOrderCurrencyField(); renderPurchaseOrderVendorSummary(); renderPurchaseOrderItems(); refreshPurchaseOrderCalculations(); renderSavedPurchaseOrders();
};

function purchaseOrderNumberWords(value) {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const underHundred = number => number < 20 ? ones[number] : `${tens[Math.floor(number / 10)]}${number % 10 ? ` ${ones[number % 10]}` : ""}`;
  const underThousand = number => number < 100 ? underHundred(number) : `${ones[Math.floor(number / 100)]} Hundred${number % 100 ? ` ${underHundred(number % 100)}` : ""}`;
  let number = Math.max(0, Math.round(Number(value || 0)));
  if (!number) return "Zero";
  const parts = [];
  const crore = Math.floor(number / 10000000); if (crore) { parts.push(`${purchaseOrderNumberWords(crore)} Crore`); number %= 10000000; }
  const lakh = Math.floor(number / 100000); if (lakh) { parts.push(`${underHundred(lakh)} Lakh`); number %= 100000; }
  const thousand = Math.floor(number / 1000); if (thousand) { parts.push(`${underHundred(thousand)} Thousand`); number %= 1000; }
  if (number) parts.push(underThousand(number));
  return parts.join(" ");
}

function purchaseOrderInternationalNumberWords(value) {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const underHundred = number => number < 20 ? ones[number] : `${tens[Math.floor(number / 10)]}${number % 10 ? ` ${ones[number % 10]}` : ""}`;
  const underThousand = number => number < 100 ? underHundred(number) : `${ones[Math.floor(number / 100)]} Hundred${number % 100 ? ` ${underHundred(number % 100)}` : ""}`;
  let number = Math.max(0, Math.round(Number(value || 0)));
  if (!number) return "Zero";
  const parts = [];
  [[1000000000, "Billion"], [1000000, "Million"], [1000, "Thousand"]].forEach(([divisor, label]) => {
    const portion = Math.floor(number / divisor);
    if (portion) { parts.push(`${underThousand(portion)} ${label}`); number %= divisor; }
  });
  if (number) parts.push(underThousand(number));
  return parts.join(" ");
}

async function purchaseOrderPdfAssetDataUrl(path, errorMessage) {
  if (purchaseOrderPdfAssetCache.has(path)) return purchaseOrderPdfAssetCache.get(path);
  const response = await fetch(new URL(path, window.location.href).href, { cache: "force-cache" });
  if (!response.ok) throw new Error(errorMessage || `${path} could not be loaded.`);
  const blob = await response.blob();
  const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
  purchaseOrderPdfAssetCache.set(path, dataUrl);
  return dataUrl;
}

async function purchaseOrderLogoDataUrl() {
  if (!purchaseOrderLogoCache) purchaseOrderLogoCache = await purchaseOrderPdfAssetDataUrl("assets/demo-logo.svg", "DemoSolar logo could not be loaded.");
  return purchaseOrderLogoCache;
}

async function purchaseOrderStampDataUrl() {
  if (!purchaseOrderStampCache) purchaseOrderStampCache = await purchaseOrderPdfAssetDataUrl("assets/demo-stamp.svg", "DemoSolar digital stamp could not be loaded.");
  return purchaseOrderStampCache;
}

function purchaseOrderPdfGradient(pdf, x, y, width, height, start = [12, 74, 110], end = [34, 197, 94]) {
  const steps = 70, strip = width / steps;
  for (let index = 0; index < steps; index += 1) { const ratio = index / (steps - 1); pdf.setFillColor(...start.map((value, channel) => Math.round(value + (end[channel] - value) * ratio))); pdf.rect(x + index * strip, y, strip + .08, height, "F"); }
}

function purchaseOrderPdfCellText(pdf, value, x, y, width, options = {}) {
  const size = options.size || 7.4, align = options.align || "left", color = options.color || [15, 23, 42];
  pdf.setFont("helvetica", options.bold ? "bold" : "normal"); pdf.setFontSize(size); pdf.setTextColor(...color);
  const lines = pdf.splitTextToSize(String(value ?? ""), Math.max(2, width - (options.padding || 2))).slice(0, options.maxLines || 3);
  const textX = align === "center" ? x + width / 2 : align === "right" ? x + width - 1.2 : x + 1.2;
  pdf.text(lines, textX, y, { align, lineHeightFactor: options.lineHeightFactor || 1.25 });
  return lines;
}

function purchaseOrderPdfGradientTitle(pdf, text, centerX, y) {
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(18);
  const characters = [...text], widths = characters.map(character => pdf.getTextWidth(character)), totalWidth = widths.reduce((sum, width) => sum + width, 0);
  let x = centerX - totalWidth / 2;
  characters.forEach((character, index) => {
    const ratio = characters.length > 1 ? index / (characters.length - 1) : 0;
    pdf.setTextColor(Math.round(12 + 22 * ratio), Math.round(74 + 123 * ratio), Math.round(110 - 16 * ratio));
    pdf.text(character, x, y); x += widths[index];
  });
}

function purchaseOrderPdfLabelValue(pdf, label, value, x, y, labelWidth, valueWidth, options = {}) {
  purchaseOrderPdfCellText(pdf, `${label}:`, x, y, labelWidth, { size: options.size || 7.2, bold: true, maxLines: 1 });
  purchaseOrderPdfCellText(pdf, value || "-", x + labelWidth, y, valueWidth, { size: options.size || 7.2, bold: Boolean(options.valueBold), maxLines: options.maxLines || 1 });
}

function drawPurchaseOrderPdfHeader(pdf, order, logo, firstPage) {
  const left = 7, width = 196;
  if (!firstPage) {
    purchaseOrderPdfGradient(pdf, left, 7, width, 9);
    purchaseOrderPdfCellText(pdf, `PURCHASE ORDER ${order.poNumber} - CONTINUED`, left, 13.2, width, { size: 9, bold: true, color: [255,255,255], align: "center", maxLines: 1 });
    return 19;
  }
  if (logo) pdf.addImage(logo, "PNG", 10, 9, 49, 24, "DEMOSOLAR_PO_LOGO", "FAST");
  purchaseOrderPdfGradientTitle(pdf, "PURCHASE ORDER", 108, 25);
  [["Document No.", "DEMOU2/PUR/F/01"], ["Issue Date", "03.09.2025"], ["Rev", "00"]].forEach(([label, value], index) => {
    purchaseOrderPdfLabelValue(pdf, label, value, 157, 15 + index * 6, 20, 25, { size: 7, valueBold: true });
  });
  pdf.setDrawColor(145, 167, 183); pdf.setLineWidth(.25); pdf.line(left, 37, left + width, 37);

  const detailsY = 38, detailsHeight = 42, split = 105;
  pdf.setFillColor(255,255,255); pdf.rect(left, detailsY, width, detailsHeight, "F");
  pdf.line(left, detailsY, left + width, detailsY); pdf.line(left, detailsY + detailsHeight, left + width, detailsY + detailsHeight); pdf.line(split, detailsY, split, detailsY + detailsHeight);
  const vendor = order.vendor || {};
  const supplierRows = [
    ["Supplier Code", vendor.vendorCode], ["Supplier Name", vendor.name], ["Address", vendor.address], ["GSTIN", vendor.gst], ["PAN", vendor.pan],
    ["Contact Name", vendor.contactName], ["Mobile", vendor.mobile], ["Email", vendor.email]
  ];
  let supplierY = 43.5;
  supplierRows.forEach(([label, value], index) => {
    purchaseOrderPdfLabelValue(pdf, label, value, 10, supplierY, 25, 67, { size: 7.1, valueBold: index < 2, maxLines: index === 2 ? 2 : 1 });
    supplierY += index === 2 ? 7.5 : 4.5;
  });
  const detailRows = [
    ["PO Date", purchaseOrderPreviewDate(order.poDate), true], ["PO No.", order.poNumber, true], ["PO Type", purchaseOrderMetaLabel(order.poType), false],
    ["Material Type", purchaseOrderMetaLabel(order.materialType), false], ["Currency", purchaseOrderRecordCurrency(order), false]
  ];
  detailRows.forEach(([label, value, bold], index) => purchaseOrderPdfLabelValue(pdf, label, value, 109, 44 + index * 6.2, 25, 65, { size: 7.5, valueBold: bold }));

  const partyTop = 81, partyWidth = 98;
  const drawParty = (party, x, title) => {
    const isBillTo = title === "BILL TO";
    purchaseOrderPdfGradient(pdf, x, partyTop, partyWidth, 7, isBillTo ? [12,74,110] : [7,129,166], isBillTo ? [7,129,166] : [11,107,102]);
    purchaseOrderPdfCellText(pdf, title, x + 2, partyTop + 4.9, partyWidth - 4, { size: 8, bold: true, color: [255,255,255], maxLines: 1 });
    pdf.setFillColor(255,255,255); pdf.rect(x, partyTop + 7, partyWidth, 36, "F");
    const rows = [["Company", party.company], ["Address", party.address], ["GSTIN", party.gst], ["PAN", party.pan], ["Contact Name", party.contactName], ["Mobile", party.mobile], ["Email", party.email]];
    let rowY = partyTop + 12;
    rows.forEach(([label, value], index) => {
      purchaseOrderPdfLabelValue(pdf, label, value, x + 3, rowY, 23, partyWidth - 29, { size: 6.8, valueBold: index === 0, maxLines: index === 1 ? 2 : 1 });
      rowY += index === 1 ? 7.2 : 4.2;
    });
  };
  drawParty(order.billTo || PURCHASE_ORDER_BILL_TO, left, "BILL TO");
  drawParty(order.shipTo || purchaseOrderShipTo(order.poType), left + partyWidth, "SHIP TO");
  pdf.line(left + partyWidth, partyTop, left + partyWidth, partyTop + 43);
  pdf.line(left, partyTop + 43, left + width, partyTop + 43);
  return 124;
}

function drawPurchaseOrderPdfItemsHeader(pdf, order, y) {
  const isImport = purchaseOrderIsImport(order.poType) || order.taxMode === "IMPORT";
  const intra = order.taxMode === "INTRA";
  const columns = isImport
    ? [["Sr.",8],["Item",22],["Description of Goods",55],["HSN/SAC",20],["Qty",14],["UOM",17],["Rate",28],["Total",32]]
    : intra
    ? [["Sr.",7],["Item",14],["Description of Goods",34],["HSN/SAC",15],["Qty",10],["UOM",13],["Rate",17],["GST %",11],["Taxable",21],["CGST",17],["SGST",17],["Total",20]]
    : [["Sr.",7],["Item",15],["Description of Goods",40],["HSN/SAC",17],["Qty",11],["UOM",14],["Rate",19],["GST %",12],["Taxable",22],["IGST",19],["Total",20]];
  purchaseOrderPdfGradient(pdf, 7, y, 196, 10); let x = 7; pdf.setDrawColor(145,167,183);
  columns.forEach(([label,width]) => { pdf.rect(x,y,width,10); purchaseOrderPdfCellText(pdf,label,x,y+6.4,width,{size:6.6,bold:true,color:[255,255,255],align:"center",maxLines:2}); x += width; });
  return columns;
}

function drawPurchaseOrderPdfItem(pdf, order, item, index, y, columns) {
  const amount = purchaseOrderItemAmounts(item, order.taxMode);
  const values = purchaseOrderIsImport(order.poType) || order.taxMode === "IMPORT"
    ? [index + 1, item.itemCode || "-", item.description, item.hsn || "-", item.qty, item.uom, purchaseOrderPdfMoney(item.rate, order.poType, purchaseOrderRecordCurrency(order)), purchaseOrderPdfMoney(amount.total, order.poType, purchaseOrderRecordCurrency(order))]
    : order.taxMode === "INTRA"
    ? [index + 1, item.itemCode || "-", item.description, item.hsn || "-", item.qty, item.uom, purchaseOrderPdfMoney(item.rate, order.poType, purchaseOrderRecordCurrency(order)), `${item.gstRate}%`, purchaseOrderPdfMoney(amount.taxable, order.poType, purchaseOrderRecordCurrency(order)), purchaseOrderPdfMoney(amount.cgst, order.poType, purchaseOrderRecordCurrency(order)), purchaseOrderPdfMoney(amount.sgst, order.poType, purchaseOrderRecordCurrency(order)), purchaseOrderPdfMoney(amount.total, order.poType, purchaseOrderRecordCurrency(order))]
    : [index + 1, item.itemCode || "-", item.description, item.hsn || "-", item.qty, item.uom, purchaseOrderPdfMoney(item.rate, order.poType, purchaseOrderRecordCurrency(order)), `${item.gstRate}%`, purchaseOrderPdfMoney(amount.taxable, order.poType, purchaseOrderRecordCurrency(order)), purchaseOrderPdfMoney(amount.igst, order.poType, purchaseOrderRecordCurrency(order)), purchaseOrderPdfMoney(amount.total, order.poType, purchaseOrderRecordCurrency(order))];
  const lineCounts = values.map((value, columnIndex) => pdf.splitTextToSize(String(value ?? ""), Math.max(2, columns[columnIndex][1] - 2)).length);
  const rowHeight = Math.max(11, Math.min(21, Math.max(...lineCounts) * 3.6 + 4));
  let x = 7; pdf.setFillColor(...(index % 2 ? [240,246,250] : [255,255,255])); pdf.rect(7,y,196,rowHeight,"F"); pdf.setDrawColor(145,167,183);
  columns.forEach(([label,width],columnIndex) => { pdf.rect(x,y,width,rowHeight); purchaseOrderPdfCellText(pdf,values[columnIndex],x,y+4.8,width,{size:6.7,bold:true,align:[0,4,5].includes(columnIndex)?"center":columnIndex>=6?"right":"left",maxLines:4}); x += width; });
  return rowHeight;
}

function drawPurchaseOrderPdfSummary(pdf, order, y, assets) {
  const totals = order.totals; const rows = purchaseOrderIsImport(order.poType) || order.taxMode === "IMPORT" ? [["Subtotal",totals.subtotal],["Round Off",totals.roundOff],["Grand Total",totals.grandTotal]] : order.taxMode === "INTRA" ? [["Subtotal",totals.subtotal],["CGST",totals.cgst],["SGST",totals.sgst],["Round Off",totals.roundOff],["Grand Total",totals.grandTotal]] : [["Subtotal",totals.subtotal],["IGST",totals.igst],["Round Off",totals.roundOff],["Grand Total",totals.grandTotal]];
  const left=7, width=196, leftWidth=118, rightX=125, height=36, rowHeight=height/rows.length;
  purchaseOrderPdfGradient(pdf,left,y,leftWidth,7); purchaseOrderPdfCellText(pdf,"REMARKS",left+2,y+4.9,leftWidth-4,{size:8,bold:true,color:[255,255,255]});
  pdf.setFillColor(255,255,255); pdf.rect(left,y+7,leftWidth,height-7,"F"); pdf.setDrawColor(145,167,183); pdf.line(rightX,y,rightX,y+height); pdf.line(left,y+height,left+width,y+height);
  purchaseOrderPdfCellText(pdf,order.remarks || "",left+2,y+12.5,leftWidth-4,{size:7.2,maxLines:6});
  rows.forEach(([label,value],index) => { const rowY=y+index*rowHeight;if(index===rows.length-1){pdf.setFillColor(217,231,242);pdf.rect(rightX,rowY,78,rowHeight,"F");}else{pdf.setFillColor(255,255,255);pdf.rect(rightX,rowY,78,rowHeight,"F");}pdf.rect(rightX,rowY,78,rowHeight);purchaseOrderPdfCellText(pdf,label,rightX+1,rowY+rowHeight*.67,38,{size:7.4,bold:index===rows.length-1,maxLines:1});purchaseOrderPdfCellText(pdf,purchaseOrderPdfMoney(value, order.poType, purchaseOrderRecordCurrency(order)),rightX+39,rowY+rowHeight*.67,38,{size:7.4,bold:index===rows.length-1,align:"right",maxLines:1}); });
  const amountY=y+38; purchaseOrderPdfGradient(pdf,left,amountY,42,8); purchaseOrderPdfCellText(pdf,"AMOUNT IN WORDS",left,amountY+5.5,42,{size:7.2,bold:true,color:[255,255,255],align:"center"}); pdf.setFillColor(255,255,255);pdf.rect(left+42,amountY,154,8,"F");pdf.line(left,amountY,left+width,amountY);pdf.line(left,amountY+8,left+width,amountY+8);pdf.line(left+42,amountY,left+42,amountY+8); purchaseOrderPdfCellText(pdf,purchaseOrderAmountInWords(totals.grandTotal, order.poType, purchaseOrderRecordCurrency(order)),left+43,amountY+5.5,152,{size:7.4,bold:true,maxLines:1});
  const infoY=amountY+9; purchaseOrderPdfGradient(pdf,left,infoY,width,7); purchaseOrderPdfCellText(pdf,"OTHER INFORMATION",left,infoY+5,width,{size:8,bold:true,color:[255,255,255],align:"center"});
  const info=[["SHIP VIA",order.shipVia],["SHIPPING TERMS",order.shippingTerms],["PAYMENT TERMS",order.paymentTerms],["DELIVERY DATE",purchaseOrderPreviewDate(order.deliveryDate)]]; info.forEach(([label,value],index)=>{const x=left+index*49;pdf.setFillColor(255,255,255);pdf.rect(x,infoY+7,49,15,"F");if(index<3)pdf.line(x+49,infoY+7,x+49,infoY+22);purchaseOrderPdfCellText(pdf,label,x,infoY+11.5,49,{size:7,bold:true,align:"center",maxLines:1});purchaseOrderPdfCellText(pdf,value||"-",x,infoY+18.5,49,{size:7.2,align:"center",maxLines:2});});
  const authY=infoY+23, half=98; pdf.setFillColor(255,255,255);pdf.rect(left,authY,width,37,"F");pdf.line(left,authY,left+width,authY);pdf.line(left+half,authY,left+half,authY+37);
  const signedPrepared=Boolean(order.preparedSignature?.signedAt), signedApproved=Boolean(order.approvedSignature?.signedAt);
  if(signedPrepared&&assets.stamp)pdf.addImage(assets.stamp,"PNG",left+35,authY+2,20,20,"PO_PREPARED_STAMP","FAST");
  if(signedPrepared&&assets.preparedSignature)pdf.addImage(assets.preparedSignature,"PNG",left+49,authY+8,31,10,"PO_PREPARED_AUTOGRAPH","FAST");
  if(signedApproved&&assets.stamp)pdf.addImage(assets.stamp,"PNG",left+half+35,authY+2,20,20,"PO_APPROVED_STAMP","FAST");
  if(signedApproved&&assets.approvedSignature)pdf.addImage(assets.approvedSignature,"PNG",left+half+49,authY+8,31,10,"PO_APPROVED_AUTOGRAPH","FAST");
  purchaseOrderPdfCellText(pdf,`PREPARED BY\n${signedPrepared?"Rohan Kapoor (Purchase Manager)":"Pending"}`,left,authY+27.5,half,{size:6.8,bold:true,align:"center",maxLines:2});
  purchaseOrderPdfCellText(pdf,`APPROVED BY\n${signedApproved?"Aarav Mehta (Chief Procurement Officer)":"Pending"}`,left+half,authY+27.5,half,{size:6.8,bold:true,align:"center",maxLines:2});
  return authY+37;
}

window.exportSavedPurchaseOrderPdf = function() {
  if (!activeSavedPurchaseOrderId) { window.showNotification({ title: "Save Required", message: "Save the Purchase Order before exporting it.", type: "warning" }); return; }
  const order = (purchaseOrdersDb || []).find(record => String(record.id) === String(activeSavedPurchaseOrderId));
  if (purchaseOrderStatus(order) !== "APPROVED") { window.showNotification({ title: "Administrator Approval Required", message: "This Purchase Order cannot be exported or issued until it is approved by the Administrator.", type: "warning" }); return; }
  window.exportPurchaseOrderPdf(activeSavedPurchaseOrderId);
};

function purchaseOrderApprovedForOutput(id) {
  const order = (purchaseOrdersDb || []).find(record => String(record.id) === String(id));
  if (!order) { window.showNotification({ title: "Purchase Order Not Found", message: "The saved Purchase Order was not found.", type: "danger" }); return null; }
  if (purchaseOrderStatus(order) !== "APPROVED" || !order.approvedSignature?.signedAt) { window.showNotification({ title: "Administrator Approval Required", message: `${order.poNumber} has not been approved and digitally signed by the Administrator.`, type: "warning" }); return null; }
  return order;
}

async function buildPurchaseOrderPdf(order) {
  const JsPdf = window.jspdf?.jsPDF;
  if (!JsPdf || !window.html2canvas) throw new Error("Refresh the ERP so the PDF libraries can load.");
  let exportHost = null;
  try {
    const exportWidth = 960;
    exportHost = document.createElement("div");
    exportHost.className = "purchase-order-pdf-render-host";
    exportHost.style.width = `${exportWidth}px`;
    exportHost.innerHTML = `<div class="purchase-order-live-sheet purchase-order-pdf-sheet">${purchaseOrderPreviewHtml(order)}</div>`;
    document.body.appendChild(exportHost);
    const sheet = exportHost.querySelector(".purchase-order-live-sheet");
    await Promise.all(Array.from(sheet.querySelectorAll("img")).map(image => image.complete && image.naturalWidth ? Promise.resolve() : new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error(`Could not load ${image.alt || "a Purchase Order image"}.`)); })));
    if (document.fonts?.ready) await document.fonts.ready;
    const canvas = await window.html2canvas(sheet, { scale: 4, useCORS: true, backgroundColor: "#ffffff", logging: false, scrollX: 0, scrollY: 0, removeContainer: true });
    const pdf = new JsPdf({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    const margin = 7, pageWidth = 210, pageHeight = 297, renderWidth = pageWidth - margin * 2, renderHeight = canvas.height * renderWidth / canvas.width, usableHeight = pageHeight - margin * 2;
    const imageData = canvas.toDataURL("image/png");
    const pageCount = Math.max(1, Math.ceil(renderHeight / usableHeight));
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      if (pageIndex) pdf.addPage();
      pdf.addImage(imageData, "PNG", margin, margin - pageIndex * usableHeight, renderWidth, renderHeight, "PURCHASE_ORDER_PREVIEW", "SLOW");
    }
    return pdf;
  } finally { exportHost?.remove(); }
}

function purchaseOrderDocumentUrl(order, documentRecord) {
  const params = new URLSearchParams({ action: "read_purchase_order_document", poNumber: String(order.poNumber || ""), path: String(documentRecord.path || "") });
  return `backend/api.php?${params.toString()}`;
}

function appendPurchaseOrderCanvasPage(pdf, canvas, alias) {
  const landscape = canvas.width > canvas.height;
  const pageWidth = landscape ? 297 : 210, pageHeight = landscape ? 210 : 297, margin = 5;
  const scale = Math.min((pageWidth - margin * 2) / canvas.width, (pageHeight - margin * 2) / canvas.height);
  const width = canvas.width * scale, height = canvas.height * scale;
  pdf.addPage([pageWidth, pageHeight], landscape ? "landscape" : "portrait");
  pdf.addImage(canvas.toDataURL("image/jpeg", 0.96), "JPEG", (pageWidth - width) / 2, (pageHeight - height) / 2, width, height, alias, "FAST");
}

async function purchaseOrderImageBlobCanvas(blob) {
  const imageUrl = URL.createObjectURL(blob), image = new Image();
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("An attached PI image could not be opened.")); image.src = imageUrl; });
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    return canvas;
  } finally { URL.revokeObjectURL(imageUrl); }
}

async function purchaseOrderPiDocuments(order) {
  const localDocuments = Array.isArray(order.documents) ? order.documents : [];
  let serverDocuments = [];
  try {
    const params = new URLSearchParams({ action: "list_purchase_order_documents", poNumber: String(order.poNumber || "") });
    const response = await fetch(`backend/api.php?${params.toString()}`, { credentials: "same-origin", cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (response.ok && String(result.status || "").toLowerCase() === "success" && Array.isArray(result.documents)) serverDocuments = result.documents;
  } catch (error) { console.warn("Stored PI lookup failed; using documents retained with the PO record.", error); }
  const byPath = new Map();
  [...localDocuments, ...serverDocuments].forEach(documentRecord => { if (documentRecord?.path) byPath.set(String(documentRecord.path), documentRecord); });
  return [...byPath.values()].filter(documentRecord => String(documentRecord?.category || "").toUpperCase() === "PI");
}

async function appendPurchaseOrderPiDocuments(pdf, order) {
  const piDocuments = await purchaseOrderPiDocuments(order);
  if (!piDocuments.length) return 0;
  let pageIndex = 0;
  for (const documentRecord of piDocuments) {
    const response = await fetch(purchaseOrderDocumentUrl(order, documentRecord), { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(`PI ${documentRecord.originalName || "document"} could not be loaded for printing.`);
    const blob = await response.blob();
    const name = String(documentRecord.originalName || documentRecord.path || "").toLowerCase();
    const isPdf = String(documentRecord.mime || blob.type || "").toLowerCase().includes("pdf") || name.endsWith(".pdf");
    if (isPdf) {
      if (!window.pdfjsLib) throw new Error("Refresh the ERP so the PI PDF printing library can load.");
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      const source = await blob.arrayBuffer();
      const piPdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(source) }).promise;
      for (let number = 1; number <= piPdf.numPages; number += 1) {
        const page = await piPdf.getPage(number), viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        appendPurchaseOrderCanvasPage(pdf, canvas, `PURCHASE_ORDER_PI_${pageIndex += 1}`);
      }
    } else if (String(documentRecord.mime || blob.type || "").toLowerCase().startsWith("image/") || /\.(jpe?g|png|webp)$/.test(name)) {
      appendPurchaseOrderCanvasPage(pdf, await purchaseOrderImageBlobCanvas(blob), `PURCHASE_ORDER_PI_${pageIndex += 1}`);
    } else {
      throw new Error(`PI ${documentRecord.originalName || "document"} is not a printable PDF or image.`);
    }
  }
  return pageIndex;
}

window.exportPurchaseOrderPdf = async function(id) {
  const order = purchaseOrderApprovedForOutput(id); if (!order) return;
  try {
    const pdf = await buildPurchaseOrderPdf(order);
    pdf.save(`${String(order.poNumber || "Purchase_Order").replace(/[^A-Za-z0-9_-]+/g,"_")}.pdf`);
    logEvent("PURCHASE", "PURCHASE_ORDER_PDF_EXPORTED", `Exported Purchase Order ${order.poNumber} as PDF.`);
  } catch (error) { console.error("Purchase Order PDF export failed", error); window.showNotification({ title: "PDF Export Failed", message: error?.message || "The Purchase Order PDF could not be created.", type: "danger" }); }
};

window.printPurchaseOrder = async function(id) {
  const order = purchaseOrderApprovedForOutput(id); if (!order) return;
  const printWindow = window.open("", "_blank");
  if (!printWindow) { window.showNotification({ title: "Print Window Blocked", message: "Allow pop-ups for this ERP and click Print PO again.", type: "warning" }); return; }
  printWindow.document.write("<!doctype html><title>Preparing Purchase Order</title><body style='font-family:Arial;padding:30px'>Preparing Purchase Order and attached PI for printing…</body>");
  try {
    const pdf = await buildPurchaseOrderPdf(order), piPages = await appendPurchaseOrderPiDocuments(pdf, order);
    if (typeof pdf.autoPrint === "function") pdf.autoPrint({ variant: "non-conform" });
    const blobUrl = URL.createObjectURL(pdf.output("blob"));
    printWindow.location.replace(blobUrl);
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 300000);
    logEvent("PURCHASE", "PURCHASE_ORDER_PRINTED", `Opened Purchase Order ${order.poNumber} for printing${piPages ? ` with ${piPages} PI page(s)` : ""}.`);
  } catch (error) {
    printWindow.close();
    console.error("Purchase Order print failed", error);
    window.showNotification({ title: "Print Failed", message: error?.message || "The Purchase Order and PI could not be prepared for printing.", type: "danger" });
  }
};

function initializePurchaseOrderDefaults() {
  const date = document.getElementById("purchaseOrderDate");
  if (date && !date.value) date.value = new Date().toISOString().slice(0, 10);
  refreshPurchaseOrderNumber(true);
  window.renderPurchaseOrderLivePreview?.();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializePurchaseOrderDefaults, { once: true });
} else {
  initializePurchaseOrderDefaults();
}
