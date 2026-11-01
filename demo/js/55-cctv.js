/* CCTV live monitoring and per-camera access control. NVR credentials never enter browser code. */
let cctvInventory = [];
let cctvAdminData = { users: [], cameras: [], access: [] };
let cctvPlayers = [];
let cctvNextSlot = 0;
let cctvPlaybackPlayer = null;
let cctvExpandedSlot = null;
let cctvAutoRotateTimer = null;
let cctvAutoRotateNextAt = 0;
let cctvAutoRotateCursor = 0;
let cctvAutoRotateBusy = false;

function cctvEscape(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

async function cctvRequest(action, options = {}) {
  const response = await erpFetchWithTimeout(`backend/cctv.php?action=${encodeURIComponent(action)}`, {
    credentials: "same-origin",
    ...options
  }, 20000);
  const result = await response.json().catch(() => ({ status: "error", message: "The CCTV server returned an invalid response." }));
  if (!response.ok || result.status !== "success") throw new Error(result.message || "The CCTV request could not be completed.");
  return result;
}

function cctvNotifyError(error, title = "CCTV Unavailable") {
  window.showNotification?.({ title, message: error?.message || "The CCTV service could not be reached.", type: "danger" });
}

function cctvEmptySlotMarkup(index) {
  return `<div class="cctv-slot-empty"><span class="cctv-empty-icon">▣</span><strong>Monitor ${Number(index) + 1}</strong><small>Select a camera from the directory</small></div>`;
}

function cctvUpdateLiveSummary() {
  const active = cctvPlayers.filter(Boolean).length;
  const count = document.getElementById("cctvActiveCount");
  if (count) count.textContent = String(active);
  document.querySelectorAll("#cctvCameraPicker .cctv-camera-button").forEach(button => {
    button.classList.toggle("is-open", cctvPlayers.some(player => Number(player?.cameraId) === Number(button.dataset.cameraId)));
  });
}

function cctvRotationCameras() {
  return cctvInventory.filter(camera => camera.enabled && camera.can_live);
}

function cctvUpdateRotateStatus(text) {
  const status = document.getElementById("cctvRotateStatus");
  if (status) text ? status.textContent = text : status.textContent = "Auto rotate off";
}

function cctvStopAutoRotate(updateControl = true) {
  if (cctvAutoRotateTimer) window.clearInterval(cctvAutoRotateTimer);
  cctvAutoRotateTimer = null;
  cctvAutoRotateNextAt = 0;
  cctvAutoRotateBusy = false;
  if (updateControl) {
    const control = document.getElementById("cctvAutoRotate");
    if (control) control.value = "off";
  }
  cctvUpdateRotateStatus("Auto rotate off");
}

async function cctvShowNextCameraPage() {
  const cameras = cctvRotationCameras();
  const slots = [...document.querySelectorAll("#cctvVideoGrid .cctv-video-slot")];
  if (!cameras.length || !slots.length) return;
  const visibleCount = Math.min(slots.length, cameras.length);
  const page = Array.from({ length: visibleCount }, (_, offset) => cameras[(cctvAutoRotateCursor + offset) % cameras.length]);
  cctvAutoRotateCursor = (cctvAutoRotateCursor + visibleCount) % cameras.length;
  for (let index = visibleCount; index < slots.length; index += 1) {
    cctvDestroyPlayer(index);
    slots[index].classList.remove("has-camera");
    slots[index].innerHTML = cctvEmptySlotMarkup(index);
  }
  await Promise.all(page.map((camera, index) => cctvPlayCamera(index, camera)));
  cctvUpdateLiveSummary();
}

function cctvScheduleAutoRotate() {
  if (cctvAutoRotateTimer) window.clearInterval(cctvAutoRotateTimer);
  cctvAutoRotateTimer = null;
  const cameras = cctvRotationCameras();
  const slotCount = document.querySelectorAll("#cctvVideoGrid .cctv-video-slot").length;
  if (document.getElementById("cctvAutoRotate")?.value !== "on") return cctvStopAutoRotate(false);
  if (!cameras.length) {
    cctvUpdateRotateStatus("No cameras available");
    return;
  }
  if (cameras.length <= slotCount) {
    cctvUpdateRotateStatus("All cameras displayed");
    return;
  }
  const seconds = Math.max(15, Number(document.getElementById("cctvRotateSeconds")?.value || 30));
  cctvAutoRotateNextAt = Date.now() + seconds * 1000;
  const tick = async () => {
    if (document.getElementById("cctvAutoRotate")?.value !== "on") return cctvStopAutoRotate(false);
    const remaining = Math.max(0, Math.ceil((cctvAutoRotateNextAt - Date.now()) / 1000));
    cctvUpdateRotateStatus(`Next change in ${remaining}s`);
    if (remaining > 0 || cctvAutoRotateBusy) return;
    cctvAutoRotateBusy = true;
    cctvAutoRotateNextAt = Date.now() + seconds * 1000;
    try { await cctvShowNextCameraPage(); }
    finally {
      cctvAutoRotateBusy = false;
      cctvAutoRotateNextAt = Date.now() + seconds * 1000;
    }
  };
  tick();
  cctvAutoRotateTimer = window.setInterval(tick, 1000);
}

window.setCctvAutoRotate = async function() {
  if (document.getElementById("cctvAutoRotate")?.value !== "on") return cctvStopAutoRotate(false);
  cctvClearFocus();
  cctvAutoRotateCursor = 0;
  cctvAutoRotateBusy = true;
  try { await cctvShowNextCameraPage(); }
  finally { cctvAutoRotateBusy = false; cctvScheduleAutoRotate(); }
};

window.updateCctvAutoRotateInterval = function() {
  if (document.getElementById("cctvAutoRotate")?.value === "on") cctvScheduleAutoRotate();
};

window.openCctvLiveView = async function(button) {
  const opened = await window.switchView("cctvLive", button, "CCTV MONITORING > LIVE CAMERAS");
  if (opened === false) return;
  await window.refreshCctvLiveView();
};

window.refreshCctvLiveView = async function() {
  const picker = document.getElementById("cctvCameraPicker");
  if (picker) picker.innerHTML = '<div class="cctv-slot-loading">Loading authorised cameras…</div>';
  try {
    const result = await cctvRequest("inventory");
    cctvInventory = Array.isArray(result.cameras) ? result.cameras : [];
    const notice = document.getElementById("cctvGatewayNotice");
    if (notice) {
      notice.style.display = result.gatewayConfigured ? "none" : "block";
      notice.textContent = result.gatewayConfigured ? "" : "The browser video gateway is not configured yet. Camera permissions can be prepared, but live tiles will remain unavailable until server setup is completed.";
    }
    cctvPopulateNvrFilter("cctvNvrFilter", cctvInventory);
    window.renderCctvCameraPicker();
    if (!document.querySelector("#cctvVideoGrid .cctv-video-slot")) window.changeCctvLayout();
  } catch (error) {
    if (picker) picker.innerHTML = `<div class="cctv-slot-error">${cctvEscape(error.message)}</div>`;
    cctvNotifyError(error);
  }
};

function cctvPopulateNvrFilter(selectId, cameras) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const selected = select.value || "ALL";
  const nvrs = new Map();
  cameras.forEach(camera => nvrs.set(String(camera.nvr_id), camera.device_name));
  select.innerHTML = '<option value="ALL">All NVRs</option>' + [...nvrs.entries()].map(([id, name]) => `<option value="${cctvEscape(id)}">${cctvEscape(name)}</option>`).join("");
  select.value = [...select.options].some(option => option.value === selected) ? selected : "ALL";
}

window.renderCctvCameraPicker = function() {
  const container = document.getElementById("cctvCameraPicker");
  if (!container) return;
  const nvr = document.getElementById("cctvNvrFilter")?.value || "ALL";
  const search = String(document.getElementById("cctvCameraSearch")?.value || "").trim().toLowerCase();
  const cameras = cctvInventory.filter(camera => camera.enabled && camera.can_live && (nvr === "ALL" || String(camera.nvr_id) === nvr) && (!search || `${camera.camera_name} ${camera.location_name || ""} ${camera.device_name}`.toLowerCase().includes(search)));
  const count = document.getElementById("cctvCameraCount");
  if (count) count.textContent = String(cameras.length);
  container.innerHTML = cameras.length ? cameras.map(camera => {
    const channel = String(Number(camera.channel_no)).padStart(2, "0");
    const open = cctvPlayers.some(player => Number(player?.cameraId) === Number(camera.id));
    return `<button type="button" class="cctv-camera-button${open ? " is-open" : ""}" data-camera-id="${Number(camera.id)}" onclick="selectCctvCamera(${Number(camera.id)})"><span class="cctv-channel-badge">CH ${channel}</span><span class="cctv-camera-copy"><strong>${cctvEscape(camera.camera_name)}</strong><small>${cctvEscape(camera.device_name)}${camera.location_name ? ` · ${cctvEscape(camera.location_name)}` : ""}</small></span><span class="cctv-camera-add" aria-hidden="true">+</span></button>`;
  }).join("") : '<div class="cctv-camera-empty"><strong>No cameras found</strong><small>Try a different recorder or search.</small></div>';
};

window.changeCctvLayout = function() {
  const count = Number(document.getElementById("cctvLayout")?.value || 4);
  const keepRotating = document.getElementById("cctvAutoRotate")?.value === "on";
  window.stopAllCctvStreams(keepRotating);
  const grid = document.getElementById("cctvVideoGrid");
  if (!grid) return;
  grid.className = `cctv-video-grid layout-${count}`;
  grid.innerHTML = Array.from({ length: count }, (_, index) => `<article class="cctv-video-slot" data-slot="${index}" ondblclick="toggleCctvFocus(${index})" title="Double-click an active camera to enlarge">${cctvEmptySlotMarkup(index)}</article>`).join("");
  cctvPlayers = Array(count).fill(null);
  cctvNextSlot = 0;
  cctvUpdateLiveSummary();
  if (keepRotating) window.setCctvAutoRotate();
};

function cctvClearFocus() {
  const grid = document.getElementById("cctvVideoGrid");
  grid?.classList.remove("is-focus-mode");
  grid?.querySelectorAll(".cctv-video-slot").forEach(slot => slot.classList.remove("is-focused"));
  cctvExpandedSlot = null;
}

window.toggleCctvFocus = function(index) {
  const slotIndex = Number(index);
  if (!cctvPlayers[slotIndex]) return;
  if (cctvExpandedSlot === slotIndex) {
    cctvClearFocus();
    return;
  }
  cctvStopAutoRotate();
  cctvClearFocus();
  const grid = document.getElementById("cctvVideoGrid");
  const slot = grid?.querySelector(`[data-slot="${slotIndex}"]`);
  if (!grid || !slot) return;
  cctvExpandedSlot = slotIndex;
  grid.classList.add("is-focus-mode");
  slot.classList.add("is-focused");
};

function cctvDestroyPlayer(index) {
  const player = cctvPlayers[index];
  if (player?.timer) window.clearTimeout(player.timer);
  if (player?.hls) player.hls.destroy();
  const video = player?.video;
  if (video) { try { video.pause(); } catch (_) {} video.removeAttribute("src"); video.load(); }
  cctvPlayers[index] = null;
}

window.stopCctvSlot = function(index) {
  cctvStopAutoRotate();
  if (cctvExpandedSlot === Number(index)) cctvClearFocus();
  cctvDestroyPlayer(index);
  const slot = document.querySelector(`#cctvVideoGrid [data-slot="${Number(index)}"]`);
  if (slot) { slot.classList.remove("has-camera"); slot.innerHTML = cctvEmptySlotMarkup(index); }
  cctvUpdateLiveSummary();
};

window.stopAllCctvStreams = function(preserveAutoRotate = false) {
  if (preserveAutoRotate) {
    if (cctvAutoRotateTimer) window.clearInterval(cctvAutoRotateTimer);
    cctvAutoRotateTimer = null;
    cctvAutoRotateBusy = false;
    cctvUpdateRotateStatus("Updating layout…");
  } else cctvStopAutoRotate();
  cctvClearFocus();
  cctvPlayers.forEach((_, index) => cctvDestroyPlayer(index));
  document.querySelectorAll("#cctvVideoGrid .cctv-video-slot").forEach((slot, index) => { slot.classList.remove("has-camera"); slot.innerHTML = cctvEmptySlotMarkup(index); });
  cctvNextSlot = 0;
  cctvUpdateLiveSummary();
};

window.selectCctvCamera = async function(cameraId) {
  cctvStopAutoRotate();
  const camera = cctvInventory.find(record => Number(record.id) === Number(cameraId));
  if (!camera) return;
  if (!cctvPlayers.length) window.changeCctvLayout();
  let slotIndex = cctvPlayers.findIndex(player => player === null);
  if (slotIndex < 0) slotIndex = cctvNextSlot % cctvPlayers.length;
  cctvNextSlot = (slotIndex + 1) % cctvPlayers.length;
  await cctvPlayCamera(slotIndex, camera);
};

async function cctvPlayCamera(slotIndex, camera) {
  const slot = document.querySelector(`#cctvVideoGrid [data-slot="${Number(slotIndex)}"]`);
  if (!slot) return;
  cctvDestroyPlayer(slotIndex);
  slot.classList.add("has-camera");
  slot.innerHTML = `<div class="cctv-slot-header"><div class="cctv-slot-identity"><i></i><span><strong>${cctvEscape(camera.camera_name)}</strong><small>${cctvEscape(camera.device_name)} · CH ${Number(camera.channel_no)}</small></span></div><button type="button" class="cctv-slot-close" onclick="stopCctvSlot(${slotIndex})" title="Close camera" aria-label="Close ${cctvEscape(camera.camera_name)}">✕</button></div>`;
  try {
    const requestToken = () => cctvRequest("stream_token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cameraId: camera.id, quality: "main" }) });
    const result = await requestToken();
    const video = document.createElement("video");
    video.className = "cctv-live-video";
    video.controls = false; video.muted = true; video.autoplay = true; video.playsInline = true;
    video.disablePictureInPicture = true; video.setAttribute("controlslist", "nodownload noplaybackrate noremoteplayback");
    video.style.visibility = "hidden";
    video.addEventListener("playing", () => { video.style.visibility = "visible"; }, { once: true });
    slot.querySelector(".cctv-slot-loading")?.remove(); slot.appendChild(video);
    const player = { hls: null, video, timer: null, cameraId: camera.id, token: result.token };
    cctvPlayers[slotIndex] = player;
    let hls = null;
    if (window.Hls?.isSupported()) {
      hls = new window.Hls({ lowLatencyMode: true, liveSyncDurationCount: 2, backBufferLength: 0, xhrSetup: xhr => {
        const active = cctvPlayers[slotIndex];
        if (active === player && active.token) xhr.setRequestHeader("Authorization", `Bearer ${active.token}`);
      } });
      player.hls = hls;
      hls.loadSource(result.streamUrl); hls.attachMedia(video);
      hls.on(window.Hls.Events.ERROR, (_event, data) => { if (data?.fatal) cctvRenderSlotError(slot, "Stream interrupted. Select the camera again or refresh."); });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = `${result.streamUrl}?token=${encodeURIComponent(result.token)}`;
    } else throw new Error("This browser does not support the CCTV video player.");
    const scheduleRenewal = expiresIn => {
      const refreshDelay = Math.max(30000, (Number(expiresIn || 120) - 20) * 1000);
      if (!hls) {
        player.timer = window.setTimeout(() => { if (cctvPlayers[slotIndex] === player) cctvPlayCamera(slotIndex, camera); }, refreshDelay);
        return;
      }
      const renew = async () => {
        if (cctvPlayers[slotIndex] !== player) return;
        try {
          const renewed = await requestToken();
          if (cctvPlayers[slotIndex] !== player) return;
          player.token = renewed.token;
          scheduleRenewal(renewed.expiresIn);
        } catch (_) {
          if (cctvPlayers[slotIndex] === player) player.timer = window.setTimeout(renew, 10000);
        }
      };
      player.timer = window.setTimeout(renew, refreshDelay);
    };
    scheduleRenewal(result.expiresIn);
    cctvUpdateLiveSummary();
    video.play().catch(() => {});
  } catch (error) { cctvDestroyPlayer(slotIndex); slot.classList.remove("has-camera"); cctvRenderSlotError(slot, error.message); cctvUpdateLiveSummary(); cctvNotifyError(error, "Camera Could Not Start"); }
}

function cctvRenderSlotError(slot, message) {
  slot.querySelector("video")?.remove();
  let loading = slot.querySelector(".cctv-slot-loading");
  if (!loading) { loading = document.createElement("div"); loading.className = "cctv-slot-loading"; slot.appendChild(loading); }
  loading.classList.add("cctv-slot-error"); loading.textContent = message;
}

function cctvLocalDateTimeValue(date) {
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

window.openCctvPlaybackView = async function(button) {
  window.stopAllCctvStreams();
  const opened = await window.switchView("cctvPlayback", button, "CCTV MONITORING > RECORDING PLAYBACK");
  if (opened === false) return;
  const to = new Date();
  const from = new Date(to.getTime() - 15 * 60 * 1000);
  const fromInput = document.getElementById("cctvPlaybackFrom");
  const toInput = document.getElementById("cctvPlaybackTo");
  if (fromInput && !fromInput.value) fromInput.value = cctvLocalDateTimeValue(from);
  if (toInput && !toInput.value) toInput.value = cctvLocalDateTimeValue(to);
  try {
    const result = await cctvRequest("playback_inventory");
    const cameras = (result.cameras || []).filter(camera => camera.enabled && camera.can_playback);
    const select = document.getElementById("cctvPlaybackCamera");
    if (select) select.innerHTML = cameras.length ? cameras.map(camera => `<option value="${Number(camera.id)}">${cctvEscape(camera.device_name)} · CH ${Number(camera.channel_no)} · ${cctvEscape(camera.camera_name)}</option>`).join("") : '<option value="">No recording access assigned</option>';
    const notice = document.getElementById("cctvPlaybackNotice");
    if (notice) { notice.style.display = result.gatewayConfigured ? "none" : "block"; notice.textContent = result.gatewayConfigured ? "" : "The browser video gateway must be installed before recordings can play."; }
  } catch (error) { cctvNotifyError(error, "Playback Unavailable"); }
};

window.stopCctvPlayback = function() {
  if (cctvPlaybackPlayer?.refreshTimer) window.clearTimeout(cctvPlaybackPlayer.refreshTimer);
  if (cctvPlaybackPlayer?.hls) cctvPlaybackPlayer.hls.destroy();
  const video = document.getElementById("cctvPlaybackVideo");
  if (video) { try { video.pause(); } catch (_) {} video.removeAttribute("src"); video.load(); video.style.display = "none"; }
  const empty = document.getElementById("cctvPlaybackEmpty");
  if (empty) { empty.style.display = "flex"; empty.textContent = "Choose a camera and recording time range."; empty.classList.remove("cctv-slot-error"); }
  cctvPlaybackPlayer = null;
};

window.playCctvRecording = async function() {
  const cameraId = Number(document.getElementById("cctvPlaybackCamera")?.value || 0);
  const fromValue = document.getElementById("cctvPlaybackFrom")?.value || "";
  const toValue = document.getElementById("cctvPlaybackTo")?.value || "";
  const begin = Math.floor(new Date(fromValue).getTime() / 1000);
  const end = Math.floor(new Date(toValue).getTime() / 1000);
  if (!cameraId || !Number.isFinite(begin) || !Number.isFinite(end) || end <= begin) {
    window.showNotification?.({ title: "Invalid Recording Range", message: "Select a camera and a valid From/To time range.", type: "warning" });
    return;
  }
  if (end - begin > 21600) {
    window.showNotification?.({ title: "Range Too Large", message: "Select a recording period of up to 6 hours.", type: "warning" });
    return;
  }
  window.stopCctvPlayback();
  const video = document.getElementById("cctvPlaybackVideo");
  const empty = document.getElementById("cctvPlaybackEmpty");
  if (empty) { empty.style.display = "flex"; empty.textContent = "Searching the NVR recording…"; }
  let currentToken = "";
  const requestToken = async () => {
    const result = await cctvRequest("playback_token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cameraId, begin, end }) });
    currentToken = result.token;
    return result;
  };
  try {
    const result = await requestToken();
    if (empty) empty.style.display = "none";
    video.style.display = "block";
    let hls = null;
    if (window.Hls?.isSupported()) {
      hls = new window.Hls({ lowLatencyMode: false, backBufferLength: 30, xhrSetup: xhr => xhr.setRequestHeader("Authorization", `Bearer ${currentToken}`) });
      hls.loadSource(result.streamUrl); hls.attachMedia(video);
      hls.on(window.Hls.Events.ERROR, (_event, data) => { if (data?.fatal && empty) { empty.style.display = "flex"; empty.textContent = "Recording is unavailable for this camera and time range."; empty.classList.add("cctv-slot-error"); } });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) video.src = `${result.streamUrl}?token=${encodeURIComponent(currentToken)}`;
    else throw new Error("This browser does not support recording playback.");
    const refresh = async () => {
      try { const renewed = await requestToken(); if (cctvPlaybackPlayer) cctvPlaybackPlayer.refreshTimer = window.setTimeout(refresh, Math.max(30000, (Number(renewed.expiresIn || 120) - 20) * 1000)); } catch (_) {}
    };
    const refreshTimer = window.setTimeout(refresh, Math.max(30000, (Number(result.expiresIn || 120) - 20) * 1000));
    cctvPlaybackPlayer = { hls, refreshTimer };
    video.play().catch(() => {});
  } catch (error) {
    if (empty) { empty.style.display = "flex"; empty.textContent = error.message; empty.classList.add("cctv-slot-error"); }
    cctvNotifyError(error, "Recording Could Not Start");
  }
};

window.openCctvAdminView = async function(button) {
  await window.openUserRightsView?.(button);
};

window.loadCctvAdminData = async function() {
  try {
    const result = await cctvRequest("admin_data");
    cctvAdminData = { users: result.users || [], cameras: result.cameras || [], access: result.access || [] };
    cctvPopulateNvrFilter("cctvAdminNvrFilter", cctvAdminData.cameras);
    window.renderCctvAccessTable();
    renderCctvCameraAdminTable();
  } catch (error) { cctvNotifyError(error, "Access Control Unavailable"); }
};

function cctvExistingAccess(userId, cameraId) {
  return cctvAdminData.access.find(row => String(row.userId) === String(userId) && Number(row.cameraId) === Number(cameraId)) || {};
}

window.renderCctvAccessTable = function() {
  const body = document.getElementById("cctvAccessBody");
  if (!body) return;
  const userId = document.getElementById("rightsSelectUser")?.value || "";
  const nvr = document.getElementById("cctvAdminNvrFilter")?.value || "ALL";
  const rows = cctvAdminData.cameras.filter(camera => nvr === "ALL" || String(camera.nvr_id) === nvr);
  body.innerHTML = rows.length ? rows.map(camera => { const access = cctvExistingAccess(userId, camera.id); return `<tr data-camera-id="${Number(camera.id)}"><td>${cctvEscape(camera.device_name)}</td><td>${Number(camera.channel_no)}</td><td><strong>${cctvEscape(camera.camera_name)}</strong><div style="font-size:10px;color:#64748b">${cctvEscape(camera.location_name || "No location")}${camera.enabled ? "" : " · DISABLED"}</div></td>${["live","playback","download"].map(permission => `<td><input type="checkbox" data-cctv-permission="${permission}" ${access[permission] ? "checked" : ""}></td>`).join("")}</tr>`; }).join("") : '<tr><td colspan="6" style="text-align:center;padding:20px;color:#64748b">No cameras found.</td></tr>';
};

window.setAllCctvAccess = function(permission, checked) {
  document.querySelectorAll("#cctvAccessBody tr[data-camera-id]").forEach(row => {
    if (permission === "all") row.querySelectorAll("input[type=checkbox]").forEach(box => { box.checked = checked; });
    else { const box = row.querySelector(`[data-cctv-permission="${permission}"]`); if (box) box.checked = checked; }
  });
};

window.saveCctvUserAccess = async function() {
  const userId = document.getElementById("rightsSelectUser")?.value || "";
  if (!userId) return;
  const visible = new Map();
  document.querySelectorAll("#cctvAccessBody tr[data-camera-id]").forEach(row => {
    const cameraId = Number(row.dataset.cameraId);
    visible.set(cameraId, { cameraId, live: row.querySelector('[data-cctv-permission="live"]')?.checked || false, playback: row.querySelector('[data-cctv-permission="playback"]')?.checked || false, download: row.querySelector('[data-cctv-permission="download"]')?.checked || false });
  });
  const retained = cctvAdminData.access.filter(row => String(row.userId) === String(userId) && !visible.has(Number(row.cameraId)));
  const access = [...retained, ...visible.values()];
  try {
    await cctvRequest("save_access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, access }) });
    window.showNotification?.({ title: "Camera Access Saved", message: "The selected user's camera permissions were updated.", type: "success" });
    await window.loadCctvAdminData();
  } catch (error) { cctvNotifyError(error, "Permissions Not Saved"); }
};

function renderCctvCameraAdminTable() {
  const body = document.getElementById("cctvCameraAdminBody");
  if (!body) return;
  body.innerHTML = cctvAdminData.cameras.map(camera => `<tr data-admin-camera-id="${Number(camera.id)}"><td>${cctvEscape(camera.device_name)}</td><td>${Number(camera.channel_no)}</td><td><input class="cctv-camera-input" data-field="name" value="${cctvEscape(camera.camera_name)}" maxlength="160"></td><td><input class="cctv-camera-input" data-field="location" value="${cctvEscape(camera.location_name || "")}" maxlength="160" placeholder="e.g. Main Gate"></td><td><input type="checkbox" data-field="enabled" ${camera.enabled ? "checked" : ""}></td><td><button class="btn btn-secondary" onclick="saveCctvCamera(${Number(camera.id)})">Save</button></td></tr>`).join("");
}

window.saveCctvCamera = async function(cameraId) {
  const row = document.querySelector(`#cctvCameraAdminBody [data-admin-camera-id="${Number(cameraId)}"]`);
  if (!row) return;
  const payload = { cameraId, name: row.querySelector('[data-field="name"]')?.value.trim(), location: row.querySelector('[data-field="location"]')?.value.trim(), enabled: row.querySelector('[data-field="enabled"]')?.checked || false };
  try {
    await cctvRequest("save_camera", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    window.showNotification?.({ title: "Camera Updated", message: "Camera name, location and status were saved.", type: "success" });
    await window.loadCctvAdminData();
  } catch (error) { cctvNotifyError(error, "Camera Not Saved"); }
};

window.addEventListener("beforeunload", () => { window.stopAllCctvStreams(); window.stopCctvPlayback(); });
