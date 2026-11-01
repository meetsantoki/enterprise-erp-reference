<?php
declare(strict_types=1);

function it_management_ready(mysqli $db): bool {
    $result=$db->query("SELECT 1 FROM erp_schema_migrations WHERE migration_key='20261016_12_it_management_settings' LIMIT 1");
    return (bool)($result&&$result->num_rows>0);
}
function it_management_bootstrap(mysqli $db): void {
    if(it_management_ready($db))return;
    $result=$db->query("SELECT GET_LOCK('demosolar_erp_it_management_bootstrap',60)");
    if((int)($result?$result->fetch_row()[0]??0:0)!==1)throw new RuntimeException('IT Management initialization is busy.');
    try{
        if(it_management_ready($db))return;
        $sql=file_get_contents(__DIR__.'/migrate_it_management.sql');
        if(!is_string($sql)||trim($sql)===''||!$db->multi_query($sql))throw new RuntimeException('IT Management schema could not be initialized: '.$db->error);
        do{if($set=$db->store_result())$set->free();if(!$db->more_results())break;}while($db->next_result());
        if($db->errno)throw new RuntimeException('IT Management schema could not be initialized: '.$db->error);
    }finally{$db->query("SELECT RELEASE_LOCK('demosolar_erp_it_management_bootstrap')");}
}
function it_apply_session_settings(mysqli $db,array $config): array {
    $cached=$_SESSION['erp_session_settings_cache']??null;
    if(is_array($cached)&&(time()-(int)($cached['cached_at']??0))<300){
        $config['session_idle_seconds']=(int)($cached['idle']??$config['session_idle_seconds']);
        $config['session_absolute_seconds']=(int)($cached['absolute']??$config['session_absolute_seconds']);
        return $config;
    }
    if(!it_management_ready($db))return $config;
    $result=$db->query("SELECT setting_key,setting_value FROM erp_it_settings WHERE setting_key IN ('session_idle_seconds','session_absolute_seconds')");
    while($result&&$row=$result->fetch_assoc()){
        $value=(int)$row['setting_value'];
        if($row['setting_key']==='session_idle_seconds')$config['session_idle_seconds']=min(86400,max(300,$value));
        if($row['setting_key']==='session_absolute_seconds')$config['session_absolute_seconds']=min(604800,max(1800,$value));
    }
    $_SESSION['erp_session_settings_cache']=['cached_at'=>time(),'idle'=>(int)$config['session_idle_seconds'],'absolute'=>(int)$config['session_absolute_seconds']];
    return $config;
}
function it_session_hash(?string $id=null): string {return hash('sha256',$id??session_id());}
function it_register_session(mysqli $db,array $user,array $config): void {
    if(!it_management_ready($db)||session_id()==='')return;
    $hash=it_session_hash();$legacy=(string)($user['id']??'');$username=(string)($user['username']??'');
    $started=(int)($_SESSION['erp_started']??time());
    $expires=date('Y-m-d H:i:s',$started+max(300,(int)($config['session_absolute_seconds']??28800)));
    $ip=substr((string)($_SERVER['REMOTE_ADDR']??''),0,45);$agent=substr((string)($_SERVER['HTTP_USER_AGENT']??''),0,500);
    $stmt=$db->prepare('INSERT INTO erp_active_sessions(session_hash,user_legacy_id,username,login_at,last_seen,expires_at,source_ip,user_agent,revoked_at,revoked_by) VALUES(?,?,?,NOW(),NOW(),?,?,?,NULL,NULL) ON DUPLICATE KEY UPDATE user_legacy_id=VALUES(user_legacy_id),username=VALUES(username),last_seen=NOW(),expires_at=VALUES(expires_at),source_ip=VALUES(source_ip),user_agent=VALUES(user_agent)');
    if(!$stmt)return;$stmt->bind_param('ssssss',$hash,$legacy,$username,$expires,$ip,$agent);$stmt->execute();$stmt->close();
    // Keep the security history useful without letting expired sessions grow forever.
    // This runs only while registering a session, not on every API request.
    $db->query("DELETE FROM erp_active_sessions WHERE (revoked_at IS NOT NULL OR expires_at<NOW()) AND last_seen<DATE_SUB(NOW(),INTERVAL 7 DAY)");
}
function it_rotate_session(mysqli $db,array $user,array $config): void {
    if(session_id()==='')return;
    $oldHash=it_session_hash();
    session_regenerate_id(true);
    if(it_management_ready($db)){
        $rotatedBy=(string)($user['username']??'SYSTEM');
        $stmt=$db->prepare("UPDATE erp_active_sessions SET revoked_at=COALESCE(revoked_at,NOW()),revoked_by=COALESCE(revoked_by,CONCAT(?,':ROTATED')) WHERE session_hash=?");
        if($stmt){$stmt->bind_param('ss',$rotatedBy,$oldHash);$stmt->execute();$stmt->close();}
        it_register_session($db,$user,$config);
    }
}
function it_validate_session(mysqli $db,array $user,array $config): bool {
    if(!it_management_ready($db)||session_id()==='')return true;
    $hash=it_session_hash();$stmt=$db->prepare('SELECT revoked_at,expires_at FROM erp_active_sessions WHERE session_hash=? LIMIT 1');
    if(!$stmt)return false;$stmt->bind_param('s',$hash);$stmt->execute();$row=$stmt->get_result()->fetch_assoc();$stmt->close();
    if(!$row){it_register_session($db,$user,$config);return true;}
    if(!empty($row['revoked_at'])||strtotime((string)$row['expires_at'])<time())return false;
    if(time()-(int)($_SESSION['erp_db_last_seen_at']??0)>=60){$stmt=$db->prepare('UPDATE erp_active_sessions SET last_seen=NOW() WHERE session_hash=?');if($stmt){$stmt->bind_param('s',$hash);$stmt->execute();$stmt->close();$_SESSION['erp_db_last_seen_at']=time();}}
    return true;
}
function it_revoke_current_session(mysqli $db,string $by): void {
    if(!it_management_ready($db)||session_id()==='')return;$hash=it_session_hash();
    $stmt=$db->prepare('UPDATE erp_active_sessions SET revoked_at=COALESCE(revoked_at,NOW()),revoked_by=COALESCE(revoked_by,?) WHERE session_hash=?');if($stmt){$stmt->bind_param('ss',$by,$hash);$stmt->execute();$stmt->close();}
}
