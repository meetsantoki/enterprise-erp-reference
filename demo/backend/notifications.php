<?php
declare(strict_types=1);

/** Database-backed, per-user ERP notifications. */
function erp_notifications_ensure_schema(mysqli $db): void {
  if (!$db->query("CREATE TABLE IF NOT EXISTS erp_user_notifications (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_legacy_id VARCHAR(100) NULL,
    username VARCHAR(100) NOT NULL,
    notification_type VARCHAR(24) NOT NULL DEFAULT 'INFO',
    category VARCHAR(32) NOT NULL DEFAULT 'SYSTEM',
    priority VARCHAR(16) NOT NULL DEFAULT 'NORMAL',
    title VARCHAR(180) NOT NULL,
    message VARCHAR(1000) NOT NULL,
    entity_type VARCHAR(80) NULL,
    entity_id VARCHAR(160) NULL,
    target_view VARCHAR(100) NULL,
    target_payload_json LONGTEXT NULL,
    approval_group_key VARCHAR(190) NULL,
    actionable TINYINT(1) NOT NULL DEFAULT 0,
    action_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    processed_by VARCHAR(100) NULL,
    processed_at DATETIME NULL,
    audit_event_id BIGINT UNSIGNED NULL,
    audit_legacy_id VARCHAR(100) NULL,
    read_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_erp_notification_user_time (username,created_at,id),
    KEY idx_erp_notification_user_unread (username,read_at,id),
    KEY idx_erp_notification_group (approval_group_key,action_status),
    KEY idx_erp_notification_audit (audit_event_id,audit_legacy_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci")) {
    throw new RuntimeException('Notification storage could not be prepared.');
  }
}

function erp_notification_text($value, int $length): string {
  $text=trim(preg_replace('/[\x00-\x1F\x7F]/u',' ',(string)($value??''))??'');
  return function_exists('mb_substr')?mb_substr($text,0,$length,'UTF-8'):substr($text,0,$length);
}

function erp_notification_audit_link(mysqli $db, ?array $audit): array {
  $legacy=erp_notification_text($audit['entry']['id']??'',100);
  if($legacy==='')return [null,null];
  $stmt=$db->prepare('SELECT id FROM erp_audit_events WHERE legacy_id=? LIMIT 1');
  if(!$stmt)return [null,$legacy];
  $stmt->bind_param('s',$legacy);$stmt->execute();$row=$stmt->get_result()->fetch_assoc();$stmt->close();
  return [$row?(int)$row['id']:null,$legacy];
}

function erp_notification_create(mysqli $db, array $recipient, array $notice): int {
  erp_notifications_ensure_schema($db);
  $username=erp_notification_text($recipient['username']??'',100);
  if($username===''||strtoupper((string)($recipient['status']??'ACTIVE'))!=='ACTIVE')return 0;
  $legacyId=erp_notification_text($recipient['id']??'',100)?:null;
  $type=strtoupper(erp_notification_text($notice['type']??'INFO',24))?:'INFO';
  $category=strtoupper(erp_notification_text($notice['category']??'SYSTEM',32))?:'SYSTEM';
  $priority=strtoupper(erp_notification_text($notice['priority']??'NORMAL',16))?:'NORMAL';
  $title=erp_notification_text($notice['title']??'Notification',180);
  $message=erp_notification_text($notice['message']??'',1000);
  $entityType=erp_notification_text($notice['entityType']??'',80)?:null;
  $entityId=erp_notification_text($notice['entityId']??'',160)?:null;
  $targetView=erp_notification_text($notice['targetView']??'',100)?:null;
  $payload=is_array($notice['targetPayload']??null)?json_encode($notice['targetPayload'],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES):null;
  $group=erp_notification_text($notice['approvalGroupKey']??'',190)?:null;
  $actionable=!empty($notice['actionable'])?1:0;
  $actionStatus=$actionable?'PENDING':'PROCESSED';
  $auditId=isset($notice['auditEventId'])?(int)$notice['auditEventId']:null;
  $auditLegacy=erp_notification_text($notice['auditLegacyId']??'',100)?:null;
  $stmt=$db->prepare('INSERT INTO erp_user_notifications(user_legacy_id,username,notification_type,category,priority,title,message,entity_type,entity_id,target_view,target_payload_json,approval_group_key,actionable,action_status,audit_event_id,audit_legacy_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  if(!$stmt)throw new RuntimeException('Notification could not be prepared.');
  $stmt->bind_param('ssssssssssssisis',$legacyId,$username,$type,$category,$priority,$title,$message,$entityType,$entityId,$targetView,$payload,$group,$actionable,$actionStatus,$auditId,$auditLegacy);
  if(!$stmt->execute()){ $stmt->close(); throw new RuntimeException('Notification could not be saved.'); }
  $id=(int)$stmt->insert_id;$stmt->close();return $id;
}

function erp_notification_recipients_for_right(mysqli $db, string $right): array {
  $recipients=[];
  foreach(all_users($db) as $user){
    if(!is_array($user)||strtoupper((string)($user['status']??''))!=='ACTIVE')continue;
    if(admin($user)||has_assigned_right($user,[$right]))$recipients[strtolower((string)($user['username']??''))]=$user;
  }
  return array_values(array_filter($recipients,fn($user)=>trim((string)($user['username']??''))!==''));
}

function erp_notification_send_to_right(mysqli $db, string $right, array $notice, string $excludeUsername=''): int {
  $count=0;
  foreach(erp_notification_recipients_for_right($db,$right) as $recipient){
    if($excludeUsername!==''&&strcasecmp((string)$recipient['username'],$excludeUsername)===0)continue;
    if(erp_notification_create($db,$recipient,$notice)>0)$count++;
  }
  return $count;
}

function erp_notification_send_to_username(mysqli $db, string $username, array $notice): int {
  foreach(all_users($db) as $recipient){
    if(is_array($recipient)&&strcasecmp((string)($recipient['username']??''),$username)===0)return erp_notification_create($db,$recipient,$notice);
  }
  return 0;
}

/** Resolves every manager copy in the same approval group atomically. */
function erp_notification_resolve_group(mysqli $db, string $groupKey, string $processedBy, ?int $auditId=null, ?string $auditLegacyId=null): int {
  erp_notifications_ensure_schema($db);
  $groupKey=erp_notification_text($groupKey,190);$processedBy=erp_notification_text($processedBy,100);
  if($groupKey==='')return 0;
  $stmt=$db->prepare("UPDATE erp_user_notifications SET action_status='PROCESSED',processed_by=?,processed_at=NOW(),audit_event_id=COALESCE(?,audit_event_id),audit_legacy_id=COALESCE(?,audit_legacy_id),updated_at=NOW() WHERE approval_group_key=? AND action_status='PENDING'");
  if(!$stmt)throw new RuntimeException('Approval notifications could not be resolved.');
  $stmt->bind_param('siss',$processedBy,$auditId,$auditLegacyId,$groupKey);$stmt->execute();$changed=$stmt->affected_rows;$stmt->close();return $changed;
}

function erp_notifications_handle(mysqli $db, array $actor, string $method): void {
  erp_notifications_ensure_schema($db);
  $username=erp_notification_text($actor['username']??'',100);
  if($method==='GET'){
    $filter=strtolower(erp_notification_text($_GET['filter']??'all',20));
    $limit=min(100,max(10,(int)($_GET['limit']??50)));
    $conditions=['username=?'];
    if($filter==='unread')$conditions[]='read_at IS NULL';
    elseif($filter==='approvals')$conditions[]="category='APPROVAL'";
    elseif($filter==='system')$conditions[]="category='SYSTEM'";
    $where=implode(' AND ',$conditions);
    $stmt=$db->prepare("SELECT id,notification_type,category,priority,title,message,entity_type,entity_id,target_view,target_payload_json,approval_group_key,actionable,action_status,processed_by,processed_at,audit_event_id,audit_legacy_id,read_at,created_at,updated_at FROM erp_user_notifications WHERE {$where} ORDER BY created_at DESC,id DESC LIMIT {$limit}");
    if(!$stmt)respond(['status'=>'error','message'=>'Notifications could not be loaded.'],500);
    $stmt->bind_param('s',$username);$stmt->execute();$result=$stmt->get_result();$notifications=[];
    while($row=$result->fetch_assoc()){
      $payload=json_decode((string)($row['target_payload_json']??''),true);
      $notifications[]=['id'=>(int)$row['id'],'type'=>(string)$row['notification_type'],'category'=>(string)$row['category'],'priority'=>(string)$row['priority'],'title'=>(string)$row['title'],'message'=>(string)$row['message'],'entityType'=>(string)($row['entity_type']??''),'entityId'=>(string)($row['entity_id']??''),'targetView'=>(string)($row['target_view']??''),'targetPayload'=>is_array($payload)?$payload:[],'approvalGroupKey'=>(string)($row['approval_group_key']??''),'actionable'=>(bool)$row['actionable'],'actionStatus'=>(string)$row['action_status'],'processedBy'=>(string)($row['processed_by']??''),'processedAt'=>$row['processed_at'],'auditEventId'=>$row['audit_event_id']===null?null:(int)$row['audit_event_id'],'auditLegacyId'=>(string)($row['audit_legacy_id']??''),'read'=>(bool)$row['read_at'],'readAt'=>$row['read_at'],'createdAt'=>(string)$row['created_at'],'updatedAt'=>(string)$row['updated_at']];
    }
    $stmt->close();$countStmt=$db->prepare('SELECT COUNT(*) AS n FROM erp_user_notifications WHERE username=? AND read_at IS NULL');$countStmt->bind_param('s',$username);$countStmt->execute();$unread=(int)($countStmt->get_result()->fetch_assoc()['n']??0);$countStmt->close();
    respond(['status'=>'success','notifications'=>$notifications,'unreadCount'=>$unread,'serverTime'=>date(DATE_ATOM)]);
  }
  if($method==='POST'){
    $data=json_body();$operation=(string)($data['operation']??'');
    if($operation==='mark_read'){
      $id=(int)($data['id']??0);$stmt=$db->prepare('UPDATE erp_user_notifications SET read_at=COALESCE(read_at,NOW()) WHERE id=? AND username=?');$stmt->bind_param('is',$id,$username);$stmt->execute();$stmt->close();respond(['status'=>'success']);
    }
    if($operation==='mark_all_read'){
      $stmt=$db->prepare('UPDATE erp_user_notifications SET read_at=COALESCE(read_at,NOW()) WHERE username=? AND read_at IS NULL');$stmt->bind_param('s',$username);$stmt->execute();$changed=$stmt->affected_rows;$stmt->close();respond(['status'=>'success','changed'=>$changed]);
    }
    respond(['status'=>'error','message'=>'Unsupported notification operation.'],400);
  }
  respond(['status'=>'error','message'=>'Unsupported notification request.'],405);
}
