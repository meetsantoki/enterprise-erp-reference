<?php
declare(strict_types=1);

require_once __DIR__ . '/session_guard.php';
require_erp_session(['admin', 'dispatch', 'packing'], ['dispatch', 'dispatchViewList', 'dispatchChallan', 'packing', 'packingScan']);

use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\Alignment;
use PhpOffice\PhpSpreadsheet\Style\Border;
use PhpOffice\PhpSpreadsheet\Style\Color;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Worksheet\Drawing;
use PhpOffice\PhpSpreadsheet\Worksheet\PageSetup;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

require_once __DIR__ . '/../vendor/autoload.php';

function exportError(int $status, string $message): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode(['status' => 'error', 'message' => $message]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    exportError(405, 'Only POST requests are allowed.');
}

try {
    $input = json_decode(file_get_contents('php://input'), true, 512, JSON_THROW_ON_ERROR);
} catch (JsonException $exception) {
    exportError(400, 'The packing-list export data is invalid.');
}

$requestedId=trim((string)($input['manifestId']??($input['manifest']['id']??'')));
$requestedInvoice=trim((string)($input['invoiceNumber']??($input['manifest']['invoice']??'')));
if($requestedId===''&&$requestedInvoice==='')exportError(400,'A saved dispatch ID or invoice number is required.');
$guardDb=erp_guard_database();$archive=erp_guard_read_module($guardDb,'DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7');$guardDb->close();$manifest=null;
foreach($archive as $saved){if(!is_array($saved))continue;if(($requestedId!==''&&hash_equals((string)($saved['id']??''),$requestedId))||($requestedInvoice!==''&&strcasecmp((string)($saved['invoice']??''),$requestedInvoice)===0)){$manifest=$saved;break;}}
if($manifest===null)exportError(404,'The saved dispatch record was not found.');

try {
    $text = static function ($value, string $fallback = '-'): string {
        $value = trim((string) ($value ?? ''));
        return $value === '' ? $fallback : $value;
    };

    $safeFilePart = static function ($value): string {
        $value = preg_replace('/[^A-Za-z0-9_-]/', '_', (string) $value);
        return trim((string) $value, '_') ?: 'PACKING_LIST';
    };

    $spreadsheet = new Spreadsheet();
    $sheet = $spreadsheet->getActiveSheet();
    $sheet->setTitle('Packing List');
    $sheet->setShowGridlines(false);

    foreach (['A' => 22, 'B' => 28, 'C' => 22, 'D' => 24, 'E' => 24] as $column => $width) {
        $sheet->getColumnDimension($column)->setWidth($width);
    }

    for ($row = 1; $row <= 6; $row++) {
        $sheet->getRowDimension($row)->setRowHeight(22);
    }

    $blackBorder = [
        'borders' => [
            'allBorders' => ['borderStyle' => Border::BORDER_THIN, 'color' => ['rgb' => '000000']],
        ],
    ];
    $center = ['horizontal' => Alignment::HORIZONTAL_CENTER, 'vertical' => Alignment::VERTICAL_CENTER, 'wrapText' => true];
    $blueFill = ['fillType' => Fill::FILL_SOLID, 'color' => ['rgb' => '5B9BD5']];
    $cyanFill = ['fillType' => Fill::FILL_SOLID, 'color' => ['rgb' => '7EC8E3']];

    $setText = static function (string $cell, $value) use ($sheet, $text): void {
        $sheet->setCellValueExplicit($cell, $text($value), DataType::TYPE_STRING);
    };

    $sheet->mergeCells('A1:B6');
    $sheet->mergeCells('C1:E1');
    $sheet->mergeCells('C2:E4');
    $sheet->mergeCells('C5:E5');
    $sheet->mergeCells('C6:E6');
    $sheet->getStyle('A1:E6')->applyFromArray($blackBorder);
    $sheet->getStyle('A1:E6')->getAlignment()->applyFromArray($center);

    $sheet->setCellValue('C1', 'DEMOSOLAR INDUSTRIES PRIVATE LIMITED');
    $sheet->getStyle('C1')->getFont()->setBold(true)->setSize(16)->setColor(new Color('6B21A8'));
    $sheet->setCellValue('C2', "Address:- Demo Industrial Park, Ahmedabad - 380001, Gujarat - India");
    $sheet->getStyle('C2')->getFont()->setSize(10);
    $sheet->setCellValue('C5', 'Contact No: +91 9000000004');
    $sheet->setCellValue('C6', 'Email: support@example.test');
    $sheet->getStyle('C5:C6')->getFont()->setBold(true)->setSize(11);

    $logoPath = __DIR__ . '/../assets/demo-logo.svg';
    if (is_file($logoPath)) {
        $drawing = new Drawing();
        $drawing->setName('DemoSolar Industries Logo');
        $drawing->setDescription('DemoSolar Industries Logo');
        $drawing->setPath($logoPath);
        // A1:B6 is the fixed logo box in this packing-list layout.
        $drawing->setResizeProportional(false);
        $drawing->setWidthAndHeight(370, 178);
        $drawing->setCoordinates('A1');
        $drawing->setOffsetX(0);
        $drawing->setOffsetY(0);
        $drawing->setWorksheet($sheet);
    }

    $infoRows = [
        ['Transporter Name:', $manifest['transporter'] ?? null, 'Challan no:', $manifest['challanNo'] ?? null],
        ['Vehicle No:', $manifest['vehicle'] ?? null, 'Date:', $manifest['date'] ?? null],
        ['Driver No:', $manifest['driverNo'] ?? null, 'Mode of Transport:', $manifest['modeTransport'] ?? 'By Road'],
        ['Driver Name:', $manifest['driverName'] ?? null, 'Delivery Order No:', $manifest['deliveryOrderNo'] ?? null],
        ['LR No:', $manifest['lrNo'] ?? null, 'Customer Name:', $manifest['customer'] ?? null],
        ['Packing Type:', $manifest['packingType'] ?? 'Box Packing', 'Invoice No.:', $manifest['invoice'] ?? null],
    ];

    $row = 7;
    foreach ($infoRows as [$leftLabel, $leftValue, $rightLabel, $rightValue]) {
        $sheet->mergeCells("D{$row}:E{$row}");
        $setText("A{$row}", $leftLabel);
        $setText("B{$row}", $leftValue);
        $setText("C{$row}", $rightLabel);
        $setText("D{$row}", $rightValue);
        $sheet->getStyle("A{$row}:E{$row}")->applyFromArray($blackBorder);
        $sheet->getStyle("A{$row}:E{$row}")->getAlignment()->applyFromArray($center);
        $sheet->getStyle("A{$row}:A{$row}")->applyFromArray($blueFill);
        $sheet->getStyle("C{$row}:C{$row}")->applyFromArray($blueFill);
        $sheet->getStyle("A{$row}:E{$row}")->getFont()->setBold(true)->setSize(11);
        $sheet->getRowDimension($row)->setRowHeight(22);
        $row++;
    }

    $sheet->mergeCells("A{$row}:B{$row}");
    $setText("A{$row}", 'Product Detail');
    $setText("C{$row}", 'HSN Code');
    $setText("D{$row}", 'Order Qty:');
    $setText("E{$row}", 'Qty');
    $sheet->getStyle("A{$row}:E{$row}")->applyFromArray($blackBorder + $cyanFill);
    $sheet->getStyle("A{$row}:E{$row}")->getAlignment()->applyFromArray($center);
    $sheet->getStyle("A{$row}:E{$row}")->getFont()->setBold(true)->setSize(11);
    $sheet->getRowDimension($row)->setRowHeight(24);
    $row++;

    $sheet->mergeCells("A{$row}:B{$row}");
    $setText("A{$row}", $manifest['product'] ?? null);
    $setText("C{$row}", $manifest['hsnCode'] ?? '85414300');
    $setText("D{$row}", $manifest['orderQty'] ?? null);
    $pallets = isset($manifest['pallets']) && is_array($manifest['pallets']) ? $manifest['pallets'] : [];
    $totalQuantity = $manifest['dispatchedQty'] ?? array_sum(array_map(static fn ($p) => (int) ($p['count'] ?? 0), $pallets));
    $setText("E{$row}", $totalQuantity);
    $sheet->getStyle("A{$row}:E{$row}")->applyFromArray($blackBorder);
    $sheet->getStyle("A{$row}:E{$row}")->getAlignment()->applyFromArray($center);
    $sheet->getStyle("A{$row}:E{$row}")->getFont()->setBold(true)->setSize(11);
    $sheet->getStyle("E{$row}")->getFont()->setColor(new Color('059669'));
    $sheet->getRowDimension($row)->setRowHeight(22);
    $row++;

    foreach ($pallets as $pallet) {
        if (!is_array($pallet)) {
            continue;
        }

        $serials = isset($pallet['serials']) && is_array($pallet['serials']) ? $pallet['serials'] : [];
        if ($serials === [] && isset($pallet['fullRows']) && is_array($pallet['fullRows'])) {
            $serials = array_map(static fn ($item) => is_array($item) ? ($item['serial'] ?? '') : '', $pallet['fullRows']);
        }

        $sheet->mergeCells("A{$row}:E{$row}");
        $palletTitle = 'PALLET NO: ' . $text($pallet['pallet'] ?? null)
            . '  |  Model: ' . $text($pallet['model'] ?? null)
            . '  |  Grade: ' . $text($pallet['grade'] ?? 'A GRADE')
            . '  |  Watt: ' . $text($pallet['watt'] ?? null);
        $setText("A{$row}", $palletTitle);
        $sheet->getStyle("A{$row}:E{$row}")->applyFromArray($blackBorder);
        $sheet->getStyle("A{$row}:E{$row}")->getAlignment()->applyFromArray(['vertical' => Alignment::VERTICAL_CENTER]);
        $sheet->getStyle("A{$row}")->getFont()->setBold(true)->setSize(11);
        $sheet->getStyle("A{$row}")->applyFromArray(['fill' => ['fillType' => Fill::FILL_SOLID, 'color' => ['rgb' => 'E2E8F0']]]);
        $sheet->getRowDimension($row)->setRowHeight(22);
        $row++;

        $sheet->mergeCells("B{$row}:C{$row}");
        foreach (['A' => 'NO', 'B' => 'SERIAL NUMBER', 'D' => 'PO NUMBER', 'E' => 'CELL TYPE'] as $column => $heading) {
            $setText("{$column}{$row}", $heading);
        }
        $sheet->getStyle("A{$row}:E{$row}")->applyFromArray($blackBorder + ['fill' => ['fillType' => Fill::FILL_SOLID, 'color' => ['rgb' => 'E2E8F0']]]);
        $sheet->getStyle("A{$row}:E{$row}")->getAlignment()->applyFromArray($center);
        $sheet->getStyle("A{$row}:E{$row}")->getFont()->setBold(true)->setSize(11);
        $sheet->getRowDimension($row)->setRowHeight(22);
        $row++;

        foreach ($serials as $index => $serial) {
            $sheet->mergeCells("B{$row}:C{$row}");
            $setText("A{$row}", $index + 1);
            $setText("B{$row}", $serial);
            $setText("D{$row}", $pallet['po'] ?? $manifest['po'] ?? null);
            $setText("E{$row}", $pallet['cellType'] ?? $manifest['cellType'] ?? 'NON - DCR');
            $sheet->getStyle("A{$row}:E{$row}")->applyFromArray($blackBorder);
            $sheet->getStyle("A{$row}:E{$row}")->getAlignment()->applyFromArray($center);
            $sheet->getStyle("B{$row}")->getFont()->setBold(true);
            $sheet->getRowDimension($row)->setRowHeight(20);
            $row++;
        }
    }

    $sheet->getPageSetup()->setOrientation(PageSetup::ORIENTATION_LANDSCAPE);
    $sheet->getPageSetup()->setPaperSize(PageSetup::PAPERSIZE_A4);
    $sheet->getPageSetup()->setFitToWidth(1)->setFitToHeight(0);
    $sheet->getPageMargins()->setTop(0.25)->setBottom(0.25)->setLeft(0.2)->setRight(0.2);

    $invoice = $text($manifest['invoice'] ?? null, $manifest['po'] ?? 'PACKING_LIST');
    $filename = 'Packing_List_' . $safeFilePart($invoice) . '.xlsx';

    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Cache-Control: max-age=0, no-store');

    $writer = new Xlsx($spreadsheet);
    $writer->save('php://output');
    $spreadsheet->disconnectWorksheets();
    exit;
} catch (Throwable $exception) {
    error_log('Packing-list XLSX export failed: ' . $exception->getMessage());
    exportError(500, 'Excel export failed. Check that the PHP GD and ZIP extensions are enabled.');
}
