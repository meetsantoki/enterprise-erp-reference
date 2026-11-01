/* DemoSolar NFC employee card profiles. This is separate from ERP login accounts. */
const NFC_CARD_BASE_URL = new URL("card.php", window.location.href).href;
const NFC_CARD_FIELDS = [
  ["nfcCardName", "fullName"], ["nfcCardTitle", "jobTitle"], ["nfcCardDepartment", "department"],
  ["nfcCardPhone", "phone"], ["nfcCardWhatsapp", "whatsapp"], ["nfcCardEmail", "email"],
  ["nfcCardAddress", "officeAddress"], ["nfcCardLinkedin", "linkedin"], ["nfcCardInstagram", "instagram"],
  ["nfcCardWebsite", "website"], ["nfcCardMaps", "googleMaps"]
];
let nfcBrochureUploadInProgress = false;

function nfcEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function nfcCardUrl(cardId) {
  return NFC_CARD_BASE_URL + "?id=" + encodeURIComponent(String(cardId || ""));
}
function normalizeNfcWhatsAppLink(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "wa.me" || url.username || url.password || url.search || url.hash) return null;
    const match = url.pathname.match(/^\/91(\d{10})\/?$/);
    return match ? `https://wa.me/91${match[1]}` : null;
  } catch (_) { return null; }
}
function ensureNfcCardId() {
  const input = document.getElementById("nfcCardId");
  if (input && !input.value) input.value = createNfcCardId();
  return input?.value || createNfcCardId();
}
function createNfcCardId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let id = "SB";
  for (const byte of bytes) id += alphabet[byte % alphabet.length];
  while ((nfcCardsDb || []).some(card => card.id === id)) id = createNfcCardId();
  return id;
}
function readNfcCardForm() {
  const card = { id: document.getElementById("nfcCardId").value.trim() || createNfcCardId() };
  NFC_CARD_FIELDS.forEach(([elementId, property]) => { card[property] = document.getElementById(elementId).value.trim(); });
  // Keep the uploaded photo URL with the profile record; the upload handler
  // stores it in this hidden field before the user saves the profile.
  card.photoUrl = document.getElementById("nfcCardPhoto").value.trim();
  card.brochureUrl = document.getElementById("nfcCardBrochure").value.trim();
  card.publicApproved = document.getElementById("nfcCardApproved").checked;
  card.updatedAt = new Date().toISOString();
  return card;
}
function fillNfcCardForm(card = {}) {
  document.getElementById("nfcCardId").value = card.id || createNfcCardId();
  NFC_CARD_FIELDS.forEach(([elementId, property]) => { document.getElementById(elementId).value = card[property] || ""; });
  document.getElementById("nfcCardPhoto").value = card.photoUrl || "";
  document.getElementById("nfcCardBrochure").value = card.brochureUrl || "";
  document.getElementById("nfcCardPhotoUpload").value = "";
  document.getElementById("nfcCardBrochureUpload").value = "";
  const photoStatus = document.getElementById("nfcCardPhotoStatus");
  const photoPreview = document.getElementById("nfcCardPhotoPreview");
  if (photoStatus) photoStatus.textContent = card.photoUrl ? "Employee photo is attached. Choose another file to replace it." : "Choose a JPG, PNG, or WebP photo (up to 5 MB).";
  if (photoPreview) { photoPreview.src = card.photoUrl ? new URL(card.photoUrl, window.location.href).href : ""; photoPreview.hidden = !card.photoUrl; }
  const brochureStatus = document.getElementById("nfcCardBrochureStatus");
  if (brochureStatus) brochureStatus.textContent = card.brochureUrl ? "Company brochure attached. Choose another PDF to replace it." : "Upload a company brochure PDF (up to 15 MB).";
  document.getElementById("nfcCardApproved").checked = card.publicApproved === true;
  document.getElementById("nfcCardSaveButton").textContent = card.id ? "Save Profile" : "Add Employee Profile";
  previewNfcCard();
}
window.uploadNfcEmployeePhoto = async function(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type) || file.size > 5 * 1024 * 1024) {
    input.value = "";
    window.showNotification({ title: "Photo Not Accepted", message: "Choose a JPG, PNG, or WebP image no larger than 5 MB.", type: "warning" });
    return;
  }
  const status = document.getElementById("nfcCardPhotoStatus");
  if (status) status.textContent = "Uploading photo…";
  const data = new FormData();
  data.append("cardId", ensureNfcCardId());
  data.append("photo", file, file.name);
  try {
    const response = await erpFetchWithTimeout("backend/api.php?action=upload_nfc_photo", { method: "POST", credentials: "same-origin", body: data }, 120000);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.status !== "success" || !result.photoUrl) throw new Error(result.message || "The employee photo could not be uploaded.");
    document.getElementById("nfcCardPhoto").value = result.photoUrl;
    const preview = document.getElementById("nfcCardPhotoPreview");
    preview.src = new URL(result.photoUrl, window.location.href).href;
    preview.hidden = false;
    if (status) status.textContent = "Photo uploaded. Save the employee profile to finish.";
  } catch (error) {
    input.value = "";
    if (status) status.textContent = "Photo upload failed. Please try again.";
    window.showNotification({ title: "Photo Upload Failed", message: error.message || "The employee photo could not be uploaded.", type: "danger" });
  }
};
window.uploadNfcCompanyBrochure = async function(input) {
  const file = input?.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".pdf") || (file.type && file.type !== "application/pdf") || file.size > 15 * 1024 * 1024) {
    input.value = "";
    window.showNotification({ title: "Brochure Not Accepted", message: "Choose a PDF brochure no larger than 15 MB.", type: "warning" });
    return;
  }
  const status = document.getElementById("nfcCardBrochureStatus");
  if (status) status.textContent = "Uploading brochure…";
  nfcBrochureUploadInProgress = true;
  const data = new FormData();
  data.append("cardId", ensureNfcCardId());
  data.append("brochure", file, file.name);
  try {
    const response = await erpFetchWithTimeout("backend/api.php?action=upload_nfc_brochure", { method: "POST", credentials: "same-origin", body: data }, 120000);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.status !== "success" || !result.brochureUrl) throw new Error(result.message || "The company brochure could not be uploaded.");
    document.getElementById("nfcCardBrochure").value = result.brochureUrl;
    if (status) status.textContent = "Brochure uploaded. Save the employee profile to finish.";
  } catch (error) {
    input.value = "";
    if (status) status.textContent = "Brochure upload failed. Please try again.";
    window.showNotification({ title: "Brochure Upload Failed", message: error.message || "The company brochure could not be uploaded.", type: "danger" });
  } finally {
    nfcBrochureUploadInProgress = false;
  }
};
window.startNewNfcCard = function() { fillNfcCardForm(); document.getElementById("nfcCardName")?.focus(); };
window.editNfcCard = function(cardId) {
  const card = (nfcCardsDb || []).find(item => item.id === cardId);
  if (card) fillNfcCardForm(card);
};
window.renderNfcCardsTable = function() {
  const body = document.getElementById("nfcCardsTableBody");
  if (!body) return;
  const cards = [...(nfcCardsDb || [])].sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || "")));
  if (!cards.length) {
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:22px">No employee card profiles yet. Add a profile to begin.</td></tr>';
    return;
  }
  body.innerHTML = cards.map(card => {
    const url = nfcCardUrl(card.id);
    return `<tr><td><code>${nfcEscape(card.id)}</code></td><td><button class="btn btn-secondary" type="button" onclick="editNfcCard('${nfcEscape(card.id)}')"><strong>${nfcEscape(card.fullName)}</strong></button></td><td>${nfcEscape(card.jobTitle)}</td><td><span style="color:${card.publicApproved ? '#15803d' : '#64748b'};font-weight:700">${card.publicApproved ? 'Approved' : 'Draft'}</span></td><td><a href="${nfcEscape(url)}" target="_blank" rel="noopener" style="overflow-wrap:anywhere;font-size:11px">${nfcEscape(url)}</a></td><td><button class="btn btn-primary" type="button" onclick="editNfcCard('${nfcEscape(card.id)}')">Edit</button></td></tr>`;
  }).join("");
};
window.previewNfcCard = function() {
  const id = ensureNfcCardId();
  const url = nfcCardUrl(id);
  const link = document.getElementById("nfcCardPreviewUrl");
  const qr = document.getElementById("nfcCardQrPreview");
  if (link) { link.textContent = url; link.href = url; }
  if (!qr) return;
  qr.replaceChildren();
  const qrFactory = window.qrcode || globalThis.qrcode;
  if (typeof qrFactory !== "function") { qr.textContent = "QR generator unavailable. Check that assets/qrcode-generator.min.js is deployed with the ERP, then refresh."; return; }
  try {
    const code = qrFactory(0, "M");
    code.addData(url);
    code.make();
    qr.innerHTML = code.createSvgTag(5, 2);
  } catch (error) { qr.textContent = "QR could not be generated for this profile."; }
};
window.copyNfcCardLink = async function() {
  const id = ensureNfcCardId();
  if (!(nfcCardsDb || []).some(card => card.id === id)) {
    window.showNotification({ title: "Save Profile First", message: "Save this employee profile before copying its working card link.", type: "warning" });
    return;
  }
  const url = nfcCardUrl(id);
  try {
    await navigator.clipboard.writeText(url);
    window.showNotification({ title: "Profile Link Copied", message: "The NFC/QR link is ready to copy.", type: "success" });
  } catch (_) {
    window.prompt("Copy the NFC/QR profile link:", url);
  }
};
window.downloadNfcCardQr = function() {
  const svg = document.querySelector("#nfcCardQrPreview svg");
  const id = ensureNfcCardId();
  if (!(nfcCardsDb || []).some(card => card.id === id)) { window.showNotification({ title: "Save Profile First", message: "Save this employee profile before downloading its QR code.", type: "warning" }); return; }
  if (!svg) { window.showNotification({ title: "QR Not Ready", message: "The QR generator did not load. Check that assets/qrcode-generator.min.js is deployed with the ERP, then refresh.", type: "warning" }); return; }
  const source = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${document.getElementById("nfcCardId").value || "demosolar-card"}-qr.svg`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};
window.saveNfcCardProfile = async function() {
  const card = readNfcCardForm();
  if (!card.fullName) { window.showNotification({ title: "Name Required", message: "Enter the employee’s name before saving the card profile.", type: "warning" }); return; }
  if (nfcBrochureUploadInProgress) { window.showNotification({ title: "Brochure Uploading", message: "Wait until the brochure upload finishes, then save the profile.", type: "warning" }); return; }
  if (!card.phone && !card.email) { window.showNotification({ title: "Contact Required", message: "Enter at least a business phone number or email address.", type: "warning" }); return; }
  const whatsappLink = normalizeNfcWhatsAppLink(card.whatsapp);
  if (whatsappLink === null) { window.showNotification({ title: "WhatsApp Link Invalid", message: "Enter a direct link in this format: https://wa.me/91 followed by exactly 10 digits. Example: https://wa.me/91900000000557", type: "warning" }); document.getElementById("nfcCardWhatsapp")?.focus(); return; }
  card.whatsapp = whatsappLink;
  if (card.publicApproved && !window.confirm("This profile contains public contact details. Confirm the employee has approved publishing this information on their NFC card.")) return;
  const previousCards = [...(nfcCardsDb || [])];
  const index = nfcCardsDb.findIndex(item => item.id === card.id);
  if (index >= 0) nfcCardsDb[index] = { ...nfcCardsDb[index], ...card };
  else nfcCardsDb.push(card);
  const saved = await saveStorage(KEY_NFC_CARDS, nfcCardsDb);
  if (saved === false) {
    nfcCardsDb = previousCards;
    window.showNotification({ title: "NFC Profile Not Saved", message: "The server did not confirm saving this profile to the ERP database. Your form entries are still present; check the error message and try again.", type: "danger" });
    return;
  }
  window.showNotification({ title: "NFC Profile Saved", message: `${card.fullName}’s card profile and link are saved in ERP.`, type: "success" });
  renderNfcCardsTable();
  fillNfcCardForm(card);
};
window.openNfcCardsView = async function(button) {
  if (!window.userCanOpenView("adminNfcCards", currentLoggedInUser)) {
    window.showNotification({ title: "Access Denied", message: "Your User Rights do not allow NFC Cards.", type: "danger" });
    return;
  }
  await switchView("adminNfcCards", button, "NFC Cards");
  renderNfcCardsTable();
  if (!document.getElementById("nfcCardId").value) fillNfcCardForm();
  previewNfcCard();
};

function initializeNfcCardManager() {
  document.getElementById("nfcCardForm")?.addEventListener("input", previewNfcCard);
  document.getElementById("view-adminNfcCards")?.addEventListener("input", previewNfcCard);
  fillNfcCardForm();
  renderNfcCardsTable();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeNfcCardManager, { once: true });
else initializeNfcCardManager();
