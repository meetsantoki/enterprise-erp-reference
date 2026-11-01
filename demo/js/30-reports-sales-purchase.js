/* =========================================================================
   REPORTS HUB — ONE LIVE, CROSS-DEPARTMENT REPORTING WORKSPACE
   ========================================================================= */

function reportHubText(value) {
  return String(value ?? "").trim();
}

function reportHubYmd(value) {
  const text = reportHubText(value);
  if (!text) return "";
  const yyyyMmDd = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (yyyyMmDd) return `${yyyyMmDd[1]}-${String(yyyyMmDd[2]).padStart(2, "0")}-${String(yyyyMmDd[3]).padStart(2, "0")}`;
  const ddMmYyyy = text.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (ddMmYyyy) return `${ddMmYyyy[3]}-${String(ddMmYyyy[2]).padStart(2, "0")}-${String(ddMmYyyy[1]).padStart(2, "0")}`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function reportHubTime(value) {
  const match = reportHubText(value).match(/(?:T|\s)(\d{1,2}):(\d{2})/);
  return match ? `${String(match[1]).padStart(2, "0")}:${match[2]}` : "";
}

function reportHubDisplayDate(value) {
  const ymd = reportHubYmd(value);
  if (!ymd) return reportHubText(value) || "-";
  const [year, month, day] = ymd.split("-");
  return `${day}/${month}/${year}`;
}

function reportHubDepartmentKey(name) {
  const value = reportHubText(name).toUpperCase();
  if (/STORE|PPC/.test(value)) return "STORE";
  if (/PACK/.test(value)) return "PACKING";
  if (/WAREHOUSE|GODOWN/.test(value)) return "WAREHOUSE";
  if (/DISPATCH|LOGISTIC|TRANSPORT/.test(value)) return "DISPATCH";
  if (/SALES/.test(value)) return "SALES";
  if (/ADMIN|SYSTEM|IT|MANAGEMENT/.test(value)) return "ADMIN";
  return `CUSTOM:${reportHubText(name)}`;
}

function getReportHubDepartments() {
  const standard = [
    { id: "ALL", name: "All Departments" },
    { id: "STORE", name: "Store & PPC" },
    { id: "PACKING", name: "Packing Department" },
    { id: "WAREHOUSE", name: "Warehouse" },
    { id: "DISPATCH", name: "Dispatch Department" },
    { id: "SALES", name: "Sales Department" },
    { id: "ADMIN", name: "Administration & System" }
  ];
  const known = new Set(standard.map(item => item.id));
  (departmentsDb || []).forEach(department => {
    const name = reportHubText(department.name);
    const id = reportHubDepartmentKey(name);
    if (name && !known.has(id)) {
      standard.push({ id, name });
      known.add(id);
    }
  });
  return standard;
}

let reportsHubSummary = null;

function reportHubModuleKeys(department) {
  const common = [KEY_DEPARTMENTS];
  const map = {
    STORE: [KEY_POS, KEY_STORE_SERIALS, KEY_STOCK, KEY_DISPATCH_ARCHIVE],
    PACKING: [KEY_STOCK],
    WAREHOUSE: [KEY_STOCK, KEY_STOCK_BOOKINGS],
    DISPATCH: [KEY_DISPATCH_ARCHIVE, KEY_ROUTE_FARES],
    SALES: [KEY_SALES_ORDERS],
    ADMIN: [KEY_LOGS]
  };
  if (department === "ALL" || String(department || "").startsWith("CUSTOM:")) {
    return [...new Set([...common, ...Object.values(map).flat()])];
  }
  return [...new Set([...common, ...(map[department] || [])])];
}

async function ensureReportsHubDepartmentData(department) {
  const needed = reportHubModuleKeys(department).filter(key => !loadedModuleKeys.has(key) && (!authorizedModuleKeys.size || authorizedModuleKeys.has(key)));
  if (needed.length) await loadModuleBundle(needed);
}

async function loadReportsHubSummary(force = false) {
  const period = getReportHubPeriod();
  const signature = `${period.from}|${period.to}`;
  if (!force && reportsHubSummary?.signature === signature) return reportsHubSummary;
  try {
    const params = new URLSearchParams({ action: "reports_hub_summary" });
    if (period.from) params.set("from", period.from);
    if (period.to) params.set("to", period.to);
    const response = await erpReadResponse(`reports-summary:${signature}`, `backend/api.php?${params.toString()}`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error("Report summary request failed.");
    const payload = await response.json();
    if (payload.status !== "success") throw new Error(payload.message || "Report summary request failed.");
    reportsHubSummary = { signature, summaries: payload.summaries || {}, total: payload.total || { records: 0, quantity: 0 } };
  } catch (error) {
    console.warn("Reports Hub summary could not be loaded.", error);
    reportsHubSummary = { signature, summaries: {}, total: { records: 0, quantity: 0 } };
  }
  return reportsHubSummary;
}

function getReportHubTypeOptions(department) {
  const readyReports = {
    ALL: [["SUMMARY", "All Department Summary"], ["DETAIL", "All Activities Register"], ["PO_STATUS", "PO & Fulfilment Status"], ["PENDING", "All Pending Items"], ["GRADE", "Grade-wise Stock"], ["TRANSPORT", "Dispatch & Route Report"], ["SALES_FINANCIAL", "Sales & Financial Report"], ["AUDIT", "System Activity Report"]],
    STORE: [["SUMMARY", "Store & PPC Summary"], ["PO_STATUS", "PO-wise Status"], ["PENDING", "Pending PO Report"], ["DETAIL", "Serial Upload Register"]],
    PACKING: [["SUMMARY", "Packing Summary"], ["DETAIL", "Pallet Register"], ["GRADE", "Grade-wise Packing"], ["PENDING", "Pending Packing"]],
    WAREHOUSE: [["SUMMARY", "Warehouse Summary"], ["DETAIL", "Live Stock Register"], ["GRADE", "Grade-wise Stock"], ["PENDING", "Booked / Pending Stock"]],
    DISPATCH: [["SUMMARY", "Dispatch Summary"], ["DETAIL", "Dispatch Register"], ["TRANSPORT", "Transport & Route Report"], ["PENDING", "Pending Dispatch"]],
    SALES: [["SUMMARY", "Sales Summary"], ["SALES_FINANCIAL", "Sales & Financial Report"], ["PENDING", "Pending Sales Orders"], ["DETAIL", "Sales Order Register"]],
    ADMIN: [["SUMMARY", "Administration Summary"], ["AUDIT", "System Activity Report"]]
  };
  return readyReports[department] || [["SUMMARY", "Department Summary"], ["DETAIL", "Detailed Register"], ["AUDIT", "Activity Report"]];
}

function populateReportsHubControls() {
  const departmentSelect = document.getElementById("reportHubDepartment");
  if (!departmentSelect) return;
  const previous = departmentSelect.value || "ALL";
  const departments = getReportHubDepartments();
  departmentSelect.innerHTML = departments.map(department => `<option value="${escapeSalesHtml(department.id)}">${escapeSalesHtml(department.name)}</option>`).join("");
  departmentSelect.value = departments.some(department => department.id === previous) ? previous : "ALL";
  populateReportsHubTypeSelect();
}

function populateReportsHubTypeSelect() {
  const department = document.getElementById("reportHubDepartment")?.value || "ALL";
  const typeSelect = document.getElementById("reportHubType");
  if (!typeSelect) return;
  const previous = typeSelect.value || "SUMMARY";
  const types = getReportHubTypeOptions(department);
  typeSelect.innerHTML = types.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  typeSelect.value = types.some(([value]) => value === previous) ? previous : "SUMMARY";
}

function getReportHubPeriod() {
  const selected = document.getElementById("reportHubPeriod")?.value || "TODAY";
  const today = new Date();
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const asYmd = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const startOfWeek = new Date(day);
  startOfWeek.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  const lastWeekStart = new Date(startOfWeek);
  lastWeekStart.setDate(startOfWeek.getDate() - 7);
  const lastWeekEnd = new Date(startOfWeek);
  lastWeekEnd.setDate(startOfWeek.getDate() - 1);
  const monthStart = new Date(day.getFullYear(), day.getMonth(), 1);
  const monthEnd = new Date(day.getFullYear(), day.getMonth() + 1, 0);
  const lastMonthStart = new Date(day.getFullYear(), day.getMonth() - 1, 1);
  const lastMonthEnd = new Date(day.getFullYear(), day.getMonth(), 0);
  const fiscalStartYear = day.getMonth() >= 3 ? day.getFullYear() : day.getFullYear() - 1;
  const financialYearStart = new Date(fiscalStartYear, 3, 1);
  const fiscalMonthOffset = (day.getMonth() - 3 + 12) % 12;
  const currentQuarterStart = new Date(day.getFullYear(), day.getMonth() - (fiscalMonthOffset % 3), 1);
  const lastQuarterStart = new Date(currentQuarterStart.getFullYear(), currentQuarterStart.getMonth() - 3, 1);
  const lastQuarterEnd = new Date(currentQuarterStart.getFullYear(), currentQuarterStart.getMonth(), 0);
  const values = {
    TODAY: [asYmd(day), asYmd(day), "Today"],
    YESTERDAY: [asYmd(new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1)), asYmd(new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1)), "Yesterday"],
    THIS_WEEK: [asYmd(startOfWeek), asYmd(endOfWeek), "This Week"],
    LAST_WEEK: [asYmd(lastWeekStart), asYmd(lastWeekEnd), "Last Week"],
    THIS_MONTH: [asYmd(monthStart), asYmd(monthEnd), "This Month"],
    LAST_MONTH: [asYmd(lastMonthStart), asYmd(lastMonthEnd), "Last Month"],
    THIS_QUARTER: [asYmd(currentQuarterStart), asYmd(day), "This Quarter"],
    LAST_QUARTER: [asYmd(lastQuarterStart), asYmd(lastQuarterEnd), "Last Quarter"],
    FINANCIAL_YEAR: [asYmd(financialYearStart), asYmd(day), "Financial Year"],
    ALL_TIME: ["", "", "All Time"],
    CUSTOM: [document.getElementById("reportHubFromDate")?.value || "", document.getElementById("reportHubToDate")?.value || "", "Custom Date Range"]
  };
  const [from, to, label] = values[selected] || values.TODAY;
  return { selected, from, to, label };
}

function getReportHubRows() {
  const rows = [];
  const add = data => rows.push({
    department: "-", date: "", reference: "-", po: "", co: "", model: "", watt: "", grade: "", customer: "", transporter: "", vehicle: "", qty: 0, pendingQty: 0, amount: 0, status: "", details: "", serials: "", ...data
  });

  (storeSerialsDb || []).forEach(batch => add({
    department: "STORE", date: batch.timestamp || batch.date || "", reference: `SERIAL BATCH ${batch.id || "-"}`, po: batch.poNumber || batch.po || "", qty: Number(batch.count || (batch.serials || []).length || 0), status: "SERIALS REGISTERED", serials: (batch.serials || []).join(", "), details: `${Number(batch.count || (batch.serials || []).length || 0)} serial number(s) registered`
  }));

  (godownStock || []).forEach(pallet => {
    const booking = (stockBookings || []).find(item => String(item.pallet || "").toUpperCase() === String(pallet.pallet || "").toUpperCase() && String(item.status || "").toUpperCase() === "BOOKED");
    add({
      department: "PACKING", date: pallet.date || "", reference: pallet.pallet || "-", po: pallet.po || "", model: pallet.model || "", watt: pallet.watt || "", grade: pallet.grade || "A GRADE", qty: Number(pallet.count || (pallet.serials || pallet.fullRows || []).length || 0), status: "PACKED", serials: (pallet.serials || (pallet.fullRows || []).map(item => item.serial)).filter(Boolean).join(", "), details: `Pallet sealed${pallet.binning ? ` • ${pallet.binning}` : ""}`
    });
    add({
      department: "WAREHOUSE", date: pallet.date || "", reference: pallet.pallet || "-", po: pallet.po || "", model: pallet.model || "", watt: pallet.watt || "", grade: pallet.grade || "A GRADE", qty: Number(pallet.count || (pallet.serials || pallet.fullRows || []).length || 0), status: booking ? "BOOKED" : "AVAILABLE", customer: booking?.customer || "", serials: (pallet.serials || (pallet.fullRows || []).map(item => item.serial)).filter(Boolean).join(", "), details: booking ? `Reserved for ${booking.customer}` : "Live finished-goods stock"
    });
  });

  (dispatchArchive || []).forEach(manifest => {
    add({
      department: "DISPATCH", date: manifest.date || "", reference: manifest.invoice || manifest.challanNo || `DISPATCH ${manifest.id || "-"}`, po: manifest.po || "", co: manifest.coNumber || "", model: manifest.product || "", customer: manifest.customer || "", transporter: manifest.transporter || "", vehicle: manifest.vehicle || "", qty: Number(manifest.dispatchedQty || 0), status: "DISPATCHED", serials: (manifest.pallets || []).flatMap(pallet => pallet.serials || (pallet.fullRows || []).map(item => item.serial)).filter(Boolean).join(", "), details: `Challan: ${manifest.challanNo || "-"}${manifest.lrNo ? ` • LR: ${manifest.lrNo}` : ""}`
    });
  });

  (routeFaresDb || []).forEach(route => add({
    department: "DISPATCH", date: route.date || "", reference: `ROUTE FARE ${route.id || "-"}`, transporter: route.transporter || "", qty: 0, amount: Number(route.amount || 0), status: "ROUTE FARE", details: `${route.fromPlace || "-"} → ${route.toPlace || "-"}${route.remarks ? ` • ${route.remarks}` : ""}`
  }));

  (salesOrders || []).forEach(order => add({
    department: "SALES", date: order.orderDate || order.createdAt || "", reference: order.coNumber || `SALES ${order.id || "-"}`, co: order.coNumber || "", model: order.modelNo || "", watt: order.moduleWatt ? `${order.moduleWatt} WATT` : (order.wpModule || ""), customer: order.customerName || "", qty: Number(order.totalOrderQty || 0), pendingQty: Number(order.pendingQty || 0), amount: Number(order.invoiceValue || order.totalOrderValue || 0), status: order.status || "PENDING", details: `${order.salesPerson || "-"} • Invoice value ₹${Number(order.invoiceValue || order.totalOrderValue || 0).toLocaleString("en-IN")}`
  }));

  (auditLogs || []).forEach(log => add({
    department: reportHubDepartmentKey(log.dept || "ADMIN"), date: log.timestamp || "", reference: log.action || `LOG ${log.id || "-"}`, status: log.dept || "SYSTEM", details: `${log.operator || "SYSTEM"}: ${log.details || "-"}`
  }));
  return rows;
}

function getReportHubPoRows() {
  const allPallets = [
    ...(godownStock || []),
    ...(dispatchArchive || []).flatMap(manifest => manifest.pallets || [])
  ];
  return (poDatabase || []).map(po => {
    const poNumber = reportHubText(po.poNumber);
    const packedQty = allPallets.filter(pallet => reportHubText(pallet.po).toUpperCase() === poNumber.toUpperCase()).reduce((sum, pallet) => sum + Number(pallet.count || (pallet.serials || pallet.fullRows || []).length || 0), 0);
    const dispatchedQty = (dispatchArchive || []).filter(manifest => reportHubText(manifest.po).toUpperCase() === poNumber.toUpperCase()).reduce((sum, manifest) => sum + Number(manifest.dispatchedQty || 0), 0);
    const orderQty = Number(po.qty || 0);
    return {
      department: "STORE", date: "", reference: poNumber, po: poNumber, model: getPoPackingModel(po) || po.product || "", watt: po.watt || "", qty: orderQty, packedQty, dispatchedQty,
      productionPending: Math.max(0, orderQty - packedQty), pendingQty: Math.max(0, orderQty - dispatchedQty), status: po.status || (dispatchedQty >= orderQty && orderQty > 0 ? "DISPATCHED" : "OPEN"), details: po.printFormat || "DEMOSOLAR"
    };
  });
}

function reportHubMatches(row, filters, allowUndated = false) {
  if (filters.departments?.length && !filters.departments.includes(row.department)) return false;
  if (filters.department !== "ALL" && row.department !== filters.department) return false;
  const ymd = reportHubYmd(row.date);
  if (!allowUndated && (filters.from || filters.to)) {
    if (!ymd || (filters.from && ymd < filters.from) || (filters.to && ymd > filters.to)) return false;
  }
  const rowTime = reportHubTime(row.date);
  if ((filters.fromTime || filters.toTime) && (!rowTime || (filters.fromTime && rowTime < filters.fromTime) || (filters.toTime && rowTime > filters.toTime))) return false;
  const allText = [row.department, row.reference, row.po, row.co, row.model, row.watt, row.grade, row.customer, row.transporter, row.vehicle, row.status, row.details, row.serials].join(" ").toLowerCase();
  const referenceText = [row.po, row.co, row.customer].join(" ").toLowerCase();
  const productText = [row.model, row.watt, row.grade].join(" ").toLowerCase();
  const transportText = [row.transporter, row.vehicle].join(" ").toLowerCase();
  const keyword = filters.keyword.toLowerCase();
  if (keyword && !allText.includes(keyword)) return false;
  if (filters.reference && !referenceText.includes(filters.reference.toLowerCase())) return false;
  if (filters.product && !productText.includes(filters.product.toLowerCase())) return false;
  if (filters.transport && !transportText.includes(filters.transport.toLowerCase())) return false;
  if (filters.status !== "ALL" && reportHubText(row.status).toUpperCase() !== filters.status) return false;
  return true;
}

function getReportHubFilters() {
  const period = getReportHubPeriod();
  const scope = document.getElementById("easyReportScope")?.value || "SINGLE";
  const departments = scope === "MULTIPLE"
    ? [...document.querySelectorAll(".easy-report-department:checked")].map(input => input.value)
    : [];
  return {
    ...period,
    departments,
    department: document.getElementById("reportHubDepartment")?.value || "ALL",
    type: document.getElementById("reportHubType")?.value || "SUMMARY",
    keyword: document.getElementById("reportHubKeyword")?.value || "",
    reference: document.getElementById("reportHubReference")?.value || "",
    product: document.getElementById("reportHubProduct")?.value || "",
    transport: document.getElementById("reportHubTransport")?.value || "",
    status: document.getElementById("reportHubStatus")?.value || "ALL",
    fromTime: document.getElementById("reportHubFromTime")?.value || "",
    toTime: document.getElementById("reportHubToTime")?.value || ""
  };
}

function reportHubGroup(rows, keyFn) {
  const groups = new Map();
  rows.forEach(row => {
    const key = keyFn(row) || "Not Specified";
    if (!groups.has(key)) groups.set(key, { key, records: 0, qty: 0, pending: 0, amount: 0, rows: [] });
    const group = groups.get(key);
    group.records += 1;
    group.qty += Number(row.qty || 0);
    group.pending += Number(row.pendingQty || 0);
    group.amount += Number(row.amount || 0);
    group.rows.push(row);
  });
  return [...groups.values()];
}

function reportHubKpi(label, value, note, color = "#087fb9") {
  return `<div class="kpi-card"><div class="kpi-label">${escapeSalesHtml(label)}</div><div class="kpi-value" style="color:${color};">${escapeSalesHtml(value)}</div><div class="kpi-sub">${escapeSalesHtml(note)}</div></div>`;
}

function getReportsHubResult() {
  const filters = getReportHubFilters();
  let rows = getReportHubRows().filter(row => reportHubMatches(row, filters));
  if (filters.type === "PENDING") rows = rows.filter(row => Number(row.pendingQty || 0) > 0 || /PENDING|OPEN|AWAITING|BOOKED/i.test(row.status));
  if (filters.type === "TRANSPORT") rows = rows.filter(row => row.department === "DISPATCH" && (row.transporter || /ROUTE FARE/i.test(row.status)));
  if (filters.type === "SALES_FINANCIAL") rows = rows.filter(row => row.department === "SALES");
  if (filters.type === "AUDIT") rows = rows.filter(row => row.reference && (row.department === "ADMIN" || String(row.department).startsWith("CUSTOM:")));
  if (filters.type === "GRADE") rows = rows.filter(row => ["PACKING", "WAREHOUSE"].includes(row.department));

  let poRows = getReportHubPoRows().filter(row => reportHubMatches(row, filters, true));
  if (filters.type === "PO_STATUS") rows = poRows;
  if (filters.type === "PENDING" && filters.department === "STORE") rows = poRows.filter(row => Number(row.pendingQty || 0) > 0 || /OPEN/i.test(row.status));
  return { filters, rows, poRows };
}

const REPORT_BUILDER_COLUMNS = [
  ["department", "Department"], ["date", "Date"], ["time", "Time"], ["reference", "Reference"],
  ["po", "PO Number"], ["co", "C/O Number"], ["customer", "Customer"], ["model", "Model"],
  ["watt", "Wattage"], ["grade", "Grade"], ["qty", "Quantity"], ["pendingQty", "Pending Qty."],
  ["status", "Status"], ["transporter", "Transporter"], ["vehicle", "Vehicle"], ["details", "Details"]
];

function reportBuilderValue(row, key) {
  if (key === "date") return reportHubDisplayDate(row.date);
  if (key === "time") return reportHubTime(row.date);
  if (key === "department") return getReportHubDepartments().find(item => item.id === row.department)?.name || String(row.department || "").replace("CUSTOM:", "");
  return row[key] ?? "";
}

function getReportBuilderColumns() {
  const checked = [...document.querySelectorAll(".report-builder-column:checked")].map(input => input.value);
  const keys = checked.length ? checked : ["department", "date", "reference", "po", "co", "customer", "model", "qty", "status"];
  return REPORT_BUILDER_COLUMNS.filter(([key]) => keys.includes(key));
}

function populateReportBuilderColumns() {
  const container = document.getElementById("reportBuilderColumns");
  if (!container || container.dataset.ready) return;
  const defaults = new Set(["department", "date", "reference", "po", "co", "customer", "model", "qty", "status"]);
  container.innerHTML = REPORT_BUILDER_COLUMNS.map(([key, label]) => `<label style="display:flex; align-items:center; gap:7px; padding:7px 9px; border:1px solid #dbe6ed; border-radius:7px; background:#fff; font-size:11px; font-weight:700; cursor:pointer;"><input class="report-builder-column" type="checkbox" value="${key}" ${defaults.has(key) ? "checked" : ""} onchange="renderReportsHub()" style="width:auto;">${escapeSalesHtml(label)}</label>`).join("");
  container.dataset.ready = "true";
}

function renderReportsHubTable(result) {
  const head = document.getElementById("reportHubTableHead");
  const body = document.getElementById("reportHubTableBody");
  if (!head || !body) return;
  const { rows, filters } = result;
  const value = value => escapeSalesHtml(reportHubText(value) || "-");
  if (!rows.length) {
    head.innerHTML = "";
    body.innerHTML = `<tr><td style="padding:30px; text-align:center; color:var(--muted);">No records match the selected report filters.</td></tr>`;
    return;
  }
  if (filters.type === "SUMMARY") {
    const groups = reportHubGroup(rows, row => row.department);
    head.innerHTML = "<tr><th>Department</th><th>Activity Records</th><th>Quantity</th><th>Pending Qty.</th><th>Amount / Value</th><th>Latest Activity</th></tr>";
    body.innerHTML = groups.map(group => `<tr><td><strong>${value(getReportHubDepartments().find(department => department.id === group.key)?.name || group.key.replace("CUSTOM:", ""))}</strong></td><td>${group.records}</td><td><strong>${group.qty.toLocaleString("en-IN")}</strong></td><td style="color:#b45309; font-weight:700;">${group.pending.toLocaleString("en-IN")}</td><td>${group.amount ? `₹ ${group.amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "-"}</td><td>${value(reportHubDisplayDate(group.rows[0]?.date))}</td></tr>`).join("");
    return;
  }
  if (filters.type === "GRADE") {
    const groups = reportHubGroup(rows, row => `${row.grade || "Not Specified"} • ${row.watt || "All Wattages"}`);
    head.innerHTML = "<tr><th>Grade / Wattage</th><th>Pallet / Stock Records</th><th>Modules</th><th>PO References</th><th>Models</th><th>Status</th></tr>";
    body.innerHTML = groups.map(group => `<tr><td><strong>${value(group.key)}</strong></td><td>${group.records}</td><td style="font-weight:800; color:#059669;">${group.qty.toLocaleString("en-IN")}</td><td>${value([...new Set(group.rows.map(row => row.po).filter(Boolean))].join(", "))}</td><td>${value([...new Set(group.rows.map(row => row.model).filter(Boolean))].join(", "))}</td><td>${value([...new Set(group.rows.map(row => row.status).filter(Boolean))].join(", "))}</td></tr>`).join("");
    return;
  }
  if (filters.type === "PO_STATUS") {
    head.innerHTML = "<tr><th>PO Number</th><th>Model / Wattage</th><th>Print Format</th><th>Ordered Qty.</th><th>Packed Qty.</th><th>Dispatched Qty.</th><th>Production Pending</th><th>Dispatch Pending</th><th>Status</th></tr>";
    body.innerHTML = rows.map(row => `<tr><td><strong>${value(row.po)}</strong></td><td><strong>${value(row.model)}</strong><div style="font-size:11px; color:var(--muted);">${value(row.watt)}</div></td><td>${value(row.details)}</td><td>${Number(row.qty || 0).toLocaleString("en-IN")}</td><td style="color:#087fb9; font-weight:700;">${Number(row.packedQty || 0).toLocaleString("en-IN")}</td><td style="color:#059669; font-weight:700;">${Number(row.dispatchedQty || 0).toLocaleString("en-IN")}</td><td style="color:#b45309; font-weight:700;">${Number(row.productionPending || 0).toLocaleString("en-IN")}</td><td style="color:#b45309; font-weight:700;">${Number(row.pendingQty || 0).toLocaleString("en-IN")}</td><td><strong>${value(row.status)}</strong></td></tr>`).join("");
    return;
  }
  const columns = getReportBuilderColumns();
  head.innerHTML = `<tr>${columns.map(([, label]) => `<th>${escapeSalesHtml(label)}</th>`).join("")}</tr>`;
  body.innerHTML = rows.map(row => `<tr>${columns.map(([key]) => `<td>${value(reportBuilderValue(row, key))}</td>`).join("")}</tr>`).join("");
}

function getReportHubPeriodCards() {
  return [
    { id: "TODAY", icon: "☀️", title: "Today's Report", note: "Live activity for today" },
    { id: "YESTERDAY", icon: "↩️", title: "Yesterday's Report", note: "Previous day activity" },
    { id: "THIS_WEEK", icon: "📅", title: "Weekly Report", note: "Monday to today" },
    { id: "LAST_WEEK", icon: "🗂️", title: "Last Week", note: "Previous week activity" },
    { id: "THIS_MONTH", icon: "🗓️", title: "Monthly Report", note: "Current month activity" },
    { id: "LAST_MONTH", icon: "📁", title: "Last Month", note: "Previous month activity" },
    { id: "THIS_QUARTER", icon: "📈", title: "Quarterly Report", note: "Current financial quarter" },
    { id: "LAST_QUARTER", icon: "📉", title: "Last Quarter", note: "Previous financial quarter" },
    { id: "FINANCIAL_YEAR", icon: "🏦", title: "Financial Year", note: "April to today" },
    { id: "CUSTOM", icon: "📆", title: "Custom Period", note: "Choose your own dates" }
  ];
}

function reportHubDepartmentIcon(id) {
  return ({ ALL: "📊", STORE: "📦", PACKING: "🏷️", WAREHOUSE: "🏭", DISPATCH: "🚚", SALES: "💼", ADMIN: "🛡️" })[id] || "🏢";
}

function populateEasyReportBuilder() {
  const single = document.getElementById("easyReportDepartment");
  const multiple = document.getElementById("easyReportDepartments");
  if (!single || !multiple || single.dataset.ready) return;
  const departments = getReportHubDepartments().filter(item => item.id !== "ALL");
  single.innerHTML = departments.map(item => `<option value="${escapeSalesHtml(item.id)}">${escapeSalesHtml(item.name)}</option>`).join("");
  document.getElementById("easyReportDepartmentCards").innerHTML = departments.map(item => `<button type="button" class="report-choice easy-single-department" data-value="${escapeSalesHtml(item.id)}" onclick="selectEasyReportDepartment('${escapeSalesHtml(item.id)}')"><span class="report-choice-icon">${reportHubDepartmentIcon(item.id)}</span><span class="report-choice-name">${escapeSalesHtml(item.name)}</span></button>`).join("");
  multiple.innerHTML = departments.map(item => `<button type="button" class="report-choice easy-multi-department" data-value="${escapeSalesHtml(item.id)}" onclick="toggleEasyReportDepartment(this,'${escapeSalesHtml(item.id)}')"><input class="easy-report-department" type="checkbox" value="${escapeSalesHtml(item.id)}" style="display:none;"><span class="report-choice-icon">${reportHubDepartmentIcon(item.id)}</span><span class="report-choice-name">${escapeSalesHtml(item.name)}</span></button>`).join("");
  document.getElementById("easyReportPeriodCards").innerHTML = [["TODAY","☀️","Today"],["YESTERDAY","↩️","Yesterday"],["THIS_WEEK","🗓️","This Week"],["LAST_WEEK","📅","Last Week"],["THIS_MONTH","📈","This Month"],["CUSTOM","🎯","Custom Dates"]].map(([id,icon,label]) => `<button type="button" class="report-choice easy-period-choice" data-value="${id}" onclick="selectEasyReportPeriod('${id}')"><span class="report-choice-icon">${icon}</span><span class="report-choice-name">${label}</span></button>`).join("");
  single.dataset.ready = "true";
  window.populateEasyReportProcesses();
  window.renderEasyReportSelections();
}

window.populateEasyReportProcesses = function() {
  const process = document.getElementById("easyReportProcess");
  if (!process) return;
  const scope = document.getElementById("easyReportScope")?.value || "SINGLE";
  const department = scope === "MULTIPLE" ? "ALL" : (document.getElementById("easyReportDepartment")?.value || "ALL");
  const previous = process.value;
  const options = getReportHubTypeOptions(department);
  process.innerHTML = options.map(([value, label]) => `<option value="${value}">${escapeSalesHtml(label)}</option>`).join("");
  if (options.some(([value]) => value === previous)) process.value = previous;
  const icons = { SUMMARY:"⚡", DETAIL:"📋", PENDING:"⏳", PO_STATUS:"🏭", GRADE:"🏷️", TRANSPORT:"🚚", SALES_FINANCIAL:"₹", AUDIT:"🛡️" };
  const cards = document.getElementById("easyReportProcessCards");
  if (cards) cards.innerHTML = options.map(([value,label]) => `<button type="button" class="report-choice easy-process-choice" data-value="${value}" onclick="selectEasyReportProcess('${value}')"><span class="report-choice-icon">${icons[value] || "📊"}</span><span class="report-choice-name">${escapeSalesHtml(label)}</span></button>`).join("");
  window.renderEasyReportSelections();
};

window.selectEasyReportScope = function(scope) { document.getElementById("easyReportScope").value = scope; window.toggleEasyReportScope(); };
window.selectEasyReportDepartment = function(value) { document.getElementById("easyReportDepartment").value = value; window.populateEasyReportProcesses(); window.renderEasyReportSelections(); };
window.toggleEasyReportDepartment = function(button) { const input = button.querySelector("input"); input.checked = !input.checked; button.classList.toggle("active", input.checked); window.renderEasyReportSelections(); };
window.selectEasyReportProcess = function(value) { document.getElementById("easyReportProcess").value = value; window.renderEasyReportSelections(); };
window.selectEasyReportPeriod = function(value) { document.getElementById("easyReportPeriod").value = value; window.toggleEasyReportDates(); window.renderEasyReportSelections(); };

window.renderEasyReportSelections = function() {
  const scope = document.getElementById("easyReportScope")?.value || "SINGLE";
  const department = document.getElementById("easyReportDepartment")?.value || "";
  const process = document.getElementById("easyReportProcess")?.value || "";
  const period = document.getElementById("easyReportPeriod")?.value || "TODAY";
  document.getElementById("easyScopeSingle")?.classList.toggle("active", scope === "SINGLE");
  document.getElementById("easyScopeMultiple")?.classList.toggle("active", scope === "MULTIPLE");
  document.querySelectorAll(".easy-single-department").forEach(card => card.classList.toggle("active", card.dataset.value === department));
  document.querySelectorAll(".easy-process-choice").forEach(card => card.classList.toggle("active", card.dataset.value === process));
  document.querySelectorAll(".easy-period-choice").forEach(card => card.classList.toggle("active", card.dataset.value === period));
  const departments = scope === "MULTIPLE" ? [...document.querySelectorAll(".easy-report-department:checked")].map(input => input.closest("button")?.querySelector(".report-choice-name")?.textContent) : [document.querySelector(`.easy-single-department[data-value="${department}"] .report-choice-name`)?.textContent];
  const processName = document.querySelector(`.easy-process-choice[data-value="${process}"] .report-choice-name`)?.textContent || "Process";
  const periodName = document.querySelector(`.easy-period-choice[data-value="${period}"] .report-choice-name`)?.textContent || "Period";
  const summary = document.getElementById("easyReportSelectionSummary");
  if (summary) summary.textContent = `${departments.filter(Boolean).join(" + ") || "Choose department"} • ${processName} • ${periodName}`;
};

window.toggleEasyReportScope = function() {
  const multiple = document.getElementById("easyReportScope")?.value === "MULTIPLE";
  const singleBox = document.getElementById("easySingleDepartmentBox");
  const multipleBox = document.getElementById("easyMultipleDepartmentBox");
  if (singleBox) singleBox.style.display = multiple ? "none" : "block";
  if (multipleBox) multipleBox.style.display = multiple ? "block" : "none";
  window.populateEasyReportProcesses();
  window.renderEasyReportSelections();
};

window.toggleEasyReportDates = function() {
  const custom = document.getElementById("easyReportPeriod")?.value === "CUSTOM";
  const dates = document.getElementById("easyReportCustomDates");
  if (dates) dates.style.display = custom ? "grid" : "none";
};

window.generateEasyReport = async function() {
  const scope = document.getElementById("easyReportScope")?.value || "SINGLE";
  const selectedDepartments = scope === "MULTIPLE"
    ? [...document.querySelectorAll(".easy-report-department:checked")].map(input => input.value)
    : [document.getElementById("easyReportDepartment")?.value || ""];
  if (!selectedDepartments.filter(Boolean).length) {
    window.showNotification({ title: "Select Department", message: "Select at least one department for the report.", type: "warning" });
    return;
  }
  const period = document.getElementById("easyReportPeriod")?.value || "TODAY";
  const from = document.getElementById("easyReportFromDate")?.value || "";
  const to = document.getElementById("easyReportToDate")?.value || "";
  if (period === "CUSTOM" && (!from || !to)) {
    window.showNotification({ title: "Select Date Range", message: "Choose both From Date and To Date.", type: "warning" });
    return;
  }
  await ensureReportsHubDepartmentData(scope === "SINGLE" ? selectedDepartments[0] : "ALL");
  document.getElementById("reportHubDepartment").value = scope === "SINGLE" ? selectedDepartments[0] : "ALL";
  populateReportsHubTypeSelect();
  document.getElementById("reportHubType").value = document.getElementById("easyReportProcess")?.value || "SUMMARY";
  document.getElementById("reportHubPeriod").value = period;
  document.getElementById("reportHubFromDate").value = from;
  document.getElementById("reportHubToDate").value = to;
  const names = getReportHubDepartments().filter(item => selectedDepartments.includes(item.id)).map(item => item.name).join(", ");
  const processName = document.getElementById("easyReportProcess")?.selectedOptions?.[0]?.textContent || "Report";
  document.getElementById("reportBuilderTitle").value = `${names} — ${processName}`;
  document.getElementById("reportHubReportPanel").style.display = "block";
  document.getElementById("reportHubExportActions").style.display = "flex";
  window.renderReportsHub();
  document.getElementById("reportHubReportPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
};

function renderReportsHubLanding() {
  if (!document.getElementById("reportHubDepartment")) return;
  const period = getReportHubPeriod();
  const periodCards = document.getElementById("reportHubPeriodCards");
  const customDates = document.getElementById("reportHubCustomDates");
  const periodText = document.getElementById("reportHubSelectedPeriodText");
  const departmentCards = document.getElementById("reportHubDepartmentCards");
  if (periodCards) periodCards.innerHTML = getReportHubPeriodCards().map(card => {
    const selected = period.selected === card.id;
    return `<button type="button" onclick="selectReportsHubPeriod('${card.id}')" style="text-align:left; border:1px solid ${selected ? "#0f9f95" : "#dbe6ed"}; background:${selected ? "linear-gradient(135deg,#e8fffa,#eef9ff)" : "#fff"}; border-radius:12px; padding:15px; cursor:pointer; box-shadow:${selected ? "0 8px 20px rgba(15,159,149,.14)" : "0 2px 6px rgba(15,23,42,.03)"}; transition:transform .2s ease,box-shadow .2s ease;" onmouseenter="this.style.transform='translateY(-3px)'" onmouseleave="this.style.transform='translateY(0)'"><div style="font-size:22px; margin-bottom:8px;">${card.icon}</div><div style="font-size:14px; font-weight:800; color:#0f172a;">${card.title}</div><div style="font-size:11px; color:#64748b; margin-top:4px;">${card.note}</div></button>`;
  }).join("");
  if (customDates) customDates.style.display = period.selected === "CUSTOM" ? "block" : "none";
  if (periodText) periodText.textContent = period.selected === "CUSTOM" && !period.from && !period.to ? "Choose the dates, then select a department." : `${period.label}${period.from ? ` • ${reportHubDisplayDate(period.from)}${period.to && period.to !== period.from ? ` to ${reportHubDisplayDate(period.to)}` : ""}` : ""}`;
  if (!departmentCards) return;
  const summaryData = reportsHubSummary?.summaries || {};
  departmentCards.innerHTML = getReportHubDepartments().map(department => {
    const summary = department.id === "ALL" ? (reportsHubSummary?.total || {}) : (summaryData[department.id] || {});
    const records = Number(summary.records || 0);
    const quantity = Number(summary.quantity || 0);
    const label = department.id === "ALL" ? "Combined operational data" : `${records.toLocaleString("en-IN")} record(s) in this period`;
    return `<button type="button" onclick="selectReportsHubDepartment('${escapeSalesHtml(department.id)}')" style="text-align:left; border:1px solid #dbe6ed; background:#fff; border-radius:12px; padding:15px; cursor:pointer; box-shadow:0 2px 6px rgba(15,23,42,.03); transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease;" onmouseenter="this.style.transform='translateY(-3px)';this.style.borderColor='#2eb7a5';this.style.boxShadow='0 10px 22px rgba(15,159,149,.12)'" onmouseleave="this.style.transform='translateY(0)';this.style.borderColor='#dbe6ed';this.style.boxShadow='0 2px 6px rgba(15,23,42,.03)'"><div style="display:flex; justify-content:space-between; gap:10px;"><span style="font-size:22px;">${reportHubDepartmentIcon(department.id)}</span><span style="font-size:12px; font-weight:800; color:#0f9f95;">${quantity ? quantity.toLocaleString("en-IN") : "View"}</span></div><div style="font-size:14px; font-weight:800; color:#0f172a; margin-top:9px;">${escapeSalesHtml(department.name)}</div><div style="font-size:11px; color:#64748b; margin-top:4px;">${escapeSalesHtml(label)}</div></button>`;
  }).join("") + `<button type="button" onclick="openReportsHubCustom()" style="text-align:left; border:1px dashed #0f9f95; background:linear-gradient(135deg,#f0fffa,#f4fbff); border-radius:12px; padding:15px; cursor:pointer; box-shadow:0 2px 6px rgba(15,23,42,.03);"><div style="display:flex; justify-content:space-between; gap:10px;"><span style="font-size:22px;">⚙️</span><span style="font-size:11px; font-weight:800; color:#0f9f95;">ADVANCED</span></div><div style="font-size:14px; font-weight:800; color:#0f172a; margin-top:9px;">Custom Report Builder</div><div style="font-size:11px; color:#64748b; margin-top:4px;">Combine departments and apply detailed filters</div></button>`;
}

window.selectReportsHubPeriod = async function(periodId) {
  const select = document.getElementById("reportHubPeriod");
  if (!select) return;
  select.value = periodId;
  reportsHubSummary = null;
  renderReportsHubLanding();
  await loadReportsHubSummary(true);
  renderReportsHubLanding();
};

window.selectReportsHubDepartment = async function(departmentId) {
  const department = document.getElementById("reportHubDepartment");
  const panel = document.getElementById("reportHubReportPanel");
  const exports = document.getElementById("reportHubExportActions");
  if (!department || !panel) return;
  department.value = departmentId;
  await ensureReportsHubDepartmentData(departmentId);
  populateReportsHubTypeSelect();
  document.getElementById("reportHubType").value = "SUMMARY";
  panel.style.display = "block";
  if (exports) exports.style.display = "flex";
  window.renderReportsHub();
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
};

window.openReportsHubCustom = async function() {
  await window.selectReportsHubDepartment("ALL");
  const type = document.getElementById("reportHubType");
  if (type) type.value = "DETAIL";
  const advanced = document.getElementById("reportHubAdvancedFilters");
  if (advanced) advanced.style.display = "block";
  window.renderReportsHub();
};

window.selectReportsHubType = function(type) {
  const select = document.getElementById("reportHubType");
  if (!select) return;
  select.value = type;
  window.renderReportsHub();
};

window.backToReportsHub = function() {
  const panel = document.getElementById("reportHubReportPanel");
  const exports = document.getElementById("reportHubExportActions");
  if (panel) panel.style.display = "none";
  if (exports) exports.style.display = "none";
  renderReportsHubLanding();
  document.getElementById("reportEasyBuilder")?.scrollIntoView({ behavior: "smooth", block: "start" });
};

window.toggleReportsHubAdvancedFilters = function() {
  const filters = document.getElementById("reportHubAdvancedFilters");
  if (filters) filters.style.display = filters.style.display === "block" ? "none" : "block";
};

window.renderReportsHub = function() {
  if (!document.getElementById("reportHubDepartment")) return;
  populateReportsHubControls();
  populateEasyReportBuilder();
  populateReportBuilderColumns();
  renderReportsHubLanding();
  const panel = document.getElementById("reportHubReportPanel");
  if (!panel || panel.style.display === "none") return;
  const result = getReportsHubResult();
  window.reportsHubLastResult = result;
  const { filters, rows, poRows } = result;
  const selectedDepartment = getReportHubDepartments().find(department => department.id === filters.department)?.name || filters.department.replace("CUSTOM:", "");
  const selectedType = getReportHubTypeOptions(filters.department).find(([id]) => id === filters.type)?.[1] || "Operations Summary";
  const breadcrumb = document.getElementById("reportHubBreadcrumb");
  const periodLabel = document.getElementById("reportHubPeriodLabel");
  const typeCards = document.getElementById("reportHubTypeCards");
  if (breadcrumb) breadcrumb.textContent = `${selectedDepartment} — ${selectedType}`;
  if (periodLabel) periodLabel.textContent = `${filters.label}${filters.from ? ` • ${reportHubDisplayDate(filters.from)}${filters.to && filters.to !== filters.from ? ` to ${reportHubDisplayDate(filters.to)}` : ""}` : ""} • Live data`;
  if (typeCards) typeCards.innerHTML = getReportHubTypeOptions(filters.department).map(([id, label]) => `<button type="button" onclick="selectReportsHubType('${id}')" style="border:1px solid ${filters.type === id ? "#0f9f95" : "#dbe6ed"}; background:${filters.type === id ? "#e8fffa" : "#fff"}; color:#0f172a; padding:8px 11px; border-radius:8px; font-size:12px; font-weight:800; cursor:pointer;">${escapeSalesHtml(label)}</button>`).join("");
  const packed = rows.filter(row => row.department === "PACKING").reduce((sum, row) => sum + Number(row.qty || 0), 0);
  const warehouse = rows.filter(row => row.department === "WAREHOUSE").reduce((sum, row) => sum + Number(row.qty || 0), 0);
  const dispatched = rows.filter(row => row.department === "DISPATCH" && row.status === "DISPATCHED").reduce((sum, row) => sum + Number(row.qty || 0), 0);
  const pending = [...rows, ...poRows].reduce((sum, row) => sum + Number(row.pendingQty || 0), 0);
  const kpis = document.getElementById("reportHubKpis");
  if (kpis) kpis.innerHTML = [
    reportHubKpi("Matching Records", rows.length.toLocaleString("en-IN"), "Filtered live activities"),
    reportHubKpi("Packed Modules", packed.toLocaleString("en-IN"), "Packing activity in period", "#087fb9"),
    reportHubKpi("Warehouse Stock", warehouse.toLocaleString("en-IN"), "Matching live pallets", "#7c3aed"),
    reportHubKpi("Dispatched Modules", dispatched.toLocaleString("en-IN"), "Shipment activity in period", "#059669"),
    reportHubKpi("Pending Quantity", pending.toLocaleString("en-IN"), "Open fulfilment requirement", "#b45309")
  ].join("");
  const insight = document.getElementById("reportHubInsight");
  if (insight) insight.innerHTML = `<div style="padding:12px 14px; border-left:4px solid var(--demosolar-teal); background:#f8fffc; border-radius:7px; font-size:12px; color:#334155;"><strong>Need one exact detail?</strong> Use the search bar for a PO, CO, pallet, serial, invoice, customer or transporter. More Filters is available only when needed.</div>`;
  renderReportsHubTable(result);
};

window.onReportsHubDepartmentChange = function() { window.renderReportsHub(); };
window.onReportsHubPeriodChange = function() { renderReportsHubLanding(); };

window.resetReportsHubFilters = function() {
  const setValue = (id, value) => { const element = document.getElementById(id); if (element) element.value = value; };
  ["reportHubKeyword", "reportHubReference", "reportHubProduct", "reportHubTransport", "reportHubFromTime", "reportHubToTime"].forEach(id => setValue(id, ""));
  setValue("reportHubStatus", "ALL");
  window.renderReportsHub();
};

window.openReportsHubView = async function(btnEl) {
  await switchView("reportsHub", btnEl, "REPORTS HUB");
  const panel = document.getElementById("reportHubReportPanel");
  const exports = document.getElementById("reportHubExportActions");
  if (panel) panel.style.display = "none";
  if (exports) exports.style.display = "none";
  renderReportsHubLanding();
  await loadReportsHubSummary();
  renderReportsHubLanding();
};

function getReportsHubExportContext() {
  const result = window.reportsHubLastResult || getReportsHubResult();
  const title = document.getElementById("reportBuilderTitle")?.value.trim() || "DemoSolar Industries Custom Report";
  return {
    result,
    title,
    columns: getReportBuilderColumns(),
    generatedBy: currentLoggedInUser?.name || currentLoggedInUser?.username || "SYSTEM",
    generatedAt: new Date().toLocaleString()
  };
}

function safeReportExportText(value, fallback = "-") {
  const text = reportHubText(value) || fallback;
  return text !== "-" && /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function getReportsHubPrintableHtml(context) {
  const { result, title, columns, generatedBy, generatedAt } = context;
  const value = input => escapeSalesHtml(reportHubText(input) || "-");
  const cellStyle = "border:1px solid #cbd5e1;padding:6px 7px;overflow-wrap:anywhere;vertical-align:middle;text-align:center;";
  return `<div class="report-export-document" style="box-sizing:border-box;font-family:Calibri,Arial,sans-serif;color:#0f172a;background:#fff;padding:10mm;width:100%;"><div style="display:flex;align-items:center;gap:16px;border-bottom:3px solid #0f9f95;padding-bottom:10px;margin-bottom:12px;"><img src="assets/demo-logo.svg" style="height:56px;width:150px;object-fit:contain;object-position:left center;"><div style="flex:1;"><div style="color:#64748b;font-size:8pt;font-weight:800;letter-spacing:1.2px;">DEMOSOLAR INDUSTRIES PRIVATE LIMITED</div><h2 style="margin:3px 0;color:#087fb9;font-size:18pt;">${value(title)}</h2><div style="font-size:9pt;font-weight:700;">${value(result.filters.label)}</div></div><div style="text-align:right;font-size:8pt;color:#475569;line-height:1.5;"><strong>${result.rows.length.toLocaleString("en-IN")} records</strong><br>${value(generatedAt)}<br>By ${value(generatedBy)}</div></div><table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:7.5pt;"><thead><tr style="background:#0f9f95;color:#fff;"><th style="${cellStyle};width:28px;">#</th>${columns.map(([, label]) => `<th style="${cellStyle}">${value(label)}</th>`).join("")}</tr></thead><tbody>${result.rows.map((row, index) => `<tr style="background:${index % 2 ? "#f8fafc" : "#ffffff"};"><td style="${cellStyle};text-align:center;">${index + 1}</td>${columns.map(([key]) => `<td style="${cellStyle}">${value(reportBuilderValue(row, key))}</td>`).join("")}</tr>`).join("")}</tbody></table><div style="margin-top:9px;padding-top:6px;border-top:1px solid #cbd5e1;font-size:7pt;color:#64748b;text-align:right;">Generated by DemoSolar Industries ERP</div></div>`;
}

window.exportReportsHubExcel = async function() {
  const context = getReportsHubExportContext();
  const { result, title, columns, generatedBy, generatedAt } = context;
  if (!result.rows.length) {
    window.showNotification({ title: "No Report Data", message: "Run a report with matching records before exporting.", type: "warning" });
    return;
  }
  if (!window.ExcelJS) {
    window.showNotification({ title: "Excel Export Unavailable", message: "Refresh the page so the Excel library can load, then try again.", type: "error" });
    return;
  }

  try {
    const workbook = new window.ExcelJS.Workbook();
    workbook.creator = "DemoSolar Industries ERP";
    workbook.created = new Date();
    workbook.subject = title;
    const sheet = workbook.addWorksheet("Report", { views: [{ state: "frozen", ySplit: 6, showGridLines: false }] });
    const columnCount = columns.length + 1;
    const lastColumn = sheet.getColumn(columnCount).letter;

    // Keep a large, dedicated A:C brand block exactly like the approved
    // spreadsheet layout, with all report information beginning at D.
    const headingStartColumn = "D";
    const headingEndColumn = columnCount >= 4 ? lastColumn : "D";
    sheet.mergeCells("A1:C4");
    [1, 2, 3, 4].forEach(rowNumber => {
      if (headingStartColumn !== headingEndColumn) sheet.mergeCells(`${headingStartColumn}${rowNumber}:${headingEndColumn}${rowNumber}`);
    });
    sheet.getRow(1).height = 28;
    sheet.getRow(2).height = 36;
    sheet.getRow(3).height = 24;
    sheet.getRow(4).height = 24;
    sheet.getRow(5).height = 8;

    const logoDataUrl = await getEmbeddedExcelLogo();
    const logoId = workbook.addImage({ base64: logoDataUrl, extension: "png" });
    // Use a fixed image size so Excel cannot expand the logo over the title.
    // It remains anchored inside the merged logo block on the left.
    sheet.addImage(logoId, {
      tl: { col: 0.15, row: 0.18 },
      ext: { width: 300, height: 112 },
      editAs: "oneCell"
    });

    sheet.getCell(`${headingStartColumn}1`).value = "DEMOSOLAR INDUSTRIES PRIVATE LIMITED";
    sheet.getCell(`${headingStartColumn}1`).font = { name: "Calibri", size: 12, bold: true, color: { argb: "FF64748B" } };
    sheet.getCell(`${headingStartColumn}2`).value = safeReportExportText(title);
    sheet.getCell(`${headingStartColumn}2`).font = { name: "Calibri", size: 19, bold: true, color: { argb: "FF087FB9" } };
    sheet.getCell(`${headingStartColumn}3`).value = `Period: ${safeReportExportText(result.filters.label)}  |  Records: ${result.rows.length.toLocaleString("en-IN")}`;
    sheet.getCell(`${headingStartColumn}3`).font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF0F766E" } };
    sheet.getCell(`${headingStartColumn}4`).value = `Generated: ${generatedAt}  |  Generated by: ${safeReportExportText(generatedBy)}`;
    sheet.getCell(`${headingStartColumn}4`).font = { name: "Calibri", size: 9, color: { argb: "FF475569" } };
    [1, 2, 3, 4].forEach(rowNumber => { sheet.getCell(`${headingStartColumn}${rowNumber}`).alignment = { vertical: "middle", horizontal: "center", wrapText: true }; });

    const headerRow = sheet.getRow(6);
    headerRow.values = ["#", ...columns.map(([, label]) => label)];
    headerRow.height = 30;
    headerRow.eachCell(cell => {
      cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F9F95" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = { top: { style: "thin", color: { argb: "FFCBD5E1" } }, left: { style: "thin", color: { argb: "FFCBD5E1" } }, bottom: { style: "thin", color: { argb: "FFCBD5E1" } }, right: { style: "thin", color: { argb: "FFCBD5E1" } } };
    });

    result.rows.forEach((record, index) => {
      const row = sheet.addRow([index + 1, ...columns.map(([key]) => safeReportExportText(reportBuilderValue(record, key)))]);
      const longestLine = Math.max(...row.values.slice(1).map(value => String(value || "").length), 1);
      row.height = longestLine > 60 ? 38 : longestLine > 32 ? 30 : 22;
      row.eachCell((cell, columnNumber) => {
        cell.font = { name: "Calibri", size: 10, color: { argb: "FF0F172A" } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: index % 2 ? "FFF1F5F9" : "FFFFFFFF" } };
        cell.border = { top: { style: "thin", color: { argb: "FFE2E8F0" } }, left: { style: "thin", color: { argb: "FFE2E8F0" } }, bottom: { style: "thin", color: { argb: "FFE2E8F0" } }, right: { style: "thin", color: { argb: "FFE2E8F0" } } };
      });
    });

    sheet.getColumn(1).width = 7;
    columns.forEach(([key, label], index) => {
      const longest = Math.max(label.length, ...result.rows.map(row => reportHubText(reportBuilderValue(row, key)).length));
      const preferredMinimum = index < 2 ? 18 : (["details", "customer", "model", "transporter"].includes(key) ? 20 : 12);
      sheet.getColumn(index + 2).width = Math.min(42, Math.max(preferredMinimum, longest + 3));
    });
    sheet.autoFilter = { from: "A6", to: `${lastColumn}${Math.max(6, result.rows.length + 6)}` };
    sheet.pageSetup = { orientation: columnCount > 7 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
    sheet.pageSetup.printArea = `A1:${lastColumn}${Math.max(6, result.rows.length + 6)}`;
    sheet.headerFooter.oddFooter = "DemoSolar Industries ERP  |  Page &P of &N";

    const buffer = await workbook.xlsx.writeBuffer();
    const safeTitle = title.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "DemoSolar_Report";
    downloadXlsxBuffer(buffer, `${safeTitle}_${Date.now()}.xlsx`);
    logEvent("SYSTEM", "REPORT_HUB_EXPORTED", `Exported ${result.rows.length} ${result.filters.label} report record(s) to Excel.`);
  } catch (error) {
    console.error("Reports Hub Excel export error:", error);
    window.showNotification({ title: "Excel Export Failed", message: error.message || "The workbook could not be generated.", type: "error" });
  }
};

window.printReportsHub = function() {
  const context = getReportsHubExportContext();
  if (!context.result.rows.length) {
    window.showNotification({ title: "No Report Data", message: "Run a report with matching records before printing.", type: "warning" });
    return;
  }
  const area = document.getElementById("printableReportArea");
  if (!area) return;
  area.innerHTML = getReportsHubPrintableHtml(context);
  area.style.display = "block";
  window.print();
  setTimeout(() => { area.style.display = "none"; area.innerHTML = ""; }, 600);
};

window.exportReportsHubPdf = async function() {
  const context = getReportsHubExportContext();
  if (!context.result.rows.length) {
    window.showNotification({ title: "No Report Data", message: "Run a report with matching records before exporting.", type: "warning" });
    return;
  }
  const area = document.getElementById("printableReportArea");
  if (!area || !window.html2canvas || !window.jspdf?.jsPDF) return;
  area.innerHTML = getReportsHubPrintableHtml(context);
  area.style.cssText = "display:block;position:absolute;left:-10000px;top:0;width:1120px;background:#fff;z-index:-1;";
  try {
    const images = area.querySelectorAll("img");
    await Promise.all([...images].map(image => image.complete ? Promise.resolve() : new Promise(resolve => { image.onload = resolve; image.onerror = resolve; })));
    const canvas = await window.html2canvas(area, { scale: 1.6, useCORS: true, backgroundColor: "#ffffff", logging: false });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("l", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 7;
    const imageWidth = pageWidth - margin * 2;
    const imageHeight = canvas.height * imageWidth / canvas.width;
    const usableHeight = pageHeight - margin * 2;
    const imageData = canvas.toDataURL("image/jpeg", 0.94);
    let offset = 0;
    let page = 0;
    while (offset < imageHeight) {
      if (page > 0) pdf.addPage();
      pdf.addImage(imageData, "JPEG", margin, margin - offset, imageWidth, imageHeight, undefined, "FAST");
      offset += usableHeight;
      page += 1;
    }
    const safeTitle = context.title.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "DemoSolar_Report";
    pdf.save(`${safeTitle}_${Date.now()}.pdf`);
    logEvent("SYSTEM", "REPORT_HUB_PDF_EXPORTED", `Exported ${context.result.rows.length} report record(s) to PDF.`);
  } catch (error) {
    console.error("Reports Hub PDF export error:", error);
    window.showNotification({ title: "PDF Export Failed", message: error.message || "The PDF could not be generated.", type: "error" });
  } finally {
    area.style.display = "none";
    area.removeAttribute("style");
    area.style.display = "none";
    area.innerHTML = "";
  }
};

function populateProductDropdowns() {
  const sel = document.getElementById("createPoProduct");
  if (!sel) return;
  if (productsDb.length === 0) { sel.innerHTML = `<option value="">-- No Products in Master Catalog --</option>`; return; }
  sel.innerHTML = poProductOptionsHtml();
}

function populatePoDropdowns() {
  const dPo = document.getElementById("dPoSelect");
  if (dPo) {
    if (poDatabase.length === 0) dPo.innerHTML = `<option value="">-- No POs Created --</option>`;
    else dPo.innerHTML = `<option value="">-- Select PO --</option>` + poDatabase.map(p => `<option value="${p.poNumber}">${p.poNumber} (${p.product})</option>`).join("");
  }
  populateScanStationPoDropdown();
}

function escapeSalesHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[char]));
}

function salesNumber(value) {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function salesCoKey(value) {
  return String(value || "").trim().toUpperCase();
}

function getSalesMonthYear() {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
}

window.formatSalesMonthYear = function(input) {
  if (!input) return;
  const digits = String(input.value || "").replace(/\D/g, "").slice(0, 6);
  input.value = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
};

window.formatSalesOrderDate = function(input) {
  if (!input) return;
  const digits = String(input.value || "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) input.value = digits;
  else if (digits.length <= 4) input.value = `${digits.slice(0, 2)}/${digits.slice(2)}`;
  else input.value = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

function isValidSalesMonthYear(value) {
  const match = String(value || "").match(/^(0[1-9]|1[0-2])\/(\d{4})$/);
  return Boolean(match);
}

function isValidSalesOrderDate(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return false;
  const [, day, month, year] = match.map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function getApprovedDeletedSalesOrderIds(requests = requestsDb) {
  return new Set((Array.isArray(requests) ? requests : [])
    .filter(request =>
      request?.type === "DELETE_SALES_ORDER" &&
      String(request.status || "").trim().toUpperCase() === "APPROVED"
    )
    .map(request => String(request.payload?.salesOrderId || "").trim())
    .filter(Boolean));
}

function removeApprovedDeletedSalesOrderGhosts(orders = salesOrders, requests = requestsDb) {
  const deletedIds = getApprovedDeletedSalesOrderIds(requests);
  if (!deletedIds.size) return Array.isArray(orders) ? orders : [];
  return (Array.isArray(orders) ? orders : []).filter(order =>
    !deletedIds.has(String(order?.id || "").trim())
  );
}

function getSalesOrderByCo(coNumber) {
  const key = salesCoKey(coNumber);
  if (!key) return null;
  // Only an order still present in the live Sales Order collection reserves a CO.
  // Approved deletion requests also act as tombstones in case stale live-sync
  // data temporarily returns the previously deleted record.
  return removeApprovedDeletedSalesOrderGhosts(salesOrders, requestsDb)
    .find(order => salesCoKey(order.coNumber) === key) || null;
}

function getSalesOrderDispatchStats(coNumber) {
  const key = salesCoKey(coNumber);
  const manifests = (dispatchArchive || []).filter(manifest => salesCoKey(manifest.coNumber) === key);
  return {
    qty: manifests.reduce((total, manifest) => total + salesNumber(manifest.dispatchedQty), 0),
    actualDispatchDate: manifests.length ? (manifests[0].date || "") : ""
  };
}

async function syncSalesOrderDispatchTotals() {
  let changed = false;
  salesOrders.forEach(order => {
    const stats = getSalesOrderDispatchStats(order.coNumber);
    const totalQty = salesNumber(order.totalOrderQty);
    const pendingQty = Math.max(0, totalQty - stats.qty);
    const certificate = Array.isArray(order.performanceCertificate)
      ? order.performanceCertificate.filter(Boolean).join(", ")
      : String(order.performanceCertificate || "").trim();
    const status = pendingQty === 0
      ? (certificate ? "CLOSED" : "AWAITING CERTIFICATE")
      : (stats.qty <= 0 ? "PENDING" : "PARTIALLY DISPATCHED");
    const closedAt = status === "CLOSED" ? (order.closedAt || new Date().toLocaleString()) : "";
    if (salesNumber(order.dispatchQty) !== stats.qty || salesNumber(order.pendingQty) !== pendingQty || order.actualDispatchDate !== stats.actualDispatchDate || order.status !== status || String(order.closedAt || "") !== closedAt) {
      order.dispatchQty = stats.qty;
      order.pendingQty = pendingQty;
      order.actualDispatchDate = stats.actualDispatchDate;
      order.status = status;
      order.closedAt = closedAt;
      changed = true;
    }
  });
  if (changed) await saveStorage(KEY_SALES_ORDERS, salesOrders);
  return changed;
}

function customerMasterKey(value) {
  return String(value || "").trim().toUpperCase();
}

function formatCustomerMasterAddress(customer) {
  if (!customer) return "";
  const structured = [customer.addressLine1, customer.addressLine2, customer.taluka, customer.district, customer.state, customer.pincode]
    .map(part => String(part || "").trim())
    .filter(Boolean);
  return structured.length ? structured.join(", ") : String(customer.address || "").trim();
}

function populateSalesCustomerDropdown() {
  const select = document.getElementById("salesCustomerSelect");
  if (!select) return;
  const current = String(select.value || "");
  const customers = Array.isArray(customersDb) ? customersDb : [];
  select.innerHTML = `<option value="">${customers.length ? "-- Select Customer from Master --" : "-- Add Customer in Customer Master First --"}</option>` + customers.map(customer =>
    `<option value="${escapeSalesHtml(customer.id)}">${escapeSalesHtml(customer.name)} — ${escapeSalesHtml(customer.gst)}</option>`
  ).join("");
  if (customers.some(customer => String(customer.id) === current)) select.value = current;
}

window.handleSalesCustomerChange = function() {
  const id = String(document.getElementById("salesCustomerSelect")?.value || "");
  const customer = (Array.isArray(customersDb) ? customersDb : []).find(item => String(item.id) === id);
  const values = customer ? {
    salesCustomerName: customer.name,
    salesContactPerson: customer.person,
    salesContactNumber: customer.phone,
    salesEmailId: customer.email,
    salesCustomerGst: customer.gst,
    salesCustomerPan: customer.pan,
    salesCustomerAddress: formatCustomerMasterAddress(customer)
  } : {
    salesCustomerName: "", salesContactPerson: "", salesContactNumber: "", salesEmailId: "", salesCustomerGst: "", salesCustomerPan: "", salesCustomerAddress: ""
  };
  Object.entries(values).forEach(([field, value]) => {
    const element = document.getElementById(field);
    if (element) element.value = value || "";
  });
};

let purchaseLocationData = null;
let purchaseLocationPromise = null;
const purchaseLocationSelection = {
  factory: { countryCode: "", stateName: "", districtName: "" },
  office: { countryCode: "", stateName: "", districtName: "" }
};

function purchaseLocationKey(value) {
  return String(value || "").trim().toLocaleLowerCase("en-IN");
}

function purchaseLocationMatch(items, value) {
  const key = purchaseLocationKey(value);
  return (Array.isArray(items) ? items : []).find(item => purchaseLocationKey(item?.name ?? item) === key) || null;
}

function purchaseIndiaDistrictMap(data, stateName) {
  const india = data?.india || {};
  const matchingState = Object.keys(india).find(name => purchaseLocationKey(name) === purchaseLocationKey(stateName));
  return matchingState ? (india[matchingState] || {}) : {};
}

const purchaseLocationLevels = {
  factoryCountry: { context: "factory", level: "country", input: "purchaseVendorFactoryCountry", wrapper: "purchaseVendorFactoryCountryCombobox", toggle: "purchaseVendorFactoryCountryToggle", options: "purchaseVendorFactoryCountryOptions" },
  factoryState: { context: "factory", level: "state", input: "purchaseVendorFactoryState", wrapper: "purchaseVendorFactoryStateCombobox", toggle: "purchaseVendorFactoryStateToggle", options: "purchaseVendorFactoryStateOptions" },
  factoryDistrict: { context: "factory", level: "district", input: "purchaseVendorFactoryDistrict", wrapper: "purchaseVendorFactoryDistrictCombobox", toggle: "purchaseVendorFactoryDistrictToggle", options: "purchaseVendorFactoryDistrictOptions" },
  officeCountry: { context: "office", level: "country", input: "purchaseVendorOfficeCountry", wrapper: "purchaseVendorOfficeCountryCombobox", toggle: "purchaseVendorOfficeCountryToggle", options: "purchaseVendorOfficeCountryOptions" },
  officeState: { context: "office", level: "state", input: "purchaseVendorOfficeState", wrapper: "purchaseVendorOfficeStateCombobox", toggle: "purchaseVendorOfficeStateToggle", options: "purchaseVendorOfficeStateOptions" },
  officeDistrict: { context: "office", level: "district", input: "purchaseVendorOfficeDistrict", wrapper: "purchaseVendorOfficeDistrictCombobox", toggle: "purchaseVendorOfficeDistrictToggle", options: "purchaseVendorOfficeDistrictOptions" }
};
const purchaseLocationChoices = Object.fromEntries(Object.keys(purchaseLocationLevels).map(key => [key, []]));

function purchaseLocationLevelFromOptionsId(id) {
  return Object.keys(purchaseLocationLevels).find(level => purchaseLocationLevels[level].options === id) || "";
}

function closePurchaseLocationDropdowns(exceptLevel = "") {
  Object.entries(purchaseLocationLevels).forEach(([level, config]) => {
    if (level === exceptLevel) return;
    document.getElementById(config.wrapper)?.classList.remove("open");
    document.getElementById(config.input)?.setAttribute("aria-expanded", "false");
  });
}

function renderPurchaseLocationOptions(level) {
  const config = purchaseLocationLevels[level];
  if (!config) return;
  const list = document.getElementById(config.options);
  const input = document.getElementById(config.input);
  if (!list || !input) return;
  const query = purchaseLocationKey(input.value);
  const matches = (purchaseLocationChoices[level] || []).filter(value => !query || purchaseLocationKey(value).includes(query));
  list.replaceChildren();
  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "account-co-empty";
    empty.textContent = query ? "No matching option. Continue typing only where manual entry is allowed." : "No options available.";
    list.appendChild(empty);
    return;
  }
  matches.forEach(value => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "account-co-option";
    button.setAttribute("role", "option");
    button.textContent = value;
    button.addEventListener("click", () => window.selectPurchaseLocationOption(level, value));
    list.appendChild(button);
  });
}

function populatePurchaseLocationOptions(id, values) {
  const level = purchaseLocationLevelFromOptionsId(id);
  if (!level) return;
  purchaseLocationChoices[level] = [...new Set((Array.isArray(values) ? values : []).map(item => String(item?.name ?? item).trim()).filter(Boolean))];
  renderPurchaseLocationOptions(level);
}

function setPurchaseLocationEnabled(level, enabled, placeholder) {
  const config = purchaseLocationLevels[level];
  if (!config) return;
  const input = document.getElementById(config.input);
  const toggle = document.getElementById(config.toggle);
  if (input) {
    input.disabled = !enabled;
    if (placeholder) input.placeholder = placeholder;
    if (!enabled) input.setAttribute("aria-expanded", "false");
  }
  if (toggle) toggle.disabled = !enabled;
  if (!enabled) document.getElementById(config.wrapper)?.classList.remove("open");
}

function setPurchaseCityEnabled(context, enabled) {
  const city = document.getElementById(context === "office" ? "purchaseVendorOfficeCity" : "purchaseVendorFactoryCity");
  if (!city) return;
  city.disabled = !enabled;
  city.placeholder = enabled ? "Type city manually" : "Select district first";
  if (!enabled) city.value = "";
}

window.openPurchaseLocationDropdown = function(level) {
  const config = purchaseLocationLevels[level];
  const input = config ? document.getElementById(config.input) : null;
  if (!config || !input || input.disabled) return;
  closePurchaseLocationDropdowns(level);
  renderPurchaseLocationOptions(level);
  document.getElementById(config.wrapper)?.classList.add("open");
  input.setAttribute("aria-expanded", "true");
};

window.togglePurchaseLocationDropdown = function(level) {
  const config = purchaseLocationLevels[level];
  const input = config ? document.getElementById(config.input) : null;
  const wrapper = config ? document.getElementById(config.wrapper) : null;
  if (!input || !wrapper || input.disabled) return;
  if (wrapper.classList.contains("open")) {
    wrapper.classList.remove("open");
    input.setAttribute("aria-expanded", "false");
  } else {
    window.openPurchaseLocationDropdown(level);
    input.focus();
  }
};

window.handlePurchaseLocationInput = function(level) {
  renderPurchaseLocationOptions(level);
  window.openPurchaseLocationDropdown(level);
  window.handlePurchaseVendorLocationChange(level);
};

window.handlePurchaseLocationKeydown = function(event, level) {
  if (event.key === "Escape") {
    closePurchaseLocationDropdowns();
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    window.openPurchaseLocationDropdown(level);
    document.getElementById(purchaseLocationLevels[level]?.options)?.querySelector("button")?.focus();
    return;
  }
  if (event.key === "Enter") {
    const first = document.getElementById(purchaseLocationLevels[level]?.options)?.querySelector("button");
    if (first) { event.preventDefault(); first.click(); }
  }
};

window.selectPurchaseLocationOption = async function(level, value) {
  const config = purchaseLocationLevels[level];
  const input = config ? document.getElementById(config.input) : null;
  if (!input) return;
  input.value = value;
  document.getElementById(config.wrapper)?.classList.remove("open");
  input.setAttribute("aria-expanded", "false");
  await window.handlePurchaseVendorLocationChange(level);
  const configLevel = purchaseLocationLevels[level];
  const next = configLevel?.level === "country" ? `${configLevel.context}State` : (configLevel?.level === "state" ? `${configLevel.context}District` : "");
  if (next) document.getElementById(purchaseLocationLevels[next].input)?.focus();
  else if (configLevel?.level === "district") document.getElementById(configLevel.context === "office" ? "purchaseVendorOfficeCity" : "purchaseVendorFactoryCity")?.focus();
};

async function ensurePurchaseVendorLocations() {
  if (purchaseLocationData) return purchaseLocationData;
  if (!purchaseLocationPromise) {
    purchaseLocationPromise = fetch("assets/vendor-locations.json", { cache: "force-cache" })
      .then(response => {
        if (!response.ok) throw new Error("Location directory could not be loaded.");
        return response.json();
      })
      .then(data => {
        purchaseLocationData = data;
        populatePurchaseLocationOptions("purchaseVendorFactoryCountryOptions", data.countries || []);
        populatePurchaseLocationOptions("purchaseVendorOfficeCountryOptions", data.countries || []);
        return data;
      })
      .catch(error => {
        purchaseLocationPromise = null;
        console.error("Purchase location directory error:", error);
        window.showNotification({ title: "Location List Unavailable", message: "The local location directory could not be loaded. Refresh the page and try again.", type: "danger" });
        throw error;
      });
  }
  return purchaseLocationPromise;
}

async function initializePurchaseVendorLocation() {
  const data = await ensurePurchaseVendorLocations();
  for (const context of ["factory", "office"]) {
    purchaseLocationSelection[context] = { countryCode: "", stateName: "", districtName: "" };
    populatePurchaseLocationOptions(`purchaseVendor${context === "office" ? "Office" : "Factory"}CountryOptions`, data.countries || []);
    populatePurchaseLocationOptions(`purchaseVendor${context === "office" ? "Office" : "Factory"}StateOptions`, []);
    populatePurchaseLocationOptions(`purchaseVendor${context === "office" ? "Office" : "Factory"}DistrictOptions`, []);
    setPurchaseLocationEnabled(`${context}Country`, true, "Type or select country");
    setPurchaseLocationEnabled(`${context}State`, false, "Select country first");
    setPurchaseLocationEnabled(`${context}District`, false, "Select state first");
    setPurchaseCityEnabled(context, false);
  }
}

window.handlePurchaseVendorLocationChange = async function(key) {
  const config = purchaseLocationLevels[key];
  if (!config) return;
  const data = await ensurePurchaseVendorLocations();
  const selection = purchaseLocationSelection[config.context];
  const input = document.getElementById(config.input);
  const value = String(input?.value || "").trim();
  const prefix = config.context === "office" ? "Office" : "Factory";
  if (config.level === "country") {
    const country = purchaseLocationMatch(data.countries, value);
    const nextCode = country?.code || "";
    if (nextCode === selection.countryCode) return;
    selection.countryCode = nextCode; selection.stateName = ""; selection.districtName = "";
    ["State", "District", "City"].forEach(name => { const field = document.getElementById(`purchaseVendor${prefix}${name}`); if (field) field.value = ""; });
    const states = nextCode ? (data.states?.[nextCode] || []) : [];
    populatePurchaseLocationOptions(`purchaseVendor${prefix}StateOptions`, states);
    populatePurchaseLocationOptions(`purchaseVendor${prefix}DistrictOptions`, []);
    setPurchaseLocationEnabled(`${config.context}State`, Boolean(nextCode), nextCode ? (states.length ? "Type or select state / province" : "Type state / province manually") : "Select country first");
    setPurchaseLocationEnabled(`${config.context}District`, false, "Select state first");
    setPurchaseCityEnabled(config.context, false);
    return;
  }
  if (config.level === "state") {
    const states = data.states?.[selection.countryCode] || [];
    const state = purchaseLocationMatch(states, value);
    const nextState = state?.name || (!states.length ? value : "");
    if (nextState === selection.stateName) return;
    selection.stateName = nextState; selection.districtName = "";
    ["District", "City"].forEach(name => { const field = document.getElementById(`purchaseVendor${prefix}${name}`); if (field) field.value = ""; });
    const districtMap = selection.countryCode === "IN" && nextState ? purchaseIndiaDistrictMap(data, nextState) : {};
    const districts = Object.keys(districtMap).sort((a, b) => a.localeCompare(b, "en-IN"));
    populatePurchaseLocationOptions(`purchaseVendor${prefix}DistrictOptions`, districts);
    setPurchaseLocationEnabled(`${config.context}District`, Boolean(nextState), nextState ? (districts.length ? "Type or select district" : "Type district / county manually") : "Select state first");
    setPurchaseCityEnabled(config.context, false);
    return;
  }
  const districtMap = purchaseIndiaDistrictMap(data, selection.stateName);
  const matchedDistrict = Object.keys(districtMap).find(name => purchaseLocationKey(name) === purchaseLocationKey(value)) || "";
  const nextDistrict = selection.countryCode === "IN" ? matchedDistrict : value;
  if (nextDistrict === selection.districtName) return;
  selection.districtName = nextDistrict;
  setPurchaseCityEnabled(config.context, Boolean(nextDistrict));
};

document.addEventListener("pointerdown", event => {
  if (!event.target.closest(".purchase-location-combobox")) closePurchaseLocationDropdowns();
});

function normalizePurchaseVendorType(value) {
  const type = String(value || "").trim().toUpperCase();
  return type === "DOMESTIC" || type === "IMPORT" ? type : "";
}

function nextPurchaseVendorCode(vendorType = document.getElementById("purchaseVendorType")?.value) {
  const type = normalizePurchaseVendorType(vendorType);
  if (!type) return "";
  const prefix = type === "IMPORT" ? "VI" : "VD";
  const highest = (Array.isArray(purchaseVendorsDb) ? purchaseVendorsDb : []).reduce((maximum, vendor) => {
    const match = String(vendor?.vendorCode || "").toUpperCase().match(new RegExp(`^${prefix}(\\d+)$`));
    if (!match) return maximum;
    return Math.max(maximum, Number(match[1]));
  }, 1000);
  return `${prefix}${highest + 1}`;
}

window.handlePurchaseVendorTypeChange = function() {
  const code = document.getElementById("purchaseVendorCode");
  if (code) code.value = nextPurchaseVendorCode();
};

function resetPurchaseVendorForm() {
  ["purchaseVendorName", "purchaseVendorGst", "purchaseVendorPan", "purchaseVendorFactoryAddress1", "purchaseVendorFactoryAddress2", "purchaseVendorFactoryCountry", "purchaseVendorFactoryState", "purchaseVendorFactoryDistrict", "purchaseVendorFactoryCity", "purchaseVendorOfficeAddress1", "purchaseVendorOfficeAddress2", "purchaseVendorOfficeCountry", "purchaseVendorOfficeState", "purchaseVendorOfficeDistrict", "purchaseVendorOfficeCity", "purchaseVendorBankName", "purchaseVendorAccountNumber", "purchaseVendorIfsc", "purchaseVendorEmail", "purchaseVendorContactPerson", "purchaseVendorContactNumber"].forEach(id => {
    const field = document.getElementById(id);
    if (field) field.value = "";
  });
  const type = document.getElementById("purchaseVendorType");
  if (type) type.value = "DOMESTIC";
  const code = document.getElementById("purchaseVendorCode");
  if (code) code.value = nextPurchaseVendorCode();
  purchaseLocationSelection.factory = { countryCode: "", stateName: "", districtName: "" };
  purchaseLocationSelection.office = { countryCode: "", stateName: "", districtName: "" };
  initializePurchaseVendorLocation().catch(() => {});
}

window.normalizePurchaseVendorCodeField = function(id, maximum) {
  const field = document.getElementById(id);
  if (field) field.value = String(field.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, maximum);
};

window.savePurchaseVendor = async function() {
  const value = id => String(document.getElementById(id)?.value || "").trim();
  const vendorType = normalizePurchaseVendorType(value("purchaseVendorType"));
  const vendorCode = nextPurchaseVendorCode(vendorType);
  const record = {
    id: `VENDOR-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    vendorCode,
    vendorType,
    name: value("purchaseVendorName").toUpperCase(),
    gst: value("purchaseVendorGst").toUpperCase().replace(/[^A-Z0-9]/g, ""),
    pan: value("purchaseVendorPan").toUpperCase().replace(/[^A-Z0-9]/g, ""),
    factoryAddressLine1: value("purchaseVendorFactoryAddress1"),
    factoryAddressLine2: value("purchaseVendorFactoryAddress2"),
    factoryCountry: value("purchaseVendorFactoryCountry"),
    factoryState: value("purchaseVendorFactoryState"),
    factoryDistrict: value("purchaseVendorFactoryDistrict"),
    factoryCity: value("purchaseVendorFactoryCity"),
    officeAddressLine1: value("purchaseVendorOfficeAddress1"),
    officeAddressLine2: value("purchaseVendorOfficeAddress2"),
    officeCountry: value("purchaseVendorOfficeCountry"),
    officeState: value("purchaseVendorOfficeState"),
    officeDistrict: value("purchaseVendorOfficeDistrict"),
    officeCity: value("purchaseVendorOfficeCity"),
    bankName: value("purchaseVendorBankName"),
    accountNumber: value("purchaseVendorAccountNumber").replace(/\s+/g, ""),
    ifsc: value("purchaseVendorIfsc").toUpperCase().replace(/[^A-Z0-9]/g, ""),
    email: value("purchaseVendorEmail").toLowerCase(),
    contactPerson: value("purchaseVendorContactPerson"),
    contactNumber: value("purchaseVendorContactNumber").replace(/[\s()-]/g, ""),
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
    createdBy: currentLoggedInUser?.username || "SYSTEM"
  };
  const required = {
    "Vendor Type": record.vendorType, "Vendor Name": record.name, "Vendor GST": record.gst, "Vendor PAN": record.pan,
    "Factory Address Line 1": record.factoryAddressLine1, "Factory Country": record.factoryCountry,
    "Factory State": record.factoryState, "Factory District": record.factoryDistrict, "Factory City": record.factoryCity,
    "Office Address Line 1": record.officeAddressLine1, "Office Country": record.officeCountry,
    "Office State": record.officeState, "Office District": record.officeDistrict, "Office City": record.officeCity,
    "Bank Name": record.bankName, "Account Number": record.accountNumber,
    "IFSC Code": record.ifsc, "Email ID": record.email, "Contact Person": record.contactPerson,
    "Contact Person Number": record.contactNumber
  };
  const missing = Object.entries(required).filter(([, entry]) => !entry).map(([label]) => label);
  if (missing.length) {
    window.showNotification({ title: "Vendor Details Required", message: `Complete: ${missing.join(", ")}.`, type: "warning" });
    return;
  }
  const locationData = await ensurePurchaseVendorLocations().catch(() => null);
  for (const context of ["factory", "office"]) {
    const label = context === "factory" ? "Factory" : "Office";
    const countryField = `${context}Country`, stateField = `${context}State`, districtField = `${context}District`;
    const selectedCountry = purchaseLocationMatch(locationData?.countries || [], record[countryField]);
    if (!selectedCountry) {
      window.showNotification({ title: `Select ${label} Country`, message: `Choose the ${label.toLowerCase()} country from the searchable list.`, type: "warning" });
      return;
    }
    const availableStates = locationData?.states?.[selectedCountry.code] || [];
    const selectedState = purchaseLocationMatch(availableStates, record[stateField]);
    if (availableStates.length && !selectedState) {
      window.showNotification({ title: `Select ${label} State`, message: `Choose the ${label.toLowerCase()} state or province from the list.`, type: "warning" });
      return;
    }
    record[countryField] = selectedCountry.name;
    if (selectedState) record[stateField] = selectedState.name;
    if (selectedCountry.code === "IN") {
      const districtMap = purchaseIndiaDistrictMap(locationData, selectedState?.name);
      const selectedDistrict = Object.keys(districtMap).find(name => purchaseLocationKey(name) === purchaseLocationKey(record[districtField]));
      if (!selectedDistrict) {
        window.showNotification({ title: `Select ${label} District`, message: `Choose the ${label.toLowerCase()} district from the selected Indian state.`, type: "warning" });
        return;
      }
      record[districtField] = selectedDistrict;
    }
  }
  // Compatibility aliases keep older reports readable while the complete dual addresses remain authoritative.
  Object.assign(record, { addressLine1: record.factoryAddressLine1, addressLine2: record.factoryAddressLine2, country: record.factoryCountry, state: record.factoryState, district: record.factoryDistrict, city: record.factoryCity });
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(record.gst)) {
    window.showNotification({ title: "Invalid GST Number", message: "Enter a valid 15-character GSTIN.", type: "warning" });
    return;
  }
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(record.pan)) {
    window.showNotification({ title: "Invalid PAN Number", message: "Enter a valid 10-character PAN.", type: "warning" });
    return;
  }
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(record.ifsc)) {
    window.showNotification({ title: "Invalid IFSC Code", message: "Enter a valid 11-character bank IFSC code.", type: "warning" });
    return;
  }
  if (!/^\S+@\S+\.\S+$/.test(record.email)) {
    window.showNotification({ title: "Invalid Email ID", message: "Enter a valid vendor email address.", type: "warning" });
    return;
  }
  if (!/^\+?\d{10,15}$/.test(record.contactNumber)) {
    window.showNotification({ title: "Invalid Contact Number", message: "Enter a valid 10 to 15 digit contact number.", type: "warning" });
    return;
  }
  if (!/^[A-Z0-9]{6,34}$/i.test(record.accountNumber)) {
    window.showNotification({ title: "Invalid Account Number", message: "Enter a valid bank account number.", type: "warning" });
    return;
  }
  const duplicate = (Array.isArray(purchaseVendorsDb) ? purchaseVendorsDb : []).find(vendor => String(vendor.gst || "").toUpperCase() === record.gst);
  if (duplicate) {
    window.showNotification({ title: "Vendor Already Exists", message: `GST ${record.gst} is already registered under ${duplicate.name || duplicate.vendorCode}.`, type: "warning" });
    return;
  }
  purchaseVendorsDb.unshift(record);
  const saved = await saveStorage(KEY_PURCHASE_VENDORS, purchaseVendorsDb);
  if (saved === false) {
    purchaseVendorsDb = purchaseVendorsDb.filter(vendor => vendor.id !== record.id);
    resetPurchaseVendorForm();
    return;
  }
  await logEvent("PURCHASE", "VENDOR_ADDED", `Added vendor ${record.vendorCode} - ${record.name}.`);
  renderPurchaseVendorMaster();
  resetPurchaseVendorForm();
  window.showNotification({ title: "Vendor Saved", message: `${record.vendorCode} - ${record.name} has been added to Vendor Master.`, type: "success" });
};

function purchaseVendorFactoryAddress(vendor) {
  return [vendor.factoryAddressLine1 ?? vendor.addressLine1, vendor.factoryAddressLine2 ?? vendor.addressLine2, vendor.factoryCity ?? vendor.city, vendor.factoryDistrict ?? vendor.district, vendor.factoryState ?? vendor.state, vendor.factoryCountry ?? vendor.country].filter(Boolean).join(", ");
}

function purchaseVendorOfficeAddress(vendor) {
  return [vendor.officeAddressLine1, vendor.officeAddressLine2, vendor.officeCity, vendor.officeDistrict, vendor.officeState, vendor.officeCountry].filter(Boolean).join(", ");
}

const PURCHASE_VENDOR_SEARCH_FIELDS = {
  any: { label: "Any Detail", placeholder: "Search any saved vendor detail..." },
  vendorType: { label: "Vendor Type", placeholder: "Search Domestic or Import..." },
  vendorCode: { label: "Vendor Code", placeholder: "Search vendor code, for example VD1001 or VI1002..." },
  name: { label: "Vendor Name", placeholder: "Search vendor or company name..." },
  gst: { label: "GST Number", placeholder: "Search complete or partial GSTIN..." },
  pan: { label: "PAN Number", placeholder: "Search complete or partial PAN..." },
  factoryAddress: { label: "Factory Address", placeholder: "Search any factory address detail..." },
  factoryCountry: { label: "Factory Country", placeholder: "Search factory country..." },
  factoryState: { label: "Factory State / Province", placeholder: "Search factory state or province..." },
  factoryDistrict: { label: "Factory District / County", placeholder: "Search factory district or county..." },
  factoryCity: { label: "Factory City", placeholder: "Search factory city..." },
  officeAddress: { label: "Office Address", placeholder: "Search any office address detail..." },
  officeCountry: { label: "Office Country", placeholder: "Search office country..." },
  officeState: { label: "Office State / Province", placeholder: "Search office state or province..." },
  officeDistrict: { label: "Office District / County", placeholder: "Search office district or county..." },
  officeCity: { label: "Office City", placeholder: "Search office city..." },
  bankName: { label: "Bank Name", placeholder: "Search bank name..." },
  accountNumber: { label: "Account Number", placeholder: "Search bank account number..." },
  ifsc: { label: "IFSC Code", placeholder: "Search IFSC code..." },
  email: { label: "Email ID", placeholder: "Search vendor email address..." },
  contactPerson: { label: "Contact Person", placeholder: "Search contact person name..." },
  contactNumber: { label: "Contact Number", placeholder: "Search contact number..." },
  status: { label: "Status", placeholder: "Search vendor status..." },
  createdBy: { label: "Created By", placeholder: "Search username that created the vendor..." },
  createdAt: { label: "Created Date / Time", placeholder: "Search saved date or time..." }
};

function purchaseVendorSearchValues(vendor) {
  const createdAt = String(vendor.createdAt || "");
  const formattedCreatedAt = createdAt ? new Date(createdAt).toLocaleString("en-IN") : "";
  return {
    vendorType: normalizePurchaseVendorType(vendor.vendorType), vendorCode: vendor.vendorCode, name: vendor.name,
    gst: vendor.gst, pan: vendor.pan,
    factoryAddress: purchaseVendorFactoryAddress(vendor), factoryCountry: vendor.factoryCountry ?? vendor.country,
    factoryState: vendor.factoryState ?? vendor.state, factoryDistrict: vendor.factoryDistrict ?? vendor.district, factoryCity: vendor.factoryCity ?? vendor.city,
    officeAddress: purchaseVendorOfficeAddress(vendor), officeCountry: vendor.officeCountry, officeState: vendor.officeState,
    officeDistrict: vendor.officeDistrict, officeCity: vendor.officeCity,
    bankName: vendor.bankName, accountNumber: vendor.accountNumber, ifsc: vendor.ifsc, email: vendor.email,
    contactPerson: vendor.contactPerson, contactNumber: vendor.contactNumber, status: vendor.status || "ACTIVE",
    createdBy: vendor.createdBy, createdAt: `${createdAt} ${formattedCreatedAt}`
  };
}

window.handlePurchaseVendorSearchFieldChange = function() {
  const field = document.getElementById("purchaseVendorSearchField")?.value || "any";
  const config = PURCHASE_VENDOR_SEARCH_FIELDS[field] || PURCHASE_VENDOR_SEARCH_FIELDS.any;
  const label = document.getElementById("purchaseVendorSearchLabel");
  const input = document.getElementById("purchaseVendorSearch");
  if (label) label.textContent = `SEARCH VENDOR HISTORY — ${config.label.toUpperCase()}`;
  if (input) { input.placeholder = config.placeholder; input.focus(); }
  renderPurchaseVendorMaster();
};

window.clearPurchaseVendorSearch = function() {
  const input = document.getElementById("purchaseVendorSearch");
  const field = document.getElementById("purchaseVendorSearchField");
  if (input) input.value = "";
  if (field) field.value = "any";
  window.handlePurchaseVendorSearchFieldChange();
};

function renderPurchaseVendorMaster() {
  const body = document.getElementById("purchaseVendorTableBody");
  if (!body) return;
  const code = document.getElementById("purchaseVendorCode");
  if (code && !code.value) code.value = nextPurchaseVendorCode();
  const query = String(document.getElementById("purchaseVendorSearch")?.value || "").trim().toLowerCase();
  const searchField = document.getElementById("purchaseVendorSearchField")?.value || "any";
  const all = Array.isArray(purchaseVendorsDb) ? purchaseVendorsDb : [];
  const rows = all.filter(vendor => {
    if (!query) return true;
    const values = purchaseVendorSearchValues(vendor);
    if (searchField !== "any") return String(values[searchField] || "").toLowerCase().includes(query);
    return Object.values(values).some(entry => String(entry || "").toLowerCase().includes(query));
  });
  const count = document.getElementById("purchaseVendorCount");
  if (count) count.textContent = query ? `${rows.length} of ${all.length} vendor(s)` : `${all.length} vendor(s)`;
  body.innerHTML = rows.length ? rows.map((vendor, index) => `<tr><td>${index + 1}</td><td><strong>${escapeSalesHtml(normalizePurchaseVendorType(vendor.vendorType))}</strong></td><td><strong>${escapeSalesHtml(vendor.vendorCode)}</strong></td><td>${escapeSalesHtml(vendor.name)}</td><td><code>${escapeSalesHtml(vendor.gst)}</code></td><td><code>${escapeSalesHtml(vendor.pan)}</code></td><td>${escapeSalesHtml(vendor.contactPerson)}</td><td>${escapeSalesHtml(vendor.contactNumber)}</td><td>${escapeSalesHtml(vendor.email)}</td><td>${escapeSalesHtml(vendor.bankName)}</td><td>${escapeSalesHtml(vendor.accountNumber)}</td><td><code>${escapeSalesHtml(vendor.ifsc)}</code></td><td>${escapeSalesHtml(purchaseVendorFactoryAddress(vendor) || "-")}</td><td>${escapeSalesHtml(purchaseVendorOfficeAddress(vendor) || "-")}</td></tr>`).join("") : `<tr><td colspan="14" style="text-align:center; padding:24px; color:var(--muted);">${all.length ? "No vendors match your search." : "No vendors have been added yet."}</td></tr>`;
}

/* Vendor Master v2: four-box form, conditional compliance, searchable addresses and protected documents. */
const PV_LOCATION_LEVELS = {
  officeCountry: { context:"office", level:"country", input:"purchaseVendorOfficeCountry", wrapper:"purchaseVendorOfficeCountryCombobox", toggle:"purchaseVendorOfficeCountryToggle", options:"purchaseVendorOfficeCountryOptions" },
  officeState: { context:"office", level:"state", input:"purchaseVendorOfficeState", wrapper:"purchaseVendorOfficeStateCombobox", toggle:"purchaseVendorOfficeStateToggle", options:"purchaseVendorOfficeStateOptions" },
  officeCity: { context:"office", level:"city", input:"purchaseVendorOfficeCity", wrapper:"purchaseVendorOfficeCityCombobox", toggle:"purchaseVendorOfficeCityToggle", options:"purchaseVendorOfficeCityOptions" },
  factoryCountry: { context:"factory", level:"country", input:"purchaseVendorFactoryCountry", wrapper:"purchaseVendorFactoryCountryCombobox", toggle:"purchaseVendorFactoryCountryToggle", options:"purchaseVendorFactoryCountryOptions" },
  factoryState: { context:"factory", level:"state", input:"purchaseVendorFactoryState", wrapper:"purchaseVendorFactoryStateCombobox", toggle:"purchaseVendorFactoryStateToggle", options:"purchaseVendorFactoryStateOptions" },
  factoryCity: { context:"factory", level:"city", input:"purchaseVendorFactoryCity", wrapper:"purchaseVendorFactoryCityCombobox", toggle:"purchaseVendorFactoryCityToggle", options:"purchaseVendorFactoryCityOptions" }
};
const pvLocationChoices = Object.fromEntries(Object.keys(PV_LOCATION_LEVELS).map(key => [key, []]));
const pvLocationSelection = { office:{ countryCode:"", stateCode:"" }, factory:{ countryCode:"", stateCode:"" } };
const pvCityCache = {};
let pvAddressCopying = false;

function pvPrefix(context) { return context === "office" ? "Office" : "Factory"; }
function pvAddressId(context, suffix) { return `purchaseVendor${pvPrefix(context)}${suffix}`; }
function pvLocationLevelByOptions(id) { return Object.keys(PV_LOCATION_LEVELS).find(key => PV_LOCATION_LEVELS[key].options === id) || ""; }
function pvLocationChoiceName(item) { return String(item?.name ?? item ?? "").trim(); }
function pvExactChoice(items, value) { const key = purchaseLocationKey(value); return (items || []).find(item => purchaseLocationKey(pvLocationChoiceName(item)) === key) || null; }

function pvPopulateOptions(id, values) {
  const level = pvLocationLevelByOptions(id);
  if (!level) return;
  pvLocationChoices[level] = (Array.isArray(values) ? values : []).filter(item => pvLocationChoiceName(item));
  pvRenderOptions(level);
}

function pvRenderOptions(level) {
  const config = PV_LOCATION_LEVELS[level];
  const input = config && document.getElementById(config.input);
  const list = config && document.getElementById(config.options);
  if (!input || !list) return;
  const query = purchaseLocationKey(input.value);
  const matches = (pvLocationChoices[level] || []).filter(item => !query || purchaseLocationKey(pvLocationChoiceName(item)).includes(query)).slice(0, 250);
  list.replaceChildren();
  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "account-co-empty";
    empty.textContent = config.level === "country" ? "No matching country." : "No match — you may continue with manual entry.";
    list.appendChild(empty);
    return;
  }
  matches.forEach(item => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "account-co-option";
    button.setAttribute("role", "option");
    button.textContent = pvLocationChoiceName(item);
    button.addEventListener("click", () => window.selectPurchaseLocationOption(level, item));
    list.appendChild(button);
  });
}

function pvCloseDropdowns(except="") {
  Object.entries(PV_LOCATION_LEVELS).forEach(([level, config]) => {
    if (level === except) return;
    document.getElementById(config.wrapper)?.classList.remove("open");
    document.getElementById(config.input)?.setAttribute("aria-expanded", "false");
  });
}

function pvSetLevelEnabled(level, enabled, placeholder) {
  const config = PV_LOCATION_LEVELS[level];
  if (!config) return;
  const input = document.getElementById(config.input);
  const toggle = document.getElementById(config.toggle);
  if (input) { input.disabled = !enabled; input.classList.toggle("purchase-linked-field", !enabled && pvIsLinkedTarget(config.context)); if (placeholder) input.placeholder = placeholder; }
  if (toggle) toggle.disabled = !enabled;
  if (!enabled) document.getElementById(config.wrapper)?.classList.remove("open");
}

function pvIsLinkedTarget(context) {
  return context === "office" ? Boolean(document.getElementById("purchaseVendorOfficeSameAsFactory")?.checked) : Boolean(document.getElementById("purchaseVendorFactorySameAsOffice")?.checked);
}

async function pvLoadCities(countryCode) {
  if (!countryCode) return {};
  if (!pvCityCache[countryCode]) {
    pvCityCache[countryCode] = fetch(`assets/vendor-cities/${encodeURIComponent(countryCode)}.json`, { cache:"force-cache" })
      .then(response => response.ok ? response.json() : {})
      .catch(() => ({}));
  }
  return pvCityCache[countryCode];
}

function pvStateChoices(context, data) { return data?.states?.[pvLocationSelection[context].countryCode] || []; }
function pvSetPostalState(context) {
  const city = document.getElementById(pvAddressId(context,"City"));
  const postal = document.getElementById(pvAddressId(context,"PostalCode"));
  if (!postal) return;
  const linked = pvIsLinkedTarget(context);
  postal.disabled = linked || !String(city?.value || "").trim();
  postal.classList.toggle("purchase-linked-field", linked);
  postal.placeholder = postal.disabled && !linked ? "Select or enter city first" : "PIN / postal code";
}

window.openPurchaseLocationDropdown = function(level) {
  const config = PV_LOCATION_LEVELS[level];
  const input = config && document.getElementById(config.input);
  if (!input || input.disabled) return;
  pvCloseDropdowns(level); pvRenderOptions(level);
  document.getElementById(config.wrapper)?.classList.add("open");
  input.setAttribute("aria-expanded","true");
};
window.togglePurchaseLocationDropdown = function(level) {
  const config = PV_LOCATION_LEVELS[level];
  const input = config && document.getElementById(config.input);
  const wrapper = config && document.getElementById(config.wrapper);
  if (!input || !wrapper || input.disabled) return;
  if (wrapper.classList.contains("open")) { wrapper.classList.remove("open"); input.setAttribute("aria-expanded","false"); }
  else { window.openPurchaseLocationDropdown(level); input.focus(); }
};
window.handlePurchaseLocationInput = function(level) {
  pvRenderOptions(level); window.openPurchaseLocationDropdown(level);
  window.handlePurchaseVendorLocationChange(level, false);
};
window.handlePurchaseLocationKeydown = function(event, level) {
  if (event.key === "Escape") { pvCloseDropdowns(); return; }
  if (event.key === "ArrowDown") { event.preventDefault(); window.openPurchaseLocationDropdown(level); document.getElementById(PV_LOCATION_LEVELS[level]?.options)?.querySelector("button")?.focus(); }
  if (event.key === "Enter") { const first=document.getElementById(PV_LOCATION_LEVELS[level]?.options)?.querySelector("button"); if(first){event.preventDefault();first.click();} }
};
window.selectPurchaseLocationOption = async function(level, item) {
  const config = PV_LOCATION_LEVELS[level];
  const input = config && document.getElementById(config.input);
  if (!input) return;
  input.value = pvLocationChoiceName(item);
  if (config.level === "country") pvLocationSelection[config.context].countryCode = String(item?.code || "");
  if (config.level === "state") pvLocationSelection[config.context].stateCode = String(item?.code || item?.isoCode || "");
  document.getElementById(config.wrapper)?.classList.remove("open"); input.setAttribute("aria-expanded","false");
  await window.handlePurchaseVendorLocationChange(level, true);
  const next = config.level === "country" ? `${config.context}State` : (config.level === "state" ? `${config.context}City` : "");
  if (next) document.getElementById(PV_LOCATION_LEVELS[next].input)?.focus(); else pvSetPostalState(config.context);
};

window.handlePurchaseVendorLocationChange = async function(level, selected=false) {
  const config = PV_LOCATION_LEVELS[level];
  if (!config) return;
  const data = await ensurePurchaseVendorLocations().catch(() => null);
  if (!data) return;
  const context = config.context;
  const value = String(document.getElementById(config.input)?.value || "").trim();
  if (config.level === "country") {
    const country = pvExactChoice(data.countries || [], value);
    const previous = pvLocationSelection[context].countryCode;
    const code = country?.code || (selected ? pvLocationSelection[context].countryCode : "");
    pvLocationSelection[context] = { countryCode:code, stateCode:"" };
    if (code !== previous || !country) {
      document.getElementById(pvAddressId(context,"State")).value = "";
      document.getElementById(pvAddressId(context,"City")).value = "";
      document.getElementById(pvAddressId(context,"PostalCode")).value = "";
    }
    const states = code ? (data.states?.[code] || []) : [];
    pvPopulateOptions(PV_LOCATION_LEVELS[`${context}State`].options, states);
    pvPopulateOptions(PV_LOCATION_LEVELS[`${context}City`].options, []);
    pvSetLevelEnabled(`${context}State`, Boolean(country), country ? "Type or select state / province" : "Select country first");
    pvSetLevelEnabled(`${context}City`, false, "Select state first");
    pvSetPostalState(context);
  } else if (config.level === "state") {
    const states = pvStateChoices(context, data);
    const state = pvExactChoice(states, value);
    pvLocationSelection[context].stateCode = String(state?.code || state?.isoCode || (selected ? pvLocationSelection[context].stateCode : ""));
    const cityMap = await pvLoadCities(pvLocationSelection[context].countryCode);
    const cities = pvLocationSelection[context].stateCode ? (cityMap[pvLocationSelection[context].stateCode] || []) : [];
    pvPopulateOptions(PV_LOCATION_LEVELS[`${context}City`].options, cities);
    pvSetLevelEnabled(`${context}City`, Boolean(value), value ? "Type or select city" : "Select state first");
    if (!selected) document.getElementById(pvAddressId(context,"City")).value = "";
    document.getElementById(pvAddressId(context,"PostalCode")).value = "";
    pvSetPostalState(context);
  } else pvSetPostalState(context);
  window.syncLinkedPurchaseAddress(context);
};

async function initializePurchaseVendorLocation() {
  const data = await ensurePurchaseVendorLocations();
  for (const context of ["office","factory"]) {
    pvLocationSelection[context] = { countryCode:"", stateCode:"" };
    pvPopulateOptions(PV_LOCATION_LEVELS[`${context}Country`].options, data.countries || []);
    pvPopulateOptions(PV_LOCATION_LEVELS[`${context}State`].options, []);
    pvPopulateOptions(PV_LOCATION_LEVELS[`${context}City`].options, []);
    pvSetLevelEnabled(`${context}Country`, true, "Type or select country");
    pvSetLevelEnabled(`${context}State`, false, "Select country first");
    pvSetLevelEnabled(`${context}City`, false, "Select state first");
    pvSetPostalState(context);
  }
}

function pvSetAddressLocked(context, locked) {
  ["Address1","Address2"].forEach(suffix => { const field=document.getElementById(pvAddressId(context,suffix)); if(field){field.disabled=locked;field.classList.toggle("purchase-linked-field",locked);} });
  if (locked) {
    ["Country","State","City"].forEach(suffix => pvSetLevelEnabled(`${context}${suffix}`, false));
    const postal=document.getElementById(pvAddressId(context,"PostalCode")); if(postal){postal.disabled=true;postal.classList.add("purchase-linked-field");}
  } else {
    pvSetLevelEnabled(`${context}Country`, true, "Type or select country");
    pvSetLevelEnabled(`${context}State`, Boolean(pvLocationSelection[context].countryCode), "Type or select state / province");
    pvSetLevelEnabled(`${context}City`, Boolean(document.getElementById(pvAddressId(context,"State"))?.value.trim()), "Type or select city");
    pvSetPostalState(context);
  }
}

async function pvCopyAddress(source, target) {
  if (pvAddressCopying) return;
  pvAddressCopying = true;
  ["Address1","Address2","Country","State","City","PostalCode"].forEach(suffix => {
    const from=document.getElementById(pvAddressId(source,suffix)); const to=document.getElementById(pvAddressId(target,suffix)); if(from&&to)to.value=from.value;
  });
  pvLocationSelection[target] = { ...pvLocationSelection[source] };
  const data = await ensurePurchaseVendorLocations().catch(() => null);
  if (data) {
    pvPopulateOptions(PV_LOCATION_LEVELS[`${target}State`].options, data.states?.[pvLocationSelection[target].countryCode] || []);
    const cityMap=await pvLoadCities(pvLocationSelection[target].countryCode);
    pvPopulateOptions(PV_LOCATION_LEVELS[`${target}City`].options, cityMap[pvLocationSelection[target].stateCode] || []);
  }
  pvAddressCopying = false;
}

window.syncLinkedPurchaseAddress = async function(source) {
  if (pvAddressCopying) return;
  if (source === "factory" && document.getElementById("purchaseVendorOfficeSameAsFactory")?.checked) await pvCopyAddress("factory","office");
  if (source === "office" && document.getElementById("purchaseVendorFactorySameAsOffice")?.checked) await pvCopyAddress("office","factory");
};
window.togglePurchaseVendorSameAddress = async function(target) {
  const officeBox=document.getElementById("purchaseVendorOfficeSameAsFactory");
  const factoryBox=document.getElementById("purchaseVendorFactorySameAsOffice");
  const selected = target === "office" ? officeBox : factoryBox;
  const opposite = target === "office" ? factoryBox : officeBox;
  if (selected?.checked) {
    if (opposite) opposite.checked=false;
    pvSetAddressLocked(target === "office" ? "factory" : "office", false);
    await pvCopyAddress(target === "office" ? "factory" : "office", target);
    pvSetAddressLocked(target, true);
  } else pvSetAddressLocked(target, false);
};
document.addEventListener("pointerdown", event => { if (!event.target.closest(".purchase-location-combobox")) pvCloseDropdowns(); });

window.normalizePurchaseVendorCodeField = function(id, maximum, allowHyphen=false) {
  const field=document.getElementById(id); if(!field)return;
  field.value=String(field.value||"").toUpperCase().replace(allowHyphen?/[^A-Z0-9-]/g:/[^A-Z0-9]/g,"").slice(0,maximum);
};

const PV_UPLOAD_CATEGORIES = ["GST","PAN","CIN","MSME","TAN","IEC","OTHER","CANCELLED_CHEQUE"];
window.openPurchaseVendorUpload = category => document.getElementById(`purchaseVendorDoc${category}`)?.click();
window.updatePurchaseVendorUploadStatus = function(category) {
  const input=document.getElementById(`purchaseVendorDoc${category}`); const status=document.getElementById(`purchaseVendorDoc${category}Status`);
  const files=Array.from(input?.files||[]); const invalid=files.find(file => file.size>20*1024*1024 || !/\.(pdf|jpe?g|png)$/i.test(file.name));
  if(invalid){input.value="";if(status)status.textContent="No file selected";window.showNotification({title:"Invalid Vendor Document",message:"Use PDF, JPG, JPEG or PNG files up to 20 MB each.",type:"warning"});return;}
  if(status)status.textContent=files.length?`${files.length} file(s): ${files.map(file=>file.name).join(", ")}`:"No file selected";
};

async function pvUploadDocuments(vendorCode) {
  const uploaded=[];
  for (const category of PV_UPLOAD_CATEGORIES) for (const file of Array.from(document.getElementById(`purchaseVendorDoc${category}`)?.files||[])) {
    const form=new FormData(); form.append("vendorCode",vendorCode); form.append("category",category); form.append("file",file,file.name);
    const response=await erpFetchWithTimeout("backend/api.php?action=upload_vendor_document",{method:"POST",credentials:"same-origin",body:form},120000);
    const result=await response.json().catch(()=>({status:"error",message:"The server returned an invalid upload response."}));
    if(!response.ok || String(result.status||"").toLowerCase()!=="success")throw new Error(result.message||`Could not upload ${file.name}.`);
    uploaded.push(result.document);
  }
  return uploaded;
}

window.handlePurchaseVendorTypeChange = function() {
  const typeSelect=document.getElementById("purchaseVendorType"),type=normalizePurchaseVendorType(typeSelect?.value),isDomestic=type==="DOMESTIC",previousType=String(typeSelect?.dataset.previousVendorType||"");
  if(previousType&&type&&previousType!==type){const proof=document.getElementById("purchaseVendorDocCANCELLED_CHEQUE");if(proof)proof.value="";const proofStatus=document.getElementById("purchaseVendorDocCANCELLED_CHEQUEStatus");if(proofStatus)proofStatus.textContent="No file selected";}
  if(typeSelect)typeSelect.dataset.previousVendorType=type;
  const code=document.getElementById("purchaseVendorCode"); if(code)code.value=type?nextPurchaseVendorCode(type):"";
  document.querySelectorAll(".purchase-domestic-only").forEach(group=>group.style.display=isDomestic?"":"none");
  document.querySelectorAll(".purchase-domestic-required").forEach(marker=>marker.style.display=isDomestic?"inline":"none");
  if(!isDomestic){for(const [fieldId,category] of [["purchaseVendorGst","GST"],["purchaseVendorPan","PAN"],["purchaseVendorMsme","MSME"],["purchaseVendorTan","TAN"]]){const field=document.getElementById(fieldId);if(field)field.value="";const input=document.getElementById(`purchaseVendorDoc${category}`);if(input)input.value="";const status=document.getElementById(`purchaseVendorDoc${category}Status`);if(status)status.textContent="No file selected";}}
  const note=document.getElementById("purchaseVendorComplianceNote"); if(note)note.textContent=type==="DOMESTIC"?"GST and PAN are mandatory for Domestic vendors. CIN and MSME / UDYAM are optional.":"Compliance identifiers are optional for Import vendors.";
  const ifsc=document.getElementById("purchaseVendorIfscGroup"), swift=document.getElementById("purchaseVendorSwiftGroup");
  if(ifsc)ifsc.style.display=isDomestic?"grid":"none"; if(swift)swift.style.display=type==="IMPORT"?"grid":"none";
  const isImport=type==="IMPORT",proofLabel=document.getElementById("purchaseVendorBankProofLabel"),proofRequirement=document.getElementById("purchaseVendorBankProofRequirement"),proofGuidance=document.getElementById("purchaseVendorBankProofGuidance");
  if(proofLabel)proofLabel.innerHTML=isImport?'BANK DETAILS ON COMPANY LETTERHEAD <span style="color:#dc2626;">*</span>':'CANCELLED CHEQUE / BANK PROOF <span style="color:#dc2626;">*</span>';
  if(proofRequirement)proofRequirement.value=isImport?"Mandatory signed & stamped document":"Mandatory bank proof";
  if(proofGuidance)proofGuidance.textContent=isImport?"Upload bank details on the company letterhead, duly signed and stamped.":(isDomestic?"Upload a cancelled cheque or official bank proof.":"Select the vendor type to see the required bank document.");
};

function resetPurchaseVendorForm() {
  ["purchaseVendorName","purchaseVendorGst","purchaseVendorPan","purchaseVendorCin","purchaseVendorMsme","purchaseVendorTan","purchaseVendorIec","purchaseVendorOtherDocumentNumber","purchaseVendorBankName","purchaseVendorAccountNumber","purchaseVendorIfsc","purchaseVendorSwift","purchaseVendorBranchName","purchaseVendorBranchAddress","purchaseVendorSalesPersonName","purchaseVendorSalesPersonMobile","purchaseVendorSalesPersonEmail","purchaseVendorQualityPersonName","purchaseVendorQualityPersonMobile","purchaseVendorQualityPersonEmail","purchaseVendorLogisticsPersonName","purchaseVendorLogisticsPersonMobile","purchaseVendorLogisticsPersonEmail","purchaseVendorAccountsPersonName","purchaseVendorAccountsPersonMobile","purchaseVendorAccountsPersonEmail"].forEach(id=>{const field=document.getElementById(id);if(field)field.value="";});
  for(const context of ["office","factory"])["Address1","Address2","Country","State","City","PostalCode"].forEach(suffix=>{const field=document.getElementById(pvAddressId(context,suffix));if(field)field.value="";});
  PV_UPLOAD_CATEGORIES.forEach(category=>{const input=document.getElementById(`purchaseVendorDoc${category}`);if(input)input.value="";const status=document.getElementById(`purchaseVendorDoc${category}Status`);if(status)status.textContent="No file selected";});
  const officeSame=document.getElementById("purchaseVendorOfficeSameAsFactory"),factorySame=document.getElementById("purchaseVendorFactorySameAsOffice");if(officeSame)officeSame.checked=false;if(factorySame)factorySame.checked=false;
  pvSetAddressLocked("office",false);pvSetAddressLocked("factory",false);
  const type=document.getElementById("purchaseVendorType");if(type)type.value="";
  initializePurchaseVendorLocation().catch(()=>{});window.handlePurchaseVendorTypeChange();
}

function pvPostalValid(country,postal){return purchaseLocationKey(country)==="india"?/^[0-9]{6}$/.test(postal):/^[A-Z0-9][A-Z0-9 -]{1,10}[A-Z0-9]$/i.test(postal);}
window.savePurchaseVendor = async function() {
  const value=id=>String(document.getElementById(id)?.value||"").trim();
  const vendorType=normalizePurchaseVendorType(value("purchaseVendorType")); const vendorCode=nextPurchaseVendorCode(vendorType);
  const record={id:`VENDOR-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`,vendorCode,vendorType,name:value("purchaseVendorName").toUpperCase(),gst:value("purchaseVendorGst").toUpperCase(),pan:value("purchaseVendorPan").toUpperCase(),cin:value("purchaseVendorCin").toUpperCase(),msme:value("purchaseVendorMsme").toUpperCase(),tan:value("purchaseVendorTan").toUpperCase(),iec:value("purchaseVendorIec").toUpperCase(),otherDocumentNumber:value("purchaseVendorOtherDocumentNumber"),email:value("purchaseVendorSalesPersonEmail").toLowerCase(),contactPerson:value("purchaseVendorSalesPersonName"),contactNumber:value("purchaseVendorSalesPersonMobile").replace(/[\s()-]/g,""),bankName:value("purchaseVendorBankName"),accountNumber:value("purchaseVendorAccountNumber").replace(/\s+/g,""),ifsc:value("purchaseVendorIfsc").toUpperCase(),swift:value("purchaseVendorSwift").toUpperCase(),branchName:value("purchaseVendorBranchName"),branchAddress:value("purchaseVendorBranchAddress"),salesPersonName:value("purchaseVendorSalesPersonName"),salesPersonMobile:value("purchaseVendorSalesPersonMobile").replace(/[\s()-]/g,""),salesPersonEmail:value("purchaseVendorSalesPersonEmail").toLowerCase(),qualityPersonName:value("purchaseVendorQualityPersonName"),qualityPersonMobile:value("purchaseVendorQualityPersonMobile").replace(/[\s()-]/g,""),qualityPersonEmail:value("purchaseVendorQualityPersonEmail").toLowerCase(),logisticsPersonName:value("purchaseVendorLogisticsPersonName"),logisticsPersonMobile:value("purchaseVendorLogisticsPersonMobile").replace(/[\s()-]/g,""),logisticsPersonEmail:value("purchaseVendorLogisticsPersonEmail").toLowerCase(),accountsPersonName:value("purchaseVendorAccountsPersonName"),accountsPersonMobile:value("purchaseVendorAccountsPersonMobile").replace(/[\s()-]/g,""),accountsPersonEmail:value("purchaseVendorAccountsPersonEmail").toLowerCase(),officeAddressLine1:value("purchaseVendorOfficeAddress1"),officeAddressLine2:value("purchaseVendorOfficeAddress2"),officeCountry:value("purchaseVendorOfficeCountry"),officeState:value("purchaseVendorOfficeState"),officeCity:value("purchaseVendorOfficeCity"),officePostalCode:value("purchaseVendorOfficePostalCode").toUpperCase(),factoryAddressLine1:value("purchaseVendorFactoryAddress1"),factoryAddressLine2:value("purchaseVendorFactoryAddress2"),factoryCountry:value("purchaseVendorFactoryCountry"),factoryState:value("purchaseVendorFactoryState"),factoryCity:value("purchaseVendorFactoryCity"),factoryPostalCode:value("purchaseVendorFactoryPostalCode").toUpperCase(),addressLink:document.getElementById("purchaseVendorOfficeSameAsFactory")?.checked?"OFFICE_SAME_AS_FACTORY":(document.getElementById("purchaseVendorFactorySameAsOffice")?.checked?"FACTORY_SAME_AS_OFFICE":""),documents:[],status:"ACTIVE",createdAt:new Date().toISOString(),createdBy:currentLoggedInUser?.username||"SYSTEM"};
  const required={"Vendor Type":record.vendorType,"Vendor Name":record.name,"Bank Name":record.bankName,"Account Number":record.accountNumber,"Branch Name":record.branchName,"Branch Address":record.branchAddress,"Sales Person Name":record.salesPersonName,"Sales Person Mobile":record.salesPersonMobile,"Sales Person Email":record.salesPersonEmail,"Office Address Line 1":record.officeAddressLine1,"Office Country":record.officeCountry,"Office State":record.officeState,"Office City":record.officeCity,"Office PIN / Postal Code":record.officePostalCode,"Factory Address Line 1":record.factoryAddressLine1,"Factory Country":record.factoryCountry,"Factory State":record.factoryState,"Factory City":record.factoryCity,"Factory PIN / Postal Code":record.factoryPostalCode};
  if(vendorType==="DOMESTIC")Object.assign(required,{GSTIN:record.gst,PAN:record.pan,"IFSC Code":record.ifsc});else required["SWIFT / BIC Code"]=record.swift;
  const missing=Object.entries(required).filter(([,entry])=>!entry).map(([label])=>label);if(missing.length){window.showNotification({title:"Vendor Details Required",message:`Complete: ${missing.join(", ")}.`,type:"warning"});return;}
  if(vendorType==="DOMESTIC"){
    const missingDocuments=[["GST","GST"],["PAN","PAN"]].filter(([category])=>!document.getElementById(`purchaseVendorDoc${category}`)?.files?.length).map(([,label])=>label);
    if(missingDocuments.length){window.showNotification({title:"Mandatory Documents Required",message:`Upload: ${missingDocuments.join(", ")}.`,type:"warning"});document.getElementById(`purchaseVendorDoc${missingDocuments[0].split(" ")[0]}`)?.focus();return;}
  }
  const bankProofFiles=Array.from(document.getElementById("purchaseVendorDocCANCELLED_CHEQUE")?.files||[]);if(!bankProofFiles.length){window.showNotification({title:"Bank Proof Required",message:vendorType==="IMPORT"?"Upload bank details on the company letterhead, duly signed and stamped.":"Upload a cancelled cheque or official bank proof.",type:"warning"});return;}
  const data=await ensurePurchaseVendorLocations().catch(()=>null);if(!data)return;
  for(const context of ["office","factory"]){const label=pvPrefix(context),countryField=`${context}Country`,stateField=`${context}State`;const country=pvExactChoice(data.countries||[],record[countryField]);if(!country){window.showNotification({title:`Select ${label} Country`,message:`Choose the ${label.toLowerCase()} country from the searchable list.`,type:"warning"});return;}record[countryField]=country.name;const states=data.states?.[country.code]||[];const state=pvExactChoice(states,record[stateField]);if(state)record[stateField]=state.name;if(!pvPostalValid(country.name,record[`${context}PostalCode`])){window.showNotification({title:`Invalid ${label} Postal Code`,message:country.code==="IN"?"Indian PIN code must contain exactly 6 digits.":"Enter a valid postal code using letters, numbers, spaces or hyphens.",type:"warning"});return;}}
  if(record.gst&&!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(record.gst)){window.showNotification({title:"Invalid GSTIN",message:"Enter a valid 15-character GSTIN.",type:"warning"});return;}
  if(record.pan&&!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(record.pan)){window.showNotification({title:"Invalid PAN",message:"Enter a valid 10-character PAN.",type:"warning"});return;}
  if(record.cin&&!/^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/.test(record.cin)){window.showNotification({title:"Invalid CIN",message:"Enter a valid 21-character Corporate Identity Number.",type:"warning"});return;}
  if(record.msme&&!/^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/.test(record.msme)){window.showNotification({title:"Invalid MSME / UDYAM",message:"Use the format UDYAM-XX-00-0000000.",type:"warning"});return;}
  if(record.tan&&!/^[A-Z]{4}[0-9]{5}[A-Z]$/.test(record.tan)){window.showNotification({title:"Invalid TAN",message:"Enter a valid 10-character TAN.",type:"warning"});return;}
  if(record.iec&&!/^[A-Z0-9]{10}$/.test(record.iec)){window.showNotification({title:"Invalid IEC",message:"Enter a valid 10-character IEC.",type:"warning"});return;}
  if(record.ifsc&&!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(record.ifsc)){window.showNotification({title:"Invalid IFSC",message:"Enter a valid 11-character IFSC code.",type:"warning"});return;}
  if(record.swift&&!/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(record.swift)){window.showNotification({title:"Invalid SWIFT / BIC",message:"Enter a valid 8 or 11-character SWIFT/BIC code.",type:"warning"});return;}
  if(!/^\S+@\S+\.\S+$/.test(record.email)||!/^\+?\d{10,15}$/.test(record.contactNumber)||!/^[A-Z0-9]{6,34}$/i.test(record.accountNumber)){window.showNotification({title:"Invalid Vendor Contact or Bank Details",message:"Check the email, 10–15 digit contact number and mandatory bank account number.",type:"warning"});return;}
  for(const [label,mobile,email,mandatory] of [["Sales Person",record.salesPersonMobile,record.salesPersonEmail,true],["Quality Department Person",record.qualityPersonMobile,record.qualityPersonEmail,false],["Logistics Person",record.logisticsPersonMobile,record.logisticsPersonEmail,false],["Accounts Department Person",record.accountsPersonMobile,record.accountsPersonEmail,false]]){if((mandatory||mobile)&&!/^\+?\d{10,15}$/.test(mobile)){window.showNotification({title:`Invalid ${label} Mobile Number`,message:"Enter a valid 10 to 15 digit mobile number.",type:"warning"});return;}if((mandatory||email)&&!/^\S+@\S+\.\S+$/.test(email)){window.showNotification({title:`Invalid ${label} Email`,message:"Enter a valid email address.",type:"warning"});return;}}
  const duplicate=(purchaseVendorsDb||[]).find(v=>record.gst&&String(v.gst||"").toUpperCase()===record.gst);if(duplicate){window.showNotification({title:"Vendor Already Exists",message:`GST ${record.gst} is already registered under ${duplicate.name||duplicate.vendorCode}.`,type:"warning"});return;}
  try{record.documents=await pvUploadDocuments(vendorCode);}catch(error){window.showNotification({title:"Document Upload Failed",message:error.message||"Vendor documents could not be stored.",type:"danger"});return;}
  Object.assign(record,{addressLine1:record.factoryAddressLine1,addressLine2:record.factoryAddressLine2,country:record.factoryCountry,state:record.factoryState,city:record.factoryCity,pincode:record.factoryPostalCode});
  purchaseVendorsDb.unshift(record);const saved=await saveStorage(KEY_PURCHASE_VENDORS,purchaseVendorsDb);if(saved===false){purchaseVendorsDb=purchaseVendorsDb.filter(v=>v.id!==record.id);return;}
  await logEvent("PURCHASE","VENDOR_ADDED",`Added vendor ${record.vendorCode} - ${record.name}; ${record.documents.length} document(s) stored.`);renderPurchaseVendorMaster();resetPurchaseVendorForm();window.showNotification({title:"Vendor Saved",message:`${record.vendorCode} - ${record.name} has been added to Vendor Master.`,type:"success"});
};

function purchaseVendorFactoryAddress(vendor){return [vendor.factoryAddressLine1??vendor.addressLine1,vendor.factoryAddressLine2??vendor.addressLine2,vendor.factoryCity??vendor.city,vendor.factoryState??vendor.state,vendor.factoryCountry??vendor.country,vendor.factoryPostalCode??vendor.pincode].filter(Boolean).join(", ");}
function purchaseVendorOfficeAddress(vendor){return [vendor.officeAddressLine1,vendor.officeAddressLine2,vendor.officeCity,vendor.officeState,vendor.officeCountry,vendor.officePostalCode].filter(Boolean).join(", ");}
const PV_SEARCH_FIELDS={any:["Any Detail","Search any saved vendor detail..."],vendorType:["Vendor Type","Search Domestic or Import..."],vendorCode:["Vendor Code","Search VD or VI vendor code..."],name:["Vendor Name","Search vendor or company name..."],gst:["GSTIN","Search GSTIN..."],pan:["PAN","Search PAN..."],cin:["CIN","Search CIN..."],msme:["MSME / UDYAM","Search UDYAM number..."],tan:["TAN","Search TAN..."],iec:["IEC","Search IEC..."],otherDocumentNumber:["Other Document Number","Search other document number..."],officeAddress:["Office Address","Search office address..."],officeCountry:["Office Country","Search office country..."],officeState:["Office State / Province","Search office state or province..."],officeCity:["Office City","Search office city..."],officePostalCode:["Office PIN / Postal Code","Search office postal code..."],factoryAddress:["Factory Address","Search factory address..."],factoryCountry:["Factory Country","Search factory country..."],factoryState:["Factory State / Province","Search factory state or province..."],factoryCity:["Factory City","Search factory city..."],factoryPostalCode:["Factory PIN / Postal Code","Search factory postal code..."],bankName:["Bank Name","Search bank name..."],accountNumber:["Account Number","Search account number..."],ifsc:["IFSC","Search IFSC..."],swift:["SWIFT / BIC","Search SWIFT/BIC..."],branchName:["Branch Name","Search branch name..."],branchAddress:["Branch Address","Search branch address..."],email:["Email ID","Search email..."],contactPerson:["Contact Person","Search contact person..."],contactNumber:["Contact Number","Search contact number..."],status:["Status","Search vendor status..."],createdBy:["Created By","Search creator username..."],createdAt:["Created Date / Time","Search saved date or time..."]};
function purchaseVendorSearchValues(v){const created=String(v.createdAt||"");return{vendorType:normalizePurchaseVendorType(v.vendorType),vendorCode:v.vendorCode,name:v.name,gst:v.gst,pan:v.pan,cin:v.cin,msme:v.msme,tan:v.tan,iec:v.iec,otherDocumentNumber:v.otherDocumentNumber,officeAddress:purchaseVendorOfficeAddress(v),officeCountry:v.officeCountry,officeState:v.officeState,officeCity:v.officeCity,officePostalCode:v.officePostalCode,factoryAddress:purchaseVendorFactoryAddress(v),factoryCountry:v.factoryCountry??v.country,factoryState:v.factoryState??v.state,factoryCity:v.factoryCity??v.city,factoryPostalCode:v.factoryPostalCode??v.pincode,bankName:v.bankName,accountNumber:v.accountNumber,ifsc:v.ifsc,swift:v.swift,branchName:v.branchName,branchAddress:v.branchAddress,email:v.email,contactPerson:v.contactPerson,contactNumber:v.contactNumber,status:v.status||"ACTIVE",createdBy:v.createdBy,createdAt:`${created} ${created?new Date(created).toLocaleString("en-IN"):""}`};}
Object.assign(PV_SEARCH_FIELDS,{salesPersonName:["Sales Person Name","Search sales person name..."],salesPersonMobile:["Sales Person Mobile","Search sales person mobile..."],salesPersonEmail:["Sales Person Email","Search sales person email..."],qualityPersonName:["Quality Person Name","Search quality person name..."],qualityPersonMobile:["Quality Person Mobile","Search quality person mobile..."],qualityPersonEmail:["Quality Person Email","Search quality person email..."],logisticsPersonName:["Logistics Person Name","Search logistics person name..."],logisticsPersonMobile:["Logistics Person Mobile","Search logistics person mobile..."],logisticsPersonEmail:["Logistics Person Email","Search logistics person email..."],accountsPersonName:["Accounts Person Name","Search accounts person name..."],accountsPersonMobile:["Accounts Person Mobile","Search accounts person mobile..."],accountsPersonEmail:["Accounts Person Email","Search accounts person email..."]});
[["accountsPersonName","Accounts Person Name"],["accountsPersonMobile","Accounts Person Mobile"],["accountsPersonEmail","Accounts Person Email"]].forEach(([value,label])=>{const select=document.getElementById("purchaseVendorSearchField");if(select&&![...select.options].some(option=>option.value===value))select.add(new Option(label,value));});
const pvBaseVendorSearchValues=purchaseVendorSearchValues;
purchaseVendorSearchValues=function(v){return{...pvBaseVendorSearchValues(v),salesPersonName:v.salesPersonName,salesPersonMobile:v.salesPersonMobile,salesPersonEmail:v.salesPersonEmail,qualityPersonName:v.qualityPersonName,qualityPersonMobile:v.qualityPersonMobile,qualityPersonEmail:v.qualityPersonEmail,logisticsPersonName:v.logisticsPersonName,logisticsPersonMobile:v.logisticsPersonMobile,logisticsPersonEmail:v.logisticsPersonEmail,accountsPersonName:v.accountsPersonName,accountsPersonMobile:v.accountsPersonMobile,accountsPersonEmail:v.accountsPersonEmail};};
function purchaseVendorDocumentLinks(vendor){if(!String(vendor?.vendorCode||""))return'<span style="color:var(--muted);">Unavailable</span>';return`<button type="button" class="btn btn-secondary" style="padding:6px 10px;font-size:11px;white-space:nowrap;" onclick="downloadPurchaseVendorDetails('${escapeSalesHtml(vendor.vendorCode)}')">⬇ Download Form</button>`;}
window.downloadPurchaseVendorDetails=async function(vendorCode){
  const vendor=(Array.isArray(purchaseVendorsDb)?purchaseVendorsDb:[]).find(item=>String(item.vendorCode||"")===String(vendorCode||""));
  if(!vendor){window.showNotification?.({title:"Vendor Not Found",message:"Refresh Vendor Master and try again.",type:"danger"});return;}
  if(!window.jspdf?.jsPDF||!window.html2canvas){window.showNotification?.({title:"PDF Export Unavailable",message:"Refresh the ERP so the PDF libraries can load.",type:"danger"});return;}
  const value=(item)=>String(item??"").trim();
  const address=(prefix,fallback)=>[vendor[`${prefix}AddressLine1`],vendor[`${prefix}AddressLine2`],vendor[`${prefix}City`],vendor[`${prefix}State`],vendor[`${prefix}PostalCode`],vendor[`${prefix}Country`]].filter(Boolean).join(", ")||fallback||"";
  const sections=[
    ["VENDOR PROFILE",[["Vendor Name",vendor.name],["Vendor Code",vendor.vendorCode],["Vendor Type",vendor.vendorType],["Status",vendor.status||"ACTIVE"],["Application No.",vendor.sourceApplicationNumber],["Saved On",vendor.createdAt?new Date(vendor.createdAt).toLocaleString("en-IN"):""]]],
    ["REGISTRATION DETAILS",[["GSTIN",vendor.gst],["PAN",vendor.pan],["CIN",vendor.cin],["MSME / UDYAM",vendor.msme],["TAN",vendor.tan],["IEC",vendor.iec],["Other Document No.",vendor.otherDocumentNumber]]],
    ["CONTACT DETAILS",[["Main Contact",vendor.contactPerson],["Contact Number",vendor.contactNumber],["Email",vendor.email],["Sales Contact",vendor.salesPersonName],["Sales Phone",vendor.salesPersonMobile],["Sales Email",vendor.salesPersonEmail],["Quality Contact",vendor.qualityPersonName],["Quality Phone",vendor.qualityPersonMobile],["Quality Email",vendor.qualityPersonEmail],["Logistics Contact",vendor.logisticsPersonName],["Logistics Phone",vendor.logisticsPersonMobile],["Logistics Email",vendor.logisticsPersonEmail],["Accounts Contact",vendor.accountsPersonName],["Accounts Phone",vendor.accountsPersonMobile],["Accounts Email",vendor.accountsPersonEmail]]],
    ["BANK DETAILS",[["Bank",vendor.bankName],["Account Number",vendor.accountNumber],["IFSC",vendor.ifsc],["SWIFT / BIC",vendor.swift],["Branch",vendor.branchName],["Branch Address",vendor.branchAddress]]],
    ["ADDRESSES",[["Factory Address",address("factory",vendor.factoryAddress||[vendor.addressLine1,vendor.addressLine2,vendor.city,vendor.state,vendor.pincode,vendor.country].filter(Boolean).join(", "))],["Office Address",address("office",vendor.officeAddress)]]]
  ];
  const esc=(item)=>escapeSalesHtml(value(item)||"-");
  const sectionHtml=sections.map(([title,rows])=>`<section><h2>${title}</h2>${rows.filter(([,item])=>value(item)).map(([label,item])=>`<div class="vendor-pdf-row"><b>${label}</b><span>${esc(item)}</span></div>`).join("")}</section>`).join("");
  const page=document.createElement("div");page.setAttribute("aria-hidden","true");page.style.cssText="position:fixed;left:-12000px;top:0;width:820px;padding:24px;background:#fff;color:#172b3b;font-family:Arial,sans-serif;box-sizing:border-box;";
  page.innerHTML=`<style>.vendor-pdf-title{font-size:27px;font-weight:800;color:#104b70;margin:0 0 4px}.vendor-pdf-subtitle{font-size:13px;color:#64748b;margin:0 0 18px}.vendor-pdf-grid{display:grid;grid-template-columns:1fr;gap:10px}.vendor-pdf-grid section{border:1px solid #d9e4ed;border-radius:9px;overflow:hidden;break-inside:avoid}.vendor-pdf-grid h2{background:#eef6fb;color:#14628c;font-size:14px;letter-spacing:.5px;margin:0;padding:8px 12px}.vendor-pdf-row{display:grid;grid-template-columns:170px 1fr;gap:10px;padding:6px 12px;border-top:1px solid #edf1f5;font-size:13px;line-height:1.3;overflow-wrap:anywhere}.vendor-pdf-row b{color:#60748a;font-weight:700}.vendor-pdf-row span{color:#172b3b}.vendor-pdf-footer{font-size:10px;color:#8795a3;margin-top:10px}</style><h1 class="vendor-pdf-title">${esc(vendor.name||"Vendor")}</h1><p class="vendor-pdf-subtitle">Vendor details · DEMOSOLAR ENERGY ERP</p><div class="vendor-pdf-grid">${sectionHtml}</div><p class="vendor-pdf-footer">Generated ${escapeSalesHtml(new Date().toLocaleString("en-IN"))}</p>`;
  document.body.appendChild(page);
  try{
    const canvas=await window.html2canvas(page,{scale:2,backgroundColor:"#ffffff",logging:false,useCORS:true});
    const pdf=new window.jspdf.jsPDF("p","mm","a4"),pageWidth=pdf.internal.pageSize.getWidth(),pageHeight=pdf.internal.pageSize.getHeight(),margin=8,scale=Math.min((pageWidth-margin*2)/canvas.width,(pageHeight-margin*2)/canvas.height),imageWidth=canvas.width*scale,imageHeight=canvas.height*scale;
    pdf.addImage(canvas.toDataURL("image/jpeg",0.94),"JPEG",(pageWidth-imageWidth)/2,(pageHeight-imageHeight)/2,imageWidth,imageHeight);
    pdf.save(`Vendor-${String(vendor.vendorCode||"Details").replace(/[^A-Za-z0-9_-]/g,"_")}-Details-One-Page.pdf`);
  }catch(error){console.error("Vendor details PDF export failed:",error);window.showNotification?.({title:"Download Failed",message:"The vendor details PDF could not be created. Please try again.",type:"danger"});}
  finally{page.remove();}
};window.handlePurchaseVendorSearchFieldChange=function(){const field=document.getElementById("purchaseVendorSearchField")?.value||"any",config=PV_SEARCH_FIELDS[field]||PV_SEARCH_FIELDS.any,label=document.getElementById("purchaseVendorSearchLabel"),input=document.getElementById("purchaseVendorSearch");if(label)label.textContent=`SEARCH VENDOR HISTORY — ${config[0].toUpperCase()}`;if(input){input.placeholder=config[1];input.focus();}renderPurchaseVendorMaster();};
function renderPurchaseVendorMaster(){const body=document.getElementById("purchaseVendorTableBody");if(!body)return;const code=document.getElementById("purchaseVendorCode");if(code&&!code.value)code.value=nextPurchaseVendorCode();const query=String(document.getElementById("purchaseVendorSearch")?.value||"").trim().toLowerCase(),field=document.getElementById("purchaseVendorSearchField")?.value||"any",all=Array.isArray(purchaseVendorsDb)?purchaseVendorsDb:[],rows=all.filter(v=>{if(!query)return true;const values=purchaseVendorSearchValues(v);return field!=="any"?String(values[field]||"").toLowerCase().includes(query):Object.values(values).some(x=>String(x||"").toLowerCase().includes(query));});const count=document.getElementById("purchaseVendorCount");if(count)count.textContent=query?`${rows.length} of ${all.length} vendor(s)`:`${all.length} vendor(s)`;body.innerHTML=rows.length?rows.map((v,i)=>`<tr><td>${i+1}</td><td><strong>${escapeSalesHtml(normalizePurchaseVendorType(v.vendorType))}</strong></td><td><strong>${escapeSalesHtml(v.vendorCode)}</strong></td><td>${escapeSalesHtml(v.name||"-")}</td><td><code>${escapeSalesHtml(v.gst||"-")}</code></td><td><code>${escapeSalesHtml(v.pan||"-")}</code></td><td>${escapeSalesHtml(v.contactPerson||"-")}</td><td>${escapeSalesHtml(v.contactNumber||"-")}</td><td>${escapeSalesHtml(v.email||"-")}</td><td>${escapeSalesHtml(v.bankName||"-")}</td><td>${escapeSalesHtml(v.accountNumber||"-")}</td><td><code>${escapeSalesHtml(v.ifsc||v.swift||"-")}</code></td><td>${escapeSalesHtml(purchaseVendorFactoryAddress(v)||"-")}</td><td>${escapeSalesHtml(purchaseVendorOfficeAddress(v)||"-")}</td><td>${purchaseVendorDocumentLinks(v)}</td></tr>`).join(""):`<tr><td colspan="15" style="text-align:center;padding:24px;color:var(--muted);">${all.length?"No vendors match your search.":"No vendors have been added yet."}</td></tr>`;}

let vendorApplicationsDb=[];
let selectedVendorApplicationId=null;

function vendorApplicationStatusBadge(status){
  const value=String(status||"SUBMITTED").toUpperCase();
  const colors={SUBMITTED:["#e0f2fe","#0369a1"],UNDER_REVIEW:["#fef3c7","#92400e"],APPROVED:["#dcfce7","#166534"],REJECTED:["#fee2e2","#991b1b"]};
  const [background,color]=colors[value]||["#e5e7eb","#374151"];
  return `<span style="display:inline-block;padding:5px 9px;border-radius:999px;background:${background};color:${color};font-weight:800;font-size:11px;">${escapeSalesHtml(value.replaceAll("_"," "))}</span>`;
}

window.loadVendorApplications=async function(force=false){
  const body=document.getElementById("vendorApplicationsTableBody");if(!body)return;
  if(!force&&vendorApplicationsDb.length){renderVendorApplications();return;}
  body.innerHTML='<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted);">Loading vendor applications…</td></tr>';
  try{
    const response=await erpReadResponse("vendor-applications","backend/api.php?action=vendor_applications",{credentials:"same-origin",cache:"no-store"},20000);
    const result=await response.json().catch(()=>({status:"error",message:"The server returned an invalid response."}));
    if(!response.ok||result.status!=="success")throw new Error(result.message||"Vendor applications could not be loaded.");
    vendorApplicationsDb=Array.isArray(result.applications)?result.applications:[];renderVendorApplications();
  }catch(error){body.innerHTML=`<tr><td colspan="7" style="text-align:center;padding:24px;color:#b91c1c;">${escapeSalesHtml(error.message||"Vendor applications could not be loaded.")}</td></tr>`;}
};

window.renderVendorApplications=function(){
  const body=document.getElementById("vendorApplicationsTableBody");if(!body)return;
  const filter=document.getElementById("vendorApplicationStatusFilter")?.value||"PENDING";
  const search=String(document.getElementById("vendorApplicationSearch")?.value||"").trim().toLowerCase();
  const rows=vendorApplicationsDb.filter(application=>{
    const status=String(application.status||"").toUpperCase();
    if(filter==="PENDING"&&!['SUBMITTED','UNDER_REVIEW'].includes(status))return false;
    if(filter!=="ALL"&&filter!=="PENDING"&&status!==filter)return false;
    if(!search)return true;const data=application.data||{};
    return [application.application_number,application.vendor_name,application.vendor_type,application.vendor_code,data.gst,data.pan,data.iec,data.salesPersonEmail].some(value=>String(value||"").toLowerCase().includes(search));
  });
  const pending=vendorApplicationsDb.filter(application=>['SUBMITTED','UNDER_REVIEW'].includes(String(application.status||"").toUpperCase())).length;
  const count=document.getElementById("vendorApplicationCount");if(count)count.textContent=`${pending} pending · ${vendorApplicationsDb.length} total application(s)`;
  body.innerHTML=rows.length?rows.map(application=>`<tr><td><strong>${escapeSalesHtml(application.application_number)}</strong></td><td>${escapeSalesHtml(application.submitted_at||"-")}</td><td>${escapeSalesHtml(application.vendor_type||"-")}</td><td><strong>${escapeSalesHtml(application.vendor_name||"-")}</strong></td><td>${vendorApplicationStatusBadge(application.status)}</td><td>${escapeSalesHtml(application.vendor_code||"-")}</td><td><button type="button" class="btn btn-secondary" onclick="openVendorApplicationReview(${Number(application.id)})">Review</button></td></tr>`).join(""):'<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted);">No vendor applications match this filter.</td></tr>';
};

function vendorApplicationDetailRows(data){
  const fields=[["Vendor type",data.vendorType],["Vendor name",data.name],["GSTIN",data.gst],["PAN",data.pan],["CIN",data.cin],["MSME / UDYAM",data.msme],["TAN",data.tan],["IEC",data.iec],["Other document",data.otherDocumentNumber],["Bank name",data.bankName],["Account number",data.accountNumber],["IFSC",data.ifsc],["SWIFT / BIC",data.swift],["Branch name",data.branchName],["Branch address",data.branchAddress],["Office address",[data.officeAddressLine1,data.officeAddressLine2,data.officeCity,data.officeState,data.officeCountry,data.officePostalCode].filter(Boolean).join(", ")],["Factory address",[data.factoryAddressLine1,data.factoryAddressLine2,data.factoryCity,data.factoryState,data.factoryCountry,data.factoryPostalCode].filter(Boolean).join(", ")],["Sales person",[data.salesPersonName,data.salesPersonMobile,data.salesPersonEmail].filter(Boolean).join(" · ")],["Logistics person",[data.logisticsPersonName,data.logisticsPersonMobile,data.logisticsPersonEmail].filter(Boolean).join(" · ")],["Quality person",[data.qualityPersonName,data.qualityPersonMobile,data.qualityPersonEmail].filter(Boolean).join(" · ")],["Accounts person",[data.accountsPersonName,data.accountsPersonMobile,data.accountsPersonEmail].filter(Boolean).join(" · ")]];
  return fields.filter(([,value])=>String(value||"").trim()!=="").map(([label,value])=>`<div style="padding:10px;border:1px solid var(--border);border-radius:8px;background:white;"><div style="font-size:10px;color:var(--muted);font-weight:800;margin-bottom:4px;">${escapeSalesHtml(label.toUpperCase())}</div><div style="font-size:13px;word-break:break-word;">${escapeSalesHtml(value)}</div></div>`).join("");
}

window.openVendorApplicationReview=function(applicationId){
  const application=vendorApplicationsDb.find(item=>Number(item.id)===Number(applicationId));if(!application)return;
  selectedVendorApplicationId=Number(application.id);const panel=document.getElementById("vendorApplicationReviewPanel"),data=application.data||{};
  document.getElementById("vendorApplicationReviewTitle").textContent=`${application.application_number} — ${application.vendor_name}`;
  document.getElementById("vendorApplicationReviewMeta").innerHTML=`${vendorApplicationStatusBadge(application.status)} &nbsp; Submitted ${escapeSalesHtml(application.submitted_at||"-")}${application.vendor_code?` &nbsp; Vendor code: <strong>${escapeSalesHtml(application.vendor_code)}</strong>`:""}`;
  document.getElementById("vendorApplicationReviewDetails").innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;">${vendorApplicationDetailRows(data)}</div>`;
  const documents=Array.isArray(application.documents)?application.documents:[];
  document.getElementById("vendorApplicationReviewDocuments").innerHTML=`<h3 style="font-size:14px;margin:0 0 8px;">ATTACHED DOCUMENTS (${documents.length})</h3>${documents.length?`<div style="display:flex;gap:8px;flex-wrap:wrap;">${documents.map(document=>`<a class="btn btn-secondary" target="_blank" rel="noopener" href="backend/api.php?action=vendor_application_document&documentId=${Number(document.id)}">${escapeSalesHtml(document.category)} — ${escapeSalesHtml(document.original_name)}</a>`).join("")}</div>`:'<p style="color:var(--muted);">No documents were attached.</p>'}`;
  const isPending=['SUBMITTED','UNDER_REVIEW'].includes(String(application.status||"").toUpperCase());document.getElementById("vendorApplicationDecisionArea").style.display=isPending?"block":"none";document.getElementById("vendorApplicationDecisionNotes").value=application.review_notes||"";
  panel.style.display="block";panel.scrollIntoView({behavior:"smooth",block:"start"});
};

window.closeVendorApplicationReview=function(){selectedVendorApplicationId=null;const panel=document.getElementById("vendorApplicationReviewPanel");if(panel)panel.style.display="none";};

window.decideVendorApplication=async function(decision){
  const application=vendorApplicationsDb.find(item=>Number(item.id)===Number(selectedVendorApplicationId));if(!application)return;
  const notes=String(document.getElementById("vendorApplicationDecisionNotes")?.value||"").trim();
  if(decision==="REJECT"&&!notes){window.showNotification({title:"Rejection Reason Required",message:"Enter why this vendor application is being rejected.",type:"warning"});return;}
  const actionText=decision==="APPROVE"?"approve this application and add it to Vendor Master":"reject this vendor application";
  if(!window.confirm(`Are you sure you want to ${actionText}?`))return;
  try{
    const response=await erpFetchWithTimeout("backend/api.php?action=vendor_application_decision",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({applicationId:application.id,decision,notes})},120000);
    const result=await response.json().catch(()=>({status:"error",message:"The server returned an invalid response."}));if(!response.ok||result.status!=="success")throw new Error(result.message||"The vendor decision could not be completed.");
    if(decision==="APPROVE"){purchaseVendorsDb=await loadStorage(KEY_PURCHASE_VENDORS,[]);renderPurchaseVendorMaster();}
    vendorApplicationsDb=[];await loadVendorApplications(true);closeVendorApplicationReview();window.showNotification({title:decision==="APPROVE"?"Vendor Approved":"Application Rejected",message:decision==="APPROVE"?`${result.applicationNumber} was approved as ${result.vendorCode}.`:`${result.applicationNumber} was rejected.`,type:decision==="APPROVE"?"success":"warning"});
  }catch(error){window.showNotification({title:"Vendor Decision Failed",message:error.message||"No Vendor Master changes were saved.",type:"danger"});}
};

window.handleCustomerMasterGstInput = function() {
  const input = document.getElementById("customerMasterGst");
  const help = document.getElementById("customerMasterGstHelp");
  if (!input) return;
  const gst = customerMasterKey(input.value).replace(/[^A-Z0-9]/g, "").slice(0, 15);
  input.value = gst;
  const pan = gst.length >= 12 ? gst.slice(2, 12) : "";
  const panInput = document.getElementById("customerMasterPan");
  if (panInput) panInput.value = pan;
  const valid = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);
  if (help) {
    help.textContent = valid ? `PAN ${pan} fetched from GSTIN characters 3–12.` : "Enter the complete GSTIN; PAN will be extracted from characters 3–12.";
    help.style.color = valid ? "#059669" : "var(--muted)";
  }
};

function resetCustomerMasterForm() {
  ["customerMasterName", "customerMasterPerson", "customerMasterPhone", "customerMasterEmail", "customerMasterGst", "customerMasterPan", "customerMasterAddressLine1", "customerMasterAddressLine2", "customerMasterTaluka", "customerMasterDistrict", "customerMasterState", "customerMasterPincode"].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.value = "";
  });
  window.handleCustomerMasterGstInput();
}

window.saveCustomerMaster = async function() {
  const value = id => String(document.getElementById(id)?.value || "").trim();
  const name = value("customerMasterName");
  const person = value("customerMasterPerson");
  const phone = value("customerMasterPhone");
  const email = value("customerMasterEmail");
  const gst = customerMasterKey(value("customerMasterGst")).replace(/[^A-Z0-9]/g, "");
  const pan = customerMasterKey(value("customerMasterPan"));
  const addressLine1 = value("customerMasterAddressLine1");
  const addressLine2 = value("customerMasterAddressLine2");
  const taluka = value("customerMasterTaluka");
  const district = value("customerMasterDistrict");
  const state = value("customerMasterState");
  const pincode = value("customerMasterPincode");
  const address = [addressLine1, addressLine2, taluka, district, state, pincode].filter(Boolean).join(", ");
  const missing = [];
  if (!name) missing.push("Customer Name");
  if (!person) missing.push("Contact Person");
  if (!phone) missing.push("Contact Number");
  if (!gst) missing.push("GST Number");
  if (!addressLine1) missing.push("Address Line 1");
  if (!taluka) missing.push("Taluka");
  if (!district) missing.push("District");
  if (!state) missing.push("State");
  if (!pincode) missing.push("Pincode");
  if (missing.length) {
    window.showNotification({ title: "Customer Details Required", message: `Complete: ${missing.join(", ")}.`, type: "warning" });
    return;
  }
  if (gst.length !== 15 || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) || pan !== gst.slice(2, 12)) {
    window.showNotification({ title: "Invalid GST Number", message: "Enter a valid 15-character GSTIN. PAN must match GST characters 3 through 12.", type: "warning" });
    return;
  }
  if (email && !/^\S+@\S+\.\S+$/.test(email)) {
    window.showNotification({ title: "Invalid E-mail", message: "Enter a valid customer e-mail address or leave it blank.", type: "warning" });
    return;
  }
  if (!/^\d{6}$/.test(pincode)) {
    window.showNotification({ title: "Invalid Pincode", message: "Enter a valid 6-digit pincode.", type: "warning" });
    return;
  }
  const duplicate = (Array.isArray(customersDb) ? customersDb : []).find(customer => customerMasterKey(customer.gst) === gst || customerMasterKey(customer.name) === customerMasterKey(name));
  if (duplicate) {
    window.showNotification({ title: "Customer Already Exists", message: `${duplicate.name} is already saved in Customer Master.`, type: "warning" });
    return;
  }
  const customer = { id: `CUS-${Date.now()}`, name: name.toUpperCase(), person, phone, email, gst, pan, addressLine1, addressLine2, taluka, district, state, pincode, address, createdAt: new Date().toISOString(), createdBy: currentLoggedInUser?.username || "SYSTEM" };
  customersDb.unshift(customer);
  const saved = await saveStorage(KEY_CUSTOMERS, customersDb);
  if (saved === false) {
    customersDb = customersDb.filter(item => item.id !== customer.id);
    return;
  }
  await logEvent("SALES", "CUSTOMER_MASTER_ADDED", `Added customer ${customer.name} with GST ${customer.gst}.`);
  populateSalesCustomerDropdown();
  renderCustomerMasterTable();
  resetCustomerMasterForm();
  window.showNotification({ title: "Customer Saved", message: `${customer.name} is now available in the Sales Order customer dropdown.`, type: "success" });
};

function populateCustomerMasterFilterOptions() {
  const customers = Array.isArray(customersDb) ? customersDb : [];
  const stateSelect = document.getElementById("customerMasterStateFilter");
  const districtSelect = document.getElementById("customerMasterDistrictFilter");
  if (!stateSelect || !districtSelect) return;
  const selectedState = String(stateSelect.value || "");
  const selectedDistrict = String(districtSelect.value || "");
  const states = [...new Set(customers.map(customer => String(customer.state || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  stateSelect.innerHTML = `<option value="">All States</option>` + states.map(state => `<option value="${escapeSalesHtml(state)}">${escapeSalesHtml(state)}</option>`).join("");
  if (states.some(state => customerMasterKey(state) === customerMasterKey(selectedState))) {
    stateSelect.value = states.find(state => customerMasterKey(state) === customerMasterKey(selectedState));
  }
  const activeState = customerMasterKey(stateSelect.value);
  const districts = [...new Set(customers
    .filter(customer => !activeState || customerMasterKey(customer.state) === activeState)
    .map(customer => String(customer.district || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  districtSelect.innerHTML = `<option value="">All Districts</option>` + districts.map(district => `<option value="${escapeSalesHtml(district)}">${escapeSalesHtml(district)}</option>`).join("");
  if (districts.some(district => customerMasterKey(district) === customerMasterKey(selectedDistrict))) {
    districtSelect.value = districts.find(district => customerMasterKey(district) === customerMasterKey(selectedDistrict));
  }
}

function getFilteredCustomerMasterRows() {
  const company = String(document.getElementById("customerMasterCompanyFilter")?.value || "").trim().toLowerCase();
  const state = customerMasterKey(document.getElementById("customerMasterStateFilter")?.value);
  const district = customerMasterKey(document.getElementById("customerMasterDistrictFilter")?.value);
  return (Array.isArray(customersDb) ? customersDb : []).filter(customer => {
    const matchesCompany = !company || String(customer.name || "").toLowerCase().includes(company);
    const matchesState = !state || customerMasterKey(customer.state) === state;
    const matchesDistrict = !district || customerMasterKey(customer.district) === district;
    return matchesCompany && matchesState && matchesDistrict;
  });
}

window.handleCustomerMasterStateFilterChange = function() {
  const districtSelect = document.getElementById("customerMasterDistrictFilter");
  if (districtSelect) districtSelect.value = "";
  populateCustomerMasterFilterOptions();
  renderCustomerMasterTable();
};

window.clearCustomerMasterFilters = function() {
  ["customerMasterCompanyFilter", "customerMasterStateFilter", "customerMasterDistrictFilter"].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.value = "";
  });
  populateCustomerMasterFilterOptions();
  renderCustomerMasterTable();
};

function renderCustomerMasterTable() {
  const body = document.getElementById("customerMasterTableBody");
  if (!body) return;
  populateCustomerMasterFilterOptions();
  const allCustomers = Array.isArray(customersDb) ? customersDb : [];
  const customers = getFilteredCustomerMasterRows();
  const count = document.getElementById("customerMasterFilterCount");
  if (count) count.textContent = customers.length === allCustomers.length
    ? `${customers.length.toLocaleString("en-IN")} customer(s)`
    : `${customers.length.toLocaleString("en-IN")} of ${allCustomers.length.toLocaleString("en-IN")} customer(s)`;
  const emptyMessage = allCustomers.length ? "No customers match the selected filters." : "No customers saved.";
  body.innerHTML = customers.length ? customers.map((customer, index) => `<tr><td>${index + 1}</td><td><strong>${escapeSalesHtml(customer.name)}</strong></td><td>${escapeSalesHtml(customer.person)}</td><td>${escapeSalesHtml(customer.phone)}</td><td>${escapeSalesHtml(customer.email || "-")}</td><td><code>${escapeSalesHtml(customer.gst)}</code></td><td><code>${escapeSalesHtml(customer.pan)}</code></td><td>${escapeSalesHtml(customer.district || "-")}</td><td>${escapeSalesHtml(customer.state || "-")}</td><td>${escapeSalesHtml(formatCustomerMasterAddress(customer))}</td></tr>`).join("") : `<tr><td colspan="10" style="text-align:center; padding:24px; color:var(--muted);">${emptyMessage}</td></tr>`;
}

window.exportCustomerMasterExcel = async function() {
  const customers = getFilteredCustomerMasterRows();
  if (!customers.length) {
    window.showNotification({ title: "No Customer Data", message: "No customers match the selected filters.", type: "warning" });
    return;
  }
  if (!window.ExcelJS) {
    window.showNotification({ title: "Excel Export Unavailable", message: "Refresh the page so the Excel library can load, then try again.", type: "error" });
    return;
  }
  try {
    const companyFilter = String(document.getElementById("customerMasterCompanyFilter")?.value || "").trim();
    const stateFilter = String(document.getElementById("customerMasterStateFilter")?.value || "").trim();
    const districtFilter = String(document.getElementById("customerMasterDistrictFilter")?.value || "").trim();
    const filterLabel = [companyFilter && `Company: ${companyFilter}`, stateFilter && `State: ${stateFilter}`, districtFilter && `District: ${districtFilter}`].filter(Boolean).join(" | ") || "All Customers";
    const workbook = new window.ExcelJS.Workbook();
    workbook.creator = "DemoSolar Industries ERP";
    workbook.created = new Date();
    workbook.subject = "Customer Master";
    const sheet = workbook.addWorksheet("Customer Master", { views: [{ state: "frozen", ySplit: 6, showGridLines: false }] });
    const headers = ["#", "Company Name", "Contact Person", "Contact Number", "E-mail", "GSTIN", "PAN", "Address Line 1", "Address Line 2", "Taluka", "District", "State", "Pincode", "Full Address", "Created By", "Created At"];
    const lastColumn = sheet.getColumn(headers.length).letter;
    sheet.mergeCells("A1:C4");
    [1, 2, 3, 4].forEach(row => sheet.mergeCells(`D${row}:${lastColumn}${row}`));
    sheet.getRow(1).height = 28; sheet.getRow(2).height = 36; sheet.getRow(3).height = 24; sheet.getRow(4).height = 24; sheet.getRow(5).height = 8;
    const logoDataUrl = await getEmbeddedExcelLogo();
    const logoId = workbook.addImage({ base64: logoDataUrl, extension: "png" });
    sheet.addImage(logoId, { tl: { col: 0.15, row: 0.18 }, ext: { width: 300, height: 112 }, editAs: "oneCell" });
    sheet.getCell("D1").value = "DEMOSOLAR INDUSTRIES PRIVATE LIMITED";
    sheet.getCell("D2").value = "CUSTOMER MASTER";
    sheet.getCell("D3").value = `Filters: ${safeReportExportText(filterLabel)} | Records: ${customers.length.toLocaleString("en-IN")}`;
    sheet.getCell("D4").value = `Generated: ${new Date().toLocaleString()} | Generated by: ${safeReportExportText(currentLoggedInUser?.name || currentLoggedInUser?.username || "SYSTEM")}`;
    sheet.getCell("D1").font = { name: "Calibri", size: 12, bold: true, color: { argb: "FF64748B" } };
    sheet.getCell("D2").font = { name: "Calibri", size: 19, bold: true, color: { argb: "FF087FB9" } };
    sheet.getCell("D3").font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF0F766E" } };
    sheet.getCell("D4").font = { name: "Calibri", size: 9, color: { argb: "FF475569" } };
    [1, 2, 3, 4].forEach(row => { sheet.getCell(`D${row}`).alignment = { vertical: "middle", horizontal: "center", wrapText: true }; });
    const headerRow = sheet.getRow(6);
    headerRow.values = headers; headerRow.height = 30;
    headerRow.eachCell(cell => {
      cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F9F95" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = { top: { style: "thin", color: { argb: "FFCBD5E1" } }, left: { style: "thin", color: { argb: "FFCBD5E1" } }, bottom: { style: "thin", color: { argb: "FFCBD5E1" } }, right: { style: "thin", color: { argb: "FFCBD5E1" } } };
    });
    customers.forEach((customer, index) => {
      const row = sheet.addRow([
        index + 1, safeReportExportText(customer.name, ""), safeReportExportText(customer.person, ""), safeReportExportText(customer.phone, ""),
        safeReportExportText(customer.email, ""), safeReportExportText(customer.gst, ""), safeReportExportText(customer.pan, ""),
        safeReportExportText(customer.addressLine1, ""), safeReportExportText(customer.addressLine2, ""), safeReportExportText(customer.taluka, ""),
        safeReportExportText(customer.district, ""), safeReportExportText(customer.state, ""), safeReportExportText(customer.pincode, ""),
        safeReportExportText(formatCustomerMasterAddress(customer), ""), safeReportExportText(customer.createdBy, ""), safeReportExportText(customer.createdAt ? new Date(customer.createdAt).toLocaleString() : "", "")
      ]);
      row.height = 24;
      row.eachCell((cell, columnNumber) => {
        cell.font = { name: "Calibri", size: 10, color: { argb: "FF0F172A" } };
        cell.alignment = { vertical: "middle", horizontal: columnNumber === 2 || columnNumber === 8 || columnNumber === 9 || columnNumber === 14 ? "left" : "center", wrapText: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: index % 2 ? "FFF1F5F9" : "FFFFFFFF" } };
        cell.border = { top: { style: "thin", color: { argb: "FFE2E8F0" } }, left: { style: "thin", color: { argb: "FFE2E8F0" } }, bottom: { style: "thin", color: { argb: "FFE2E8F0" } }, right: { style: "thin", color: { argb: "FFE2E8F0" } } };
      });
    });
    [7, 28, 20, 17, 28, 20, 16, 28, 25, 16, 18, 18, 12, 42, 16, 22].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    sheet.autoFilter = { from: "A6", to: `${lastColumn}${customers.length + 6}` };
    sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    const buffer = await workbook.xlsx.writeBuffer();
    const suffix = [stateFilter, districtFilter, companyFilter].filter(Boolean).join("_").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 70) || "All_Customers";
    downloadXlsxBuffer(buffer, `Customer_Master_${suffix}_${Date.now()}.xlsx`);
    await logEvent("SALES", "CUSTOMER_MASTER_EXPORTED", `Exported ${customers.length} Customer Master record(s) to Excel. Filters: ${filterLabel}.`);
  } catch (error) {
    console.error("Customer Master Excel export error:", error);
    window.showNotification({ title: "Excel Export Failed", message: error.message || "The Customer Master workbook could not be generated.", type: "error" });
  }
};

function populateSalesPersonDropdowns() {
  const activePeople = (salesPeople || []).filter(person => person.status !== "INACTIVE");
  const salesSelect = document.getElementById("salesPersonSelect");
  if (salesSelect) {
    const current = salesSelect.value;
    salesSelect.innerHTML = `<option value="">${activePeople.length ? "-- Select Sales Person --" : "-- Add a Sales Person in Master First --"}</option>` +
      activePeople.map(person => `<option value="${escapeSalesHtml(person.id)}">${escapeSalesHtml(person.name)}</option>`).join("");
    if (activePeople.some(person => String(person.id) === current)) salesSelect.value = current;
  }

  const filterSelect = document.getElementById("salesSheetPersonFilter");
  if (filterSelect) {
    const current = filterSelect.value;
    filterSelect.innerHTML = `<option value="">All Sales Persons</option>` +
      (salesPeople || []).map(person => `<option value="${escapeSalesHtml(person.id)}">${escapeSalesHtml(person.name)}${person.status === "INACTIVE" ? " (Inactive)" : ""}</option>`).join("");
    if ((salesPeople || []).some(person => String(person.id) === current)) filterSelect.value = current;
  }
}

function populateSalesOrderModelDropdown() {
  const select = document.getElementById("salesModelNo");
  if (!select) return;
  const current = select.value;
  const selectedCellType = String(document.getElementById("salesDcrNdcr")?.value || "").trim().toUpperCase();
  const normalizeCellType = value => String(value || "").replace(/[\s-]/g, "").toUpperCase();
  if (!selectedCellType) {
    select.innerHTML = `<option value="">-- Select DCR / NON-DCR First --</option>`;
    return;
  }
  const matchingProducts = (productsDb || []).filter(product => normalizeCellType(product.cellType) === normalizeCellType(selectedCellType));
  select.innerHTML = `<option value="">${matchingProducts.length ? "-- Select Product Model --" : "-- No Matching Products in Catalogue --"}</option>` +
    matchingProducts.map(product => `<option value="${escapeSalesHtml(product.name)}">${escapeSalesHtml(product.name)}</option>`).join("");
  if (matchingProducts.some(product => product.name === current)) select.value = current;
}

function populateSalesOrderWattDropdown(preferredWatt = "") {
  const select = document.getElementById("salesModuleWatt");
  if (!select) return;
  const current = String(preferredWatt || select.value || "");
  const watts = [...new Set((productsDb || []).map(product => salesNumber(product.watt)).filter(watt => watt > 0))].sort((first, second) => first - second);
  select.innerHTML = `<option value="">${watts.length ? "-- Select Module Watt --" : "-- No Wattage in Product Master --"}</option>` +
    watts.map(watt => `<option value="${watt}">${watt} WATT</option>`).join("");
  if (watts.some(watt => String(watt) === current)) select.value = current;
}

window.handleSalesDcrNdcrChange = function() {
  const modelSelect = document.getElementById("salesModelNo");
  if (modelSelect) modelSelect.value = "";
  populateSalesOrderModelDropdown();
  populateSalesOrderWattDropdown();
  window.calculateSalesOrderValue();
};

window.handleSalesModelChange = function() {
  const modelName = String(document.getElementById("salesModelNo")?.value || "");
  const product = (productsDb || []).find(item => String(item.name) === modelName);
  const productWatt = product ? salesNumber(product.watt) : "";
  populateSalesOrderWattDropdown(productWatt);
  window.calculateSalesOrderValue();
};

function getNextSalesOrderSerial() {
  return (salesOrders || []).reduce((highest, order) => Math.max(highest, Number(order.serialNo) || 0), 0) + 1;
}

// ================= SALES: PPC PO / STOCK TO CO ALLOCATION =================
// A PPC PO can be created for stock first, then split between several compatible
// customer orders. Allocations are reservation records, never a replacement for
// the PO, pallet, serial or dispatch records.
function coAllocationKey(value) {
  return String(value || "").trim().toUpperCase();
}

function getPoCellType(po) {
  const direct = String(po?.cellType || po?.dcrNdcr || "").trim();
  if (direct) return direct;
  return String((productsDb || []).find(product => String(product.name || "").trim() === String(po?.product || "").trim())?.cellType || "").trim();
}

function isPoCompatibleWithSalesOrder(po, order) {
  if (!po || !order) return false;
  const poModel = coAllocationKey(po.product);
  const coModel = coAllocationKey(order.modelNo);
  const poWatt = salesNumber(po.watt);
  const coWatt = salesNumber(order.moduleWatt || order.wpModule);
  const poCellType = coAllocationKey(getPoCellType(po)).replace(/[\s-]/g, "");
  const coCellType = coAllocationKey(order.dcrNdcr).replace(/[\s-]/g, "");
  return Boolean(poModel && coModel && poModel === coModel && poWatt > 0 && poWatt === coWatt && (!poCellType || !coCellType || poCellType === coCellType));
}

function getApprovedAllocationQty({ poNumber = "", coNumber = "" } = {}) {
  const poKey = coAllocationKey(poNumber);
  const coKey = coAllocationKey(coNumber);
  return (coAllocations || []).filter(allocation => {
    if (String(allocation.status || "RESERVED").toUpperCase() === "CANCELLED") return false;
    return (!poKey || coAllocationKey(allocation.poNumber) === poKey) && (!coKey || coAllocationKey(allocation.coNumber) === coKey);
  }).reduce((sum, allocation) => sum + salesNumber(allocation.qty), 0);
}

function getPendingAllocationQty({ poNumber = "", coNumber = "" } = {}) {
  const poKey = coAllocationKey(poNumber);
  const coKey = coAllocationKey(coNumber);
  return (requestsDb || []).filter(request => request.status === "PENDING" && request.type === "ALLOCATE_PO_TO_CO").filter(request => {
    const proposed = request.payload || {};
    return (!poKey || coAllocationKey(proposed.poNumber) === poKey) && (!coKey || coAllocationKey(proposed.coNumber) === coKey);
  }).reduce((sum, request) => sum + salesNumber(request.payload?.qty), 0);
}

function getCoAvailableToAllocate(order, includePending = true) {
  if (!order) return 0;
  const dispatched = salesNumber(getSalesOrderDispatchStats(order.coNumber).qty);
  const reserved = getApprovedAllocationQty({ coNumber: order.coNumber });
  const pending = includePending ? getPendingAllocationQty({ coNumber: order.coNumber }) : 0;
  return Math.max(0, salesNumber(order.totalOrderQty) - dispatched - reserved - pending);
}

function getPoAvailableToAllocate(po, includePending = true) {
  if (!po) return 0;
  const reserved = getApprovedAllocationQty({ poNumber: po.poNumber });
  const pending = includePending ? getPendingAllocationQty({ poNumber: po.poNumber }) : 0;
  return Math.max(0, salesNumber(po.qty) - reserved - pending);
}

window.populateCoAllocationCoSelect = function() {
  const select = document.getElementById("coAllocationCo");
  if (!select) return;
  const previous = select.value;
  const eligible = (salesOrders || []).filter(order => getCoAvailableToAllocate(order, true) > 0);
  select.innerHTML = `<option value="">${eligible.length ? "-- Select Customer Order / CO --" : "-- No CO has quantity available for allocation --"}</option>` + eligible.map(order => {
    const available = getCoAvailableToAllocate(order, true);
    return `<option value="${escapeSalesHtml(order.id)}">${escapeSalesHtml(order.coNumber)} — ${escapeSalesHtml(order.customerName)} | ${escapeSalesHtml(order.modelNo)} | ${salesNumber(order.moduleWatt || order.wpModule)}W | Available: ${available.toLocaleString("en-IN")}</option>`;
  }).join("");
  if (eligible.some(order => String(order.id) === String(previous))) select.value = previous;
  window.populateCoAllocationPoSelect();
};

window.populateCoAllocationPoSelect = function() {
  const coSelect = document.getElementById("coAllocationCo");
  const poSelect = document.getElementById("coAllocationPo");
  if (!poSelect) return;
  const previous = poSelect.value;
  const order = (salesOrders || []).find(item => String(item.id) === String(coSelect?.value || ""));
  if (!order) {
    poSelect.innerHTML = '<option value="">-- Select CO First --</option>';
    window.previewCoAllocation();
    return;
  }
  const compatible = (poDatabase || []).filter(po => isPoCompatibleWithSalesOrder(po, order) && getPoAvailableToAllocate(po, true) > 0);
  poSelect.innerHTML = `<option value="">${compatible.length ? "-- Select Compatible PPC PO / Stock --" : "-- No compatible PPC PO quantity available --"}</option>` + compatible.map(po => {
    const available = getPoAvailableToAllocate(po, true);
    return `<option value="${escapeSalesHtml(po.poNumber)}">PO ${escapeSalesHtml(po.poNumber)} | ${escapeSalesHtml(po.product)} | ${salesNumber(po.watt)}W | Available: ${available.toLocaleString("en-IN")}</option>`;
  }).join("");
  if (compatible.some(po => String(po.poNumber) === String(previous))) poSelect.value = previous;
  window.previewCoAllocation();
};

window.previewCoAllocation = function() {
  const preview = document.getElementById("coAllocationPreview");
  if (!preview) return;
  const order = (salesOrders || []).find(item => String(item.id) === String(document.getElementById("coAllocationCo")?.value || ""));
  const po = (poDatabase || []).find(item => coAllocationKey(item.poNumber) === coAllocationKey(document.getElementById("coAllocationPo")?.value));
  const qty = salesNumber(document.getElementById("coAllocationQty")?.value);
  if (!order) {
    preview.style.cssText = "margin-top:10px; padding:12px; border:1px solid #bfdbfe; background:#eff6ff; border-radius:7px; color:#1d4ed8; font-size:12px;";
    preview.textContent = "Select a CO first. Only matching model, wattage and DCR/Non-DCR PPC POs can be reserved.";
    return;
  }
  if (!po) {
    preview.style.cssText = "margin-top:10px; padding:12px; border:1px solid #fcd34d; background:#fffbeb; border-radius:7px; color:#92400e; font-size:12px;";
    preview.textContent = `CO ${order.coNumber} can still receive ${getCoAvailableToAllocate(order, true).toLocaleString("en-IN")} module(s). Select a compatible PPC PO.`;
    return;
  }
  const coAvailable = getCoAvailableToAllocate(order, true);
  const poAvailable = getPoAvailableToAllocate(po, true);
  const permitted = Math.min(coAvailable, poAvailable);
  const valid = qty > 0 && qty <= permitted;
  preview.style.cssText = `margin-top:10px; padding:12px; border:1px solid ${valid || !qty ? "#bfdbfe" : "#fecaca"}; background:${valid || !qty ? "#eff6ff" : "#fef2f2"}; border-radius:7px; color:${valid || !qty ? "#1d4ed8" : "#b91c1c"}; font-size:12px;`;
  preview.innerHTML = `<strong>CO available:</strong> ${coAvailable.toLocaleString("en-IN")} &nbsp; | &nbsp; <strong>PO available:</strong> ${poAvailable.toLocaleString("en-IN")} &nbsp; | &nbsp; <strong>Maximum this request:</strong> ${permitted.toLocaleString("en-IN")}${qty ? ` &nbsp; | &nbsp; <strong>Requested:</strong> ${qty.toLocaleString("en-IN")}${valid ? " ✓" : " — exceeds the available quantity"}` : ""}`;
};

window.submitCoAllocationRequest = async function() {
  const order = (salesOrders || []).find(item => String(item.id) === String(document.getElementById("coAllocationCo")?.value || ""));
  const po = (poDatabase || []).find(item => coAllocationKey(item.poNumber) === coAllocationKey(document.getElementById("coAllocationPo")?.value));
  const qty = salesNumber(document.getElementById("coAllocationQty")?.value);
  if (!order || !po || !Number.isInteger(qty) || qty <= 0) {
    window.showNotification({ title: "Allocation Details Missing", message: "Select a CO, a compatible PPC PO, and a whole-module quantity greater than zero.", type: "warning" });
    return;
  }
  if (!isPoCompatibleWithSalesOrder(po, order)) {
    window.showNotification({ title: "Product Mismatch", message: "The selected PPC PO does not match this CO's model, wattage, or DCR/Non-DCR requirement.", type: "danger" });
    return;
  }
  const maximum = Math.min(getCoAvailableToAllocate(order, true), getPoAvailableToAllocate(po, true));
  if (qty > maximum) {
    window.showNotification({ title: "Allocation Limit Reached", message: `This request can reserve a maximum of ${maximum.toLocaleString("en-IN")} module(s).`, type: "danger" });
    return;
  }
  const reason = await window.showPromptDialog({ title: "Request PO-to-CO Allocation", message: `Reserve ${qty.toLocaleString("en-IN")} module(s) of PO ${po.poNumber} for CO ${order.coNumber}? The reservation becomes live only after Administrator approval.`, label: "Reason for Allocation *", placeholder: "Example: customer order received against finished-goods stock...", confirmText: "Send for Approval" });
  if (!reason) return;
  const requestId = "REQ-" + Date.now();
  requestsDb.unshift({
    id: requestId, type: "ALLOCATE_PO_TO_CO", targetId: `PO ${po.poNumber} → CO ${order.coNumber}`,
    details: `${po.product} | ${salesNumber(po.watt)}W | ${qty.toLocaleString("en-IN")} module(s)`,
    payload: { salesOrderId: order.id, coNumber: order.coNumber, poNumber: po.poNumber, qty, model: po.product, watt: salesNumber(po.watt), dcrNdcr: getPoCellType(po) },
    requestedBy: currentLoggedInUser?.username || "OPERATOR", requestedAt: new Date().toLocaleString(), reason, status: "PENDING", reviewedBy: "-", reviewedAt: "-", adminRemark: "-"
  });
  const requestSaved = await saveStorage(KEY_REQUESTS, requestsDb);
  if (!requestSaved) {
    requestsDb = requestsDb.filter(request => request.id !== requestId);
    window.showNotification({ title: "Allocation Request Not Saved", message: "The request could not be saved to the live database. Check your User Rights or connection, then try again.", type: "danger" });
    return;
  }
  await logEvent("SALES", "PO_TO_CO_ALLOCATION_REQUESTED", `Requested ${qty} module(s) from PO ${po.poNumber} for CO ${order.coNumber}.`);
  window.showNotification({ title: "Allocation Request Submitted", message: `PO ${po.poNumber} will be reserved for CO ${order.coNumber} only after Administrator approval.`, type: "warning" });
  document.getElementById("coAllocationQty").value = "";
  window.populateCoAllocationCoSelect();
  window.renderCoAllocationTable();
};

window.renderCoAllocationTable = function() {
  const tbody = document.getElementById("coAllocationTableBody");
  if (!tbody) return;
  const approved = (coAllocations || []).map(allocation => ({ ...allocation, requestStatus: allocation.status || "RESERVED", audit: `${allocation.approvedAt || allocation.createdAt || "-"}${allocation.approvedBy ? ` by ${allocation.approvedBy}` : ""}` }));
  const pending = (requestsDb || []).filter(request => request.type === "ALLOCATE_PO_TO_CO" && request.status === "PENDING").map(request => ({ ...request.payload, requestStatus: "PENDING APPROVAL", audit: `Request ${request.id}`, createdBy: request.requestedBy, createdAt: request.requestedAt }));
  const rows = [...pending, ...approved];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:24px; color:var(--muted);">No PO-to-CO allocations or pending allocation requests.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(row => `<tr><td><strong style="color:${row.requestStatus === "PENDING APPROVAL" ? "#b45309" : "#059669"};">${escapeSalesHtml(row.requestStatus)}</strong></td><td><strong>${escapeSalesHtml(row.coNumber)}</strong></td><td>${escapeSalesHtml(row.poNumber)}</td><td>${escapeSalesHtml(row.model)} / ${salesNumber(row.watt)}W</td><td style="font-weight:800;">${salesNumber(row.qty).toLocaleString("en-IN")}</td><td>${escapeSalesHtml(row.audit || row.createdAt || "-")}</td><td>${escapeSalesHtml(row.createdBy || "-")}</td></tr>`).join("");
};

window.populateCo360Search = function() {
  const list = document.getElementById("co360CoList");
  if (!list) return;
  list.innerHTML = (salesOrders || []).map(order => `<option value="${escapeSalesHtml(order.coNumber)}">${escapeSalesHtml(order.customerName)} | ${escapeSalesHtml(order.modelNo)} | ${salesNumber(order.totalOrderQty).toLocaleString("en-IN")} modules</option>`).join("");
};

function co360PalletPo(pallet) {
  return String(pallet?.po || pallet?.fullRows?.[0]?.po || "").trim();
}

function co360PalletQty(pallet) {
  return salesNumber(pallet?.count || (pallet?.serials || pallet?.fullRows || []).length);
}

function co360PalletSerials(pallet) {
  return (pallet?.serials || (pallet?.fullRows || []).map(row => typeof row === "object" ? row.serial : row) || []).map(value => String(value || "").trim()).filter(Boolean);
}

function co360LinkedPoNumbers(order) {
  const poNumbers = new Set();
  (coAllocations || []).filter(allocation => coAllocationKey(allocation.coNumber) === coAllocationKey(order.coNumber) && String(allocation.status || "RESERVED").toUpperCase() !== "CANCELLED").forEach(allocation => poNumbers.add(String(allocation.poNumber || "").trim()));
  String(order.prodOrderNo || "").split(/[,/;]+/).map(value => value.trim()).filter(Boolean).forEach(value => poNumbers.add(value));
  (dispatchArchive || []).filter(manifest => coAllocationKey(manifest.coNumber) === coAllocationKey(order.coNumber)).forEach(manifest => {
    if (manifest.po && String(manifest.po).toUpperCase() !== "MULTI-PO") poNumbers.add(String(manifest.po).trim());
    (manifest.pallets || []).forEach(pallet => { const po = co360PalletPo(pallet); if (po) poNumbers.add(po); });
  });
  return [...poNumbers].filter(Boolean);
}

window.renderCo360 = function() {
  const container = document.getElementById("co360Details");
  if (!container) return;
  const input = document.getElementById("co360Search");
  const coNumber = String(input?.value || "").trim();
  if (!coNumber) {
    container.style.cssText = "margin-top:14px; padding:14px; border:1px dashed #86efac; border-radius:8px; background:#fff; color:var(--muted); font-size:12px;";
    container.textContent = "Enter a CO Number to view live Sales, PPC, Production, Packing, Warehouse, Dispatch, pallet and serial details.";
    return;
  }
  const order = (salesOrders || []).find(item => coAllocationKey(item.coNumber) === coAllocationKey(coNumber));
  if (!order) {
    container.style.cssText = "margin-top:14px; padding:14px; border:1px solid #fecaca; border-radius:8px; background:#fef2f2; color:#b91c1c; font-size:12px;";
    container.textContent = `No saved Sales CO matches "${coNumber}".`;
    return;
  }
  if (input) input.value = order.coNumber;
  const poNumbers = co360LinkedPoNumbers(order);
  const poSet = new Set(poNumbers.map(coAllocationKey));
  const linkedPos = (poDatabase || []).filter(po => poSet.has(coAllocationKey(po.poNumber)));
  const allocations = (coAllocations || []).filter(allocation => coAllocationKey(allocation.coNumber) === coAllocationKey(order.coNumber));
  const pendingAllocations = (requestsDb || []).filter(request => request.status === "PENDING" && request.type === "ALLOCATE_PO_TO_CO" && coAllocationKey(request.payload?.coNumber) === coAllocationKey(order.coNumber));
  const warehousePallets = (godownStock || []).filter(pallet => poSet.has(coAllocationKey(co360PalletPo(pallet))));
  const dispatches = (dispatchArchive || []).filter(manifest => coAllocationKey(manifest.coNumber) === coAllocationKey(order.coNumber));
  const dispatchedPallets = dispatches.flatMap(manifest => (manifest.pallets || []).map(pallet => ({ ...pallet, __manifest: manifest })));
  const dispatchedQty = getSalesOrderDispatchStats(order.coNumber).qty;
  const reservedQty = getApprovedAllocationQty({ coNumber: order.coNumber });
  const producedQty = linkedPos.reduce((sum, po) => sum + salesNumber(getProductionRow(po.poNumber)?.daily?.qty), 0);
  const warehouseQty = warehousePallets.reduce((sum, pallet) => sum + co360PalletQty(pallet), 0);
  const packedPallets = [...warehousePallets, ...dispatchedPallets];
  const packedByPallet = new Map();
  packedPallets.forEach((pallet, index) => {
    const key = normalizePackingId(pallet.pallet) || `${co360PalletPo(pallet)}-${index}`;
    if (!packedByPallet.has(key)) packedByPallet.set(key, pallet);
  });
  const packedQty = [...packedByPallet.values()].reduce((sum, pallet) => sum + co360PalletQty(pallet), 0);
  const allSerials = [...new Set([...packedByPallet.values()].flatMap(co360PalletSerials))];
  const pendingQty = Math.max(0, salesNumber(order.totalOrderQty) - dispatchedQty);
  const allocationRows = [...allocations.map(row => ({ ...row, statusLabel: row.status || "RESERVED", audit: `${row.approvedAt || row.createdAt || "-"}${row.approvedBy ? ` by ${row.approvedBy}` : ""}` })), ...pendingAllocations.map(request => ({ ...request.payload, statusLabel: "PENDING APPROVAL", audit: `Request ${request.id}` }))];
  const poRows = linkedPos.map(po => {
    const row = getProductionRow(po.poNumber);
    const poWarehouse = warehousePallets.filter(pallet => coAllocationKey(co360PalletPo(pallet)) === coAllocationKey(po.poNumber));
    const poDispatch = dispatchedPallets.filter(pallet => coAllocationKey(co360PalletPo(pallet)) === coAllocationKey(po.poNumber));
    const poPacked = [...poWarehouse, ...poDispatch].reduce((sum, pallet) => sum + co360PalletQty(pallet), 0);
    return `<tr><td><strong>${escapeSalesHtml(po.poNumber)}</strong></td><td>${escapeSalesHtml(po.product)}</td><td>${salesNumber(po.watt)}W</td><td>${salesNumber(po.qty).toLocaleString("en-IN")}</td><td>${escapeSalesHtml(row?.productionStatus || "Not in Production Sheet")}</td><td>${salesNumber(row?.daily?.qty).toLocaleString("en-IN")}</td><td>${poPacked.toLocaleString("en-IN")}</td><td>${poWarehouse.reduce((sum, pallet) => sum + co360PalletQty(pallet), 0).toLocaleString("en-IN")}</td><td>${poDispatch.reduce((sum, pallet) => sum + co360PalletQty(pallet), 0).toLocaleString("en-IN")}</td></tr>`;
  }).join("") || '<tr><td colspan="9" style="text-align:center; padding:12px; color:var(--muted);">No PPC PO has been linked to this CO yet. Create and approve an allocation to establish the traceability link.</td></tr>';
  const palletRows = [...packedByPallet.values()].map(pallet => {
    const serials = co360PalletSerials(pallet);
    return `<tr><td><strong>${escapeSalesHtml(pallet.pallet || "-")}</strong></td><td>${escapeSalesHtml(co360PalletPo(pallet) || "-")}</td><td>${escapeSalesHtml(pallet.grade || "-")}</td><td>${co360PalletQty(pallet).toLocaleString("en-IN")}</td><td>${escapeSalesHtml(serials[0] || "-")}<br>${escapeSalesHtml(serials[serials.length - 1] || "-")}</td><td>${pallet.__manifest ? "Dispatched" : "Warehouse"}</td></tr>`;
  }).join("") || '<tr><td colspan="6" style="text-align:center; padding:12px; color:var(--muted);">No packed pallets are linked through this CO’s PPC POs yet.</td></tr>';
  const dispatchRows = dispatches.map(manifest => `<tr><td>${escapeSalesHtml(manifest.date || "-")}</td><td><strong>${escapeSalesHtml(manifest.challanNo || manifest.invoice || "-")}</strong></td><td>${escapeSalesHtml(manifest.invoice || "-")}</td><td>${escapeSalesHtml(manifest.transporter || "-")}</td><td>${escapeSalesHtml(manifest.vehicle || "-")}</td><td>${salesNumber(manifest.dispatchedQty).toLocaleString("en-IN")}</td><td>${(manifest.pallets || []).map(pallet => escapeSalesHtml(pallet.pallet || "-")).join(", ") || "-"}</td></tr>`).join("") || '<tr><td colspan="7" style="text-align:center; padding:12px; color:var(--muted);">No dispatch has been recorded for this CO.</td></tr>';
  container.style.cssText = "margin-top:14px; padding:14px; border:1px solid #86efac; border-radius:8px; background:#fff; color:var(--text); font-size:12px;";
  container.innerHTML = `<div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:12px;"><div><strong style="font-size:15px; color:#047857;">CO ${escapeSalesHtml(order.coNumber)}</strong><div style="margin-top:3px;">${escapeSalesHtml(order.customerName)} · ${escapeSalesHtml(order.modelNo)} · ${salesNumber(order.moduleWatt || order.wpModule)}W · ${escapeSalesHtml(order.dcrNdcr || "-")}</div></div><div><strong>Status:</strong> ${escapeSalesHtml(order.status || "OPEN")}<br><strong>Customer PO:</strong> ${escapeSalesHtml(order.customerPurchaseOrderNo || "-")}</div></div><div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); margin:0 0 14px;"><div class="kpi-card" style="padding:10px;"><div class="kpi-label">ORDERED</div><div class="kpi-value" style="font-size:18px;">${salesNumber(order.totalOrderQty).toLocaleString("en-IN")}</div></div><div class="kpi-card" style="padding:10px;"><div class="kpi-label">RESERVED</div><div class="kpi-value" style="font-size:18px; color:#2563eb;">${reservedQty.toLocaleString("en-IN")}</div></div><div class="kpi-card" style="padding:10px;"><div class="kpi-label">PRODUCED</div><div class="kpi-value" style="font-size:18px; color:#7c3aed;">${producedQty.toLocaleString("en-IN")}</div></div><div class="kpi-card" style="padding:10px;"><div class="kpi-label">PACKED</div><div class="kpi-value" style="font-size:18px; color:#0891b2;">${packedQty.toLocaleString("en-IN")}</div></div><div class="kpi-card" style="padding:10px;"><div class="kpi-label">FG WAREHOUSE</div><div class="kpi-value" style="font-size:18px; color:#059669;">${warehouseQty.toLocaleString("en-IN")}</div></div><div class="kpi-card" style="padding:10px;"><div class="kpi-label">DISPATCHED</div><div class="kpi-value" style="font-size:18px; color:#059669;">${dispatchedQty.toLocaleString("en-IN")}</div></div><div class="kpi-card" style="padding:10px;"><div class="kpi-label">CO PENDING</div><div class="kpi-value" style="font-size:18px; color:#b45309;">${pendingQty.toLocaleString("en-IN")}</div></div></div><details open><summary style="cursor:pointer; font-weight:800; color:#075985; margin-bottom:8px;">PPC PO &amp; Production Position (${linkedPos.length})</summary><div style="overflow:auto;"><table class="custom-table" style="min-width:900px;"><thead><tr><th>PPC PO</th><th>MODEL</th><th>WATT</th><th>PO QTY.</th><th>PRODUCTION STATUS</th><th>PRODUCED</th><th>PACKED</th><th>FG</th><th>DISPATCHED</th></tr></thead><tbody>${poRows}</tbody></table></div></details><details style="margin-top:12px;"><summary style="cursor:pointer; font-weight:800; color:#075985; margin-bottom:8px;">Allocation History (${allocationRows.length})</summary><div style="overflow:auto;"><table class="custom-table" style="min-width:760px;"><thead><tr><th>STATUS</th><th>PPC PO</th><th>MODEL / WATT</th><th>QTY.</th><th>REQUEST / APPROVAL</th></tr></thead><tbody>${allocationRows.map(row => `<tr><td>${escapeSalesHtml(row.statusLabel)}</td><td>${escapeSalesHtml(row.poNumber)}</td><td>${escapeSalesHtml(row.model)} / ${salesNumber(row.watt)}W</td><td>${salesNumber(row.qty).toLocaleString("en-IN")}</td><td>${escapeSalesHtml(row.audit)}</td></tr>`).join("") || '<tr><td colspan="5" style="text-align:center; padding:12px; color:var(--muted);">No allocation records.</td></tr>'}</tbody></table></div></details><details style="margin-top:12px;"><summary style="cursor:pointer; font-weight:800; color:#075985; margin-bottom:8px;">Packing Pallets &amp; Serial Ranges (${packedByPallet.size} pallets / ${allSerials.length} serials)</summary><div style="overflow:auto;"><table class="custom-table" style="min-width:760px;"><thead><tr><th>PALLET</th><th>PPC PO</th><th>GRADE</th><th>MODULES</th><th>SERIAL START / END</th><th>LOCATION</th></tr></thead><tbody>${palletRows}</tbody></table></div></details><details style="margin-top:12px;"><summary style="cursor:pointer; font-weight:800; color:#075985; margin-bottom:8px;">Dispatch &amp; Challan History (${dispatches.length})</summary><div style="overflow:auto;"><table class="custom-table" style="min-width:900px;"><thead><tr><th>DATE</th><th>CHALLAN</th><th>INVOICE</th><th>TRANSPORTER</th><th>VEHICLE</th><th>MODULES</th><th>PALLETS</th></tr></thead><tbody>${dispatchRows}</tbody></table></div></details>`;
};

function salesSerialTrackingPalletSerials(pallet) {
  return (pallet?.serials || (pallet?.fullRows || []).map(row => typeof row === "object" ? row.serial : row) || [])
    .map(value => String(value || "").trim()).filter(Boolean);
}

function salesSerialTrackingFindPallet(serial, pallets) {
  const needle = normalizePackingId(serial);
  for (const pallet of pallets || []) {
    if (salesSerialTrackingPalletSerials(pallet).some(value => normalizePackingId(value) === needle)) {
      const row = (pallet.fullRows || []).find(item => normalizePackingId(typeof item === "object" ? item.serial : item) === needle);
      return { pallet, row: typeof row === "object" ? row : null };
    }
  }
  return null;
}

function salesSerialTrackingFindPalletNumber(palletNumber, pallets) {
  const needle = normalizePackingId(palletNumber);
  for (const pallet of pallets || []) {
    if (normalizePackingId(pallet?.pallet) !== needle) continue;
    const firstRow = (pallet.fullRows || []).find(item => typeof item === "object") || null;
    return { pallet, row: firstRow };
  }
  return null;
}

function salesSerialTrackingDate(value) {
  const text = String(value || "").trim();
  if (!text) return "-";
  return typeof reportHubDisplayDate === "function" ? reportHubDisplayDate(text) : text;
}

function salesSerialTrackingSet(id, value, fallback = "-") {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value ?? "").trim() || fallback;
}

function salesSerialTrackingLookup(searchValue) {
  const searchedValue = normalizePackingId(searchValue);
  let warehouseMatch = salesSerialTrackingFindPalletNumber(searchedValue, godownStock || []);
  let dispatchMatch = null;
  let manifest = null;
  for (const item of dispatchArchive || []) {
    const match = salesSerialTrackingFindPalletNumber(searchedValue, item.pallets || []);
    if (match) { dispatchMatch = match; manifest = item; break; }
  }
  const isPalletSearch = Boolean(dispatchMatch || warehouseMatch);
  const matchedPallet = (dispatchMatch || warehouseMatch)?.pallet || null;
  const palletSerials = isPalletSearch ? salesSerialTrackingPalletSerials(matchedPallet) : [];
  const needle = isPalletSearch ? normalizePackingId(palletSerials[0]) : searchedValue;
  const registeredBatch = (storeSerialsDb || []).find(batch =>
    (batch.serials || []).some(value => normalizePackingId(value) === needle)
  ) || null;
  if (!isPalletSearch) {
    warehouseMatch = salesSerialTrackingFindPallet(needle, godownStock || []);
    for (const item of dispatchArchive || []) {
      const match = salesSerialTrackingFindPallet(needle, item.pallets || []);
      if (match) { dispatchMatch = match; manifest = item; break; }
    }
  }
  const match = dispatchMatch || warehouseMatch;
  if (!registeredBatch && !match) return null;
  const pallet = match?.pallet || null;
  const row = match?.row || null;
  const poNumber = String(row?.po || pallet?.po || pallet?.fullRows?.[0]?.po || registeredBatch?.poNumber || registeredBatch?.po || "").trim();
  const po = (poDatabase || []).find(item => coAllocationKey(item.poNumber) === coAllocationKey(poNumber)) || null;
  const invoice = manifest
    ? (accountInvoices || []).find(item => String(item.id || "") === String(manifest.accountInvoiceId || "") || accountInvoiceKey(item.invoiceNumber) === accountInvoiceKey(manifest.invoice)) || null
    : null;
  const coNumber = String(manifest?.coNumber || invoice?.coNumber || "").trim();
  const order = coNumber ? getSalesOrderByCo(coNumber) : null;
  const status = manifest ? "DISPATCHED" : warehouseMatch ? "IN FG WAREHOUSE" : pallet ? "PACKED" : "PPC REGISTERED";
  return { needle, searchedValue, matchedValue: isPalletSearch ? (pallet?.pallet || searchedValue) : needle, searchType: isPalletSearch ? "PALLET" : "SERIAL", palletSerials: isPalletSearch ? palletSerials : [], registeredBatch, warehouseMatch, dispatchMatch, manifest, pallet, row, poNumber, po, invoice, coNumber, order, status };
}

window.trackSalesSerialNumber = function() {
  const input = document.getElementById("salesSerialTrackingInput");
  const searchValue = normalizePackingId(input?.value);
  if (input) input.value = searchValue;
  if (!searchValue) {
    window.showNotification({ title: "Serial or Pallet Required", message: "Scan or enter a module serial number or pallet number first.", type: "warning" });
    input?.focus();
    return;
  }
  const record = salesSerialTrackingLookup(searchValue);
  const empty = document.getElementById("salesSerialTrackingEmpty");
  const result = document.getElementById("salesSerialTrackingResult");
  if (!record) {
    if (result) result.style.display = "none";
    if (empty) {
      empty.style.display = "block";
      empty.innerHTML = `<div style="font-size:34px; margin-bottom:8px;">⌕</div><strong style="display:block; color:#b91c1c; margin-bottom:5px;">Serial or pallet not found</strong>No PPC, packing, warehouse or dispatch record matches <code>${escapeSalesHtml(searchValue)}</code>.`;
    }
    window.showNotification({ title: "Serial or Pallet Not Found", message: `No ERP record matches ${searchValue}.`, type: "danger" });
    return;
  }
  if (empty) empty.style.display = "none";
  if (result) result.style.display = "grid";
  const { registeredBatch, warehouseMatch, manifest, pallet, row, poNumber, po, invoice, coNumber, order, status, searchType, matchedValue, palletSerials } = record;
  const customer = manifest?.customer || invoice?.customerName || order?.customerName || "-";
  const model = manifest?.product || invoice?.modelNo || order?.modelNo || pallet?.model || po?.product || "-";
  const watt = row?.watt || pallet?.watt || invoice?.wattPerModule || order?.moduleWatt || po?.watt || "-";
  const cellType = pallet?.cellType || manifest?.cellType || invoice?.dcrNdcr || order?.dcrNdcr || po?.cellType || "-";
  salesSerialTrackingSet("salesSerialResultMatchLabel", searchType === "PALLET" ? "MATCHED PALLET NUMBER" : "MATCHED SERIAL NUMBER");
  salesSerialTrackingSet("salesSerialResultSerial", matchedValue);
  salesSerialTrackingSet("salesSerialResultJourneyTitle", searchType === "PALLET" ? "Pallet Journey" : "Serial Journey");
  salesSerialTrackingSet("salesSerialResultPo", poNumber);
  salesSerialTrackingSet("salesSerialResultPallet", pallet?.pallet);
  salesSerialTrackingSet("salesSerialResultLocation", manifest ? "Dispatched to customer" : warehouseMatch ? "DemoSolar FG Warehouse" : pallet ? "Packed" : "PPC serial register");
  salesSerialTrackingSet("salesSerialResultCo", coNumber);
  salesSerialTrackingSet("salesSerialResultModel", model);
  salesSerialTrackingSet("salesSerialResultWatt", watt === "-" ? watt : String(watt).toUpperCase().includes("W") ? watt : `${watt} W`);
  salesSerialTrackingSet("salesSerialResultCellType", cellType);
  salesSerialTrackingSet("salesSerialResultGrade", pallet?.grade);
  salesSerialTrackingSet("salesSerialResultRegisteredDate", salesSerialTrackingDate(registeredBatch?.timestamp || registeredBatch?.date));
  salesSerialTrackingSet("salesSerialResultPackedDate", salesSerialTrackingDate(pallet?.date));
  salesSerialTrackingSet("salesSerialResultCustomer", customer);
  salesSerialTrackingSet("salesSerialResultCustomerPo", order?.customerPurchaseOrderNo);
  salesSerialTrackingSet("salesSerialResultInvoice", manifest?.invoice || invoice?.invoiceNumber);
  salesSerialTrackingSet("salesSerialResultInvoiceDate", salesSerialTrackingDate(invoice?.invoiceDate || manifest?.date));
  salesSerialTrackingSet("salesSerialResultSalesPerson", order?.salesPerson);
  salesSerialTrackingSet("salesSerialResultDispatchStatus", status);
  salesSerialTrackingSet("salesSerialResultChallan", manifest?.challanNo || invoice?.challanNo);
  salesSerialTrackingSet("salesSerialResultDispatchDate", salesSerialTrackingDate(manifest?.date));
  salesSerialTrackingSet("salesSerialResultTransporter", manifest?.transporter || invoice?.transporterName);
  salesSerialTrackingSet("salesSerialResultVehicle", manifest?.vehicle || invoice?.vehicleNumber);
  salesSerialTrackingSet("salesSerialResultDriver", [manifest?.driverName, manifest?.driverNo || manifest?.driverPhone].filter(Boolean).join(" / "));
  salesSerialTrackingSet("salesSerialResultLr", manifest?.lrNo || invoice?.lrNo);
  salesSerialTrackingSet("salesSerialResultCustomerWarranty", manifest?.customerWarrantyDue || invoice?.customerWarrantyDue || order?.customerWarrantyDue, "Not configured");
  salesSerialTrackingSet("salesSerialResultCompanyWarranty", manifest?.companyWarrantyDue || invoice?.companyWarrantyDue || order?.companyWarrantyDue, "Not configured");
  salesSerialTrackingSet("salesSerialResultDealerWarranty", manifest?.dealerWarrantyDue || invoice?.dealerWarrantyDue || order?.dealerWarrantyDue, "Not configured");
  salesSerialTrackingSet("salesSerialResultWarrantyReference", manifest?.warrantyReference || invoice?.warrantyReference || order?.warrantyReference);
  const palletModules = document.getElementById("salesSerialPalletModules");
  const palletModuleList = document.getElementById("salesSerialPalletModuleList");
  if (palletModules) palletModules.style.display = searchType === "PALLET" ? "block" : "none";
  dashboardSetText("salesSerialPalletModuleCount", `${palletSerials.length.toLocaleString("en-IN")} MODULE${palletSerials.length === 1 ? "" : "S"}`);
  if (palletModuleList) palletModuleList.innerHTML = palletSerials.length ? palletSerials.map((item, index) => `<span style="padding:5px 8px; border:1px solid #dbe6ed; border-radius:7px; background:#f8fafc; color:#334155; font-size:9px; font-family:monospace;"><b>${index + 1}.</b> ${escapeSalesHtml(item)}</span>`).join("") : '<span style="color:#94a3b8; font-size:10px;">No module serial list is stored for this pallet.</span>';
  const statusBadge = document.getElementById("salesSerialResultStatus");
  if (statusBadge) {
    statusBadge.textContent = status;
    statusBadge.className = `serial-tracker-status ${manifest ? "dispatched" : warehouseMatch ? "warehouse" : pallet ? "packed" : "registered"}`;
  }
  const timeline = document.getElementById("salesSerialResultTimeline");
  if (timeline) {
    const steps = [
      { label: "PPC Registered", done: Boolean(registeredBatch), detail: salesSerialTrackingDate(registeredBatch?.timestamp || registeredBatch?.date) },
      { label: "Pallet Packed", done: Boolean(pallet), detail: pallet ? `${pallet.pallet || "-"} · ${salesSerialTrackingDate(pallet.date)}` : "Pending" },
      { label: "FG Warehouse", done: Boolean(warehouseMatch || manifest), detail: warehouseMatch ? "Available in FG" : manifest ? "Passed through FG" : "Pending" },
      { label: "Invoice", done: Boolean(invoice || manifest?.invoice), detail: invoice?.invoiceNumber || manifest?.invoice || "Pending" },
      { label: "Dispatched", done: Boolean(manifest), detail: manifest ? `${salesSerialTrackingDate(manifest.date)} · ${manifest.vehicle || "-"}` : "Pending" }
    ];
    timeline.innerHTML = steps.map(step => `<div class="serial-tracker-step ${step.done ? "done" : ""}"><b>${step.done ? "✓ " : "○ "}${escapeSalesHtml(step.label)}</b><small>${escapeSalesHtml(step.detail)}</small></div>`).join("");
  }
};

window.clearSalesSerialTracking = function() {
  const input = document.getElementById("salesSerialTrackingInput");
  if (input) input.value = "";
  const result = document.getElementById("salesSerialTrackingResult");
  const empty = document.getElementById("salesSerialTrackingEmpty");
  if (result) result.style.display = "none";
  if (empty) {
    empty.style.display = "block";
    empty.innerHTML = '<div style="font-size:34px; margin-bottom:8px;">▦</div><strong style="display:block; color:#334155; margin-bottom:5px;">Ready to trace a module or pallet</strong>Scan a barcode or type the full serial number or pallet number above.';
  }
  salesSerialTrackingSet("salesSerialResultJourneyTitle", "Serial Journey");
  const palletModules = document.getElementById("salesSerialPalletModules");
  if (palletModules) palletModules.style.display = "none";
  input?.focus();
};

window.prepareSalesSerialTracking = function() {
  const input = document.getElementById("salesSerialTrackingInput");
  if (String(input?.value || "").trim()) window.trackSalesSerialNumber();
  window.setTimeout(() => input?.focus(), 80);
};

window.refreshSalesSerialTracking = function() {
  const input = document.getElementById("salesSerialTrackingInput");
  if (String(input?.value || "").trim()) window.trackSalesSerialNumber();
};

function setSalesCertificateUploadStatus(message, color = "var(--muted)") {
  const status = document.getElementById("salesCertificateUploadStatus");
  if (!status) return;
  status.textContent = message;
  status.style.color = color;
}

function readSalesCertificateFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, data: reader.result });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

window.uploadSalesCertificates = async function(input) {
  const files = Array.from(input?.files || []);
  const coNumber = salesCoKey(document.getElementById("salesCoNumber")?.value);
  const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
  const allowedExtensions = /\.(pdf|jpe?g|png)$/i;

  if (!coNumber) {
    window.showNotification({ title: "CO Number Required", message: "Enter the CO Number before uploading its certificate.", type: "warning" });
    if (input) input.value = "";
    document.getElementById("salesCoNumber")?.focus();
    return;
  }
  if (!files.length) return;
  const invalidFile = files.find(file => (!allowedTypes.has(file.type) && !allowedExtensions.test(file.name)) || file.size > 10 * 1024 * 1024);
  if (invalidFile) {
    window.showNotification({ title: "Certificate File Blocked", message: "Only PDF, JPG, JPEG, or PNG files up to 10 MB each are allowed.", type: "warning" });
    if (input) input.value = "";
    return;
  }

  setSalesCertificateUploadStatus("Uploading certificate...", "#0284c7");
  try {
    const certificateFiles = await Promise.all(files.map(readSalesCertificateFile));
    const response = await erpFetchWithTimeout("backend/api.php?action=upload_sales_certificates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coNumber, files: certificateFiles })
    }, 120000);
    const data = await response.json();
    if (!response.ok || data?.status !== "SUCCESS" || !Array.isArray(data.saved)) {
      throw new Error(data?.message || "Certificate upload failed.");
    }
    const existingOrder = getSalesOrderByCo(coNumber);
    if (existingOrder) {
      const existingPaths = Array.isArray(existingOrder.performanceCertificate)
        ? existingOrder.performanceCertificate
        : String(existingOrder.performanceCertificate || "").split(",").map(path => path.trim()).filter(Boolean);
      existingOrder.performanceCertificate = [...new Set([...existingPaths, ...data.saved])].join(", ");
      await saveStorage(KEY_SALES_ORDERS, salesOrders);
      await syncSalesOrderDispatchTotals();
      const isClosed = existingOrder.status === "CLOSED";
      setSalesCertificateUploadStatus(
        isClosed
          ? `✓ Certificate saved. CO ${coNumber} is now CLOSED.`
          : `✓ Certificate saved. CO ${coNumber} will close after its pending quantity is dispatched.`,
        "#059669"
      );
      window.showNotification({
        title: isClosed ? "CO Closed" : "Certificate Uploaded",
        message: isClosed
          ? `CO Number ${coNumber} is fully dispatched and is now closed. Its record remains permanently in Sales Sheet.`
          : `Saved ${data.saved.length} file(s) for CO Number ${coNumber}. Pending dispatch is still required before closure.`,
        type: "success"
      });
      populateDispatchCoDropdown();
      renderSalesOrdersTable();
      return;
    }
    if (salesCertificateCoNumber && salesCertificateCoNumber !== coNumber) salesCertificatePaths = [];
    salesCertificateCoNumber = coNumber;
    salesCertificatePaths = [...salesCertificatePaths, ...data.saved];
    setSalesCertificateUploadStatus(`✓ ${data.saved.length} certificate file(s) saved in certificate/${coNumber}/`, "#059669");
    window.showNotification({ title: "Certificate Uploaded", message: `Saved ${data.saved.length} file(s) for CO Number ${coNumber}.`, type: "success" });
  } catch (error) {
    console.error("Sales certificate upload error:", error);
    setSalesCertificateUploadStatus("✕ Upload failed. Check the certificate folder and server permissions.", "#dc2626");
    window.showNotification({ title: "Certificate Upload Failed", message: error.message || "Could not save the certificate.", type: "danger" });
  } finally {
    if (input) input.value = "";
  }
};

function setSalesOrderFormMode(order = null) {
  const isEditing = Boolean(order);
  const title = document.getElementById("salesOrderFormTitle");
  const hint = document.getElementById("salesOrderFormHint");
  const saveButton = document.getElementById("btnSaveSalesOrder");
  const coInput = document.getElementById("salesCoNumber");
  if (title) title.textContent = isEditing ? "EDIT SALES ORDER DETAILS" : "ADD SALES ORDER DETAILS";
  if (hint) hint.textContent = isEditing
    ? `Preparing an edit request for CO ${order.coNumber}. The correction is applied only after Administrator approval.`
    : "CO Number must be unique. Add at least one product before saving the Sales Order.";
  if (saveButton) saveButton.textContent = isEditing ? "🛡️ Send Edit Request for Approval" : "💾 Save Sales Order";
  if (coInput) {
    coInput.readOnly = isEditing;
    coInput.style.background = isEditing ? "#f8fafc" : "";
    coInput.title = isEditing ? "CO Number cannot be changed after the Sales Order is created." : "";
  }
}

function salesOrderSelectionSummary(order) {
  if (!order) return "Enter a C/O Number to display its saved data.";
  const value = input => escapeSalesHtml(input || "-");
  const status = value(order.status || "PENDING");
  const products = normalizeSalesOrderProductLines(order).map((line, index) =>
    `<div style="padding:7px 0;${index ? "border-top:1px solid #e2e8f0;" : ""}"><strong>${index + 1}. ${value(line.modelNo)}</strong> · ${salesNumber(line.moduleWatt).toLocaleString("en-IN")} W · ${value(line.dcrNdcr)}<br>Qty ${salesNumber(line.totalOrderQty).toLocaleString("en-IN")} · ₹${salesNumber(line.rateWp).toLocaleString("en-IN", { maximumFractionDigits: 2 })}/W · Invoice ₹${salesNumber(line.invoiceValue).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>`
  ).join("");
  return `<div style="color:#334155;">
    <div class="grid-2" style="gap:14px;">
      <div><strong>C/O Number:</strong> ${value(order.coNumber)}<br><strong>Order Date:</strong> ${value(order.orderDate)}<br><strong>Customer:</strong> ${value(order.customerName)}<br><strong>Sales Person:</strong> ${value(order.salesPerson)}</div>
      <div><strong>Total Quantity:</strong> ${salesNumber(order.totalOrderQty).toLocaleString("en-IN")}<br><strong>Dispatched:</strong> ${salesNumber(order.dispatchQty).toLocaleString("en-IN")}<br><strong>Pending:</strong> ${salesNumber(order.pendingQty).toLocaleString("en-IN")}<br><strong>Status:</strong> ${status}</div>
    </div>
    <div style="margin-top:12px; padding-top:10px; border-top:1px solid #e2e8f0;"><strong>Saved Products</strong>${products || "<div>-</div>"}</div>
  </div>`;
}

function renumberSalesOrderSerials() {
  salesOrders
    .slice()
    .sort((first, second) => salesNumber(first.serialNo) - salesNumber(second.serialNo))
    .forEach((remainingOrder, index) => { remainingOrder.serialNo = index + 1; });
}

function populateSalesOrderSelect(selectId, infoId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const current = select.value;
  const orders = salesOrders || [];
  select.innerHTML = `<option value="">${orders.length ? "-- Select Sales Order --" : "-- No Sales Orders Available --"}</option>` + orders.map(order =>
    `<option value="${escapeSalesHtml(order.id)}">${escapeSalesHtml(order.coNumber)} — ${escapeSalesHtml(order.customerName)} (${salesNumber(order.totalOrderQty).toLocaleString("en-IN")} modules)</option>`
  ).join("");
  if (orders.some(order => String(order.id) === String(current))) select.value = current;
  const info = document.getElementById(infoId);
  if (info) info.innerHTML = salesOrderSelectionSummary(orders.find(order => String(order.id) === String(select.value)));
}

window.populateSalesOrderEditSelect = function() {
  const input = document.getElementById("editSalesOrderCoInput");
  const list = document.getElementById("editSalesOrderCoList");
  if (!input || !list) return;
  const current = input.value;
  list.innerHTML = (salesOrders || [])
    .slice()
    .sort((first, second) => String(first.coNumber || "").localeCompare(String(second.coNumber || ""), undefined, { numeric: true }))
    .map(order => `<option value="${escapeSalesHtml(order.coNumber)}">${escapeSalesHtml(order.customerName || "")} — ${salesNumber(order.totalOrderQty).toLocaleString("en-IN")} modules</option>`)
    .join("");
  input.value = current;
  window.previewSalesOrderForEdit();
};

window.populateSalesOrderDeleteSelect = function() {
  populateSalesOrderSelect("deleteSalesOrderSelect", "deleteSalesOrderInfo");
};

window.previewSalesOrderForEdit = function() {
  const input = document.getElementById("editSalesOrderCoInput");
  const info = document.getElementById("editSalesOrderInfo");
  const button = document.getElementById("btnLoadSalesOrderEdit");
  if (!input || !info || !button) return;
  const entered = String(input.value || "").trim();
  const order = getSalesOrderByCo(entered);
  if (!entered) {
    info.innerHTML = "Enter a C/O Number to display its saved data.";
    button.style.display = "none";
    return;
  }
  if (!order) {
    const matches = (salesOrders || []).filter(item => salesCoKey(item.coNumber).includes(salesCoKey(entered))).slice(0, 8);
    info.innerHTML = matches.length
      ? `<strong>${matches.length} matching C/O number(s):</strong><br>${matches.map(item => escapeSalesHtml(item.coNumber)).join(" · ")}<br><span style="color:var(--muted);">Select the complete C/O number from the suggestions.</span>`
      : `<span style="color:#b91c1c; font-weight:700;">No active Sales Order was found for C/O ${escapeSalesHtml(entered)}.</span>`;
    button.style.display = "none";
    return;
  }
  input.value = order.coNumber;
  info.innerHTML = salesOrderSelectionSummary(order);
  button.style.display = "flex";
};

window.previewSalesOrderForDelete = function() {
  populateSalesOrderSelect("deleteSalesOrderSelect", "deleteSalesOrderInfo");
};

window.openSalesOrderEditView = function(button) {
  switchView("salesOrderEdit", button, "Sales Order > Edit Order");
  const input = document.getElementById("editSalesOrderCoInput");
  if (input) input.value = "";
  window.previewSalesOrderForEdit();
};

window.openSalesOrderDeleteView = function(button) {
  switchView("salesOrderDelete", button, "Sales Order > Delete Order");
};

window.loadSelectedSalesOrderForEditing = async function() {
  const coNumber = String(document.getElementById("editSalesOrderCoInput")?.value || "").trim();
  const order = getSalesOrderByCo(coNumber);
  if (!order) {
    window.showNotification({ title: "C/O Number Required", message: "Enter or select a valid active C/O Number first.", type: "warning" });
    return;
  }
  await switchView("salesOrderAdd", document.getElementById("navSub-salesOrderEdit"), "Sales Order > Edit Order");
  editingSalesOrderId = order.id;

  const setValue = (field, value = "") => {
    const element = document.getElementById(field);
    if (element) element.value = value ?? "";
  };
  populateSalesPersonDropdowns();
  populateSalesCustomerDropdown();
  const personSelect = document.getElementById("salesPersonSelect");
  if (personSelect && order.salesPersonId && !Array.from(personSelect.options).some(option => String(option.value) === String(order.salesPersonId))) {
    personSelect.insertAdjacentHTML("beforeend", `<option value="${escapeSalesHtml(order.salesPersonId)}">${escapeSalesHtml(order.salesPerson || "Previous Sales Person")} (Inactive)</option>`);
  }
  const customerSelect = document.getElementById("salesCustomerSelect");
  const customerValue = order.customerId || `LEGACY-${order.id}`;
  if (customerSelect && !Array.from(customerSelect.options).some(option => String(option.value) === String(customerValue))) {
    customerSelect.insertAdjacentHTML("beforeend", `<option value="${escapeSalesHtml(customerValue)}">${escapeSalesHtml(order.customerName || "Previous Customer")} (Historical)</option>`);
  }
  salesOrderProductLines = normalizeSalesOrderProductLines(order);
  clearSalesOrderProductEntry();
  window.renderSalesOrderProductLines();
  [
    ["salesSrNo", order.serialNo], ["salesCoNumber", order.coNumber], ["salesMonthYear", order.monthYear], ["salesOrderDate", order.orderDate],
    ["salesProdOrderNo", order.prodOrderNo], ["salesCustomerPoNo", order.customerPurchaseOrderNo], ["salesCustomerSelect", customerValue], ["salesCustomerName", order.customerName],
    ["salesContactPerson", order.contactPerson], ["salesContactNumber", order.contactNumber], ["salesEmailId", order.emailId], ["salesCustomerGst", order.customerGst], ["salesCustomerPan", order.customerPan], ["salesCustomerAddress", order.customerAddress],
    ["salesPersonSelect", order.salesPersonId], ["salesFobExFactory", order.fobExFactory],
    ["salesTaxRate", 5], ["salesDispatchMode", order.dispatchMode],
    ["salesTentativeDispatch", order.tentativeDispatch], ["salesActualDispatchDate", order.actualDispatchDate], ["salesBom", order.bom],
    ["salesDispatchQty", order.dispatchQty], ["salesPendingQty", order.pendingQty], ["salesDispatchSource", order.dispatchSource],
    ["salesProductSpecification", order.productSpecification], ["salesRemarks", order.remarks]
  ].forEach(([field, value]) => setValue(field, value));
  salesCertificatePaths = Array.isArray(order.performanceCertificate)
    ? order.performanceCertificate.filter(Boolean)
    : String(order.performanceCertificate || "").split(",").map(path => path.trim()).filter(Boolean);
  salesCertificateCoNumber = order.coNumber;
  setSalesCertificateUploadStatus(salesCertificatePaths.length ? `✓ ${salesCertificatePaths.length} certificate file(s) linked to this CO.` : "No certificate uploaded.");
  setSalesOrderFormMode(order);
  window.calculateSalesOrderValue();
};

window.deleteSelectedSalesOrder = async function() {
  const id = String(document.getElementById("deleteSalesOrderSelect")?.value || "");
  const order = (salesOrders || []).find(item => String(item.id) === id);
  if (!order) {
    window.showNotification({ title: "Sales Order Required", message: "Select a Sales Order to delete.", type: "warning" });
    return;
  }
  const dispatchedQty = Math.max(salesNumber(order.dispatchQty), salesNumber(getSalesOrderDispatchStats(order.coNumber).qty));
  if (dispatchedQty > 0) {
    window.showNotification({ title: "Order Cannot Be Deleted", message: `CO ${order.coNumber} has dispatched quantity. Its historical record must remain in Sales Sheet.`, type: "warning" });
    return;
  }
  const coKey = salesCoKey(order.coNumber);
  const linkedRecords = [
    ["Accounts invoice", (accountInvoices || []).some(item => salesCoKey(item.coNumber) === coKey)],
    ["receipt", (accountReceiptsDb || []).some(item => salesCoKey(item.coNumber) === coKey)],
    ["stock booking", (stockBookings || []).some(item => salesCoKey(item.coNumber) === coKey || String(item.salesOrderId || "") === String(order.id))],
    ["vehicle booking", (vehicleBookingsDb || []).some(item => salesCoKey(item.coNumber) === coKey || String(item.salesOrderId || "") === String(order.id))]
  ].filter(([, exists]) => exists).map(([label]) => label);
  if (linkedRecords.length) {
    window.showNotification({ title: "Order Cannot Be Deleted", message: `CO ${order.coNumber} has linked ${linkedRecords.join(", ")} record(s). Those permanent transactions must not be disconnected or overwritten.`, type: "warning" });
    return;
  }
  const alreadyPending = (requestsDb || []).some(request =>
    request.status === "PENDING" &&
    ["EDIT_SALES_ORDER", "DELETE_SALES_ORDER"].includes(request.type) &&
    String(request.payload?.salesOrderId) === String(order.id)
  );
  if (alreadyPending) {
    window.showNotification({ title: "Request Already Pending", message: `CO ${order.coNumber} already has an edit or deletion request waiting for Administrator approval.`, type: "warning" });
    return;
  }
  const reason = await window.showPromptDialog({
    title: "Request Sales Order Deletion",
    message: `Send a deletion request for CO ${order.coNumber}? An Administrator must approve it before anything is deleted.`,
    label: "Reason for Deletion *",
    placeholder: "Example: duplicate CO entry, cancelled order...",
    confirmText: "Send for Approval",
    isDanger: true
  });
  if (!reason) return;
  requestsDb.unshift({
    id: "REQ-" + Date.now(),
    type: "DELETE_SALES_ORDER",
    targetId: `CO ${order.coNumber}`,
    details: `${order.customerName} | ${order.modelNo} | ${salesNumber(order.totalOrderQty).toLocaleString("en-IN")} modules | SR. NO. ${order.serialNo}`,
    payload: { salesOrderId: order.id, coNumber: order.coNumber },
    requestedBy: currentLoggedInUser ? currentLoggedInUser.username : "OPERATOR",
    requestedAt: new Date().toLocaleString(),
    reason,
    status: "PENDING",
    reviewedBy: "-",
    reviewedAt: "-",
    adminRemark: "-"
  });
  await saveStorage(KEY_REQUESTS, requestsDb);
  logEvent("SALES", "SALES_ORDER_DELETE_REQUESTED", `Requested deletion of Sales Order CO ${order.coNumber}.`);
  window.showNotification({ title: "Deletion Request Submitted", message: `CO ${order.coNumber} will be deleted only after Administrator approval.`, type: "warning" });
  populateSalesOrderDeleteSelect();
};

window.resetSalesOrderForm = function() {
  editingSalesOrderId = "";
  salesOrderProductLines = [];
  setSalesOrderFormMode();
  const setValue = (id, value = "") => {
    const element = document.getElementById(id);
    if (element) element.value = value;
  };
  [
    "salesCoNumber", "salesProdOrderNo", "salesCustomerPoNo", "salesCustomerSelect", "salesCustomerName", "salesContactPerson", "salesContactNumber", "salesEmailId", "salesCustomerGst", "salesCustomerPan", "salesCustomerAddress",
    "salesModelNo", "salesModuleWatt", "salesRateWp", "salesPricePerModule", "salesFobExFactory", "salesTotalWatts", "salesTotalOrderQty", "salesTotalOrderValue", "salesTaxAmount", "salesInvoiceValue", "salesTentativeDispatch",
    "salesActualDispatchDate", "salesBom", "salesProductSpecification", "salesPerformanceCertificate", "salesRemarks"
  ].forEach(id => setValue(id));
  setValue("salesSrNo", getNextSalesOrderSerial());
  setValue("salesMonthYear", getSalesMonthYear());
  setValue("salesOrderDate", getFormattedToday());
  setValue("salesDispatchQty", "0");
  setValue("salesPendingQty", "0");
  ["salesPersonSelect", "salesDcrNdcr", "salesDispatchMode", "salesDispatchSource"].forEach(id => setValue(id));
  setValue("salesTaxRate", "5");
  salesCertificatePaths = [];
  salesCertificateCoNumber = "";
  setSalesCertificateUploadStatus("No certificate uploaded.");
  populateSalesPersonDropdowns();
  populateSalesCustomerDropdown();
  populateSalesOrderModelDropdown();
  populateSalesOrderWattDropdown();
  window.renderSalesOrderProductLines();
};

window.calculateSalesOrderValue = function() {
  const watt = salesNumber(document.getElementById("salesModuleWatt")?.value);
  const rateInput = document.getElementById("salesRateWp");
  const rateIsEntered = String(rateInput?.value || "").trim() !== "";
  const rate = salesNumber(rateInput?.value);
  const totalQty = salesNumber(document.getElementById("salesTotalOrderQty")?.value);
  const taxRate = salesNumber(document.getElementById("salesTaxRate")?.value);
  const pricePerModuleOutput = document.getElementById("salesPricePerModule");
  const totalOutput = document.getElementById("salesTotalOrderValue");
  const taxOutput = document.getElementById("salesTaxAmount");
  const invoiceOutput = document.getElementById("salesInvoiceValue");
  const totalWattsOutput = document.getElementById("salesTotalWatts");
  if (!totalOutput) return;

  // Price per Module depends only on Watt / Module and Rate / Watt.
  const pricePerModule = watt > 0 && rateIsEntered && rate >= 0 ? watt * rate : 0;
  if (pricePerModuleOutput) pricePerModuleOutput.value = watt > 0 && rateIsEntered ? pricePerModule.toFixed(2) : "";

  // Quantity is needed only for the total-watt, total-value, tax and invoice rows.
  if (totalWattsOutput) totalWattsOutput.value = watt > 0 && totalQty > 0
    ? (watt * totalQty).toLocaleString("en-IN", { maximumFractionDigits: 2 })
    : "";
  if (!rateIsEntered || totalQty <= 0) {
    totalOutput.value = "";
    if (taxOutput) taxOutput.value = "";
    if (invoiceOutput) invoiceOutput.value = "";
    return;
  }

  const totalValue = pricePerModule * totalQty;
  const taxAmount = totalValue * (taxRate / 100);
  totalOutput.value = totalValue.toFixed(2);
  if (taxOutput) taxOutput.value = taxAmount.toFixed(2);
  if (invoiceOutput) invoiceOutput.value = (totalValue + taxAmount).toFixed(2);
};

window.updateNewSalesOrderQtyPreview = function() {
  const totalQty = salesNumber(document.getElementById("salesTotalOrderQty")?.value);
  const dispatchQty = document.getElementById("salesDispatchQty");
  const pendingQty = document.getElementById("salesPendingQty");
  if (dispatchQty) dispatchQty.value = "0";
  if (pendingQty) pendingQty.value = totalQty || "0";
  window.calculateSalesOrderValue();
};

function normalizeSalesOrderProductLines(order) {
  const savedLines = Array.isArray(order?.lineItems) ? order.lineItems : [];
  if (savedLines.length) {
    return savedLines.map((line, index) => ({
      id: String(line.id || `SOITEM-${order?.id || "LEGACY"}-${index + 1}`),
      dcrNdcr: String(line.dcrNdcr || "").trim(),
      modelNo: String(line.modelNo || "").trim(),
      moduleWatt: salesNumber(line.moduleWatt || line.wpModule),
      rateWp: salesNumber(line.rateWp),
      pricePerModule: salesNumber(line.pricePerModule),
      totalOrderQty: salesNumber(line.totalOrderQty),
      totalWatts: salesNumber(line.totalWatts),
      totalOrderValue: salesNumber(line.totalOrderValue),
      taxRate: salesNumber(line.taxRate),
      taxAmount: salesNumber(line.taxAmount),
      invoiceValue: salesNumber(line.invoiceValue)
    }));
  }
  if (!order || !order.modelNo || salesNumber(order.totalOrderQty) <= 0) return [];
  return [{
    id: `SOITEM-${order.id || "LEGACY"}-1`,
    dcrNdcr: String(order.dcrNdcr || "").trim(),
    modelNo: String(order.modelNo || "").trim(),
    moduleWatt: salesNumber(order.moduleWatt || order.wpModule),
    rateWp: salesNumber(order.rateWp),
    pricePerModule: salesNumber(order.pricePerModule),
    totalOrderQty: salesNumber(order.totalOrderQty),
    totalWatts: salesNumber(order.totalWatts) || (salesNumber(order.moduleWatt || order.wpModule) * salesNumber(order.totalOrderQty)),
    totalOrderValue: salesNumber(order.totalOrderValue),
    taxRate: salesNumber(order.taxRate),
    taxAmount: salesNumber(order.taxAmount),
    invoiceValue: salesNumber(order.invoiceValue)
  }];
}

function salesOrderProductKey(line) {
  return [line?.dcrNdcr, line?.modelNo, salesNumber(line?.moduleWatt)]
    .map(value => String(value || "").trim().replace(/[\s-]+/g, "").toUpperCase())
    .join("|");
}

function clearSalesOrderProductEntry() {
  const setValue = (id, value = "") => { const element = document.getElementById(id); if (element) element.value = value; };
  ["salesDcrNdcr", "salesModelNo", "salesModuleWatt", "salesRateWp", "salesPricePerModule", "salesTotalOrderQty", "salesTotalWatts", "salesTotalOrderValue", "salesTaxAmount", "salesInvoiceValue"].forEach(id => setValue(id));
  setValue("salesTaxRate", "5");
  populateSalesOrderModelDropdown();
  populateSalesOrderWattDropdown();
}

window.renderSalesOrderProductLines = function() {
  const body = document.getElementById("salesOrderProductsBody");
  const totals = document.getElementById("salesOrderProductsTotals");
  const requirement = document.getElementById("salesOrderProductRequirement");
  if (!body) return;
  if (!salesOrderProductLines.length) {
    body.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:18px; color:var(--muted);">No product added yet. The first product is mandatory.</td></tr>';
    if (totals) totals.innerHTML = "";
    if (requirement) requirement.textContent = "At least one product is mandatory. Select the product details above, then click Add Product.";
    const pendingField = document.getElementById("salesPendingQty");
    if (pendingField) pendingField.value = "0";
    return;
  }
  body.innerHTML = salesOrderProductLines.map((line, index) => `<tr>
    <td>${index + 1}</td><td><strong>${escapeSalesHtml(line.dcrNdcr)}</strong></td><td><strong>${escapeSalesHtml(line.modelNo)}</strong></td>
    <td>${salesNumber(line.moduleWatt).toLocaleString("en-IN")} W</td><td>₹ ${salesNumber(line.rateWp).toLocaleString("en-IN")}</td>
    <td><strong>${salesNumber(line.totalOrderQty).toLocaleString("en-IN")}</strong></td><td>${salesNumber(line.totalWatts).toLocaleString("en-IN")}</td>
    <td>${salesNumber(line.taxRate)}%</td><td>₹ ${salesNumber(line.invoiceValue).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
    <td><button type="button" class="btn btn-danger" style="padding:5px 9px;" onclick="removeSalesOrderProductLine('${escapeSalesHtml(line.id)}')">Remove</button></td>
  </tr>`).join("");
  const totalQty = salesOrderProductLines.reduce((sum, line) => sum + salesNumber(line.totalOrderQty), 0);
  const totalWatts = salesOrderProductLines.reduce((sum, line) => sum + salesNumber(line.totalWatts), 0);
  const invoiceValue = salesOrderProductLines.reduce((sum, line) => sum + salesNumber(line.invoiceValue), 0);
  const dispatchedQty = salesNumber(document.getElementById("salesDispatchQty")?.value);
  const pendingField = document.getElementById("salesPendingQty");
  if (pendingField) pendingField.value = Math.max(0, totalQty - dispatchedQty);
  if (totals) totals.innerHTML = `<tr style="font-weight:900; background:#fffbeb;"><td colspan="5" style="text-align:right;">C/O TOTAL</td><td>${totalQty.toLocaleString("en-IN")}</td><td>${totalWatts.toLocaleString("en-IN")}</td><td></td><td>₹ ${invoiceValue.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td></td></tr>`;
  if (requirement) requirement.textContent = `${salesOrderProductLines.length} product(s) added. Different products may be added; an identical product cannot be added twice.`;
};

window.addSalesOrderProductLine = function() {
  const value = id => String(document.getElementById(id)?.value || "").trim();
  const watt = salesNumber(value("salesModuleWatt"));
  const rate = salesNumber(value("salesRateWp"));
  const qty = salesNumber(value("salesTotalOrderQty"));
  const taxRate = salesNumber(value("salesTaxRate"));
  const missing = [];
  if (!value("salesDcrNdcr")) missing.push("DCR / Non-DCR");
  if (!value("salesModelNo")) missing.push("Model");
  if (watt <= 0) missing.push("Watt / Module");
  if (value("salesRateWp") === "" || rate < 0) missing.push("Rate / Watt");
  if (!Number.isInteger(qty) || qty <= 0) missing.push("Total Order Qty");
  if (![5, 12, 18].includes(taxRate)) missing.push("Tax Rate");
  if (missing.length) {
    window.showNotification({ title: "Product Details Missing", message: `Complete: ${missing.join(", ")}.`, type: "warning" });
    return;
  }
  const pricePerModule = watt * rate;
  const totalWatts = watt * qty;
  const totalOrderValue = pricePerModule * qty;
  const taxAmount = totalOrderValue * taxRate / 100;
  const line = {
    id: `SOITEM-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    dcrNdcr: value("salesDcrNdcr"), modelNo: value("salesModelNo"), moduleWatt: watt,
    rateWp: rate, pricePerModule, totalOrderQty: qty, totalWatts, totalOrderValue,
    taxRate, taxAmount, invoiceValue: totalOrderValue + taxAmount
  };
  if (salesOrderProductLines.some(saved => salesOrderProductKey(saved) === salesOrderProductKey(line))) {
    window.showNotification({ title: "Product Already Added", message: `${line.modelNo} (${line.moduleWatt}W, ${line.dcrNdcr}) is already in this C/O. Remove the existing row and add it again if its quantity must be changed.`, type: "warning" });
    return;
  }
  salesOrderProductLines.push(line);
  window.renderSalesOrderProductLines();
  clearSalesOrderProductEntry();
  window.showNotification({ title: "Product Added", message: `${line.modelNo} was added to this C/O.`, type: "success" });
};

window.removeSalesOrderProductLine = function(id) {
  salesOrderProductLines = salesOrderProductLines.filter(line => String(line.id) !== String(id));
  window.renderSalesOrderProductLines();
};

window.saveSalesOrder = async function() {
  const getValue = id => String(document.getElementById(id)?.value || "").trim();
  const existingOrder = editingSalesOrderId ? (salesOrders || []).find(order => String(order.id) === String(editingSalesOrderId)) : null;
  const selectedPerson = (salesPeople || []).find(person => String(person.id) === getValue("salesPersonSelect") && (person.status !== "INACTIVE" || String(person.id) === String(existingOrder?.salesPersonId)));
  const selectedCustomer = (Array.isArray(customersDb) ? customersDb : []).find(customer => String(customer.id) === getValue("salesCustomerSelect"));
  const lineItems = salesOrderProductLines.map(line => ({ ...line }));
  const firstLine = lineItems[0] || {};
  const totalOrderQty = lineItems.reduce((sum, line) => sum + salesNumber(line.totalOrderQty), 0);
  const totalWatts = lineItems.reduce((sum, line) => sum + salesNumber(line.totalWatts), 0);
  const totalOrderValue = lineItems.reduce((sum, line) => sum + salesNumber(line.totalOrderValue), 0);
  const taxAmount = lineItems.reduce((sum, line) => sum + salesNumber(line.taxAmount), 0);
  const invoiceValue = lineItems.reduce((sum, line) => sum + salesNumber(line.invoiceValue), 0);
  const distinctModels = [...new Set(lineItems.map(line => String(line.modelNo || "").trim()).filter(Boolean))];
  const distinctDcr = [...new Set(lineItems.map(line => String(line.dcrNdcr || "").trim()).filter(Boolean))];
  const unaddedProductDraft = ["salesDcrNdcr", "salesModelNo", "salesModuleWatt", "salesRateWp", "salesTotalOrderQty"]
    .some(id => getValue(id) !== "");
  if (unaddedProductDraft) {
    window.showNotification({ title: "Add the Product First", message: "Product details are filled but not yet added. Click Add Product, then save the Sales Order.", type: "warning" });
    return;
  }
  const record = {
    id: existingOrder?.id || `SO-${Date.now()}`,
    serialNo: salesNumber(getValue("salesSrNo")) || existingOrder?.serialNo || getNextSalesOrderSerial(),
    coNumber: getValue("salesCoNumber").toUpperCase(),
    monthYear: getValue("salesMonthYear"),
    orderDate: getValue("salesOrderDate"),
    prodOrderNo: getValue("salesProdOrderNo"),
    customerPurchaseOrderNo: getValue("salesCustomerPoNo"),
    customerId: selectedCustomer?.id || existingOrder?.customerId || "",
    customerName: getValue("salesCustomerName"),
    contactPerson: getValue("salesContactPerson"),
    contactNumber: getValue("salesContactNumber"),
    emailId: getValue("salesEmailId"),
    customerGst: getValue("salesCustomerGst"),
    customerPan: getValue("salesCustomerPan"),
    customerAddress: getValue("salesCustomerAddress"),
    salesPersonId: selectedPerson?.id || existingOrder?.salesPersonId || "",
    salesPerson: selectedPerson?.name || existingOrder?.salesPerson || "",
    lineItems,
    dcrNdcr: distinctDcr.join(" / "),
    modelNo: distinctModels.length > 1 ? `${distinctModels.length} PRODUCTS` : (firstLine.modelNo || ""),
    moduleWatt: lineItems.length === 1 ? salesNumber(firstLine.moduleWatt) : 0,
    wpModule: lineItems.length === 1 ? `${salesNumber(firstLine.moduleWatt)} WATT` : "MULTIPLE",
    rateWp: lineItems.length === 1 ? salesNumber(firstLine.rateWp) : 0,
    pricePerModule: lineItems.length === 1 ? salesNumber(firstLine.pricePerModule) : 0,
    fobExFactory: getValue("salesFobExFactory"),
    totalWatts,
    mw: totalWatts / 1000000,
    totalOrderQty,
    totalOrderValue,
    taxRate: lineItems.length === 1 ? salesNumber(firstLine.taxRate) : 0,
    taxAmount,
    invoiceValue,
    dispatchMode: getValue("salesDispatchMode"),
    tentativeDispatch: getValue("salesTentativeDispatch"),
    actualDispatchDate: existingOrder?.actualDispatchDate || "",
    bom: getValue("salesBom"),
    dispatchQty: salesNumber(existingOrder?.dispatchQty),
    pendingQty: Math.max(0, totalOrderQty - salesNumber(existingOrder?.dispatchQty)),
    dispatchSource: getValue("salesDispatchSource"),
    productSpecification: getValue("salesProductSpecification"),
    performanceCertificate: salesCertificatePaths.length ? salesCertificatePaths.join(", ") : (existingOrder?.performanceCertificate || ""),
    remarks: getValue("salesRemarks"),
    status: existingOrder?.status || "PENDING",
    closedAt: existingOrder?.closedAt || "",
    createdAt: existingOrder?.createdAt || new Date().toLocaleString(),
    createdBy: existingOrder?.createdBy || currentLoggedInUser?.username || "SYSTEM",
    updatedAt: existingOrder ? new Date().toLocaleString() : "",
    updatedBy: existingOrder ? (currentLoggedInUser?.username || "SYSTEM") : ""
  };

  const missing = [];
  if (!record.coNumber) missing.push("CO Number");
  if (!Number.isInteger(record.serialNo) || record.serialNo <= 0) missing.push("SR. No.");
  if (!record.monthYear) missing.push("Month/Year");
  if (!record.orderDate) missing.push("Order Date");
  if (!record.customerName) missing.push("Customer Name");
  if (!selectedCustomer && !existingOrder) missing.push("Customer Master Selection");
  if (!record.contactPerson) missing.push("Contact Person");
  if (!record.contactNumber) missing.push("Contact Number");
  if (!selectedPerson) missing.push("Sales Person");
  if (!record.lineItems.length) missing.push("At least one Product (click Add Product)");
  if (!record.fobExFactory) missing.push("Transport Terms");
  if (missing.length) {
    window.showNotification({ title: "Mandatory Fields Missing", message: `Complete: ${missing.join(", ")}.`, type: "warning" });
    return;
  }
  if (salesCertificatePaths.length && salesCertificateCoNumber !== record.coNumber) {
    window.showNotification({ title: "Certificate CO Mismatch", message: "The CO Number was changed after upload. Upload the certificate again for the current CO Number.", type: "warning" });
    return;
  }
  if (!isValidSalesMonthYear(record.monthYear)) {
    window.showNotification({ title: "Invalid Month/Year", message: "Enter Month/Year in MM/YYYY format, for example 09/2026.", type: "warning" });
    return;
  }
  if (!isValidSalesOrderDate(record.orderDate)) {
    window.showNotification({ title: "Invalid Order Date", message: "Enter a valid date in DD/MM/YYYY format, for example 22/09/2026.", type: "warning" });
    return;
  }
  if (existingOrder && salesCoKey(record.coNumber) !== salesCoKey(existingOrder.coNumber)) {
    window.showNotification({ title: "CO Number Protected", message: "The CO Number cannot be changed while editing a Sales Order.", type: "warning" });
    return;
  }
  const alreadyDispatched = salesNumber(existingOrder?.dispatchQty);
  const alreadyReserved = existingOrder ? getApprovedAllocationQty({ coNumber: existingOrder.coNumber }) : 0;
  if (record.totalOrderQty < alreadyDispatched + alreadyReserved) {
    window.showNotification({ title: "Quantity Cannot Be Reduced", message: `Total Order Qty cannot be lower than dispatched plus reserved quantity of ${(alreadyDispatched + alreadyReserved).toLocaleString("en-IN")}.`, type: "warning" });
    return;
  }
  if (record.emailId && !/^\S+@\S+\.\S+$/.test(record.emailId)) {
    window.showNotification({ title: "Invalid E-mail", message: "Enter a valid e-mail address or leave this optional field blank.", type: "warning" });
    return;
  }
  const coExists = getSalesOrderByCo(record.coNumber);
  if (!existingOrder && coExists) {
    window.showNotification({ title: "CO Number Already In Use", message: `CO Number ${record.coNumber} belongs to a Sales Order currently available in the ERP. It can be reused only after that Sales Order is deleted through approval.`, type: "danger" });
    return;
  }
  // Never include an already approved/deleted record in the next Sales Order
  // save. This also repairs databases affected by an older stale browser write.
  salesOrders = removeApprovedDeletedSalesOrderGhosts(salesOrders, requestsDb);
  const duplicateSerial = (salesOrders || []).find(order =>
    String(order.id) !== String(existingOrder?.id || "") && salesNumber(order.serialNo) === record.serialNo
  );
  if (duplicateSerial) {
    window.showNotification({ title: "SR. No. Already In Use", message: `SR. No. ${record.serialNo} is already assigned to CO ${duplicateSerial.coNumber}. Choose a different number.`, type: "warning" });
    return;
  }

  if (existingOrder) {
    const alreadyPending = (requestsDb || []).some(request =>
      request.status === "PENDING" &&
      ["EDIT_SALES_ORDER", "DELETE_SALES_ORDER"].includes(request.type) &&
      String(request.payload?.salesOrderId) === String(existingOrder.id)
    );
    if (alreadyPending) {
      window.showNotification({ title: "Request Already Pending", message: `CO ${record.coNumber} already has an edit or deletion request waiting for Administrator approval.`, type: "warning" });
      return;
    }
    const reason = await window.showPromptDialog({
      title: "Request Sales Order Edit",
      message: `Send the proposed changes for CO ${record.coNumber} to Administrator for approval? The saved Sales Order will not change until approval.`,
      label: "Reason for Edit *",
      placeholder: "Example: corrected customer details, revised quantity, pricing correction...",
      confirmText: "Send for Approval"
    });
    if (!reason) return;
    const editRequest = {
      id: "REQ-" + Date.now(),
      type: "EDIT_SALES_ORDER",
      targetId: `CO ${record.coNumber}`,
      details: `${record.customerName} | ${record.modelNo} | Qty ${salesNumber(existingOrder.totalOrderQty).toLocaleString("en-IN")} → ${salesNumber(record.totalOrderQty).toLocaleString("en-IN")} | ₹/W ${salesNumber(existingOrder.rateWp)} → ${salesNumber(record.rateWp)}`,
      payload: { salesOrderId: existingOrder.id, coNumber: existingOrder.coNumber, proposedOrder: record },
      requestedBy: currentLoggedInUser ? currentLoggedInUser.username : "OPERATOR",
      requestedAt: new Date().toLocaleString(),
      reason,
      status: "PENDING",
      reviewedBy: "-",
      reviewedAt: "-",
      adminRemark: "-"
    };
    requestsDb.unshift(editRequest);
    const requestSaved = await saveStorage(KEY_REQUESTS, requestsDb);
    if (!requestSaved) {
      requestsDb = requestsDb.filter(request => String(request.id) !== String(editRequest.id));
      return;
    }
    logEvent("SALES", "SALES_ORDER_EDIT_REQUESTED", `Requested edit for Sales Order CO ${record.coNumber}.`);
    window.showNotification({ title: "Edit Request Submitted", message: `CO ${record.coNumber} will update only after Administrator approval.`, type: "warning" });
    resetSalesOrderForm();
    await switchView("salesOrderEdit", document.getElementById("navSub-salesOrderEdit"), "Sales Order > Edit Order");
    const editSearch = document.getElementById("editSalesOrderCoInput");
    if (editSearch) editSearch.value = record.coNumber;
    window.previewSalesOrderForEdit();
    return;
  } else {
    salesOrders.unshift(record);
    salesCoRegistry = [...(salesCoRegistry || []).filter(co => salesCoKey(co) !== salesCoKey(record.coNumber)), record.coNumber];
    const created = await runStorageBatch(async () => {
      await saveStorage(KEY_SALES_ORDERS, salesOrders);
      await saveStorage(KEY_SALES_CO_REGISTRY, salesCoRegistry);
      logEvent("SALES", "SALES_ORDER_CREATED", `Created Sales Order CO ${record.coNumber} for ${record.customerName}; Qty: ${record.totalOrderQty}.`);
    });
    if (!created) return;
    window.showNotification({ title: "Sales Order Saved", message: `CO Number ${record.coNumber} is now ready for Dispatch selection.`, type: "success" });
  }
  resetSalesOrderForm();
  populateDispatchCoDropdown();
  renderSalesOrdersTable();
  renderSalesOrderDashboard();
  populateSalesOrderEditSelect();
  populateSalesOrderDeleteSelect();
};

window.renderSalesOrdersTable = function() {
  const tbody = document.getElementById("salesOrdersTableBody");
  const search = String(document.getElementById("salesSheetSearch")?.value || "").trim().toLowerCase();
  const personId = String(document.getElementById("salesSheetPersonFilter")?.value || "");
  const statusFilter = String(document.getElementById("salesSheetStatusFilter")?.value || "");
  populateSalesPersonDropdowns();

  const orders = (salesOrders || []).filter(order => {
    const matchesPerson = !personId || String(order.salesPersonId) === personId;
    const status = String(order.status || "PENDING").toUpperCase();
    const matchesStatus = !statusFilter || (statusFilter === "OPEN"
      ? (status === "PENDING" || status === "PARTIALLY DISPATCHED")
      : status === statusFilter);
    const haystack = Object.values(order).join(" ").toLowerCase();
    return matchesPerson && matchesStatus && (!search || haystack.includes(search));
  }).sort((a, b) => {
    const serialDifference = salesNumber(b.serialNo) - salesNumber(a.serialNo);
    if (serialDifference !== 0) return serialDifference;
    return (Date.parse(b.updatedAt || b.createdAt || "") || 0) - (Date.parse(a.updatedAt || a.createdAt || "") || 0);
  });

  const totalOrders = (salesOrders || []).length;
  const totalDispatched = (salesOrders || []).reduce((total, order) => total + salesNumber(order.dispatchQty), 0);
  const totalPending = (salesOrders || []).reduce((total, order) => total + salesNumber(order.pendingQty), 0);
  const setText = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
  setText("salesKpiOrders", totalOrders);
  setText("salesKpiDispatched", totalDispatched.toLocaleString("en-IN"));
  setText("salesKpiPending", totalPending.toLocaleString("en-IN"));
  if (!tbody) return;
  if (!orders.length) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:24px; color:var(--muted);">No Sales Orders match the current filter.</td></tr>`;
    return;
  }
  const value = input => escapeSalesHtml(input || "-");
  tbody.innerHTML = orders.map(order => {
    const lines = normalizeSalesOrderProductLines(order);
    const products = lines.map(line => `<div style="margin-bottom:4px;"><strong>${value(line.modelNo)}</strong><div style="font-size:10px; color:var(--muted);">${salesNumber(line.moduleWatt)}W · ${value(line.dcrNdcr)} · Qty ${salesNumber(line.totalOrderQty).toLocaleString("en-IN")}</div></div>`).join("") || value(order.modelNo);
    const rates = lines.length > 1 ? lines.map(line => `<div>₹ ${salesNumber(line.rateWp).toLocaleString("en-IN")}</div>`).join("") : `₹ ${salesNumber(order.rateWp).toLocaleString("en-IN")}`;
    return `<tr>
      <td>${value(order.serialNo)}</td><td>${value(order.monthYear)}</td><td><strong>${value(order.customerName)}</strong></td><td>${value(order.salesPerson)}</td><td>${products}</td><td>${rates}</td><td>${salesNumber(order.mw).toLocaleString("en-IN")}</td><td><strong>${salesNumber(order.totalOrderQty).toLocaleString("en-IN")}</strong></td><td style="color:#059669; font-weight:800;">${salesNumber(order.dispatchQty).toLocaleString("en-IN")}</td><td style="color:#b45309; font-weight:800;">${salesNumber(order.pendingQty).toLocaleString("en-IN")}</td>
    </tr>`;
  }).join("");
};

function salesDashboardDate(value) {
  const ymd = reportHubYmd(value);
  if (!ymd) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function salesDashboardCompactQty(value) {
  const amount = Number(value || 0);
  if (Math.abs(amount) < 1000) return amount.toLocaleString("en-IN");
  return new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(amount);
}

function salesDashboardNiceAxisMax(value) {
  const maximum = Math.max(1, Number(value || 0));
  const magnitude = 10 ** Math.floor(Math.log10(maximum));
  const normalized = maximum / magnitude;
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  return (steps.find(step => step >= normalized) || 10) * magnitude;
}

function renderSalesDashboardBarChart(elementId, summaryElementId, periods, orders) {
  const chart = document.getElementById(elementId);
  if (!chart) return;
  const orderRows = (orders || []).map(order => ({ ...order, __date: salesDashboardDate(order.orderDate || order.createdAt) }));
  const dispatchRows = (dispatchArchive || []).map(manifest => ({ ...manifest, __date: salesDashboardDate(manifest.date) }));
  const series = periods.map(period => {
    const periodOrders = orderRows.filter(order => order.__date && order.__date >= period.start && order.__date <= period.end);
    const periodDispatches = dispatchRows.filter(manifest => manifest.__date && manifest.__date >= period.start && manifest.__date <= period.end);
    const dispatchedOrderKeys = new Set(periodDispatches.map(manifest => salesCoKey(manifest.coNumber) || accountInvoiceKey(manifest.invoice)).filter(Boolean));
    return {
      ...period,
      ordered: periodOrders.length,
      dispatched: dispatchedOrderKeys.size,
      pending: periodOrders.filter(order => salesNumber(order.pendingQty) > 0 && String(order.status || "").toUpperCase() !== "CLOSED").length,
      orders: periodOrders.length,
      closed: periodOrders.filter(order => String(order.status || "").toUpperCase() === "CLOSED").length
    };
  });
  const summary = document.getElementById(summaryElementId);
  if (summary) {
    const shownOrders = orderRows.filter(order => order.__date && order.__date >= periods[0].start && order.__date <= periods[periods.length - 1].end);
    const shownDispatches = dispatchRows.filter(manifest => manifest.__date && manifest.__date >= periods[0].start && manifest.__date <= periods[periods.length - 1].end);
    const orderedModules = shownOrders.reduce((sum, order) => sum + salesNumber(order.totalOrderQty), 0);
    const dispatchedModules = shownDispatches.reduce((sum, manifest) => sum + salesNumber(manifest.dispatchedQty), 0);
    const pendingModules = shownOrders.reduce((sum, order) => sum + salesNumber(order.pendingQty), 0);
    const customers = new Set(shownOrders.map(order => receiptPartyKey(order.customerName)).filter(Boolean)).size;
    summary.innerHTML = `<div><span>Ordered Qty.</span><strong style="color:#087fb9;">${orderedModules.toLocaleString("en-IN")}</strong><small>Modules</small></div><div><span>Dispatched Qty.</span><strong style="color:#059669;">${dispatchedModules.toLocaleString("en-IN")}</strong><small>Modules</small></div><div><span>Pending Qty.</span><strong style="color:#b45309;">${pendingModules.toLocaleString("en-IN")}</strong><small>Modules</small></div><div><span>Sales Orders</span><strong style="color:#65a30d;">${shownOrders.length.toLocaleString("en-IN")}</strong><small>COs</small></div><div><span>Customers</span><strong style="color:#7c3aed;">${customers.toLocaleString("en-IN")}</strong><small>Parties</small></div>`;
  }
  const maximum = Math.max(0, ...series.flatMap(item => [item.ordered, item.dispatched, item.pending]));
  if (maximum <= 0) {
    chart.className = "sales-chart-empty";
    chart.removeAttribute("style");
    chart.textContent = "No dated sales or dispatch activity is available for this period.";
    return;
  }
  const width = 720;
  const height = 270;
  const plot = { left: 62, right: 16, top: 25, bottom: 205 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = plot.bottom - plot.top;
  const tickCount = Math.min(4, Math.max(1, Math.ceil(maximum)));
  const tickStep = Math.max(1, Math.ceil(maximum / tickCount));
  const axisMax = tickStep * tickCount;
  const groupWidth = plotWidth / series.length;
  const preferredBarWidth = series.length <= 3 ? 28 : series.length <= 6 ? 22 : series.length <= 7 ? 18 : 12;
  const barWidth = Math.min(preferredBarWidth, Math.max(8, (groupWidth * .68 - 8) / 3));
  const barGap = 4;
  const groupBarsWidth = barWidth * 3 + barGap * 2;
  const gradientPrefix = elementId === "salesDashboardWeeklyChart" ? "salesWeekly" : "salesMonthly";
  const colors = { ordered: `url(#${gradientPrefix}Ordered)`, dispatched: `url(#${gradientPrefix}Dispatched)`, pending: `url(#${gradientPrefix}Pending)` };
  const labels = { ordered: "Orders received", dispatched: "Orders dispatched", pending: "Orders pending" };
  const grid = Array.from({ length: tickCount + 1 }, (_, index) => {
    const value = axisMax * (tickCount - index) / tickCount;
    const y = plot.top + plotHeight * index / tickCount;
    return `<line class="grid-line" x1="${plot.left}" y1="${y}" x2="${width - plot.right}" y2="${y}"></line><text class="axis-label" x="${plot.left - 9}" y="${y + 3}" text-anchor="end">${escapeSalesHtml(salesDashboardCompactQty(value))}</text>`;
  }).join("");
  const groups = series.map((item, index) => {
    const center = plot.left + groupWidth * index + groupWidth / 2;
    const startX = center - groupBarsWidth / 2;
    const bars = ["ordered", "dispatched", "pending"].map((key, barIndex) => {
      const value = Number(item[key] || 0);
      if (value <= 0) return "";
      const barHeight = Math.max(3, value / axisMax * plotHeight);
      const x = startX + barIndex * (barWidth + barGap);
      const y = plot.bottom - barHeight;
      const tooltip = `${item.fullLabel}: ${labels[key]} ${value.toLocaleString("en-IN")}`;
      return `<g><title>${escapeSalesHtml(tooltip)}</title><rect class="data-bar" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="4" fill="${colors[key]}"></rect><text class="bar-value" x="${(x + barWidth / 2).toFixed(2)}" y="${Math.max(13, y - 6).toFixed(2)}" text-anchor="middle">${escapeSalesHtml(salesDashboardCompactQty(value))}</text></g>`;
    }).join("");
    return `${bars}<text class="period-label" x="${center.toFixed(2)}" y="228" text-anchor="middle">${escapeSalesHtml(item.label)}</text><text class="period-subtitle" x="${center.toFixed(2)}" y="243" text-anchor="middle">${item.orders} CO${item.orders === 1 ? "" : "s"}</text>`;
  }).join("");
  chart.className = "";
  chart.removeAttribute("style");
  chart.innerHTML = `<svg class="sales-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Sales Order counts received, dispatched and pending by period"><defs><linearGradient id="${gradientPrefix}Ordered" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#60a5fa"></stop><stop offset="1" stop-color="#2563eb"></stop></linearGradient><linearGradient id="${gradientPrefix}Dispatched" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34d399"></stop><stop offset="1" stop-color="#059669"></stop></linearGradient><linearGradient id="${gradientPrefix}Pending" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbbf24"></stop><stop offset="1" stop-color="#d97706"></stop></linearGradient></defs>${grid}<line class="axis-line" x1="${plot.left}" y1="${plot.bottom}" x2="${width - plot.right}" y2="${plot.bottom}"></line><line class="axis-line" x1="${plot.left}" y1="${plot.top}" x2="${plot.left}" y2="${plot.bottom}"></line>${groups}<text class="axis-label" x="14" y="${(plot.top + plot.bottom) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(plot.top + plot.bottom) / 2})">SALES ORDERS</text></svg>`;
}

function renderSalesDashboardTrendCharts(orders) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekly = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const end = new Date(date); end.setHours(23, 59, 59, 999);
    return {
      start: date,
      end,
      label: date.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit" }),
      fullLabel: date.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short", year: "numeric" })
    };
  });
  const monthCount = Math.max(3, Math.min(12, Number(document.getElementById("salesDashboardMonthRange")?.value || 3)));
  dashboardSetText("salesDashboardMonthlySubtitle", `Month-wise position for the latest ${monthCount === 3 ? "three" : monthCount === 6 ? "six" : "twelve"} months`);
  const monthly = Array.from({ length: monthCount }, (_, index) => {
    const offset = monthCount - 1 - index;
    const start = new Date(today.getFullYear(), today.getMonth() - offset, 1);
    const end = new Date(today.getFullYear(), today.getMonth() - offset + 1, 0, 23, 59, 59, 999);
    return {
      start,
      end,
      label: start.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
      fullLabel: start.toLocaleDateString("en-IN", { month: "long", year: "numeric" })
    };
  });
  renderSalesDashboardBarChart("salesDashboardWeeklyChart", "salesDashboardWeeklySummary", weekly, orders);
  renderSalesDashboardBarChart("salesDashboardMonthlyChart", "salesDashboardMonthlySummary", monthly, orders);
}

window.renderSalesOrderDashboard = function() {
  const orders = (salesOrders || []).slice().sort((a, b) => {
    const serialDifference = salesNumber(b.serialNo) - salesNumber(a.serialNo);
    if (serialDifference !== 0) return serialDifference;
    return (Date.parse(b.updatedAt || b.createdAt || "") || 0) - (Date.parse(a.updatedAt || a.createdAt || "") || 0);
  });
  const summary = document.getElementById("salesDashboardTillDateSummary");
  if (summary) {
    const orderedModules = orders.reduce((sum, order) => sum + salesNumber(order.totalOrderQty), 0);
    const dispatchedModules = orders.reduce((sum, order) => sum + salesNumber(order.dispatchQty), 0);
    const pendingModules = orders.reduce((sum, order) => sum + salesNumber(order.pendingQty), 0);
    const customers = new Set(orders.map(order => receiptPartyKey(order.customerName)).filter(Boolean)).size;
    dashboardSetHtml(summary, `<div><span>Ordered Qty.</span><strong style="color:#087fb9;">${orderedModules.toLocaleString("en-IN")}</strong><small>Modules</small></div><div><span>Dispatched Qty.</span><strong style="color:#059669;">${dispatchedModules.toLocaleString("en-IN")}</strong><small>Modules</small></div><div><span>Pending Qty.</span><strong style="color:#b45309;">${pendingModules.toLocaleString("en-IN")}</strong><small>Modules</small></div><div><span>Sales Orders</span><strong style="color:#65a30d;">${orders.length.toLocaleString("en-IN")}</strong><small>COs</small></div><div><span>Customers</span><strong style="color:#7c3aed;">${customers.toLocaleString("en-IN")}</strong><small>Parties</small></div>`);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayEnd = new Date(today);
  dayEnd.setHours(23, 59, 59, 999);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - 6);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const orderRows = orders.map(order => ({ ...order, __date: salesDashboardDate(order.orderDate || order.createdAt) }));
  const dispatchRows = (dispatchArchive || []).map(manifest => ({ ...manifest, __date: salesDashboardDate(manifest.createdAt || manifest.dispatchedAt || manifest.date) }));
  const renderPeriodKpis = (elementId, start, end) => {
    const output = document.getElementById(elementId);
    if (!output) return;
    const periodOrders = orderRows.filter(order => order.__date && order.__date >= start && order.__date <= end);
    const periodDispatches = dispatchRows.filter(manifest => manifest.__date && manifest.__date >= start && manifest.__date <= end);
    const orderQty = periodOrders.reduce((sum, order) => sum + salesNumber(order.totalOrderQty), 0);
    const dispatchedQty = periodDispatches.reduce((sum, manifest) => sum + salesNumber(manifest.dispatchedQty), 0);
    const pendingQty = periodOrders.reduce((sum, order) => sum + salesNumber(order.pendingQty), 0);
    const closedCos = periodOrders.filter(order => String(order.status || "").toUpperCase() === "CLOSED").length;
    dashboardSetHtml(output, `<div><span>Total Sales Orders</span><strong style="color:#087fb9;">${periodOrders.length.toLocaleString("en-IN")}</strong><small>Active saved CO records</small></div><div><span>Total Order Qty.</span><strong style="color:#20a99f;">${orderQty.toLocaleString("en-IN")}</strong><small>Modules ordered</small></div><div><span>Dispatched Qty.</span><strong style="color:#059669;">${dispatchedQty.toLocaleString("en-IN")}</strong><small>Modules dispatched</small></div><div><span>Pending Qty.</span><strong style="color:#b45309;">${pendingQty.toLocaleString("en-IN")}</strong><small>Modules remaining</small></div><div><span>Closed COs</span><strong style="color:#65a30d;">${closedCos.toLocaleString("en-IN")}</strong><small>Fully dispatched with certificate</small></div>`);
  };
  renderPeriodKpis("salesDashboardWeeklyKpis", weekStart, dayEnd);
  renderPeriodKpis("salesDashboardMonthlyKpis", monthStart, dayEnd);

  const tbody = document.getElementById("salesDashboardRecentBody");
  if (!tbody) return;
  if (!orders.length) {
    dashboardSetHtml(tbody, `<tr><td colspan="7" style="text-align:center; padding:24px; color:var(--muted);">No sales orders saved.</td></tr>`);
    return;
  }
  const value = input => escapeSalesHtml(input || "-");
  const statusStyle = status => {
    const normalized = String(status || "PENDING").toUpperCase();
    if (normalized === "CLOSED") return "#047857";
    if (normalized === "AWAITING CERTIFICATE") return "#b45309";
    if (normalized === "PARTIALLY DISPATCHED") return "#087fb9";
    return "#64748b";
  };
  dashboardSetHtml(tbody, orders.map(order => `<tr>
    <td><strong style="color:#087fb9;">${value(order.coNumber)}</strong></td><td>${value(order.customerName)}</td><td>${value(order.salesPerson)}</td><td><strong>${salesNumber(order.totalOrderQty).toLocaleString("en-IN")}</strong></td><td style="color:#059669; font-weight:800;">${salesNumber(order.dispatchQty).toLocaleString("en-IN")}</td><td style="color:#b45309; font-weight:800;">${salesNumber(order.pendingQty).toLocaleString("en-IN")}</td><td><span style="font-size:11px; font-weight:800; color:${statusStyle(order.status)};">${value(order.status || "PENDING")}</span></td>
  </tr>`).join(""));
};

window.renderSalesPeopleTable = function() {
  const tbody = document.getElementById("salesPeopleTableBody");
  if (!tbody) return;
  if (!(salesPeople || []).length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--muted);">No Sales Persons added yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = salesPeople.map((person, index) => `<tr>
    <td>${index + 1}</td><td><strong>${escapeSalesHtml(person.name)}</strong></td><td><span style="font-size:11px; font-weight:800; color:${person.status === "INACTIVE" ? "#991b1b" : "#059669"};">${person.status === "INACTIVE" ? "INACTIVE" : "ACTIVE"}</span></td><td>${escapeSalesHtml(person.createdAt || "-")}</td>
    <td><button class="btn btn-secondary" style="padding:5px 8px; font-size:11px;" onclick="editSalesPerson('${person.id}')">Edit</button> <button class="btn btn-danger" style="padding:5px 8px; font-size:11px;" onclick="deleteSalesPerson('${person.id}')">${person.status === "INACTIVE" ? "Remove" : "Delete"}</button></td>
  </tr>`).join("");
};

window.addSalesPerson = async function() {
  const input = document.getElementById("salesPersonNameInput");
  const name = String(input?.value || "").trim();
  if (!name) {
    window.showNotification({ title: "Name Required", message: "Enter a Sales Person name.", type: "warning" });
    return;
  }
  if ((salesPeople || []).some(person => person.name.toLowerCase() === name.toLowerCase())) {
    window.showNotification({ title: "Duplicate Sales Person", message: "This Sales Person already exists in the master.", type: "warning" });
    return;
  }
  salesPeople.push({ id: `SP-${Date.now()}`, name, status: "ACTIVE", createdAt: new Date().toLocaleString() });
  await saveStorage(KEY_SALES_PEOPLE, salesPeople);
  logEvent("SALES", "SALES_PERSON_ADDED", `Added Sales Person ${name}.`);
  if (input) input.value = "";
  populateSalesPersonDropdowns();
  renderSalesPeopleTable();
};

window.editSalesPerson = async function(id) {
  const person = (salesPeople || []).find(item => String(item.id) === String(id));
  if (!person) return;
  const name = await window.showPromptDialog({ title: "Edit Sales Person", message: "Update the master name. Existing saved Sales Orders keep their historical name.", label: "Sales Person Name *", defaultValue: person.name, confirmText: "Save Name" });
  if (!name || name.toLowerCase() === person.name.toLowerCase()) return;
  if ((salesPeople || []).some(item => item.id !== person.id && item.name.toLowerCase() === name.toLowerCase())) {
    window.showNotification({ title: "Duplicate Sales Person", message: "This Sales Person name already exists.", type: "warning" });
    return;
  }
  person.name = name;
  await saveStorage(KEY_SALES_PEOPLE, salesPeople);
  logEvent("SALES", "SALES_PERSON_EDITED", `Updated Sales Person master to ${name}.`);
  populateSalesPersonDropdowns();
  renderSalesPeopleTable();
};

window.deleteSalesPerson = async function(id) {
  const person = (salesPeople || []).find(item => String(item.id) === String(id));
  if (!person) return;
  const linkedOrders = (salesOrders || []).some(order => String(order.salesPersonId) === String(person.id));
  const actionText = linkedOrders ? "Deactivate" : "Delete";
  const confirmed = await window.showConfirmDialog({ title: `${actionText} Sales Person`, message: linkedOrders ? `${person.name} is used in saved Sales Orders and will be deactivated to preserve history.` : `Delete ${person.name} from the Sales Person Master?`, confirmText: actionText, isDanger: true });
  if (!confirmed) return;
  if (linkedOrders) person.status = "INACTIVE";
  else salesPeople = salesPeople.filter(item => item.id !== person.id);
  await saveStorage(KEY_SALES_PEOPLE, salesPeople);
  logEvent("SALES", linkedOrders ? "SALES_PERSON_DEACTIVATED" : "SALES_PERSON_DELETED", `${actionText}d Sales Person ${person.name}.`);
  populateSalesPersonDropdowns();
  renderSalesPeopleTable();
};
