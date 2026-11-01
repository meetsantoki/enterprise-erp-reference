/* =========================================================================
   DELETION CONTROLLERS, ADVANCED SEARCH & APPROVAL ENGINE
   ========================================================================= */

  // PACKING: EDIT PALLET WITH ADMIN APPROVAL
let currentEditPallet = null;

function getEditablePalletGrade(value) {
  const firstLetter = String(value || "A").trim().toUpperCase().charAt(0);
  return ["A", "B", "R"].includes(firstLetter) ? `${firstLetter} GRADE` : "A GRADE";
}

function canPalletBeAGrade(pallet) {
  const rows = pallet.fullRows || [];
  const poValues = new Set(
    rows.map(row => String(row.po || pallet.po || "").trim()).filter(Boolean)
  );
  const binningValues = new Set(
    rows.map(row => String(row.binning || pallet.binning || "").trim()).filter(Boolean)
  );

  if (poValues.size === 0 && pallet.po) poValues.add(String(pallet.po).trim());
  if (binningValues.size === 0 && pallet.binning) binningValues.add(String(pallet.binning).trim());

  return poValues.size === 1 && binningValues.size === 1;
}

window.populateEditPalletDropdown = function() {
  const select = document.getElementById("editPalletSelect");
  if (!select) return;

  currentEditPallet = null;

  select.innerHTML = `<option value="">-- Select pallet to edit --</option>` +
    (godownStock || []).map(pallet => `
      <option value="${pallet.pallet}">
        ${pallet.pallet} | PO: ${pallet.po || "-"} | ${pallet.count || (pallet.serials || []).length} Modules
      </option>
    `).join("");

  window.onSelectPalletToEdit();
};

window.onSelectPalletToEdit = function() {
  const palletNumber = document.getElementById("editPalletSelect")?.value || "";
  const pallet = (godownStock || []).find(item =>
    normalizePackingId(item.pallet) === normalizePackingId(palletNumber)
  );

  const detailsBox = document.getElementById("editPalletDetailsBox");
  const emptyBox = document.getElementById("editPalletEmptyMsg");
  const button = document.getElementById("btnSubmitPalletEdit");

  currentEditPallet = pallet || null;

  if (!pallet) {
    if (detailsBox) detailsBox.style.display = "none";
    if (emptyBox) emptyBox.style.display = "block";
    if (button) button.style.display = "none";
    return;
  }

  document.getElementById("editPalletCurrentNumber").textContent = pallet.pallet;
  document.getElementById("editPalletCurrentGrade").textContent = getEditablePalletGrade(pallet.grade);
  document.getElementById("editPalletCurrentPo").textContent = pallet.po || "-";
  document.getElementById("editPalletCurrentModel").textContent = pallet.model || "-";
  document.getElementById("editPalletCurrentCount").textContent =
    pallet.count || (pallet.serials || []).length || 0;

  document.getElementById("editPalletNewNumber").value = pallet.pallet;
  document.getElementById("editPalletNewGrade").value = getEditablePalletGrade(pallet.grade);
  document.getElementById("editPalletReason").value = "";

  if (detailsBox) detailsBox.style.display = "block";
  if (emptyBox) emptyBox.style.display = "none";
  if (button) button.style.display = "block";
};

window.submitPalletEditRequest = async function() {
  const pallet = currentEditPallet;
  const newPalletNumber = normalizePackingId(
    document.getElementById("editPalletNewNumber")?.value
  );
  const newGrade = getEditablePalletGrade(
    document.getElementById("editPalletNewGrade")?.value
  );
  const reason = (document.getElementById("editPalletReason")?.value || "").trim();

  if (!pallet) {
    window.showNotification({ title: "Select Pallet", message: "Please select a pallet first.", type: "warning" });
    return;
  }

  if (!newPalletNumber || !/^[A-Z0-9][A-Z0-9-]*$/.test(newPalletNumber)) {
    window.showNotification({ title: "Invalid Pallet Number", message: "Use only letters, numbers, and hyphens.", type: "warning" });
    return;
  }

  if (!reason) {
    window.showNotification({ title: "Reason Required", message: "Enter the reason for this pallet correction.", type: "warning" });
    return;
  }

  const oldPalletNumber = normalizePackingId(pallet.pallet);

  const duplicateNumber = [
    ...(godownStock || []),
    ...((dispatchArchive || []).flatMap(manifest => manifest.pallets || []))
  ].some(item =>
    normalizePackingId(item.pallet) === newPalletNumber &&
    normalizePackingId(item.pallet) !== oldPalletNumber
  );

  if (duplicateNumber) {
    window.showNotification({ title: "Duplicate Pallet Number", message: `Pallet number ${newPalletNumber} already exists in warehouse or dispatch history.`, type: "danger" });
    return;
  }

  if (newGrade === "A GRADE" && !canPalletBeAGrade(pallet)) {
    window.showNotification({
      title: "A Grade Validation Failed",
      message: "A-grade pallet must contain modules of one PO and one binning only.",
      type: "danger"
    });
    return;
  }

  if (oldPalletNumber === newPalletNumber &&
      getEditablePalletGrade(pallet.grade) === newGrade) {
    window.showNotification({ title: "No Change", message: "Enter a different pallet number or grade before submitting.", type: "warning" });
    return;
  }

  const alreadyPending = (requestsDb || []).some(request =>
    request.status === "PENDING" &&
    request.type === "EDIT_PALLET" &&
    normalizePackingId(request.payload?.oldPallet) === oldPalletNumber
  );

  if (alreadyPending) {
    window.showNotification({ title: "Request Already Pending", message: "This pallet already has an edit request waiting for Admin approval.", type: "warning" });
    return;
  }

  const request = {
    id: "REQ-" + Date.now(),
    type: "EDIT_PALLET",
    targetId: pallet.pallet,
    details: `Pallet: ${pallet.pallet} → ${newPalletNumber} | Grade: ${getEditablePalletGrade(pallet.grade)} → ${newGrade} | PO: ${pallet.po || "-"}`,
    payload: {
      oldPallet: pallet.pallet,
      newPallet: newPalletNumber,
      newGrade: newGrade
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

  logEvent("PACKING", "PALLET_EDIT_REQUESTED",
    `Edit request for ${pallet.pallet}: pallet ${newPalletNumber}, grade ${newGrade}.`);

  window.showNotification({
    title: "Edit Request Submitted",
    message: `Pallet ${pallet.pallet} correction is waiting for Administrator approval.`,
    type: "warning"
  });

  window.populateEditPalletDropdown();
};

// 1. PACKING: MULTIPLE PALLET DELETE WITH ADMIN APPROVAL

function palletBelongsToPoForDelete(pallet, poNumber) {
  const targetPo = String(poNumber || "").trim().toUpperCase();

  if (String(pallet.po || "").trim().toUpperCase() === targetPo) return true;

  return (pallet.fullRows || []).some(row =>
    String(row.po || "").trim().toUpperCase() === targetPo
  );
}

window.populateDeletePalletDropdown = function() {
  const poSelect = document.getElementById("deletePalletPoFilter");
  const listBox = document.getElementById("deletePalletListBox");
  const emptyMsg = document.getElementById("deletePalletEmptyMsg");

  if (!poSelect) return;

  selectedDeletePallets = new Set();

  const poNumbers = [...new Set(
    (godownStock || [])
      .flatMap(pallet => [
        pallet.po || "",
        ...(pallet.fullRows || []).map(row => row.po || "")
      ])
      .map(po => String(po).trim())
      .filter(Boolean)
  )].sort();

  poSelect.innerHTML = poNumbers.length
    ? `<option value="">-- Select PO to View Warehouse Pallets --</option>` +
      poNumbers.map(po => `<option value="${po}">PO ${po}</option>`).join("")
    : `<option value="">-- No Warehouse Pallets Available --</option>`;

  if (listBox) listBox.style.display = "none";
  if (emptyMsg) emptyMsg.style.display = "block";

  window.updateSelectedDeletePallets();
};

window.loadPalletsForPoDelete = function() {
  const poNumber = document.getElementById("deletePalletPoFilter")?.value || "";
  const listBox = document.getElementById("deletePalletListBox");
  const tbody = document.getElementById("deletePalletListTbody");
  const emptyMsg = document.getElementById("deletePalletEmptyMsg");
  const selectAll = document.getElementById("selectAllDeletePallets");
  const reasonInput = document.getElementById("deleteMultiplePalletReason");

  selectedDeletePallets = new Set();
  if (selectAll) selectAll.checked = false;
  if (reasonInput) reasonInput.value = "";

  if (!poNumber) {
    if (listBox) listBox.style.display = "none";
    if (emptyMsg) emptyMsg.style.display = "block";
    window.updateSelectedDeletePallets();
    return;
  }

  const pallets = (godownStock || []).filter(pallet =>
    palletBelongsToPoForDelete(pallet, poNumber)
  );

  if (!pallets.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; color:var(--muted); padding:20px;">
          No warehouse pallets found for PO ${poNumber}.
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = pallets.map((pallet, index) => {
      const booking = getActiveStockBooking(pallet.pallet);
      const bookedCustomer = booking ? booking.customer : "-";
      const quantity = pallet.count || (pallet.serials || []).length || 0;

      return `
        <tr>
          <td style="text-align:center;">
            <input type="checkbox" class="delete-pallet-checkbox"
              value="${pallet.pallet}"
              onchange="updateSelectedDeletePallets()">
          </td>
          <td>${index + 1}</td>
          <td><strong style="color:var(--primary);">${pallet.pallet}</strong></td>
          <td>${pallet.grade || "A GRADE"}</td>
          <td>${pallet.model || "-"}</td>
          <td><strong>${quantity}</strong></td>
          <td style="color:${booking ? "#7c3aed" : "var(--muted)"}; font-weight:${booking ? "700" : "400"};">
            ${bookedCustomer}
          </td>
        </tr>
      `;
    }).join("");
  }

  if (listBox) listBox.style.display = "block";
  if (emptyMsg) emptyMsg.style.display = "none";

  window.updateSelectedDeletePallets();
};

window.toggleAllDeletePallets = function(isChecked) {
  document.querySelectorAll(".delete-pallet-checkbox").forEach(box => {
    box.checked = isChecked;
  });

  window.updateSelectedDeletePallets();
};

window.updateSelectedDeletePallets = function() {
  selectedDeletePallets = new Set(
    [...document.querySelectorAll(".delete-pallet-checkbox:checked")]
      .map(box => String(box.value || "").trim())
      .filter(Boolean)
  );

  const summary = document.getElementById("deletePalletSelectionSummary");
  const button = document.getElementById("btnRequestMultiPalletDelete");
  const selectAll = document.getElementById("selectAllDeletePallets");
  const allBoxes = [...document.querySelectorAll(".delete-pallet-checkbox")];

  if (summary) {
    const selectedModules = [...selectedDeletePallets].reduce((total, palletNumber) => {
      const pallet = (godownStock || []).find(item =>
        normalizePackingId(item.pallet) === normalizePackingId(palletNumber)
      );

      return total + (pallet?.count || (pallet?.serials || []).length || 0);
    }, 0);

    summary.textContent =
      `${selectedDeletePallets.size} pallet(s) selected • ${selectedModules} module(s)`;
  }

  if (button) {
    button.disabled = selectedDeletePallets.size === 0;
    button.style.opacity = selectedDeletePallets.size === 0 ? "0.55" : "1";
    button.style.cursor = selectedDeletePallets.size === 0 ? "not-allowed" : "pointer";
  }

  if (selectAll && allBoxes.length) {
    selectAll.checked = allBoxes.every(box => box.checked);
  }
};

window.submitMultiplePalletDeleteRequest = async function() {
  const poNumber = document.getElementById("deletePalletPoFilter")?.value || "";
  const reason = (document.getElementById("deleteMultiplePalletReason")?.value || "").trim();
  const pallets = [...selectedDeletePallets];

  if (!poNumber) {
    window.showNotification({
      title: "PO Required",
      message: "Please select a Production Order first.",
      type: "warning"
    });
    return;
  }

  if (!pallets.length) {
    window.showNotification({
      title: "No Pallets Selected",
      message: "Select at least one warehouse pallet.",
      type: "warning"
    });
    return;
  }

  if (!reason) {
    window.showNotification({
      title: "Reason Required",
      message: "Enter a reason for deleting the selected pallets.",
      type: "warning"
    });
    return;
  }

  const unavailable = pallets.filter(palletNumber =>
    !(godownStock || []).some(pallet =>
      normalizePackingId(pallet.pallet) === normalizePackingId(palletNumber)
    )
  );

  if (unavailable.length) {
    window.showNotification({
      title: "Pallet Unavailable",
      message: `${unavailable.length} selected pallet(s) no longer exist in warehouse. Refresh and select again.`,
      type: "danger"
    });
    return;
  }

  const request = {
    id: "REQ-" + Date.now(),
    type: "DELETE_PALLETS_MULTI",
    targetId: `PO ${poNumber} — ${pallets.length} Pallet(s)`,
    details: `Deletion requested for ${pallets.length} warehouse pallet(s): ${pallets.join(", ")}`,
    payload: {
      poNumber: poNumber,
      pallets: pallets
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
    "PACKING",
    "MULTI_PALLET_DELETE_REQUESTED",
    `Requested deletion of ${pallets.length} warehouse pallet(s) for PO ${poNumber}.`
  );

  window.showNotification({
    title: "Request Submitted",
    message: `${pallets.length} pallet deletion request sent to Administrator.`,
    type: "warning"
  });

  window.populateDeletePalletDropdown();
};

// 2. DISPATCH DELETE: ADVANCED MULTI-FIELD SEARCH & RENDERING ENGINE
window.resetDispatchDeleteView = function() {
  activeDeleteMatchedManifests = [];
  const searchInput = document.getElementById("searchDispatchDeleteInput");
  if (searchInput) searchInput.value = "";
  
  const container = document.getElementById("dispatchDeleteCardsContainer");
  if (container) container.innerHTML = "";
  
  const emptyNotice = document.getElementById("dispatchDeleteEmptyNotice");
  if (emptyNotice) emptyNotice.style.display = "block";

  const bulkBar = document.getElementById("dispDeleteBulkBar");
  if (bulkBar) bulkBar.style.display = "none";

  window.populateDispatchDeleteDropdownOptions(dispatchArchive || []);
};

window.populateDispatchDeleteDropdownOptions = function(list) {
  const sel = document.getElementById("deleteDispatchSelect");
  if (!sel) return;

  if (!list || list.length === 0) {
    sel.innerHTML = `<option value="">-- No Dispatches Available --</option>`;
    return;
  }

  sel.innerHTML = `<option value="">-- Direct Pick: All Dispatches (${list.length}) --</option>` + list.map(m => `
    <option value="${m.id}">${m.invoice} | ${m.vehicle} | ${m.customer} | ${m.date} (${m.dispatchedQty} mods)</option>
  `).join("");
};

window.onSelectDispatchDropdownChange = function() {
  const selId = document.getElementById("deleteDispatchSelect").value;
  if (!selId) {
    window.resetDispatchDeleteView();
    return;
  }
  const match = (activeDeleteMatchedManifests.length > 0 ? activeDeleteMatchedManifests : dispatchArchive).find(m => String(m.id) === String(selId));
  if (match) {
    window.renderDispatchDeleteCards([match]);
  }
};

window.executeDispatchDeleteSearch = function() {
  const rawQ = (document.getElementById("searchDispatchDeleteInput")?.value || "").trim().toUpperCase();
  if (!rawQ) {
    window.showNotification({ title: "Search Required", message: "Enter Pallet No, Date, Vehicle No, Driver, Transporter, Invoice, or Serial No.", type: "warning" });
    return;
  }

  const cleanQ = rawQ.replace(/[^A-Z0-9]/g, "");
  const matched = [];

  const palletMatches = (p) => {
    if (!p) return false;
    const pltNo = (p.pallet || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (pltNo.includes(cleanQ) || cleanQ.includes(pltNo)) return true;

    const serialList = p.serials || (p.fullRows || []).map(r => (typeof r === 'object' ? r.serial : r)) || [];
    return serialList.some(s => {
      const cleanS = String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
      return cleanS === cleanQ || cleanS.includes(cleanQ);
    });
  };

  (dispatchArchive || []).forEach(m => {
    const inv = (m.invoice || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const veh = (m.vehicle || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const dt = (m.date || "").toUpperCase();
    const trans = (m.transporter || "").toUpperCase();
    const drv = (m.driverName || "").toUpperCase();

    let isMatch = (inv.includes(cleanQ) || veh.includes(cleanQ) || dt.includes(rawQ) || trans.includes(rawQ) || drv.includes(rawQ));
    if (!isMatch && Array.isArray(m.pallets)) {
      isMatch = m.pallets.some(palletMatches);
    }
    if (isMatch) matched.push(m);
  });

  const matchedGodownPallets = (godownStock || []).filter(palletMatches);
  if (matchedGodownPallets.length > 0) {
    const totalQty = matchedGodownPallets.reduce((acc, p) => acc + (p.count || (p.serials || []).length || 0), 0);
    matched.push({
      id: "GODOWN_" + Date.now(),
      invoice: "IN-GODOWN (SEALED STOCK)",
      challanNo: "GODOWN-INVENTORY",
      vehicle: "Warehouse Floor",
      transporter: "Internal Plant Stock",
      customer: "Central Warehouse Stock",
      date: typeof getFormattedToday === "function" ? getFormattedToday() : new Date().toLocaleDateString(),
      product: matchedGodownPallets[0].model || "Solar PV Modules",
      cellType: matchedGodownPallets[0].cellType || "NON - DCR",
      orderQty: `${totalQty} Units`,
      dispatchedQty: totalQty,
      pallets: matchedGodownPallets,
      photos: []
    });
  }

  if (matched.length === 0) {
    window.showNotification({ title: "Search Results", message: `No records found matching "${rawQ}".`, type: "warning" });
    if (typeof window.resetDispatchDeleteView === "function") {
      window.resetDispatchDeleteView();
    }
    return;
  }

  if (typeof window.populateDispatchDeleteDropdownOptions === "function") {
    window.populateDispatchDeleteDropdownOptions(matched);
  }
  if (typeof window.renderDispatchDeleteCards === "function") {
    window.renderDispatchDeleteCards(matched);
  }
};

function executeDispatchDeleteSearch() {
  window.executeDispatchDeleteSearch();
}

window.renderDispatchDeleteCards = function(manifestList) {
  activeDeleteMatchedManifests = manifestList;
  const container = document.getElementById("dispatchDeleteCardsContainer");
  const emptyNotice = document.getElementById("dispatchDeleteEmptyNotice");
  const bulkBar = document.getElementById("dispDeleteBulkBar");

  if (emptyNotice) emptyNotice.style.display = "none";
  if (bulkBar) bulkBar.style.display = manifestList.length > 1 ? "flex" : "none";
  window.updateBulkSelectedBadge();

  if (!container) return;
  container.innerHTML = "";

  manifestList.forEach((m, mIdx) => {
    const card = document.createElement("div");
    card.className = "card";
    card.style.border = "1.5px solid #cbd5e1";
    card.style.borderRadius = "10px";
    card.style.padding = "18px";
    card.style.marginBottom = "24px";
    card.style.boxShadow = "0 3px 12px rgba(0,0,0,0.04)";

    let palletCheckboxesHtml = "";
    if (m.pallets && m.pallets.length > 0) {
      palletCheckboxesHtml = `
        <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-top: 14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <strong style="font-size:12px; text-transform:uppercase; color:#0f172a;">Select Individual Pallets to Remove / Restore to Godown:</strong>
            <button class="btn btn-danger" style="padding: 4px 10px; font-size: 11px;" onclick="window.submitSelectedPalletsDelete(${mIdx})">
              ✕ Delete Selected Pallets
            </button>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 10px;">
            ${m.pallets.map((p, pIdx) => `
              <label style="display: inline-flex; align-items: center; gap: 6px; background: #fff; border: 1px solid #cbd5e1; padding: 5px 10px; border-radius: 6px; font-size: 12px; cursor: pointer;">
                <input type="checkbox" class="chk-pallet-del-${mIdx}" value="${pIdx}" style="width: 14px; height: 14px;">
                <strong>${p.pallet}</strong> (${p.count || (p.serials || []).length} mods)
              </label>
            `).join("")}
          </div>
        </div>
      `;
    }

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1.5px solid var(--border); padding-bottom: 10px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <input type="checkbox" class="chk-manifest-del" value="${m.id}" onchange="window.updateBulkSelectedBadge()" style="width: 18px; height: 18px; cursor: pointer;">
          <div>
            <span style="font-size: 14px; font-weight: 800; color: #0284c7;">INVOICE: ${m.invoice}</span>
            <span style="font-size: 12px; color: var(--muted); margin-left: 12px;">Vehicle: <strong>${m.vehicle}</strong> | Customer: <strong>${m.customer}</strong> | Date: <strong>${m.date}</strong></span>
          </div>
        </div>
        <div>
          <button class="btn btn-danger" style="padding: 6px 14px; font-size: 11px; background: #dc2626; color: #fff;" onclick="window.submitSingleWholeDispatchDelete(${mIdx})">
            ⚠️ Cancel Entire Dispatch
          </button>
        </div>
      </div>

      <div style="overflow-x: auto;">
        <table class="excel-table" style="width: 100%; border-collapse: collapse; border: 1px solid #000;">
          <colgroup>
            <col style="width: 20%;">
            <col style="width: 20%;">
            <col style="width: 20%;">
            <col style="width: 20%;">
            <col style="width: 20%;">
          </colgroup>
          <tr>
            <td colspan="2" rowspan="6" class="cell-logo" style="padding: 6px; vertical-align: middle; background: #fff; border: 1px solid #000; text-align: center;">
              <img src="assets/demo-logo.svg" class="brand-logo-img" onerror="this.onerror=null; this.src='assets/demo-logo.svg';" style="max-height: 75px; max-width: 190px; object-fit: contain;">
            </td>
            <td colspan="3" style="text-align: center; font-weight: bold; color: #6b21a8; font-size: 13pt; padding: 4px; border: 1px solid #000;">
              DEMOSOLAR INDUSTRIES PRIVATE LIMITED
            </td>
          </tr>
          <tr>
            <td colspan="3" rowspan="3" style="text-align: center; padding: 3px; font-size: 9pt; line-height: 1.2; border: 1px solid #000;">
              <strong>Address:-</strong> Demo Industrial Park, Ahmedabad - 380001, Gujarat - India
            </td>
          </tr>
          <tr></tr>
          <tr></tr>
          <tr>
            <td colspan="3" style="text-align: center; padding: 3px; font-size: 9.5pt; border: 1px solid #000;">
              <strong>Contact No:</strong> +91 9000000004
            </td>
          </tr>
          <tr>
            <td colspan="3" style="text-align: center; padding: 3px; font-size: 9.5pt; border: 1px solid #000;">
              <strong>Email:</strong> support@example.test
            </td>
          </tr>
          <tr>
            <td style="background: #5b9bd5; font-weight: bold; padding: 4px 6px; border: 1px solid #000;">Transporter Name:</td>
            <td style="padding: 4px 6px; font-weight: bold; border: 1px solid #000;">${m.transporter || '-'}</td>
            <td style="background: #5b9bd5; font-weight: bold; padding: 4px 6px; border: 1px solid #000;">Challan no:</td>
            <td colspan="2" style="padding: 4px 6px; font-weight: bold; border: 1px solid #000;">${m.challanNo || '-'}</td>
          </tr>
          <tr>
            <td style="background: #5b9bd5; font-weight: bold; padding: 4px 6px; border: 1px solid #000;">Vehicle No:</td>
            <td style="padding: 4px 6px; font-weight: bold; border: 1px solid #000;">${m.vehicle || '-'}</td>
            <td style="background: #5b9bd5; font-weight: bold; padding: 4px 6px; border: 1px solid #000;">Date:</td>
            <td colspan="2" style="padding: 4px 6px; font-weight: bold; border: 1px solid #000;">${m.date || '-'}</td>
          </tr>
          <tr>
            <td style="background: #5b9bd5; font-weight: bold; padding: 4px 6px; border: 1px solid #000;">Driver No:</td>
            <td style="padding: 4px 6px; font-weight: bold; border: 1px solid #000;">${m.driverNo || '-'}</td>
            <td style="background: #5b9bd5; font-weight: bold; padding: 4px 6px; border: 1px solid #000;">Mode of Transport:</td>
            <td colspan="2" style="padding: 4px 6px; font-weight: bold; border: 1px solid #000;">${m.modeTransport || 'By Road'}</td>
          </tr>
          <tr>
            <td style="background: #5b9bd5; font-weight: bold; padding: 4px 6px; border: 1px solid #000;">Driver Name:</td>
            <td style="padding: 4px 6px; font-weight: bold; border: 1px solid #000;">${m.driverName || '-'}</td>
            <td style="background: #5b9bd5; font-weight: bold; padding: 4px 6px; border: 1px solid #000;">Delivery Order No:</td>
            <td colspan="2" style="padding: 4px 6px; font-weight: bold; border: 1px solid #000;">${m.deliveryOrderNo || '-'}</td>
          </tr>
          <tr>
            <td style="background: #5b9bd5; font-weight: bold; padding: 4px 6px; border: 1px solid #000;">LR No:</td>
            <td style="padding: 4px 6px; font-weight: bold; border: 1px solid #000;">${m.lrNo || '-'}</td>
            <td style="background: #5b9bd5; font-weight: bold; padding: 4px 6px; border: 1px solid #000;">Customer Name:</td>
            <td colspan="2" style="padding: 4px 6px; font-weight: bold; border: 1px solid #000; text-align: center;">${m.customer || '-'}</td>
          </tr>
          <tr>
            <td style="background: #5b9bd5; font-weight: bold; padding: 4px 6px; border: 1px solid #000;">Packing Type:</td>
            <td style="padding: 4px 6px; font-weight: bold; border: 1px solid #000;">${m.packingType || 'Box Packing'}</td>
            <td style="background: #5b9bd5; font-weight: bold; padding: 4px 6px; border: 1px solid #000;">Invoice No.:</td>
            <td colspan="2" style="padding: 4px 6px; font-weight: bold; border: 1px solid #000;">${m.invoice || '-'}</td>
          </tr>
          <tr style="background: #7ec8e3; font-weight: bold; text-align: center;">
            <td colspan="2" style="border: 1px solid #000; padding: 6px;">Product Detail</td>
            <td style="border: 1px solid #000; padding: 6px;">HSN Code</td>
            <td style="border: 1px solid #000; padding: 6px;">Order Qty:</td>
            <td style="border: 1px solid #000; padding: 6px;">Qty</td>
          </tr>
          <tr style="text-align: center; font-weight: bold; font-family: 'Aptos Narrow', Arial, sans-serif; font-size: 11pt;">
            <td colspan="2" style="border: 1px solid #000; padding: 6px;">${m.product || '-'}</td>
            <td style="border: 1px solid #000; padding: 6px;">85414300</td>
            <td style="border: 1px solid #000; padding: 6px;">${m.orderQty || '-'}</td>
            <td style="border: 1px solid #000; padding: 6px; color: #059669;">${m.dispatchedQty || (m.pallets ? m.pallets.reduce((s, p) => s + (p.count || 0), 0) : 0)}</td>
          </tr>
          <tbody>${buildDynamicPalletRows(m.pallets)}</tbody>
        </table>
      </div>
      ${palletCheckboxesHtml}
    `;
    container.appendChild(card);
  });
};

window.updateBulkSelectedBadge = function() {
  const checked = document.querySelectorAll(".chk-manifest-del:checked");
  const countSpan = document.getElementById("bulkSelectedCountText");
  if (countSpan) countSpan.textContent = `${checked.length} Manifest(s) Selected`;
};

window.submitSelectedPalletsDelete = async function(mIdx) {
  const manifest = activeDeleteMatchedManifests[mIdx];
  if (!manifest) return;

  const checkboxes = document.querySelectorAll(`.chk-pallet-del-${mIdx}:checked`);
  if (checkboxes.length === 0) {
    window.showNotification({ title: "Select Pallets", message: "Please check at least one pallet to remove.", type: "warning" });
    return;
  }

  const selectedIndices = Array.from(checkboxes).map(cb => parseInt(cb.value, 10)).sort((a, b) => b - a);
  const selectedPallets = selectedIndices.map(idx => manifest.pallets[idx]);
  const palletNames = selectedPallets.map(p => p.pallet).join(", ");

  const reason = await window.showPromptDialog({
    title: "Pallet Removal Reason",
    message: `Removing Pallet(s) [${palletNames}] from Invoice: ${manifest.invoice}.`,
    label: "Reason for Removal *",
    placeholder: "e.g. Loading Error, Damaged Box...",
    isDanger: true
  });
  if (!reason) return;

  const isAdmin = currentLoggedInUser && (currentLoggedInUser.role === "admin" || currentLoggedInUser.username.toUpperCase() === "IT");

  if (isAdmin) {
    const confirmed = await window.showConfirmDialog({
      title: "Admin Direct Action",
      message: `Remove ${selectedPallets.length} pallet(s) from invoice "${manifest.invoice}" and restore immediately to Warehouse?`,
      confirmText: "Restore to Godown",
      isDanger: true
    });
    if (confirmed) {
      selectedIndices.forEach(idx => {
        const removed = manifest.pallets.splice(idx, 1)[0];
        godownStock.push(removed);
      });
      manifest.dispatchedQty = manifest.pallets.reduce((s, p) => s + (p.count || 0), 0);
      const restored = await runStorageBatch(async () => {
        await saveStorage(KEY_STOCK, godownStock);
        await saveStorage(KEY_DISPATCH_ARCHIVE, dispatchArchive);
        logEvent("DISPATCH", "PALLETS_RESTORED_DIRECT", `Admin restored pallets [${palletNames}] to godown from ${manifest.invoice}`);
      });
      if (!restored) return;
      window.showNotification({ title: "Pallets Restored", message: `Pallet(s) [${palletNames}] restored to Central Godown!`, type: "success" });
      window.executeDispatchDeleteSearch();
      return;
    }
    return;
  }

  const req = {
    id: "REQ-" + Date.now(),
    type: "DELETE_DISPATCH_PALLETS_MULTI",
    targetId: `${manifest.invoice} > [${palletNames}]`,
    details: `Invoice: ${manifest.invoice}, Pallets: ${palletNames}`,
    payload: { manifestId: manifest.id, palletIndices: selectedIndices, pallets: selectedPallets },
    requestedBy: currentLoggedInUser ? currentLoggedInUser.username : "OPERATOR",
    requestedAt: new Date().toLocaleString(),
    reason: reason,
    status: "PENDING",
    reviewedBy: "-",
    reviewedAt: "-",
    adminRemark: "-"
  };

  requestsDb.unshift(req);
  await saveStorage(KEY_REQUESTS, requestsDb);
  logEvent("DISPATCH", "PALLET_DEL_REQUESTED", `Requested removal of pallets [${palletNames}] from invoice ${manifest.invoice}`);
  window.showNotification({ title: "Request Submitted", message: `Removal request for pallets [${palletNames}] submitted for approval.`, type: "warning" });
  window.resetDispatchDeleteView();
};

window.submitSingleWholeDispatchDelete = async function(mIdx) {
  const manifest = activeDeleteMatchedManifests[mIdx];
  if (!manifest) return;

  const reason = await window.showPromptDialog({
    title: "Cancel Shipment",
    message: `Cancel entire shipment for Invoice "${manifest.invoice}" (Vehicle: ${manifest.vehicle}).`,
    label: "Reason for Cancellation *",
    placeholder: "e.g. Order Cancelled by Customer...",
    isDanger: true
  });
  if (!reason) return;

  const isAdmin = currentLoggedInUser && (currentLoggedInUser.role === "admin" || currentLoggedInUser.username.toUpperCase() === "IT");

  if (isAdmin) {
    const confirmed = await window.showConfirmDialog({
      title: "Admin Direct Action",
      message: `Permanently cancel dispatch "${manifest.invoice}" and restore all ${manifest.pallets.length} pallets to Warehouse stock?`,
      confirmText: "Cancel & Restore All",
      isDanger: true
    });
    if (confirmed) {
      if (manifest.pallets && manifest.pallets.length > 0) {
        manifest.pallets.forEach(p => godownStock.push(p));
      }
      dispatchArchive = dispatchArchive.filter(m => m.id !== manifest.id);
      const cancelled = await runStorageBatch(async () => {
        await saveStorage(KEY_STOCK, godownStock);
        await saveStorage(KEY_DISPATCH_ARCHIVE, dispatchArchive);
        await reconcileAccountInvoiceDispatchStatus();
        await syncSalesOrderDispatchTotals();
        logEvent("DISPATCH", "DISPATCH_CANCELLED_DIRECT", `Admin canceled dispatch ${manifest.invoice}; all pallets restored to godown.`);
      });
      if (!cancelled) return;
      window.showNotification({ title: "Shipment Cancelled", message: `Dispatch ${manifest.invoice} canceled and all pallets restored to stock.`, type: "success" });
      window.resetDispatchDeleteView();
      refreshDispatchDashboard();
      refreshAdminDashboard();
      return;
    }
    return;
  }

  const req = {
    id: "REQ-" + Date.now(),
    type: "DELETE_DISPATCH_FULL",
    targetId: manifest.invoice,
    details: `Vehicle: ${manifest.vehicle}, Total Mods: ${manifest.dispatchedQty}, Pallets: ${manifest.pallets.length}`,
    payload: { manifestId: manifest.id },
    requestedBy: currentLoggedInUser ? currentLoggedInUser.username : "OPERATOR",
    requestedAt: new Date().toLocaleString(),
    reason: reason,
    status: "PENDING",
    reviewedBy: "-",
    reviewedAt: "-",
    adminRemark: "-"
  };

  requestsDb.unshift(req);
  await saveStorage(KEY_REQUESTS, requestsDb);
  logEvent("DISPATCH", "DISPATCH_FULL_DEL_REQUESTED", `Requested cancellation of whole dispatch: ${manifest.invoice}`);
  window.showNotification({ title: "Request Submitted", message: `Dispatch cancellation request for ${manifest.invoice} submitted to Admin.`, type: "warning" });
  window.resetDispatchDeleteView();
};

window.submitBulkDispatchFullDeleteRequest = async function() {
  const checked = document.querySelectorAll(".chk-manifest-del:checked");
  if (checked.length === 0) {
    window.showNotification({ title: "Selection Warning", message: "Please select at least one dispatch manifest.", type: "warning" });
    return;
  }

  const manifestIds = Array.from(checked).map(cb => cb.value);
  const targets = dispatchArchive.filter(m => manifestIds.includes(String(m.id)));
  const invoices = targets.map(m => m.invoice).join(", ");

  const reason = await window.showPromptDialog({
    title: "Bulk Shipment Cancellation",
    message: `Cancel ${targets.length} selected shipments (${invoices}).`,
    label: "Reason for Bulk Deletion *",
    placeholder: "e.g. Invoicing Correction...",
    isDanger: true
  });
  if (!reason) return;

  const isAdmin = currentLoggedInUser && (currentLoggedInUser.role === "admin" || currentLoggedInUser.username.toUpperCase() === "IT");

  if (isAdmin) {
    const confirmed = await window.showConfirmDialog({
      title: "Admin Bulk Action",
      message: `Cancel ${targets.length} shipments and restore ALL pallets to Warehouse stock?`,
      confirmText: "Execute Bulk Rollback",
      isDanger: true
    });
    if (confirmed) {
      targets.forEach(m => {
        if (m.pallets && m.pallets.length > 0) {
          m.pallets.forEach(p => godownStock.push(p));
        }
      });
      dispatchArchive = dispatchArchive.filter(m => !manifestIds.includes(String(m.id)));
      const cancelled = await runStorageBatch(async () => {
        await saveStorage(KEY_STOCK, godownStock);
        await saveStorage(KEY_DISPATCH_ARCHIVE, dispatchArchive);
        await reconcileAccountInvoiceDispatchStatus();
        await syncSalesOrderDispatchTotals();
        logEvent("DISPATCH", "BULK_DISPATCH_CANCELLED", `Admin canceled ${targets.length} shipments: ${invoices}`);
      });
      if (!cancelled) return;
      window.showNotification({ title: "Bulk Rollback Done", message: `${targets.length} manifests canceled. Pallets restored to Godown!`, type: "success" });
      window.resetDispatchDeleteView();
      refreshDispatchDashboard();
      refreshAdminDashboard();
      return;
    }
    return;
  }

  const req = {
    id: "REQ-" + Date.now(),
    type: "DELETE_DISPATCH_BULK",
    targetId: `${targets.length} Shipments: [${invoices}]`,
    details: `Total Invoices: ${invoices}`,
    payload: { manifestIds: manifestIds },
    requestedBy: currentLoggedInUser ? currentLoggedInUser.username : "OPERATOR",
    requestedAt: new Date().toLocaleString(),
    reason: reason,
    status: "PENDING",
    reviewedBy: "-",
    reviewedAt: "-",
    adminRemark: "-"
  };

  requestsDb.unshift(req);
  await saveStorage(KEY_REQUESTS, requestsDb);
  logEvent("DISPATCH", "BULK_DISPATCH_DEL_REQUESTED", `Requested bulk deletion of manifests: ${invoices}`);
  window.showNotification({ title: "Bulk Request Sent", message: `Bulk dispatch deletion request submitted to Administrator.`, type: "warning" });
  window.resetDispatchDeleteView();
};

// 3. TRACK & APPROVE REQUEST ENGINES (USER ISOLATED)
window.renderTrackRequestsTable = function() {
  const tbody = document.getElementById("trackRequestsBody");
  if (!tbody) return;

  const isAdmin = currentLoggedInUser && (currentLoggedInUser.role === "admin" || currentLoggedInUser.username.toUpperCase() === "IT");
  const currentUser = currentLoggedInUser ? currentLoggedInUser.username.toLowerCase() : "";

  const filteredRequests = isAdmin 
    ? (requestsDb || []) 
    : (requestsDb || []).filter(r => (r.requestedBy || "").toLowerCase() === currentUser);

  if (filteredRequests.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--muted); padding:20px;">No requests found ${isAdmin ? 'in the system' : 'submitted by you'}.</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredRequests.map(r => {
    let badgeColor = "background:#fef3c7; color:#b45309;";
    if (r.status === "APPROVED") badgeColor = "background:#dcfce7; color:#15803d;";
    else if (r.status === "REJECTED") badgeColor = "background:#fee2e2; color:#b91c1c;";

    return `
      <tr>
        <td><code>${r.id}</code></td>
        <td><strong>${r.type.replace(/_/g, ' ')}</strong></td>
        <td><strong>${r.targetId}</strong><br><small style="color:var(--muted);">${r.details || ''}</small></td>
        <td>@${r.requestedBy}</td>
        <td style="font-size:11px; white-space:nowrap;">${r.requestedAt}</td>
        <td>${r.reason}</td>
        <td><span style="font-size:11px; font-weight:800; padding:3px 8px; border-radius:4px; ${badgeColor}">${r.status}</span></td>
        <td>${r.adminRemark !== '-' ? `<em>${r.adminRemark}</em><br><small style="color:var(--muted);">By @${r.reviewedBy}</small>` : '-'}</td>
      </tr>
    `;
  }).join("");
};

function normalizedRequestDepartment(value) {
  const department = String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
  if (/ACCOUNT|FINANCE/.test(department)) return "ACCOUNTS";
  if (/SALES|MARKETING/.test(department)) return "SALES & MARKETING";
  if (/STORE|PPC/.test(department)) return "STORE & PPC";
  if (/PRODUCTION/.test(department)) return "PRODUCTION";
  if (/PACKING/.test(department)) return "PACKING";
  if (/DISPATCH|LOGISTIC/.test(department)) return "DISPATCH";
  if (/PURCHASE|PROCUREMENT/.test(department)) return "PURCHASE";
  if (/HUMAN RESOURCE|\bHR\b/.test(department)) return "HR";
  if (/INFORMATION TECHNOLOGY|IT DEPARTMENT|\bIT\b/.test(department)) return "IT";
  return department;
}

function approvalRequestDepartmentFromUser(request) {
  const requester = (usersDb || []).find(user => String(user.username || "").toLowerCase() === String(request?.requestedBy || "").toLowerCase());
  return normalizedRequestDepartment(request?.department || requester?.department || approvalRequestDepartment(request));
}

function canCurrentUserApproveRequest(request) {
  if (!currentLoggedInUser || String(request?.status || "").toUpperCase() !== "PENDING") return false;
  const isAdmin = String(currentLoggedInUser.role || "").toLowerCase() === "admin" || String(currentLoggedInUser.username || "").toUpperCase() === "IT";
  if (isAdmin) return true;
  if (currentLoggedInUser.rights?.requestsApprove !== true && currentLoggedInUser.rights?.requestRouteAssignee !== true) return false;
  if (String(request?.requestedBy || "").toLowerCase() === String(currentLoggedInUser.username || "").toLowerCase()) return false;
  if (Array.isArray(request?.assignedApproverUsernames)) return request.assignedApproverUsernames.some(username => String(username).toLowerCase() === String(currentLoggedInUser.username || "").toLowerCase());
  return approvalRequestDepartmentFromUser(request) === normalizedRequestDepartment(currentLoggedInUser.department || currentLoggedInUser.role);
}
window.canCurrentUserApproveRequest = canCurrentUserApproveRequest;

function approvalRequestAssignmentLabel(request) {
  const names = Array.isArray(request?.assignedApproverNames) ? request.assignedApproverNames.filter(Boolean) : [];
  const usernames = Array.isArray(request?.assignedApproverUsernames) ? request.assignedApproverUsernames.filter(Boolean) : [];
  if (names.length) return names.map((name,index) => `${name}${usernames[index] ? ` (@${usernames[index]})` : ""}`).join(", ");
  return request?.routingRule || "IT superuser fallback";
}

window.renderApproveRequestsTable = function() {
  const tbody = document.getElementById("approveRequestsBody");
  if (!tbody) return;

  const pending = (requestsDb || []).filter(canCurrentUserApproveRequest);
  if (pending.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--muted); padding:20px;">No pending authorization requests. Everything is clear!</td></tr>`;
    return;
  }

  tbody.innerHTML = pending.map(r => `
    <tr>
      <td><code>${r.id}</code></td>
      <td><span style="font-weight:700; color:var(--primary); font-size:11px;">${r.type.replace(/_/g, ' ')}</span><br><small>${approvalRequestDepartmentFromUser(r)} · Assigned to ${approvalRequestAssignmentLabel(r)}</small></td>
      <td><strong>${r.targetId}</strong><br><small style="color:var(--muted);">${r.details}</small></td>
      <td><strong>@${r.requestedBy}</strong></td>
      <td style="font-size:11px; white-space:nowrap;">${r.requestedAt}</td>
      <td>${r.reason}</td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="btn btn-success" style="padding: 4px 10px; font-size: 11px; margin-right: 6px;" onclick="window.handleAdminRequestDecision('${r.id}', true)">✓ Approve</button>
        <button class="btn btn-danger" style="padding: 4px 10px; font-size: 11px;" onclick="window.handleAdminRequestDecision('${r.id}', false)">✕ Decline</button>
      </td>
    </tr>
  `).join("");
};

function approvalRequestDepartment(request) {
  const type = String(request?.type || "").toUpperCase();
  if (type.includes("ACCOUNT") || type.includes("INVOICE") || type.includes("RECEIPT")) return "ACCOUNTS";
  if (type.includes("PRODUCTION")) return "PRODUCTION";
  if (type.includes("DISPATCH") || type.includes("VEHICLE") || type.includes("ROUTE")) return "DISPATCH";
  if (type.includes("PALLET") || type.includes("PACKING")) return "PACKING";
  if (type.includes("SERIAL") || type.includes("PO")) return "STORE & PPC";
  if (type.includes("SALES") || type.includes("CUSTOMER")) return "SALES";
  if (type.includes("PURCHASE") || type.includes("VENDOR")) return "PURCHASE";
  if (type.includes("USER") || type.includes("RIGHT") || type.includes("DEPARTMENT") || type.includes("DESIGNATION")) return "HR / IT";
  return "ERP OPERATION";
}

window.renderHrDepartmentApprovals = function() {
  const tbody = document.getElementById("hrDepartmentApprovalsBody");
  if (!tbody) return;
  const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));
  const pending = (requestsDb || []).filter(canCurrentUserApproveRequest);
  const count = document.getElementById("tourDepartmentApprovalCount");
  if (count) count.textContent = pending.length.toLocaleString("en-IN");
  if (!pending.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px;">No department-level permission requests are waiting for approval.</td></tr>';
    window.updateHrUnifiedApprovalBadge?.();
    return;
  }
  tbody.innerHTML = pending.map(request => `
    <tr>
      <td><code>${escape(request.id)}</code></td>
      <td><strong>${escape(approvalRequestDepartmentFromUser(request))}</strong><br><small>${escape(String(request.type || "REQUEST").replace(/_/g," "))} · Assigned to ${escape(approvalRequestAssignmentLabel(request))}</small></td>
      <td><strong>${escape(request.targetId || "-")}</strong><br><small style="color:var(--muted);">${escape(request.details || "")}</small></td>
      <td><strong>@${escape(request.requestedBy || "-")}</strong></td>
      <td style="font-size:11px;white-space:nowrap;">${escape(request.requestedAt || "-")}</td>
      <td>${escape(request.reason || "-")}</td>
      <td style="text-align:right;white-space:nowrap;"><button class="btn btn-success" style="padding:4px 10px;font-size:11px;margin-right:6px;" onclick="window.handleAdminRequestDecision('${escape(request.id)}',true)">✓ Approve</button><button class="btn btn-danger" style="padding:4px 10px;font-size:11px;" onclick="window.handleAdminRequestDecision('${escape(request.id)}',false)">✕ Decline</button></td>
    </tr>`).join("");
  window.updateHrUnifiedApprovalBadge?.();
};

window.handleAdminRequestDecision = async function(reqId, isApproved) {
  const req = requestsDb.find(r => r.id === reqId);
if (!req) return;

const isAdmin = currentLoggedInUser && (currentLoggedInUser.role === "admin" || currentLoggedInUser.username.toUpperCase() === "IT");
if (!canCurrentUserApproveRequest(req)) {
  window.showNotification({
    title: "Request Not Assigned",
    message: "This request is assigned to another department approver.",
    type: "danger"
  });
  return;
}

  const adminName = currentLoggedInUser ? currentLoggedInUser.username : "APPROVER";
  
  const remark = await window.showPromptDialog({
    title: isApproved ? "Approve Request" : "Decline Request",
    message: `${isApproved ? 'Authorizing' : 'Declining'} request ${req.id} for "${req.targetId}".`,
    label: isApproved ? "Approval Note (Optional)" : "Reason for Declining *",
    defaultValue: isApproved ? "Approved by assigned department approver" : "Declined by assigned department approver",
    confirmText: isApproved ? "Approve Request" : "Decline Request",
    isDanger: !isApproved
  });

  if (remark === null) return;
  if (isApproved) {
    try {
      await ensureApprovalRequestModules(req);
    } catch (error) {
      window.showNotification({ title: "Approval Data Unavailable", message: error?.message || "The linked department records could not be loaded.", type: "danger" });
      return;
    }
  }
  beginStorageBatch(req.id);
  let approvalBatchCommitted = false;
  try {

  if (!isApproved) {
    req.status = "REJECTED";
    req.reviewedBy = adminName;
    req.reviewedAt = new Date().toLocaleString();
    req.adminRemark = remark || "Declined by assigned department approver";
    await saveStorage(KEY_REQUESTS, requestsDb);
    logEvent("SYSTEM", "REQUEST_REJECTED", `Assigned approver @${adminName} declined request ${req.id} (${req.type})`);
    if (!await commitStorageBatch()) return;
    approvalBatchCommitted = true;
    window.showNotification({ title: "Request Declined", message: `Request ${req.id} has been marked as REJECTED.`, type: "danger" });
    window.renderApproveRequestsTable();
    window.renderHrDepartmentApprovals?.();
    window.renderAccountReceiptTable?.();
    return;
  }

if (req.type === "DELETE_SERIALS_MULTI") {
  const poNumber = String(req.payload?.poNumber || "").trim();
  const serials = [...new Set(
    (req.payload?.serials || [])
      .map(serial => normalizePackingId(serial))
      .filter(Boolean)
  )];

  const currentPoSerials = getPpcSerialsForPo(poNumber)
    .map(serial => normalizePackingId(serial));

  const missingSerials = serials.filter(serial =>
    !currentPoSerials.includes(serial)
  );

  const packedSerials = serials.filter(serial => findSerialUsage(serial));

  if (missingSerials.length || packedSerials.length) {
    window.showNotification({
      title: "Approval Cannot Be Applied",
      message: missingSerials.length
        ? `${missingSerials.length} serial(s) no longer exist under PO ${poNumber}. Decline this request.`
        : `${packedSerials.length} serial(s) are now packed or dispatched. Decline this request.`,
      type: "danger"
    });
    return;
  }

  const serialSet = new Set(serials);

  storeSerialsDb.forEach(batch => {
    if (String(batch.poNumber || "").trim().toUpperCase() === poNumber.toUpperCase()) {
      batch.serials = (batch.serials || []).filter(serial =>
        !serialSet.has(normalizePackingId(serial))
      );
      batch.count = batch.serials.length;
    }
  });

  storeSerialsDb = storeSerialsDb.filter(batch =>
    (batch.serials || []).length > 0
  );

  await saveStorage(KEY_STORE_SERIALS, storeSerialsDb);

  logEvent(
    "STORE",
    "MULTI_SERIAL_DELETE_APPROVED",
    `Admin deleted ${serials.length} PPC serial(s) from PO ${poNumber}.`
  );

  renderStoreSerialTable();
  populateStoreSerialPoFilters();
}
else

  // EXECUTE ACTUAL BACKEND MUTATION WITH AUTOMATIC ROLLBACK
  if (req.type === "DELETE_SERIAL") {
    const { serial } = req.payload;
    for (let batch of storeSerialsDb) {
      const idx = batch.serials.findIndex(s => s.toUpperCase() === serial.toUpperCase());
      if (idx !== -1) {
        batch.serials.splice(idx, 1);
        batch.count = batch.serials.length;
        break;
      }
    }
    storeSerialsDb = storeSerialsDb.filter(b => b.serials.length > 0);
    await saveStorage(KEY_STORE_SERIALS, storeSerialsDb);
  } 
  else if (req.type === "EDIT_PALLET") {
  const oldPallet = normalizePackingId(req.payload?.oldPallet);
  const newPallet = normalizePackingId(req.payload?.newPallet);
  const newGrade = getEditablePalletGrade(req.payload?.newGrade);

  const pallet = (godownStock || []).find(item =>
    normalizePackingId(item.pallet) === oldPallet
  );

  if (!pallet) {
    window.showNotification({
      title: "Pallet Not Found",
      message: "The pallet no longer exists in warehouse stock. The request remains pending.",
      type: "danger"
    });
    return;
  }

  const duplicateNumber = [
    ...(godownStock || []),
    ...((dispatchArchive || []).flatMap(manifest => manifest.pallets || []))
  ].some(item =>
    normalizePackingId(item.pallet) === newPallet &&
    normalizePackingId(item.pallet) !== oldPallet
  );

  if (duplicateNumber) {
    window.showNotification({
      title: "Duplicate Pallet Number",
      message: `${newPallet} is now already in use. Decline this request or use a different pallet number.`,
      type: "danger"
    });
    return;
  }

  if (newGrade === "A GRADE" && !canPalletBeAGrade(pallet)) {
    window.showNotification({
      title: "A Grade Validation Failed",
      message: "Cannot approve: an A-grade pallet must have one PO and one binning only.",
      type: "danger"
    });
    return;
  }

  const previousPallet = pallet.pallet;
  const previousGrade = getEditablePalletGrade(pallet.grade);

  pallet.pallet = newPallet;
  pallet.grade = newGrade;
  pallet.combined = `${newPallet}${newGrade}`;
  pallet.lastEditedAt = new Date().toLocaleString();
  pallet.lastEditedBy = adminName;

  let bookingChanged = false;
  (stockBookings || []).forEach(booking => {
    if (normalizePackingId(booking.pallet) === oldPallet) {
      booking.pallet = newPallet;
      bookingChanged = true;
    }
  });

  await saveStorage(KEY_STOCK, godownStock);
  if (bookingChanged) await saveStorage(KEY_STOCK_BOOKINGS, stockBookings);

  logEvent("PACKING", "PALLET_EDIT_APPROVED",
    `Admin changed pallet ${previousPallet} to ${newPallet}; grade ${previousGrade} to ${newGrade}.`);

  window.populateEditPalletDropdown();
  window.populateDeletePalletDropdown();
  refreshAdminDashboard();
}
  else if (req.type === "DELETE_PALLETS_MULTI") {
  const pallets = [...new Set(
    (req.payload?.pallets || [])
      .map(pallet => normalizePackingId(pallet))
      .filter(Boolean)
  )];

  const availablePallets = (godownStock || []).filter(pallet =>
    pallets.includes(normalizePackingId(pallet.pallet))
  );

  if (availablePallets.length !== pallets.length) {
    window.showNotification({
      title: "Approval Cannot Be Applied",
      message: "One or more pallets are no longer in warehouse stock. Decline this request and create a new one.",
      type: "danger"
    });
    return;
  }

  const palletSet = new Set(
    availablePallets.map(pallet => normalizePackingId(pallet.pallet))
  );

  godownStock = godownStock.filter(pallet =>
    !palletSet.has(normalizePackingId(pallet.pallet))
  );

  (stockBookings || []).forEach(booking => {
    if (booking.status === "BOOKED" &&
        palletSet.has(normalizePackingId(booking.pallet))) {
      booking.status = "CANCELLED";
      booking.cancelledAt = new Date().toLocaleString();
      booking.cancelledBy = adminName;
      booking.cancelReason = "Pallet deleted by approved multiple-pallet request";
    }
  });

  await saveStorage(KEY_STOCK, godownStock);
  await saveStorage(KEY_STOCK_BOOKINGS, stockBookings);

  logEvent(
    "PACKING",
    "MULTI_PALLET_DELETE_APPROVED",
    `Admin deleted ${availablePallets.length} warehouse pallet(s): ${availablePallets.map(p => p.pallet).join(", ")}.`
  );

  window.populateDeletePalletDropdown();
  window.populateEditPalletDropdown();
  refreshAdminDashboard();
}
  else if (req.type === "DELETE_PALLET") {
    godownStock = godownStock.filter(p => p.pallet !== req.payload.pallet);
    await saveStorage(KEY_STOCK, godownStock);
  } 
  else if (req.type === "DELETE_DISPATCH_PALLETS_MULTI") {
    const manifest = dispatchArchive.find(m => m.id === req.payload.manifestId);
    if (manifest && req.payload.pallets) {
      req.payload.pallets.forEach(pObj => {
        const pIdx = manifest.pallets.findIndex(p => p.pallet === pObj.pallet);
        if (pIdx !== -1) manifest.pallets.splice(pIdx, 1);
        godownStock.push(pObj);
      });
      manifest.dispatchedQty = manifest.pallets.reduce((sum, p) => sum + (p.count || 0), 0);
      await saveStorage(KEY_STOCK, godownStock);
      await saveStorage(KEY_DISPATCH_ARCHIVE, dispatchArchive);
      await syncSalesOrderDispatchTotals();
    }
  } 
  else if (req.type === "DELETE_DISPATCH_FULL") {
    const manifest = dispatchArchive.find(m => m.id === req.payload.manifestId);
    if (manifest) {
      if (manifest.pallets && manifest.pallets.length > 0) {
        manifest.pallets.forEach(p => godownStock.push(p));
      }
      dispatchArchive = dispatchArchive.filter(m => m.id !== manifest.id);
      await saveStorage(KEY_STOCK, godownStock);
      await saveStorage(KEY_DISPATCH_ARCHIVE, dispatchArchive);
      await reconcileAccountInvoiceDispatchStatus();
      await syncSalesOrderDispatchTotals();
    }
  }
  else if (req.type === "DELETE_DISPATCH_BULK") {
    const ids = req.payload.manifestIds || [];
    const targets = dispatchArchive.filter(m => ids.includes(String(m.id)));
    targets.forEach(m => {
      if (m.pallets && m.pallets.length > 0) {
        m.pallets.forEach(p => godownStock.push(p));
      }
    });
    dispatchArchive = dispatchArchive.filter(m => !ids.includes(String(m.id)));
    await saveStorage(KEY_STOCK, godownStock);
    await saveStorage(KEY_DISPATCH_ARCHIVE, dispatchArchive);
    await reconcileAccountInvoiceDispatchStatus();
    await syncSalesOrderDispatchTotals();
  }
  else if (req.type === "ALLOCATE_PO_TO_CO") {
    const salesOrderId = String(req.payload?.salesOrderId || "");
    const order = (salesOrders || []).find(item => String(item.id) === salesOrderId);
    const po = (poDatabase || []).find(item => coAllocationKey(item.poNumber) === coAllocationKey(req.payload?.poNumber));
    const qty = salesNumber(req.payload?.qty);
    if (!order || !po || !Number.isInteger(qty) || qty <= 0) {
      window.showNotification({ title: "Approval Cannot Be Applied", message: "The CO, PPC PO, or requested module quantity is no longer valid. Decline this request.", type: "danger" });
      return;
    }
    if (!isPoCompatibleWithSalesOrder(po, order)) {
      window.showNotification({ title: "Approval Cannot Be Applied", message: "The PPC PO no longer matches the CO model, wattage, or DCR/Non-DCR requirement. Decline this request.", type: "danger" });
      return;
    }
    const poAvailable = getPoAvailableToAllocate(po, false);
    const coAvailable = getCoAvailableToAllocate(order, false);
    if (qty > poAvailable || qty > coAvailable) {
      window.showNotification({ title: "Approval Cannot Be Applied", message: `Only ${Math.min(poAvailable, coAvailable).toLocaleString("en-IN")} module(s) remain available for this allocation. Decline this request and create a corrected one.`, type: "danger" });
      return;
    }
    coAllocations.unshift({
      id: "ALLOC-" + Date.now(), salesOrderId: order.id, coNumber: order.coNumber, poNumber: po.poNumber,
      qty, model: po.product, watt: salesNumber(po.watt), dcrNdcr: getPoCellType(po), status: "RESERVED",
      createdAt: req.requestedAt, createdBy: req.requestedBy, approvedAt: new Date().toLocaleString(), approvedBy: adminName,
      sourceRequestId: req.id
    });
    await saveStorage(KEY_CO_ALLOCATIONS, coAllocations);
    logEvent("SALES", "PO_TO_CO_ALLOCATION_APPROVED", `Admin reserved ${qty} module(s) from PO ${po.poNumber} for CO ${order.coNumber}.`);
    window.populateCoAllocationCoSelect?.();
    window.renderCoAllocationTable?.();
  }
  else if (req.type === "EDIT_ACCOUNT_RECEIPT") {
    const applied = await window.applyApprovedAccountReceiptEdit?.(req, adminName);
    if (!applied) {
      window.showNotification({ title:"Approval Cannot Be Applied", message:"The transaction changed after this request was submitted, or its proposed values are no longer valid. Decline the request and submit a fresh correction.", type:"danger" });
      return;
    }
    logEvent("ACCOUNTS", "ACCOUNT_TRANSACTION_EDIT_APPROVED", `Admin approved changes to receipt transaction ${req.payload?.receiptId}.`);
    renderAccountReceiptTable();
    window.renderAccountsDashboard?.();
  }
  else if (req.type === "DELETE_ACCOUNT_RECEIPT") {
    const receiptId = String(req.payload?.receiptId || "");
    const receiptIndex = (accountReceiptsDb || []).findIndex(receipt => String(receipt.id) === receiptId);
    if (receiptIndex < 0) {
      window.showNotification({ title:"Approval Cannot Be Applied", message:"This account transaction no longer exists. Decline the request.", type:"danger" });
      return;
    }
    const [deletedReceipt] = accountReceiptsDb.splice(receiptIndex, 1);
    if (await saveStorage(KEY_ACCOUNT_RECEIPTS, accountReceiptsDb) === false) {
      accountReceiptsDb.splice(receiptIndex, 0, deletedReceipt);
      return;
    }
    logEvent("ACCOUNTS", "ACCOUNT_TRANSACTION_DELETE_APPROVED", `Admin deleted ${deletedReceipt.transactionType || "receipt"} ${deletedReceipt.id} for ${deletedReceipt.partyName} after approval.`);
    renderAccountReceiptTable();
    window.renderAccountsDashboard?.();
  }
  else if (req.type === "DELETE_ACCOUNT_INVOICE") {
    const invoiceId = String(req.payload?.accountInvoiceId || "");
    const invoiceIndex = (accountInvoices || []).findIndex(invoice => String(invoice.id) === invoiceId);
    const existingInvoice = invoiceIndex >= 0 ? accountInvoices[invoiceIndex] : null;
    if (!existingInvoice) {
      window.showNotification({ title:"Approval Cannot Be Applied", message:"This invoice no longer exists. Decline this request.", type:"danger" });
      return;
    }
    if (getInvoiceDispatchLink(existingInvoice)) {
      window.showNotification({ title:"Dispatched Invoice Protected", message:`Invoice ${existingInvoice.invoiceNumber} is dispatched or linked to dispatch history. It cannot be deleted under any condition. Decline this request.`, type:"danger" });
      return;
    }

    const deletedInvoiceNumber = existingInvoice.invoiceNumber;
    accountInvoices.splice(invoiceIndex, 1);
    let vehicleBookingChanged = false;
    (vehicleBookingsDb || []).forEach(booking => {
      if (String(booking.status || "ACTIVE").toUpperCase() === "CANCELLED"
          || vehicleBookingKey(booking.invoiceNumber) !== vehicleBookingKey(deletedInvoiceNumber)) return;
      booking.status = "CANCELLED";
      booking.cancelledAt = new Date().toISOString();
      booking.cancelledBy = adminName;
      booking.cancelReason = `Invoice ${deletedInvoiceNumber} deleted through approved request ${req.id}`;
      vehicleBookingChanged = true;
    });

    await saveStorage(KEY_ACCOUNT_INVOICES, accountInvoices);
    if (vehicleBookingChanged) {
      await saveStorage(KEY_VEHICLE_BOOKINGS, vehicleBookingsDb);
    }
    logEvent("ACCOUNTS", "INVOICE_DELETE_APPROVED", `Admin deleted undispatched invoice ${deletedInvoiceNumber}. The invoice number is now available for reuse.`);
    renderAccountInvoiceTable();
    populateEditInvoiceSelect();
    populateDeleteInvoiceSelect();
    populateDispatchInvoiceDropdown();
    window.populateVehicleBookingCoDropdown?.();
    window.populateVehicleSettlementDropdown?.();
    window.renderVehicleBookingTable?.();
  }
  else if (req.type === "EDIT_ACCOUNT_INVOICE") {
    const invoiceId = String(req.payload?.accountInvoiceId || "");
    const invoiceIndex = (accountInvoices || []).findIndex(invoice => String(invoice.id) === invoiceId);
    const existingInvoice = invoiceIndex >= 0 ? accountInvoices[invoiceIndex] : null;
    const proposed = req.payload?.proposedInvoice;
    if (!existingInvoice || !proposed) {
      window.showNotification({ title:"Approval Cannot Be Applied", message:"The invoice or proposed correction no longer exists. Decline this request.", type:"danger" });
      return;
    }
    const duplicate = (accountInvoices || []).some((invoice,index) => index !== invoiceIndex && accountInvoiceKey(invoice.invoiceNumber) === accountInvoiceKey(proposed.invoiceNumber));
    if (duplicate) {
      window.showNotification({ title:"Approval Cannot Be Applied", message:`Invoice Number ${proposed.invoiceNumber} is now used by another invoice.`, type:"danger" });
      return;
    }
    const linkedOrder = getSalesOrderByCo(proposed.coNumber);
    if (!linkedOrder || String(linkedOrder.id) !== String(proposed.salesOrderId)) {
      window.showNotification({ title:"Approval Cannot Be Applied", message:"The proposed C/O no longer matches an active Sales Order.", type:"danger" });
      return;
    }
    const dispatched = String(existingInvoice.status || "").toUpperCase() === "DISPATCHED";
    if (dispatched && (accountInvoiceKey(proposed.invoiceNumber) !== accountInvoiceKey(existingInvoice.invoiceNumber) || salesCoKey(proposed.coNumber) !== salesCoKey(existingInvoice.coNumber) || salesNumber(proposed.quantity) !== salesNumber(existingInvoice.quantity))) {
      window.showNotification({ title:"Approval Cannot Be Applied", message:"Invoice Number, C/O Number and quantity are protected after dispatch.", type:"danger" });
      return;
    }
    if (!dispatched) {
      const otherOpenQty = (accountInvoices || []).filter((invoice,index) => index !== invoiceIndex && salesCoKey(invoice.coNumber) === salesCoKey(proposed.coNumber) && String(invoice.status || "").toUpperCase() !== "DISPATCHED").reduce((sum,invoice) => sum + salesNumber(invoice.quantity),0);
      const available = Math.max(0,salesNumber(linkedOrder.totalOrderQty)-getSalesOrderDispatchStats(linkedOrder.coNumber).qty-otherOpenQty);
      if (salesNumber(proposed.quantity) <= 0 || salesNumber(proposed.quantity) > available) {
        window.showNotification({ title:"Approval Cannot Be Applied", message:`Only ${available.toLocaleString("en-IN")} module(s) remain available against C/O ${linkedOrder.coNumber}.`, type:"danger" });
        return;
      }
    }
    const proposedLines = Array.isArray(proposed.lineItems) ? proposed.lineItems : [];
    let financialsReconcile = true;
    if (proposedLines.length) {
      let lineQty = 0, lineWatts = 0, lineTaxable = 0, lineTax = 0, lineTotal = 0;
      proposedLines.forEach(line => {
        const expectedPrice = salesNumber(line.wattPerModule) * salesNumber(line.ratePerWatt);
        const expectedWatts = salesNumber(line.wattPerModule) * salesNumber(line.quantity);
        const expectedTaxable = expectedPrice * salesNumber(line.quantity);
        const expectedTax = expectedTaxable * salesNumber(line.taxRate) / 100;
        if (salesNumber(line.quantity) <= 0 || Math.abs(salesNumber(line.pricePerModule)-expectedPrice)>0.02 || Math.abs(salesNumber(line.totalWatts)-expectedWatts)>0.02 || Math.abs(salesNumber(line.taxableValue)-expectedTaxable)>0.02 || Math.abs(salesNumber(line.taxAmount)-expectedTax)>0.02 || Math.abs(salesNumber(line.invoiceValue)-(expectedTaxable+expectedTax))>0.02) financialsReconcile = false;
        lineQty += salesNumber(line.quantity); lineWatts += expectedWatts; lineTaxable += expectedTaxable; lineTax += expectedTax; lineTotal += expectedTaxable + expectedTax;
      });
      const roundedTotal = Math.round(lineTotal);
      if (Math.abs(salesNumber(proposed.quantity)-lineQty)>0.02 || Math.abs(salesNumber(proposed.totalWatts)-lineWatts)>0.02 || Math.abs(salesNumber(proposed.totalValue)-lineTaxable)>0.02 || Math.abs(salesNumber(proposed.taxAmount)-lineTax)>0.02 || Math.abs(salesNumber(proposed.invoiceValue)-roundedTotal)>0.02 || Math.abs(salesNumber(proposed.roundingOff)-(roundedTotal-lineTotal))>0.02) financialsReconcile = false;
    } else {
      const expectedPrice = salesNumber(proposed.wattPerModule) * salesNumber(proposed.ratePerWatt);
      const expectedTaxable = expectedPrice * salesNumber(proposed.quantity);
      const expectedTax = expectedTaxable * salesNumber(proposed.taxRate) / 100;
      const rawTotal = expectedTaxable + expectedTax;
      const roundedTotal = Math.round(rawTotal);
      financialsReconcile = Math.abs(salesNumber(proposed.pricePerModule)-expectedPrice)<=0.02 && Math.abs(salesNumber(proposed.totalValue)-expectedTaxable)<=0.02 && Math.abs(salesNumber(proposed.taxAmount)-expectedTax)<=0.02 && Math.abs(salesNumber(proposed.invoiceValue)-roundedTotal)<=0.02 && Math.abs(salesNumber(proposed.roundingOff)-(roundedTotal-rawTotal))<=0.02;
    }
    if (!financialsReconcile) {
      window.showNotification({ title:"Approval Cannot Be Applied", message:"The proposed invoice financial calculation does not reconcile.", type:"danger" });
      return;
    }
    const approvedInvoice = {...existingInvoice,...proposed,id:existingInvoice.id,status:existingInvoice.status,dispatchId:existingInvoice.dispatchId||"",dispatchedAt:existingInvoice.dispatchedAt||"",dispatchedBy:existingInvoice.dispatchedBy||"",createdAt:existingInvoice.createdAt,createdBy:existingInvoice.createdBy,deliveryOrderNo:linkedOrder.coNumber,updatedAt:new Date().toISOString(),updatedBy:adminName};
    accountInvoices[invoiceIndex] = approvedInvoice;
    await saveStorage(KEY_ACCOUNT_INVOICES,accountInvoices);
    let manifestUpdated = false;
    (dispatchArchive || []).forEach(manifest => {
      if (String(manifest.accountInvoiceId || "") !== String(existingInvoice.id) && accountInvoiceKey(manifest.invoice) !== accountInvoiceKey(existingInvoice.invoiceNumber)) return;
      manifest.transporter = approvedInvoice.transporterName;manifest.vehicle = approvedInvoice.vehicleNumber;manifest.modeTransport = approvedInvoice.modeTransport;manifest.deliveryOrderNo = approvedInvoice.deliveryOrderNo;manifest.lrNo = approvedInvoice.lrNo;manifest.challanNo = approvedInvoice.challanNo;manifest.customer = approvedInvoice.customerName;manifest.product = approvedInvoice.modelNo;manifest.cellType = approvedInvoice.dcrNdcr;manifest.date = approvedInvoice.invoiceDate;manifest.packingType = approvedInvoice.packingType;manifest.hsnCode = approvedInvoice.hsnCode;manifestUpdated = true;
    });
    if (manifestUpdated) await saveStorage(KEY_DISPATCH_ARCHIVE,dispatchArchive);
    logEvent("ACCOUNTS","INVOICE_EDIT_APPROVED",`Admin approved corrections for invoice ${existingInvoice.invoiceNumber}.`);
    renderAccountInvoiceTable();populateDispatchInvoiceDropdown();
  }
  else if (req.type === "EDIT_SALES_ORDER") {
    const salesOrderId = String(req.payload?.salesOrderId || "");
    const orderIndex = (salesOrders || []).findIndex(order => String(order.id) === salesOrderId);
    const existingOrder = orderIndex >= 0 ? salesOrders[orderIndex] : null;
    const proposedOrder = req.payload?.proposedOrder;
    if (!existingOrder || !proposedOrder) {
      window.showNotification({ title: "Approval Cannot Be Applied", message: "The Sales Order or its proposed changes are no longer available. Decline this request.", type: "danger" });
      return;
    }
    const dispatchStats = getSalesOrderDispatchStats(existingOrder.coNumber);
    const dispatchedQty = Math.max(salesNumber(existingOrder.dispatchQty), salesNumber(dispatchStats.qty));
    const reservedQty = getApprovedAllocationQty({ coNumber: existingOrder.coNumber });
    if (salesNumber(proposedOrder.totalOrderQty) < dispatchedQty + reservedQty) {
      window.showNotification({ title: "Approval Cannot Be Applied", message: `The proposed quantity is lower than the dispatched plus reserved quantity of ${(dispatchedQty + reservedQty).toLocaleString("en-IN")}. Release stock through an approved request first.`, type: "danger" });
      return;
    }
    salesOrders[orderIndex] = {
      ...existingOrder,
      ...proposedOrder,
      id: existingOrder.id,
      serialNo: existingOrder.serialNo,
      coNumber: existingOrder.coNumber,
      dispatchQty: dispatchedQty,
      pendingQty: Math.max(0, salesNumber(proposedOrder.totalOrderQty) - dispatchedQty),
      actualDispatchDate: dispatchStats.actualDispatchDate || existingOrder.actualDispatchDate || "",
      performanceCertificate: existingOrder.performanceCertificate || "",
      status: existingOrder.status || "PENDING",
      closedAt: existingOrder.closedAt || "",
      createdAt: existingOrder.createdAt,
      createdBy: existingOrder.createdBy,
      updatedAt: new Date().toLocaleString(),
      updatedBy: adminName
    };
    await saveStorage(KEY_SALES_ORDERS, salesOrders);
    await syncSalesOrderDispatchTotals();
    logEvent("SALES", "SALES_ORDER_EDIT_APPROVED", `Admin approved edit for Sales Order CO ${existingOrder.coNumber}.`);
    populateDispatchCoDropdown();
    renderSalesOrdersTable();
    renderSalesOrderDashboard();
  }
  else if (req.type === "DELETE_SALES_ORDER") {
    const salesOrderId = String(req.payload?.salesOrderId || "");
    const existingOrder = (salesOrders || []).find(order => String(order.id) === salesOrderId);
    if (!existingOrder) {
      window.showNotification({ title: "Approval Cannot Be Applied", message: "This Sales Order no longer exists. Decline the request.", type: "danger" });
      return;
    }
    const dispatchedQty = Math.max(salesNumber(existingOrder.dispatchQty), salesNumber(getSalesOrderDispatchStats(existingOrder.coNumber).qty));
    if (dispatchedQty > 0) {
      window.showNotification({ title: "Approval Cannot Be Applied", message: `CO ${existingOrder.coNumber} now has dispatched quantity and cannot be deleted. Decline this request.`, type: "danger" });
      return;
    }
    const reservedQty = getApprovedAllocationQty({ coNumber: existingOrder.coNumber });
    if (reservedQty > 0) {
      window.showNotification({ title: "Approval Cannot Be Applied", message: `CO ${existingOrder.coNumber} has ${reservedQty.toLocaleString("en-IN")} reserved module(s). Release them through an approved allocation request before deleting this CO.`, type: "danger" });
      return;
    }
    const coKey = salesCoKey(existingOrder.coNumber);
    const linkedRecords = [
      ["Accounts invoice", (accountInvoices || []).some(item => salesCoKey(item.coNumber) === coKey)],
      ["receipt", (accountReceiptsDb || []).some(item => salesCoKey(item.coNumber) === coKey)],
      ["stock booking", (stockBookings || []).some(item => salesCoKey(item.coNumber) === coKey || String(item.salesOrderId || "") === String(existingOrder.id))],
      ["vehicle booking", (vehicleBookingsDb || []).some(item => salesCoKey(item.coNumber) === coKey || String(item.salesOrderId || "") === String(existingOrder.id))]
    ].filter(([, exists]) => exists).map(([label]) => label);
    if (linkedRecords.length) {
      window.showNotification({ title: "Approval Cannot Be Applied", message: `CO ${existingOrder.coNumber} now has linked ${linkedRecords.join(", ")} record(s) and cannot be deleted from the database. Decline this request.`, type: "danger" });
      return;
    }
    coAllocations = (coAllocations || []).filter(allocation => salesCoKey(allocation.coNumber) !== coKey && String(allocation.salesOrderId || "") !== String(existingOrder.id));
    salesOrders = salesOrders.filter(order => String(order.id) !== salesOrderId);
    renumberSalesOrderSerials();
    await saveStorage(KEY_SALES_ORDERS, salesOrders);
    await saveStorage(KEY_CO_ALLOCATIONS, coAllocations);
    salesCoRegistry = (salesCoRegistry || []).filter(co => salesCoKey(co) !== salesCoKey(existingOrder.coNumber));
    await saveStorage(KEY_SALES_CO_REGISTRY, salesCoRegistry);
    logEvent("SALES", "SALES_ORDER_DELETE_APPROVED", `Admin deleted Sales Order CO ${existingOrder.coNumber}; CO Number released for reuse.`);
    populateDispatchCoDropdown();
    renderSalesOrdersTable();
    renderSalesOrderDashboard();
  }
  else if (req.type === "EDIT_PRODUCTION_SHEET") {
    const sheetId = String(req.payload?.productionSheetId || "");
    const poNumber = productionText(req.payload?.poNumber);
    const index = (productionSheetDb || []).findIndex(record => String(record.id) === sheetId && productionPoKey(record.poNumber) === productionPoKey(poNumber));
    const existing = index >= 0 ? productionSheetDb[index] : null;
    const proposed = req.payload?.proposedRecord;
    if (!existing || !proposed) {
      window.showNotification({ title: "Approval Cannot Be Applied", message: "The Production Sheet or proposed changes are no longer available. Decline this request.", type: "danger" });
      return;
    }
    const duplicateSr = (productionSheetDb || []).some((record, recordIndex) => recordIndex !== index && productionText(record.serialNo) === productionText(proposed.serialNo));
    if (duplicateSr) {
      window.showNotification({ title: "Approval Cannot Be Applied", message: `SR. No. ${proposed.serialNo} is now used by another Production Sheet. Decline this request.`, type: "danger" });
      return;
    }
    productionSheetDb[index] = { ...existing, ...proposed, id: existing.id, poNumber: existing.poNumber, createdAt: existing.createdAt, createdBy: existing.createdBy, detailsEnteredAt: existing.detailsEnteredAt || new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: adminName };
    await saveStorage(KEY_PRODUCTION_SHEET, productionSheetDb);
    logEvent("PRODUCTION", "PRODUCTION_SHEET_EDIT_APPROVED", `Admin approved edit for Production Sheet PO ${poNumber}.`);
    window.renderProductionSheet?.();
    window.populateProductionEditSheetSelect?.();
  }
  else if (req.type === "DELETE_PRODUCTION_SHEET") {
    const sheetId = String(req.payload?.productionSheetId || "");
    const poNumber = productionText(req.payload?.poNumber);
    const existing = (productionSheetDb || []).find(record => String(record.id) === sheetId && productionPoKey(record.poNumber) === productionPoKey(poNumber));
    if (!existing) {
      window.showNotification({ title: "Approval Cannot Be Applied", message: "This Production Sheet no longer exists. Decline this request.", type: "danger" });
      return;
    }
    if (getProductionDailyRows(poNumber).length) {
      window.showNotification({ title: "Approval Cannot Be Applied", message: "Daily Production history now exists for this PO. Keep the sheet for traceability and decline this request.", type: "danger" });
      return;
    }
    productionSheetDb = productionSheetDb.filter(record => String(record.id) !== sheetId);
    await saveStorage(KEY_PRODUCTION_SHEET, productionSheetDb);
    logEvent("PRODUCTION", "PRODUCTION_SHEET_DELETE_APPROVED", `Admin deleted Production Sheet PO ${poNumber}. PPC and other source records were retained.`);
    window.renderProductionSheet?.();
    window.populateProductionDeleteSheetSelect?.();
  }
  
  else if (req.type === "DELETE_PO") {
  const poNumber = String(req.payload?.poNumber || "").trim();
  const deleteMode = req.payload?.deleteMode || "PO_ONLY";

  const affectedPallets = (godownStock || []).filter(pallet =>
    palletMatchesPo(pallet, poNumber)
  );

  poDatabase = poDatabase.filter(po =>
    String(po.poNumber || "").trim().toUpperCase() !== poNumber.toUpperCase()
  );

  if (deleteMode === "PO_AND_WAREHOUSE_PALLETS") {
    const removedPallets = new Set(
      affectedPallets.map(pallet => normalizePackingId(pallet.pallet))
    );

    godownStock = godownStock.filter(pallet =>
      !removedPallets.has(normalizePackingId(pallet.pallet))
    );

    (stockBookings || []).forEach(booking => {
      if (booking.status === "BOOKED" &&
          removedPallets.has(normalizePackingId(booking.pallet))) {
        booking.status = "CANCELLED";
        booking.cancelledAt = new Date().toLocaleString();
        booking.cancelledBy = adminName;
        booking.cancelReason = `PO ${poNumber} deleted by approved request`;
      }
    });

    await saveStorage(KEY_STOCK, godownStock);
    await saveStorage(KEY_STOCK_BOOKINGS, stockBookings);
  }

  await saveStorage(KEY_POS, poDatabase);

  logEvent(
    "STORE",
    "PO_DELETE_APPROVED",
    deleteMode === "PO_AND_WAREHOUSE_PALLETS"
      ? `PO #${poNumber} deleted with ${affectedPallets.length} warehouse pallet(s). Dispatch history retained.`
      : `PO #${poNumber} deleted only. Warehouse pallets and serial records retained.`
  );

  populatePoDropdowns();
  populateEditPoDropdown();
  populateStoreSerialPoFilters();
  populateDeletePoDropdown();
  window.populateEditPalletDropdown();
  window.populateDeletePalletDropdown();
  refreshAdminDashboard();
}

  req.status = "APPROVED";
  req.reviewedBy = adminName;
  req.reviewedAt = new Date().toLocaleString();
  req.adminRemark = remark || "Approved and executed by assigned department approver";
  await saveStorage(KEY_REQUESTS, requestsDb);

  logEvent("SYSTEM", "REQUEST_APPROVED", `Assigned approver @${adminName} approved and executed request ${req.id} (${req.type})`);
  if (!await commitStorageBatch()) return;
  approvalBatchCommitted = true;
  window.showNotification({ title: "Request Executed", message: `Request ${req.id} successfully APPROVED and executed!`, type: "success" });
  window.renderApproveRequestsTable();
  window.renderHrDepartmentApprovals?.();
  window.renderAccountInvoiceTable?.();
  window.populateDispatchCoDropdown?.();
  window.populateDispatchInvoiceDropdown?.();
  } finally {
    if (!approvalBatchCommitted) discardStorageBatch();
  }
};

// ================= STORE & PPC: SINGLE TEXTBOX CUM DROPDOWN DELETE PO =================
let currentSelectedDeletePo = null;

window.populateDeletePoDropdown = function() {
  const datalist = document.getElementById("deletePoDataList");
  const input = document.getElementById("singleDeletePoInput");
  if (!datalist) return;

  if (input) input.value = "";
  currentSelectedDeletePo = null;
  window.renderPoFullDetails(null);

  if (!poDatabase || poDatabase.length === 0) {
    datalist.innerHTML = "";
    return;
  }

  datalist.innerHTML = poDatabase.map(p => `
    <option value="${p.poNumber}">${p.poNumber} — ${p.product} (${p.qty} units)</option>
  `).join("");
};

window.handleSingleDeletePoInput = function(rawVal) {
  const val = (rawVal || "").trim().toUpperCase();
  if (!val) {
    currentSelectedDeletePo = null;
    window.renderPoFullDetails(null);
    return;
  }

  const cleanInput = val.split("—")[0].trim().toUpperCase();
  const matchedPo = poDatabase.find(p => p.poNumber.toUpperCase() === cleanInput);

  if (matchedPo) {
    currentSelectedDeletePo = matchedPo;
    window.renderPoFullDetails(matchedPo);
  } else {
    currentSelectedDeletePo = null;
    window.renderPoFullDetails(null);
  }
};

window.renderPoFullDetails = function(po) {
  const box = document.getElementById("deletePoDetailsBox");
  const empty = document.getElementById("deletePoEmptyMsg");

  if (!po) {
    if (box) box.style.display = "none";
    if (empty) empty.style.display = "block";
    return;
  }

  const prodMatch = (productsDb || []).find(pr => pr.name.toUpperCase() === (po.product || "").toUpperCase());
  const cellType = po.cellType || (prodMatch ? prodMatch.cellType : "NON - DCR") || "NON - DCR";

  const serialCount = (storeSerialsDb || [])
    .filter(b => (b.poNumber || "").toUpperCase() === po.poNumber.toUpperCase())
    .reduce((sum, b) => sum + (b.serials || []).length, 0);

  const createdDate = po.createdDate || po.date || (po.timestamp ? po.timestamp.split(" ")[0] : "Logged in System");

  document.getElementById("delPoDisplayNum").textContent = po.poNumber;
  document.getElementById("delPoDisplayCellTypeBadge").textContent = cellType;
  document.getElementById("delPoFieldNum").textContent = po.poNumber;
  document.getElementById("delPoFieldQty").textContent = `${po.qty} Units`;
  document.getElementById("delPoFieldDate").textContent = createdDate;
  document.getElementById("delPoFieldModel").textContent = po.product || "-";
  document.getElementById("delPoFieldWatt").textContent = po.watt || "-";
  document.getElementById("delPoFieldCellType").textContent = cellType;
  document.getElementById("delPoFieldSerials").textContent = `${serialCount} Serials Uploaded`;

  if (box) box.style.display = "block";
  if (empty) empty.style.display = "none";
};

  function palletMatchesPo(pallet, poNumber) {
  const expectedPo = String(poNumber || "").trim().toUpperCase();

  if (String(pallet.po || "").trim().toUpperCase() === expectedPo) return true;

  return (pallet.fullRows || []).some(row =>
    String(row.po || "").trim().toUpperCase() === expectedPo
  );
}

window.executeDeletePoWorkflow = async function() {
  if (!currentSelectedDeletePo) {
    window.showNotification({
      title: "Selection Error",
      message: "Please select a valid Production Order first.",
      type: "warning"
    });
    return;
  }

  const po = currentSelectedDeletePo;
  const deleteMode =
    document.querySelector('input[name="deletePoMode"]:checked')?.value ||
    "PO_ONLY";

  const matchingWarehousePallets = (godownStock || []).filter(pallet =>
    palletMatchesPo(pallet, po.poNumber)
  );

  const reason = await window.showPromptDialog({
    title: "Request PO Deletion",
    message: deleteMode === "PO_AND_WAREHOUSE_PALLETS"
      ? `Request deletion of PO #${po.poNumber} and ${matchingWarehousePallets.length} warehouse pallet(s)? Dispatch history will not be changed.`
      : `Request deletion of PO #${po.poNumber} only? Warehouse pallets and serial records will remain untouched.`,
    label: "Reason for Deletion *",
    placeholder: "Example: duplicate PO, cancelled order, incorrect entry...",
    confirmText: "Send for Admin Approval",
    isDanger: true
  });

  if (!reason) return;

  const request = {
    id: "REQ-" + Date.now(),
    type: "DELETE_PO",
    targetId: po.poNumber,
    details: deleteMode === "PO_AND_WAREHOUSE_PALLETS"
      ? `Delete PO with ${matchingWarehousePallets.length} warehouse pallet(s). Model: ${po.product}, Qty: ${po.qty}`
      : `Delete PO only; warehouse pallets and serials remain. Model: ${po.product}, Qty: ${po.qty}`,
    payload: {
      poNumber: po.poNumber,
      deleteMode: deleteMode
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

  logEvent("STORE", "PO_DELETE_REQUESTED",
    `Requested ${deleteMode} for PO #${po.poNumber}.`);

  window.showNotification({
    title: "Request Submitted",
    message: `PO #${po.poNumber} deletion request is waiting for Administrator approval.`,
    type: "warning"
  });

  window.populateDeletePoDropdown();
};

// ================= PACKING: CLOSE PO VALIDATION CONTROLLERS =================
window.populateClosePoDropdown = function() {
  const sel = document.getElementById("closePoSelect");
  if (!sel) return;

  const openPos = (poDatabase || []).filter(p => p.status !== "CLOSED");

  if (openPos.length === 0) {
    sel.innerHTML = `<option value="">-- No Open POs Found --</option>`;
    window.onSelectPoToClose();
    return;
  }

  sel.innerHTML = `<option value="">-- Select PO to Audit & Close --</option>` + openPos.map(p => `
    <option value="${p.poNumber}">${p.poNumber} (${p.product} - ${p.qty} units)</option>
  `).join("");
  window.onSelectPoToClose();
};

window.onSelectPoToClose = function() {
  const poNum = document.getElementById("closePoSelect").value;
  const po = poDatabase.find(p => p.poNumber === poNum);
  const box = document.getElementById("closePoInspectionBox");
  const empty = document.getElementById("closePoEmptyMsg");
  const alertBox = document.getElementById("closePoStatusAlert");
  const btnClose = document.getElementById("btnClosePoAction");

  if (!po) {
    if (box) box.style.display = "none";
    if (empty) empty.style.display = "block";
    return;
  }

  const targetQty = Number(po.qty) || 0;

  const ppcBatches = storeSerialsDb.filter(b => b.poNumber.toUpperCase() === po.poNumber.toUpperCase());
  const ppcSerialsSet = new Set();
  ppcBatches.forEach(b => (b.serials || []).forEach(s => ppcSerialsSet.add(s.toUpperCase())));
  const totalPpcSerials = ppcSerialsSet.size;

  const packedSerialsSet = new Set();
  let countA = 0;
  let countB = 0;
  let countR = 0;

  // Helper to robustly tally grades regardless of spacing or naming format
  const tallyGrade = (palletItem) => {
    const rawGrade = (palletItem.grade || "A GRADE").trim().toUpperCase();
    const cnt = palletItem.count || (palletItem.serials ? palletItem.serials.length : (palletItem.fullRows ? palletItem.fullRows.length : 0));
    
    // Check exact word matches or starting characters, avoiding general substring inclusion of 'R'
    if (rawGrade.includes("B") || rawGrade === "B") {
      countB += cnt;
    } else if (rawGrade === "R GRADE" || rawGrade === "R" || rawGrade.startsWith("R")) {
      countR += cnt;
    } else {
      countA += cnt; // Catches "A GRADE" and defaults
    }
  };

  // 1. Calculate from active Godown stock
  (godownStock || []).forEach(p => {
    if ((p.po || "").toUpperCase() === po.poNumber.toUpperCase()) {
      const serials = p.serials || (p.fullRows || []).map(r => (typeof r === 'object' ? r.serial : r));
      (serials || []).forEach(s => packedSerialsSet.add(String(s).toUpperCase()));
      tallyGrade(p);
    }
  });

  // 2. Calculate from already Dispatched stock
  (dispatchArchive || []).forEach(m => {
    (m.pallets || []).forEach(p => {
      if ((p.po || m.po || "").toUpperCase() === po.poNumber.toUpperCase()) {
        const serials = p.serials || (p.fullRows || []).map(r => (typeof r === 'object' ? r.serial : r));
        (serials || []).forEach(s => packedSerialsSet.add(String(s).toUpperCase()));
        tallyGrade(p);
      }
    });
  });

  const totalPacked = packedSerialsSet.size;

  let missingSerials = [];
  ppcSerialsSet.forEach(s => {
    if (!packedSerialsSet.has(s)) missingSerials.push(s);
  });

  // Populate Metric Cards
  document.getElementById("closePoTargetQty").textContent = `${targetQty} Units`;
  document.getElementById("closePoPpcSerials").innerHTML = `
  <span style="color:#059669;">A: ${countA}</span>
  <span style="color:#64748b;"> | </span>
  <span style="color:#ca8a04;">B: ${countB}</span>
  <span style="color:#64748b;"> | </span>
  <span style="color:#dc2626;">R: ${countR}</span>
`;
  document.getElementById("closePoPackedQty").textContent = `${totalPacked} Units`;

  const isQtyMatched = totalPacked >= targetQty;
  const isAllPpcSerialsPacked = totalPpcSerials > 0 && missingSerials.length === 0;

  if (isQtyMatched && isAllPpcSerialsPacked) {
    alertBox.style.background = "#ecfdf5";
    alertBox.style.border = "1.5px solid #a7f3d0";
    alertBox.style.color = "#065f46";
    alertBox.innerHTML = `<strong>✓ Perfect Match Verified:</strong> All ${totalPacked} modules are fully packed and 100% of Store &amp; PPC serial numbers are accounted for. This PO is eligible to be closed.`;
    btnClose.disabled = false;
    btnClose.className = "btn btn-success";
    btnClose.style.background = "#059669";
    btnClose.style.color = "#ffffff";
  } else {
    alertBox.style.background = "#fef2f2";
    alertBox.style.border = "1.5px solid #fecaca";
    alertBox.style.color = "#991b1b";

    let reasons = [];
    if (!isQtyMatched) reasons.push(`Packed quantity (${totalPacked}) is less than Target Quantity (${targetQty}).`);
    if (totalPpcSerials === 0) reasons.push(`No serials were uploaded by Store & PPC for this PO.`);
    else if (missingSerials.length > 0) reasons.push(`${missingSerials.length} PPC registered serials are not yet packed.`);

    alertBox.innerHTML = `<strong>🔒 Closure Blocked:</strong><br>• ` + reasons.join("<br>• ");
    btnClose.disabled = true;
    btnClose.className = "btn btn-secondary";
    btnClose.style.background = "#e2e8f0";
    btnClose.style.color = "#94a3b8";
  }

  box.style.display = "block";
  empty.style.display = "none";
};

window.executeClosePo = async function() {
  const poNum = document.getElementById("closePoSelect").value;
  const po = poDatabase.find(p => p.poNumber === poNum);
  if (!po) return;

  const confirmed = await window.showConfirmDialog({
    title: "Finalize Closure",
    message: `Close Production Order #${po.poNumber}? Once closed, operators will not be able to scan additional modules against this PO.`,
    confirmText: "Close PO Now"
  });

  if (confirmed) {
    po.status = "CLOSED";
    po.closedAt = new Date().toLocaleString();
    po.closedBy = currentLoggedInUser ? currentLoggedInUser.username : "OPERATOR";

    await saveStorage(KEY_POS, poDatabase);
    logEvent("PACKING", "PO_CLOSED", `Production Order #${po.poNumber} closed and verified.`);

    window.showNotification({
      title: "PO Closed",
      message: `Production Order #${po.poNumber} has been successfully verified and CLOSED.`,
      type: "success"
    });

    populateClosePoDropdown();
    populatePoDropdowns();
  }
};

// =========================================================================
// PACKING LIST: PHOTO UPLOAD HANDLERS
// =========================================================================
let stagedBase64Photos = [];
let uploadedServerPhotoPaths = [];

// Step 1: Handle Selecting Single or Multiple Photos
window.handleDispatchPhotoSelect = function(e) {
  const files = Array.from(e.target.files || []);
  const grid = document.getElementById("dispatchPhotoPreviewGrid");
  const countBadge = document.getElementById("photoUploadCountBadge");
  const statusNotice = document.getElementById("photoUploadStatusNotice");

  stagedBase64Photos = [];
  uploadedServerPhotoPaths = [];
  if (grid) grid.innerHTML = "";
  if (statusNotice) statusNotice.style.display = "none";

  if (files.length === 0) {
    if (grid) grid.style.display = "none";
    if (countBadge) countBadge.textContent = "0 photos chosen";
    return;
  }

  if (countBadge) countBadge.textContent = `${files.length} photo(s) selected`;

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = function(evt) {
      const base64 = evt.target.result;
      stagedBase64Photos.push(base64);

      if (grid) {
        grid.style.display = "grid";
        const img = document.createElement("img");
        img.src = base64;
        img.className = "photo-thumb";
        img.style.border = "2px solid #cbd5e1";
        grid.appendChild(img);
      }
    };
    reader.readAsDataURL(file);
  });
};

// Step 2: Explicit "Upload Photos" Action
window.uploadSelectedPhotosNow = async function() {
  const invoice = (document.getElementById("dtInvoice")?.value || "").trim().toUpperCase();
  const statusNotice = document.getElementById("photoUploadStatusNotice");
  const uploadBtn = document.getElementById("btnTriggerPhotoUpload");

  if (!invoice) {
    window.showNotification({
      title: "Invoice Number Required",
      message: "Please enter the Invoice No first so the server knows which folder to create.",
      type: "warning"
    });
    document.getElementById("dtInvoice")?.focus();
    return;
  }

  if (stagedBase64Photos.length === 0) {
    window.showNotification({
      title: "No Photos Selected",
      message: "Please choose at least one photo using the file picker before clicking upload.",
      type: "warning"
    });
    return;
  }

  if (uploadBtn) {
    uploadBtn.disabled = true;
    uploadBtn.textContent = "⏳ Uploading...";
  }

  try {
    const res = await erpFetchWithTimeout("backend/api.php?action=upload_photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoice: invoice,
        images: stagedBase64Photos
      })
    }, 120000);

    const data = await res.json();

    if (data && data.status === "SUCCESS" && Array.isArray(data.saved)) {
      uploadedServerPhotoPaths = data.saved;
      currentUploadedRawPhotos = data.saved;

      if (statusNotice) {
        statusNotice.style.display = "block";
        statusNotice.style.color = "#059669";
        statusNotice.textContent = `✓ Successfully saved ${data.saved.length} photo(s) inside photos/${invoice}/`;
      }

      window.showNotification({
        title: "Photos Uploaded",
        message: `Saved ${data.saved.length} photo(s) into photos/${invoice}/`,
        type: "success"
      });

      // Visually flag preview thumbs as uploaded
      const thumbs = document.querySelectorAll("#dispatchPhotoPreviewGrid img");
      thumbs.forEach(t => t.style.borderColor = "#10b981");
    } else {
      throw new Error(data.message || "Upload failed");
    }
  } catch (err) {
    console.error("Photo upload error:", err);
    if (statusNotice) {
      statusNotice.style.display = "block";
      statusNotice.style.color = "#dc2626";
      statusNotice.textContent = "✕ Failed to upload photos. Check server permissions.";
    }
    window.showNotification({
      title: "Upload Failed",
      message: "Could not upload images to server. Ensure photos/ folder exists.",
      type: "danger"
    });
  } finally {
    if (uploadBtn) {
      uploadBtn.disabled = false;
      uploadBtn.textContent = "⬆️ Upload Photos";
    }
  }
};

