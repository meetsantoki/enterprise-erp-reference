function accountInvoiceKey(value) {
  return String(value || "").trim().toUpperCase();
}

function accountSetValue(id, value = "") {
  const element = document.getElementById(id);
  if (element) element.value = value ?? "";
}

function getOpenAccountInvoiceQty(coNumber) {
  const key = salesCoKey(coNumber);
  return (Array.isArray(accountInvoices) ? accountInvoices : [])
    .filter(invoice => salesCoKey(invoice.coNumber) === key && String(invoice.status || "OPEN").toUpperCase() !== "DISPATCHED")
    .reduce((sum, invoice) => sum + salesNumber(invoice.quantity), 0);
}

function accountInvoiceProductKey(line) {
  return [line?.dcrNdcr, line?.modelNo, salesNumber(line?.moduleWatt || line?.wattPerModule)]
    .map(value => String(value || "").trim().replace(/[\s-]+/g, "").toUpperCase())
    .join("|");
}

function getAccountInvoiceProductAllocation(order, excludedInvoiceId = "") {
  if (!order) return [];
  const orderLines = normalizeSalesOrderProductLines(order);
  const usedByLine = new Map(orderLines.map(line => [String(line.id), 0]));
  const idByKey = new Map(orderLines.map(line => [accountInvoiceProductKey(line), String(line.id)]));
  const savedInvoiceNumbers = new Set();
  (Array.isArray(accountInvoices) ? accountInvoices : []).forEach(invoice => {
    if (String(invoice.id || "") === String(excludedInvoiceId || "") || salesCoKey(invoice.coNumber) !== salesCoKey(order.coNumber)) return;
    const invoiceNumber = accountInvoiceKey(invoice.invoiceNumber);
    if (invoiceNumber) savedInvoiceNumbers.add(invoiceNumber);
    const savedLines = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
    if (savedLines.length) {
      savedLines.forEach(savedLine => {
        const directId = String(savedLine.salesOrderLineId || "");
        const matchedId = usedByLine.has(directId) ? directId : idByKey.get(accountInvoiceProductKey(savedLine));
        if (matchedId) usedByLine.set(matchedId, salesNumber(usedByLine.get(matchedId)) + salesNumber(savedLine.quantity));
      });
      return;
    }
    const legacyMatchedId = idByKey.get(accountInvoiceProductKey(invoice)) || (orderLines.length === 1 ? String(orderLines[0].id) : "");
    if (legacyMatchedId) usedByLine.set(legacyMatchedId, salesNumber(usedByLine.get(legacyMatchedId)) + salesNumber(invoice.quantity));
  });
  // Some migrated dispatches pre-date Accounts Invoice storage. Count those
  // orphaned dispatch quantities so already-shipped modules cannot be invoiced
  // again while their historical invoice records are being restored.
  const countedLegacyDispatchInvoices = new Set();
  (Array.isArray(dispatchArchive) ? dispatchArchive : []).forEach(manifest => {
    if (salesCoKey(manifest.coNumber) !== salesCoKey(order.coNumber)) return;
    const invoiceNumber = accountInvoiceKey(manifest.invoice);
    if (!invoiceNumber || savedInvoiceNumbers.has(invoiceNumber) || countedLegacyDispatchInvoices.has(invoiceNumber)) return;
    const dispatchedQty = Math.trunc(salesNumber(manifest.dispatchedQty));
    if (dispatchedQty <= 0) return;
    const manifestModel = accountInvoiceKey(manifest.product).replace(/[^A-Z0-9]/g, "");
    const matchingLines = orderLines.filter(line => {
      const lineModel = accountInvoiceKey(line.modelNo).replace(/[^A-Z0-9]/g, "");
      return lineModel && manifestModel.includes(lineModel);
    });
    const matchedLine = matchingLines.length === 1 ? matchingLines[0] : (orderLines.length === 1 ? orderLines[0] : null);
    if (!matchedLine) return;
    const matchedId = String(matchedLine.id);
    usedByLine.set(matchedId, salesNumber(usedByLine.get(matchedId)) + dispatchedQty);
    countedLegacyDispatchInvoices.add(invoiceNumber);
  });
  return orderLines.map(line => {
    const orderedQty = Math.trunc(salesNumber(line.totalOrderQty));
    const alreadyInvoicedQty = Math.trunc(salesNumber(usedByLine.get(String(line.id))));
    return {
      salesOrderLineId: String(line.id),
      lineKey: accountInvoiceProductKey(line),
      dcrNdcr: String(line.dcrNdcr || "").trim(),
      modelNo: String(line.modelNo || "").trim(),
      wattPerModule: salesNumber(line.moduleWatt),
      ratePerWatt: salesNumber(line.rateWp),
      orderedQty,
      alreadyInvoicedQty,
      availableQty: Math.max(0, orderedQty - alreadyInvoicedQty),
      quantity: Math.max(0, orderedQty - alreadyInvoicedQty),
      taxRate: salesNumber(line.taxRate) || 5
    };
  });
}

function getAccountInvoiceByNumber(invoiceNumber) {
  const key = accountInvoiceKey(invoiceNumber);
  return (Array.isArray(accountInvoices) ? accountInvoices : []).find(invoice => accountInvoiceKey(invoice.invoiceNumber) === key) || null;
}

function getAccountInvoiceAvailableQty(order) {
  return getAccountInvoiceProductAllocation(order).reduce((sum, line) => sum + salesNumber(line.availableQty), 0);
}

const JB_INFRA_HISTORICAL_INVOICE_NUMBERS = Object.freeze([
  "DEMO2/2627-459", "DEMO2/2627-460", "DEMO2/2627-461", "DEMO2/2627-463",
  "DEMO2/2627-465", "DEMO2/2627-466", "DEMO2/2627-468", "DEMO2/2627-469"
]);
let jbInfraHistoricalInvoiceRestorePromise = null;
let jbInfraHistoricalInvoiceRestoreScheduled = false;

function legacyAccountInvoiceDate(manifest) {
  const rawDate = String(manifest?.invoiceDate || manifest?.date || "").trim();
  const dateParts = rawDate.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
  return dateParts ? `${dateParts[3]}-${dateParts[2]}-${dateParts[1]}` : rawDate.slice(0, 10);
}

function getJbInfraHistoricalInvoiceDisplayRows() {
  const targetNumbers = new Set(JB_INFRA_HISTORICAL_INVOICE_NUMBERS);
  const existingNumbers = new Set((Array.isArray(accountInvoices) ? accountInvoices : []).map(item => accountInvoiceKey(item.invoiceNumber)));
  return (Array.isArray(dispatchArchive) ? dispatchArchive : []).filter(manifest => {
    const invoiceNumber = accountInvoiceKey(manifest.invoice);
    return targetNumbers.has(invoiceNumber) && !existingNumbers.has(invoiceNumber) && accountInvoiceKey(manifest.customer) === "JB INFRA";
  }).map(manifest => {
    const quantity = Math.trunc(salesNumber(manifest.dispatchedQty));
    const totalWatts = quantity * 625;
    const totalValue = totalWatts * 12.4;
    const taxAmount = totalValue * 0.05;
    return {
      id: `LEGACY-DISPLAY-${accountInvoiceKey(manifest.invoice).split("-").pop()}`,
      invoiceNumber: accountInvoiceKey(manifest.invoice),
      invoiceDate: legacyAccountInvoiceDate(manifest),
      coNumber: String(manifest.coNumber || "U2/26-27/91"),
      customerName: "JB INFRA",
      modelNo: "DEMOG12R132-625",
      modelType: "G12R",
      dcrNdcr: "NON-DCR",
      wattPerModule: 625,
      ratePerWatt: 12.4,
      pricePerModule: 7750,
      quantity,
      totalWatts,
      totalValue,
      taxRate: 5,
      taxAmount,
      roundingOff: 0,
      invoiceValue: totalValue + taxAmount,
      transporterName: String(manifest.transporter || ""),
      vehicleNumber: String(manifest.vehicle || ""),
      lrNo: String(manifest.lrNo || ""),
      status: "DISPATCHED",
      dispatchId: String(manifest.id || ""),
      restoredFromDispatchArchive: true
    };
  });
}

window.restoreJbInfraHistoricalInvoices = async function() {
  if (jbInfraHistoricalInvoiceRestorePromise) return jbInfraHistoricalInvoiceRestorePromise;
  jbInfraHistoricalInvoiceRestorePromise = (async () => {
    const targetNumbers = new Set(JB_INFRA_HISTORICAL_INVOICE_NUMBERS);
    const order = (Array.isArray(salesOrders) ? salesOrders : []).find(item => salesCoKey(item.coNumber) === salesCoKey("U2/26-27/91"));
    if (!order) return { restored: 0, linked: 0 };
    const manifests = (Array.isArray(dispatchArchive) ? dispatchArchive : []).filter(item =>
      targetNumbers.has(accountInvoiceKey(item.invoice))
      && salesCoKey(item.coNumber) === salesCoKey(order.coNumber)
      && accountInvoiceKey(item.customer) === "JB INFRA"
    );
    if (manifests.length !== targetNumbers.size) return { restored: 0, linked: 0 };

    const historicalRate = 12.4;
    const historicalWatt = 625;
    const historicalTaxRate = 5;
    const orderLine = normalizeSalesOrderProductLines(order).find(line => accountInvoiceKey(line.modelNo).replace(/[^A-Z0-9]/g, "") === "DEMOG12R132625") || normalizeSalesOrderProductLines(order)[0];
    if (!orderLine) return { restored: 0, linked: 0 };
    const transporterByName = new Map((Array.isArray(transportersDb) ? transportersDb : []).map(item => [accountInvoiceKey(item.name), item]));
    const existingByNumber = new Map((Array.isArray(accountInvoices) ? accountInvoices : []).map(item => [accountInvoiceKey(item.invoiceNumber), item]));
    const addedIds = [];
    let linksChanged = 0;

    manifests.forEach(manifest => {
      const invoiceNumber = accountInvoiceKey(manifest.invoice);
      let invoice = existingByNumber.get(invoiceNumber);
      if (!invoice) {
        const quantity = Math.trunc(salesNumber(manifest.dispatchedQty));
        const totalWatts = quantity * historicalWatt;
        const totalValue = totalWatts * historicalRate;
        const taxAmount = totalValue * historicalTaxRate / 100;
        const invoiceDate = legacyAccountInvoiceDate(manifest);
        const transporter = transporterByName.get(accountInvoiceKey(manifest.transporter));
        const suffix = invoiceNumber.split("-").pop().replace(/[^A-Z0-9]/g, "");
        invoice = {
          id: `ACC-RESTORED-JB-${suffix}`,
          salesOrderId: order.id,
          coNumber: order.coNumber,
          customerName: "JB INFRA",
          customerGst: String(order.customerGst || ""),
          invoiceNumber,
          invoiceDate,
          lineItems: [{
            salesOrderLineId: String(orderLine.id),
            lineKey: accountInvoiceProductKey(orderLine),
            dcrNdcr: "NON-DCR",
            modelNo: "DEMOG12R132-625",
            wattPerModule: historicalWatt,
            ratePerWatt: historicalRate,
            pricePerModule: historicalWatt * historicalRate,
            orderedQty: salesNumber(orderLine.totalOrderQty),
            quantity,
            totalWatts,
            taxableValue: totalValue,
            taxRate: historicalTaxRate,
            taxAmount,
            invoiceValue: totalValue + taxAmount
          }],
          dcrNdcr: "NON-DCR",
          modelNo: "DEMOG12R132-625",
          modelType: "G12R",
          wattPerModule: historicalWatt,
          ratePerWatt: historicalRate,
          pricePerModule: historicalWatt * historicalRate,
          quantity,
          totalWatts,
          totalValue,
          taxRate: historicalTaxRate,
          taxAmount,
          roundingOff: 0,
          invoiceValue: totalValue + taxAmount,
          transporterName: String(manifest.transporter || ""),
          transporterGst: String(transporter?.gst || ""),
          transporterPan: String(transporter?.pan || ""),
          vehicleNumber: String(manifest.vehicle || ""),
          modeTransport: String(manifest.modeTransport || "By Road"),
          challanNo: String(manifest.challanNo || ""),
          deliveryOrderNo: String(manifest.deliveryOrderNo || order.coNumber),
          lrNo: String(manifest.lrNo || ""),
          packingType: String(manifest.packingType || "Box Packing"),
          hsnCode: String(manifest.hsnCode || "85414300"),
          status: "DISPATCHED",
          dispatchId: String(manifest.id || ""),
          dispatchedAt: String(manifest.dispatchedAt || manifest.createdAt || ""),
          dispatchedBy: String(manifest.createdBy || "SYSTEM"),
          restoredFromDispatchArchive: true,
          restoredAt: new Date().toISOString(),
          restoredBy: currentLoggedInUser?.username || "SYSTEM",
          createdAt: invoiceDate ? `${invoiceDate}T12:00:00+05:30` : new Date().toISOString(),
          createdBy: "IT"
        };
        accountInvoices.push(invoice);
        existingByNumber.set(invoiceNumber, invoice);
        addedIds.push(invoice.id);
      }
      if (String(manifest.accountInvoiceId || "") !== String(invoice.id)) {
        manifest.accountInvoiceId = invoice.id;
        linksChanged += 1;
      }
    });

    if (addedIds.length && await saveStorage(KEY_ACCOUNT_INVOICES, accountInvoices) === false) {
      accountInvoices = accountInvoices.filter(item => !addedIds.includes(String(item.id)));
      throw new Error("JB INFRA invoice restoration could not save the Accounts Invoice records.");
    }
    if (linksChanged && await saveStorage(KEY_DISPATCH_ARCHIVE, dispatchArchive) === false) {
      throw new Error("JB INFRA invoices were restored, but their dispatch links could not be saved. Reload Accounts to retry the links.");
    }
    if (addedIds.length || linksChanged) {
      await logEvent("ACCOUNTS", "HISTORICAL_INVOICES_RESTORED", `Restored ${addedIds.length} JB INFRA invoice record(s) and ${linksChanged} dispatch link(s) for C/O U2/26-27/91.`);
      window.showNotification({ title: "JB INFRA Invoices Restored", message: `${addedIds.length || targetNumbers.size} historical dispatched invoices are now available in Accounts.`, type: "success" });
    }
    return { restored: addedIds.length, linked: linksChanged };
  })();
  try { return await jbInfraHistoricalInvoiceRestorePromise; }
  finally { jbInfraHistoricalInvoiceRestorePromise = null; }
};

function populateAccountCoDropdown() {
  const input = document.getElementById("accountCoSelect");
  const help = document.getElementById("accountCoHelp");
  if (!input) return;
  const current = input.value;
  const sourceOrders = Array.isArray(salesOrders) ? salesOrders : [];
  const orders = sourceOrders.filter(order => getAccountInvoiceAvailableQty(order) > 0 && String(order.status || "").toUpperCase() !== "CLOSED");
  input.placeholder = orders.length ? `Type or select from ${orders.length} Sales C/O records` : "No Sales C/O is available for invoicing";
  if (help) help.textContent = orders.length
    ? `${orders.length} Sales Sheet C/O record(s) are available. Start typing or select a C/O number.`
    : `No invoiceable C/O was found. Sales Sheet contains ${sourceOrders.length} record(s); fully dispatched or fully allocated invoices are excluded.`;
  if (orders.some(order => salesCoKey(order.coNumber) === salesCoKey(current))) input.value = current;
  renderAccountCoOptions(input.value);
}

function getInvoiceableAccountOrders() {
  return (Array.isArray(salesOrders) ? salesOrders : []).filter(order =>
    getAccountInvoiceAvailableQty(order) > 0 && String(order.status || "").toUpperCase() !== "CLOSED"
  );
}

function renderAccountCoOptions(searchText = "") {
  const panel = document.getElementById("accountCoOptions");
  if (!panel) return;
  const query = salesCoKey(searchText);
  const orders = getInvoiceableAccountOrders().filter(order => {
    if (!query) return true;
    return [order.coNumber, order.customerName, order.modelNo].some(value => salesCoKey(value).includes(query));
  });
  panel.innerHTML = orders.length ? orders.map(order => {
    const remaining = getAccountInvoiceAvailableQty(order);
    const selected = salesCoKey(order.coNumber) === salesCoKey(document.getElementById("accountCoSelect")?.value);
    return `<button type="button" class="account-co-option${selected ? " selected" : ""}" role="option" aria-selected="${selected}" data-co="${escapeSalesHtml(order.coNumber)}" onclick="selectAccountCoOption(this.dataset.co)">
      <span class="account-co-option-code">${escapeSalesHtml(order.coNumber)}</span>
      <span class="account-co-option-details"><span class="account-co-option-customer">${escapeSalesHtml(order.customerName || "Customer not recorded")}</span><span class="account-co-option-qty">${remaining.toLocaleString("en-IN")} available</span></span>
    </button>`;
  }).join("") : `<div class="account-co-empty">No matching C/O number found.</div>`;
}

window.openAccountCoDropdown = function() {
  const wrapper = document.getElementById("accountCoCombobox");
  const input = document.getElementById("accountCoSelect");
  if (!wrapper || !input) return;
  renderAccountCoOptions(input.value);
  wrapper.classList.add("open");
  input.setAttribute("aria-expanded", "true");
};

window.closeAccountCoDropdown = function() {
  document.getElementById("accountCoCombobox")?.classList.remove("open");
  document.getElementById("accountCoSelect")?.setAttribute("aria-expanded", "false");
};

window.toggleAccountCoDropdown = function() {
  const wrapper = document.getElementById("accountCoCombobox");
  const input = document.getElementById("accountCoSelect");
  if (!wrapper || !input) return;
  if (wrapper.classList.contains("open")) window.closeAccountCoDropdown();
  else {
    input.focus();
    window.openAccountCoDropdown();
  }
};

window.handleAccountCoSearchInput = function() {
  window.openAccountCoDropdown();
  window.handleAccountCoChange();
};

window.handleAccountCoSearchKeydown = function(event) {
  const options = [...document.querySelectorAll("#accountCoOptions .account-co-option")];
  if (event.key === "ArrowDown" && options.length) {
    event.preventDefault();
    window.openAccountCoDropdown();
    options[0].focus();
  } else if (event.key === "Enter" && options.length) {
    event.preventDefault();
    options[0].click();
  } else if (event.key === "Escape") {
    window.closeAccountCoDropdown();
  }
};

window.selectAccountCoOption = function(coNumber) {
  const input = document.getElementById("accountCoSelect");
  if (!input) return;
  input.value = coNumber || "";
  window.closeAccountCoDropdown();
  window.handleAccountCoChange();
};

document.addEventListener("click", event => {
  if (!event.target.closest("#accountCoCombobox")) window.closeAccountCoDropdown?.();
  if (!event.target.closest("#accountTransporterCombobox")) window.closeAccountTransporterDropdown?.();
});

window.loadLatestAccountCoTrial = function() {
  const input = document.getElementById("accountCoSelect");
  const orders = (Array.isArray(salesOrders) ? salesOrders : []).filter(order => getAccountInvoiceAvailableQty(order) > 0 && String(order.status || "").toUpperCase() !== "CLOSED");
  if (!input || !orders.length) {
    window.showNotification({ title: "No C/O Available", message: "No Sales Sheet C/O currently has quantity available for invoicing.", type: "warning" });
    return;
  }
  const trialOrder = orders.find(order => /G12R?|M10R?/i.test(String(order.modelNo || ""))) || orders[0];
  input.value = trialOrder.coNumber;
  window.closeAccountCoDropdown();
  window.handleAccountCoChange();
  window.showNotification({ title: "Trial C/O Loaded", message: `Loaded ${trialOrder.coNumber} from the Sales Sheet. Review the auto-filled customer, model and financial details.`, type: "success" });
};

function populateAccountTransporterDropdown() {
  const input = document.getElementById("accountTransporterSelect");
  const help = document.getElementById("accountTransporterHelp");
  if (!input) return;
  const current = String(input.value || "");
  const transporters = Array.isArray(transportersDb) ? transportersDb : [];
  input.placeholder = transporters.length ? `Search ${transporters.length} transporter(s)` : "No transporter saved — click + to add";
  input.value = current;
  if (help) help.textContent = transporters.length
    ? `${transporters.length} transporter(s) available. Type a name or open the dropdown.`
    : "No transporter is available. Click + to open Add Transporter.";
  renderAccountTransporterOptions(current);
}

function renderAccountTransporterOptions(searchText = "") {
  const panel = document.getElementById("accountTransporterOptions");
  if (!panel) return;
  const query = accountInvoiceKey(searchText);
  const matches = (transportersDb || []).filter(transporter =>
    !query || [transporter.name, transporter.gst, transporter.person, transporter.phone].some(value => accountInvoiceKey(value).includes(query))
  );
  panel.innerHTML = matches.length ? matches.map(transporter => {
    const selected = accountInvoiceKey(transporter.name) === accountInvoiceKey(document.getElementById("accountTransporterSelect")?.value);
    return `<button type="button" class="account-co-option${selected ? " selected" : ""}" role="option" aria-selected="${selected}" data-name="${escapeSalesHtml(transporter.name)}" onclick="selectAccountTransporterOption(this.dataset.name)"><span class="account-co-option-code">${escapeSalesHtml(transporter.name)}</span><span class="account-co-option-details"><span class="account-co-option-customer">${escapeSalesHtml(transporter.person || transporter.phone || "Contact not saved")}</span><span class="account-co-option-qty">${escapeSalesHtml(transporter.gst || "GST not saved")}</span></span></button>`;
  }).join("") : `<div class="account-co-empty">No matching transporter. Click + to add a new transporter.</div>`;
}

window.openAccountTransporterDropdown = function() {
  const wrapper = document.getElementById("accountTransporterCombobox");
  const input = document.getElementById("accountTransporterSelect");
  if (!wrapper || !input) return;
  renderAccountTransporterOptions(input.value);
  wrapper.classList.add("open");
  input.setAttribute("aria-expanded", "true");
};

window.closeAccountTransporterDropdown = function() {
  document.getElementById("accountTransporterCombobox")?.classList.remove("open");
  document.getElementById("accountTransporterSelect")?.setAttribute("aria-expanded", "false");
};

window.toggleAccountTransporterDropdown = function() {
  const wrapper = document.getElementById("accountTransporterCombobox");
  const input = document.getElementById("accountTransporterSelect");
  if (!wrapper || !input) return;
  if (wrapper.classList.contains("open")) window.closeAccountTransporterDropdown();
  else { input.focus(); window.openAccountTransporterDropdown(); }
};

window.handleAccountTransporterSearchInput = function() {
  window.openAccountTransporterDropdown();
  window.handleAccountTransporterChange();
};

window.handleAccountTransporterSearchKeydown = function(event) {
  const options = [...document.querySelectorAll("#accountTransporterOptions .account-co-option")];
  if (event.key === "ArrowDown" && options.length) { event.preventDefault(); window.openAccountTransporterDropdown(); options[0].focus(); }
  else if (event.key === "Enter" && options.length) { event.preventDefault(); options[0].click(); }
  else if (event.key === "Escape") window.closeAccountTransporterDropdown();
};

window.selectAccountTransporterOption = function(name) {
  const input = document.getElementById("accountTransporterSelect");
  if (!input) return;
  input.value = name || "";
  window.closeAccountTransporterDropdown();
  window.handleAccountTransporterChange();
};

window.openTransporterAddFromAccounts = async function() {
  window.closeAccountTransporterDropdown();
  await switchView("transporterAdd", document.getElementById("navSub-transporterAdd"), "Dispatch > Transporter > Add Transporter");
};

function populateAccountDriverDropdown(transporterName = "") {
  const select = document.getElementById("accountDriverSelect");
  if (!select) return;
  const matchKey = accountInvoiceKey(transporterName);
  const drivers = (driversDb || []).filter(driver => !matchKey || accountInvoiceKey(driver.transporter) === matchKey);
  select.innerHTML = `<option value="">-- Select Driver (Optional) --</option>` + drivers.map(driver =>
    `<option value="${escapeSalesHtml(driver.id ?? driver.phone ?? driver.name)}">${escapeSalesHtml(driver.name)} — ${escapeSalesHtml(driver.phone || "No phone")}${driver.vehicle ? ` (${escapeSalesHtml(driver.vehicle)})` : ""}</option>`
  ).join("");
}

function inferAccountModelType(modelNo = "") {
  const modelText = accountInvoiceKey(modelNo);
  return modelText.includes("G12R") ? "G12R"
    : modelText.includes("M10R") ? "M10R"
    : modelText.includes("G12") ? "G12"
    : modelText.includes("M10") ? "M10"
    : "";
}

function renderAccountInvoiceProductLines() {
  const select = document.getElementById("accountProductSelect");
  if (!select) return;
  const availableLines = accountInvoiceProductLines.filter(line => salesNumber(line.availableQty) > 0);
  const totalOption = availableLines.length > 1
    ? `<option value="__TOTAL__">TOTAL — WHOLE C/O (${availableLines.reduce((sum, line) => sum + salesNumber(line.availableQty), 0).toLocaleString("en-IN")} available)</option>`
    : "";
  select.innerHTML = `<option value="">${availableLines.length ? "-- Select Product --" : "-- No Product Quantity Available --"}</option>` + availableLines.map(line =>
    `<option value="${escapeSalesHtml(line.salesOrderLineId)}">${escapeSalesHtml(line.modelNo)} — ${salesNumber(line.wattPerModule).toLocaleString("en-IN")} W — ${escapeSalesHtml(line.dcrNdcr)} (${salesNumber(line.availableQty).toLocaleString("en-IN")} available)</option>`
  ).join("") + totalOption;
  if (accountSelectedProductLineId === "__TOTAL__" && availableLines.length > 1) select.value = "__TOTAL__";
  else if (availableLines.some(line => String(line.salesOrderLineId) === String(accountSelectedProductLineId))) select.value = accountSelectedProductLineId;
  else accountSelectedProductLineId = "";
  window.calculateAccountInvoiceValue();
}

window.handleAccountInvoiceProductSelection = function() {
  accountSelectedProductLineId = String(document.getElementById("accountProductSelect")?.value || "");
  accountInvoiceProductLines.forEach(line => { line.quantity = 0; });
  const totalSelected = accountSelectedProductLineId === "__TOTAL__";
  if (totalSelected) {
    const availableLines = accountInvoiceProductLines.filter(item => salesNumber(item.availableQty) > 0);
    availableLines.forEach(item => { item.quantity = salesNumber(item.availableQty); });
    const distinctDcr = [...new Set(availableLines.map(item => item.dcrNdcr).filter(Boolean))];
    const totalAvailable = availableLines.reduce((sum, item) => sum + salesNumber(item.availableQty), 0);
    const commonTaxRate = availableLines.every(item => salesNumber(item.taxRate) === salesNumber(availableLines[0]?.taxRate)) ? salesNumber(availableLines[0]?.taxRate) : 5;
    accountSetValue("accountDcrNdcr", distinctDcr.join(" / "));
    accountSetValue("accountModelNo", `${availableLines.length} PRODUCTS — WHOLE C/O`);
    accountSetValue("accountRemainingModules", totalAvailable);
    accountSetValue("accountTaxRate", [5, 12, 18].includes(commonTaxRate) ? commonTaxRate : 5);
    accountSetValue("accountModelType", "MULTIPLE");
    const qtyField = document.getElementById("accountVehicleQty");
    if (qtyField) {
      qtyField.max = String(totalAvailable);
      qtyField.readOnly = true;
      qtyField.style.background = "#f8fafc";
    }
    window.calculateAccountInvoiceValue();
    return;
  }
  const line = accountInvoiceProductLines.find(item => String(item.salesOrderLineId) === accountSelectedProductLineId);
  if (line) line.quantity = salesNumber(line.availableQty);
  accountSetValue("accountDcrNdcr", line?.dcrNdcr || "");
  accountSetValue("accountModelNo", line?.modelNo || "");
  accountSetValue("accountRemainingModules", line ? salesNumber(line.availableQty) : "");
  accountSetValue("accountTaxRate", line && [5, 12, 18].includes(salesNumber(line.taxRate)) ? salesNumber(line.taxRate) : 5);
  accountSetValue("accountModelType", line ? inferAccountModelType(line.modelNo) : "");
  const qtyField = document.getElementById("accountVehicleQty");
  if (qtyField) {
    qtyField.max = line ? String(salesNumber(line.availableQty)) : "";
    qtyField.readOnly = false;
    qtyField.style.background = "";
  }
  window.calculateAccountInvoiceValue();
};

window.updateSelectedAccountInvoiceQuantity = function(value) {
  if (accountSelectedProductLineId === "__TOTAL__") {
    window.calculateAccountInvoiceValue();
    return;
  }
  const line = accountInvoiceProductLines.find(item => String(item.salesOrderLineId) === String(accountSelectedProductLineId));
  if (!line) return;
  line.quantity = Math.max(0, Math.trunc(salesNumber(value)));
  window.calculateAccountInvoiceValue();
};

window.applyAccountInvoiceTaxRate = function() {
  const taxRate = salesNumber(document.getElementById("accountTaxRate")?.value);
  if (accountSelectedProductLineId === "__TOTAL__") {
    accountInvoiceProductLines.filter(item => salesNumber(item.quantity) > 0).forEach(item => { item.taxRate = taxRate; });
    window.calculateAccountInvoiceValue();
    return;
  }
  const line = accountInvoiceProductLines.find(item => String(item.salesOrderLineId) === String(accountSelectedProductLineId));
  if (line) line.taxRate = taxRate;
  window.calculateAccountInvoiceValue();
};

window.handleAccountCoChange = function() {
  const order = getSalesOrderByCo(document.getElementById("accountCoSelect")?.value || "");
  const quantityField = document.getElementById("accountVehicleQty");
  if (quantityField) {
    quantityField.readOnly = false;
    quantityField.style.background = "";
  }
  if (!order) {
    accountInvoiceProductLines = [];
    accountSelectedProductLineId = "";
    ["accountCustomer", "accountCustomerGst", "accountDcrNdcr", "accountModelNo", "accountModuleWatt", "accountRateWp", "accountVehicleQty", "accountDeliveryOrderNo", "accountRemainingModules"].forEach(id => accountSetValue(id));
    renderAccountInvoiceProductLines();
    calculateAccountInvoiceValue();
    return;
  }
  const customer = (Array.isArray(customersDb) ? customersDb : []).find(item => String(item.id) === String(order.customerId) || customerMasterKey(item.name) === customerMasterKey(order.customerName));
  accountSetValue("accountCustomer", order.customerName);
  accountSetValue("accountCustomerGst", order.customerGst || customer?.gst || "");
  accountInvoiceProductLines = getAccountInvoiceProductAllocation(order);
  accountInvoiceProductLines.forEach(line => { line.quantity = 0; });
  const availableLines = accountInvoiceProductLines.filter(line => salesNumber(line.availableQty) > 0);
  accountSelectedProductLineId = availableLines.length === 1 ? String(availableLines[0].salesOrderLineId) : "";
  accountSetValue("accountDeliveryOrderNo", order.coNumber);
  if (accountSelectedProductLineId) {
    const selectedLine = availableLines[0];
    selectedLine.quantity = salesNumber(selectedLine.availableQty);
    accountSetValue("accountDcrNdcr", selectedLine.dcrNdcr);
    accountSetValue("accountModelNo", selectedLine.modelNo);
    accountSetValue("accountRemainingModules", selectedLine.availableQty);
    accountSetValue("accountTaxRate", [5, 12, 18].includes(salesNumber(selectedLine.taxRate)) ? selectedLine.taxRate : 5);
    accountSetValue("accountModelType", inferAccountModelType(selectedLine.modelNo));
  } else {
    ["accountDcrNdcr", "accountModelNo", "accountRemainingModules", "accountModelType"].forEach(id => accountSetValue(id));
    accountSetValue("accountTaxRate", 5);
  }
  renderAccountInvoiceProductLines();
};

window.accountInvoiceRoundedTotal = function(invoice) {
  const value = Number(invoice?.invoiceValue || 0);
  return Math.round(value);
};

window.accountInvoiceRoundOff = function(invoice) {
  if (invoice?.roundingOff !== undefined && invoice?.roundingOff !== null) return Number(invoice.roundingOff || 0);
  return window.accountInvoiceRoundedTotal(invoice) - Number(invoice?.invoiceValue || 0);
};

window.calculateAccountInvoiceValue = function() {
  const totalSelected = accountSelectedProductLineId === "__TOTAL__";
  const selectedLine = accountInvoiceProductLines.find(line => String(line.salesOrderLineId) === String(accountSelectedProductLineId));
  accountInvoiceProductLines.forEach(line => {
    line.pricePerModule = salesNumber(line.wattPerModule) * salesNumber(line.ratePerWatt);
    line.totalWatts = salesNumber(line.wattPerModule) * salesNumber(line.quantity);
    line.taxableValue = line.pricePerModule * salesNumber(line.quantity);
    line.taxAmount = line.taxableValue * salesNumber(line.taxRate) / 100;
    line.invoiceValue = line.taxableValue + line.taxAmount;
  });
  const activeLines = totalSelected ? accountInvoiceProductLines.filter(line => salesNumber(line.quantity) > 0) : (selectedLine ? [selectedLine] : []);
  const quantity = activeLines.reduce((sum, line) => sum + salesNumber(line.quantity), 0);
  const totalWatts = activeLines.reduce((sum, line) => sum + salesNumber(line.totalWatts), 0);
  const totalValue = activeLines.reduce((sum, line) => sum + salesNumber(line.taxableValue), 0);
  const taxAmount = activeLines.reduce((sum, line) => sum + salesNumber(line.taxAmount), 0);
  const rawInvoiceValue = activeLines.reduce((sum, line) => sum + salesNumber(line.invoiceValue), 0);
  const invoiceValue = Math.round(rawInvoiceValue);
  const roundingOff = invoiceValue - rawInvoiceValue;
  accountSetValue("accountModuleWatt", totalSelected ? "MULTIPLE" : (selectedLine ? salesNumber(selectedLine.wattPerModule) : ""));
  accountSetValue("accountRateWp", totalSelected ? "MULTIPLE" : (selectedLine ? salesNumber(selectedLine.ratePerWatt).toFixed(2) : ""));
  accountSetValue("accountPricePerModule", totalSelected ? "MULTIPLE" : (selectedLine ? salesNumber(selectedLine.pricePerModule).toFixed(2) : ""));
  accountSetValue("accountVehicleQty", activeLines.length ? quantity : "");
  accountSetValue("accountTotalWatts", activeLines.length ? totalWatts.toFixed(0) : "");
  accountSetValue("accountTotalValue", activeLines.length ? totalValue.toFixed(2) : "");
  accountSetValue("accountTaxAmount", activeLines.length ? taxAmount.toFixed(2) : "");
  accountSetValue("accountRoundingOff", activeLines.length ? roundingOff.toFixed(2) : "");
  accountSetValue("accountInvoiceValue", activeLines.length ? invoiceValue.toFixed(2) : "");
};

window.handleAccountTransporterChange = function() {
  const name = document.getElementById("accountTransporterSelect")?.value || "";
  const nameKey = accountInvoiceKey(name);
  return (Array.isArray(transportersDb) ? transportersDb : []).find(item => accountInvoiceKey(item.name) === nameKey) || null;
};

window.handleAccountDriverChange = function() {
  const selected = String(document.getElementById("accountDriverSelect")?.value || "");
  const driver = (driversDb || []).find(item => String(item.id ?? item.phone ?? item.name) === selected);
  if (!driver) return;
  accountSetValue("accountDriverName", driver.name || "");
  accountSetValue("accountDriverPhone", driver.phone || "");
  if (driver.vehicle) accountSetValue("accountVehicleNumber", driver.vehicle);
};

function resetAccountInvoiceForm() {
  accountInvoiceProductLines = [];
  accountSelectedProductLineId = "";
  populateAccountCoDropdown();
  populateAccountTransporterDropdown();
  [
    "accountCustomer", "accountCustomerGst", "accountInvoiceNo", "accountDcrNdcr", "accountModelNo", "accountModuleWatt", "accountRateWp",
    "accountPricePerModule", "accountVehicleQty", "accountRemainingModules", "accountTotalWatts", "accountTotalValue", "accountTaxAmount", "accountRoundingOff", "accountInvoiceValue",
    "accountTransporterPerson", "accountTransporterPhone", "accountTransporterEmail", "accountTransporterAddress",
    "accountVehicleNumber", "accountDriverName", "accountDriverPhone", "accountChallanNo", "accountDeliveryOrderNo", "accountLrNo"
  ].forEach(id => accountSetValue(id));
  accountSetValue("accountCoSelect", "");
  accountSetValue("accountTransporterSelect", "");
  accountSetValue("accountModelType", "");
  accountSetValue("accountInvoiceDate", new Date().toISOString().slice(0, 10));
  accountSetValue("accountTaxRate", "5");
  accountSetValue("accountModeTransport", "By Road");
  accountSetValue("accountPackingType", "Box Packing");
  accountSetValue("accountHsnCode", "85414300");
  const quantityField = document.getElementById("accountVehicleQty");
  if (quantityField) {
    quantityField.readOnly = false;
    quantityField.style.background = "";
    quantityField.removeAttribute("max");
  }
  renderAccountInvoiceProductLines();
}

window.saveAccountInvoice = async function() {
  const order = getSalesOrderByCo(document.getElementById("accountCoSelect")?.value || "");
  const invoiceNumber = accountInvoiceKey(document.getElementById("accountInvoiceNo")?.value);
  window.calculateAccountInvoiceValue();
  const selectedLines = accountInvoiceProductLines.filter(line => salesNumber(line.quantity) > 0);
  const quantity = Math.trunc(selectedLines.reduce((sum, line) => sum + salesNumber(line.quantity), 0));
  const transporterName = String(document.getElementById("accountTransporterSelect")?.value || "").trim();
  const vehicleNumber = accountInvoiceKey(document.getElementById("accountVehicleNumber")?.value);
  const invoiceDate = String(document.getElementById("accountInvoiceDate")?.value || "").trim();
  const modelType = String(document.getElementById("accountModelType")?.value || "").trim();
  const selectedTransporter = (Array.isArray(transportersDb) ? transportersDb : []).find(item => accountInvoiceKey(item.name) === accountInvoiceKey(transporterName));
  const transporterGst = accountInvoiceKey(selectedTransporter?.gst).replace(/[^A-Z0-9]/g, "").slice(0, 15);
  const transporterPan = transporterGst.length >= 12 ? transporterGst.slice(2, 12) : accountInvoiceKey(selectedTransporter?.pan);
  const missing = [];
  if (!order) missing.push("C/O Number");
  if (!accountSelectedProductLineId || !selectedLines.length) missing.push("Product");
  if (!invoiceNumber) missing.push("Invoice Number");
  if (!invoiceDate) missing.push("Invoice Date");
  if (!modelType) missing.push("Model Type");
  if (quantity <= 0) missing.push("Invoice Quantity in at least one Product Line");
  if (!transporterName) missing.push("Transporter");
  if (!vehicleNumber) missing.push("Vehicle Number");
  if (missing.length) {
    window.showNotification({ title: "Accounts Details Required", message: `Complete: ${missing.join(", ")}.`, type: "warning" });
    return;
  }
  if (!selectedTransporter) {
    window.showNotification({ title: "Select Transporter Master", message: "Select a transporter saved in Dispatch → Transporter Master.", type: "warning" });
    return;
  }
  if (transporterGst && (transporterGst.length !== 15 || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(transporterPan) || transporterPan !== transporterGst.slice(2, 12))) {
    window.showNotification({ title: "Invalid Transporter Master GST", message: "Update this transporter's GSTIN in Dispatch → Transporter Master before creating the invoice.", type: "warning" });
    return;
  }
  if (getAccountInvoiceByNumber(invoiceNumber) || (dispatchArchive || []).some(item => accountInvoiceKey(item.invoice) === invoiceNumber)) {
    window.showNotification({ title: "Invoice Already Exists", message: `Invoice ${invoiceNumber} has already been saved.`, type: "danger" });
    return;
  }
  const freshAllocation = getAccountInvoiceProductAllocation(order);
  const invalidLine = selectedLines.find(line => {
    const current = freshAllocation.find(item => String(item.salesOrderLineId) === String(line.salesOrderLineId) || item.lineKey === line.lineKey);
    return !Number.isInteger(salesNumber(line.quantity)) || salesNumber(line.quantity) <= 0 || !current || salesNumber(line.quantity) > salesNumber(current.availableQty);
  });
  if (invalidLine) {
    const current = freshAllocation.find(item => String(item.salesOrderLineId) === String(invalidLine.salesOrderLineId) || item.lineKey === invalidLine.lineKey);
    window.showNotification({ title: "Product Quantity Exceeds Balance", message: `${invalidLine.modelNo} has only ${salesNumber(current?.availableQty).toLocaleString("en-IN")} module(s) available for invoicing.`, type: "danger" });
    return;
  }
  const invoiceLineItems = selectedLines.map(line => ({
    salesOrderLineId: line.salesOrderLineId,
    lineKey: line.lineKey,
    dcrNdcr: line.dcrNdcr,
    modelNo: line.modelNo,
    wattPerModule: salesNumber(line.wattPerModule),
    ratePerWatt: salesNumber(line.ratePerWatt),
    pricePerModule: salesNumber(line.pricePerModule),
    orderedQty: salesNumber(line.orderedQty),
    alreadyInvoicedQty: salesNumber(line.alreadyInvoicedQty),
    availableQtyAtCreation: salesNumber(line.availableQty),
    quantity: Math.trunc(salesNumber(line.quantity)),
    totalWatts: salesNumber(line.totalWatts),
    taxableValue: salesNumber(line.taxableValue),
    taxRate: salesNumber(line.taxRate),
    taxAmount: salesNumber(line.taxAmount),
    invoiceValue: salesNumber(line.invoiceValue)
  }));
  const distinctModels = [...new Set(invoiceLineItems.map(line => line.modelNo).filter(Boolean))];
  const distinctDcr = [...new Set(invoiceLineItems.map(line => line.dcrNdcr).filter(Boolean))];
  const distinctTaxRates = [...new Set(invoiceLineItems.map(line => salesNumber(line.taxRate)))];
  const singleLine = invoiceLineItems.length === 1 ? invoiceLineItems[0] : null;
  const totalWatts = invoiceLineItems.reduce((sum, line) => sum + salesNumber(line.totalWatts), 0);
  const totalValue = invoiceLineItems.reduce((sum, line) => sum + salesNumber(line.taxableValue), 0);
  const taxAmount = invoiceLineItems.reduce((sum, line) => sum + salesNumber(line.taxAmount), 0);
  const rawInvoiceValue = invoiceLineItems.reduce((sum, line) => sum + salesNumber(line.invoiceValue), 0);
  const invoiceValue = Math.round(rawInvoiceValue);
  const roundingOff = invoiceValue - rawInvoiceValue;
  const record = {
    id: `ACC-${Date.now()}`,
    salesOrderId: order.id || "",
    coNumber: order.coNumber,
    customerName: order.customerName,
    customerGst: String(document.getElementById("accountCustomerGst")?.value || "").trim().toUpperCase(),
    invoiceNumber,
    invoiceDate,
    lineItems: invoiceLineItems,
    dcrNdcr: distinctDcr.join(" / "),
    modelNo: distinctModels.length > 1 ? `${distinctModels.length} PRODUCTS` : (distinctModels[0] || ""),
    modelType,
    wattPerModule: singleLine ? salesNumber(singleLine.wattPerModule) : 0,
    ratePerWatt: singleLine ? salesNumber(singleLine.ratePerWatt) : 0,
    pricePerModule: singleLine ? salesNumber(singleLine.pricePerModule) : 0,
    quantity,
    totalWatts,
    totalValue,
    taxRate: distinctTaxRates.length === 1 ? distinctTaxRates[0] : 0,
    taxAmount,
    roundingOff,
    invoiceValue,
    transporterName,
    transporterGst,
    transporterPan,
    vehicleNumber,
    modeTransport: String(document.getElementById("accountModeTransport")?.value || "By Road").trim() || "By Road",
    challanNo: String(document.getElementById("accountChallanNo")?.value || "").trim(),
    deliveryOrderNo: String(document.getElementById("accountDeliveryOrderNo")?.value || "").trim(),
    lrNo: String(document.getElementById("accountLrNo")?.value || "").trim(),
    packingType: String(document.getElementById("accountPackingType")?.value || "Box Packing"),
    hsnCode: String(document.getElementById("accountHsnCode")?.value || "85414300").trim() || "85414300",
    status: "READY FOR DISPATCH",
    createdAt: new Date().toISOString(),
    createdBy: currentLoggedInUser?.username || "SYSTEM"
  };
  accountInvoices.unshift(record);
  const saved = await saveStorage(KEY_ACCOUNT_INVOICES, accountInvoices);
  if (saved === false) {
    accountInvoices = accountInvoices.filter(item => item.id !== record.id);
    return;
  }
  await logEvent("ACCOUNTS", "INVOICE_RELEASED", `Invoice ${invoiceNumber} released for C/O ${order.coNumber}, ${quantity} modules, vehicle ${vehicleNumber}.`);
  window.showNotification({ title: "Invoice Released to Dispatch", message: `Invoice ${invoiceNumber} is ready. Dispatch only needs to select it and add pallets.`, type: "success" });
  resetAccountInvoiceForm();
  renderAccountInvoiceTable();
  populateDispatchInvoiceDropdown();
};

function renderAccountInvoiceTable() {
  const body = document.getElementById("accountInvoiceTableBody");
  if (!body) return;
  const allInvoices = [...(Array.isArray(accountInvoices) ? accountInvoices : []), ...getJbInfraHistoricalInvoiceDisplayRows()];
  if (!jbInfraHistoricalInvoiceRestoreScheduled && getJbInfraHistoricalInvoiceDisplayRows().length) {
    jbInfraHistoricalInvoiceRestoreScheduled = true;
    Promise.resolve().then(() => window.restoreJbInfraHistoricalInvoices()).then(result => {
      if (result?.restored || result?.linked) renderAccountInvoiceTable();
    }).catch(error => {
      jbInfraHistoricalInvoiceRestoreScheduled = false;
      console.error("JB INFRA historical invoice restoration failed.", error);
      window.showNotification?.({ title: "Historical Invoice Restore Pending", message: "The invoices are visible from Dispatch Archive, but database persistence needs another retry.", type: "warning" });
    });
  }
  const search = String(document.getElementById("accountInvoiceFilterSearch")?.value || "").trim().toLowerCase();
  const fromDate = String(document.getElementById("accountInvoiceFilterFromDate")?.value || "");
  const toDate = String(document.getElementById("accountInvoiceFilterToDate")?.value || "");
  const status = String(document.getElementById("accountInvoiceFilterStatus")?.value || "").trim().toUpperCase();
  const invoices = allInvoices.filter(invoice => {
    const invoiceDate = String(invoice.invoiceDate || "").slice(0, 10);
    const invoiceStatus = String(invoice.status || "READY FOR DISPATCH").trim().toUpperCase();
    if (fromDate && invoiceDate < fromDate) return false;
    if (toDate && invoiceDate > toDate) return false;
    if (status && invoiceStatus !== status) return false;
    if (!search) return true;
    return [invoice.invoiceNumber, invoice.invoiceDate, invoice.coNumber, invoice.customerName, invoice.modelNo, invoice.modelType, invoice.quantity, invoice.invoiceValue, invoice.transporterName, invoice.vehicleNumber, invoiceStatus]
      .some(value => String(value ?? "").toLowerCase().includes(search));
  });
  const count = document.getElementById("accountInvoiceFilterCount");
  if (count) count.textContent = `${invoices.length} of ${allInvoices.length} record${allInvoices.length === 1 ? "" : "s"}`;
  if (!invoices.length) {
    body.innerHTML = `<tr><td colspan="11" style="text-align:center; padding:24px; color:var(--muted);">${allInvoices.length ? "No invoice matches the selected filters." : "No Accounts invoice has been saved."}</td></tr>`;
    return;
  }
  body.innerHTML = invoices.map(invoice => {
    const dispatched = String(invoice.status || "").toUpperCase() === "DISPATCHED";
    return `<tr><td><strong>${escapeSalesHtml(invoice.invoiceNumber)}</strong></td><td>${escapeSalesHtml(invoice.invoiceDate)}</td><td>${escapeSalesHtml(invoice.coNumber)}</td><td>${escapeSalesHtml(invoice.customerName)}</td><td>${escapeSalesHtml(invoice.modelNo)}</td><td>${escapeSalesHtml(invoice.modelType)}</td><td>${salesNumber(invoice.quantity).toLocaleString("en-IN")}</td><td>₹${window.accountInvoiceRoundedTotal(invoice).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td>${escapeSalesHtml(invoice.transporterName)}</td><td><code>${escapeSalesHtml(invoice.vehicleNumber)}</code></td><td><span style="font-size:10px; font-weight:800; padding:3px 7px; border-radius:10px; ${dispatched ? "background:#dcfce7; color:#15803d;" : "background:#dbeafe; color:#1d4ed8;"}">${escapeSalesHtml(invoice.status || "READY FOR DISPATCH")}</span></td></tr>`;
  }).join("");
}

window.clearAccountInvoiceFilters = function() {
  ["accountInvoiceFilterSearch", "accountInvoiceFilterFromDate", "accountInvoiceFilterToDate"].forEach(id => { const field = document.getElementById(id); if (field) field.value = ""; });
  const status = document.getElementById("accountInvoiceFilterStatus");
  if (status) status.value = "";
  renderAccountInvoiceTable();
};

function populateEditInvoiceSelect() {
  const select = document.getElementById("editInvoiceSelect");
  const form = document.getElementById("editInvoiceForm");
  if (!select) return;
  const current = select.value;
  const invoices = Array.isArray(accountInvoices) ? accountInvoices : [];
  select.innerHTML = `<option value="">${invoices.length ? "-- Select Invoice --" : "-- No Saved Invoices --"}</option>` + invoices.map(invoice =>
    `<option value="${escapeSalesHtml(invoice.id)}">${escapeSalesHtml(invoice.invoiceNumber)} — ${escapeSalesHtml(invoice.coNumber)} — ${escapeSalesHtml(invoice.customerName)}</option>`
  ).join("");
  if (invoices.some(invoice => String(invoice.id) === String(current))) select.value = current;
  else {
    editingAccountInvoiceId = "";
    if (form) form.style.display = "none";
  }
  window.previewInvoiceForEdit?.();
}

window.previewInvoiceForEdit = function() {
  const id = String(document.getElementById("editInvoiceSelect")?.value || "");
  const preview = document.getElementById("editInvoicePreview");
  const invoice = (accountInvoices || []).find(item => String(item.id) === id);
  if (!preview) return;
  if (!invoice) {
    preview.innerHTML = "Select an invoice to display its saved details.";
    return;
  }
  preview.innerHTML = `<div class="grid-2" style="gap:12px; color:#334155;"><div><strong>Invoice:</strong> ${escapeSalesHtml(invoice.invoiceNumber)}<br><strong>C/O:</strong> ${escapeSalesHtml(invoice.coNumber)}<br><strong>Customer:</strong> ${escapeSalesHtml(invoice.customerName)}<br><strong>Model:</strong> ${escapeSalesHtml(invoice.modelNo)} (${escapeSalesHtml(invoice.modelType)})</div><div><strong>Quantity:</strong> ${salesNumber(invoice.quantity).toLocaleString("en-IN")}<br><strong>Round Off:</strong> ₹${window.accountInvoiceRoundOff(invoice).toLocaleString("en-IN", { minimumFractionDigits:2, maximumFractionDigits:2 })}<br><strong>Invoice Value:</strong> ₹${window.accountInvoiceRoundedTotal(invoice).toLocaleString("en-IN", { minimumFractionDigits:2, maximumFractionDigits:2 })}<br><strong>Transporter:</strong> ${escapeSalesHtml(invoice.transporterName)}<br><strong>Status:</strong> ${escapeSalesHtml(invoice.status || "READY FOR DISPATCH")}</div></div>`;
};

function formatEditInvoiceDateForDisplay(value) {
  const raw = String(value || "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  const dmy = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  return dmy ? `${dmy[1]}-${dmy[2]}-${dmy[3]}` : raw;
}

window.formatEditInvoiceDate = function(input) {
  if (!input) return;
  const digits = String(input.value || "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) input.value = digits;
  else if (digits.length <= 4) input.value = `${digits.slice(0, 2)}-${digits.slice(2)}`;
  else input.value = `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
};

function parseEditInvoiceDate(value) {
  const match = String(value || "").trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return "";
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function editInvoiceSetValue(id, value = "") {
  const field = document.getElementById(id);
  if (field) field.value = value ?? "";
}

window.loadSelectedInvoiceForEdit = function() {
  const id = String(document.getElementById("editInvoiceSelect")?.value || "");
  const invoice = (accountInvoices || []).find(item => String(item.id) === id);
  if (!invoice) {
    window.showNotification({ title:"Invoice Required", message:"Select a saved invoice first.", type:"warning" });
    return;
  }
  editingAccountInvoiceId = invoice.id;
  const coList = document.getElementById("editInvoiceCoList");
  if (coList) coList.innerHTML = (salesOrders || []).map(order => `<option value="${escapeSalesHtml(order.coNumber)}">${escapeSalesHtml(order.customerName)}</option>`).join("");
  const transporter = document.getElementById("editInvoiceTransporter");
  if (transporter) {
    const names = [...new Set([invoice.transporterName, ...(transportersDb || []).map(item => item.name)].map(name => String(name || "").trim()).filter(Boolean))];
    transporter.innerHTML = `<option value="">-- Select Transporter --</option>` + names.map(name => `<option value="${escapeSalesHtml(name)}">${escapeSalesHtml(name)}</option>`).join("");
  }
  [
    ["editInvoiceNumber",invoice.invoiceNumber],["editInvoiceDate",invoice.invoiceDate],["editInvoiceCoNumber",invoice.coNumber],
    ["editInvoiceCustomer",invoice.customerName],["editInvoiceCustomerGst",invoice.customerGst],["editInvoiceDcr",invoice.dcrNdcr],
    ["editInvoiceModel",invoice.modelNo],["editInvoiceModelType",invoice.modelType],["editInvoiceWatt",invoice.wattPerModule],
    ["editInvoiceRate",invoice.ratePerWatt],["editInvoiceQty",invoice.quantity],["editInvoiceTaxRate",invoice.taxRate || 5],
    ["editInvoiceTransporter",invoice.transporterName],["editInvoiceVehicle",invoice.vehicleNumber],["editInvoiceMode",invoice.modeTransport || "By Road"],
    ["editInvoiceChallan",invoice.challanNo],["editInvoiceDeliveryOrder",invoice.deliveryOrderNo || invoice.coNumber],["editInvoiceLr",invoice.lrNo],
    ["editInvoicePacking",invoice.packingType || "Box Packing"],["editInvoiceHsn",invoice.hsnCode || "85414300"]
  ].forEach(([field,value]) => editInvoiceSetValue(field, field === "editInvoiceDate" ? formatEditInvoiceDateForDisplay(value) : value));
  const dispatched = String(invoice.status || "").toUpperCase() === "DISPATCHED";
  const multiProduct = Array.isArray(invoice.lineItems) && invoice.lineItems.length > 1;
  ["editInvoiceNumber","editInvoiceCoNumber","editInvoiceQty","editInvoiceDcr","editInvoiceModel","editInvoiceWatt","editInvoiceRate"].forEach(field => {
    const element = document.getElementById(field);
    if (!element) return;
    const productFinancialField = ["editInvoiceCoNumber","editInvoiceQty","editInvoiceDcr","editInvoiceModel","editInvoiceWatt","editInvoiceRate"].includes(field);
    const protectedField = dispatched || (multiProduct && productFinancialField);
    element.readOnly = protectedField;
    element.style.background = protectedField ? "#f8fafc" : "";
  });
  const modelTypeField = document.getElementById("editInvoiceModelType");
  const taxRateField = document.getElementById("editInvoiceTaxRate");
  if (modelTypeField) modelTypeField.disabled = multiProduct;
  if (taxRateField) taxRateField.disabled = multiProduct;
  const note = document.getElementById("editInvoiceProtectionNote");
  if (note) {
    note.style.display = dispatched || multiProduct ? "block" : "none";
    note.textContent = dispatched
      ? "This invoice has already been dispatched. Invoice Number, C/O Number and dispatched quantity are protected; other corrections still require Administrator approval."
      : multiProduct ? "This is a multi-product invoice. Its product rows, quantities and financial values are protected here; transporter and other logistics corrections can still be sent for approval." : "";
  }
  document.getElementById("editInvoiceForm").style.display = "block";
  window.calculateEditInvoiceValue();
};

window.handleEditInvoiceCoChange = function() {
  const order = getSalesOrderByCo(document.getElementById("editInvoiceCoNumber")?.value || "");
  if (!order) return;
  const customer = (customersDb || []).find(item => String(item.id) === String(order.customerId) || customerMasterKey(item.name) === customerMasterKey(order.customerName));
  editInvoiceSetValue("editInvoiceCoNumber",order.coNumber);
  editInvoiceSetValue("editInvoiceCustomer",order.customerName);
  editInvoiceSetValue("editInvoiceCustomerGst",order.customerGst || customer?.gst || "");
  editInvoiceSetValue("editInvoiceDcr",order.dcrNdcr);
  editInvoiceSetValue("editInvoiceModel",order.modelNo);
  editInvoiceSetValue("editInvoiceWatt",salesNumber(order.moduleWatt || order.wpModule));
  editInvoiceSetValue("editInvoiceRate",salesNumber(order.rateWp));
  editInvoiceSetValue("editInvoiceDeliveryOrder",order.coNumber);
  window.calculateEditInvoiceValue();
};

window.calculateEditInvoiceValue = function() {
  const watt=salesNumber(document.getElementById("editInvoiceWatt")?.value);
  const rate=salesNumber(document.getElementById("editInvoiceRate")?.value);
  const qty=Math.trunc(salesNumber(document.getElementById("editInvoiceQty")?.value));
  const taxRate=salesNumber(document.getElementById("editInvoiceTaxRate")?.value);
  const price=watt*rate,totalWatts=watt*qty,taxable=price*qty,tax=taxable*taxRate/100;
  editInvoiceSetValue("editInvoicePricePerModule",price.toFixed(2));
  editInvoiceSetValue("editInvoiceTotalWatts",totalWatts.toFixed(0));
  editInvoiceSetValue("editInvoiceTaxable",taxable.toFixed(2));
  editInvoiceSetValue("editInvoiceTaxAmount",tax.toFixed(2));
  const rawInvoiceValue=taxable+tax;
  const roundedInvoiceValue=Math.round(rawInvoiceValue);
  editInvoiceSetValue("editInvoiceRoundingOff",(roundedInvoiceValue-rawInvoiceValue).toFixed(2));
  editInvoiceSetValue("editInvoiceValue",roundedInvoiceValue.toFixed(2));
};

window.submitInvoiceEditRequest = async function() {
  const existing = (accountInvoices || []).find(item => String(item.id) === String(editingAccountInvoiceId));
  if (!existing) { window.showNotification({ title:"Invoice Required", message:"Load the invoice again before submitting.", type:"warning" }); return; }
  const value=id=>String(document.getElementById(id)?.value||"").trim();
  const order=getSalesOrderByCo(value("editInvoiceCoNumber"));
  const invoiceNumber=accountInvoiceKey(value("editInvoiceNumber"));
  const invoiceDate=parseEditInvoiceDate(value("editInvoiceDate"));
  const multiProduct = Array.isArray(existing.lineItems) && existing.lineItems.length > 1;
  const quantity=multiProduct ? Math.trunc(salesNumber(existing.quantity)) : Math.trunc(salesNumber(value("editInvoiceQty")));
  const transporterName=value("editInvoiceTransporter");
  const transporter=(transportersDb||[]).find(item=>accountInvoiceKey(item.name)===accountInvoiceKey(transporterName));
  const missing=[];
  if(!invoiceNumber)missing.push("Invoice Number");if(!invoiceDate)missing.push("Invoice Date (DD-MM-YYYY)");if(!order)missing.push("valid C/O Number");if(!value("editInvoiceModelType"))missing.push("Model Type");if(quantity<=0)missing.push("Quantity");if(!transporterName)missing.push("Transporter");if(!value("editInvoiceVehicle"))missing.push("Vehicle Number");
  if(missing.length){window.showNotification({title:"Invoice Details Required",message:`Complete: ${missing.join(", ")}.`,type:"warning"});return;}
  const duplicate=(accountInvoices||[]).some(item=>String(item.id)!==String(existing.id)&&accountInvoiceKey(item.invoiceNumber)===invoiceNumber);
  if(duplicate){window.showNotification({title:"Invoice Already Exists",message:`Invoice ${invoiceNumber} is already saved.`,type:"danger"});return;}
  const dispatched=String(existing.status||"").toUpperCase()==="DISPATCHED";
  if(multiProduct&&salesCoKey(order.coNumber)!==salesCoKey(existing.coNumber)){window.showNotification({title:"Multi-Product Invoice Protected",message:"The C/O and product allocation of a multi-product invoice cannot be changed in the general edit form.",type:"danger"});return;}
  if(dispatched&&(invoiceNumber!==accountInvoiceKey(existing.invoiceNumber)||salesCoKey(order.coNumber)!==salesCoKey(existing.coNumber)||quantity!==salesNumber(existing.quantity))){window.showNotification({title:"Dispatched Invoice Protected",message:"Invoice Number, C/O Number and quantity cannot change after dispatch.",type:"danger"});return;}
  const available=getAccountInvoiceAvailableQty(order)+(salesCoKey(order.coNumber)===salesCoKey(existing.coNumber)&&!dispatched?salesNumber(existing.quantity):0);
  if(!dispatched&&quantity>available){window.showNotification({title:"Quantity Exceeds C/O Balance",message:`Only ${available.toLocaleString("en-IN")} module(s) are available for this invoice.`,type:"danger"});return;}
  const alreadyPending=(requestsDb||[]).some(request=>request.status==="PENDING"&&["EDIT_ACCOUNT_INVOICE","DELETE_ACCOUNT_INVOICE"].includes(request.type)&&String(request.payload?.accountInvoiceId)===String(existing.id));
  if(alreadyPending){window.showNotification({title:"Request Already Pending",message:`Invoice ${existing.invoiceNumber} already has an edit or deletion request awaiting Administrator approval.`,type:"warning"});return;}
  const gst=accountInvoiceKey(transporter?.gst||existing.transporterGst).replace(/[^A-Z0-9]/g,"").slice(0,15);
  const proposedFinancials = multiProduct ? {
    dcrNdcr: existing.dcrNdcr, modelNo: existing.modelNo, modelType: existing.modelType,
    wattPerModule: existing.wattPerModule, ratePerWatt: existing.ratePerWatt, pricePerModule: existing.pricePerModule,
    quantity: existing.quantity, totalWatts: existing.totalWatts, totalValue: existing.totalValue,
    taxRate: existing.taxRate, taxAmount: existing.taxAmount,
    roundingOff: Math.round((existing.lineItems || []).reduce((sum,line)=>sum+salesNumber(line.invoiceValue),0))-(existing.lineItems || []).reduce((sum,line)=>sum+salesNumber(line.invoiceValue),0),
    invoiceValue: Math.round((existing.lineItems || []).reduce((sum,line)=>sum+salesNumber(line.invoiceValue),0)),
    lineItems: existing.lineItems.map(line => ({...line}))
  } : {
    dcrNdcr:value("editInvoiceDcr"),modelNo:value("editInvoiceModel"),modelType:value("editInvoiceModelType"),wattPerModule:salesNumber(value("editInvoiceWatt")),ratePerWatt:salesNumber(value("editInvoiceRate")),pricePerModule:salesNumber(value("editInvoicePricePerModule")),quantity,totalWatts:salesNumber(value("editInvoiceTotalWatts")),totalValue:salesNumber(value("editInvoiceTaxable")),taxRate:salesNumber(value("editInvoiceTaxRate")),taxAmount:salesNumber(value("editInvoiceTaxAmount")),roundingOff:salesNumber(value("editInvoiceRoundingOff")),invoiceValue:salesNumber(value("editInvoiceValue"))
  };
  const proposed={...existing,...proposedFinancials,salesOrderId:order.id,coNumber:order.coNumber,customerName:value("editInvoiceCustomer"),customerGst:accountInvoiceKey(value("editInvoiceCustomerGst")),invoiceNumber,invoiceDate,transporterName,transporterGst:gst,transporterPan:gst.length>=12?gst.slice(2,12):accountInvoiceKey(transporter?.pan||existing.transporterPan),vehicleNumber:accountInvoiceKey(value("editInvoiceVehicle")),modeTransport:value("editInvoiceMode")||"By Road",challanNo:value("editInvoiceChallan"),deliveryOrderNo:order.coNumber,lrNo:value("editInvoiceLr"),packingType:value("editInvoicePacking")||"Box Packing",hsnCode:value("editInvoiceHsn")||"85414300",updatedAt:new Date().toISOString(),updatedBy:currentLoggedInUser?.username||"SYSTEM"};
  const reason=await window.showPromptDialog({title:"Request Invoice Edit",message:`Send the proposed corrections for invoice ${existing.invoiceNumber} to Administrator?`,label:"Reason for Edit *",placeholder:"Example: vehicle number correction, revised transporter, invoice correction...",confirmText:"Send for Approval"});
  if(!reason)return;
  const request={id:"REQ-"+Date.now(),type:"EDIT_ACCOUNT_INVOICE",targetId:`Invoice ${existing.invoiceNumber}`,details:`${existing.coNumber} | ${existing.customerName} | Qty ${salesNumber(existing.quantity).toLocaleString("en-IN")} → ${quantity.toLocaleString("en-IN")} | Value ₹${salesNumber(existing.invoiceValue).toLocaleString("en-IN")} → ₹${salesNumber(proposed.invoiceValue).toLocaleString("en-IN")}`,payload:{accountInvoiceId:existing.id,proposedInvoice:proposed},requestedBy:currentLoggedInUser?.username||"OPERATOR",requestedAt:new Date().toLocaleString(),reason,status:"PENDING",reviewedBy:"-",reviewedAt:"-",adminRemark:"-"};
  requestsDb.unshift(request);
  if(!await saveStorage(KEY_REQUESTS,requestsDb)){requestsDb=requestsDb.filter(item=>String(item.id)!==String(request.id));return;}
  await logEvent("ACCOUNTS","INVOICE_EDIT_REQUESTED",`Requested edit for invoice ${existing.invoiceNumber}.`);
  window.showNotification({title:"Invoice Edit Request Submitted",message:`Invoice ${existing.invoiceNumber} remains unchanged until Administrator approval.`,type:"success"});
  editingAccountInvoiceId="";document.getElementById("editInvoiceForm").style.display="none";populateEditInvoiceSelect();
};

function getInvoiceDispatchLink(invoice) {
  if (!invoice) return null;
  const invoiceId = String(invoice.id || "");
  const invoiceNumber = accountInvoiceKey(invoice.invoiceNumber);
  const archiveRecord = (dispatchArchive || []).find(manifest =>
    (invoiceId && String(manifest.accountInvoiceId || "") === invoiceId)
    || (invoiceNumber && accountInvoiceKey(manifest.invoice) === invoiceNumber)
  );
  if (archiveRecord) return archiveRecord;
  if (String(invoice.status || "").toUpperCase() === "DISPATCHED" || String(invoice.dispatchId || "").trim()) {
    return { id: invoice.dispatchId || "DISPATCHED", invoice: invoice.invoiceNumber };
  }
  return null;
}

function populateDeleteInvoiceSelect() {
  const select = document.getElementById("deleteInvoiceSelect");
  const preview = document.getElementById("deleteInvoicePreview");
  if (!select) return;
  const current = String(select.value || "");
  const invoices = Array.isArray(accountInvoices) ? accountInvoices : [];
  select.innerHTML = `<option value="">${invoices.length ? "-- Select Undispatched Invoice --" : "-- No Saved Invoices --"}</option>` + invoices.map(invoice => {
    const protectedInvoice = Boolean(getInvoiceDispatchLink(invoice));
    const suffix = protectedInvoice ? " — DISPATCHED (CANNOT DELETE)" : "";
    return `<option value="${escapeSalesHtml(invoice.id)}" ${protectedInvoice ? "disabled" : ""}>${escapeSalesHtml(invoice.invoiceNumber)} — ${escapeSalesHtml(invoice.coNumber)} — ${escapeSalesHtml(invoice.customerName)}${suffix}</option>`;
  }).join("");
  if (invoices.some(invoice => String(invoice.id) === current && !getInvoiceDispatchLink(invoice))) select.value = current;
  else select.value = "";
  if (select.value) window.previewInvoiceForDelete?.();
  else if (preview) preview.innerHTML = "Select an invoice to display its saved details.";
}

window.previewInvoiceForDelete = function() {
  const id = String(document.getElementById("deleteInvoiceSelect")?.value || "");
  const preview = document.getElementById("deleteInvoicePreview");
  const invoice = (accountInvoices || []).find(item => String(item.id) === id);
  if (!preview) return;
  if (!invoice) {
    preview.innerHTML = "Select an invoice to display its saved details.";
    return;
  }
  const dispatchLink = getInvoiceDispatchLink(invoice);
  preview.innerHTML = `<div class="grid-2" style="gap:12px; color:#334155;"><div><strong>Invoice:</strong> ${escapeSalesHtml(invoice.invoiceNumber)}<br><strong>Date:</strong> ${escapeSalesHtml(invoice.invoiceDate)}<br><strong>C/O:</strong> ${escapeSalesHtml(invoice.coNumber)}<br><strong>Customer:</strong> ${escapeSalesHtml(invoice.customerName)}</div><div><strong>Quantity:</strong> ${salesNumber(invoice.quantity).toLocaleString("en-IN")}<br><strong>Round Off:</strong> ₹${window.accountInvoiceRoundOff(invoice).toLocaleString("en-IN", { minimumFractionDigits:2, maximumFractionDigits:2 })}<br><strong>Invoice Value:</strong> ₹${window.accountInvoiceRoundedTotal(invoice).toLocaleString("en-IN", { minimumFractionDigits:2, maximumFractionDigits:2 })}<br><strong>Vehicle:</strong> ${escapeSalesHtml(invoice.vehicleNumber)}<br><strong>Status:</strong> ${escapeSalesHtml(invoice.status || "READY FOR DISPATCH")}</div></div>${dispatchLink ? `<div style="margin-top:10px; color:#b91c1c; font-weight:800;">This invoice is dispatched and can never be deleted.</div>` : `<div style="margin-top:10px; color:#15803d; font-weight:800;">This invoice is not dispatched and may be sent for Administrator approval.</div>`}`;
};

window.submitInvoiceDeleteRequest = async function() {
  const id = String(document.getElementById("deleteInvoiceSelect")?.value || "");
  const invoice = (accountInvoices || []).find(item => String(item.id) === id);
  if (!invoice) {
    window.showNotification({ title:"Invoice Required", message:"Select an undispatched invoice to delete.", type:"warning" });
    return;
  }
  if (getInvoiceDispatchLink(invoice)) {
    window.showNotification({ title:"Dispatched Invoice Protected", message:`Invoice ${invoice.invoiceNumber} is dispatched and cannot be deleted under any condition.`, type:"danger" });
    return;
  }
  const alreadyPending = (requestsDb || []).some(request =>
    request.status === "PENDING"
    && ["EDIT_ACCOUNT_INVOICE", "DELETE_ACCOUNT_INVOICE"].includes(request.type)
    && String(request.payload?.accountInvoiceId || "") === String(invoice.id)
  );
  if (alreadyPending) {
    window.showNotification({ title:"Request Already Pending", message:`Invoice ${invoice.invoiceNumber} already has an edit or deletion request awaiting Administrator approval.`, type:"warning" });
    return;
  }
  const reason = await window.showPromptDialog({
    title:"Request Invoice Deletion",
    message:`Send a deletion request for invoice ${invoice.invoiceNumber}? It will remain active until an Administrator approves the request.`,
    label:"Reason for Deletion *",
    placeholder:"Example: duplicate invoice, invoice created by mistake...",
    confirmText:"Send for Approval",
    isDanger:true
  });
  if (!reason) return;
  const request = {
    id:"REQ-" + Date.now(),
    type:"DELETE_ACCOUNT_INVOICE",
    targetId:`Invoice ${invoice.invoiceNumber}`,
    details:`${invoice.coNumber} | ${invoice.customerName} | Qty ${salesNumber(invoice.quantity).toLocaleString("en-IN")} | Value ₹${salesNumber(invoice.invoiceValue).toLocaleString("en-IN", { minimumFractionDigits:2, maximumFractionDigits:2 })}`,
    payload:{ accountInvoiceId:invoice.id, invoiceNumber:invoice.invoiceNumber, coNumber:invoice.coNumber },
    requestedBy:currentLoggedInUser?.username || "OPERATOR",
    requestedAt:new Date().toLocaleString(),
    reason,
    status:"PENDING",
    reviewedBy:"-",
    reviewedAt:"-",
    adminRemark:"-"
  };
  requestsDb.unshift(request);
  if (!await saveStorage(KEY_REQUESTS, requestsDb)) {
    requestsDb = requestsDb.filter(item => String(item.id) !== String(request.id));
    return;
  }
  await logEvent("ACCOUNTS", "INVOICE_DELETE_REQUESTED", `Requested deletion of undispatched invoice ${invoice.invoiceNumber}.`);
  window.showNotification({ title:"Deletion Request Submitted", message:`Invoice ${invoice.invoiceNumber} remains active until Administrator approval.`, type:"warning" });
  populateDeleteInvoiceSelect();
};

function receiptPartyKey(value) {
  return String(value || "").trim().toUpperCase();
}

function getReceiptParties() {
  return (Array.isArray(customersDb) ? customersDb : [])
    .map(customer => ({ ...customer, name: String(customer.name || "").trim(), receiptSource: "CUSTOMER MASTER" }))
    .filter(customer => customer.name && customer.id)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function getReceiptPartyById(customerId) {
  return getReceiptParties().find(customer => String(customer.id) === String(customerId));
}

function getReceiptPartyOrders(customer) {
  if (!customer) return [];
  return (salesOrders || []).filter(order =>
    String(order.customerId || "") === String(customer.id || "")
    || receiptPartyKey(order.customerName) === receiptPartyKey(customer.name)
  );
}

function getReceiptPartySalesPeople(customer) {
  const unique = new Map();
  getReceiptPartyOrders(customer).forEach(order => {
    const person = String(order.salesPerson || (salesPeople || []).find(item => String(item.id) === String(order.salesPersonId))?.name || "").trim();
    if (person) unique.set(receiptPartyKey(person), person);
  });
  return [...unique.values()];
}

function getPartyReceiptPosition(partyName) {
  const key = receiptPartyKey(partyName);
  if (!key) return { totalInvoiced: 0, receivedTillDate: 0, pending: 0 };
  const totalInvoiced = (accountInvoices || [])
    .filter(invoice => receiptPartyKey(invoice.customerName) === key)
    .reduce((sum, invoice) => sum + window.accountInvoiceRoundedTotal(invoice), 0);
  const receivedTillDate = (accountReceiptsDb || [])
    .filter(receipt => receiptPartyKey(receipt.partyName) === key)
    .reduce((sum, receipt) => sum + Number(receipt.balanceEffect ?? receipt.amount ?? 0), 0);
  return {
    totalInvoiced: Math.round(totalInvoiced * 100) / 100,
    receivedTillDate: Math.round(receivedTillDate * 100) / 100,
    pending: Math.max(0, Math.round((totalInvoiced - receivedTillDate) * 100) / 100),
    advanceBalance: Math.max(0, Math.round((receivedTillDate - totalInvoiced) * 100) / 100)
  };
}

function getAccountsReportPartyNames() {
  const names = new Map();
  (accountInvoices || []).forEach(invoice => {
    const name = String(invoice.customerName || "").trim();
    if (name) names.set(receiptPartyKey(name), name);
  });
  (accountReceiptsDb || []).forEach(receipt => {
    const name = String(receipt.partyName || "").trim();
    if (name) names.set(receiptPartyKey(name), name);
  });
  return [...names.entries()].filter(([key]) => key).sort((a, b) => a[1].localeCompare(b[1]));
}

function getAccountsReportLedgerRows(partyKeys) {
  const entries = [];
  for (const [key, name] of getAccountsReportPartyNames()) {
    if (partyKeys.size && !partyKeys.has(key)) continue;
    (accountInvoices || []).filter(invoice => receiptPartyKey(invoice.customerName) === key).forEach(invoice => {
      const amount = window.accountInvoiceRoundedTotal(invoice);
      entries.push({ sortDate: reportHubYmd(invoice.invoiceDate || invoice.createdAt), date: reportHubDisplayDate(invoice.invoiceDate || invoice.createdAt), key, name, particulars: "Invoice", reference: invoice.invoiceNumber || invoice.coNumber || "-", debit: amount, credit: 0 });
    });
    (accountReceiptsDb || []).filter(receipt => receiptPartyKey(receipt.partyName) === key).forEach(receipt => {
      const effect = Number(receipt.balanceEffect ?? receipt.amount ?? 0);
      entries.push({ sortDate: reportHubYmd(receipt.date || receipt.createdAt), date: reportHubDisplayDate(receipt.date || receipt.createdAt), key, name, particulars: receipt.transactionType || "RECEIPT", reference: receipt.id || receipt.coNumber || "-", debit: Math.max(0, -effect), credit: Math.max(0, effect) });
    });
  }
  entries.sort((a, b) => a.sortDate.localeCompare(b.sortDate) || a.name.localeCompare(b.name) || a.particulars.localeCompare(b.particulars));
  const balances = new Map();
  return entries.map(entry => {
    const balance = Math.round(((balances.get(entry.key) || 0) + entry.debit - entry.credit) * 100) / 100;
    balances.set(entry.key, balance);
    return { ...entry, balance };
  });
}

window.renderAccountsReports = function() {
  const typeSelect = document.getElementById("accountsReportType");
  const customerSelect = document.getElementById("accountsReportCustomer");
  const head = document.getElementById("accountsReportHead");
  const body = document.getElementById("accountsReportBody");
  const summary = document.getElementById("accountsReportSummary");
  const caption = document.getElementById("accountsReportCaption");
  const customerList = document.getElementById("accountsReportCustomerList");
  if (!typeSelect || !customerSelect || !customerList || !head || !body || !summary) return;
  const previousCustomer = String(customerSelect.value || "");
  const parties = getAccountsReportPartyNames();
  customerList.innerHTML = parties.map(([, name]) => `<option value="${escapeSalesHtml(name)}"></option>`).join("");
  customerSelect.value = previousCustomer;
  const enteredCustomer = previousCustomer.trim();
  const selectedKey = enteredCustomer ? receiptPartyKey(enteredCustomer) : "ALL";
  const partyKeys = selectedKey === "ALL" ? new Set() : new Set([selectedKey]);
  const type = typeSelect.value || "LEDGER";
  let headings = [];
  let rows = [];
  let summaryItems = [];
  if (type === "LEDGER") {
    headings = ["DATE", "CUSTOMER", "PARTICULARS", "REFERENCE", "DEBIT (₹)", "CREDIT (₹)", "BALANCE (₹)"];
    rows = getAccountsReportLedgerRows(partyKeys);
    const debits = rows.reduce((sum, row) => sum + row.debit, 0);
    const credits = rows.reduce((sum, row) => sum + row.credit, 0);
    const closingBalances = new Map();
    rows.forEach(row => closingBalances.set(row.key, row.balance));
    const closingTotal = [...closingBalances.values()].reduce((sum, amount) => sum + amount, 0);
    summaryItems = [["Total debit", debits], ["Total credit", credits], ["Closing balance", closingTotal]];
    if (caption) caption.textContent = `${rows.length.toLocaleString("en-IN")} ledger entr${rows.length === 1 ? "y" : "ies"}${selectedKey === "ALL" ? " · All customers" : ` · ${enteredCustomer}`}`;
    body.innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeSalesHtml(row.date)}</td><td><strong>${escapeSalesHtml(row.name)}</strong></td><td>${escapeSalesHtml(row.particulars)}</td><td>${escapeSalesHtml(row.reference)}</td><td>${row.debit ? `₹${row.debit.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-"}</td><td>${row.credit ? `₹${row.credit.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-"}</td><td style="font-weight:900; color:${row.balance < 0 ? "#059669" : "#b45309"};">₹${row.balance.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>`).join("") : `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted);">No ledger entries found.</td></tr>`;
  } else {
    const positions = getAccountsReportPartyNames().filter(([key]) => !partyKeys.size || partyKeys.has(key)).map(([key, name]) => ({ key, name, ...getPartyReceiptPosition(name) }));
    const outstandingReport = type === "OUTSTANDING";
    headings = outstandingReport ? ["CUSTOMER", "INVOICED TOTAL (₹)", "RECEIVED / ADJUSTED (₹)", "OUTSTANDING RECEIVABLE (₹)"] : ["CUSTOMER", "INVOICED TOTAL (₹)", "RECEIVED / ADJUSTED (₹)", "ADVANCE FROM CUSTOMER (₹)"];
    rows = positions.filter(item => outstandingReport ? item.pending > 0 : item.advanceBalance > 0).sort((a, b) => outstandingReport ? b.pending - a.pending : b.advanceBalance - a.advanceBalance);
    const totalBalance = rows.reduce((sum, item) => sum + (outstandingReport ? item.pending : item.advanceBalance), 0);
    summaryItems = [[outstandingReport ? "Total receivable" : "Total customer advance", totalBalance], ["Customer accounts", rows.length]];
    if (caption) caption.textContent = `${rows.length.toLocaleString("en-IN")} customer account${rows.length === 1 ? "" : "s"}${selectedKey === "ALL" ? " · All customers" : ` · ${enteredCustomer}`}`;
    body.innerHTML = rows.length ? rows.map(item => { const balance = outstandingReport ? item.pending : item.advanceBalance; return `<tr><td><strong>${escapeSalesHtml(item.name)}</strong></td><td>₹${item.totalInvoiced.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td>₹${item.receivedTillDate.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td style="font-weight:900;color:${outstandingReport ? "#b45309" : "#059669"};">₹${balance.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>`; }).join("") : `<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--muted);">No ${outstandingReport ? "outstanding receivables" : "customer advances"} found.</td></tr>`;
  }
  head.innerHTML = headings.map(label => `<th>${escapeSalesHtml(label)}</th>`).join("");
  summary.innerHTML = summaryItems.map(([label, value]) => { const display = /customer accounts/i.test(label) ? Number(value).toLocaleString("en-IN") : `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; return `<div style="padding:13px 15px;border:1px solid #dbe4ee;border-radius:10px;background:#f8fbff;"><div style="font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;">${escapeSalesHtml(label)}</div><strong style="display:block;margin-top:5px;font-size:19px;color:#0f172a;">${display}</strong></div>`; }).join("");
};

window.clearAccountsReportFilters = function() {
  const customer = document.getElementById("accountsReportCustomer");
  if (customer) customer.value = "";
  window.renderAccountsReports();
};

window.exportAccountsReportExcel = async function() {
  const head = [...(document.querySelectorAll("#accountsReportHead th") || [])].map(cell => cell.textContent.trim());
  const rows = [...(document.querySelectorAll("#accountsReportBody tr") || [])].map(row => [...row.querySelectorAll("td")].map(cell => cell.textContent.trim())).filter(row => row.length === head.length);
  if (!head.length || !rows.length) { window.showNotification({ title: "No Report Data", message: "Select a report with data before exporting.", type: "warning" }); return; }
  if (!window.ExcelJS) { window.showNotification({ title: "Excel Export Unavailable", message: "Refresh the ERP so the Excel library can load, then try again.", type: "error" }); return; }
  const workbook = new window.ExcelJS.Workbook();
  workbook.creator = "DemoSolar Industries ERP";
  const reportType = document.getElementById("accountsReportType")?.value || "OUTSTANDING";
  const reportName = reportType === "ADVANCE" ? "Advance From Customer" : reportType === "OUTSTANDING" ? "Outstanding Receivable" : "Accounts Report";
  const sheet = workbook.addWorksheet(reportName.slice(0, 31));
  sheet.addRow(head);
  rows.forEach(row => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: head.length } };
  sheet.columns = head.map((label, index) => ({ header: label, key: `c${index}`, width: Math.min(32, Math.max(16, label.length + 4)) }));
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Accounts_${reportType}_${reportHubYmd(new Date()) || "Export"}.xlsx`;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(link.href);
};

function getReceiptBalanceEffect(transactionType, amount) {
  const type = receiptPartyKey(transactionType || "RECEIPT");
  const value = Math.max(0, Number(amount || 0));
  if (type === "DEBIT NOTE") return -value;
  return value;
}

function populateReceiptSalesPersonList() {
  const list = document.getElementById("receiptSalesPersonList");
  if (!list) return;
  const people = (Array.isArray(salesPeople) ? salesPeople : [])
    .filter(person => String(person.status || "ACTIVE").toUpperCase() !== "INACTIVE")
    .map(person => String(person.name || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  list.innerHTML = [...new Set(people.map(name => receiptPartyKey(name)))].map(key => {
    const name = people.find(item => receiptPartyKey(item) === key) || key;
    return `<option value="${escapeSalesHtml(name)}"></option>`;
  }).join("");
}

function setReceiptMoneyField(id, amount) {
  accountSetValue(id, Number(amount || 0).toFixed(2));
}

window.updateReceiptPendingPreview = function() {
  const customer = getReceiptPartyById(selectedReceiptCustomerId);
  const position = getPartyReceiptPosition(customer?.name || "");
  const enteredAmount = Math.max(0, Number(document.getElementById("receiptAmount")?.value || 0));
  const transactionType = document.getElementById("receiptTransactionType")?.value || "RECEIPT";
  const balanceEffect = getReceiptBalanceEffect(transactionType, enteredAmount);
  setReceiptMoneyField("receiptTotalInvoiced", position.totalInvoiced);
  setReceiptMoneyField("receiptReceivedTillDate", position.receivedTillDate);
  setReceiptMoneyField("receiptPendingBefore", position.pending);
  setReceiptMoneyField("receiptPendingAfter", Math.max(0, position.pending - balanceEffect));
};

function renderReceiptPartyOptions(query = "") {
  const panel = document.getElementById("receiptPartyOptions");
  if (!panel) return;
  const search = receiptPartyKey(query);
  const parties = getReceiptParties().filter(customer => {
    const orders = getReceiptPartyOrders(customer);
    const people = getReceiptPartySalesPeople(customer);
    return !search || [customer.name, customer.gst, ...orders.map(order => order.coNumber), ...people].some(value => receiptPartyKey(value).includes(search));
  });
  panel.innerHTML = parties.length ? parties.map(customer => {
    const orders = getReceiptPartyOrders(customer);
    const people = getReceiptPartySalesPeople(customer);
    const selected = String(customer.id) === String(selectedReceiptCustomerId);
    const position = getPartyReceiptPosition(customer.name);
    const accountStatus = position.pending > 0
      ? `Outstanding ₹${position.pending.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
      : position.advanceBalance > 0
        ? `Advance ₹${position.advanceBalance.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
        : position.totalInvoiced > 0 ? "No outstanding" : "Advance payment available";
    return `<button type="button" class="account-co-option${selected ? " selected" : ""}" role="option" aria-selected="${selected}" data-customer-id="${escapeSalesHtml(customer.id)}" onclick="selectReceiptParty(this.dataset.customerId)"><span class="account-co-option-code">${escapeSalesHtml(customer.name)}</span><span class="account-co-option-details"><span class="account-co-option-customer">${escapeSalesHtml(customer.receiptSource || "CUSTOMER MASTER")} • ${orders.length} C/O record(s)</span><span class="account-co-option-qty">${escapeSalesHtml(accountStatus)} • ${escapeSalesHtml(people.join(", ") || "Select Sales Person")}</span></span></button>`;
  }).join("") : `<div class="account-co-empty">No party matches your search in Customer Master.</div>`;
}

window.populateReceiptPartyDropdown = function() {
  const input = document.getElementById("receiptPartyName");
  if (!input) return;
  populateReceiptSalesPersonList();
  const selectedCustomer = getReceiptPartyById(selectedReceiptCustomerId);
  if (selectedCustomer) {
    input.value = selectedCustomer.name || "";
    accountSetValue("receiptSalesPerson", getReceiptPartySalesPeople(selectedCustomer)[0] || "");
  }
  renderReceiptPartyOptions(input.value);
  window.updateReceiptPendingPreview();
};

window.openReceiptPartyDropdown = function() {
  const wrapper = document.getElementById("receiptPartyCombobox");
  const input = document.getElementById("receiptPartyName");
  if (!wrapper || !input) return;
  renderReceiptPartyOptions(input.value);
  wrapper.classList.add("open");
  input.setAttribute("aria-expanded", "true");
};

window.closeReceiptPartyDropdown = function() {
  document.getElementById("receiptPartyCombobox")?.classList.remove("open");
  document.getElementById("receiptPartyName")?.setAttribute("aria-expanded", "false");
};

window.toggleReceiptPartyDropdown = function() {
  const wrapper = document.getElementById("receiptPartyCombobox");
  if (wrapper?.classList.contains("open")) window.closeReceiptPartyDropdown();
  else window.openReceiptPartyDropdown();
};

window.handleReceiptPartySearchInput = function() {
  selectedReceiptCustomerId = "";
  accountSetValue("receiptSalesPerson", "");
  window.updateReceiptPendingPreview();
  renderReceiptPartyOptions(document.getElementById("receiptPartyName")?.value || "");
  window.openReceiptPartyDropdown();
};

window.handleReceiptPartySearchKeydown = function(event) {
  const options = [...document.querySelectorAll("#receiptPartyOptions .account-co-option")];
  if (event.key === "Escape") {
    window.closeReceiptPartyDropdown();
    return;
  }
  if (event.key === "ArrowDown" && options.length) {
    event.preventDefault();
    options[0].focus();
  }
};

window.selectReceiptParty = function(customerId) {
  const customer = getReceiptPartyById(customerId);
  if (!customer) return;
  selectedReceiptCustomerId = String(customer.id);
  accountSetValue("receiptPartyName", customer.name);
  accountSetValue("receiptSalesPerson", getReceiptPartySalesPeople(customer)[0] || "");
  window.updateReceiptPendingPreview();
  window.closeReceiptPartyDropdown();
};

document.addEventListener("click", event => {
  if (!event.target.closest("#receiptPartyCombobox")) window.closeReceiptPartyDropdown?.();
});

function getReceiptTodayValue() {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()}`;
}

window.formatReceiptDateInput = function(input) {
  if (!input) return;
  const maxDigits = input.id === "receiptDateYear" ? 4 : 2;
  input.value = String(input.value || "").replace(/\D/g, "").slice(0, maxDigits);
  const parts = [...document.querySelectorAll(".receipt-date-part")];
  const index = parts.indexOf(input);
  if (input.value.length === maxDigits && index >= 0 && index < parts.length - 1) parts[index + 1].focus();
  syncReceiptDateSegments();
};

function syncReceiptDateSegments() {
  const day = String(document.getElementById("receiptDateDay")?.value || "").padStart(2, "0");
  const month = String(document.getElementById("receiptDateMonth")?.value || "").padStart(2, "0");
  const year = String(document.getElementById("receiptDateYear")?.value || "");
  accountSetValue("receiptDate", `${day}-${month}-${year}`);
}

function setReceiptDateSegments(dateValue) {
  const match = String(dateValue || "").match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return;
  accountSetValue("receiptDateDay", match[1]);
  accountSetValue("receiptDateMonth", match[2]);
  accountSetValue("receiptDateYear", match[3]);
  syncReceiptDateSegments();
}

window.setReceiptDateFromPicker = function(isoDate) {
  const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return;
  setReceiptDateSegments(`${match[3]}-${match[2]}-${match[1]}`);
  accountSetValue("receiptDatePicker", isoDate);
};

function receiptDateToIso(value) {
  const match = String(value || "").trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return "";
  const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function resetAccountReceiptForm() {
  selectedReceiptCustomerId = "";
  accountSetValue("receiptTransactionType", "RECEIPT");
  setReceiptDateSegments(getReceiptTodayValue());
  accountSetValue("receiptDatePicker", receiptDateToIso(document.getElementById("receiptDate")?.value));
  accountSetValue("receiptPartyName", "");
  accountSetValue("receiptAmount", "");
  accountSetValue("receiptBankUnit", "");
  accountSetValue("receiptSalesPerson", "");
  populateReceiptSalesPersonList();
  ["receiptTotalInvoiced", "receiptReceivedTillDate", "receiptPendingBefore", "receiptPendingAfter"].forEach(id => setReceiptMoneyField(id, 0));
  window.closeReceiptPartyDropdown?.();
}

window.saveAccountReceipt = async function() {
  const transactionType = receiptPartyKey(document.getElementById("receiptTransactionType")?.value || "");
  const date = receiptDateToIso(document.getElementById("receiptDate")?.value || "");
  const amount = Number(document.getElementById("receiptAmount")?.value || 0);
  const bankUnit = receiptPartyKey(document.getElementById("receiptBankUnit")?.value || "");
  const typedSalesPerson = String(document.getElementById("receiptSalesPerson")?.value || "").trim();
  const customer = getReceiptPartyById(selectedReceiptCustomerId);
  const typedParty = receiptPartyKey(document.getElementById("receiptPartyName")?.value);
  if (!date) {
    window.showNotification({ title: "Invalid Date", message: "Enter the receipt date in DD-MM-YYYY format.", type: "warning" });
    return;
  }
  if (!transactionType || !customer || receiptPartyKey(customer.name) !== typedParty || !Number.isFinite(amount) || amount <= 0 || !bankUnit || !typedSalesPerson) {
    window.showNotification({ title: "Transaction Details Required", message: "Complete Transaction Type, Date, Party, Amount, Bank / Unit and Sales Person.", type: "warning" });
    return;
  }
  const salesPersonRecord = (salesPeople || []).find(person => receiptPartyKey(person.name) === receiptPartyKey(typedSalesPerson) && String(person.status || "ACTIVE").toUpperCase() !== "INACTIVE");
  if (!salesPersonRecord) {
    window.showNotification({ title: "Select Sales Person from Master", message: "Choose an active Sales Person from Sales Person Master.", type: "warning" });
    return;
  }
  const partyOrders = getReceiptPartyOrders(customer);
  const salesPerson = String(salesPersonRecord.name || typedSalesPerson).trim();
  const position = getPartyReceiptPosition(customer.name);
  const balanceEffect = getReceiptBalanceEffect(transactionType, amount);
  const linkedOrder = partyOrders.find(order => receiptPartyKey(order.salesPerson || (salesPeople || []).find(item => String(item.id) === String(order.salesPersonId))?.name) === receiptPartyKey(salesPerson)) || partyOrders[0] || null;
  const pendingAfter = Math.max(0, Math.round((position.pending - balanceEffect) * 100) / 100);
  const receivedAfter = Math.round((position.receivedTillDate + balanceEffect) * 100) / 100;
  const advanceBefore = position.advanceBalance;
  const advanceAfter = Math.max(0, Math.round((receivedAfter - position.totalInvoiced) * 100) / 100);
  const advanceAmount = Math.max(0, Math.round((balanceEffect - position.pending) * 100) / 100);
  const receipt = {
    id: `RCT-${Date.now()}`,
    transactionType,
    date,
    customerId: customer.id,
    partyName: String(customer.name || "").trim(),
    salesOrderId: linkedOrder?.id || "",
    coNumber: linkedOrder?.coNumber || "",
    coNumbers: partyOrders.map(order => String(order.coNumber || "").trim()).filter(Boolean),
    amount: Math.round(amount * 100) / 100,
    balanceEffect: Math.round(balanceEffect * 100) / 100,
    bankUnit,
    totalInvoiced: position.totalInvoiced,
    receivedBefore: position.receivedTillDate,
    receivedAfter,
    pendingBefore: position.pending,
    pendingAfter,
    advanceBefore,
    advanceAmount,
    advanceAfter,
    isAdvance: advanceAmount > 0,
    notes: [],
    salesPersonId: salesPersonRecord.id || "",
    salesPersonIds: [...new Set(partyOrders.map(order => String(order.salesPersonId || "")).filter(Boolean))],
    salesPerson,
    createdAt: new Date().toISOString(),
    createdBy: currentLoggedInUser?.username || "SYSTEM"
  };
  accountReceiptsDb.unshift(receipt);
  const saved = await saveStorage(KEY_ACCOUNT_RECEIPTS, accountReceiptsDb);
  if (saved === false) {
    accountReceiptsDb = accountReceiptsDb.filter(item => item.id !== receipt.id);
    return;
  }
  await logEvent("ACCOUNTS", "ACCOUNT_TRANSACTION_ADDED", `${receipt.transactionType} ₹${receipt.amount.toLocaleString("en-IN")} saved for ${receipt.partyName} through ${receipt.bankUnit}; remaining ₹${receipt.pendingAfter.toLocaleString("en-IN")}; advance ₹${receipt.advanceAfter.toLocaleString("en-IN")}.`);
  renderAccountReceiptTable();
  resetAccountReceiptForm();
  window.showNotification({ title: receipt.isAdvance ? "Advance Payment Saved" : "Transaction Saved", message: `${receipt.transactionType} ₹${receipt.amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} saved for ${receipt.partyName}${receipt.advanceAfter > 0 ? `; available advance ₹${receipt.advanceAfter.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""}.`, type: "success" });
};

function getFilteredAccountReceipts() {
  const allReceipts = Array.isArray(accountReceiptsDb) ? accountReceiptsDb : [];
  const query = String(document.getElementById("accountReceiptSearchInput")?.value || "").trim().toLocaleLowerCase();
  const field = String(document.getElementById("accountReceiptSearchField")?.value || "any");
  const searchableValues = receipt => {
    const transactionDate = String(receipt.date || "");
    const savedAt = String(receipt.createdAt || "");
    const total = Number(receipt.totalInvoiced || 0);
    const amount = Number(receipt.amount || 0);
    const remaining = Number(receipt.pendingAfter || 0);
    const advance = Number(receipt.advanceAfter || 0);
    return {
      transaction: String(receipt.transactionType || "RECEIPT"),
      date: `${transactionDate} ${reportHubDisplayDate(transactionDate)}`,
      party: String(receipt.partyName || ""),
      amount: `${total} ${total.toLocaleString("en-IN")} ${amount} ${amount.toLocaleString("en-IN")} ${remaining} ${remaining.toLocaleString("en-IN")} ${advance} ${advance.toLocaleString("en-IN")}`,
      bank: String(receipt.bankUnit || ""),
      salesPerson: String(receipt.salesPerson || ""),
      enteredBy: String(receipt.createdBy || ""),
      savedAt: `${savedAt} ${savedAt ? new Date(savedAt).toLocaleString() : ""}`
    };
  };
  const receipts = query ? allReceipts.filter(receipt => {
    const values = searchableValues(receipt);
    const haystack = field === "any" ? Object.values(values).join(" ") : (values[field] || "");
    return haystack.toLocaleLowerCase().includes(query);
  }) : allReceipts;
  return { allReceipts, receipts, query, field };
}

function getAccountTransactionExportRows() {
  return getFilteredAccountReceipts().receipts.map((receipt, index) => [
    index + 1,
    String(receipt.transactionType || "RECEIPT"),
    reportHubDisplayDate(receipt.date),
    String(receipt.partyName || "-"),
    Number(receipt.totalInvoiced || 0),
    Number(receipt.amount || 0),
    Number(receipt.advanceAfter || 0) > 0 ? `ADVANCE ₹${Number(receipt.advanceAfter).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : (receipt.pendingAfter === undefined ? "-" : Number(receipt.pendingAfter || 0)),
    String(receipt.bankUnit || "-"),
    String(receipt.salesPerson || "-"),
    String(receipt.createdBy || "-"),
    receipt.createdAt ? new Date(receipt.createdAt).toLocaleString() : "-"
  ]);
}

function renderAccountReceiptTable() {
  const body = document.getElementById("accountReceiptTableBody");
  if (!body) return;
  const { allReceipts, receipts, query } = getFilteredAccountReceipts();
  const count = document.getElementById("accountReceiptSearchCount");
  if (count) count.textContent = query ? `${receipts.length} of ${allReceipts.length} transactions found` : `${allReceipts.length} transaction${allReceipts.length === 1 ? "" : "s"}`;
  body.innerHTML = receipts.length ? receipts.map((receipt, index) => {
    const advanceAfter = Number(receipt.advanceAfter || 0);
    const pendingDelete = (requestsDb || []).some(request => request.type === "DELETE_ACCOUNT_RECEIPT" && request.status === "PENDING" && String(request.payload?.receiptId) === String(receipt.id));
    const pendingEdit = (requestsDb || []).some(request => request.type === "EDIT_ACCOUNT_RECEIPT" && request.status === "PENDING" && String(request.payload?.receiptId) === String(receipt.id));
    const notes = Array.isArray(receipt.notes) ? receipt.notes : (receipt.remarks ? [{ text: receipt.remarks }] : []);
    const lastNote = notes[notes.length - 1]?.text || "";
    const balanceLabel = advanceAfter > 0
      ? `<span style="color:#059669;">ADVANCE ₹${advanceAfter.toLocaleString("en-IN", { minimumFractionDigits:2, maximumFractionDigits:2 })}</span>`
      : `<span style="color:#b45309;">₹${Number(receipt.pendingAfter || 0).toLocaleString("en-IN", { minimumFractionDigits:2, maximumFractionDigits:2 })}</span>`;
    return `<tr><td>${index + 1}</td><td><strong>${escapeSalesHtml(receipt.transactionType || "RECEIPT")}</strong></td><td>${escapeSalesHtml(reportHubDisplayDate(receipt.date))}</td><td><strong>${escapeSalesHtml(receipt.partyName)}</strong></td><td style="font-weight:900; color:#0369a1;">₹${Number(receipt.totalInvoiced || 0).toLocaleString("en-IN", { minimumFractionDigits:2, maximumFractionDigits:2 })}</td><td style="font-weight:900; color:#059669;">₹${Number(receipt.amount || 0).toLocaleString("en-IN", { minimumFractionDigits:2, maximumFractionDigits:2 })}</td><td style="font-weight:900;">${balanceLabel}</td><td>${escapeSalesHtml(receipt.bankUnit || "-")}</td><td>${escapeSalesHtml(receipt.salesPerson || "-")}</td><td>${escapeSalesHtml(receipt.createdBy || "-")}</td><td>${escapeSalesHtml(receipt.createdAt ? new Date(receipt.createdAt).toLocaleString() : "-")}</td><td title="${escapeSalesHtml(lastNote)}" style="max-width:240px; white-space:normal;">${lastNote ? escapeSalesHtml(lastNote) : "-"}${notes.length > 1 ? `<small style="display:block;color:var(--muted);">+${notes.length - 1} more note(s)</small>` : ""}</td><td><select aria-label="Options for transaction ${escapeSalesHtml(receipt.id)}" data-receipt-id="${escapeSalesHtml(receipt.id)}" onchange="handleAccountReceiptAction(this)" style="min-width:128px;padding:7px 9px;"><option value="">${pendingDelete ? "Delete pending" : pendingEdit ? "Edit pending" : "Action"}</option><option value="edit" ${pendingEdit || pendingDelete ? "disabled" : ""}>${pendingEdit ? "Edit pending approval" : "Edit"}</option><option value="remarks" ${pendingDelete ? "disabled" : ""}>Remarks / Add note</option><option value="delete" ${pendingDelete || pendingEdit ? "disabled" : ""}>${pendingDelete ? "Delete pending approval" : pendingEdit ? "Edit pending approval" : "Delete (approval)"}</option></select></td></tr>`;
  }).join("") : `<tr><td colspan="13" style="text-align:center; padding:24px; color:var(--muted);">${query ? "No matching transactions found." : "No receipts saved."}</td></tr>`;
}

window.handleAccountReceiptAction = async function(select) {
  const receiptId = String(select?.dataset?.receiptId || "");
  const action = String(select?.value || "");
  if (select) select.value = "";
  const receipt = (accountReceiptsDb || []).find(item => String(item.id) === receiptId);
  if (!receipt || !action) return;
  if (action === "edit") return openAccountReceiptEdit(receipt);
  if (action === "remarks") {
    const note = await window.showPromptDialog({ title:"Add Receipt Note", message:`Add a note to ${receipt.transactionType || "receipt"} for ${receipt.partyName}.`, label:"Note *", placeholder:"Enter a note for this transaction...", confirmText:"Save Note" });
    if (note === null) return;
    if (!String(note).trim()) { window.showNotification({title:"Note Required",message:"Enter a note before saving.",type:"warning"}); return; }
    if (String(note).trim().length > 2000) { window.showNotification({title:"Note Too Long",message:"Keep each note within 2,000 characters.",type:"warning"}); return; }
    const oldNotes = Array.isArray(receipt.notes) ? receipt.notes : (receipt.remarks ? [{ text: receipt.remarks, createdAt: receipt.createdAt, createdBy: receipt.createdBy }] : []);
    receipt.notes = [...oldNotes, { text:String(note).trim(), createdAt:new Date().toISOString(), createdBy:currentLoggedInUser?.username || "SYSTEM" }];
    if (await saveStorage(KEY_ACCOUNT_RECEIPTS, accountReceiptsDb) === false) { receipt.notes = oldNotes; return; }
    await logEvent("ACCOUNTS", "ACCOUNT_TRANSACTION_NOTE_ADDED", `Added a note to ${receipt.transactionType || "receipt"} ${receipt.id} for ${receipt.partyName}.`);
    renderAccountReceiptTable();
    window.showNotification({title:"Note Saved",message:"The note was added to this transaction.",type:"success"});
    return;
  }
  if (action !== "delete") return;
  const existingRequest = (requestsDb || []).find(request => request.type === "DELETE_ACCOUNT_RECEIPT" && request.status === "PENDING" && String(request.payload?.receiptId) === receiptId);
  if (existingRequest) { window.showNotification({title:"Request Already Pending",message:"This transaction already has a deletion request awaiting Administrator approval.",type:"warning"}); return; }
  const reason = await window.showPromptDialog({ title:"Request Receipt Deletion", message:`${receipt.transactionType || "Transaction"} ${receipt.id} for ${receipt.partyName} will remain active until an Administrator approves the request.`, label:"Reason for deletion *", placeholder:"Enter why this transaction should be deleted...", confirmText:"Send for Approval", isDanger:true });
  if (reason === null) return;
  if (!String(reason).trim()) { window.showNotification({title:"Reason Required",message:"Enter a reason before sending the deletion request.",type:"warning"}); return; }
  const request = { id:`REQ-RCT-${Date.now()}`, type:"DELETE_ACCOUNT_RECEIPT", targetId:receipt.id, details:`${receipt.transactionType || "Receipt"} · ${receipt.partyName} · ₹${Number(receipt.amount || 0).toLocaleString("en-IN", {minimumFractionDigits:2,maximumFractionDigits:2})}`, requestedBy:currentLoggedInUser?.username || "UNKNOWN", requestedAt:new Date().toLocaleString(), reason:String(reason).trim(), status:"PENDING", payload:{receiptId:receipt.id, snapshot:{...receipt}} };
  requestsDb.unshift(request);
  if (await saveStorage(KEY_REQUESTS, requestsDb) === false) { requestsDb = requestsDb.filter(item => item.id !== request.id); return; }
  await logEvent("ACCOUNTS", "ACCOUNT_TRANSACTION_DELETE_REQUESTED", `Requested Administrator approval to delete ${receipt.transactionType || "receipt"} ${receipt.id} for ${receipt.partyName}.`);
  renderAccountReceiptTable();
  window.renderApproveRequestsTable?.();
  window.showNotification({title:"Deletion Request Submitted",message:"The transaction remains active until an Administrator approves the request.",type:"warning"});
};

function openAccountReceiptEdit(receipt) {
  let overlay = document.getElementById("accountReceiptEditOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "accountReceiptEditOverlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:10050;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(15,23,42,.58);";
    document.body.appendChild(overlay);
  }
  const customers = getReceiptParties();
  const people = (salesPeople || []).filter(person => String(person.status || "ACTIVE").toUpperCase() !== "INACTIVE");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(receipt.date || "")) ? receipt.date : receiptDateToIso(receipt.date || "");
  overlay.innerHTML = `<form onsubmit="saveAccountReceiptEdit(event,'${escapeSalesHtml(receipt.id)}')" style="width:min(620px,100%);max-height:90vh;overflow:auto;padding:22px;border-radius:16px;background:#fff;box-shadow:0 24px 70px rgba(0,0,0,.3);"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px;"><div><h2 style="margin:0;font-size:20px;">Edit Transaction</h2><small style="color:#64748b;">Changes take effect after Administrator approval.</small></div><button type="button" class="btn btn-secondary" onclick="document.getElementById('accountReceiptEditOverlay').style.display='none'">Close</button></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;"><div class="form-group"><label>TRANSACTION TYPE</label><select name="transactionType" required>${["RECEIPT","TDS","CREDIT NOTE","DEBIT NOTE","OTHER"].map(value=>`<option ${receipt.transactionType===value?"selected":""}>${value}</option>`).join("")}</select></div><div class="form-group"><label>DATE</label><input name="date" type="date" required value="${escapeSalesHtml(date)}"></div><div class="form-group"><label>PARTY</label><select name="customerId" required>${customers.map(customer=>`<option value="${escapeSalesHtml(customer.id)}" ${String(customer.id)===String(receipt.customerId)?"selected":""}>${escapeSalesHtml(customer.name)}</option>`).join("")}</select></div><div class="form-group"><label>AMOUNT (₹)</label><input name="amount" type="number" min="0.01" step="0.01" required value="${Number(receipt.amount || 0)}"></div><div class="form-group"><label>BANK / UNIT</label><input name="bankUnit" required value="${escapeSalesHtml(receipt.bankUnit || "")}"></div><div class="form-group"><label>SALES PERSON</label><select name="salesPersonId" required>${people.map(person=>`<option value="${escapeSalesHtml(person.id)}" ${String(person.id)===String(receipt.salesPersonId)?"selected":""}>${escapeSalesHtml(person.name)}</option>`).join("")}</select></div><div class="form-group" style="grid-column:1/-1;"><label>REASON FOR EDIT *</label><input name="editReason" required maxlength="500" placeholder="Why should these transaction details be corrected?"></div></div><div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px;"><button type="button" class="btn btn-secondary" onclick="document.getElementById('accountReceiptEditOverlay').style.display='none'">Cancel</button><button type="submit" class="btn btn-primary">Send for Approval</button></div></form>`;
  overlay.style.display = "flex";
}

window.saveAccountReceiptEdit = async function(event, receiptId) {
  event.preventDefault();
  const receipt = (accountReceiptsDb || []).find(item => String(item.id) === String(receiptId));
  const form = event.currentTarget;
  if (!receipt || !form) return;
  if ((requestsDb || []).some(request => ["EDIT_ACCOUNT_RECEIPT","DELETE_ACCOUNT_RECEIPT"].includes(request.type) && request.status === "PENDING" && String(request.payload?.receiptId) === String(receiptId))) { window.showNotification({title:"Request Already Pending",message:"This transaction already has an edit or deletion request awaiting Administrator approval.",type:"warning"}); return; }
  const data = new FormData(form);
  const customer = getReceiptPartyById(data.get("customerId"));
  const person = (salesPeople || []).find(item => String(item.id) === String(data.get("salesPersonId")));
  const amount = Number(data.get("amount"));
  const reason = String(data.get("editReason") || "").trim();
  if (!customer || !person || !Number.isFinite(amount) || amount <= 0 || !data.get("date") || !reason || !String(data.get("bankUnit") || "").trim()) { window.showNotification({title:"Invalid Transaction",message:"Complete the date, party, amount, bank / unit, salesperson and edit reason.",type:"warning"}); return; }
  const orders = getReceiptPartyOrders(customer);
  const linkedOrder = orders.find(order => receiptPartyKey(order.salesPerson || (salesPeople || []).find(item => String(item.id) === String(order.salesPersonId))?.name) === receiptPartyKey(person.name)) || orders[0] || null;
  const proposedReceipt = { ...receipt, transactionType:receiptPartyKey(data.get("transactionType")), date:String(data.get("date")), customerId:customer.id, partyName:customer.name, salesOrderId:linkedOrder?.id || "", coNumber:linkedOrder?.coNumber || "", amount:Math.round(amount*100)/100, balanceEffect:Math.round(getReceiptBalanceEffect(data.get("transactionType"),amount)*100)/100, bankUnit:receiptPartyKey(data.get("bankUnit")), salesPersonId:person.id, salesPerson:person.name };
  const request = { id:`REQ-RCT-EDIT-${Date.now()}`, type:"EDIT_ACCOUNT_RECEIPT", targetId:receipt.id, details:`${receipt.transactionType || "Receipt"} ${receipt.id} · ${receipt.partyName}`, requestedBy:currentLoggedInUser?.username || "UNKNOWN", requestedAt:new Date().toLocaleString(), reason, status:"PENDING", payload:{receiptId:receipt.id, baseline:{transactionType:receipt.transactionType,date:receipt.date,customerId:receipt.customerId,amount:receipt.amount,bankUnit:receipt.bankUnit,salesPersonId:receipt.salesPersonId},proposedReceipt} };
  requestsDb.unshift(request);
  if (await saveStorage(KEY_REQUESTS, requestsDb) === false) { requestsDb = requestsDb.filter(item => item.id !== request.id); return; }
  document.getElementById("accountReceiptEditOverlay").style.display = "none";
  renderAccountReceiptTable();
  window.renderApproveRequestsTable?.();
  window.showNotification({title:"Edit Request Submitted",message:"The saved transaction will change only after Administrator approval.",type:"success"});
};

window.applyApprovedAccountReceiptEdit = async function(request, adminName) {
  const payload = request?.payload || {};
  const receipt = (accountReceiptsDb || []).find(item => String(item.id) === String(payload.receiptId));
  const proposed = payload.proposedReceipt;
  if (!receipt || !proposed) return false;
  const baseline = payload.baseline || {};
  if (["transactionType","date","customerId","amount","bankUnit","salesPersonId"].some(key => String(receipt[key] ?? "") !== String(baseline[key] ?? ""))) return false;
  const customer = getReceiptPartyById(proposed.customerId);
  const person = (salesPeople || []).find(item => String(item.id) === String(proposed.salesPersonId) && String(item.status || "ACTIVE").toUpperCase() !== "INACTIVE");
  const amount = Number(proposed.amount);
  if (!customer || !person || !Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(String(proposed.date || "")) || !String(proposed.bankUnit || "").trim()) return false;
  const originalRows = (accountReceiptsDb || []).map(item => ({ ...item, notes:Array.isArray(item.notes) ? item.notes.map(note=>({...note})) : item.notes, editHistory:Array.isArray(item.editHistory) ? item.editHistory.map(entry=>({...entry})) : item.editHistory }));
  const oldPartyKey = receiptPartyKey(receipt.partyName);
  const previousValues = { transactionType:receipt.transactionType, date:receipt.date, customerId:receipt.customerId, partyName:receipt.partyName, amount:receipt.amount, bankUnit:receipt.bankUnit, salesPersonId:receipt.salesPersonId, salesPerson:receipt.salesPerson };
  const editorName = adminName || currentLoggedInUser?.username || "ADMIN";
  const editedAt = new Date().toISOString();
  Object.assign(receipt, { transactionType:receiptPartyKey(proposed.transactionType), date:String(proposed.date), customerId:customer.id, partyName:customer.name, salesOrderId:String(proposed.salesOrderId || ""), coNumber:String(proposed.coNumber || ""), amount:Math.round(amount*100)/100, balanceEffect:Math.round(getReceiptBalanceEffect(proposed.transactionType,amount)*100)/100, bankUnit:receiptPartyKey(proposed.bankUnit), salesPersonId:person.id, salesPerson:person.name, editedAt, editedBy:editorName, editHistory:[...(Array.isArray(receipt.editHistory)?receipt.editHistory:[]), { values:previousValues, editedAt, editedBy:editorName, requestId:request.id }] });
  const affectedParties = new Set([oldPartyKey, receiptPartyKey(receipt.partyName)]);
  affectedParties.forEach(partyKey => {
    const partyRows = (accountReceiptsDb || []).filter(item => receiptPartyKey(item.partyName) === partyKey).sort((a,b)=>String(a.date||"").localeCompare(String(b.date||"")) || String(a.createdAt||"").localeCompare(String(b.createdAt||"")));
    const totalInvoiced = (accountInvoices || []).filter(invoice=>receiptPartyKey(invoice.customerName)===partyKey).reduce((sum,invoice)=>sum+window.accountInvoiceRoundedTotal(invoice),0);
    let received=0;
    partyRows.forEach(item=>{const effect=Number(item.balanceEffect??item.amount??0);item.totalInvoiced=Math.round(totalInvoiced*100)/100;item.receivedBefore=Math.round(received*100)/100;item.pendingBefore=Math.max(0,Math.round((totalInvoiced-received)*100)/100);received=Math.round((received+effect)*100)/100;item.receivedAfter=received;item.pendingAfter=Math.max(0,Math.round((totalInvoiced-received)*100)/100);item.advanceBefore=Math.max(0,Math.round((item.receivedBefore-totalInvoiced)*100)/100);item.advanceAmount=Math.max(0,Math.round((effect-item.pendingBefore)*100)/100);item.advanceAfter=Math.max(0,Math.round((received-totalInvoiced)*100)/100);item.isAdvance=item.advanceAmount>0;});
  });
  if (await saveStorage(KEY_ACCOUNT_RECEIPTS, accountReceiptsDb) === false) { accountReceiptsDb = originalRows; return false; }
  return true;
};

window.exportAccountTransactionsExcel = async function() {
  const rows = getAccountTransactionExportRows();
  if (!rows.length) {
    window.showNotification({ title: "No Transaction Data", message: "No account transactions match the current search.", type: "warning" });
    return;
  }
  if (!window.ExcelJS) {
    window.showNotification({ title: "Excel Export Unavailable", message: "Refresh the page so the Excel library can load, then try again.", type: "error" });
    return;
  }
  try {
    const headers = ["#", "Transaction", "Date", "Party Name", "Total Party Amount (INR)", "Transaction Amount (INR)", "Outstanding / Advance (INR)", "Bank / Unit", "Sales Person", "Entered By", "Saved At"];
    const workbook = new window.ExcelJS.Workbook();
    workbook.creator = "DemoSolar Industries ERP";
    workbook.created = new Date();
    workbook.subject = "Saved Account Transactions";
    const sheet = workbook.addWorksheet("Account Transactions", { views: [{ state: "frozen", ySplit: 5, showGridLines: false }] });
    const lastColumn = sheet.getColumn(headers.length).letter;
    sheet.mergeCells(`A1:${lastColumn}1`);
    sheet.mergeCells(`A2:${lastColumn}2`);
    sheet.mergeCells(`A3:${lastColumn}3`);
    sheet.getCell("A1").value = "DEMOSOLAR INDUSTRIES PRIVATE LIMITED";
    sheet.getCell("A2").value = "SAVED ACCOUNT TRANSACTIONS";
    const { query, field } = getFilteredAccountReceipts();
    const fieldLabel = document.getElementById("accountReceiptSearchField")?.selectedOptions?.[0]?.textContent || "Any Detail";
    sheet.getCell("A3").value = `${query ? `Filter: ${fieldLabel} contains \"${query}\"` : "Filter: All Transactions"} | Records: ${rows.length.toLocaleString("en-IN")} | Generated: ${new Date().toLocaleString()}`;
    sheet.getCell("A1").font = { name: "Calibri", size: 12, bold: true, color: { argb: "FF64748B" } };
    sheet.getCell("A2").font = { name: "Calibri", size: 20, bold: true, color: { argb: "FF087FB9" } };
    sheet.getCell("A3").font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF0F766E" } };
    [1, 2, 3].forEach(rowNumber => {
      sheet.getRow(rowNumber).height = rowNumber === 2 ? 32 : 24;
      sheet.getCell(`A${rowNumber}`).alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    });
    const headerRow = sheet.getRow(5);
    headerRow.values = headers;
    headerRow.height = 32;
    headerRow.eachCell(cell => {
      cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F9F95" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = { top: { style: "thin", color: { argb: "FFCBD5E1" } }, left: { style: "thin", color: { argb: "FFCBD5E1" } }, bottom: { style: "thin", color: { argb: "FFCBD5E1" } }, right: { style: "thin", color: { argb: "FFCBD5E1" } } };
    });
    rows.forEach((values, index) => {
      const row = sheet.addRow(values);
      row.height = 24;
      row.eachCell((cell, columnNumber) => {
        cell.font = { name: "Calibri", size: 10, color: { argb: "FF0F172A" } };
        cell.alignment = { vertical: "middle", horizontal: [4, 8, 9].includes(columnNumber) ? "left" : "center", wrapText: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: index % 2 ? "FFF1F5F9" : "FFFFFFFF" } };
        cell.border = { top: { style: "thin", color: { argb: "FFE2E8F0" } }, left: { style: "thin", color: { argb: "FFE2E8F0" } }, bottom: { style: "thin", color: { argb: "FFE2E8F0" } }, right: { style: "thin", color: { argb: "FFE2E8F0" } } };
        if ([5, 6, 7].includes(columnNumber) && typeof cell.value === "number") cell.numFmt = '₹#,##0.00';
      });
    });
    [7, 16, 14, 30, 22, 24, 23, 18, 22, 18, 24].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    sheet.autoFilter = { from: "A5", to: `${lastColumn}${rows.length + 5}` };
    sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    sheet.headerFooter.oddFooter = "DemoSolar Industries ERP  |  Page &P of &N";
    const buffer = await workbook.xlsx.writeBuffer();
    downloadXlsxBuffer(buffer, `Account_Transactions_${Date.now()}.xlsx`);
    await logEvent("ACCOUNTS", "ACCOUNT_TRANSACTIONS_EXPORTED", `Exported ${rows.length} account transaction(s) to Excel${query ? ` using ${field} search` : ""}.`);
  } catch (error) {
    console.error("Account transactions Excel export failed:", error);
    window.showNotification({ title: "Excel Export Failed", message: error.message || "The workbook could not be generated.", type: "error" });
  }
};

window.exportAccountTransactionsPdf = async function() {
  const rows = getAccountTransactionExportRows();
  if (!rows.length) {
    window.showNotification({ title: "No Transaction Data", message: "No account transactions match the current search.", type: "warning" });
    return;
  }
  const JsPdf = window.jspdf?.jsPDF;
  if (!JsPdf) {
    window.showNotification({ title: "PDF Export Unavailable", message: "Refresh the page so the PDF library can load, then try again.", type: "error" });
    return;
  }
  try {
    const pdf = new JsPdf({ orientation: "landscape", unit: "mm", format: "a4" });
    const headers = ["#", "Transaction", "Date", "Party", "Total (INR)", "Amount (INR)", "Outstanding / Advance", "Bank / Unit", "Sales Person", "Entered By", "Saved At"];
    const widths = [7, 18, 17, 33, 23, 23, 24, 21, 24, 20, 27];
    const margin = 10;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const formatMoney = value => typeof value === "number" ? value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(value || "-");
    const pdfRows = rows.map(row => row.map((value, index) => [4, 5, 6].includes(index) ? formatMoney(value) : String(value ?? "-")));
    let pageNumber = 1;
    let y = 0;
    const drawPageHeader = () => {
      pdf.setFillColor(8, 127, 185);
      pdf.rect(0, 0, pageWidth * 0.55, 4, "F");
      pdf.setFillColor(31, 190, 104);
      pdf.rect(pageWidth * 0.55, 0, pageWidth * 0.45, 4, "F");
      pdf.setTextColor(15, 23, 42);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(15);
      pdf.text("SAVED ACCOUNT TRANSACTIONS", margin, 14);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      pdf.setTextColor(71, 85, 105);
      const { query } = getFilteredAccountReceipts();
      const fieldLabel = document.getElementById("accountReceiptSearchField")?.selectedOptions?.[0]?.textContent || "Any Detail";
      pdf.text(`${query ? `${fieldLabel}: ${query}` : "All Transactions"}  |  ${rows.length} record(s)  |  Generated ${new Date().toLocaleString()}`, margin, 20);
      pdf.text(`Page ${pageNumber}`, pageWidth - margin, 20, { align: "right" });
      y = 25;
      let x = margin;
      pdf.setFillColor(15, 159, 149);
      pdf.setTextColor(255, 255, 255);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(6.5);
      headers.forEach((header, index) => {
        pdf.rect(x, y, widths[index], 10, "F");
        const lines = pdf.splitTextToSize(header, widths[index] - 2);
        pdf.text(lines, x + widths[index] / 2, y + 4.2, { align: "center" });
        x += widths[index];
      });
      y += 10;
    };
    drawPageHeader();
    pdfRows.forEach((row, rowIndex) => {
      const wrapped = row.map((value, index) => pdf.splitTextToSize(value, widths[index] - 2));
      const rowHeight = Math.max(8, Math.max(...wrapped.map(lines => lines.length)) * 3.2 + 2.5);
      if (y + rowHeight > pageHeight - 10) {
        pdf.addPage();
        pageNumber += 1;
        drawPageHeader();
      }
      let x = margin;
      pdf.setFillColor(rowIndex % 2 ? 241 : 255, rowIndex % 2 ? 245 : 255, rowIndex % 2 ? 249 : 255);
      pdf.setDrawColor(203, 213, 225);
      pdf.setLineWidth(0.15);
      pdf.setTextColor(15, 23, 42);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(6.3);
      wrapped.forEach((lines, index) => {
        pdf.rect(x, y, widths[index], rowHeight, "FD");
        const align = [0, 1, 2, 4, 5, 6, 9, 10].includes(index) ? "center" : "left";
        pdf.text(lines, align === "center" ? x + widths[index] / 2 : x + 1, y + 4, { align });
        x += widths[index];
      });
      y += rowHeight;
    });
    pdf.save(`Account_Transactions_${Date.now()}.pdf`);
    const { query, field } = getFilteredAccountReceipts();
    await logEvent("ACCOUNTS", "ACCOUNT_TRANSACTIONS_EXPORTED", `Exported ${rows.length} account transaction(s) to PDF${query ? ` using ${field} search` : ""}.`);
  } catch (error) {
    console.error("Account transactions PDF export failed:", error);
    window.showNotification({ title: "PDF Export Failed", message: error.message || "The PDF could not be generated.", type: "error" });
  }
};

