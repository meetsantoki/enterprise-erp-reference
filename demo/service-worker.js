const CACHE_NAME = "demosolar-erp-security-v319-approval-request-history-fix";
const APP_SHELL = [
  "./",
  "./index.html",
  "./mobile.css?v=20261023-login-bottom-center-4",
  "./assets/login-graffiti.css?v=20261030-login-credit-v8",
  "./assets/utilities.css?v=20261024-pdf-studio-v1",
  "./assets/pdf-studio-v2.css?v=20261025-signature-preview-v9",
  "./assets/saved-documents.css?v=20261025-saved-documents-live-v3",
  "./assets/tour-expenses.css?v=20261101-reimburse-summary-v7",
  "./assets/request-routes.css?v=20261031-full-width-route-form-v2",
  "./js/00-core.js?v=20261101-approval-request-fix-v22",
  "./js/05-notifications.js?v=20261030-erp-150-users-v2",
  "./js/10-dashboards-production.js?v=20261031-scoped-route-assignee-v7",
  "./js/20-navigation-store.js?v=20261101-user-level-v11",
  "./js/30-reports-sales-purchase.js?v=20261030-sales-orders-group-v4",
  "./js/35-purchase-orders.js?v=20261024-notifications-v1",
  "./js/40-accounts.js?v=20261027-accounts-report-customer-input-v4",
  "./js/50-packing-dispatch-masters.js?v=20261101-recharge-menu-v7",
  "./assets/cctv.css?v=20261009-unified-theme-v17",
  "./assets/erp-library-loader.js?v=20261030-packing-excel-v4",
  "./js/55-cctv.js?v=20261013-strict-user-rights-v2",
  "./js/56-it-management.js?v=20261030-performance-monitor-v3",
  "./js/57-hr-attendance.js?v=20261016-cosec-live-v1",
  "./js/59-request-routes.js?v=20261031-all-active-route-users-v4",
  "./js/65-tour-expenses.js?v=20261101-reimburse-summary-v23",
  "./js/60-packing-list-exports.js?v=20261030-packing-excel-v65",
  "./js/70-ui-selects.js?v=20261012-searchable-dispatch-v2",
  "./js/75-utilities.js?v=20261025-signature-preview-v9",
  "./js/80-approvals-workflows.js?v=20261031-scoped-route-assignee-v10",
  "./js/58-nfc-cards.js?v=20261016-nfc-v8",
  "./js/90-audit-runtime.js?v=20261029-erp-performance-v2",
  "./js/95-sticky-table-headers.js?v=20261023-sticky-table-dashboard-filters-v6",
  "./assets/demo-logo.svg",
  "./assets/demo-logo.svg",
  "./assets/demo-background.svg",
  "./assets/demo-signature.svg",
  "./assets/demo-signature.svg",
  "./assets/vendor-locations.json"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Let video requests reach Apache directly so byte-range streaming works and
  // the large login background video is not copied into the app cache.
  if (/\.(?:mp4|webm|ogg)$/i.test(url.pathname)) return;

  // Authentication, ERP records and uploaded documents must always come from
  // the live server and are never stored in the application cache.
  const privatePath = /\/(?:data|tmp|output|notes|backups|ERP_PERSISTENT_DATA)(?:\/|$)/i.test(url.pathname);
  if (privatePath || url.pathname.includes("/backend/") || url.pathname.includes("/cctv-stream/") || url.pathname.includes("/photos/") || url.pathname.includes("/certificate/") || url.pathname.includes("/vendor_documents/")) return;

  const updateCache = response => {
    if (response?.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    return response;
  };

  // Repeat visits use cached versioned assets immediately while the service
  // worker refreshes them in the background.
  const isStaticAsset = /\.(?:js|css|json|png|jpe?g|gif|svg|webp|ico|woff2?)(?:$|\?)/i.test(url.pathname + url.search);
  if (isStaticAsset && request.mode !== "navigate") {
    event.respondWith(
      caches.match(request).then(cached => {
        const network = fetch(request).then(updateCache).catch(() => null);
        return cached || network.then(response => response || Promise.reject(new Error("Offline resource unavailable")));
      })
    );
    return;
  }

  // HTML stays network-first so deployments advertise their new asset version
  // immediately; the cached shell remains available when offline.
  event.respondWith(
    fetch(request)
      .then(updateCache)
      .catch(() => caches.match(request).then(cached => cached || (request.mode === "navigate" ? caches.match("./index.html") : Promise.reject(new Error("Offline resource unavailable")))))
  );
});
