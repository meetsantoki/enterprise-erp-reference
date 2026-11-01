<?php
// Copy this file to cctv_config.php on the ERP server. Keep it outside source control.
// Generate the token secret with: php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
return [
    'token_secret' => 'REPLACE_WITH_64_RANDOM_HEX_CHARACTERS',
    'token_lifetime_seconds' => 120,
    // IIS/ARR exposes this same-origin path and proxies it to the local gateway.
    'gateway_public_base' => '/cctv-stream/',
];
