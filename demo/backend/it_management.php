<?php
/** Database-backed IT administration: sessions, assets, role templates and effective access. */
declare(strict_types=1);
header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
require_once __DIR__.'/session_guard.php';

function it_out(array $payload,int $status=200): void {http_response_code($status);echo json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);exit;}
function it_body(): array {$value=json_decode((string)(file_get_contents('php://input')?:'{}'),true);if(!is_array($value))it_out(['status'=>'error','message'=>'Invalid JSON request.'],400);return $value;}
function it_admin(array $user): bool {return strtolower((string)($user['role']??''))==='admin';}
function it_right(array $user,string $right): bool {return it_admin($user)||(($user['rights'][$right]??false)===true);}
function it_need(array $user,string $right): void {if(!it_right($user,$right))it_out(['status'=>'error','message'=>'Your User Rights do not allow this IT action.'],403);}
function it_need_any(array $user,array $rights): void {foreach($rights as $right)if(it_right($user,$right))return;it_out(['status'=>'error','message'=>'Your User Rights do not allow this IT action.'],403);}
function it_users(mysqli $db): array {$key='DEMOSOLAR_USERS_PALLET_FORMAT_V7';$rows=rr_runtime_is_authoritative($db,$key)?rr_runtime_read_records($db,$key):module_state_read($db,$key);return rr_hydrate_user_permissions($db,is_array($rows)?$rows:[]);}
function it_save_users(mysqli $db,array $users): void {
    $key='DEMOSOLAR_USERS_PALLET_FORMAT_V7';$db->begin_transaction();
    try{rr_sync_module($db,$key,$users);if(!module_state_write_in_transaction($db,$key,$users))throw new RuntimeException('User database update failed.');$db->commit();}
    catch(Throwable $error){$db->rollback();throw $error;}
}
function it_public_users(array $users): array {return array_map(function($u){unset($u['password'],$u['passwordHash'],$u['password_hash']);return $u;},$users);}
function it_find_user_index(array $users,string $id): ?int {foreach($users as $i=>$user)if((string)($user['id']??'')===$id)return $i;return null;}
function it_log_rights(mysqli $db,array $target,array $before,array $after,string $by): void {
    $id=(string)($target['id']??'');$name=(string)($target['username']??'');$beforeJson=json_encode($before,JSON_UNESCAPED_SLASHES)?:'{}';$afterJson=json_encode($after,JSON_UNESCAPED_SLASHES)?:'{}';
    $stmt=$db->prepare('INSERT INTO erp_permission_change_log(target_user_legacy_id,target_username,changed_by,before_json,after_json) VALUES(?,?,?,?,?)');if(!$stmt)return;$stmt->bind_param('sssss',$id,$name,$by,$beforeJson,$afterJson);$stmt->execute();$stmt->close();
}
function it_seed_templates(mysqli $db,string $by): void {
    $sets=[
      'Guard'=>['cctv'=>true,'cctvLive'=>true],
      'Purchase'=>['dashboard'=>true,'purchase'=>true,'purchaseVendorApprovals'=>true,'purchaseVendorMaster'=>true,'purchasePartCode'=>true,'purchaseOrder'=>true,'purchaseOrderView'=>true,'purchaseOrderApprovals'=>false],
      'Store'=>['dashboard'=>true,'storePpc'=>true,'storeCreatePo'=>true,'storeEditPo'=>true,'storeUploadSerial'=>true,'storeEditSerial'=>true,'storeDeleteSerial'=>true,'storeDeletePo'=>true],
      'Packing'=>['dashboard'=>true,'packing'=>true,'packingScan'=>true,'packingRework'=>true,'packingEditPallet'=>true,'packingDeletePallet'=>true,'packingClosePo'=>true],
      'Dispatch'=>['dashboard'=>true,'dispatch'=>true,'dispatchChallan'=>true,'dispatchBookedStock'=>true,'dispatchViewList'=>true,'dispatchRouteFare'=>true,'dispatchBookVehicle'=>true],
      'Accounts'=>['dashboard'=>true,'accounts'=>true,'accountsDashboard'=>true,'accountsInvoiceLogistics'=>true,'accountsEditInvoice'=>true,'accountsDeleteInvoice'=>true,'accountsReceipt'=>true,'accountsReports'=>true],
      'Production'=>['dashboard'=>true,'production'=>true,'productionDashboard'=>true,'productionAddDetails'=>true,'productionEditSheet'=>true,'productionDeleteSheet'=>true,'productionViewSheet'=>true,'productionDailyUpdate'=>true],
      'Sales'=>['dashboard'=>true,'salesOrders'=>true,'salesOrderDashboard'=>true,'salesOrderAdd'=>true,'salesOrderView'=>true,'salesOrderAllocation'=>true,'salesOrderSerialTracking'=>true,'salesOrderEdit'=>true,'salesOrderDelete'=>true],
      'HR'=>['dashboard'=>true,'hr'=>true,'hrEmployeeAdd'=>true,'hrEmployeeEdit'=>true,'hrEmployeeDelete'=>true,'hrAttendanceView'=>true,'hrAttendanceManual'=>true],
      'IT Administrator'=>['dashboard'=>true,'it'=>true,'hr'=>true,'hrEmployeeAdd'=>true,'hrEmployeeEdit'=>true,'hrEmployeeDelete'=>true,'hrAttendanceView'=>true,'hrAttendanceManual'=>true,'departmentView'=>true,'departmentAdd'=>true,'departmentEdit'=>true,'departmentDelete'=>true,'adminUsers'=>true,'adminAddUser'=>true,'adminEditUser'=>true,'adminDeleteUser'=>true,'adminUserRights'=>true,'itSecuritySessions'=>true,'itAssetDashboard'=>true,'itAssetMaster'=>true,'itAssetAllocation'=>true,'itRoleTemplates'=>true,'itEffectiveAccess'=>true]
    ];
    $stmt=$db->prepare('INSERT INTO erp_role_templates(template_name,description,permissions_json,is_system,created_by) VALUES(?,?,?,1,?) ON DUPLICATE KEY UPDATE description=IF(is_system=1,VALUES(description),description),permissions_json=IF(is_system=1,VALUES(permissions_json),permissions_json)');if(!$stmt)return;
    foreach($sets as $name=>$rights){$description=$name.' standard access template';$json=json_encode($rights,JSON_UNESCAPED_SLASHES);$stmt->bind_param('ssss',$name,$description,$json,$by);$stmt->execute();}$stmt->close();
}

$user=require_erp_session(['admin'],['itSecuritySessions','itAssetDashboard','itAssetMaster','itAssetAllocation','itRoleTemplates','itEffectiveAccess']);
$db=erp_guard_database();it_management_bootstrap($db);it_register_session($db,$user,it_apply_session_settings($db,erp_guard_config()));it_seed_templates($db,(string)($user['username']??'SYSTEM'));
$action=strtolower(trim((string)($_GET['action']??'overview')));$method=$_SERVER['REQUEST_METHOD']??'GET';
try{
if($action==='overview'&&$method==='GET'){
    it_need($user,'itAssetDashboard');
    $summary=[];foreach(['total'=>'SELECT COUNT(*) FROM erp_it_assets','available'=>"SELECT COUNT(*) FROM erp_it_assets WHERE status='AVAILABLE'",'assigned'=>"SELECT COUNT(*) FROM erp_it_assets WHERE status='ASSIGNED'",'repair'=>"SELECT COUNT(*) FROM erp_it_assets WHERE status='REPAIR'",'warranty'=>"SELECT COUNT(*) FROM erp_it_assets WHERE warranty_until IS NOT NULL AND warranty_until BETWEEN CURDATE() AND DATE_ADD(CURDATE(),INTERVAL 30 DAY)"] as $key=>$sql){$result=$db->query($sql);$summary[$key]=(int)($result?$result->fetch_row()[0]??0:0);}it_out(['status'=>'success','summary'=>$summary]);
}
if($action==='sessions'&&$method==='GET'){
    it_need($user,'itSecuritySessions');
    $settings=it_apply_session_settings($db,erp_guard_config());$idle=max(300,(int)$settings['session_idle_seconds']);
    $db->query("UPDATE erp_active_sessions SET revoked_at=COALESCE(revoked_at,NOW()),revoked_by=COALESCE(revoked_by,'EXPIRED') WHERE revoked_at IS NULL AND (expires_at<NOW() OR last_seen<DATE_SUB(NOW(),INTERVAL ".$idle." SECOND))");
    $result=$db->query('SELECT session_hash,user_legacy_id,username,login_at,last_seen,expires_at,source_ip,user_agent,revoked_at,revoked_by FROM erp_active_sessions ORDER BY (revoked_at IS NULL AND expires_at>NOW()) DESC,last_seen DESC LIMIT 500');$rows=[];while($result&&$row=$result->fetch_assoc()){$row['sessionToken']=substr((string)$row['session_hash'],0,16);unset($row['session_hash']);$row['active']=empty($row['revoked_at'])&&strtotime((string)$row['expires_at'])>time();$rows[]=$row;}
    $events=[];$audit=$db->query("SELECT event_time,actor_username,action_code,source_ip,details FROM erp_audit_events WHERE action_code IN ('LOGIN_SUCCESS','LOGIN_FAILED','LOGIN_RATE_LIMITED','LOGOUT') ORDER BY event_time DESC,id DESC LIMIT 100");while($audit&&$row=$audit->fetch_assoc())$events[]=$row;
    it_out(['status'=>'success','sessions'=>$rows,'loginEvents'=>$events]);
}
if($action==='session_settings'&&$method==='GET'){
    it_need($user,'itSecuritySessions');$settings=it_apply_session_settings($db,erp_guard_config());it_out(['status'=>'success','idleSeconds'=>(int)$settings['session_idle_seconds'],'absoluteSeconds'=>(int)$settings['session_absolute_seconds']]);
}
if($action==='session_settings'&&$method==='POST'){
    it_need($user,'itSecuritySessions');$b=it_body();$idle=min(86400,max(300,(int)($b['idleSeconds']??1800)));$absolute=min(604800,max(1800,(int)($b['absoluteSeconds']??28800)));if($absolute<$idle)$absolute=$idle;$by=(string)$user['username'];$stmt=$db->prepare('INSERT INTO erp_it_settings(setting_key,setting_value,updated_by) VALUES(?,?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_by=VALUES(updated_by)');foreach([['session_idle_seconds',(string)$idle],['session_absolute_seconds',(string)$absolute]] as [$key,$value]){$stmt->bind_param('sss',$key,$value,$by);$stmt->execute();}$stmt->close();it_out(['status'=>'success','idleSeconds'=>$idle,'absoluteSeconds'=>$absolute]);
}
if($action==='revoke_session'&&$method==='POST'){
    it_need($user,'itSecuritySessions');$body=it_body();$token=trim((string)($body['sessionToken']??''));if(!preg_match('/^[a-f0-9]{16}$/',$token))it_out(['status'=>'error','message'=>'Invalid session.'],422);
    $by=(string)$user['username'];$stmt=$db->prepare("UPDATE erp_active_sessions SET revoked_at=NOW(),revoked_by=? WHERE session_hash LIKE CONCAT(?,'%') AND revoked_at IS NULL");$stmt->bind_param('ss',$by,$token);$stmt->execute();$count=$stmt->affected_rows;$stmt->close();it_out(['status'=>'success','revoked'=>$count]);
}
if($action==='disable_user'&&$method==='POST'){
    it_need($user,'itSecuritySessions');$body=it_body();$id=(string)($body['userId']??'');$users=it_users($db);$index=it_find_user_index($users,$id);if($index===null)it_out(['status'=>'error','message'=>'User not found.'],404);if($id===(string)($user['id']??''))it_out(['status'=>'error','message'=>'You cannot disable your own account.'],422);
    $users[$index]['status']='DISABLED';it_save_users($db,$users);$by=(string)$user['username'];$stmt=$db->prepare('UPDATE erp_active_sessions SET revoked_at=NOW(),revoked_by=? WHERE user_legacy_id=? AND revoked_at IS NULL');$stmt->bind_param('ss',$by,$id);$stmt->execute();$stmt->close();it_out(['status'=>'success']);
}
if($action==='reset_password'&&$method==='POST'){
    it_need($user,'itSecuritySessions');$body=it_body();$id=(string)($body['userId']??'');$password=(string)($body['password']??'');if(strlen($password)<10)it_out(['status'=>'error','message'=>'Password must contain at least 10 characters.'],422);$users=it_users($db);$index=it_find_user_index($users,$id);if($index===null)it_out(['status'=>'error','message'=>'User not found.'],404);$users[$index]['passwordHash']=password_hash($password,PASSWORD_DEFAULT);it_save_users($db,$users);$by=(string)$user['username'];$stmt=$db->prepare('UPDATE erp_active_sessions SET revoked_at=NOW(),revoked_by=? WHERE user_legacy_id=? AND revoked_at IS NULL');$stmt->bind_param('ss',$by,$id);$stmt->execute();$stmt->close();it_out(['status'=>'success']);
}
if($action==='assets'&&$method==='GET'){
    it_need_any($user,['itAssetMaster','itAssetAllocation']);$result=$db->query('SELECT * FROM erp_it_assets ORDER BY asset_code');$rows=[];while($result&&$row=$result->fetch_assoc())$rows[]=$row;it_out(['status'=>'success','assets'=>$rows,'users'=>it_public_users(it_users($db))]);
}
if($action==='save_asset'&&$method==='POST'){
    it_need($user,'itAssetMaster');$b=it_body();$id=(int)($b['id']??0);$code=strtoupper(trim((string)($b['assetCode']??'')));$category=trim((string)($b['category']??''));$name=trim((string)($b['assetName']??''));if($code===''||$category===''||$name==='')it_out(['status'=>'error','message'=>'Asset code, category and asset name are required.'],422);
    $fields=['brand','model','serialNumber','purchaseDate','warrantyUntil','vendorName','invoiceNumber','locationName','notes'];foreach($fields as $field)$$field=trim((string)($b[$field]??''));$status=strtoupper(trim((string)($b['status']??'AVAILABLE')));$by=(string)$user['username'];
    if($id){$stmt=$db->prepare('UPDATE erp_it_assets SET asset_code=?,category=?,asset_name=?,brand=?,model=?,serial_number=NULLIF(?,\'\'),purchase_date=NULLIF(?,\'\'),warranty_until=NULLIF(?,\'\'),vendor_name=?,invoice_number=?,location_name=?,status=?,notes=?,updated_by=? WHERE id=?');$stmt->bind_param('ssssssssssssssi',$code,$category,$name,$brand,$model,$serialNumber,$purchaseDate,$warrantyUntil,$vendorName,$invoiceNumber,$locationName,$status,$notes,$by,$id);}else{$stmt=$db->prepare('INSERT INTO erp_it_assets(asset_code,category,asset_name,brand,model,serial_number,purchase_date,warranty_until,vendor_name,invoice_number,location_name,status,notes,created_by) VALUES(?,?,?,?,?,NULLIF(?,\'\'),NULLIF(?,\'\'),NULLIF(?,\'\'),?,?,?,?,?,?)');$stmt->bind_param('ssssssssssssss',$code,$category,$name,$brand,$model,$serialNumber,$purchaseDate,$warrantyUntil,$vendorName,$invoiceNumber,$locationName,$status,$notes,$by);}if(!$stmt||!$stmt->execute())throw new RuntimeException('Asset could not be saved. Ensure the code and serial number are unique.');$stmt->close();it_out(['status'=>'success']);
}
if($action==='assign_asset'&&$method==='POST'){
    it_need($user,'itAssetAllocation');$b=it_body();$assetId=(int)($b['assetId']??0);$to=(string)($b['userId']??'');$remarks=trim((string)($b['remarks']??''));$users=it_users($db);$index=$to===''?null:it_find_user_index($users,$to);$username=$index===null?'':(string)$users[$index]['username'];$result=$db->query('SELECT assigned_user_legacy_id FROM erp_it_assets WHERE id='.(int)$assetId.' LIMIT 1');$row=$result?$result->fetch_assoc():null;if(!$row)it_out(['status'=>'error','message'=>'Asset not found.'],404);$from=(string)($row['assigned_user_legacy_id']??'');$status=$to===''?'AVAILABLE':'ASSIGNED';$by=(string)$user['username'];$stmt=$db->prepare('UPDATE erp_it_assets SET assigned_user_legacy_id=NULLIF(?,\'\'),assigned_username=NULLIF(?,\'\'),status=?,updated_by=? WHERE id=?');$stmt->bind_param('ssssi',$to,$username,$status,$by,$assetId);$stmt->execute();$stmt->close();$actionCode=$to===''?'RETURNED':'ASSIGNED';$stmt=$db->prepare('INSERT INTO erp_it_asset_history(asset_id,action_code,from_user_legacy_id,to_user_legacy_id,remarks,action_by) VALUES(?,?,?,?,?,?)');$stmt->bind_param('isssss',$assetId,$actionCode,$from,$to,$remarks,$by);$stmt->execute();$stmt->close();it_out(['status'=>'success']);
}
if($action==='templates'&&$method==='GET'){
    it_need($user,'itRoleTemplates');$result=$db->query('SELECT id,template_name,description,permissions_json,is_system,created_by,created_at,updated_by,updated_at FROM erp_role_templates ORDER BY is_system DESC,template_name');$rows=[];while($result&&$row=$result->fetch_assoc()){$row['permissions']=json_decode((string)$row['permissions_json'],true)?:[];unset($row['permissions_json']);$rows[]=$row;}it_out(['status'=>'success','templates'=>$rows,'users'=>it_public_users(it_users($db))]);
}
if($action==='save_template'&&$method==='POST'){
    it_need($user,'itRoleTemplates');$b=it_body();$name=trim((string)($b['name']??''));$description=trim((string)($b['description']??''));$rights=is_array($b['permissions']??null)?$b['permissions']:[];if($name==='')it_out(['status'=>'error','message'=>'Template name is required.'],422);$json=json_encode($rights,JSON_UNESCAPED_SLASHES);$by=(string)$user['username'];$stmt=$db->prepare('INSERT INTO erp_role_templates(template_name,description,permissions_json,is_system,created_by,updated_by) VALUES(?,?,?,0,?,?) ON DUPLICATE KEY UPDATE description=VALUES(description),permissions_json=VALUES(permissions_json),updated_by=VALUES(updated_by)');$stmt->bind_param('sssss',$name,$description,$json,$by,$by);$stmt->execute();$stmt->close();it_out(['status'=>'success']);
}
if($action==='apply_template'&&$method==='POST'){
    it_need($user,'itRoleTemplates');$b=it_body();$templateId=(int)($b['templateId']??0);$userId=(string)($b['userId']??'');$stmt=$db->prepare('SELECT permissions_json FROM erp_role_templates WHERE id=?');$stmt->bind_param('i',$templateId);$stmt->execute();$row=$stmt->get_result()->fetch_assoc();$stmt->close();if(!$row)it_out(['status'=>'error','message'=>'Template not found.'],404);$rights=json_decode((string)$row['permissions_json'],true);if(!is_array($rights))$rights=[];$users=it_users($db);$index=it_find_user_index($users,$userId);if($index===null)it_out(['status'=>'error','message'=>'User not found.'],404);$before=is_array($users[$index]['rights']??null)?$users[$index]['rights']:[];$users[$index]['rights']=$rights;it_save_users($db,$users);it_log_rights($db,$users[$index],$before,$rights,(string)$user['username']);it_out(['status'=>'success']);
}
if($action==='effective_access'&&$method==='GET'){
    it_need($user,'itEffectiveAccess');$id=(string)($_GET['userId']??'');$users=it_users($db);$index=it_find_user_index($users,$id);if($index===null)it_out(['status'=>'error','message'=>'User not found.'],404);$target=it_public_users([$users[$index]])[0];$history=[];$stmt=$db->prepare('SELECT changed_by,changed_at,before_json,after_json FROM erp_permission_change_log WHERE target_user_legacy_id=? ORDER BY changed_at DESC,id DESC LIMIT 25');$stmt->bind_param('s',$id);$stmt->execute();$result=$stmt->get_result();while($row=$result->fetch_assoc()){$row['before']=json_decode((string)$row['before_json'],true)?:[];$row['after']=json_decode((string)$row['after_json'],true)?:[];unset($row['before_json'],$row['after_json']);$history[]=$row;}$stmt->close();$camera=0;if(rr_table_exists($db,'erp_cctv_user_access')){$stmt=$db->prepare('SELECT COUNT(*) FROM erp_cctv_user_access WHERE user_legacy_id=? AND (can_live=1 OR can_playback=1 OR can_download=1)');$stmt->bind_param('s',$id);$stmt->execute();$camera=(int)($stmt->get_result()->fetch_row()[0]??0);$stmt->close();}it_out(['status'=>'success','user'=>$target,'cameraCount'=>$camera,'history'=>$history,'users'=>it_public_users($users)]);
}
if($action==='effective_access_users'&&$method==='GET'){
    it_need($user,'itEffectiveAccess');it_out(['status'=>'success','users'=>it_public_users(it_users($db))]);
}
it_out(['status'=>'error','message'=>'Unsupported IT Management action.'],404);
}catch(Throwable $error){error_log('IT Management error: '.$error->getMessage());it_out(['status'=>'error','message'=>$error->getMessage()?:'IT Management operation failed.'],500);}
