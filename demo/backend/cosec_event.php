<?php
/** Matrix COSEC live T&A event receiver. This endpoint does not use an ERP browser session. */
declare(strict_types=1);
require_once __DIR__.'/persistent_paths.php';
require_once __DIR__.'/cosec_attendance_common.php';

header('Content-Type: text/plain; charset=UTF-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
function cosec_reply(int $status,string $message): never {http_response_code($status);echo $message;exit;}
if(($_SERVER['REQUEST_METHOD']??'GET')!=='GET')cosec_reply(405,'METHOD NOT ALLOWED');

$config=['db_host'=>getenv('ERP_DB_HOST')?:'127.0.0.1','db_port'=>(int)(getenv('ERP_DB_PORT')?:3306),'db_name'=>getenv('ERP_DB_NAME')?:'demosolar_erp','db_user'=>getenv('ERP_DB_USER')?:'root','db_pass'=>getenv('ERP_DB_PASSWORD')?:'','cosec_receiver_key'=>getenv('ERP_COSEC_RECEIVER_KEY')?:'','cosec_allowed_ips'=>getenv('ERP_COSEC_ALLOWED_IPS')?:''];
$configPath=erp_config_path();if(is_file($configPath)){$local=require $configPath;if(is_array($local))$config=array_replace($config,$local);}
$expected=trim((string)($config['cosec_receiver_key']??''));$provided=trim((string)($_GET['receiver_key']??''));
if(strlen($expected)<24)cosec_reply(503,'RECEIVER NOT CONFIGURED');
if($provided===''||!hash_equals($expected,$provided))cosec_reply(403,'FORBIDDEN');
$sourceIp=substr((string)($_SERVER['REMOTE_ADDR']??''),0,45);$allowed=array_values(array_filter(array_map('trim',explode(',',(string)($config['cosec_allowed_ips']??'')))));
if($allowed&&!in_array($sourceIp,$allowed,true))cosec_reply(403,'SOURCE NOT ALLOWED');

$values=[];foreach($_GET as $key=>$value){if($key==='receiver_key'||is_array($value))continue;$values[strtolower(preg_replace('/[^a-z0-9]+/i','',(string)$key)??'')]=cosec_text($value,1000);}
$field=static fn(string $name): string => cosec_text($values[$name]??'',255);
$userId=$field('userid');if($userId==='')cosec_reply(422,'USER ID REQUIRED');
$date=cosec_date($field('date'));$time=cosec_time($field('time'));$eventAt=$date!==null?($date.' '.($time??'00:00:00')):null;
$payload=[
  'userId'=>$userId,'userName'=>$field('username'),'date'=>$date,'time'=>$time,'ioFlag'=>$field('ioflag'),
  'specialFunctionId'=>$field('specialfunctionid'),'panelId'=>$field('panelid'),'doorId'=>$field('doorid'),
  'eventId'=>$field('eventid'),'referenceCode'=>$field('referencecode')
];
$identity=$payload['referenceCode']!==''?'reference:'.$payload['referenceCode']:json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
$dedupe=hash('sha256',(string)$identity);$raw=json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)?:'{}';
mysqli_report(MYSQLI_REPORT_OFF);$db=@new mysqli((string)$config['db_host'],(string)$config['db_user'],(string)$config['db_pass'],(string)$config['db_name'],(int)$config['db_port']);
if($db->connect_error)cosec_reply(503,'DATABASE UNAVAILABLE');$db->set_charset('utf8mb4');
try{
  cosec_attendance_bootstrap($db);
  $stmt=$db->prepare("INSERT IGNORE INTO erp_cosec_events(dedupe_key,reference_code,user_id,user_name,event_date,event_time,event_at,io_flag,special_function_id,panel_id,door_id,event_id,raw_payload_json,source_ip) VALUES(?,NULLIF(?,''),?,?,NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),?,?,?,?,?,?,?)");
  if(!$stmt)throw new RuntimeException('prepare');
  $reference=$payload['referenceCode'];$userName=$payload['userName'];$dateValue=$date??'';$timeValue=$time??'';$eventAtValue=$eventAt??'';$io=$payload['ioFlag'];$special=$payload['specialFunctionId'];$panel=$payload['panelId'];$door=$payload['doorId'];$event=$payload['eventId'];
  $stmt->bind_param('ssssssssssssss',$dedupe,$reference,$userId,$userName,$dateValue,$timeValue,$eventAtValue,$io,$special,$panel,$door,$event,$raw,$sourceIp);
  if(!$stmt->execute())throw new RuntimeException('insert');$stored=$stmt->affected_rows>0;$stmt->close();
  cosec_reply(200,$stored?'OK':'DUPLICATE OK');
}catch(Throwable $error){error_log('COSEC receiver failed: '.$error->getMessage());cosec_reply(500,'RECEIVER ERROR');}
