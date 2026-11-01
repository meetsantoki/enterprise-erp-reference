// Database-backed notification centre with live polling and exact-record routing.
(() => {
  const state = { items: [], unread: 0, filter: "all", started: false, timer: null, initial: true, newestId: 0, request: null };
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const icon = item => item.category === "APPROVAL" ? "✓" : item.type === "WARNING" ? "!" : item.type === "SUCCESS" ? "✓" : "i";
  const relative = value => {
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(String(value).replace(" ", "T")).getTime()) / 1000));
    if (seconds < 45) return "Just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return new Date(String(value).replace(" ", "T")).toLocaleDateString("en-IN");
  };

  async function request(filter = state.filter, payload = null) {
    const url = `backend/api.php?action=notifications&filter=${encodeURIComponent(filter)}&limit=75`;
    const response = await erpFetchWithTimeout(url, {
      method: payload ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
      headers: payload ? { "Content-Type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined
    }, 12000);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.status !== "success") throw new Error(result.message || "Notifications could not be loaded.");
    return result;
  }

  function updateBell() {
    const badge = document.getElementById("erpNotificationCount");
    const bell = document.getElementById("erpNotificationBell");
    if (badge) { badge.textContent = state.unread > 99 ? "99+" : String(state.unread); badge.hidden = state.unread < 1; }
    if (bell) {
      bell.classList.toggle("has-unread", state.unread > 0);
      bell.setAttribute("aria-label", state.unread ? `Notifications, ${state.unread} unread` : "Notifications");
    }
  }

  function render() {
    updateBell();
    document.querySelectorAll("[data-notification-filter]").forEach(button => {
      const active = button.dataset.notificationFilter === state.filter;
      button.classList.toggle("active", active);button.setAttribute("aria-pressed", String(active));
    });
    const list = document.getElementById("erpNotificationList");
    if (!list) return;
    if (!state.items.length) {
      list.innerHTML = '<div class="erp-notification-empty"><span>✓</span><strong>You are up to date</strong><small>No notifications match this filter.</small></div>';
      return;
    }
    list.innerHTML = state.items.map(item => {
      const processed = item.actionable && item.actionStatus === "PROCESSED";
      const audit = item.auditLegacyId ? `<button type="button" class="erp-notification-audit" onclick="event.stopPropagation();openNotificationAudit(${Number(item.id)})" title="Open linked audit history">Audit ${esc(item.auditLegacyId)}</button>` : "";
      return `<article class="erp-notification-item ${item.read ? "" : "unread"} ${processed ? "processed" : ""}" data-notification-id="${Number(item.id)}" tabindex="0" role="button" onclick="openErpNotification(${Number(item.id)})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openErpNotification(${Number(item.id)})}">
        <div class="erp-notification-icon type-${esc(String(item.type).toLowerCase())}">${icon(item)}</div>
        <div class="erp-notification-copy"><div class="erp-notification-title-row"><strong>${esc(item.title)}</strong>${item.read ? "" : '<span class="erp-notification-new">NEW</span>'}</div>
        <p>${esc(item.message)}</p>
        ${processed ? `<div class="erp-notification-processed">Processed by ${esc(item.processedBy || "another approver")}${item.processedAt ? ` · ${esc(relative(item.processedAt))}` : ""}</div>` : ""}
        <div class="erp-notification-meta"><span>${esc(relative(item.createdAt))}</span>${item.entityId ? `<span>${esc(item.entityType.replaceAll("_", " "))} #${esc(item.entityId)}</span>` : ""}${audit}</div></div>
        ${item.targetView ? '<span class="erp-notification-open" aria-hidden="true">›</span>' : ""}
      </article>`;
    }).join("");
  }

  async function load({ silent = false } = {}) {
    if (!window.currentLoggedInUser && typeof currentLoggedInUser !== "undefined" && !currentLoggedInUser) return;
    if (state.request) return state.request;
    state.request = request().then(result => {
      const incoming = Array.isArray(result.notifications) ? result.notifications : [];
      const newest = incoming.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
      if (!state.initial && newest > state.newestId) {
        const fresh = incoming.filter(item => Number(item.id) > state.newestId);
        if (fresh.length && !silent) window.showNotification?.({ title: fresh[0].title, message: fresh.length === 1 ? fresh[0].message : `${fresh.length} new notifications received.`, type: fresh[0].type === "WARNING" ? "warning" : "info", duration: 6500 });
      }
      state.items = incoming;state.unread = Number(result.unreadCount || 0);state.newestId = Math.max(state.newestId, newest);state.initial = false;render();
    }).catch(error => {
      if (!silent && document.getElementById("erpNotificationDrawer")?.classList.contains("open")) {
        const list=document.getElementById("erpNotificationList");if(list)list.innerHTML=`<div class="erp-notification-empty"><strong>Could not load notifications</strong><small>${esc(error.message)}</small></div>`;
      }
    }).finally(() => { state.request = null; });
    return state.request;
  }

  function schedule(delay = 10000) {
    clearTimeout(state.timer);
    if (!state.started) return;
    const jitter = Math.min(5000, Math.max(250, delay * 0.2));
    state.timer = window.setTimeout(async () => { await load({ silent: false });schedule(document.hidden ? 60000 : 20000); }, delay + Math.random() * jitter);
  }

  window.startNotificationLiveUpdates = function() {
    state.started = true;state.initial = true;state.newestId = 0;load({ silent: true });schedule(20000);
  };
  window.stopNotificationLiveUpdates = function() {
    state.started = false;clearTimeout(state.timer);state.timer = null;state.items=[];state.unread=0;state.initial=true;render();window.closeNotificationDrawer?.();
  };
  window.toggleNotificationDrawer = function(force) {
    const drawer=document.getElementById("erpNotificationDrawer"), backdrop=document.getElementById("erpNotificationBackdrop");if(!drawer)return;
    const open=typeof force==="boolean"?force:!drawer.classList.contains("open");drawer.classList.toggle("open",open);backdrop?.classList.toggle("open",open);drawer.setAttribute("aria-hidden",String(!open));document.getElementById("erpNotificationBell")?.setAttribute("aria-expanded",String(open));
    if(open){document.getElementById("profileDropdownMenu")?.classList.remove("show");load({silent:true});}
  };
  window.closeNotificationDrawer = () => window.toggleNotificationDrawer(false);
  window.setNotificationFilter = async function(filter) { state.filter=["all","unread","approvals","system"].includes(filter)?filter:"all";render();await load({silent:true}); };
  window.markAllNotificationsRead = async function() { await request(state.filter,{operation:"mark_all_read"});state.items=state.items.map(item=>({...item,read:true}));state.unread=0;render();await load({silent:true}); };
  async function markRead(item) { if(item.read)return;item.read=true;state.unread=Math.max(0,state.unread-1);render();try{await request(state.filter,{operation:"mark_read",id:item.id});}catch(_){await load({silent:true});} }

  async function routeToRecord(item) {
    if(item.targetView === "hrTourExpenses") {
      const requestedScope=item.targetPayload?.scope || (item.actionStatus === "PENDING" ? "pending" : "mine");
      const scope=item.processedBy && requestedScope === "pending" ? "record" : requestedScope;
      await window.openHrTourExpenses?.(document.getElementById(scope === "pending" || scope === "record" ? "navSub-hrTourExpensesApprove" : "navSub-hrTourExpenses"),scope,Number(item.targetPayload?.tripId || item.entityId));
      const card=document.querySelector(`[data-trip-id="${CSS.escape(String(item.targetPayload?.tripId || item.entityId))}"]`);
      if(card){card.classList.add("erp-record-highlight");card.scrollIntoView({behavior:"smooth",block:"center"});window.setTimeout(()=>card.classList.remove("erp-record-highlight"),3200);}
      return;
    }
    const custom=window.erpNotificationRouteHandlers?.[item.entityType];
    if(typeof custom==="function"){await custom(item);return;}
    if(item.targetView && typeof window.switchView === "function") await window.switchView(item.targetView,null,item.title);
  }
  window.openErpNotification = async function(id) { const item=state.items.find(entry=>Number(entry.id)===Number(id));if(!item)return;await markRead(item);window.closeNotificationDrawer();await routeToRecord(item); };
  window.openNotificationAudit = async function(id) { const item=state.items.find(entry=>Number(entry.id)===Number(id));if(!item)return;await markRead(item);window.closeNotificationDrawer();if(typeof window.openLogsHubView==="function")await window.openLogsHubView(document.getElementById("navMain-logs"));window.showNotification?.({title:"Linked audit history",message:`Audit reference ${item.auditLegacyId || item.auditEventId} is permanently linked to this approval notification.`,type:"info",duration:7000}); };

  window.erpNotificationRouteHandlers = window.erpNotificationRouteHandlers || {};
  window.erpNotificationRouteHandlers.PURCHASE_ORDER = async item => {
    const pending=item.actionStatus === "PENDING" && item.targetView === "purchaseOrderApprovals";
    await window.switchView?.(pending?"purchaseOrderApprovals":"purchaseOrderView",pending?document.getElementById("navSub-purchaseOrderApprovals"):document.getElementById("navSub-purchaseOrderView"),pending?"Purchase > PO > Approve PO":"Purchase > PO > View PO");
    if(pending && typeof window.openPurchaseOrderApprovalReview === "function")window.openPurchaseOrderApprovalReview(String(item.targetPayload?.orderId || item.entityId));
    const row=document.querySelector(`[data-purchase-order-id="${CSS.escape(String(item.targetPayload?.orderId || item.entityId))}"]`);if(row){row.classList.add("erp-record-highlight");row.scrollIntoView({behavior:"smooth",block:"center"});window.setTimeout(()=>row.classList.remove("erp-record-highlight"),3200);}
  };

  document.addEventListener("visibilitychange",()=>{if(state.started&&!document.hidden){load({silent:true});schedule(10000);}});
  window.addEventListener("focus",()=>{if(state.started)load({silent:true});});
})();
