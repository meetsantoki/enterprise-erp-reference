<?php
declare(strict_types=1);
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: same-origin');
header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()');
header("Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
header('Cache-Control: no-cache');
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Vendor Registration | DemoSolar Industries</title>
  <link rel="stylesheet" href="style.css?v=20261006-v2">
</head>
<body>
  <header class="portal-header">
    <div class="header-inner">
      <img src="../assets/demo-logo.svg" alt="DemoSolar Industries">
      <div><p class="eyebrow">DEMOSOLAR ENERGY PVT. LTD.</p><h1>Vendor Registration Form</h1></div>
    </div>
  </header>

  <main class="portal-shell">
    <form id="vendorRegistrationForm" enctype="multipart/form-data" novalidate>
      <div class="purchase-vendor-box-grid">
        <section class="purchase-vendor-box details">
          <div class="purchase-vendor-box-title"><span>1. VENDOR DETAILS</span></div>
          <div class="form-group"><label>VENDOR TYPE <b>*</b></label><select name="vendorType" id="vendorType" required><option value="">-- Select Vendor Type --</option><option value="DOMESTIC">Domestic</option><option value="IMPORT">Import</option></select></div>
          <div class="form-group"><label>VENDOR NAME <b>*</b></label><input name="name" maxlength="200" placeholder="Vendor or company name" required></div>

          <div class="form-group domestic-only hidden"><label>GSTIN <b>*</b></label><div class="purchase-upload-row"><input name="gst" maxlength="15" class="uppercase" placeholder="15-character GSTIN"><button class="purchase-upload-button" type="button" data-upload="GST" title="Attach mandatory GST document">+</button></div><input id="documentGST" type="file" name="documents_GST[]" accept=".pdf,.jpg,.jpeg,.png" multiple hidden><div class="purchase-upload-status" data-status="GST">No file selected (mandatory)</div></div>
          <div class="form-group domestic-only hidden"><label>PAN <b>*</b></label><div class="purchase-upload-row"><input name="pan" maxlength="10" class="uppercase" placeholder="10-character PAN"><button class="purchase-upload-button" type="button" data-upload="PAN" title="Attach mandatory PAN document">+</button></div><input id="documentPAN" type="file" name="documents_PAN[]" accept=".pdf,.jpg,.jpeg,.png" multiple hidden><div class="purchase-upload-status" data-status="PAN">No file selected (mandatory)</div></div>
          <div class="form-group"><label>CIN</label><div class="purchase-upload-row"><input name="cin" maxlength="21" class="uppercase" placeholder="Optional 21-character CIN"><button class="purchase-upload-button" type="button" data-upload="CIN" title="Attach optional CIN documents">+</button></div><input id="documentCIN" type="file" name="documents_CIN[]" accept=".pdf,.jpg,.jpeg,.png" multiple hidden><div class="purchase-upload-status" data-status="CIN">No file selected (optional)</div></div>
          <div class="form-group domestic-only hidden"><label>MSME / UDYAM</label><div class="purchase-upload-row"><input name="msme" maxlength="20" class="uppercase" placeholder="UDYAM-XX-00-0000000"><button class="purchase-upload-button" type="button" data-upload="MSME" title="Attach optional MSME document">+</button></div><input id="documentMSME" type="file" name="documents_MSME[]" accept=".pdf,.jpg,.jpeg,.png" multiple hidden><div class="purchase-upload-status" data-status="MSME">No file selected (optional)</div></div>
          <div class="form-group domestic-only hidden"><label>TAN</label><div class="purchase-upload-row"><input name="tan" maxlength="10" class="uppercase" placeholder="Optional TAN"><button class="purchase-upload-button" type="button" data-upload="TAN" title="Attach TAN documents">+</button></div><input id="documentTAN" type="file" name="documents_TAN[]" accept=".pdf,.jpg,.jpeg,.png" multiple hidden><div class="purchase-upload-status" data-status="TAN">No file selected</div></div>
          <div class="form-group"><label>IEC</label><div class="purchase-upload-row"><input name="iec" maxlength="10" class="uppercase" placeholder="Optional IEC"><button class="purchase-upload-button" type="button" data-upload="IEC" title="Attach IEC documents">+</button></div><input id="documentIEC" type="file" name="documents_IEC[]" accept=".pdf,.jpg,.jpeg,.png" multiple hidden><div class="purchase-upload-status" data-status="IEC">No file selected</div></div>
          <div class="form-group"><label>OTHER DOCUMENT</label><div class="purchase-upload-row"><input name="otherDocumentNumber" maxlength="100" placeholder="Optional document number"><button class="purchase-upload-button" type="button" data-upload="OTHER" title="Attach other documents">+</button></div><input id="documentOTHER" type="file" name="documents_OTHER[]" accept=".pdf,.jpg,.jpeg,.png" multiple hidden><div class="purchase-upload-status" data-status="OTHER">No file selected</div></div>
        </section>

        <section class="purchase-vendor-box bank">
          <div class="purchase-vendor-box-title"><span>2. VENDOR BANK DETAILS</span></div>
          <div class="form-group"><label>BANK NAME <b>*</b></label><input name="bankName" maxlength="160" placeholder="Enter bank name" required></div>
          <div class="form-group"><label>ACCOUNT NUMBER <b>*</b></label><input name="accountNumber" maxlength="34" autocomplete="off" placeholder="Enter bank account number" required></div>
          <div class="form-group domestic-bank hidden"><label>IFSC CODE <b>*</b></label><input name="ifsc" maxlength="11" class="uppercase" placeholder="Enter 11-character IFSC"></div>
          <div class="form-group import-bank hidden"><label>SWIFT / BIC CODE <b>*</b></label><input name="swift" maxlength="11" class="uppercase" placeholder="Enter 8 or 11-character SWIFT/BIC"></div>
          <div class="form-group"><label>BRANCH NAME <b>*</b></label><input name="branchName" maxlength="160" placeholder="Enter bank branch name" required></div>
          <div class="form-group"><label>BRANCH ADDRESS <b>*</b></label><input name="branchAddress" maxlength="500" placeholder="Enter bank branch address" required></div>
          <div class="form-group"><label id="bankProofLabel">CANCELLED CHEQUE / BANK PROOF <b>*</b></label><div class="purchase-upload-row"><input id="bankProofRequirement" value="Mandatory bank proof" readonly class="readonly-field"><button class="purchase-upload-button" type="button" data-upload="CANCELLED_CHEQUE" title="Attach mandatory bank proof">+</button></div><input id="documentCANCELLED_CHEQUE" type="file" name="documents_CANCELLED_CHEQUE[]" accept=".pdf,.jpg,.jpeg,.png" multiple hidden><div class="purchase-upload-status" data-status="CANCELLED_CHEQUE">No file selected</div><div id="bankProofGuidance" style="margin-top:7px;color:#475569;font-size:12px;line-height:1.5;">Select the vendor type to see the required bank document.</div></div>
        </section>

        <section class="purchase-vendor-box office">
          <div class="purchase-vendor-box-title"><span>3. VENDOR OFFICE ADDRESS</span></div>
          <div class="form-group"><label>ADDRESS LINE 1 <b>*</b></label><input name="officeAddressLine1" maxlength="300" placeholder="Building, plot, street or office address" required></div>
          <div class="form-group"><label>ADDRESS LINE 2</label><input name="officeAddressLine2" maxlength="300" placeholder="Area, landmark or additional address"></div>
          <div class="form-group"><label>COUNTRY <b>*</b></label><input name="officeCountry" maxlength="100" placeholder="Enter country" required></div>
          <div class="form-group"><label>STATE / PROVINCE <b>*</b></label><input name="officeState" maxlength="120" placeholder="Enter state or province" required></div>
          <div class="form-group"><label>CITY <b>*</b></label><input name="officeCity" maxlength="120" placeholder="Enter city" required></div>
          <div class="form-group"><label>PIN / POSTAL CODE <b>*</b></label><input name="officePostalCode" maxlength="20" class="uppercase" placeholder="Enter PIN or postal code" required></div>
        </section>

        <section class="purchase-vendor-box factory">
          <div class="purchase-vendor-box-title"><span>4. VENDOR FACTORY ADDRESS</span><label class="purchase-address-link"><input type="checkbox" id="factorySameAsOffice"> Same as Office Address</label></div>
          <div class="form-group"><label>ADDRESS LINE 1 <b>*</b></label><input name="factoryAddressLine1" maxlength="300" placeholder="Building, plot, street or factory address" required></div>
          <div class="form-group"><label>ADDRESS LINE 2</label><input name="factoryAddressLine2" maxlength="300" placeholder="Area, landmark or additional address"></div>
          <div class="form-group"><label>COUNTRY <b>*</b></label><input name="factoryCountry" maxlength="100" placeholder="Enter country" required></div>
          <div class="form-group"><label>STATE / PROVINCE <b>*</b></label><input name="factoryState" maxlength="120" placeholder="Enter state or province" required></div>
          <div class="form-group"><label>CITY <b>*</b></label><input name="factoryCity" maxlength="120" placeholder="Enter city" required></div>
          <div class="form-group"><label>PIN / POSTAL CODE <b>*</b></label><input name="factoryPostalCode" maxlength="20" class="uppercase" placeholder="Enter PIN or postal code" required></div>
        </section>
      </div>

      <div class="purchase-contact-grid">
        <section class="purchase-contact-box"><div class="purchase-contact-title">5. SALES PERSON</div><div class="form-group"><label>PERSON NAME <b>*</b></label><input name="salesPersonName" maxlength="160" placeholder="Enter sales person name" required></div><div class="form-group"><label>MOBILE NUMBER <b>*</b></label><input name="salesPersonMobile" maxlength="16" inputmode="tel" placeholder="Enter mobile number" required></div><div class="form-group"><label>EMAIL ID <b>*</b></label><input name="salesPersonEmail" maxlength="190" type="email" placeholder="Enter email address" required></div></section>
        <section class="purchase-contact-box"><div class="purchase-contact-title">6. LOGISTICS PERSON</div><div class="form-group"><label>PERSON NAME</label><input name="logisticsPersonName" maxlength="160" placeholder="Optional logistics person name"></div><div class="form-group"><label>MOBILE NUMBER</label><input name="logisticsPersonMobile" maxlength="16" inputmode="tel" placeholder="Optional mobile number"></div><div class="form-group"><label>EMAIL ID</label><input name="logisticsPersonEmail" maxlength="190" type="email" placeholder="Optional email address"></div></section>
        <section class="purchase-contact-box"><div class="purchase-contact-title">7. QUALITY DEPARTMENT PERSON</div><div class="form-group"><label>PERSON NAME</label><input name="qualityPersonName" maxlength="160" placeholder="Optional quality person name"></div><div class="form-group"><label>MOBILE NUMBER</label><input name="qualityPersonMobile" maxlength="16" inputmode="tel" placeholder="Optional mobile number"></div><div class="form-group"><label>EMAIL ID</label><input name="qualityPersonEmail" maxlength="190" type="email" placeholder="Optional email address"></div></section>
        <section class="purchase-contact-box"><div class="purchase-contact-title">8. ACCOUNTS DEPARTMENT PERSON</div><div class="form-group"><label>PERSON NAME</label><input name="accountsPersonName" maxlength="160" placeholder="Optional accounts person name"></div><div class="form-group"><label>MOBILE NUMBER</label><input name="accountsPersonMobile" maxlength="16" inputmode="tel" placeholder="Optional mobile number"></div><div class="form-group"><label>EMAIL ID</label><input name="accountsPersonEmail" maxlength="190" type="email" placeholder="Optional email address"></div></section>
      </div>

      <section class="submit-card">
        <label class="consent"><input type="checkbox" name="consentConfirmed" required> I confirm that the information and documents submitted are accurate and may be verified by DemoSolar Industries. <b>*</b></label>
        <div id="formMessage" class="form-message" role="status" aria-live="polite"></div>
        <button id="submitVendorApplication" class="submit-button" type="submit">Submit for Approval</button>
      </section>
    </form>

    <section id="successPanel" class="success-panel hidden" aria-live="polite"><div class="success-icon">✓</div><h2>Application submitted</h2><p>Your reference number is</p><strong id="applicationNumber"></strong><p>Please keep this reference for communication with DemoSolar Purchase.</p><button type="button" id="newApplication">Submit Another Application</button></section>
  </main>
  <script src="app.js?v=20261010-msme-optional-v1"></script>
</body>
</html>
