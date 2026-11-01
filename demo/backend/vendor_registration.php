<?php
/** Public, same-origin vendor application submission endpoint. */
declare(strict_types=1);
require_once __DIR__ . '/persistent_paths.php';
header('Content-Type: application/json; charset=UTF-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: same-origin');
header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
header('Cache-Control: no-store');

function vendor_registration_respond(array $data, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function vendor_registration_same_origin(): bool
{
    $source = trim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''));
    if ($source === '') $source = trim((string) ($_SERVER['HTTP_REFERER'] ?? ''));
    $sourceHost = strtolower((string) (parse_url($source, PHP_URL_HOST) ?? ''));
    $requestHost = strtolower(trim(explode(':', (string) ($_SERVER['HTTP_HOST'] ?? ''))[0] ?? ''));
    return $sourceHost !== '' && $requestHost !== '' && hash_equals($requestHost, $sourceHost);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    vendor_registration_respond(['status' => 'error', 'message' => 'Only vendor application submissions are accepted.'], 405);
}
if (!vendor_registration_same_origin()) {
    vendor_registration_respond(['status' => 'error', 'message' => 'Submit the application from the official DemoSolar vendor registration page.'], 403);
}

$config = [
    'db_host' => getenv('ERP_DB_HOST') ?: '127.0.0.1',
    'db_port' => (int) (getenv('ERP_DB_PORT') ?: 3306),
    'db_name' => getenv('ERP_DB_NAME') ?: 'demosolar_erp',
    'db_user' => getenv('ERP_DB_USER') ?: 'root',
    'db_pass' => getenv('ERP_DB_PASSWORD') ?: '',
    'app_timezone' => getenv('ERP_APP_TIMEZONE') ?: 'Asia/Calcutta'
];
$configPath = erp_config_path();
if (is_file($configPath)) {
    $local = require $configPath;
    if (is_array($local)) $config = array_replace($config, $local);
}
date_default_timezone_set((string) ($config['app_timezone'] ?? 'Asia/Calcutta'));
mysqli_report(MYSQLI_REPORT_OFF);
$db = @new mysqli((string) $config['db_host'], (string) $config['db_user'], (string) $config['db_pass'], (string) $config['db_name'], (int) $config['db_port']);
if ($db->connect_error) vendor_registration_respond(['status' => 'error', 'message' => 'Vendor registration is temporarily unavailable. Please contact DemoSolar Purchase.'], 503);
$db->set_charset('utf8mb4');
require_once __DIR__ . '/vendor_portal_common.php';

$payload = json_decode((string) ($_POST['payload'] ?? ''), true);
if (!is_array($payload)) vendor_registration_respond(['status' => 'error', 'message' => 'The submitted vendor form is invalid.'], 400);

$storedFiles = [];
try {
    $data = vendor_portal_validate($payload);
    if ($data['vendorType'] === 'DOMESTIC') {
        $missingDocuments = [];
        foreach (['GST' => 'GST', 'PAN' => 'PAN'] as $category => $label) {
            if (!vendor_portal_uploaded_files('documents_' . $category)) $missingDocuments[] = $label;
        }
        if ($missingDocuments) throw new InvalidArgumentException('Upload the mandatory documents: ' . implode(', ', $missingDocuments) . '.');
    }
    $bankProofFiles = vendor_portal_uploaded_files('documents_CANCELLED_CHEQUE');
    if (!$bankProofFiles) {
        $message = $data['vendorType'] === 'IMPORT'
            ? 'Upload the bank details on company letterhead, duly signed and stamped.'
            : 'Upload a cancelled cheque or official bank proof.';
        throw new InvalidArgumentException($message);
    }
    vendor_portal_ensure_schema($db);

    $existingMaster = [];
    require_once __DIR__ . '/module_state.php';
    $existingMaster = module_state_read($db, 'DEMOSOLAR_PURCHASE_VENDORS_V1');
    foreach (is_array($existingMaster) ? $existingMaster : [] as $vendor) {
        if (!is_array($vendor)) continue;
        if ($data['gst'] !== '' && strtoupper((string) ($vendor['gst'] ?? '')) === $data['gst']) throw new InvalidArgumentException('This GSTIN is already registered in Vendor Master.');
        if ($data['pan'] !== '' && strtoupper((string) ($vendor['pan'] ?? '')) === $data['pan']) throw new InvalidArgumentException('This PAN is already registered in Vendor Master.');
        if ($data['iec'] !== '' && strtoupper((string) ($vendor['iec'] ?? '')) === $data['iec']) throw new InvalidArgumentException('This IEC is already registered in Vendor Master.');
        if ($data['accountNumber'] !== '' && preg_replace('/\s+/', '', (string) ($vendor['accountNumber'] ?? '')) === $data['accountNumber']) throw new InvalidArgumentException('This bank account is already registered in Vendor Master.');
    }

    $duplicate = $db->prepare("SELECT application_number FROM erp_vendor_applications WHERE status IN ('SUBMITTED','UNDER_REVIEW','CORRECTION_REQUIRED') AND ((gstin<>'' AND gstin=?) OR (pan<>'' AND pan=?) OR (iec<>'' AND iec=?) OR bank_account=?) LIMIT 1");
    if (!$duplicate) throw new RuntimeException('Duplicate application check is unavailable.');
    $duplicate->bind_param('ssss', $data['gst'], $data['pan'], $data['iec'], $data['accountNumber']);
    $duplicate->execute();
    $duplicateRow = $duplicate->get_result()->fetch_assoc();
    $duplicate->close();
    if ($duplicateRow) throw new InvalidArgumentException('An application with the same tax, import or bank details is already pending under reference ' . (string) $duplicateRow['application_number'] . '.');

    $db->begin_transaction();
    $temporaryNumber = 'PENDING-' . bin2hex(random_bytes(12));
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) throw new RuntimeException('Vendor application data could not be prepared.');
    $stmt = $db->prepare("INSERT INTO erp_vendor_applications(application_number,vendor_type,vendor_name,gstin,pan,iec,bank_account,sales_email,payload_json,status) VALUES(?,?,?,?,?,?,?,?,?,'SUBMITTED')");
    if (!$stmt) throw new RuntimeException('Vendor application storage is unavailable.');
    $stmt->bind_param('sssssssss', $temporaryNumber, $data['vendorType'], $data['name'], $data['gst'], $data['pan'], $data['iec'], $data['accountNumber'], $data['salesPersonEmail'], $json);
    if (!$stmt->execute()) throw new RuntimeException('Vendor application could not be saved.');
    $applicationId = (int) $stmt->insert_id;
    $stmt->close();

    $applicationNumber = 'VRA-' . date('Y') . '-' . str_pad((string) $applicationId, 6, '0', STR_PAD_LEFT);
    $update = $db->prepare('UPDATE erp_vendor_applications SET application_number=? WHERE id=?');
    if (!$update) throw new RuntimeException('Vendor application reference could not be created.');
    $update->bind_param('si', $applicationNumber, $applicationId);
    if (!$update->execute()) throw new RuntimeException('Vendor application reference could not be saved.');
    $update->close();

    $pendingRoot = erp_persistent_storage_path('pending_vendor_documents/' . $applicationNumber) . DIRECTORY_SEPARATOR;
    $types = ['application/pdf' => 'pdf', 'image/jpeg' => 'jpg', 'image/png' => 'png'];
    $documentInsert = $db->prepare('INSERT INTO erp_vendor_application_documents(application_id,category,original_name,storage_path,mime_type,file_size) VALUES(?,?,?,?,?,?)');
    if (!$documentInsert) throw new RuntimeException('Vendor document storage is unavailable.');
    foreach (vendor_portal_document_categories() as $category) {
        if ($data['vendorType'] === 'IMPORT' && in_array($category, ['GST', 'PAN', 'MSME', 'TAN'], true)) continue;
        foreach (vendor_portal_uploaded_files('documents_' . $category) as $file) {
            if ($file['error'] !== UPLOAD_ERR_OK || $file['tmp_name'] === '' || !is_uploaded_file($file['tmp_name'])) throw new InvalidArgumentException('One of the ' . $category . ' documents did not upload completely.');
            $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']) ?: '';
            if (!isset($types[$mime])) throw new InvalidArgumentException('Only PDF, JPG, JPEG and PNG vendor documents are accepted.');
            $directory = $pendingRoot . $category . '/';
            if (!is_dir($directory) && !mkdir($directory, 0775, true)) throw new RuntimeException('A pending document folder could not be created.');
            $filename = $category . '_' . date('Ymd_His') . '_' . bin2hex(random_bytes(8)) . '.' . $types[$mime];
            $absolutePath = $directory . $filename;
            if (!move_uploaded_file($file['tmp_name'], $absolutePath)) throw new RuntimeException('A vendor document could not be stored.');
            $storedFiles[] = $absolutePath;
            $relativePath = 'pending_vendor_documents/' . $applicationNumber . '/' . $category . '/' . $filename;
            $originalName = mb_substr(vendor_portal_text($file['name'], 255), 0, 255, 'UTF-8');
            $size = (int) $file['size'];
            $documentInsert->bind_param('issssi', $applicationId, $category, $originalName, $relativePath, $mime, $size);
            if (!$documentInsert->execute()) throw new RuntimeException('Vendor document information could not be saved.');
        }
    }
    $documentInsert->close();

    $history = $db->prepare("INSERT INTO erp_vendor_application_history(application_id,action_code,notes,actor) VALUES(?,'SUBMITTED','Vendor submitted the registration form.','PUBLIC VENDOR PORTAL')");
    if (!$history) throw new RuntimeException('Application history could not be created.');
    $history->bind_param('i', $applicationId);
    if (!$history->execute()) throw new RuntimeException('Application history could not be saved.');
    $history->close();
    $db->commit();

    vendor_registration_respond([
        'status' => 'success',
        'applicationNumber' => $applicationNumber,
        'message' => 'Your vendor registration was submitted for DemoSolar approval.'
    ], 201);
} catch (InvalidArgumentException $error) {
    if ($db->errno || $db->thread_id) @$db->rollback();
    foreach ($storedFiles as $path) if (is_file($path)) @unlink($path);
    vendor_registration_respond(['status' => 'error', 'message' => $error->getMessage()], 422);
} catch (Throwable $error) {
    @$db->rollback();
    foreach ($storedFiles as $path) if (is_file($path)) @unlink($path);
    error_log('Public vendor application failed: ' . $error->getMessage());
    vendor_registration_respond(['status' => 'error', 'message' => 'The vendor application could not be submitted. Please try again or contact DemoSolar Purchase.'], 500);
}
