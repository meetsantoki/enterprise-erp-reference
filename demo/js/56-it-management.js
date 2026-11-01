/* Database-backed IT administration. */
let itAssets = [];
let itAssetUsers = [];
let itRoleTemplates = [];
let itTemplateUsers = [];

function itEscape(value) {
  return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[ch]);
}
async function itRequest(action, options = {}, parameters = {}) {
  const query = new URLSearchParams({ action, ...parameters });
  const response = await erpFetchWithTimeout(`backend/it_management.php?${query.toString()}`, { credentials: "same-origin", ...options }, 30000);
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.status !== "success") throw new Error(result.message || "The IT database operation failed.");
  return result;
}
async function itPost(action, body) {
  return itRequest(action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function itError(error, title = "IT Management") {
  window.showNotification?.({ title, message: error?.message || "The operation failed.", type: "danger" });
}

function itFormatBytes(value) {
  let bytes = Math.max(0, Number(value || 0));
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unit = 0;
  while (bytes >= 1024 && unit < units.length - 1) { bytes /= 1024; unit += 1; }
  return `${bytes.toFixed(unit === 0 ? 0 : bytes >= 100 ? 0 : 1)} ${units[unit]}`;
}
window.openItPerformance = async function(button) {
  if (await switchView("itPerformance", button, "IT > Server Performance") === false) return;
  await window.loadItPerformance();
};
window.loadItPerformance = async function() {
  try {
    const response = await erpFetchWithTimeout("backend/api.php?action=performance_health", { credentials: "same-origin", cache: "no-store" }, 15000);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.status !== "success") throw new Error(result.message || "Performance metrics could not be loaded.");
    const metrics = result.database?.metrics || {};
    const settings = result.database?.settings || {};
    const maxConnections = Number(settings.max_connections || 0);
    const cards = [
      ["Database Cache Hit", `${Number(result.database?.bufferPoolHitRate || 0).toFixed(2)}%`, Number(result.database?.bufferPoolHitRate || 0) >= 99 ? "#059669" : "#d97706"],
      ["Active Connections", `${Number(metrics.Threads_connected || 0)} / ${maxConnections || "-"}`, Number(metrics.Threads_connected || 0) < maxConnections * 0.8 ? "#0369a1" : "#dc2626"],
      ["Peak Connections", Number(metrics.Max_used_connections || 0).toLocaleString("en-IN"), "#7c3aed"],
      ["Slow Queries", Number(metrics.Slow_queries || 0).toLocaleString("en-IN"), Number(metrics.Slow_queries || 0) === 0 ? "#059669" : "#d97706"],
      ["Running Queries", Number(metrics.Threads_running || 0).toLocaleString("en-IN"), Number(metrics.Threads_running || 0) < 20 ? "#059669" : "#dc2626"],
      ["Disk Temp Tables", `${Number(result.database?.temporaryDiskRate || 0).toFixed(2)}%`, Number(result.database?.temporaryDiskRate || 0) < 10 ? "#059669" : "#d97706"],
      ["Database Buffer", itFormatBytes(settings.innodb_buffer_pool_size), "#0f766e"],
      ["Storage Free", itFormatBytes(result.storage?.freeBytes), Number(result.storage?.freeBytes || 0) > 10 * 1024 ** 3 ? "#059669" : "#dc2626"]
    ];
    const box = document.getElementById("itPerformanceCards");
    if (box) box.innerHTML = cards.map(([label, value, color]) => `<div class="card" style="border-top:4px solid ${color};margin:0;"><div style="font-size:11px;color:var(--muted);font-weight:900;text-transform:uppercase;letter-spacing:.05em;">${itEscape(label)}</div><div style="font-size:25px;font-weight:900;margin-top:7px;color:${color};">${itEscape(value)}</div></div>`).join("");
    const body = document.getElementById("itPerformanceModules");
    if (body) body.innerHTML = (result.modules || []).map(module => `<tr><td><strong>${itEscape(module.key)}</strong></td><td>${Number(module.records || 0).toLocaleString("en-IN")}</td><td>${itFormatBytes(module.bytes)}</td></tr>`).join("") || '<tr><td colspan="3" style="text-align:center;">No module metrics are available.</td></tr>';
    const status = document.getElementById("itPerformanceStatus");
    if (status) status.innerHTML = `Database: <strong>${itEscape(String(result.health?.database || "unknown").toUpperCase())}</strong> · Capacity: <strong>${itEscape(String(result.health?.capacity || "unknown").toUpperCase())}</strong> · Performance Schema: <strong>${String(settings.performance_schema || "OFF").toUpperCase()}</strong> · Slow log: <strong>${String(settings.slow_query_log || "OFF").toUpperCase()}</strong> · Updated ${new Date(result.generatedAt).toLocaleString("en-IN")}`;
  } catch (error) { itError(error, "Server Performance"); }
};

window.openItSecuritySessions = async function(button) {
  if (await switchView("itSecuritySessions", button, "IT > User Management > Security & Sessions") === false) return;
  await window.loadItSecuritySessions();
};
window.loadItSecuritySessions = async function() {
  try {
    const [result, settings] = await Promise.all([itRequest("sessions"), itRequest("session_settings")]);
    const idle = document.getElementById("itSessionIdleMinutes");
    const absolute = document.getElementById("itSessionAbsoluteHours");
    if (idle) idle.value = Math.round(Number(settings.idleSeconds || 1800) / 60);
    if (absolute) absolute.value = Number((Number(settings.absoluteSeconds || 28800) / 3600).toFixed(1));
    const body = document.getElementById("itSessionsBody");
    if (body) body.innerHTML = result.sessions.length ? result.sessions.map(row => `<tr><td><strong>${itEscape(row.username)}</strong></td><td>${itEscape(row.source_ip || "-")}<br><small>${itEscape((row.user_agent || "").slice(0, 80))}</small></td><td>${itEscape(row.login_at)}</td><td>${itEscape(row.last_seen)}</td><td><span style="font-weight:800;color:${row.active ? "#059669" : "#94a3b8"}">${row.active ? "ACTIVE" : "CLOSED"}</span></td><td style="display:flex;gap:5px;flex-wrap:wrap;">${row.active ? `<button class="btn btn-danger" onclick="revokeItSession('${row.sessionToken}')">Force Logout</button>` : ""}<button class="btn btn-secondary" onclick="resetItUserPassword('${itEscape(row.user_legacy_id)}')">Reset Password</button><button class="btn btn-danger" onclick="disableItUser('${itEscape(row.user_legacy_id)}')">Disable</button></td></tr>`).join("") : `<tr><td colspan="6" style="text-align:center">No sessions recorded.</td></tr>`;
    const events = document.getElementById("itLoginEventsBody");
    if (events) events.innerHTML = result.loginEvents.length ? result.loginEvents.map(row => `<tr><td>${itEscape(row.event_time)}</td><td>${itEscape(row.actor_username)}</td><td>${itEscape(row.action_code)}</td><td>${itEscape(row.source_ip || "-")}</td><td>${itEscape(row.details || "")}</td></tr>`).join("") : `<tr><td colspan="5" style="text-align:center">No login events recorded.</td></tr>`;
  } catch (error) { itError(error, "Security & Sessions"); }
};
window.saveItSessionSettings = async function() {
  const idleSeconds = Math.round(Number(document.getElementById("itSessionIdleMinutes")?.value || 30) * 60);
  const absoluteSeconds = Math.round(Number(document.getElementById("itSessionAbsoluteHours")?.value || 8) * 3600);
  if (!Number.isFinite(idleSeconds) || !Number.isFinite(absoluteSeconds) || idleSeconds < 300 || absoluteSeconds < 1800) {
    return window.showNotification?.({ title: "Invalid Session Policy", message: "Idle timeout must be at least 5 minutes and maximum length at least 30 minutes.", type: "warning" });
  }
  try {
    const result = await itPost("session_settings", { idleSeconds, absoluteSeconds });
    document.getElementById("itSessionIdleMinutes").value = Math.round(Number(result.idleSeconds) / 60);
    document.getElementById("itSessionAbsoluteHours").value = Number((Number(result.absoluteSeconds) / 3600).toFixed(1));
    window.showNotification?.({ title: "Session Policy Saved", message: "The database-backed timeout policy is now active.", type: "success" });
  } catch (error) { itError(error, "Session Policy"); }
};
window.revokeItSession = async function(token) {
  if (!await window.showConfirmDialog({ title: "Force Logout", message: "End this session immediately?", confirmText: "Force Logout", isDanger: true })) return;
  try { await itPost("revoke_session", { sessionToken: token }); await loadItSecuritySessions(); window.showNotification({ title: "Session Ended", message: "The selected session was revoked.", type: "success" }); } catch (error) { itError(error); }
};
window.disableItUser = async function(userId) {
  try { await itPost("disable_user", { userId }); window.showNotification({ title: "Account Disabled", message: "The account and its active sessions were disabled.", type: "success" }); } catch (error) { itError(error); }
};
window.resetItUserPassword = async function(userId) {
  const password = await window.showPromptDialog({ title: "Reset User Password", message: "This will also end every active session for the user.", label: "New password (minimum 10 characters) *", placeholder: "Enter a strong temporary password", confirmText: "Reset Password", isDanger: true }); if (!password) return;
  try { await itPost("reset_password", { userId, password }); window.showNotification({ title: "Password Reset", message: "Password changed and active sessions revoked.", type: "success" }); } catch (error) { itError(error); }
};

window.openItAssetDashboard = async function(button) { if (await switchView("itAssetDashboard", button, "IT > Asset Management > Dashboard") === false) return; await loadItAssetDashboard(); };
window.loadItAssetDashboard = async function() {
  try { const { summary } = await itRequest("overview"); const cards = [["Total Assets",summary.total,"#0369a1"],["Available",summary.available,"#059669"],["Assigned",summary.assigned,"#7c3aed"],["In Repair",summary.repair,"#dc2626"],["Warranty Due ≤30 Days",summary.warranty,"#d97706"]]; const box=document.getElementById("itAssetSummaryCards"); if(box)box.innerHTML=cards.map(([label,value,color])=>`<div class="card" style="border-top:4px solid ${color};"><div style="font-size:12px;color:var(--muted);font-weight:800;">${label}</div><div style="font-size:30px;font-weight:900;margin-top:8px;color:${color};">${Number(value||0).toLocaleString("en-IN")}</div></div>`).join(""); } catch(error){itError(error,"IT Asset Dashboard");}
};
window.openItAssetMaster = async function(button) { if (await switchView("itAssetMaster", button, "IT > Asset Management > Asset Master") === false) return; await loadItAssets(); };
window.loadItAssets = async function() {
  try { const result=await itRequest("assets");itAssets=result.assets||[];itAssetUsers=result.users||[];renderItAssets();populateItAllocation(); } catch(error){itError(error,"Asset Master");}
};
window.renderItAssets = function() {
  const q=String(document.getElementById("itAssetSearch")?.value||"").toLowerCase();const rows=itAssets.filter(a=>JSON.stringify(a).toLowerCase().includes(q));const body=document.getElementById("itAssetsBody");if(!body)return;
  body.innerHTML=rows.length?rows.map(a=>`<tr><td><strong>${itEscape(a.asset_code)}</strong><br><small>${itEscape(a.category)}</small></td><td>${itEscape(a.asset_name)}<br><small>${itEscape([a.brand,a.model].filter(Boolean).join(" "))}</small></td><td>${itEscape(a.serial_number||"-")}</td><td>${itEscape(a.status)}</td><td>${itEscape(a.assigned_username||"-")}</td><td>${itEscape(a.warranty_until||"-")}</td><td><button class="btn btn-secondary" onclick="editItAsset(${Number(a.id)})">Edit</button></td></tr>`).join(""):`<tr><td colspan="7" style="text-align:center">No assets found.</td></tr>`;
};
window.resetItAssetForm = function(){["itAssetId","itAssetCode","itAssetName","itAssetBrand","itAssetModel","itAssetSerial","itAssetLocation","itAssetPurchaseDate","itAssetWarranty","itAssetVendor","itAssetInvoice","itAssetNotes"].forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});const status=document.getElementById("itAssetStatus");if(status)status.value="AVAILABLE";};
window.editItAsset = function(id){const a=itAssets.find(row=>Number(row.id)===Number(id));if(!a)return;const values={itAssetId:a.id,itAssetCode:a.asset_code,itAssetCategory:a.category,itAssetName:a.asset_name,itAssetStatus:a.status,itAssetBrand:a.brand,itAssetModel:a.model,itAssetSerial:a.serial_number,itAssetLocation:a.location_name,itAssetPurchaseDate:a.purchase_date,itAssetWarranty:a.warranty_until,itAssetVendor:a.vendor_name,itAssetInvoice:a.invoice_number,itAssetNotes:a.notes};Object.entries(values).forEach(([id,value])=>{const el=document.getElementById(id);if(el)el.value=value||"";});document.getElementById("view-itAssetMaster")?.scrollIntoView({behavior:"smooth"});};
window.saveItAsset = async function(){const value=id=>document.getElementById(id)?.value||"";const body={id:Number(value("itAssetId")||0),assetCode:value("itAssetCode"),category:value("itAssetCategory"),assetName:value("itAssetName"),status:value("itAssetStatus"),brand:value("itAssetBrand"),model:value("itAssetModel"),serialNumber:value("itAssetSerial"),locationName:value("itAssetLocation"),purchaseDate:value("itAssetPurchaseDate"),warrantyUntil:value("itAssetWarranty"),vendorName:value("itAssetVendor"),invoiceNumber:value("itAssetInvoice"),notes:value("itAssetNotes")};try{await itPost("save_asset",body);resetItAssetForm();await loadItAssets();window.showNotification({title:"Asset Saved",message:"The asset record was saved in the database.",type:"success"});}catch(error){itError(error,"Asset Save Failed");}};
function populateItAllocation(){const asset=document.getElementById("itAllocationAsset");if(asset)asset.innerHTML=itAssets.map(a=>`<option value="${Number(a.id)}">${itEscape(a.asset_code)} — ${itEscape(a.asset_name)} (${itEscape(a.status)})</option>`).join("");const user=document.getElementById("itAllocationUser");if(user)user.innerHTML=`<option value="">Return to IT / Available</option>`+itAssetUsers.map(u=>`<option value="${itEscape(u.id)}">${itEscape(u.name||u.username)} (@${itEscape(u.username)})</option>`).join("");}
window.openItAssetAllocation=async function(button){if(await switchView("itAssetAllocation",button,"IT > Asset Management > Allocation / Return")===false)return;await loadItAssets();};
window.saveItAssetAllocation=async function(){try{await itPost("assign_asset",{assetId:Number(document.getElementById("itAllocationAsset")?.value||0),userId:document.getElementById("itAllocationUser")?.value||"",remarks:document.getElementById("itAllocationRemarks")?.value||""});await loadItAssets();window.showNotification({title:"Allocation Saved",message:"Asset custody was updated.",type:"success"});}catch(error){itError(error,"Allocation Failed");}};

window.openItRoleTemplates=async function(button){if(await switchView("itRoleTemplates",button,"IT > User Management > Role Templates")===false)return;await loadItRoleTemplates();};
window.loadItRoleTemplates=async function(){try{const result=await itRequest("templates");itRoleTemplates=result.templates||[];itTemplateUsers=result.users||[];const sel=document.getElementById("itTemplateSelect");if(sel)sel.innerHTML=itRoleTemplates.map(t=>`<option value="${Number(t.id)}">${itEscape(t.template_name)}</option>`).join("");const options=itTemplateUsers.map(u=>`<option value="${itEscape(u.id)}">${itEscape(u.name||u.username)} (@${itEscape(u.username)})</option>`).join("");const users=document.getElementById("itTemplateUser");if(users)users.innerHTML=options;const source=document.getElementById("itTemplateSourceUser");if(source)source.innerHTML=options;showItTemplate();}catch(error){itError(error,"Role Templates");}};
window.showItTemplate=function(){const template=itRoleTemplates.find(t=>Number(t.id)===Number(document.getElementById("itTemplateSelect")?.value));const box=document.getElementById("itTemplateRights");if(box)box.innerHTML=template?Object.entries(template.permissions||{}).filter(([,yes])=>yes===true).map(([key])=>`<div style="padding:5px 0;border-bottom:1px solid #e2e8f0;">✓ ${itEscape(key)}</div>`).join(""):`No template selected.`;};
window.applyItRoleTemplate=async function(){const templateId=Number(document.getElementById("itTemplateSelect")?.value||0);const userId=document.getElementById("itTemplateUser")?.value||"";if(!await window.showConfirmDialog({title:"Apply Role Template",message:"Replace this user’s complete permission set with the selected template?",confirmText:"Apply Template"}))return;try{await itPost("apply_template",{templateId,userId});window.showNotification({title:"Template Applied",message:"Database User Rights were replaced and logged.",type:"success"});}catch(error){itError(error,"Template Application Failed");}};
window.saveItCustomTemplate=async function(){const name=document.getElementById("itNewTemplateName")?.value.trim()||"";const description=document.getElementById("itNewTemplateDescription")?.value.trim()||"";const sourceId=document.getElementById("itTemplateSourceUser")?.value||"";const source=itTemplateUsers.find(user=>String(user.id)===String(sourceId));if(!name||!source)return window.showNotification?.({title:"Template Details Required",message:"Enter a template name and select a source user.",type:"warning"});try{await itPost("save_template",{name,description,permissions:source.rights||{}});document.getElementById("itNewTemplateName").value="";document.getElementById("itNewTemplateDescription").value="";await loadItRoleTemplates();window.showNotification?.({title:"Template Saved",message:`${name} was saved from @${source.username}'s current database rights.`,type:"success"});}catch(error){itError(error,"Template Save Failed");}};

window.openItEffectiveAccess=async function(button){if(await switchView("itEffectiveAccess",button,"IT > User Management > Effective Access")===false)return;try{const result=await itRequest("effective_access_users");const select=document.getElementById("itAccessUser");if(select)select.innerHTML=(result.users||[]).map(u=>`<option value="${itEscape(u.id)}">${itEscape(u.name||u.username)} (@${itEscape(u.username)})</option>`).join("");await loadItEffectiveAccess();}catch(error){itError(error,"Effective Access");}};
window.loadItEffectiveAccess=async function(){const id=document.getElementById("itAccessUser")?.value;if(!id)return;try{const result=await itRequest("effective_access",{}, {userId:id});const rights=result.user?.rights||{};const all=[...new Set(APP_MENUS.flatMap(menu=>[menu.id,...menu.submenus.map(sub=>sub.id)]))];const allowed=all.filter(key=>rights[key]===true),blocked=all.filter(key=>rights[key]!==true);document.getElementById("itAccessSummary").innerHTML=`<div class="card" style="background:#f8fafc;"><strong>${itEscape(result.user.name||result.user.username)}</strong> · @${itEscape(result.user.username)} · ${itEscape(result.user.department||result.user.role||"")}<br><small>${allowed.length} allowed · ${blocked.length} blocked · ${Number(result.cameraCount||0)} cameras</small></div>`;document.getElementById("itAccessAllowed").innerHTML=allowed.map(key=>`<span style="display:inline-block;margin:3px;padding:5px 8px;border-radius:999px;background:#dcfce7;color:#166534;font-size:11px;font-weight:800;">${itEscape(key)}</span>`).join("")||"None";document.getElementById("itAccessBlocked").innerHTML=blocked.map(key=>`<span style="display:inline-block;margin:3px;padding:5px 8px;border-radius:999px;background:#fee2e2;color:#991b1b;font-size:11px;font-weight:800;">${itEscape(key)}</span>`).join("")||"None";document.getElementById("itAccessHistory").innerHTML=result.history.length?result.history.map(h=>`<div style="padding:9px;border-bottom:1px solid var(--border);"><strong>${itEscape(h.changed_at)}</strong> by ${itEscape(h.changed_by)}</div>`).join(""):`<div style="color:var(--muted);">No recorded template changes yet.</div>`;}catch(error){itError(error,"Effective Access");}};
