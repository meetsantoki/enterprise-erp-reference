<?php
declare(strict_types=1);

/**
 * Permanent ERP files live beside the replaceable ERP application directory.
 * Set ERP_PERSISTENT_ROOT to override the default on a particular server.
 */
function erp_persistent_root(): string
{
    $configured = trim((string) (getenv('ERP_PERSISTENT_ROOT') ?: ''));
    $root = $configured !== ''
        ? $configured
        : dirname(dirname(__DIR__)) . DIRECTORY_SEPARATOR . 'ERP_PERSISTENT_DATA';
    return rtrim(str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $root), DIRECTORY_SEPARATOR);
}

function erp_persistent_path(string $relative = ''): string
{
    $segments = [];
    foreach (preg_split('~[\\\\/]+~', trim($relative)) ?: [] as $segment) {
        if ($segment === '' || $segment === '.') continue;
        if ($segment === '..' || str_contains($segment, "\0")) {
            throw new InvalidArgumentException('Invalid persistent storage path.');
        }
        $segments[] = $segment;
    }
    return erp_persistent_root() . ($segments ? DIRECTORY_SEPARATOR . implode(DIRECTORY_SEPARATOR, $segments) : '');
}

function erp_persistent_storage_path(string $logicalPath): string
{
    return erp_persistent_path($logicalPath);
}

/** Read migrated files first, with a temporary fallback to the old ERP folders. */
function erp_existing_storage_path(string $logicalPath): string
{
    $persistent = erp_persistent_storage_path($logicalPath);
    if (file_exists($persistent)) return $persistent;
    return dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace(['/', '\\'], DIRECTORY_SEPARATOR, ltrim($logicalPath, '/\\'));
}

function erp_config_path(string $filename = 'config.php'): string
{
    $persistent = erp_persistent_path('config/' . basename($filename));
    if (is_file($persistent)) return $persistent;
    return __DIR__ . DIRECTORY_SEPARATOR . basename($filename);
}

function erp_path_is_inside(string $path, string $root): bool
{
    $realPath = realpath($path);
    $realRoot = realpath($root);
    if ($realPath === false || $realRoot === false) return false;
    $realPath = strtolower(rtrim($realPath, DIRECTORY_SEPARATOR));
    $realRoot = strtolower(rtrim($realRoot, DIRECTORY_SEPARATOR));
    return $realPath === $realRoot || str_starts_with($realPath, $realRoot . DIRECTORY_SEPARATOR);
}

