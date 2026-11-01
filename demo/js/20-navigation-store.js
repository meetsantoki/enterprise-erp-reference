function canCreateProductionOrder() {
  return currentLoggedInUser?.rights?.storeCreatePo === true;
}

const VIEW_RIGHT_ALIASES = Object.freeze({
  dashboardAdmin: "dashboard",
  dashboardPacking: "dashboard",
  dashboardDispatch: "dashboard",
  accounts: "accountsInvoiceLogistics",
  purchaseOrderView: "purchaseOrderView",
  reportsHub: "reports",
  reportsPacking: "reports",
  reportsDispatch: "reports",
  reportsCustom: "reports",
  reportsDailyDept: "reports"
});

function requiredRightForView(viewId) {
  if (VIEW_RIGHT_ALIASES[viewId]) return VIEW_RIGHT_ALIASES[viewId];
  for (const menu of APP_MENUS) {
    if (menu.id === viewId) return menu.id;
    if (menu.submenus.some(submenu => submenu.id === viewId)) return viewId;
  }
  return null;
}

window.userCanOpenView = function(viewId, user = currentLoggedInUser) {
  if (!user) return false;
  if (String(user.role || "").trim().toLowerCase() === "admin") return true;
  if (viewId === "requestsApprove" && user.rights?.requestRouteAssignee === true) return true;
  // Utilities are safe, browser-only tools. Existing users receive access by
  // default; IT can explicitly disable the parent or either child permission.
  if (["utilitiesPdfStudio","utilitiesImageOptimizer","utilitiesCodeMaker","utilitiesSavedDocuments"].includes(viewId)) {
    return user.rights?.utilities !== false && user.rights?.[viewId] !== false;
  }
  if (viewId === "adminNfcCards") return user.rights?.nfcCards === true;
  const requiredRight = requiredRightForView(viewId);
  return !requiredRight || user.rights?.[requiredRight] === true;
};

window.switchView = async function(viewId, btnEl, titleText) {
  if (!window.userCanOpenView(viewId, currentLoggedInUser)) {
    window.showNotification({ title: "Access Denied", message: "Your User Rights do not allow this page.", type: "danger" });
    return false;
  }
  if (viewId === "purchaseVendorApprovals" && window.canReviewVendorApplications?.(currentLoggedInUser) !== true) {
    window.showNotification({ title: "Access Denied", message: "Your User Rights do not allow Vendor Approvals.", type: "danger" });
    return false;
  }
  if (viewId === "purchaseOrderApprovals" && window.canApprovePurchaseOrders?.(currentLoggedInUser) !== true) {
    window.showNotification({ title: "Access Denied", message: "Only an Administrator with Approve PO access can review Purchase Orders.", type: "danger" });
    return false;
  }
  if (viewId === "logs" && currentLoggedInUser?.rights?.logs !== true && String(currentLoggedInUser?.role || "").toLowerCase() !== "admin") {
    window.showNotification({ title: "Access Denied", message: "Your User Rights do not allow Logs.", type: "danger" });
    return false;
  }
  if (viewId === "cctvLive" && currentLoggedInUser?.rights?.cctvLive !== true) {
    window.showNotification({ title: "Access Denied", message: "Your User Rights do not allow Live Cameras.", type: "danger" });
    return false;
  }
  if (viewId === "cctvPlayback" && currentLoggedInUser?.rights?.cctvPlayback !== true) {
    window.showNotification({ title: "Access Denied", message: "Your User Rights do not allow Recording Playback.", type: "danger" });
    return false;
  }
  if (viewId === "storeCreatePo" && !canCreateProductionOrder()) {
  window.showNotification({
    title: "Access Denied",
    message: "Your User Rights do not allow Create PO.",
    type: "danger"
  });
  return;
}
  const navigationSequence = ++viewNavigationSequence;
  currentActiveViewId = viewId;
  const useFastDashboard = window.shouldUseFastDashboard?.(viewId) === true;
  try {
    // Dashboards use native HTML/SVG only. Do not put optional export libraries
    // or the full ERP module bundle in the login-to-dashboard critical path.
    if (!useFastDashboard) await window.ensureErpLibrariesForView?.(viewId);
    if (!useFastDashboard) await ensureViewModules(viewId);
  } catch (error) {
    window.showNotification({ title: "Page Data Unavailable", message: error?.message || "This page could not load its authorised data.", type: "danger" });
    return;
  }
  if (navigationSequence !== viewNavigationSequence) return;

  // Normalize missing POs when switching tabs
  godownStock.forEach(p => {
    if (!p.po || p.po === "-" || p.po.trim() === "") {
      if (p.fullRows && p.fullRows.length > 0 && p.fullRows[0].po) {
        p.po = p.fullRows[0].po;
      } else if (p.pallet && p.pallet.startsWith("A") && p.pallet.includes("-")) {
        p.po = p.pallet.split("-")[0].substring(1);
      }
    }
  });

  document.querySelectorAll(".view-panel").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".sub-item").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".menu-btn").forEach(m => m.classList.remove("active"));

  const reportPanelView = ["accountsLedger", "accountsOutstandingReceivable", "accountsAdvanceFromCustomer"].includes(viewId) ? "accountsReports" : viewId;
  const target = document.getElementById(`view-${reportPanelView}`);
  if (target) target.classList.add("active");
  if (btnEl) btnEl.classList.add("active");
  if (titleText) document.getElementById("screenTitleDisplay").textContent = titleText;

  const scroller = document.getElementById("mainScrollContainer");
  if (scroller) scroller.scrollTop = 0;
  window.scrollTo(0, 0);

  if (viewId === "dashboardAdmin" || viewId === "dashboardPacking" || viewId === "dashboardDispatch") {
    if (useFastDashboard) {
      try {
        await window.renderFastDashboard?.(viewId);
      } catch (error) {
        console.warn("Fast dashboard summary was unavailable; full data will replace it shortly.", error);
        window.refreshDashboardFromFullData?.(viewId);
      }
    } else {
      window.refreshDashboardFromFullData?.(viewId);
    }
  }
  else if (viewId === "warehouse") renderWarehouseTable();
  else if (viewId === "accountsDashboard") window.renderAccountsDashboard?.();
  else if (viewId === "accounts") { await window.restoreJbInfraHistoricalInvoices?.(); resetAccountInvoiceForm(); renderAccountInvoiceTable(); }
  else if (viewId === "accountsEditInvoice") { editingAccountInvoiceId = ""; populateEditInvoiceSelect(); }
  else if (viewId === "accountsDeleteInvoice") populateDeleteInvoiceSelect();
  else if (viewId === "accountsReceipt") { resetAccountReceiptForm(); populateReceiptPartyDropdown(); renderAccountReceiptTable(); }
  else if (viewId === "accountsReports" || viewId === "accountsOutstandingReceivable" || viewId === "accountsAdvanceFromCustomer") {
    document.getElementById("accountsReportWorkspace")?.style.setProperty("display", "block");
    document.getElementById("accountsLedgerComingSoon")?.style.setProperty("display", "none");
    const reportType = document.getElementById("accountsReportType");
    if (reportType) reportType.value = viewId === "accountsAdvanceFromCustomer" ? "ADVANCE" : "OUTSTANDING";
    window.renderAccountsReports?.();
  } else if (viewId === "accountsLedger") {
    document.getElementById("accountsReportWorkspace")?.style.setProperty("display", "none");
    document.getElementById("accountsLedgerComingSoon")?.style.setProperty("display", "block");
  }
  else if (viewId === "utilitiesPdfStudio") window.pdfStudioActivate?.();
  else if (viewId === "utilitiesImageOptimizer") window.utilitiesImageOptimizerActivate?.();
  else if (viewId === "utilitiesCodeMaker") window.utilitiesCodeMakerActivate?.();
  else if (viewId === "utilitiesSavedDocuments") window.utilitiesSavedDocumentsActivate?.();
  else if (viewId === "salesOrderDashboard") renderSalesOrderDashboard();
  else if (viewId === "salesOrderAdd") resetSalesOrderForm();
  else if (viewId === "salesOrderView") renderSalesOrdersTable();
  else if (viewId === "salesOrderAllocation") { window.populateCoAllocationCoSelect?.(); window.populateCo360Search?.(); window.renderCoAllocationTable?.(); window.renderCo360?.(); }
  else if (viewId === "salesOrderSerialTracking") window.prepareSalesSerialTracking?.();
  else if (viewId === "productionDashboard") window.renderProductionDashboard?.();
  else if (viewId === "productionAddDetails") { productionFormMode = "add"; window.resetProductionDetailForm?.(); }
  else if (viewId === "productionEditSheet") window.populateProductionEditSheetSelect?.();
  else if (viewId === "productionDeleteSheet") window.populateProductionDeleteSheetSelect?.();
  else if (viewId === "productionViewSheet") window.renderProductionSheet?.();
  else if (viewId === "productionDailyUpdate") window.resetProductionDailyForm?.();
  else if (viewId === "salesOrderEdit") populateSalesOrderEditSelect();
  else if (viewId === "salesOrderDelete") populateSalesOrderDeleteSelect();
  else if (viewId === "salesPersonMaster") { renderSalesPeopleTable(); populateSalesPersonDropdowns(); }
  else if (viewId === "customerMaster") { resetCustomerMasterForm(); renderCustomerMasterTable(); }
  else if (viewId === "purchaseVendorApprovals") { closeVendorApplicationReview(); loadVendorApplications(true).catch(()=>{}); }
  else if (viewId === "purchaseVendorRegistration") resetPurchaseVendorForm();
  else if (viewId === "purchaseVendorMaster") renderPurchaseVendorMaster();
  else if (viewId === "purchaseOrder") window.preparePurchaseOrderPage?.();
  else if (viewId === "purchaseOrderView") window.preparePurchaseOrderViewPage?.();
  else if (viewId === "purchaseOrderEdit") window.preparePurchaseOrderEditPage?.();
  else if (viewId === "purchaseOrderApprovals") window.preparePurchaseOrderApprovals?.();
  else if (viewId === "purchaseOrderDelete") window.preparePurchaseOrderDeletePage?.();
  else if (viewId === "storeCreatePo") {
    document.getElementById("createPoNumber").value = "";
    document.getElementById("createPoQty").value = "";
    document.getElementById("createPoPrintFormat").value = "DEMOSOLAR";
    document.getElementById("createPoDemoOemOrderNumber").value = "";
    toggleDemoOemOrderNumberFields();
    populateProductDropdowns();
  } else if (viewId === "storeEditPo") populateEditPoDropdown();
  else if (viewId === "storeUploadSerial") renderStoreSerialTable();
  else if (viewId === "storeEditSerial") { populateStoreSerialPoFilters(); resetEditSerialStation(); }
  else if (viewId === "storeDeleteSerial") { populateStoreSerialPoFilters(); resetDeleteSerialStation(); }
  else if (viewId === "packingScan") resetScanPalletizeStation();
  else if (viewId === "dispatchChallan") resetDispatchFormState();
  else if (viewId === "dispatchBookedStock") window.renderBookedStockView();
  else if (viewId === "packingRework") populateReworkPalletDropdown();
  else if (viewId === "packingEditPallet") window.populateEditPalletDropdown();
  else if (viewId === "packingDeletePallet") window.populateDeletePalletDropdown();
  else if (viewId === "dispatchViewList") resetViewPackingListState();
  else if (viewId === "dispatchRouteFare") resetRouteFareView();
  else if (viewId === "dispatchBookVehicle") resetVehicleBookingView();
  else if (viewId === "dispatchDelete") window.resetDispatchDeleteView();
  else if (viewId === "requestsTrack") window.renderTrackRequestsTable();
  else if (viewId === "requestsApprove") window.renderApproveRequestsTable();
  else if (viewId === "requestRoutes") {
    window.prepareRequestRoutesView?.();
  }
  else if (viewId === "transporterView") renderTransporterTable();
  else if (viewId === "transporterAdd") {
    document.getElementById("trAddName").value = "";
    document.getElementById("trAddPerson").value = "";
    document.getElementById("trAddPhone").value = "";
    document.getElementById("trAddEmail").value = "";
    document.getElementById("trAddGst").value = "";
    document.getElementById("trAddPan").value = "";
    document.getElementById("trAddAddress").value = "";
  } else if (viewId === "transporterEdit") populateTransporterEditDropdown();
  else if (viewId === "transporterDelete") populateTransporterDeleteDropdown();
  else if (viewId === "driverView") renderDriverTable();
  else if (viewId === "driverAdd") {
    document.getElementById("drAddName").value = "";
    document.getElementById("drAddPhone").value = "";
    document.getElementById("drAddVehicle").value = "";
    populateDriverTransporterDropdowns();
  } else if (viewId === "driverEdit") populateDriverEditDropdown();
  else if (viewId === "driverDelete") populateDriverDeleteDropdown();
  else if (viewId === "departmentView") renderDepartmentsTable();
  else if (viewId === "departmentAdd") { document.getElementById("departmentAddName").value = ""; }
  else if (viewId === "departmentEdit") populateDepartmentEditDropdown();
  else if (viewId === "departmentDelete") populateDepartmentDeleteDropdown();
  else if (viewId === "designationView") window.renderDesignationsTable?.();
  else if (viewId === "designationAdd") window.prepareDesignationAddView?.();
  else if (viewId === "designationEdit") window.populateDesignationEditDropdown?.();
  else if (viewId === "designationDelete") window.populateDesignationDeleteDropdown?.();
  else if (viewId === "productsView") renderProductsViewTable();
  else if (viewId === "productsAdd") {
    document.getElementById("pAddName").value = "";
    document.getElementById("pAddWatt").value = "";
    document.getElementById("pAddCellType").value = "NON - DCR";
  } else if (viewId === "adminAddUser") {
    document.getElementById("newEmpName").value = "";
    document.getElementById("newEmpUser").value = "";
    document.getElementById("newEmpPass").value = "";
    const newEmpLevel = document.getElementById("newEmpLevel");
    if (newEmpLevel) { newEmpLevel.value = ""; newEmpLevel.dataset.levelSource = ""; }
    populateNewUserDepartmentDropdown();
  } else if (viewId === "adminUsers") renderUsersTable();
  else if (viewId === "adminEditUser") populateEditUserDropdown();
  else if (viewId === "adminDeleteUser") populateDeleteUserDropdown();
  else if (viewId === "productsEdit" || viewId === "productsDelete") renderProductTables();
  else if (viewId === "reportsHub") window.renderReportsHub();
  else if (viewId === "reportsPacking") openPackingReportsView(btnEl);
  else if (viewId === "reportsDispatch") openDispatchReportsView(btnEl);
  else if (viewId === "reportsCustom") openCustomReportsView(btnEl);
  else if (viewId === "reportsDailyDept") openDailyDepartmentReportView(btnEl);
  else if (viewId === "storeDeletePo") {
    populateDeletePoDropdown();
  } else if (viewId === "packingClosePo") {
    populateClosePoDropdown();
  }
  else if (viewId === "logs") renderAllLogsTables();

  recordAutomaticAudit(
    auditDepartmentFromView(viewId),
    "PAGE_OPENED",
    `Opened page: ${String(titleText || viewId || "Unknown page").trim()} (view ${String(viewId || "unknown")}).`
  );
  return true;
};

window.toggleDemoOemOrderNumberFields = function(mode = "create") {
  const isEdit = mode === "edit";
  const formatSelect = document.getElementById(isEdit ? "editPoPrintFormat" : "createPoPrintFormat");
  const group = document.getElementById(isEdit ? "editPoDemoOemOrderNumberGroup" : "createPoDemoOemOrderNumberGroup");
  const input = document.getElementById(isEdit ? "editPoDemoOemOrderNumber" : "createPoDemoOemOrderNumber");
  if (!formatSelect || !group || !input) return;

  const isDemoOem = formatSelect.value === "DEMOOEM";
  group.style.display = isDemoOem ? "block" : "none";
  input.required = isDemoOem;

  if (!isDemoOem) {
    input.readOnly = false;
    if (!isEdit) input.value = "";
    return;
  }

  const selectedPo = isEdit ? getPoRecord(document.getElementById("editPoSelect")?.value) : null;
  const savedOrderNumber = String(selectedPo?.kosolOrderNumber || "").trim();
  input.readOnly = Boolean(savedOrderNumber);
  if (savedOrderNumber) input.value = savedOrderNumber;
};

function getPoRecord(poNumber) {
  const poKey = String(poNumber || "").trim().toUpperCase();
  return (poDatabase || []).find(item => String(item.poNumber || "").trim().toUpperCase() === poKey) || null;
}

function getDemoOemOrderNumber(poNumber) {
  const po = getPoRecord(poNumber);
  return String(po?.kosolOrderNumber || po?.kosolOrderNo || po?.orderNumber || "").trim();
}

function requireDemoOemOrderNumber(poNumber, actionLabel) {
  if (getPoPrintFormat(poNumber) !== "DEMOOEM") return true;
  if (getDemoOemOrderNumber(poNumber)) return true;
  window.showNotification({
    title: "DemoOem Order Number Missing",
    message: `PPC must add the DemoOem order number in Edit PO #${poNumber} before ${actionLabel}.`,
    type: "danger"
  });
  return false;
}

function formatDemoOemGrade(grade) {
  const cleanGrade = String(grade || "A GRADE").trim().toUpperCase();
  const match = cleanGrade.match(/^([ABR])\s*-?\s*GRADE$/);
  return match ? `${match[1]} - GRADE` : cleanGrade;
}

function getWattNumber(value) {
  const match = String(value || "").match(/(\d{3,4})/);
  return match ? Number(match[1]) : 0;
}

function getPoPackingModel(po) {
  if (!po) return "";
  const savedModel = String(po.product || "").trim();
  if (getWattNumber(po.watt) !== 570) return savedModel;

  const isDemoOem = String(po.printFormat || "").trim().toUpperCase() === "DEMOOEM";
  const matching570Models = (productsDb || []).filter(product => getWattNumber(product.watt) === 570);
  const selectedModel = matching570Models.find(product => {
    const name = String(product.name || "").trim();
    const isDemoOemModel = /^(KE\b|KE\d|DEMOOEM\b)/i.test(name);
    return isDemoOem ? isDemoOemModel : !isDemoOemModel;
  });

  return String(selectedModel?.name || savedModel).trim();
}

function poProductCatalogKey(product, index = 0) {
  const id = String(product?.id ?? "").trim();
  if (id) return `PRODUCT-ID:${id}`;
  return `PRODUCT:${encodeURIComponent(String(product?.name || "").trim())}:${encodeURIComponent(String(product?.cellType || "NON - DCR").trim())}:${index}`;
}

function poProductOptionsHtml() {
  return (productsDb || []).map((product, index) => `<option value="${escapeSalesHtml(poProductCatalogKey(product, index))}" data-product-index="${index}">${escapeSalesHtml(product.name)} (${escapeSalesHtml(product.cellType || "NON - DCR")})</option>`).join("");
}

function getSelectedPoCatalogProduct(selectId) {
  const select = document.getElementById(selectId);
  const selectedOption = select?.options?.[select.selectedIndex];
  const index = Number(selectedOption?.dataset?.productIndex);
  if (Number.isInteger(index) && index >= 0 && productsDb[index]) return productsDb[index];
  return (productsDb || []).find((product, productIndex) => poProductCatalogKey(product, productIndex) === select?.value) || null;
}

function findPoCatalogProduct(po) {
  const savedId = String(po?.productId ?? "").trim();
  if (savedId) {
    const byId = (productsDb || []).find(product => String(product?.id ?? "").trim() === savedId);
    if (byId) return byId;
  }
  const savedName = String(po?.product || "").trim().toUpperCase();
  const savedCellType = String(po?.cellType || po?.dcrNdcr || "").trim().toUpperCase();
  const exact = (productsDb || []).find(product => String(product?.name || "").trim().toUpperCase() === savedName
    && (!savedCellType || String(product?.cellType || "NON - DCR").trim().toUpperCase() === savedCellType));
  if (exact) return exact;
  return (productsDb || []).find(product => String(product?.name || "").trim().toUpperCase() === savedName) || null;
}

window.saveNewProductionOrder = async function() {
  if (!canCreateProductionOrder()) {
  window.showNotification({
    title: "Access Denied",
    message: "Your User Rights do not allow Create PO.",
    type: "danger"
  });
  return;
}
  const po = document.getElementById("createPoNumber").value.trim().toUpperCase();
  const watt = document.getElementById("createPoWatt").value;
  const selectedProduct = getSelectedPoCatalogProduct("createPoProduct");
  const prod = String(selectedProduct?.name || "").trim();
  const qty = parseInt(document.getElementById("createPoQty").value, 10);
  const printFormat = document.getElementById("createPoPrintFormat").value === "DEMOOEM" ? "DEMOOEM" : "DEMOSOLAR";
  const kosolOrderNumber = printFormat === "DEMOOEM"
    ? document.getElementById("createPoDemoOemOrderNumber").value.trim().toUpperCase()
    : "";

  if (!po || !prod || isNaN(qty) || qty <= 0) {
    window.showNotification({ title: "Validation Error", message: "Please fill all PO fields with valid values.", type: "danger" });
    return;
  }

  if (printFormat === "DEMOOEM" && !kosolOrderNumber) {
    window.showNotification({ title: "DemoOem Order Number Required", message: "Enter the DemoOem order number before creating this DemoOem PO.", type: "danger" });
    return;
  }

  if (poDatabase.some(p => p.poNumber.toUpperCase() === po)) {
    window.showNotification({ title: "Duplicate PO", message: `PO Number "${po}" already exists in the system.`, type: "danger" });
    return;
  }

  poDatabase.push({ poNumber: po, watt: watt, product: prod, productId: selectedProduct?.id ?? "", cellType: selectedProduct?.cellType || "NON - DCR", qty: qty, printFormat, kosolOrderNumber, status: "OPEN" });
  await saveStorage(KEY_POS, poDatabase);
  // Creating a PPC PO immediately creates its linked Production Sheet row.
  await createProductionSheetForPpcPo(po);

  logEvent("STORE", "PO_CREATED", `Created PO #${po} (${qty} units of ${prod}, ${watt}; ${printFormat} print format${kosolOrderNumber ? `; DemoOem order ${kosolOrderNumber}` : ""})`);
  window.showNotification({ title: "PO Created", message: `PO #${po} saved with ${printFormat === "DEMOOEM" ? "DemoOem" : "DemoSolar"} sticker format.`, type: "success" });

  populatePoDropdowns();
  populateEditPoDropdown();
  populateStoreSerialPoFilters();
  switchView("storeCreatePo", null, "Store & PPC > Create PO");
};

function populateEditPoDropdown() {
  const sel = document.getElementById("editPoSelect");
  const prodSel = document.getElementById("editPoProductSelect");
  if (!sel) return;

  if (productsDb.length > 0 && prodSel) {
    prodSel.innerHTML = poProductOptionsHtml();
  }

  if (poDatabase.length === 0) {
    sel.innerHTML = `<option value="">-- No POs Available to Edit --</option>`;
    onSelectPoToEdit();
    return;
  }

  sel.innerHTML = `<option value="">-- Select PO to Modify --</option>` + poDatabase.map(p => `
    <option value="${p.poNumber}">${p.poNumber} (${p.product} - ${p.qty} units)</option>
  `).join("");
  onSelectPoToEdit();
}

window.onSelectPoToEdit = function() {
  const poNum = document.getElementById("editPoSelect").value;
  const po = poDatabase.find(p => p.poNumber === poNum);
  if (!po) {
    document.getElementById("editPoNumberInput").value = "";
    document.getElementById("editPoQtyInput").value = "";
    document.getElementById("editPoDemoOemOrderNumber").value = "";
    toggleDemoOemOrderNumberFields("edit");
    return;
  }
  document.getElementById("editPoNumberInput").value = po.poNumber;
  document.getElementById("editPoWattSelect").value = po.watt;
  const productSelect = document.getElementById("editPoProductSelect");
  const selectedProduct = findPoCatalogProduct(po);
  if (productSelect && selectedProduct) {
    const productIndex = productsDb.indexOf(selectedProduct);
    productSelect.value = poProductCatalogKey(selectedProduct, productIndex);
  }
  document.getElementById("editPoQtyInput").value = po.qty;
  document.getElementById("editPoPrintFormat").value = po.printFormat === "DEMOOEM" ? "DEMOOEM" : "DEMOSOLAR";
  document.getElementById("editPoDemoOemOrderNumber").value = po.kosolOrderNumber || "";
  toggleDemoOemOrderNumberFields("edit");
};

window.saveEditedPo = async function() {
  const origPoNum = document.getElementById("editPoSelect").value;
  const po = poDatabase.find(p => p.poNumber === origPoNum);
  if (!po) { 
    window.showNotification({ title: "Selection Error", message: "Please select a valid PO to edit.", type: "warning" }); 
    return; 
  }

  const newPoNum = document.getElementById("editPoNumberInput").value.trim().toUpperCase();
  const newWatt = document.getElementById("editPoWattSelect").value;
  const selectedProduct = getSelectedPoCatalogProduct("editPoProductSelect");
  const newProd = String(selectedProduct?.name || "").trim();
  const newQty = parseInt(document.getElementById("editPoQtyInput").value, 10);
  const newPrintFormat = document.getElementById("editPoPrintFormat").value === "DEMOOEM" ? "DEMOOEM" : "DEMOSOLAR";
  const newDemoOemOrderNumber = newPrintFormat === "DEMOOEM"
    ? document.getElementById("editPoDemoOemOrderNumber").value.trim().toUpperCase()
    : "";

  if (!newPoNum || !newProd || isNaN(newQty) || newQty <= 0) {
    window.showNotification({ title: "Validation Error", message: "All fields are required and quantity must be positive.", type: "danger" });
    return;
  }

  if (newPrintFormat === "DEMOOEM" && !newDemoOemOrderNumber) {
    window.showNotification({ title: "DemoOem Order Number Required", message: "Enter the DemoOem order number before saving this DemoOem PO.", type: "danger" });
    return;
  }

  if (newPoNum !== po.poNumber && poDatabase.some(p => p.poNumber === newPoNum)) {
    window.showNotification({ title: "Duplicate PO", message: `PO Number "${newPoNum}" already exists.`, type: "danger" });
    return;
  }

  const oldName = po.poNumber;
  po.poNumber = newPoNum;
  po.watt = newWatt;
  po.product = newProd;
  po.productId = selectedProduct?.id ?? "";
  po.cellType = selectedProduct?.cellType || "NON - DCR";
  po.qty = newQty;
  po.printFormat = newPrintFormat;
  po.kosolOrderNumber = newDemoOemOrderNumber;

  if (oldName !== newPoNum) {
    storeSerialsDb.forEach(b => { if (b.poNumber === oldName) b.poNumber = newPoNum; });
    await saveStorage(KEY_STORE_SERIALS, storeSerialsDb);
  }

  await saveStorage(KEY_POS, poDatabase);
  logEvent("STORE", "PO_EDITED", `Modified PO #${oldName} -> #${newPoNum} (${newQty} units of ${newProd}; ${po.cellType})`);
  window.renderWarehouseTable?.();
  window.showNotification({ title: "PO Updated", message: `PO #${newPoNum} updated successfully. Warehouse DCR and NON-DCR stock totals were recalculated.`, type: "success" });

  populatePoDropdowns();
  populateEditPoDropdown();
  populateStoreSerialPoFilters();
};

window.handleStoreExcelUpload = function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, {type: 'array'});
      const firstSheet = workbook.SheetNames[0];
      const json = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], {header: 1});
      parsedStoreExcelSerials = json.flat().filter(cell => cell !== null && cell !== undefined && String(cell).trim() !== "");
      window.showNotification({ title: "File Parsed", message: `Extracted ${parsedStoreExcelSerials.length} serial entries from file.`, type: "info" });
    } catch(err) {
      window.showNotification({ title: "Upload Error", message: "Error parsing Excel file.", type: "danger" });
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
};

function getAllRegisteredSerials() {
  const set = new Set();
  storeSerialsDb.forEach(batch => { batch.serials.forEach(s => set.add(s.toUpperCase())); });
  return set;
}

window.processStoreSerialUpload = async function() {
  const po = document.getElementById("storePoInput").value.trim().toUpperCase();
  const manualText = document.getElementById("storeManualSerials").value.trim();
  if (!po) { 
    window.showNotification({ title: "Missing Information", message: "Please enter a valid PO Number.", type: "warning" }); 
    return; 
  }

  let manualSerials = [];
  if (manualText) {
    manualSerials = manualText.split(/[\n,\s]+/).map(s => s.trim().toUpperCase()).filter(s => s.length > 0);
  }

  const inputList = [...parsedStoreExcelSerials.map(s => String(s).trim().toUpperCase()), ...manualSerials];
  const uniqueInputs = [...new Set(inputList)].filter(s => s.length > 0);
  if (uniqueInputs.length === 0) { 
    window.showNotification({ title: "Input Required", message: "Please upload an Excel file or paste serial numbers.", type: "warning" }); 
    return; 
  }

  const existingDbSerials = getAllRegisteredSerials();
  const duplicates = [];
  const validNewSerials = [];

  uniqueInputs.forEach(s => {
    if (existingDbSerials.has(s)) duplicates.push(s);
    else validNewSerials.push(s);
  });

  if (duplicates.length > 0) {
    window.showNotification({ title: "Duplicates Blocked", message: `${duplicates.length} serial number(s) already exist in Store database.`, type: "danger" });
    return;
  }

  const record = { id: Date.now(), timestamp: new Date().toLocaleString(), poNumber: po, serials: validNewSerials, count: validNewSerials.length };
  storeSerialsDb.unshift(record);
  await saveStorage(KEY_STORE_SERIALS, storeSerialsDb);

  logEvent("STORE", "STORE_SERIALS_UPLOADED", `Uploaded and saved ${record.count} serial numbers for PO: ${po}`);
  window.showNotification({ title: "Upload Successful", message: `Saved ${record.count} serial numbers for PO: ${po}!`, type: "success" });

  document.getElementById("storePoInput").value = "";
  document.getElementById("storeExcelFile").value = "";
  document.getElementById("storeManualSerials").value = "";
  parsedStoreExcelSerials = [];

  renderStoreSerialTable();
  populateStoreSerialPoFilters();
};

function renderStoreSerialTable() {
  const tbody = document.querySelector("#storeSerialTable tbody");
  if (!tbody) return;
  if (storeSerialsDb.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--muted);">No serial records uploaded yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = storeSerialsDb.map(r => `
    <tr>
      <td style="font-family:monospace; font-size:11px;">${r.timestamp}</td>
      <td><strong>${r.poNumber}</strong></td>
      <td style="font-family:monospace; font-size:11px;">${r.serials.slice(0, 4).join(', ')}${r.serials.length > 4 ? ' ... (+' + (r.serials.length - 4) + ' more)' : ''}</td>
      <td><span style="background: #e2e8f0; padding: 2px 8px; border-radius: 4px; font-weight: bold;">${r.count}</span></td>
    </tr>
  `).join("");
}

function populateStoreSerialPoFilters() {
  const editFilter = document.getElementById("editSerialPoFilterSelect");
  const deleteFilter = document.getElementById("deleteSerialPoFilterSelect");
  const poList = [...new Set(storeSerialsDb.map(b => b.poNumber))];
  let html = `<option value="">-- Select PO to View All Serials --</option>`;
  if (poList.length === 0) {
    html = `<option value="">-- No Uploaded PO Batches Found --</option>`;
  } else {
    poList.forEach(po => {
      const count = storeSerialsDb.filter(b => b.poNumber === po).reduce((sum, b) => sum + b.serials.length, 0);
      html += `<option value="${po}">${po} (${count} serials)</option>`;
    });
  }
  if (editFilter) editFilter.innerHTML = html;
  if (deleteFilter) deleteFilter.innerHTML = html;
}

const SERIAL_TABLE_PAGE_SIZE = 250;
let editSerialPage = 1;
let editSerialRows = [];
let deleteSerialPage = 1;
let deleteEligibleSerials = [];

function renderSerialPagination(containerId, page, total, handlerName) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const pages = Math.max(1, Math.ceil(total / SERIAL_TABLE_PAGE_SIZE));
  container.style.display = total > SERIAL_TABLE_PAGE_SIZE ? "flex" : "none";
  container.innerHTML = total > SERIAL_TABLE_PAGE_SIZE ? `<button type="button" class="btn btn-secondary" ${page <= 1 ? "disabled" : ""} onclick="${handlerName}(${page - 1})">Previous</button><strong>Page ${page.toLocaleString("en-IN")} of ${pages.toLocaleString("en-IN")} · ${total.toLocaleString("en-IN")} serials</strong><button type="button" class="btn btn-secondary" ${page >= pages ? "disabled" : ""} onclick="${handlerName}(${page + 1})">Next</button>` : "";
}

window.changeEditSerialPage = function(page) {
  const pages = Math.max(1, Math.ceil(editSerialRows.length / SERIAL_TABLE_PAGE_SIZE));
  editSerialPage = Math.min(pages, Math.max(1, Number(page) || 1));
  renderEditSerialPage();
};

function renderEditSerialPage() {
  const tbody = document.getElementById("editSerialPoListTbody");
  if (!tbody) return;
  const start = (editSerialPage - 1) * SERIAL_TABLE_PAGE_SIZE;
  const rows = editSerialRows.slice(start, start + SERIAL_TABLE_PAGE_SIZE);
  tbody.innerHTML = rows.map((item, idx) => `<tr><td>${start + idx + 1}</td><td style="font-family:monospace;font-weight:bold;">${escapeSalesHtml(item.serial)}</td><td><button class="btn btn-primary" style="padding:4px 10px;font-size:11px;" onclick="loadSpecificSerialForEdit(decodeURIComponent('${encodeURIComponent(item.serial)}'))">Edit</button></td></tr>`).join("");
  renderSerialPagination("editSerialPagination", editSerialPage, editSerialRows.length, "changeEditSerialPage");
}

function resetEditSerialStation() {
  editSerialPage = 1;
  editSerialRows = [];
  currentEditSerialTarget = null;
  document.getElementById("searchEditSerialInput").value = "";
  document.getElementById("editSerialPoFilterSelect").value = "";
  document.getElementById("editSerialPoListBox").style.display = "none";
  document.getElementById("editSerialFormBox").style.display = "none";
  document.getElementById("editSerialEmptyMsg").style.display = "block";
}

window.loadSerialsForPoEdit = function() {
  const selectedPo = document.getElementById("editSerialPoFilterSelect").value;
  const listBox = document.getElementById("editSerialPoListBox");
  const tbody = document.getElementById("editSerialPoListTbody");
  const emptyMsg = document.getElementById("editSerialEmptyMsg");
  document.getElementById("searchEditSerialInput").value = "";
  document.getElementById("editSerialFormBox").style.display = "none";

  if (!selectedPo) { listBox.style.display = "none"; emptyMsg.style.display = "block"; return; }
  let serials = [];
  storeSerialsDb.forEach(batch => {
    if (batch.poNumber === selectedPo) {
      batch.serials.forEach(s => serials.push({ serial: s, batch: batch }));
    }
  });

  if (serials.length === 0) {
    editSerialRows = [];
    renderSerialPagination("editSerialPagination", 1, 0, "changeEditSerialPage");
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--muted);">No serials found under PO ${selectedPo}</td></tr>`;
  } else {
    editSerialRows = serials;
    editSerialPage = 1;
    renderEditSerialPage();
  }
  listBox.style.display = "block";
  emptyMsg.style.display = "none";
};

window.loadSpecificSerialForEdit = function(serial) {
  document.getElementById("searchEditSerialInput").value = serial;
  onSearchEditSerial();
};

window.onSearchEditSerial = function() {
  const q = document.getElementById("searchEditSerialInput").value.trim().toUpperCase();
  const formBox = document.getElementById("editSerialFormBox");
  const emptyMsg = document.getElementById("editSerialEmptyMsg");

  if (!q) {
    formBox.style.display = "none";
    if (document.getElementById("editSerialPoListBox").style.display === "none") emptyMsg.style.display = "block";
    currentEditSerialTarget = null;
    return;
  }

  let foundBatch = null;
  let foundIndex = -1;
  for (let batch of storeSerialsDb) {
    foundIndex = batch.serials.findIndex(s => s.toUpperCase() === q);
    if (foundIndex !== -1) { foundBatch = batch; break; }
  }

  if (foundBatch && foundIndex !== -1) {
    currentEditSerialTarget = { batch: foundBatch, index: foundIndex, originalSerial: foundBatch.serials[foundIndex] };
    document.getElementById("editOldSerialInput").value = currentEditSerialTarget.originalSerial;
    document.getElementById("editNewSerialInput").value = currentEditSerialTarget.originalSerial;
    document.getElementById("editSerialPoInput").value = foundBatch.poNumber;
    formBox.style.display = "block";
    emptyMsg.style.display = "none";
  } else {
    currentEditSerialTarget = null;
    formBox.style.display = "none";
    if (document.getElementById("editSerialPoListBox").style.display === "none") emptyMsg.style.display = "block";
  }
};

window.saveEditedSerial = async function() {
  if (!currentEditSerialTarget) return;
  const newSerial = document.getElementById("editNewSerialInput").value.trim().toUpperCase();
  if (!newSerial) { 
    window.showNotification({ title: "Validation Error", message: "Serial number cannot be empty.", type: "warning" }); 
    return; 
  }

  if (newSerial !== currentEditSerialTarget.originalSerial.toUpperCase()) {
    const existing = getAllRegisteredSerials();
    if (existing.has(newSerial)) { 
      window.showNotification({ title: "Duplicate Serial", message: `Serial number "${newSerial}" already exists.`, type: "danger" }); 
      return; 
    }
  }

  const oldSerial = currentEditSerialTarget.batch.serials[currentEditSerialTarget.index];
  currentEditSerialTarget.batch.serials[currentEditSerialTarget.index] = newSerial;
  await saveStorage(KEY_STORE_SERIALS, storeSerialsDb);

  logEvent("STORE", "SERIAL_EDITED", `Modified serial ${oldSerial} -> ${newSerial}`);
  window.showNotification({ title: "Serial Updated", message: `Serial updated successfully to "${newSerial}"!`, type: "success" });

  resetEditSerialStation();
  renderStoreSerialTable();
  populateStoreSerialPoFilters();
};

function getPpcSerialsForPo(poNumber) {
  const targetPo = String(poNumber || "").trim().toUpperCase();

  return (storeSerialsDb || [])
    .filter(batch => String(batch.poNumber || "").trim().toUpperCase() === targetPo)
    .flatMap(batch => batch.serials || [])
    .map(serial => String(serial || "").trim())
    .filter(Boolean)
    .sort((left, right) => {
      const leftMatch = left.match(/(\d+)(?!.*\d)/);
      const rightMatch = right.match(/(\d+)(?!.*\d)/);
      const difference = Number(leftMatch?.[1] || 0) - Number(rightMatch?.[1] || 0);
      return difference || left.localeCompare(right, undefined, { numeric: true });
    });
}

function resetDeleteSerialStation() {
  selectedDeleteSerials = new Set();
  deleteEligibleSerials = [];
  deleteSerialPage = 1;

  const poSelect = document.getElementById("deleteSerialPoFilterSelect");
  const listBox = document.getElementById("deleteSerialPoListBox");
  const emptyMsg = document.getElementById("deleteSerialEmptyMsg");
  const tbody = document.getElementById("deleteSerialPoListTbody");
  const selectAll = document.getElementById("selectAllDeleteSerials");

  if (poSelect) poSelect.value = "";
  if (listBox) {
    listBox.style.display = "none";
    listBox.dataset.eligibleCount = "0";
    listBox.dataset.protectedCount = "0";
  }
  if (emptyMsg) emptyMsg.style.display = "block";
  if (tbody) tbody.innerHTML = "";
  renderSerialPagination("deleteSerialPagination", 1, 0, "changeDeleteSerialPage");
  if (selectAll) selectAll.checked = false;

  window.updateSelectedDeleteSerials();
}

window.loadSerialsForPoDelete = function() {
  const selectedPo = document.getElementById("deleteSerialPoFilterSelect")?.value || "";
  const listBox = document.getElementById("deleteSerialPoListBox");
  const tbody = document.getElementById("deleteSerialPoListTbody");
  const emptyMsg = document.getElementById("deleteSerialEmptyMsg");
  const selectAll = document.getElementById("selectAllDeleteSerials");

  selectedDeleteSerials = new Set();
  if (selectAll) selectAll.checked = false;

  if (!selectedPo) {
    if (listBox) listBox.style.display = "none";
    if (emptyMsg) emptyMsg.style.display = "block";
    window.updateSelectedDeleteSerials();
    return;
  }

  const allSerials = getPpcSerialsForPo(selectedPo);
  const serials = allSerials.filter(serial => !findSerialUsage(serial));
  const protectedCount = allSerials.length - serials.length;

  if (listBox) {
    listBox.dataset.eligibleCount = String(serials.length);
    listBox.dataset.protectedCount = String(protectedCount);
  }

  if (!serials.length) {
    deleteEligibleSerials = [];
    renderSerialPagination("deleteSerialPagination", 1, 0, "changeDeleteSerialPage");
    tbody.innerHTML = `
      <tr>
        <td colspan="3" style="text-align:center; color:var(--muted); padding:20px;">
          ${allSerials.length
            ? `All ${allSerials.length} serial(s) for PO ${selectedPo} are already packed or dispatched and are protected from deletion.`
            : `No PPC-uploaded serials found for PO ${selectedPo}.`}
        </td>
      </tr>
    `;
  } else {
    deleteEligibleSerials = serials;
    deleteSerialPage = 1;
    renderDeleteSerialPage();
  }

  if (listBox) listBox.style.display = "block";
  if (emptyMsg) emptyMsg.style.display = "none";

  window.updateSelectedDeleteSerials();
};

window.changeDeleteSerialPage = function(page) {
  const pages = Math.max(1, Math.ceil(deleteEligibleSerials.length / SERIAL_TABLE_PAGE_SIZE));
  deleteSerialPage = Math.min(pages, Math.max(1, Number(page) || 1));
  renderDeleteSerialPage();
};

function renderDeleteSerialPage() {
  const tbody = document.getElementById("deleteSerialPoListTbody");
  if (!tbody) return;
  const start = (deleteSerialPage - 1) * SERIAL_TABLE_PAGE_SIZE;
  const rows = deleteEligibleSerials.slice(start, start + SERIAL_TABLE_PAGE_SIZE);
  tbody.innerHTML = rows.map((serial, index) => `<tr><td style="text-align:center;"><input type="checkbox" class="delete-serial-checkbox" value="${escapeSalesHtml(serial)}" ${selectedDeleteSerials.has(serial) ? "checked" : ""} onchange="updateSelectedDeleteSerials(this)"></td><td>${start + index + 1}</td><td style="font-family:monospace;font-weight:700;">${escapeSalesHtml(serial)}</td></tr>`).join("");
  renderSerialPagination("deleteSerialPagination", deleteSerialPage, deleteEligibleSerials.length, "changeDeleteSerialPage");
  window.updateSelectedDeleteSerials();
}

window.toggleAllDeleteSerials = function(isChecked) {
  document.querySelectorAll(".delete-serial-checkbox").forEach(box => {
    box.checked = isChecked;
    const value = String(box.value || "").trim();
    if (value) isChecked ? selectedDeleteSerials.add(value) : selectedDeleteSerials.delete(value);
  });

  window.updateSelectedDeleteSerials();
};

window.updateSelectedDeleteSerials = function(changedBox) {
  if (changedBox) {
    const value = String(changedBox.value || "").trim();
    if (value) changedBox.checked ? selectedDeleteSerials.add(value) : selectedDeleteSerials.delete(value);
  }

  const summary = document.getElementById("deleteSerialSelectionSummary");
  const listBox = document.getElementById("deleteSerialPoListBox");
  const button = document.getElementById("btnRequestMultiSerialDelete");
  const selectAll = document.getElementById("selectAllDeleteSerials");
  const allBoxes = [...document.querySelectorAll(".delete-serial-checkbox")];

  if (summary) {
    const eligibleCount = Number(listBox?.dataset.eligibleCount || 0);
    const protectedCount = Number(listBox?.dataset.protectedCount || 0);
    summary.textContent = `${selectedDeleteSerials.size} selected · ${eligibleCount} unpacked available${protectedCount ? ` · ${protectedCount} packed protected` : ""}`;
  }

  if (button) {
    button.disabled = selectedDeleteSerials.size === 0;
    button.style.opacity = selectedDeleteSerials.size === 0 ? "0.55" : "1";
    button.style.cursor = selectedDeleteSerials.size === 0 ? "not-allowed" : "pointer";
  }

  if (selectAll && allBoxes.length) {
    selectAll.checked = allBoxes.every(box => box.checked);
    selectAll.indeterminate = selectedDeleteSerials.size > 0 && !selectAll.checked;
  } else if (selectAll) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
  }
};

window.submitMultipleSerialDeleteRequest = async function() {
  const poNumber = document.getElementById("deleteSerialPoFilterSelect")?.value || "";
  const serials = [...selectedDeleteSerials];

  if (!poNumber) {
    window.showNotification({
      title: "PO Required",
      message: "Select a Production Order before selecting serials.",
      type: "warning"
    });
    return;
  }

  if (!serials.length) {
    window.showNotification({
      title: "No Serials Selected",
      message: "Select at least one serial number for deletion.",
      type: "warning"
    });
    return;
  }

  const protectedSerials = serials.filter(serial => findSerialUsage(serial));

  if (protectedSerials.length) {
    window.showNotification({
      title: "Packed Serial Cannot Be Deleted",
      message: `${protectedSerials.length} selected serial(s) are already in a warehouse pallet or dispatch history. Remove them from the selection.`,
      type: "danger"
    });
    return;
  }

  const reason = await window.showPromptDialog({
    title: "Request Multiple Serial Deletion",
    message: `Request deletion of ${serials.length} PPC-uploaded serial(s) from PO ${poNumber}? This requires the assigned Store & PPC approver.`,
    label: "Reason for Deletion *",
    placeholder: "Example: rejected material, duplicate import, incorrect upload...",
    confirmText: "Send for Department Approval",
    isDanger: true
  });

  if (!reason) return;

  const request = {
    id: "REQ-" + Date.now(),
    type: "DELETE_SERIALS_MULTI",
    targetId: `PO ${poNumber} — ${serials.length} Serial(s)`,
    details: `${serials.length} PPC-uploaded serial(s) selected for deletion from PO ${poNumber}.`,
    payload: {
      poNumber: poNumber,
      serials: serials
    },
    requestedBy: currentLoggedInUser ? currentLoggedInUser.username : "OPERATOR",
    requestedAt: new Date().toLocaleString(),
    reason: reason,
    status: "PENDING",
    reviewedBy: "-",
    reviewedAt: "-",
    adminRemark: "-"
  };

  requestsDb.unshift(request);
  await saveStorage(KEY_REQUESTS, requestsDb);

  logEvent(
    "STORE",
    "MULTI_SERIAL_DELETE_REQUESTED",
    `Requested deletion of ${serials.length} serial(s) from PO ${poNumber}.`
  );

  window.showNotification({
    title: "Request Submitted",
    message: `${serials.length} serial deletion request sent to the assigned Store & PPC approver.`,
    type: "warning"
  });

  window.loadSerialsForPoDelete();
};

function legacyReportPackingRows() {
  const rows = [];
  (godownStock || []).forEach(pallet => rows.push({ pallet: pallet.pallet || "-", po: pallet.po || "-", specification: `${pallet.model || "-"} ${pallet.watt || ""}`.trim(), quantity: Number(pallet.count || (pallet.serials || []).length || 0), status: "IN WAREHOUSE", serials: (pallet.serials || []).join(", "), date: pallet.date || "" }));
  (dispatchArchive || []).forEach(manifest => (manifest.pallets || []).forEach(pallet => rows.push({ pallet: pallet.pallet || "-", po: pallet.po || manifest.po || "-", specification: `${pallet.model || "-"} ${pallet.watt || ""}`.trim(), quantity: Number(pallet.count || (pallet.serials || []).length || 0), status: "DISPATCHED", serials: (pallet.serials || []).join(", "), date: manifest.date || pallet.date || "" })));
  return rows;
}

window.openPackingReportsView = function() {
  const select = document.getElementById("repPackPoFilter");
  if (select) {
    const current = select.value;
    const orders = [...new Set(legacyReportPackingRows().map(row => row.po).filter(value => value && value !== "-"))].sort();
    select.innerHTML = `<option value="ALL">All Production Orders</option>` + orders.map(value => `<option value="${escapeSalesHtml(value)}">${escapeSalesHtml(value)}</option>`).join("");
    if (["ALL", ...orders].includes(current)) select.value = current;
  }
  window.renderPackingReportTable();
};

window.renderPackingReportTable = function() {
  const body = document.getElementById("repPackTableBody");
  if (!body) return;
  const po = document.getElementById("repPackPoFilter")?.value || "ALL";
  const from = document.getElementById("repPackDateFrom")?.value || "";
  const to = document.getElementById("repPackDateTo")?.value || "";
  const rows = legacyReportPackingRows().filter(row => {
    const ymd = typeof reportHubYmd === "function" ? reportHubYmd(row.date) : "";
    return (po === "ALL" || row.po === po) && (!from || !ymd || ymd >= from) && (!to || !ymd || ymd <= to);
  });
  body.innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeSalesHtml(row.pallet)}</td><td>${escapeSalesHtml(row.po)}</td><td>${escapeSalesHtml(row.specification)}</td><td>${row.quantity.toLocaleString("en-IN")}</td><td>${escapeSalesHtml(row.status)}</td></tr>`).join("") : `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--muted);">No packing records match these filters.</td></tr>`;
};

window.openDispatchReportsView = function() { window.renderDispatchReportTable(); };

window.renderDispatchReportTable = function() {
  const body = document.getElementById("repDispTableBody");
  if (!body) return;
  const customer = String(document.getElementById("repDispCustomerFilter")?.value || "").trim().toLowerCase();
  const vehicle = String(document.getElementById("repDispVehicleFilter")?.value || "").trim().toLowerCase();
  const date = document.getElementById("repDispDateFilter")?.value || "";
  const rows = (dispatchArchive || []).filter(row => {
    const ymd = typeof reportHubYmd === "function" ? reportHubYmd(row.date || row.createdAt) : "";
    return (!customer || String(row.customer || "").toLowerCase().includes(customer)) && (!vehicle || String(row.vehicle || "").toLowerCase().includes(vehicle)) && (!date || ymd === date);
  });
  body.innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeSalesHtml(row.date || "-")}</td><td>${escapeSalesHtml(row.invoice || "-")}</td><td>${escapeSalesHtml(row.vehicle || "-")}</td><td>${escapeSalesHtml(row.customer || "-")}</td><td>${Number((row.pallets || []).length).toLocaleString("en-IN")}</td><td>${Number(row.dispatchedQty || 0).toLocaleString("en-IN")}</td><td>${escapeSalesHtml(row.challanNo || "-")}</td></tr>`).join("") : `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--muted);">No dispatch records match these filters.</td></tr>`;
};

window.openCustomReportsView = function() {
  const select = document.getElementById("custRepWatt");
  if (select) {
    const current = select.value;
    const values = [...new Set(legacyReportPackingRows().map(row => row.specification).filter(Boolean))].sort();
    select.innerHTML = `<option value="ALL">All Specifications</option>` + values.map(value => `<option value="${escapeSalesHtml(value)}">${escapeSalesHtml(value)}</option>`).join("");
    if (["ALL", ...values].includes(current)) select.value = current;
  }
  window.renderCustomReportTable();
};

window.renderCustomReportTable = function() {
  const body = document.getElementById("custRepTableBody");
  if (!body) return;
  const scope = document.getElementById("custRepScope")?.value || "COMBINED";
  const specification = document.getElementById("custRepWatt")?.value || "ALL";
  const keyword = String(document.getElementById("custRepKeyword")?.value || "").trim().toLowerCase();
  const packing = legacyReportPackingRows().filter(row => row.status !== "DISPATCHED").map(row => ({ scope: "PACKING", reference: row.pallet, ...row }));
  const dispatch = (dispatchArchive || []).map(row => ({ scope: "DISPATCH", reference: row.invoice || "-", po: row.po || "-", specification: `${row.model || "-"} ${row.watt || ""}`.trim(), quantity: Number(row.dispatchedQty || 0), serials: (row.pallets || []).flatMap(pallet => pallet.serials || []).join(", ") }));
  const rows = [...packing, ...dispatch].filter(row => (scope === "COMBINED" || row.scope === scope) && (specification === "ALL" || row.specification === specification) && (!keyword || JSON.stringify(row).toLowerCase().includes(keyword)));
  body.innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeSalesHtml(row.scope)}</td><td>${escapeSalesHtml(row.reference)}</td><td>${escapeSalesHtml(row.po)}</td><td>${escapeSalesHtml(row.specification)}</td><td>${Number(row.quantity || 0).toLocaleString("en-IN")}</td><td>${escapeSalesHtml(row.serials || "-")}</td></tr>`).join("") : `<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--muted);">No records match these filters.</td></tr>`;
};

window.exportDataToExcel = function(scope) {
  const tableId = scope === "PACKING" ? "repPackTableBody" : scope === "DISPATCH" ? "repDispTableBody" : "custRepTableBody";
  const table = document.getElementById(tableId)?.closest("table");
  if (!table || !window.XLSX) {
    window.showNotification({ title: "Export Unavailable", message: "The Excel exporter is not available. Refresh the page and try again.", type: "danger" });
    return;
  }
  const workbook = XLSX.utils.table_to_book(table, { sheet: scope });
  XLSX.writeFile(workbook, `DemoSolar_${scope}_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

window.exportDataToPdf = function(scope) {
  const tableId = scope === "PACKING" ? "repPackTableBody" : scope === "DISPATCH" ? "repDispTableBody" : "custRepTableBody";
  const table = document.getElementById(tableId)?.closest("table");
  const JsPdf = window.jspdf?.jsPDF;
  if (!table || !JsPdf) {
    window.showNotification({ title: "Export Unavailable", message: "The PDF exporter is not available. Refresh the page and try again.", type: "danger" });
    return;
  }
  const pdf = new JsPdf({ orientation: "landscape", unit: "mm", format: "a4" });
  pdf.setFontSize(14);
  pdf.text(`DEMOSOLAR ENERGY — ${scope} REPORT`, 12, 14);
  pdf.setFontSize(8);
  let y = 22;
  [...table.rows].forEach(row => {
    const line = [...row.cells].map(cell => String(cell.innerText || "").replace(/\s+/g, " ").trim()).join(" | ");
    const wrapped = pdf.splitTextToSize(line, 270);
    if (y + wrapped.length * 4 > 195) { pdf.addPage(); y = 14; }
    pdf.text(wrapped, 12, y);
    y += wrapped.length * 4 + 1;
  });
  pdf.save(`DemoSolar_${scope}_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
};

window.openDailyDepartmentReportView = function(btnEl) {
  switchView('reportsDailyDept', btnEl, "Reports Hub > Today's Dept Reports");
  renderDailyDeptReport();
};

window.renderDailyDeptReport = function() {
  const dept = document.getElementById("dailyDeptSelect").value;
  const output = document.getElementById("dailyDeptReportOutput");
  if (!output) return;

  const todayStr = new Date().toLocaleDateString();
  let html = `<h4 style="margin-bottom: 15px; color: var(--primary);">Department-wise Operations Summary (${todayStr})</h4>`;

  if (dept === "all" || dept === "store") {
    let totalStoreBatches = storeSerialsDb.length;
    let totalStoreSerials = storeSerialsDb.reduce((acc, curr) => acc + curr.count, 0);
    html += `
      <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 15px;">
        <h5 style="text-transform: uppercase; color: #0f172a; margin-bottom: 8px;">📦 Store &amp; PPC Department</h5>
        <p style="font-size: 13px; color: var(--muted); margin-bottom: 4px;">Total Production Orders (POs): <strong>${poDatabase.length}</strong></p>
        <p style="font-size: 13px; color: var(--muted); margin-bottom: 4px;">Total Batch Uploads Logged: <strong>${totalStoreBatches}</strong></p>
        <p style="font-size: 13px; color: var(--muted);">Total Serial Numbers Registered: <strong style="color: var(--primary);">${totalStoreSerials}</strong></p>
      </div>
    `;
  }

  if (dept === "all" || dept === "packing") {
    let totalPackedToday = godownStock.reduce((acc, curr) => acc + curr.count, 0);
    html += `
      <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 15px;">
        <h5 style="text-transform: uppercase; color: #0f172a; margin-bottom: 8px;">🏷️ Packing Department</h5>
        <p style="font-size: 13px; color: var(--muted); margin-bottom: 4px;">Pallets Sealed &amp; Transferred to Godown: <strong>${godownStock.length}</strong></p>
        <p style="font-size: 13px; color: var(--muted);">Total Modules Packed: <strong style="color: var(--success);">${totalPackedToday}</strong></p>
      </div>
    `;
  }

  if (dept === "all" || dept === "dispatch") {
    let totalDispatchedToday = dispatchArchive.reduce((acc, curr) => acc + curr.dispatchedQty, 0);
    html += `
      <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 15px;">
        <h5 style="text-transform: uppercase; color: #0f172a; margin-bottom: 8px;">🚚 Dispatch Department</h5>
        <p style="font-size: 13px; color: var(--muted); margin-bottom: 4px;">Vehicles Cleared / Challans Generated: <strong>${dispatchArchive.length}</strong></p>
        <p style="font-size: 13px; color: var(--muted);">Total Modules Dispatched: <strong style="color: var(--success);">${totalDispatchedToday}</strong></p>
      </div>
    `;
  }
  output.innerHTML = html;
};
