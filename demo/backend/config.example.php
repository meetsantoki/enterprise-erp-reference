<?php
// Copy as config.php on the local PC/NAS. Do not store config.php in source control.
return [
  'db_host'=>'127.0.0.1', 'db_port'=>3306, 'db_name'=>'demosolar_erp',
  'db_user'=>'demosolar_erp_app', 'db_pass'=>'CHANGE_THIS_TO_A_LONG_UNIQUE_PASSWORD',
  'session_idle_seconds'=>1800, 'session_absolute_seconds'=>28800,
  // Keep the project key only on the server. AI stays off until both values are set.
];
