/**
 * DEMOSOLAR ERP - Department request routing master.
 * Exact request-type rules take priority over department-wide rules.
 */
(function requestRoutesModule() {
  const REQUEST_TYPES = [
    ["*", "All request types"],
    ["DELETE_SERIALS_MULTI", "Delete serial numbers"], ["DELETE_SERIAL", "Delete serial number"],
    ["EDIT_PALLET", "Edit pallet"], ["DELETE_PALLETS_MULTI", "Delete multiple pallets"], ["DELETE_PALLET", "Delete pallet"],
    ["DELETE_DISPATCH_PALLETS_MULTI", "Delete dispatch pallets"], ["DELETE_DISPATCH_FULL", "Delete full dispatch"], ["DELETE_DISPATCH_BULK", "Delete dispatch records"],
    ["ALLOCATE_PO_TO_CO", "Allocate PO / stock to C/O"],
    ["EDIT_ACCOUNT_RECEIPT", "Edit account receipt"], ["DELETE_ACCOUNT_RECEIPT", "Delete account receipt"],
    ["EDIT_ACCOUNT_INVOICE", "Edit account invoice"], ["DELETE_ACCOUNT_INVOICE", "Delete account invoice"],
    ["EDIT_SALES_ORDER", "Edit sales order"], ["DELETE_SALES_ORDER", "Delete sales order"],
    ["EDIT_PRODUCTION_SHEET", "Edit production sheet"], ["DELETE_PRODUCTION_SHEET", "Delete production sheet"],
    ["DELETE_PO", "Delete production order"]
  ];
  const typeLabel = Object.fromEntries(REQUEST_TYPES);
  const DEPARTMENT_REQUEST_TYPES = Object.freeze({
    ACCOUNTS: ["EDIT_ACCOUNT_INVOICE", "DELETE_ACCOUNT_INVOICE", "EDIT_ACCOUNT_RECEIPT", "DELETE_ACCOUNT_RECEIPT"],
    SALES: ["EDIT_SALES_ORDER", "DELETE_SALES_ORDER", "ALLOCATE_PO_TO_CO"],
    PRODUCTION: ["EDIT_PRODUCTION_SHEET", "DELETE_PRODUCTION_SHEET"],
    "STORE & PPC": ["DELETE_SERIALS_MULTI", "DELETE_SERIAL", "DELETE_PO"],
    PACKING: ["EDIT_PALLET", "DELETE_PALLETS_MULTI", "DELETE_PALLET"],
    DISPATCH: ["DELETE_DISPATCH_PALLETS_MULTI", "DELETE_DISPATCH_FULL", "DELETE_DISPATCH_BULK"]
  });
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const activeUsers = () => (usersDb || []).filter(user => {
    return String(user.status || "ACTIVE").toUpperCase() === "ACTIVE";
  });
  const userById = id => (usersDb || []).find(user => String(user.id) === String(id));
  const designationName = user => {
    const designation = (designationsDb || []).find(item => String(item.id) === String(user?.designationId));
    return designation?.name || user?.designation || "";
  };
  const userLabel = user => {
    if (!user) return "Unknown user";
    const detail = [user.department, designationName(user)].filter(Boolean).join(" · ");
    return `${user.name || user.username} (@${user.username})${detail ? ` · ${detail}` : ""}`;
  };
  const option = (value, label) => `<option value="${esc(value)}">${esc(label)}</option>`;

  function departmentRouteKey(value) {
    const department = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
    if (/ACCOUNT|FINANCE/.test(department)) return "ACCOUNTS";
    if (/SALES|MARKETING/.test(department)) return "SALES";
    if (/STORE|PPC|WAREHOUSE/.test(department)) return "STORE & PPC";
    if (/PRODUCTION/.test(department)) return "PRODUCTION";
    if (/PACKING/.test(department)) return "PACKING";
    if (/DISPATCH|LOGISTIC/.test(department)) return "DISPATCH";
    return department;
  }

  function populateRequestTypeOptions(departmentName, preferredType = "") {
    const requestType = byId("requestRouteType");
    if (!requestType) return;
    const available = DEPARTMENT_REQUEST_TYPES[departmentRouteKey(departmentName)] || [];
    if (!departmentName) {
      requestType.innerHTML = option("", "Select a department first");
      requestType.disabled = true;
      return;
    }
    if (!available.length) {
      requestType.innerHTML = option("", "No approval requests available for this department");
      requestType.disabled = true;
      return;
    }
    requestType.disabled = false;
    requestType.innerHTML = option("*", "All request types for this department")
      + available.map(value => option(value, typeLabel[value] || value)).join("");
    requestType.value = available.includes(preferredType) || preferredType === "*" ? preferredType : "*";
  }

  window.handleRequestRouteDepartmentChange = function() {
    populateRequestTypeOptions(byId("requestRouteDepartment")?.value || "", "*");
    window.updateRequestRoutePreview();
  };

  function populateRouteSelectors() {
    const department = byId("requestRouteDepartment");
    const requestType = byId("requestRouteType");
    const primary = byId("requestRoutePrimary");
    const secondary = byId("requestRouteSecondary");
    if (!department || !requestType || !primary || !secondary) return;
    const selected = { department: department.value, requestType: requestType.value || "*", primary: primary.value, secondary: secondary.value };
    const departmentNames = [...new Set((departmentsDb || [])
      .filter(item => String(item.status || "ACTIVE").toUpperCase() !== "INACTIVE")
      .map(item => String(item.name || "").trim())
      .filter(name => name && (DEPARTMENT_REQUEST_TYPES[departmentRouteKey(name)] || []).length > 0))].sort();
    department.innerHTML = option("", "Select source department") + departmentNames.map(name => option(name, name)).join("");
    populateRequestTypeOptions(selected.department, selected.requestType);
    const approvers = activeUsers().sort((a, b) => String(a.name || a.username).localeCompare(String(b.name || b.username)));
    const approverOptions = approvers.map(user => option(String(user.id), userLabel(user))).join("");
    primary.innerHTML = option("", "Select primary approver") + approverOptions;
    secondary.innerHTML = option("", "No second approver") + approverOptions;
    department.value = selected.department;
    if (!requestType.disabled) requestType.value = selected.requestType || "*";
    primary.value = selected.primary;
    secondary.value = selected.secondary;
  }

  window.updateRequestRoutePreview = function() {
    const department = byId("requestRouteDepartment")?.value || "the selected department";
    const requestType = byId("requestRouteType")?.value || "*";
    const primary = userById(byId("requestRoutePrimary")?.value);
    const secondary = userById(byId("requestRouteSecondary")?.value);
    const status = byId("requestRouteStatus")?.value || "ACTIVE";
    const preview = byId("requestRoutePreview");
    if (!preview) return;
    if (!primary) { preview.textContent = "Select a department and primary approver to preview the route."; return; }
    const people = secondary ? `${primary.name || primary.username} or ${secondary.name || secondary.username}` : (primary.name || primary.username);
    preview.innerHTML = `<strong>${esc(department)}</strong> · ${esc(typeLabel[requestType] || requestType)} → <strong>${esc(people)}</strong> can approve. Route is ${esc(status.toLowerCase())}.`;
  };

  window.resetRequestRouteForm = function() {
    if (byId("requestRouteEditId")) byId("requestRouteEditId").value = "";
    if (byId("requestRouteDepartment")) byId("requestRouteDepartment").value = "";
    populateRequestTypeOptions("", "");
    if (byId("requestRoutePrimary")) byId("requestRoutePrimary").value = "";
    if (byId("requestRouteSecondary")) byId("requestRouteSecondary").value = "";
    if (byId("requestRouteStatus")) byId("requestRouteStatus").value = "ACTIVE";
    if (byId("requestRouteNotes")) byId("requestRouteNotes").value = "";
    if (byId("requestRouteEditorTitle")) byId("requestRouteEditorTitle").textContent = "➕ Create Routing Rule";
    window.updateRequestRoutePreview();
  };

  window.saveRequestRoute = async function() {
    const id = byId("requestRouteEditId")?.value || "";
    const department = byId("requestRouteDepartment")?.value.trim() || "";
    const requestType = byId("requestRouteType")?.value || "";
    const primaryApproverId = byId("requestRoutePrimary")?.value || "";
    const secondaryApproverId = byId("requestRouteSecondary")?.value || "";
    const status = byId("requestRouteStatus")?.value || "ACTIVE";
    const notes = byId("requestRouteNotes")?.value.trim() || "";
    if (!department || !requestType || !primaryApproverId) {
      window.showNotification({ title: "Route Incomplete", message: "Select a department that has available requests, a request type and the primary approver.", type: "warning" }); return;
    }
    if (secondaryApproverId && secondaryApproverId === primaryApproverId) {
      window.showNotification({ title: "Duplicate Approver", message: "Primary and second approver must be different employee IDs.", type: "warning" }); return;
    }
    const duplicate = (requestRoutesDb || []).find(route => String(route.id) !== String(id) && String(route.department).toUpperCase() === department.toUpperCase() && String(route.requestType || "*").toUpperCase() === requestType.toUpperCase());
    if (duplicate) {
      window.showNotification({ title: "Route Already Exists", message: "Edit the existing rule for this department and request type.", type: "warning" }); return;
    }
    const now = new Date().toISOString();
    const route = { id: id || `ROUTE-${Date.now()}`, department, requestType, primaryApproverId, secondaryApproverId, approvalMode: "ANY_ONE", status, notes, updatedAt: now, updatedBy: currentLoggedInUser?.username || "IT" };
    if (!id) { route.createdAt = now; route.createdBy = currentLoggedInUser?.username || "IT"; requestRoutesDb.push(route); }
    else {
      const index = requestRoutesDb.findIndex(item => String(item.id) === String(id));
      if (index < 0) return;
      requestRoutesDb[index] = { ...requestRoutesDb[index], ...route };
    }
    const saved = await saveStorage(KEY_REQUEST_ROUTES, requestRoutesDb);
    if (!saved) return;
    await logEvent("IT", id ? "REQUEST_ROUTE_UPDATED" : "REQUEST_ROUTE_CREATED", `${department} / ${typeLabel[requestType] || requestType} routed to ${userLabel(userById(primaryApproverId))}${secondaryApproverId ? ` and ${userLabel(userById(secondaryApproverId))}` : ""}.`, { silent: true });
    window.showNotification({ title: id ? "Route Updated" : "Route Created", message: "Future and pending requests will use this routing rule immediately.", type: "success" });
    window.resetRequestRouteForm(); window.renderRequestRoutesTable();
  };

  window.editRequestRoute = function(id) {
    const route = (requestRoutesDb || []).find(item => String(item.id) === String(id)); if (!route) return;
    populateRouteSelectors();
    byId("requestRouteEditId").value = route.id;
    byId("requestRouteDepartment").value = route.department || "";
    populateRequestTypeOptions(route.department || "", route.requestType || "*");
    byId("requestRouteType").value = route.requestType || "*";
    byId("requestRoutePrimary").value = String(route.primaryApproverId || "");
    byId("requestRouteSecondary").value = String(route.secondaryApproverId || "");
    byId("requestRouteStatus").value = route.status || "ACTIVE";
    byId("requestRouteNotes").value = route.notes || "";
    byId("requestRouteEditorTitle").textContent = "✏️ Edit Routing Rule";
    window.updateRequestRoutePreview();
    document.querySelector(".request-route-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  window.deleteRequestRoute = async function(id) {
    const route = (requestRoutesDb || []).find(item => String(item.id) === String(id)); if (!route) return;
    const confirmed = await window.showConfirmDialog({ title: "Delete Request Route", message: `Delete the route for ${route.department} · ${typeLabel[route.requestType] || route.requestType}?`, confirmText: "Delete Route", isDanger: true });
    if (!confirmed) return;
    requestRoutesDb = requestRoutesDb.filter(item => String(item.id) !== String(id));
    if (!await saveStorage(KEY_REQUEST_ROUTES, requestRoutesDb)) return;
    await logEvent("IT", "REQUEST_ROUTE_DELETED", `${route.department} / ${typeLabel[route.requestType] || route.requestType} routing rule deleted.`, { silent: true });
    window.resetRequestRouteForm(); window.renderRequestRoutesTable();
    window.showNotification({ title: "Route Deleted", message: "The department fallback route will apply unless another matching rule exists.", type: "success" });
  };

  window.renderRequestRoutesTable = function() {
    const body = byId("requestRoutesTableBody"); if (!body) return;
    const query = String(byId("requestRouteSearch")?.value || "").trim().toLowerCase();
    const routes = (requestRoutesDb || []).filter(route => {
      const primary = userLabel(userById(route.primaryApproverId)); const secondary = userLabel(userById(route.secondaryApproverId));
      return !query || [route.department, typeLabel[route.requestType] || route.requestType, primary, secondary, route.status].join(" ").toLowerCase().includes(query);
    }).sort((a, b) => String(a.department).localeCompare(String(b.department)) || String(a.requestType).localeCompare(String(b.requestType)));
    const summary = byId("requestRouteRegisterSummary"); if (summary) summary.textContent = `${requestRoutesDb.length} routing rule${requestRoutesDb.length === 1 ? "" : "s"} configured · ${requestRoutesDb.filter(route => route.status === "ACTIVE").length} active`;
    if (!routes.length) { body.innerHTML = `<tr><td colspan="7" class="request-route-empty">${query ? "No routing rule matches this search." : "No request routes configured. Department fallback routing remains active."}</td></tr>`; return; }
    body.innerHTML = routes.map(route => {
      const primary = userById(route.primaryApproverId); const secondary = userById(route.secondaryApproverId);
      const date = route.updatedAt ? new Date(route.updatedAt).toLocaleString("en-IN") : "-";
      return `<tr><td><strong>${esc(route.department)}</strong></td><td>${esc(typeLabel[route.requestType] || route.requestType)}</td><td><div class="request-route-approvers"><span class="request-route-person">1 · ${esc(primary?.name || primary?.username || "Missing user")}</span>${secondary ? `<span class="request-route-person secondary">2 · ${esc(secondary.name || secondary.username)}</span>` : ""}</div></td><td>Either can approve</td><td><span class="request-route-status ${String(route.status).toLowerCase()}">${esc(route.status || "ACTIVE")}</span></td><td>${esc(date)}<br><small>${esc(route.updatedBy || route.createdBy || "-")}</small></td><td><div class="request-route-actions"><button title="Edit route" onclick="editRequestRoute('${esc(route.id)}')">✏️</button><button class="danger" title="Delete route" onclick="deleteRequestRoute('${esc(route.id)}')">🗑️</button></div></td></tr>`;
    }).join("");
  };

  window.prepareRequestRoutesView = function() {
    populateRouteSelectors();
    window.resetRequestRouteForm();
    window.renderRequestRoutesTable();
  };
})();
