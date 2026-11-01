/* =========================================================================
   COMPLETE PACKING LIST CONTROLLERS, LOGO HELPER, EXCEL & PDF EXPORTERS
   ========================================================================= */

function getDemoSolarLogoDataUrl() {
  const existingImg = document.querySelector(".brand-logo-img") || document.querySelector("img[src*='DEMOSOLAR_LOGO']");
  if (existingImg && existingImg.complete && existingImg.naturalWidth > 0) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = existingImg.naturalWidth;
      canvas.height = existingImg.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(existingImg, 0, 0);
      return canvas.toDataURL("image/png");
    } catch (e) {
      return existingImg.src;
    }
  }
  return "assets/demo-logo.svg";
}

window.openViewPackingListView = function(btnEl) {
  if (typeof switchView === "function") {
    switchView('dispatchViewList', btnEl, 'VIEW PACKING LIST');
  } else {
    document.querySelectorAll(".view-panel").forEach(v => v.classList.remove("active"));
    document.querySelectorAll(".sub-item").forEach(s => s.classList.remove("active"));
    const el = document.getElementById("view-dispatchViewList");
    if (el) el.classList.add("active");
    if (btnEl) btnEl.classList.add("active");
    const title = document.getElementById("screenTitleDisplay");
    if (title) title.textContent = "VIEW PACKING LIST";
  }
  resetViewPackingListState();
};

window.onViewPackingSearchFieldChange = function() {
  const field = document.getElementById("viewPackingSearchField")?.value || "any";
  const label = document.getElementById("viewPackingSearchLabel");
  const input = document.getElementById("searchPalletInput");

  const labels = {
    any: "Search Packing Lists — Any Detail",
    pallet: "Search Packing Lists — Pallet Number",
    serial: "Search Packing Lists — Serial Number",
    date: "Search Packing Lists — Date Packed / Dispatched",
    po: "Search Packing Lists — PO Number",
    co: "Search Packing Lists — CO Number (PO Reservation)",
    grade_a: "Search Packing Lists — A Grade",
    grade_b: "Search Packing Lists — B Grade",
    grade_r: "Search Packing Lists — R Grade",
    customer_name: "Search Packing Lists — Customer Name",
    watt: "Search Packing Lists — Wattage",
    dcr: "Search Packing Lists — DCR Stock",
    non_dcr: "Search Packing Lists — NON-DCR Stock",
    model: "Search Packing Lists — Model Number",
    cell_type: "Search Packing Lists — Cell Type",
    quantity: "Search Packing Lists — Quantity",
    booked: "Search Packing Lists — Booked Stock Only",
    customer: "Search Packing Lists — Booked Customer Name"
  };

  if (label) label.textContent = labels[field] || labels.any;

  if (input) {
    input.placeholder = ["dcr", "non_dcr", "booked", "grade_a", "grade_b", "grade_r"].includes(field)
      ? "Optional: type additional search text..."
      : "Enter search value... ⏎";
  }
};

window.resetViewPackingListState = function() {
  activeMultiSearchedManifests = [];
  const searchInput = document.getElementById("searchPalletInput");
  const searchField = document.getElementById("viewPackingSearchField");
if (searchField) searchField.value = "any";
window.onViewPackingSearchFieldChange();
  if (searchInput) searchInput.value = "";

  const emptyNotice = document.getElementById("viewPackingListEmpty");
  if (emptyNotice) {
    emptyNotice.style.display = "block";
    emptyNotice.innerHTML = "Enter a Serial Number, Pallet Number, or PO Number above to view complete packing lists.";
  }

  const btnDownload = document.getElementById("btnDownloadHistoricalList");
  if (btnDownload) btnDownload.disabled = true;

  const btnPdf = document.getElementById("btnDownloadHistoricalPdf");
  if (btnPdf) btnPdf.disabled = true;

  const container = document.getElementById("multiPackingListDisplayContainer");
  if (container) container.innerHTML = "";
};

window.executeUniversalPackingSearch = function() {
  const searchInput = document.getElementById("searchPalletInput");
  const rawQuery = (searchInput?.value || "").trim();
  const query = rawQuery.toLowerCase();
  const cleanQuery = rawQuery.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const searchField = document.getElementById("viewPackingSearchField")?.value || "any";

  const allowsBlankSearch = ["dcr", "non_dcr", "booked", "grade_a", "grade_b", "grade_r"].includes(searchField);

  if (!rawQuery && !allowsBlankSearch) {
    window.showNotification({
      title: "Input Required",
      message: "Enter a value to search with the selected search type.",
      type: "warning"
    });
    return;
  }

  const cleanValue = value =>
    String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  const textMatch = value =>
    !query || String(value || "").toLowerCase().includes(query);

  const identifierMatch = value => {
    const cleaned = cleanValue(value);
    return !cleanQuery || cleaned.includes(cleanQuery) || cleanQuery.includes(cleaned);
  };

  function palletMatchesSearch(pallet, booking = null, manifest = null) {
    const cellType = getWarehousePalletCellType(pallet);
    const serials = pallet.serials || (pallet.fullRows || []).map(row => row.serial || "");
    const fullRows = pallet.fullRows || [];

    const serialData = [
      ...serials,
      ...fullRows.flatMap(row => [row.serial || "", row.barcode || ""])
    ].join(" ");

    const poData = [
      pallet.po || "",
      ...fullRows.map(row => row.po || ""),
      manifest?.po || ""
    ].join(" ");

    const wattData = [
      pallet.watt || "",
      ...fullRows.map(row => row.watt || "")
    ].join(" ");

    const bookingData = `${booking?.customer || ""} ${booking?.remarks || ""}`;
    const reservedCos = getWarehousePalletReservedCoNumbers(pallet);
    const coNumbers = [...new Set([...(reservedCos || []), manifest?.coNumber || ""].map(value => String(value || "").trim()).filter(Boolean))];
    const customerNames = [...new Set([
      booking?.customer || "",
      manifest?.customer || "",
      ...coNumbers.map(co => getSalesOrderByCo(co)?.customerName || "")
    ].map(value => String(value || "").trim()).filter(Boolean))];
    const coData = coNumbers.join(" ");
    const customerData = customerNames.join(" ");

    const allData = `
      ${pallet.pallet || ""}
      ${serialData}
      ${poData}
      ${pallet.model || ""}
      ${wattData}
      ${cellType}
      ${pallet.grade || ""}
      ${pallet.binning || ""}
      ${pallet.count || (pallet.serials || []).length || 0}
      ${pallet.date || ""}
      ${manifest?.date || ""}
      ${manifest?.customer || ""}
      ${manifest?.vehicle || ""}
      ${bookingData}
      ${coData}
      ${customerData}
    `;

    if (searchField === "pallet") return identifierMatch(pallet.pallet);
    if (searchField === "serial") return identifierMatch(serialData);
    if (searchField === "po") return identifierMatch(poData);
    if (searchField === "co") return textMatch(coData);
    if (searchField === "customer_name") return textMatch(customerData);
    if (searchField === "date") return textMatch(`${pallet.date || ""} ${manifest?.date || ""}`);
    if (searchField === "watt") return textMatch(wattData);
    if (searchField === "model") return textMatch(pallet.model);
    if (searchField === "cell_type") return textMatch(cellType);
    if (searchField === "quantity") return textMatch(pallet.count || (pallet.serials || []).length || 0);

    if (searchField === "grade_a") return String(pallet.grade || "A GRADE").trim().toUpperCase() === "A GRADE" && (!query || textMatch(allData));
    if (searchField === "grade_b") return String(pallet.grade || "").trim().toUpperCase() === "B GRADE" && (!query || textMatch(allData));
    if (searchField === "grade_r") return String(pallet.grade || "").trim().toUpperCase() === "R GRADE" && (!query || textMatch(allData));

    if (searchField === "dcr") {
      return cellType.trim().toUpperCase() === "DCR" &&
        (!query || textMatch(allData));
    }

    if (searchField === "non_dcr") {
      return cellType.trim().toUpperCase() !== "DCR" &&
        (!query || textMatch(allData));
    }

    if (searchField === "booked") {
      return Boolean(booking) && (!query || textMatch(bookingData));
    }

    if (searchField === "customer") {
      return Boolean(booking) && textMatch(bookingData);
    }

    return textMatch(allData);
  }

  const matchedManifests = [];

  const matchedGodownPallets = (godownStock || []).filter(pallet =>
    palletMatchesSearch(pallet, getActiveStockBooking(pallet.pallet))
  );

  if (matchedGodownPallets.length) {
    const totalQty = matchedGodownPallets.reduce(
      (total, pallet) => total + (pallet.count || (pallet.serials || []).length || 0),
      0
    );

    const godownCos = [...new Set(matchedGodownPallets.flatMap(pallet => getWarehousePalletReservedCoNumbers(pallet)))];
    const godownCustomers = [...new Set(godownCos.map(co => getSalesOrderByCo(co)?.customerName || "").filter(Boolean))];
    matchedManifests.push({
      id: "GODOWN_" + Date.now(),
      invoice: "IN-GODOWN (SEALED STOCK)",
      challanNo: "GODOWN-INVENTORY",
      vehicle: "Warehouse Floor",
      transporter: "Internal Plant Stock",
      coNumber: godownCos.join(", "),
      customer: godownCustomers.join(", ") || "Central Warehouse Stock",
      date: typeof getFormattedToday === "function"
        ? getFormattedToday()
        : new Date().toLocaleDateString(),
      product: matchedGodownPallets[0].model || "Solar PV Modules",
      cellType: matchedGodownPallets[0].cellType || "NON - DCR",
      orderQty: `${totalQty} Units`,
      dispatchedQty: totalQty,
      pallets: matchedGodownPallets,
      photos: []
    });
  }

  // Booked Stock and Booked Customer apply only to live warehouse stock.
  if (!["booked", "customer"].includes(searchField)) {
    (dispatchArchive || []).forEach(manifest => {
      const matchingPallets = (manifest.pallets || []).filter(pallet =>
        palletMatchesSearch(pallet, null, manifest)
      );

      if (matchingPallets.length) {
        matchedManifests.push({
          ...manifest,
          pallets: matchingPallets,
          dispatchedQty: matchingPallets.reduce(
            (total, pallet) => total + (pallet.count || (pallet.serials || []).length || 0),
            0
          )
        });
      }
    });
  }

  if (!matchedManifests.length) {
    window.showNotification({
      title: "No Records Found",
      message: "No warehouse stock or dispatch packing list matches this search.",
      type: "warning"
    });

    window.resetViewPackingListState();
    return;
  }

  renderMultiPackingLists(matchedManifests);
};

function renderMultiPackingLists(manifestList) {
  activeMultiSearchedManifests = manifestList;
  const container = document.getElementById("multiPackingListDisplayContainer");
  const emptyNotice = document.getElementById("viewPackingListEmpty");
  const btnDownload = document.getElementById("btnDownloadHistoricalList");
  const btnPdf = document.getElementById("btnDownloadHistoricalPdf");

  if (emptyNotice) emptyNotice.style.display = "none";
  if (btnDownload) btnDownload.disabled = false;
  if (btnPdf) btnPdf.disabled = false;
  if (!container) return;
  container.innerHTML = "";

  manifestList.forEach((m, idx) => {
    const card = document.createElement("div");
    card.className = "card";
    card.style.border = "1px solid #cbd5e1";
    card.style.boxShadow = "0 2px 8px rgba(0,0,0,0.04)";
    card.style.marginBottom = "20px";

    let photosHtml = "";
    if (m.photos && m.photos.length > 0) {
      photosHtml = `
        <div style="margin-top: 14px; padding-top: 10px; border-top: 1px dashed var(--border);">
          <strong style="font-size: 11px; text-transform: uppercase; color: var(--muted); display: block; margin-bottom: 6px;">Sealed Physical Loading Photos:</strong>
          <div class="photo-grid">
            ${m.photos.map(src => `<img src="${src}" class="photo-thumb" alt="Pallet Seal Photo">`).join("")}
          </div>
        </div>
      `;
    }

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">
        <div>
          <span style="font-size: 13px; font-weight: 800; color: #0284c7;">RECORD #${idx + 1}: ${m.invoice}</span>
          <span style="font-size: 12px; color: var(--muted); margin-left: 10px;">CO: <strong>${m.coNumber || "-"}</strong> | Vehicle: <strong>${m.vehicle}</strong> | Customer: <strong>${m.customer}</strong></span>
        </div>
        <div>
          <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 11px; margin-right: 6px;" onclick="exportSingleManifestPdf(${idx})">📄 Export PDF</button>
          <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 11px;" onclick="exportSingleManifestDirect(${idx})">📥 Export (.xls)</button>
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
              <img src="assets/demo-logo.svg" class="brand-logo-img" onerror="this.onerror=null; this.src='assets/demo-logo.svg';" style="max-height: 80px; max-width: 200px; object-fit: contain;">
            </td>
            <td colspan="3" style="text-align: center; font-weight: bold; color: #6b21a8; font-size: 14pt; padding: 4px; border: 1px solid #000;">
              DEMOSOLAR INDUSTRIES PRIVATE LIMITED
            </td>
          </tr>
          <tr>
            <td colspan="3" rowspan="3" style="text-align: center; padding: 4px; font-size: 10pt; line-height: 1.3; border: 1px solid #000;">
              <strong>Address:-</strong> Demo Industrial Park, Ahmedabad - 380001, Gujarat - India
            </td>
          </tr>
          <tr></tr>
          <tr></tr>
          <tr>
            <td colspan="3" style="text-align: center; padding: 4px; border: 1px solid #000;">
              <strong>Contact No:</strong> +91 9000000004
            </td>
          </tr>
          <tr>
            <td colspan="3" style="text-align: center; padding: 4px; border: 1px solid #000;">
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
      ${photosHtml}
    `;
    container.appendChild(card);
  });
}

window.exportSingleManifestDirect = function(idx) {
  if (activeMultiSearchedManifests && activeMultiSearchedManifests[idx]) {
    exportDispatchSheetJs(activeMultiSearchedManifests[idx]);
  } else {
    window.showNotification({ title: "Export Error", message: "Select or search for a packing list first.", type: "warning" });
  }
};

window.downloadAllSearchedPackingListsExcel = function() {
  if (!activeMultiSearchedManifests || activeMultiSearchedManifests.length === 0) {
    window.showNotification({ title: "No Results", message: "No active search results to download.", type: "warning" });
    return;
  }
  activeMultiSearchedManifests.forEach(m => exportDispatchSheetJs(m));
};

window.exportCurrentDispatchPdf = async function() {
  if (!dispatchPallets || dispatchPallets.length === 0) {
    window.showNotification({ title: "PDF Error", message: "Cannot generate PDF without adding pallets to the list.", type: "warning" });
    return;
  }
  if (!validateCurrentPackingListQuantity("PDF Packing List")) return;

  const manifest = {
    invoice: document.getElementById("dtInvoice")?.value.trim() || "DRAFT-INV",
    challanNo: document.getElementById("dtChallan")?.value.trim() || "-",
    transporter: document.getElementById("dtTransporter")?.value.trim() || "-",
    vehicle: document.getElementById("dtVehicle")?.value.trim() || "-",
    customer: document.getElementById("dtCustomer")?.value.trim() || "-",
    date: document.getElementById("dtDate")?.value.trim() || (typeof getFormattedToday === "function" ? getFormattedToday() : new Date().toLocaleDateString()),
    product: document.getElementById("cProduct")?.textContent || "-",
    cellType: document.getElementById("cProductTypeCell")?.textContent || "NON - DCR",
    orderQty: document.getElementById("dOrderQty")?.value.trim() || "-",
    dispatchedQty: dispatchPallets.reduce((sum, p) => sum + p.count, 0),
    pallets: dispatchPallets
  };

  await renderAndDownloadManifestPdf(manifest);
};

window.exportSingleManifestPdf = async function(idx) {
  if (!activeMultiSearchedManifests || !activeMultiSearchedManifests[idx]) {
    window.showNotification({ title: "PDF Error", message: "Please search and select a valid packing list first.", type: "warning" });
    return;
  }
  await renderAndDownloadManifestPdf(activeMultiSearchedManifests[idx]);
};

async function renderAndDownloadManifestPdf(m) {
  const printArea = document.getElementById("printableReportArea");
  if (!printArea) return;

  const logoSrc = getDemoSolarLogoDataUrl();
  const getFld = (val, fb = "-") => (val && String(val).trim() !== "") ? String(val).trim() : fb;

  const transporter = getFld(m.transporter || document.getElementById("dtTransporter")?.value);
  const challanNo = getFld(m.challanNo || document.getElementById("dtChallan")?.value);
  const vehicleNo = getFld(m.vehicle || document.getElementById("dtVehicle")?.value);
  const dateVal = getFld(m.date || document.getElementById("dtDate")?.value, typeof getFormattedToday === "function" ? getFormattedToday() : new Date().toLocaleDateString());
  const driverNo = getFld(m.driverNo || document.getElementById("dtDriverNo")?.value);
  const modeTransport = getFld(m.modeTransport || document.getElementById("dtModeTransport")?.value, "By Road");
  const driverName = getFld(m.driverName || document.getElementById("dtDriverName")?.value);
  const deliveryOrderNo = getFld(m.deliveryOrderNo || document.getElementById("dtDeliveryOrder")?.value);
  const lrNo = getFld(m.lrNo || document.getElementById("dtLrNo")?.value);
  const customerName = getFld(m.customer || document.getElementById("dtCustomer")?.value);
  const packingType = getFld(m.packingType || document.getElementById("dtPackingType")?.value, "Box Packing");
  const invoiceNo = getFld(m.invoice || document.getElementById("dtInvoice")?.value);
  const productDesc = getFld(m.product || document.getElementById("cProduct")?.textContent);
  const orderQty = getFld(m.orderQty || document.getElementById("dOrderQty")?.value || document.getElementById("vOrderQty")?.textContent);
  const dispatchedQty = m.dispatchedQty !== undefined ? m.dispatchedQty : (document.getElementById("cDispatchedQty")?.textContent || 0);

  const pallets = m.pallets || [];
  const chunkSize = 5;
  const totalChunks = Math.max(1, Math.ceil(pallets.length / chunkSize));
  
  printArea.innerHTML = "";
  printArea.style.display = "block";
  printArea.style.position = "absolute";
  printArea.style.top = "0";
  printArea.style.left = "0";
  printArea.style.zIndex = "-9999";

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pdfPageWidth = 210;
  const margin = 6;
  const printWidth = pdfPageWidth - (margin * 2);

  try {
    for (let c = 0; c < totalChunks; c++) {
      const currentChunk = pallets.slice(c * chunkSize, (c + 1) * chunkSize);
      while (currentChunk.length < 5) {
        currentChunk.push(null);
      }

      let matrixRowsHtml = "";
      matrixRowsHtml += `<tr style="height: 22px; background-color: #7ec8e3; font-weight: bold; text-align: center;">`;
      currentChunk.forEach(p => {
        matrixRowsHtml += `<td style="border: 1px solid #000; font-size: 11pt; padding: 2px;">${p ? (p.pallet || '-') : ''}</td>`;
      });
      matrixRowsHtml += `</tr>`;

      matrixRowsHtml += `<tr style="height: 20px; background-color: #7ec8e3; font-weight: bold; text-align: center;">`;
      currentChunk.forEach(p => {
        const cnt = p ? (p.count || (p.serials || []).length || 0) : '';
        matrixRowsHtml += `<td style="border: 1px solid #000; font-size: 10.5pt; padding: 2px;">${cnt}</td>`;
      });
      matrixRowsHtml += `</tr>`;

      for (let r = 0; r < 31; r++) {
        matrixRowsHtml += `<tr style="height: 19.2px; text-align: center; vertical-align: middle;">`;
        currentChunk.forEach(p => {
          let s = "";
          if (p) {
            const list = p.serials || (p.fullRows || []).map(row => row.serial) || [];
            s = list[r] ? String(list[r]).trim() : "";
          }
          matrixRowsHtml += `<td style="border: 1px solid #000; font-family: 'Aptos Narrow', Calibri, monospace; font-size: 9pt; font-weight: bold; padding: 1px 2px;">${s}</td>`;
        });
        matrixRowsHtml += `</tr>`;
      }

      const pageContainer = document.createElement("div");
      pageContainer.style.width = "780px";
      pageContainer.style.height = "1090px";
      pageContainer.style.background = "#ffffff";
      pageContainer.style.padding = "8px";
      pageContainer.style.boxSizing = "border-box";
      pageContainer.style.fontFamily = "'Aptos Narrow', Calibri, Arial, sans-serif";
      pageContainer.style.color = "#000";

      pageContainer.innerHTML = `
        <table style="width: 100%; border-collapse: collapse; border: 1.5px solid #000; table-layout: fixed;">
          <colgroup>
            <col style="width: 20%;">
            <col style="width: 20%;">
            <col style="width: 20%;">
            <col style="width: 20%;">
            <col style="width: 20%;">
          </colgroup>
          <tr>
            <td colspan="2" rowspan="6" style="padding: 4px; vertical-align: middle; background: #ffffff; border: 1px solid #000; text-align: center;">
              <img src="${logoSrc}" style="max-height: 65px; max-width: 190px; object-fit: contain;">
            </td>
            <td colspan="3" style="text-align: center; font-weight: bold; color: #6b21a8; font-size: 13pt; padding: 2px; border: 1px solid #000;">
              DEMOSOLAR INDUSTRIES PRIVATE LIMITED
            </td>
          </tr>
          <tr>
            <td colspan="3" rowspan="3" style="text-align: center; padding: 2px; font-size: 8pt; line-height: 1.2; border: 1px solid #000;">
              <strong>Address:-</strong> Demo Industrial Park, Ahmedabad - 380001, Gujarat - India
            </td>
          </tr>
          <tr></tr>
          <tr></tr>
          <tr>
            <td colspan="3" style="text-align: center; padding: 2px; font-size: 8.5pt; border: 1px solid #000;">
              <strong>Contact No:</strong> +91 9000000004
            </td>
          </tr>
          <tr>
            <td colspan="3" style="text-align: center; padding: 2px; font-size: 8.5pt; border: 1px solid #000;">
              <strong>Email:</strong> support@example.test
            </td>
          </tr>
          <tr style="font-size: 8.5pt; height: 18px;">
            <td style="background-color: #5b9bd5; font-weight: bold; padding: 2px 4px; border: 1px solid #000;">Transporter Name:</td>
            <td style="padding: 2px 4px; font-weight: bold; border: 1px solid #000; text-align: center;">${transporter}</td>
            <td style="background-color: #5b9bd5; font-weight: bold; padding: 2px 4px; border: 1px solid #000;">Challan no:</td>
            <td colspan="2" style="padding: 2px 4px; font-weight: bold; border: 1px solid #000; text-align: center;">${challanNo}</td>
          </tr>
          <tr style="font-size: 8.5pt; height: 18px;">
            <td style="background-color: #5b9bd5; font-weight: bold; padding: 2px 4px; border: 1px solid #000;">Vehicle No:</td>
            <td style="padding: 2px 4px; font-weight: bold; border: 1px solid #000; text-align: center;">${vehicleNo}</td>
            <td style="background-color: #5b9bd5; font-weight: bold; padding: 2px 4px; border: 1px solid #000;">Date:</td>
            <td colspan="2" style="padding: 2px 4px; font-weight: bold; border: 1px solid #000; text-align: center;">${dateVal}</td>
          </tr>
          <tr style="font-size: 8.5pt; height: 18px;">
            <td style="background-color: #5b9bd5; font-weight: bold; padding: 2px 4px; border: 1px solid #000;">Driver No:</td>
            <td style="padding: 2px 4px; font-weight: bold; border: 1px solid #000; text-align: center;">${driverNo}</td>
            <td style="background-color: #5b9bd5; font-weight: bold; padding: 2px 4px; border: 1px solid #000;">Mode of Transport:</td>
            <td colspan="2" style="padding: 2px 4px; font-weight: bold; border: 1px solid #000; text-align: center;">${modeTransport}</td>
          </tr>
          <tr style="font-size: 8.5pt; height: 18px;">
            <td style="background-color: #5b9bd5; font-weight: bold; padding: 2px 4px; border: 1px solid #000;">Driver Name:</td>
            <td style="padding: 2px 4px; font-weight: bold; border: 1px solid #000; text-align: center;">${driverName}</td>
            <td style="background-color: #5b9bd5; font-weight: bold; padding: 2px 4px; border: 1px solid #000;">Delivery Order No:</td>
            <td colspan="2" style="padding: 2px 4px; font-weight: bold; border: 1px solid #000; text-align: center;">${deliveryOrderNo}</td>
          </tr>
          <tr style="font-size: 8.5pt; height: 18px;">
            <td style="background-color: #5b9bd5; font-weight: bold; padding: 2px 4px; border: 1px solid #000;">LR No:</td>
            <td style="padding: 2px 4px; font-weight: bold; border: 1px solid #000; text-align: center;">${lrNo}</td>
            <td style="background-color: #5b9bd5; font-weight: bold; padding: 2px 4px; border: 1px solid #000;">Customer Name:</td>
            <td colspan="2" style="padding: 2px 4px; font-weight: bold; border: 1px solid #000; text-align: center;">${customerName}</td>
          </tr>
          <tr style="font-size: 8.5pt; height: 18px;">
            <td style="background-color: #5b9bd5; font-weight: bold; padding: 2px 4px; border: 1px solid #000;">Packing Type:</td>
            <td style="padding: 2px 4px; font-weight: bold; border: 1px solid #000; text-align: center;">${packingType}</td>
            <td style="background-color: #5b9bd5; font-weight: bold; padding: 2px 4px; border: 1px solid #000;">Invoice No.:</td>
            <td colspan="2" style="padding: 2px 4px; font-weight: bold; border: 1px solid #000; text-align: center;">${invoiceNo}</td>
          </tr>
          <tr style="background-color: #7ec8e3; font-weight: bold; text-align: center; font-size: 8.5pt; height: 19px;">
            <td colspan="2" style="border: 1px solid #000; padding: 2px;">Product Detail</td>
            <td style="border: 1px solid #000; padding: 2px;">HSN Code</td>
            <td style="border: 1px solid #000; padding: 2px;">Order Qty:</td>
            <td style="border: 1px solid #000; padding: 2px;">Qty</td>
          </tr>
          <tr style="text-align: center; font-weight: bold; font-size: 8.5pt; height: 19px;">
            <td colspan="2" style="border: 1px solid #000; padding: 2px;">${productDesc}</td>
            <td style="border: 1px solid #000; padding: 2px;">85414300</td>
            <td style="border: 1px solid #000; padding: 2px;">${orderQty}</td>
            <td style="border: 1px solid #000; padding: 2px; color: #059669;">${dispatchedQty}</td>
          </tr>
          ${matrixRowsHtml}
        </table>
      `;

      printArea.appendChild(pageContainer);

      const canvas = await html2canvas(pageContainer, {
        scale: 2,
        useCORS: true,
        logging: false,
        scrollY: 0
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.98);
      const imgHeight = (canvas.height * printWidth) / canvas.width;

      if (c > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', margin, margin, printWidth, imgHeight);

      printArea.innerHTML = "";
    }

    pdf.save(`Packing_List_${String(invoiceNo !== '-' ? invoiceNo : 'INV').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`);
  } catch (err) {
    console.error("PDF generation failed:", err);
    window.print();
  } finally {
    printArea.style.display = "none";
    printArea.style.position = "static";
    printArea.style.zIndex = "1";
    printArea.innerHTML = "";
  }
}

async function embedDemoSolarLogoInExcelHtml(content) {
  let logoDataUrl = "";
  try {
    logoDataUrl = await getEmbeddedExcelLogo();
  } catch (error) {
    console.warn("DemoSolar logo could not be embedded in HTML Excel export:", error);
    return String(content || "");
  }

  let html = String(content || "");
  const demosolarAssetPattern = /(["'])(?:\.\/)?(?:assets\/)?(?:demosolar-logo-final|DEMOSOLAR_LOGO_page-0001-removebg-preview)\.png\1/gi;
  html = html.replace(demosolarAssetPattern, (_, quote) => `${quote}${logoDataUrl}${quote}`);

  // Some reports do not have a logo section of their own. Add a compact,
  // embedded DemoSolar header so the image travels inside the exported file.
  if (!html.includes(logoDataUrl)) {
    const logoHeader = `<div style="margin:0 0 10px 0; text-align:left;"><img src="${logoDataUrl}" alt="DemoSolar Industries" style="height:48px; max-width:220px; object-fit:contain;"></div>`;
    html = /<body\b[^>]*>/i.test(html)
      ? html.replace(/<body\b[^>]*>/i, match => `${match}${logoHeader}`)
      : `${logoHeader}${html}`;
  }
  return html;
}

window.saveNewDriver = async function() {
  const value = id => String(document.getElementById(id)?.value || "").trim();
  const name = value("drAddName").toUpperCase();
  const phone = value("drAddPhone");
  const transporter = value("drAddTransporterSelect");
  const vehicle = accountInvoiceKey(value("drAddVehicle"));
  if (!name || !phone) {
    window.showNotification({ title: "Driver Details Required", message: "Enter the driver name and mobile number.", type: "warning" });
    return;
  }
  if (!/^\d{10}$/.test(phone)) {
    window.showNotification({ title: "Invalid Mobile Number", message: "Enter a valid 10-digit driver mobile number.", type: "warning" });
    return;
  }
  if (driversDb.some(row => String(row.phone || "") === phone)) {
    window.showNotification({ title: "Driver Already Exists", message: "This mobile number is already registered to a driver.", type: "warning" });
    return;
  }
  const driver = { id: `DR-${Date.now()}`, name, phone, transporter, vehicle, createdAt: new Date().toISOString(), createdBy: currentLoggedInUser?.username || "SYSTEM" };
  driversDb.unshift(driver);
  if (await saveStorage(KEY_DRIVERS, driversDb) === false) { driversDb = driversDb.filter(row => row !== driver); return; }
  await logEvent("DISPATCH", "DRIVER_ADDED", `Added driver ${name}.`);
  renderDriverTable();
  populateDriverEditDropdown();
  populateDriverDeleteDropdown();
  ["drAddName", "drAddPhone", "drAddVehicle"].forEach(id => { const element = document.getElementById(id); if (element) element.value = ""; });
  const transporterSelect = document.getElementById("drAddTransporterSelect");
  if (transporterSelect) transporterSelect.value = "";
  window.showNotification({ title: "Driver Saved", message: `${name} was added successfully.`, type: "success" });
};

function populateDriverEditDropdown() {
  const select = document.getElementById("drEditSelect");
  if (!select) return;
  const current = String(select.value || "");
  select.innerHTML = `<option value="">${driversDb.length ? "-- Select Driver --" : "-- No Drivers Registered --"}</option>` +
    driversDb.map(item => `<option value="${escapeSalesHtml(String(item.id || ""))}">${escapeSalesHtml(item.name || "Unnamed Driver")} — ${escapeSalesHtml(item.phone || "")}</option>`).join("");
  if (driversDb.some(item => String(item.id || "") === current)) select.value = current;
  window.onSelectDriverToEdit();
}

function populateDriverDeleteDropdown() {
  const select = document.getElementById("drDeleteSelect");
  if (!select) return;
  const current = String(select.value || "");
  select.innerHTML = `<option value="">${driversDb.length ? "-- Select Driver --" : "-- No Drivers Registered --"}</option>` +
    driversDb.map(item => `<option value="${escapeSalesHtml(String(item.id || ""))}">${escapeSalesHtml(item.name || "Unnamed Driver")} — ${escapeSalesHtml(item.phone || "")}</option>`).join("");
  if (driversDb.some(item => String(item.id || "") === current)) select.value = current;
  window.onSelectDriverToDelete();
}

window.onSelectDriverToEdit = function() {
  const id = String(document.getElementById("drEditSelect")?.value || "");
  const item = driversDb.find(row => String(row.id || "") === id);
  populateDriverTransporterDropdowns();
  const set = (field, value = "") => { const element = document.getElementById(field); if (element) element.value = value; };
  set("drEditName", item?.name);
  set("drEditPhone", item?.phone);
  set("drEditTransporterSelect", item?.transporter);
  set("drEditVehicle", item?.vehicle);
};

window.saveEditedDriver = async function() {
  const value = id => String(document.getElementById(id)?.value || "").trim();
  const id = value("drEditSelect");
  const item = driversDb.find(row => String(row.id || "") === id);
  if (!item) {
    window.showNotification({ title: "Select Driver", message: "Select a driver before saving changes.", type: "warning" });
    return;
  }
  const name = value("drEditName").toUpperCase();
  const phone = value("drEditPhone");
  const transporter = value("drEditTransporterSelect");
  const vehicle = accountInvoiceKey(value("drEditVehicle"));
  if (!name || !/^\d{10}$/.test(phone)) {
    window.showNotification({ title: "Valid Driver Details Required", message: "Enter the driver name and a valid 10-digit mobile number.", type: "warning" });
    return;
  }
  if (driversDb.some(row => row !== item && String(row.phone || "") === phone)) {
    window.showNotification({ title: "Mobile Number Already Used", message: "Another driver already uses this mobile number.", type: "warning" });
    return;
  }
  const before = item.name;
  Object.assign(item, { name, phone, transporter, vehicle, updatedAt: new Date().toISOString(), updatedBy: currentLoggedInUser?.username || "SYSTEM" });
  if (await saveStorage(KEY_DRIVERS, driversDb) === false) return;
  await logEvent("DISPATCH", "DRIVER_EDITED", `Updated driver ${before}.`);
  renderDriverTable();
  populateDriverEditDropdown();
  populateDriverDeleteDropdown();
  window.showNotification({ title: "Driver Updated", message: `${name} was updated successfully.`, type: "success" });
};

window.onSelectDriverToDelete = function() {
  const id = String(document.getElementById("drDeleteSelect")?.value || "");
  const item = driversDb.find(row => String(row.id || "") === id);
  const box = document.getElementById("drDeleteInfoBox");
  if (!box) return;
  box.innerHTML = item
    ? `<strong style="color:#0f172a;">${escapeSalesHtml(item.name || "Unnamed Driver")}</strong><br>${escapeSalesHtml(item.phone || "-")} · ${escapeSalesHtml(item.transporter || "No transporter")} · ${escapeSalesHtml(item.vehicle || "No vehicle")}`
    : "Select a driver to view assigned information before deletion.";
};

window.executeDeleteDriver = async function() {
  const id = String(document.getElementById("drDeleteSelect")?.value || "");
  const item = driversDb.find(row => String(row.id || "") === id);
  if (!item) {
    window.showNotification({ title: "Select Driver", message: "Select a driver before deleting it.", type: "warning" });
    return;
  }
  const confirmed = await window.showConfirmDialog({ title: "Delete Driver", message: `Delete driver “${item.name}”? Existing dispatch history remains unchanged.`, confirmText: "Delete Driver", isDanger: true });
  if (!confirmed) return;
  const previous = driversDb;
  driversDb = driversDb.filter(row => row !== item);
  if (await saveStorage(KEY_DRIVERS, driversDb) === false) { driversDb = previous; return; }
  await logEvent("DISPATCH", "DRIVER_DELETED", `Deleted driver ${item.name}.`);
  renderDriverTable();
  populateDriverEditDropdown();
  populateDriverDeleteDropdown();
  window.showNotification({ title: "Driver Deleted", message: `${item.name} was removed from the active master.`, type: "success" });
};

async function downloadHtmlBlob(content, fileName) {
  const embeddedContent = await embedDemoSolarLogoInExcelHtml(content);
  try {
    const base64Content = window.btoa(unescape(encodeURIComponent(embeddedContent)));
    const dataUri = 'data:application/vnd.ms-excel;base64,' + base64Content;

    const link = document.createElement('a');
    link.href = dataUri;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => document.body.removeChild(link), 200);
  } catch (err) {
    const uri = 'data:application/vnd.ms-excel;charset=utf-8,' + encodeURIComponent(embeddedContent);
    const fallbackLink = document.createElement('a');
    fallbackLink.href = uri;
    fallbackLink.download = fileName;
    document.body.appendChild(fallbackLink);
    fallbackLink.click();
    setTimeout(() => document.body.removeChild(fallbackLink), 200);
  }
}

