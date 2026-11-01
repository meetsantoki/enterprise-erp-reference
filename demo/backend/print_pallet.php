<?php
require_once __DIR__ . '/session_guard.php';
require_erp_session(['admin', 'packing'], ['packing', 'packingScan']);
header("Content-Type: application/json; charset=UTF-8");

$rawInput = file_get_contents('php://input');
$request = json_decode($rawInput, true);

if (!is_array($request) || empty($request['pallet'])) {
    echo json_encode(["status" => "error", "message" => "Invalid pallet payload."]);
    exit;
}

// Printer Configuration
$printerIp = "192.0.2.121";
$printerPort = 9100;
$timeout = 4; // seconds

function print_text($value, int $length = 40): string {
    $value = preg_replace('/[\x00-\x1F\x7F]/u', ' ', (string) $value);
    $value = trim($value);
    return function_exists('mb_substr') ? mb_substr($value, 0, $length) : substr($value, 0, $length);
}
$requestedPallet=strtoupper(substr(trim((string)$request['pallet']),0,120));
$guardDb=erp_guard_database();$data=null;
foreach(erp_guard_read_module($guardDb,'DEMOSOLAR_STOCK_PALLET_FORMAT_V7') as $saved){if(is_array($saved)&&strtoupper(trim((string)($saved['pallet']??'')))===$requestedPallet){$data=$saved;break;}}
if($data===null){foreach(erp_guard_read_module($guardDb,'DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7') as $dispatch){foreach(is_array($dispatch['pallets']??null)?$dispatch['pallets']:[] as $saved){if(is_array($saved)&&strtoupper(trim((string)($saved['pallet']??'')))===$requestedPallet){$data=$saved;break 2;}}}}
$guardDb->close();
if($data===null){http_response_code(404);echo json_encode(['status'=>'error','message'=>'The saved pallet was not found.']);exit;}
$palletNo = print_text($data['pallet'], 24);
$grade = print_text($data['grade'] ?? 'A GRADE', 18);
$model = print_text($data['model'] ?? '-', 40);
$binning = print_text($data['binning'] ?? '-', 20);
$watt = print_text($data['watt'] ?? '-', 18);
$capacity = max(1, min(100, (int) ($data['capacity'] ?? 31)));
$serials = is_array($data['fullRows'] ?? null) ? array_slice(array_values($data['fullRows']), 0, $capacity) : [];

// Construct PCL / Clean RAW text buffer with form feed (FF) for Brother HL-B2180DW
$ESC = chr(27);
$FF  = chr(12);

$payload  = $ESC . "@"; // Initialize Printer
$payload .= $ESC . "(s0p12h0s0b4099T"; // Default font
$payload .= "========================================================================\r\n";
$payload .= "                      DEMOSOLAR ENERGY PVT LTD                            \r\n";
$payload .= "========================================================================\r\n";
$payload .= sprintf("PALLET NO  : %-20s  GRADE   : %s\r\n", $palletNo, $grade);
$payload .= sprintf("MODEL TYPE : %-20s  BINNING : %-6s  QTY: %d / %d\r\n", $model, $binning, count($serials), $capacity);
$payload .= sprintf("WATTAGE    : %s\r\n", $watt);
$payload .= "------------------------------------------------------------------------\r\n";
$payload .= sprintf("%-4s  %-26s  %-15s  %-10s\r\n", "NO", "SERIAL NUMBER", "PO NUMBER", "WATT");
$payload .= "------------------------------------------------------------------------\r\n";

foreach ($serials as $i => $row) {
    if (!is_array($row)) continue;
    $sNo = $i + 1;
    $sn  = print_text($row['serial'] ?? '-', 26);
    $po  = print_text($row['po'] ?? '-', 15);
    $wt  = print_text($row['watt'] ?? $watt, 10);
    $payload .= sprintf("%-4d  %-26s  %-15s  %-10s\r\n", $sNo, $sn, $po, $wt);
}

$payload .= "========================================================================\r\n";
$payload .= "  PRINTED AUTOMATICALLY VIA DEMOSOLAR ERP RAW JETDIRECT RELAY (PORT 9100) \r\n";
$payload .= "========================================================================\r\n";
$payload .= $FF; // Eject A4 Sticker Sheet

// Open Raw TCP Socket Connection to Brother Printer
$socket = @fsockopen($printerIp, $printerPort, $errno, $errstr, $timeout);
if (!$socket) {
    echo json_encode([
        "status" => "error", 
        "message" => "Could not connect to Brother printer at {$printerIp}:9100. Error: {$errstr} ({$errno})"
    ]);
    exit;
}

// Stream to printer buffer
stream_set_timeout($socket, $timeout);
fwrite($socket, $payload);
fflush($socket);
fclose($socket);

echo json_encode([
    "status" => "success",
    "message" => "Pallet {$palletNo} sent directly to Brother printer at {$printerIp}."
]);
