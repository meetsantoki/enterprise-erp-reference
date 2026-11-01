const FAST_DASHBOARD_VIEWS = new Set(["dashboardAdmin", "dashboardPacking", "dashboardDispatch"]);
const FAST_DASHBOARD_CACHE_KEY = "DEMOSOLAR_FAST_DASHBOARD_SUMMARY_V2";
const FAST_DASHBOARD_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let fastDashboardSummaryPromise = null;

window.isFastDashboardView = function(viewId) {
  return FAST_DASHBOARD_VIEWS.has(String(viewId || ""));
};

window.shouldUseFastDashboard = function(viewId) {
  if (!window.isFastDashboardView(viewId)) return false;
  return getViewModuleKeys(viewId).some(key => !loadedModuleKeys.has(key));
};

function readFastDashboardCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(FAST_DASHBOARD_CACHE_KEY) || "null");
    if (!cached?.summary || !Number.isFinite(Number(cached.savedAt))) return null;
    if (Date.now() - Number(cached.savedAt) > FAST_DASHBOARD_CACHE_MAX_AGE_MS) return null;
    return cached.summary;
  } catch (_error) {
    return null;
  }
}

function writeFastDashboardCache(summary) {
  if (!summary || typeof summary !== "object") return;
  try {
    localStorage.setItem(FAST_DASHBOARD_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), summary }));
  } catch (_error) {
    // A large operating history can exceed the browser quota. The server cache
    // still provides the same fast path, so this must never block the dashboard.
  }
}

function compactDashboardPallet(pallet = {}) {
  const rows = Array.isArray(pallet.fullRows) ? pallet.fullRows : [];
  const serials = Array.isArray(pallet.serials) ? pallet.serials : [];
  return {
    pallet: String(pallet.pallet || ""),
    po: String(pallet.po || rows[0]?.po || ""),
    model: String(pallet.model || ""),
    grade: String(pallet.grade || "A GRADE"),
    count: Number(pallet.count || serials.length || rows.length || 0),
    date: String(pallet.date || ""),
    watt: String(pallet.watt || "")
  };
}

function buildFastDashboardSummaryFromFullData() {
  return {
    generatedAt: new Date().toISOString(),
    stock: (Array.isArray(godownStock) ? godownStock : []).map(compactDashboardPallet),
    dispatches: (Array.isArray(dispatchArchive) ? dispatchArchive : []).map(dispatch => ({
      id: dispatch?.id ?? null,
      date: String(dispatch?.date || ""),
      createdAt: String(dispatch?.createdAt || ""),
      dispatchedAt: String(dispatch?.dispatchedAt || ""),
      dispatchedQty: Number(dispatch?.dispatchedQty || 0),
      invoice: String(dispatch?.invoice || ""),
      invoiceNumber: String(dispatch?.invoiceNumber || dispatch?.invoice || ""),
      customer: String(dispatch?.customer || ""),
      vehicle: String(dispatch?.vehicle || ""),
      pallets: (Array.isArray(dispatch?.pallets) ? dispatch.pallets : []).map(pallet => {
        const compact = compactDashboardPallet(pallet);
        if (!compact.date) compact.date = String(dispatch?.date || "");
        return compact;
      })
    })),
    productionOrders: (Array.isArray(poDatabase) ? poDatabase : []).map(order => ({
      id: order?.id ?? null,
      poNumber: String(order?.poNumber || ""),
      product: String(order?.product || ""),
      watt: String(order?.watt || ""),
      qty: Number(order?.qty || 0),
      status: String(order?.status || "OPEN")
    }))
  };
}

function paintFastDashboard(viewId, summary) {
  const fullState = { stock: godownStock, dispatches: dispatchArchive, productionOrders: poDatabase };
  try {
    godownStock = Array.isArray(summary?.stock) ? summary.stock : [];
    dispatchArchive = Array.isArray(summary?.dispatches) ? summary.dispatches : [];
    poDatabase = Array.isArray(summary?.productionOrders) ? summary.productionOrders : [];
    if (viewId === "dashboardPacking") refreshPackingDashboard();
    else if (viewId === "dashboardDispatch") refreshDispatchDashboard();
    else refreshAdminDashboard();
  } finally {
    godownStock = fullState.stock;
    dispatchArchive = fullState.dispatches;
    poDatabase = fullState.productionOrders;
  }
}

async function getFastDashboardSummary(forceRefresh = false) {
  if (!forceRefresh && fastDashboardSummaryPromise) return fastDashboardSummaryPromise;
  const refreshParameter = forceRefresh ? "&refresh=1" : "";
  fastDashboardSummaryPromise = (async () => {
    const response = await erpFetchWithTimeout(`backend/api.php?action=dashboard_summary${refreshParameter}`, {
      credentials: "same-origin",
      cache: "no-store"
    }, 5000);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.status !== "success" || !result?.summary) {
      throw new Error(result?.message || "Dashboard summary could not be loaded.");
    }
      writeFastDashboardCache(result.summary);
      return { summary: result.summary, stale: result.stale === true };
  })();
  try {
    return await fastDashboardSummaryPromise;
  } finally {
    fastDashboardSummaryPromise = null;
  }
}

window.renderFastDashboard = function(viewId) {
  const cached = readFastDashboardCache();
  if (cached) paintFastDashboard(viewId, cached);

  const update = async () => {
    const result = await getFastDashboardSummary(false);
    if (currentActiveViewId === viewId) paintFastDashboard(viewId, result.summary);
    if (result.stale) {
      const fresh = await getFastDashboardSummary(true);
      if (currentActiveViewId === viewId) paintFastDashboard(viewId, fresh.summary);
    }
  };
  if (cached) {
    void update().catch(error => console.warn("Dashboard background refresh was unavailable.", error));
    return Promise.resolve(true);
  }
  return update().then(() => true);
};

window.refreshDashboardFromFullData = function(viewId = currentActiveViewId) {
  writeFastDashboardCache(buildFastDashboardSummaryFromFullData());
  if (viewId === "dashboardPacking") refreshPackingDashboard();
  else if (viewId === "dashboardDispatch") refreshDispatchDashboard();
  else if (viewId === "dashboardAdmin") refreshAdminDashboard();
};

window.goToUserDashboard = async function() {
  if (!currentLoggedInUser) return;
  const role = String(currentLoggedInUser.role || "").toLowerCase();
  const department = String(currentLoggedInUser.department || "").toLowerCase();

  if (role === "packing") {
    await switchView("dashboardPacking", document.getElementById("btnDashboard"), "DASHBOARD");
  } else if (role === "dispatch") {
    await switchView("dashboardDispatch", document.getElementById("btnDashboard"), "DASHBOARD");
  } else if (role === "warehouse") {
    await openWarehouseView(document.getElementById("btnWarehouse"));
  } else if (role === "purchase" || role === "procurement" || /\b(purchase|procurement)\b/.test(department)) {
    await switchView("purchaseVendorMaster", document.getElementById("navSub-purchaseVendorMaster"), "PURCHASE > VENDOR MASTER");
  } else {
    await switchView("dashboardAdmin", document.getElementById("btnDashboard"), "DASHBOARD");
  }
};

window.openWarehouseView = async function(btnEl) {
  await switchView("warehouse", btnEl, "WAREHOUSE > FINISHED GOODS INVENTORY");
};

function getWarehousePalletReservedCoNumbers(item) {
  const poNumbers = new Set([
    String(item?.po || "").trim(),
    ...(item?.fullRows || []).map(row => String(row?.po || "").trim())
  ].filter(Boolean).map(coAllocationKey));
  return [...new Set((coAllocations || []).filter(allocation => {
    const status = String(allocation.status || "RESERVED").toUpperCase();
    return status !== "CANCELLED" && poNumbers.has(coAllocationKey(allocation.poNumber));
  }).map(allocation => String(allocation.coNumber || "").trim()).filter(Boolean))];
}

function normalizeWarehouseCellType(value) {
  return String(value || "").replace(/[\s_-]/g, "").toUpperCase() === "DCR" ? "DCR" : "NON - DCR";
}

function getWarehousePalletCellType(item) {
  const poNumbers = [...new Set([
    String(item?.po || "").trim(),
    ...(item?.fullRows || []).map(row => String(row?.po || "").trim())
  ].filter(Boolean).map(value => value.toUpperCase()))];
  const poTypes = [...new Set(poNumbers.map(poNumber => {
    const po = getPoRecord(poNumber);
    return po ? normalizeWarehouseCellType(getPoCellType(po)) : "";
  }).filter(Boolean))];
  if (poTypes.length === 1) return poTypes[0];

  const direct = String(item?.cellType || item?.dcrNdcr || "").trim();
  if (direct) return normalizeWarehouseCellType(direct);

  const model = String(item?.model || "").trim().toUpperCase();
  const modelTypes = [...new Set((productsDb || [])
    .filter(product => String(product?.name || "").trim().toUpperCase() === model)
    .map(product => normalizeWarehouseCellType(product?.cellType)))];
  return modelTypes.length === 1 ? modelTypes[0] : "NON - DCR";
}

window.renderWarehouseTable = function() {
  const search = (document.getElementById("whSearchInput")?.value || "")
    .trim()
    .toLowerCase();

  const searchField = document.getElementById("whSearchField")?.value || "any";
  const tbody = document.getElementById("whTableBody");
  const searchLabel = document.getElementById("whSearchLabel");
  const searchSummary = document.getElementById("whSearchSummary");

  if (!tbody) return;

  const fieldLabels = {
    any: "Any Detail",
    pallet: "Pallet Number",
    serial: "Serial Number",
    date: "Date Packed",
    po: "PO Number",
    co: "CO Number (PO Reservation)",
    grade_a: "A Grade",
    grade_b: "B Grade",
    grade_r: "R Grade",
    watt: "Wattage",
    dcr: "DCR Stock",
    non_dcr: "NON-DCR Stock",
    model: "Model Number",
    cell_type: "Cell Type",
    quantity: "Quantity",
    booked: "Booked Stock Only",
    customer: "Booked Customer Name"
  };

  if (searchLabel) {
    searchLabel.textContent = `Search Warehouse Stock — ${fieldLabels[searchField] || "Any Detail"}`;
  }

  let totalModules = 0;
  let dcrModules = 0;
  let nonDcrModules = 0;
  let bookedPallets = 0;
  let bookedModules = 0;

  const filtered = (godownStock || []).filter(item => {
    const quantity = item.count || (item.serials || []).length || 0;
    const cellType = getWarehousePalletCellType(item);
    const booking = getActiveStockBooking(item.pallet);
    const reservedCos = getWarehousePalletReservedCoNumbers(item);

    const serialData = [
      ...(item.serials || []),
      ...(item.fullRows || []).flatMap(row => [
        row.serial || "",
        row.barcode || "",
        row.po || "",
        row.watt || "",
        row.binning || ""
      ])
    ].join(" ").toLowerCase();

    const poData = [
      item.po || "",
      ...(item.fullRows || []).map(row => row.po || "")
    ].join(" ").toLowerCase();

    const wattData = [
      item.watt || "",
      ...(item.fullRows || []).map(row => row.watt || "")
    ].join(" ").toLowerCase();

    const bookingData = `${booking?.customer || ""} ${booking?.remarks || ""}`.toLowerCase();
    const coData = reservedCos.join(" ").toLowerCase();

    const allData = `
      ${item.pallet || ""}
      ${item.po || ""}
      ${item.model || ""}
      ${item.watt || ""}
      ${item.grade || ""}
      ${item.binning || ""}
      ${cellType}
      ${quantity}
      ${item.date || ""}
      ${serialData}
      ${bookingData}
      ${coData}
    `.toLowerCase();

    let matched = true;

    if (searchField === "dcr") {
      matched = cellType.trim().toUpperCase() === "DCR";
    } else if (searchField === "non_dcr") {
      matched = cellType.trim().toUpperCase() !== "DCR";
    } else if (searchField === "booked") {
      matched = Boolean(booking);
    } else if (searchField === "pallet") {
      matched = String(item.pallet || "").toLowerCase().includes(search);
    } else if (searchField === "serial") {
      matched = serialData.includes(search);
    } else if (searchField === "date") {
      matched = String(item.date || "").toLowerCase().includes(search);
    } else if (searchField === "po") {
      matched = poData.includes(search);
    } else if (searchField === "co") {
      matched = Boolean(coData) && coData.includes(search);
    } else if (searchField === "grade_a") {
      matched = String(item.grade || "A GRADE").trim().toUpperCase() === "A GRADE";
    } else if (searchField === "grade_b") {
      matched = String(item.grade || "").trim().toUpperCase() === "B GRADE";
    } else if (searchField === "grade_r") {
      matched = String(item.grade || "").trim().toUpperCase() === "R GRADE";
    } else if (searchField === "watt") {
      matched = wattData.includes(search);
    } else if (searchField === "model") {
      matched = String(item.model || "").toLowerCase().includes(search);
    } else if (searchField === "cell_type") {
      matched = String(cellType || "").toLowerCase().includes(search);
    } else if (searchField === "quantity") {
      matched = String(quantity).includes(search);
    } else if (searchField === "customer") {
      matched = Boolean(booking) && bookingData.includes(search);
    } else {
      matched = allData.includes(search);
    }

    // DCR, NON-DCR, and Booked Stock work immediately even without typed text.
    if (matched && search && ["dcr", "non_dcr", "booked"].includes(searchField)) {
      matched = allData.includes(search) || bookingData.includes(search);
    }

    if (!matched) return false;

    totalModules += quantity;

    if (booking) {
      bookedPallets++;
      bookedModules += quantity;
    }

    if (cellType.trim().toUpperCase() === "DCR") {
      dcrModules += quantity;
    } else {
      nonDcrModules += quantity;
    }

    return true;
  });

  document.getElementById("whKpiBookedStock").textContent = bookedPallets;

  const bookedSub = document.getElementById("whKpiBookedStockSub");
  if (bookedSub) bookedSub.textContent = `${bookedModules} modules reserved`;

  document.getElementById("whKpiModules").textContent = totalModules;
  document.getElementById("whKpiDcr").textContent = dcrModules;
  document.getElementById("whKpiNonDcr").textContent = nonDcrModules;

  const filterActive = search || searchField !== "any";

  if (searchSummary) {
    searchSummary.textContent = filterActive
      ? `Filtered result: ${filtered.length} pallet(s) • ${totalModules} module(s)`
      : `Showing all stock: ${filtered.length} pallet(s) • ${totalModules} module(s)`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align:center; color:var(--muted); padding:20px;">
          No warehouse finished goods match this search.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((item, index) => {
    const cellType = getWarehousePalletCellType(item);
    const isDcr = cellType.trim().toUpperCase() === "DCR";
    const booking = getActiveStockBooking(item.pallet);
    const reservedCos = getWarehousePalletReservedCoNumbers(item);

    const bookingNote = booking
      ? `<div style="margin-top:4px; font-size:10px; color:#7c3aed; font-weight:700;">BOOKED: ${booking.customer}</div>`
      : "";

    return `
      <tr>
        <td>${index + 1}</td>
        <td><strong style="color:var(--primary);">${item.pallet}</strong>${bookingNote}</td>
        <td><strong>${item.po || "-"}</strong></td>
        <td>${reservedCos.length ? reservedCos.map(co => `<div style="font-size:11px; color:#2563eb; font-weight:700;">${co}</div>`).join("") : '<span style="color:var(--muted);">General Stock</span>'}</td>
        <td>${item.model || "-"}</td>
        <td>
          <span style="font-size:11px; font-weight:700; padding:3px 8px; border-radius:4px;
            ${isDcr ? "background:#f3e8ff; color:#7c3aed;" : "background:#fef3c7; color:#b45309;"}">
            ${cellType}
          </span>
        </td>
        <td>${item.grade || "A GRADE"}</td>
        <td>${item.watt || "-"}</td>
        <td><strong style="font-size:14px;">${item.count || (item.serials || []).length || 0}</strong></td>
        <td style="color:var(--muted); font-size:12px;">${item.date || "-"}</td>
      </tr>
    `;
  }).join("");
};

function getActiveStockBooking(palletNumber) {
  const pallet = normalizePackingId(palletNumber);

  return (stockBookings || []).find(
    booking =>
      booking.status === "BOOKED" &&
      normalizePackingId(booking.pallet) === pallet
  ) || null;
}

function normalizeBookingParty(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

window.renderBookedStockView = function() {
  const poSelect = document.getElementById("bookedStockPoSelect");
  const palletSelect = document.getElementById("bookedStockPalletSelect");
  const tableBody = document.getElementById("bookedStockTableBody");

  if (!poSelect || !palletSelect) return;

  const savedPo = poSelect.value || "";

  bookedStockDraftPallets = bookedStockDraftPallets.filter(palletNo =>
    godownStock.some(p => normalizePackingId(p.pallet) === normalizePackingId(palletNo)) &&
    !getActiveStockBooking(palletNo)
  );

  const availablePos = [...new Set(
  godownStock
    .map(p => String(p.po || "").trim())
    .filter(Boolean)
)].sort();

  poSelect.innerHTML =
    `<option value="">-- Select PO Number First --</option>` +
    availablePos.map(po => `<option value="${po}">${po}</option>`).join("");

  poSelect.value = availablePos.includes(savedPo) ? savedPo : "";

  const selectedPo = poSelect.value;

  const availablePallets = godownStock.filter(p =>
    String(p.po || "").trim() === selectedPo &&
    !getActiveStockBooking(p.pallet) &&
    !bookedStockDraftPallets.some(palletNo =>
      normalizePackingId(palletNo) === normalizePackingId(p.pallet)
    )
  );

  palletSelect.disabled = !selectedPo;

  palletSelect.innerHTML = !selectedPo
    ? `<option value="">-- Select PO Number First --</option>`
    : `<option value="">-- Select available warehouse pallet --</option>` +
      availablePallets.map(p =>
        `<option value="${p.pallet}">
          ${p.pallet} — ${p.count || (p.serials || []).length} modules | PO: ${p.po}
        </option>`
      ).join("");

  renderBookedStockDraftList();
  if (!tableBody) return;

  const activeBookings = stockBookings.filter(b => b.status === "BOOKED");

  if (activeBookings.length === 0) {
    tableBody.innerHTML =
      `<tr><td colspan="7" style="text-align:center; color:var(--muted); padding:20px;">
        No warehouse stock is booked currently.
      </td></tr>`;
    return;
  }

  tableBody.innerHTML = activeBookings.map((booking, index) => {
    const pallet = godownStock.find(p =>
      normalizePackingId(p.pallet) === normalizePackingId(booking.pallet)
    );

    const quantity = pallet
      ? (pallet.count || (pallet.serials || []).length)
      : 0;

    const canCancel =
      currentLoggedInUser &&
      (currentLoggedInUser.role === "admin" ||
       currentLoggedInUser.username === booking.bookedBy);

    return `
      <tr>
        <td>${index + 1}</td>
        <td><strong>${booking.pallet}</strong></td>
        <td>${quantity}</td>
        <td>${booking.customer}</td>
        <td>${booking.bookedDate}</td>
        <td>${booking.remarks || "-"}</td>
        <td>
          ${canCancel
            ? `<button class="btn btn-danger" style="padding:4px 8px; font-size:11px;"
                 onclick="cancelStockBooking('${booking.id}')">Cancel Booking</button>`
            : `<span style="color:var(--muted); font-size:11px;">Booked by another user</span>`
          }
        </td>
      </tr>
    `;
  }).join("");
};

window.filterBookedStockPalletsByPo = function() {
  window.renderBookedStockView();
};

function renderBookedStockDraftList() {
  const list = document.getElementById("bookedStockDraftList");
  const total = document.getElementById("bookedStockDraftTotal");
  if (!list || !total) return;
  const selectedPallets = bookedStockDraftPallets.map(palletNumber =>
    godownStock.find(pallet => normalizePackingId(pallet.pallet) === normalizePackingId(palletNumber))
  ).filter(Boolean);
  const moduleCount = selectedPallets.reduce((sum, pallet) => sum + (pallet.count || (pallet.serials || []).length || 0), 0);
  total.textContent = `${selectedPallets.length} pallet(s) • ${moduleCount} modules selected`;
  list.innerHTML = selectedPallets.length === 0
    ? `<span style="font-size:12px; color:var(--muted);">No pallets added to this booking yet.</span>`
    : selectedPallets.map((pallet, index) => `<span style="background:#ede9fe; border:1px solid #c4b5fd; color:#5b21b6; font-size:12px; font-weight:700; padding:5px 9px; border-radius:6px; display:inline-flex; align-items:center; gap:7px;">📦 ${pallet.pallet} (${pallet.count || (pallet.serials || []).length}) <button type="button" onclick="removePalletFromBookingDraft(${index})" style="border:0; background:none; color:#dc2626; cursor:pointer; font-weight:900;">✕</button></span>`).join("");
}

window.addPalletToBookingDraft = function() {
  const pallet = document.getElementById("bookedStockPalletSelect")?.value || "";
  if (!pallet) {
    window.showNotification({ title: "Select a Pallet", message: "Select an available warehouse pallet before adding it to the booking list.", type: "warning" });
    return;
  }
  if (bookedStockDraftPallets.some(item => normalizePackingId(item) === normalizePackingId(pallet))) return;
  if (!godownStock.some(item => normalizePackingId(item.pallet) === normalizePackingId(pallet)) || getActiveStockBooking(pallet)) {
    window.showNotification({ title: "Pallet Unavailable", message: "This pallet is no longer available for booking.", type: "danger" });
    window.renderBookedStockView();
    return;
  }
  bookedStockDraftPallets.push(pallet);
  window.renderBookedStockView();
};

window.removePalletFromBookingDraft = function(index) {
  bookedStockDraftPallets.splice(index, 1);
  window.renderBookedStockView();
};

window.bookWarehouseStock = async function() {
  const customer = (document.getElementById("bookedStockCustomer")?.value || "").trim();
  const remarks = (document.getElementById("bookedStockRemarks")?.value || "").trim();
  if (bookedStockDraftPallets.length === 0 || !customer) {
    window.showNotification({ title: "Booking Details Required", message: "Add at least one warehouse pallet and enter the allotted customer/company.", type: "warning" });
    return;
  }
  const unavailablePallet = bookedStockDraftPallets.find(pallet =>
    !godownStock.some(item => normalizePackingId(item.pallet) === normalizePackingId(pallet)) || getActiveStockBooking(pallet)
  );
  if (unavailablePallet) {
    window.showNotification({ title: "Pallet Unavailable", message: `Pallet ${unavailablePallet} is no longer available for booking.`, type: "danger" });
    window.renderBookedStockView();
    return;
  }
  const bookingBatchId = `BOOK-BATCH-${Date.now()}`;
  const newBookings = bookedStockDraftPallets.map((pallet, index) => ({ id: `${bookingBatchId}-${index + 1}`, bookingBatchId, pallet, customer, remarks, bookedDate: getFormattedToday(), bookedBy: currentLoggedInUser?.username || "DISPATCH", status: "BOOKED" }));
  stockBookings.unshift(...newBookings);
  await saveStorage(KEY_STOCK_BOOKINGS, stockBookings);
  logEvent("DISPATCH", "STOCK_BOOKED", `${newBookings.length} pallet(s) reserved for ${customer}: ${bookedStockDraftPallets.join(", ")}.`);
  bookedStockDraftPallets = [];
  document.getElementById("bookedStockCustomer").value = "";
  document.getElementById("bookedStockRemarks").value = "";
  window.renderBookedStockView();
  renderWarehouseTable();
  window.showNotification({ title: "Stock Booked", message: `${newBookings.length} pallet(s) are reserved for ${customer}.`, type: "success" });
};

window.cancelStockBooking = async function(bookingId) {
  const booking = stockBookings.find(item => item.id === bookingId && item.status === "BOOKED");
  if (!booking) return;
  const canCancel = currentLoggedInUser && (currentLoggedInUser.role === "admin" || currentLoggedInUser.username === booking.bookedBy);
  if (!canCancel) {
    window.showNotification({ title: "Not Authorized", message: "Only the booking user or an administrator can cancel this booking.", type: "danger" });
    return;
  }
  const approved = await window.showConfirmDialog({ title: "Cancel Stock Booking", message: `Release pallet ${booking.pallet} from ${booking.customer}?`, confirmText: "Release Pallet", isDanger: true });
  if (!approved) return;
  booking.status = "CANCELLED";
  booking.cancelledAt = new Date().toLocaleString();
  booking.cancelledBy = currentLoggedInUser?.username || "SYSTEM";
  await saveStorage(KEY_STOCK_BOOKINGS, stockBookings);
  logEvent("DISPATCH", "STOCK_BOOKING_CANCELLED", `Released pallet ${booking.pallet} from ${booking.customer}.`);
  window.renderBookedStockView();
  renderWarehouseTable();
};

window.exportWarehouseStockExcel = function() {
  let rowsHtml = "";
  godownStock.forEach((item, idx) => {
    const cellType = getWarehousePalletCellType(item);
    rowsHtml += `
      <tr style="text-align:center; border:1px solid #000;">
        <td style="border:1px solid #000;">${idx + 1}</td>
        <td style="border:1px solid #000; font-weight:bold;">${item.pallet}</td>
        <td style="border:1px solid #000;">${item.po || '-'}</td>
        <td style="border:1px solid #000;">${item.model || '-'}</td>
        <td style="border:1px solid #000; font-weight:bold;">${cellType}</td>
        <td style="border:1px solid #000;">${item.grade || 'A GRADE'}</td>
        <td style="border:1px solid #000;">${item.watt || '-'}</td>
        <td style="border:1px solid #000; font-weight:bold;">${item.count}</td>
        <td style="border:1px solid #000;">${item.date || '-'}</td>
      </tr>
    `;
  });

  const fullHtml = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
    <head><meta charset="utf-8">
      <style>
        table { border-collapse: collapse; width: 100%; font-family: 'Calibri', sans-serif; }
        th, td { border: 1px solid #000; padding: 6px 8px; font-size: 11pt; }
        .hdr { background-color: #7ec8e3; font-weight: bold; text-align: center; }
      </style>
      
    </head>
    <body>
      <table>
        <tr>
          <td colspan="2" style="border:none; padding:10px; text-align:center; vertical-align:middle;">
            <img src="assets/demo-logo.svg" style="max-height:45px; object-fit:contain;">
          </td>
          <td colspan="7" style="text-align:center; font-size:16pt; font-weight:bold; border:none; padding:10px;">
            DEMOSOLAR INDUSTRIES PRIVATE LIMITED - WAREHOUSE STOCK
          </td>
        </tr>
        <tr class="hdr"><th>#</th><th>Pallet No</th><th>PO Number</th><th>Model</th><th>Cell Type</th><th>Grade</th><th>Watt</th><th>Quantity</th><th>Packed Date</th></tr>
        ${rowsHtml}
      </table>
    </body>
    </html>
  `;
  downloadHtmlBlob(fullHtml, `Warehouse_Stock_${Date.now()}.xls`);
};

window.exportWarehouseStockPDF = async function() {
  const printArea = document.getElementById("printableReportArea");
  let rowsHtml = "";
  godownStock.forEach((item, idx) => {
    const cellType = getWarehousePalletCellType(item);
    rowsHtml += `
      <tr>
        <td style="padding:6px;">${idx + 1}</td>
        <td style="padding:6px;"><strong>${item.pallet}</strong></td>
        <td style="padding:6px;">${item.po || '-'}</td>
        <td style="padding:6px;">${item.model || '-'}</td>
        <td style="padding:6px;">${cellType}</td>
        <td style="padding:6px;">${item.grade || 'A GRADE'}</td>
        <td style="padding:6px;">${item.watt || '-'}</td>
        <td style="padding:6px;"><strong>${item.count}</strong></td>
        <td style="padding:6px;">${item.date || '-'}</td>
      </tr>
    `;
  });

  printArea.innerHTML = `
    <div style="padding: 20px; background: #fff; width: 297mm; font-family: Calibri, sans-serif; color: #0f172a;">
      <div style="border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 14px;">
          <img src="assets/demo-logo.svg" style="max-height: 48px; object-fit: contain;">
          <div>
            <h2 style="color: #0284c7; margin: 0; font-size: 16pt;">DEMOSOLAR INDUSTRIES PRIVATE LIMITED</h2>
            <div style="font-size: 9.5pt; color: #475569;">Warehouse Finished Goods Inventory Register</div>
          </div>
        </div>
        <div style="text-align: right; font-size: 9.5pt; font-weight: bold; color: #0284c7;">
          Total Pallets: ${godownStock.length} | Generated: ${new Date().toLocaleString()}
        </div>
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 9.5pt;" border="1">
        <thead>
          <tr style="background-color: #f1f5f9;">
            <th style="padding:6px;">#</th><th>Pallet No</th><th>PO Number</th><th>Model</th><th>Cell Type</th><th>Grade</th><th>Wattage</th><th>Count</th><th>Sealed Date</th>
          </tr>
        </thead>
        <tbody>${rowsHtml || '<tr><td colspan="9" style="text-align:center; padding:10px;">No warehouse stock available.</td></tr>'}</tbody>
      </table>
    </div>
  `;
  printArea.style.display = "block";

  try {
    const canvas = await html2canvas(printArea, { scale: 2, useCORS: true });
    const imgData = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('l', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
    pdf.save(`Warehouse_Stock_${Date.now()}.pdf`);
    logEvent("SYSTEM", "EXPORT_PDF", `Downloaded Warehouse Stock PDF report.`);
  } catch (err) {
    console.error("PDF generation error:", err);
    window.print();
  } finally {
    printArea.style.display = "none";
    printArea.innerHTML = "";
  }
};

function refreshPackingDashboard() {
  const todayStr = getFormattedToday();
  const todayPallets = godownStock.filter(p => (p.date || "").trim() === todayStr);
  let packedTodayModules = todayPallets.reduce((sum, p) => sum + p.count, 0);

  dashboardSetText("kpiPackModules", packedTodayModules);
  dashboardSetText("kpiPackPallets", todayPallets.length);

  const list = document.getElementById("packRecentPalletsList");
  const recentHtml = todayPallets.length === 0
    ? `<span style="color:var(--muted);">No pallets sealed today.</span>`
    : todayPallets.slice(-4).reverse().map(p => `
      <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border);">
        <strong>${p.pallet}</strong>
        <span>${p.count} modules (${p.model || p.po})</span>
        <span style="color:var(--success); font-weight:700;">SEALED TODAY</span>
      </div>
    `).join("");
  dashboardSetHtml(list, recentHtml);
}

function refreshDispatchDashboard() {
  dashboardSetText("kpiDispGodownPallets", godownStock.length);
  let dispCount = dispatchArchive.reduce((acc, m) => acc + m.dispatchedQty, 0);
  dashboardSetText("kpiDispModules", dispCount);
  dashboardSetText("kpiDispVehicles", dispatchArchive.length);

  const box = document.getElementById("dispInventoryQuickList");
  const quickInventory = godownStock.slice(-100).reverse();
  const inventoryHtml = godownStock.length === 0
    ? `<span style="color:var(--muted);">No inventory in godown.</span>`
    : quickInventory.map(p => `
      <div style="display:flex; justify-content:space-between; padding:7px 0; border-bottom:1px solid var(--border);">
        <span><strong>${p.pallet}</strong> — ${p.po}</span>
        <span style="color:var(--primary); font-weight:700;">${p.count} mods ready</span>
      </div>
    `).join("") + (godownStock.length > quickInventory.length ? `<div style="padding:9px 0;color:var(--muted);font-size:11px;">Showing the latest ${quickInventory.length.toLocaleString("en-IN")} of ${godownStock.length.toLocaleString("en-IN")} pallets. Open Warehouse for the complete inventory.</div>` : "");
  dashboardSetHtml(box, inventoryHtml);
}

function refreshAdminDashboard() {
  const todayStr = getFormattedToday(); // Format: DD/MM/YYYY
  const todayYmd = productionToday();

  // 1. Today's packed pallets & modules
  const todayPallets = godownStock.filter(p => (p.date || "").trim() === todayStr);
  let todayModules = todayPallets.reduce((sum, p) => sum + p.count, 0);

  // 2. Today's dispatched modules
  const todayDispatches = dispatchArchive.filter(manifest => reportHubYmd(manifest.createdAt || manifest.dispatchedAt || manifest.date) === todayYmd);
  let totalDispatchedToday = todayDispatches.reduce((acc, m) => acc + m.dispatchedQty, 0);

  // 3. Current month key (MM/YYYY)
  const currentMonthKey = todayStr.split("/").slice(1).join("/");
  const monthPalletsByNumber = new Map();
  const rememberMonthlyPallet = (pallet, fallbackDate = "") => {
    const packedDate = (pallet.date || fallbackDate || "").trim();
    if (!packedDate.endsWith(currentMonthKey)) return;
    const palletKey = normalizePackingId(pallet.pallet) || `ROW-${monthPalletsByNumber.size}`;
    if (!monthPalletsByNumber.has(palletKey)) monthPalletsByNumber.set(palletKey, { ...pallet, date: packedDate });
  };
  (godownStock || []).forEach(pallet => rememberMonthlyPallet(pallet));
  (dispatchArchive || []).forEach(manifest => (manifest.pallets || []).forEach(pallet => rememberMonthlyPallet(pallet, manifest.date)));
  const monthlyPackedPallets = [...monthPalletsByNumber.values()];
  const monthlyPackedModules = monthlyPackedPallets.reduce((sum, pallet) => sum + (pallet.count || (pallet.serials || []).length || 0), 0);
  const monthlyDispatchedModules = (dispatchArchive || [])
    .filter(manifest => reportHubYmd(manifest.createdAt || manifest.dispatchedAt || manifest.date).slice(0, 7) === todayYmd.slice(0, 7))
    .reduce((sum, manifest) => sum + Number(manifest.dispatchedQty || 0), 0);

  const productionDispatchTitle = document.getElementById("adminProductionDispatchTitle");
  if (productionDispatchTitle) dashboardSetText(productionDispatchTitle, `Packing vs Dispatch (${currentMonthKey})`);
  const monthTitleEl = document.getElementById("adminMonthlyGradeTitle");
  if (monthTitleEl) {
    dashboardSetText(monthTitleEl, `Grade Breakdown (${currentMonthKey})`);
  }

  // 4. Calculate Month-to-date Grade Breakdown (A, B, R)
  let monthGradeA = 0;
  let monthGradeB = 0;
  let monthGradeR = 0;

  const tallyMonthlyGrade = (p) => {
    const rawDate = (p.date || "").trim();
    if (!rawDate.endsWith(currentMonthKey)) return;

    const rawGrade = (p.grade || "A GRADE").trim().toUpperCase();
    const cnt = p.count || (p.serials ? p.serials.length : (p.fullRows ? p.fullRows.length : 0));

    if (rawGrade === "B GRADE" || rawGrade === "B" || rawGrade.startsWith("B ")) {
      monthGradeB += cnt;
    } else if (rawGrade === "R GRADE" || rawGrade === "R" || rawGrade.startsWith("R ")) {
      monthGradeR += cnt;
    } else {
      monthGradeA += cnt;
    }
  };

  monthlyPackedPallets.forEach(tallyMonthlyGrade);

  dashboardSetText("kpiAdminTotalPallets", todayPallets.length);
  dashboardSetText("kpiAdminStockModules", todayModules);
  dashboardSetText("kpiAdminDispatched", totalDispatchedToday);
  dashboardSetText("kpiAdminActivePos", getActiveProductionOrderProgress().length);

  if (document.getElementById("activePoDetailsOverlay")?.classList.contains("open")) {
    renderActivePoDetails();
  }
  if (currentDashboardDetailType && document.getElementById("dashboardDetailsOverlay")?.classList.contains("open")) {
    renderDashboardDetails(currentDashboardDetailType);
  }

  renderDailyPackingChart(monthlyPackedPallets, currentMonthKey);
  renderAdminCharts(monthlyPackedModules, monthlyDispatchedModules, { a: monthGradeA, b: monthGradeB, r: monthGradeR });
}

function getActiveProductionOrderProgress() {
  const normalizePo = value => String(value || "").trim().toUpperCase();
  const packedPalletsByNumber = new Map();
  const rememberPallet = pallet => {
    const palletId = String(pallet?.pallet || "").trim().toUpperCase();
    const fallbackKey = `${normalizePo(pallet?.po)}-${pallet?.model || ""}-${(pallet?.serials || []).join("|")}`;
    const key = palletId || fallbackKey;
    if (key && !packedPalletsByNumber.has(key)) packedPalletsByNumber.set(key, pallet);
  };

  (godownStock || []).forEach(rememberPallet);
  (dispatchArchive || []).forEach(manifest => (manifest.pallets || []).forEach(rememberPallet));
  const allPackedPallets = [...packedPalletsByNumber.values()];

  return (poDatabase || [])
    .filter(po => String(po.status || "OPEN").trim().toUpperCase() !== "CLOSED")
    .map(po => {
      const poNumber = normalizePo(po.poNumber);
      const producedQty = allPackedPallets
        .filter(pallet => normalizePo(pallet.po) === poNumber)
        .reduce((sum, pallet) => sum + Number(pallet.count || (pallet.serials || pallet.fullRows || []).length || 0), 0);
      const targetQty = Number(po.qty || 0);
      const remainingQty = Math.max(0, targetQty - producedQty);
      const completedPercent = targetQty > 0 ? Math.min(100, (producedQty / targetQty) * 100) : 0;
      return { ...po, targetQty, producedQty, remainingQty, completedPercent };
    });
}

function renderActivePoDetails() {
  const list = document.getElementById("activePoDetailsList");
  const subtitle = document.getElementById("activePoDetailsSubtitle");
  if (!list) return;
  const activePos = getActiveProductionOrderProgress();
  if (subtitle) subtitle.textContent = `${activePos.length} active PO(s) — target, produced, and remaining modules.`;
  if (!activePos.length) {
    list.innerHTML = `<div class="active-po-empty">No active Production Orders are currently available.</div>`;
    return;
  }
  const displayQty = quantity => Number(quantity || 0).toLocaleString("en-IN");
  list.innerHTML = activePos.map((po, index) => `
    <article class="active-po-record" style="animation-delay:${index * 45}ms;">
      <div class="active-po-record-top">
        <div>
          <div class="active-po-record-title">PO: ${escapeSalesHtml(po.poNumber || "-")}</div>
          <div class="active-po-record-model">${escapeSalesHtml(po.product || "Product not selected")} · ${escapeSalesHtml(po.watt || "Wattage not set")}</div>
        </div>
        <span class="active-po-status">${escapeSalesHtml(String(po.status || "OPEN").toUpperCase())}</span>
      </div>
      <div class="active-po-metrics">
        <div class="active-po-metric"><div class="active-po-metric-label">Target Qty.</div><div class="active-po-metric-value">${displayQty(po.targetQty)}</div></div>
        <div class="active-po-metric"><div class="active-po-metric-label">Produced / Packed</div><div class="active-po-metric-value" style="color:#0284c7;">${displayQty(po.producedQty)}</div></div>
        <div class="active-po-metric"><div class="active-po-metric-label">Remaining Qty.</div><div class="active-po-metric-value" style="color:#b45309;">${displayQty(po.remainingQty)}</div></div>
      </div>
      <div class="active-po-progress-track"><div class="active-po-progress-fill" style="width:${po.completedPercent.toFixed(1)}%;"></div></div>
      <div class="active-po-progress-text">${po.completedPercent.toFixed(1)}% completed</div>
    </article>
  `).join("");
}

window.openActivePoDetails = function() {
  renderActivePoDetails();
  document.getElementById("activePoDetailsOverlay")?.classList.add("open");
};

window.closeActivePoDetails = function() {
  document.getElementById("activePoDetailsOverlay")?.classList.remove("open");
};

let currentDashboardDetailType = "";

function dashboardQty(value) {
  return Number(value || 0).toLocaleString("en-IN");
}

function dashboardPalletQty(pallet) {
  return Number(pallet?.count || (pallet?.serials || pallet?.fullRows || []).length || 0);
}

function dashboardPoNumberFromPallet(pallet) {
  let poNumber = String(pallet?.po || "").trim();
  if (!poNumber && pallet?.fullRows?.[0]?.po) poNumber = String(pallet.fullRows[0].po).trim();
  if (!poNumber && pallet?.pallet) {
    const match = String(pallet.pallet).trim().match(/^A([^-]+)-/i);
    if (match) poNumber = match[1];
  }
  return poNumber || "UNASSIGNED";
}

function getDashboardTodayPackedPallets() {
  const today = getFormattedToday();
  return (godownStock || []).filter(pallet => String(pallet.date || "").trim() === today);
}

function getDashboardMonthlyPackedPallets(monthKey) {
  const uniquePallets = new Map();
  const rememberPallet = (pallet, fallbackDate = "") => {
    const packedDate = String(pallet?.date || fallbackDate || "").trim();
    if (!packedDate.endsWith(monthKey)) return;
    const key = String(pallet?.pallet || "").trim().toUpperCase() || `${dashboardPoNumberFromPallet(pallet)}-${(pallet?.serials || []).join("|")}`;
    if (key && !uniquePallets.has(key)) uniquePallets.set(key, { ...pallet, date: packedDate });
  };
  (godownStock || []).forEach(pallet => rememberPallet(pallet));
  (dispatchArchive || []).forEach(manifest => (manifest.pallets || []).forEach(pallet => rememberPallet(pallet, manifest.date)));
  return [...uniquePallets.values()];
}

function getDashboardManifestPoNumbers(manifest) {
  const fromPallets = [...new Set((manifest?.pallets || []).map(dashboardPoNumberFromPallet).filter(po => po && po !== "UNASSIGNED"))];
  if (fromPallets.length) return fromPallets.join(", ");
  const manifestPo = String(manifest?.po || "").trim();
  return manifestPo && manifestPo !== "MULTI-PO" ? manifestPo : "UNASSIGNED";
}

function dashboardDetailCard(title, subtitle, metrics, progress = null, index = 0) {
  const metricHtml = metrics.map(metric => `
    <div class="active-po-metric">
      <div class="active-po-metric-label">${escapeSalesHtml(metric.label)}</div>
      <div class="active-po-metric-value"${metric.color ? ` style="color:${metric.color};"` : ""}>${escapeSalesHtml(metric.value)}</div>
    </div>
  `).join("");
  const progressHtml = progress === null ? "" : `
    <div class="active-po-progress-track"><div class="active-po-progress-fill" style="width:${Math.max(0, Math.min(100, progress)).toFixed(1)}%;"></div></div>
    <div class="active-po-progress-text">${Math.max(0, Math.min(100, progress)).toFixed(1)}% complete</div>
  `;
  return `<article class="active-po-record" style="animation-delay:${index * 45}ms;">
    <div class="active-po-record-top"><div><div class="active-po-record-title">${escapeSalesHtml(title)}</div><div class="active-po-record-model">${escapeSalesHtml(subtitle)}</div></div></div>
    <div class="active-po-metrics">${metricHtml}</div>${progressHtml}
  </article>`;
}

function buildDashboardDetail(type) {
  const today = getFormattedToday();
  const monthKey = today.split("/").slice(1).join("/");
  const todayPallets = getDashboardTodayPackedPallets();
  const monthPallets = getDashboardMonthlyPackedPallets(monthKey);

  if (type === "todayPallets") {
    return {
      title: "Today's Pallets Packed",
      subtitle: `${todayPallets.length} pallet(s) sealed on ${today}.`,
      cards: todayPallets.map((pallet, index) => dashboardDetailCard(
        `Pallet: ${pallet.pallet || "-"}`,
        `${pallet.model || "Model not set"} · ${pallet.grade || "A GRADE"}`,
        [
          { label: "PO Number", value: dashboardPoNumberFromPallet(pallet) },
          { label: "Packed Qty.", value: dashboardQty(dashboardPalletQty(pallet)), color: "#0284c7" },
          { label: "Wattage", value: pallet.watt || "-" }
        ],
        null,
        index
      ))
    };
  }

  if (type === "todayModules") {
    const byPo = new Map();
    todayPallets.forEach(pallet => {
      const po = dashboardPoNumberFromPallet(pallet);
      const row = byPo.get(po) || { qty: 0, pallets: 0, models: new Set() };
      row.qty += dashboardPalletQty(pallet);
      row.pallets += 1;
      if (pallet.model) row.models.add(pallet.model);
      byPo.set(po, row);
    });
    return {
      title: "Today's Modules Packed",
      subtitle: `${dashboardQty(todayPallets.reduce((sum, pallet) => sum + dashboardPalletQty(pallet), 0))} module(s) packed on ${today}, grouped by PO.`,
      cards: [...byPo.entries()].map(([po, row], index) => dashboardDetailCard(
        `PO: ${po}`,
        [...row.models].join(", ") || "Model not set",
        [
          { label: "Modules Packed", value: dashboardQty(row.qty), color: "#0284c7" },
          { label: "Pallets", value: dashboardQty(row.pallets) },
          { label: "Date", value: today }
        ],
        null,
        index
      ))
    };
  }

  if (type === "todayDispatch") {
    const dispatches = (dispatchArchive || []).filter(manifest => reportHubYmd(manifest.createdAt || manifest.dispatchedAt || manifest.date) === productionToday());
    return {
      title: "Today's Dispatch",
      subtitle: `${dashboardQty(dispatches.reduce((sum, manifest) => sum + Number(manifest.dispatchedQty || 0), 0))} module(s) dispatched on ${today}.`,
      cards: dispatches.map((manifest, index) => dashboardDetailCard(
        `Invoice: ${manifest.invoice || "-"}`,
        `${manifest.customer || "Customer not recorded"} · Vehicle: ${manifest.vehicle || "-"}`,
        [
          { label: "PO Number(s)", value: getDashboardManifestPoNumbers(manifest) },
          { label: "Dispatched Qty.", value: dashboardQty(manifest.dispatchedQty), color: "#059669" },
          { label: "Challan No.", value: manifest.challanNo || "-" }
        ],
        null,
        index
      ))
    };
  }

  if (type === "monthlyProductionDispatch") {
    const packedByPo = new Map();
    monthPallets.forEach(pallet => {
      const po = dashboardPoNumberFromPallet(pallet);
      packedByPo.set(po, (packedByPo.get(po) || 0) + dashboardPalletQty(pallet));
    });
    const dispatchByPo = new Map();
    (dispatchArchive || []).filter(manifest => reportHubYmd(manifest.createdAt || manifest.dispatchedAt || manifest.date).slice(0, 7) === productionToday().slice(0, 7)).forEach(manifest => {
      const pallets = manifest.pallets || [];
      if (pallets.length) {
        pallets.forEach(pallet => {
          const po = dashboardPoNumberFromPallet(pallet);
          dispatchByPo.set(po, (dispatchByPo.get(po) || 0) + dashboardPalletQty(pallet));
        });
      } else {
        const po = getDashboardManifestPoNumbers(manifest);
        dispatchByPo.set(po, (dispatchByPo.get(po) || 0) + Number(manifest.dispatchedQty || 0));
      }
    });
    const poNumbers = [...new Set([...packedByPo.keys(), ...dispatchByPo.keys()])];
    return {
      title: `Packing vs Dispatch (${monthKey})`,
      subtitle: "Current-month PO-wise packing and dispatch figures.",
      cards: poNumbers.map((po, index) => {
        const packed = packedByPo.get(po) || 0;
        const dispatched = dispatchByPo.get(po) || 0;
        return dashboardDetailCard(`PO: ${po}`, "Current-month movement", [
          { label: "Packed", value: dashboardQty(packed), color: "#0284c7" },
          { label: "Dispatched", value: dashboardQty(dispatched), color: "#059669" },
          { label: "Balance", value: dashboardQty(packed - dispatched), color: "#b45309" }
        ], null, index);
      })
    };
  }

  if (type === "monthlyGrade") {
    const gradesByPo = new Map();
    monthPallets.forEach(pallet => {
      const po = dashboardPoNumberFromPallet(pallet);
      const grade = String(pallet.grade || "A").trim().toUpperCase().startsWith("B") ? "b" : (String(pallet.grade || "A").trim().toUpperCase().startsWith("R") ? "r" : "a");
      const row = gradesByPo.get(po) || { a: 0, b: 0, r: 0 };
      row[grade] += dashboardPalletQty(pallet);
      gradesByPo.set(po, row);
    });
    return {
      title: `Grade Breakdown (${monthKey})`,
      subtitle: "Current-month grade quantities, grouped by PO.",
      cards: [...gradesByPo.entries()].map(([po, grades], index) => dashboardDetailCard(
        `PO: ${po}`,
        `Total packed: ${dashboardQty(grades.a + grades.b + grades.r)}`,
        [
          { label: "A Grade", value: dashboardQty(grades.a), color: "#059669" },
          { label: "B Grade", value: dashboardQty(grades.b), color: "#d97706" },
          { label: "R Grade", value: dashboardQty(grades.r), color: "#dc2626" }
        ],
        null,
        index
      ))
    };
  }

  const stockByPo = new Map();
  (godownStock || []).forEach(pallet => {
    const po = dashboardPoNumberFromPallet(pallet);
    const row = stockByPo.get(po) || { qty: 0, pallets: 0, models: new Set() };
    row.qty += dashboardPalletQty(pallet);
    row.pallets += 1;
    if (pallet.model) row.models.add(pallet.model);
    stockByPo.set(po, row);
  });
  const totalStock = [...stockByPo.values()].reduce((sum, row) => sum + row.qty, 0);
  return {
    title: "Stock Breakdown by PO",
    subtitle: `${dashboardQty(totalStock)} module(s) currently in finished-goods stock.`,
    cards: [...stockByPo.entries()].map(([po, row], index) => dashboardDetailCard(
      `PO: ${po}`,
      [...row.models].join(", ") || "Model not set",
      [
        { label: "Modules in Stock", value: dashboardQty(row.qty), color: "#0284c7" },
        { label: "Pallets", value: dashboardQty(row.pallets) },
        { label: "Stock Share", value: `${totalStock ? ((row.qty / totalStock) * 100).toFixed(1) : 0}%` }
      ],
      totalStock ? (row.qty / totalStock) * 100 : 0,
      index
    ))
  };
}

function renderDashboardDetails(type) {
  const list = document.getElementById("dashboardDetailsList");
  const title = document.getElementById("dashboardDetailsTitle");
  const subtitle = document.getElementById("dashboardDetailsSubtitle");
  if (!list || !title || !subtitle) return;
  const detail = buildDashboardDetail(type);
  title.textContent = detail.title;
  subtitle.textContent = detail.subtitle;
  list.innerHTML = detail.cards.length ? detail.cards.join("") : `<div class="active-po-empty">No records are available for this period.</div>`;
}

window.openDashboardDetails = function(type) {
  currentDashboardDetailType = type;
  renderDashboardDetails(type);
  document.getElementById("dashboardDetailsOverlay")?.classList.add("open");
};

window.closeDashboardDetails = function() {
  document.getElementById("dashboardDetailsOverlay")?.classList.remove("open");
  currentDashboardDetailType = "";
};

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    window.closeActivePoDetails();
    window.closeDashboardDetails();
  }
});

function renderDailyPackingChart(monthlyPallets, monthKey) {
  const svg = document.getElementById("adminDailyPackingChart");
  if (!svg) return;
  const title = document.getElementById("adminDailyPackingTitle");
  if (title) title.textContent = `Daily Packing Report (${monthKey})`;

  const todayParts = getFormattedToday().split("/").map(Number);
  const dayCount = Math.max(1, todayParts[0] || 1);
  const dailyTotals = Array.from({ length: dayCount }, () => 0);
  (monthlyPallets || []).forEach(pallet => {
    const match = String(pallet?.date || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match || `${match[2]}/${match[3]}` !== monthKey) return;
    const day = Number(match[1]);
    if (day >= 1 && day <= dayCount) dailyTotals[day - 1] += dashboardPalletQty(pallet);
  });

  const total = dailyTotals.reduce((sum, value) => sum + value, 0);
  const packingDays = dailyTotals.filter(value => value > 0);
  const maximum = Math.max(...dailyTotals, 0);
  const bestIndex = maximum > 0 ? dailyTotals.indexOf(maximum) : -1;
  const setText = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
  setText("dailyPackingMonthTotal", `${total.toLocaleString("en-IN")} modules`);
  setText("dailyPackingBestDay", bestIndex >= 0 ? `${String(bestIndex + 1).padStart(2, "0")}/${monthKey.split("/")[0]} · ${maximum.toLocaleString("en-IN")}` : "-");
  setText("dailyPackingAverage", packingDays.length ? `${Math.round(total / packingDays.length).toLocaleString("en-IN")} modules` : "0 modules");

  const width = 1000, height = 280, left = 64, right = 24, top = 24, bottom = 48;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const roughMax = Math.max(maximum, 10);
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughMax)));
  const fraction = roughMax / magnitude;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  const yMax = niceFraction * magnitude;
  const xForDay = index => dayCount === 1 ? left + plotWidth / 2 : left + (index / (dayCount - 1)) * plotWidth;
  const yForValue = value => top + plotHeight - (value / yMax) * plotHeight;
  const points = dailyTotals.map((value, index) => `${xForDay(index).toFixed(1)},${yForValue(value).toFixed(1)}`).join(" ");
  const areaPoints = `${left},${top + plotHeight} ${points} ${dayCount === 1 ? left + plotWidth / 2 : left + plotWidth},${top + plotHeight}`;
  const yGrid = Array.from({ length: 5 }, (_, index) => {
    const value = (yMax / 4) * index;
    const y = yForValue(value);
    return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="${index === 0 ? "#94a3b8" : "#e2e8f0"}" stroke-width="${index === 0 ? 1.5 : 1}" />
      <text x="${left - 10}" y="${y + 4}" text-anchor="end" font-size="11" fill="#64748b">${Math.round(value).toLocaleString("en-IN")}</text>`;
  }).join("");
  const labelEvery = Math.max(1, Math.ceil(dayCount / 12));
  const xLabels = dailyTotals.map((value, index) => {
    const day = index + 1;
    if (day !== 1 && day !== dayCount && day % labelEvery !== 0) return "";
    return `<text x="${xForDay(index)}" y="${height - 20}" text-anchor="middle" font-size="11" fill="#64748b">${String(day).padStart(2, "0")}</text>`;
  }).join("");
  const markers = dailyTotals.map((value, index) => value > 0 ? `<g><circle cx="${xForDay(index)}" cy="${yForValue(value)}" r="4.5" fill="#0f9f95" stroke="#ffffff" stroke-width="2"><title>${String(index + 1).padStart(2, "0")}/${monthKey}: ${value.toLocaleString("en-IN")} modules</title></circle><text x="${xForDay(index)}" y="${Math.max(14, yForValue(value) - 10)}" text-anchor="middle" font-size="10" font-weight="800" fill="#0f766e">${value.toLocaleString("en-IN")}</text></g>` : "").join("");

  svg.innerHTML = `<defs>
      <linearGradient id="dailyPackingLine" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#075985"/><stop offset="52%" stop-color="#0891b2"/><stop offset="100%" stop-color="#10b981"/></linearGradient>
      <linearGradient id="dailyPackingArea" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#075985" stop-opacity="0.28"/><stop offset="52%" stop-color="#0891b2" stop-opacity="0.18"/><stop offset="100%" stop-color="#10b981" stop-opacity="0.03"/></linearGradient>
    </defs>
    ${yGrid}
    <line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotHeight}" stroke="#94a3b8" stroke-width="1.5" />
    <polygon points="${areaPoints}" fill="url(#dailyPackingArea)" />
    <polyline points="${points}" fill="none" stroke="#ffffff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9" />
    <polyline points="${points}" fill="none" stroke="url(#dailyPackingLine)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />
    ${markers}${xLabels}
    <text x="${left + plotWidth / 2}" y="${height - 3}" text-anchor="middle" font-size="11" font-weight="700" fill="#475569">Packing Date (Day of Month)</text>
    <text x="15" y="${top + plotHeight / 2}" text-anchor="middle" font-size="11" font-weight="700" fill="#475569" transform="rotate(-90 15 ${top + plotHeight / 2})">Modules Packed</text>
    ${total === 0 ? `<text x="${left + plotWidth / 2}" y="${top + plotHeight / 2}" text-anchor="middle" font-size="14" font-weight="700" fill="#94a3b8">No packing recorded this month</text>` : ""}`;
}

function renderAdminCharts(packedQty, dispQty, monthlyGrades = { a: 0, b: 0, r: 0 }) {
  const chartHeight = 120;

  // ----------------------------------------------------
  // CHART 1: PACKING VS DISPATCH (CURRENT MONTH)
  // ----------------------------------------------------
  const barSvg = document.getElementById("adminBarChart");
  if (barSvg) {
    const maxVal = Math.max(packedQty, dispQty, 50);
    const packedBarHeight = (packedQty / maxVal) * chartHeight;
    const dispBarHeight = (dispQty / maxVal) * chartHeight;

    barSvg.innerHTML = `
      <line x1="20" y1="145" x2="300" y2="145" stroke="#cbd5e1" stroke-width="2" />
      <rect x="70" y="${145 - packedBarHeight}" width="45" height="${packedBarHeight}" fill="#0284c7" rx="4" />
      <text x="92" y="${137 - packedBarHeight}" text-anchor="middle" font-size="11" font-weight="bold" fill="#0f172a">${packedQty}</text>
      <text x="92" y="162" text-anchor="middle" font-size="11" fill="#64748b">Packed</text>

      <rect x="190" y="${145 - dispBarHeight}" width="45" height="${dispBarHeight}" fill="#059669" rx="4" />
      <text x="212" y="${137 - dispBarHeight}" text-anchor="middle" font-size="11" font-weight="bold" fill="#0f172a">${dispQty}</text>
      <text x="212" y="162" text-anchor="middle" font-size="11" fill="#64748b">Dispatched</text>
    `;
  }

  // ----------------------------------------------------
  // CHART 2: MONTHLY GRADE BREAKDOWN (SCALE OF 100)
  // ----------------------------------------------------
  const gradeSvg = document.getElementById("adminGradeBarChart");
  if (gradeSvg) {
    const totalMonthUnits = (monthlyGrades.a + monthlyGrades.b + monthlyGrades.r);
    
    // Scale on 100%
    const pctA = totalMonthUnits > 0 ? (monthlyGrades.a / totalMonthUnits) * 100 : 0;
    const pctB = totalMonthUnits > 0 ? (monthlyGrades.b / totalMonthUnits) * 100 : 0;
    const pctR = totalMonthUnits > 0 ? (monthlyGrades.r / totalMonthUnits) * 100 : 0;

    // Direct pixel mapping (100% = chartHeight pixels)
    const hA = (pctA / 100) * chartHeight;
    const hB = (pctB / 100) * chartHeight;
    const hR = (pctR / 100) * chartHeight;

    gradeSvg.innerHTML = `
      <!-- Scale 100 Reference Guidelines -->
      <line x1="20" y1="${145 - chartHeight}" x2="300" y2="${145 - chartHeight}" stroke="#f1f5f9" stroke-width="1" stroke-dasharray="3,3" />
      <text x="18" y="${148 - chartHeight}" text-anchor="end" font-size="9" fill="#94a3b8">100%</text>

      <line x1="20" y1="${145 - (chartHeight / 2)}" x2="300" y2="${145 - (chartHeight / 2)}" stroke="#f1f5f9" stroke-width="1" stroke-dasharray="3,3" />
      <text x="18" y="${148 - (chartHeight / 2)}" text-anchor="end" font-size="9" fill="#94a3b8">50%</text>

      <line x1="20" y1="145" x2="300" y2="145" stroke="#cbd5e1" stroke-width="2" />

      <!-- Grade A Bar -->
      <rect x="45" y="${145 - hA}" width="40" height="${hA}" fill="#059669" rx="3" />
      <text x="65" y="${137 - hA}" text-anchor="middle" font-size="10" font-weight="bold" fill="#0f172a">${pctA.toFixed(1)}%</text>
      <text x="65" y="160" text-anchor="middle" font-size="10" font-weight="bold" fill="#64748b">A (${monthlyGrades.a})</text>

      <!-- Grade B Bar -->
      <rect x="135" y="${145 - hB}" width="40" height="${hB}" fill="#d97706" rx="3" />
      <text x="155" y="${137 - hB}" text-anchor="middle" font-size="10" font-weight="bold" fill="#0f172a">${pctB.toFixed(1)}%</text>
      <text x="155" y="160" text-anchor="middle" font-size="10" font-weight="bold" fill="#64748b">B (${monthlyGrades.b})</text>

      <!-- Grade R Bar -->
      <rect x="225" y="${145 - hR}" width="40" height="${hR}" fill="#dc2626" rx="3" />
      <text x="245" y="${137 - hR}" text-anchor="middle" font-size="10" font-weight="bold" fill="#0f172a">${pctR.toFixed(1)}%</text>
      <text x="245" y="160" text-anchor="middle" font-size="10" font-weight="bold" fill="#64748b">R (${monthlyGrades.r})</text>
    `;
  }

  // ----------------------------------------------------
  // CHART 3: STOCK BREAKDOWN BY PO (PIE CHART)
  // ----------------------------------------------------
  const pieSvg = document.getElementById("adminPieChart");
  const legendBox = document.getElementById("adminPieLegend");
  if (!pieSvg || !legendBox) return;

  let totalModules = godownStock.reduce((sum, p) => sum + p.count, 0);

  const countsByPo = {};
  godownStock.forEach(item => {
    let poKey = (item.po || "").trim();
    if (!poKey || poKey === "-") {
      if (item.fullRows && item.fullRows.length > 0 && item.fullRows[0].po) {
        poKey = item.fullRows[0].po;
      } else if (item.pallet && item.pallet.startsWith("A") && item.pallet.includes("-")) {
        poKey = item.pallet.split("-")[0].substring(1);
      } else {
        poKey = "UNASSIGNED";
      }
    }
    countsByPo[poKey] = (countsByPo[poKey] || 0) + item.count;
  });

  const pieEntries = Object.entries(countsByPo).sort((a, b) => String(b[0]).localeCompare(String(a[0]), undefined, { numeric: true, sensitivity: "base" }));
  const poKeys = pieEntries.map(entry => entry[0]);
  const colors = ["#075985", "#0284c7", "#0891b2", "#0f766e", "#10b981", "#22c55e", "#d97706", "#7c3aed", "#e11d48"];

  if (poKeys.length === 0 || totalModules === 0) {
    pieSvg.innerHTML = `<circle cx="0" cy="0" r="0.8" fill="#e2e8f0" />`;
    legendBox.innerHTML = `<span style="color:var(--muted);">No inventory in godown</span>`;
    return;
  }

  let cumulativeAngle = 0;
  let pathElements = `<defs><filter id="adminPieSoftShadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0.025" dy="0" stdDeviation="0.035" flood-color="#0f172a" flood-opacity="0.2" /></filter></defs><style>#adminPieChart path{transition:opacity .16s ease;}#adminPieChart path:hover{opacity:.82;}</style><g filter="url(#adminPieSoftShadow)">`;
  let legendHtml = "";

  pieEntries.forEach(([po, sliceQty], idx) => {
    const slicePct = sliceQty / totalModules;
    const angle = slicePct * 2 * Math.PI;
    const color = colors[idx % colors.length];
    const x1 = Math.cos(cumulativeAngle);
    const y1 = Math.sin(cumulativeAngle);
    cumulativeAngle += angle;
    const x2 = Math.cos(cumulativeAngle);
    const y2 = Math.sin(cumulativeAngle);
    const largeArc = slicePct > .5 ? 1 : 0;
    const safePo = escapeSalesHtml(po);
    pathElements += pieEntries.length === 1
      ? `<circle cx="0" cy="0" r="0.9" fill="${color}"><title>${safePo}: ${sliceQty.toLocaleString("en-IN")} modules (100%)</title></circle>`
      : `<path d="M 0 0 L ${x1} ${y1} A 1 1 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${color}" stroke="#ffffff" stroke-width="0.018" stroke-linejoin="round"><title>${safePo}: ${sliceQty.toLocaleString("en-IN")} modules (${(slicePct * 100).toFixed(1)}%)</title></path>`;
    legendHtml += `
      <div style="display:flex; align-items:center; gap:7px; color:#334155;">
        <span style="width:9px; height:9px; border-radius:2px; background:${color}; flex-shrink:0;"></span>
        <span title="${safePo}"><strong>${safePo}</strong>: ${sliceQty.toLocaleString("en-IN")} (${Math.round(slicePct * 100)}%)</span>
      </div>
    `;
  });

  pathElements += `<circle cx="0" cy="0" r="1" fill="none" stroke="#ffffff" stroke-width="0.025" /></g>`;
  pieSvg.innerHTML = pathElements;
  legendBox.innerHTML = legendHtml;
}


function applyUserRightsToSidebar(user) {
  if (!user) return;

  APP_MENUS.forEach(menu => {
    const blockEl = document.getElementById(menu.blockId);
    if (!blockEl) return;

    const isParentAllowed = (menu.id === "utilities" && user.rights?.utilities !== false)
      || !!(user.rights && user.rights[menu.id])
      || (menu.id === "it" && user.rights?.nfcCards === true)
      || (menu.id === "tripExpenses" && menu.submenus.some(sub => user.rights?.[sub.id] === true));
    if (!isParentAllowed) {
      blockEl.style.display = "none";
    } else {
      let hasAnyVisibleChild = false;
      menu.submenus.forEach(sub => {
        const subEl = document.getElementById(sub.elementId);
        const isSubAllowed = menu.id === "utilities"
          ? user.rights?.[sub.id] !== false
          : !!(user.rights && user.rights[sub.id]);
        if (subEl) subEl.style.display = isSubAllowed ? "block" : "none";
        if (isSubAllowed) hasAnyVisibleChild = true;
      });
      if (menu.submenus.length > 0 && !hasAnyVisibleChild) {
        blockEl.style.display = "none";
      } else {
        blockEl.style.display = "flex";
      }
      document.querySelectorAll(`[data-right-group-parent="${menu.id}"]`).forEach(group => {
        const rightIds = String(group.dataset.rightIds || "").split(",").map(id => id.trim()).filter(Boolean);
        group.style.display = rightIds.some(id => user.rights?.[id] === true) ? "block" : "none";
      });
    }
  });
}

window.toggleProfileDropdown = function() {
  document.getElementById("profileDropdownMenu").classList.toggle("show");
};

window.addEventListener("click", e => {
  if (!e.target.closest(".profile-dropdown-container")) {
    document.getElementById("profileDropdownMenu")?.classList.remove("show");
  }
});

window.logout = async function() {
  window.stopNotificationLiveUpdates?.();
  // Start the protected server revocation, but never hold the visible logout
  // transition behind database/audit latency.
  const serverLogout = erpFetchWithTimeout("backend/api.php?action=logout", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true
  }, 5000).catch(() => null);
  currentLoggedInUser = null;
  sessionStorage.removeItem(KEY_SESSION);
  document.getElementById("txtUser").value = "";
  document.getElementById("txtPass").value = "";
  document.getElementById("profileDropdownMenu").classList.remove("show");
  document.getElementById("loginOverlay").style.display = "flex";
  if (liveSyncTimer) window.clearTimeout(liveSyncTimer);
  liveSyncTimer = null;
  setLiveSyncStatus("paused", "STANDBY", "Live synchronization starts after sign-in.");
  scheduleLiveSync(3000);
  void serverLogout;
};

window.toggleSubmenu = function(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = (el.style.display === "flex" || el.style.display === "block") ? "none" : "flex";
};

function getFormattedToday() {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function getRouteFareToday() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatRouteFareDate(dateValue) {
  const match = String(dateValue || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : (dateValue || "-");
}

function populateRouteFareTransporterSuggestions() {
  const list = document.getElementById("routeFareTransporterList");
  if (!list) return;
  const names = [...new Set((transportersDb || []).map(item => String(item.name || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  list.innerHTML = names.map(name => `<option value="${escapeSalesHtml(name)}"></option>`).join("");
}

function getRouteFareOptions(record) {
  const savedOptions = Array.isArray(record?.fareOptions) ? record.fareOptions : [];
  const options = savedOptions.length
    ? savedOptions
    : [
      { transporter: record?.transporter, amount: record?.amount },
      { transporter: record?.transporter2, amount: record?.amount2 },
      { transporter: record?.transporter3, amount: record?.amount3 }
    ];
  return options.slice(0, 3).map(option => ({
    transporter: String(option?.transporter || "").trim(),
    amount: Number(option?.amount || 0)
  }));
}

function formatRouteFareAmount(amount) {
  return `₹ ${Number(amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

window.renderRouteFareTable = function() {
  const tbody = document.getElementById("routeFareTableBody");
  if (!tbody) return;

  const search = String(document.getElementById("routeFareSearch")?.value || "").trim().toLowerCase();
  const searchField = String(document.getElementById("routeFareSearchField")?.value || "any");
  const filterDate = String(document.getElementById("routeFareFilterDate")?.value || "");
  const filterTransporter = String(document.getElementById("routeFareFilterTransporter")?.value || "").trim().toLowerCase();
  const filterFrom = String(document.getElementById("routeFareFilterFrom")?.value || "").trim().toLowerCase();
  const filterTo = String(document.getElementById("routeFareFilterTo")?.value || "").trim().toLowerCase();
  const filterAmount = String(document.getElementById("routeFareFilterAmount")?.value || "").trim().toLowerCase();
  const filterRemarks = String(document.getElementById("routeFareFilterRemarks")?.value || "").trim().toLowerCase();

  const fieldLabels = {
    any: "Any Detail",
    date: "Date",
    transporter: "Transporter Name",
    fromPlace: "Starting Place",
    toPlace: "Ending Place",
    amount: "Fare",
    remarks: "Remarks"
  };
  const searchLabel = document.getElementById("routeFareSearchLabel");
  if (searchLabel) searchLabel.textContent = `SEARCH ROUTE FARES — ${String(fieldLabels[searchField] || "Any Detail").toUpperCase()}`;

  const matches = [...(routeFaresDb || [])]
    .filter(record => {
      const fareOptions = getRouteFareOptions(record);
      const values = {
        date: `${record.date || ""} ${formatRouteFareDate(record.date)}`.toLowerCase(),
        transporter: fareOptions.map(option => option.transporter).filter(Boolean).join(" ").toLowerCase(),
        fromPlace: String(record.fromPlace || "").toLowerCase(),
        toPlace: String(record.toPlace || "").toLowerCase(),
        amount: fareOptions.map(option => `${option.amount} ${Number(option.amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(" ").toLowerCase(),
        remarks: String(record.remarks || "").toLowerCase()
      };
      const searchable = [...Object.values(values), String(record.savedBy || "").toLowerCase()].join(" ");
      const mainSearchMatches = !search || (searchField === "any" ? searchable.includes(search) : String(values[searchField] || "").includes(search));
      const combinationMatches =
        (!filterDate || String(record.date || "") === filterDate) &&
        (!filterTransporter || values.transporter.includes(filterTransporter)) &&
        (!filterFrom || values.fromPlace.includes(filterFrom)) &&
        (!filterTo || values.toPlace.includes(filterTo)) &&
        (!filterAmount || values.amount.includes(filterAmount)) &&
        (!filterRemarks || values.remarks.includes(filterRemarks));
      return mainSearchMatches && combinationMatches;
    })
    .sort((first, second) => String(second.date || "").localeCompare(String(first.date || "")) || Number(second.id || 0) - Number(first.id || 0));

  const counter = document.getElementById("routeFareResultCount");
  if (counter) counter.textContent = `${matches.length} record${matches.length === 1 ? "" : "s"} found`;

  if (!matches.length) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; padding:24px; color:var(--muted);">${routeFaresDb.length ? "No route fares match the selected filters." : "No route fare records saved yet."}</td></tr>`;
    return;
  }

  tbody.innerHTML = matches.map((record, index) => {
    const fareOptions = getRouteFareOptions(record);
    const fareColumns = [0, 1, 2].map(index => {
      const option = fareOptions[index];
      return `<td>${option?.transporter ? `<strong>${escapeSalesHtml(option.transporter)}</strong>` : "-"}</td><td style="text-align:right; font-weight:800; color:${option?.amount > 0 ? "#047857" : "var(--muted)"};">${option?.amount > 0 ? formatRouteFareAmount(option.amount) : "-"}</td>`;
    }).join("");
    return `<tr>
      <td>${index + 1}</td>
      <td>${escapeSalesHtml(formatRouteFareDate(record.date))}</td>
      <td><strong>${escapeSalesHtml(record.fromPlace || "-")}</strong> <span style="color:var(--muted);">→</span> <strong>${escapeSalesHtml(record.toPlace || "-")}</strong></td>
      ${fareColumns}
      <td>${escapeSalesHtml(record.remarks || "-")}</td>
      <td>${escapeSalesHtml(record.savedBy || "SYSTEM")}</td>
    </tr>`;
  }).join("");
};

window.searchRouteFares = function() {
  window.renderRouteFareTable();
};

window.onRouteFareSearchFieldChange = function() {
  const field = String(document.getElementById("routeFareSearchField")?.value || "any");
  const input = document.getElementById("routeFareSearch");
  const placeholders = {
    any: "Type to search any route fare detail...",
    date: "Type date, e.g. 24/09/2026...",
    transporter: "Type transporter name...",
    fromPlace: "Type starting place...",
    toPlace: "Type ending place...",
    amount: "Type fare amount...",
    remarks: "Type remarks..."
  };
  if (input) input.placeholder = placeholders[field] || placeholders.any;
  window.renderRouteFareTable();
};

window.resetRouteFareSearch = function() {
  ["routeFareSearch", "routeFareFilterDate", "routeFareFilterTransporter", "routeFareFilterFrom", "routeFareFilterTo", "routeFareFilterAmount", "routeFareFilterRemarks"].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = "";
  });
  const searchField = document.getElementById("routeFareSearchField");
  if (searchField) searchField.value = "any";
  window.onRouteFareSearchFieldChange();
};

window.resetRouteFareView = function() {
  const dateInput = document.getElementById("routeFareDate");
  if (dateInput) dateInput.value = getRouteFareToday();
  ["routeFareTransporter", "routeFareAmount", "routeFareTransporter2", "routeFareAmount2", "routeFareTransporter3", "routeFareAmount3", "routeFareFrom", "routeFareTo", "routeFareRemarks"].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = "";
  });
  window.resetRouteFareSearch();
  populateRouteFareTransporterSuggestions();
};

window.saveRouteFare = async function() {
  const date = String(document.getElementById("routeFareDate")?.value || "");
  const fromPlace = String(document.getElementById("routeFareFrom")?.value || "").trim().replace(/\s+/g, " ");
  const toPlace = String(document.getElementById("routeFareTo")?.value || "").trim().replace(/\s+/g, " ");
  const remarks = String(document.getElementById("routeFareRemarks")?.value || "").trim();
  const fareOptions = [1, 2, 3].map(index => {
    const suffix = index === 1 ? "" : String(index);
    const transporter = String(document.getElementById(`routeFareTransporter${suffix}`)?.value || "").trim().replace(/\s+/g, " ");
    const rawAmount = String(document.getElementById(`routeFareAmount${suffix}`)?.value || "").trim();
    return { transporter, rawAmount, amount: Number(rawAmount || 0) };
  });
  const [primaryFare] = fareOptions;

  if (!date || !fromPlace || !toPlace || !primaryFare.transporter || !Number.isFinite(primaryFare.amount) || primaryFare.amount <= 0) {
    window.showNotification({ title: "Missing Route Fare Details", message: "Date, starting place, ending place, Transporter 1, and a valid Fare 1 are required.", type: "warning" });
    return;
  }
  const incompleteOptionalFare = fareOptions.slice(1).find(option =>
    (option.transporter && (!option.rawAmount || !Number.isFinite(option.amount) || option.amount <= 0)) ||
    (!option.transporter && option.rawAmount)
  );
  if (incompleteOptionalFare) {
    window.showNotification({ title: "Incomplete Fare Detail", message: "For Transporter 2 or 3, enter both the transporter name and a valid fare—or leave both blank.", type: "warning" });
    return;
  }

  const record = {
    id: Date.now(),
    date,
    transporter: primaryFare.transporter,
    fromPlace,
    toPlace,
    amount: primaryFare.amount,
    fareOptions: fareOptions.filter(option => option.transporter && option.amount > 0).map(option => ({ transporter: option.transporter, amount: option.amount })),
    remarks,
    savedBy: currentLoggedInUser?.username || "SYSTEM",
    savedAt: new Date().toLocaleString("en-IN")
  };
  routeFaresDb.unshift(record);
  await saveStorage(KEY_ROUTE_FARES, routeFaresDb);
  await logEvent("DISPATCH", "ROUTE_FARE_SAVED", `Route fare saved: ${primaryFare.transporter}, ${fromPlace} to ${toPlace}, ${fareOptions.filter(option => option.transporter && option.amount > 0).length} transporter quote(s).`);

  ["routeFareTransporter", "routeFareAmount", "routeFareTransporter2", "routeFareAmount2", "routeFareTransporter3", "routeFareAmount3", "routeFareFrom", "routeFareTo", "routeFareRemarks"].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = "";
  });
  populateRouteFareTransporterSuggestions();
  window.renderRouteFareTable();
  window.showNotification({ title: "Route Fare Saved", message: `${primaryFare.transporter}: ${fromPlace} to ${toPlace} has been saved with ${fareOptions.filter(option => option.transporter && option.amount > 0).length} transporter quote(s).`, type: "success" });
};

function vehicleBookingKey(value) {
  return String(value || "").trim().toUpperCase();
}

function getUnbookedAccountInvoices() {
  const bookedInvoices = new Set((vehicleBookingsDb || [])
    .filter(record => String(record.status || "ACTIVE").toUpperCase() !== "CANCELLED")
    .map(record => vehicleBookingKey(record.invoiceNumber)));
  return (accountInvoices || []).filter(invoice => invoice.invoiceNumber && !bookedInvoices.has(vehicleBookingKey(invoice.invoiceNumber)));
}

window.populateVehicleBookingCoDropdown = function() {
  const select = document.getElementById("vehicleBookingCo");
  if (!select) return;
  const previous = select.value;
  const coNumbers = [...new Map((salesOrders || []).filter(order => order.coNumber).map(order => [vehicleBookingKey(order.coNumber), order])).values()];
  select.innerHTML = `<option value="">${coNumbers.length ? "-- Select C/O Number --" : "-- No Sales Order C/O available --"}</option>` + coNumbers.map(order =>
    `<option value="${escapeSalesHtml(order.coNumber)}">${escapeSalesHtml(order.coNumber)} — ${escapeSalesHtml(order.customerName || "Customer not recorded")}</option>`
  ).join("");
  if (coNumbers.some(order => vehicleBookingKey(order.coNumber) === vehicleBookingKey(previous))) select.value = previous;
  window.populateVehicleBookingInvoices();
};

window.populateVehicleBookingInvoices = function() {
  const coNumber = document.getElementById("vehicleBookingCo")?.value || "";
  const select = document.getElementById("vehicleBookingInvoice");
  if (!select) return;
  const previous = select.value;
  const invoices = getUnbookedAccountInvoices().filter(invoice => vehicleBookingKey(invoice.coNumber) === vehicleBookingKey(coNumber));
  select.innerHTML = `<option value="">-- Select Invoice --</option>` + invoices.map(invoice =>
    `<option value="${escapeSalesHtml(invoice.invoiceNumber)}">${escapeSalesHtml(invoice.invoiceNumber)} — ${Number(invoice.quantity || 0).toLocaleString("en-IN")} modules</option>`
  ).join("");
  if (invoices.some(invoice => vehicleBookingKey(invoice.invoiceNumber) === vehicleBookingKey(previous))) select.value = previous;
};

window.resetVehicleBookingView = function() {
  const type = document.getElementById("vehicleBookingType");
  if (type) type.value = "";
  const freight = document.getElementById("vehicleBookingFreight");
  if (freight) freight.value = "";
  const transporter = document.getElementById("vehicleBookingTransporter");
  if (transporter) {
    transporter.innerHTML = `<option value="">${(transportersDb || []).length ? "-- Select Transporter --" : "-- Add Transporter in Master First --"}</option>` + (transportersDb || []).map(item => `<option value="${escapeSalesHtml(item.name)}">${escapeSalesHtml(item.name)}</option>`).join("");
  }
  window.populateVehicleBookingCoDropdown();
  window.populateVehicleSettlementDropdown();
  window.renderVehicleBookingTable();
};

window.saveVehicleBooking = async function() {
  const coNumber = String(document.getElementById("vehicleBookingCo")?.value || "").trim();
  const invoiceNumber = String(document.getElementById("vehicleBookingInvoice")?.value || "").trim();
  const vehicleType = String(document.getElementById("vehicleBookingType")?.value || "").trim();
  const transporterName = String(document.getElementById("vehicleBookingTransporter")?.value || "").trim();
  const originalFreight = Number(document.getElementById("vehicleBookingFreight")?.value || 0);
  if (!coNumber || !invoiceNumber || !vehicleType || !transporterName || !Number.isFinite(originalFreight) || originalFreight <= 0) {
    window.showNotification({ title: "Vehicle Booking Details Required", message: "C/O Number, Invoice Number, Vehicle Type, Transporter and Original Freight are mandatory.", type: "warning" });
    return;
  }
  const invoice = (accountInvoices || []).find(item => vehicleBookingKey(item.invoiceNumber) === vehicleBookingKey(invoiceNumber) && vehicleBookingKey(item.coNumber) === vehicleBookingKey(coNumber));
  if (!invoice) {
    window.showNotification({ title: "Invoice Does Not Match", message: "Select an invoice created against the selected C/O Number.", type: "danger" });
    return;
  }
  if ((vehicleBookingsDb || []).some(record => String(record.status || "ACTIVE").toUpperCase() !== "CANCELLED" && vehicleBookingKey(record.invoiceNumber) === vehicleBookingKey(invoiceNumber))) {
    window.showNotification({ title: "Vehicle Already Booked", message: `Invoice ${invoiceNumber} already has a vehicle booking.`, type: "warning" });
    return;
  }
  const record = {
    id: `VB-${Date.now()}`,
    coNumber: invoice.coNumber,
    invoiceNumber: invoice.invoiceNumber,
    customerName: invoice.customerName || "",
    quantity: Number(invoice.quantity || 0),
    modelNo: invoice.modelNo || "",
    vehicleType,
    transporterName,
    originalFreight,
    unloadingCharges: 0,
    grossAmount: originalFreight,
    deductionAmount: 0,
    finalPayable: originalFreight,
    bookedAt: new Date().toLocaleString("en-IN"),
    bookedBy: currentLoggedInUser?.username || "SYSTEM"
  };
  vehicleBookingsDb.unshift(record);
  const saved = await saveStorage(KEY_VEHICLE_BOOKINGS, vehicleBookingsDb);
  if (saved === false) {
    vehicleBookingsDb = vehicleBookingsDb.filter(item => item.id !== record.id);
    return;
  }
  await logEvent("DISPATCH", "VEHICLE_BOOKED", `Booked ${vehicleType} with ${transporterName} for C/O ${record.coNumber}, Invoice ${record.invoiceNumber}, freight ₹${originalFreight}.`);
  window.showNotification({ title: "Vehicle Booked", message: `${vehicleType} booked with ${transporterName} for Invoice ${record.invoiceNumber}.`, type: "success" });
  window.resetVehicleBookingView();
};

window.populateVehicleSettlementDropdown = function() {
  const select = document.getElementById("vehicleSettlementBooking");
  if (!select) return;
  const previous = select.value;
  const records = (vehicleBookingsDb || []).filter(record => String(record.status || "ACTIVE").toUpperCase() !== "CANCELLED");
  select.innerHTML = `<option value="">${records.length ? "-- Select Vehicle Booking --" : "-- No Vehicle Booking Available --"}</option>` + records.map(record => `<option value="${escapeSalesHtml(record.id)}">${escapeSalesHtml(record.coNumber)} — ${escapeSalesHtml(record.invoiceNumber)} — ${escapeSalesHtml(record.vehicleType)}</option>`).join("");
  if (records.some(record => String(record.id) === String(previous))) select.value = previous;
  window.loadVehicleSettlement();
};

window.loadVehicleSettlement = function() {
  const id = document.getElementById("vehicleSettlementBooking")?.value || "";
  const record = (vehicleBookingsDb || []).find(item => String(item.id) === String(id));
  accountSetValue("vehicleSettlementFreight", record ? Number(record.originalFreight || 0).toFixed(2) : "");
  accountSetValue("vehicleSettlementUnloading", record ? Number(record.unloadingCharges || 0).toFixed(2) : "0");
  accountSetValue("vehicleSettlementDeduction", record ? Number(record.deductionAmount || 0).toFixed(2) : "0");
  window.calculateVehicleSettlement();
};

window.calculateVehicleSettlement = function() {
  const freight = Number(document.getElementById("vehicleSettlementFreight")?.value || 0);
  const unloading = Math.max(0, Number(document.getElementById("vehicleSettlementUnloading")?.value || 0));
  const deduction = Math.max(0, Number(document.getElementById("vehicleSettlementDeduction")?.value || 0));
  const gross = freight + unloading;
  const finalPayable = Math.max(0, gross - deduction);
  accountSetValue("vehicleSettlementGross", gross.toFixed(2));
  accountSetValue("vehicleSettlementFinal", finalPayable.toFixed(2));
};

window.saveVehicleSettlement = async function() {
  const id = document.getElementById("vehicleSettlementBooking")?.value || "";
  const record = (vehicleBookingsDb || []).find(item => String(item.id) === String(id));
  if (!record) {
    window.showNotification({ title: "Select Vehicle Booking", message: "Select a saved vehicle booking before entering settlement amounts.", type: "warning" });
    return;
  }
  const unloadingCharges = Number(document.getElementById("vehicleSettlementUnloading")?.value || 0);
  const deductionAmount = Number(document.getElementById("vehicleSettlementDeduction")?.value || 0);
  const originalFreight = Number(record.originalFreight || 0);
  const grossAmount = originalFreight + unloadingCharges;
  const finalPayable = grossAmount - deductionAmount;
  if (![unloadingCharges, deductionAmount, grossAmount, finalPayable].every(Number.isFinite) || unloadingCharges < 0 || deductionAmount < 0 || deductionAmount > grossAmount) {
    window.showNotification({ title: "Invalid Settlement Amount", message: "Charges and deduction cannot be negative, and deduction cannot exceed the gross amount.", type: "warning" });
    return;
  }
  Object.assign(record, { unloadingCharges, grossAmount, deductionAmount, finalPayable, settledAt: new Date().toLocaleString("en-IN"), settledBy: currentLoggedInUser?.username || "SYSTEM" });
  const saved = await saveStorage(KEY_VEHICLE_BOOKINGS, vehicleBookingsDb);
  if (saved === false) return;
  await logEvent("DISPATCH", "TRANSPORT_SETTLED", `Settlement saved for Invoice ${record.invoiceNumber}: ₹${originalFreight} + ₹${unloadingCharges} - ₹${deductionAmount} = ₹${finalPayable}.`);
  window.showNotification({ title: "Settlement Saved", message: `Final payable for Invoice ${record.invoiceNumber} is ₹${finalPayable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}.`, type: "success" });
  window.renderVehicleBookingTable();
};

window.renderVehicleBookingTable = function() {
  const body = document.getElementById("vehicleBookingTableBody");
  if (!body) return;
  const records = vehicleBookingsDb || [];
  const money = value => `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  body.innerHTML = records.length ? records.map((record, index) => `<tr><td>${index + 1}</td><td><strong>${escapeSalesHtml(record.coNumber)}</strong></td><td>${escapeSalesHtml(record.invoiceNumber)}</td><td>${escapeSalesHtml(record.transporterName || "-")}</td><td><strong>${escapeSalesHtml(record.vehicleType)}</strong></td><td>${money(record.originalFreight)}</td><td>${money(record.unloadingCharges)}</td><td>${money(record.grossAmount ?? record.originalFreight)}</td><td>${money(record.deductionAmount)}</td><td style="font-weight:900; color:#059669;">${money(record.finalPayable ?? record.originalFreight)}</td><td>${escapeSalesHtml(record.bookedBy || "-")}</td></tr>`).join("") : `<tr><td colspan="11" style="text-align:center; padding:22px; color:var(--muted);">No vehicle booking saved.</td></tr>`;
};

function productionText(value) {
  return String(value || "").trim();
}

function productionPoKey(value) {
  return productionText(value).toUpperCase();
}

function productionNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function productionToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function productionDisplayDate(value) {
  const match = productionText(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : (productionText(value) || "-");
}

function productionPreviousDate(value) {
  const match = productionText(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function productionEsc(value) {
  return escapeSalesHtml(value === "" || value === null || value === undefined ? "-" : value);
}

function productionPalletPo(pallet) {
  return productionText(pallet?.po || pallet?.fullRows?.[0]?.po);
}

function productionPalletQty(pallet) {
  return productionNumber(pallet?.count || (pallet?.serials || pallet?.fullRows || []).length);
}

function productionGradeKey(value) {
  const grade = productionText(value).toUpperCase();
  return grade.startsWith("B") ? "B" : grade.startsWith("R") ? "R" : "A";
}

function getProductionSheetRecord(poNumber) {
  const key = productionPoKey(poNumber);
  return (productionSheetDb || []).find(record => productionPoKey(record.poNumber) === key) || null;
}

function getProductionSalesOrder(poNumber) {
  const key = productionPoKey(poNumber);
  return (salesOrders || []).find(order => productionPoKey(order.prodOrderNo) === key) || null;
}

function productionSerialSortValue(serial) {
  const match = productionText(serial).match(/(\d+)(?!.*\d)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function getProductionPpcSerialRange(poNumber) {
  const serials = getPpcSerialsForPo(poNumber);
  const poQty = productionNumber(getPoRecord(poNumber)?.qty);
  if (!serials.length) return { start: "", end: "", uploadedCount: 0, duplicateCount: 0, missingSequenceCount: 0, hasSequenceGaps: false, warning: false, valid: false, message: "PPC serial numbers have not been uploaded yet." };

  const normalized = serials.map(serial => productionText(serial)).filter(Boolean);
  const seen = new Set();
  const uniqueSerials = [];
  normalized.forEach(serial => {
    const key = serial.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    uniqueSerials.push(serial);
  });
  const duplicateCount = normalized.length - uniqueSerials.length;
  const uniqueCount = uniqueSerials.length;
  const ordered = [...uniqueSerials].sort((left, right) => {
    const difference = productionSerialSortValue(left) - productionSerialSortValue(right);
    return difference || left.localeCompare(right, undefined, { numeric: true });
  });
  const start = ordered[0];
  const end = ordered[ordered.length - 1];

  // Serial continuity is checked independently inside each prefix/number-width
  // group. The first-to-last numeric span is never treated as uploaded PO Qty.
  const sequenceGroups = new Map();
  let unsequencedCount = 0;
  uniqueSerials.forEach(serial => {
    const match = serial.match(/^(.*?)(\d+)$/);
    if (!match) { unsequencedCount += 1; return; }
    const prefix = match[1];
    const width = match[2].length;
    const key = `${prefix.toUpperCase()}\u0000${width}`;
    if (!sequenceGroups.has(key)) sequenceGroups.set(key, { prefix, width, numbers: new Set() });
    sequenceGroups.get(key).numbers.add(Number(match[2]));
  });
  let missingSequenceCount = 0;
  const missingExamples = [];
  sequenceGroups.forEach(group => {
    const numbers = [...group.numbers].sort((left, right) => left - right);
    for (let index = 1; index < numbers.length; index += 1) {
      const previous = numbers[index - 1];
      const current = numbers[index];
      if (current <= previous + 1) continue;
      missingSequenceCount += current - previous - 1;
      for (let value = previous + 1; value < current && missingExamples.length < 8; value += 1) {
        missingExamples.push(`${group.prefix}${String(value).padStart(group.width, "0")}`);
      }
    }
  });

  const hasSequenceGaps = missingSequenceCount > 0;
  const valid = poQty > 0 && uniqueCount === poQty && duplicateCount === 0;
  const gapMessage = hasSequenceGaps
    ? ` Numeric sequence check found ${missingSequenceCount.toLocaleString("en-IN")} unused number(s) between uploaded serials${missingExamples.length ? ` (for example: ${missingExamples.join(", ")})` : ""}.`
    : "";
  let message = "";
  if (poQty <= 0) message = "PO quantity is unavailable or zero.";
  else if (duplicateCount > 0) message = `${normalized.length.toLocaleString("en-IN")} serial row(s) were uploaded, but only ${uniqueCount.toLocaleString("en-IN")} are unique. Remove ${duplicateCount.toLocaleString("en-IN")} duplicate serial(s).${gapMessage}`;
  else if (uniqueCount < poQty) message = `PPC uploaded ${uniqueCount.toLocaleString("en-IN")} unique serial(s), which is ${(poQty - uniqueCount).toLocaleString("en-IN")} short of PO Qty ${poQty.toLocaleString("en-IN")}.${gapMessage}`;
  else if (uniqueCount > poQty) message = `PPC uploaded ${uniqueCount.toLocaleString("en-IN")} unique serial(s), which is ${(uniqueCount - poQty).toLocaleString("en-IN")} more than PO Qty ${poQty.toLocaleString("en-IN")}.${gapMessage}`;
  else if (hasSequenceGaps) message = `Verified quantity: ${uniqueCount.toLocaleString("en-IN")} unique uploaded serial(s) match PO Qty ${poQty.toLocaleString("en-IN")}.${gapMessage} The first-to-last span is not used as PO quantity.`;
  else if (unsequencedCount > 0) message = `Verified quantity: ${uniqueCount.toLocaleString("en-IN")} unique uploaded serial(s) match PO Qty ${poQty.toLocaleString("en-IN")}. ${unsequencedCount.toLocaleString("en-IN")} serial(s) do not end in a number, so numeric gap checking does not apply to them.`;
  else message = `Verified: ${uniqueCount.toLocaleString("en-IN")} unique uploaded serial(s) match PO Qty ${poQty.toLocaleString("en-IN")}, with no missing numbers inside each serial sequence.`;
  return { start, end, uploadedCount: uniqueCount, duplicateCount, missingSequenceCount, missingExamples, hasSequenceGaps, unsequencedCount, warning: valid && (hasSequenceGaps || unsequencedCount > 0), valid, message };
}

function getProductionDailyRows(poNumber) {
  const key = productionPoKey(poNumber);
  return (productionDailyDb || [])
    .filter(record => productionPoKey(record.poNumber) === key)
    .sort((left, right) => productionText(left.date).localeCompare(productionText(right.date)) || productionNumber(left.updatedAt) - productionNumber(right.updatedAt));
}

function getProductionDailyTotals(poNumber) {
  const rows = getProductionDailyRows(poNumber);
  return rows.reduce((totals, row) => ({
    qty: totals.qty + productionNumber(row.productionQty),
    a: totals.a + productionNumber(row.gradeA),
    b: totals.b + productionNumber(row.gradeB),
    r: totals.r + productionNumber(row.gradeR),
    latest: row
  }), { qty: 0, a: 0, b: 0, r: 0, latest: null });
}

function getProductionLiveMetrics(poNumber) {
  const key = productionPoKey(poNumber);
  const warehousePallets = (godownStock || []).filter(pallet => productionPoKey(productionPalletPo(pallet)) === key);
  const dispatchedManifests = (dispatchArchive || []).filter(manifest => productionPoKey(manifest.po) === key || (manifest.pallets || []).some(pallet => productionPoKey(productionPalletPo(pallet)) === key));
  const warehouse = { total: 0, a: 0, b: 0, r: 0 };
  const dispatched = { total: 0, a: 0, b: 0, r: 0 };
  warehousePallets.forEach(pallet => {
    const qty = productionPalletQty(pallet); const grade = productionGradeKey(pallet.grade);
    warehouse.total += qty; warehouse[grade.toLowerCase()] += qty;
  });
  dispatchedManifests.forEach(manifest => {
    const pallets = (manifest.pallets || []).filter(pallet => productionPoKey(productionPalletPo(pallet)) === key);
    if (pallets.length) {
      pallets.forEach(pallet => {
        const qty = productionPalletQty(pallet); const grade = productionGradeKey(pallet.grade);
        dispatched.total += qty; dispatched[grade.toLowerCase()] += qty;
      });
    } else if (productionPoKey(manifest.po) === key) {
      dispatched.total += productionNumber(manifest.dispatchedQty);
      dispatched.a += productionNumber(manifest.dispatchedQty);
    }
  });
  return { warehouse, dispatched, totalFg: warehouse.total + dispatched.total };
}

function getProductionRow(poNumber) {
  const po = getPoRecord(poNumber);
  const saved = getProductionSheetRecord(poNumber);
  const sales = getProductionSalesOrder(poNumber);
  const serials = getProductionPpcSerialRange(poNumber);
  const daily = getProductionDailyTotals(poNumber);
  const live = getProductionLiveMetrics(poNumber);
  const latestStatus = productionText(daily.latest?.productionStatus || saved?.productionStatus || "PRODUCTION NOT STARTED");
  // A PO stays IN LINE until Packing accepts its first registered PPC serial.
  // Once opened by scan, the saved OPEN state takes precedence over RUNNING.
  const packingStatus = productionText(saved?.packingStatus || "IN LINE");
  const poQty = productionNumber(po?.qty);
  return {
    saved, po, sales, serials, daily, live,
    poNumber: productionText(poNumber),
    model: getPoPackingModel(po) || productionText(po?.product),
    watt: productionText(po?.watt),
    poQty,
    productionStatus: latestStatus,
    packingStatus,
    bom: productionText(saved?.bom || sales?.bom),
    dispatchMode: productionText(saved?.dispatchMode || sales?.dispatchMode),
    customerQty: productionNumber(saved?.customerOrderQty || sales?.totalOrderQty),
    pendingQty: Math.max(0, poQty - daily.qty)
  };
}

function nextProductionSerial() {
  const used = (productionSheetDb || []).map(record => productionNumber(record.serialNo)).filter(value => value > 0);
  return String(used.length ? Math.max(...used) + 1 : 1);
}

async function createProductionSheetForPpcPo(poNumber) {
  if (!poNumber || getProductionSheetRecord(poNumber)) return;
  productionSheetDb.push({
    id: Date.now(),
    serialNo: nextProductionSerial(),
    poNumber: productionText(poNumber),
    productionStatus: "PRODUCTION NOT STARTED",
    packingStatus: "IN LINE",
    bom: "",
    dispatchMode: "",
    customerOrderQty: 0,
    startDate: "",
    endDate: "",
    prefix: "",
    serialHold: "",
    tentativeDispatchDate: "",
    customerTargetDispatchDate: "",
    createdAt: new Date().toISOString(),
    createdBy: currentLoggedInUser?.username || "PPC",
    updatedAt: new Date().toISOString(),
    updatedBy: currentLoggedInUser?.username || "PPC"
  });
  await saveStorage(KEY_PRODUCTION_SHEET, productionSheetDb);
}

function setProductionInput(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value ?? "";
}

function renderProductionSerialRangeNotice(range, hasPo = true) {
  const notice = document.getElementById("productionSerialRangeNotice");
  if (!notice) return;
  if (!hasPo) { notice.style.display = "none"; return; }
  notice.style.display = "block";
  const isPending = !range?.uploadedCount;
  const isWarning = range?.warning === true;
  notice.style.background = range?.valid && !isWarning ? "#ecfdf5" : (isPending || isWarning ? "#fffbeb" : "#fef2f2");
  notice.style.border = `1px solid ${range?.valid && !isWarning ? "#86efac" : (isPending || isWarning ? "#fde68a" : "#fca5a5")}`;
  notice.style.color = range?.valid && !isWarning ? "#047857" : (isPending || isWarning ? "#92400e" : "#b91c1c");
  notice.textContent = `${range?.valid ? (isWarning ? "⚠" : "✓") : "!"} Serial Upload Check: ${range?.message || "No PPC serial data."}`;
}

window.updateProductionStartDateRequirement = function() {
  const isRunning = productionText(document.getElementById("productionStatus")?.value).toUpperCase() === "RUNNING";
  const label = document.getElementById("productionStartDateLabel");
  const input = document.getElementById("productionStartDate");
  if (label) label.innerHTML = `START DATE${isRunning ? ' <span style="color:#dc2626;">*</span>' : ""}`;
  if (input) input.required = isRunning;
};

window.populateProductionDetailPoSelect = function(selected = "") {
  const select = document.getElementById("productionPoSelect");
  if (!select) return;
  const current = selected || select.value;
  select.innerHTML = `<option value="">${poDatabase.length ? "-- Select PPC Production Order --" : "-- No PPC Production Orders Available --"}</option>` +
    (poDatabase || []).map(po => `<option value="${productionEsc(po.poNumber)}">${productionEsc(po.poNumber)} — ${productionEsc(getPoPackingModel(po) || po.product)} (${productionNumber(po.qty).toLocaleString("en-IN")})</option>`).join("");
  if ((poDatabase || []).some(po => productionPoKey(po.poNumber) === productionPoKey(current))) select.value = current;
};

window.populateProductionDetailAutoFields = function() {
  const poNumber = document.getElementById("productionPoSelect")?.value || "";
  const row = getProductionRow(poNumber);
  const saved = row.saved;
  setProductionInput("productionModel", row.model);
  setProductionInput("productionWatt", row.watt);
  setProductionInput("productionPoQty", row.poQty || "");
  setProductionInput("productionSerialStart", row.serials.start);
  setProductionInput("productionSerialEnd", row.serials.end);
  setProductionInput("productionCustomerQty", row.customerQty || "");
  renderProductionSerialRangeNotice(row.serials, Boolean(poNumber));
  if (!saved) {
    setProductionInput("productionStatus", "PRODUCTION NOT STARTED");
    setProductionInput("productionPackingStatus", "IN LINE");
    setProductionInput("productionBom", row.bom);
    setProductionInput("productionDispatchMode", row.dispatchMode);
    ["productionStartDate", "productionEndDate", "productionPrefix", "productionSerialHold", "productionTentativeDispatch", "productionCustomerTargetDispatch"].forEach(id => setProductionInput(id, ""));
    window.updateProductionStartDateRequirement();
    return;
  }
  setProductionInput("productionSrNo", saved.serialNo);
  setProductionInput("productionStatus", row.productionStatus);
  setProductionInput("productionPackingStatus", row.packingStatus);
  setProductionInput("productionBom", row.bom);
  setProductionInput("productionDispatchMode", row.dispatchMode);
  setProductionInput("productionStartDate", saved.startDate);
  setProductionInput("productionEndDate", saved.endDate);
  setProductionInput("productionPrefix", saved.prefix);
  setProductionInput("productionSerialHold", saved.serialHold);
  setProductionInput("productionTentativeDispatch", saved.tentativeDispatchDate || row.sales?.tentativeDispatch || "");
  setProductionInput("productionCustomerTargetDispatch", saved.customerTargetDispatchDate);
  window.updateProductionStartDateRequirement();
};

window.resetProductionDetailForm = function() {
  productionFormMode = "add";
  window.updateProductionDetailFormMode();
  setProductionInput("productionSrNo", nextProductionSerial());
  window.populateProductionDetailPoSelect("");
  window.populateProductionDetailAutoFields();
};

window.updateProductionDetailFormMode = function() {
  const editing = productionFormMode === "edit";
  const title = document.getElementById("productionDetailFormTitle");
  const hint = document.getElementById("productionDetailFormHint");
  const button = document.getElementById("productionDetailSaveButton");
  if (title) title.textContent = editing ? "✏️ EDIT PRODUCTION SHEET" : "🏭 ADD PRODUCTION DETAILS TO SHEET";
  if (hint) hint.textContent = editing
    ? "Edits are sent to Administrator for approval. PPC, Sales, Packing and Dispatch figures remain linked live."
    : "Select the PPC Production Order. PPC, Sales, Packing and Dispatch figures remain linked live.";
  if (button) button.textContent = editing ? "📩 Send Sheet Changes for Approval" : "💾 Save Production Sheet Details";
};

window.populateProductionEditSheetSelect = function() {
  const select = document.getElementById("productionEditSheetSelect");
  if (!select) return;
  const current = select.value;
  const records = productionSheetDb || [];
  select.innerHTML = `<option value="">${records.length ? "-- Select Production Order to Edit --" : "-- No Production Sheets Available --"}</option>` +
    records.map(record => {
      const row = getProductionRow(record.poNumber);
      return `<option value="${productionEsc(record.poNumber)}">${productionEsc(record.poNumber)} — ${productionEsc(row.model)} (${productionEsc(row.productionStatus)})</option>`;
    }).join("");
  if (records.some(record => productionPoKey(record.poNumber) === productionPoKey(current))) select.value = current;
  window.previewProductionSheetForEdit();
};

window.previewProductionSheetForEdit = function() {
  const poNumber = document.getElementById("productionEditSheetSelect")?.value || "";
  const preview = document.getElementById("productionEditSheetPreview");
  const row = getProductionRow(poNumber);
  if (!preview || !poNumber || !row.saved) {
    if (preview) preview.textContent = "Select a Production Order to review its current details.";
    return;
  }
  preview.innerHTML = `<div class="grid-2" style="gap:10px;"><div><strong>PO:</strong> ${productionEsc(row.poNumber)}<br><strong>Model / W/P:</strong> ${productionEsc(row.model)} / ${productionEsc(row.watt)}<br><strong>Status:</strong> ${productionEsc(row.productionStatus)} · <strong>Packing:</strong> ${productionEsc(row.packingStatus)}</div><div><strong>PO Qty.:</strong> ${row.poQty.toLocaleString("en-IN")}<br><strong>Production Till Date:</strong> ${row.daily.qty.toLocaleString("en-IN")} · <strong>Pending:</strong> ${row.pendingQty.toLocaleString("en-IN")}<br><strong>Start Date:</strong> ${productionDisplayDate(row.saved.startDate)} · <strong>End Date:</strong> ${productionDisplayDate(row.saved.endDate)}</div></div>`;
};

window.loadProductionSheetForEditing = async function() {
  const poNumber = productionText(document.getElementById("productionEditSheetSelect")?.value);
  if (!poNumber || !getProductionSheetRecord(poNumber)) {
    window.showNotification({ title: "Select Production Order", message: "Select a Production Order before opening Edit Sheet.", type: "warning" });
    return;
  }
  await window.switchView("productionAddDetails", null, "Production > Edit Sheet");
  productionFormMode = "edit";
  window.updateProductionDetailFormMode();
  window.populateProductionDetailPoSelect(poNumber);
  document.getElementById("productionPoSelect").value = poNumber;
  window.populateProductionDetailAutoFields();
};

window.populateProductionDeleteSheetSelect = function() {
  const select = document.getElementById("productionDeleteSheetSelect");
  if (!select) return;
  const current = select.value;
  const records = productionSheetDb || [];
  select.innerHTML = `<option value="">${records.length ? "-- Select Production Order to Delete --" : "-- No Production Sheets Available --"}</option>` +
    records.map(record => `<option value="${productionEsc(record.poNumber)}">${productionEsc(record.poNumber)} — ${productionEsc(getProductionRow(record.poNumber).model)}</option>`).join("");
  if (records.some(record => productionPoKey(record.poNumber) === productionPoKey(current))) select.value = current;
  window.previewProductionSheetForDelete();
};

window.previewProductionSheetForDelete = function() {
  const poNumber = document.getElementById("productionDeleteSheetSelect")?.value || "";
  const preview = document.getElementById("productionDeleteSheetPreview");
  const row = getProductionRow(poNumber);
  if (!preview || !poNumber || !row.saved) {
    if (preview) preview.textContent = "Select a Production Order to review it before requesting deletion.";
    return;
  }
  const dailyCount = getProductionDailyRows(poNumber).length;
  preview.innerHTML = `<strong>PO:</strong> ${productionEsc(row.poNumber)}<br><strong>Model / W/P:</strong> ${productionEsc(row.model)} / ${productionEsc(row.watt)}<br><strong>Production Status:</strong> ${productionEsc(row.productionStatus)}<br><strong>Daily Updates:</strong> ${dailyCount}${dailyCount ? `<div style="margin-top:8px; color:#b91c1c; font-weight:700;">Deletion cannot be approved while daily Production history exists.</div>` : `<div style="margin-top:8px; color:#92400e;">The request will be sent to Administrator for approval.</div>`}`;
};

window.requestProductionSheetDeletion = async function() {
  const poNumber = productionText(document.getElementById("productionDeleteSheetSelect")?.value);
  const record = getProductionSheetRecord(poNumber);
  if (!poNumber || !record) {
    window.showNotification({ title: "Select Production Order", message: "Select a Production Order before requesting deletion.", type: "warning" });
    return;
  }
  if (getProductionDailyRows(poNumber).length) {
    window.showNotification({ title: "Deletion Blocked", message: "This PO has daily Production history. Its Production Sheet must remain for traceability.", type: "danger" });
    return;
  }
  const pending = (requestsDb || []).some(request => request.status === "PENDING" && ["EDIT_PRODUCTION_SHEET", "DELETE_PRODUCTION_SHEET"].includes(request.type) && productionPoKey(request.payload?.poNumber) === productionPoKey(poNumber));
  if (pending) {
    window.showNotification({ title: "Request Already Pending", message: `PO ${poNumber} already has an edit or deletion request waiting for Administrator approval.`, type: "warning" });
    return;
  }
  const reason = await window.showPromptDialog({ title: "Request Production Sheet Deletion", message: `Request deletion of Production Sheet PO ${poNumber}? PPC, Sales, Packing and Dispatch source records will not be deleted.`, label: "Reason for Deletion *", placeholder: "Example: duplicate sheet, incorrect PO mapping...", confirmText: "Send for Admin Approval", isDanger: true });
  if (!reason) return;
  requestsDb.unshift({ id: "REQ-" + Date.now(), type: "DELETE_PRODUCTION_SHEET", targetId: `PO ${poNumber}`, details: `${getProductionRow(poNumber).model} | PO Qty: ${getProductionRow(poNumber).poQty.toLocaleString("en-IN")} | No daily Production history`, payload: { productionSheetId: record.id, poNumber }, requestedBy: currentLoggedInUser?.username || "OPERATOR", requestedAt: new Date().toLocaleString(), reason, status: "PENDING", reviewedBy: "-", reviewedAt: "-", adminRemark: "-" });
  await saveStorage(KEY_REQUESTS, requestsDb);
  await logEvent("PRODUCTION", "PRODUCTION_SHEET_DELETE_REQUESTED", `Requested deletion for Production Sheet PO ${poNumber}.`);
  window.showNotification({ title: "Deletion Request Submitted", message: `PO ${poNumber} will be deleted only after Administrator approval.`, type: "warning" });
  window.populateProductionDeleteSheetSelect();
};

window.saveProductionDetails = async function() {
  const poNumber = productionText(document.getElementById("productionPoSelect")?.value);
  const serialNo = productionText(document.getElementById("productionSrNo")?.value);
  const status = productionText(document.getElementById("productionStatus")?.value);
  const po = getPoRecord(poNumber);
  if (!poNumber || !po || !serialNo || !status) {
    window.showNotification({ title: "Missing Required Details", message: "SR. No., PPC Production Order and Production Status are required.", type: "warning" });
    return;
  }
  const model = productionText(document.getElementById("productionModel")?.value);
  const watt = productionText(document.getElementById("productionWatt")?.value);
  const poQty = productionNumber(document.getElementById("productionPoQty")?.value);
  if (!model || !watt || poQty <= 0) {
    window.showNotification({ title: "Required Linked Details Missing", message: "Model No., W/P and Production Order Qty. must be available before saving this Production Sheet record.", type: "danger" });
    return;
  }
  if (status === "RUNNING" && !productionText(document.getElementById("productionStartDate")?.value)) {
    window.showNotification({ title: "Start Date Required", message: "Enter Start Date before changing Production Status to Running.", type: "warning" });
    return;
  }
  const serialRange = getProductionPpcSerialRange(poNumber);
  if (serialRange.uploadedCount > 0 && !serialRange.valid) {
    window.showNotification({ title: "PPC Serial Range Mismatch", message: serialRange.message, type: "danger" });
    return;
  }
  const duplicateSerial = (productionSheetDb || []).find(record => productionText(record.serialNo) === serialNo && productionPoKey(record.poNumber) !== productionPoKey(poNumber));
  if (duplicateSerial) {
    window.showNotification({ title: "SR. No. Already Used", message: `SR. No. ${serialNo} is already assigned to PO ${duplicateSerial.poNumber}.`, type: "danger" });
    return;
  }
  const existingIndex = (productionSheetDb || []).findIndex(record => productionPoKey(record.poNumber) === productionPoKey(poNumber));
  const existing = existingIndex >= 0 ? productionSheetDb[existingIndex] : null;
  const record = {
    id: existing?.id || Date.now(), serialNo, poNumber,
    productionStatus: status,
    packingStatus: productionText(document.getElementById("productionPackingStatus")?.value || "OPEN"),
    bom: productionText(document.getElementById("productionBom")?.value),
    dispatchMode: productionText(document.getElementById("productionDispatchMode")?.value),
    // Customer order quantity is optional. A blank value is saved as zero.
    customerOrderQty: productionNumber(document.getElementById("productionCustomerQty")?.value),
    startDate: productionText(document.getElementById("productionStartDate")?.value),
    endDate: productionText(document.getElementById("productionEndDate")?.value),
    prefix: productionText(document.getElementById("productionPrefix")?.value),
    serialHold: productionText(document.getElementById("productionSerialHold")?.value),
    tentativeDispatchDate: productionText(document.getElementById("productionTentativeDispatch")?.value),
    customerTargetDispatchDate: productionText(document.getElementById("productionCustomerTargetDispatch")?.value),
    createdAt: existing?.createdAt || new Date().toISOString(), createdBy: existing?.createdBy || currentLoggedInUser?.username || "OPERATOR",
    detailsEnteredAt: existing?.detailsEnteredAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(), updatedBy: currentLoggedInUser?.username || "OPERATOR"
  };
  const needsApproval = Boolean(existing?.detailsEnteredAt);
  if (needsApproval) {
    const pending = (requestsDb || []).some(request => request.status === "PENDING" && ["EDIT_PRODUCTION_SHEET", "DELETE_PRODUCTION_SHEET"].includes(request.type) && productionPoKey(request.payload?.poNumber) === productionPoKey(poNumber));
    if (pending) {
      window.showNotification({ title: "Request Already Pending", message: `PO ${poNumber} already has an edit or deletion request waiting for Administrator approval.`, type: "warning" });
      return;
    }
    const reason = await window.showPromptDialog({ title: "Request Production Sheet Edit", message: `Send changes for PO ${poNumber} to Administrator for approval?`, label: "Reason for Edit *", placeholder: "Describe the required correction...", confirmText: "Send for Approval" });
    if (!reason) return;
    requestsDb.unshift({ id: "REQ-" + Date.now(), type: "EDIT_PRODUCTION_SHEET", targetId: `PO ${poNumber}`, details: `Status: ${existing.productionStatus} → ${record.productionStatus} | Start: ${productionDisplayDate(existing.startDate)} → ${productionDisplayDate(record.startDate)} | BOM: ${existing.bom || "-"} → ${record.bom || "-"}`, payload: { productionSheetId: existing.id, poNumber, proposedRecord: record }, requestedBy: currentLoggedInUser?.username || "OPERATOR", requestedAt: new Date().toLocaleString(), reason, status: "PENDING", reviewedBy: "-", reviewedAt: "-", adminRemark: "-" });
    await saveStorage(KEY_REQUESTS, requestsDb);
    await logEvent("PRODUCTION", "PRODUCTION_SHEET_EDIT_REQUESTED", `Requested an edit for Production Sheet PO ${poNumber}.`);
    window.showNotification({ title: "Edit Request Submitted", message: `PO ${poNumber} will change only after Administrator approval.`, type: "warning" });
    return;
  }
  if (existingIndex >= 0) productionSheetDb.splice(existingIndex, 1, record); else productionSheetDb.push(record);
  await saveStorage(KEY_PRODUCTION_SHEET, productionSheetDb);
  await logEvent("PRODUCTION", existing ? "PRODUCTION_SHEET_UPDATED" : "PRODUCTION_SHEET_CREATED", `PO ${poNumber}; status ${status}.`);
  window.showNotification({ title: "Production Sheet Saved", message: `PO ${poNumber} is now linked to the Production Sheet.`, type: "success" });
  window.renderProductionSheet();
};

window.markProductionPackingOpen = async function(poNumber) {
  const index = (productionSheetDb || []).findIndex(record => productionPoKey(record.poNumber) === productionPoKey(poNumber));
  if (index < 0 || productionText(productionSheetDb[index].packingStatus).toUpperCase() === "OPEN") return;
  productionSheetDb[index] = {
    ...productionSheetDb[index],
    packingStatus: "OPEN",
    packingOpenedAt: new Date().toISOString(),
    packingOpenedBy: currentLoggedInUser?.username || "PACKING OPERATOR",
    updatedAt: new Date().toISOString(),
    updatedBy: currentLoggedInUser?.username || "PACKING OPERATOR"
  };
  await saveStorage(KEY_PRODUCTION_SHEET, productionSheetDb);
  window.renderProductionSheet?.();
};

window.populateProductionDailyPoSelect = function(selected = "") {
  const select = document.getElementById("productionDailyPoSelect");
  if (!select) return;
  const current = selected || select.value;
  const records = productionSheetDb || [];
  select.innerHTML = `<option value="">${records.length ? "-- Select Production Order --" : "-- Add Production Sheet Details First --"}</option>` +
    records.map(record => `<option value="${productionEsc(record.poNumber)}">${productionEsc(record.poNumber)} — ${productionEsc(getProductionRow(record.poNumber).model)}</option>`).join("");
  if (records.some(record => productionPoKey(record.poNumber) === productionPoKey(current))) select.value = current;
  window.populateProductionDailyContext();
};

window.toggleProductionDailyGradeInputs = function() {
  const closed = document.getElementById("productionDailyStatus")?.value === "CLOSED";
  const fields = document.getElementById("productionDailyGradeFields");
  if (fields) fields.style.display = closed ? "grid" : "none";
  if (!closed) ["productionDailyGradeA", "productionDailyGradeB", "productionDailyGradeR"].forEach(id => setProductionInput(id, ""));
};

window.populateProductionDailyContext = function() {
  const poNumber = document.getElementById("productionDailyPoSelect")?.value || "";
  const context = document.getElementById("productionDailyContext");
  const detailArea = document.getElementById("productionDailyDetailArea");
  const yesterdayBox = document.getElementById("productionYesterdayUpdate");
  const row = getProductionRow(poNumber);
  if (!context || !poNumber || !row.saved) {
    if (context) context.textContent = "Select a Production Order to load the live context.";
    if (detailArea) detailArea.style.display = "none";
    return;
  }
  if (detailArea) detailArea.style.display = "block";
  const updateDate = document.getElementById("productionDailyDate")?.value || productionToday();
  const todayRow = getProductionDailyRows(poNumber).find(record => record.date === updateDate);
  const previousTotals = getProductionDailyRows(poNumber).filter(record => productionText(record.date) < productionText(updateDate)).reduce((totals, record) => ({
    qty: totals.qty + productionNumber(record.productionQty),
    a: totals.a + productionNumber(record.gradeA),
    b: totals.b + productionNumber(record.gradeB),
    r: totals.r + productionNumber(record.gradeR)
  }), { qty: 0, a: 0, b: 0, r: 0 });
  // A daily update is an increment, never a cumulative value. Keep all entry
  // controls empty so an operator cannot accidentally save the existing total.
  setProductionInput("productionDailyQty", "");
  setProductionInput("productionDailyStatus", "");
  window.toggleProductionDailyGradeInputs();
  setProductionInput("productionDailyDelayDays", "");
  setProductionInput("productionDailyGradeA", "");
  setProductionInput("productionDailyGradeB", "");
  setProductionInput("productionDailyGradeR", "");
  setProductionInput("productionDailyCellReject", "");
  setProductionInput("productionDailyModuleReject", "");
  setProductionInput("productionDailyDelayReason", "");
  const saveButton = document.getElementById("productionDailySaveBtn");
  if (saveButton) {
    saveButton.disabled = Boolean(todayRow);
    saveButton.title = todayRow ? "A saved daily update can be corrected only through Administrator approval." : "";
  }
  context.innerHTML = `<strong>PO ${productionEsc(row.poNumber)}</strong> · ${productionEsc(row.model)} · <strong>${productionEsc(row.watt)}</strong><br><span style="color:#475569;">PO Qty: ${row.poQty.toLocaleString("en-IN")} | <strong>Production before this update: ${previousTotals.qty.toLocaleString("en-IN")}</strong> | Pending before this update: ${Math.max(0, row.poQty - previousTotals.qty).toLocaleString("en-IN")} | Total FG: ${row.live.totalFg.toLocaleString("en-IN")} | Dispatched: ${row.live.dispatched.total.toLocaleString("en-IN")}</span>${todayRow ? `<div style="margin-top:8px; color:#b45309; font-weight:700;">An update for ${productionDisplayDate(updateDate)} is already saved (${productionNumber(todayRow.productionQty).toLocaleString("en-IN")} modules). It is protected from direct overwrite and requires Administrator approval for correction.</div>` : ""}`;
  const previousDate = productionPreviousDate(updateDate);
  const previousUpdate = getProductionDailyRows(poNumber).find(record => record.date === previousDate);
  if (yesterdayBox) {
    yesterdayBox.innerHTML = previousUpdate
      ? `<strong style="color:#5b21b6;">Previous Day Update — ${productionDisplayDate(previousDate)}</strong><br><span style="line-height:1.8;">Production: <strong>${productionNumber(previousUpdate.productionQty).toLocaleString("en-IN")}</strong> | Status: <strong>${productionEsc(previousUpdate.productionStatus)}</strong> | A/B/R: <strong>${productionNumber(previousUpdate.gradeA)}</strong> / <strong>${productionNumber(previousUpdate.gradeB)}</strong> / <strong>${productionNumber(previousUpdate.gradeR)}</strong> | Cell Rej.: <strong>${productionNumber(previousUpdate.cellRejectionPct).toFixed(2)}%</strong> | Module Rej.: <strong>${productionNumber(previousUpdate.moduleRejectionPct).toFixed(2)}%</strong> | Delay: <strong>${productionNumber(previousUpdate.delayDays)} day(s)</strong>${previousUpdate.delayReason ? ` · ${productionEsc(previousUpdate.delayReason)}` : ""}</span>`
      : `<strong style="color:#6b7280;">Previous Day Update — ${productionDisplayDate(previousDate)}</strong><br>No update was saved for this PO on the previous day.`;
  }
};

window.resetProductionDailyForm = function() {
  setProductionInput("productionDailyDate", productionToday());
  window.populateProductionDailyPoSelect("");
};

window.saveProductionDailyUpdate = async function() {
  const poNumber = productionText(document.getElementById("productionDailyPoSelect")?.value);
  const date = productionText(document.getElementById("productionDailyDate")?.value);
  const productionQty = productionNumber(document.getElementById("productionDailyQty")?.value);
  const productionStatus = productionText(document.getElementById("productionDailyStatus")?.value);
  const gradeA = productionNumber(document.getElementById("productionDailyGradeA")?.value);
  const gradeB = productionNumber(document.getElementById("productionDailyGradeB")?.value);
  const gradeR = productionNumber(document.getElementById("productionDailyGradeR")?.value);
  const cellRejectionPct = productionNumber(document.getElementById("productionDailyCellReject")?.value);
  const moduleRejectionPct = productionNumber(document.getElementById("productionDailyModuleReject")?.value);
  const delayDays = productionNumber(document.getElementById("productionDailyDelayDays")?.value);
  const delayReason = productionText(document.getElementById("productionDailyDelayReason")?.value);
  if (!poNumber || !date || !productionStatus || document.getElementById("productionDailyQty")?.value === "") {
    window.showNotification({ title: "Daily Update Incomplete", message: "Date, Production Order, Today's Production Qty. and Status are required.", type: "warning" });
    return;
  }
  const productionSheet = getProductionSheetRecord(poNumber);
  if (productionStatus === "RUNNING" && !productionText(productionSheet?.startDate)) {
    window.showNotification({ title: "Start Date Required", message: "Enter the Start Date in Add Details to Sheet before saving a Running daily update.", type: "warning" });
    return;
  }
  const serialRange = getProductionPpcSerialRange(poNumber);
  if (!serialRange.valid) {
    window.showNotification({ title: "PPC Serial Range Must Match PO", message: serialRange.message, type: "danger" });
    return;
  }
  if ([productionQty, gradeA, gradeB, gradeR, cellRejectionPct, moduleRejectionPct, delayDays].some(value => value < 0) || cellRejectionPct > 100 || moduleRejectionPct > 100) {
    window.showNotification({ title: "Invalid Daily Values", message: "Quantities cannot be negative and rejection percentage must be between 0 and 100.", type: "danger" });
    return;
  }
  if (gradeA + gradeB + gradeR > productionQty) {
    window.showNotification({ title: "Grade Quantity Mismatch", message: "A + B + R grade quantity cannot be greater than Today's Production Qty.", type: "danger" });
    return;
  }
  if (delayDays > 0 && !delayReason) {
    window.showNotification({ title: "Delay Reason Required", message: "Enter the reason when Delay Days is greater than zero.", type: "warning" });
    return;
  }
  const index = (productionDailyDb || []).findIndex(record => productionPoKey(record.poNumber) === productionPoKey(poNumber) && record.date === date);
  const existing = index >= 0 ? productionDailyDb[index] : null;
  if (existing) {
    window.showNotification({ title: "Daily Update Already Saved", message: `PO ${poNumber} already has a saved update for ${productionDisplayDate(date)}. It cannot be overwritten directly; submit an Administrator-approved correction instead.`, type: "warning" });
    return;
  }
  const alreadyRecordedQty = getProductionDailyRows(poNumber)
    .reduce((total, row) => total + productionNumber(row.productionQty), 0);
  const poQty = getProductionRow(poNumber).poQty;
  if (alreadyRecordedQty + productionQty > poQty) {
    window.showNotification({ title: "Production Quantity Exceeds PO", message: `Previously recorded production is ${alreadyRecordedQty.toLocaleString("en-IN")} and this update adds ${productionQty.toLocaleString("en-IN")}. The total cannot exceed PO Qty ${poQty.toLocaleString("en-IN")}.`, type: "danger" });
    return;
  }
  const record = { id: Date.now(), poNumber, date, productionQty, productionStatus, gradeA, gradeB, gradeR, cellRejectionPct, moduleRejectionPct, delayDays, delayReason, createdAt: new Date().toISOString(), createdBy: currentLoggedInUser?.username || "OPERATOR", updatedAt: new Date().toISOString(), updatedBy: currentLoggedInUser?.username || "OPERATOR" };
  productionDailyDb.push(record);
  await saveStorage(KEY_PRODUCTION_DAILY, productionDailyDb);
  await logEvent("PRODUCTION", "PRODUCTION_DAILY_CREATED", `PO ${poNumber}; ${date}; ${productionQty} module(s).`);
  window.showNotification({ title: "Daily Production Saved", message: `${poNumber}: ${productionQty.toLocaleString("en-IN")} module(s) saved for ${productionDisplayDate(date)}.`, type: "success" });
  window.populateProductionDailyContext();
  window.renderProductionSheet();
};

window.renderProductionSheet = function() {
  const body = document.getElementById("productionSheetBody");
  if (!body) return;
  const keyword = productionText(document.getElementById("productionSheetSearch")?.value).toLowerCase();
  const statusFilter = productionText(document.getElementById("productionSheetStatusFilter")?.value).toUpperCase();
  const rows = (productionSheetDb || []).map(record => getProductionRow(record.poNumber)).filter(row => {
    const searchable = [row.saved?.serialNo, row.poNumber, row.model, row.watt, row.productionStatus, row.packingStatus, row.bom, row.dispatchMode, row.serials.start, row.serials.end].join(" ").toLowerCase();
    return (!keyword || searchable.includes(keyword)) && (!statusFilter || row.productionStatus === statusFilter);
  });
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="22" style="text-align:center; padding:24px; color:var(--muted);">No Production PO details match this search.</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(row => {
    const saved = row.saved; const latest = row.daily.latest || {};
    const gradeText = `A: ${row.daily.a.toLocaleString("en-IN")}<br>B: ${row.daily.b.toLocaleString("en-IN")}<br>R: ${row.daily.r.toLocaleString("en-IN")}`;
    const dispatchText = `A: ${row.live.dispatched.a.toLocaleString("en-IN")}<br>B: ${row.live.dispatched.b.toLocaleString("en-IN")}<br>R: ${row.live.dispatched.r.toLocaleString("en-IN")}`;
    const warehouseText = `A: ${row.live.warehouse.a.toLocaleString("en-IN")}<br>B: ${row.live.warehouse.b.toLocaleString("en-IN")}<br>R: ${row.live.warehouse.r.toLocaleString("en-IN")}`;
    return `<tr><td>${productionEsc(saved.serialNo)}</td><td><strong>${productionEsc(row.poNumber)}</strong></td><td><strong>${productionEsc(row.productionStatus)}</strong></td><td>${productionEsc(row.packingStatus)}</td><td><strong>${productionEsc(row.model)}</strong><div style="color:var(--muted); margin-top:2px;">${productionEsc(row.watt)}</div></td><td>${productionEsc(row.bom)}</td><td>${productionEsc(row.dispatchMode)}</td><td>${row.customerQty.toLocaleString("en-IN")}</td><td>${row.poQty.toLocaleString("en-IN")}</td><td style="font-weight:800; color:#087fb9;">${row.daily.qty.toLocaleString("en-IN")}</td><td style="font-weight:800; color:#b45309;">${row.pendingQty.toLocaleString("en-IN")}</td><td>${productionDisplayDate(saved.startDate)}<br>${productionDisplayDate(saved.endDate)}</td><td>${productionEsc(row.serials.start)}<br>${productionEsc(row.serials.end)}${saved.serialHold ? `<div style="color:#b45309; margin-top:3px;">Hold: ${productionEsc(saved.serialHold)}</div>` : ""}</td><td>${gradeText}</td><td>${productionNumber(latest.cellRejectionPct).toFixed(2)}%</td><td>${productionNumber(latest.moduleRejectionPct).toFixed(2)}%</td><td>${productionDisplayDate(saved.tentativeDispatchDate)}</td><td>${productionDisplayDate(saved.customerTargetDispatchDate)}</td><td>${productionNumber(latest.delayDays)} day(s)${latest.delayReason ? `<div style="margin-top:3px;">${productionEsc(latest.delayReason)}</div>` : ""}</td><td style="font-weight:800; color:#059669;">${row.live.totalFg.toLocaleString("en-IN")}</td><td>${warehouseText}</td><td>${dispatchText}</td></tr>`;
  }).join("");
};

const dashboardHtmlCache = new WeakMap();

function dashboardSetText(id, value) {
  const element = typeof id === "string" ? document.getElementById(id) : id;
  if (!element) return false;
  const text = String(value ?? "");
  if (element.textContent === text) {
    window.erpPerformanceStats.dashboardDomWritesSkipped += 1;
    return false;
  }
  const wasRendered = element.dataset.erpDashboardRendered === "1";
  element.textContent = text;
  element.dataset.erpDashboardRendered = "1";
  window.erpPerformanceStats.dashboardDomWrites += 1;
  if (wasRendered && !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
    element.animate?.([{ opacity: 0.55, transform: "translateY(2px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 180, easing: "ease-out" });
  }
  return true;
}

function dashboardSetHtml(target, value) {
  const element = typeof target === "string" ? document.getElementById(target) : target;
  if (!element) return false;
  const html = String(value ?? "");
  if (dashboardHtmlCache.get(element) === html || element.innerHTML === html) {
    dashboardHtmlCache.set(element, html);
    window.erpPerformanceStats.dashboardDomWritesSkipped += 1;
    return false;
  }
  element.innerHTML = html;
  dashboardHtmlCache.set(element, html);
  window.erpPerformanceStats.dashboardDomWrites += 1;
  return true;
}

function dashboardSetStyle(element, property, value) {
  if (!element || element.style[property] === value) {
    if (element) window.erpPerformanceStats.dashboardDomWritesSkipped += 1;
    return false;
  }
  element.style[property] = value;
  window.erpPerformanceStats.dashboardDomWrites += 1;
  return true;
}

function dashboardMoney(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function dashboardInvoiceValue(invoice) {
  return Math.round(Number(invoice?.invoiceValue || 0));
}

function getAccountsDashboardPartyPositions() {
  const positions = new Map();
  (accountInvoices || []).forEach(invoice => {
    const key = receiptPartyKey(invoice.customerName);
    if (!key) return;
    const current = positions.get(key) || { name: invoice.customerName || key, invoiced: 0, received: 0, invoiceNumbers: new Set(), coNumbers: new Set() };
    current.invoiced += dashboardInvoiceValue(invoice);
    if (invoice.invoiceNumber) current.invoiceNumbers.add(String(invoice.invoiceNumber));
    if (invoice.coNumber) current.coNumbers.add(String(invoice.coNumber));
    positions.set(key, current);
  });
  (accountReceiptsDb || []).forEach(receipt => {
    const key = receiptPartyKey(receipt.partyName);
    if (!key) return;
    const current = positions.get(key) || { name: receipt.partyName || key, invoiced: 0, received: 0, invoiceNumbers: new Set(), coNumbers: new Set() };
    current.received += Number(receipt.balanceEffect ?? receipt.amount ?? 0);
    (Array.isArray(receipt.coNumbers) ? receipt.coNumbers : [receipt.coNumber]).filter(Boolean).forEach(co => current.coNumbers.add(String(co)));
    positions.set(key, current);
  });
  return [...positions.values()].map(item => ({
    ...item,
    invoiceNumbers: [...item.invoiceNumbers],
    coNumbers: [...item.coNumbers],
    pending: Math.max(0, item.invoiced - item.received)
  }));
}

function findAccountsDashboardDispatch(invoice) {
  return (dispatchArchive || []).find(manifest =>
    String(manifest.accountInvoiceId || "") === String(invoice.id || "")
    || accountInvoiceKey(manifest.invoice) === accountInvoiceKey(invoice.invoiceNumber)
  ) || null;
}

window.openAccountsDashboardDetail = function(type) {
  const validTypes = ["invoice", "received", "outstanding", "ready", "dispatched"];
  accountsDashboardDetailType = validTypes.includes(type) ? type : "outstanding";
  window.renderAccountsDashboardDetail?.();
  document.getElementById("accountsDashDetailPanel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
};

window.renderAccountsDashboardDetail = function() {
  const head = document.getElementById("accountsDashDetailHead");
  const body = document.getElementById("accountsDashDetailBody");
  if (!head || !body) return;
  const invoices = Array.isArray(accountInvoices) ? accountInvoices : [];
  const receipts = Array.isArray(accountReceiptsDb) ? accountReceiptsDb : [];
  const validTypes = ["invoice", "received", "outstanding", "ready", "dispatched"];
  const type = validTypes.includes(accountsDashboardDetailType) ? accountsDashboardDetailType : "outstanding";
  document.querySelectorAll("[data-accounts-detail]").forEach(card => card.classList.toggle("active", card.dataset.accountsDetail === type));

  let title = "";
  let subtitle = "";
  let headings = [];
  let rows = [];
  if (type === "invoice") {
    title = "Invoice Value Breakdown";
    subtitle = "Every invoice contributing to the total invoice value.";
    headings = ["Invoice", "Date", "Customer", "CO Number", "Qty.", "Invoice Value", "Status"];
    rows = invoices.map(invoice => {
      const dispatched = String(invoice.status || "").toUpperCase() === "DISPATCHED";
      return `<tr><td><strong>${escapeSalesHtml(invoice.invoiceNumber || "-")}</strong></td><td>${escapeSalesHtml(reportHubDisplayDate(invoice.invoiceDate || ""))}</td><td>${escapeSalesHtml(invoice.customerName || "-")}</td><td>${escapeSalesHtml(invoice.coNumber || "-")}</td><td>${Number(invoice.quantity || 0).toLocaleString("en-IN")}</td><td style="font-weight:900;">${dashboardMoney(invoice.invoiceValue)}</td><td style="font-weight:800; color:${dispatched ? "#15803d" : "#1d4ed8"};">${escapeSalesHtml(invoice.status || "READY FOR DISPATCH")}</td></tr>`;
    });
  } else if (type === "received") {
    title = "Received Amount Breakdown";
    subtitle = "Receipt and adjustment entries showing where collections came from.";
    headings = ["Date", "Party", "Transaction", "Amount", "Balance Effect", "Bank / Unit", "Sales Person", "Entered By"];
    rows = receipts.map(receipt => `<tr><td>${escapeSalesHtml(reportHubDisplayDate(receipt.date || ""))}</td><td><strong>${escapeSalesHtml(receipt.partyName || "-")}</strong></td><td>${escapeSalesHtml(receipt.transactionType || "RECEIPT")}</td><td style="font-weight:900;">${dashboardMoney(receipt.amount)}</td><td>${dashboardMoney(receipt.balanceEffect ?? receipt.amount)}</td><td>${escapeSalesHtml(receipt.bankUnit || "-")}</td><td>${escapeSalesHtml(receipt.salesPerson || "-")}</td><td>${escapeSalesHtml(receipt.createdBy || "-")}</td></tr>`);
  } else if (type === "outstanding") {
    title = "Outstanding Breakdown";
    subtitle = "Customer-wise pending collection with its invoice and CO sources.";
    headings = ["Customer", "Invoices", "CO Numbers", "Invoiced", "Received", "Outstanding"];
    rows = getAccountsDashboardPartyPositions().filter(item => item.pending > 0).sort((a, b) => b.pending - a.pending).map(item => `<tr><td><strong>${escapeSalesHtml(item.name || "-")}</strong></td><td>${escapeSalesHtml(item.invoiceNumbers.join(", ") || "-")}</td><td>${escapeSalesHtml(item.coNumbers.join(", ") || "-")}</td><td>${dashboardMoney(item.invoiced)}</td><td style="color:#059669; font-weight:800;">${dashboardMoney(item.received)}</td><td style="color:#b45309; font-weight:900;">${dashboardMoney(item.pending)}</td></tr>`);
  } else if (type === "ready") {
    title = "Ready for Dispatch";
    subtitle = "Invoices still waiting for dispatch, including quantity and vehicle details.";
    headings = ["Invoice", "Date", "Customer", "CO Number", "Pending Qty.", "Model", "Vehicle", "Transporter"];
    rows = invoices.filter(invoice => String(invoice.status || "READY FOR DISPATCH").toUpperCase() !== "DISPATCHED").map(invoice => `<tr><td><strong>${escapeSalesHtml(invoice.invoiceNumber || "-")}</strong></td><td>${escapeSalesHtml(reportHubDisplayDate(invoice.invoiceDate || ""))}</td><td>${escapeSalesHtml(invoice.customerName || "-")}</td><td>${escapeSalesHtml(invoice.coNumber || "-")}</td><td style="font-weight:900; color:#0284c7;">${Number(invoice.quantity || 0).toLocaleString("en-IN")}</td><td>${escapeSalesHtml(invoice.modelNo || invoice.modelType || "-")}</td><td>${escapeSalesHtml(invoice.vehicleNumber || "-")}</td><td>${escapeSalesHtml(invoice.transporterName || "-")}</td></tr>`);
  } else {
    title = "Dispatched Invoice Details";
    subtitle = "Completed dispatches with quantity, vehicle, transporter and challan details.";
    headings = ["Invoice", "Dispatch Date", "Customer", "CO Number", "Qty.", "Vehicle", "Transporter", "Challan"];
    rows = invoices.filter(invoice => String(invoice.status || "").toUpperCase() === "DISPATCHED").map(invoice => {
      const manifest = findAccountsDashboardDispatch(invoice);
      return `<tr><td><strong>${escapeSalesHtml(invoice.invoiceNumber || manifest?.invoice || "-")}</strong></td><td>${escapeSalesHtml(reportHubDisplayDate(manifest?.createdAt || manifest?.dispatchedAt || manifest?.date || invoice.dispatchedAt || invoice.invoiceDate || ""))}</td><td>${escapeSalesHtml(manifest?.customer || invoice.customerName || "-")}</td><td>${escapeSalesHtml(manifest?.coNumber || invoice.coNumber || "-")}</td><td style="font-weight:900; color:#7c3aed;">${Number(manifest?.dispatchedQty ?? invoice.quantity ?? 0).toLocaleString("en-IN")}</td><td>${escapeSalesHtml(manifest?.vehicle || invoice.vehicleNumber || "-")}</td><td>${escapeSalesHtml(manifest?.transporter || invoice.transporterName || "-")}</td><td>${escapeSalesHtml(manifest?.challanNo || invoice.challanNo || "-")}</td></tr>`;
    });
  }

  dashboardSetText("accountsDashDetailTitle", title);
  dashboardSetText("accountsDashDetailSubtitle", subtitle);
  dashboardSetText("accountsDashDetailCount", `${rows.length.toLocaleString("en-IN")} RECORD${rows.length === 1 ? "" : "S"}`);
  head.innerHTML = headings.map(label => `<th>${escapeSalesHtml(label)}</th>`).join("");
  body.innerHTML = rows.length ? rows.join("") : `<tr><td colspan="${headings.length}" style="text-align:center; padding:24px; color:var(--muted);">No records are available for this section.</td></tr>`;
};

function getAccountsDashboardDetailExportData() {
  const head = document.getElementById("accountsDashDetailHead");
  const body = document.getElementById("accountsDashDetailBody");
  const headings = Array.from(head?.querySelectorAll("th") || []).map(cell => String(cell.textContent || "").trim());
  const rows = Array.from(body?.querySelectorAll("tr") || []).map(row => Array.from(row.querySelectorAll("td")).map(cell => String(cell.textContent || "").replace(/\s+/g, " ").trim())).filter(row => headings.length && row.length === headings.length);
  return {
    title: String(document.getElementById("accountsDashDetailTitle")?.textContent || "Accounts Dashboard Details").trim(),
    subtitle: String(document.getElementById("accountsDashDetailSubtitle")?.textContent || "").trim(),
    headings,
    rows
  };
}

function accountsDashboardDetailExportName(title, extension) {
  const safe = String(title || "Accounts Dashboard Details").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "Accounts_Dashboard_Details";
  return `${safe}_${new Date().toISOString().slice(0, 10)}.${extension}`;
}

window.exportAccountsDashboardDetailExcel = async function() {
  const data = getAccountsDashboardDetailExportData();
  if (!data.rows.length) { window.showNotification({ title: "No Records to Export", message: "This breakdown does not currently contain any records.", type: "warning" }); return; }
  if (!window.ExcelJS) { window.showNotification({ title: "Excel Export Unavailable", message: "Refresh the ERP so the Excel library can load, then try again.", type: "error" }); return; }
  try {
    const workbook = new window.ExcelJS.Workbook();
    workbook.creator = "DemoSolar Industries ERP";
    workbook.created = new Date();
    workbook.subject = data.title;
    const sheet = workbook.addWorksheet("Breakdown", { views: [{ state: "frozen", ySplit: 5, showGridLines: false }] });
    const headers = ["#", ...data.headings];
    const lastColumn = sheet.getColumn(headers.length).letter;
    sheet.mergeCells(`A1:${lastColumn}1`); sheet.mergeCells(`A2:${lastColumn}2`); sheet.mergeCells(`A3:${lastColumn}3`);
    sheet.getCell("A1").value = "DEMOSOLAR INDUSTRIES PRIVATE LIMITED";
    sheet.getCell("A2").value = data.title.toUpperCase();
    sheet.getCell("A3").value = `${data.subtitle} | Records: ${data.rows.length.toLocaleString("en-IN")} | Generated: ${new Date().toLocaleString()}`;
    sheet.getCell("A1").font = { name: "Calibri", size: 12, bold: true, color: { argb: "FF64748B" } };
    sheet.getCell("A2").font = { name: "Calibri", size: 18, bold: true, color: { argb: "FF087FB9" } };
    sheet.getCell("A3").font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF0F766E" } };
    [1, 2, 3].forEach(rowNumber => { sheet.getRow(rowNumber).height = rowNumber === 2 ? 30 : 23; sheet.getCell(`A${rowNumber}`).alignment = { vertical: "middle", horizontal: "center", wrapText: true }; });
    const headerRow = sheet.getRow(5); headerRow.values = headers; headerRow.height = 30;
    headerRow.eachCell(cell => { cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F9F95" } }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; cell.border = { top: { style: "thin", color: { argb: "FFCBD5E1" } }, left: { style: "thin", color: { argb: "FFCBD5E1" } }, bottom: { style: "thin", color: { argb: "FFCBD5E1" } }, right: { style: "thin", color: { argb: "FFCBD5E1" } } }; });
    data.rows.forEach((values, index) => {
      const row = sheet.addRow([index + 1, ...values]); row.height = 23;
      row.eachCell(cell => { cell.font = { name: "Calibri", size: 10, color: { argb: "FF0F172A" } }; cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: index % 2 ? "FFF1F5F9" : "FFFFFFFF" } }; cell.border = { top: { style: "thin", color: { argb: "FFE2E8F0" } }, left: { style: "thin", color: { argb: "FFE2E8F0" } }, bottom: { style: "thin", color: { argb: "FFE2E8F0" } }, right: { style: "thin", color: { argb: "FFE2E8F0" } } }; });
    });
    sheet.getColumn(1).width = 7;
    data.headings.forEach((heading, index) => { const longest = Math.max(heading.length, ...data.rows.map(row => String(row[index] || "").length)); sheet.getColumn(index + 2).width = Math.min(36, Math.max(14, longest + 3)); });
    sheet.autoFilter = { from: "A5", to: `${lastColumn}${data.rows.length + 5}` };
    sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    sheet.headerFooter.oddFooter = "DemoSolar Industries ERP  |  Page &P of &N";
    const buffer = await workbook.xlsx.writeBuffer();
    downloadXlsxBuffer(buffer, accountsDashboardDetailExportName(data.title, "xlsx"));
    await logEvent("ACCOUNTS", "ACCOUNTS_DASHBOARD_EXPORTED", `Exported ${data.rows.length} ${data.title} record(s) to Excel.`);
  } catch (error) { console.error("Accounts dashboard Excel export failed:", error); window.showNotification({ title: "Excel Export Failed", message: error.message || "The workbook could not be generated.", type: "error" }); }
};

window.exportAccountsDashboardDetailPdf = async function() {
  const data = getAccountsDashboardDetailExportData();
  if (!data.rows.length) { window.showNotification({ title: "No Records to Export", message: "This breakdown does not currently contain any records.", type: "warning" }); return; }
  const JsPdf = window.jspdf?.jsPDF;
  if (!JsPdf) { window.showNotification({ title: "PDF Export Unavailable", message: "Refresh the ERP so the PDF library can load, then try again.", type: "error" }); return; }
  try {
    const pdf = new JsPdf({ orientation: "landscape", unit: "mm", format: "a4" });
    const headers = ["#", ...data.headings];
    const margin = 9, pageWidth = pdf.internal.pageSize.getWidth(), pageHeight = pdf.internal.pageSize.getHeight(), tableWidth = pageWidth - margin * 2;
    const numberWidth = 9, availableColumnWidth = tableWidth - numberWidth;
    const columnWeights = data.headings.map(heading => {
      const label = String(heading || "").toLowerCase();
      if (/invoice|description/.test(label)) return 1.55;
      if (/customer|party|co number|transporter|bank|unit/.test(label)) return 1.25;
      if (/amount|invoiced|received|outstanding|balance|qty|quantity|date/.test(label)) return .82;
      return 1;
    });
    const totalColumnWeight = columnWeights.reduce((total, weight) => total + weight, 0) || 1;
    const widths = [numberWidth, ...columnWeights.map(weight => availableColumnWidth * weight / totalColumnWeight)];
    const clean = value => String(value ?? "-").replace(/₹/g, "INR ").replace(/\s+/g, " ").trim() || "-";
    let pageNumber = 1, y = 0;
    const drawHeader = () => {
      pdf.setFillColor(8, 127, 185); pdf.rect(0, 0, pageWidth * .55, 4, "F"); pdf.setFillColor(31, 190, 104); pdf.rect(pageWidth * .55, 0, pageWidth * .45, 4, "F");
      pdf.setTextColor(15, 23, 42); pdf.setFont("helvetica", "bold"); pdf.setFontSize(15); pdf.text(data.title.toUpperCase(), margin, 14);
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(7.5); pdf.setTextColor(71, 85, 105); pdf.text(`${clean(data.subtitle)} | ${data.rows.length} record(s) | Generated ${new Date().toLocaleString()}`, margin, 20); pdf.text(`Page ${pageNumber}`, pageWidth - margin, 20, { align: "right" });
      y = 25; let x = margin; pdf.setFont("helvetica", "bold"); pdf.setFontSize(7);
      headers.forEach((header, index) => {
        // PDF text and shape fills share the same non-stroking colour state, so
        // restore the cell fill before every rectangle and the text colour after it.
        pdf.setFillColor(15, 159, 149); pdf.rect(x, y, widths[index], 10, "F");
        pdf.setTextColor(255, 255, 255); pdf.text(pdf.splitTextToSize(clean(header), widths[index] - 2), x + widths[index] / 2, y + 4.2, { align: "center" });
        x += widths[index];
      }); y += 10;
    };
    drawHeader();
    data.rows.forEach((values, rowIndex) => {
      const row = [rowIndex + 1, ...values].map(clean);
      const wrapped = row.map((value, index) => pdf.splitTextToSize(value, widths[index] - 2));
      const lineHeight = 3.35, rowPadding = 2.8, bottomMargin = 9;
      const totalLines = Math.max(...wrapped.map(lines => lines.length));
      const fullRowHeight = Math.max(8, totalLines * lineHeight + rowPadding);
      const fullPageRowSpace = pageHeight - 35 - bottomMargin;
      if (fullRowHeight <= fullPageRowSpace && y + fullRowHeight > pageHeight - bottomMargin) { pdf.addPage(); pageNumber += 1; drawHeader(); }
      let lineOffset = 0;
      while (lineOffset < totalLines) {
        let availableHeight = pageHeight - bottomMargin - y;
        let linesThisSegment = Math.floor((availableHeight - rowPadding) / lineHeight);
        if (linesThisSegment < 1 || availableHeight < 8) { pdf.addPage(); pageNumber += 1; drawHeader(); availableHeight = pageHeight - bottomMargin - y; linesThisSegment = Math.floor((availableHeight - rowPadding) / lineHeight); }
        linesThisSegment = Math.min(totalLines - lineOffset, Math.max(1, linesThisSegment));
        const rowHeight = Math.max(8, linesThisSegment * lineHeight + rowPadding);
        let x = margin;
        pdf.setDrawColor(203, 213, 225); pdf.setLineWidth(.15); pdf.setFont("helvetica", "normal"); pdf.setFontSize(7);
        wrapped.forEach((lines, index) => {
          const segmentLines = lines.slice(lineOffset, lineOffset + linesThisSegment);
          pdf.setFillColor(rowIndex % 2 ? 241 : 255, rowIndex % 2 ? 245 : 255, rowIndex % 2 ? 249 : 255);
          pdf.rect(x, y, widths[index], rowHeight, "FD");
          pdf.setTextColor(15, 23, 42);
          if (segmentLines.length) pdf.text(segmentLines, x + widths[index] / 2, y + 4.2, { align: "center" });
          x += widths[index];
        });
        y += rowHeight; lineOffset += linesThisSegment;
        if (lineOffset < totalLines) { pdf.addPage(); pageNumber += 1; drawHeader(); }
      }
    });
    pdf.save(accountsDashboardDetailExportName(data.title, "pdf"));
    await logEvent("ACCOUNTS", "ACCOUNTS_DASHBOARD_EXPORTED", `Exported ${data.rows.length} ${data.title} record(s) to PDF.`);
  } catch (error) { console.error("Accounts dashboard PDF export failed:", error); window.showNotification({ title: "PDF Export Failed", message: error.message || "The PDF could not be generated.", type: "error" }); }
};

function accountsIntelPeriod(periodKey) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const startOfMonth = (year, month) => new Date(year, month, 1, 0, 0, 0, 0);
  if (periodKey === "THIS_MONTH") return { start: startOfMonth(today.getFullYear(), today.getMonth()), end: today, label: "This Month" };
  if (periodKey === "LAST_MONTH") return { start: startOfMonth(today.getFullYear(), today.getMonth() - 1), end: new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999), label: "Last Month" };
  if (periodKey === "LAST_3_MONTHS") return { start: startOfMonth(today.getFullYear(), today.getMonth() - 2), end: today, label: "Last 3 Months" };
  if (periodKey === "LAST_6_MONTHS") return { start: startOfMonth(today.getFullYear(), today.getMonth() - 5), end: today, label: "Last 6 Months" };
  if (periodKey === "THIS_FY") {
    const fyYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
    return { start: new Date(fyYear, 3, 1, 0, 0, 0, 0), end: today, label: "This Financial Year" };
  }
  return { start: null, end: null, label: "All Time" };
}

function accountsIntelDate(value) {
  const ymd = reportHubYmd(value);
  if (!ymd) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function accountsIntelInPeriod(value, period) {
  if (!period.start && !period.end) return true;
  const date = accountsIntelDate(value);
  return Boolean(date && (!period.start || date >= period.start) && (!period.end || date <= period.end));
}

function populateAccountsIntelCustomers() {
  const select = document.getElementById("accountsIntelCustomer");
  if (!select) return "ALL";
  const current = select.value || "ALL";
  const names = [...new Set([
    ...(accountInvoices || []).map(item => String(item.customerName || "").trim()),
    ...(accountReceiptsDb || []).map(item => String(item.partyName || "").trim())
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  select.innerHTML = '<option value="ALL">All Customers</option>' + names.map(name => `<option value="${escapeSalesHtml(receiptPartyKey(name))}">${escapeSalesHtml(name)}</option>`).join("");
  select.value = current === "ALL" || names.some(name => receiptPartyKey(name) === current) ? current : "ALL";
  return select.value;
}

function getAccountsIntelligenceModel() {
  const customer = populateAccountsIntelCustomers();
  const periodKey = String(document.getElementById("accountsIntelPeriod")?.value || "ALL");
  const transactionType = String(document.getElementById("accountsIntelType")?.value || "ALL");
  const period = accountsIntelPeriod(periodKey);
  const matchesCustomer = name => customer === "ALL" || receiptPartyKey(name) === customer;
  const includeInvoices = transactionType !== "COLLECTION";
  const includeReceipts = transactionType !== "INVOICE";
  const invoices = includeInvoices ? (accountInvoices || []).filter(invoice => matchesCustomer(invoice.customerName) && accountsIntelInPeriod(invoice.invoiceDate || invoice.createdAt, period)) : [];
  const receipts = includeReceipts ? (accountReceiptsDb || []).filter(receipt => matchesCustomer(receipt.partyName) && accountsIntelInPeriod(receipt.date || receipt.createdAt, period)) : [];
  const invoiceValue = invoices.reduce((sum, invoice) => sum + dashboardInvoiceValue(invoice), 0);
  const collected = Math.max(0, receipts.reduce((sum, receipt) => sum + Number(receipt.balanceEffect ?? receipt.amount ?? 0), 0));
  const outstanding = Math.max(0, invoiceValue - collected);
  const invoicedQuantity = invoices.reduce((sum, invoice) => sum + Number(invoice.quantity || 0), 0);
  const dispatched = invoices.filter(invoice => String(invoice.status || "").toUpperCase() === "DISPATCHED");
  const ready = invoices.filter(invoice => String(invoice.status || "READY FOR DISPATCH").toUpperCase() !== "DISPATCHED");
  const customerLabel = customer === "ALL" ? "All Customers" : (invoices[0]?.customerName || receipts[0]?.partyName || document.getElementById("accountsIntelCustomer")?.selectedOptions?.[0]?.textContent || "All Customers");
  const transactions = [
    ...invoices.map(invoice => ({ date: invoice.invoiceDate || invoice.createdAt || "", type: "INVOICE", reference: invoice.invoiceNumber || "-", coNumber: invoice.coNumber || "-", party: invoice.customerName || "-", amount: dashboardInvoiceValue(invoice), quantity: Number(invoice.quantity || 0), bankTransporter: invoice.transporterName || "-", status: invoice.status || "READY FOR DISPATCH" })),
    ...receipts.map(receipt => ({ date: receipt.date || receipt.createdAt || "", type: receipt.transactionType || "RECEIPT", reference: receipt.id || "-", coNumber: (Array.isArray(receipt.coNumbers) ? receipt.coNumbers.join(", ") : String(receipt.coNumbers || receipt.coNumber || "-")), party: receipt.partyName || "-", amount: Number(receipt.amount || 0), quantity: 0, bankTransporter: receipt.bankUnit || "-", status: "POSTED" }))
  ].sort((a, b) => String(reportHubYmd(b.date)).localeCompare(String(reportHubYmd(a.date))));
  const search = String(document.getElementById("accountsIntelSearch")?.value || "").trim().toLowerCase();
  const registerRows = search ? transactions.filter(row => Object.values(row).join(" ").toLowerCase().includes(search)) : transactions;
  return { period, periodKey, transactionType, customer, customerLabel, invoices, receipts, invoiceValue, collected, outstanding, invoicedQuantity, dispatched, ready, transactions, registerRows };
}

function accountsIntelAgeing(model) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const parties = new Map();
  model.invoices.forEach(invoice => {
    const key = receiptPartyKey(invoice.customerName);
    if (!key) return;
    const entry = parties.get(key) || { name: invoice.customerName || key, invoices: [], receipts: 0 };
    entry.invoices.push({ amount: dashboardInvoiceValue(invoice), date: accountsIntelDate(invoice.invoiceDate || invoice.createdAt) });
    parties.set(key, entry);
  });
  model.receipts.forEach(receipt => {
    const key = receiptPartyKey(receipt.partyName);
    if (!key) return;
    const entry = parties.get(key) || { name: receipt.partyName || key, invoices: [], receipts: 0 };
    entry.receipts += Number(receipt.balanceEffect ?? receipt.amount ?? 0);
    parties.set(key, entry);
  });
  const buckets = [
    { amount: 0, customers: new Set() }, { amount: 0, customers: new Set() },
    { amount: 0, customers: new Set() }, { amount: 0, customers: new Set() }
  ];
  parties.forEach((entry, key) => {
    let credit = Math.max(0, entry.receipts);
    const open = entry.invoices.slice().sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0)).map(invoice => {
      const applied = Math.min(credit, invoice.amount);
      credit -= applied;
      return { ...invoice, remaining: Math.max(0, invoice.amount - applied) };
    }).filter(invoice => invoice.remaining > .001);
    if (!open.length) return;
    const balance = open.reduce((sum, invoice) => sum + invoice.remaining, 0);
    const oldest = open[0].date || today;
    const days = Math.max(0, Math.floor((today - oldest) / 86400000));
    const index = days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3;
    buckets[index].amount += balance;
    buckets[index].customers.add(key);
  });
  return buckets;
}

function accountsIntelNiceMax(value) {
  const maximum = Math.max(1, Number(value || 0));
  const magnitude = 10 ** Math.floor(Math.log10(maximum));
  const normalized = maximum / magnitude;
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(item => item >= normalized) || 10;
  return step * magnitude;
}

function renderAccountsIntelTrend(model) {
  const container = document.getElementById("accountsIntelTrendChart");
  if (!container) return;
  const today = new Date();
  const months = Array.from({ length: 6 }, (_, index) => {
    const offset = 5 - index;
    const start = new Date(today.getFullYear(), today.getMonth() - offset, 1);
    const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
    return { key, label: start.toLocaleDateString("en-IN", { month: "short" }), billed: 0, collected: 0 };
  });
  const byKey = new Map(months.map(month => [month.key, month]));
  model.invoices.forEach(invoice => { const key = reportHubYmd(invoice.invoiceDate || invoice.createdAt).slice(0, 7); if (byKey.has(key)) byKey.get(key).billed += dashboardInvoiceValue(invoice); });
  model.receipts.forEach(receipt => { const key = reportHubYmd(receipt.date || receipt.createdAt).slice(0, 7); if (byKey.has(key)) byKey.get(key).collected += Number(receipt.balanceEffect ?? receipt.amount ?? 0); });
  const maximum = Math.max(0, ...months.flatMap(month => [month.billed, month.collected]));
  if (maximum <= 0) { container.innerHTML = '<div style="height:280px; display:grid; place-items:center; color:#94a3b8; font-size:11px;">No billing or collection activity in the last six months.</div>'; return; }
  const width = 760, height = 310, left = 58, right = 14, top = 25, bottom = 245;
  const plotWidth = width - left - right, plotHeight = bottom - top, axisMax = accountsIntelNiceMax(maximum), groupWidth = plotWidth / months.length, barWidth = 20, gap = 6;
  const grid = Array.from({ length: 5 }, (_, index) => { const value = axisMax * (4 - index) / 4; const y = top + plotHeight * index / 4; return `<line x1="${left}" y1="${y}" x2="${width-right}" y2="${y}" stroke="#e5eaf0" stroke-width="1"></line><text x="${left-8}" y="${y+3}" text-anchor="end" fill="#64748b" font-size="9">${escapeSalesHtml(salesDashboardCompactQty(value))}</text>`; }).join("");
  const bars = months.map((month, index) => {
    const center = left + groupWidth * index + groupWidth / 2;
    const makeBar = (value, x, fill, label) => { if (value <= 0) return ""; const barHeight = Math.max(3, value / axisMax * plotHeight); const y = bottom - barHeight; return `<g><title>${escapeSalesHtml(`${month.label} ${label}: ${dashboardMoney(value)}`)}</title><rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="5" fill="${fill}"></rect></g>`; };
    return `${makeBar(month.billed,center-barWidth-gap/2,"url(#accountsBilled)","Invoice Value")}${makeBar(month.collected,center+gap/2,"url(#accountsCollected)","Collections")}<text x="${center}" y="266" text-anchor="middle" fill="#475569" font-size="10" font-weight="800">${month.label}</text>`;
  }).join("");
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Billing versus collection trend for the last six months"><defs><linearGradient id="accountsBilled" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#38bdf8"></stop><stop offset="1" stop-color="#0284c7"></stop></linearGradient><linearGradient id="accountsCollected" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34d399"></stop><stop offset="1" stop-color="#059669"></stop></linearGradient></defs>${grid}<line x1="${left}" y1="${bottom}" x2="${width-right}" y2="${bottom}" stroke="#94a3b8"></line>${bars}<g transform="translate(${width/2-95},296)"><rect width="10" height="10" rx="3" fill="#0284c7"></rect><text x="16" y="9" fill="#64748b" font-size="9" font-weight="800">Invoice Value</text><rect x="102" width="10" height="10" rx="3" fill="#059669"></rect><text x="118" y="9" fill="#64748b" font-size="9" font-weight="800">Collections</text></g></svg>`;
}

window.resetAccountsIntelligenceFilters = function() {
  const set = (id, value) => { const element = document.getElementById(id); if (element) element.value = value; };
  set("accountsIntelPeriod", "ALL"); set("accountsIntelCustomer", "ALL"); set("accountsIntelType", "ALL"); set("accountsIntelSearch", "");
  window.renderAccountsDashboard?.();
};

window.renderAccountsDashboard = function() {
  if (!document.getElementById("accountsIntelligenceExportArea")) return;
  const model = getAccountsIntelligenceModel();
  dashboardSetText("accountsIntelInvoiceValue", dashboardMoney(model.invoiceValue));
  dashboardSetText("accountsIntelInvoiceCount", `${model.invoices.length.toLocaleString("en-IN")} invoice${model.invoices.length === 1 ? "" : "s"}`);
  dashboardSetText("accountsIntelCollected", dashboardMoney(model.collected));
  dashboardSetText("accountsIntelReceiptCount", `${model.receipts.length.toLocaleString("en-IN")} transaction${model.receipts.length === 1 ? "" : "s"}`);
  dashboardSetText("accountsIntelOutstanding", dashboardMoney(model.outstanding));
  dashboardSetText("accountsIntelQuantity", model.invoicedQuantity.toLocaleString("en-IN"));
  dashboardSetText("accountsIntelDispatched", model.dispatched.length.toLocaleString("en-IN"));
  dashboardSetText("accountsIntelReady", `${model.ready.length.toLocaleString("en-IN")} ready for dispatch`);
  const rate = model.invoiceValue > 0 ? Math.min(100, model.collected / model.invoiceValue * 100) : 0;
  dashboardSetText("accountsIntelEfficiencyRate", `${rate.toFixed(1)}%`);
  dashboardSetText("accountsIntelBilled", dashboardMoney(model.invoiceValue));
  dashboardSetText("accountsIntelEfficiencyCollected", dashboardMoney(model.collected));
  dashboardSetText("accountsIntelBalance", dashboardMoney(model.outstanding));
  dashboardSetText("accountsIntelEfficiencyContext", `${model.period.label} · ${model.customerLabel}`);
  const ring = document.getElementById("accountsIntelEfficiencyRing"); if (ring) ring.style.setProperty("--rate", `${rate}%`);
  renderAccountsIntelTrend(model);
  const ageing = accountsIntelAgeing(model);
  [["accountsIntelAge0","accountsIntelAge0Customers"],["accountsIntelAge31","accountsIntelAge31Customers"],["accountsIntelAge61","accountsIntelAge61Customers"],["accountsIntelAge90","accountsIntelAge90Customers"]].forEach(([amountId,countId], index) => {
    dashboardSetText(amountId, dashboardMoney(ageing[index].amount));
    const count = ageing[index].customers.size;
    dashboardSetText(countId, `${count.toLocaleString("en-IN")} customer${count === 1 ? "" : "s"}`);
  });
  dashboardSetText("accountsIntelRegisterCaption", `${model.registerRows.length.toLocaleString("en-IN")} records · ${model.period.label}`);
  const body = document.getElementById("accountsIntelRegisterBody");
  if (body) dashboardSetHtml(body, model.registerRows.length ? model.registerRows.map(row => {
    const isInvoice = String(row.type).toUpperCase() === "INVOICE";
    return `<tr><td>${escapeSalesHtml(reportHubDisplayDate(row.date))}</td><td><span class="accounts-type-badge ${isInvoice ? "invoice" : "receipt"}">${escapeSalesHtml(row.type)}</span></td><td><strong>${escapeSalesHtml(row.reference)}</strong></td><td>${escapeSalesHtml(row.coNumber)}</td><td><strong>${escapeSalesHtml(row.party)}</strong></td><td style="font-weight:900; color:${isInvoice ? "#087fb9" : "#059669"};">${dashboardMoney(row.amount)}</td><td>${row.quantity ? Number(row.quantity).toLocaleString("en-IN") : "-"}</td><td>${escapeSalesHtml(row.bankTransporter)}</td><td>${escapeSalesHtml(row.status)}</td></tr>`;
  }).join("") : '<tr><td colspan="9" style="text-align:center; padding:25px; color:var(--muted);">No Accounts transactions match the selected filters.</td></tr>');
};

window.exportAccountsIntelligenceExcel = function() {
  const model = getAccountsIntelligenceModel();
  const rows = model.registerRows.map(row => `<tr><td>${escapeSalesHtml(reportHubDisplayDate(row.date))}</td><td>${escapeSalesHtml(row.type)}</td><td>${escapeSalesHtml(row.reference)}</td><td>${escapeSalesHtml(row.coNumber)}</td><td>${escapeSalesHtml(row.party)}</td><td>${Number(row.amount || 0).toFixed(2)}</td><td>${Number(row.quantity || 0)}</td><td>${escapeSalesHtml(row.bankTransporter)}</td><td>${escapeSalesHtml(row.status)}</td></tr>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse;font-family:Arial;font-size:11px;margin-bottom:16px}th,td{border:1px solid #999;padding:6px}th{background:#0b7fab;color:#fff}.summary td:nth-child(2){font-weight:bold}</style></head><body><h2>Accounts Intelligence</h2><p>${escapeSalesHtml(model.period.label)} · ${escapeSalesHtml(model.customerLabel)}</p><table class="summary"><tr><td>Invoice Value</td><td>${model.invoiceValue.toFixed(2)}</td><td>Amount Collected</td><td>${model.collected.toFixed(2)}</td><td>Outstanding</td><td>${model.outstanding.toFixed(2)}</td></tr><tr><td>Invoiced Quantity</td><td>${model.invoicedQuantity}</td><td>Dispatched Invoices</td><td>${model.dispatched.length}</td><td>Ready for Dispatch</td><td>${model.ready.length}</td></tr></table><table><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>C/O No.</th><th>Customer / Party</th><th>Amount</th><th>Qty.</th><th>Bank / Transporter</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
  const blob = new Blob(["\ufeff", html], { type: "application/vnd.ms-excel" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `Accounts_Intelligence_${reportHubYmd(new Date()) || "Report"}.xls`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(link.href);
};

window.exportAccountsIntelligencePdf = async function() {
  const area = document.getElementById("accountsIntelligenceExportArea");
  if (!area || !window.html2canvas || !window.jspdf?.jsPDF) { window.showNotification?.({ title: "PDF Export Unavailable", message: "The PDF library is not available.", type: "danger" }); return; }
  const registerViewport = document.getElementById("accountsIntelRegisterBody")?.closest("div");
  const previousMaxHeight = registerViewport?.style.maxHeight || "";
  const previousOverflow = registerViewport?.style.overflow || "";
  try {
    if (registerViewport) { registerViewport.style.maxHeight = "none"; registerViewport.style.overflow = "visible"; }
    const canvas = await window.html2canvas(area, { scale: 1.35, useCORS: true, backgroundColor: "#ffffff", logging: false });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("l", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth(), pageHeight = pdf.internal.pageSize.getHeight();
    const imageHeight = canvas.height * pageWidth / canvas.width;
    const image = canvas.toDataURL("image/jpeg", .92);
    let position = 0;
    pdf.addImage(image, "JPEG", 0, position, pageWidth, imageHeight);
    while (position + imageHeight > pageHeight) { position -= pageHeight; pdf.addPage(); pdf.addImage(image, "JPEG", 0, position, pageWidth, imageHeight); }
    pdf.save(`Accounts_Intelligence_${reportHubYmd(new Date()) || "Report"}.pdf`);
  } catch (error) { console.error("Accounts Intelligence PDF export failed:", error); window.showNotification?.({ title: "PDF Export Failed", message: error?.message || "The dashboard PDF could not be created.", type: "danger" }); }
  finally { if (registerViewport) { registerViewport.style.maxHeight = previousMaxHeight; registerViewport.style.overflow = previousOverflow; } }
};

// Classic Accounts Dashboard retained as the active Accounts overview.
window.renderAccountsDashboard = function() {
  const invoices = Array.isArray(accountInvoices) ? accountInvoices : [];
  const receipts = Array.isArray(accountReceiptsDb) ? accountReceiptsDb : [];
  const invoiceValue = invoices.reduce((sum, invoice) => sum + dashboardInvoiceValue(invoice), 0);
  const received = Math.max(0, receipts.reduce((sum, receipt) => sum + Number(receipt.balanceEffect ?? receipt.amount ?? 0), 0));
  const outstanding = Math.max(0, invoiceValue - received);
  const dispatched = invoices.filter(invoice => String(invoice.status || "").toUpperCase() === "DISPATCHED").length;
  const ready = Math.max(0, invoices.length - dispatched);
  const collectionRate = invoiceValue > 0 ? Math.min(100, Math.round(received / invoiceValue * 100)) : 0;
  dashboardSetText("accountsDashInvoiceValue", dashboardMoney(invoiceValue));
  dashboardSetText("accountsDashInvoiceCount", `${invoices.length.toLocaleString("en-IN")} invoice${invoices.length === 1 ? "" : "s"}`);
  dashboardSetText("accountsDashReceived", dashboardMoney(received));
  dashboardSetText("accountsDashOutstanding", dashboardMoney(outstanding));
  dashboardSetText("accountsDashReady", ready.toLocaleString("en-IN"));
  dashboardSetText("accountsDashDispatched", dispatched.toLocaleString("en-IN"));
  dashboardSetText("accountsDashCollectionRate", `${collectionRate}%`);
  dashboardSetText("accountsDashCollectionCaption", `${dashboardMoney(received)} of ${dashboardMoney(invoiceValue)} received`);
  const collectionBar = document.getElementById("accountsDashCollectionBar");
  if (collectionBar) dashboardSetStyle(collectionBar, "width", `${collectionRate}%`);

  const recentBody = document.getElementById("accountsDashRecentInvoices");
  if (recentBody) {
    const recent = invoices.slice(0, 10);
    dashboardSetHtml(recentBody, recent.length ? recent.map(invoice => {
      const isDispatched = String(invoice.status || "").toUpperCase() === "DISPATCHED";
      return `<tr><td><strong>${escapeSalesHtml(invoice.invoiceNumber || "-")}</strong></td><td>${escapeSalesHtml(reportHubDisplayDate(invoice.invoiceDate || ""))}</td><td>${escapeSalesHtml(invoice.customerName || "-")}</td><td>${escapeSalesHtml(invoice.coNumber || "-")}</td><td>${Number(invoice.quantity || 0).toLocaleString("en-IN")}</td><td style="font-weight:800;">${dashboardMoney(dashboardInvoiceValue(invoice))}</td><td><span style="display:inline-block; padding:3px 7px; border-radius:999px; font-size:9px; font-weight:900; background:${isDispatched ? "#dcfce7" : "#dbeafe"}; color:${isDispatched ? "#15803d" : "#1d4ed8"};">${escapeSalesHtml(invoice.status || "READY FOR DISPATCH")}</span></td></tr>`;
    }).join("") : '<tr><td colspan="7" style="text-align:center; padding:22px; color:var(--muted);">No invoices available.</td></tr>');
  }

  const balances = getAccountsDashboardPartyPositions().filter(item => item.pending > 0).sort((a, b) => b.pending - a.pending).slice(0, 5);
  const maxPending = Math.max(1, ...balances.map(item => item.pending));
  const balancesBox = document.getElementById("accountsDashPartyBalances");
  if (balancesBox) dashboardSetHtml(balancesBox, balances.length ? balances.map(item => `<div class="dept-status-row"><span title="${escapeSalesHtml(item.name)}" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:700;">${escapeSalesHtml(item.name)}</span><div class="dept-progress"><span style="width:${Math.max(3, item.pending / maxPending * 100)}%;"></span></div><b>${dashboardMoney(item.pending)}</b></div>`).join("") : '<div style="padding:16px; text-align:center; color:var(--muted); font-size:11px;">No outstanding customer balances.</div>');
  window.renderAccountsDashboardDetail?.();
};

window.openProductionDashboardDetail = function(type) {
  const validTypes = ["production", "orders", "maintenance", "planned", "produced", "pending", "fg", "dispatched"];
  productionDashboardDetailType = validTypes.includes(type) ? type : "orders";
  window.renderProductionDashboardDetail?.(true);
  document.getElementById("productionDashDetailPanel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
};

let productionDashboardColumnFilters = {};
let productionDashboardFilterRenderTimer = null;

window.updateProductionDashboardColumnFilter = function(input) {
  const index = String(input?.dataset?.productionFilter ?? "");
  if (!index) return;
  productionDashboardColumnFilters[index] = productionText(input.value).trim().toLocaleLowerCase();
  if (!productionDashboardColumnFilters[index]) delete productionDashboardColumnFilters[index];
  clearTimeout(productionDashboardFilterRenderTimer);
  productionDashboardFilterRenderTimer = setTimeout(() => window.renderProductionDashboardDetail(true), 500);
};

window.clearProductionDashboardColumnFilters = function() {
  productionDashboardColumnFilters = {};
  window.renderProductionDashboardDetail();
};

window.renderProductionDashboardDetail = function(force = false) {
  const head = document.getElementById("productionDashDetailHead");
  const body = document.getElementById("productionDashDetailBody");
  if (!head || !body) return;
  // Keep periodic data refreshes from rebuilding the table while a user is typing.
  if (!force && document.activeElement?.matches?.(".production-column-filter")) return;
  const validTypes = ["production", "orders", "maintenance", "planned", "produced", "pending", "fg", "dispatched"];
  const type = validTypes.includes(productionDashboardDetailType) ? productionDashboardDetailType : "orders";
  const allRows = type === "production" ? [] : (productionSheetDb || []).map(record => getProductionRow(record.poNumber));
  document.querySelectorAll("[data-production-detail]").forEach(card => card.classList.toggle("active", card.dataset.productionDetail === type));
  const periodSummary = document.getElementById("productionDashPeriodSummary");
  if (periodSummary) {
    periodSummary.style.display = "none";
    periodSummary.innerHTML = "";
  }

  let title = "";
  let subtitle = "";
  let headings = [];
  let records = [];
  let rows = [];
  if (type === "maintenance") {
    title = "Breakdown Maintenance";
    subtitle = "Maintenance tracking and machine breakdown analysis.";
    headings = ["Status"];
    records = [];
    rows = [`<tr><td style="height:180px; text-align:center; vertical-align:middle;"><div style="font-size:38px; margin-bottom:10px;">🛠️</div><strong style="font-size:20px; color:#0284c7;">Coming Soon</strong></td></tr>`];
  } else if (type === "production") {
    const today = productionToday();
    const monthKey = today.slice(0, 7);
    const dailyRecords = (productionDailyDb || []).filter(record => productionText(record.date) === today);
    const monthlyRecords = (productionDailyDb || []).filter(record => productionText(record.date).startsWith(monthKey));
    const todayQty = dailyRecords.reduce((sum, record) => sum + productionNumber(record.productionQty), 0);
    const monthQty = monthlyRecords.reduce((sum, record) => sum + productionNumber(record.productionQty), 0);
    const tillDateQty = (productionDailyDb || []).reduce((sum, record) => sum + productionNumber(record.productionQty), 0);
    title = "Production Summary";
    subtitle = "Daily, current-month and cumulative module production from saved Production updates.";
    headings = ["Date", "PO Number", "Model / Watt", "Produced Qty.", "Grade A", "Grade B", "Grade R", "Status"];
    records = [...(productionDailyDb || [])].filter(record => {
      const productionRow = getProductionRow(record.poNumber);
      const values = [productionDisplayDate(record.date),record.poNumber,`${productionRow?.model || "-"} ${productionRow?.watt || "-"}`,record.productionQty,record.gradeA,record.gradeB,record.gradeR,record.productionStatus];
      return Object.entries(productionDashboardColumnFilters).every(([index,filter]) => !filter || String(values[Number(index)] ?? "").toLocaleLowerCase().includes(filter));
    }).sort((a, b) => productionText(b.date).localeCompare(productionText(a.date)) || productionNumber(b.updatedAt) - productionNumber(a.updatedAt));
    rows = records.map(record => {
      const productionRow = getProductionRow(record.poNumber);
      return `<tr><td><strong>${productionDisplayDate(record.date)}</strong></td><td><strong>${productionEsc(record.poNumber)}</strong></td><td>${productionEsc(productionRow?.model || "-")} / ${productionEsc(productionRow?.watt || "-")}</td><td style="font-weight:900; color:#7c3aed;">${productionNumber(record.productionQty).toLocaleString("en-IN")}</td><td>${productionNumber(record.gradeA).toLocaleString("en-IN")}</td><td>${productionNumber(record.gradeB).toLocaleString("en-IN")}</td><td>${productionNumber(record.gradeR).toLocaleString("en-IN")}</td><td>${productionEsc(record.productionStatus || "-")}</td></tr>`;
    });
    if (periodSummary) {
      periodSummary.style.display = "grid";
      periodSummary.innerHTML = `<div><span>Daily Production</span><strong>${todayQty.toLocaleString("en-IN")}</strong><small>${productionDisplayDate(today)} · Modules</small></div><div><span>Monthly Production</span><strong>${monthQty.toLocaleString("en-IN")}</strong><small>${new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" })} · Modules</small></div><div><span>Till-Date Production</span><strong>${tillDateQty.toLocaleString("en-IN")}</strong><small>All saved production · Modules</small></div>`;
    }
  } else if (type === "orders") {
    const statusOf = row => productionText(row.productionStatus || "PRODUCTION NOT STARTED").toUpperCase();
    const running = allRows.filter(row => statusOf(row) === "RUNNING");
    const upcoming = allRows.filter(row => statusOf(row) === "UPCOMING");
    const hold = allRows.filter(row => statusOf(row) === "HOLD");
    title = "Production Orders";
    subtitle = "POs currently classified as Running, Upcoming, or Hold.";
    headings = ["PO Number", "Model / Watt", "Status", "Planned Qty.", "Produced", "Pending", "Start Date", "Target Dispatch"];
    records = [...running, ...upcoming, ...hold];
    rows = records.map(row => {
      const status = statusOf(row);
      const color = status === "RUNNING" ? "#059669" : status === "HOLD" ? "#dc2626" : "#7c3aed";
      return `<tr><td><strong>${productionEsc(row.poNumber)}</strong></td><td>${productionEsc(row.model || "-")} / ${productionEsc(row.watt || "-")}</td><td style="font-weight:900; color:${color};">${productionEsc(status)}</td><td>${productionNumber(row.poQty).toLocaleString("en-IN")}</td><td>${productionNumber(row.daily?.qty).toLocaleString("en-IN")}</td><td style="font-weight:900; color:#b45309;">${productionNumber(row.pendingQty).toLocaleString("en-IN")}</td><td>${productionDisplayDate(row.saved?.startDate)}</td><td>${productionDisplayDate(row.saved?.customerTargetDispatchDate || row.saved?.tentativeDispatchDate)}</td></tr>`;
    });
    if (periodSummary) {
      periodSummary.style.display = "grid";
      periodSummary.innerHTML = `<div><span>Running POs</span><strong>${running.length.toLocaleString("en-IN")}</strong><small>Currently in production</small></div><div><span>Upcoming POs</span><strong>${upcoming.length.toLocaleString("en-IN")}</strong><small>Scheduled production orders</small></div><div><span>Hold POs</span><strong style="color:#dc2626;">${hold.length.toLocaleString("en-IN")}</strong><small>Production currently stopped</small></div>`;
    }
  } else if (type === "planned") {
    title = "Planned Quantity by Production PO";
    subtitle = "All Production Orders contributing to the production plan.";
    headings = ["PO Number", "Model / Watt", "Production Status", "Planned Qty.", "Start Date", "End Date", "Customer Qty."];
    records = allRows.filter(row => Number(row.poQty || 0) > 0).sort((a, b) => Number(b.poQty || 0) - Number(a.poQty || 0));
    rows = records.map(row => `<tr><td><strong>${productionEsc(row.poNumber)}</strong></td><td>${productionEsc(row.model || "-")} / ${productionEsc(row.watt || "-")}</td><td>${productionEsc(row.productionStatus || "-")}</td><td style="font-weight:900;">${Number(row.poQty || 0).toLocaleString("en-IN")}</td><td>${productionDisplayDate(row.saved?.startDate)}</td><td>${productionDisplayDate(row.saved?.endDate)}</td><td>${Number(row.customerQty || 0).toLocaleString("en-IN")}</td></tr>`);
  } else if (type === "produced") {
    title = "Produced Quantity by Production PO";
    subtitle = "PO-wise production completed till date with completion progress.";
    headings = ["PO Number", "Model / Watt", "Status", "Planned", "Produced", "Pending", "Completion", "Latest Update"];
    records = allRows.filter(row => Number(row.daily?.qty || 0) > 0).sort((a, b) => Number(b.daily?.qty || 0) - Number(a.daily?.qty || 0));
    rows = records.map(row => {
      const progress = Number(row.poQty || 0) > 0 ? Math.min(100, Math.round(Number(row.daily?.qty || 0) / Number(row.poQty || 0) * 100)) : 0;
      return `<tr><td><strong>${productionEsc(row.poNumber)}</strong></td><td>${productionEsc(row.model || "-")} / ${productionEsc(row.watt || "-")}</td><td>${productionEsc(row.productionStatus || "-")}</td><td>${Number(row.poQty || 0).toLocaleString("en-IN")}</td><td style="font-weight:900; color:#7c3aed;">${Number(row.daily?.qty || 0).toLocaleString("en-IN")}</td><td>${Number(row.pendingQty || 0).toLocaleString("en-IN")}</td><td><strong>${progress}%</strong></td><td>${productionDisplayDate(row.daily?.latest?.date)}</td></tr>`;
    });
  } else if (type === "pending") {
    title = "Pending Production by PO";
    subtitle = "Remaining modules and production status for every incomplete PO.";
    headings = ["PO Number", "Model / Watt", "Status", "Planned", "Produced", "Pending", "Target Dispatch", "Packing Status"];
    records = allRows.filter(row => Number(row.pendingQty || 0) > 0).sort((a, b) => Number(b.pendingQty || 0) - Number(a.pendingQty || 0));
    rows = records.map(row => `<tr><td><strong>${productionEsc(row.poNumber)}</strong></td><td>${productionEsc(row.model || "-")} / ${productionEsc(row.watt || "-")}</td><td>${productionEsc(row.productionStatus || "-")}</td><td>${Number(row.poQty || 0).toLocaleString("en-IN")}</td><td>${Number(row.daily?.qty || 0).toLocaleString("en-IN")}</td><td style="font-weight:900; color:#b45309;">${Number(row.pendingQty || 0).toLocaleString("en-IN")}</td><td>${productionDisplayDate(row.saved?.customerTargetDispatchDate || row.saved?.tentativeDispatchDate)}</td><td>${productionEsc(row.packingStatus || "-")}</td></tr>`);
  } else if (type === "fg") {
    title = "FG Warehouse Stock by PO";
    subtitle = "Finished goods physically available in the warehouse, split by grade.";
    headings = ["PO Number", "Model / Watt", "Packing Status", "FG Available", "Grade A", "Grade B", "Grade R", "Produced"];
    records = allRows.filter(row => Number(row.live?.warehouse?.total || 0) > 0).sort((a, b) => Number(b.live?.warehouse?.total || 0) - Number(a.live?.warehouse?.total || 0));
    rows = records.map(row => `<tr><td><strong>${productionEsc(row.poNumber)}</strong></td><td>${productionEsc(row.model || "-")} / ${productionEsc(row.watt || "-")}</td><td>${productionEsc(row.packingStatus || "-")}</td><td style="font-weight:900; color:#059669;">${Number(row.live?.warehouse?.total || 0).toLocaleString("en-IN")}</td><td>${Number(row.live?.warehouse?.a || 0).toLocaleString("en-IN")}</td><td>${Number(row.live?.warehouse?.b || 0).toLocaleString("en-IN")}</td><td>${Number(row.live?.warehouse?.r || 0).toLocaleString("en-IN")}</td><td>${Number(row.daily?.qty || 0).toLocaleString("en-IN")}</td></tr>`);
  } else {
    const today = productionToday();
    const monthKey = today.slice(0, 7);
    const dispatchRecords = (dispatchArchive || []).map(manifest => ({ ...manifest, __ymd: reportHubYmd(manifest.createdAt || manifest.dispatchedAt || manifest.date) }));
    const dailyDispatches = dispatchRecords.filter(manifest => manifest.__ymd === today);
    const monthlyDispatches = dispatchRecords.filter(manifest => manifest.__ymd.startsWith(monthKey));
    const todayQty = dailyDispatches.reduce((sum, manifest) => sum + productionNumber(manifest.dispatchedQty), 0);
    const monthQty = monthlyDispatches.reduce((sum, manifest) => sum + productionNumber(manifest.dispatchedQty), 0);
    const tillDateQty = dispatchRecords.reduce((sum, manifest) => sum + productionNumber(manifest.dispatchedQty), 0);
    title = "Dispatch Summary";
    subtitle = "Daily, current-month and cumulative dispatched module quantity from saved Packing Lists.";
    headings = ["Dispatch Date", "Invoice", "CO Number", "Customer", "Vehicle", "Qty.", "Pallets", "Challan"];
    records = dispatchRecords.sort((a, b) => productionText(b.__ymd).localeCompare(productionText(a.__ymd)) || productionText(b.createdAt).localeCompare(productionText(a.createdAt)));
    rows = records.map(manifest => `<tr><td><strong>${productionEsc(reportHubDisplayDate(manifest.createdAt || manifest.dispatchedAt || manifest.date))}</strong></td><td><strong>${productionEsc(manifest.invoice || "-")}</strong></td><td>${productionEsc(manifest.coNumber || "-")}</td><td>${productionEsc(manifest.customer || "-")}</td><td>${productionEsc(manifest.vehicle || "-")}</td><td style="font-weight:900; color:#7c3aed;">${productionNumber(manifest.dispatchedQty).toLocaleString("en-IN")}</td><td>${Number((manifest.pallets || []).length).toLocaleString("en-IN")}</td><td>${productionEsc(manifest.challanNo || "-")}</td></tr>`);
    if (periodSummary) {
      periodSummary.style.display = "grid";
      periodSummary.innerHTML = `<div><span>Daily Dispatch</span><strong>${todayQty.toLocaleString("en-IN")}</strong><small>${productionDisplayDate(today)} · Modules</small></div><div><span>Monthly Dispatch</span><strong>${monthQty.toLocaleString("en-IN")}</strong><small>${new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" })} · Modules</small></div><div><span>Till-Date Dispatch</span><strong>${tillDateQty.toLocaleString("en-IN")}</strong><small>All saved dispatches · Modules</small></div>`;
    }
  }

  dashboardSetText("productionDashDetailTitle", title);
  dashboardSetText("productionDashDetailSubtitle", subtitle);
  dashboardSetText("productionDashDetailCount", type === "maintenance"
    ? "COMING SOON"
    : type === "production"
    ? `${records.length.toLocaleString("en-IN")} ${records.length === 1 ? "UPDATE" : "UPDATES"}`
    : type === "dispatched"
      ? `${records.length.toLocaleString("en-IN")} ${records.length === 1 ? "DISPATCH" : "DISPATCHES"}`
      : `${records.length.toLocaleString("en-IN")} ${records.length === 1 ? "PO" : "POs"}`);
  head.innerHTML = headings.map(label => `<th>${productionEsc(label)}</th>`).join("");
  const filterHead = document.getElementById("productionDashDetailFilterHead");
  const clearFiltersButton = document.getElementById("productionDashClearFilters");
  if (filterHead) {
    const showFilters = type === "production";
    const display = showFilters ? "table-row" : "none";
    if (filterHead.style.display !== display) filterHead.style.display = display;
    const filterSignature = showFilters ? headings.join("|") : "";
    if (filterHead.dataset.filterSignature !== filterSignature) {
      filterHead.innerHTML = showFilters ? headings.map((label,index) => `<th><input class="production-column-filter" data-production-filter="${index}" aria-label="Filter ${productionEsc(label)}" placeholder="Filter" value="${productionDashboardColumnFilters[index] ? productionEsc(productionDashboardColumnFilters[index]) : ""}" oninput="updateProductionDashboardColumnFilter(this)"></th>`).join("") : "";
      filterHead.dataset.filterSignature = filterSignature;
    }
  }
  if (clearFiltersButton) clearFiltersButton.style.display = type === "production" && Object.keys(productionDashboardColumnFilters).length ? "inline-flex" : "none";
  body.innerHTML = rows.length ? rows.join("") : `<tr><td colspan="${headings.length}" style="text-align:center; padding:24px; color:var(--muted);">No Production Order records are available for this section.</td></tr>`;
};

window.renderProductionDashboard = function() {
  const rows = (productionSheetDb || []).map(record => getProductionRow(record.poNumber));
  const planned = rows.reduce((sum, row) => sum + Number(row.poQty || 0), 0);
  const produced = rows.reduce((sum, row) => sum + Number(row.daily?.qty || 0), 0);
  const pending = rows.reduce((sum, row) => sum + Number(row.pendingQty || 0), 0);
  const fg = rows.reduce((sum, row) => sum + Number(row.live?.warehouse?.total || 0), 0);
  const dispatched = rows.reduce((sum, row) => sum + Number(row.live?.dispatched?.total || 0), 0);
  const productionOrderCount = rows.filter(row => ["RUNNING", "UPCOMING", "HOLD"].includes(productionText(row.productionStatus).toUpperCase())).length;
  const completion = planned > 0 ? Math.min(100, Math.round(produced / planned * 100)) : 0;
  const todayProduced = (productionDailyDb || []).filter(record => productionText(record.date) === productionToday()).reduce((sum, record) => sum + productionNumber(record.productionQty), 0);
  const todayDispatched = (dispatchArchive || []).filter(manifest => reportHubYmd(manifest.createdAt || manifest.dispatchedAt || manifest.date) === productionToday()).reduce((sum, manifest) => sum + productionNumber(manifest.dispatchedQty), 0);
  dashboardSetText("productionDashToday", todayProduced.toLocaleString("en-IN"));
  dashboardSetText("productionDashDispatchToday", todayDispatched.toLocaleString("en-IN"));
  dashboardSetText("productionDashOrderCount", productionOrderCount.toLocaleString("en-IN"));
  dashboardSetText("productionDashPlanned", planned.toLocaleString("en-IN"));
  dashboardSetText("productionDashProduced", produced.toLocaleString("en-IN"));
  dashboardSetText("productionDashPending", pending.toLocaleString("en-IN"));
  dashboardSetText("productionDashFg", fg.toLocaleString("en-IN"));
  dashboardSetText("productionDashDispatched", dispatched.toLocaleString("en-IN"));
  dashboardSetText("productionDashCompletion", `${completion}% completion`);
  dashboardSetText("productionDashProgressRate", `${completion}%`);
  dashboardSetText("productionDashProgressCaption", `${produced.toLocaleString("en-IN")} of ${planned.toLocaleString("en-IN")} modules`);
  const progressBar = document.getElementById("productionDashProgressBar");
  if (progressBar) dashboardSetStyle(progressBar, "width", `${completion}%`);

  const activeBody = document.getElementById("productionDashActiveOrders");
  if (activeBody) {
    const activeRows = rows.filter(row => String(row.productionStatus || "").toUpperCase() !== "CLOSED").slice(0, 12);
    dashboardSetHtml(activeBody, activeRows.length ? activeRows.map(row => {
      const rowProgress = row.poQty > 0 ? Math.min(100, Math.round(Number(row.daily?.qty || 0) / row.poQty * 100)) : 0;
      const status = String(row.productionStatus || "PRODUCTION NOT STARTED").toUpperCase();
      const statusColor = status === "RUNNING" ? "#059669" : status === "HOLD" ? "#dc2626" : status === "NEXT PO" ? "#7c3aed" : "#64748b";
      return `<tr><td><strong>${productionEsc(row.poNumber)}</strong></td><td>${productionEsc(row.model || "-")}<div style="color:var(--muted); margin-top:2px;">${productionEsc(row.watt || "-")}</div></td><td style="font-weight:800; color:${statusColor};">${productionEsc(status)}</td><td>${Number(row.poQty || 0).toLocaleString("en-IN")}</td><td style="font-weight:800; color:#7c3aed;">${Number(row.daily?.qty || 0).toLocaleString("en-IN")}</td><td style="font-weight:800; color:#b45309;">${Number(row.pendingQty || 0).toLocaleString("en-IN")}</td><td style="min-width:120px;"><div class="dept-progress"><span style="width:${rowProgress}%;"></span></div><div style="font-size:9px; margin-top:4px; color:#64748b;">${rowProgress}%</div></td></tr>`;
    }).join("") : '<tr><td colspan="7" style="text-align:center; padding:22px; color:var(--muted);">No active production orders available.</td></tr>');
  }

  const statusCounts = new Map();
  rows.forEach(row => {
    const status = String(row.productionStatus || "PRODUCTION NOT STARTED").toUpperCase();
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
  });
  const statusBox = document.getElementById("productionDashStatuses");
  const maxStatus = Math.max(1, ...statusCounts.values());
  if (statusBox) dashboardSetHtml(statusBox, statusCounts.size ? [...statusCounts.entries()].map(([status, count]) => `<div class="dept-status-row"><span style="font-weight:700;">${productionEsc(status)}</span><div class="dept-progress"><span style="width:${count / maxStatus * 100}%;"></span></div><b>${count}</b></div>`).join("") : '<div style="padding:16px; text-align:center; color:var(--muted); font-size:11px;">No production status available.</div>');
  const qualityRows = rows.map(row => row.daily?.latest).filter(Boolean);
  const average = field => qualityRows.length ? qualityRows.reduce((sum, row) => sum + Number(row[field] || 0), 0) / qualityRows.length : 0;
  dashboardSetText("productionDashCellReject", `${average("cellRejectionPct").toFixed(2)}%`);
  dashboardSetText("productionDashModuleReject", `${average("moduleRejectionPct").toFixed(2)}%`);
  window.renderProductionDashboardDetail?.();
};
