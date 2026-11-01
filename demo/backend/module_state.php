<?php
/** Versioned server-side ERP module state, independent of legacy kv_storage. */
declare(strict_types=1);

function module_state_read(mysqli $db, string $key)
{
    $stmt = $db->prepare('SELECT payload_json FROM erp_module_state WHERE module_key=?');
    if (!$stmt) throw new RuntimeException('ERP module state is unavailable.');
    $stmt->bind_param('s', $key);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$row) return null;
    $value = json_decode((string) $row['payload_json'], true);
    if (json_last_error() !== JSON_ERROR_NONE) throw new RuntimeException('Stored ERP module data is invalid.');
    return $value;
}

function module_state_read_for_update(mysqli $db, string $key)
{
    $stmt = $db->prepare('SELECT payload_json FROM erp_module_state WHERE module_key=? FOR UPDATE');
    if (!$stmt) throw new RuntimeException('ERP module state is unavailable.');
    $stmt->bind_param('s', $key);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$row) return [];
    $value = json_decode((string) $row['payload_json'], true);
    if (json_last_error() !== JSON_ERROR_NONE) throw new RuntimeException('Stored ERP module data is invalid.');
    return $value;
}

function module_state_write_in_transaction(mysqli $db, string $key, $value): bool
{
    $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) return false;
    $stmt = $db->prepare(
        'INSERT INTO erp_module_state(module_key,payload_json,revision) VALUES(?,?,1) '
        . 'ON DUPLICATE KEY UPDATE payload_json=VALUES(payload_json),revision=revision+1,updated_at=CURRENT_TIMESTAMP'
    );
    if (!$stmt) return false;
    $stmt->bind_param('ss', $key, $json);
    $ok = $stmt->execute();
    $stmt->close();
    return $ok;
}

/**
 * Advance a module revision without rewriting its legacy JSON mirror.
 * Large authoritative modules are already stored row-by-row in
 * erp_runtime_records and normalized ERP tables. Re-encoding their complete
 * multi-megabyte compatibility snapshot on every one-row edit was redundant.
 */
function module_state_touch_in_transaction(mysqli $db, string $key): bool
{
    $empty = '[]';
    $stmt = $db->prepare(
        'INSERT INTO erp_module_state(module_key,payload_json,revision) VALUES(?,?,1) '
        . 'ON DUPLICATE KEY UPDATE payload_json=VALUES(payload_json),revision=revision+1,updated_at=CURRENT_TIMESTAMP'
    );
    if (!$stmt) return false;
    $stmt->bind_param('ss', $key, $empty);
    $ok = $stmt->execute();
    $stmt->close();
    return $ok;
}

function module_state_locked_version(mysqli $db, string $key): string
{
    $stmt = $db->prepare('SELECT revision FROM erp_module_state WHERE module_key=? FOR UPDATE');
    if (!$stmt) throw new RuntimeException('ERP module version is unavailable.');
    $stmt->bind_param('s', $key);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    return $row ? (string) $row['revision'] : '__missing__';
}

function module_state_versions(mysqli $db, array $keys): array
{
    if (!$keys) return [];
    $placeholders = implode(',', array_fill(0, count($keys), '?'));
    $stmt = $db->prepare(
        'SELECT module_key,CAST(revision AS CHAR) AS version_hash '
        . "FROM erp_module_state WHERE module_key IN ($placeholders)"
    );
    if (!$stmt) throw new RuntimeException('ERP module versions are unavailable.');
    $types = str_repeat('s', count($keys));
    $stmt->bind_param($types, ...$keys);
    $stmt->execute();
    $result = $stmt->get_result();
    $versions = [];
    while ($row = $result->fetch_assoc()) $versions[(string) $row['module_key']] = (string) $row['version_hash'];
    $stmt->close();
    return $versions;
}

