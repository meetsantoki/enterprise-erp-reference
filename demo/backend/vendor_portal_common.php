<?php
/** Shared database and validation helpers for public vendor onboarding. */
declare(strict_types=1);

function vendor_portal_ensure_schema(mysqli $db): void
{
    $statements = [
        "CREATE TABLE IF NOT EXISTS erp_vendor_applications (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            application_number VARCHAR(40) NOT NULL,
            vendor_type VARCHAR(20) NOT NULL,
            vendor_name VARCHAR(200) NOT NULL,
            gstin VARCHAR(20) NULL,
            pan VARCHAR(20) NULL,
            iec VARCHAR(20) NULL,
            bank_account VARCHAR(50) NOT NULL,
            sales_email VARCHAR(190) NOT NULL,
            payload_json LONGTEXT NOT NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'SUBMITTED',
            review_notes TEXT NULL,
            vendor_code VARCHAR(30) NULL,
            submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            reviewed_at DATETIME NULL,
            reviewed_by VARCHAR(100) NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_vendor_application_number (application_number),
            KEY idx_vendor_application_status (status, submitted_at),
            KEY idx_vendor_application_gstin (gstin),
            KEY idx_vendor_application_pan (pan),
            KEY idx_vendor_application_iec (iec),
            KEY idx_vendor_application_bank (bank_account)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS erp_vendor_application_documents (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            application_id BIGINT UNSIGNED NOT NULL,
            category VARCHAR(40) NOT NULL,
            original_name VARCHAR(255) NOT NULL,
            storage_path VARCHAR(600) NOT NULL,
            mime_type VARCHAR(100) NOT NULL,
            file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
            uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_vendor_application_documents (application_id, category),
            CONSTRAINT fk_vendor_application_documents
              FOREIGN KEY (application_id) REFERENCES erp_vendor_applications(id)
              ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS erp_vendor_application_history (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            application_id BIGINT UNSIGNED NOT NULL,
            action_code VARCHAR(40) NOT NULL,
            notes TEXT NULL,
            actor VARCHAR(100) NOT NULL,
            action_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_vendor_application_history (application_id, action_at),
            CONSTRAINT fk_vendor_application_history
              FOREIGN KEY (application_id) REFERENCES erp_vendor_applications(id)
              ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    ];
    foreach ($statements as $statement) {
        if (!$db->query($statement)) {
            throw new RuntimeException('Vendor application database setup failed: ' . $db->error);
        }
    }
}

function vendor_portal_text($value, int $maximum = 500): string
{
    $value = trim((string) $value);
    return mb_substr($value, 0, $maximum, 'UTF-8');
}

function vendor_portal_upper($value, int $maximum = 100): string
{
    return strtoupper(vendor_portal_text($value, $maximum));
}

function vendor_portal_phone($value): string
{
    return preg_replace('/[\s()\-]/', '', vendor_portal_text($value, 30)) ?: '';
}

function vendor_portal_validate(array $input): array
{
    $vendorType = vendor_portal_upper($input['vendorType'] ?? '', 20);
    if (!in_array($vendorType, ['DOMESTIC', 'IMPORT'], true)) {
        throw new InvalidArgumentException('Select Domestic or Import vendor type.');
    }

    $data = [
        'vendorType' => $vendorType,
        'name' => vendor_portal_upper($input['name'] ?? '', 200),
        'gst' => preg_replace('/[^A-Z0-9]/', '', vendor_portal_upper($input['gst'] ?? '', 20)) ?: '',
        'pan' => preg_replace('/[^A-Z0-9]/', '', vendor_portal_upper($input['pan'] ?? '', 20)) ?: '',
        'cin' => preg_replace('/[^A-Z0-9]/', '', vendor_portal_upper($input['cin'] ?? '', 30)) ?: '',
        'msme' => preg_replace('/[^A-Z0-9\-]/', '', vendor_portal_upper($input['msme'] ?? '', 30)) ?: '',
        'tan' => preg_replace('/[^A-Z0-9]/', '', vendor_portal_upper($input['tan'] ?? '', 20)) ?: '',
        'iec' => preg_replace('/[^A-Z0-9]/', '', vendor_portal_upper($input['iec'] ?? '', 20)) ?: '',
        'otherDocumentNumber' => vendor_portal_text($input['otherDocumentNumber'] ?? '', 100),
        'bankName' => vendor_portal_text($input['bankName'] ?? '', 160),
        'accountNumber' => preg_replace('/\s+/', '', vendor_portal_text($input['accountNumber'] ?? '', 50)) ?: '',
        'ifsc' => preg_replace('/[^A-Z0-9]/', '', vendor_portal_upper($input['ifsc'] ?? '', 20)) ?: '',
        'swift' => preg_replace('/[^A-Z0-9]/', '', vendor_portal_upper($input['swift'] ?? '', 20)) ?: '',
        'branchName' => vendor_portal_text($input['branchName'] ?? '', 160),
        'branchAddress' => vendor_portal_text($input['branchAddress'] ?? '', 500),
        'officeAddressLine1' => vendor_portal_text($input['officeAddressLine1'] ?? '', 300),
        'officeAddressLine2' => vendor_portal_text($input['officeAddressLine2'] ?? '', 300),
        'officeCountry' => vendor_portal_text($input['officeCountry'] ?? '', 100),
        'officeState' => vendor_portal_text($input['officeState'] ?? '', 120),
        'officeCity' => vendor_portal_text($input['officeCity'] ?? '', 120),
        'officePostalCode' => vendor_portal_upper($input['officePostalCode'] ?? '', 20),
        'factoryAddressLine1' => vendor_portal_text($input['factoryAddressLine1'] ?? '', 300),
        'factoryAddressLine2' => vendor_portal_text($input['factoryAddressLine2'] ?? '', 300),
        'factoryCountry' => vendor_portal_text($input['factoryCountry'] ?? '', 100),
        'factoryState' => vendor_portal_text($input['factoryState'] ?? '', 120),
        'factoryCity' => vendor_portal_text($input['factoryCity'] ?? '', 120),
        'factoryPostalCode' => vendor_portal_upper($input['factoryPostalCode'] ?? '', 20),
        'addressLink' => !empty($input['factorySameAsOffice']) ? 'FACTORY_SAME_AS_OFFICE' : '',
        'salesPersonName' => vendor_portal_text($input['salesPersonName'] ?? '', 160),
        'salesPersonMobile' => vendor_portal_phone($input['salesPersonMobile'] ?? ''),
        'salesPersonEmail' => strtolower(vendor_portal_text($input['salesPersonEmail'] ?? '', 190)),
        'qualityPersonName' => vendor_portal_text($input['qualityPersonName'] ?? '', 160),
        'qualityPersonMobile' => vendor_portal_phone($input['qualityPersonMobile'] ?? ''),
        'qualityPersonEmail' => strtolower(vendor_portal_text($input['qualityPersonEmail'] ?? '', 190)),
        'logisticsPersonName' => vendor_portal_text($input['logisticsPersonName'] ?? '', 160),
        'logisticsPersonMobile' => vendor_portal_phone($input['logisticsPersonMobile'] ?? ''),
        'logisticsPersonEmail' => strtolower(vendor_portal_text($input['logisticsPersonEmail'] ?? '', 190)),
        'accountsPersonName' => vendor_portal_text($input['accountsPersonName'] ?? '', 160),
        'accountsPersonMobile' => vendor_portal_phone($input['accountsPersonMobile'] ?? ''),
        'accountsPersonEmail' => strtolower(vendor_portal_text($input['accountsPersonEmail'] ?? '', 190)),
        'consentConfirmed' => !empty($input['consentConfirmed'])
    ];

    $required = [
        'Vendor name' => $data['name'], 'Bank name' => $data['bankName'],
        'Account number' => $data['accountNumber'], 'Branch name' => $data['branchName'],
        'Branch address' => $data['branchAddress'], 'Office address' => $data['officeAddressLine1'],
        'Office country' => $data['officeCountry'], 'Office state' => $data['officeState'],
        'Office city' => $data['officeCity'], 'Office postal code' => $data['officePostalCode'],
        'Factory address' => $data['factoryAddressLine1'], 'Factory country' => $data['factoryCountry'],
        'Factory state' => $data['factoryState'], 'Factory city' => $data['factoryCity'],
        'Factory postal code' => $data['factoryPostalCode'], 'Sales person name' => $data['salesPersonName'],
        'Sales person mobile' => $data['salesPersonMobile'], 'Sales person email' => $data['salesPersonEmail']
    ];
    if ($vendorType === 'DOMESTIC') {
        $required += ['GSTIN' => $data['gst'], 'PAN' => $data['pan'], 'IFSC' => $data['ifsc']];
        $data['swift'] = '';
    } else {
        $required += ['SWIFT / BIC' => $data['swift']];
        $data['gst'] = $data['pan'] = $data['msme'] = $data['tan'] = $data['ifsc'] = '';
    }
    $missing = array_keys(array_filter($required, static fn($value) => trim((string) $value) === ''));
    if ($missing) throw new InvalidArgumentException('Complete the mandatory fields: ' . implode(', ', $missing) . '.');
    if (!$data['consentConfirmed']) throw new InvalidArgumentException('Confirm that the submitted vendor information is accurate.');

    $patterns = [
        'gst' => ['/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/', 'GSTIN is invalid.'],
        'pan' => ['/^[A-Z]{5}[0-9]{4}[A-Z]$/', 'PAN is invalid.'],
        'cin' => ['/^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/', 'CIN is invalid.'],
        'msme' => ['/^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/', 'MSME / UDYAM number is invalid.'],
        'tan' => ['/^[A-Z]{4}[0-9]{5}[A-Z]$/', 'TAN is invalid.'],
        'iec' => ['/^[A-Z0-9]{10}$/', 'IEC is invalid.'],
        'ifsc' => ['/^[A-Z]{4}0[A-Z0-9]{6}$/', 'IFSC is invalid.'],
        'swift' => ['/^[A-Z0-9]{8}([A-Z0-9]{3})?$/', 'SWIFT / BIC is invalid.'],
        'accountNumber' => ['/^[A-Z0-9]{6,34}$/i', 'Bank account number is invalid.']
    ];
    foreach ($patterns as $field => [$pattern, $message]) {
        if ($data[$field] !== '' && !preg_match($pattern, $data[$field])) throw new InvalidArgumentException($message);
    }
    foreach (['salesPerson', 'qualityPerson', 'logisticsPerson', 'accountsPerson'] as $contact) {
        $mobile = $data[$contact . 'Mobile'];
        $email = $data[$contact . 'Email'];
        if ($mobile !== '' && !preg_match('/^\+?[0-9]{10,15}$/', $mobile)) throw new InvalidArgumentException(ucfirst($contact) . ' mobile number is invalid.');
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) throw new InvalidArgumentException(ucfirst($contact) . ' email address is invalid.');
    }
    foreach (['office', 'factory'] as $address) {
        $country = $data[$address . 'Country'];
        $postal = $data[$address . 'PostalCode'];
        $valid = strcasecmp($country, 'India') === 0
            ? (bool) preg_match('/^[0-9]{6}$/', $postal)
            : (bool) preg_match('/^[A-Z0-9][A-Z0-9 \-]{1,10}[A-Z0-9]$/i', $postal);
        if (!$valid) throw new InvalidArgumentException(ucfirst($address) . ' postal code is invalid.');
    }
    return $data;
}

function vendor_portal_document_categories(): array
{
    return ['GST', 'PAN', 'CIN', 'MSME', 'TAN', 'IEC', 'OTHER', 'CANCELLED_CHEQUE'];
}

function vendor_portal_uploaded_files(string $field): array
{
    if (!isset($_FILES[$field]) || !is_array($_FILES[$field])) return [];
    $source = $_FILES[$field];
    $names = is_array($source['name'] ?? null) ? $source['name'] : [$source['name'] ?? ''];
    $files = [];
    foreach ($names as $index => $name) {
        $files[] = [
            'name' => (string) $name,
            'type' => (string) (is_array($source['type'] ?? null) ? ($source['type'][$index] ?? '') : ($source['type'] ?? '')),
            'tmp_name' => (string) (is_array($source['tmp_name'] ?? null) ? ($source['tmp_name'][$index] ?? '') : ($source['tmp_name'] ?? '')),
            'error' => (int) (is_array($source['error'] ?? null) ? ($source['error'][$index] ?? UPLOAD_ERR_NO_FILE) : ($source['error'] ?? UPLOAD_ERR_NO_FILE)),
            'size' => (int) (is_array($source['size'] ?? null) ? ($source['size'][$index] ?? 0) : ($source['size'] ?? 0))
        ];
    }
    return array_values(array_filter($files, static fn($file) => $file['error'] !== UPLOAD_ERR_NO_FILE));
}
