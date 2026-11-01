<?php
/** Authenticated HR attendance API. */
declare(strict_types=1);
header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
require_once __DIR__.'/session_guard.php';
require_once __DIR__.'/cosec_attendance_common.php';
function attendance_out(array $value,int $status=200): never {http_response_code($status);echo json_encode($value,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);exit;}
function attendance_body(): array {$value=json_decode((string)(file_get_contents('php://input')?:'{}'),true);if(!is_array($value))attendance_out(['status'=>'error','message'=>'Invalid JSON request.'],400);return $value;}
function attendance_right(array $user,string $right): bool {return strtolower((string)($user['role']??''))==='admin'||(($user['rights'][$right]??false)===true);}
$user=require_erp_session(['admin'],['hrAttendanceView','hrAttendanceManual']);$db=erp_guard_database();cosec_attendance_bootstrap($db);
$action=strtolower(trim((string)($_GET['action']??'events')));$method=$_SERVER['REQUEST_METHOD']??'GET';
try{
if($action==='events'&&$method==='GET'){
  if(!attendance_right($user,'hrAttendanceView'))attendance_out(['status'=>'error','message'=>'Your User Rights do not allow attendance viewing.'],403);
  $from=cosec_date((string)($_GET['from']??date('Y-m-01')))??date('Y-m-01');$to=cosec_date((string)($_GET['to']??date('Y-m-d')))??date('Y-m-d');$search=cosec_text($_GET['search']??'',100);$limit=min(1000,max(50,(int)($_GET['limit']??500)));
  $where='event_date BETWEEN ? AND ?';$types='ss';$params=[$from,$to];if($search!==''){$where.=' AND (user_id LIKE ? OR user_name LIKE ?)';$needle='%'.$search.'%';$types.='ss';$params[]=$needle;$params[]=$needle;}
  $stmt=$db->prepare("SELECT id,reference_code,user_id,user_name,event_date,event_time,event_at,io_flag,special_function_id,panel_id,door_id,event_id,received_at FROM erp_cosec_events WHERE {$where} ORDER BY COALESCE(event_at,received_at) DESC,id DESC LIMIT {$limit}");$stmt->bind_param($types,...$params);$stmt->execute();$result=$stmt->get_result();$events=[];while($row=$result->fetch_assoc())$events[]=$row;$stmt->close();
  $summaryResult=$db->query("SELECT COUNT(*) total,COUNT(DISTINCT user_id) employees,MAX(received_at) last_received FROM erp_cosec_events WHERE event_date=CURDATE()");$summary=$summaryResult?$summaryResult->fetch_assoc():['total'=>0,'employees'=>0,'last_received'=>null];
  attendance_out(['status'=>'success','events'=>$events,'summary'=>$summary,'from'=>$from,'to'=>$to]);
}
if($action==='manual'&&$method==='GET'){
  if(!attendance_right($user,'hrAttendanceManual'))attendance_out(['status'=>'error','message'=>'Your User Rights do not allow manual attendance.'],403);
  $result=$db->query('SELECT id,user_id,user_name,attendance_date,time_in,time_out,attendance_status,reason,created_by,created_at FROM erp_manual_attendance ORDER BY attendance_date DESC,id DESC LIMIT 500');$rows=[];while($result&&$row=$result->fetch_assoc())$rows[]=$row;attendance_out(['status'=>'success','records'=>$rows]);
}
if($action==='manual'&&$method==='POST'){
  if(!attendance_right($user,'hrAttendanceManual'))attendance_out(['status'=>'error','message'=>'Your User Rights do not allow manual attendance.'],403);$body=attendance_body();
  $userId=cosec_text($body['userId']??'',100);$userName=cosec_text($body['userName']??'',255);$date=cosec_date((string)($body['date']??''));$timeIn=cosec_time((string)($body['timeIn']??''));$timeOut=cosec_time((string)($body['timeOut']??''));$status=strtoupper(cosec_text($body['status']??'PRESENT',30));$reason=cosec_text($body['reason']??'',1000);
  $statuses=['PRESENT','ABSENT','HALF_DAY','LEAVE','WORK_FROM_HOME','HOLIDAY'];if($userId===''||$date===null||$reason==='')attendance_out(['status'=>'error','message'=>'Employee ID, date and reason are required.'],422);if(!in_array($status,$statuses,true))attendance_out(['status'=>'error','message'=>'Select a valid attendance status.'],422);
  $by=cosec_text($user['username']??'SYSTEM',100);$timeInValue=$timeIn??'';$timeOutValue=$timeOut??'';$stmt=$db->prepare("INSERT INTO erp_manual_attendance(user_id,user_name,attendance_date,time_in,time_out,attendance_status,reason,created_by) VALUES(?,?,?,NULLIF(?,''),NULLIF(?,''),?,?,?)");$stmt->bind_param('ssssssss',$userId,$userName,$date,$timeInValue,$timeOutValue,$status,$reason,$by);if(!$stmt->execute())throw new RuntimeException('Manual attendance could not be saved.');$recordId=$stmt->insert_id;$stmt->close();
  if($db->query("SHOW TABLES LIKE 'erp_audit_events'")?->num_rows){$details='Manual attendance #'.$recordId.' for '.$userId.' on '.$date.' ('.$status.').';$department='HR';$actionCode='MANUAL_ATTENDANCE_CREATED';$sourceIp=substr((string)($_SERVER['REMOTE_ADDR']??''),0,45);$legacyId='ATTENDANCE-'.(string)$recordId;$organization=0;$org=$db->query("SELECT id FROM erp_organizations WHERE code='DEMOSOLAR' LIMIT 1");if($org)$organization=(int)($org->fetch_row()[0]??0);if($organization>0){$audit=$db->prepare('INSERT INTO erp_audit_events(organization_id,legacy_id,event_time,actor_username,department_code,action_code,details,source_ip) VALUES(?,?,NOW(),?,?,?,?,?)');$audit->bind_param('issssss',$organization,$legacyId,$by,$department,$actionCode,$details,$sourceIp);$audit->execute();$audit->close();}}
  attendance_out(['status'=>'success','id'=>$recordId]);
}
attendance_out(['status'=>'error','message'=>'Unsupported attendance operation.'],404);
}catch(Throwable $error){error_log('Attendance API failed: '.$error->getMessage());attendance_out(['status'=>'error','message'=>'Attendance operation failed.'],500);}
