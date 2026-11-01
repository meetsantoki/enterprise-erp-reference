<?php
declare(strict_types=1);

function saved_documents_username(array $actor): string
{
    $username = trim((string)($actor['username'] ?? 'USER'));
    $safe = preg_replace('/[^A-Za-z0-9._-]+/', '_', $username) ?: 'USER';
    return trim($safe, '._-') ?: 'USER';
}

function saved_documents_categories(): array
{
    return [
        'pdf' => 'PDF',
        'images' => 'Images',
        'excel' => 'Excel & Data',
        'documents' => 'Documents',
        'presentations' => 'Presentations',
        'archives' => 'Archives',
        'engineering' => 'Engineering',
        'other' => 'Other',
    ];
}

function saved_documents_category(string $extension): string
{
    $extension = strtolower($extension);
    if ($extension === 'pdf') return 'pdf';
    if (in_array($extension, ['jpg','jpeg','png','webp','gif','bmp','tif','tiff','svg'], true)) return 'images';
    if (in_array($extension, ['xls','xlsx','xlsm','xlsb','csv','ods','tsv'], true)) return 'excel';
    if (in_array($extension, ['doc','docx','docm','odt','rtf','txt','md'], true)) return 'documents';
    if (in_array($extension, ['ppt','pptx','pptm','pps','ppsx','odp'], true)) return 'presentations';
    if (in_array($extension, ['zip','7z','rar','tar','gz','bz2'], true)) return 'archives';
    if (in_array($extension, ['dwg','dxf','step','stp','iges','igs'], true)) return 'engineering';
    return 'other';
}

function saved_documents_blocked_extension(string $extension): bool
{
    return in_array(strtolower($extension), [
        'php','php3','php4','php5','php7','php8','phtml','phar','cgi','pl','py','rb','jsp','asp','aspx',
        'exe','com','dll','msi','scr','bat','cmd','ps1','vbs','vbe','js','jse','wsf','wsh','hta','sh','bash',
        'html','htm','shtml','xhtml','jar','app','apk','deb','rpm','dmg','iso'
    ], true);
}

function saved_documents_root(array $actor): string
{
    return erp_persistent_storage_path('saved_document/' . saved_documents_username($actor));
}

function saved_documents_token(string $category, string $filename): string
{
    return rtrim(strtr(base64_encode($category . "\n" . $filename), '+/', '-_'), '=');
}

function saved_documents_decode_token(string $token): ?array
{
    if ($token === '' || !preg_match('/^[A-Za-z0-9_-]{8,500}$/', $token)) return null;
    $padding = strlen($token) % 4;
    if ($padding) $token .= str_repeat('=', 4 - $padding);
    $decoded = base64_decode(strtr($token, '-_', '+/'), true);
    if (!is_string($decoded) || !str_contains($decoded, "\n")) return null;
    [$category, $filename] = explode("\n", $decoded, 2);
    if (!array_key_exists($category, saved_documents_categories()) || $filename === '' || basename($filename) !== $filename) return null;
    if (!preg_match('/^[A-Za-z0-9._-]+$/', $filename)) return null;
    return [$category, $filename];
}

function saved_documents_safe_original_name(string $name): string
{
    $name = trim(str_replace(["\0", "\r", "\n", '/', '\\'], '_', $name));
    $name = $name !== '' ? $name : 'document';
    return function_exists('mb_substr') ? mb_substr($name, 0, 240) : substr($name, 0, 240);
}

function saved_documents_record(array $actor, string $category, string $filename): ?array
{
    $root = saved_documents_root($actor);
    $path = $root . DIRECTORY_SEPARATOR . $category . DIRECTORY_SEPARATOR . $filename;
    if (!is_file($path) || !is_readable($path) || !erp_path_is_inside($path, $root)) return null;
    $metaPath = $path . '.meta.json';
    $meta = [];
    if (is_file($metaPath)) {
        $decoded = json_decode((string)file_get_contents($metaPath), true);
        if (is_array($decoded)) $meta = $decoded;
    }
    $original = saved_documents_safe_original_name((string)($meta['originalName'] ?? preg_replace('/^\d{8}_\d{6}_[a-f0-9]{12}_/', '', $filename)));
    $mime = substr((string)($meta['mime'] ?? 'application/octet-stream'), 0, 160);
    $size = (int)(filesize($path) ?: 0);
    $uploadedAt = (string)($meta['uploadedAt'] ?? date(DATE_ATOM, (int)(filemtime($path) ?: time())));
    $extension = strtolower(pathinfo($original, PATHINFO_EXTENSION));
    $previewable = $mime === 'application/pdf' || str_starts_with($mime, 'image/') && $extension !== 'svg' || str_starts_with($mime, 'text/');
    $token = saved_documents_token($category, $filename);
    return [
        'id' => $token,
        'name' => $original,
        'category' => $category,
        'categoryLabel' => saved_documents_categories()[$category],
        'extension' => strtoupper($extension ?: 'FILE'),
        'mime' => $mime,
        'size' => $size,
        'uploadedAt' => $uploadedAt,
        'previewable' => $previewable,
        'previewUrl' => 'backend/api.php?action=saved_document_file&id=' . rawurlencode($token) . '&preview=1',
        'downloadUrl' => 'backend/api.php?action=saved_document_file&id=' . rawurlencode($token),
    ];
}

function saved_documents_list(array $actor): array
{
    $root = saved_documents_root($actor);
    $files = [];
    if (is_dir($root)) {
        foreach (saved_documents_categories() as $category => $_label) {
            $directory = $root . DIRECTORY_SEPARATOR . $category;
            if (!is_dir($directory)) continue;
            foreach (new DirectoryIterator($directory) as $entry) {
                if ($entry->isDot() || !$entry->isFile() || str_ends_with($entry->getFilename(), '.meta.json')) continue;
                $record = saved_documents_record($actor, $category, $entry->getFilename());
                if ($record) $files[] = $record;
            }
        }
    }
    usort($files, fn(array $a, array $b): int => strcmp((string)$b['uploadedAt'], (string)$a['uploadedAt']));
    return $files;
}

function saved_documents_upload(mysqli $db, array $actor): void
{
    $incoming = $_FILES['files'] ?? null;
    if (!is_array($incoming) || !isset($incoming['name'])) respond(['status'=>'error','message'=>'Choose at least one file to save.'], 400);
    $names = is_array($incoming['name']) ? $incoming['name'] : [$incoming['name']];
    $tmpNames = is_array($incoming['tmp_name'] ?? null) ? $incoming['tmp_name'] : [$incoming['tmp_name'] ?? ''];
    $sizes = is_array($incoming['size'] ?? null) ? $incoming['size'] : [$incoming['size'] ?? 0];
    $errors = is_array($incoming['error'] ?? null) ? $incoming['error'] : [$incoming['error'] ?? UPLOAD_ERR_NO_FILE];
    if (count($names) > 10) respond(['status'=>'error','message'=>'Upload up to 10 files at a time.'], 400);
    $root = saved_documents_root($actor);
    if (!is_dir($root) && !mkdir($root, 0750, true) && !is_dir($root)) respond(['status'=>'error','message'=>'Your Saved Documents folder could not be created.'], 500);
    $saved = [];$rejected = [];$finfo = new finfo(FILEINFO_MIME_TYPE);
    foreach ($names as $index => $rawName) {
        $original = saved_documents_safe_original_name((string)$rawName);
        $temporary = (string)($tmpNames[$index] ?? '');
        $size = (int)($sizes[$index] ?? 0);
        $error = (int)($errors[$index] ?? UPLOAD_ERR_NO_FILE);
        $extension = strtolower(pathinfo($original, PATHINFO_EXTENSION));
        if ($error !== UPLOAD_ERR_OK || $size <= 0 || !is_uploaded_file($temporary)) {$rejected[]=['name'=>$original,'reason'=>'Upload failed.'];continue;}
        if (saved_documents_blocked_extension($extension)) {$rejected[]=['name'=>$original,'reason'=>'Executable or web-script files are not allowed.'];continue;}
        $mime = (string)($finfo->file($temporary) ?: 'application/octet-stream');
        if (preg_match('~(?:php|x-httpd|x-executable|x-dosexec|javascript|html)~i', $mime)) {$rejected[]=['name'=>$original,'reason'=>'Executable or active web content is not allowed.'];continue;}
        $category = saved_documents_category($extension);
        $directory = $root . DIRECTORY_SEPARATOR . $category;
        if (!is_dir($directory) && !mkdir($directory, 0750, true) && !is_dir($directory)) {$rejected[]=['name'=>$original,'reason'=>'The file-type folder could not be created.'];continue;}
        $safeBase = preg_replace('/[^A-Za-z0-9._-]+/', '_', pathinfo($original, PATHINFO_FILENAME)) ?: 'document';
        $safeBase = substr(trim($safeBase, '._-') ?: 'document', 0, 90);
        $stored = date('Ymd_His') . '_' . bin2hex(random_bytes(6)) . '_' . $safeBase . ($extension !== '' ? '.' . $extension : '');
        $destination = $directory . DIRECTORY_SEPARATOR . $stored;
        if (!move_uploaded_file($temporary, $destination)) {$rejected[]=['name'=>$original,'reason'=>'The file could not be stored.'];continue;}
        @chmod($destination, 0640);
        $metadata = ['originalName'=>$original,'mime'=>$mime,'size'=>$size,'uploadedAt'=>date(DATE_ATOM),'uploadedBy'=>(string)($actor['username']??'USER')];
        if (file_put_contents($destination . '.meta.json', json_encode($metadata, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES), LOCK_EX) === false) {@unlink($destination);$rejected[]=['name'=>$original,'reason'=>'File metadata could not be stored.'];continue;}
        $record = saved_documents_record($actor, $category, $stored);
        if ($record) $saved[] = $record;
    }
    if (!$saved) respond(['status'=>'error','message'=>$rejected[0]['reason'] ?? 'No files could be saved.','rejected'=>$rejected], 422);
    try { append_audit_event($db, $actor, 'SYSTEM', 'SAVED_DOCUMENTS_UPLOADED', 'Saved ' . count($saved) . ' private document(s); rejected ' . count($rejected) . '.'); }
    catch (Throwable $error) { error_log('Saved Documents upload audit failed: ' . $error->getMessage()); }
    respond(['status'=>'success','message'=>count($saved).' file(s) saved.','saved'=>$saved,'rejected'=>$rejected]);
}

function saved_documents_file(array $actor): void
{
    $decoded = saved_documents_decode_token(trim((string)($_GET['id'] ?? '')));
    if (!$decoded) respond(['status'=>'error','message'=>'The selected file is invalid.'], 400);
    [$category, $filename] = $decoded;
    $record = saved_documents_record($actor, $category, $filename);
    if (!$record) respond(['status'=>'error','message'=>'The selected file was not found.'], 404);
    $path = saved_documents_root($actor) . DIRECTORY_SEPARATOR . $category . DIRECTORY_SEPARATOR . $filename;
    $preview = ($_GET['preview'] ?? '') === '1' && $record['previewable'];
    $fallback = preg_replace('/[^A-Za-z0-9._-]+/', '_', (string)$record['name']) ?: 'document';
    header_remove('Content-Type');
    header('Content-Type: ' . ($record['mime'] ?: 'application/octet-stream'));
    header('Content-Length: ' . (string)filesize($path));
    header('Content-Disposition: ' . ($preview ? 'inline' : 'attachment') . '; filename="' . addcslashes($fallback, '"\\') . '"; filename*=UTF-8\'\'' . rawurlencode((string)$record['name']));
    header('Cache-Control: no-store, private');
    header('X-Content-Type-Options: nosniff');
    readfile($path);exit;
}

function saved_documents_delete(mysqli $db, array $actor): void
{
    $input = json_body();
    $decoded = saved_documents_decode_token(trim((string)($input['id'] ?? '')));
    if (!$decoded) respond(['status'=>'error','message'=>'The selected file is invalid.'], 400);
    [$category, $filename] = $decoded;
    $record = saved_documents_record($actor, $category, $filename);
    if (!$record) respond(['status'=>'error','message'=>'The selected file was not found.'], 404);
    $path = saved_documents_root($actor) . DIRECTORY_SEPARATOR . $category . DIRECTORY_SEPARATOR . $filename;
    if (!unlink($path)) respond(['status'=>'error','message'=>'The selected file could not be deleted.'], 500);
    $meta = $path . '.meta.json';if (is_file($meta)) @unlink($meta);
    try { append_audit_event($db, $actor, 'SYSTEM', 'SAVED_DOCUMENT_DELETED', 'Deleted private saved document ' . substr((string)$record['name'], 0, 220) . '.'); }
    catch (Throwable $error) { error_log('Saved Documents delete audit failed: ' . $error->getMessage()); }
    respond(['status'=>'success','message'=>'File deleted.']);
}

function saved_documents_handle(mysqli $db, array $actor, string $action, string $method): void
{
    if ($action === 'saved_documents' && $method === 'GET') {
        $files = saved_documents_list($actor);$total = array_sum(array_column($files, 'size'));
        respond(['status'=>'success','files'=>$files,'totalFiles'=>count($files),'totalSize'=>$total,'username'=>(string)($actor['username']??'USER'),'categories'=>saved_documents_categories()]);
    }
    if ($action === 'saved_documents_upload' && $method === 'POST') saved_documents_upload($db, $actor);
    if ($action === 'saved_document_file' && $method === 'GET') saved_documents_file($actor);
    if ($action === 'saved_document_delete' && $method === 'POST') saved_documents_delete($db, $actor);
    respond(['status'=>'error','message'=>'Unsupported Saved Documents request.'], 405);
}
