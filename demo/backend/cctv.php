<?php
/** Secure CCTV inventory, per-camera permissions and short-lived gateway tokens. */
declare(strict_types=1);

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: same-origin');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'self'; base-uri 'none'");

require_once __DIR__.'/session_guard.php';

function cctv_response(array $payload, int $status=200): void {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
    exit;
}
function cctv_json_body(): array {
    $body=json_decode((string)(file_get_contents('php://input')?:'{}'),true);
    if(!is_array($body))cctv_response(['status'=>'error','message'=>'Invalid JSON request.'],400);
    return $body;
}
function cctv_config(): array {
    $config=[
        'token_secret'=>(string)(getenv('ERP_CCTV_TOKEN_SECRET')?:''),
        'token_lifetime_seconds'=>(int)(getenv('ERP_CCTV_TOKEN_LIFETIME')?:120),
        'gateway_public_base'=>(string)(getenv('ERP_CCTV_GATEWAY_PUBLIC_BASE')?:'/cctv-stream/'),
    ];
    $path=erp_config_path('cctv_config.php');
    if(is_file($path)){$local=require $path;if(is_array($local))$config=array_replace($config,$local);}
    $config['token_lifetime_seconds']=min(300,max(30,(int)$config['token_lifetime_seconds']));
    $config['gateway_public_base']='/'.trim((string)$config['gateway_public_base'],'/').'/' ;
    return $config;
}
function cctv_base64url_encode(string $value): string {return rtrim(strtr(base64_encode($value),'+/','-_'),'=');}
function cctv_base64url_decode(string $value): string|false {
    $remainder=strlen($value)%4;if($remainder)$value.=str_repeat('=',4-$remainder);
    return base64_decode(strtr($value,'-_','+/'),true);
}
function cctv_token(array $claims,string $secret): string {
    $payload=cctv_base64url_encode((string)json_encode($claims,JSON_UNESCAPED_SLASHES));
    return $payload.'.'.cctv_base64url_encode(hash_hmac('sha256',$payload,$secret,true));
}
function cctv_validate_token(string $token,string $secret): ?array {
    if($secret===''||!str_contains($token,'.'))return null;
    [$payload,$provided]=array_pad(explode('.',$token,2),2,'');
    $expected=cctv_base64url_encode(hash_hmac('sha256',$payload,$secret,true));
    if($provided===''||!hash_equals($expected,$provided))return null;
    $decoded=cctv_base64url_decode($payload);if($decoded===false)return null;
    $claims=json_decode($decoded,true);
    if(!is_array($claims)||(int)($claims['exp']??0)<time()||(int)($claims['iat']??0)>time()+30)return null;
    return $claims;
}
function cctv_exec_schema(mysqli $db): bool {
    $ready=$db->query("SELECT 1 FROM erp_schema_migrations WHERE migration_key='20261007_10_cctv_foundation' LIMIT 1");
    if($ready&&$ready->num_rows>0)return false;
    $lock=$db->query("SELECT GET_LOCK('demosolar_erp_cctv_bootstrap',60)");
    $locked=(int)($lock?$lock->fetch_row()[0]??0:0)===1;
    if(!$locked)throw new RuntimeException('CCTV initialization is busy.');
    try{
        $sql=file_get_contents(__DIR__.'/migrate_cctv.sql');
        if(!is_string($sql)||trim($sql)===''||!$db->multi_query($sql))throw new RuntimeException('CCTV schema could not be initialized: '.$db->error);
        do{if($result=$db->store_result())$result->free();if(!$db->more_results())break;}while($db->next_result());
        if($db->errno)throw new RuntimeException('CCTV schema could not be initialized: '.$db->error);
    }finally{$db->query("SELECT RELEASE_LOCK('demosolar_erp_cctv_bootstrap')");}
    return true;
}
function cctv_seed_inventory(mysqli $db): void {
    $nvrs=[
        ['DEMOSOLAR_2_1','DEMOSOLAR 2.1','NVR302-32B-IQ','192.0.2.201',32],
        ['DEMOSOLAR_2_2','DEMOSOLAR 2.2','NVR302-32B-IQ','192.0.2.202',32],
        ['DEMOSOLAR_2_3','DEMOSOLAR 2.3','NVR302-32B-IQ','192.0.2.203',32],
        ['DEMOSOLAR_2_4','DEMOSOLAR 2.4','NVR301-16S3','192.0.2.205',16],
    ];
    $nvrStmt=$db->prepare('INSERT INTO erp_cctv_nvrs(code,device_name,model,host,max_channels) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE device_name=VALUES(device_name),model=VALUES(model),host=VALUES(host),max_channels=VALUES(max_channels)');
    $idStmt=$db->prepare('SELECT id FROM erp_cctv_nvrs WHERE code=? LIMIT 1');
    $cameraStmt=$db->prepare('INSERT INTO erp_cctv_cameras(nvr_id,channel_no,camera_name,stream_path_sub,stream_path_main,enabled) VALUES(?,?,?,?,?,1) ON DUPLICATE KEY UPDATE stream_path_sub=VALUES(stream_path_sub),stream_path_main=VALUES(stream_path_main)');
    if(!$nvrStmt||!$idStmt||!$cameraStmt)throw new RuntimeException('CCTV inventory preparation failed.');
    foreach($nvrs as [$code,$name,$model,$host,$channels]){
        $nvrStmt->bind_param('ssssi',$code,$name,$model,$host,$channels);$nvrStmt->execute();
        $idStmt->bind_param('s',$code);$idStmt->execute();$nvrId=(int)($idStmt->get_result()->fetch_row()[0]??0);
        $suffix=substr($host,strrpos($host,'.')+1);
        for($channel=1;$channel<=$channels;$channel++){
            $cameraName=sprintf('Camera %02d',$channel);
            $sub=sprintf('nvr%s_c%02d_sub',$suffix,$channel);$main=sprintf('nvr%s_c%02d_main',$suffix,$channel);
            $cameraStmt->bind_param('iisss',$nvrId,$channel,$cameraName,$sub,$main);$cameraStmt->execute();
        }
    }
    $nvrStmt->close();$idStmt->close();$cameraStmt->close();
}
function cctv_bootstrap(mysqli $db): void {
    if(cctv_exec_schema($db))cctv_seed_inventory($db);
}
function cctv_is_admin(array $user): bool {return strtolower((string)($user['role']??''))==='admin';}
function cctv_has_right(array $user,string $right): bool {
    if(cctv_is_admin($user))return true;
    $value=is_array($user['rights']??null)?($user['rights'][$right]??false):false;
    return $value===true||$value===1||$value==='1'||$value==='true';
}
function cctv_require_right(array $user,string $right): void {
    if(!cctv_has_right($user,$right))cctv_response(['status'=>'error','message'=>'Your User Rights do not allow this CCTV action.'],403);
}
function cctv_log(mysqli $db,array $user,?int $cameraId,string $action,string $details=''): void {
    $stmt=$db->prepare('INSERT INTO erp_cctv_access_log(user_legacy_id,username,camera_id,action_code,source_ip,details) VALUES(?,?,?,?,?,?)');
    if(!$stmt)return;$userId=(string)($user['id']??'');$username=(string)($user['username']??'');$source=substr((string)($_SERVER['REMOTE_ADDR']??''),0,45);$details=substr($details,0,500);
    $stmt->bind_param('ssisss',$userId,$username,$cameraId,$action,$source,$details);$stmt->execute();$stmt->close();
}
function cctv_camera_rows(mysqli $db,array $user): array {
    $all=cctv_is_admin($user)||cctv_has_right($user,'cctvAdmin');$userId=(string)($user['id']??'');
    $sql='SELECT c.id,c.channel_no,c.camera_name,c.location_name,c.stream_path_sub,c.stream_path_main,c.enabled,n.id AS nvr_id,n.code AS nvr_code,n.device_name,n.model,n.host,n.max_channels';
    if($all){$result=$db->query($sql.' FROM erp_cctv_cameras c JOIN erp_cctv_nvrs n ON n.id=c.nvr_id WHERE n.enabled=1 ORDER BY n.device_name,c.channel_no');}
    else{$stmt=$db->prepare($sql.',a.can_live,a.can_playback,a.can_download FROM erp_cctv_user_access a JOIN erp_cctv_cameras c ON c.id=a.camera_id JOIN erp_cctv_nvrs n ON n.id=c.nvr_id WHERE a.user_legacy_id=? AND c.enabled=1 AND n.enabled=1 AND (a.can_live=1 OR a.can_playback=1) ORDER BY n.device_name,c.channel_no');$stmt->bind_param('s',$userId);$stmt->execute();$result=$stmt->get_result();}
    if(!$result)throw new RuntimeException('CCTV inventory is unavailable.');$rows=[];
    while($row=$result->fetch_assoc()){$row['id']=(int)$row['id'];$row['nvr_id']=(int)$row['nvr_id'];$row['channel_no']=(int)$row['channel_no'];$row['max_channels']=(int)$row['max_channels'];$row['enabled']=(bool)$row['enabled'];if($all){$row['can_live']=true;$row['can_playback']=true;$row['can_download']=true;}else{foreach(['can_live','can_playback','can_download'] as $field)$row[$field]=(bool)$row[$field];}$rows[]=$row;}
    if(isset($stmt))$stmt->close();return $rows;
}

$action=strtolower(trim((string)($_GET['action']??'inventory')));
if($action==='gateway_auth'){
    if(($_SERVER['REQUEST_METHOD']??'GET')!=='POST')cctv_response(['status'=>'error'],405);
    $remote=(string)($_SERVER['REMOTE_ADDR']??'');
    if(!in_array($remote,['127.0.0.1','::1'],true))cctv_response(['status'=>'error'],403);
    $body=cctv_json_body();$config=cctv_config();$claims=cctv_validate_token((string)($body['token']??''),(string)$config['token_secret']);
    $path=trim((string)($body['path']??''),'/');$actionName=(string)($body['action']??'');$protocol=(string)($body['protocol']??'');
    if(!$claims||!hash_equals((string)($claims['path']??''),$path)||$actionName!=='read'||!in_array($protocol,['hls','webrtc'],true))cctv_response(['status'=>'error'],403);
    cctv_response(['status'=>'success']);
}

$user=require_erp_session(['admin','warehouse','security'],['cctv','cctvLive','cctvPlayback','cctvAdmin']);
$db=erp_guard_database();
try{cctv_bootstrap($db);}catch(Throwable $error){error_log('CCTV bootstrap failed: '.$error->getMessage());cctv_response(['status'=>'error','message'=>'CCTV setup could not be initialized. Contact IT.'],503);}

if($action==='inventory'&&($_SERVER['REQUEST_METHOD']??'GET')==='GET'){
    cctv_require_right($user,'cctvLive');$config=cctv_config();
    cctv_response(['status'=>'success','cameras'=>cctv_camera_rows($db,$user),'gatewayConfigured'=>strlen((string)$config['token_secret'])>=32]);
}
if($action==='playback_inventory'&&($_SERVER['REQUEST_METHOD']??'GET')==='GET'){
    cctv_require_right($user,'cctvPlayback');$config=cctv_config();
    cctv_response(['status'=>'success','cameras'=>cctv_camera_rows($db,$user),'gatewayConfigured'=>strlen((string)$config['token_secret'])>=32]);
}
if($action==='admin_data'&&($_SERVER['REQUEST_METHOD']??'GET')==='GET'){
    cctv_require_right($user,'cctvAdmin');$users=erp_guard_read_module($db,'DEMOSOLAR_USERS_PALLET_FORMAT_V7');$public=[];
    foreach($users as $record)if(is_array($record))$public[]=['id'=>(string)($record['id']??''),'name'=>(string)($record['name']??$record['username']??''),'username'=>(string)($record['username']??''),'department'=>(string)($record['department']??$record['role']??''),'status'=>(string)($record['status']??'')];
    $access=[];$result=$db->query('SELECT user_legacy_id,camera_id,can_live,can_playback,can_download FROM erp_cctv_user_access');if($result)while($row=$result->fetch_assoc())$access[]=['userId'=>(string)$row['user_legacy_id'],'cameraId'=>(int)$row['camera_id'],'live'=>(bool)$row['can_live'],'playback'=>(bool)$row['can_playback'],'download'=>(bool)$row['can_download']];
    cctv_response(['status'=>'success','users'=>$public,'cameras'=>cctv_camera_rows($db,$user),'access'=>$access]);
}
if($action==='save_camera'&&($_SERVER['REQUEST_METHOD']??'GET')==='POST'){
    cctv_require_right($user,'cctvAdmin');$body=cctv_json_body();$cameraId=(int)($body['cameraId']??0);$name=trim((string)($body['name']??''));$location=trim((string)($body['location']??''));$enabled=!empty($body['enabled'])?1:0;
    if($cameraId<=0||$name===''||mb_strlen($name)>160||mb_strlen($location)>160)cctv_response(['status'=>'error','message'=>'Enter a valid camera name and location.'],422);
    $stmt=$db->prepare('UPDATE erp_cctv_cameras SET camera_name=?,location_name=?,enabled=? WHERE id=?');$stmt->bind_param('ssii',$name,$location,$enabled,$cameraId);$stmt->execute();$changed=$stmt->affected_rows;$stmt->close();
    cctv_log($db,$user,$cameraId,'CAMERA_CONFIGURATION_UPDATED','Camera name, location or enabled status updated.');cctv_response(['status'=>'success','changed'=>$changed]);
}
if($action==='save_access'&&($_SERVER['REQUEST_METHOD']??'GET')==='POST'){
    cctv_require_right($user,'cctvAdmin');$body=cctv_json_body();$target=(string)($body['userId']??'');$rows=is_array($body['access']??null)?$body['access']:[];
    if($target==='')cctv_response(['status'=>'error','message'=>'Select an ERP user.'],422);
    $db->begin_transaction();
    try{$delete=$db->prepare('DELETE FROM erp_cctv_user_access WHERE user_legacy_id=?');$delete->bind_param('s',$target);$delete->execute();$delete->close();$insert=$db->prepare('INSERT INTO erp_cctv_user_access(user_legacy_id,camera_id,can_live,can_playback,can_download,granted_by) VALUES(?,?,?,?,?,?)');$grantedBy=(string)($user['username']??'');
        foreach($rows as $row){if(!is_array($row))continue;$cameraId=(int)($row['cameraId']??0);$live=!empty($row['live'])?1:0;$playback=!empty($row['playback'])?1:0;$download=!empty($row['download'])?1:0;if($cameraId<=0||(!$live&&!$playback&&!$download))continue;$insert->bind_param('siiiis',$target,$cameraId,$live,$playback,$download,$grantedBy);$insert->execute();}$insert->close();$db->commit();
    }catch(Throwable $error){$db->rollback();cctv_response(['status'=>'error','message'=>'Camera permissions could not be saved.'],500);}
    cctv_log($db,$user,null,'CAMERA_ACCESS_UPDATED','Updated camera access for ERP user ID '.$target.'.');cctv_response(['status'=>'success']);
}
if($action==='stream_token'&&($_SERVER['REQUEST_METHOD']??'GET')==='POST'){
    cctv_require_right($user,'cctvLive');$body=cctv_json_body();$cameraId=(int)($body['cameraId']??0);$quality=strtolower((string)($body['quality']??'sub'))==='main'?'main':'sub';$config=cctv_config();$secret=(string)$config['token_secret'];
    if(strlen($secret)<32)cctv_response(['status'=>'error','message'=>'The CCTV gateway secret has not been configured on the server.'],503);
    $allowed=null;foreach(cctv_camera_rows($db,$user) as $camera)if((int)$camera['id']===$cameraId&&$camera['can_live']){$allowed=$camera;break;}
    if(!$allowed)cctv_response(['status'=>'error','message'=>'You are not authorised to view this camera.'],403);$path=(string)$allowed[$quality==='main'?'stream_path_main':'stream_path_sub'];$now=time();
    $token=cctv_token(['sub'=>(string)($user['id']??''),'camera'=>$cameraId,'path'=>$path,'iat'=>$now,'exp'=>$now+(int)$config['token_lifetime_seconds'],'nonce'=>bin2hex(random_bytes(8))],$secret);
    cctv_log($db,$user,$cameraId,'LIVE_VIEW_TOKEN_ISSUED','Issued '.$quality.' stream access for '.$allowed['device_name'].' channel '.$allowed['channel_no'].'.');
    cctv_response(['status'=>'success','token'=>$token,'expiresIn'=>(int)$config['token_lifetime_seconds'],'streamUrl'=>(string)$config['gateway_public_base'].$path.'/index.m3u8']);
}
if($action==='playback_token'&&($_SERVER['REQUEST_METHOD']??'GET')==='POST'){
    cctv_require_right($user,'cctvPlayback');$body=cctv_json_body();$cameraId=(int)($body['cameraId']??0);$begin=(int)($body['begin']??0);$end=(int)($body['end']??0);$config=cctv_config();$secret=(string)$config['token_secret'];
    if(strlen($secret)<32)cctv_response(['status'=>'error','message'=>'The CCTV gateway secret has not been configured on the server.'],503);
    if($begin<=0||$end<=$begin||$end-$begin>21600||$end>time()+300)cctv_response(['status'=>'error','message'=>'Choose a valid recording range of up to 6 hours.'],422);
    $allowed=null;foreach(cctv_camera_rows($db,$user) as $camera)if((int)$camera['id']===$cameraId&&$camera['can_playback']){$allowed=$camera;break;}
    if(!$allowed)cctv_response(['status'=>'error','message'=>'You are not authorised to play recordings from this camera.'],403);
    $suffix=substr((string)$allowed['host'],strrpos((string)$allowed['host'],'.')+1);$path='play'.$suffix.'_c'.(int)$allowed['channel_no'].'_b'.$begin.'_e'.$end;$now=time();
    $token=cctv_token(['sub'=>(string)($user['id']??''),'camera'=>$cameraId,'path'=>$path,'iat'=>$now,'exp'=>$now+(int)$config['token_lifetime_seconds'],'nonce'=>bin2hex(random_bytes(8))],$secret);
    cctv_log($db,$user,$cameraId,'RECORDING_PLAYBACK_TOKEN_ISSUED','Playback requested for '.$allowed['device_name'].' channel '.$allowed['channel_no'].' from '.date('c',$begin).' to '.date('c',$end).'.');
    cctv_response(['status'=>'success','token'=>$token,'expiresIn'=>(int)$config['token_lifetime_seconds'],'streamUrl'=>(string)$config['gateway_public_base'].$path.'/index.m3u8']);
}
cctv_response(['status'=>'error','message'=>'Unsupported CCTV request.'],404);
