<?php
/**
 * One-time/repeatable reconciliation of all current module-state snapshots into
 * normalized tables. Safe to run more than once; all writes are upserts.
 *
 * Usage: php backend/sync_relational_runtime.php
 */
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require_once __DIR__.'/persistent_paths.php';

$config=require erp_config_path();
mysqli_report(MYSQLI_REPORT_ERROR|MYSQLI_REPORT_STRICT);
$db=new mysqli((string)($config['db_host']??'127.0.0.1'),(string)($config['db_user']??'root'),(string)($config['db_pass']??''),(string)($config['db_name']??'demosolar_erp'),(int)($config['db_port']??3306));
$db->set_charset('utf8mb4');
require_once __DIR__.'/module_state.php';
require_once __DIR__.'/relational_runtime.php';

$keys=rr_module_keys();

if(!rr_ready($db)){fwrite(STDERR,"Import migrate_relational_runtime.sql first.\n");exit(1);}
$db->begin_transaction();
try{
  foreach($keys as $key){$value=rr_runtime_is_authoritative($db,$key)?rr_runtime_read_records($db,$key,true):module_state_read_for_update($db,$key);if(!is_array($value))$value=[];rr_sync_module($db,$key,$value);echo $key.': '.count($value)." record(s) synchronized\n";}
  $db->commit();echo "Relational runtime reconciliation completed successfully.\n";
}catch(Throwable $error){$db->rollback();fwrite(STDERR,'Relational reconciliation failed: '.$error->getMessage().PHP_EOL);exit(1);}
