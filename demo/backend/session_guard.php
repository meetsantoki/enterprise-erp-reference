<?php
declare(strict_types=1);
require_once __DIR__.'/persistent_paths.php';
require_once __DIR__.'/module_state.php';
require_once __DIR__.'/relational_runtime.php';
require_once __DIR__.'/it_management_common.php';

/** Shared, server-side guard for ERP export and direct-print endpoints. */
function erp_guard_fail(int $status, string $message): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');
    header('Cache-Control: no-store, private');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('Referrer-Policy: same-origin');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    echo json_encode(['status' => 'error', 'message' => $message]);
    exit;
}

function erp_guard_is_https(): bool {
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') return true;
    $forwarded = strtolower(trim(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))[0] ?? ''));
    if ($forwarded === 'https') return true;
    $visitor = json_decode((string) ($_SERVER['HTTP_CF_VISITOR'] ?? ''), true);
    return is_array($visitor) && strtolower((string) ($visitor['scheme'] ?? '')) === 'https';
}

function erp_guard_same_origin(): bool {
    $source = trim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''));
    if ($source === '') $source = trim((string) ($_SERVER['HTTP_REFERER'] ?? ''));
    if ($source === '') return false;
    $sourceHost = strtolower((string) (parse_url($source, PHP_URL_HOST) ?? ''));
    $requestHost = strtolower(trim(explode(':', (string) ($_SERVER['HTTP_HOST'] ?? ''))[0] ?? ''));
    return $sourceHost !== '' && $requestHost !== '' && hash_equals($requestHost, $sourceHost);
}

function erp_guard_config(): array {
    $config = [
        'db_host' => getenv('ERP_DB_HOST') ?: '127.0.0.1',
        'db_port' => (int) (getenv('ERP_DB_PORT') ?: 3306),
        'db_name' => getenv('ERP_DB_NAME') ?: 'demosolar_erp',
        'db_user' => getenv('ERP_DB_USER') ?: 'root',
        'db_pass' => getenv('ERP_DB_PASSWORD') ?: '',
        'session_idle_seconds' => (int) (getenv('ERP_SESSION_IDLE_SECONDS') ?: 1800),
        'session_absolute_seconds' => (int) (getenv('ERP_SESSION_ABSOLUTE_SECONDS') ?: 28800),
    ];
    $path = erp_config_path();
    if (is_file($path)) {
        $local = require $path;
        if (is_array($local)) $config = array_replace($config, $local);
    }
    return $config;
}

function erp_guard_user(mysqli $db, string $userId): ?array {
    $key = 'DEMOSOLAR_USERS_PALLET_FORMAT_V7';
    $users = rr_runtime_is_authoritative($db,$key) ? rr_runtime_read_records($db,$key) : module_state_read($db,$key);
    if (!is_array($users)) return null;
    $users=rr_hydrate_user_permissions($db,$users);
    foreach ($users as $user) {
        if (is_array($user) && (string) ($user['id'] ?? '') === $userId) return $user;
    }
    return null;
}

function erp_guard_database(): mysqli {
    $config=erp_guard_config();mysqli_report(MYSQLI_REPORT_OFF);
    $db=@new mysqli((string)$config['db_host'],(string)$config['db_user'],(string)$config['db_pass'],(string)$config['db_name'],(int)$config['db_port']);
    if($db->connect_error)erp_guard_fail(500,'ERP database connection failed. Contact the system administrator.');
    $db->set_charset('utf8mb4');return $db;
}
function erp_guard_read_module(mysqli $db,string $key): array {
    $value=rr_runtime_is_authoritative($db,$key)?rr_runtime_read_records($db,$key):module_state_read($db,$key);
    return is_array($value)?$value:[];
}

function erp_guard_has_any_right(array $user, array $rights): bool {
    if (!is_array($user['rights'] ?? null)) return false;
    foreach ($rights as $right) {
        $value = $user['rights'][$right] ?? false;
        if ($value === true || $value === 1 || $value === '1' || $value === 'true') return true;
    }
    return false;
}

function require_erp_session(array $allowedRoles = [], array $requiredRights = []): array {
    $https = erp_guard_is_https();
    session_name('DEMOSOLAR_ERP_SESSION');
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Strict']);
    if (session_status() !== PHP_SESSION_ACTIVE) session_start();
    if (empty($_SESSION['erp_csrf']) || !is_string($_SESSION['erp_csrf'])) $_SESSION['erp_csrf'] = bin2hex(random_bytes(32));
    header('X-ERP-CSRF-Token: ' . $_SESSION['erp_csrf']);

    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
        $provided = (string) ($_SERVER['HTTP_X_ERP_CSRF_TOKEN'] ?? '');
        if (!erp_guard_same_origin() || $provided === '' || !hash_equals((string) $_SESSION['erp_csrf'], $provided)) {
            erp_guard_fail(403, 'Your secure form token expired. Refresh the ERP page and try again.');
        }
    }

    $config = erp_guard_config();
    mysqli_report(MYSQLI_REPORT_OFF);
    $db = @new mysqli((string) $config['db_host'], (string) $config['db_user'], (string) $config['db_pass'], (string) $config['db_name'], (int) $config['db_port']);
    if ($db->connect_error) erp_guard_fail(500, 'ERP database connection failed. Contact the system administrator.');
    $db->set_charset('utf8mb4');
    $config=it_apply_session_settings($db,$config);
    $now = time();
    $userId = (string) ($_SESSION['erp_user_id'] ?? '');
    $started = (int) ($_SESSION['erp_started'] ?? 0);
    $seen = (int) ($_SESSION['erp_seen'] ?? 0);
    if ($userId === '' || $started <= 0 || $seen <= 0 || $now - $seen > (int) $config['session_idle_seconds'] || $now - $started > (int) $config['session_absolute_seconds']) {
        $_SESSION = [];
        session_destroy();
        erp_guard_fail(401, 'Your secure ERP session has expired. Please sign in again.');
    }

    $user = erp_guard_user($db, $userId);
    if (!$user || strtoupper((string) ($user['status'] ?? '')) !== 'ACTIVE' || !it_validate_session($db,$user,$config)) {
        $_SESSION = [];
        session_destroy();
        erp_guard_fail(401, 'Your ERP account is not active.');
    }

    $role = strtolower((string) ($user['role'] ?? ''));
    $permitted = is_array($user['rights'] ?? null)
        ? erp_guard_has_any_right($user, $requiredRights)
        : (!$allowedRoles || in_array($role, $allowedRoles, true));
    if (!$permitted) erp_guard_fail(403, 'Your User Rights do not allow this action.');
    $_SESSION['erp_seen'] = $now;
    $lastRotation = (int) ($_SESSION['erp_rotated'] ?? $_SESSION['erp_started']);
    if ($now - $lastRotation >= 900) {
        it_rotate_session($db,$user,$config);
        $_SESSION['erp_rotated'] = $now;
    }
    session_write_close();
    return $user;
}
