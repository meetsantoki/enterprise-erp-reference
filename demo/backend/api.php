<?php
/** DEMOSOLAR ERP secure local API: server login, sessions and guarded storage. */
declare(strict_types=1);
require_once __DIR__.'/persistent_paths.php';
$erpRequestStartedAt=microtime(true);
$erpRequestId=bin2hex(random_bytes(8));
const ERP_USERS_KEY = 'DEMOSOLAR_USERS_PALLET_FORMAT_V7';
const ERP_LOGS_KEY = 'DEMOSOLAR_SYSTEM_LOGS_PALLET_FORMAT_V7';
const ERP_PURCHASE_VENDORS_KEY = 'DEMOSOLAR_PURCHASE_VENDORS_V1';
const ERP_PURCHASE_ORDERS_KEY = 'DEMOSOLAR_PURCHASE_ORDERS_V1';
header('Content-Type: application/json; charset=UTF-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: same-origin');
header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
header('Cache-Control: no-store, private');
header('X-ERP-Request-ID: '.$erpRequestId);

function erp_request_is_https(): bool {
  if(!empty($_SERVER['HTTPS'])&&$_SERVER['HTTPS']!=='off')return true;
  $forwarded=strtolower(trim(explode(',',(string)($_SERVER['HTTP_X_FORWARDED_PROTO']??''))[0]??''));
  if($forwarded==='https')return true;
  $visitor=json_decode((string)($_SERVER['HTTP_CF_VISITOR']??''),true);
  return is_array($visitor)&&strtolower((string)($visitor['scheme']??''))==='https';
}
function erp_same_origin_request(): bool {
  $source=trim((string)($_SERVER['HTTP_ORIGIN']??''));
  if($source==='')$source=trim((string)($_SERVER['HTTP_REFERER']??''));
  if($source==='')return false;
  $sourceHost=strtolower((string)(parse_url($source,PHP_URL_HOST)??''));
  $requestHost=strtolower(trim(explode(':',(string)($_SERVER['HTTP_HOST']??''))[0]??''));
  return $sourceHost!==''&&$requestHost!==''&&hash_equals($requestHost,$sourceHost);
}

$https = erp_request_is_https();
session_name('DEMOSOLAR_ERP_SESSION');
ini_set('session.use_strict_mode','1');
ini_set('session.use_only_cookies','1');
session_set_cookie_params(['lifetime'=>0, 'path'=>'/', 'secure'=>$https, 'httponly'=>true, 'samesite'=>'Strict']);
session_start();
if(empty($_SESSION['erp_csrf'])||!is_string($_SESSION['erp_csrf']))$_SESSION['erp_csrf']=bin2hex(random_bytes(32));
header('X-ERP-CSRF-Token: '.$_SESSION['erp_csrf']);
function respond($data, int $status=200): void { global $erpRequestStartedAt;header('Server-Timing: app;dur='.number_format((microtime(true)-$erpRequestStartedAt)*1000,1,'.',''));http_response_code($status); echo json_encode($data, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES); exit; }
function json_body(): array {
  $raw=file_get_contents('php://input') ?: '{}';
  $encoding=strtolower(trim((string)($_SERVER['HTTP_X_ERP_CONTENT_ENCODING']??'')));
  if($encoding==='gzip'){
    if(strlen($raw)<2||substr($raw,0,2)!=="\x1f\x8b")respond(['status'=>'error','message'=>'Invalid compressed ERP request.'],400);
    $decoded=gzdecode($raw);
    if(!is_string($decoded)||strlen($decoded)>64*1024*1024)respond(['status'=>'error','message'=>'Compressed ERP request could not be decoded safely.'],400);
    $raw=$decoded;
  }
  $value=json_decode($raw,true);
  if(!is_array($value))respond(['status'=>'error','message'=>'Invalid JSON request.'],400);
  return $value;
}

// Permanent production credentials live in ERP_PERSISTENT_DATA/config/config.php.
$config=['db_host'=>getenv('ERP_DB_HOST')?:'127.0.0.1','db_port'=>(int)(getenv('ERP_DB_PORT')?:3306),'db_name'=>getenv('ERP_DB_NAME')?:'demosolar_erp','db_user'=>getenv('ERP_DB_USER')?:'root','db_pass'=>getenv('ERP_DB_PASSWORD')?:'','app_timezone'=>getenv('ERP_APP_TIMEZONE')?:'Asia/Calcutta','session_idle_seconds'=>(int)(getenv('ERP_SESSION_IDLE_SECONDS')?:1800),'session_absolute_seconds'=>(int)(getenv('ERP_SESSION_ABSOLUTE_SECONDS')?:28800)];
$configPath=erp_config_path();if(is_file($configPath)) { $local=require $configPath; if(is_array($local)) $config=array_replace($config,$local); }
date_default_timezone_set((string)($config['app_timezone']??'Asia/Calcutta'));
mysqli_report(MYSQLI_REPORT_OFF);
$conn=@new mysqli((string)$config['db_host'],(string)$config['db_user'],(string)$config['db_pass'],(string)$config['db_name'],(int)$config['db_port']);
if($conn->connect_error) respond(['status'=>'error','message'=>'ERP database connection failed. Contact the system administrator.'],500);
$conn->set_charset('utf8mb4');
require_once __DIR__.'/module_state.php';
require_once __DIR__.'/relational_runtime.php';
require_once __DIR__.'/vendor_portal_common.php';
require_once __DIR__.'/it_management_common.php';
require_once __DIR__.'/notifications.php';
require_once __DIR__.'/saved_documents.php';
$config=it_apply_session_settings($conn,$config);

function audit_datetime($value): string {
  $timestamp=strtotime(trim((string)$value));
  return $timestamp===false?date('Y-m-d H:i:s'):date('Y-m-d H:i:s',$timestamp);
}
function audit_events_append(mysqli $db,array $records): void {
  $result=$db->query("SELECT id FROM erp_organizations WHERE code='DEMOSOLAR' LIMIT 1");
  $organizationId=(int)($result?$result->fetch_row()[0]??0:0);
  if($organizationId<=0)throw new RuntimeException('ERP organization is unavailable for audit logging.');
  $stmt=$db->prepare('INSERT IGNORE INTO erp_audit_events(organization_id,legacy_id,event_time,actor_username,department_code,action_code,details,source_ip) VALUES(?,?,?,?,?,?,?,?)');
  if(!$stmt)throw new RuntimeException('Audit event storage is unavailable.');
  $sourceIp=substr((string)($_SERVER['REMOTE_ADDR']??''),0,45);
  foreach($records as $record){
    if(!is_array($record))continue;
    $legacyId=trim((string)($record['id']??''));
    if($legacyId==='')$legacyId='LOG_'.strtoupper(substr(hash('sha256',json_encode($record)),0,24));
    $eventTime=audit_datetime($record['timestamp']??null);
    $operator=substr(trim((string)($record['operator']??'SYSTEM'))?:'SYSTEM',0,100);
    $department=substr(trim((string)($record['dept']??'SYSTEM'))?:'SYSTEM',0,60);
    $action=substr(trim((string)($record['action']??'UNSPECIFIED'))?:'UNSPECIFIED',0,100);
    $details=substr((string)($record['details']??''),0,4000);
    $stmt->bind_param('isssssss',$organizationId,$legacyId,$eventTime,$operator,$department,$action,$details,$sourceIp);
    $stmt->execute();
  }
  $stmt->close();
}
function append_security_audit_event(mysqli $db,array $actor,string $actionCode,string $details): void {
  audit_events_append($db,[[
    'id'=>'LOG-'.bin2hex(random_bytes(12)),
    'timestamp'=>date('Y-m-d H:i:s'),
    'operator'=>transaction_text($actor['username']??'SYSTEM',100)?:'SYSTEM',
    'dept'=>'SYSTEM',
    'action'=>strtoupper(transaction_text($actionCode,100))?:'UNSPECIFIED',
    'details'=>transaction_text($details,4000)
  ]]);
}
function audit_events_read(mysqli $db,?string $department=null): array {
  if($department!==null){
    $stmt=$db->prepare('SELECT legacy_id,event_time,actor_username,department_code,action_code,details FROM erp_audit_events WHERE department_code=? ORDER BY event_time DESC,id DESC');
    if(!$stmt)throw new RuntimeException('Audit history is unavailable.');
    $stmt->bind_param('s',$department);$stmt->execute();$result=$stmt->get_result();
  }else{$stmt=null;$result=$db->query("SELECT legacy_id,event_time,actor_username,department_code,action_code,details FROM erp_audit_events ORDER BY event_time DESC,id DESC");}
  if(!$result)throw new RuntimeException('Audit history is unavailable.');
  $records=[];
  while($row=$result->fetch_assoc())$records[]=[
    'id'=>(string)($row['legacy_id']??''),
    'timestamp'=>(string)$row['event_time'],
    'operator'=>(string)$row['actor_username'],
    'dept'=>(string)($row['department_code']??'SYSTEM'),
    'action'=>(string)$row['action_code'],
    'details'=>(string)($row['details']??'')
  ];
  if($stmt)$stmt->close();
  return $records;
}
function audit_logs_version(mysqli $db,array $actor): string {
  $where='';
  if(!admin($actor))$where=" WHERE department_code='".$db->real_escape_string(audit_department_for_user($actor))."'";
  $result=$db->query("SELECT COUNT(*) AS total,COALESCE(MAX(id),0) AS latest_id FROM erp_audit_events{$where}");
  if(!$result)throw new RuntimeException('Audit version is unavailable.');
  $row=$result->fetch_assoc()?:['total'=>0,'latest_id'=>0];
  return md5((string)$row['total'].':'.(string)$row['latest_id']);
}
function audit_logs_page(mysqli $db,array $actor,array $query): array {
  audit_events_ensure_seeded($db);
  $page=max(1,(int)($query['page']??1));
  $pageSize=min(200,max(10,(int)($query['pageSize']??100)));
  $period=strtoupper(trim((string)($query['period']??'ALL')));
  $requestedDepartment=strtoupper(trim((string)($query['department']??'ALL')));
  $department=admin($actor)?$requestedDepartment:audit_department_for_user($actor);
  $conditions=[];
  if($department!==''&&$department!=='ALL')$conditions[]="department_code='".$db->real_escape_string($department)."'";
  $today=new DateTimeImmutable('today');$start=null;$end=null;
  if($period==='TODAY'){$start=$today;$end=$today->modify('+1 day');}
  elseif($period==='YESTERDAY'){$start=$today->modify('-1 day');$end=$today;}
  elseif($period==='WEEKLY'){$start=$today->modify('-6 days');$end=$today->modify('+1 day');}
  elseif($period==='QUARTERLY'){$start=$today->modify('-3 months');$end=$today->modify('+1 day');}
  elseif($period==='YEARLY'){$start=$today->modify('-1 year');$end=$today->modify('+1 day');}
  elseif($period==='CUSTOM'){
    $from=trim((string)($query['from']??''));$to=trim((string)($query['to']??''));
    if(preg_match('/^\d{4}-\d{2}-\d{2}$/',$from))$start=new DateTimeImmutable($from.' 00:00:00');
    if(preg_match('/^\d{4}-\d{2}-\d{2}$/',$to))$end=(new DateTimeImmutable($to.' 00:00:00'))->modify('+1 day');
  }
  if($start)$conditions[]="event_time>='".$db->real_escape_string($start->format('Y-m-d H:i:s'))."'";
  if($end)$conditions[]="event_time<'".$db->real_escape_string($end->format('Y-m-d H:i:s'))."'";
  $where=$conditions?' WHERE '.implode(' AND ',$conditions):'';
  $countResult=$db->query("SELECT COUNT(*) AS total FROM erp_audit_events{$where}");
  if(!$countResult)throw new RuntimeException('Audit total is unavailable.');
  $total=(int)($countResult->fetch_assoc()['total']??0);$pages=max(1,(int)ceil($total/$pageSize));$page=min($page,$pages);$offset=($page-1)*$pageSize;
  $result=$db->query("SELECT legacy_id,event_time,actor_username,department_code,action_code,details FROM erp_audit_events{$where} ORDER BY event_time DESC,id DESC LIMIT {$pageSize} OFFSET {$offset}");
  if(!$result)throw new RuntimeException('Audit page is unavailable.');
  $records=[];while($row=$result->fetch_assoc())$records[]=['id'=>(string)$row['legacy_id'],'timestamp'=>(string)$row['event_time'],'operator'=>(string)$row['actor_username'],'dept'=>(string)($row['department_code']??'SYSTEM'),'action'=>(string)$row['action_code'],'details'=>(string)($row['details']??'')];
  if(admin($actor)){$departmentResult=$db->query("SELECT DISTINCT department_code FROM erp_audit_events WHERE department_code<>'' ORDER BY department_code");$departments=[];if($departmentResult)while($row=$departmentResult->fetch_assoc())$departments[]=(string)$row['department_code'];}
  else $departments=[audit_department_for_user($actor)];
  return ['records'=>$records,'total'=>$total,'page'=>$page,'pageSize'=>$pageSize,'pages'=>$pages,'departments'=>$departments,'version'=>audit_logs_version($db,$actor)];
}
function audit_events_ensure_seeded(mysqli $db): void {
  $result=$db->query("SELECT 1 FROM erp_schema_migrations WHERE migration_key='20260929_04_audit_state_sync' LIMIT 1");
  if($result&&$result->num_rows>0)return;
  $state=module_state_read($db,ERP_LOGS_KEY);
  if(is_array($state))audit_events_append($db,$state);
  $db->query("INSERT INTO erp_schema_migrations(migration_key,details) VALUES('20260929_04_audit_state_sync','Module audit history synchronized to append-only erp_audit_events') ON DUPLICATE KEY UPDATE details=VALUES(details)");
}
function audit_immutable_error(array $existing,$submitted): ?string {
  if(!is_array($submitted))return 'Audit history must be submitted as a record list.';
  $before=[];foreach($existing as $row)if(is_array($row)&&trim((string)($row['id']??''))!=='')$before[(string)$row['id']]=$row;
  $after=[];foreach($submitted as $row){if(!is_array($row)||trim((string)($row['id']??''))==='')return 'Every audit event requires a permanent identifier.';$id=(string)$row['id'];if(isset($after[$id]))return 'Duplicate audit event identifiers are not allowed.';$after[$id]=$row;}
  foreach($before as $id=>$row){
    if(!isset($after[$id]))return 'Audit events are permanent and cannot be deleted.';
    if(json_encode($after[$id],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)!==json_encode($row,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES))return 'Historical audit events cannot be edited.';
  }
  return null;
}
function read_value(mysqli $db,string $key) {
  if($key===ERP_LOGS_KEY){audit_events_ensure_seeded($db);return audit_events_read($db);}
  if(rr_runtime_is_authoritative($db,$key))return rr_runtime_read_records($db,$key);
  return module_state_read($db,$key);
}
function write_value(mysqli $db,string $key,$value): bool {
  $db->begin_transaction();
  try{$ok=write_value_in_transaction($db,$key,$value);if(!$ok)throw new RuntimeException('Database write failed.');$db->commit();return true;}
  catch(Throwable $error){$db->rollback();return false;}
}
function read_value_for_update(mysqli $db,string $key) {
  if($key!==ERP_LOGS_KEY&&rr_runtime_is_authoritative($db,$key))return rr_runtime_read_records($db,$key,true);
  return module_state_read_for_update($db,$key);
}
function serial_key($value): string {
  return strtoupper(trim((string)$value));
}
function store_serial_index($value): array {
  $serials=[];
  foreach(is_array($value)?$value:[] as $batch){
    if(!is_array($batch))continue;
    foreach(is_array($batch['serials']??null)?$batch['serials']:[] as $serial){$key=serial_key($serial);if($key!=='')$serials[$key]=true;}
  }
  return $serials;
}
function packed_serial_index(mysqli $db): array {
  $packed=[];
  $collect=function($pallets)use(&$packed): void {
    foreach(is_array($pallets)?$pallets:[] as $pallet){
      if(!is_array($pallet))continue;
      $values=is_array($pallet['serials']??null)?$pallet['serials']:[];
      if(!$values&&is_array($pallet['fullRows']??null))$values=array_map(fn($row)=>is_array($row)?($row['serial']??''):$row,$pallet['fullRows']);
      foreach($values as $serial){$key=serial_key($serial);if($key!=='')$packed[$key]=true;}
    }
  };
  $collect(read_value($db,'DEMOSOLAR_STOCK_PALLET_FORMAT_V7'));
  foreach(is_array($archive=read_value($db,'DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7'))?$archive:[] as $manifest)if(is_array($manifest))$collect($manifest['pallets']??[]);
  return $packed;
}
function packed_store_serial_delete_error(mysqli $db,$submitted): ?string {
  if(!is_array($submitted))return 'PPC serial storage must be submitted as a record list.';
  $before=store_serial_index(read_value($db,'DEMOSOLAR_STORE_SERIALS_STORAGE_V1'));
  $after=store_serial_index($submitted);
  $removed=array_diff_key($before,$after);
  if(!$removed)return null;
  $protected=array_intersect_key($removed,packed_serial_index($db));
  if(!$protected)return null;
  return count($protected).' packed or dispatched serial number(s) cannot be deleted. Remove only unpacked modules and try again.';
}
function write_value_in_transaction(mysqli $db,string $key,$value,bool $incremental=false): bool {
  if($key==='DEMOSOLAR_STORE_SERIALS_STORAGE_V1'){
    $serialError=packed_store_serial_delete_error($db,$value);
    if($serialError!==null)throw new RuntimeException($serialError);
  }
  if($key===ERP_LOGS_KEY&&is_array($value))audit_events_append($db,$value);
  if($key!==ERP_LOGS_KEY)rr_sync_module($db,$key,$value,0,$incremental);
  if($key!==ERP_LOGS_KEY&&rr_runtime_is_authoritative($db,$key)&&in_array($key,[
    'DEMOSOLAR_STORE_SERIALS_STORAGE_V1','DEMOSOLAR_STOCK_PALLET_FORMAT_V7','DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7'
  ],true))return module_state_touch_in_transaction($db,$key);
  $written=module_state_write_in_transaction($db,$key,$value);
  // Route assignments affect effective user permissions. Touching the user
  // module makes every signed-in client receive the scoped permission change.
  if($written&&$key==='DEMOSOLAR_REQUEST_ROUTES_V1')module_state_touch_in_transaction($db,ERP_USERS_KEY);
  if($written&&in_array($key,[ERP_USERS_KEY,'DEMOSOLAR_REQUEST_ROUTES_V1','DEMOSOLAR_DESIGNATIONS_MASTER_V1'],true)){
    unset($GLOBALS['ERP_ALL_USERS_CACHE']);
    if($key==='DEMOSOLAR_REQUEST_ROUTES_V1')unset($GLOBALS['ERP_APPROVAL_ROUTES_CACHE']);
    if($key==='DEMOSOLAR_DESIGNATIONS_MASTER_V1')unset($GLOBALS['ERP_APPROVAL_DESIGNATIONS_CACHE']);
  }
  return $written;
}
function incremental_sync_preferred(string $key): bool {
  // These modules are maintained as record lists. Runtime storage still
  // receives the complete atomic snapshot, while normalized SQL tables only
  // need rows whose payload changed. This prevents a one-record edit from
  // reprocessing tens of thousands of historical serials or every pallet.
  return in_array($key,[
    'DEMOSOLAR_PRODUCTS_PALLET_FORMAT_V7','DEMOSOLAR_POS_PALLET_FORMAT_V7',
    'DEMOSOLAR_STORE_SERIALS_STORAGE_V1','DEMOSOLAR_STOCK_PALLET_FORMAT_V7',
    'DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7','DEMOSOLAR_STOCK_BOOKINGS_V1',
    'DEMOSOLAR_TRANSPORTERS_MASTER_V7','DEMOSOLAR_DRIVERS_MASTER_V7',
    'DEMOSOLAR_ROUTE_FARES_V1','DEMOSOLAR_VEHICLE_BOOKINGS_V1',
    'DEMOSOLAR_PRODUCTION_SHEET_V1','DEMOSOLAR_PRODUCTION_DAILY_V1',
    'DEMOSOLAR_CUSTOMERS_MASTER_V1','DEMOSOLAR_SALES_PEOPLE_V1',
    'DEMOSOLAR_ACCOUNT_INVOICES_V1','DEMOSOLAR_ACCOUNT_RECEIPTS_V1',
    'DEMOSOLAR_DELETION_REQUESTS_V1','DEMOSOLAR_DEPARTMENTS_MASTER_V1',
    'DEMOSOLAR_DESIGNATIONS_MASTER_V1','DEMOSOLAR_REQUEST_ROUTES_V1',ERP_PURCHASE_VENDORS_KEY,ERP_PURCHASE_ORDERS_KEY
  ],true);
}
function locked_storage_version(mysqli $db,string $key): string {
  return module_state_locked_version($db,$key);
}
function write_value_checked(mysqli $db,string $key,$value,string $expectedVersion=''): array {
  $db->begin_transaction();
  try {
    $current=locked_storage_version($db,$key);
    if($expectedVersion!==''&&!hash_equals($current,$expectedVersion)){$db->rollback();return ['ok'=>false,'conflict'=>true,'version'=>$current];}
    if($key===ERP_LOGS_KEY){$prior=module_state_read($db,$key);$auditError=audit_immutable_error(is_array($prior)?$prior:[],$value);if($auditError!==null){$db->rollback();return ['ok'=>false,'conflict'=>false,'validation'=>$auditError,'version'=>$current];}}
    if(!write_value_in_transaction($db,$key,$value,incremental_sync_preferred($key)))throw new RuntimeException('Database write failed.');
    $version=locked_storage_version($db,$key);$db->commit();return ['ok'=>true,'version'=>$version];
  }catch(Throwable $error){$db->rollback();throw $error;}
}
function write_patch_checked(mysqli $db,string $key,array $patch,string $expectedVersion,array $actor): array {
  if($key===ERP_USERS_KEY||$key===ERP_LOGS_KEY)return ['ok'=>false,'conflict'=>false,'validation'=>'This protected module does not accept record patches.'];
  $db->begin_transaction();
  try{
    $currentVersion=locked_storage_version($db,$key);
    if($expectedVersion!==''&&!hash_equals($currentVersion,$expectedVersion)){$db->rollback();return ['ok'=>false,'conflict'=>true,'version'=>$currentVersion];}
    $current=read_value_for_update($db,$key);if(!is_array($current))$current=[];
    $value=$key==='DEMOSOLAR_DELETION_REQUESTS_V1'?transaction_merge_request_patch($current,$patch):transaction_apply_record_patch($current,$patch);
    $validationActor=$actor;if($key===ERP_PURCHASE_VENDORS_KEY)$validationActor['role']='purchase';
    $writeError=non_admin_write_error($db,$validationActor,$key,$value);
    if($writeError!==null){$db->rollback();return ['ok'=>false,'conflict'=>false,'validation'=>$writeError,'version'=>$currentVersion];}
    if(!write_value_in_transaction($db,$key,$value,true))throw new RuntimeException('Database patch write failed.');
    $version=locked_storage_version($db,$key);$db->commit();return ['ok'=>true,'version'=>$version,'value'=>$value];
  }catch(Throwable $error){$db->rollback();throw $error;}
}
function audit_department_for_key(string $key): string {
  $map=[
    ERP_USERS_KEY=>'SYSTEM','DEMOSOLAR_PRODUCTS_PALLET_FORMAT_V7'=>'WAREHOUSE','DEMOSOLAR_POS_PALLET_FORMAT_V7'=>'STORE',
    'DEMOSOLAR_STORE_SERIALS_STORAGE_V1'=>'STORE','DEMOSOLAR_STOCK_PALLET_FORMAT_V7'=>'PACKING',
    'DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7'=>'DISPATCH','DEMOSOLAR_STOCK_BOOKINGS_V1'=>'DISPATCH',
    'DEMOSOLAR_TRANSPORTERS_MASTER_V7'=>'DISPATCH','DEMOSOLAR_DRIVERS_MASTER_V7'=>'DISPATCH',
    'DEMOSOLAR_ROUTE_FARES_V1'=>'DISPATCH','DEMOSOLAR_VEHICLE_BOOKINGS_V1'=>'DISPATCH',
    'DEMOSOLAR_PRODUCTION_SHEET_V1'=>'PRODUCTION','DEMOSOLAR_PRODUCTION_DAILY_V1'=>'PRODUCTION',
    'DEMOSOLAR_SALES_ORDERS_V1'=>'SALES','DEMOSOLAR_CUSTOMERS_MASTER_V1'=>'SALES',
    'DEMOSOLAR_SALES_PEOPLE_V1'=>'SALES','DEMOSOLAR_SALES_CO_REGISTRY_V1'=>'SALES',
    'DEMOSOLAR_CO_ALLOCATIONS_V1'=>'SALES','DEMOSOLAR_ACCOUNT_INVOICES_V1'=>'ACCOUNTS',
    'DEMOSOLAR_ACCOUNT_RECEIPTS_V1'=>'ACCOUNTS',ERP_PURCHASE_VENDORS_KEY=>'PURCHASE',ERP_PURCHASE_ORDERS_KEY=>'PURCHASE','DEMOSOLAR_DEPARTMENTS_MASTER_V1'=>'HR','DEMOSOLAR_DESIGNATIONS_MASTER_V1'=>'HR',
    'DEMOSOLAR_DELETION_REQUESTS_V1'=>'SYSTEM'
  ];
  return $map[$key]??'SYSTEM';
}
function audit_department_for_user(array $user): string {
  $role=strtolower(trim((string)($user['role']??'')));
  $department=strtolower(trim((string)($user['department']??'')));
  $source=$role.' '.$department;
  if(preg_match('/\b(account|accounts|finance)\b/',$source))return 'ACCOUNTS';
  if(preg_match('/\bdispatch\b/',$source))return 'DISPATCH';
  if(preg_match('/\bpacking\b/',$source))return 'PACKING';
  if(preg_match('/\b(store|ppc)\b/',$source))return 'STORE';
  if(preg_match('/\b(sales|marketing)\b/',$source))return 'SALES';
  if(preg_match('/\b(purchase|procurement)\b/',$source))return 'PURCHASE';
  if(preg_match('/\bproduction\b/',$source))return 'PRODUCTION';
  if(preg_match('/\bwarehouse\b/',$source))return 'WAREHOUSE';
  if($role==='admin'||preg_match('/\b(admin|system|it)\b/',$source))return 'SYSTEM';
  $custom=strtoupper(preg_replace('/[^A-Za-z0-9]+/','_',trim((string)($user['department']??$user['role']??'SYSTEM'))));
  return trim($custom,'_')?:'SYSTEM';
}
function read_value_for_actor(mysqli $db,string $key,array $actor) {
  if($key===ERP_LOGS_KEY&&!admin($actor)){audit_events_ensure_seeded($db);return audit_events_read($db,audit_department_for_user($actor));}
  $value=read_value($db,$key);
  if($key==='DEMOSOLAR_DELETION_REQUESTS_V1'&&is_array($value)){
    $value=array_values(array_map(fn($request)=>is_array($request)?approval_request_with_routing($db,$request):$request,$value));
    if(admin($actor))return $value;
    $username=strtolower(trim((string)($actor['username']??'')));
    return array_values(array_filter($value,function($request)use($username){
      if(!is_array($request))return false;
      if(strtolower(trim((string)($request['requestedBy']??'')))===$username)return true;
      if(strtoupper((string)($request['status']??''))!=='PENDING')return false;
      foreach(is_array($request['assignedApproverUsernames']??null)?$request['assignedApproverUsernames']:[] as $assigned)if(strtolower(trim((string)$assigned))===$username)return true;
      return false;
    }));
  }
  return $value;
}
/**
 * Central append-only audit writer. All UI events and generic data mutations
 * pass through this function so new modules inherit audit logging automatically.
 * erp_audit_events retains the complete permanent history. The module-state
 * value is only a bounded live-sync cache, preventing it from growing forever.
 */
function append_audit_event(mysqli $db,array $actor,string $department,string $actionCode,string $details): array {
  $effectiveDepartment=admin($actor)?(strtoupper(transaction_text($department,60))?:'SYSTEM'):audit_department_for_user($actor);
  $event=[
    'id'=>'LOG-'.bin2hex(random_bytes(12)),
    'timestamp'=>date('Y-m-d H:i:s'),
    'operator'=>transaction_text($actor['username']??'SYSTEM',100)?:'SYSTEM',
    'dept'=>$effectiveDepartment,
    'action'=>strtoupper(transaction_text($actionCode,100))?:'UNSPECIFIED',
    'details'=>transaction_text($details,4000)
  ];
  $db->begin_transaction();
  try {
    $cache=module_state_read_for_update($db,ERP_LOGS_KEY);
    if(!is_array($cache))$cache=[];
    array_unshift($cache,$event);
    $cache=array_slice($cache,0,2000);
    audit_events_append($db,[$event]);
    if(!module_state_write_in_transaction($db,ERP_LOGS_KEY,$cache))throw new RuntimeException('Audit event could not be saved.');
    $version=module_state_locked_version($db,ERP_LOGS_KEY);
    $db->commit();
    return ['entry'=>$event,'version'=>$version];
  } catch(Throwable $error) {
    $db->rollback();
    throw $error;
  }
}
function transaction_text($value,int $length=160): string {
  $value=preg_replace('/[\x00-\x1F\x7F]/u',' ',trim((string)$value));
  return substr((string)$value,0,$length);
}
function transaction_key($value): string { return strtoupper(transaction_text($value,160)); }
function transaction_number($value): int { return max(0,(int)$value); }
function transaction_pallet_qty(array $pallet): int {
  $count=transaction_number($pallet['count']??0);
  return $count>0?$count:count(is_array($pallet['serials']??null)?$pallet['serials']:(is_array($pallet['fullRows']??null)?$pallet['fullRows']:[]));
}
function transaction_pallet_serials(array $pallet): array {
  $source=is_array($pallet['serials']??null)?$pallet['serials']:(is_array($pallet['fullRows']??null)?$pallet['fullRows']:[]);
  $serials=[];
  foreach($source as $item){
    $serial=transaction_key(is_array($item)?($item['serial']??''):$item);
    if($serial!=='')$serials[]=$serial;
  }
  return array_values(array_unique($serials));
}
function transaction_seal_pallet(mysqli $db,array $actor,array $input): array {
  if(!feature_allowed($actor,['packing','packingScan'],['packing']))respond(['status'=>'error','message'=>'Your User Rights do not allow pallet sealing.'],403);
  $record=is_array($input['pallet']??null)?$input['pallet']:[];
  $palletNumber=transaction_key($record['pallet']??'');
  $binning=transaction_text($record['binning']??'',40);
  $po=transaction_text($record['po']??'',100);
  $serials=transaction_pallet_serials($record);
  if($palletNumber===''||$binning===''||$po===''||!$serials)throw new RuntimeException('Pallet Number, PO, Binning and scanned serials are required before sealing.');
  if(count($serials)>500)throw new RuntimeException('The pallet contains an invalid number of serials.');
  $submittedCount=transaction_number($record['count']??0);
  if($submittedCount!==count($serials))throw new RuntimeException('The pallet module count does not match its unique serial numbers.');

  $db->begin_transaction();
  try {
    $stock=read_value_for_update($db,'DEMOSOLAR_STOCK_PALLET_FORMAT_V7');
    $archive=read_value_for_update($db,'DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7');
    if(!is_array($stock)||!is_array($archive))throw new RuntimeException('Packing stock data is unavailable.');

    $usedSerials=[];
    foreach($stock as $existing){
      if(!is_array($existing))continue;
      if(transaction_key($existing['pallet']??'')===$palletNumber)throw new RuntimeException("Pallet {$palletNumber} already exists in Warehouse stock.");
      foreach(transaction_pallet_serials($existing) as $serial)$usedSerials[$serial]=true;
    }
    foreach($archive as $manifest){
      if(!is_array($manifest))continue;
      foreach((is_array($manifest['pallets']??null)?$manifest['pallets']:[]) as $existing){
        if(!is_array($existing))continue;
        if(transaction_key($existing['pallet']??'')===$palletNumber)throw new RuntimeException("Pallet {$palletNumber} already exists in Dispatch history.");
        foreach(transaction_pallet_serials($existing) as $serial)$usedSerials[$serial]=true;
      }
    }
    foreach($serials as $serial)if(isset($usedSerials[$serial]))throw new RuntimeException("Serial {$serial} is already assigned to another sealed or dispatched pallet.");

    $record['pallet']=$palletNumber;
    $record['count']=count($serials);
    $record['serials']=$serials;
    $record['sealedAt']=date('c');
    $record['sealedBy']=transaction_text($actor['username']??'PACKING',100);
    $stock[]=$record;
    // Only the appended pallet needs relational normalization. The complete
    // legacy state is still written atomically for backward compatibility,
    // but reprocessing every historical pallet makes sealing unnecessarily
    // slow as warehouse history grows.
    if(!write_value_in_transaction($db,'DEMOSOLAR_STOCK_PALLET_FORMAT_V7',$stock,true))throw new RuntimeException('The pallet could not be committed to Warehouse stock.');
    $version=locked_storage_version($db,'DEMOSOLAR_STOCK_PALLET_FORMAT_V7');
    $db->commit();
    // The client already owns the current stock list and can append this one
    // committed record. Avoid returning several megabytes of unchanged stock.
    return ['pallet'=>$record,'version'=>$version];
  }catch(Throwable $error){$db->rollback();throw $error;}
}
function transaction_dispatch(mysqli $db,array $actor,array $input): array {
  if(!feature_allowed($actor,['dispatchChallan'],['dispatch']))respond(['status'=>'error','message'=>'Your User Rights do not allow dispatch creation.'],403);
  $coNumber=transaction_text($input['coNumber']??'',80);$invoice=transaction_text($input['invoice']??'',80);$accountInvoiceId=transaction_text($input['accountInvoiceId']??'',100);
  $vehicle=transaction_text($input['vehicle']??'',40);$date=transaction_text($input['date']??'',32);$driverNo=transaction_text($input['driverNo']??'',60);$driverName=transaction_text($input['driverName']??'',120);
  $palletIds=is_array($input['palletIds']??null)?$input['palletIds']:[];
  $palletKeys=array_values(array_unique(array_filter(array_map('transaction_key',$palletIds))));
  if(!$accountInvoiceId||!$coNumber||!$invoice||!$vehicle||!$date||!$driverNo||!$driverName||!$palletKeys)respond(['status'=>'error','message'=>'An Accounts invoice, Driver Name, Driver Number and at least one pallet are required.'],400);
  $db->begin_transaction();
  try {
    $stock=read_value_for_update($db,'DEMOSOLAR_STOCK_PALLET_FORMAT_V7');
    $archive=read_value_for_update($db,'DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7');
    $orders=read_value_for_update($db,'DEMOSOLAR_SALES_ORDERS_V1');
    $bookings=read_value_for_update($db,'DEMOSOLAR_STOCK_BOOKINGS_V1');
    $accountInvoices=read_value_for_update($db,'DEMOSOLAR_ACCOUNT_INVOICES_V1');
    if(!is_array($stock)||!is_array($archive)||!is_array($orders)||!is_array($bookings)||!is_array($accountInvoices))throw new RuntimeException('ERP transaction data is invalid.');
    $accountIndex=-1;foreach($accountInvoices as $index=>$accountRecord){if(is_array($accountRecord)&&(string)($accountRecord['id']??'')===$accountInvoiceId){$accountIndex=$index;break;}}
    if($accountIndex<0)throw new RuntimeException('The selected Accounts invoice no longer exists.');
    $accountRecord=$accountInvoices[$accountIndex];
    // The active archive is the dispatch source of truth. A previously approved
    // cancellation may leave an older invoice status marked DISPATCHED; the
    // archive check below still blocks any invoice with an active dispatch.
    if(transaction_key($accountRecord['invoiceNumber']??'')!==transaction_key($invoice)||transaction_key($accountRecord['coNumber']??'')!==transaction_key($coNumber))throw new RuntimeException('Invoice and Customer Order do not match the Accounts record.');
    $orderIndex=-1;foreach($orders as $index=>$order){if(is_array($order)&&transaction_key($order['coNumber']??'')===transaction_key($coNumber)){$orderIndex=$index;break;}}
    if($orderIndex<0)throw new RuntimeException('The selected Customer Order no longer exists.');
    $order=$orders[$orderIndex];
    foreach($archive as $manifest){if(is_array($manifest)&&transaction_key($manifest['invoice']??'')===transaction_key($invoice))throw new RuntimeException('This Invoice Number already exists in Dispatch history.');}
    $selected=[];$selectedKeys=[];
    foreach($stock as $pallet){
      if(!is_array($pallet))continue;$key=transaction_key($pallet['pallet']??'');
      if(in_array($key,$palletKeys,true)){$selected[]=$pallet;$selectedKeys[]=$key;}
    }
    if(count($selected)!==count($palletKeys))throw new RuntimeException('One or more selected pallets are no longer available in warehouse stock. Refresh and try again.');
    $total=array_sum(array_map('transaction_pallet_qty',$selected));
    if($total<=0)throw new RuntimeException('Selected pallets do not contain any modules.');
    $invoiceQty=transaction_number($accountRecord['quantity']??0);
    if($invoiceQty<=0||$total!==$invoiceQty)throw new RuntimeException("The packing list must contain exactly the {$invoiceQty} modules entered by Accounts in QTY. IN VEHICLE.");
    $already=0;foreach($archive as $manifest){if(is_array($manifest)&&transaction_key($manifest['coNumber']??'')===transaction_key($coNumber))$already+=transaction_number($manifest['dispatchedQty']??0);}
    $orderQty=transaction_number($order['totalOrderQty']??0);
    if($already+$total>$orderQty)throw new RuntimeException('Dispatch quantity exceeds the pending Customer Order quantity.');
    $safeInvoice=preg_replace('/[^A-Za-z0-9_-]/','_',strtoupper($invoice));
    $photoPattern='#^photos/'.preg_quote($safeInvoice,'#').'/photo_[0-9]+_[a-f0-9]{16}\.(jpg|png|webp)$#i';
    $photos=[];foreach((is_array($input['photos']??null)?$input['photos']:[]) as $path){$path=transaction_text($path,240);if(preg_match($photoPattern,$path))$photos[]=$path;}
    $now=date('c');$operator=transaction_text($actor['username']??'DISPATCH',80);
    $manifest=[
      'id'=>'DISP-'.bin2hex(random_bytes(8)),'coNumber'=>$coNumber,'salesOrderId'=>$order['id']??'',
      'accountInvoiceId'=>$accountInvoiceId,'po'=>transaction_text($input['po']??'MULTI-PO',80)?:'MULTI-PO','transporter'=>transaction_text($accountRecord['transporterName']??'',120),
      'vehicle'=>transaction_text($accountRecord['vehicleNumber']??'',40),'driverNo'=>$driverNo,'driverName'=>$driverName,
      'modeTransport'=>transaction_text($accountRecord['modeTransport']??'By Road',60)?:'By Road','deliveryOrderNo'=>transaction_text($accountRecord['deliveryOrderNo']??'',80),
      'lrNo'=>transaction_text($accountRecord['lrNo']??'',80),'customer'=>transaction_text($order['customerName']??'',160),'invoice'=>$invoice,
      'challanNo'=>transaction_text($accountRecord['challanNo']??'',80),'product'=>transaction_text($order['modelNo']??'',160),
      'cellType'=>transaction_text($accountRecord['dcrNdcr']??'NON - DCR',40),'invoiceDate'=>transaction_text($accountRecord['invoiceDate']??$date,32),'date'=>date('Y-m-d'),'dispatchedAt'=>$now,'packingType'=>transaction_text($accountRecord['packingType']??'Box Packing',60),
      'hsnCode'=>transaction_text($accountRecord['hsnCode']??'85414300',20),'orderQty'=>$invoiceQty,'dispatchedQty'=>$total,'pallets'=>$selected,'photos'=>array_values(array_unique($photos)),
      'createdAt'=>$now,'createdBy'=>$operator
    ];
    array_unshift($archive,$manifest);
    $stock=array_values(array_filter($stock,fn($pallet)=>!is_array($pallet)||!in_array(transaction_key($pallet['pallet']??''),$selectedKeys,true)));
    foreach($bookings as &$booking){if(is_array($booking)&&strtoupper((string)($booking['status']??''))==='BOOKED'&&in_array(transaction_key($booking['pallet']??''),$selectedKeys,true)){$booking['status']='DISPATCHED';$booking['dispatchedAt']=date('Y-m-d H:i:s');$booking['invoice']=$invoice;}}unset($booking);
    $newDispatched=$already+$total;$pending=max(0,$orderQty-$newDispatched);$certificate=trim((string)($order['performanceCertificate']??''));
    $order['dispatchQty']=$newDispatched;$order['pendingQty']=$pending;$order['actualDispatchDate']=date('Y-m-d');$order['status']=$pending===0?($certificate!==''?'CLOSED':'AWAITING CERTIFICATE'):($newDispatched>0?'PARTIALLY DISPATCHED':'PENDING');
    $order['closedAt']=$order['status']==='CLOSED'?((string)($order['closedAt']??'')?:date('Y-m-d H:i:s')):'';$order['updatedAt']=$now;$order['updatedBy']=$operator;$orders[$orderIndex]=$order;
    $accountRecord['status']='DISPATCHED';$accountRecord['dispatchId']=$manifest['id'];$accountRecord['dispatchedAt']=$now;$accountRecord['dispatchedBy']=$operator;$accountInvoices[$accountIndex]=$accountRecord;
    foreach(['DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7'=>$archive,'DEMOSOLAR_STOCK_PALLET_FORMAT_V7'=>$stock,'DEMOSOLAR_SALES_ORDERS_V1'=>$orders,'DEMOSOLAR_STOCK_BOOKINGS_V1'=>$bookings,'DEMOSOLAR_ACCOUNT_INVOICES_V1'=>$accountInvoices] as $key=>$value){if(!write_value_in_transaction($db,$key,$value,true))throw new RuntimeException('Unable to save all dispatch records.');}
    append_audit_event($db,$actor,'DISPATCH','DISPATCH_COMPLETED',"Cleared shipment: Invoice {$invoice}, Vehicle {$vehicle}, {$total} modules.");
    $versions=[];foreach(['DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7','DEMOSOLAR_STOCK_PALLET_FORMAT_V7','DEMOSOLAR_SALES_ORDERS_V1','DEMOSOLAR_STOCK_BOOKINGS_V1','DEMOSOLAR_ACCOUNT_INVOICES_V1'] as $changedKey)$versions[$changedKey]=locked_storage_version($db,$changedKey);
    $db->commit();
    // Return only changed records. Sending complete Stock and Dispatch history
    // added more than 11 MB to every successful dispatch response.
    return ['manifest'=>$manifest,'removedPalletIds'=>$selectedKeys,'salesOrder'=>$order,'stockBookings'=>$bookings,'accountInvoice'=>$accountRecord,'versions'=>$versions];
  }catch(Throwable $error){$db->rollback();throw $error;}
}
function transaction_apply_record_patch(array $current,array $patch): array {
  if(($patch['mode']??'')!=='record-key-v1'||!is_array($patch['order']??null)||!is_array($patch['items']??null))throw new RuntimeException('The approval record patch is invalid.');
  $order=array_values($patch['order']);$items=$patch['items'];
  if(count($order)>100000)throw new RuntimeException('The approval record patch is too large.');
  $currentByKey=[];$seen=[];
  foreach(array_values($current) as $position=>$row){$recordKey=rr_runtime_record_key($row,$position);if(isset($seen[$recordKey]))$recordKey.=':'.($position+1);$seen[$recordKey]=true;$currentByKey[$recordKey]=$row;}
  $result=[];$used=[];
  foreach($order as $recordKey){
    if(!is_string($recordKey)||$recordKey===''||isset($used[$recordKey]))throw new RuntimeException('The approval record order contains an invalid or duplicate identity.');
    $used[$recordKey]=true;
    if(array_key_exists($recordKey,$items))$result[]=$items[$recordKey];
    elseif(array_key_exists($recordKey,$currentByKey))$result[]=$currentByKey[$recordKey];
    else throw new RuntimeException('An approval record changed before this action was completed. Refresh and try again.');
  }
  foreach(array_keys($items) as $recordKey)if(!isset($used[(string)$recordKey]))throw new RuntimeException('The approval patch contains an unordered record.');
  return $result;
}
function transaction_merge_request_patch(array $current,array $patch): array {
  if(($patch['mode']??'')!=='record-key-v1'||!is_array($patch['items']??null))throw new RuntimeException('The request update format is invalid.');
  $items=$patch['items'];$positions=[];
  foreach($current as $index=>$record){$key=rr_runtime_record_key($record,$index);$positions[$key]=$index;}
  $new=[];
  foreach($items as $recordKey=>$record){
    if(!is_string($recordKey)||$recordKey===''||!is_array($record))throw new RuntimeException('The request update contains an invalid record.');
    if(isset($positions[$recordKey]))$current[$positions[$recordKey]]=$record;else $new[]=$record;
  }
  return array_values(array_merge($new,$current));
}
function approval_department_key(string $value): string {
  $department=strtoupper(trim((string)preg_replace('/\s+/',' ',$value)));
  if(preg_match('/ACCOUNT|FINANCE/',$department))return 'ACCOUNTS';
  if(preg_match('/SALES|MARKETING/',$department))return 'SALES & MARKETING';
  if(preg_match('/STORE|PPC/',$department))return 'STORE & PPC';
  if(str_contains($department,'PRODUCTION'))return 'PRODUCTION';
  if(str_contains($department,'PACKING'))return 'PACKING';
  if(preg_match('/DISPATCH|LOGISTIC/',$department))return 'DISPATCH';
  if(preg_match('/PURCHASE|PROCUREMENT/',$department))return 'PURCHASE';
  if(preg_match('/HUMAN RESOURCE|\bHR\b/',$department))return 'HR';
  if(preg_match('/INFORMATION TECHNOLOGY|IT DEPARTMENT|\bIT\b/',$department))return 'IT';
  return $department;
}
function approval_routes_cached(mysqli $db): array {
  if(isset($GLOBALS['ERP_APPROVAL_ROUTES_CACHE'])&&is_array($GLOBALS['ERP_APPROVAL_ROUTES_CACHE']))return $GLOBALS['ERP_APPROVAL_ROUTES_CACHE'];
  $routes=read_value($db,'DEMOSOLAR_REQUEST_ROUTES_V1');
  return $GLOBALS['ERP_APPROVAL_ROUTES_CACHE']=is_array($routes)?$routes:[];
}
function approval_designation_names_cached(mysqli $db): array {
  if(isset($GLOBALS['ERP_APPROVAL_DESIGNATIONS_CACHE'])&&is_array($GLOBALS['ERP_APPROVAL_DESIGNATIONS_CACHE']))return $GLOBALS['ERP_APPROVAL_DESIGNATIONS_CACHE'];
  $designations=read_value($db,'DEMOSOLAR_DESIGNATIONS_MASTER_V1');$names=[];
  foreach(is_array($designations)?$designations:[] as $designation)if(is_array($designation))$names[(string)($designation['id']??'')]=strtoupper(trim((string)($designation['name']??'')));
  return $GLOBALS['ERP_APPROVAL_DESIGNATIONS_CACHE']=$names;
}
function approval_request_department(mysqli $db,array $request): string {
  $saved=approval_department_key((string)($request['department']??''));if($saved!=='')return $saved;
  $requester=strtolower(trim((string)($request['requestedBy']??'')));
  foreach(all_users($db) as $user)if(is_array($user)&&strtolower(trim((string)($user['username']??'')))===$requester)return approval_department_key((string)($user['department']??$user['role']??''));
  $type=strtoupper((string)($request['type']??''));
  if(str_contains($type,'ACCOUNT')||str_contains($type,'INVOICE')||str_contains($type,'RECEIPT'))return 'ACCOUNTS';
  if(str_contains($type,'PRODUCTION'))return 'PRODUCTION';
  if(str_contains($type,'DISPATCH')||str_contains($type,'VEHICLE')||str_contains($type,'ROUTE'))return 'DISPATCH';
  if(str_contains($type,'PALLET')||str_contains($type,'PACKING'))return 'PACKING';
  if(str_contains($type,'SERIAL')||str_contains($type,'PO'))return 'STORE & PPC';
  if(str_contains($type,'SALES')||str_contains($type,'CUSTOMER')||str_contains($type,'ALLOCATE'))return 'SALES & MARKETING';
  if(str_contains($type,'PURCHASE')||str_contains($type,'VENDOR'))return 'PURCHASE';
  return 'SYSTEM';
}
function approval_request_assignees(mysqli $db,array $request): array {
  $department=approval_request_department($db,$request);$users=all_users($db);
  $designationNames=approval_designation_names_cached($db);
  // An active exact-type route wins over a department-wide route. Pending
  // requests resolve this dynamically, so route changes apply immediately.
  $requestType=strtoupper(trim((string)($request['type']??'')));
  $routes=approval_routes_cached($db);$routeCandidates=[];
  foreach(is_array($routes)?$routes:[] as $route){
    if(!is_array($route)||strtoupper((string)($route['status']??'ACTIVE'))!=='ACTIVE')continue;
    if(approval_department_key((string)($route['department']??''))!==$department)continue;
    $routeType=strtoupper(trim((string)($route['requestType']??'*')));
    if($routeType!==$requestType&&$routeType!=='*')continue;
    $routeCandidates[]=['route'=>$route,'specificity'=>$routeType===$requestType?2:1];
  }
  usort($routeCandidates,fn($left,$right)=>$right['specificity']<=>$left['specificity']?:strcmp((string)($right['route']['updatedAt']??''),(string)($left['route']['updatedAt']??'')));
  if($routeCandidates){
    $selected=$routeCandidates[0]['route'];$assignedIds=array_values(array_unique(array_filter([(string)($selected['primaryApproverId']??''),(string)($selected['secondaryApproverId']??'')],fn($id)=>$id!=='')));
    $matches=[];
    foreach($users as $user){
      if(!is_array($user)||!in_array((string)($user['id']??''),$assignedIds,true)||strtoupper((string)($user['status']??'ACTIVE'))!=='ACTIVE')continue;
      $username=trim((string)($user['username']??''));
      if($username==='')continue;
      $matches[]=['id'=>(string)($user['id']??''),'username'=>$username,'name'=>(string)($user['name']??$username),'rule'=>'REQUEST ROUTE MASTER','routeId'=>(string)($selected['id']??'')];
    }
    return $matches;
  }
  $matches=[];
  foreach($users as $user){
    if(!is_array($user)||strtoupper((string)($user['status']??'ACTIVE'))!=='ACTIVE'||!has_assigned_right($user,['requestsApprove']))continue;
    $username=trim((string)($user['username']??''));if($username===''||strtoupper($username)==='IT')continue;
    $userDepartment=approval_department_key((string)($user['department']??$user['role']??''));
    $designation=$designationNames[(string)($user['designationId']??'')]??strtoupper(trim((string)($user['designation']??'')));
    $assigned=false;$rule='DEPARTMENT APPROVER';
    if($department==='PACKING'){$assigned=in_array($designation,['OPERATION MANAGER','OPERATIONS MANAGER'],true);$rule='OPERATIONS MANAGER';}
    elseif($department==='STORE & PPC'){$assigned=in_array($designation,['PURCHASE MANAGER','MANAGER'],true)&&preg_match('/PURCHASE|PROCUREMENT|PPC/',$userDepartment);$rule='PURCHASE MANAGER';}
    else $assigned=$userDepartment===$department;
    if($assigned)$matches[]=['id'=>(string)($user['id']??''),'username'=>$username,'name'=>(string)($user['name']??$username),'rule'=>$rule];
  }
  return $matches;
}
function approval_request_with_routing(mysqli $db,array $request): array {
  $assignees=approval_request_assignees($db,$request);
  $request['department']=approval_request_department($db,$request);
  $request['assignedApproverIds']=array_values(array_map(fn($user)=>(string)$user['id'],$assignees));
  $request['assignedApproverUsernames']=array_values(array_map(fn($user)=>(string)$user['username'],$assignees));
  $request['assignedApproverNames']=array_values(array_map(fn($user)=>(string)$user['name'],$assignees));
  $request['routingRule']=!empty($assignees[0]['routeId'])?'REQUEST ROUTE MASTER':($request['department']==='PACKING'?'OPERATIONS MANAGER':($request['department']==='STORE & PPC'?'PURCHASE MANAGER':'DEPARTMENT APPROVER'));
  return $request;
}
function actor_can_approve_department_request(mysqli $db,array $actor,array $request): bool {
  if(strtoupper((string)($request['status']??''))!=='PENDING')return false;
  if(strcasecmp((string)($request['requestedBy']??''),(string)($actor['username']??''))===0)return false;
  if(admin($actor)||strtoupper((string)($actor['username']??''))==='IT')return true;
  $username=strtolower(trim((string)($actor['username']??'')));
  foreach(approval_request_assignees($db,$request) as $assignee)if(strtolower((string)$assignee['username'])===$username)return true;
  return false;
}
function approval_request_allowed_keys(string $type): array {
  $requests='DEMOSOLAR_DELETION_REQUESTS_V1';$type=strtoupper(trim($type));
  if(in_array($type,['DELETE_SERIALS_MULTI','DELETE_SERIAL'],true))return [$requests,'DEMOSOLAR_STORE_SERIALS_STORAGE_V1','DEMOSOLAR_STOCK_PALLET_FORMAT_V7','DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7','DEMOSOLAR_POS_PALLET_FORMAT_V7'];
  if(in_array($type,['EDIT_PALLET','DELETE_PALLETS_MULTI','DELETE_PALLET'],true))return [$requests,'DEMOSOLAR_STOCK_PALLET_FORMAT_V7','DEMOSOLAR_STOCK_BOOKINGS_V1','DEMOSOLAR_POS_PALLET_FORMAT_V7'];
  if(in_array($type,['DELETE_DISPATCH_PALLETS_MULTI','DELETE_DISPATCH_FULL','DELETE_DISPATCH_BULK'],true))return [$requests,'DEMOSOLAR_STOCK_PALLET_FORMAT_V7','DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7','DEMOSOLAR_ACCOUNT_INVOICES_V1','DEMOSOLAR_SALES_ORDERS_V1','DEMOSOLAR_STOCK_BOOKINGS_V1'];
  if($type==='ALLOCATE_PO_TO_CO')return [$requests,'DEMOSOLAR_SALES_ORDERS_V1','DEMOSOLAR_CO_ALLOCATIONS_V1','DEMOSOLAR_SALES_CO_REGISTRY_V1'];
  if(in_array($type,['EDIT_ACCOUNT_RECEIPT','DELETE_ACCOUNT_RECEIPT'],true))return [$requests,'DEMOSOLAR_ACCOUNT_RECEIPTS_V1'];
  if(in_array($type,['EDIT_ACCOUNT_INVOICE','DELETE_ACCOUNT_INVOICE'],true))return [$requests,'DEMOSOLAR_ACCOUNT_INVOICES_V1','DEMOSOLAR_SALES_ORDERS_V1','DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7','DEMOSOLAR_VEHICLE_BOOKINGS_V1'];
  if(in_array($type,['EDIT_SALES_ORDER','DELETE_SALES_ORDER'],true))return [$requests,'DEMOSOLAR_SALES_ORDERS_V1','DEMOSOLAR_CO_ALLOCATIONS_V1','DEMOSOLAR_SALES_CO_REGISTRY_V1','DEMOSOLAR_ACCOUNT_INVOICES_V1','DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7'];
  if(in_array($type,['EDIT_PRODUCTION_SHEET','DELETE_PRODUCTION_SHEET'],true))return [$requests,'DEMOSOLAR_PRODUCTION_SHEET_V1'];
  if($type==='DELETE_PO')return [$requests,'DEMOSOLAR_POS_PALLET_FORMAT_V7','DEMOSOLAR_STORE_SERIALS_STORAGE_V1','DEMOSOLAR_STOCK_PALLET_FORMAT_V7','DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7','DEMOSOLAR_PRODUCTION_SHEET_V1','DEMOSOLAR_STOCK_BOOKINGS_V1'];
  return [$requests];
}
function transaction_batch_save(mysqli $db,array $actor,array $input): array {
  $isAdmin=admin($actor);
  $approvalRequestId=transaction_text($input['approvalRequestId']??'',100);$assignedApprovalRequest=null;
  $changes=is_array($input['changes']??null)?$input['changes']:[];$patches=is_array($input['patches']??null)?$input['patches']:[];$expected=is_array($input['expectedVersions']??null)?$input['expectedVersions']:[];$auditEvents=is_array($input['auditEvents']??null)?array_slice($input['auditEvents'],0,30):[];
  $allowedKeys=array_values(array_filter(rr_module_keys(),fn($key)=>$key!==ERP_USERS_KEY&&$key!==ERP_LOGS_KEY));
  $submittedKeys=array_values(array_unique(array_merge(array_keys($changes),array_keys($patches))));
  if(!$submittedKeys||count($submittedKeys)>12)throw new RuntimeException('The approval transaction must contain between 1 and 12 module changes.');
  if(array_intersect(array_keys($changes),array_keys($patches)))throw new RuntimeException('An approval module cannot contain both a full value and a record patch.');
  foreach($submittedKeys as $changeKey)if(!is_string($changeKey)||!in_array($changeKey,$allowedKeys,true))throw new RuntimeException('The approval transaction contains an unsupported module.');
  if(!$isAdmin){
    if($approvalRequestId!==''){
      $savedRequests=read_value($db,'DEMOSOLAR_DELETION_REQUESTS_V1');
      foreach(is_array($savedRequests)?$savedRequests:[] as $savedRequest)if(is_array($savedRequest)&&(string)($savedRequest['id']??'')===$approvalRequestId){$assignedApprovalRequest=$savedRequest;break;}
      if(!$assignedApprovalRequest||!actor_can_approve_department_request($db,$actor,$assignedApprovalRequest))throw new RuntimeException('This request is not assigned to your employee ID and department.');
      $permitted=approval_request_allowed_keys((string)($assignedApprovalRequest['type']??''));
      foreach($submittedKeys as $changeKey)if(!in_array($changeKey,$permitted,true))throw new RuntimeException('This approval attempted to change a module outside its assigned department workflow.');
      if(!in_array('DEMOSOLAR_DELETION_REQUESTS_V1',$submittedKeys,true))throw new RuntimeException('The approval decision must update its source request atomically.');
      if($changes)throw new RuntimeException('Assigned department approvals require record-level changes. Refresh and try again.');
    } else {
    // The only other non-Administrator batch required by the UI is atomic
    // creation of one Sales Order together with its active CO registry.
    if($patches)throw new RuntimeException('Only an assigned approver can execute incremental approval patches.');
    $salesCreationKeys=['DEMOSOLAR_SALES_CO_REGISTRY_V1','DEMOSOLAR_SALES_ORDERS_V1'];
    $nonAdminKeys=$submittedKeys;sort($nonAdminKeys,SORT_STRING);sort($salesCreationKeys,SORT_STRING);
    if($nonAdminKeys!==$salesCreationKeys)throw new RuntimeException('Only an Administrator can execute this multi-module transaction.');
    foreach($nonAdminKeys as $changeKey){
      if(!allowed($actor,$changeKey,true))throw new RuntimeException('Your User Rights do not allow this Sales Order transaction.');
      $writeError=non_admin_write_error($db,$actor,$changeKey,$changes[$changeKey]);
      if($writeError!==null)throw new RuntimeException($writeError);
    }
    $beforeOrders=records_by_identity(read_value($db,'DEMOSOLAR_SALES_ORDERS_V1')??[],['id','coNumber']);
    $afterOrders=records_by_identity($changes['DEMOSOLAR_SALES_ORDERS_V1'],['id','coNumber']);
    $newOrders=array_diff_key($afterOrders,$beforeOrders);
    if(count($newOrders)!==1||count($afterOrders)!==count($beforeOrders)+1)throw new RuntimeException('A Sales user transaction must create exactly one new Sales Order.');
    $newOrder=reset($newOrders);
    if(!is_array($newOrder)||strcasecmp((string)($newOrder['createdBy']??''),(string)($actor['username']??''))!==0)throw new RuntimeException('Sales Order creator does not match the signed-in user.');
    $orderCos=[];foreach($changes['DEMOSOLAR_SALES_ORDERS_V1'] as $order)if(is_array($order)&&($co=transaction_key($order['coNumber']??''))!=='')$orderCos[$co]=true;
    $registryCos=[];foreach($changes['DEMOSOLAR_SALES_CO_REGISTRY_V1'] as $entry){$co=transaction_key(is_array($entry)?($entry['coNumber']??$entry['co']??''):$entry);if($co!=='')$registryCos[$co]=true;}
    if(array_keys($orderCos)!==array_keys($registryCos)){
      ksort($orderCos,SORT_STRING);ksort($registryCos,SORT_STRING);
      if(array_keys($orderCos)!==array_keys($registryCos))throw new RuntimeException('The Sales Order CO registry does not match the active Sales Orders.');
    }
    }
  }
  sort($submittedKeys,SORT_STRING);ksort($changes,SORT_STRING);ksort($patches,SORT_STRING);$db->begin_transaction();
  try{
    $locked=[];foreach($submittedKeys as $changeKey){$locked[$changeKey]=locked_storage_version($db,$changeKey);$wanted=is_scalar($expected[$changeKey]??null)?(string)$expected[$changeKey]:'';if($wanted==='')throw new RuntimeException('The browser has not finished loading the latest ERP data. Refresh before trying again.');if(!hash_equals($locked[$changeKey],$wanted))throw new RuntimeException('Live ERP data changed during approval. Refresh before trying again.');}
    foreach($patches as $changeKey=>$patch){$current=read_value_for_update($db,$changeKey);if(!is_array($current))$current=[];$changes[$changeKey]=$changeKey==='DEMOSOLAR_DELETION_REQUESTS_V1'?transaction_merge_request_patch($current,$patch):transaction_apply_record_patch($current,$patch);}
    if(!$isAdmin&&$assignedApprovalRequest){
      $decided=null;foreach($changes['DEMOSOLAR_DELETION_REQUESTS_V1']??[] as $candidate)if(is_array($candidate)&&(string)($candidate['id']??'')===$approvalRequestId){$decided=$candidate;break;}
      if(!$decided||!in_array(strtoupper((string)($decided['status']??'')),['APPROVED','REJECTED'],true)||strcasecmp((string)($decided['reviewedBy']??''),(string)($actor['username']??''))!==0)throw new RuntimeException('The assigned approval decision is incomplete or belongs to another user.');
    }
    ksort($changes,SORT_STRING);
    foreach($changes as $value)if(!is_array($value))throw new RuntimeException('Every approval module must contain a record list.');
    foreach($changes as $changeKey=>$value)if(!write_value_in_transaction($db,$changeKey,$value,true))throw new RuntimeException('The complete approval transaction could not be saved.');
    if($auditEvents){
      $records=[];$username=transaction_text($actor['username']??'SYSTEM',100)?:'SYSTEM';
      foreach($auditEvents as $event){if(!is_array($event))continue;$records[]=['id'=>'LOG-'.bin2hex(random_bytes(12)),'timestamp'=>date('Y-m-d H:i:s'),'operator'=>$username,'dept'=>strtoupper(transaction_text($event['department']??'SYSTEM',60))?:'SYSTEM','action'=>strtoupper(transaction_text($event['actionCode']??'APPROVAL_UPDATED',100))?:'APPROVAL_UPDATED','details'=>transaction_text($event['details']??'',4000)];}
      if($records)audit_events_append($db,$records);
    }
    $versions=[];foreach($submittedKeys as $changeKey)$versions[$changeKey]=locked_storage_version($db,$changeKey);
    $db->commit();return ['versions'=>$versions,'savedKeys'=>$submittedKeys];
  }catch(Throwable $error){$db->rollback();throw $error;}
}
function records_by_identity($value,array $identityFields): array {
  if(!is_array($value))return [];
  $records=[];
  foreach($value as $record){
    if(!is_array($record))continue;
    $identity='';
    foreach($identityFields as $field){
      $candidate=trim((string)($record[$field]??''));
      if($candidate!==''){ $identity=strtolower($field).':'.strtoupper($candidate); break; }
    }
    if($identity!=='')$records[$identity]=$record;
  }
  return $records;
}
function changed_record_fields(array $before,array $after): array {
  $fields=[];
  foreach(array_unique(array_merge(array_keys($before),array_keys($after))) as $field){
    if(json_encode($before[$field]??null)!==json_encode($after[$field]??null))$fields[]=$field;
  }
  return $fields;
}
function actor_has_any_right(array $user,array $rights,array $legacyRoles=[]): bool {
  if(user_rights_configured($user))return has_assigned_right($user,$rights);
  return admin($user)||in_array(strtolower((string)($user['role']??'')),$legacyRoles,true);
}
function purchase_order_workflow(mysqli $db,array $actor,array $input): array {
  $operation=strtoupper(trim((string)($input['operation']??'')));
  $orderId=trim((string)($input['orderId']??''));
  $expected=is_scalar($input['expectedVersion']??null)?(string)$input['expectedVersion']:'';
  $remark=transaction_text($input['remark']??'',1000);
  if(!in_array($operation,['EDIT','SUBMIT','APPROVE','REJECT','REQUEST_DELETE','APPROVE_DELETE','REJECT_DELETE'],true)||$orderId==='')throw new InvalidArgumentException('Choose a valid Purchase Order workflow action.');
  if($operation==='EDIT'&&!allowed($actor,ERP_PURCHASE_ORDERS_KEY,true))throw new RuntimeException('Your User Rights do not allow Purchase Order editing.');
  if($operation==='SUBMIT'&&!allowed($actor,ERP_PURCHASE_ORDERS_KEY,true))throw new RuntimeException('Your User Rights do not allow Purchase Order submission.');
  if(in_array($operation,['APPROVE','REJECT'],true)&&!admin($actor))throw new RuntimeException('Only an Administrator can approve or reject a Purchase Order.');
  if($operation==='REQUEST_DELETE'&&!actor_has_any_right($actor,['purchaseOrderDelete'],['purchase','procurement']))throw new RuntimeException('Your User Rights do not allow Purchase Order deletion requests.');
  if(in_array($operation,['APPROVE_DELETE','REJECT_DELETE'],true)&&!admin($actor))throw new RuntimeException('Only an Administrator can decide a Purchase Order deletion request.');
  if($operation==='REJECT'&&$remark==='')throw new InvalidArgumentException('Enter an Administrator remark before rejecting the Purchase Order.');
  if(in_array($operation,['REQUEST_DELETE','REJECT_DELETE'],true)&&$remark==='')throw new InvalidArgumentException('Enter a reason for the Purchase Order deletion decision.');

  $db->begin_transaction();
  try {
    $currentVersion=locked_storage_version($db,ERP_PURCHASE_ORDERS_KEY);
    if($expected!==''&&!hash_equals($currentVersion,$expected))throw new RuntimeException('Purchase Order data changed on another screen. Refresh and try again.');
    $orders=read_value_for_update($db,ERP_PURCHASE_ORDERS_KEY);
    if(!is_array($orders))$orders=[];
    $index=null;
    foreach($orders as $position=>$candidate)if(is_array($candidate)&&(string)($candidate['id']??'')===$orderId){$index=$position;break;}
    if($index===null)throw new RuntimeException('The selected Purchase Order was not found.');
    $order=$orders[$index];
    $status=strtoupper(trim((string)($order['status']??'DRAFT')));
    if($status==='SAVED')$status='DRAFT';
    $username=transaction_text($actor['username']??'SYSTEM',100)?:'SYSTEM';
    $name=transaction_text($actor['name']??$username,160)?:$username;
    $now=date(DATE_ATOM);

    $deleted=false;
    if($operation==='EDIT'){
      if($status==='PENDING_APPROVAL')throw new RuntimeException('A Purchase Order awaiting approval cannot be edited. Complete the approval decision first.');
      if(!admin($actor)&&strcasecmp((string)($order['createdBy']??''),$username)!==0)throw new RuntimeException('Only the Purchase Order creator or an Administrator can edit this record.');
      if(strtoupper((string)($order['deleteRequest']['status']??''))==='PENDING')throw new RuntimeException('This Purchase Order cannot be edited while its deletion request is pending.');
      $edited=is_array($input['order']??null)?$input['order']:null;
      if(!$edited)throw new InvalidArgumentException('The edited Purchase Order details are missing.');
      if((string)($edited['id']??'')!==$orderId||(string)($edited['poNumber']??'')!==(string)($order['poNumber']??''))throw new InvalidArgumentException('The Purchase Order identity or number cannot be changed.');
      $poDate=trim((string)($edited['poDate']??''));$poType=strtoupper(trim((string)($edited['poType']??'')));$materialType=strtoupper(trim((string)($edited['materialType']??'')));
      if(!preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/',$poDate))throw new InvalidArgumentException('Select a valid Purchase Order date.');
      if(!in_array($poType,['DOMESTIC','IMPORT'],true))throw new InvalidArgumentException('Select Domestic or Import as the PO type.');
      if(!in_array($materialType,['RM','SPARES','SERVICE','CAPITAL_GOODS','CONSUMABLES'],true))throw new InvalidArgumentException('Select a valid material type.');
      $vendor=is_array($edited['vendor']??null)?$edited['vendor']:[];$vendorId=trim((string)($edited['vendorId']??''));
      if($vendorId===''||trim((string)($vendor['name']??''))==='')throw new InvalidArgumentException('Select a valid Purchase Order vendor.');
      $vendorGst=strtoupper(preg_replace('/[^A-Z0-9]/','',(string)($vendor['gst']??'')));
      $taxMode='IMPORT';$currency=strtoupper(trim((string)($edited['currency']??'')));
      if($poType==='IMPORT'){
        if(!in_array($currency,['USD','RMB'],true))throw new InvalidArgumentException('Select Dollar (USD) or Renminbi (RMB) for the Import Purchase Order.');
      } else {
        if(strlen($vendorGst)!==15)throw new InvalidArgumentException('The selected Domestic vendor GSTIN is invalid.');
        $taxMode=substr($vendorGst,0,2)==='24'?'INTRA':'INTER';$currency='INR';
      }
      if(strtoupper(trim((string)($edited['taxMode']??'')))!==$taxMode)throw new InvalidArgumentException('Purchase Order tax mode does not match its type and vendor.');
      $items=is_array($edited['items']??null)?$edited['items']:[];if(!$items)throw new InvalidArgumentException('Purchase Order requires at least one item.');
      $allowedRates=[5.0,12.0,18.0,28.0];$allowedUom=['NOS','KG','LTR','MTR','SQM','FEET','SET'];$subtotal=0.0;$taxTotal=0.0;
      foreach($items as $item){
        if(!is_array($item)||trim((string)($item['description']??''))==='')throw new InvalidArgumentException('Every Purchase Order item requires a description.');
        $qty=is_numeric($item['qty']??null)?(float)$item['qty']:0.0;$rate=is_numeric($item['rate']??null)?(float)$item['rate']:-1.0;$gstRate=is_numeric($item['gstRate']??null)?(float)$item['gstRate']:0.0;$uom=strtoupper(trim((string)($item['uom']??'')));
        if($qty<=0||$rate<0||!in_array($uom,$allowedUom,true)||($poType==='DOMESTIC'&&!in_array($gstRate,$allowedRates,true))||($poType==='IMPORT'&&abs($gstRate)>0.001))throw new InvalidArgumentException('Purchase Order item quantity, UOM, rate or GST selection is invalid.');
        $taxable=$qty*$rate;$subtotal+=$taxable;if($poType==='DOMESTIC')$taxTotal+=$taxable*$gstRate/100;
      }
      $cgst=$taxMode==='INTRA'?$taxTotal/2:0.0;$sgst=$taxMode==='INTRA'?$taxTotal/2:0.0;$igst=$taxMode==='INTER'?$taxTotal:0.0;$rounded=round($subtotal+$taxTotal);$roundOff=$rounded-($subtotal+$taxTotal);$totals=is_array($edited['totals']??null)?$edited['totals']:[];
      foreach(['subtotal'=>$subtotal,'cgst'=>$cgst,'sgst'=>$sgst,'igst'=>$igst,'roundOff'=>$roundOff,'grandTotal'=>$rounded] as $field=>$expectedValue){$submittedValue=is_numeric($totals[$field]??null)?(float)$totals[$field]:0.0;if(abs($submittedValue-$expectedValue)>0.02)throw new InvalidArgumentException('Purchase Order totals do not reconcile with the edited item values.');}
      foreach(['poDate','poType','materialType','vendorId','vendor','taxMode','currency','items','billTo','shipTo','shipVia','shippingTerms','paymentTerms','deliveryDate','remarks','totals','documents'] as $field)if(array_key_exists($field,$edited))$order[$field]=$edited[$field];
      $order['poDate']=$poDate;$order['poType']=$poType;$order['materialType']=$materialType;$order['vendorId']=$vendorId;$order['vendor']=$vendor;$order['taxMode']=$taxMode;$order['currency']=$currency;
      $order['status']='DRAFT';$order['editedAt']=$now;$order['editedBy']=$username;$order['editedName']=$name;
      foreach(['submittedAt','submittedBy','preparedAt','preparedBy','preparedName','preparedSignature','approvedAt','approvedBy','approvedName','approvedSignature','rejectedAt','rejectedBy','approvalRemark'] as $field)unset($order[$field]);
    } elseif($operation==='SUBMIT'){
      if($status!=='DRAFT'&&$status!=='REJECTED')throw new RuntimeException('Only a Draft or Rejected Purchase Order can be sent for approval.');
      if(!admin($actor)&&strcasecmp((string)($order['createdBy']??''),$username)!==0)throw new RuntimeException('Only the Purchase Order creator can submit it for approval.');
      $order['status']='PENDING_APPROVAL';
      $order['submittedAt']=$now;$order['submittedBy']=$username;
      $order['preparedAt']=$now;$order['preparedBy']=$username;$order['preparedName']=$name;
      $order['preparedSignature']=['type'=>'ERP_DIGITAL_SIGNATURE','signer'=>$username,'signerName'=>$name,'signedAt'=>$now];
      $order['approvedAt']='';$order['approvedBy']='';$order['approvedName']='';$order['approvedSignature']=null;$order['approvalRemark']='';
    } elseif($operation==='APPROVE') {
      if($status!=='PENDING_APPROVAL')throw new RuntimeException('Only a Purchase Order waiting for approval can be approved.');
      $order['status']='APPROVED';
      $order['approvedAt']=$now;$order['approvedBy']=$username;$order['approvedName']=$name;$order['approvalRemark']=$remark;
      $order['approvedSignature']=['type'=>'ERP_DIGITAL_SIGNATURE','signer'=>$username,'signerName'=>$name,'signedAt'=>$now];
    } elseif($operation==='REJECT') {
      if($status!=='PENDING_APPROVAL')throw new RuntimeException('Only a Purchase Order waiting for approval can be rejected.');
      $order['status']='REJECTED';
      $order['rejectedAt']=$now;$order['rejectedBy']=$username;$order['approvalRemark']=$remark;
      $order['approvedAt']='';$order['approvedBy']='';$order['approvedName']='';$order['approvedSignature']=null;
    } elseif($operation==='REQUEST_DELETE') {
      if($status==='PENDING_APPROVAL')throw new RuntimeException('Finish the Purchase Order approval decision before requesting its deletion.');
      if(strtoupper((string)($order['deleteRequest']['status']??''))==='PENDING')throw new RuntimeException('A deletion request for this Purchase Order is already waiting for Administrator approval.');
      $order['deleteRequest']=['status'=>'PENDING','reason'=>$remark,'requestedAt'=>$now,'requestedBy'=>$username,'requestedName'=>$name,'decidedAt'=>'','decidedBy'=>'','decisionRemark'=>''];
    } elseif($operation==='REJECT_DELETE') {
      if(strtoupper((string)($order['deleteRequest']['status']??''))!=='PENDING')throw new RuntimeException('This Purchase Order does not have a pending deletion request.');
      if(strcasecmp((string)($order['deleteRequest']['requestedBy']??''),$username)===0)throw new RuntimeException('The deletion requester cannot decide their own request.');
      $order['deleteRequest']['status']='REJECTED';$order['deleteRequest']['decidedAt']=$now;$order['deleteRequest']['decidedBy']=$username;$order['deleteRequest']['decisionRemark']=$remark;
    } else {
      if(strtoupper((string)($order['deleteRequest']['status']??''))!=='PENDING')throw new RuntimeException('This Purchase Order does not have a pending deletion request.');
      if(strcasecmp((string)($order['deleteRequest']['requestedBy']??''),$username)===0)throw new RuntimeException('The deletion requester cannot approve their own request.');
      $order['deleteRequest']['status']='APPROVED';$order['deleteRequest']['decidedAt']=$now;$order['deleteRequest']['decidedBy']=$username;$order['deleteRequest']['decisionRemark']=$remark;
      array_splice($orders,$index,1);$deleted=true;
    }
    $order['updatedAt']=$now;$order['updatedBy']=$username;
    if(!$deleted)$orders[$index]=$order;
    if(!write_value_in_transaction($db,ERP_PURCHASE_ORDERS_KEY,$orders,true))throw new RuntimeException('The Purchase Order workflow could not be saved.');
    $version=locked_storage_version($db,ERP_PURCHASE_ORDERS_KEY);
    $db->commit();
  } catch(Throwable $error) {
    $db->rollback();
    throw $error;
  }
  $actionCodes=['EDIT'=>'PURCHASE_ORDER_EDITED','SUBMIT'=>'PURCHASE_ORDER_SUBMITTED','APPROVE'=>'PURCHASE_ORDER_APPROVED','REJECT'=>'PURCHASE_ORDER_REJECTED','REQUEST_DELETE'=>'PURCHASE_ORDER_DELETE_REQUESTED','APPROVE_DELETE'=>'PURCHASE_ORDER_DELETE_APPROVED','REJECT_DELETE'=>'PURCHASE_ORDER_DELETE_REJECTED'];
  $actionCode=$actionCodes[$operation]??'PURCHASE_ORDER_WORKFLOW';
  $audit=null;
  try{$audit=append_audit_event($db,$actor,'PURCHASE',$actionCode,$operation.' Purchase Order '.(string)($order['poNumber']??$orderId).($remark!==''?'; remark: '.$remark:'.'));}
  catch(Throwable $auditError){error_log('Purchase Order workflow audit failed: '.$auditError->getMessage());}
  try{
    [$auditId,$auditLegacy]=erp_notification_audit_link($db,$audit);$poNumber=(string)($order['poNumber']??$orderId);$group='PURCHASE_ORDER:'.$orderId.':APPROVAL';
    if($operation==='SUBMIT')erp_notification_send_to_right($db,'purchaseOrderApprovals',['type'=>'APPROVAL','category'=>'APPROVAL','priority'=>'HIGH','title'=>'Purchase Order needs approval','message'=>$name.' submitted '.$poNumber.' for approval.','entityType'=>'PURCHASE_ORDER','entityId'=>$orderId,'targetView'=>'purchaseOrderApprovals','targetPayload'=>['orderId'=>$orderId],'approvalGroupKey'=>$group,'actionable'=>true,'auditEventId'=>$auditId,'auditLegacyId'=>$auditLegacy],$username);
    elseif(in_array($operation,['APPROVE','REJECT'],true)){
      erp_notification_resolve_group($db,$group,$name,$auditId,$auditLegacy);
      $creator=(string)($order['createdBy']??$order['submittedBy']??'');if($creator!=='')erp_notification_send_to_username($db,$creator,['type'=>$operation==='APPROVE'?'SUCCESS':'WARNING','category'=>'APPROVAL','priority'=>$operation==='APPROVE'?'NORMAL':'HIGH','title'=>$operation==='APPROVE'?'Purchase Order approved':'Purchase Order rejected','message'=>$name.' '.($operation==='APPROVE'?'approved ':'rejected ').$poNumber.($remark!==''?' · '.$remark:''),'entityType'=>'PURCHASE_ORDER','entityId'=>$orderId,'targetView'=>'purchaseOrderView','targetPayload'=>['orderId'=>$orderId],'auditEventId'=>$auditId,'auditLegacyId'=>$auditLegacy]);
    }
  }catch(Throwable $notificationError){error_log('Purchase Order notification failed: '.$notificationError->getMessage());}
  return ['order'=>$order,'deleted'=>$deleted,'version'=>$version];
}
/**
 * Browser approval dialogs are helpful, but they are not a security boundary.
 * This server-side guard stops a non-admin from replacing historical protected
 * records through a manually constructed storage request. New operational
 * records are still allowed; existing protected records remain immutable until
 * an Administrator performs the approved mutation.
 */
function non_admin_write_error(mysqli $db,array $actor,string $key,$submitted): ?string {
  if(admin($actor))return null;
  $rules=[
    'DEMOSOLAR_SALES_ORDERS_V1'=>['id','coNumber'],
    'DEMOSOLAR_ACCOUNT_INVOICES_V1'=>['invoiceNumber'],
    'DEMOSOLAR_ACCOUNT_RECEIPTS_V1'=>['id'],
    ERP_PURCHASE_VENDORS_KEY=>['vendorCode'],
    ERP_PURCHASE_ORDERS_KEY=>['id','poNumber'],
    'DEMOSOLAR_CUSTOMERS_MASTER_V1'=>['gst'],
    'DEMOSOLAR_PRODUCTION_SHEET_V1'=>['id','poNumber'],
    'DEMOSOLAR_PRODUCTION_DAILY_V1'=>['id'],
    'DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7'=>['id','invoice'],
    'DEMOSOLAR_VEHICLE_BOOKINGS_V1'=>['id'],
    'DEMOSOLAR_CO_ALLOCATIONS_V1'=>['id'],
    'DEMOSOLAR_DELETION_REQUESTS_V1'=>['id'],
    'DEMOSOLAR_SYSTEM_LOGS_PALLET_FORMAT_V7'=>['id']
  ];
  if(!isset($rules[$key]))return null;
  if(!is_array($submitted))return 'Protected ERP data must be submitted as a record list.';
  $existing=read_value($db,$key);
  if($existing===null)$existing=[];
  if(!is_array($existing))return 'Protected ERP data is not in a valid format.';
  $before=records_by_identity($existing,$rules[$key]);
  $after=records_by_identity($submitted,$rules[$key]);
  $submittedRecords=count(array_filter($submitted,fn($record)=>is_array($record)));
  if(count($after)!==$submittedRecords)return 'Protected ERP records must have a unique valid identifier.';
  foreach($before as $identity=>$old){
    if(!array_key_exists($identity,$after))return 'Direct deletion of protected records is not allowed. Submit an Administrator approval request.';
    $new=$after[$identity];
    $changed=changed_record_fields($old,$new);
    if(!$changed)continue;
    if($key==='DEMOSOLAR_SALES_ORDERS_V1'){
      // Dispatch and certificate workflows only maintain calculated delivery fields.
      $allowed=['dispatchQty','pendingQty','actualDispatchDate','status','closedAt','performanceCertificate','updatedAt','updatedBy'];
      if(array_diff($changed,$allowed))return 'Direct Sales Order edits require Administrator approval.';
      continue;
    }
    if($key==='DEMOSOLAR_PRODUCTION_SHEET_V1'){
      // Scanning the first valid serial legitimately opens packing for a PO.
      $allowed=['packingStatus','packingOpenedAt','packingOpenedBy','updatedAt','updatedBy'];
      $opensPacking=actor_has_any_right($actor,['packingScan'],['packing'])
        && strtoupper((string)($old['packingStatus']??'IN LINE'))!=='OPEN'
        && strtoupper((string)($new['packingStatus']??''))==='OPEN';
      if(!$opensPacking||array_diff($changed,$allowed))return 'Direct Production Sheet edits require Administrator approval.';
      continue;
    }
    if($key==='DEMOSOLAR_VEHICLE_BOOKINGS_V1'){
      $allowed=['unloadingCharges','grossAmount','deductionAmount','finalPayable','settledAt','settledBy'];
      if(array_diff($changed,$allowed))return 'Only transport settlement amounts may be updated after vehicle booking.';
      $freight=transaction_number($new['originalFreight']??0);$unloading=transaction_number($new['unloadingCharges']??0);$deduction=transaction_number($new['deductionAmount']??0);$gross=transaction_number($new['grossAmount']??0);$final=transaction_number($new['finalPayable']??0);
      if($freight<=0||$unloading<0||$deduction<0||abs($gross-($freight+$unloading))>0.01||$deduction>$gross||abs($final-($gross-$deduction))>0.01)return 'Transport settlement calculation is invalid.';
      if(strcasecmp((string)($new['settledBy']??''),(string)($actor['username']??''))!==0)return 'Settlement operator does not match the signed-in user.';
      continue;
    }
    if($key==='DEMOSOLAR_ACCOUNT_RECEIPTS_V1'){
      if(array_diff($changed,['notes']))return 'Receipt corrections require Administrator approval. Only append-only receipt notes can be saved directly.';
      $oldNotes=is_array($old['notes']??null)?$old['notes']:[];
      $newNotes=is_array($new['notes']??null)?$new['notes']:[];
      if(count($newNotes)!==count($oldNotes)+1||array_slice($newNotes,0,count($oldNotes))!==$oldNotes)return 'Receipt notes may only be appended; existing notes cannot be changed or removed.';
      $note=end($newNotes);
      if(!is_array($note)||trim((string)($note['text']??''))===''||strlen((string)$note['text'])>2000||strcasecmp((string)($note['createdBy']??''),(string)($actor['username']??''))!==0)return 'Receipt note is invalid or its author does not match the signed-in user.';
      continue;
    }
    // Daily records, allocations, requests and audit logs are immutable after creation.
    return 'Historical protected records cannot be changed directly. Submit an Administrator approval request.';
  }
  foreach($after as $identity=>$new){
    if(isset($before[$identity]))continue;
    if($key==='DEMOSOLAR_ACCOUNT_INVOICES_V1'){
      $required=['coNumber','invoiceNumber','invoiceDate','transporterName','vehicleNumber'];
      foreach($required as $field)if(trim((string)($new[$field]??''))==='')return 'Accounts invoice is missing required order, invoice, transporter or vehicle details.';
      if(transaction_key($new['deliveryOrderNo']??'')!==transaction_key($new['coNumber']??''))return 'Delivery Order Number must match the selected C/O Number.';
      if(transaction_number($new['quantity']??0)<=0)return 'Accounts invoice quantity must be greater than zero.';
      $orders=read_value($db,'DEMOSOLAR_SALES_ORDERS_V1');$linkedOrder=null;
      foreach(is_array($orders)?$orders:[] as $order)if(is_array($order)&&transaction_key($order['coNumber']??'')===transaction_key($new['coNumber']??'')){$linkedOrder=$order;break;}
      if(!$linkedOrder)return 'The selected C/O does not exist in the active Sales Orders.';
      $alreadyInvoiced=0;foreach(is_array($existing)?$existing:[] as $savedInvoice)if(is_array($savedInvoice)&&transaction_key($savedInvoice['coNumber']??'')===transaction_key($new['coNumber']??''))$alreadyInvoiced+=transaction_number($savedInvoice['quantity']??0);
      $remaining=max(0,transaction_number($linkedOrder['totalOrderQty']??0)-$alreadyInvoiced);
      if(transaction_number($new['quantity']??0)>$remaining)return 'Invoice quantity exceeds the remaining C/O quantity of '.$remaining.' module(s).';
      $gst=strtoupper(preg_replace('/[^A-Z0-9]/','',(string)($new['transporterGst']??'')));$pan=strtoupper(preg_replace('/[^A-Z0-9]/','',(string)($new['transporterPan']??'')));
      if($gst!==''&&(strlen($gst)!==15||!preg_match('/^[A-Z]{5}[0-9]{4}[A-Z]$/',$pan)||substr($gst,2,10)!==$pan))return 'Transporter PAN must match GSTIN characters 3 through 12.';
      if(strtoupper((string)($new['status']??''))!=='READY FOR DISPATCH')return 'A new Accounts invoice must be released as Ready for Dispatch.';
      if(strcasecmp((string)($new['createdBy']??''),(string)($actor['username']??''))!==0)return 'Accounts invoice creator does not match the signed-in user.';
    }
    if($key==='DEMOSOLAR_ACCOUNT_RECEIPTS_V1'){
      foreach(['id','date','customerId','partyName','transactionType','bankUnit','salesPerson','createdBy'] as $field)if(trim((string)($new[$field]??''))==='')return 'Receipt is missing required date, Customer Master party, transaction, bank or sales person details.';
      $date=DateTime::createFromFormat('Y-m-d',(string)$new['date']);
      if(!$date||$date->format('Y-m-d')!==(string)$new['date'])return 'Receipt date is invalid.';
      if(!is_numeric($new['amount']??null)||(float)$new['amount']<=0)return 'Receipt amount must be greater than zero.';
      $transactionType=strtoupper(trim((string)$new['transactionType']));if(!in_array($transactionType,['RECEIPT','TDS','CREDIT NOTE','DEBIT NOTE','OTHER'],true))return 'Receipt transaction type is invalid.';
      $customers=read_value($db,'DEMOSOLAR_CUSTOMERS_MASTER_V1');$linkedCustomer=null;
      foreach(is_array($customers)?$customers:[] as $customer){if(is_array($customer)&&(string)($customer['id']??'')===(string)$new['customerId']){$linkedCustomer=$customer;break;}}
      if(!$linkedCustomer||transaction_key($linkedCustomer['name']??'')!==transaction_key($new['partyName']))return 'Receipt party must match a saved Customer Master record.';
      $people=read_value($db,'DEMOSOLAR_SALES_PEOPLE_V1');$linkedPerson=null;
      foreach(is_array($people)?$people:[] as $person){if(is_array($person)&&transaction_key($person['name']??'')===transaction_key($new['salesPerson'])&&strtoupper((string)($person['status']??'ACTIVE'))!=='INACTIVE'){$linkedPerson=$person;break;}}
      if(!$linkedPerson)return 'Receipt Sales Person must match an active Sales Person Master record.';
      foreach(['totalInvoiced','receivedBefore','receivedAfter','pendingBefore','pendingAfter','advanceBefore','advanceAmount','advanceAfter','balanceEffect'] as $field)if(!is_numeric($new[$field]??null))return 'Receipt balance or advance calculation is invalid.';
      $amount=(float)$new['amount'];$total=(float)$new['totalInvoiced'];$received=(float)$new['receivedBefore'];$receivedAfter=(float)$new['receivedAfter'];$pendingBefore=(float)$new['pendingBefore'];$pendingAfter=(float)$new['pendingAfter'];$advanceBefore=(float)$new['advanceBefore'];$advanceAmount=(float)$new['advanceAmount'];$advanceAfter=(float)$new['advanceAfter'];$balanceEffect=(float)$new['balanceEffect'];
      $expectedBalanceEffect=$transactionType==='DEBIT NOTE'?-$amount:$amount;if(abs($balanceEffect-$expectedBalanceEffect)>0.011)return 'Receipt transaction amount and balance effect do not reconcile.';
      if($total<0||$received<0||$receivedAfter<0||$pendingBefore<0||$pendingAfter<0||$advanceBefore<0||$advanceAmount<0||$advanceAfter<0)return 'Receipt balance or advance calculation is invalid.';
      $expectedPendingBefore=max(0,$total-$received);$expectedReceivedAfter=$received+$balanceEffect;$expectedPendingAfter=max(0,$total-$expectedReceivedAfter);$expectedAdvanceBefore=max(0,$received-$total);$expectedAdvanceAfter=max(0,$expectedReceivedAfter-$total);$expectedAdvanceAmount=max(0,$balanceEffect-$expectedPendingBefore);
      if(abs($pendingBefore-$expectedPendingBefore)>0.011||abs($receivedAfter-$expectedReceivedAfter)>0.011||abs($pendingAfter-$expectedPendingAfter)>0.011||abs($advanceBefore-$expectedAdvanceBefore)>0.011||abs($advanceAfter-$expectedAdvanceAfter)>0.011||abs($advanceAmount-$expectedAdvanceAmount)>0.011)return 'Receipt balance or advance calculation does not reconcile.';
      if((bool)($new['isAdvance']??false)!==($advanceAmount>0.001))return 'Receipt advance-payment classification is invalid.';
      $salesOrderId=trim((string)($new['salesOrderId']??''));$coNumber=trim((string)($new['coNumber']??''));
      if(($salesOrderId==='')!==($coNumber===''))return 'Receipt Sales C/O linkage is incomplete.';
      if($salesOrderId!==''){
        $orders=read_value($db,'DEMOSOLAR_SALES_ORDERS_V1');$linkedOrder=null;
        foreach(is_array($orders)?$orders:[] as $order){if(is_array($order)&&(string)($order['id']??'')===$salesOrderId){$linkedOrder=$order;break;}}
        if(!$linkedOrder||transaction_key($linkedOrder['customerName']??'')!==transaction_key($new['partyName'])||transaction_key($linkedOrder['coNumber']??'')!==transaction_key($coNumber))return 'Receipt party and optional C/O must match the saved Sales Order.';
      }
      $invoices=read_value($db,'DEMOSOLAR_ACCOUNT_INVOICES_V1');$actualTotal=0.0;
      foreach(is_array($invoices)?$invoices:[] as $invoice)if(is_array($invoice)&&transaction_key($invoice['customerName']??'')===transaction_key($new['partyName']))$actualTotal+=round((float)($invoice['invoiceValue']??0));
      $actualReceived=0.0;foreach(is_array($existing)?$existing:[] as $savedReceipt)if(is_array($savedReceipt)&&transaction_key($savedReceipt['partyName']??'')===transaction_key($new['partyName']))$actualReceived+=(float)($savedReceipt['balanceEffect']??$savedReceipt['amount']??0);
      if(abs($total-$actualTotal)>0.011||abs($received-$actualReceived)>0.011)return 'Receipt balance is not based on the latest Accounts invoice and receipt records. Refresh and try again.';
      if(strcasecmp((string)($new['createdBy']??''),(string)($actor['username']??''))!==0)return 'Receipt operator does not match the signed-in user.';
    }
    if($key===ERP_PURCHASE_VENDORS_KEY){
      $vendorType=strtoupper(trim((string)$new['vendorType']));if(!in_array($vendorType,['DOMESTIC','IMPORT'],true))return 'Vendor Type must be Domestic or Import.';
      foreach(['id','vendorCode','name','factoryAddressLine1','factoryCountry','factoryState','factoryCity','factoryPostalCode','officeAddressLine1','officeCountry','officeState','officeCity','officePostalCode','bankName','accountNumber','branchName','branchAddress','salesPersonName','salesPersonMobile','salesPersonEmail','createdBy'] as $field)if(trim((string)($new[$field]??''))==='')return 'Vendor Master record is missing required vendor, address, bank or Sales contact details.';
      foreach($vendorType==='DOMESTIC'?['gst','pan','ifsc']:['swift'] as $field)if(trim((string)($new[$field]??''))==='')return $vendorType==='DOMESTIC'?'Domestic vendors require GSTIN, PAN and IFSC. CIN and MSME / UDYAM are optional.':'Import vendors require a SWIFT / BIC code.';
      $documents=is_array($new['documents']??null)?$new['documents']:[];$documentCategories=[];foreach($documents as $document)if(is_array($document))$documentCategories[]=strtoupper(trim((string)($document['category']??'')));
      $requiredDocumentCategories=$vendorType==='DOMESTIC'?['GST','PAN','CANCELLED_CHEQUE']:['CANCELLED_CHEQUE'];foreach($requiredDocumentCategories as $category)if(!in_array($category,$documentCategories,true))return $vendorType==='DOMESTIC'?'Domestic vendors require uploaded GST, PAN and bank proof documents.':'Import vendors require uploaded bank details on company letterhead.';
      if(!preg_match('/^V[DI][0-9]{4,}$/',(string)$new['vendorCode']))return 'Vendor code format is invalid.';
      $gst=strtoupper(preg_replace('/[^A-Z0-9]/','',(string)($new['gst']??'')));$pan=strtoupper(preg_replace('/[^A-Z0-9]/','',(string)($new['pan']??'')));$cin=strtoupper(preg_replace('/[^A-Z0-9]/','',(string)($new['cin']??'')));$msme=strtoupper(trim((string)($new['msme']??'')));$tan=strtoupper(preg_replace('/[^A-Z0-9]/','',(string)($new['tan']??'')));$iec=strtoupper(preg_replace('/[^A-Z0-9]/','',(string)($new['iec']??'')));$ifsc=strtoupper(preg_replace('/[^A-Z0-9]/','',(string)($new['ifsc']??'')));$swift=strtoupper(preg_replace('/[^A-Z0-9]/','',(string)($new['swift']??'')));
      if($gst!==''&&!preg_match('/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/',$gst))return 'Vendor GSTIN is invalid.';
      if($pan!==''&&!preg_match('/^[A-Z]{5}[0-9]{4}[A-Z]$/',$pan))return 'Vendor PAN is invalid.';
      if($cin!==''&&!preg_match('/^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/',$cin))return 'Vendor CIN is invalid.';
      if($msme!==''&&!preg_match('/^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/',$msme))return 'Vendor MSME / UDYAM number is invalid.';
      if($tan!==''&&!preg_match('/^[A-Z]{4}[0-9]{5}[A-Z]$/',$tan))return 'Vendor TAN is invalid.';
      if($iec!==''&&!preg_match('/^[A-Z0-9]{10}$/',$iec))return 'Vendor IEC is invalid.';
      if($ifsc!==''&&!preg_match('/^[A-Z]{4}0[A-Z0-9]{6}$/',$ifsc))return 'Vendor IFSC code is invalid.';
      if($swift!==''&&!preg_match('/^[A-Z0-9]{8}([A-Z0-9]{3})?$/',$swift))return 'Vendor SWIFT / BIC code is invalid.';
      foreach(['office','factory'] as $addressType){$country=(string)($new[$addressType.'Country']??'');$postal=strtoupper(trim((string)($new[$addressType.'PostalCode']??'')));if(strcasecmp(trim($country),'India')===0){if(!preg_match('/^[0-9]{6}$/',$postal))return ucfirst($addressType).' Indian PIN code must contain exactly 6 digits.';}elseif(!preg_match('/^[A-Z0-9][A-Z0-9 -]{1,10}[A-Z0-9]$/',$postal))return ucfirst($addressType).' postal code is invalid.';}
      $account=preg_replace('/\s+/','',(string)$new['accountNumber']);
      if(!preg_match('/^[A-Z0-9]{6,34}$/i',$account))return 'Vendor bank account number is invalid.';
      foreach(['salesPerson','qualityPerson','logisticsPerson','accountsPerson'] as $contactType){$mobile=preg_replace('/[\s()\-]/','',(string)($new[$contactType.'Mobile']??''));$email=trim((string)($new[$contactType.'Email']??''));if($mobile!==''&&!preg_match('/^\+?[0-9]{10,15}$/',$mobile))return ucfirst($contactType).' mobile number is invalid.';if($email!==''&&!filter_var($email,FILTER_VALIDATE_EMAIL))return ucfirst($contactType).' email address is invalid.';}
      $prefix=$vendorType==='IMPORT'?'VI':'VD';
      $highest=1000;foreach(is_array($existing)?$existing:[] as $savedVendor){if(!is_array($savedVendor))continue;if($gst!==''&&strtoupper(preg_replace('/[^A-Z0-9]/','',(string)($savedVendor['gst']??'')))===$gst)return 'This GSTIN is already registered in Vendor Master.';if(preg_match('/^'.preg_quote($prefix,'/').'([0-9]+)$/i',(string)($savedVendor['vendorCode']??''),$match))$highest=max($highest,(int)$match[1]);}
      if(strtoupper((string)$new['vendorCode'])!==$prefix.($highest+1))return 'Vendor code is not the next available '.$vendorType.' sequence. Refresh Vendor Master and try again.';
      if(strcasecmp((string)($new['createdBy']??''),(string)($actor['username']??''))!==0)return 'Vendor creator does not match the signed-in user.';
    }
    if($key===ERP_PURCHASE_ORDERS_KEY){
      foreach(['id','poNumber','poDate','vendorId','createdBy'] as $field)if(trim((string)($new[$field]??''))==='')return 'Purchase Order is missing its number, date, vendor or creator.';
      if(strcasecmp((string)$new['createdBy'],(string)($actor['username']??''))!==0)return 'Purchase Order creator does not match the signed-in user.';
      $vendorGst=strtoupper(preg_replace('/[^A-Z0-9]/','',(string)($new['vendor']['gst']??'')));
      if(strlen($vendorGst)!==15)return 'Purchase Order vendor GSTIN is invalid.';
      $taxMode=substr($vendorGst,0,2)==='24'?'INTRA':'INTER';
      if(strtoupper((string)($new['taxMode']??''))!==$taxMode)return 'Purchase Order tax mode does not match the vendor GSTIN state code.';
      $items=is_array($new['items']??null)?$new['items']:[];if(!$items)return 'Purchase Order requires at least one item.';
      $subtotal=0.0;$taxTotal=0.0;$allowedRates=[5.0,12.0,18.0,28.0];$allowedUom=['NOS','KG','LTR','MTR','SQM','FEET','SET'];
      foreach($items as $item){if(!is_array($item)||trim((string)($item['description']??''))==='')return 'Every Purchase Order item requires a description.';$qty=is_numeric($item['qty']??null)?(float)$item['qty']:0.0;$rate=is_numeric($item['rate']??null)?(float)$item['rate']:-1.0;$gstRate=is_numeric($item['gstRate']??null)?(float)$item['gstRate']:0.0;$uom=strtoupper(trim((string)($item['uom']??'')));if($qty<=0||$rate<0||!in_array($gstRate,$allowedRates,true)||!in_array($uom,$allowedUom,true))return 'Purchase Order item quantity, UOM, rate or GST selection is invalid.';$taxable=$qty*$rate;$subtotal+=$taxable;$taxTotal+=$taxable*$gstRate/100;}
      $cgst=$taxMode==='INTRA'?$taxTotal/2:0.0;$sgst=$taxMode==='INTRA'?$taxTotal/2:0.0;$igst=$taxMode==='INTER'?$taxTotal:0.0;$rounded=round($subtotal+$taxTotal);$roundOff=$rounded-($subtotal+$taxTotal);$totals=is_array($new['totals']??null)?$new['totals']:[];
      foreach(['subtotal'=>$subtotal,'cgst'=>$cgst,'sgst'=>$sgst,'igst'=>$igst,'roundOff'=>$roundOff,'grandTotal'=>$rounded] as $field=>$expectedValue){$submittedValue=is_numeric($totals[$field]??null)?(float)$totals[$field]:0.0;if(abs($submittedValue-$expectedValue)>0.02)return 'Purchase Order totals do not reconcile with the selected item GST rates.';}
      if(strtoupper(trim((string)($new['status']??'DRAFT')))!=='DRAFT')return 'A new Purchase Order must be saved as Draft before it can be submitted for Administrator approval.';
      if(!empty($new['preparedSignature'])||!empty($new['approvedSignature']))return 'Purchase Order digital signatures can only be created by the protected approval workflow.';
      foreach(is_array($existing)?$existing:[] as $savedOrder)if(is_array($savedOrder)&&strcasecmp(trim((string)($savedOrder['poNumber']??'')),trim((string)$new['poNumber']))===0)return 'This Purchase Order number already exists.';
    }
    if($key==='DEMOSOLAR_VEHICLE_BOOKINGS_V1'){
      foreach(['coNumber','invoiceNumber','vehicleType','transporterName','bookedBy'] as $field)if(trim((string)($new[$field]??''))==='')return 'Vehicle booking is missing required C/O, invoice, transporter, vehicle type or operator details.';
      $freight=transaction_number($new['originalFreight']??0);$unloading=transaction_number($new['unloadingCharges']??0);$deduction=transaction_number($new['deductionAmount']??0);$gross=transaction_number($new['grossAmount']??0);$final=transaction_number($new['finalPayable']??0);
      if($freight<=0||$unloading<0||$deduction<0||abs($gross-($freight+$unloading))>0.01||$deduction>$gross||abs($final-($gross-$deduction))>0.01)return 'Vehicle booking freight calculation is invalid.';
      if(strcasecmp((string)($new['bookedBy']??''),(string)($actor['username']??''))!==0)return 'Vehicle booking operator does not match the signed-in user.';
    }
    if($key==='DEMOSOLAR_CUSTOMERS_MASTER_V1'){
      foreach(['name','person','phone','gst','pan','address','addressLine1','taluka','district','state','pincode'] as $field)if(trim((string)($new[$field]??''))==='')return 'Customer Master record is missing required customer, contact, GST, PAN or structured address details.';
      if(!preg_match('/^[0-9]{6}$/',(string)($new['pincode']??'')))return 'Customer Master pincode must contain exactly 6 digits.';
      $gst=strtoupper(preg_replace('/[^A-Z0-9]/','',(string)($new['gst']??'')));$pan=strtoupper(preg_replace('/[^A-Z0-9]/','',(string)($new['pan']??'')));
      if(strlen($gst)!==15||!preg_match('/^[A-Z]{5}[0-9]{4}[A-Z]$/',$pan)||substr($gst,2,10)!==$pan)return 'Customer PAN must match GSTIN characters 3 through 12.';
      if(strcasecmp((string)($new['createdBy']??''),(string)($actor['username']??''))!==0)return 'Customer Master creator does not match the signed-in user.';
    }
    if($key==='DEMOSOLAR_DELETION_REQUESTS_V1'){
      if(strtoupper((string)($new['status']??''))!=='PENDING'||strcasecmp((string)($new['requestedBy']??''),(string)($actor['username']??''))!==0)return 'Only a new Pending request in your own name may be submitted.';
    }
    if($key==='DEMOSOLAR_CO_ALLOCATIONS_V1')return 'PO-to-CO allocations can be created only by Administrator approval.';
    if($key==='DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7')return 'Dispatch records can be created only through the verified dispatch transaction.';
  }
  return null;
}
function public_user(array $user): array {
  unset($user['password'],$user['passwordHash'],$user['password_hash']);
  if(strtolower((string)($user['role']??''))==='admin'&&!admin($user)){
    $department=strtolower(trim((string)($user['department']??'')));
    $user['role']=str_contains($department,'management')?'management':(str_contains($department,'admin')?'administration':'department');
  }
  if(admin($user)){
    if(!is_array($user['rights']??null))$user['rights']=[];
    $user['rights']['requests']=true;$user['rights']['requestRoutes']=true;
  }
  return $user;
}
function all_users(mysqli $db): array {
  if(isset($GLOBALS['ERP_ALL_USERS_CACHE'])&&is_array($GLOBALS['ERP_ALL_USERS_CACHE']))return $GLOBALS['ERP_ALL_USERS_CACHE'];
  $data=read_value($db,ERP_USERS_KEY);
  $users=rr_hydrate_user_permissions($db,is_array($data)?$data:[]);
  $assignedIds=[];$routes=approval_routes_cached($db);
  foreach(is_array($routes)?$routes:[] as $route){
    if(!is_array($route)||strtoupper((string)($route['status']??'ACTIVE'))!=='ACTIVE')continue;
    foreach(['primaryApproverId','secondaryApproverId'] as $field){$id=trim((string)($route[$field]??''));if($id!=='')$assignedIds[$id]=true;}
  }
  foreach($users as &$user){
    if(!is_array($user)||!isset($assignedIds[(string)($user['id']??'')]))continue;
    if(!is_array($user['rights']??null))$user['rights']=[];
    $user['rights']['requests']=true;
    $user['rights']['requestRouteAssignee']=true;
  }
  unset($user);
  return $GLOBALS['ERP_ALL_USERS_CACHE']=$users;
}
function lookup_user(mysqli $db,$id): ?array { foreach(all_users($db) as $u) if(is_array($u)&&(string)($u['id']??'')===(string)$id)return $u; return null; }
function current_user(mysqli $db,array $cfg): ?array {
  if(empty($_SESSION['erp_user_id'])||empty($_SESSION['erp_started'])||empty($_SESSION['erp_seen']))return null;
  $now=time(); if($now-(int)$_SESSION['erp_seen']>(int)$cfg['session_idle_seconds']||$now-(int)$_SESSION['erp_started']>(int)$cfg['session_absolute_seconds']){$_SESSION=[];session_destroy();return null;}
  $routeVersions=module_state_versions($db,['DEMOSOLAR_REQUEST_ROUTES_V1']);
  $routeVersion=(string)($routeVersions['DEMOSOLAR_REQUEST_ROUTES_V1']??'__missing__');
  $cached=$_SESSION['erp_user_cache']??null;$cachedAt=(int)($_SESSION['erp_user_cache_at']??0);
  if(is_array($cached)&&$now-$cachedAt<10&&(string)($cached['id']??'')===(string)$_SESSION['erp_user_id']&&hash_equals((string)($_SESSION['erp_route_version']??''),$routeVersion))$user=$cached;
  else{$user=lookup_user($db,$_SESSION['erp_user_id']);if(!$user||strtoupper((string)($user['status']??''))!=='ACTIVE'||!it_validate_session($db,$user,$cfg)){$_SESSION=[];session_destroy();return null;}$_SESSION['erp_user_cache']=public_user($user);$_SESSION['erp_user_cache_at']=$now;$_SESSION['erp_route_version']=$routeVersion;}
  $_SESSION['erp_seen']=$now;
  $lastRotation=(int)($_SESSION['erp_rotated']??$_SESSION['erp_started']);if($now-$lastRotation>=900){it_rotate_session($db,$user,$cfg);$_SESSION['erp_rotated']=$now;}
  return $user;
}
function require_user(mysqli $db,array $cfg): array {
  $u=current_user($db,$cfg);
  if(!$u)respond(['status'=>'error','message'=>'Your secure session has expired. Please sign in again.'],401);
  // PHP otherwise holds this user's session lock until the response ends.
  // Releasing it lets the live-sync request stay concurrent and responsive.
  if(session_status()===PHP_SESSION_ACTIVE) session_write_close();
  return $u;
}
function admin(array $user): bool {
  $username=strtoupper(trim((string)($user['username']??'')));
  $department=strtoupper(trim((string)($user['department']??'')));
  return $username==='IT'&&($department==='IT'||$department==='IT DEPARTMENT'||$department==='INFORMATION TECHNOLOGY');
}
function vendor_approval_allowed(array $user): bool {
  return admin($user)||has_assigned_right($user,['purchaseVendorApprovals']);
}
function has_assigned_right(array $user,array $names): bool {
  $rights=$user['rights']??[];
  if(!is_array($rights))return false;
  foreach($names as $name){
    $value=$rights[$name]??false;
    if($value===true||$value===1||$value==='1'||$value==='true')return true;
  }
  return false;
}
function user_rights_configured(array $user): bool { return is_array($user['rights']??null); }
function feature_allowed(array $user,array $rights,array $legacyRoles=[]): bool {
  if(user_rights_configured($user))return has_assigned_right($user,$rights);
  return admin($user)||in_array(strtolower((string)($user['role']??'')),$legacyRoles,true);
}
function allowed(array $user,string $key,bool $write): bool {
  if($key==='DEMOSOLAR_NFC_CARDS_V1')return admin($user)||has_assigned_right($user,['nfcCards']);
  if($key==='DEMOSOLAR_REQUEST_ROUTES_V1')return admin($user);
  $role=strtolower((string)($user['role']??''));
  $department=strtolower((string)($user['department']??''));
  // Audit history is visible only when Logs was explicitly assigned in User
  // Rights. Audit-event creation remains available through its append-only API.
  if($key===ERP_LOGS_KEY&&!$write)return admin($user)||has_assigned_right($user,['logs']);
  $map=[
   'DEMOSOLAR_PRODUCTS_PALLET_FORMAT_V7'=>[['warehouse','store','packing','dispatch','sales'],[]],
   'DEMOSOLAR_POS_PALLET_FORMAT_V7'=>[['store','packing','dispatch'],['store']],
   'DEMOSOLAR_STORE_SERIALS_STORAGE_V1'=>[['store','packing'],['store']],
   'DEMOSOLAR_STOCK_PALLET_FORMAT_V7'=>[['warehouse','store','packing','dispatch'],['store','packing']],
   'DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7'=>[['warehouse','packing','dispatch'],['dispatch']],
   'DEMOSOLAR_STOCK_BOOKINGS_V1'=>[['warehouse','dispatch'],['dispatch']],
   'DEMOSOLAR_TRANSPORTERS_MASTER_V7'=>[['dispatch','accounts'],['dispatch','accounts']], 'DEMOSOLAR_DRIVERS_MASTER_V7'=>[['dispatch','accounts'],['dispatch']], 'DEMOSOLAR_ROUTE_FARES_V1'=>[['dispatch'],['dispatch']], 'DEMOSOLAR_VEHICLE_BOOKINGS_V1'=>[['dispatch'],['dispatch']],
   'DEMOSOLAR_PRODUCTION_SHEET_V1'=>[['production'],['production']], 'DEMOSOLAR_PRODUCTION_DAILY_V1'=>[['production'],['production']],
   'DEMOSOLAR_CO_ALLOCATIONS_V1'=>[['sales','dispatch'],[]],
   // Dispatch needs read-only Sales Orders to select a live CO in Packing List.
   // Sales remains the only department allowed to create or edit Sales Orders.
   'DEMOSOLAR_SALES_ORDERS_V1'=>[['sales','dispatch','accounts'],['sales']], 'DEMOSOLAR_ACCOUNT_INVOICES_V1'=>[['accounts','dispatch'],['accounts']], 'DEMOSOLAR_ACCOUNT_RECEIPTS_V1'=>[['accounts'],['accounts']], ERP_PURCHASE_VENDORS_KEY=>[['purchase','procurement'],['purchase','procurement']], ERP_PURCHASE_ORDERS_KEY=>[['purchase','procurement'],['purchase','procurement']], 'DEMOSOLAR_CUSTOMERS_MASTER_V1'=>[['sales','accounts'],['sales']], 'DEMOSOLAR_SALES_PEOPLE_V1'=>[['sales','accounts'],['sales']], 'DEMOSOLAR_SALES_CO_REGISTRY_V1'=>[['sales','dispatch'],['sales']],
    'DEMOSOLAR_DELETION_REQUESTS_V1'=>[['warehouse','store','packing','dispatch','sales','accounts'],['warehouse','store','packing','dispatch','sales','accounts']],
   'DEMOSOLAR_SYSTEM_LOGS_PALLET_FORMAT_V7'=>[['warehouse','store','packing','dispatch','sales','accounts'],['warehouse','store','packing','dispatch','sales','accounts']]
  ];
  // Rights are assigned by Admin and stored server-side with the user record.
  // Use them as an additional read-only check so a custom department user can
  // see the data for the menus explicitly granted in User Rights.
  $readRights=[
    'DEMOSOLAR_PRODUCTS_PALLET_FORMAT_V7'=>['products','productsView','productsAdd','productsEdit','productsDelete','warehouse','storePpc','packing','dispatch','salesOrders','salesOrderAllocation','salesOrderSerialTracking'],
    'DEMOSOLAR_POS_PALLET_FORMAT_V7'=>['storePpc','storeCreatePo','storeEditPo','storeDeletePo','packing','packingScan','dispatch','dispatchChallan','production','productionAddDetails','productionViewSheet','productionDailyUpdate','salesOrderAllocation','salesOrders','salesOrderSerialTracking'],
    'DEMOSOLAR_STORE_SERIALS_STORAGE_V1'=>['storePpc','storeUploadSerial','storeEditSerial','storeDeleteSerial','packing','packingScan','production','productionAddDetails','productionViewSheet','productionDailyUpdate','salesOrders','salesOrderSerialTracking'],
    'DEMOSOLAR_STOCK_PALLET_FORMAT_V7'=>['warehouse','storePpc','packing','packingScan','packingRework','packingEditPallet','packingDeletePallet','dispatch','dispatchChallan','dispatchBookedStock','dispatchViewList','production','productionAddDetails','productionViewSheet','productionDailyUpdate','salesOrders','salesOrderSerialTracking'],
    'DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7'=>['warehouse','packing','packingScan','packingRework','packingEditPallet','packingDeletePallet','dispatch','dispatchChallan','dispatchViewList','dispatchDelete','salesOrders','storeDeleteSerial','production','productionAddDetails','productionViewSheet','productionDailyUpdate'],
    'DEMOSOLAR_STOCK_BOOKINGS_V1'=>['warehouse','dispatch','dispatchBookedStock','dispatchChallan'],
    'DEMOSOLAR_TRANSPORTERS_MASTER_V7'=>['accounts','dispatch','dispatchChallan','transporterView','transporterAdd','transporterEdit','transporterDelete'],
    'DEMOSOLAR_DRIVERS_MASTER_V7'=>['accounts','dispatch','dispatchChallan','driverView','driverAdd','driverEdit','driverDelete'],
    'DEMOSOLAR_ROUTE_FARES_V1'=>['dispatch','dispatchRouteFare'],
    'DEMOSOLAR_VEHICLE_BOOKINGS_V1'=>['dispatch','dispatchBookVehicle'],
    'DEMOSOLAR_PRODUCTION_SHEET_V1'=>['production','productionAddDetails','productionEditSheet','productionDeleteSheet','productionViewSheet','productionDailyUpdate','packing','packingScan','storePpc','storeCreatePo','storeEditPo'],
    'DEMOSOLAR_PRODUCTION_DAILY_V1'=>['production','productionDailyUpdate','productionViewSheet'],
    'DEMOSOLAR_SALES_ORDERS_V1'=>['accounts','salesOrders','salesOrderDashboard','salesOrderAdd','salesOrderView','salesOrderAllocation','salesOrderEdit','salesOrderDelete','dispatch','dispatchChallan','production','productionAddDetails','productionViewSheet','productionDailyUpdate'],
    'DEMOSOLAR_ACCOUNT_INVOICES_V1'=>['accounts','accountsInvoiceLogistics','accountsEditInvoice','accountsDeleteInvoice','accountsReports','accountsOutstandingReceivable','accountsAdvanceFromCustomer','dispatch','dispatchChallan','salesOrders','salesOrderSerialTracking'],
    'DEMOSOLAR_ACCOUNT_RECEIPTS_V1'=>['accounts','accountsReceipt','accountsReports','accountsOutstandingReceivable','accountsAdvanceFromCustomer'],
    ERP_PURCHASE_VENDORS_KEY=>['purchase','purchaseVendorMaster','purchaseOrder'],
    ERP_PURCHASE_ORDERS_KEY=>['purchase','purchaseOrder','purchaseOrderView','purchaseOrderApprovals','purchaseOrderDelete'],
    'DEMOSOLAR_CUSTOMERS_MASTER_V1'=>['accounts','salesOrders','salesOrderAdd','salesOrderEdit','customerMaster'],
    'DEMOSOLAR_SALES_PEOPLE_V1'=>['accounts','accountsReceipt','salesOrders','salesOrderAdd','salesOrderEdit'],
    'DEMOSOLAR_SALES_CO_REGISTRY_V1'=>['salesOrders','salesOrderAdd','salesOrderEdit','dispatch','dispatchChallan'],
    'DEMOSOLAR_CO_ALLOCATIONS_V1'=>['salesOrders','salesOrderAllocation','dispatch','dispatchChallan','requestsApprove'],
    'DEMOSOLAR_DELETION_REQUESTS_V1'=>['requests','requestsTrack','requestsApprove','requestRouteAssignee','warehouse','storePpc','packing','dispatch','salesOrders','salesOrderEdit','salesOrderDelete','salesOrderAllocation','accounts','accountsEditInvoice','accountsDeleteInvoice','production','productionEditSheet','productionDeleteSheet'],
    'DEMOSOLAR_SYSTEM_LOGS_PALLET_FORMAT_V7'=>['accounts','logs','logsPacking','logsDispatch','logsSystem','salesOrderAllocation','production','productionAddDetails','productionViewSheet','productionDailyUpdate'],
    'DEMOSOLAR_DEPARTMENTS_MASTER_V1'=>['hr','departmentView','departmentAdd','departmentEdit','departmentDelete'],
    'DEMOSOLAR_DESIGNATIONS_MASTER_V1'=>['hr','designationView','designationAdd','designationEdit','designationDelete'],
    'DEMOSOLAR_REQUEST_ROUTES_V1'=>['requestRoutes']
  ];
  $writeRights=[
    ERP_USERS_KEY=>['users','adminUsers','adminAddUser','adminEditUser','adminDeleteUser','adminUserRights'],
    'DEMOSOLAR_PRODUCTS_PALLET_FORMAT_V7'=>['productsAdd','productsEdit','productsDelete'],
    'DEMOSOLAR_POS_PALLET_FORMAT_V7'=>['storeCreatePo','storeEditPo','storeDeletePo','packingClosePo'],
    'DEMOSOLAR_STORE_SERIALS_STORAGE_V1'=>['storeUploadSerial','storeEditSerial','storeDeleteSerial'],
    'DEMOSOLAR_STOCK_PALLET_FORMAT_V7'=>['packingScan','packingRework','packingEditPallet','packingDeletePallet','dispatchChallan','dispatchBookedStock','dispatchDelete'],
    'DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7'=>['dispatchChallan','dispatchDelete'],
    'DEMOSOLAR_STOCK_BOOKINGS_V1'=>['dispatchBookedStock'],
    'DEMOSOLAR_TRANSPORTERS_MASTER_V7'=>['accounts','transporterAdd','transporterEdit','transporterDelete'],
    'DEMOSOLAR_DRIVERS_MASTER_V7'=>['driverAdd','driverEdit','driverDelete'],
    'DEMOSOLAR_ROUTE_FARES_V1'=>['dispatchRouteFare'],
    'DEMOSOLAR_VEHICLE_BOOKINGS_V1'=>['dispatchBookVehicle'],
    'DEMOSOLAR_PRODUCTION_SHEET_V1'=>['productionAddDetails','productionEditSheet','packingScan','storeCreatePo','storeEditPo','requestsApprove'],
    'DEMOSOLAR_PRODUCTION_DAILY_V1'=>['productionDailyUpdate'],
    'DEMOSOLAR_SALES_ORDERS_V1'=>['salesOrderAdd','salesOrderEdit','salesOrderDelete'],
    'DEMOSOLAR_ACCOUNT_INVOICES_V1'=>['accounts','accountsInvoiceLogistics'],
    'DEMOSOLAR_ACCOUNT_RECEIPTS_V1'=>['accounts','accountsReceipt'],
    ERP_PURCHASE_VENDORS_KEY=>['purchase','purchaseVendorMaster'],
    ERP_PURCHASE_ORDERS_KEY=>['purchase','purchaseOrder','purchaseOrderDelete'],
    'DEMOSOLAR_CUSTOMERS_MASTER_V1'=>['customerMaster','salesOrderAdd','salesOrderEdit'],
    'DEMOSOLAR_SALES_PEOPLE_V1'=>['salesPersonMaster'],
    'DEMOSOLAR_SALES_CO_REGISTRY_V1'=>['salesOrderAdd','salesOrderEdit','salesOrderDelete'],
    'DEMOSOLAR_CO_ALLOCATIONS_V1'=>['requestsApprove'],
    'DEMOSOLAR_DELETION_REQUESTS_V1'=>['warehouse','storePpc','packing','dispatch','salesOrders','salesOrderEdit','salesOrderDelete','salesOrderAllocation','accounts','accountsEditInvoice','accountsDeleteInvoice','requestsTrack','requestsApprove','productionEditSheet','productionDeleteSheet'],
    'DEMOSOLAR_SYSTEM_LOGS_PALLET_FORMAT_V7'=>['accounts','accountsDeleteInvoice','warehouse','storePpc','packing','dispatch','salesOrders','salesOrderAllocation','requests','logsPacking','logsDispatch','logsSystem','productionAddDetails','productionEditSheet','productionDeleteSheet','productionDailyUpdate'],
    'DEMOSOLAR_DEPARTMENTS_MASTER_V1'=>['departmentAdd','departmentEdit','departmentDelete'],
    'DEMOSOLAR_DESIGNATIONS_MASTER_V1'=>['designationAdd','designationEdit','designationDelete'],
    'DEMOSOLAR_REQUEST_ROUTES_V1'=>['requestRoutes']
  ];
  // Once an Admin has assigned User Rights, those rights are the only
  // authority for this user's operational reads and writes. Department role
  // is retained solely for older users that do not yet have a rights record.
  if(user_rights_configured($user)){
    $rightsRecord=$user['rights'];
    $legacyAccountsDepartment=($role==='accounts'||preg_match('/\b(account|accounts|finance)\b/i',$department))&&!array_key_exists('accounts',$rightsRecord);
    if($legacyAccountsDepartment){
      $accountsRead=['DEMOSOLAR_ACCOUNT_INVOICES_V1','DEMOSOLAR_ACCOUNT_RECEIPTS_V1','DEMOSOLAR_CUSTOMERS_MASTER_V1','DEMOSOLAR_SALES_ORDERS_V1','DEMOSOLAR_SALES_PEOPLE_V1','DEMOSOLAR_TRANSPORTERS_MASTER_V7','DEMOSOLAR_DRIVERS_MASTER_V7','DEMOSOLAR_SYSTEM_LOGS_PALLET_FORMAT_V7'];
      $accountsWrite=['DEMOSOLAR_ACCOUNT_INVOICES_V1','DEMOSOLAR_ACCOUNT_RECEIPTS_V1','DEMOSOLAR_TRANSPORTERS_MASTER_V7','DEMOSOLAR_SYSTEM_LOGS_PALLET_FORMAT_V7'];
      if(in_array($key,$write?$accountsWrite:$accountsRead,true))return true;
    }
    if($key===ERP_USERS_KEY)return admin($user)&&has_assigned_right($user,$writeRights[ERP_USERS_KEY]);
    $rights=$write?($writeRights[$key]??[]):($readRights[$key]??[]);
    return has_assigned_right($user,$rights);
  }
  if(admin($user))return true;
  return isset($map[$key])&&in_array($role,$map[$key][$write?1:0],true);
}
function live_sync_keys(mysqli $db,array $user): array {
  // Central server-side module registry: every future department module must
  // be listed here and in allowed(). The client can request fewer keys, but it
  // can never use module_bundle/live_sync to exceed the signed-in user's rights.
  $keys=[
    ERP_USERS_KEY,
    'DEMOSOLAR_NFC_CARDS_V1',
    'DEMOSOLAR_PRODUCTS_PALLET_FORMAT_V7','DEMOSOLAR_POS_PALLET_FORMAT_V7','DEMOSOLAR_STOCK_PALLET_FORMAT_V7',
    'DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7','DEMOSOLAR_TRANSPORTERS_MASTER_V7','DEMOSOLAR_DRIVERS_MASTER_V7',
    'DEMOSOLAR_STORE_SERIALS_STORAGE_V1','DEMOSOLAR_SYSTEM_LOGS_PALLET_FORMAT_V7','DEMOSOLAR_DELETION_REQUESTS_V1','DEMOSOLAR_REQUEST_ROUTES_V1',
    'DEMOSOLAR_STOCK_BOOKINGS_V1','DEMOSOLAR_SALES_ORDERS_V1','DEMOSOLAR_ACCOUNT_INVOICES_V1','DEMOSOLAR_ACCOUNT_RECEIPTS_V1','DEMOSOLAR_CUSTOMERS_MASTER_V1','DEMOSOLAR_SALES_PEOPLE_V1',
    'DEMOSOLAR_SALES_CO_REGISTRY_V1','DEMOSOLAR_DEPARTMENTS_MASTER_V1','DEMOSOLAR_DESIGNATIONS_MASTER_V1','DEMOSOLAR_ROUTE_FARES_V1','DEMOSOLAR_VEHICLE_BOOKINGS_V1',ERP_PURCHASE_VENDORS_KEY,ERP_PURCHASE_ORDERS_KEY,
    'DEMOSOLAR_CO_ALLOCATIONS_V1',
    'DEMOSOLAR_PRODUCTION_SHEET_V1','DEMOSOLAR_PRODUCTION_DAILY_V1'
  ];
  $allowedKeys=array_values(array_filter($keys, fn($key) => $key===ERP_USERS_KEY || allowed($user,$key,false)));
  if(!admin($user)&&has_assigned_right($user,['requestsApprove','requestRouteAssignee'])){
    $requests=read_value($db,'DEMOSOLAR_DELETION_REQUESTS_V1');
    foreach(is_array($requests)?$requests:[] as $request){
      if(!is_array($request)||!actor_can_approve_department_request($db,$user,$request))continue;
      foreach(approval_request_allowed_keys((string)($request['type']??'')) as $approvalKey)if(in_array($approvalKey,$keys,true))$allowedKeys[]=$approvalKey;
    }
  }
  return array_values(array_unique($allowedKeys));
}
function request_route_bootstrap(mysqli $db,array $user): array {
  if(!admin($user))return [];
  $keys=[ERP_USERS_KEY,'DEMOSOLAR_REQUEST_ROUTES_V1','DEMOSOLAR_DEPARTMENTS_MASTER_V1','DEMOSOLAR_DESIGNATIONS_MASTER_V1'];
  return [
    'modules'=>[
      ERP_USERS_KEY=>array_map(fn($record)=>is_array($record)?public_user($record):$record,all_users($db)),
      'DEMOSOLAR_REQUEST_ROUTES_V1'=>read_value($db,'DEMOSOLAR_REQUEST_ROUTES_V1'),
      'DEMOSOLAR_DEPARTMENTS_MASTER_V1'=>read_value($db,'DEMOSOLAR_DEPARTMENTS_MASTER_V1'),
      'DEMOSOLAR_DESIGNATIONS_MASTER_V1'=>read_value($db,'DEMOSOLAR_DESIGNATIONS_MASTER_V1')
    ],
    'versions'=>storage_versions($db,$keys)
  ];
}
function storage_versions(mysqli $db,array $keys): array {
  return module_state_versions($db,$keys);
}
function secure_users_for_save(mysqli $db,array $submitted): array {
  $prior=[];foreach(all_users($db) as $u)$prior[(string)($u['id']??'')]=$u; $safe=[];
  foreach($submitted as $u){if(!is_array($u))continue;$old=$prior[(string)($u['id']??'')]??[];$level=strtoupper(trim((string)($u['employeeLevel']??'')));$level=preg_replace('/^LEVEL\s+/','',$level)??'';
   if(!in_array($level,['A','B','C'],true)){
    $oldLevel=strtoupper(trim((string)($old['employeeLevel']??'')));
    if(in_array($oldLevel,['A','B','C'],true)){$u['employeeLevel']=$oldLevel;$u['employeeLevelSource']=in_array(strtoupper((string)($old['employeeLevelSource']??'')),['AUTO','MANUAL'],true)?strtoupper((string)$old['employeeLevelSource']):'MANUAL';}
    elseif(!$old)throw new InvalidArgumentException('Every new user must have one employee level: A, B, or C.');
    else{unset($u['employeeLevel'],$u['employeeLevelSource']);}
   }else{$u['employeeLevel']=$level;$u['employeeLevelSource']=strtoupper((string)($u['employeeLevelSource']??''))==='AUTO'?'AUTO':'MANUAL';}
   $plain=(string)($u['password']??'');unset($u['password'],$u['passwordHash'],$u['password_hash']);
   if($plain!=='')$u['passwordHash']=password_hash($plain,PASSWORD_DEFAULT); elseif(!empty($old['passwordHash']))$u['passwordHash']=$old['passwordHash']; elseif(!empty($old['password_hash']))$u['passwordHash']=$old['password_hash']; elseif(!empty($old['password']))$u['passwordHash']=password_hash((string)$old['password'],PASSWORD_DEFAULT); $safe[]=$u; }
  return $safe;
}
function log_user_permission_changes(mysqli $db,array $beforeUsers,array $afterUsers,array $actor): void {
  $before=[];foreach($beforeUsers as $row)if(is_array($row))$before[(string)($row['id']??'')]=$row;
  $stmt=$db->prepare('INSERT INTO erp_permission_change_log(target_user_legacy_id,target_username,changed_by,before_json,after_json) VALUES(?,?,?,?,?)');
  if(!$stmt)return;
  $changedBy=(string)($actor['username']??'SYSTEM');
  foreach($afterUsers as $row){
    if(!is_array($row))continue;$id=(string)($row['id']??'');if($id==='')continue;
    $oldRights=is_array($before[$id]['rights']??null)?$before[$id]['rights']:[];$newRights=is_array($row['rights']??null)?$row['rights']:[];
    ksort($oldRights);ksort($newRights);if($oldRights===$newRights)continue;
    $username=(string)($row['username']??'');$beforeJson=json_encode($oldRights,JSON_UNESCAPED_SLASHES)?:'{}';$afterJson=json_encode($newRights,JSON_UNESCAPED_SLASHES)?:'{}';
    $stmt->bind_param('sssss',$id,$username,$changedBy,$beforeJson,$afterJson);$stmt->execute();
  }
  $stmt->close();
}
function upload_photos(array $data): array {
 $invoice=preg_replace('/[^A-Za-z0-9_-]/','_',trim((string)($data['invoice']??'')));if(!$invoice)$invoice='MANUAL_'.time();$dir=erp_persistent_storage_path('photos/'.$invoice).DIRECTORY_SEPARATOR;if(!is_dir($dir)&&!mkdir($dir,0775,true))respond(['status'=>'ERROR','message'=>'Could not create the upload folder.'],500);$saved=[];
 foreach(($data['images']??[]) as $i=>$image){if(!is_string($image)||!preg_match('/^data:image\/(jpeg|png|webp);base64,/',$image,$m))continue;$binary=base64_decode(substr($image,strpos($image,',')+1),true);if($binary===false||strlen($binary)>10*1024*1024)continue;$ext=$m[1]==='jpeg'?'jpg':$m[1];$name='photo_'.($i+1).'_'.bin2hex(random_bytes(8)).'.'.$ext;if(file_put_contents($dir.$name,$binary,LOCK_EX)!==false)$saved[]='photos/'.$invoice.'/'.$name;}
 return ['folder'=>'photos/'.$invoice,'saved'=>$saved];
}

function vendor_portal_applications(mysqli $db): array {
  vendor_portal_ensure_schema($db);
  $result=$db->query("SELECT id,application_number,vendor_type,vendor_name,status,review_notes,vendor_code,submitted_at,updated_at,reviewed_at,reviewed_by,payload_json FROM erp_vendor_applications ORDER BY FIELD(status,'SUBMITTED','UNDER_REVIEW','CORRECTION_REQUIRED','APPROVED','REJECTED'),submitted_at DESC,id DESC");
  if(!$result)throw new RuntimeException('Vendor applications could not be loaded.');
  $applications=[];$byId=[];
  while($row=$result->fetch_assoc()){
    $data=json_decode((string)$row['payload_json'],true);if(!is_array($data))$data=[];
    unset($row['payload_json']);$row['id']=(int)$row['id'];$row['data']=$data;$row['documents']=[];$row['history']=[];
    $byId[$row['id']]=count($applications);$applications[]=$row;
  }
  if(!$applications)return [];
  $documents=$db->query('SELECT id,application_id,category,original_name,storage_path,mime_type,file_size,uploaded_at FROM erp_vendor_application_documents ORDER BY application_id,id');
  if($documents)while($document=$documents->fetch_assoc()){$applicationId=(int)$document['application_id'];if(!isset($byId[$applicationId]))continue;$document['id']=(int)$document['id'];$document['file_size']=(int)$document['file_size'];unset($document['storage_path']);$applications[$byId[$applicationId]]['documents'][]=$document;}
  $history=$db->query('SELECT application_id,action_code,notes,actor,action_at FROM erp_vendor_application_history ORDER BY application_id,action_at,id');
  if($history)while($event=$history->fetch_assoc()){$applicationId=(int)$event['application_id'];if(isset($byId[$applicationId]))$applications[$byId[$applicationId]]['history'][]=$event;}
  return $applications;
}

function vendor_portal_decide(mysqli $db,array $actor,array $input): array {
  vendor_portal_ensure_schema($db);
  $applicationId=(int)($input['applicationId']??0);$decision=strtoupper(trim((string)($input['decision']??'')));$notes=vendor_portal_text($input['notes']??'',2000);
  if($applicationId<=0||!in_array($decision,['APPROVE','REJECT'],true))throw new InvalidArgumentException('Select a valid vendor application decision.');
  if($decision==='REJECT'&&$notes==='')throw new InvalidArgumentException('Enter the rejection reason.');
  $moved=[];$db->begin_transaction();
  try{
    $statement=$db->prepare('SELECT * FROM erp_vendor_applications WHERE id=? FOR UPDATE');if(!$statement)throw new RuntimeException('Vendor application is unavailable.');$statement->bind_param('i',$applicationId);$statement->execute();$application=$statement->get_result()->fetch_assoc();$statement->close();
    if(!$application)throw new InvalidArgumentException('Vendor application was not found.');
    if(!in_array(strtoupper((string)$application['status']),['SUBMITTED','UNDER_REVIEW'],true))throw new InvalidArgumentException('This vendor application has already received a final decision.');
    $username=(string)($actor['username']??'SYSTEM');
    if($decision==='REJECT'){
      $status='REJECTED';$update=$db->prepare('UPDATE erp_vendor_applications SET status=?,review_notes=?,reviewed_at=NOW(),reviewed_by=? WHERE id=?');if(!$update)throw new RuntimeException('Vendor decision could not be saved.');$update->bind_param('sssi',$status,$notes,$username,$applicationId);if(!$update->execute())throw new RuntimeException('Vendor decision could not be saved.');$update->close();
      $history=$db->prepare("INSERT INTO erp_vendor_application_history(application_id,action_code,notes,actor) VALUES(?,'REJECTED',?,?)");if(!$history)throw new RuntimeException('Vendor history could not be saved.');$history->bind_param('iss',$applicationId,$notes,$username);$history->execute();$history->close();
      append_audit_event($db,$actor,'PURCHASE','VENDOR_APPLICATION_REJECTED','Rejected vendor application '.(string)$application['application_number'].'.');
      $db->commit();return ['applicationNumber'=>(string)$application['application_number'],'status'=>'REJECTED'];
    }

    $data=json_decode((string)$application['payload_json'],true);if(!is_array($data))throw new RuntimeException('Vendor application data is invalid.');$data=vendor_portal_validate($data);
    // Lock the module-state row so two approvals can never allocate the same code.
    $empty='[]';$seed=$db->prepare('INSERT IGNORE INTO erp_module_state(module_key,payload_json,revision) VALUES(?,?,1)');if(!$seed)throw new RuntimeException('Vendor Master sequence lock is unavailable.');$moduleKey=ERP_PURCHASE_VENDORS_KEY;$seed->bind_param('ss',$moduleKey,$empty);$seed->execute();$seed->close();
    locked_storage_version($db,ERP_PURCHASE_VENDORS_KEY);
    $existing=read_value_for_update($db,ERP_PURCHASE_VENDORS_KEY);if(!is_array($existing))$existing=[];
    foreach($existing as $vendor){if(!is_array($vendor))continue;if($data['gst']!==''&&strtoupper((string)($vendor['gst']??''))===$data['gst'])throw new InvalidArgumentException('This GSTIN is already registered in Vendor Master.');if($data['pan']!==''&&strtoupper((string)($vendor['pan']??''))===$data['pan'])throw new InvalidArgumentException('This PAN is already registered in Vendor Master.');if($data['iec']!==''&&strtoupper((string)($vendor['iec']??''))===$data['iec'])throw new InvalidArgumentException('This IEC is already registered in Vendor Master.');if($data['accountNumber']!==''&&preg_replace('/\s+/','',(string)($vendor['accountNumber']??''))===$data['accountNumber'])throw new InvalidArgumentException('This bank account is already registered in Vendor Master.');}
    $prefix=$data['vendorType']==='IMPORT'?'VI':'VD';$highest=1000;
    foreach($existing as $vendor){if(!is_array($vendor))continue;if(preg_match('/^'.preg_quote($prefix,'/').'([0-9]+)$/i',(string)($vendor['vendorCode']??''),$match))$highest=max($highest,(int)$match[1]);}
    $vendorCode=$prefix.($highest+1);$now=date(DATE_ATOM);

    $documentResult=$db->query('SELECT id,category,original_name,storage_path,mime_type,file_size,uploaded_at FROM erp_vendor_application_documents WHERE application_id='.(int)$applicationId.' FOR UPDATE');
    if(!$documentResult)throw new RuntimeException('Vendor application documents are unavailable.');$documents=[];
    while($document=$documentResult->fetch_assoc()){
      $category=strtoupper((string)$document['category']);$source=erp_existing_storage_path((string)$document['storage_path']);$destinationDirectory=erp_persistent_storage_path('vendor_documents/'.$vendorCode.'/'.$category).DIRECTORY_SEPARATOR;
      if(!is_file($source))throw new RuntimeException('A pending vendor document is missing.');if(!is_dir($destinationDirectory)&&!mkdir($destinationDirectory,0775,true))throw new RuntimeException('The approved vendor document folder could not be created.');
      $destination=$destinationDirectory.basename($source);if(!rename($source,$destination))throw new RuntimeException('A vendor document could not be moved into Vendor Master.');$moved[]=[$source,$destination];
      $relative='vendor_documents/'.$vendorCode.'/'.$category.'/'.basename($source);$documentUpdate=$db->prepare('UPDATE erp_vendor_application_documents SET storage_path=? WHERE id=?');if(!$documentUpdate)throw new RuntimeException('Vendor document path could not be updated.');$documentId=(int)$document['id'];$documentUpdate->bind_param('si',$relative,$documentId);$documentUpdate->execute();$documentUpdate->close();
      $documents[]=['category'=>$category,'path'=>$relative,'originalName'=>(string)$document['original_name'],'size'=>(int)$document['file_size'],'mime'=>(string)$document['mime_type'],'uploadedAt'=>(string)$document['uploaded_at'],'uploadedBy'=>'PUBLIC VENDOR PORTAL'];
      rr_register_attachments($db,'PURCHASE_VENDOR',$vendorCode,[$relative],$category,$username);
    }
    $record=$data+[
      'id'=>'VENDOR-PORTAL-'.$applicationId,'vendorCode'=>$vendorCode,'documents'=>$documents,'status'=>'ACTIVE','createdAt'=>$now,'createdBy'=>$username,
      'sourceApplicationNumber'=>(string)$application['application_number']
    ];
    $record['email']=$data['salesPersonEmail'];$record['contactPerson']=$data['salesPersonName'];$record['contactNumber']=$data['salesPersonMobile'];
    $record['addressLine1']=$data['factoryAddressLine1'];$record['addressLine2']=$data['factoryAddressLine2'];$record['country']=$data['factoryCountry'];$record['state']=$data['factoryState'];$record['city']=$data['factoryCity'];$record['pincode']=$data['factoryPostalCode'];
    $updated=$existing;array_unshift($updated,$record);$validationActor=$actor;$validationActor['role']='purchase';$validation=non_admin_write_error($db,$validationActor,ERP_PURCHASE_VENDORS_KEY,$updated);if($validation!==null)throw new InvalidArgumentException($validation);
    if(!write_value_in_transaction($db,ERP_PURCHASE_VENDORS_KEY,$updated,true))throw new RuntimeException('Vendor Master could not be updated.');
    $status='APPROVED';$update=$db->prepare('UPDATE erp_vendor_applications SET status=?,review_notes=?,vendor_code=?,reviewed_at=NOW(),reviewed_by=? WHERE id=?');if(!$update)throw new RuntimeException('Vendor approval could not be saved.');$update->bind_param('ssssi',$status,$notes,$vendorCode,$username,$applicationId);if(!$update->execute())throw new RuntimeException('Vendor approval could not be saved.');$update->close();
    $history=$db->prepare("INSERT INTO erp_vendor_application_history(application_id,action_code,notes,actor) VALUES(?,'APPROVED',?,?)");if(!$history)throw new RuntimeException('Vendor approval history could not be saved.');$history->bind_param('iss',$applicationId,$notes,$username);$history->execute();$history->close();
    append_audit_event($db,$actor,'PURCHASE','VENDOR_APPLICATION_APPROVED','Approved vendor application '.(string)$application['application_number'].' as '.$vendorCode.'.');
    $db->commit();return ['applicationNumber'=>(string)$application['application_number'],'status'=>'APPROVED','vendorCode'=>$vendorCode];
  }catch(Throwable $error){$db->rollback();foreach(array_reverse($moved) as [$source,$destination])if(is_file($destination)){if(!is_dir(dirname($source)))@mkdir(dirname($source),0775,true);@rename($destination,$source);}throw $error;}
}

$action=(string)($_GET['action']??'');$key=(string)($_GET['key']??'');$method=$_SERVER['REQUEST_METHOD']??'GET';if($method==='OPTIONS')respond(['status'=>'ok']);
if($method==='POST'){
  if(!erp_same_origin_request())respond(['status'=>'error','message'=>'Cross-site ERP requests are not allowed.'],403);
  if($action!=='login'){
    $provided=(string)($_SERVER['HTTP_X_ERP_CSRF_TOKEN']??'');
    if($provided===''||!hash_equals((string)$_SESSION['erp_csrf'],$provided))respond(['status'=>'error','message'=>'Your secure form token expired. Refresh the ERP page and try again.'],403);
  }
}
if($action==='session'&&$method==='GET'){ $u=current_user($conn,$config);$bootstrap=$u?request_route_bootstrap($conn,$u):[];respond(['status'=>'success','authenticated'=>(bool)$u,'user'=>$u?public_user($u):null,'requestRouteBootstrap'=>$bootstrap?:null]); }
if($action==='login'&&$method==='POST'){
 $data=json_body();$name=trim((string)($data['username']??''));$pass=(string)($data['password']??'');$now=time();
 $users=all_users($conn);$index=null;foreach($users as $i=>$u)if(is_array($u)&&strcasecmp((string)($u['username']??''),$name)===0){$index=$i;break;}$user=$index===null?null:$users[$index];
 // The reserved IT super-administrator must remain available for emergency
 // recovery even when this browser session has reached the normal failure
 // threshold. The bypass depends on the server-side username + IT department
 // identity check in admin(); merely typing "IT" is not sufficient.
 $reservedItSuperAdmin=$user!==null&&admin($user);
 $limit=$_SESSION['login_attempts']??['count'=>0,'at'=>$now];if($now-(int)$limit['at']>900)$limit=['count'=>0,'at'=>$now];if(!$reservedItSuperAdmin&&(int)$limit['count']>=5){try{append_security_audit_event($conn,['username'=>$name?:'UNKNOWN'],'LOGIN_RATE_LIMITED','Blocked sign-in attempt for username '.transaction_text($name?:'UNKNOWN',100).' after too many failures. No password or secret was recorded.');}catch(Throwable $auditError){error_log('Login rate-limit audit failed: '.$auditError->getMessage());}respond(['status'=>'error','message'=>'Too many sign-in attempts. Try again in 15 minutes.'],429);}
 $hash=$user['passwordHash']??$user['password_hash']??'';$valid=$user&&((is_string($hash)&&$hash!==''&&password_verify($pass,$hash))||(!empty($user['password'])&&hash_equals((string)$user['password'],$pass)));
 if(!$valid||strtoupper((string)($user['status']??''))!=='ACTIVE'){if(!$reservedItSuperAdmin)$_SESSION['login_attempts']=['count'=>(int)$limit['count']+1,'at'=>$limit['at']];try{append_security_audit_event($conn,['username'=>$name?:'UNKNOWN'],'LOGIN_FAILED','Failed sign-in attempt for username '.transaction_text($name?:'UNKNOWN',100).'. No password or secret was recorded.');}catch(Throwable $auditError){error_log('Login failure audit failed: '.$auditError->getMessage());}usleep(350000);respond(['status'=>'error','message'=>'Invalid username or password.'],401);}
 if($hash===''&&!empty($user['password'])){$users[$index]['passwordHash']=password_hash($pass,PASSWORD_DEFAULT);unset($users[$index]['password']);write_value($conn,ERP_USERS_KEY,$users);$user=$users[$index];}
 session_regenerate_id(true);$_SESSION['erp_user_id']=$user['id'];$_SESSION['erp_username']=(string)($user['username']??$name);$_SESSION['erp_role']=strtolower((string)($user['role']??''));$_SESSION['erp_department']=(string)($user['department']??'');$_SESSION['erp_started']=$now;$_SESSION['erp_seen']=$now;$_SESSION['erp_rotated']=$now;$_SESSION['erp_csrf']=bin2hex(random_bytes(32));header('X-ERP-CSRF-Token: '.$_SESSION['erp_csrf']);unset($_SESSION['login_attempts']);
 // Database migrations run on the first authenticated module request. Keeping
 // them out of this response makes successful authentication consistently fast.
 it_register_session($conn,$user,$config);$publicUser=public_user($user);
 if(session_status()===PHP_SESSION_ACTIVE)session_write_close();
 $routeBootstrap=request_route_bootstrap($conn,$user);
 try{append_security_audit_event($conn,$user,'LOGIN_SUCCESS','User signed in successfully.');}catch(Throwable $auditError){error_log('Login audit failed: '.$auditError->getMessage());}respond(['status'=>'success','user'=>$publicUser,'requestRouteBootstrap'=>$routeBootstrap?:null]);
}
if($action==='logout'&&$method==='POST'){$logoutUsername=transaction_text($_SESSION['erp_username']??'SELF',100)?:'SELF';$logoutActor=['username'=>$logoutUsername,'role'=>(string)($_SESSION['erp_role']??''),'department'=>(string)($_SESSION['erp_department']??'')];if(!empty($_SESSION['erp_user_id']))it_revoke_current_session($conn,$logoutUsername);$_SESSION=[];session_destroy();try{append_security_audit_event($conn,$logoutActor,'LOGOUT','User signed out.');}catch(Throwable $auditError){error_log('Logout audit failed: '.$auditError->getMessage());}respond(['status'=>'success']);}
if($action==='public_nfc_photo'&&$method==='GET'){
  $cardId=strtoupper(trim((string)($_GET['id']??'')));
  if(!preg_match('/^SB[A-HJ-NP-Z2-9]{8}$/',$cardId))respond(['status'=>'error','message'=>'Employee photo not found.'],404);
  $cards=read_value($conn,'DEMOSOLAR_NFC_CARDS_V1');$approved=false;
  foreach(is_array($cards)?$cards:[] as $card)if(is_array($card)&&strtoupper((string)($card['id']??''))===$cardId&&($card['publicApproved']??false)===true){$approved=true;break;}
  if(!$approved)respond(['status'=>'error','message'=>'Employee photo not found.'],404);
  $extensions=['jpg'=>'image/jpeg','png'=>'image/png','webp'=>'image/webp'];$photoPath='';$photoType='';
  foreach($extensions as $extension=>$mime){$candidate=erp_persistent_storage_path('nfc_card_photos/'.$cardId.'.'.$extension);if(is_file($candidate)){$photoPath=$candidate;$photoType=$mime;break;}}
  if($photoPath===''||!is_readable($photoPath))respond(['status'=>'error','message'=>'Employee photo not found.'],404);
  header_remove('Content-Type');header('Content-Type: '.$photoType);header('Content-Length: '.(string)filesize($photoPath));header('Cache-Control: public, max-age=3600');header('X-Content-Type-Options: nosniff');readfile($photoPath);exit;
}
if($action==='public_nfc_brochure'&&$method==='GET'){
  $cardId=strtoupper(trim((string)($_GET['id']??'')));
  if(!preg_match('/^SB[A-HJ-NP-Z2-9]{8}$/',$cardId))respond(['status'=>'error','message'=>'Company brochure not found.'],404);
  $cards=read_value($conn,'DEMOSOLAR_NFC_CARDS_V1');$approved=false;
  foreach(is_array($cards)?$cards:[] as $card)if(is_array($card)&&strtoupper((string)($card['id']??''))===$cardId&&($card['publicApproved']??false)===true){$approved=true;break;}
  if(!$approved)respond(['status'=>'error','message'=>'Company brochure not found.'],404);
  $brochurePath=erp_persistent_storage_path('nfc_card_brochures/'.$cardId.'.pdf');
  if(!is_file($brochurePath)||!is_readable($brochurePath))respond(['status'=>'error','message'=>'Company brochure not found.'],404);
  header_remove('Content-Type');header('Content-Type: application/pdf');header('Content-Length: '.(string)filesize($brochurePath));header('Content-Disposition: inline; filename="demosolar-brochure-'.$cardId.'.pdf"');header('Cache-Control: public, max-age=3600');header('X-Content-Type-Options: nosniff');readfile($brochurePath);exit;
}
if($action==='public_nfc_card'&&$method==='GET'){
  $cardId=strtoupper(trim((string)($_GET['id']??'')));
  if(!preg_match('/^SB[A-HJ-NP-Z2-9]{8}$/',$cardId))respond(['status'=>'error','message'=>'Employee card not found.'],404);
  $cards=read_value($conn,'DEMOSOLAR_NFC_CARDS_V1');
  foreach(is_array($cards)?$cards:[] as $card){
    if(!is_array($card)||strtoupper((string)($card['id']??''))!==$cardId||($card['publicApproved']??false)!==true)continue;
    $public=[];
    foreach(['id','fullName','jobTitle','department','phone','whatsapp','email','officeAddress','linkedin','instagram','website','googleMaps','photoUrl','brochureUrl'] as $field)$public[$field]=substr((string)($card[$field]??''),0,2000);
    $public['publicApproved']=true;
    respond(['status'=>'success','card'=>$public]);
  }
  respond(['status'=>'error','message'=>'Employee card not found.'],404);
}
$actor=require_user($conn,$config);
if(admin($actor)){try{rr_bootstrap_database($conn);it_management_bootstrap($conn);}catch(Throwable $bootstrapError){error_log('Authenticated relational bootstrap failed: '.$bootstrapError->getMessage());respond(['status'=>'error','message'=>'Database upgrade could not be completed. Contact IT before continuing.'],503);}}
if(str_starts_with($action,'saved_document')){
  try{saved_documents_handle($conn,$actor,$action,$method);}
  catch(Throwable $error){error_log('Saved Documents request failed: '.$error->getMessage());respond(['status'=>'error','message'=>'Saved Documents could not complete this request.'],500);}
}
if($action==='notifications'){
  try{erp_notifications_handle($conn,$actor,$method);}
  catch(Throwable $error){error_log('Notification request failed: '.$error->getMessage());respond(['status'=>'error','message'=>'Notifications are temporarily unavailable.'],500);}
}
if($action==='upload_nfc_photo'&&$method==='POST'){
  if(!allowed($actor,'DEMOSOLAR_NFC_CARDS_V1',true))respond(['status'=>'error','message'=>'Your User Rights do not allow NFC card photo uploads.'],403);
  $cardId=strtoupper(trim((string)($_POST['cardId']??'')));
  if(!preg_match('/^SB[A-HJ-NP-Z2-9]{8}$/',$cardId))respond(['status'=>'error','message'=>'The employee card ID is invalid.'],400);
  if(!isset($_FILES['photo'])||!is_array($_FILES['photo']))respond(['status'=>'error','message'=>'Choose an employee photo to upload.'],400);
  $file=$_FILES['photo'];$error=(int)($file['error']??UPLOAD_ERR_NO_FILE);$size=(int)($file['size']??0);$temporary=(string)($file['tmp_name']??'');
  if($error!==UPLOAD_ERR_OK||$size<=0||$size>5*1024*1024||!is_uploaded_file($temporary))respond(['status'=>'error','message'=>'The photo upload failed or exceeds the 5 MB limit.'],400);
  $mime=(new finfo(FILEINFO_MIME_TYPE))->file($temporary)?:'';$extensions=['image/jpeg'=>'jpg','image/png'=>'png','image/webp'=>'webp'];
  if(!isset($extensions[$mime]))respond(['status'=>'error','message'=>'Choose a JPG, PNG, or WebP image.'],415);
  $directory=erp_persistent_storage_path('nfc_card_photos');
  if(!is_dir($directory)&&!mkdir($directory,0750,true)&&!is_dir($directory))respond(['status'=>'error','message'=>'The employee photo folder could not be created.'],500);
  $destination=$directory.DIRECTORY_SEPARATOR.$cardId.'.'.$extensions[$mime];
  if(!move_uploaded_file($temporary,$destination))respond(['status'=>'error','message'=>'The employee photo could not be saved.'],500);
  foreach(['jpg','png','webp'] as $extension)if($extension!==$extensions[$mime]){$old=$directory.DIRECTORY_SEPARATOR.$cardId.'.'.$extension;if(is_file($old))@unlink($old);}
  try{append_audit_event($conn,$actor,'SYSTEM','NFC_PHOTO_UPLOADED','Uploaded a photo for NFC card '.$cardId.'.');}catch(Throwable $auditError){error_log('NFC photo upload audit failed: '.$auditError->getMessage());}
  respond(['status'=>'success','photoUrl'=>'backend/api.php?action=public_nfc_photo&id='.$cardId]);
}
if($action==='upload_nfc_brochure'&&$method==='POST'){
  if(!allowed($actor,'DEMOSOLAR_NFC_CARDS_V1',true))respond(['status'=>'error','message'=>'Your User Rights do not allow NFC card brochure uploads.'],403);
  $cardId=strtoupper(trim((string)($_POST['cardId']??'')));
  if(!preg_match('/^SB[A-HJ-NP-Z2-9]{8}$/',$cardId))respond(['status'=>'error','message'=>'The employee card ID is invalid.'],400);
  if(!isset($_FILES['brochure'])||!is_array($_FILES['brochure']))respond(['status'=>'error','message'=>'Choose a company brochure PDF to upload.'],400);
  $file=$_FILES['brochure'];$error=(int)($file['error']??UPLOAD_ERR_NO_FILE);$size=(int)($file['size']??0);$temporary=(string)($file['tmp_name']??'');
  if($error!==UPLOAD_ERR_OK||$size<=0||$size>15*1024*1024||!is_uploaded_file($temporary))respond(['status'=>'error','message'=>'The brochure upload failed or exceeds the 15 MB limit.'],400);
  $mime=(new finfo(FILEINFO_MIME_TYPE))->file($temporary)?:'';$signature=(string)file_get_contents($temporary,false,null,0,5);
  if($mime!=='application/pdf'||$signature!=='%PDF-')respond(['status'=>'error','message'=>'Choose a valid PDF company brochure.'],415);
  $directory=erp_persistent_storage_path('nfc_card_brochures');
  if(!is_dir($directory)&&!mkdir($directory,0750,true)&&!is_dir($directory))respond(['status'=>'error','message'=>'The brochure folder could not be created.'],500);
  $destination=$directory.DIRECTORY_SEPARATOR.$cardId.'.pdf';
  if(!move_uploaded_file($temporary,$destination))respond(['status'=>'error','message'=>'The company brochure could not be saved.'],500);
  try{append_audit_event($conn,$actor,'SYSTEM','NFC_BROCHURE_UPLOADED','Uploaded a company brochure for NFC card '.$cardId.'.');}catch(Throwable $auditError){error_log('NFC brochure upload audit failed: '.$auditError->getMessage());}
  respond(['status'=>'success','brochureUrl'=>'backend/api.php?action=public_nfc_brochure&id='.$cardId]);
}
if($action==='vendor_applications'&&$method==='GET'){
  if(!vendor_approval_allowed($actor))respond(['status'=>'error','message'=>'Your User Rights do not allow Vendor Approvals.'],403);
  try{respond(['status'=>'success','applications'=>vendor_portal_applications($conn)]);}catch(Throwable $error){error_log('Vendor application list failed: '.$error->getMessage());respond(['status'=>'error','message'=>'Vendor applications could not be loaded.'],500);}
}
if($action==='vendor_application_document'&&$method==='GET'){
  if(!vendor_approval_allowed($actor))respond(['status'=>'error','message'=>'Your User Rights do not allow Vendor Approvals.'],403);
  try{vendor_portal_ensure_schema($conn);$documentId=(int)($_GET['documentId']??0);$statement=$conn->prepare('SELECT original_name,storage_path,mime_type FROM erp_vendor_application_documents WHERE id=?');if(!$statement)throw new RuntimeException('Vendor document is unavailable.');$statement->bind_param('i',$documentId);$statement->execute();$document=$statement->get_result()->fetch_assoc();$statement->close();if(!$document)respond(['status'=>'error','message'=>'Vendor document was not found.'],404);$file=erp_existing_storage_path((string)$document['storage_path']);$allowed=erp_path_is_inside($file,erp_persistent_root())||erp_path_is_inside($file,dirname(__DIR__));if(!$allowed||!is_file($file))respond(['status'=>'error','message'=>'Vendor document file was not found.'],404);$downloadName=preg_replace('/[^A-Za-z0-9._ -]/','_',basename((string)$document['original_name']))?:'vendor-document';header_remove('Content-Type');header('Content-Type: '.((string)$document['mime_type']?:'application/octet-stream'));header('Content-Length: '.filesize($file));header('Content-Disposition: inline; filename="'.str_replace('"','',$downloadName).'"');header('Cache-Control: no-store, private');readfile($file);exit;}catch(Throwable $error){error_log('Vendor document read failed: '.$error->getMessage());respond(['status'=>'error','message'=>'Vendor document could not be opened.'],500);}
}
if($action==='vendor_application_decision'&&$method==='POST'){
  if(!vendor_approval_allowed($actor))respond(['status'=>'error','message'=>'Your User Rights do not allow Vendor Approvals.'],403);
  try{$decision=vendor_portal_decide($conn,$actor,json_body());respond(['status'=>'success']+$decision);}catch(InvalidArgumentException $error){respond(['status'=>'error','message'=>$error->getMessage()],422);}catch(Throwable $error){error_log('Vendor application decision failed: '.$error->getMessage());respond(['status'=>'error','message'=>'The vendor decision could not be completed safely. No Vendor Master changes were saved.'],500);}
}
if($action==='purchase_order_workflow'&&$method==='POST'){
  try{respond(['status'=>'success']+purchase_order_workflow($conn,$actor,json_body()));}
  catch(InvalidArgumentException $error){respond(['status'=>'error','message'=>$error->getMessage()],422);}
  catch(Throwable $error){error_log('Purchase Order workflow failed: '.$error->getMessage());respond(['status'=>'error','message'=>$error->getMessage()?:'The Purchase Order workflow could not be completed.'],409);}
}
if($action==='reports_hub_summary'&&$method==='GET'){
  if(!feature_allowed($actor,['reports'],[]))respond(['status'=>'error','message'=>'Your User Rights do not allow Reports Hub access.'],403);
  try{
    $from=trim((string)($_GET['from']??''));
    $to=trim((string)($_GET['to']??''));
    $validDate=static fn(string $value): bool=>$value===''||(bool)preg_match('/^\d{4}-\d{2}-\d{2}$/',$value);
    if(!$validDate($from)||!$validDate($to))respond(['status'=>'error','message'=>'The report period is invalid.'],422);
    $summaries=[];
    $run=static function(mysqli $db,string $sql,string $from,string $to): array {
      $conditions=[];$types='';$values=[];
      if($from!==''){$conditions[]='activity_date >= ?';$types.='s';$values[]=$from;}
      if($to!==''){$conditions[]='activity_date <= ?';$types.='s';$values[]=$to;}
      $wrapped='SELECT COUNT(*) records,COALESCE(SUM(quantity),0) quantity FROM ('.$sql.') report_rows'.($conditions?' WHERE '.implode(' AND ',$conditions):'');
      $statement=$db->prepare($wrapped);if(!$statement)throw new RuntimeException('Report summary query could not be prepared.');
      if($values)$statement->bind_param($types,...$values);
      $statement->execute();$row=$statement->get_result()->fetch_assoc()?:[];$statement->close();
      return ['records'=>(int)($row['records']??0),'quantity'=>(float)($row['quantity']??0)];
    };
    $summaries['STORE']=$run($conn,'SELECT DATE(imported_at) activity_date,source_count quantity FROM erp_serial_import_batches',$from,$to);
    $stockSummarySql="SELECT COALESCE(STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.date')),'%Y-%m-%d'),STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.date')),'%d/%m/%Y'),DATE(created_at)) activity_date,COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.count')) AS DECIMAL(18,3)),JSON_LENGTH(JSON_EXTRACT(payload_json,'$.serials')),JSON_LENGTH(JSON_EXTRACT(payload_json,'$.fullRows')),0) quantity FROM erp_runtime_records WHERE module_key='DEMOSOLAR_STOCK_PALLET_FORMAT_V7'";
    $summaries['PACKING']=$run($conn,$stockSummarySql,$from,$to);
    $summaries['WAREHOUSE']=$run($conn,$stockSummarySql,$from,$to);
    $summaries['DISPATCH']=$run($conn,'SELECT COALESCE(dispatch_date,DATE(created_at)) activity_date,dispatched_quantity quantity FROM erp_dispatches',$from,$to);
    $summaries['SALES']=$run($conn,'SELECT COALESCE(order_date,DATE(created_at)) activity_date,quantity FROM erp_sales_orders',$from,$to);
    $summaries['ADMIN']=$run($conn,'SELECT DATE(event_time) activity_date,0 quantity FROM erp_audit_events',$from,$to);
    $total=['records'=>0,'quantity'=>0.0];foreach($summaries as $summary){$total['records']+=$summary['records'];$total['quantity']+=$summary['quantity'];}
    respond(['status'=>'success','summaries'=>$summaries,'total'=>$total,'from'=>$from,'to'=>$to]);
  }catch(Throwable $error){error_log('Reports Hub summary failed: '.$error->getMessage());respond(['status'=>'error','message'=>'The report summary is temporarily unavailable.'],500);}
}
if($action==='dashboard_summary'&&$method==='GET'){
  if(!admin($actor)&&!feature_allowed($actor,['dashboard'],['packing','dispatch','warehouse']))respond(['status'=>'error','message'=>'Your User Rights do not allow Dashboard access.'],403);
  try{
    $dashboardKeys=['DEMOSOLAR_POS_PALLET_FORMAT_V7','DEMOSOLAR_STOCK_PALLET_FORMAT_V7','DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7'];
    $dashboardVersions=storage_versions($conn,$dashboardKeys);
    $signature=hash('sha256',json_encode($dashboardVersions,JSON_UNESCAPED_SLASHES));
    $dashboardCacheDirectory=rtrim(erp_persistent_root(),DIRECTORY_SEPARATOR).DIRECTORY_SEPARATOR.'cache';
    if(!is_dir($dashboardCacheDirectory)&&!@mkdir($dashboardCacheDirectory,0775,true)&&!is_dir($dashboardCacheDirectory))throw new RuntimeException('Dashboard cache directory could not be created.');
    $cachePath=$dashboardCacheDirectory.DIRECTORY_SEPARATOR.'dashboard-summary.json';
    $legacyCachePath=rtrim(sys_get_temp_dir(),DIRECTORY_SEPARATOR).DIRECTORY_SEPARATOR.'demosolar-erp-dashboard-summary.json';
    $readCached=static function(string $path): ?array {
      if(!is_file($path)||!is_readable($path))return null;
      $decoded=json_decode((string)@file_get_contents($path),true);
      return is_array($decoded)&&is_array($decoded['summary']??null)?$decoded:null;
    };
    $cachedEnvelope=$readCached($cachePath)??$readCached($legacyCachePath);
    $forceRefresh=(string)($_GET['refresh']??'')==='1';
    if($cachedEnvelope!==null&&hash_equals((string)($cachedEnvelope['signature']??''),$signature)){
      header('X-ERP-Dashboard-Cache: HIT');respond(['status'=>'success','summary'=>$cachedEnvelope['summary'],'versions'=>$dashboardVersions,'stale'=>false]);
    }
    // Never leave the dashboard empty while a large history is compacted. Return
    // the last complete snapshot now; the browser immediately requests a refresh.
    if($cachedEnvelope!==null&&!$forceRefresh){
      header('X-ERP-Dashboard-Cache: STALE');respond(['status'=>'success','summary'=>$cachedEnvelope['summary'],'versions'=>$dashboardVersions,'stale'=>true]);
    }

    $lockHandle=@fopen($cachePath.'.lock','c+');
    if(is_resource($lockHandle))@flock($lockHandle,LOCK_EX);
    $cachedEnvelope=$readCached($cachePath);
    if($cachedEnvelope!==null&&hash_equals((string)($cachedEnvelope['signature']??''),$signature)){if(is_resource($lockHandle)){@flock($lockHandle,LOCK_UN);@fclose($lockHandle);}header('X-ERP-Dashboard-Cache: HIT-AFTER-WAIT');respond(['status'=>'success','summary'=>$cachedEnvelope['summary'],'versions'=>$dashboardVersions,'stale'=>false]);}

    $stock=[];$dispatches=[];$productionOrders=[];
    // The normalized tables contain the exact compact fields used by the
    // dashboard and avoid reading multi-megabyte serial/fullRows JSON payloads.
    // Keep the legacy runtime fallback below for installations not migrated yet.
    try{
      $normalizedReady=true;foreach($dashboardKeys as $dashboardKey)if(!rr_runtime_is_authoritative($conn,$dashboardKey)){$normalizedReady=false;break;}
      if($normalizedReady){
        [$organizationId]=rr_context($conn);$organizationId=(int)$organizationId;
        $poStatement=$conn->prepare('SELECT id,po_number,model_name,wattage,target_quantity,status FROM erp_production_orders WHERE organization_id=? ORDER BY id');
        $poStatement->bind_param('i',$organizationId);$poStatement->execute();$poResult=$poStatement->get_result();
        while($po=$poResult->fetch_assoc())$productionOrders[]=['id'=>(int)$po['id'],'poNumber'=>(string)$po['po_number'],'product'=>(string)($po['model_name']??''),'watt'=>(string)($po['wattage']??''),'qty'=>(float)($po['target_quantity']??0),'status'=>(string)($po['status']??'OPEN')];
        $poStatement->close();

        $stockStatement=$conn->prepare("SELECT p.pallet_number,p.grade,p.model_name,p.wattage,p.module_count,p.packed_date,po.po_number FROM erp_pallets p LEFT JOIN erp_production_orders po ON po.id=p.production_order_id WHERE p.organization_id=? AND p.stock_status='WAREHOUSE' ORDER BY p.id");
        $stockStatement->bind_param('i',$organizationId);$stockStatement->execute();$stockResult=$stockStatement->get_result();
        while($pallet=$stockResult->fetch_assoc())$stock[]=['pallet'=>(string)$pallet['pallet_number'],'po'=>(string)($pallet['po_number']??''),'model'=>(string)($pallet['model_name']??''),'grade'=>(string)($pallet['grade']??'A GRADE'),'count'=>(int)($pallet['module_count']??0),'date'=>(string)($pallet['packed_date']??''),'watt'=>(string)($pallet['wattage']??'')];
        $stockStatement->close();

        $dispatchStatement=$conn->prepare('SELECT d.id,d.dispatch_date,d.created_at,d.dispatched_quantity,d.invoice_number,d.customer_name,d.vehicle_number,p.pallet_number,p.grade,p.model_name,p.wattage,p.packed_date,dp.quantity,po.po_number FROM erp_dispatches d LEFT JOIN erp_dispatch_pallets dp ON dp.dispatch_id=d.id LEFT JOIN erp_pallets p ON p.id=dp.pallet_id LEFT JOIN erp_production_orders po ON po.id=p.production_order_id WHERE d.organization_id=? ORDER BY d.id,p.id');
        $dispatchStatement->bind_param('i',$organizationId);$dispatchStatement->execute();$dispatchResult=$dispatchStatement->get_result();$dispatchIndex=[];
        while($row=$dispatchResult->fetch_assoc()){
          $dispatchId=(int)$row['id'];
          if(!isset($dispatchIndex[$dispatchId])){$dispatchIndex[$dispatchId]=count($dispatches);$dispatches[]=['id'=>$dispatchId,'date'=>(string)($row['dispatch_date']??''),'createdAt'=>(string)($row['created_at']??''),'dispatchedAt'=>(string)($row['created_at']??''),'dispatchedQty'=>(float)($row['dispatched_quantity']??0),'invoice'=>(string)($row['invoice_number']??''),'invoiceNumber'=>(string)($row['invoice_number']??''),'customer'=>(string)($row['customer_name']??''),'vehicle'=>(string)($row['vehicle_number']??''),'pallets'=>[]];}
          if($row['pallet_number']!==null)$dispatches[$dispatchIndex[$dispatchId]]['pallets'][]=['pallet'=>(string)$row['pallet_number'],'po'=>(string)($row['po_number']??''),'model'=>(string)($row['model_name']??''),'grade'=>(string)($row['grade']??'A GRADE'),'count'=>(int)($row['quantity']??0),'date'=>(string)($row['packed_date']??$row['dispatch_date']??''),'watt'=>(string)($row['wattage']??'')];
        }
        $dispatchStatement->close();
        $summary=['generatedAt'=>date(DATE_ATOM),'stock'=>$stock,'dispatches'=>$dispatches,'productionOrders'=>$productionOrders];
        $cachePayload=json_encode(['signature'=>$signature,'summary'=>$summary],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_INVALID_UTF8_SUBSTITUTE);
        if(is_string($cachePayload))@file_put_contents($cachePath,$cachePayload,LOCK_EX);
        if(is_resource($lockHandle)){@flock($lockHandle,LOCK_UN);@fclose($lockHandle);}
        header('X-ERP-Dashboard-Cache: NORMALIZED');respond(['status'=>'success','summary'=>$summary,'versions'=>$dashboardVersions,'stale'=>false]);
      }
    }catch(Throwable $normalizedError){error_log('Normalized dashboard summary fallback: '.$normalizedError->getMessage());$stock=[];$dispatches=[];$productionOrders=[];}

    $placeholders=implode(',',array_fill(0,count($dashboardKeys),'?'));
    $statement=$conn->prepare("SELECT module_key,payload_json FROM erp_runtime_records WHERE module_key IN ({$placeholders}) ORDER BY module_key,position_no");
    if(!$statement)throw new RuntimeException('Dashboard summary query could not be prepared.');
    $types=str_repeat('s',count($dashboardKeys));$statement->bind_param($types,...$dashboardKeys);$statement->execute();$result=$statement->get_result();
    $compactPallet=static function(array $pallet): array {
      $serials=is_array($pallet['serials']??null)?$pallet['serials']:[];$rows=is_array($pallet['fullRows']??null)?$pallet['fullRows']:[];
      return ['pallet'=>(string)($pallet['pallet']??''),'po'=>(string)($pallet['po']??($rows[0]['po']??'')),'model'=>(string)($pallet['model']??''),'grade'=>(string)($pallet['grade']??'A GRADE'),'count'=>(int)($pallet['count']??(count($serials)?:count($rows))),'date'=>(string)($pallet['date']??''),'watt'=>(string)($pallet['watt']??'')];
    };
    while($row=$result->fetch_assoc()){
      $payload=json_decode((string)$row['payload_json'],true);if(!is_array($payload))continue;$moduleKey=(string)$row['module_key'];
      if($moduleKey==='DEMOSOLAR_STOCK_PALLET_FORMAT_V7'){$stock[]=$compactPallet($payload);continue;}
      if($moduleKey==='DEMOSOLAR_POS_PALLET_FORMAT_V7'){$productionOrders[]=['id'=>$payload['id']??null,'poNumber'=>(string)($payload['poNumber']??''),'product'=>(string)($payload['product']??''),'watt'=>(string)($payload['watt']??''),'qty'=>(float)($payload['qty']??0),'status'=>(string)($payload['status']??'OPEN')];continue;}
      if($moduleKey==='DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7'){
        $pallets=[];foreach(is_array($payload['pallets']??null)?$payload['pallets']:[] as $pallet)if(is_array($pallet)){$compact=$compactPallet($pallet);if($compact['date']==='')$compact['date']=(string)($payload['date']??'');$pallets[]=$compact;}
        $dispatches[]=['id'=>$payload['id']??null,'date'=>(string)($payload['date']??''),'createdAt'=>(string)($payload['createdAt']??''),'dispatchedAt'=>(string)($payload['dispatchedAt']??''),'dispatchedQty'=>(float)($payload['dispatchedQty']??0),'invoice'=>(string)($payload['invoice']??''),'invoiceNumber'=>(string)($payload['invoiceNumber']??$payload['invoice']??''),'customer'=>(string)($payload['customer']??''),'vehicle'=>(string)($payload['vehicle']??''),'pallets'=>$pallets];
      }
    }
    $statement->close();
    $summary=['generatedAt'=>date(DATE_ATOM),'stock'=>$stock,'dispatches'=>$dispatches,'productionOrders'=>$productionOrders];
    $cachePayload=json_encode(['signature'=>$signature,'summary'=>$summary],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_INVALID_UTF8_SUBSTITUTE);
    if(is_string($cachePayload))@file_put_contents($cachePath,$cachePayload,LOCK_EX);
    if(is_resource($lockHandle)){@flock($lockHandle,LOCK_UN);@fclose($lockHandle);}
    header('X-ERP-Dashboard-Cache: MISS');respond(['status'=>'success','summary'=>$summary,'versions'=>$dashboardVersions,'stale'=>false]);
  }catch(Throwable $error){error_log('Dashboard summary failed: '.$error->getMessage());respond(['status'=>'error','message'=>'Dashboard summary is temporarily unavailable.'],500);}
}
if($action==='performance_health'&&$method==='GET'){
  if(!admin($actor))respond(['status'=>'error','message'=>'Only an Administrator can view server performance.'],403);
  try{
    $wanted=['Uptime','Threads_connected','Threads_running','Max_used_connections','Connections','Aborted_connects','Questions','Slow_queries','Created_tmp_tables','Created_tmp_disk_tables','Innodb_buffer_pool_read_requests','Innodb_buffer_pool_reads','Innodb_row_lock_waits','Innodb_row_lock_time'];
    $quoted=implode(',',array_map(static fn(string $name): string=>"'".$name."'",$wanted));
    $result=$conn->query("SHOW GLOBAL STATUS WHERE Variable_name IN ({$quoted})");
    $metrics=[];if($result)while($row=$result->fetch_assoc())$metrics[(string)$row['Variable_name']]=(float)$row['Value'];
    $readRequests=(float)($metrics['Innodb_buffer_pool_read_requests']??0);$diskReads=(float)($metrics['Innodb_buffer_pool_reads']??0);
    $bufferHitRate=$readRequests>0?max(0,min(100,(1-($diskReads/$readRequests))*100)):100;
    $temporary=(float)($metrics['Created_tmp_tables']??0);$diskTemporary=(float)($metrics['Created_tmp_disk_tables']??0);
    $temporaryDiskRate=$temporary>0?($diskTemporary/$temporary)*100:0;
    $moduleResult=$conn->query('SELECT module_key,COUNT(*) record_count,COALESCE(SUM(OCTET_LENGTH(payload_json)),0) payload_bytes FROM erp_runtime_records GROUP BY module_key ORDER BY payload_bytes DESC LIMIT 12');
    $modules=[];if($moduleResult)while($row=$moduleResult->fetch_assoc())$modules[]=['key'=>(string)$row['module_key'],'records'=>(int)$row['record_count'],'bytes'=>(int)$row['payload_bytes']];
    $settings=[];$settingResult=$conn->query("SHOW GLOBAL VARIABLES WHERE Variable_name IN ('version','max_connections','innodb_buffer_pool_size','performance_schema','slow_query_log','long_query_time','tmp_table_size','max_heap_table_size')");
    if($settingResult)while($row=$settingResult->fetch_assoc())$settings[(string)$row['Variable_name']]=(string)$row['Value'];
    $root=erp_persistent_root();$storageTotal=@disk_total_space($root);$storageFree=@disk_free_space($root);
    respond(['status'=>'success','generatedAt'=>date(DATE_ATOM),'database'=>['metrics'=>$metrics,'bufferPoolHitRate'=>round($bufferHitRate,3),'temporaryDiskRate'=>round($temporaryDiskRate,3),'settings'=>$settings],'modules'=>$modules,'storage'=>['totalBytes'=>$storageTotal===false?null:(int)$storageTotal,'freeBytes'=>$storageFree===false?null:(int)$storageFree],'health'=>['database'=>$bufferHitRate>=99&&($metrics['Threads_running']??0)<20?'healthy':'attention','capacity'=>($metrics['Max_used_connections']??0)<((float)($settings['max_connections']??1)*0.8)?'healthy':'attention']]);
  }catch(Throwable $error){error_log('Performance health failed: '.$error->getMessage());respond(['status'=>'error','message'=>'Server performance metrics are temporarily unavailable.'],500);}
}
$automaticRequestAuditExcluded=in_array($action,['audit_event','module_bundle','module_delta','live_sync','session','login','logout','purchase_order_workflow','reports_hub_summary','dashboard_summary','performance_health'],true);
if($method==='POST'&&!$automaticRequestAuditExcluded){
  $automaticRequestStarted=microtime(true);
  register_shutdown_function(function() use($conn,$actor,$action,$key,$automaticRequestStarted): void {
    $status=http_response_code();
    if($status===0)$status=200;
    $success=$status>=200&&$status<300;
    $operation=$action!==''?'action='.$action:($key!==''?'storage_key='.$key:'unidentified_operation');
    $department=$key!==''?audit_department_for_key($key):($action==='transaction'?'DISPATCH':($action==='upload_sales_certificates'?'SALES':($action==='upload_photos'?'DISPATCH':(in_array($action,['upload_vendor_document','upload_purchase_order_document','vendor_application_decision'],true)?'PURCHASE':'SYSTEM'))));
    $duration=(int)round((microtime(true)-$automaticRequestStarted)*1000);
    try{
      append_audit_event($conn,$actor,$department,$success?'API_OPERATION_COMPLETED':'API_OPERATION_REJECTED',
        'POST '.$operation.' finished with HTTP '.$status.' in '.$duration.' ms. Request content and secrets were not copied to the audit log.');
    }catch(Throwable $auditError){error_log('Automatic API request audit failed: '.$auditError->getMessage());}
  });
}
if($action==='tour_expenses'||$action==='tour_receipt'){
  require_once __DIR__.'/tour_expenses.php';
  tour_expenses_handle($conn,$actor,$action,$method);
}
if($action==='recharge_expenses'||$action==='recharge_receipt'){
  require_once __DIR__.'/tour_expenses.php';
  require_once __DIR__.'/recharge_expenses.php';
  recharge_expenses_handle($conn,$actor,$action,$method);
}
if($action==='audit_logs'&&$method==='GET'){
  if(!allowed($actor,ERP_LOGS_KEY,false))respond(['status'=>'error','message'=>'Your User Rights do not allow Logs.'],403);
  try{respond(['status'=>'success']+audit_logs_page($conn,$actor,$_GET));}
  catch(Throwable $error){error_log('Paginated audit read failed: '.$error->getMessage());respond(['status'=>'error','message'=>'Audit logs could not be loaded.'],500);}
}
if($action==='audit_event'&&$method==='POST'){
  $input=json_body();
  $department=strtoupper(transaction_text($input['department']??'SYSTEM',60))?:'SYSTEM';
  $actionCode=strtoupper(transaction_text($input['actionCode']??'UNSPECIFIED',100))?:'UNSPECIFIED';
  $details=transaction_text($input['details']??'',4000);
  try{$saved=append_audit_event($conn,$actor,$department,$actionCode,$details);$saved['version']=audit_logs_version($conn,$actor);respond(['status'=>'success']+$saved);}
  catch(Throwable $error){error_log('Audit event failed: '.$error->getMessage());respond(['status'=>'error','message'=>'Audit event could not be saved.'],500);}
}
if($action==='transaction'&&$method==='POST'){
  $input=json_body();$operation=(string)($input['operation']??'');
  try {
    if($operation==='seal_pallet')respond(['status'=>'success','data'=>transaction_seal_pallet($conn,$actor,$input)]);
    if($operation==='dispatch')respond(['status'=>'success','data'=>transaction_dispatch($conn,$actor,$input)]);
    if($operation==='batch_save')respond(['status'=>'success','data'=>transaction_batch_save($conn,$actor,$input)]);
    respond(['status'=>'error','message'=>'Unsupported ERP transaction.'],400);
  } catch(Throwable $error) {
    error_log('ERP transaction failed: '.$error->getMessage());
    respond(['status'=>'error','message'=>$error->getMessage()?:'ERP transaction failed.'],409);
  }
}
if($action==='module_bundle'&&$method==='POST'){
  $input=json_body();
  $allowedKeys=live_sync_keys($conn,$actor);
  $requestedKeys=is_array($input['keys']??null)?array_values(array_unique(array_filter($input['keys'],'is_string'))):[];
  $keys=$requestedKeys?array_values(array_intersect($allowedKeys,$requestedKeys)):$allowedKeys;
  $versions=storage_versions($conn,$keys);
  $modules=[];$recordHashes=[];
  foreach($keys as $moduleKey){
    if($moduleKey===ERP_USERS_KEY){$modules[$moduleKey]=admin($actor)?array_map(fn($user)=>is_array($user)?public_user($user):$user,all_users($conn)):[public_user($actor)];continue;}
    if($moduleKey===ERP_LOGS_KEY){$auditVersion=audit_logs_version($conn,$actor);$versions[$moduleKey]=$auditVersion;$modules[$moduleKey]=['__paginated'=>true,'version'=>$auditVersion];continue;}
    $modules[$moduleKey]=read_value_for_actor($conn,$moduleKey,$actor);
    if($moduleKey!=='DEMOSOLAR_DELETION_REQUESTS_V1'&&rr_runtime_is_authoritative($conn,$moduleKey))$recordHashes[$moduleKey]=rr_runtime_hashes($conn,$moduleKey);
  }
  respond(['status'=>'success','allowedKeys'=>$allowedKeys,'versions'=>$versions,'modules'=>$modules,'recordHashes'=>$recordHashes]);
}
if($action==='module_delta'&&$method==='POST'){
  $input=json_body();
  $moduleKey=is_string($input['key']??null)?(string)$input['key']:'';
  $allowedKeys=live_sync_keys($conn,$actor);
  if($moduleKey===''||!in_array($moduleKey,$allowedKeys,true)||$moduleKey===ERP_LOGS_KEY)respond(['status'=>'error','message'=>'This ERP module is not available for incremental synchronization.'],403);
  $versions=storage_versions($conn,[$moduleKey]);
  $version=$versions[$moduleKey]??'__missing__';
  if($moduleKey===ERP_USERS_KEY){
    $value=admin($actor)?array_map(fn($user)=>is_array($user)?public_user($user):$user,all_users($conn)):[public_user($actor)];
    respond(['status'=>'success','mode'=>'full','version'=>$version,'value'=>$value]);
  }
  if($moduleKey==='DEMOSOLAR_DELETION_REQUESTS_V1')respond(['status'=>'success','mode'=>'full','version'=>$version,'value'=>read_value_for_actor($conn,$moduleKey,$actor)]);
  $clientHashes=is_array($input['hashes']??null)?$input['hashes']:null;
  if(($input['hashMode']??'')==='sha256-runtime-v1'&&$clientHashes!==null&&rr_runtime_is_authoritative($conn,$moduleKey)){
    $delta=rr_runtime_delta($conn,$moduleKey,$clientHashes);
    if(!empty($delta['preferFull'])){
      respond(['status'=>'success','mode'=>'full','version'=>$version,'value'=>read_value($conn,$moduleKey),'hashes'=>$delta['hashes'],'hashMode'=>'sha256-runtime-v1']);
    }
    respond(['status'=>'success','mode'=>'indexed-v1','version'=>$version,'length'=>$delta['length'],'items'=>$delta['items'],'hashes'=>$delta['hashes'],'hashMode'=>'sha256-runtime-v1']);
  }
  $value=read_value($conn,$moduleKey);
  $isList=is_array($value)&&($value===[]||array_keys($value)===range(0,count($value)-1));
  if(!$isList||$clientHashes===null){
    respond(['status'=>'success','mode'=>'full','version'=>$version,'value'=>$value]);
  }
  $items=[];
  foreach($value as $index=>$record){
    $encoded=json_encode($record,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
    $recordHash=$encoded===false?'':hash('crc32b',$encoded);
    if((string)($clientHashes[$index]??'')!==$recordHash)$items[(string)$index]=$record;
  }
  // A full response is simpler and usually smaller when most rows changed.
  if(count($value)>0&&count($items)>count($value)*0.65){
    respond(['status'=>'success','mode'=>'full','version'=>$version,'value'=>$value]);
  }
  respond(['status'=>'success','mode'=>'indexed-v1','version'=>$version,'length'=>count($value),'items'=>$items]);
}
if($action==='live_sync'&&$method==='POST'){
  $input=json_body();
  $knownVersions=is_array($input['versions']??null)?$input['versions']:[];
  $deltaMode=($input['deltaMode']??'')==='indexed-v1';
  $allowedKeys=live_sync_keys($conn,$actor);
  $requestedKeys=is_array($input['keys']??null)?array_values(array_unique(array_filter($input['keys'],'is_string'))):[];
  $keys=$requestedKeys?array_values(array_intersect($allowedKeys,$requestedKeys)):$allowedKeys;
  $versions=storage_versions($conn,$keys);
  $changes=[];
  foreach($keys as $syncKey){
    if($syncKey===ERP_USERS_KEY && !admin($actor)){
      $visibleUser=public_user($actor);
      $version=md5(json_encode($visibleUser,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));
      $versions[$syncKey]=$version;
      if(($knownVersions[$syncKey]??'')!==$version)$changes[$syncKey]=[$visibleUser];
      continue;
    }
    if($syncKey===ERP_LOGS_KEY){
      $version=audit_logs_version($conn,$actor);
      $versions[$syncKey]=$version;
      if(($knownVersions[$syncKey]??'')!==$version)$changes[$syncKey]=['__paginated'=>true,'version'=>$version];
      continue;
    }
    $version=$versions[$syncKey]??'__missing__';
    $versions[$syncKey]=$version;
    if(($knownVersions[$syncKey]??'')!==$version){
      if($deltaMode&&$syncKey!==ERP_USERS_KEY){$changes[$syncKey]=['__deltaPending'=>true,'version'=>$version];continue;}
      $value=read_value_for_actor($conn,$syncKey,$actor);
      if($syncKey===ERP_USERS_KEY&&is_array($value))$value=array_map(fn($u)=>is_array($u)?public_user($u):$u,$value);
      $changes[$syncKey]=$value;
    }
  }
  respond(['status'=>'success','allowedKeys'=>$allowedKeys,'versions'=>$versions,'changes'=>$changes]);
}
if($action==='upload_photos'&&$method==='POST'){
 if(!feature_allowed($actor,['packing','packingScan','dispatch','dispatchChallan'],['packing','dispatch']))respond(['status'=>'error','message'=>'Your User Rights do not allow dispatch-photo uploads.'],403);
 $photoInput=json_body();$uploaded=upload_photos($photoInput);try{rr_register_attachments($conn,'DISPATCH',trim((string)($photoInput['invoice']??'')),$uploaded['saved']??[],'PHOTO',(string)($actor['username']??'SYSTEM'));append_audit_event($conn,$actor,'DISPATCH','FILES_UPLOADED','Uploaded '.count($uploaded['saved']??[]).' dispatch photo(s) to '.($uploaded['folder']??'dispatch folder').'.');}catch(Throwable $auditError){error_log('Photo upload audit failed: '.$auditError->getMessage());}respond(['status'=>'SUCCESS']+$uploaded);
}
if($action==='list_purchase_order_documents'&&$method==='GET'){
 if(!allowed($actor,ERP_PURCHASE_ORDERS_KEY,false))respond(['status'=>'error','message'=>'Your User Rights do not allow Purchase Order document access.'],403);
 $poNumber=strtoupper(trim((string)($_GET['poNumber']??'')));if(!preg_match('/^DEMOU2\/PO\/\d{2}-\d{2}\/\d{4,}$/',$poNumber))respond(['status'=>'error','message'=>'The PO number is invalid.'],400);
 $org=rr_default_organization_id($conn);$statement=$conn->prepare("SELECT attachment_type,original_name,storage_path,created_at,uploaded_by FROM erp_attachments WHERE organization_id=? AND entity_type='PURCHASE_ORDER' AND entity_reference=? AND active=1 ORDER BY id");
 if(!$statement)respond(['status'=>'error','message'=>'Purchase Order documents are unavailable.'],500);$statement->bind_param('is',$org,$poNumber);$statement->execute();$result=$statement->get_result();$documents=[];
 while($row=$result->fetch_assoc()){$path=(string)$row['storage_path'];$file=erp_existing_storage_path($path);$documents[]=['category'=>(string)$row['attachment_type'],'path'=>$path,'originalName'=>(string)($row['original_name']?:basename($path)),'mime'=>is_file($file)?((new finfo(FILEINFO_MIME_TYPE))->file($file)?:'application/octet-stream'):'application/octet-stream','uploadedAt'=>(string)$row['created_at'],'uploadedBy'=>(string)$row['uploaded_by']];}$statement->close();respond(['status'=>'success','documents'=>$documents]);
}
if($action==='read_purchase_order_document'&&$method==='GET'){
 if(!allowed($actor,ERP_PURCHASE_ORDERS_KEY,false))respond(['status'=>'error','message'=>'Your User Rights do not allow Purchase Order document access.'],403);
 $poNumber=strtoupper(trim((string)($_GET['poNumber']??'')));$relative=str_replace('\\','/',trim((string)($_GET['path']??'')));
 if(!preg_match('/^DEMOU2\/PO\/\d{2}-\d{2}\/\d{4,}$/',$poNumber))respond(['status'=>'error','message'=>'The PO number is invalid.'],400);
 $poFolder=preg_replace('/[^A-Za-z0-9_-]/','_',$poNumber);$expectedPrefix='po_upload_details/'.$poFolder.'/';
 if($relative===''||!str_starts_with($relative,$expectedPrefix)||str_contains($relative,'..'))respond(['status'=>'error','message'=>'The Purchase Order document path is invalid.'],400);
 $file=erp_existing_storage_path($relative);$allowedRoot=erp_persistent_storage_path('po_upload_details/'.$poFolder);
 if(!erp_path_is_inside($file,$allowedRoot)||!is_file($file))respond(['status'=>'error','message'=>'The Purchase Order document was not found.'],404);
 $mime=(new finfo(FILEINFO_MIME_TYPE))->file($file)?:'application/octet-stream';$downloadName=preg_replace('/[^A-Za-z0-9._ -]/','_',basename($file))?:'purchase-order-document';
 header_remove('Content-Type');header('Content-Type: '.$mime);header('Content-Length: '.filesize($file));header('Content-Disposition: inline; filename="'.str_replace('"','',$downloadName).'"');header('Cache-Control: no-store, private');readfile($file);exit;
}
if($action==='upload_purchase_order_document'&&$method==='POST'){
 if(!allowed($actor,ERP_PURCHASE_ORDERS_KEY,true))respond(['status'=>'error','message'=>'Your User Rights do not allow Purchase Order document uploads.'],403);
 $poNumber=strtoupper(trim((string)($_POST['poNumber']??'')));
 $category=strtoupper(trim((string)($_POST['category']??'')));
 $categoryFolders=['PI'=>'pi','SPARE_PART_IMAGE'=>'spare_part_images','DATASHEET'=>'datasheets','OTHER_DOCUMENTS'=>'other_documents'];
 if(!preg_match('/^DEMOU2\/PO\/\d{2}-\d{2}\/\d{4,}$/',$poNumber)||!isset($categoryFolders[$category]))respond(['status'=>'error','message'=>'The PO number or document category is invalid.'],400);
 if(!isset($_FILES['file'])||!is_array($_FILES['file']))respond(['status'=>'error','message'=>'Select a Purchase Order document to upload.'],400);
 $file=$_FILES['file'];$error=(int)($file['error']??UPLOAD_ERR_NO_FILE);$size=(int)($file['size']??0);$temporary=(string)($file['tmp_name']??'');
 if(in_array($error,[UPLOAD_ERR_INI_SIZE,UPLOAD_ERR_FORM_SIZE],true))respond(['status'=>'error','message'=>'This file exceeds the PHP/NAS server upload limit. Increase the server upload limit to accept larger files.'],413);
 if($error!==UPLOAD_ERR_OK||$temporary===''||!is_uploaded_file($temporary))respond(['status'=>'error','message'=>'The Purchase Order document upload was incomplete.'],422);
 if($size<=0)respond(['status'=>'error','message'=>'Empty files cannot be uploaded.'],422);
 $originalName=substr((string)($file['name']??'document'),0,255);$extension=strtolower((string)pathinfo($originalName,PATHINFO_EXTENSION));
 $allowedExtensions=['pdf','jpg','jpeg','png','webp','doc','docx','xls','xlsx','csv','txt'];
 if(!in_array($extension,$allowedExtensions,true))respond(['status'=>'error','message'=>'Allowed formats are PDF, JPG, JPEG, PNG, WEBP, DOC, DOCX, XLS, XLSX, CSV and TXT.'],415);
 if($category==='PI'&&!in_array($extension,['pdf','jpg','jpeg','png','webp'],true))respond(['status'=>'error','message'=>'PI files must be printable PDF, JPG, JPEG, PNG or WEBP files.'],415);
 $poFolder=preg_replace('/[^A-Za-z0-9_-]/','_',$poNumber);$directory=erp_persistent_storage_path('po_upload_details/'.$poFolder.'/'.$categoryFolders[$category]).DIRECTORY_SEPARATOR;
 if(!is_dir($directory)&&!mkdir($directory,0775,true))respond(['status'=>'error','message'=>'The Purchase Order document folder could not be created.'],500);
 $base=preg_replace('/[^A-Za-z0-9._-]/','_',pathinfo($originalName,PATHINFO_FILENAME));if($base==='')$base='document';
 $filename=$base.'_'.date('Ymd_His').'_'.bin2hex(random_bytes(8)).'.'.$extension;
 if(!move_uploaded_file($temporary,$directory.$filename))respond(['status'=>'error','message'=>'The Purchase Order document could not be stored.'],500);
 $relative='po_upload_details/'.$poFolder.'/'.$categoryFolders[$category].'/'.$filename;$mime=(new finfo(FILEINFO_MIME_TYPE))->file($directory.$filename)?:'application/octet-stream';
 $document=['category'=>$category,'path'=>$relative,'originalName'=>$originalName,'size'=>$size,'mime'=>$mime,'uploadedAt'=>date(DATE_ATOM),'uploadedBy'=>(string)($actor['username']??'SYSTEM')];
 try{rr_register_attachments($conn,'PURCHASE_ORDER',$poNumber,[$relative],$category,(string)($actor['username']??'SYSTEM'));append_audit_event($conn,$actor,'PURCHASE','PURCHASE_ORDER_DOCUMENT_UPLOADED','Uploaded '.$category.' document for '.$poNumber.'.');}catch(Throwable $auditError){error_log('Purchase Order document audit failed: '.$auditError->getMessage());}
 respond(['status'=>'success','folder'=>'po_upload_details/'.$poFolder.'/'.$categoryFolders[$category],'document'=>$document]);
}
if($action==='upload_vendor_document'&&$method==='POST'){
 if(!allowed($actor,ERP_PURCHASE_VENDORS_KEY,true))respond(['status'=>'error','message'=>'Your User Rights do not allow Vendor Master document uploads.'],403);
 $vendorCode=strtoupper(trim((string)($_POST['vendorCode']??'')));
 $category=strtoupper(trim((string)($_POST['category']??'')));
 $allowedCategories=['GST','PAN','CIN','MSME','TAN','IEC','OTHER','CANCELLED_CHEQUE'];
 if(!preg_match('/^V[DI][0-9]{4,}$/',$vendorCode)||!in_array($category,$allowedCategories,true))respond(['status'=>'error','message'=>'Vendor code or document category is invalid.'],400);
 if(!isset($_FILES['file'])||!is_array($_FILES['file']))respond(['status'=>'error','message'=>'Select a vendor document to upload.'],400);
 $file=$_FILES['file'];$error=(int)($file['error']??UPLOAD_ERR_NO_FILE);$size=(int)($file['size']??0);$temporary=(string)($file['tmp_name']??'');
 if($error!==UPLOAD_ERR_OK||$temporary===''||!is_uploaded_file($temporary))respond(['status'=>'error','message'=>'The vendor document upload was incomplete.'],422);
 if($size<=0||$size>20*1024*1024)respond(['status'=>'error','message'=>'Each vendor document must be no larger than 20 MB.'],413);
 $mime=(new finfo(FILEINFO_MIME_TYPE))->file($temporary)?:'';$extensions=['application/pdf'=>'pdf','image/jpeg'=>'jpg','image/png'=>'png'];
 if(!isset($extensions[$mime]))respond(['status'=>'error','message'=>'Only PDF, JPG, JPEG and PNG vendor documents are allowed.'],415);
 $directory=erp_persistent_storage_path('vendor_documents/'.$vendorCode.'/'.$category).DIRECTORY_SEPARATOR;
 if(!is_dir($directory)&&!mkdir($directory,0775,true))respond(['status'=>'error','message'=>'The vendor document folder could not be created.'],500);
 $filename=$category.'_'.date('Ymd_His').'_'.bin2hex(random_bytes(8)).'.'.$extensions[$mime];
 if(!move_uploaded_file($temporary,$directory.$filename))respond(['status'=>'error','message'=>'The vendor document could not be stored.'],500);
 $relative='vendor_documents/'.$vendorCode.'/'.$category.'/'.$filename;
 $document=['category'=>$category,'path'=>$relative,'originalName'=>substr((string)($file['name']??$filename),0,255),'size'=>$size,'mime'=>$mime,'uploadedAt'=>date(DATE_ATOM),'uploadedBy'=>(string)($actor['username']??'SYSTEM')];
 try{rr_register_attachments($conn,'PURCHASE_VENDOR',$vendorCode,[$relative],$category,(string)($actor['username']??'SYSTEM'));append_audit_event($conn,$actor,'PURCHASE','VENDOR_DOCUMENT_UPLOADED','Uploaded '.$category.' document for vendor '.$vendorCode.'.');}catch(Throwable $auditError){error_log('Vendor document audit failed: '.$auditError->getMessage());}
 respond(['status'=>'success','document'=>$document]);
}
if($action==='upload_sales_certificates'&&$method==='POST'){
 if(!feature_allowed($actor,['salesOrders','salesOrderAdd','salesOrderEdit'],['sales']))respond(['status'=>'error','message'=>'Your User Rights do not allow sales-certificate uploads.'],403);
 $data=json_body();$co=preg_replace('/[^A-Za-z0-9_-]/','_',trim((string)($data['coNumber']??'')));$files=is_array($data['files']??null)?$data['files']:[];if(!$co||!$files||count($files)>10)respond(['status'=>'ERROR','message'=>'A CO Number and up to 10 files are required.'],400);$dir=erp_persistent_storage_path('certificate/'.$co).DIRECTORY_SEPARATOR;if(!is_dir($dir)&&!mkdir($dir,0775,true))respond(['status'=>'ERROR','message'=>'Could not create the certificate folder.'],500);$types=['application/pdf'=>'pdf','image/jpeg'=>'jpg','image/png'=>'png'];$saved=[];$rejected=0;
 foreach($files as $i=>$file){$value=is_array($file)?(string)($file['data']??''):'';if(!preg_match('/^data:([^;]+);base64,(.+)$/s',$value,$m)||!isset($types[strtolower($m[1])])){$rejected++;continue;}$binary=base64_decode($m[2],true);if($binary===false||strlen($binary)===0||strlen($binary)>10*1024*1024){$rejected++;continue;}$name='certificate_'.date('Ymd_His').'_'.($i+1).'_'.bin2hex(random_bytes(8)).'.'.$types[strtolower($m[1])];if(file_put_contents($dir.$name,$binary,LOCK_EX)!==false)$saved[]='certificate/'.$co.'/'.$name;else $rejected++;}
 if(!$saved)respond(['status'=>'ERROR','message'=>'No valid certificates could be saved.'],422);try{rr_register_attachments($conn,'SALES_ORDER',$co,$saved,'CERTIFICATE',(string)($actor['username']??'SYSTEM'));append_audit_event($conn,$actor,'SALES','CERTIFICATES_UPLOADED','Uploaded '.count($saved).' certificate file(s) for C/O '.$co.'; rejected '.$rejected.'.');}catch(Throwable $auditError){error_log('Certificate upload audit failed: '.$auditError->getMessage());}respond(['status'=>'SUCCESS','folder'=>'certificate/'.$co,'saved'=>$saved,'rejected'=>$rejected]);
}
if(!$key)respond(['status'=>'error','message'=>'Missing storage key parameter.'],400);
if($method==='GET'){
 if($key===ERP_USERS_KEY&&!admin($actor))respond([public_user($actor)]);if($key!==ERP_USERS_KEY&&!allowed($actor,$key,false))respond(['status'=>'error','message'=>'You are not authorised to read this data.'],403);$value=read_value_for_actor($conn,$key,$actor);$version=$key===ERP_LOGS_KEY&&!admin($actor)?md5(json_encode([count(is_array($value)?$value:[]),$value[0]['id']??''],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)):(storage_versions($conn,[$key])[$key]??'__missing__');header('X-ERP-Storage-Version: '.$version);if($key===ERP_USERS_KEY&&is_array($value))$value=array_map(fn($u)=>is_array($u)?public_user($u):$u,$value);respond($value);
}
if($method==='POST'){
 if($key===ERP_LOGS_KEY)respond(['status'=>'error','message'=>'Audit history is append-only. New events must use the protected audit endpoint.'],405);
 if(!allowed($actor,$key,true))respond(['status'=>'error','message'=>'You are not authorised to change this data.'],403);
 $input=json_body();$hasPatch=is_array($input['patch']??null);$wrapped=array_key_exists('value',$input)&&array_key_exists('expectedVersion',$input);$value=$wrapped?$input['value']:$input;$expected=is_scalar($input['expectedVersion']??null)?(string)$input['expectedVersion']:'';$permissionBefore=[];
 if($hasPatch){
   $write=write_patch_checked($conn,$key,$input['patch'],$expected,$actor);if(!$write['ok'])respond(['status'=>'error','message'=>(string)($write['validation']??'This data changed on another screen. Refresh before saving so no live data is overwritten.')],409);
   $value=$write['value'];$recordCount=count($value);try{append_audit_event($conn,$actor,audit_department_for_key($key),'MODULE_RECORDS_PATCHED','Saved record-level changes for '.$key.' successfully; resulting record count: '.$recordCount.'.');}catch(Throwable $auditError){error_log('Automatic record-patch audit failed: '.$auditError->getMessage());}
   respond(['status'=>'success','message'=>'Record changes saved securely.','version'=>$write['version'],'mode'=>'record-key-v1']);
 }
 if($key===ERP_USERS_KEY){if(!is_array($value))respond(['status'=>'error','message'=>'Invalid user list.'],400);$permissionBefore=all_users($conn);$value=secure_users_for_save($conn,$value);}
 else{$validationActor=$actor;if($key===ERP_PURCHASE_VENDORS_KEY)$validationActor['role']='purchase';$writeError=non_admin_write_error($conn,$validationActor,$key,$value);if($writeError!==null)respond(['status'=>'error','message'=>$writeError],403);}
 $write=write_value_checked($conn,$key,$value,$expected);if(!$write['ok'])respond(['status'=>'error','message'=>(string)($write['validation']??'This data changed on another screen. Refresh before saving so no live data is overwritten.')],409);
 if($key===ERP_USERS_KEY)try{log_user_permission_changes($conn,$permissionBefore,$value,$actor);}catch(Throwable $permissionError){error_log('Permission history logging failed: '.$permissionError->getMessage());}
 $recordCount=is_array($value)?count($value):1;try{append_audit_event($conn,$actor,audit_department_for_key($key),'MODULE_DATA_SAVED','Saved '.$key.' successfully; submitted record count: '.$recordCount.'.');}catch(Throwable $auditError){error_log('Automatic data-change audit failed: '.$auditError->getMessage());}respond(['status'=>'success','message'=>'Data saved securely.','version'=>$write['version']]);
}
respond(['status'=>'error','message'=>'Unsupported request.'],405);
