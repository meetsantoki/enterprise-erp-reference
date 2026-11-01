"use strict";

const form = document.getElementById("vendorRegistrationForm");
const vendorType = document.getElementById("vendorType");
const message = document.getElementById("formMessage");
const submitButton = document.getElementById("submitVendorApplication");

function setRequired(name, required) {
  const field = form.elements.namedItem(name);
  if (field && "required" in field) field.required = required;
}

function updateVendorType() {
  const domestic = vendorType.value === "DOMESTIC";
  const imported = vendorType.value === "IMPORT";
  document.querySelectorAll(".domestic-only").forEach(element => element.classList.toggle("hidden", !domestic));
  document.querySelectorAll(".domestic-required").forEach(element => element.classList.toggle("hidden", !domestic));
  document.querySelectorAll(".domestic-bank").forEach(element => element.classList.toggle("hidden", !domestic));
  document.querySelectorAll(".import-bank").forEach(element => element.classList.toggle("hidden", !imported));
  for (const name of ["gst", "pan", "ifsc"]) setRequired(name, domestic);
  setRequired("msme", false);
  setRequired("cin", false);
  setRequired("swift", imported);
  const bankProofLabel = document.getElementById("bankProofLabel");
  const bankProofRequirement = document.getElementById("bankProofRequirement");
  const bankProofGuidance = document.getElementById("bankProofGuidance");
  if (bankProofLabel) bankProofLabel.innerHTML = imported ? "BANK DETAILS ON COMPANY LETTERHEAD <b>*</b>" : "CANCELLED CHEQUE / BANK PROOF <b>*</b>";
  if (bankProofRequirement) bankProofRequirement.value = imported ? "Mandatory signed & stamped document" : "Mandatory bank proof";
  if (bankProofGuidance) bankProofGuidance.textContent = imported
    ? "Upload bank details on the company letterhead, duly signed and stamped."
    : (domestic ? "Upload a cancelled cheque or official bank proof." : "Select the vendor type to see the required bank document.");
  if (imported) {
    for (const name of ["gst", "pan", "msme", "tan", "ifsc"]) {
      const field = form.elements.namedItem(name); if (field) field.value = "";
    }
    for (const category of ["GST", "PAN", "MSME", "TAN"]) {
      const input = document.getElementById(`document${category}`); if (input) input.value = "";
      const status = document.querySelector(`[data-status="${category}"]`); if (status) status.textContent = "No file selected";
    }
  } else if (domestic) {
    const swift = form.elements.namedItem("swift"); if (swift) swift.value = "";
  }
}

function copyOfficeToFactory() {
  const checked = document.getElementById("factorySameAsOffice").checked;
  const pairs = [["officeAddressLine1","factoryAddressLine1"],["officeAddressLine2","factoryAddressLine2"],["officeCountry","factoryCountry"],["officeState","factoryState"],["officeCity","factoryCity"],["officePostalCode","factoryPostalCode"]];
  for (const [sourceName, targetName] of pairs) {
    const source = form.elements.namedItem(sourceName), target = form.elements.namedItem(targetName);
    if (!source || !target) continue;
    if (checked) target.value = source.value;
    target.readOnly = checked;
  }
}

function payloadFromForm() {
  const value = name => String(form.elements.namedItem(name)?.value || "").trim();
  return {
    vendorType: value("vendorType"), name: value("name"), gst: value("gst"), pan: value("pan"),
    cin: value("cin"), msme: value("msme"), tan: value("tan"), iec: value("iec"),
    otherDocumentNumber: value("otherDocumentNumber"), bankName: value("bankName"),
    accountNumber: value("accountNumber"), ifsc: value("ifsc"), swift: value("swift"),
    branchName: value("branchName"), branchAddress: value("branchAddress"),
    officeAddressLine1: value("officeAddressLine1"), officeAddressLine2: value("officeAddressLine2"),
    officeCountry: value("officeCountry"), officeState: value("officeState"), officeCity: value("officeCity"), officePostalCode: value("officePostalCode"),
    factoryAddressLine1: value("factoryAddressLine1"), factoryAddressLine2: value("factoryAddressLine2"),
    factoryCountry: value("factoryCountry"), factoryState: value("factoryState"), factoryCity: value("factoryCity"), factoryPostalCode: value("factoryPostalCode"),
    factorySameAsOffice: Boolean(document.getElementById("factorySameAsOffice")?.checked),
    salesPersonName: value("salesPersonName"), salesPersonMobile: value("salesPersonMobile"), salesPersonEmail: value("salesPersonEmail"),
    logisticsPersonName: value("logisticsPersonName"), logisticsPersonMobile: value("logisticsPersonMobile"), logisticsPersonEmail: value("logisticsPersonEmail"),
    qualityPersonName: value("qualityPersonName"), qualityPersonMobile: value("qualityPersonMobile"), qualityPersonEmail: value("qualityPersonEmail"),
    accountsPersonName: value("accountsPersonName"), accountsPersonMobile: value("accountsPersonMobile"), accountsPersonEmail: value("accountsPersonEmail"),
    consentConfirmed: Boolean(form.elements.namedItem("consentConfirmed")?.checked)
  };
}

form.addEventListener("input", event => {
  if (event.target.classList?.contains("uppercase")) event.target.value = event.target.value.toUpperCase();
  if (document.getElementById("factorySameAsOffice").checked && String(event.target.name || "").startsWith("office")) copyOfficeToFactory();
});
vendorType.addEventListener("change", () => {
  const bankProof = document.getElementById("documentCANCELLED_CHEQUE");
  if (bankProof) bankProof.value = "";
  const status = document.querySelector('[data-status="CANCELLED_CHEQUE"]');
  if (status) status.textContent = "No file selected";
  updateVendorType();
});
document.getElementById("factorySameAsOffice").addEventListener("change", copyOfficeToFactory);
document.addEventListener("click", event => {
  const button = event.target.closest?.("[data-upload]");
  if (!button) return;
  document.getElementById(`document${button.dataset.upload}`)?.click();
});
document.addEventListener("change", event => {
  if (!(event.target instanceof HTMLInputElement) || event.target.type !== "file") return;
  const category = event.target.id.replace(/^document/, "");
  const files = Array.from(event.target.files || []);
  const status = document.querySelector(`[data-status="${category}"]`);
  if (status) status.textContent = files.length ? `${files.length} file(s): ${files.map(file => file.name).join(", ")}` : "No file selected";
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  message.className = "form-message";
  message.textContent = "";
  if (!form.reportValidity()) return;
  if (vendorType.value === "DOMESTIC") {
    const missingDocuments = [["GST", "GST"], ["PAN", "PAN"]]
      .filter(([category]) => !document.getElementById(`document${category}`)?.files?.length)
      .map(([, label]) => label);
    if (missingDocuments.length) {
      message.className = "form-message error";
      message.textContent = `Upload the mandatory documents: ${missingDocuments.join(", ")}.`;
      document.querySelector(`[data-upload="${missingDocuments[0].split(" ")[0]}"]`)?.focus();
      return;
    }
  }
  const bankProof = document.getElementById("documentCANCELLED_CHEQUE");
  if (!bankProof?.files?.length) {
    const imported = vendorType.value === "IMPORT";
    message.className = "form-message error";
    message.textContent = imported
      ? "Upload the bank details on company letterhead, duly signed and stamped."
      : "Upload a cancelled cheque or official bank proof.";
    document.querySelector('[data-upload="CANCELLED_CHEQUE"]')?.focus();
    return;
  }
  const body = new FormData(form);
  body.set("payload", JSON.stringify(payloadFromForm()));
  submitButton.disabled = true;
  submitButton.textContent = "Submitting…";
  message.className = "form-message info";
  message.textContent = "Uploading documents and submitting your application…";
  try {
    const response = await fetch("../backend/vendor_registration.php", { method: "POST", body, credentials: "same-origin" });
    const result = await response.json().catch(() => ({ status: "error", message: "The server returned an invalid response." }));
    if (!response.ok || result.status !== "success") throw new Error(result.message || "Application submission failed.");
    form.classList.add("hidden");
    document.querySelector(".notice")?.classList.add("hidden");
    document.getElementById("applicationNumber").textContent = result.applicationNumber;
    document.getElementById("successPanel").classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    message.className = "form-message error";
    message.textContent = error.message || "The application could not be submitted.";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Submit for approval";
  }
});

document.getElementById("newApplication").addEventListener("click", () => window.location.reload());
updateVendorType();
