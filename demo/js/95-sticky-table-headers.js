(() => {
  "use strict";

  const layer = document.createElement("div");
  layer.id = "erpFloatingTableHeader";
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    position: "fixed",
    display: "none",
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "51",
    margin: "0",
    padding: "0",
    background: "#f8fafc",
    boxShadow: "0 2px 8px rgba(15,23,42,.12)",
    borderBottom: "1px solid #e2e8f0",
    boxSizing: "border-box"
  });
  document.body.appendChild(layer);

  let sourceHead = null;
  let framePending = false;

  function visible(el) {
    if (!el || !el.getClientRects().length) return false;
    if (el.closest(".erp-modal-card, [role='dialog'], #loginOverlay")) return false;
    const panel = el.closest(".view-panel");
    return !panel || panel.classList.contains("active");
  }

  function visibleBounds(table) {
    const bounds = { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
    for (let node = table.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      const clipsX = /auto|scroll|hidden|clip/.test(style.overflowX);
      const clipsY = /auto|scroll|hidden|clip/.test(style.overflowY);
      if (!clipsX && !clipsY) continue;
      const rect = node.getBoundingClientRect();
      if (clipsX) {
        bounds.left = Math.max(bounds.left, rect.left + node.clientLeft);
        bounds.right = Math.min(bounds.right, rect.left + node.clientLeft + node.clientWidth);
      }
      if (clipsY) {
        bounds.top = Math.max(bounds.top, rect.top + node.clientTop);
        bounds.bottom = Math.min(bounds.bottom, rect.top + node.clientTop + node.clientHeight);
      }
    }
    const main = document.querySelector(".main-wrapper");
    if (main) {
      const rect = main.getBoundingClientRect();
      bounds.top = Math.max(bounds.top, rect.top);
      bounds.bottom = Math.min(bounds.bottom, rect.bottom);
    }
    return bounds;
  }

  function restoreSource() {
    if (sourceHead) {
      sourceHead.style.removeProperty("visibility");
      sourceHead = null;
    }
  }

  function render() {
    const main = document.querySelector(".main-wrapper");
    const topbar = main && main.querySelector(":scope > .topbar");
    const mainRect = main ? main.getBoundingClientRect() : { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
    const topbarHeight = topbar ? topbar.getBoundingClientRect().height : 0;
    const stickyTop = Math.max(0, mainRect.top) + topbarHeight;
    const viewportBottom = Math.min(innerHeight, mainRect.bottom);
    let active = null;

    document.querySelectorAll("table").forEach(table => {
      const head = table.tHead;
      // The Sales Order Sheet scrolls inside its own viewport and uses native
      // sticky cells there. A page-level floating clone hides that native row.
      if (table.classList.contains("sales-orders-table")) return;
      if (!head || !visible(table)) return;
      const tableRect = table.getBoundingClientRect();
      const headRect = head.getBoundingClientRect();
      const bodyRect = table.tBodies[0]?.getBoundingClientRect() || tableRect;
      const bounds = visibleBounds(table);
      const visibleBottom = Math.min(viewportBottom, bounds.bottom);
      const visibleTop = Math.max(stickyTop, bounds.top);
      if (bodyRect.bottom <= visibleTop + 4 || bodyRect.top >= visibleBottom || headRect.top >= stickyTop) return;
      if (!active || headRect.top > active.headRect.top) active = { table, head, tableRect, headRect, bounds };
    });

    if (!active) {
      restoreSource();
      layer.replaceChildren();
      layer.style.display = "none";
      return;
    }

    if (sourceHead !== active.head) restoreSource();
    sourceHead = active.head;
    if (sourceHead.style.visibility !== "hidden") sourceHead.style.visibility = "hidden";

    const left = Math.max(0, active.bounds.left);
    const right = Math.min(innerWidth, active.bounds.right);
    const width = Math.max(0, right - left);
    const height = active.headRect.height;
    if (!width || !height) {
      restoreSource();
      layer.replaceChildren();
      layer.style.display = "none";
      return;
    }

    const focusedFilter = document.activeElement?.closest?.("#erpFloatingTableHeader .production-column-filter");
    const focusedFilterIndex = focusedFilter?.dataset.productionFilter;
    const focusedSelectionStart = focusedFilter?.selectionStart;
    const focusedSelectionEnd = focusedFilter?.selectionEnd;
    const cloneTable = active.table.cloneNode(false);
    cloneTable.removeAttribute("id");
    cloneTable.style.width = `${active.tableRect.width}px`;
    cloneTable.style.minWidth = `${active.tableRect.width}px`;
    cloneTable.style.maxWidth = "none";
    cloneTable.style.margin = "0";
    cloneTable.style.tableLayout = "fixed";
    cloneTable.style.borderCollapse = "separate";
    cloneTable.style.borderSpacing = "0";
    cloneTable.style.boxSizing = "border-box";

    const clonedHead = active.head.cloneNode(true);
    clonedHead.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
    const originalCells = active.head.querySelectorAll("th, td");
    const clonedCells = clonedHead.querySelectorAll("th, td");
    clonedCells.forEach((cell, index) => {
      const original = originalCells[index];
      if (!original) return;
      const cellWidth = original.getBoundingClientRect().width;
      cell.style.width = `${cellWidth}px`;
      cell.style.minWidth = `${cellWidth}px`;
      cell.style.maxWidth = `${cellWidth}px`;
      cell.style.position = "static";
      cell.style.top = "auto";
      cell.style.backgroundColor = "#f8fafc";
      cell.style.boxShadow = "0 1px 0 #e2e8f0";
      cell.style.boxSizing = "border-box";
    });
    cloneTable.appendChild(clonedHead);
    cloneTable.style.transform = `translateX(${active.tableRect.left - left}px)`;

    layer.replaceChildren(cloneTable);
    if (focusedFilterIndex !== undefined) {
      const replacementFilter = [...layer.querySelectorAll(".production-column-filter")].find(input => input.dataset.productionFilter === focusedFilterIndex);
      if (replacementFilter) {
        replacementFilter.focus({ preventScroll: true });
        if (focusedSelectionStart !== null && focusedSelectionEnd !== null) replacementFilter.setSelectionRange(focusedSelectionStart, focusedSelectionEnd);
      }
    }
    layer.style.left = `${left}px`;
    layer.style.top = `${stickyTop}px`;
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
    layer.style.pointerEvents = active.table.classList.contains("production-dashboard-detail-table") ? "auto" : "none";
    layer.style.display = "block";
  }

  function schedule() {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(() => {
      framePending = false;
      render();
    });
  }

  window.addEventListener("scroll", schedule, true);
  window.addEventListener("resize", schedule, { passive: true });
  document.addEventListener("click", schedule, true);
  window.addEventListener("pageshow", schedule);

  const content = document.querySelector(".content-area");
  if (content && "MutationObserver" in window) {
    new MutationObserver(schedule).observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
  }

  schedule();
})();
