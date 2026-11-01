let accountInvoiceDispatchRepairInFlight = null;
async function reconcileAccountInvoiceDispatchStatus() {
  if (accountInvoiceDispatchRepairInFlight) return accountInvoiceDispatchRepairInFlight;
  let changed = false;
  for (const invoice of accountInvoices || []) {
    if (String(invoice.status || "").trim().toUpperCase() !== "DISPATCHED") continue;
    const invoiceId = String(invoice.id || "");
    const invoiceNumber = accountInvoiceKey(invoice.invoiceNumber);
    const activeManifest = (dispatchArchive || []).some(manifest =>
      (invoiceId && String(manifest.accountInvoiceId || "") === invoiceId)
      || (invoiceNumber && accountInvoiceKey(manifest.invoice) === invoiceNumber)
    );
    if (activeManifest) continue;
    invoice.status = "READY FOR DISPATCH";
    invoice.dispatchId = "";
    invoice.dispatchedAt = "";
    invoice.dispatchedBy = "";
    changed = true;
  }
  if (!changed) return true;
  accountInvoiceDispatchRepairInFlight = (async () => {
    const saved = await saveStorage(KEY_ACCOUNT_INVOICES, accountInvoices);
    if (saved === false) return false;
    window.renderAccountInvoiceTable?.();
    window.populateDeleteInvoiceSelect?.();
    return true;
  })();
  try {
    return await accountInvoiceDispatchRepairInFlight;
  } finally {
    accountInvoiceDispatchRepairInFlight = null;
  }
}

function populateDispatchInvoiceDropdown(selectedCoNumber = null) {
  const select = document.getElementById("dAccountInvoiceSelect");
  if (!select) return;
  // Old approvals could remove the manifest but leave the invoice marked DISPATCHED.
  void reconcileAccountInvoiceDispatchStatus();
  const current = select.value;
  const coNumber = String(selectedCoNumber ?? document.getElementById("dCoSelect")?.value ?? "").trim();
  if (!coNumber) {
    select.innerHTML = `<option value="">-- Select C/O Number First --</option>`;
    select.disabled = true;
    return;
  }
  const ready = (accountInvoices || []).filter(invoice =>
    salesCoKey(invoice.coNumber) === salesCoKey(coNumber)
    && !(dispatchArchive || []).some(item => accountInvoiceKey(item.invoice) === accountInvoiceKey(invoice.invoiceNumber))
  );
  select.innerHTML = `<option value="">${ready.length ? "-- Select Invoice for this C/O --" : "-- No Undispatched Invoice for this C/O --"}</option>` + ready.map(invoice =>
    `<option value="${escapeSalesHtml(invoice.invoiceNumber)}">${escapeSalesHtml(invoice.invoiceNumber)} — ${salesNumber(invoice.quantity).toLocaleString("en-IN")} modules — ${escapeSalesHtml(invoice.invoiceDate || "")}</option>`
  ).join("");
  select.disabled = ready.length === 0;
  if (ready.some(invoice => invoice.invoiceNumber === current)) select.value = current;
}

window.handleDispatchInvoiceChange = function() {
  const invoice = getAccountInvoiceByNumber(document.getElementById("dAccountInvoiceSelect")?.value || "");
  const selectedCoNumber = String(document.getElementById("dCoSelect")?.value || "").trim();
  const summary = document.getElementById("dCoSummary");
  if (!invoice || salesCoKey(invoice.coNumber) !== salesCoKey(selectedCoNumber)) {
    ["dtTransporter", "dtVehicle", "dtChallan", "dtDate", "dtDriverNo", "dtDriverName", "dtModeTransport", "dtDeliveryOrder", "dtLrNo", "dtCustomer", "dtPackingType", "dtInvoice", "dtHsnCode", "dOrderQty"].forEach(id => accountSetValue(id));
    if (summary) summary.textContent = selectedCoNumber ? `C/O ${selectedCoNumber} selected. Now select an invoice created against this C/O.` : "Select the C/O Number first.";
    updateChallanPreview();
    return;
  }
  const salesOrder = getSalesOrderByCo(invoice.coNumber);
  accountSetValue("dOrderQty", invoice.quantity);
  accountSetValue("dtTransporter", invoice.transporterName);
  accountSetValue("dtVehicle", invoice.vehicleNumber);
  accountSetValue("dtChallan", invoice.challanNo);
  accountSetValue("dtDate", invoice.invoiceDate);
  accountSetValue("dtDriverNo", "");
  accountSetValue("dtDriverName", "");
  accountSetValue("dtModeTransport", invoice.modeTransport || "By Road");
  accountSetValue("dtDeliveryOrder", invoice.deliveryOrderNo);
  accountSetValue("dtLrNo", invoice.lrNo);
  accountSetValue("dtCustomer", salesOrder?.customerName || invoice.customerName);
  accountSetValue("dtPackingType", invoice.packingType || "Box Packing");
  accountSetValue("dtInvoice", invoice.invoiceNumber);
  accountSetValue("dtHsnCode", invoice.hsnCode || "85414300");
  const productCell = document.getElementById("cProduct");
  const typeCell = document.getElementById("cProductTypeCell");
  if (productCell) productCell.textContent = salesOrder?.modelNo || invoice.modelNo || "-";
  if (typeCell) typeCell.textContent = salesOrder?.dcrNdcr || invoice.dcrNdcr || "NON - DCR";
  if (summary) summary.innerHTML = `<strong>${escapeSalesHtml(salesOrder?.customerName || invoice.customerName)}</strong> | C/O: <strong>${escapeSalesHtml(invoice.coNumber)}</strong> | Sales Model: <strong>${escapeSalesHtml(salesOrder?.modelNo || invoice.modelNo || "-")}</strong> | Invoice Qty: <strong>${salesNumber(invoice.quantity).toLocaleString("en-IN")}</strong> | Vehicle: <strong>${escapeSalesHtml(invoice.vehicleNumber)}</strong> <span style="color:#b45309;">— Enter Driver Name and Number manually.</span>`;
  const poSelect = document.getElementById("dPoSelect");
  if (poSelect) poSelect.value = "";
  populateReadyPalletsDropdown("");
  updateChallanPreview();
};

function populateDispatchCoDropdown() {
  const select = document.getElementById("dCoSelect");
  if (!select) return;
  const current = select.value;
  const dispatchableOrders = (salesOrders || []).filter(order => {
    const stats = getSalesOrderDispatchStats(order.coNumber);
    return String(order.status || "").toUpperCase() !== "CLOSED" && salesNumber(order.totalOrderQty) > stats.qty;
  });
  select.innerHTML = `<option value="">${dispatchableOrders.length ? "-- Select CO Number (Mandatory) --" : "-- No Sales Orders with Pending Qty --"}</option>` +
    dispatchableOrders.map(order => {
      const stats = getSalesOrderDispatchStats(order.coNumber);
      const pending = Math.max(0, salesNumber(order.totalOrderQty) - stats.qty);
      return `<option value="${escapeSalesHtml(order.coNumber)}">${escapeSalesHtml(order.coNumber)} — ${escapeSalesHtml(order.customerName)} (${pending} pending)</option>`;
    }).join("");
  if (dispatchableOrders.some(order => order.coNumber === current)) select.value = current;
}

window.handleDispatchCoChange = function() {
  const coNumber = String(document.getElementById("dCoSelect")?.value || "").trim();
  const summary = document.getElementById("dCoSummary");
  const invoiceSelect = document.getElementById("dAccountInvoiceSelect");
  if (invoiceSelect) invoiceSelect.value = "";
  populateDispatchInvoiceDropdown(coNumber);
  ["dtTransporter", "dtVehicle", "dtChallan", "dtDate", "dtDriverNo", "dtDriverName", "dtModeTransport", "dtDeliveryOrder", "dtLrNo", "dtCustomer", "dtPackingType", "dtInvoice", "dtHsnCode", "dOrderQty"].forEach(id => accountSetValue(id));
  if (!coNumber) {
    if (summary) summary.textContent = "Select the C/O Number first. The Invoice dropdown will then show only invoices created against that C/O.";
    updateChallanPreview();
    return;
  }
  const order = getSalesOrderByCo(coNumber);
  if (!order) return;
  const stats = getSalesOrderDispatchStats(order.coNumber);
  const pending = Math.max(0, salesNumber(order.totalOrderQty) - stats.qty);
  const poSelect = document.getElementById("dPoSelect");
  if (poSelect) poSelect.value = "";
  const matchingInvoices = [...(invoiceSelect?.options || [])].filter(option => option.value).length;
  if (summary) summary.innerHTML = `<strong>${escapeSalesHtml(order.customerName)}</strong> | C/O: <strong>${escapeSalesHtml(order.coNumber)}</strong> | Pending: <strong style="color:#b45309;">${pending}</strong> | <strong>${matchingInvoices}</strong> invoice(s) ready — now select the invoice.`;
  handlePoChange();
  const productCell = document.getElementById("cProduct");
  const typeCell = document.getElementById("cProductTypeCell");
  if (productCell) productCell.textContent = order.modelNo || "-";
  if (typeCell) typeCell.textContent = order.dcrNdcr || "NON - DCR";
  updateChallanPreview();
};

function resetScanPalletizeStation() {
  activeSerials = [];
  activePalletPo = "";
  document.getElementById("pPalletNoInput").value = "";
  const gradeSelect = document.getElementById("pGradeSelect");
  gradeSelect.value = "A GRADE";
  gradeSelect.disabled = false;
  document.getElementById("pBinningSelect").value = "";
  const binningStatus = document.getElementById("pBinningStatus");
  if (binningStatus) binningStatus.value = "NO BINNING";
  const packQty = document.getElementById("pPackQty");
  if (packQty) {
    packQty.value = "36";
    packQty.disabled = false;
  }
  activeMaxCapacity = 36;
  const bulkFile = document.getElementById("packingBulkExcelFile");
  if (bulkFile) bulkFile.value = "";
  const bulkText = document.getElementById("packingBulkPasteText");
  if (bulkText) bulkText.value = "";
  parsedPackingBulkSerials = [];

  populateScanStationPoDropdown();
  populatePackingModelDropdown();
  applyPackingFormatRules("");
  updatePackingPrintFormatNotice("");

  const pWattSel = document.getElementById("pWattSelect");
  pWattSel.disabled = false;
  const poSelect = document.getElementById("pPoSelectStation");
  const modelSelect = document.getElementById("pModelSelect");
  if (poSelect) poSelect.disabled = false;
  if (modelSelect) modelSelect.disabled = false;
  activeLockedWatt = pWattSel.value;

  const gun = document.getElementById("gunInput");
  gun.value = "";
  gun.disabled = true;
  gun.placeholder = "Enter Pallet No to unlock scanner...";

  document.getElementById("btnSealPallet").disabled = true;

  updatePalletMetaPreview();
  renderPalletSheetRows();
}

function populateScanStationPoDropdown() {
  const sel = document.getElementById("pPoSelectStation");
  if (!sel) return;
  const previousPo = String(sel.value || activePalletPo || "").trim();
  if (poDatabase.length === 0) { sel.innerHTML = `<option value="">-- No POs Created in Store & PPC --</option>`; return; }
  sel.innerHTML = `<option value="">-- Auto-detected from Serial or Select PO --</option>` + poDatabase.map(p => `
    <option value="${p.poNumber}">${p.poNumber} (${p.watt} - ${p.qty} modules)</option>
  `).join("");
  if (previousPo && [...sel.options].some(option => normalizePackingId(option.value) === normalizePackingId(previousPo))) {
    sel.value = [...sel.options].find(option => normalizePackingId(option.value) === normalizePackingId(previousPo)).value;
  }
}

function getPoPrintFormat(poNumber) {
  return getPoRecord(poNumber)?.printFormat === "DEMOOEM" ? "DEMOOEM" : "DEMOSOLAR";
}

function packingIdentityForPo(poNumber) {
  const po = getPoRecord(poNumber);
  if (!po) return null;
  const model = getPoPackingModel(po) || String(po.product || "").trim();
  const wattNumber = getWattNumber(po.watt);
  const product = (productsDb || []).find(item =>
    String(item.name || "").trim() === model ||
    (getWattNumber(item.watt) === wattNumber && String(item.name || "").trim() === model)
  );
  return {
    poNumber: String(po.poNumber || poNumber).trim(),
    model,
    wattNumber,
    wattLabel: String(product?.watt || po.watt || "").trim(),
    printFormat: getPoPrintFormat(po.poNumber || poNumber)
  };
}

function ensurePackingWattOption(wattLabel) {
  const select = document.getElementById("pWattSelect");
  if (!select || !wattLabel) return;
  const wattNumber = getWattNumber(wattLabel);
  let option = Array.from(select.options).find(item => getWattNumber(item.value) === wattNumber);
  if (!option) {
    option = document.createElement("option");
    option.value = wattLabel;
    option.textContent = wattLabel;
    select.appendChild(option);
  }
  select.value = option.value;
}

function lockPackingIdentity() {
  if (!activeSerials.length) return;
  ["pPoSelectStation", "pModelSelect", "pWattSelect", "pPackQty"].forEach(id => {
    const control = document.getElementById(id);
    if (control) control.disabled = true;
  });
}

function applyFirstSerialPackingIdentity(poNumber) {
  const identity = packingIdentityForPo(poNumber);
  if (!identity) return null;
  const poSelect = document.getElementById("pPoSelectStation");
  const modelSelect = document.getElementById("pModelSelect");
  if (poSelect && Array.from(poSelect.options).some(option => String(option.value) === identity.poNumber)) poSelect.value = identity.poNumber;
  activePalletPo = identity.poNumber;
  applyPackingFormatRules(identity.poNumber);
  updatePackingPrintFormatNotice(identity.poNumber);
  populatePackingModelDropdown();
  if (modelSelect && Array.from(modelSelect.options).some(option => String(option.value) === identity.model)) modelSelect.value = identity.model;
  ensurePackingWattOption(identity.wattLabel);
  onModelTypeChange();
  onWattSelectChange();
  return identity;
}

function arePackingPosCompatible(firstPo, candidatePo) {
  if (!firstPo || normalizePackingId(firstPo) === normalizePackingId(candidatePo)) return { ok: true };
  const first = packingIdentityForPo(firstPo);
  const candidate = packingIdentityForPo(candidatePo);
  if (!first || !candidate) return { ok: false, message: "The PO linked to this serial is missing from Store & PPC." };
  if (first.wattNumber !== candidate.wattNumber || first.model !== candidate.model || first.printFormat !== candidate.printFormat) {
    return { ok: false, message: `This serial belongs to PO ${candidate.poNumber} (${candidate.model}, ${candidate.wattLabel}, ${candidate.printFormat}), which does not match the first serial's PO ${first.poNumber}.` };
  }
  return { ok: true };
}

function isCompatibleWithFirstSerialPo(candidatePo) {
  return arePackingPosCompatible(activeSerials[0]?.po, candidatePo);
}

function applyPackingFormatRules(poNumber) {
  const isDemoOem = getPoPrintFormat(poNumber) === "DEMOOEM";
  const binningGroup = document.getElementById("pBinningGroup");
  const binningSelect = document.getElementById("pBinningSelect");
  if (!binningSelect) return;

  if (isPackingNoBinning()) {
    if (binningGroup) binningGroup.style.display = "none";
    binningSelect.value = "";
    binningSelect.disabled = true;
    return;
  }
  if (binningGroup) binningGroup.style.display = "block";

  // Binning is mandatory for both formats, but each customer has its own
  // approved bin names. Rebuild the list whenever the PO format changes so
  // an I-bin can never be selected for DemoOem, or a B-bin for DemoSolar.
  const previousValue = binningSelect.value;
  const values = isDemoOem
    ? ["570-571.99 (B1)", "572-573.99 (B2)", "574-575 (B3)", "MIX"]
    : ["I1", "I2", "I3", "MIX"];
  binningSelect.innerHTML = `<option value="">-- Select Binning --</option>` +
    values.map(value => `<option value="${value}">${value}</option>`).join("");
  binningSelect.disabled = false;
  binningSelect.value = values.includes(previousValue) ? previousValue : "";
}

function getSelectedPackingBinning() {
  if (isPackingNoBinning()) return "NO BINNING";
  const select = document.getElementById("pBinningSelect");
  if (!select) return "";
  const selectedOption = select.options?.[select.selectedIndex];
  return String(selectedOption?.value ?? select.value ?? "").trim();
}

function isPackingNoBinning() {
  return (document.getElementById("pBinningStatus")?.value || "NO BINNING") === "NO BINNING";
}

window.onPackingBinningStatusChange = function() {
  const poNumber = activePalletPo || document.getElementById("pPoSelectStation")?.value || activeSerials[0]?.po || "";
  applyPackingFormatRules(poNumber);
  updatePackingPrintFormatNotice(poNumber);
  updatePalletMetaPreview();
};

function updatePackingPrintFormatNotice(poNumber) {
  const notice = document.getElementById("pPrintFormatNotice");
  if (!notice) return;
  if (!poNumber) {
    notice.textContent = "STICKER FORMAT: Select a PO to fetch its print format automatically.";
    notice.style.background = "#effbf6";
    notice.style.borderColor = "#9ae6b4";
    notice.style.color = "#047857";
    return;
  }
  const format = getPoPrintFormat(poNumber);
  notice.textContent = isPackingNoBinning()
    ? `STICKER FORMAT: ${format === "DEMOOEM" ? "DemoOem OEM" : "DemoSolar"} Packing Sticker (PO ${poNumber}). NO BINNING selected; binning will not appear on the print.`
    : (format === "DEMOOEM"
      ? `STICKER FORMAT: DemoOem OEM Packing Sticker (PO ${poNumber}). Select DemoOem binning: 570-571.99 (B1), 572-573.99 (B2), 574-575 (B3), or MIX.`
      : `STICKER FORMAT: DemoSolar Packing Sticker (PO ${poNumber}). Select DemoSolar binning: I1, I2, I3, or MIX.`);
  notice.style.background = format === "DEMOOEM" ? "#f8fafc" : "#effbf6";
  notice.style.borderColor = format === "DEMOOEM" ? "#94a3b8" : "#9ae6b4";
  notice.style.color = format === "DEMOOEM" ? "#1e293b" : "#047857";
}

window.onSelectPoStation = function() {
  const poNum = document.getElementById("pPoSelectStation").value;
  const firstScannedPo = activeSerials[0]?.po;
  if (firstScannedPo && normalizePackingId(poNum) !== normalizePackingId(firstScannedPo)) {
    const select = document.getElementById("pPoSelectStation");
    select.value = firstScannedPo;
    window.showNotification({ title: "PO Locked", message: "The first scanned serial controls the PO, model, wattage, and sticker format for this pallet.", type: "warning" });
    return;
  }
  if (!poNum) {
    activePalletPo = "";
    applyPackingFormatRules("");
    updatePackingPrintFormatNotice("");
    return;
  }
  
  // Set active PO
  activePalletPo = poNum;

  const po = poDatabase.find(p => p.poNumber === poNum);
  if (!po) return;
  applyPackingFormatRules(poNum);
  updatePackingPrintFormatNotice(poNum);

  // Refresh the model list when a PO is selected so newly edited Product Master
  // names are used immediately instead of leaving the previous model on screen.
  populatePackingModelDropdown();
  const modelSel = document.getElementById("pModelSelect");
  const packingModel = getPoPackingModel(po);
  if (Array.from(modelSel.options).some(option => option.value === packingModel)) {
    modelSel.value = packingModel;
  }
  onModelTypeChange();

  const wattSel = document.getElementById("pWattSelect");
  const wattTrimmed = po.watt.toLowerCase().replace("watt", "w").trim();
  Array.from(wattSel.options).forEach(opt => {
    if (opt.value.toLowerCase().includes(wattTrimmed)) wattSel.value = opt.value;
  });
  onWattSelectChange();
};

function populatePackingModelDropdown() {
  const sel = document.getElementById("pModelSelect");
  if (!sel) return;
  if (productsDb.length === 0) { sel.innerHTML = `<option value="">-- No Products in Master Catalog --</option>`; return; }
  const uniqueModels = [...new Map(productsDb.map(product => [String(product.name || "").trim(), product])).values()]
    .filter(product => product.name);
  sel.innerHTML = uniqueModels.map(product => `<option value="${product.name}">${product.name}</option>`).join("");
  onModelTypeChange();
}

window.onModelTypeChange = function() {
  activeMaxCapacity = getSelectedPackingCapacity();

  document.getElementById("cellModelType").textContent = document.getElementById("pModelSelect")?.value || "-";
  document.getElementById("cellCapacityQty").textContent = `QTY - ${activeMaxCapacity}`;
  renderPalletSheetRows();
};

function getSelectedPackingCapacity() {
  const input = document.getElementById("pPackQty");
  const requested = Math.trunc(Number(input?.value || 36));
  return Math.min(36, Math.max(1, Number.isFinite(requested) ? requested : 36));
}

window.onPackingQuantityChange = function() {
  const input = document.getElementById("pPackQty");
  if (!input) return;
  const requested = getSelectedPackingCapacity();
  if (activeSerials.length > requested) {
    input.value = String(activeMaxCapacity);
    window.showNotification({ title: "Quantity Locked", message: `The selected quantity cannot be lower than the ${activeSerials.length} modules already scanned.`, type: "warning" });
    return;
  }
  activeMaxCapacity = requested;
  input.value = String(requested);
  document.getElementById("cellCapacityQty").textContent = `QTY - ${activeMaxCapacity}`;
  const gun = document.getElementById("gunInput");
  if (gun && !gun.disabled) gun.placeholder = `Ready: Scan barcode with gun (1 to ${activeMaxCapacity}) ⏎`;
  renderPalletSheetRows();
};

window.onWattSelectChange = function() {
  activeLockedWatt = document.getElementById("pWattSelect").value;
  renderPalletSheetRows();
};

window.onPalletNoInput = function() {
  const raw = document.getElementById("pPalletNoInput").value.trim().toUpperCase();
  const gun = document.getElementById("gunInput");
  if (!raw) {
    gun.disabled = true;
    gun.placeholder = "Enter Pallet No to unlock scanner...";
  } else {
    gun.disabled = false;
    gun.placeholder = `Ready: Scan barcode with gun (1 to ${activeMaxCapacity}) ⏎`;
  }
  updatePalletMetaPreview();
  renderPalletSheetRows();
};

window.updatePalletMetaPreview = function() {
  const palletRaw = document.getElementById("pPalletNoInput").value.trim().toUpperCase();
  const grade = document.getElementById("pGradeSelect").value;
  const binning = document.getElementById("pBinningSelect").value;
  document.getElementById("cellPalletNo").textContent = palletRaw || "-";
  document.getElementById("cellCombinedPalletGrade").textContent = palletRaw ? `*${palletRaw.replace(/\s+/g, '')}${grade.replace(/\s+/g, '')}*` : "-";
  document.getElementById("cellGradeOnly").textContent = grade;
  const showBinning = binning && binning !== "NO BINNING";
  document.getElementById("cellBinningLabel").textContent = showBinning ? "BINNING" : "";
  document.getElementById("cellBinning").textContent = showBinning ? binning : "";
};

function isAGradePallet() {
  return (document.getElementById("pGradeSelect")?.value || "A GRADE").trim().toUpperCase() === "A GRADE";
}

function getActivePalletPos() {
  return new Set(activeSerials.map(item => normalizePackingId(item.po)).filter(Boolean));
}

function lockPackingGrade() {
  const gradeSelect = document.getElementById("pGradeSelect");
  if (gradeSelect && activeSerials.length > 0) gradeSelect.disabled = true;
}

window.handleBarcodeScan = function(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    const serial = e.target.value.trim().toUpperCase();
    if (!serial) return;

    const palletRaw = document.getElementById("pPalletNoInput").value.trim().toUpperCase();
    if (!palletRaw) {
      window.showNotification({ title: "Scanner Locked", message: "Please enter Pallet Number first.", type: "warning" });
      e.target.value = "";
      return;
    }

    if (activeSerials.some(item => normalizePackingId(item.serial) === serial)) {
      window.showNotification({ title: "Duplicate Scan Blocked", message: `Serial "${serial}" is already in this pallet.`, type: "danger" });
      e.target.value = "";
      return;
    }
    const previousUse = findSerialUsage(serial);
    if (previousUse) {
      window.showNotification({ title: "Serial Already Used", message: `Serial "${serial}" already belongs to pallet ${previousUse.pallet} in ${previousUse.location}.`, type: "danger" });
      e.target.value = "";
      return;
    }

    let foundStoreRecord = null;
    for (let rec of storeSerialsDb) {
      if (rec.serials.map(s => s.toUpperCase()).includes(serial)) { foundStoreRecord = rec; break; }
    }

    if (!foundStoreRecord) {
      window.showNotification({ title: "Scan Rejected", message: `Serial "${serial}" is not registered in Store & PPC database.`, type: "danger" });
      e.target.value = "";
      return;
    }

    const matchedPo = foundStoreRecord.poNumber;
    const poSelect = document.getElementById("pPoSelectStation");
    if (isAGradePallet()) {
      const existingPos = getActivePalletPos();
      const expectedPo = existingPos.values().next().value;
      if (expectedPo && expectedPo !== normalizePackingId(matchedPo)) {
        window.showNotification({ 
          title: "PO Mismatch (A-Grade)", 
          message: `A-Grade pallets may contain only one PO. Serial "${serial}" belongs to PO "${matchedPo}", not PO "${expectedPo}".`, 
          type: "danger" 
        });
        e.target.value = "";
        return;
      }
    } else {
      const compatibility = isCompatibleWithFirstSerialPo(matchedPo);
      if (!compatibility.ok) {
        window.showNotification({ title: "PO Conflict (B/R Grade)", message: compatibility.message, type: "danger" });
        e.target.value = "";
        return;
      }
    }

    const firstIdentity = activeSerials.length === 0 ? applyFirstSerialPackingIdentity(matchedPo) : packingIdentityForPo(activeSerials[0].po);
    if (!firstIdentity) {
      window.showNotification({ title: "PO Not Found", message: `PO "${matchedPo}" is not available in Store & PPC, so the pallet details cannot be fetched.`, type: "danger" });
      e.target.value = "";
      return;
    }

    if (activeSerials.length >= activeMaxCapacity) {
      window.showNotification({ title: "Capacity Reached", message: `Pallet capacity full: ${activeMaxCapacity} modules reached.`, type: "warning" });
      e.target.value = "";
      return;
    }
    activeSerials.push({ no: activeSerials.length + 1, barcode: serial, serial: serial, po: matchedPo, grade: document.getElementById("pGradeSelect").value, watt: firstIdentity.wattLabel || activeLockedWatt });
    // The first accepted PPC barcode starts packing for this PO.
    window.markProductionPackingOpen?.(matchedPo);
    lockPackingGrade();
    lockPackingIdentity();

    e.target.value = "";
    renderPalletSheetRows();

    if (activeSerials.length >= activeMaxCapacity) document.getElementById("btnSealPallet").disabled = false;
  }
};

window.handlePackingBulkExcel = function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, {type: 'array'});
      const firstSheet = workbook.SheetNames[0];
      const json = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], {header: 1});
      parsedPackingBulkSerials = json.flat().filter(cell => cell !== null && cell !== undefined && String(cell).trim() !== "").map(s => String(s).trim().toUpperCase());
      window.showNotification({ title: "Bulk File Loaded", message: `Extracted ${parsedPackingBulkSerials.length} serials. Click "Load Bulk Serials" to apply.`, type: "info" });
    } catch(err) {
      window.showNotification({ title: "Excel Error", message: "Failed parsing Excel file.", type: "danger" });
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
};

function getUniquePackingSerials(rawText) {
  const seen = new Set();
  return String(rawText || "")
    .split(/[\n,\s\r\t]+/)
    .map(serial => serial.trim().toUpperCase())
    .filter(serial => {
      if (!serial || seen.has(serial)) return false;
      seen.add(serial);
      return true;
    });
}

window.normalizePackingBulkPasteText = function() {
  const textarea = document.getElementById("packingBulkPasteText");
  if (!textarea) return [];
  const uniqueSerials = getUniquePackingSerials(textarea.value);
  textarea.value = uniqueSerials.join("\n");
  return uniqueSerials;
};

window.processPackingBulkExcel = function() {
  const palletRaw = document.getElementById("pPalletNoInput").value.trim().toUpperCase();
  if (!palletRaw) {
    window.showNotification({ title: "Input Required", message: "Please enter Pallet Number first.", type: "warning" });
    return;
  }

  const pasteText = (document.getElementById("packingBulkPasteText")?.value || "").trim();
  let serialList = [];

  if (pasteText) {
    serialList = window.normalizePackingBulkPasteText();
  } else if (parsedPackingBulkSerials.length > 0) {
    serialList = parsedPackingBulkSerials;
  } else {
    window.showNotification({ title: "Missing Data", message: "Please select an Excel file or paste serial numbers.", type: "warning" });
    return;
  }

  const availableSlots = Math.max(0, activeMaxCapacity - activeSerials.length);
  const sliceSerials = serialList.slice(0, availableSlots);
  if (sliceSerials.length === 0) {
    window.showNotification({ title: "Capacity Reached", message: `Pallet capacity is already full (${activeMaxCapacity} modules).`, type: "warning" });
    return;
  }

  let firstPoFound = "";
  const incomingSerials = new Set();
  const validatedRows = [];
  const activePos = getActivePalletPos();

  for (let serial of sliceSerials) {
    if (incomingSerials.has(serial)) {
      window.showNotification({ title: "Duplicate Bulk Serial Blocked", message: `Serial "${serial}" appears more than once in the uploaded/pasted list. Nothing further was added.`, type: "danger" });
      return;
    }
    incomingSerials.add(serial);

    let foundStoreRecord = null;
    for (let rec of storeSerialsDb) {
      if (rec.serials.map(s => s.toUpperCase()).includes(serial)) { foundStoreRecord = rec; break; }
    }

    if (!foundStoreRecord) {
      window.showNotification({ title: "Bulk Load Stopped", message: `Serial "${serial}" is not registered in Store & PPC database.`, type: "danger" });
      return;
    }

    if (activeSerials.some(item => normalizePackingId(item.serial) === serial)) {
      window.showNotification({ title: "Duplicate Bulk Serial Blocked", message: `Serial "${serial}" is already in the active pallet.`, type: "danger" });
      return;
    }
    const previousUse = findSerialUsage(serial);
    if (previousUse) {
      window.showNotification({ title: "Serial Already Used", message: `Serial "${serial}" already belongs to pallet ${previousUse.pallet} in ${previousUse.location}.`, type: "danger" });
      return;
    }

    const matchedPo = normalizePackingId(foundStoreRecord.poNumber);
    if (isAGradePallet()) {
      const expectedPo = activePos.values().next().value || firstPoFound;
      if (expectedPo && expectedPo !== matchedPo) {
        window.showNotification({ title: "PO Conflict (A-Grade)", message: `A-Grade pallets may contain only one PO. Serial "${serial}" belongs to PO "${foundStoreRecord.poNumber}", not PO "${expectedPo}". No serials were added.`, type: "danger" });
        return;
      }
    } else {
      const compatibility = arePackingPosCompatible(activeSerials[0]?.po || firstPoFound, matchedPo);
      if (!compatibility.ok) {
        window.showNotification({ title: "PO Conflict (B/R Grade)", message: `${compatibility.message} No serials were added.`, type: "danger" });
        return;
      }
    }
    if (!firstPoFound) firstPoFound = matchedPo;
    validatedRows.push({ serial, po: foundStoreRecord.poNumber });
  }

  const identity = activeSerials.length === 0 ? applyFirstSerialPackingIdentity(firstPoFound) : packingIdentityForPo(activeSerials[0]?.po);
  if (!identity) {
    window.showNotification({ title: "PO Not Found", message: `PO "${firstPoFound}" is not available in Store & PPC, so the pallet details cannot be fetched.`, type: "danger" });
    return;
  }
  validatedRows.forEach(row => {
    activeSerials.push({ no: activeSerials.length + 1, barcode: row.serial, serial: row.serial, po: row.po, grade: document.getElementById("pGradeSelect").value, watt: identity.wattLabel || activeLockedWatt });
  });
  // Bulk loading may contain compatible B/R serials from more than one PO.
  [...new Set(validatedRows.map(row => row.po))].forEach(poNumber => window.markProductionPackingOpen?.(poNumber));
  const loadedCount = validatedRows.length;

  lockPackingGrade();
  lockPackingIdentity();
  renderPalletSheetRows();

  if (activeSerials.length >= activeMaxCapacity) document.getElementById("btnSealPallet").disabled = false;
  window.showNotification({ title: "Bulk Serials Added", message: `Successfully loaded ${loadedCount} modules into pallet ${palletRaw}!`, type: "success" });
};

function renderPalletSheetRows() {
  const tbody = document.getElementById("palletSheetBody");
  if (!tbody) return;

  let html = "";
  for (let i = 1; i <= activeMaxCapacity; i++) {
    const item = activeSerials[i - 1];
    if (item) {
      html += `
        <tr style="height: 24px;">
          <td class="font-aptos-11" style="font-weight: 800;">${i}</td>
          <td style="padding: 1px 3px;"><span class="font-barcode-13">*${item.barcode.replace(/\s+/g, '')}*</span></td>
          <td class="font-aptos-11" style="font-family: monospace; font-size: 11px; font-weight: 700;">${item.serial}</td>
          <td style="padding: 1px; text-align:center; font-weight:bold;">${item.po}</td>
          <td class="font-aptos-11" style="font-weight: bold;">${item.watt}</td>
        </tr>
      `;
    } else {
      html += `
        <tr style="height: 24px; background: #fafafa; color: #94a3b8;">
          <td class="font-aptos-11" style="font-weight: 600;">${i}</td>
          <td>-</td>
          <td class="font-aptos-11" style="font-family: monospace;">[ Open Slot - Scan / Bulk Upload ]</td>
          <td style="text-align: center;">-</td>
          <td class="font-aptos-11">${activeLockedWatt}</td>
        </tr>
      `;
    }
  }
  tbody.innerHTML = html;
  // UNLOCK SEAL BUTTON WHENEVER MODULES ARE PRESENT
  const sealBtn = document.getElementById("btnSealPallet");
  const palletNo = (document.getElementById("pPalletNoInput")?.value || "").trim();
  if (sealBtn) sealBtn.disabled = (!palletNo || activeSerials.length !== activeMaxCapacity);
}

window.clearActiveScanPallet = async function() {
  const confirmed = await window.showConfirmDialog({
    title: "Reset Station",
    message: "Reset and clear the current scanning pallet sheet?",
    confirmText: "Reset Sheet"
  });
  if (confirmed) resetScanPalletizeStation();
};

function generateCode39Svg(text, height = 17) {
  if (!text) return "";
  try {
    const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(svgNode, String(text).trim(), {
      format: "CODE128",
      displayValue: false,
      margin: 0,
      height: height,
      width: 0.95
    });
    svgNode.removeAttribute("viewBox");
    svgNode.style.display = "block";
    svgNode.style.margin = "0 auto";
    return svgNode.outerHTML;
  } catch (err) {
    console.error("Barcode generation failed for:", text, err);
    return "-";
  }
}

function generatePalletHtmlTable(plt) {
  // Print only packed modules. Empty pallet capacity slots must never create
  // blank bordered rows or a second page on a physical packing slip.
  // A partial pallet keeps normal row height. A full pallet (up to 31 slots)
  // reaches the bottom of the safe A4 print area without adding blank rows.
  const maxSlots = Math.min(36, Math.max(1, Number(plt.capacity || 36)));
  const serials = (plt.fullRows || [])
    .filter(row => String(row?.serial || row?.barcode || "").trim())
    .slice(0, maxSlots);
  const hasBinning = String(plt.binning || "").trim().toUpperCase() !== "NO BINNING";
  const printedBinning = hasBinning ? `BINNING &nbsp;&nbsp;&nbsp;&nbsp; ${escapeSalesHtml(String(plt.binning || "").trim())}` : "";
  const printableHeightMm = 278; // safe A4 content height; prevents printer overflow
  const headerHeightMm = 29.8;
  // Use the 36-module layout as the fixed row size. A full pallet fits on one A4 page.
  const serialRowHeightMm = Math.max(5.8, (printableHeightMm - headerHeightMm) / 36);
  const serialBarcodeHeight = Math.max(15, Math.min(24, Math.round(serialRowHeightMm * 2.8)));
  let rows = "";

  for (let i = 0; i < serials.length; i++) {
    const rowItem = serials[i];
    const s = String(rowItem.serial || rowItem.barcode || "").trim();
    const barcodeSvg = generateCode39Svg(s, serialBarcodeHeight);

    rows += `
      <tr style="height: ${serialRowHeightMm.toFixed(2)}mm; text-align: center; border: 1px solid #000; page-break-inside: avoid; break-inside: avoid;">
        <td style="border: 1px solid #000; font-weight: bold; font-size: 9pt; padding: 0;">${i + 1}</td>
        <td style="border: 1px solid #000; padding: 0 4px; vertical-align: middle; text-align: center;">${barcodeSvg}</td>
        <td style="border: 1px solid #000; font-family: monospace; font-weight: bold; font-size: 8.5pt; color:#000; padding: 0 4px; white-space: nowrap;">${s}</td>
        <td style="border: 1px solid #000; font-weight: bold; font-size: 9pt; padding: 0;">${rowItem.po || '-'}</td>
        <td style="border: 1px solid #000; font-size: 8pt; padding: 0;">${plt.watt || '-'}</td>
      </tr>
    `;
  }

  const palletBarcodeSvg = plt.pallet ? generateCode39Svg(plt.pallet, 17) : "-";

  return `
    <style>
      @page { size: A4 portrait; margin: 0 !important; }
      @media print {
        html, body {
          width: 210mm !important; height: auto !important; min-height: 0 !important;
          margin: 0 !important; padding: 0 !important; background: #ffffff !important; overflow: visible !important;
          -webkit-print-color-adjust: exact; print-color-adjust: exact;
        }
        #printableReportArea {
          display: block !important; width: 210mm !important; height: auto !important; min-height:0 !important;
          margin: 0 auto !important; padding: 0 !important; overflow: visible !important;
          page-break-after: avoid !important; break-after: avoid !important;
        }
      }
    </style>
    <div style="width: 210mm; height:auto; box-sizing: border-box; margin: 0 auto; padding:8mm 10mm; background: #ffffff; page-break-inside: avoid; break-inside: avoid;">
      <div style="width: 190mm; height:auto; box-sizing: border-box; font-family: 'Aptos Narrow', Calibri, Arial, sans-serif; color: #000;">
        <table style="border-collapse: collapse; width: 100%; height:auto; table-layout: fixed; border: 1.5px solid #000; margin: 0 auto; page-break-inside: avoid; break-inside: avoid;">
          <colgroup>
            <col style="width: 34px;"><col style="width: 266px;"><col style="width: 175px;"><col style="width: 55px;"><col style="width: 90px;">
          </colgroup>
          <tr style="height: 42px; page-break-inside: avoid; break-inside: avoid;">
            <td colspan="5" style="border: 1px solid #000; text-align: center; vertical-align: middle; padding: 2px 8px; background: #ffffff;">
              <div style="display: flex; align-items: center; justify-content: center; gap: 16px; width: 100%;">
                <img src="assets/demo-logo.svg" onerror="this.onerror=null; this.src='assets/demo-logo.svg';" style="max-height: 34px; width: auto; object-fit: contain; flex-shrink: 0;">
                <span style="font-weight: 900; font-size: 14pt; letter-spacing: 0.5px; white-space: nowrap; color: #000;">
                  DEMOSOLAR ENERGY PVT LTD
                </span>
              </div>
            </td>
          </tr>
          <tr style="height: 28px; border: 1px solid #000; font-weight: bold; background: #ffffff; page-break-inside: avoid; break-inside: avoid;">
            <td colspan="2" style="border: 1px solid #000; padding: 1px 6px; text-align: center; vertical-align: middle;">
              <div style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%;">
                <span style="font-size: 8.5pt; color: #475569; letter-spacing: 0.5px;">PALLET NO :</span>
                <span style="font-size: 11.5pt; font-weight: 900; letter-spacing: 0.5px; color: #000;">${plt.pallet || '-'}</span>
              </div>
            </td>
            <td style="border: 1px solid #000; text-align: center; vertical-align: middle; padding: 1px;">
              ${palletBarcodeSvg}
            </td>
            <td colspan="2" style="border: 1px solid #000; text-align: center; font-size: 10.5pt;">${escapeSalesHtml(plt.grade || 'A GRADE')}</td>
          </tr>
          <tr style="height: 23px; border: 1px solid #000; font-weight: bold; background: #ffffff; page-break-inside: avoid; break-inside: avoid;">
            <td colspan="2" style="border: 1px solid #000; padding: 1px 6px; text-align: center; vertical-align: middle;">
              <div style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%;">
                <span style="font-size: 8pt; color: #475569;">MODEL TYPE :</span>
                <span style="font-size: 9.5pt; font-weight: 800; color: #000; white-space: nowrap;">${plt.model || '-'}</span>
              </div>
            </td>
            <td style="border: 1px solid #000; text-align: center; font-size: 8.5pt;">${printedBinning}</td>
            <td colspan="2" style="border: 1px solid #000; text-align: center; color: #0284c7; font-size: 8.5pt;">QTY - ${serials.length} / ${maxSlots}</td>
          </tr>
          <tr style="height: 20px; text-align: center; border: 1px solid #000; background: #e2e8f0; font-size: 8.5pt; font-weight: bold; page-break-inside: avoid; break-inside: avoid;">
            <th style="border: 1px solid #000; padding: 1px;">NO</th>
            <th style="border: 1px solid #000; padding: 1px;">BARCODE</th>
            <th style="border: 1px solid #000; padding: 1px;">SERIAL NO</th>
            <th style="border: 1px solid #000; padding: 1px;">PO</th>
            <th style="border: 1px solid #000; padding: 1px;">WATT</th>
          </tr>
          ${rows}
        </table>
      </div>
    </div>
  `;
}

function generateDemoOemPalletHtmlTable(plt) {
  const maxSlots = Math.min(36, Math.max(1, Number(plt.capacity || 36)));
  const serials = (plt.fullRows || [])
    .filter(row => String(row?.serial || row?.barcode || "").trim())
    .slice(0, maxSlots);
  // Keep normal rows for a partly filled pallet. Thirty-one real modules
  // fill the safe A4 area; rows after the final module are never generated.
  const printableHeightMm = 274; // safe A4 content height; prevents printer overflow
  const headerHeightMm = 48;
  const serialAreaHeightMm = printableHeightMm - headerHeightMm;
  const serialRowHeightMm = Math.max(5.4, serialAreaHeightMm / 36);
  const serialBarcodeHeight = Math.max(12, Math.min(20, Math.round(serialRowHeightMm * 2.6)));
  const value = input => escapeSalesHtml(String(input || "-").trim() || "-");
  const poRecord = getPoRecord(plt.po);
  // Resolve 570W against the current Product Master name. This keeps legacy
  // PO records (such as the earlier KE570T value) aligned with the selected
  // DemoSolar or DemoOem print format when they are reprinted.
  const itemName = getPoPackingModel(poRecord) || plt.model || "-";
  const kosolOrderNumber = plt.kosolOrderNumber || poRecord?.kosolOrderNumber || "-";
  const grade = formatDemoOemGrade(plt.grade);
  const hasBinning = String(plt.binning || "").trim().toUpperCase() !== "NO BINNING";
  const packingDate = plt.date || getFormattedToday();
  const palletBarcode = plt.pallet ? generateCode39Svg(plt.pallet, 15) : "-";
  const binning = hasBinning ? value(plt.binning) : "";
  let rows = "";

  for (let index = 0; index < serials.length; index++) {
    const row = serials[index];
    const serial = String(row.serial || row.barcode || "").trim();
    rows += `<tr style="height:${serialRowHeightMm.toFixed(2)}mm; page-break-inside:avoid; break-inside:avoid;">
      <td style="border:1px solid #000; text-align:center; font-size:8pt; padding:0;">${index + 1}</td>
      <td style="border:1px solid #000; padding:0 4px; text-align:center; vertical-align:middle; font-family:monospace; font-size:8pt; white-space:nowrap;">${value(serial)}</td>
      <td style="border:1px solid #000; padding:0 6px; text-align:center; vertical-align:middle;">${generateCode39Svg(serial, serialBarcodeHeight)}</td>
    </tr>`;
  }

  return `
    <style>
      @page { size: A4 portrait; margin: 0 !important; }
      @media print {
        html, body { width:210mm !important; height:auto !important; margin:0 !important; padding:0 !important; background:#fff !important; overflow:visible !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
        .sidebar, #loginOverlay, #erpToastContainer, .footer-credit-badge, .main-wrapper > :not(.content-area), .content-area > :not(#printableReportArea) { display:none !important; }
        .main-wrapper, .content-area { display:block !important; width:210mm !important; height:auto !important; min-height:0 !important; margin:0 !important; padding:0 !important; overflow:visible !important; }
        #printableReportArea { position:static !important; display:block !important; width:210mm !important; height:auto !important; min-height:0 !important; margin:0 !important; padding:0 !important; overflow:visible !important; }
        .kosol-print-page { width:210mm !important; height:auto !important; min-height:0 !important; margin:0 !important; padding:10mm 17mm !important; box-sizing:border-box !important; overflow:visible !important; break-after:avoid !important; page-break-after:avoid !important; }
      }
    </style>
    <div class="kosol-print-page" style="width:210mm; height:auto; padding:10mm 17mm; box-sizing:border-box; background:#fff; color:#000; font-family:Calibri,Arial,Helvetica,sans-serif;">
      <div style="width:176mm; height:auto; margin:0 auto;">
        <table style="width:100%; border-collapse:collapse; table-layout:fixed; border:2px solid #000;">
          <colgroup><col style="width:34%;"><col style="width:44%;"><col style="width:22%;"></colgroup>
          <tr style="height:14mm;">
            <td rowspan="2" style="border:2px solid #000; text-align:center; vertical-align:middle; padding:2px;">
              <img src="assets/demo-oem-logo.svg" onerror="this.style.display='none';" alt="DemoOem" style="display:block; width:100%; max-width:260px; max-height:74px; object-fit:contain; margin:0 auto;">
            </td>
            <td style="border:2px solid #000; text-align:center; font-size:10pt; font-weight:800;">DEMOOEM ENERGIE PRIVATE LIMITED.</td>
            <td style="border:2px solid #000; text-align:center; font-size:10pt; font-weight:800;">Packing Details</td>
          </tr>
          <tr style="height:9mm;">
            <td style="border:2px solid #000; text-align:center; vertical-align:middle; padding:1px 3px;">
              <div style="display:flex; align-items:center; justify-content:center; gap:6px; white-space:nowrap;">
                <span style="display:inline-block; line-height:1;">${palletBarcode}</span>
                ${hasBinning ? `<span style="font-size:7pt; font-weight:800;">BINNING: ${binning}</span>` : ""}
              </div>
            </td>
            <td style="border:2px solid #000; text-align:center; vertical-align:middle; font-size:10pt; font-weight:800;">${value(grade)}</td>
          </tr>
          <tr style="height:8mm; font-size:9pt; font-weight:800;">
            <td style="border:2px solid #000; padding:2px 5px; text-align:center;"><b>Packing No :</b> &nbsp;${value(plt.pallet)}</td>
            <td style="border:2px solid #000; text-align:center;"><b>Date :</b> &nbsp;${value(packingDate)}</td>
            <td style="border:2px solid #000; text-align:center; font-weight:800;">QTY - ${serials.length}</td>
          </tr>
          <tr style="height:10mm; font-size:9pt; font-weight:800;">
            <td colspan="2" style="border:2px solid #000; padding:2px 5px; text-align:center;"><b>Item Name :</b> &nbsp;${value(itemName)}</td>
            <td style="border:2px solid #000; padding:2px 5px; text-align:center;"><b>Order No :</b> &nbsp;${value(kosolOrderNumber)}</td>
          </tr>
        </table>
        <table style="width:100%; height:auto; border-collapse:collapse; table-layout:fixed; border:1px solid #000; margin-top:-1px;">
          <colgroup><col style="width:13%;"><col style="width:49%;"><col style="width:38%;"></colgroup>
          <thead><tr style="height:7mm; background:#f3f4f6; font-size:8pt; font-weight:700;"><th style="border:1px solid #000;">SN</th><th style="border:1px solid #000;">Serial Number</th><th style="border:1px solid #000;">BARCODE</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function generatePackingStickerHtml(plt) {
  const format = ["DEMOSOLAR", "DEMOOEM"].includes(plt.printFormat) ? plt.printFormat : getPoPrintFormat(plt.po);
  return format === "DEMOOEM" ? generateDemoOemPalletHtmlTable(plt) : generatePalletHtmlTable(plt);
}

async function getDemoOemExcelLogo() {
  const logoUrl = new URL("assets/demo-oem-logo.svg", window.location.href).href;
  const response = await fetch(logoUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("DemoOem logo file could not be loaded.");
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function downloadXlsxBuffer(fileBuffer, fileName) {
  const fileBlob = new Blob([fileBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const downloadUrl = URL.createObjectURL(fileBlob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}

async function exportDemoOemPackingPalletXlsx(plt) {
  if (!window.ExcelJS) throw new Error("Excel export library did not load. Refresh the page and try again.");

  const workbook = new window.ExcelJS.Workbook();
  workbook.creator = "DemoSolar Industries ERP";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("DemoOem Packing Slip", { views: [{ showGridLines: false }] });
  const poRecord = getPoRecord(plt.po);
  // The downloadable DemoOem slip follows the same rule as direct printing:
  // only real packed serials receive bordered rows.
  const serials = (plt.fullRows || [])
    .filter(row => String(row?.serial || row?.barcode || "").trim())
    .slice(0, Math.min(36, Math.max(1, Number(plt.capacity || 36))));
  const lastDataRow = 6 + serials.length;
  const packingDate = plt.date || getFormattedToday();
  // Use the same current Product Master mapping in the downloadable DemoOem
  // file, so its printed item name always matches the on-screen pallet slip.
  const itemName = getPoPackingModel(poRecord) || plt.model || "-";
  const kosolOrderNumber = plt.kosolOrderNumber || poRecord?.kosolOrderNumber || "-";
  const grade = formatDemoOemGrade(plt.grade);
  const hasBinning = String(plt.binning || "").trim().toUpperCase() !== "NO BINNING";
  const borderSide = { style: "medium", color: { argb: "FF000000" } };
  const mediumBorder = { top: borderSide, right: borderSide, bottom: borderSide, left: borderSide };
  const center = { horizontal: "center", vertical: "middle", wrapText: true };
  const safeText = input => {
    const text = String(input ?? "").trim() || "-";
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
  };

  const widths = { A: 3.140625, B: 20.85546875, C: 8.7109375, D: 9.7109375, E: 10.140625, F: 12.7109375, G: 20.7109375, H: 26.140625, I: 14.7109375, J: 14.5703125, K: 13 };
  Object.entries(widths).forEach(([column, width]) => { sheet.getColumn(column).width = width; });

  sheet.getRow(1).height = 15.75;
  sheet.getRow(2).height = 38.25;
  sheet.getRow(3).height = 36;
  sheet.getRow(4).height = 43.5;
  sheet.getRow(5).height = 45;
  sheet.getRow(6).height = 39.75;
  for (let row = 7; row <= lastDataRow; row++) sheet.getRow(row).height = 28.5;

  for (let row = 2; row <= lastDataRow; row++) {
    for (let column = 2; column <= 10; column++) {
      const cell = sheet.getCell(row, column);
      cell.border = mediumBorder;
      cell.alignment = center;
      cell.font = { name: "Calibri", size: row >= 7 ? 18 : 18, bold: row <= 6 };
    }
  }

  ["B2:E3", "F2:H2", "I2:J2", "F3:G3", "I3:J3", "B4:C4", "D4:E4", "G4:H4", "I4:J4", "B5:C5", "D5:G5", "I5:J5", "C6:F6", "G6:J6"].forEach(range => sheet.mergeCells(range));
  for (let row = 7; row <= lastDataRow; row++) {
    sheet.mergeCells(`C${row}:F${row}`);
    sheet.mergeCells(`G${row}:J${row}`);
  }

  sheet.getCell("F2").value = "DEMOOEM ENERGIE PRIVATE LIMITED.";
  sheet.getCell("F2").font = { name: "Calibri", size: 18, bold: true };
  sheet.getCell("I2").value = "Packing Details";
  sheet.getCell("I2").font = { name: "Calibri", size: 18, bold: true };
  sheet.getCell("F3").value = { formula: "D4", result: safeText(plt.pallet) };
  sheet.getCell("F3").font = { name: "Libre Barcode 39", size: 26 };
  sheet.getCell("H3").value = hasBinning ? `BINNING: ${safeText(plt.binning)}` : "";
  sheet.getCell("H3").font = { name: "Calibri", size: 9, bold: true };
  sheet.getCell("H3").alignment = center;
  sheet.getCell("H3").border = mediumBorder;
  sheet.getCell("I3").value = safeText(grade);
  sheet.getCell("I3").font = { name: "Calibri", size: 20, bold: true };

  sheet.getCell("B4").value = "Packing No :";
  sheet.getCell("D4").value = safeText(plt.pallet);
  sheet.getCell("F4").value = "Date :";
  sheet.getCell("G4").value = safeText(packingDate);
  sheet.getCell("I4").value = `QTY - ${serials.length}`;
  sheet.getCell("I4").font = { name: "Calibri", size: 20, bold: true };
  sheet.getCell("B5").value = "Item Name :";
  sheet.getCell("D5").value = safeText(itemName);
  sheet.getCell("D5").font = { name: "Calibri", size: 16, bold: true };
  sheet.getCell("H5").value = "Order No :";
  sheet.getCell("I5").value = safeText(kosolOrderNumber);
  sheet.getCell("B6").value = "SN";
  sheet.getCell("C6").value = "Serial Number";
  sheet.getCell("G6").value = "BARCODE";

  const boldHeaderCells = {
    B4: 18, D4: 18, F4: 18, G4: 16, I4: 20,
    B5: 18, D5: 16, H5: 18, I5: 18,
    B6: 18, C6: 18, G6: 18
  };
  Object.entries(boldHeaderCells).forEach(([address, size]) => {
    const cell = sheet.getCell(address);
    cell.border = mediumBorder;
    cell.alignment = center;
    cell.font = { name: "Calibri", size, bold: true };
  });

  for (let index = 0; index < serials.length; index++) {
    const row = index + 7;
    const serial = String(serials[index]?.serial || serials[index]?.barcode || "").trim();
    sheet.getCell(`B${row}`).value = index + 1;
    sheet.getCell(`B${row}`).font = { name: "Calibri", size: 18 };
    sheet.getCell(`C${row}`).value = serial ? safeText(serial) : "";
    sheet.getCell(`C${row}`).font = { name: "Calibri", size: 18 };
    if (serial) {
      sheet.getCell(`G${row}`).value = { formula: `"*"&C${row}&"*"`, result: `*${serial}*` };
      sheet.getCell(`G${row}`).font = { name: "Libre Barcode 39", size: 20 };
    }
  }

  const logoDataUrl = await getDemoOemExcelLogo();
  const logoId = workbook.addImage({ base64: logoDataUrl, extension: "png" });
  sheet.addImage(logoId, { tl: { col: 1, row: 1 }, br: { col: 5, row: 3 } });

  sheet.pageSetup.orientation = "portrait";
  sheet.pageSetup.scale = 60;
  sheet.pageSetup.margins = { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };
  sheet.pageSetup.printArea = `A1:K${Math.max(6, lastDataRow)}`;

  const fileBuffer = await workbook.xlsx.writeBuffer();
  const cleanPallet = String(plt.pallet || "PALLET").replace(/[^a-zA-Z0-9_-]/g, "_");
  downloadXlsxBuffer(fileBuffer, `DemoOem_Packing_Slip_${cleanPallet}.xlsx`);
}

window.exportPackingPalletExcelDirect = async function() {
  const palletRaw = document.getElementById("pPalletNoInput").value.trim().toUpperCase();
  const grade = document.getElementById("pGradeSelect").value;
  const binning = getSelectedPackingBinning();
  const model = document.getElementById("pModelSelect").value;
  const po = activePalletPo || document.getElementById("pPoSelectStation")?.value || activeSerials[0]?.po || "";
  const printFormat = getPoPrintFormat(po);

  if (printFormat === "DEMOOEM" && !requireDemoOemOrderNumber(po, "exporting the packing slip")) return;
  if (!binning) {
    window.showNotification({ title: "Binning Required", message: `Select ${printFormat === "DEMOOEM" ? "a DemoOem B1/B2/B3 range or MIX" : "I1, I2, I3, or MIX"} before exporting the packing sticker.`, type: "warning" });
    return;
  }

  const plt = {
    pallet: palletRaw || "PALLET",
    grade: grade,
    binning: binning,
    model: model,
    watt: activeLockedWatt,
    po,
    printFormat,
    kosolOrderNumber: getDemoOemOrderNumber(po),
    capacity: activeMaxCapacity,
    fullRows: activeSerials,
    date: getFormattedToday()
  };

  try {
    if (plt.printFormat === "DEMOOEM") {
      await exportDemoOemPackingPalletXlsx(plt);
      return;
    }

    const fullHtml = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
      <head><meta charset="utf-8"></head>
      <body>${generatePackingStickerHtml(plt)}</body>
      </html>
    `;
    downloadHtmlBlob(fullHtml, `Pallet_${plt.pallet}.xls`);
  } catch (error) {
    console.error("Packing XLSX export failed:", error);
    window.showNotification({ title: "Excel Export Failed", message: error.message || "Unable to generate the Excel file.", type: "danger" });
  }
};

async function printPackingStickerInIsolatedFrame(stickerHtml, palletNumber) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(frame);

  const cleanup = () => {
    if (frame.isConnected) frame.remove();
  };

  try {
    const printWindow = frame.contentWindow;
    const printDocument = frame.contentDocument;
    if (!printWindow || !printDocument) throw new Error("Print frame is unavailable.");

    const baseUrl = String(document.baseURI || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    printDocument.open();
    printDocument.write(`<!doctype html><html><head><meta charset="utf-8"><base href="${baseUrl}"><title>Pallet ${escapeSalesHtml(palletNumber || "Sticker")}</title><style>html,body{margin:0;padding:0;background:#fff}*{box-sizing:border-box}</style></head><body><main id="printableReportArea">${stickerHtml}</main></body></html>`);
    printDocument.close();

    const images = Array.from(printDocument.images || []);
    await Promise.race([
      Promise.all(images.map(image => {
        if (image.complete) return typeof image.decode === "function" ? image.decode().catch(() => undefined) : Promise.resolve();
        return new Promise(resolve => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        });
      })),
      new Promise(resolve => setTimeout(resolve, 900))
    ]);
    if (printDocument.fonts?.ready) await Promise.race([printDocument.fonts.ready, new Promise(resolve => setTimeout(resolve, 250))]);
    await new Promise(resolve => printWindow.requestAnimationFrame(() => printWindow.requestAnimationFrame(resolve)));

    printWindow.addEventListener("afterprint", cleanup, { once: true });
    printWindow.focus();
    printWindow.print();
    setTimeout(cleanup, 60000);
  } catch (error) {
    cleanup();
    console.error("Isolated packing print failed:", error);
    throw error;
  }
}

window.printPackingPalletDirect = function(palletSnapshot = null) {
  const palletRaw = document.getElementById("pPalletNoInput")?.value.trim().toUpperCase();
  const grade = document.getElementById("pGradeSelect")?.value || "A GRADE";
  const binning = getSelectedPackingBinning();
  const model = document.getElementById("pModelSelect")?.value || "-";

  if (!palletSnapshot && !palletRaw && activeSerials.length === 0) {
    window.showNotification({ title: "Print Warning", message: "Please enter Pallet Number and scan modules first.", type: "warning" });
    return;
  }

  const resolvedPo = palletSnapshot?.po || activePalletPo || document.getElementById("pPoSelectStation")?.value || activeSerials[0]?.po || "";
  const printFormat = ["DEMOSOLAR", "DEMOOEM"].includes(palletSnapshot?.printFormat) ? palletSnapshot.printFormat : getPoPrintFormat(resolvedPo);
  if (printFormat === "DEMOOEM" && !requireDemoOemOrderNumber(resolvedPo, "printing the packing slip")) return;
  const stickerBinning = String(palletSnapshot?.binning ?? binning).trim();
  if (!stickerBinning) {
    window.showNotification({ title: "Binning Required", message: `Select ${printFormat === "DEMOOEM" ? "a DemoOem B1/B2/B3 range or MIX" : "I1, I2, I3, or MIX"} before printing the packing sticker.`, type: "warning" });
    return;
  }
  const currentPallet = palletSnapshot ? { ...palletSnapshot, po: resolvedPo, printFormat, binning: stickerBinning } : {
    pallet: palletRaw || "PALLET",
    grade: grade,
    binning: stickerBinning,
    model: model,
    watt: activeLockedWatt,
    po: resolvedPo,
    printFormat,
    kosolOrderNumber: printFormat === "DEMOOEM" ? getDemoOemOrderNumber(resolvedPo) : "",
    capacity: activeMaxCapacity,
    fullRows: activeSerials,
    date: getFormattedToday()
  };

  // Printing the entire ERP document forces the browser to lay out every
  // dashboard and hidden panel. A tiny isolated frame contains only the A4
  // sticker, so the print dialog can open without reflowing the application.
  printPackingStickerInIsolatedFrame(generatePackingStickerHtml(currentPallet), currentPallet.pallet).catch(() => {
    const printArea = document.getElementById("printableReportArea");
    if (!printArea) return;
    printArea.innerHTML = generatePackingStickerHtml(currentPallet);
    printArea.style.display = "block";
    window.print();
    printArea.style.display = "none";
    printArea.innerHTML = "";
  });
};

window.sealAndPrintPackingPallet = async function() {
  // Preserve the exact operator selection because sealing resets the station.
  const selectedBinning = getSelectedPackingBinning();
  const sealed = await sealPackingPallet();
  if (sealed) printPackingPalletDirect({ ...sealed, binning: selectedBinning || sealed.binning });
};

window.sealPackingPallet = async function() {
  if (palletSealInProgress) return false;
  const palletRaw = document.getElementById("pPalletNoInput").value.trim().toUpperCase();
  const grade = document.getElementById("pGradeSelect").value;
  const binning = getSelectedPackingBinning();
  const selectedPo = activeSerials[0]?.po || activePalletPo || document.getElementById("pPoSelectStation")?.value || "";
  const firstIdentity = packingIdentityForPo(selectedPo);
  const model = firstIdentity?.model || document.getElementById("pModelSelect").value;

  if (getPoPrintFormat(selectedPo) === "DEMOOEM" && !requireDemoOemOrderNumber(selectedPo, "sealing this pallet")) return false;
  if (!binning) {
    const format = getPoPrintFormat(selectedPo);
    window.showNotification({ title: "Binning Required", message: `Select ${format === "DEMOOEM" ? "a DemoOem B1/B2/B3 range or MIX" : "I1, I2, I3, or MIX"} before sealing this pallet.`, type: "warning" });
    return false;
  }

  if (!palletRaw) {
    window.showNotification({ title: "Validation Error", message: "Please enter a valid Pallet Number.", type: "warning" });
    return false;
  }
  if (palletNumberAlreadyUsed(palletRaw)) {
    window.showNotification({ title: "Duplicate Pallet Blocked", message: `Pallet "${palletRaw}" already exists in Warehouse stock or Dispatch history.`, type: "danger" });
    return false;
  }
  if (activeSerials.length === 0) {
    window.showNotification({ title: "Empty Pallet", message: "Cannot seal an empty pallet.", type: "danger" });
    return false;
  }

  const activeSerialSet = new Set();
  for (const item of activeSerials) {
    const serial = normalizePackingId(item.serial);
    if (!serial || activeSerialSet.has(serial) || findSerialUsage(serial)) {
      window.showNotification({ title: "Pallet Validation Failed", message: `Pallet contains an invalid or previously used serial: "${serial || "blank"}".`, type: "danger" });
      return false;
    }
    activeSerialSet.add(serial);
  }

  if (isAGradePallet()) {
    const poNumbers = getActivePalletPos();
    if (poNumbers.size !== 1) {
      window.showNotification({ title: "PO Conflict (A-Grade)", message: "An A-Grade pallet must contain modules from exactly one PO.", type: "danger" });
      return false;
    }
  }

  for (const item of activeSerials) {
    const compatibility = arePackingPosCompatible(selectedPo, item.po);
    if (!compatibility.ok) {
      window.showNotification({ title: "Pallet Identity Conflict", message: compatibility.message, type: "danger" });
      return false;
    }
  }

  if (activeSerials.length !== activeMaxCapacity) {
    window.showNotification({ title: "Exact Quantity Required", message: `Scan exactly ${activeMaxCapacity} modules before sealing this pallet. Current count: ${activeSerials.length}.`, type: "warning" });
    return false;
  }

  // The first scanned serial is the immutable source of truth for the header.
  const resolvedPo = activeSerials[0]?.po ||
    ((activePalletPo && activePalletPo !== "-") ? activePalletPo :
      (document.getElementById("pPoSelectStation")?.value.trim() ||
        (palletRaw.startsWith("A") && palletRaw.includes("-") ? palletRaw.split("-")[0].substring(1) : "-")));
  const cellType = getWarehousePalletCellType({ po: resolvedPo, model });
  const printFormat = getPoPrintFormat(resolvedPo);

  const sealedPalletRecord = {
    pallet: palletRaw,
    grade: grade,
    combined: `${palletRaw}${grade}`,
    model: model,
    binning: binning,
    cellType: cellType,
    count: activeSerials.length,
    capacity: activeMaxCapacity,
    po: resolvedPo,
    printFormat,
    kosolOrderNumber: printFormat === "DEMOOEM" ? getDemoOemOrderNumber(resolvedPo) : "",
    watt: firstIdentity?.wattLabel || activeLockedWatt,
    serials: activeSerials.map(s => s.serial),
    fullRows: JSON.parse(JSON.stringify(activeSerials)),
    date: getFormattedToday()
  };

  palletSealInProgress = true;
  let palletSaved = false;
  const sealButton = document.getElementById("btnSealPallet");
  if (sealButton) { sealButton.disabled = true; sealButton.textContent = "⏳ Sealing..."; }
  try {
    const saved = await runErpTransaction("seal_pallet", { pallet: sealedPalletRecord });
    if (!saved?.pallet) return false;
    if (Array.isArray(saved.godownStock)) {
      // Backward compatibility with an older server during staggered deploys.
      godownStock = saved.godownStock;
    } else {
      const savedPalletKey = normalizePackingId(saved.pallet.pallet);
      godownStock = [...godownStock.filter(item => normalizePackingId(item?.pallet) !== savedPalletKey), saved.pallet];
    }
    if (saved.version) liveSyncVersions[KEY_STOCK] = String(saved.version);
    palletSaved = true;

    // The pallet is already committed. Persist its audit event without making
    // the operator wait for a second network round trip before printing.
    Promise.resolve(logEvent("PACKING", "PALLET_SEALED", `Pallet ${palletRaw} sealed with ${activeSerials.length} modules.`))
      .catch(error => console.error("Pallet audit logging failed:", error));
    window.showNotification({ title: "Pallet Sealed", message: `Pallet ${palletRaw} sealed and transferred to Godown!`, type: "success" });

    resetScanPalletizeStation();
    refreshPackingDashboard();
    refreshAdminDashboard();
    return saved.pallet;
  } finally {
    palletSealInProgress = false;
    if (sealButton) { sealButton.disabled = palletSaved; sealButton.textContent = "🔒 Seal Pallet & Print"; }
  }
};

window.openReworkView = function(btnEl) {
  switchView("packingRework", btnEl, "Packing Operations > Rework");
  populateReworkPalletDropdown();
};

function populateReworkPalletDropdown() {
  const sel = document.getElementById("reworkPalletDropdown");
  if (!sel) return;
  if (godownStock.length === 0) {
    sel.innerHTML = `<option value="">-- No Pallets Available in Stock --</option>`;
    onSelectReworkPallet();
    return;
  }
  sel.innerHTML = `<option value="">-- Select Pallet to Inspect / Rework --</option>` + godownStock.map(p => `
    <option value="${p.pallet}">${p.pallet} (${p.count} modules - ${p.po || p.model})</option>
  `).join("");
  onSelectReworkPallet();
}

window.onSelectReworkPallet = function() {
  const pltId = document.getElementById("reworkPalletDropdown").value;
  currentReworkPallet = godownStock.find(p => p.pallet === pltId) || null;
  selectedReworkSerials = new Set();

  const tbody = document.getElementById("reworkSerialsTableBody");
  const scanInput = document.getElementById("reworkScanInput");
  const lockNotice = document.getElementById("reworkLockNotice");
  const countBadge = document.getElementById("reworkCountBadge");
  const btnReprint = document.getElementById("btnReprintRework");
  const hdrInfo = document.getElementById("reworkHeaderInfo");

  if (!currentReworkPallet) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--muted); padding: 30px;">Select a pallet from the dropdown to inspect.</td></tr>`;
    scanInput.disabled = true;
    scanInput.value = "";
    scanInput.placeholder = "Select a pallet first";
    lockNotice.textContent = "Scanner locked until a pallet is selected.";
    countBadge.textContent = "Count: 0 / 36";
    btnReprint.disabled = true;
    hdrInfo.textContent = "Packed Modules inside Pallet: None Selected";
    updateReworkSelectionControls();
    return;
  }

  hdrInfo.textContent = `Packed Modules inside Pallet: ${currentReworkPallet.pallet} (${currentReworkPallet.model || currentReworkPallet.po})`;
  btnReprint.disabled = false;
  renderReworkTable();
};

function updateReworkSelectionControls() {
  const serials = Array.isArray(currentReworkPallet?.serials) ? currentReworkPallet.serials.map(String) : [];
  selectedReworkSerials = new Set([...selectedReworkSerials].filter(serial => serials.includes(String(serial))));
  const selectedCount = selectedReworkSerials.size;
  const selectAll = document.getElementById("reworkSelectAll");
  const bulkButton = document.getElementById("btnBulkRemoveRework");
  if (selectAll) {
    selectAll.disabled = serials.length === 0;
    selectAll.checked = serials.length > 0 && selectedCount === serials.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < serials.length;
  }
  if (bulkButton) {
    bulkButton.disabled = selectedCount === 0;
    bulkButton.textContent = `✕ Remove Selected (${selectedCount})`;
  }
}

window.toggleReworkSerialSelection = function(index, checked) {
  const serial = String(currentReworkPallet?.serials?.[index] || "");
  if (!serial) return;
  if (checked) selectedReworkSerials.add(serial);
  else selectedReworkSerials.delete(serial);
  updateReworkSelectionControls();
};

window.toggleAllReworkSerials = function(checked) {
  const serials = Array.isArray(currentReworkPallet?.serials) ? currentReworkPallet.serials.map(String) : [];
  selectedReworkSerials = checked ? new Set(serials) : new Set();
  serials.forEach((serial, index) => {
    const checkbox = document.getElementById(`reworkSerial-${index}`);
    if (checkbox) checkbox.checked = checked;
  });
  updateReworkSelectionControls();
};

function renderReworkTable() {
  const tbody = document.getElementById("reworkSerialsTableBody");
  const scanInput = document.getElementById("reworkScanInput");
  const lockNotice = document.getElementById("reworkLockNotice");
  const countBadge = document.getElementById("reworkCountBadge");

  const maxCap = currentReworkPallet.capacity || 31;
  const count = currentReworkPallet.serials.length;
  currentReworkPallet.count = count;
  countBadge.textContent = `Count: ${count} / ${maxCap}`;

  if (count >= maxCap) {
    scanInput.disabled = true;
    scanInput.value = "";
    scanInput.placeholder = `Pallet is full (${maxCap}/${maxCap}).`;
    lockNotice.textContent = `🔒 Capacity reached (${maxCap}/${maxCap}). Scanner is locked.`;
    lockNotice.style.color = "var(--danger)";
  } else {
    scanInput.disabled = false;
    scanInput.placeholder = `Ready: Scan replacement module (${maxCap - count} slots open) ⏎`;
    lockNotice.textContent = `✓ Scanner unlocked (${count}/${maxCap} modules).`;
    lockNotice.style.color = "var(--success)";
    scanInput.focus();
  }

  if (count === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--danger); padding: 20px;">All modules removed.</td></tr>`;
    updateReworkSelectionControls();
    return;
  }

  tbody.innerHTML = currentReworkPallet.serials.map((s, idx) => `
    <tr>
      <td style="text-align:center;"><input id="reworkSerial-${idx}" type="checkbox" aria-label="Select module ${escapeSalesHtml(s)}" ${selectedReworkSerials.has(String(s)) ? "checked" : ""} onchange="toggleReworkSerialSelection(${idx}, this.checked)"></td>
      <td style="font-family: monospace; font-weight: bold; color: var(--muted);">${idx + 1}</td>
      <td style="font-family: monospace; font-size: 13px; font-weight: 600;">${escapeSalesHtml(s)}</td>
      <td><span style="color: var(--success); font-weight: 600; font-size: 11px;">VERIFIED</span></td>
      <td style="text-align: right;">
        <button class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="removeModuleFromRework(${idx})">✕ Remove</button>
      </td>
    </tr>
  `).join("");
  updateReworkSelectionControls();
}

window.removeModuleFromRework = async function(idx) {
  if (!currentReworkPallet) return;
  const removedSerial = currentReworkPallet.serials[idx];

  const confirmed = await window.showConfirmDialog({
    title: "Remove Defective Module",
    message: `Remove defective serial "${removedSerial}" from pallet "${currentReworkPallet.pallet}"?`,
    confirmText: "Remove Module",
    isDanger: true
  });

  if (confirmed) {
    selectedReworkSerials.delete(String(removedSerial));
    currentReworkPallet.serials.splice(idx, 1);
    if (currentReworkPallet.fullRows) currentReworkPallet.fullRows.splice(idx, 1);
    currentReworkPallet.count = currentReworkPallet.serials.length;
    await saveStorage(KEY_STOCK, godownStock);

    logEvent("PACKING", "MODULE_REMOVED_REWORK", `Removed defective module ${removedSerial} from ${currentReworkPallet.pallet}.`);
    window.showNotification({ title: "Module Removed", message: `Removed serial ${removedSerial}. Slot is now open for replacement.`, type: "info" });
    renderReworkTable();
  }
};

window.removeSelectedModulesFromRework = async function() {
  if (!currentReworkPallet || selectedReworkSerials.size === 0) return;
  const selected = new Set(selectedReworkSerials);
  const removedSerials = currentReworkPallet.serials.filter(serial => selected.has(String(serial)));
  if (!removedSerials.length) {
    selectedReworkSerials = new Set();
    updateReworkSelectionControls();
    return;
  }
  const confirmed = await window.showConfirmDialog({
    title: "Remove Selected Modules",
    message: `Remove ${removedSerials.length} selected module(s) from pallet "${currentReworkPallet.pallet}"? This will open ${removedSerials.length} slot(s) for replacement.`,
    confirmText: `Remove ${removedSerials.length} Modules`,
    isDanger: true
  });
  if (!confirmed) return;
  const removedIndexes = new Set(currentReworkPallet.serials.map((serial, index) => selected.has(String(serial)) ? index : -1).filter(index => index >= 0));
  currentReworkPallet.serials = currentReworkPallet.serials.filter((serial, index) => !removedIndexes.has(index));
  if (Array.isArray(currentReworkPallet.fullRows)) currentReworkPallet.fullRows = currentReworkPallet.fullRows.filter((row, index) => !removedIndexes.has(index));
  currentReworkPallet.count = currentReworkPallet.serials.length;
  selectedReworkSerials = new Set();
  await saveStorage(KEY_STOCK, godownStock);
  await logEvent("PACKING", "MODULES_BULK_REMOVED_REWORK", `Removed ${removedSerials.length} selected modules from ${currentReworkPallet.pallet}.`);
  window.showNotification({ title: "Selected Modules Removed", message: `${removedSerials.length} module(s) removed. Replacement slots are now open.`, type: "info" });
  renderReworkTable();
};

window.handleReworkScan = async function(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    if (!currentReworkPallet) return;

    const serial = e.target.value.trim().toUpperCase();
    if (!serial) return;

    let foundStoreRecord = null;
    for (let rec of storeSerialsDb) {
      if (rec.serials.map(s => s.toUpperCase()).includes(serial)) { foundStoreRecord = rec; break; }
    }

    if (!foundStoreRecord) {
      window.showNotification({ title: "Rework Rejected", message: `Replacement serial "${serial}" is not registered in Store & PPC database.`, type: "danger" });
      e.target.value = "";
      return;
    }

    const maxCap = currentReworkPallet.capacity || 31;
    if (currentReworkPallet.serials.length >= maxCap) {
      window.showNotification({ title: "Capacity Limit", message: `Pallet capacity limit of ${maxCap} reached.`, type: "warning" });
      return;
    }

    if (currentReworkPallet.serials.includes(serial)) {
      window.showNotification({ title: "Duplicate Serial", message: `Module ${serial} is already in this pallet.`, type: "warning" });
      e.target.value = "";
      return;
    }

    currentReworkPallet.serials.push(serial);
    if (currentReworkPallet.fullRows) {
      currentReworkPallet.fullRows.push({
        no: currentReworkPallet.serials.length,
        barcode: serial,
        serial: serial,
        po: currentReworkPallet.po,
        watt: currentReworkPallet.watt
      });
    }
    currentReworkPallet.count = currentReworkPallet.serials.length;
    await saveStorage(KEY_STOCK, godownStock);

    logEvent("PACKING", "MODULE_ADDED_REWORK", `Added replacement module ${serial} into ${currentReworkPallet.pallet}.`);
    window.showNotification({ title: "Module Replaced", message: `Module ${serial} placed into pallet!`, type: "success" });
    e.target.value = "";
    renderReworkTable();
  }
};

window.reprintReworkPallet = function() {
  if (!currentReworkPallet) return;
  window.printPackingPalletDirect(currentReworkPallet);
  logEvent("PACKING", "PALLET_REPRINTED_REWORK", `Triggered label reprint for ${currentReworkPallet.pallet}.`);
};

window.reprintPackingSticker = async function() {
  const palletNumber = await window.showPromptDialog({
    title: "Reprint Pallet Sticker",
    message: "Enter the sealed pallet number to print its existing sticker again. This will not create stock or modify the pallet.",
    label: "Pallet Number *",
    placeholder: "e.g. A101-0022"
  });
  if (!palletNumber) return;
  const needle = normalizePackingId(palletNumber);
  const pallet = godownStock.find(item => normalizePackingId(item.pallet) === needle) ||
    dispatchArchive.flatMap(manifest => manifest.pallets || []).find(item => normalizePackingId(item.pallet) === needle);
  if (!pallet) {
    window.showNotification({ title: "Pallet Not Found", message: `No sealed or dispatched pallet exists with number "${needle}".`, type: "danger" });
    return;
  }
  window.printPackingPalletDirect(pallet);
  logEvent("PACKING", "PALLET_STICKER_REPRINTED", `Reprinted existing sticker for pallet ${pallet.pallet}.`);
};

function resetDispatchFormState() {
  dispatchPallets = [];
  currentUploadedRawPhotos = [];
  stagedBase64Photos = [];
  uploadedServerPhotoPaths = [];

  const photoInput = document.getElementById("dispatchPhotoInput");
  if (photoInput) photoInput.value = "";
  const photoGrid = document.getElementById("dispatchPhotoPreviewGrid");
  if (photoGrid) {
    photoGrid.innerHTML = "";
    photoGrid.style.display = "none";
  }
  const photoBadge = document.getElementById("photoUploadCountBadge");
  if (photoBadge) photoBadge.textContent = "0 photos chosen";
  const statusNotice = document.getElementById("photoUploadStatusNotice");
  if (statusNotice) {
    statusNotice.textContent = "";
    statusNotice.style.display = "none";
  }

  populatePoDropdowns();
  populateDispatchCoDropdown();
  populateDispatchTransportersDropdown();

  const coSelect = document.getElementById("dCoSelect");
  if (coSelect) coSelect.value = "";
  populateDispatchInvoiceDropdown("");
  const invoiceSelect = document.getElementById("dAccountInvoiceSelect");
  if (invoiceSelect) invoiceSelect.value = "";
  const coSummary = document.getElementById("dCoSummary");
  if (coSummary) coSummary.textContent = "Select the C/O Number first. The Invoice dropdown will then show only invoices created against that C/O.";

  const dateInput = document.getElementById("dtDate");
  if (dateInput) dateInput.value = "";
  ["dtTransporter", "dtVehicle", "dtChallan", "dtDriverNo", "dtDriverName", "dtModeTransport", "dtDeliveryOrder", "dtLrNo", "dtCustomer", "dtInvoice", "dtHsnCode"].forEach(id => accountSetValue(id));

  const dPo = document.getElementById("dPoSelect");
  if (dPo && dPo.value) {
    handlePoChange();
  } else {
    const oQty = document.getElementById("dOrderQty");
    if (oQty) oQty.value = "";
    
    const vQty = document.getElementById("vOrderQty");
    if (vQty) vQty.textContent = "-";
    
    const cProd = document.getElementById("cProduct");
    if (cProd) cProd.textContent = "-";
    
    const cCell = document.getElementById("cProductTypeCell");
    if (cCell) cCell.textContent = "NON - DCR";
    
    populateReadyPalletsDropdown("");
  }

  renderLoadedPalletTags();
  updateChallanPreview();
}

window.handlePoChange = function() {
  const poSelect = document.getElementById("dPoSelect");
  const poNum = poSelect ? poSelect.value.trim() : "";

  const vQty = document.getElementById("vOrderQty");
  const cProd = document.getElementById("cProduct");
  const cCell = document.getElementById("cProductTypeCell");
  const dOrderQty = document.getElementById("dOrderQty");

  if (!poNum) {
    if (cProd) cProd.textContent = "-";
    if (cCell) cCell.textContent = "NON - DCR";
    populateReadyPalletsDropdown("");
    updateChallanPreview();
    return;
  }

  const po = poDatabase.find(p => p.poNumber.toUpperCase() === poNum.toUpperCase());
  if (po) {
    const prodMatch = productsDb.find(pr => pr.name === po.product);
    const cType = prodMatch ? (prodMatch.cellType || "NON - DCR") : "NON - DCR";

    if (vQty) vQty.textContent = dOrderQty ? dOrderQty.value : "-";
    if (cProd) cProd.textContent = `${po.product} (${po.watt})`;
    if (cCell) cCell.textContent = cType;
  } else {
    if (vQty) vQty.textContent = dOrderQty ? dOrderQty.value : "-";
    if (cProd) cProd.textContent = poNum;
    if (cCell) cCell.textContent = "NON - DCR";
  }

  populateReadyPalletsDropdown(poNum);
  updateChallanPreview();
};

function populateReadyPalletsDropdown(poFilter) {
  const sel = document.getElementById("readyPalletDropdown");
  if (!sel) return;

  const cleanFilter = (poFilter || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const selectedInvoice = getAccountInvoiceByNumber(document.getElementById("dAccountInvoiceSelect")?.value || "");
  const loadedQuantity = dispatchPallets.reduce((sum, pallet) => sum + salesNumber(pallet.count), 0);
  const remainingVehicleQuantity = selectedInvoice ? Math.max(0, salesNumber(selectedInvoice.quantity) - loadedQuantity) : null;
  const availablePallets = godownStock.filter(p => {
    const alreadyLoaded = dispatchPallets.some(dp => dp.pallet === p.pallet);
    if (alreadyLoaded) return false;
    if (remainingVehicleQuantity !== null && salesNumber(p.count) > remainingVehicleQuantity) return false;
    if (!cleanFilter) return true;
    const cleanPalletPo = (p.po || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return cleanPalletPo === cleanFilter || cleanFilter.includes(cleanPalletPo) || cleanPalletPo.includes(cleanFilter);
  });

  if (availablePallets.length === 0) {
    sel.innerHTML = `<option value="">${remainingVehicleQuantity === 0 ? "-- Invoice Vehicle Quantity Fully Loaded --" : "-- No Eligible Sealed Pallets Found --"}</option>`;
    return;
  }

  sel.innerHTML = `<option value="">-- Select Pallet to Add (${availablePallets.length} Ready) --</option>` +
    availablePallets.map(p => `
      <option value="${p.pallet}">${p.pallet} (${p.count} modules - ${p.model || p.po || 'Ready'})${getActiveStockBooking(p.pallet) ? ` — BOOKED: ${getActiveStockBooking(p.pallet).customer}` : ''}</option>
    `).join("");
}

window.addPalletToManifest = function() {
  const accountInvoice = getAccountInvoiceByNumber(document.getElementById("dAccountInvoiceSelect")?.value || "");
  if (!accountInvoice) {
    window.showNotification({ title: "Accounts Invoice Required", message: "Select an invoice released by Accounts before adding pallets.", type: "warning" });
    return;
  }
  const coNumber = String(document.getElementById("dCoSelect")?.value || "").trim();
  if (!coNumber) {
    window.showNotification({ title: "CO Number Required", message: "Select the Customer Order (CO) Number before adding pallets to this dispatch.", type: "warning" });
    return;
  }
  const sel = document.getElementById("readyPalletDropdown");
  const palletId = sel ? sel.value : "";
  if (!palletId) {
    window.showNotification({ title: "Selection Warning", message: "Please select a pallet from the dropdown first.", type: "warning" });
    return;
  }

  const palletObj = godownStock.find(p => p.pallet === palletId);
  if (!palletObj) return;
  const loadedBefore = dispatchPallets.reduce((sum, pallet) => sum + salesNumber(pallet.count), 0);
  if (loadedBefore + salesNumber(palletObj.count) > salesNumber(accountInvoice.quantity)) {
    window.showNotification({ title: "Vehicle Module Limit Exceeded", message: `Accounts entered ${salesNumber(accountInvoice.quantity).toLocaleString("en-IN")} modules in this vehicle. This pallet would exceed that permitted quantity.`, type: "danger" });
    return;
  }

  const booking = getActiveStockBooking(palletId);
  const dispatchCustomer = (document.getElementById("dtCustomer")?.value || "").trim();
  if (booking && normalizeBookingParty(booking.customer) !== normalizeBookingParty(dispatchCustomer)) {
    window.showNotification({ title: "Booked Stock Restricted", message: `Pallet ${palletId} is reserved for ${booking.customer}. Enter that same customer before adding it to this packing list.`, type: "danger" });
    return;
  }

  dispatchPallets.push(palletObj);
  renderLoadedPalletTags();
  renderDispatchExcelPreview();
  populateReadyPalletsDropdown(document.getElementById("dPoSelect").value);
};

window.removePalletFromManifest = function(idx) {
  dispatchPallets.splice(idx, 1);
  renderLoadedPalletTags();
  renderDispatchExcelPreview();
  populateReadyPalletsDropdown(document.getElementById("dPoSelect").value);
};

function renderLoadedPalletTags() {
  const box = document.getElementById("loadedTagsBox");
  if (dispatchPallets.length === 0) {
    box.innerHTML = `<span style="font-size: 12px; color: var(--muted);">No pallets added yet.</span>`;
    document.getElementById("dDispatchedQty").value = "0";
    document.getElementById("cDispatchedQty").textContent = "0";
    return;
  }

  const totalMods = dispatchPallets.reduce((sum, p) => sum + p.count, 0);
  document.getElementById("dDispatchedQty").value = totalMods;
  document.getElementById("cDispatchedQty").textContent = totalMods;

  box.innerHTML = dispatchPallets.map((p, idx) => `
    <span style="background: #e0f2fe; border: 1px solid #bae6fd; color: #0284c7; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 6px; display: inline-flex; align-items: center; gap: 8px;">
      📦 ${p.pallet} (${p.count} mods)
      <button onclick="removePalletFromManifest(${idx})" style="background: none; border: none; color: #ef4444; font-weight: bold; cursor: pointer;">✕</button>
    </span>
  `).join("");
}

window.updateChallanPreview = function() {
  const getVal = (id, fb = "-") => (document.getElementById(id)?.value || "").trim() || fb;
  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setTxt("cTransporter", getVal("dtTransporter"));
  setTxt("cVehicle", getVal("dtVehicle"));
  setTxt("cChallan", getVal("dtChallan"));
  setTxt("cDate", getVal("dtDate", typeof getFormattedToday === "function" ? getFormattedToday() : new Date().toLocaleDateString()));
  setTxt("cDriverNo", getVal("dtDriverNo"));
  setTxt("cModeTransport", getVal("dtModeTransport", "By Road"));
  setTxt("cDriverName", getVal("dtDriverName"));
  setTxt("cDeliveryOrder", getVal("dtDeliveryOrder"));
  setTxt("cLrNo", getVal("dtLrNo"));
  setTxt("cCustomer", getVal("dtCustomer"));
  setTxt("cPackingType", getVal("dtPackingType", "Box Packing"));
  setTxt("cInvoice", getVal("dtInvoice"));
  setTxt("cHsnCode", getVal("dtHsnCode", "85414300"));

  const customOrderQty = document.getElementById("dOrderQty")?.value || "-";
  setTxt("vOrderQty", customOrderQty);

  const loadedQty = dispatchPallets.reduce((acc, p) => acc + (p.count || 0), 0);
  setTxt("cDispatchedQty", loadedQty);

  renderDispatchExcelPreview();
};

function renderDispatchExcelPreview() {
  const tbody = document.getElementById("excelPalletBody");
  if (!tbody) return;

  if (dispatchPallets.length === 0) {
    tbody.innerHTML = "";
    return;
  }

  let html = "";
  dispatchPallets.forEach(plt => {
    html += `
      <tr style="background: #f1f5f9; font-weight: bold;">
        <td colspan="5" style="text-align: left; padding: 6px 10px; border: 1px solid #000; font-size: 11pt;">
          PALLET NO: <strong style="color:#0284c7;">${plt.pallet || '-'}</strong> &nbsp;|&nbsp; Model: ${plt.model || '-'} &nbsp;|&nbsp; Grade: ${plt.grade || 'A GRADE'} &nbsp;|&nbsp; Watt: ${plt.watt || '-'}
        </td>
      </tr>
      <tr style="background: #e2e8f0; font-size: 11pt; font-weight: bold; text-align: center;">
        <td style="border: 1px solid #000; width: 60px;">NO</td>
        <td colspan="2" style="border: 1px solid #000;">SERIAL NUMBER</td>
        <td style="border: 1px solid #000;">PO NUMBER</td>
        <td style="border: 1px solid #000;">CELL TYPE</td>
      </tr>
    `;
    const serials = plt.serials || (plt.fullRows || []).map(r => r.serial) || [];
    serials.forEach((s, sIdx) => {
      html += `
        <tr style="text-align: center; font-size: 11pt;">
          <td style="border: 1px solid #000;">${sIdx + 1}</td>
          <td colspan="2" style="border: 1px solid #000; font-family: monospace; font-weight: bold;">${String(s).trim()}</td>
          <td style="border: 1px solid #000;">${plt.po || '-'}</td>
          <td style="border: 1px solid #000;">${plt.cellType || 'NON - DCR'}</td>
        </tr>
      `;
    });
  });
  tbody.innerHTML = html;
}

function buildDynamicPalletRows(palletList) {
  if (!palletList || palletList.length === 0) return "";
  let html = "";
  const chunkSize = 5;

  for (let c = 0; c < palletList.length; c += chunkSize) {
    const chunk = palletList.slice(c, c + chunkSize);
    while (chunk.length < 5) {
      chunk.push(null);
    }

    html += `<tr style="height: 24pt; mso-height-source: userset;">`;
    chunk.forEach(p => {
      html += `<td style="border: 0.5pt solid #000000; background-color: #7ec8e3; font-family: 'Aptos Narrow', Calibri, Arial, sans-serif; font-size: 12pt; font-weight: bold; text-align: center; vertical-align: middle; padding: 4px;">${p ? (p.pallet || '-') : ''}</td>`;
    });
    html += `</tr>`;

    html += `<tr style="height: 22pt; mso-height-source: userset;">`;
    chunk.forEach(p => {
      const cnt = p ? (p.count || (p.serials || []).length || 0) : '';
      html += `<td style="border: 0.5pt solid #000000; background-color: #7ec8e3; font-family: 'Aptos Narrow', Calibri, Arial, sans-serif; font-size: 11pt; font-weight: bold; text-align: center; vertical-align: middle; padding: 4px;">${cnt}</td>`;
    });
    html += `</tr>`;

    const maxSerials = Math.max(...chunk.map(p => (p && p.serials ? p.serials.length : (p && p.fullRows ? p.fullRows.length : 0))), 31);

    for (let r = 0; r < maxSerials; r++) {
      html += `<tr style="height: 20pt; mso-height-source: userset;">`;
      chunk.forEach(p => {
        let serial = "";
        if (p) {
          const list = p.serials || (p.fullRows || []).map(row => row.serial) || [];
          serial = list[r] ? String(list[r]).trim() : "";
        }
        html += `<td style="border: 0.5pt solid #000000; background-color: #ffffff; font-family: 'Aptos Narrow', Calibri, monospace; font-size: 11pt; text-align: center; vertical-align: middle; padding: 4px; mso-number-format: '\\@';">${serial}</td>`;
      });
      html += `</tr>`;
    }
  }

  return html;
}

function buildCurrentDispatchDraftManifest() {
  return {
    invoice: document.getElementById("dtInvoice")?.value.trim() || "DRAFT-INV",
    challanNo: document.getElementById("dtChallan")?.value.trim() || "-",
    transporter: document.getElementById("dtTransporter")?.value.trim() || "-",
    vehicle: document.getElementById("dtVehicle")?.value.trim() || "-",
    driverNo: document.getElementById("dtDriverNo")?.value.trim() || "-",
    driverName: document.getElementById("dtDriverName")?.value.trim() || "-",
    modeTransport: document.getElementById("dtModeTransport")?.value.trim() || "By Road",
    deliveryOrderNo: document.getElementById("dtDeliveryOrder")?.value.trim() || "-",
    lrNo: document.getElementById("dtLrNo")?.value.trim() || "-",
    customer: document.getElementById("dtCustomer")?.value.trim() || "-",
    packingType: document.getElementById("dtPackingType")?.value || "Box Packing",
    hsnCode: document.getElementById("dtHsnCode")?.value.trim() || "85414300",
    date: document.getElementById("dtDate")?.value.trim() || (typeof getFormattedToday === "function" ? getFormattedToday() : new Date().toLocaleDateString()),
    product: document.getElementById("cProduct")?.textContent || "-",
    cellType: document.getElementById("cProductTypeCell")?.textContent || "NON - DCR",
    orderQty: document.getElementById("dOrderQty")?.value.trim() || "-",
    dispatchedQty: dispatchPallets.reduce((sum, pallet) => sum + Number(pallet.count || 0), 0),
    pallets: dispatchPallets
  };
}

function validateCurrentPackingListQuantity(exportType = "Packing List") {
  const invoiceNumber = String(document.getElementById("dAccountInvoiceSelect")?.value || "").trim();
  const accountInvoice = getAccountInvoiceByNumber(invoiceNumber);
  if (!accountInvoice) {
    window.showNotification({ title: "Invoice Required", message: `Select an Accounts invoice before generating the ${exportType}.`, type: "warning" });
    return false;
  }
  const allowedQuantity = salesNumber(accountInvoice.quantity);
  const loadedQuantity = dispatchPallets.reduce((sum, pallet) => sum + salesNumber(pallet.count), 0);
  if (loadedQuantity !== allowedQuantity) {
    window.showNotification({
      title: "Vehicle Quantity Must Match",
      message: `Accounts entered ${allowedQuantity.toLocaleString("en-IN")} modules in this vehicle. The packing list currently contains ${loadedQuantity.toLocaleString("en-IN")} modules. Load exactly ${allowedQuantity.toLocaleString("en-IN")} modules before continuing.`,
      type: "danger"
    });
    return false;
  }
  return true;
}

window.exportCurrentDispatchExcel = async function() {
  if (!dispatchPallets.length) {
    window.showNotification({ title: "Excel Export", message: "Add at least one pallet before exporting the Packing List.", type: "warning" });
    return;
  }
  if (!validateCurrentPackingListQuantity("Excel Packing List")) return;
  const manifest = buildCurrentDispatchDraftManifest();
  const exported = await exportDispatchSheetJs(manifest);
  if (exported) await logEvent("DISPATCH", "PACKING_LIST_EXCEL_EXPORTED", `Exported draft Packing List Excel for invoice ${manifest.invoice}; dispatch was not saved.`);
};

window.dispatchPackingList = async function() {
  const poNum = document.getElementById("dPoSelect").value;
  const coNumber = String(document.getElementById("dCoSelect")?.value || "").trim();
  const vehicle = document.getElementById("dtVehicle").value.trim().toUpperCase();
  const invoice = document.getElementById("dtInvoice").value.trim().toUpperCase();
  const accountInvoice = getAccountInvoiceByNumber(invoice);
  const salesOrder = getSalesOrderByCo(coNumber);
  const customer = salesOrder ? salesOrder.customerName : document.getElementById("dtCustomer").value.trim();
  const date = document.getElementById("dtDate").value.trim();
  const driverNo = document.getElementById("dtDriverNo").value.trim();
  const driverName = document.getElementById("dtDriverName").value.trim();

  if (!accountInvoice || !coNumber || !salesOrder || !vehicle || !invoice || !customer || !date) {
    window.showNotification({ title: "Accounts Invoice Required", message: "Select an invoice released by Accounts before generating the Packing List.", type: "warning" });
    return;
  }
  if (!driverNo || !driverName) {
    window.showNotification({ title: "Driver Details Required", message: "Enter the Driver Name and Driver Number. All other details are fetched automatically from Sales and Accounts.", type: "warning" });
    return;
  }

  if (dispatchPallets.length === 0) {
    window.showNotification({ title: "No Pallets Loaded", message: "Cannot generate Packing List without adding pallets.", type: "danger" });
    return;
  }

  const totalDispatched = dispatchPallets.reduce((sum, p) => sum + p.count, 0);
  if (totalDispatched !== salesNumber(accountInvoice.quantity)) {
    window.showNotification({ title: "Vehicle Quantity Must Match", message: `Accounts entered ${salesNumber(accountInvoice.quantity).toLocaleString("en-IN")} modules in this vehicle for invoice ${invoice}, but the packing list contains ${totalDispatched.toLocaleString("en-IN")} modules.`, type: "danger" });
    return;
  }
  const alreadyDispatched = getSalesOrderDispatchStats(coNumber).qty;
  const pendingQty = Math.max(0, salesNumber(salesOrder.totalOrderQty) - alreadyDispatched);
  if (totalDispatched > pendingQty) {
    window.showNotification({ title: "CO Pending Quantity Exceeded", message: `This CO has only ${pendingQty} module(s) pending, but ${totalDispatched} module(s) are loaded.`, type: "danger" });
    return;
  }
  const confirmed = await window.showConfirmDialog({
    title: "Confirm Dispatch",
    message: `Dispatch invoice ${invoice} with ${totalDispatched.toLocaleString("en-IN")} module(s)? This saves the dispatch permanently and does not download Excel or PDF.`,
    confirmText: "Dispatch"
  });
  if (!confirmed) return;
  if (!await reconcileAccountInvoiceDispatchStatus()) {
    window.showNotification({ title: "Invoice Status Not Saved", message: "The reopened invoice status could not be saved. Refresh this page and try again.", type: "danger" });
    return;
  }
  const cellType = document.getElementById("cProductTypeCell")?.textContent || "NON - DCR";

  // If user selected photos but didn't click "Upload Photos", auto-upload them now:
  if (uploadedServerPhotoPaths.length === 0 && stagedBase64Photos.length > 0) {
    await window.uploadSelectedPhotosNow();
    if (uploadedServerPhotoPaths.length === 0) return;
  }

  const transaction = await runErpTransaction("dispatch", {
    accountInvoiceId: accountInvoice.id,
    coNumber,
    po: poNum || "MULTI-PO",
    transporter: document.getElementById("dtTransporter").value.trim(), vehicle,
    driverNo: document.getElementById("dtDriverNo").value.trim(), driverName: document.getElementById("dtDriverName").value.trim(),
    modeTransport: document.getElementById("dtModeTransport").value.trim() || "By Road", deliveryOrderNo: document.getElementById("dtDeliveryOrder").value.trim(),
    lrNo: document.getElementById("dtLrNo").value.trim(), invoice, challanNo: document.getElementById("dtChallan").value.trim(),
    product: document.getElementById("cProduct").textContent, cellType, date,
    packingType: document.getElementById("dtPackingType").value || "Box Packing", hsnCode: document.getElementById("dtHsnCode").value.trim() || "85414300",
    palletIds: dispatchPallets.map(pallet => pallet.pallet), photos: uploadedServerPhotoPaths
  });
  if (!transaction) return;
  if (Array.isArray(transaction.dispatchArchive)) dispatchArchive = transaction.dispatchArchive;
  else if (transaction.manifest) dispatchArchive = [transaction.manifest, ...dispatchArchive.filter(item => String(item?.id || "") !== String(transaction.manifest.id || ""))];
  if (Array.isArray(transaction.godownStock)) godownStock = transaction.godownStock;
  else if (Array.isArray(transaction.removedPalletIds)) {
    const removed = new Set(transaction.removedPalletIds.map(normalizePackingId));
    godownStock = godownStock.filter(item => !removed.has(normalizePackingId(item?.pallet)));
  }
  if (Array.isArray(transaction.salesOrders)) salesOrders = transaction.salesOrders;
  else if (transaction.salesOrder) salesOrders = salesOrders.map(item => String(item?.id || item?.coNumber || "") === String(transaction.salesOrder.id || transaction.salesOrder.coNumber || "") ? transaction.salesOrder : item);
  stockBookings = Array.isArray(transaction.stockBookings) ? transaction.stockBookings : stockBookings;
  if (Array.isArray(transaction.accountInvoices)) accountInvoices = transaction.accountInvoices;
  else if (transaction.accountInvoice) accountInvoices = accountInvoices.map(item => String(item?.id || "") === String(transaction.accountInvoice.id || "") ? transaction.accountInvoice : item);
  Object.assign(liveSyncVersions, transaction.versions || {});
  invalidatePackingUsageIndexes();
  window.showNotification({ title: "Shipment Dispatched", message: `Dispatch for ${invoice} saved successfully. No Excel or PDF file was downloaded. Photos are saved in photos/${invoice}/.`, type: "success" });

  resetDispatchFormState();
  refreshDispatchDashboard();
  refreshAdminDashboard();
  renderSalesOrdersTable();
  renderAccountInvoiceTable();
};

// Backward-compatible alias for any older cached button. It now dispatches
// only and never downloads an Excel file.
window.generateExcel = window.dispatchPackingList;

async function getEmbeddedExcelLogo() {
  const logoUrl = new URL(
    "assets/demo-logo.svg",
    window.location.href
  ).href;

  const response = await fetch(logoUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new Error("DemoSolar logo file could not be loaded.");
  }

  const logoBlob = await response.blob();

  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(logoBlob);
  });
}

async function exportDispatchSheetJs(m) {
  if (!m) {
    window.showNotification({ title: "Export Error", message: "No manifest data found to export.", type: "warning" });
    return;
  }

  try {
    if (!window.ExcelJS && typeof window.ensureErpLibrary === "function") {
      await window.ensureErpLibrary("exceljs");
    }
    if (!window.ExcelJS) {
      throw new Error("Excel export library did not load. Refresh the page and try again.");
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "DemoSolar Industries ERP";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Packing List", {
      views: [{ showGridLines: false }]
    });

    // One uniform five-column grid keeps the Excel pallet matrix aligned with the PDF.
    sheet.columns = [
      { width: 27.4 }, { width: 27.4 }, { width: 27.4 }, { width: 27.4 }, { width: 27.4 }
    ];

    const thinBlack = { style: "thin", color: { argb: "FF000000" } };
    const border = { top: thinBlack, left: thinBlack, bottom: thinBlack, right: thinBlack };
    const center = { horizontal: "center", vertical: "middle", wrapText: true };
    const blue = "FF5B9BD5";
    const cyan = "FF7EC8E3";

    const value = (input, fallback = "-") => {
      const text = String(input ?? "").trim() || fallback;
      return /^[=+\-@]/.test(text) ? `'${text}` : text;
    };

    const styleRange = (row, from, to, options = {}) => {
      for (let column = from; column <= to; column++) {
        const cell = sheet.getCell(row, column);
        cell.border = border;
        cell.alignment = options.alignment || center;
        cell.font = {
          name: "Arial",
          size: options.size || 11,
          bold: options.bold !== false,
          color: options.color ? { argb: options.color } : undefined
        };
        if (options.fill) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: options.fill } };
        }
      }
    };

    for (let row = 1; row <= 6; row++) sheet.getRow(row).height = 22;
    sheet.getRow(1).height = 26;
    sheet.getRow(2).height = 30;
    sheet.getRow(3).height = 30;

    styleRange(1, 1, 5);
    styleRange(2, 1, 5);
    styleRange(3, 1, 5);
    styleRange(4, 1, 5);
    styleRange(5, 1, 5);
    styleRange(6, 1, 5);
    sheet.mergeCells("A1:B6");
    sheet.mergeCells("C1:E1");
    sheet.mergeCells("C2:E4");
    sheet.mergeCells("C5:E5");
    sheet.mergeCells("C6:E6");

    sheet.getCell("C1").value = "DEMOSOLAR INDUSTRIES PRIVATE LIMITED";
    sheet.getCell("C1").font = { name: "Arial", size: 16, bold: true, color: { argb: "FF6F22B9" } };
    sheet.getCell("C1").alignment = center;
    sheet.getCell("C2").value = "Address:- Demo Industrial Park, Ahmedabad - 380001, Gujarat - India";
    sheet.getCell("C2").font = { name: "Arial", size: 10, bold: false };
    sheet.getCell("C2").alignment = center;
    sheet.getCell("C5").value = "Contact No: +91 9000000004";
    sheet.getCell("C5").font = { name: "Arial", size: 11, bold: true };
    sheet.getCell("C5").alignment = center;
    sheet.getCell("C6").value = "Email: support@example.test";
    sheet.getCell("C6").font = { name: "Arial", size: 11, bold: true };
    sheet.getCell("C6").alignment = center;

    const logoDataUrl = await getEmbeddedExcelLogo();
    const logoId = workbook.addImage({ base64: logoDataUrl, extension: "png" });
    sheet.addImage(logoId, {
      tl: { col: 0, row: 0 },
      br: { col: 2, row: 6 }
    });

    const dispatchRows = [
      ["Transporter Name:", m.transporter, "Challan no:", m.challanNo],
      ["Vehicle No:", m.vehicle, "Date:", m.date],
      ["Driver No:", m.driverNo, "Mode of Transport:", m.modeTransport],
      ["Driver Name:", m.driverName, "Delivery Order No:", m.deliveryOrderNo],
      ["LR No:", m.lrNo, "Customer Name:", m.customer],
      ["Packing Type:", m.packingType, "Invoice No.:", m.invoice]
    ];

    dispatchRows.forEach((item, index) => {
      const row = 7 + index;
      sheet.getRow(row).height = 22;
      styleRange(row, 1, 5);
      sheet.mergeCells(row, 4, row, 5);
      sheet.getCell(row, 1).value = item[0];
      sheet.getCell(row, 2).value = value(item[1]);
      sheet.getCell(row, 3).value = item[2];
      sheet.getCell(row, 4).value = value(item[3]);
      sheet.getCell(row, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: blue } };
      sheet.getCell(row, 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: blue } };
      sheet.getCell(row, 1).font = { name: "Arial", size: 11, bold: true };
      sheet.getCell(row, 3).font = { name: "Arial", size: 11, bold: true };
      sheet.getCell(row, 2).alignment = center;
      sheet.getCell(row, 4).alignment = center;
    });

    styleRange(13, 1, 5, { fill: cyan });
    sheet.mergeCells("A13:B13");
    sheet.getCell("A13").value = "Product Detail";
    sheet.getCell("C13").value = "HSN Code";
    sheet.getCell("D13").value = "Order Qty:";
    sheet.getCell("E13").value = "Qty";
    sheet.getRow(13).height = 22;

    styleRange(14, 1, 5);
    sheet.mergeCells("A14:B14");
    sheet.getCell("A14").value = value(m.product);
    sheet.getCell("C14").value = value(m.hsnCode || "85414300");
    sheet.getCell("D14").value = value(m.orderQty || m.dispatchedQty || "0");
    sheet.getCell("E14").value = value(m.dispatchedQty || "0");
    sheet.getCell("E14").font = { name: "Arial", size: 11, bold: true, color: { argb: "FF009966" } };
    sheet.getRow(14).height = 22;

    // Keep the Excel pallet body identical to the PDF: up to five pallets
    // across, then one quantity row and the serials directly beneath each pallet.
    let outputRow = 15;
    const palletGroups = [];
    const pallets = m.pallets || [];
    for (let index = 0; index < pallets.length; index += 5) {
      palletGroups.push(pallets.slice(index, index + 5));
    }
    if (!palletGroups.length) palletGroups.push([]);

    palletGroups.forEach(group => {
      const fivePallets = [...group];
      while (fivePallets.length < 5) fivePallets.push(null);

      styleRange(outputRow, 1, 5, { fill: cyan, size: 11 });
      fivePallets.forEach((pallet, columnIndex) => {
        const cell = sheet.getCell(outputRow, columnIndex + 1);
        cell.value = pallet ? value(pallet.pallet || pallet.id, "") : "";
      });
      sheet.getRow(outputRow).height = 22;
      outputRow++;

      styleRange(outputRow, 1, 5, { fill: cyan, size: 11 });
      fivePallets.forEach((pallet, columnIndex) => {
        const serialCount = pallet ? (pallet.count || (pallet.serials || pallet.fullRows || []).length || 0) : "";
        sheet.getCell(outputRow, columnIndex + 1).value = serialCount;
      });
      sheet.getRow(outputRow).height = 20;
      outputRow++;

      // The PDF always prints 31 serial rows per pallet group.
      for (let serialIndex = 0; serialIndex < 31; serialIndex++) {
        styleRange(outputRow, 1, 5, { bold: true, size: 9 });
        fivePallets.forEach((pallet, columnIndex) => {
          const serials = pallet ? (pallet.serials || (pallet.fullRows || []).map(row => row.serial) || []) : [];
          sheet.getCell(outputRow, columnIndex + 1).value = serials[serialIndex] ? value(String(serials[serialIndex]).trim(), "") : "";
        });
        sheet.getRow(outputRow).height = 19;
        outputRow++;
      }
    });

    const invoice = String(m.invoice || m.po || "PACKING_LIST").replace(/[^a-zA-Z0-9_-]/g, "_");
    const fileBuffer = await workbook.xlsx.writeBuffer();
    const fileBlob = new Blob([fileBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const downloadUrl = URL.createObjectURL(fileBlob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `Packing_List_${invoice}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    window.showNotification({
      title: "Packing List Downloaded",
      message: `${link.download} was generated successfully.`,
      type: "success"
    });
    return true;
  } catch (error) {
    console.error("Packing-list XLSX export failed:", error);
    window.showNotification({
      title: "Excel Export Failed",
      message: error.message || "Unable to generate the Excel file.",
      type: "danger"
    });
    return false;
  }
}

window.openProductsView = function(btnEl) {
  switchView('productsView', btnEl, 'Product Master > View Products');
  renderProductsViewTable();
};

window.renderProductsViewTable = function() {
  const search = (document.getElementById("prodSearchInput")?.value || "").trim().toLowerCase();
  const tbody = document.getElementById("productsViewBody");
  if (!tbody) return;

  const filtered = productsDb.filter(p => {
    if (!search) return true;
    const haystack = `${p.name} ${p.watt} ${p.cellType || 'NON - DCR'}`.toLowerCase();
    return haystack.includes(search);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--muted); padding:20px;">No products match your search.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((p, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td><strong>${p.name}</strong></td>
      <td>${p.watt}</td>
      <td><span style="font-weight:700; color:${p.cellType === 'DCR' ? '#7c3aed' : '#0284c7'};">${p.cellType || 'NON - DCR'}</span></td>
      <td style="color:var(--muted); font-size:12px;">${p.date || 'Master Catalog'}</td>
    </tr>
  `).join("");
};

window.exportProductCatalogExcel = function() {
  let rowsHtml = "";
  productsDb.forEach((p, idx) => {
    rowsHtml += `
      <tr style="text-align:center; border:1px solid #000;">
        <td style="border:1px solid #000;">${idx + 1}</td>
        <td style="border:1px solid #000; font-weight:bold;">${p.name}</td>
        <td style="border:1px solid #000;">${p.watt}</td>
        <td style="border:1px solid #000; font-weight:bold;">${p.cellType || 'NON - DCR'}</td>
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
          <td colspan="2" style="text-align:center; font-size:16pt; font-weight:bold; border:none; padding:10px;">
            DEMOSOLAR INDUSTRIES PRIVATE LIMITED - MASTER PRODUCT CATALOG
          </td>
        </tr>
        <tr class="hdr"><th>#</th><th>Model Description</th><th>Wattage</th><th>Cell Type</th></tr>
        ${rowsHtml}
      </table>
    </body>
    </html>
  `;
  downloadHtmlBlob(fullHtml, `Product_Catalog_${Date.now()}.xls`);
};

window.saveProductCatalog = async function() {
  const name = document.getElementById("pAddName").value.trim().toUpperCase();
  const watt = document.getElementById("pAddWatt").value.trim();
  const cellType = document.getElementById("pAddCellType").value;

  if (!name || !watt) { 
    window.showNotification({ title: "Input Required", message: "Product name and wattage are required.", type: "warning" }); 
    return; 
  }

  const isDuplicate = productsDb.some(p => p.name.toUpperCase() === name && (p.cellType || 'NON - DCR') === cellType);
  if (isDuplicate) {
    window.showNotification({ title: "Duplicate Product", message: `Product "${name}" (${cellType}) already exists.`, type: "danger" }); 
    return; 
  }

  productsDb.push({ id: Date.now(), name, watt, cellType, date: getFormattedToday() });
  await saveStorage(KEY_PRODUCTS, productsDb);

  window.showNotification({ title: "Product Saved", message: "Product added to master catalog successfully!", type: "success" });
  document.getElementById("pAddName").value = "";
  document.getElementById("pAddWatt").value = "";
  document.getElementById("pAddCellType").value = "NON - DCR";

  populateProductDropdowns();
  renderProductTables();
  renderProductsViewTable();
  switchView("productsView", null, 'Product Master > View Products');
};

window.openDeleteUserView = function(btnEl) {
  switchView('adminDeleteUser', btnEl, 'IT > User Management > Delete User');
  populateDeleteUserDropdown();
};

function populateDeleteUserDropdown() {
  const sel = document.getElementById("deleteSelectUser");
  if (!sel) return;
  if (usersDb.length === 0) { sel.innerHTML = `<option value="">-- No users registered --</option>`; onSelectUserToDelete(); return; }
  sel.innerHTML = `<option value="">-- Select User to Delete --</option>` + usersDb.map(u => `
    <option value="${u.id}">${u.name.toUpperCase()} (@${u.username})</option>
  `).join("");
  onSelectUserToDelete();
}

window.onSelectUserToDelete = function() {
  const userId = parseInt(document.getElementById("deleteSelectUser").value, 10);
  const user = usersDb.find(u => u.id === userId);
  const box = document.getElementById("deleteUserInfoBox");
  if (!user) { box.innerHTML = `Select a user account above to view details.`; return; }
  box.innerHTML = `<strong>Name:</strong> ${user.name.toUpperCase()}<br><strong>Username:</strong> @${user.username}<br><strong>Role:</strong> ${user.role.toUpperCase()}`;
};

window.executeDeleteUser = async function() {
  const userId = parseInt(document.getElementById("deleteSelectUser").value, 10);
  const user = usersDb.find(u => u.id === userId);
  if (!user) return;

  if (currentLoggedInUser && currentLoggedInUser.id === user.id) {
    window.showNotification({ title: "Action Blocked", message: "You cannot delete the account you are currently signed into.", type: "danger" });
    return;
  }

  const confirmed = await window.showConfirmDialog({
    title: "Delete User",
    message: `Are you sure you want to permanently delete user account @${user.username}?`,
    confirmText: "Delete Account",
    isDanger: true
  });

  if (confirmed) {
    usersDb = usersDb.filter(u => u.id !== user.id);
    await saveStorage(KEY_USERS, usersDb);
    window.showNotification({ title: "User Deleted", message: `User @${user.username} has been decommissioned.`, type: "success" });
    populateDeleteUserDropdown();
    renderUsersTable();
  }
};

window.openUserRightsView = async function(btnEl) {
  switchView('adminUserRights', btnEl, 'IT > User Management > User Rights');
  populateUserRightsDropdown();
  await window.loadCctvAdminData?.();
};

function populateUserRightsDropdown() {
  const sel = document.getElementById("rightsSelectUser");
  if (!sel) return;
  sel.innerHTML = usersDb.map(u => `<option value="${u.id}">${u.name.toUpperCase()} (@${u.username})</option>`).join("");
  onSelectUserRights();
}

window.onSelectUserRights = function() {
  const userId = parseInt(document.getElementById("rightsSelectUser").value, 10);
  const user = usersDb.find(u => u.id === userId);
  if (!user) return;
  if (!user.rights) user.rights = {};

  const container = document.getElementById("rightsChecklistContainer");
  container.innerHTML = "";

  APP_MENUS.forEach(menu => {
    const isParentChecked = menu.id === "utilities"
      ? user.rights[menu.id] !== false
      : user.rights[menu.id] === true;
    const card = document.createElement("div");
    card.className = "rights-card-box";
    let html = `
      <div class="rights-parent-header">
        <input type="checkbox" id="right_${menu.id}" ${isParentChecked ? 'checked' : ''} onchange="toggleParentRight('${menu.id}')">
        <label for="right_${menu.id}">${menu.name}</label>
      </div>
    `;
    if (menu.submenus.length > 0) {
      html += `<div class="rights-child-list" id="childBox_${menu.id}">`;
      menu.submenus.forEach(sub => {
        if (sub.id === "requestRoutes" && !(String(user.username || "").toUpperCase() === "IT" && /^(IT|IT DEPARTMENT|INFORMATION TECHNOLOGY)$/i.test(String(user.department || "")))) return;
        const isSubChecked = menu.id === "utilities"
          ? user.rights[sub.id] !== false
          : user.rights[sub.id] === true;
        html += `
          <div class="rights-child-item">
            <input type="checkbox" id="right_${sub.id}" class="child-right-${menu.id}" ${isSubChecked ? 'checked' : ''} onchange="syncChildToParent('${menu.id}')">
            <label for="right_${sub.id}">${sub.name}</label>
          </div>
        `;
      });
      html += `</div>`;
    }
    card.innerHTML = html;
    container.appendChild(card);
  });
  window.renderCctvAccessTable?.();
};

window.toggleParentRight = function(parentId) {
  const parentCheck = document.getElementById(`right_${parentId}`);
  const childBoxes = document.querySelectorAll(`.child-right-${parentId}`);
  childBoxes.forEach(cb => { cb.checked = parentCheck.checked; });
};

window.syncChildToParent = function(parentId) {
  const childBoxes = document.querySelectorAll(`.child-right-${parentId}`);
  const parentCheck = document.getElementById(`right_${parentId}`);
  const hasAnyChecked = Array.from(childBoxes).some(cb => cb.checked);
  if (hasAnyChecked) parentCheck.checked = true;
};

window.saveUserRights = async function() {
  const userId = parseInt(document.getElementById("rightsSelectUser").value, 10);
  const user = usersDb.find(u => u.id === userId);
  if (!user) return;

  const newRights = {};
  APP_MENUS.forEach(menu => {
    const parentCheck = document.getElementById(`right_${menu.id}`);
    newRights[menu.id] = parentCheck ? parentCheck.checked : false;
    menu.submenus.forEach(sub => {
      const subCheck = document.getElementById(`right_${sub.id}`);
      newRights[sub.id] = subCheck ? subCheck.checked : false;
    });
  });
  // Camera administration is now part of User Rights and follows the same permission.
  newRights.cctvAdmin = newRights.adminUserRights === true;

  user.rights = newRights;
  await saveStorage(KEY_USERS, usersDb);
  window.showNotification({ title: "Permissions Saved", message: `Access rights for @${user.username} updated!`, type: "success" });
  if (currentLoggedInUser && currentLoggedInUser.id === user.id) {
    currentLoggedInUser.rights = newRights;
    applyUserRightsToSidebar(currentLoggedInUser);
  }
};

function renderUsersTable() {
  const tbody = document.getElementById("userTableBody");
  if (!tbody) return;
  if (usersDb.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--muted); padding:20px;">No authorized users registered.</td></tr>`;
    return;
  }
  tbody.innerHTML = usersDb.map(u => `
    <tr>
      <td><strong>${u.name.toUpperCase()}</strong></td>
      <td><code>${u.username}</code></td>
      <td><span style="text-transform:uppercase; font-size:11px; font-weight:700; color:#0284c7;">${escapeSalesHtml(u.department || u.role)}</span></td>
      <td>${escapeSalesHtml(designationsDb.find(item => String(item.id) === String(u.designationId || ""))?.name || "-")}</td>
      <td><span style="display:inline-flex;min-width:34px;justify-content:center;padding:3px 9px;border-radius:999px;background:#e0f2fe;color:#075985;font-size:11px;font-weight:900;">${escapeSalesHtml(normalizeEmployeeLevel(u.employeeLevel) || "-")}</span></td>
      <td><span style="padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; ${u.status === 'ACTIVE' ? 'background:#dcfce7; color:#15803d;' : 'background:#fee2e2; color:#b91c1c;'}">${u.status}</span></td>
    </tr>
  `).join("");
}

window.saveNewUser = async function() {
  const name = document.getElementById("newEmpName").value.trim();
  const user = document.getElementById("newEmpUser").value.trim();
  const pass = document.getElementById("newEmpPass").value;
  const department = normalizeDepartmentName(document.getElementById("newEmpDepartment")?.value);
  const designationId = String(document.getElementById("newEmpDesignation")?.value || "");
  const employeeLevelElement = document.getElementById("newEmpLevel");
  const employeeLevel = normalizeEmployeeLevel(employeeLevelElement?.value);
  const employeeLevelSource = employeeLevelElement?.dataset.levelSource === "MANUAL" ? "MANUAL" : "AUTO";
  const role = user.toUpperCase() === "IT" && /^IT(?:\s+DEPARTMENT)?$/i.test(department) ? "admin" : getAccessRoleForDepartment(department);

  if (!name || !user || !pass || !department || !designationId || !employeeLevel) {
    window.showNotification({ title: "Missing Information", message: "Name, Username, Password, Department, Designation, and Employee Level are required.", type: "warning" });
    return; 
  }
  const departmentRecord=departmentsDb.find(item=>normalizeDepartmentName(item.name)===department);
  const designationRecord=designationsDb.find(item=>String(item.id)===designationId);
  if(!departmentRecord||!designationRecord||!designationDepartmentIds(designationRecord).includes(String(departmentRecord.id))){window.showNotification({title:"Invalid Designation",message:"Select a designation assigned to this employee's department.",type:"warning"});return;}
  if (usersDb.some(u => u.username.toLowerCase() === user.toLowerCase())) { 
    window.showNotification({ title: "User Exists", message: "This username already exists.", type: "danger" }); 
    return; 
  }

  const defaultNewRights = {
    dashboard: true, warehouse: (role === "warehouse" || role === "admin"),
    accounts: (role === "accounts" || role === "admin"),
    accountsDashboard: (role === "accounts" || role === "admin"),
    accountsInvoiceLogistics: (role === "accounts" || role === "admin"),
    accountsEditInvoice: (role === "accounts" || role === "admin"),
    accountsDeleteInvoice: (role === "accounts" || role === "admin"),
    accountsReceipt: (role === "accounts" || role === "admin"),
    accountsReports: (role === "accounts" || role === "admin"),
    accountsLedger: (role === "accounts" || role === "admin"),
    accountsOutstandingReceivable: (role === "accounts" || role === "admin"),
    accountsAdvanceFromCustomer: (role === "accounts" || role === "admin"),
    salesOrders: (role === "sales" || role === "admin"),
    salesOrderDashboard: (role === "sales" || role === "admin"),
    salesOrderAdd: (role === "sales" || role === "admin"),
    salesOrderView: (role === "sales" || role === "admin"),
    salesOrderAllocation: (role === "sales" || role === "admin"),
    salesOrderSerialTracking: (role === "sales" || role === "admin"),
    salesOrderEdit: (role === "sales" || role === "admin"),
    salesOrderDelete: (role === "sales" || role === "admin"),
    salesPersonMaster: (role === "sales" || role === "admin"),
    customerMaster: (role === "sales" || role === "admin"),
    purchase: (role === "purchase" || role === "admin"),
    purchaseVendorApprovals: (role === "purchase" || role === "admin"),
    purchaseVendorMaster: (role === "purchase" || role === "admin"),
    purchasePartCode: (role === "purchase" || role === "admin"),
    purchaseOrder: (role === "purchase" || role === "admin"),
    purchaseOrderView: (role === "purchase" || role === "admin"),
    purchaseOrderDelete: (role === "purchase" || role === "admin"),
    purchaseOrderApprovals: (role === "admin"),
    production: (role === "production" || role === "admin"),
    productionDashboard: (role === "production" || role === "admin"),
    productionAddDetails: (role === "production" || role === "admin"),
    productionEditSheet: (role === "production" || role === "admin"),
    productionDeleteSheet: (role === "production" || role === "admin"),
    productionViewSheet: (role === "production" || role === "admin"),
    productionDailyUpdate: (role === "production" || role === "admin"),
    storePpc: (role === "store" || role === "admin"),
    storeCreatePo: (role === "store" || role === "admin"),
    storeEditPo: (role === "store" || role === "admin"),
    storeUploadSerial: (role === "store" || role === "admin"),
    storeEditSerial: (role === "store" || role === "admin"),
    storeDeleteSerial: (role === "store" || role === "admin"),
    storeDeletePo: (role === "store" || role === "admin"),
    packing: (role === "packing" || role === "admin"),
    packingScan: (role === "packing" || role === "admin"),
    packingRework: (role === "packing" || role === "admin"),
    packingDeletePallet: (role === "packing" || role === "admin"),
    packingClosePo: (role === "packing" || role === "admin"),
    dispatch: (role === "dispatch" || role === "admin"),
    dispatchChallan: (role === "dispatch" || role === "admin"),
    dispatchBookedStock: (role === "dispatch" || role === "admin"),
    dispatchViewList: (role === "dispatch" || role === "admin"),
    dispatchRouteFare: (role === "dispatch" || role === "admin"),
    dispatchBookVehicle: (role === "dispatch" || role === "admin"),
    dispatchDelete: (role === "dispatch" || role === "admin"),
    transporterView: (role === "dispatch" || role === "admin"),
    transporterAdd: (role === "dispatch" || role === "admin"),
    transporterEdit: (role === "dispatch" || role === "admin"),
    transporterDelete: (role === "dispatch" || role === "admin"),
    driverView: (role === "dispatch" || role === "admin"),
    driverAdd: (role === "dispatch" || role === "admin"),
    driverEdit: (role === "dispatch" || role === "admin"),
    driverDelete: (role === "dispatch" || role === "admin"),
    requests: true,
    requestsTrack: true,
    requestsApprove: (role === "admin"),
    requestRoutes: (role === "admin"),
    tripExpenses: true,
    hrTourExpenses: true,
    expensesRecharge: true,
    departmentView: (role === "hr" || role === "admin"), departmentAdd: (role === "hr" || role === "admin"), departmentEdit: (role === "hr" || role === "admin"), departmentDelete: (role === "hr" || role === "admin"),
    designationView: (role === "hr" || role === "admin"), designationAdd: (role === "hr" || role === "admin"), designationEdit: (role === "hr" || role === "admin"), designationDelete: (role === "hr" || role === "admin"),
    products: (role === "admin"), productsView: (role === "admin"),
    productsAdd: (role === "admin"), productsEdit: (role === "admin"), productsDelete: (role === "admin"),
    users: (role === "admin"), adminUsers: (role === "admin"), adminAddUser: (role === "admin"),
    adminEditUser: (role === "admin"), adminDeleteUser: (role === "admin"), adminUserRights: (role === "admin"),
    it: (role === "admin"),
    itSecuritySessions: (role === "admin"), itRoleTemplates: (role === "admin"), itEffectiveAccess: (role === "admin"),
    itAssetDashboard: (role === "admin"), itAssetMaster: (role === "admin"), itAssetAllocation: (role === "admin"),
    itPerformance: (role === "admin"),
    hr: (role === "hr" || role === "admin"), hrEmployeeAdd: (role === "hr" || role === "admin"), hrEmployeeEdit: (role === "hr" || role === "admin"), hrEmployeeDelete: (role === "hr" || role === "admin"), hrAttendanceView: (role === "hr" || role === "admin"), hrAttendanceManual: (role === "hr" || role === "admin"),
    cctv: (role === "admin"), cctvLive: (role === "admin"), cctvPlayback: (role === "admin"), cctvAdmin: (role === "admin"),
    reports: true,
    reportsPacking: (role === "packing" || role === "admin"),
    reportsDispatch: (role === "dispatch" || role === "admin"),
    reportsCustom: true, reportsDailyDept: true,
    logs: (role === "admin"),
    logsPacking: (role === "packing" || role === "admin"),
    logsDispatch: (role === "dispatch" || role === "admin"),
    logsSystem: (role === "admin")
  };

  const newUser = { id: Date.now(), name, username: user, password: pass, role, department, designationId, employeeLevel, employeeLevelSource, status: "ACTIVE", rights: defaultNewRights };
  usersDb.push(newUser);
  await saveStorage(KEY_USERS, usersDb);

  window.showNotification({ title: "User Registered", message: `User '@${user}' saved in ${department} Department.`, type: "success" });
  document.getElementById("newEmpName").value = "";
  document.getElementById("newEmpUser").value = "";
  document.getElementById("newEmpPass").value = "";
  document.getElementById("newEmpDepartment").value = "";
  if (employeeLevelElement) { employeeLevelElement.value = ""; employeeLevelElement.dataset.levelSource = ""; }
  window.populateNewUserDesignationDropdown();

  renderUsersTable();
  switchView("adminUsers", null, "IT > User Management > All Users");
};

window.openEditUserView = function(btnEl) {
  switchView('adminEditUser', btnEl, 'IT > User Management > Edit User');
  populateEditUserDropdown();
};

function populateEditUserDropdown() {
  const sel = document.getElementById("editSelectUser");
  if (!sel) return;
  populateEditUserDepartmentDropdown();
  if (usersDb.length === 0) { sel.innerHTML = `<option value="">-- No users registered --</option>`; onSelectUserToEdit(); return; }
  sel.innerHTML = `<option value="">-- Select User to Modify --</option>` + usersDb.map(u => `
    <option value="${u.id}">${u.name.toUpperCase()} (@${u.username})</option>
  `).join("");
  onSelectUserToEdit();
}

window.onSelectUserToEdit = function() {
  const selectedId = parseInt(document.getElementById("editSelectUser").value, 10);
  const user = usersDb.find(u => u.id === selectedId);
  if (user) {
    document.getElementById("editEmpName").value = user.name;
    document.getElementById("editEmpUsername").value = user.username;
    document.getElementById("editEmpPassword").value = "";
    populateEditUserDepartmentDropdown(user.department || getDepartmentNameForRole(user.role));
    window.populateEditUserDesignationDropdown(user.designationId || "");
    const savedLevel = normalizeEmployeeLevel(user.employeeLevel) || employeeLevelForDesignationId(user.designationId);
    setEmployeeLevelSelection("edit", savedLevel, user.employeeLevel ? (user.employeeLevelSource || "MANUAL") : "AUTO");
    document.getElementById("editEmpStatus").value = user.status;
  } else {
    populateEditUserDepartmentDropdown();
    window.populateEditUserDesignationDropdown();
    setEmployeeLevelSelection("edit", "", "");
  }
};

window.saveEditedUser = async function() {
  const selectedId = parseInt(document.getElementById("editSelectUser").value, 10);
  const user = usersDb.find(u => u.id === selectedId);
  if (!user) return;

  user.name = document.getElementById("editEmpName").value.trim();
  user.username = document.getElementById("editEmpUsername").value.trim();
  const newPass = document.getElementById("editEmpPassword").value;
  if (newPass.trim() !== "") user.password = newPass.trim();
  const department = normalizeDepartmentName(document.getElementById("editEmpDepartment")?.value);
  if (!department) {
    window.showNotification({ title: "Department Required", message: "Select a department before saving this user.", type: "warning" });
    return;
  }
  user.department = department;
  const designationId=String(document.getElementById("editEmpDesignation")?.value||"");
  const departmentRecord=departmentsDb.find(item=>normalizeDepartmentName(item.name)===department);
  const designationRecord=designationsDb.find(item=>String(item.id)===designationId);
  if(!designationId||!departmentRecord||!designationRecord||!designationDepartmentIds(designationRecord).includes(String(departmentRecord.id))){window.showNotification({title:"Designation Required",message:"Select a designation assigned to this user's department.",type:"warning"});return;}
  user.designationId=designationId;
  const employeeLevelElement=document.getElementById("editEmpLevel");
  const employeeLevel=normalizeEmployeeLevel(employeeLevelElement?.value);
  if(!employeeLevel){window.showNotification({title:"Employee Level Required",message:"Select Level A, Level B, or Level C before saving this user.",type:"warning"});return;}
  user.employeeLevel=employeeLevel;
  user.employeeLevelSource=employeeLevelElement?.dataset.levelSource==="MANUAL"?"MANUAL":"AUTO";
  user.role = String(user.username || "").toUpperCase() === "IT" && /^IT(?:\s+DEPARTMENT)?$/i.test(department) ? "admin" : getAccessRoleForDepartment(department);
  user.status = document.getElementById("editEmpStatus").value;

  await saveStorage(KEY_USERS, usersDb);
  window.showNotification({ title: "Account Updated", message: `User @${user.username} saved successfully!`, type: "success" });
  renderUsersTable();
  populateEditUserDropdown();
};

function renderProductTables() {
  const editBody = document.getElementById("productsEditBody");
  const delBody = document.getElementById("productsDeleteBody");
  if (!editBody || !delBody) return;

  if (productsDb.length === 0) {
    editBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--muted); padding:20px;">No products in master catalog.</td></tr>`;
    delBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--muted); padding:20px;">No products in master catalog.</td></tr>`;
    return;
  }

  editBody.innerHTML = productsDb.map(p => `
    <tr>
      <td><strong>${p.name}</strong></td>
      <td>${p.watt}</td>
      <td><span style="font-weight:bold; color:${p.cellType === 'DCR' ? '#7c3aed' : '#0284c7'};">${p.cellType || 'NON - DCR'}</span></td>
      <td><button class="btn btn-secondary" style="padding:4px 8px; font-size:11px;" onclick="promptEditProduct(${p.id})">Edit</button></td>
    </tr>
  `).join("");

  delBody.innerHTML = productsDb.map(p => `
    <tr>
      <td><strong>${p.name}</strong></td>
      <td>${p.watt}</td>
      <td><span style="font-weight:bold; color:${p.cellType === 'DCR' ? '#7c3aed' : '#0284c7'};">${p.cellType || 'NON - DCR'}</span></td>
      <td><button class="btn btn-danger" style="padding:4px 8px; font-size:11px;" onclick="deleteProduct(${p.id})">Delete</button></td>
    </tr>
  `).join("");
}

window.promptEditProduct = async function(id) {
  const p = productsDb.find(prod => prod.id === id);
  if (!p) return;
  const newName = await window.showPromptDialog({
    title: "Edit Product Name",
    message: `Current Model: "${p.name}"`,
    label: "New Model Description *",
    defaultValue: p.name
  });
  if (newName && newName.trim() !== "") {
    p.name = newName.trim().toUpperCase();
    await saveStorage(KEY_PRODUCTS, productsDb);
    window.showNotification({ title: "Product Updated", message: `Catalog entry renamed to ${p.name}`, type: "success" });
    renderProductTables();
    renderProductsViewTable();
    populateProductDropdowns();
  }
};

window.deleteProduct = async function(id) {
  const prod = productsDb.find(p => p.id === id);
  if (!prod) return;
  const confirmed = await window.showConfirmDialog({
    title: "Delete Product",
    message: `Delete product model "${prod.name}" from catalog?`,
    confirmText: "Delete Product",
    isDanger: true
  });
  if (confirmed) {
    productsDb = productsDb.filter(p => p.id !== id);
    await saveStorage(KEY_PRODUCTS, productsDb);
    window.showNotification({ title: "Product Deleted", message: `Removed "${prod.name}" from catalog.`, type: "info" });
    renderProductTables();
    renderProductsViewTable();
    populateProductDropdowns();
  }
};

function normalizeDepartmentName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

const EMPLOYEE_LEVEL_BY_DESIGNATION = Object.freeze({
  "DIRECTOR": "A", "SENIOR DIRECTOR": "A", "CEO": "A", "MD": "A", "PRESIDENT": "A", "BUSINESS HEAD": "A",
  "GM": "B", "DGM": "B", "AGM": "B", "SENIOR MANAGER": "B", "MANAGER": "B", "DEPARTMENT HEAD": "B",
  "EXECUTIVE": "C", "SENIOR EXECUTIVE": "C", "OFFICER": "C", "ENGINEER": "C", "SENIOR ENGINEER": "C", "ASSISTANT MANAGER": "C"
});

function normalizeEmployeeLevel(value) {
  const level = String(value || "").trim().toUpperCase().replace(/^LEVEL\s+/, "");
  return ["A", "B", "C"].includes(level) ? level : "";
}

function normalizeDesignationForEmployeeLevel(value) {
  return String(value || "").trim().toUpperCase()
    .replace(/[.]/g, "")
    .replace(/\bSR\b/g, "SENIOR")
    .replace(/\bASST\b/g, "ASSISTANT")
    .replace(/\s+/g, " ");
}

function employeeLevelForDesignationId(designationId) {
  const designation = (designationsDb || []).find(item => String(item.id) === String(designationId || ""));
  return EMPLOYEE_LEVEL_BY_DESIGNATION[normalizeDesignationForEmployeeLevel(designation?.name)] || "";
}

function setEmployeeLevelSelection(prefix, level, source) {
  const select = document.getElementById(prefix === "edit" ? "editEmpLevel" : "newEmpLevel");
  const hint = document.getElementById(prefix === "edit" ? "editEmpLevelHint" : "newEmpLevelHint");
  if (!select) return;
  select.value = normalizeEmployeeLevel(level);
  select.dataset.levelSource = select.value ? (source === "MANUAL" ? "MANUAL" : "AUTO") : "";
  if (hint) hint.textContent = !select.value
    ? "This designation has no automatic mapping. Select Level A, B, or C manually."
    : select.dataset.levelSource === "MANUAL"
      ? `Manual override selected: Level ${select.value}. This level will control TA/DA rules.`
      : `Automatically selected from designation: Level ${select.value}. You may override it if required.`;
}

window.markUserLevelManual = function(prefix) {
  const select = document.getElementById(prefix === "edit" ? "editEmpLevel" : "newEmpLevel");
  if (!select) return;
  setEmployeeLevelSelection(prefix, select.value, select.value ? "MANUAL" : "");
};

window.syncNewUserLevelFromDesignation = function() {
  setEmployeeLevelSelection("new", employeeLevelForDesignationId(document.getElementById("newEmpDesignation")?.value), "AUTO");
};

window.syncEditUserLevelFromDesignation = function() {
  setEmployeeLevelSelection("edit", employeeLevelForDesignationId(document.getElementById("editEmpDesignation")?.value), "AUTO");
};

function getAccessRoleForDepartment(departmentName) {
  const name = normalizeDepartmentName(departmentName).toLowerCase();
  if (/\b(account|accounts|finance)\b/.test(name)) return "accounts";
  if (/\b(sales|marketing)\b/.test(name)) return "sales";
  if (/\b(purchase|procurement)\b/.test(name)) return "purchase";
  if (/\b(store|ppc)\b/.test(name)) return "store";
  if (/\bproduction\b/.test(name)) return "production";
  if (/\bpack\b/.test(name)) return "packing";
  if (/\bdispatch|logistics\b/.test(name)) return "dispatch";
  if (/\bwarehouse|godown\b/.test(name)) return "warehouse";
  if (/\badministration|admin department\b/.test(name)) return "administration";
  if (/\bmanagement\b/.test(name)) return "management";
  if (/\binformation technology|it department|\bit\b/.test(name)) return "it";
  return "department";
}

function populateNewUserDepartmentDropdown() {
  const select = document.getElementById("newEmpDepartment");
  if (!select) return;
  const current = String(select.value || "");
  select.innerHTML = `<option value="">${departmentsDb.length ? "-- Select Department --" : "-- Add Department in Department Master First --"}</option>` + departmentsDb.map(department => `<option value="${escapeSalesHtml(department.name)}">${escapeSalesHtml(department.name)}</option>`).join("");
  if (departmentsDb.some(department => department.name === current)) select.value = current;
  window.populateNewUserDesignationDropdown?.();
}

function getDepartmentNameForRole(role) {
  const matchingDepartment = departmentsDb.find(department => getAccessRoleForDepartment(department.name) === role);
  return matchingDepartment ? matchingDepartment.name : "";
}

function populateEditUserDepartmentDropdown(selectedDepartment = "") {
  const select = document.getElementById("editEmpDepartment");
  if (!select) return;
  const current = normalizeDepartmentName(selectedDepartment || select.value);
  select.innerHTML = `<option value="">${departmentsDb.length ? "-- Select Department --" : "-- Add Department in Department Master First --"}</option>` + departmentsDb.map(department => `<option value="${escapeSalesHtml(department.name)}">${escapeSalesHtml(department.name)}</option>`).join("");
  const matchingDepartment = departmentsDb.find(department => department.name === current);
  if (matchingDepartment) select.value = matchingDepartment.name;
}

function designationOptionsForDepartment(departmentName, selectedId = "") {
  const department = (departmentsDb || []).find(item => normalizeDepartmentName(item.name).toLowerCase() === normalizeDepartmentName(departmentName).toLowerCase());
  const available = department ? (designationsDb || []).filter(designation => String(designation.status || "ACTIVE").toUpperCase() !== "INACTIVE" && designationDepartmentIds(designation).includes(String(department.id))) : [];
  const placeholder = !departmentName ? "-- Select Department First --" : available.length ? "-- Select Designation --" : "-- No Designation Assigned to Department --";
  return `<option value="">${placeholder}</option>` + available.sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""))).map(designation => `<option value="${escapeSalesHtml(designation.id)}"${String(designation.id) === String(selectedId) ? " selected" : ""}>${escapeSalesHtml(designation.name)}</option>`).join("");
}

window.populateNewUserDesignationDropdown = function(selectedId = "") {
  const select=document.getElementById("newEmpDesignation");if(!select)return;
  const keep=String(selectedId||select.value||"");select.innerHTML=designationOptionsForDepartment(document.getElementById("newEmpDepartment")?.value,keep);
  window.syncNewUserLevelFromDesignation();
};

window.populateEditUserDesignationDropdown = function(selectedId = "") {
  const select=document.getElementById("editEmpDesignation");if(!select)return;
  const keep=String(selectedId||select.value||"");select.innerHTML=designationOptionsForDepartment(document.getElementById("editEmpDepartment")?.value,keep);
  window.syncEditUserLevelFromDesignation();
};

window.renderDepartmentsTable = function() {
  const tbody = document.getElementById("departmentTableBody");
  if (!tbody) return;
  if (!(departmentsDb || []).length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:24px; color:var(--muted);">No departments added yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = departmentsDb.map((department, index) => `<tr>
    <td>${index + 1}</td><td><strong>${escapeSalesHtml(department.name)}</strong></td><td>${escapeSalesHtml(department.createdAt || "-")}</td><td>${escapeSalesHtml(department.createdBy || "SYSTEM")}</td>
  </tr>`).join("");
};

function populateDepartmentEditDropdown() {
  const select = document.getElementById("departmentEditSelect");
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${departmentsDb.length ? "-- Select Department --" : "-- No Departments Added --"}</option>` + departmentsDb.map(department => `<option value="${escapeSalesHtml(department.id)}">${escapeSalesHtml(department.name)}</option>`).join("");
  if (departmentsDb.some(department => String(department.id) === String(current))) select.value = current;
  window.loadDepartmentForEdit();
}

function populateDepartmentDeleteDropdown() {
  const select = document.getElementById("departmentDeleteSelect");
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${departmentsDb.length ? "-- Select Department --" : "-- No Departments Added --"}</option>` + departmentsDb.map(department => `<option value="${escapeSalesHtml(department.id)}">${escapeSalesHtml(department.name)}</option>`).join("");
  if (departmentsDb.some(department => String(department.id) === String(current))) select.value = current;
  window.showDepartmentDeleteInfo();
}

window.addDepartment = async function() {
  const input = document.getElementById("departmentAddName");
  const name = normalizeDepartmentName(input?.value);
  if (!name) {
    window.showNotification({ title: "Department Name Required", message: "Enter a department name before saving.", type: "warning" });
    input?.focus();
    return;
  }
  if (departmentsDb.some(department => normalizeDepartmentName(department.name).toLowerCase() === name.toLowerCase())) {
    window.showNotification({ title: "Duplicate Department", message: `Department "${name}" already exists.`, type: "warning" });
    return;
  }
  departmentsDb.push({ id: `DEPT-${Date.now()}`, name, createdAt: new Date().toLocaleString(), createdBy: currentLoggedInUser?.username || "SYSTEM" });
  await saveStorage(KEY_DEPARTMENTS, departmentsDb);
  await logEvent("SYSTEM", "DEPARTMENT_ADDED", `Added Department: ${name}.`);
  if (input) input.value = "";
  renderDepartmentsTable();
  populateDepartmentEditDropdown();
  populateDepartmentDeleteDropdown();
  populateNewUserDepartmentDropdown();
  populateEditUserDepartmentDropdown();
  window.populateDesignationDepartmentDropdowns?.();
  window.showNotification({ title: "Department Added", message: `${name} has been added to Department Master.`, type: "success" });
};

window.loadDepartmentForEdit = function() {
  const id = String(document.getElementById("departmentEditSelect")?.value || "");
  const department = departmentsDb.find(item => String(item.id) === id);
  const input = document.getElementById("departmentEditName");
  if (input) input.value = department ? department.name : "";
};

window.saveDepartmentEdit = async function() {
  const id = String(document.getElementById("departmentEditSelect")?.value || "");
  const department = departmentsDb.find(item => String(item.id) === id);
  if (!department) {
    window.showNotification({ title: "Select Department", message: "Select a department before saving changes.", type: "warning" });
    return;
  }
  const name = normalizeDepartmentName(document.getElementById("departmentEditName")?.value);
  if (!name) {
    window.showNotification({ title: "Department Name Required", message: "Enter a department name before saving.", type: "warning" });
    return;
  }
  if (departmentsDb.some(item => item.id !== department.id && normalizeDepartmentName(item.name).toLowerCase() === name.toLowerCase())) {
    window.showNotification({ title: "Duplicate Department", message: `Department "${name}" already exists.`, type: "warning" });
    return;
  }
  const previousName = department.name;
  department.name = name;
  department.updatedAt = new Date().toLocaleString();
  department.updatedBy = currentLoggedInUser?.username || "SYSTEM";
  designationsDb.forEach(designation => {
    if (designation.department === previousName) designation.department = name;
    if (Array.isArray(designation.departments)) designation.departments = designation.departments.map(item => item === previousName ? name : item);
  });
  await Promise.all([saveStorage(KEY_DEPARTMENTS, departmentsDb), saveStorage(KEY_DESIGNATIONS, designationsDb)]);
  await logEvent("SYSTEM", "DEPARTMENT_EDITED", `Renamed Department: ${previousName} → ${name}.`);
  renderDepartmentsTable();
  populateDepartmentEditDropdown();
  populateDepartmentDeleteDropdown();
  populateNewUserDepartmentDropdown();
  populateEditUserDepartmentDropdown();
  window.populateDesignationDepartmentDropdowns?.();
  window.showNotification({ title: "Department Updated", message: `${name} has been updated.`, type: "success" });
};

window.showDepartmentDeleteInfo = function() {
  const id = String(document.getElementById("departmentDeleteSelect")?.value || "");
  const department = departmentsDb.find(item => String(item.id) === id);
  const info = document.getElementById("departmentDeleteInfo");
  if (!info) return;
  info.innerHTML = department
    ? `<strong style="color:#0f172a;">${escapeSalesHtml(department.name)}</strong><br><span>Created: ${escapeSalesHtml(department.createdAt || "-")} · By: ${escapeSalesHtml(department.createdBy || "SYSTEM")}</span>`
    : "Select a department to review it before deletion.";
};

window.deleteDepartment = async function() {
  const id = String(document.getElementById("departmentDeleteSelect")?.value || "");
  const department = departmentsDb.find(item => String(item.id) === id);
  if (!department) {
    window.showNotification({ title: "Select Department", message: "Select a department before deleting it.", type: "warning" });
    return;
  }
  if ((designationsDb || []).some(designation => designationDepartmentIds(designation).includes(String(department.id)))) {
    window.showNotification({ title: "Department In Use", message: "Reassign or remove its designations before deleting this department.", type: "warning" });
    return;
  }
  const confirmed = await window.showConfirmDialog({
    title: "Delete Department",
    message: `Delete the Department "${department.name}"? This cannot be undone.`,
    confirmText: "Delete Department",
    isDanger: true
  });
  if (!confirmed) return;
  departmentsDb = departmentsDb.filter(item => item.id !== department.id);
  await saveStorage(KEY_DEPARTMENTS, departmentsDb);
  await logEvent("SYSTEM", "DEPARTMENT_DELETED", `Deleted Department: ${department.name}.`);
  renderDepartmentsTable();
  populateDepartmentEditDropdown();
  populateDepartmentDeleteDropdown();
  populateNewUserDepartmentDropdown();
  populateEditUserDepartmentDropdown();
  window.populateDesignationDepartmentDropdowns?.();
  window.showNotification({ title: "Department Deleted", message: `${department.name} has been deleted from Department Master.`, type: "success" });
};

function normalizeDesignationName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeDesignationCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20);
}

function designationDepartmentIds(designation) {
  if (!designation || typeof designation !== "object") return [];
  const validIds = new Set((departmentsDb || []).map(department => String(department.id)));
  let ids = Array.isArray(designation.departmentIds) ? designation.departmentIds.map(String) : [];
  if (!ids.length && Array.isArray(designation.departments)) {
    ids = designation.departments.map(name => departmentsDb.find(department => normalizeDepartmentName(department.name).toLowerCase() === normalizeDepartmentName(name).toLowerCase())?.id).filter(Boolean).map(String);
  }
  if (!ids.length && normalizeDepartmentName(designation.department)) {
    const legacyDepartment = departmentsDb.find(department => normalizeDepartmentName(department.name).toLowerCase() === normalizeDepartmentName(designation.department).toLowerCase());
    if (legacyDepartment) ids = [String(legacyDepartment.id)];
  }
  // Older records were saved as "Company-wide" with an empty department.
  // Preserve their availability until HR explicitly edits their assignments.
  if (!Object.prototype.hasOwnProperty.call(designation, "departmentIds") && !ids.length) ids = (departmentsDb || []).map(department => String(department.id));
  return [...new Set(ids.filter(id => validIds.has(id)))];
}

function designationDepartmentNames(designation) {
  const ids = new Set(designationDepartmentIds(designation));
  return (departmentsDb || []).filter(department => ids.has(String(department.id))).map(department => department.name);
}

function renderDesignationDepartmentChecklist(containerId, selectedIds = []) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const selected = new Set((selectedIds || []).map(String));
  container.innerHTML = departmentsDb.length ? departmentsDb.map(department => `<label class="designation-department-option"><input type="checkbox" value="${escapeSalesHtml(department.id)}"${selected.has(String(department.id)) ? " checked" : ""}><span>${escapeSalesHtml(department.name)}</span></label>`).join("") : '<div class="designation-department-empty">Add departments in Department Master first.</div>';
}

function selectedDesignationDepartmentIds(containerId) {
  return [...document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)].map(input => String(input.value));
}

window.populateDesignationDepartmentDropdowns = function() {
  renderDesignationDepartmentChecklist("designationAddDepartments", selectedDesignationDepartmentIds("designationAddDepartments"));
  const editing = designationsDb.find(item => String(item.id) === String(document.getElementById("designationEditSelect")?.value || ""));
  renderDesignationDepartmentChecklist("designationEditDepartments", editing ? designationDepartmentIds(editing) : []);
};

window.renderDesignationsTable = function() {
  const tbody = document.getElementById("designationTableBody");
  if (!tbody) return;
  const rows = [...(designationsDb || [])].sort((a, b) => Number(b.level || 0) - Number(a.level || 0) || String(a.name || "").localeCompare(String(b.name || "")));
  tbody.innerHTML = rows.length ? rows.map((designation, index) => { const names=designationDepartmentNames(designation);return `<tr><td>${index + 1}</td><td><strong>${escapeSalesHtml(designation.code)}</strong></td><td>${escapeSalesHtml(designation.name)}</td><td><div class="designation-department-tags">${names.length ? names.map(name => `<span class="designation-department-tag">${escapeSalesHtml(name)}</span>`).join("") : '<span style="color:var(--muted);">Not assigned</span>'}</div></td><td>${Number(designation.level || 1)}</td><td><span class="status ${designation.status === "INACTIVE" ? "status-cancelled" : "status-completed"}">${escapeSalesHtml(designation.status || "ACTIVE")}</span></td></tr>`; }).join("") : `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--muted);">No designations added yet.</td></tr>`;
};

window.prepareDesignationAddView = function() {
  const input = document.getElementById("designationAddName");
  if (input) input.value = "";
  renderDesignationDepartmentChecklist("designationAddDepartments", []);
};

window.populateDesignationEditDropdown = function() {
  const select = document.getElementById("designationEditSelect");
  if (!select) return;
  const current = String(select.value || "");
  select.innerHTML = `<option value="">${designationsDb.length ? "-- Select Designation --" : "-- No Designations Added --"}</option>` + designationsDb.map(item => `<option value="${escapeSalesHtml(item.id)}">${escapeSalesHtml(item.code)} · ${escapeSalesHtml(item.name)}</option>`).join("");
  if (designationsDb.some(item => String(item.id) === current)) select.value = current;
  window.loadDesignationForEdit();
};

window.populateDesignationDeleteDropdown = function() {
  const select = document.getElementById("designationDeleteSelect");
  if (!select) return;
  const current = String(select.value || "");
  select.innerHTML = `<option value="">${designationsDb.length ? "-- Select Designation --" : "-- No Designations Added --"}</option>` + designationsDb.map(item => `<option value="${escapeSalesHtml(item.id)}">${escapeSalesHtml(item.code)} · ${escapeSalesHtml(item.name)}</option>`).join("");
  if (designationsDb.some(item => String(item.id) === current)) select.value = current;
  window.showDesignationDeleteInfo();
};

window.addDesignation = async function() {
  const name = normalizeDesignationName(document.getElementById("designationAddName")?.value);
  const departmentIds = selectedDesignationDepartmentIds("designationAddDepartments");
  if (!name) {
    window.showNotification({ title: "Designation Name Required", message: "Enter a designation name before saving.", type: "warning" });
    document.getElementById("designationAddName")?.focus();
    return;
  }
  if (designationsDb.some(item => normalizeDesignationName(item.name).toLowerCase() === name.toLowerCase())) {
    window.showNotification({ title: "Duplicate Designation", message: `Designation "${name}" already exists.`, type: "warning" });
    return;
  }
  if (!departmentIds.length) {
    window.showNotification({ title: "Department Required", message: "Select at least one department for this designation.", type: "warning" });
    return;
  }
  const baseCode = normalizeDesignationCode(name) || "DESIGNATION";
  let code = baseCode;
  let suffix = 2;
  while (designationsDb.some(item => String(item.code || "").toUpperCase() === code)) code = `${baseCode.slice(0, 16)}-${suffix++}`;
  designationsDb.push({ id: `DESIG-${Date.now()}`, code, name, departmentIds, level: 1, status: "ACTIVE", createdAt: new Date().toLocaleString(), createdBy: currentLoggedInUser?.username || "SYSTEM" });
  await saveStorage(KEY_DESIGNATIONS, designationsDb);
  await logEvent("HR", "DESIGNATION_ADDED", `Added Designation: ${code} · ${name}; departments: ${designationDepartmentNames(designationsDb[designationsDb.length - 1]).join(", ")}.`);
  window.prepareDesignationAddView();
  window.renderDesignationsTable();
  window.populateDesignationEditDropdown();
  window.populateDesignationDeleteDropdown();
  window.showNotification({ title: "Designation Added", message: `${name} has been added to Designation Master.`, type: "success" });
};

window.loadDesignationForEdit = function() {
  const designation = designationsDb.find(item => String(item.id) === String(document.getElementById("designationEditSelect")?.value || ""));
  const input = document.getElementById("designationEditName");
  if (input) input.value = designation?.name || "";
  renderDesignationDepartmentChecklist("designationEditDepartments", designation ? designationDepartmentIds(designation) : []);
};

window.saveDesignationEdit = async function() {
  const designation = designationsDb.find(item => String(item.id) === String(document.getElementById("designationEditSelect")?.value || ""));
  if (!designation) return window.showNotification({ title: "Select Designation", message: "Select a designation before saving changes.", type: "warning" });
  const name = normalizeDesignationName(document.getElementById("designationEditName")?.value);
  const departmentIds = selectedDesignationDepartmentIds("designationEditDepartments");
  if (!name) return window.showNotification({ title: "Designation Name Required", message: "Enter a designation name before saving.", type: "warning" });
  if (designationsDb.some(item => item.id !== designation.id && normalizeDesignationName(item.name).toLowerCase() === name.toLowerCase())) return window.showNotification({ title: "Duplicate Designation", message: `Designation "${name}" already exists.`, type: "warning" });
  if (!departmentIds.length) return window.showNotification({ title: "Department Required", message: "Select at least one department for this designation.", type: "warning" });
  const previous = `${designation.code} · ${designation.name}`;
  const baseCode = normalizeDesignationCode(name) || "DESIGNATION";
  let code = baseCode;
  let suffix = 2;
  while (designationsDb.some(item => item.id !== designation.id && String(item.code || "").toUpperCase() === code)) code = `${baseCode.slice(0, 16)}-${suffix++}`;
  Object.assign(designation, { code, name, departmentIds, updatedAt: new Date().toLocaleString(), updatedBy: currentLoggedInUser?.username || "SYSTEM" });
  delete designation.department;
  delete designation.departments;
  delete designation.managerEligible;
  delete designation.managementLevel;
  delete designation.ownerLevel;
  await saveStorage(KEY_DESIGNATIONS, designationsDb);
  await logEvent("HR", "DESIGNATION_EDITED", `Updated Designation: ${previous} → ${code} · ${name}; departments: ${designationDepartmentNames(designation).join(", ")}.`);
  window.renderDesignationsTable(); window.populateDesignationEditDropdown(); window.populateDesignationDeleteDropdown();
  window.showNotification({ title: "Designation Updated", message: `${name} has been updated.`, type: "success" });
};

window.showDesignationDeleteInfo = function() {
  const designation = designationsDb.find(item => String(item.id) === String(document.getElementById("designationDeleteSelect")?.value || ""));
  const info = document.getElementById("designationDeleteInfo");
  if (!info) return;
  info.innerHTML = designation ? `<strong style="color:#0f172a;">${escapeSalesHtml(designation.code)} · ${escapeSalesHtml(designation.name)}</strong><br><span>${escapeSalesHtml(designationDepartmentNames(designation).join(", ") || "Not assigned")} · Level ${Number(designation.level || 1)} · ${designation.status || "ACTIVE"}</span>` : "Select a designation to review it before deletion.";
};

window.deleteDesignation = async function() {
  const designation = designationsDb.find(item => String(item.id) === String(document.getElementById("designationDeleteSelect")?.value || ""));
  if (!designation) return window.showNotification({ title: "Select Designation", message: "Select a designation before deleting it.", type: "warning" });
  if ((usersDb || []).some(user => String(user.designationId || "") === String(designation.id))) return window.showNotification({ title: "Designation In Use", message: "Reassign employees using this designation before deleting it.", type: "warning" });
  const confirmed = await window.showConfirmDialog({ title: "Delete Designation", message: `Delete "${designation.name}"? This cannot be undone.`, confirmText: "Delete Designation", isDanger: true });
  if (!confirmed) return;
  designationsDb = designationsDb.filter(item => item.id !== designation.id);
  await saveStorage(KEY_DESIGNATIONS, designationsDb);
  await logEvent("HR", "DESIGNATION_DELETED", `Deleted Designation: ${designation.code} · ${designation.name}.`);
  window.renderDesignationsTable(); window.populateDesignationEditDropdown(); window.populateDesignationDeleteDropdown();
  window.showNotification({ title: "Designation Deleted", message: `${designation.name} has been deleted.`, type: "success" });
};

window.handleTransporterMasterGstInput = function() {
  const gstInput = document.getElementById("trAddGst");
  const panInput = document.getElementById("trAddPan");
  if (!gstInput || !panInput) return;
  const gst = accountInvoiceKey(gstInput.value).replace(/[^A-Z0-9]/g, "").slice(0, 15);
  gstInput.value = gst;
  panInput.value = gst.length >= 12 ? gst.slice(2, 12) : "";
};

window.saveNewTransporter = async function() {
  const value = id => String(document.getElementById(id)?.value || "").trim();
  const name = value("trAddName").toUpperCase();
  const person = value("trAddPerson");
  const phone = value("trAddPhone");
  const email = value("trAddEmail");
  const gst = accountInvoiceKey(value("trAddGst")).replace(/[^A-Z0-9]/g, "");
  const pan = accountInvoiceKey(value("trAddPan"));
  const address = value("trAddAddress");
  if (!name || !person || !phone || !address) {
    window.showNotification({ title: "Transporter Details Required", message: "Complete Transporter Name, Contact Person, Mobile Number and Address.", type: "warning" });
    return;
  }
  if (!/^\d{10}$/.test(phone)) {
    window.showNotification({ title: "Invalid Mobile Number", message: "Enter a valid 10-digit transporter mobile number.", type: "warning" });
    return;
  }
  if (gst && (gst.length !== 15 || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) || pan !== gst.slice(2, 12))) {
    window.showNotification({ title: "Invalid GST Number", message: "Enter a valid 15-character GSTIN. PAN is fetched automatically from characters 3–12.", type: "warning" });
    return;
  }
  if (email && !/^\S+@\S+\.\S+$/.test(email)) {
    window.showNotification({ title: "Invalid E-mail", message: "Enter a valid transporter e-mail or leave it blank.", type: "warning" });
    return;
  }
  const duplicate = (Array.isArray(transportersDb) ? transportersDb : []).find(item => accountInvoiceKey(item.name) === accountInvoiceKey(name) || (gst && accountInvoiceKey(item.gst) === gst));
  if (duplicate) {
    window.showNotification({ title: "Transporter Already Exists", message: `${duplicate.name} is already saved in Transporter Master.`, type: "warning" });
    return;
  }
  const transporter = { id: `TR-${Date.now()}`, name, person, phone, email, gst, pan, address, createdAt: new Date().toISOString(), createdBy: currentLoggedInUser?.username || "SYSTEM" };
  transportersDb.unshift(transporter);
  const saved = await saveStorage(KEY_TRANSPORTERS, transportersDb);
  if (saved === false) {
    transportersDb = transportersDb.filter(item => item.id !== transporter.id);
    return;
  }
  await logEvent("DISPATCH", "TRANSPORTER_ADDED", `Added transporter ${name}${gst ? ` with GST ${gst}` : " without GST"}.`);
  ["trAddName", "trAddPerson", "trAddPhone", "trAddEmail", "trAddGst", "trAddPan", "trAddAddress"].forEach(id => accountSetValue(id));
  populateDispatchTransportersDropdown();
  populateAccountTransporterDropdown();
  populateDriverTransporterDropdowns();
  renderTransporterTable();
  window.showNotification({ title: "Transporter Saved", message: `${name} is now available in the Accounts transporter dropdown.`, type: "success" });
};

function populateTransporterEditDropdown() {
  const select = document.getElementById("trEditSelect");
  if (!select) return;
  const current = String(select.value || "");
  select.innerHTML = `<option value="">${transportersDb.length ? "-- Select Transporter --" : "-- No Transporters Registered --"}</option>` +
    transportersDb.map(item => `<option value="${escapeSalesHtml(String(item.id || ""))}">${escapeSalesHtml(item.name || "Unnamed Transporter")}</option>`).join("");
  if (transportersDb.some(item => String(item.id || "") === current)) select.value = current;
  window.onSelectTransporterToEdit();
}

function populateTransporterDeleteDropdown() {
  const select = document.getElementById("trDeleteSelect");
  if (!select) return;
  const current = String(select.value || "");
  select.innerHTML = `<option value="">${transportersDb.length ? "-- Select Transporter --" : "-- No Transporters Registered --"}</option>` +
    transportersDb.map(item => `<option value="${escapeSalesHtml(String(item.id || ""))}">${escapeSalesHtml(item.name || "Unnamed Transporter")}</option>`).join("");
  if (transportersDb.some(item => String(item.id || "") === current)) select.value = current;
  window.onSelectTransporterToDelete();
}

window.onSelectTransporterToEdit = function() {
  const id = String(document.getElementById("trEditSelect")?.value || "");
  const item = transportersDb.find(row => String(row.id || "") === id);
  const set = (field, value = "") => { const element = document.getElementById(field); if (element) element.value = value; };
  set("trEditName", item?.name);
  set("trEditPerson", item?.person);
  set("trEditPhone", item?.phone);
  set("trEditEmail", item?.email);
  set("trEditGst", item?.gst);
  set("trEditPan", item?.pan);
  set("trEditAddress", item?.address);
};

window.saveEditedTransporter = async function() {
  const value = id => String(document.getElementById(id)?.value || "").trim();
  const id = value("trEditSelect");
  const item = transportersDb.find(row => String(row.id || "") === id);
  if (!item) {
    window.showNotification({ title: "Select Transporter", message: "Select a transporter before saving changes.", type: "warning" });
    return;
  }
  const name = value("trEditName").toUpperCase();
  const person = value("trEditPerson");
  const phone = value("trEditPhone");
  const email = value("trEditEmail");
  const gst = accountInvoiceKey(value("trEditGst")).replace(/[^A-Z0-9]/g, "");
  const pan = accountInvoiceKey(value("trEditPan")).replace(/[^A-Z0-9]/g, "");
  const address = value("trEditAddress");
  if (!name || !person || !phone || !address) {
    window.showNotification({ title: "Transporter Details Required", message: "Complete Transporter Name, Contact Person, Mobile Number and Address.", type: "warning" });
    return;
  }
  if (!/^\d{10}$/.test(phone)) {
    window.showNotification({ title: "Invalid Mobile Number", message: "Enter a valid 10-digit transporter mobile number.", type: "warning" });
    return;
  }
  if (email && !/^\S+@\S+\.\S+$/.test(email)) {
    window.showNotification({ title: "Invalid E-mail", message: "Enter a valid transporter e-mail or leave it blank.", type: "warning" });
    return;
  }
  if (gst && (gst.length !== 15 || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) || pan !== gst.slice(2, 12))) {
    window.showNotification({ title: "Invalid GST Number", message: "Enter a valid GSTIN and matching PAN.", type: "warning" });
    return;
  }
  const duplicate = transportersDb.find(row => row !== item && (accountInvoiceKey(row.name) === accountInvoiceKey(name) || (gst && accountInvoiceKey(row.gst) === gst)));
  if (duplicate) {
    window.showNotification({ title: "Transporter Already Exists", message: `${duplicate.name} already uses this company name or GSTIN.`, type: "warning" });
    return;
  }
  const before = item.name;
  Object.assign(item, { name, person, phone, email, gst, pan: gst ? pan : "", address, updatedAt: new Date().toISOString(), updatedBy: currentLoggedInUser?.username || "SYSTEM" });
  if (await saveStorage(KEY_TRANSPORTERS, transportersDb) === false) return;
  await logEvent("DISPATCH", "TRANSPORTER_EDITED", `Updated transporter ${before}.`);
  populateDispatchTransportersDropdown();
  populateAccountTransporterDropdown();
  populateDriverTransporterDropdowns();
  populateTransporterEditDropdown();
  populateTransporterDeleteDropdown();
  renderTransporterTable();
  window.showNotification({ title: "Transporter Updated", message: `${name} was updated successfully.`, type: "success" });
};

window.onSelectTransporterToDelete = function() {
  const id = String(document.getElementById("trDeleteSelect")?.value || "");
  const item = transportersDb.find(row => String(row.id || "") === id);
  const box = document.getElementById("trDeleteInfoBox");
  if (!box) return;
  box.innerHTML = item
    ? `<strong style="color:#0f172a;">${escapeSalesHtml(item.name || "Unnamed Transporter")}</strong><br>${escapeSalesHtml(item.person || "-")} · ${escapeSalesHtml(item.phone || "-")}<br>${escapeSalesHtml(item.address || "-")}`
    : "Select a transporter from the dropdown to review details before deletion.";
};

window.executeDeleteTransporter = async function() {
  const id = String(document.getElementById("trDeleteSelect")?.value || "");
  const item = transportersDb.find(row => String(row.id || "") === id);
  if (!item) {
    window.showNotification({ title: "Select Transporter", message: "Select a transporter before deleting it.", type: "warning" });
    return;
  }
  const confirmed = await window.showConfirmDialog({ title: "Delete Transporter", message: `Delete transporter “${item.name}”? Existing historical transactions remain unchanged.`, confirmText: "Delete Transporter", isDanger: true });
  if (!confirmed) return;
  const previous = transportersDb;
  transportersDb = transportersDb.filter(row => row !== item);
  if (await saveStorage(KEY_TRANSPORTERS, transportersDb) === false) { transportersDb = previous; return; }
  await logEvent("DISPATCH", "TRANSPORTER_DELETED", `Deleted transporter ${item.name}.`);
  populateDispatchTransportersDropdown();
  populateAccountTransporterDropdown();
  populateDriverTransporterDropdowns();
  populateTransporterEditDropdown();
  populateTransporterDeleteDropdown();
  renderTransporterTable();
  window.showNotification({ title: "Transporter Deleted", message: `${item.name} was removed from the active master.`, type: "success" });
};

function populateDispatchTransportersDropdown() {
  const sel = document.getElementById("dtTransporterSelect");
  if (!sel) return;
  if (!transportersDb || transportersDb.length === 0) {
    sel.innerHTML = `<option value="">-- No Transporters Registered --</option>`;
    if (typeof updateChallanPreview === "function") updateChallanPreview();
    return;
  }
  sel.innerHTML = `<option value="">-- Select Transporter --</option>` + transportersDb.map(t => `
    <option value="${t.name}">${t.name}</option>
  `).join("");
  if (typeof updateChallanPreview === "function") updateChallanPreview();
}

function populateDriverTransporterDropdowns() {
  const addSel = document.getElementById("drAddTransporterSelect");
  const editSel = document.getElementById("drEditTransporterSelect");
  const optionsHtml = `<option value="">-- Select Transporter (Optional) --</option>` + 
    (transportersDb || []).map(t => `<option value="${t.name}">${t.name}</option>`).join("");
  if (addSel) addSel.innerHTML = optionsHtml;
  if (editSel) editSel.innerHTML = optionsHtml;
}

function renderTransporterTable() {
  const tbody = document.getElementById("transporterTableBody");
  if (!tbody) return;
  if (!transportersDb || transportersDb.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--muted); padding:20px;">No registered transporters found.</td></tr>`;
    return;
  }
  tbody.innerHTML = transportersDb.map(t => `
    <tr>
      <td><strong>${t.name}</strong></td>
      <td>${t.person} (${t.phone})</td>
      <td>${t.phone}</td>
      <td>${t.email || '-'}</td>
      <td><code>${t.gst}</code></td>
      <td><code>${t.pan || '-'}</code></td>
      <td>${t.address}</td>
    </tr>
  `).join("");
}

function renderDriverTable() {
  const tbody = document.getElementById("driverTableBody");
  if (!tbody) return;
  if (!driversDb || driversDb.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--muted); padding:20px;">No registered drivers found.</td></tr>`;
    return;
  }
  tbody.innerHTML = driversDb.map(d => `
    <tr>
      <td><strong>${d.name}</strong></td>
      <td>${d.phone}</td>
      <td>${d.transporter}</td>
      <td><code>${d.vehicle}</code></td>
    </tr>
  `).join("");
}

