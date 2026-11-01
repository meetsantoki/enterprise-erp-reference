<?php
/**
 * Transactional mirror from the browser-compatible module arrays into the
 * normalized ERP tables. The module-state row is retained as a reversible
 * compatibility snapshot; reports and future APIs can use relational rows.
 */
declare(strict_types=1);

function rr_text($value, int $max = 500): string {
    $value = trim(preg_replace('/[\x00-\x1F\x7F]/u', ' ', (string)($value ?? '')) ?? '');
    return mb_substr($value, 0, $max);
}
function rr_number($value): float { return is_numeric($value) ? (float)$value : 0.0; }
function rr_json($value): string { return json_encode($value, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES) ?: '{}'; }
function rr_date($value): ?string {
    $raw=rr_text($value,40); if($raw==='')return null;
    foreach(['Y-m-d','d/m/Y','d-m-Y','m/d/Y'] as $format){$date=DateTime::createFromFormat('!'.$format,$raw);if($date&&$date->format($format)===$raw)return $date->format('Y-m-d');}
    $time=strtotime($raw); return $time===false?null:date('Y-m-d',$time);
}
function rr_datetime($value): ?string {$raw=rr_text($value,80);if($raw==='')return null;$time=strtotime($raw);return $time===false?null:date('Y-m-d H:i:s',$time);}
function rr_slug(string $value,string $fallback): string {$value=strtoupper(preg_replace('/[^A-Za-z0-9]+/','_',trim($value))??'');$value=trim($value,'_');return mb_substr($value!==''?$value:$fallback,0,60);}
function rr_exec(mysqli $db,string $sql,string $types='',array $params=[]): void {
    if($types!==''&&strlen($types)!==count($params))throw new RuntimeException('Relational bind mismatch: '.strlen($types).' types for '.count($params).' values in '.substr(preg_replace('/\s+/',' ',$sql)??$sql,0,120));
    $stmt=$db->prepare($sql);if(!$stmt)throw new RuntimeException('Relational statement could not be prepared.');
    if($types!=='')$stmt->bind_param($types,...$params);
    if(!$stmt->execute()){$stmt->close();throw new RuntimeException('Relational database operation failed.');}
    $stmt->close();
}
function rr_scalar(mysqli $db,string $sql,string $types='',array $params=[]){$stmt=$db->prepare($sql);if(!$stmt)return null;if($types!=='')$stmt->bind_param($types,...$params);$stmt->execute();$row=$stmt->get_result()->fetch_row();$stmt->close();return $row[0]??null;}
function rr_ready(mysqli $db): bool {
    static $ready=null;if($ready!==null)return $ready;
    $result=$db->query("SELECT 1 FROM erp_schema_migrations WHERE migration_key='20260930_06_relational_runtime' LIMIT 1");
    return $ready=(bool)($result&&$result->num_rows>0);
}
function rr_module_keys(): array {return [
 'DEMOSOLAR_DEPARTMENTS_MASTER_V1','DEMOSOLAR_USERS_PALLET_FORMAT_V7','DEMOSOLAR_PRODUCTS_PALLET_FORMAT_V7',
 'DEMOSOLAR_CUSTOMERS_MASTER_V1','DEMOSOLAR_SALES_PEOPLE_V1','DEMOSOLAR_SALES_ORDERS_V1',
 'DEMOSOLAR_POS_PALLET_FORMAT_V7','DEMOSOLAR_PRODUCTION_SHEET_V1','DEMOSOLAR_PRODUCTION_DAILY_V1',
 'DEMOSOLAR_STORE_SERIALS_STORAGE_V1','DEMOSOLAR_STOCK_PALLET_FORMAT_V7','DEMOSOLAR_STOCK_BOOKINGS_V1',
 'DEMOSOLAR_TRANSPORTERS_MASTER_V7','DEMOSOLAR_DRIVERS_MASTER_V7','DEMOSOLAR_ACCOUNT_INVOICES_V1',
 'DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7','DEMOSOLAR_ACCOUNT_RECEIPTS_V1','DEMOSOLAR_VEHICLE_BOOKINGS_V1',
 'DEMOSOLAR_ROUTE_FARES_V1','DEMOSOLAR_SALES_CO_REGISTRY_V1','DEMOSOLAR_CO_ALLOCATIONS_V1',
 'DEMOSOLAR_DELETION_REQUESTS_V1','DEMOSOLAR_REQUEST_ROUTES_V1','DEMOSOLAR_PURCHASE_VENDORS_V1','DEMOSOLAR_PURCHASE_ORDERS_V1'
];}
function rr_migration_applied(mysqli $db,string $key): bool {
    $escaped=$db->real_escape_string($key);
    $result=$db->query("SELECT 1 FROM erp_schema_migrations WHERE migration_key='{$escaped}' LIMIT 1");
    return (bool)($result&&$result->num_rows>0);
}
function rr_table_exists(mysqli $db,string $table): bool {$table=$db->real_escape_string($table);$result=$db->query("SHOW TABLES LIKE '{$table}'");return (bool)($result&&$result->num_rows>0);}
function rr_apply_schema_file(mysqli $db): void {
    $path=__DIR__.'/migrate_relational_runtime.sql';
    $sql=is_file($path)?file_get_contents($path):false;
    if(!is_string($sql)||trim($sql)==='')throw new RuntimeException('Relational migration file is missing.');
    if(!$db->multi_query($sql))throw new RuntimeException('Relational schema upgrade failed: '.$db->error);
    do{if($result=$db->store_result())$result->free();if(!$db->more_results())break;}while($db->next_result());
    if($db->errno)throw new RuntimeException('Relational schema upgrade failed: '.$db->error);
}
function rr_bootstrap_database(mysqli $db): void {
    $required=['20260930_08_runtime_records_authority','20261001_09_sales_order_physical_delete','20261016_10_user_permissions_authority','20261030_11_runtime_snapshot_compaction'];
    $quoted=implode(',',array_map(static fn(string $key): string=>"'".$db->real_escape_string($key)."'",$required));
    $result=$db->query("SELECT migration_key FROM erp_schema_migrations WHERE migration_key IN ({$quoted})");$applied=[];
    if($result)while($row=$result->fetch_assoc())$applied[(string)$row['migration_key']]=true;
    $runtimeReady=isset($applied['20260930_08_runtime_records_authority']);
    $deleteCleanupReady=isset($applied['20261001_09_sales_order_physical_delete']);
    $permissionsReady=isset($applied['20261016_10_user_permissions_authority']);
    $snapshotCompactionReady=isset($applied['20261030_11_runtime_snapshot_compaction']);
    if($runtimeReady&&$deleteCleanupReady&&$permissionsReady&&$snapshotCompactionReady)return;
    $lock=rr_scalar($db,"SELECT GET_LOCK('demosolar_erp_relational_bootstrap',120)");
    if((int)$lock!==1)throw new RuntimeException('Relational database initialization is busy.');
    try{
        if(!rr_migration_applied($db,'20260930_06_relational_runtime')||!rr_table_exists($db,'erp_runtime_records'))rr_apply_schema_file($db);
        @set_time_limit(300);
        $db->begin_transaction();
        try{
            if(!rr_migration_applied($db,'20260930_08_runtime_records_authority')){
                foreach(rr_module_keys() as $key){$value=module_state_read_for_update($db,$key);rr_sync_module($db,$key,is_array($value)?$value:[]);}
                rr_exec($db,"INSERT INTO erp_schema_migrations(migration_key,details) VALUES('20260930_07_relational_initial_sync','Automatic first-run synchronization completed') ON DUPLICATE KEY UPDATE applied_at=CURRENT_TIMESTAMP,details=VALUES(details)");
                rr_exec($db,"INSERT INTO erp_schema_migrations(migration_key,details) VALUES('20260930_08_runtime_records_authority','Record-level relational runtime activated') ON DUPLICATE KEY UPDATE applied_at=CURRENT_TIMESTAMP,details=VALUES(details)");
            }
            if(!rr_migration_applied($db,'20261001_09_sales_order_physical_delete')){
                rr_purge_approved_sales_order_deletions($db,true);
                rr_exec($db,"INSERT INTO erp_schema_migrations(migration_key,details) VALUES('20261001_09_sales_order_physical_delete','Approved Sales Order deletions physically reconciled across runtime and normalized tables') ON DUPLICATE KEY UPDATE applied_at=CURRENT_TIMESTAMP,details=VALUES(details)");
            }
            if(!rr_migration_applied($db,'20261016_10_user_permissions_authority')){
                [$org]=rr_context($db);
                $users=rr_runtime_is_authoritative($db,'DEMOSOLAR_USERS_PALLET_FORMAT_V7')
                    ?rr_runtime_read_records($db,'DEMOSOLAR_USERS_PALLET_FORMAT_V7',true)
                    :module_state_read_for_update($db,'DEMOSOLAR_USERS_PALLET_FORMAT_V7');
                rr_sync_users($db,$org,is_array($users)?$users:[]);
                rr_exec($db,"INSERT INTO erp_schema_migrations(migration_key,details) VALUES('20261016_10_user_permissions_authority','User Rights migrated to erp_user_permissions and activated as the authorization source') ON DUPLICATE KEY UPDATE applied_at=CURRENT_TIMESTAMP,details=VALUES(details)");
            }
            if(!rr_migration_applied($db,'20261030_11_runtime_snapshot_compaction')){
                $authoritativeKeys=['DEMOSOLAR_PRODUCTS_PALLET_FORMAT_V7','DEMOSOLAR_POS_PALLET_FORMAT_V7','DEMOSOLAR_STORE_SERIALS_STORAGE_V1','DEMOSOLAR_STOCK_PALLET_FORMAT_V7','DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7'];
                $placeholders=implode(',',array_fill(0,count($authoritativeKeys),'?'));
                $statement=$db->prepare("UPDATE erp_module_state SET payload_json='[]' WHERE module_key IN ({$placeholders})");
                if(!$statement)throw new RuntimeException('Runtime snapshot compaction could not be prepared.');
                $types=str_repeat('s',count($authoritativeKeys));$statement->bind_param($types,...$authoritativeKeys);$statement->execute();$statement->close();
                rr_exec($db,"INSERT INTO erp_schema_migrations(migration_key,details) VALUES('20261030_11_runtime_snapshot_compaction','Redundant large JSON snapshots cleared after row-level runtime authority verification') ON DUPLICATE KEY UPDATE applied_at=CURRENT_TIMESTAMP,details=VALUES(details)");
            }
            $db->commit();
        }catch(Throwable $error){$db->rollback();throw $error;}
    }finally{$db->query("SELECT RELEASE_LOCK('demosolar_erp_relational_bootstrap')");}
}
function rr_context(mysqli $db): array {
    rr_exec($db,"INSERT INTO erp_organizations(code,legal_name) VALUES('DEMOSOLAR','DEMOSOLAR INDUSTRIES PRIVATE LIMITED') ON DUPLICATE KEY UPDATE legal_name=VALUES(legal_name)");
    $org=(int)rr_scalar($db,"SELECT id FROM erp_organizations WHERE code='DEMOSOLAR'");
    rr_exec($db,"INSERT INTO erp_plants(organization_id,code,name,timezone) VALUES(?,'MAIN','Main Manufacturing Plant','Asia/Calcutta') ON DUPLICATE KEY UPDATE name=VALUES(name)",'i',[$org]);
    $plant=(int)rr_scalar($db,"SELECT id FROM erp_plants WHERE organization_id=? AND code='MAIN'",'i',[$org]);
    return [$org,$plant];
}
function rr_customer_id(mysqli $db,int $org,string $name): ?int {$name=rr_text($name,200);if($name==='')return null;$id=rr_scalar($db,'SELECT id FROM erp_customers WHERE organization_id=? AND customer_name=? LIMIT 1','is',[$org,$name]);if($id)return (int)$id;$code='CUST_'.strtoupper(substr(hash('sha256',$name),0,16));rr_exec($db,'INSERT INTO erp_customers(organization_id,customer_code,customer_name) VALUES(?,?,?) ON DUPLICATE KEY UPDATE customer_name=VALUES(customer_name)','iss',[$org,$code,$name]);return (int)rr_scalar($db,'SELECT id FROM erp_customers WHERE organization_id=? AND customer_code=?','is',[$org,$code]);}
function rr_sales_order_id(mysqli $db,int $org,string $co): ?int {$co=rr_text($co,100);if($co==='')return null;$id=rr_scalar($db,'SELECT id FROM erp_sales_orders WHERE organization_id=? AND co_number=?','is',[$org,$co]);return $id===null?null:(int)$id;}
function rr_production_order_id(mysqli $db,int $org,string $po): ?int {$po=rr_text($po,100);if($po==='')return null;$id=rr_scalar($db,'SELECT id FROM erp_production_orders WHERE organization_id=? AND po_number=?','is',[$org,$po]);return $id===null?null:(int)$id;}
function rr_transporter_id(mysqli $db,int $org,string $name): ?int {$name=rr_text($name,200);if($name==='')return null;$id=rr_scalar($db,'SELECT id FROM erp_transporters WHERE organization_id=? AND transporter_name=? LIMIT 1','is',[$org,$name]);return $id===null?null:(int)$id;}
function rr_invoice_id(mysqli $db,int $org,string $number): ?int {$number=rr_text($number,100);if($number==='')return null;$id=rr_scalar($db,'SELECT id FROM erp_account_invoices WHERE organization_id=? AND invoice_number=?','is',[$org,$number]);return $id===null?null:(int)$id;}
function rr_product_id(mysqli $db,int $org,string $model,float $watt): ?int {$model=rr_text($model,200);if($model==='')return null;$id=rr_scalar($db,'SELECT id FROM erp_products WHERE organization_id=? AND model_name=? ORDER BY ABS(wattage-?) LIMIT 1','isd',[$org,$model,$watt]);return $id===null?null:(int)$id;}
function rr_record_id(array $row,string $prefix): string {$id=rr_text($row['id']??'',100);return $id!==''?$id:$prefix.'_'.strtoupper(substr(hash('sha256',rr_json($row)),0,20));}
function rr_sales_order_dependency_count(mysqli $db,int $orderId): int {
    $total=0;
    foreach(['erp_stock_bookings','erp_account_invoices','erp_dispatches','erp_account_receipts','erp_vehicle_bookings'] as $table){
        $total+=(int)rr_scalar($db,"SELECT COUNT(*) FROM {$table} WHERE sales_order_id=?",'i',[$orderId]);
    }
    return $total;
}
function rr_delete_sales_order_row(mysqli $db,int $orderId): void {
    rr_exec($db,'DELETE FROM erp_co_allocations WHERE sales_order_id=?','i',[$orderId]);
    rr_exec($db,'DELETE FROM erp_sales_co_registry WHERE sales_order_id=?','i',[$orderId]);
    rr_exec($db,'DELETE FROM erp_sales_orders WHERE id=?','i',[$orderId]);
    if((int)rr_scalar($db,'SELECT COUNT(*) FROM erp_sales_orders WHERE id=?','i',[$orderId])!==0)throw new RuntimeException('The deleted Sales Order could not be removed from the relational database.');
}
function rr_prepare_reused_sales_order_number(mysqli $db,int $org,string $co,string $newLegacy): void {
    $stmt=$db->prepare('SELECT id,legacy_id FROM erp_sales_orders WHERE organization_id=? AND co_number=? LIMIT 1');
    if(!$stmt)throw new RuntimeException('Sales Order lookup could not be prepared.');
    $stmt->bind_param('is',$org,$co);$stmt->execute();$existing=$stmt->get_result()->fetch_assoc();$stmt->close();
    if(!$existing||hash_equals((string)($existing['legacy_id']??''),$newLegacy))return;
    $orderId=(int)$existing['id'];
    if(rr_sales_order_dependency_count($db,$orderId)>0)throw new RuntimeException("CO {$co} has linked financial or operational records and cannot be reused.");
    rr_delete_sales_order_row($db,$orderId);
}
function rr_runtime_record_key($row,int $position): string {
    if(is_array($row))foreach(['id','coNumber','invoiceNumber','invoice','pallet','poNumber','username','gst','name'] as $field){$value=rr_text($row[$field]??'',150);if($value!=='')return strtoupper($field).':'.strtoupper($value);}
    if(!is_array($row))return 'VALUE:'.strtoupper(substr(hash('sha256',rr_json($row)),0,24));
    return 'ROW:'.($position+1).':'.strtoupper(substr(hash('sha256',rr_json($row)),0,24));
}
function rr_runtime_existing_index(mysqli $db,string $key): array {
    $stmt=$db->prepare('SELECT record_key,position_no,payload_hash FROM erp_runtime_records WHERE module_key=?');
    if(!$stmt)throw new RuntimeException('Relational runtime index could not be prepared.');
    $stmt->bind_param('s',$key);$stmt->execute();$result=$stmt->get_result();$index=[];
    while($row=$result->fetch_assoc())$index[(string)$row['record_key']]=['position'=>(int)$row['position_no'],'hash'=>(string)$row['payload_hash']];
    $stmt->close();return $index;
}
function rr_runtime_entries(array $rows): array {
    $entries=[];$seen=[];
    foreach(array_values($rows) as $position=>$row){
        $recordKey=rr_runtime_record_key($row,$position);if(isset($seen[$recordKey]))$recordKey.=':'.($position+1);$seen[$recordKey]=true;
        $json=rr_json($row);$entries[$recordKey]=['row'=>$row,'position'=>$position,'json'=>$json,'hash'=>hash('sha256',$json)];
    }
    return $entries;
}
/**
 * Persist only changed runtime rows. The former implementation executed one
 * large JSON upsert for every record on every save; stock approval therefore
 * rewrote every pallet and all serial payloads even when one pallet changed.
 */
function rr_runtime_write_records(mysqli $db,string $key,array $rows,?array $existing=null,?array $entries=null): void {
    $existing=$existing??rr_runtime_existing_index($db,$key);$entries=$entries??rr_runtime_entries($rows);
    if(!$entries){rr_exec($db,'DELETE FROM erp_runtime_records WHERE module_key=?','s',[$key]);return;}
    $positionChanges=[];
    foreach($entries as $recordKey=>$entry){
        $prior=$existing[$recordKey]??null;
        if(!$prior||!hash_equals((string)$prior['hash'],(string)$entry['hash'])){
            rr_exec($db,'INSERT INTO erp_runtime_records(module_key,record_key,position_no,payload_json,payload_hash) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE position_no=VALUES(position_no),payload_json=VALUES(payload_json),payload_hash=VALUES(payload_hash),row_revision=IF(payload_hash=VALUES(payload_hash),row_revision,row_revision+1),updated_at=CURRENT_TIMESTAMP','ssiss',[$key,$recordKey,$entry['position'],$entry['json'],$entry['hash']]);
        }elseif((int)$prior['position']!==(int)$entry['position'])$positionChanges[$recordKey]=(int)$entry['position'];
    }
    foreach(array_chunk($positionChanges,300,true) as $chunk){
        $case=[];$params=[];$types='';
        foreach($chunk as $recordKey=>$position){$case[]='WHEN ? THEN ?';$params[]=$recordKey;$params[]=$position;$types.='si';}
        $keys=array_keys($chunk);$placeholders=implode(',',array_fill(0,count($keys),'?'));
        $params[]=$key;$types.='s';foreach($keys as $recordKey){$params[]=$recordKey;$types.='s';}
        rr_exec($db,'UPDATE erp_runtime_records SET position_no=CASE record_key '.implode(' ',$case).' ELSE position_no END WHERE module_key=? AND record_key IN ('.$placeholders.')',$types,$params);
    }
    $removed=array_values(array_diff(array_keys($existing),array_keys($entries)));
    foreach(array_chunk($removed,500) as $chunk){$placeholders=implode(',',array_fill(0,count($chunk),'?'));rr_exec($db,'DELETE FROM erp_runtime_records WHERE module_key=? AND record_key IN ('.$placeholders.')',str_repeat('s',count($chunk)+1),array_merge([$key],$chunk));}
}
function rr_runtime_read_records(mysqli $db,string $key,bool $forUpdate=false): array {
    $sql='SELECT payload_json FROM erp_runtime_records WHERE module_key=? ORDER BY position_no,record_key'.($forUpdate?' FOR UPDATE':'');
    $stmt=$db->prepare($sql);if(!$stmt)throw new RuntimeException('Relational runtime records are unavailable.');$stmt->bind_param('s',$key);$stmt->execute();$result=$stmt->get_result();$rows=[];while($record=$result->fetch_assoc()){$decoded=json_decode((string)$record['payload_json'],true);if(json_last_error()===JSON_ERROR_NONE)$rows[]=$decoded;}$stmt->close();return $rows;
}
function rr_runtime_hashes(mysqli $db,string $key): array {
    $stmt=$db->prepare('SELECT payload_hash FROM erp_runtime_records WHERE module_key=? ORDER BY position_no,record_key');
    if(!$stmt)throw new RuntimeException('Relational runtime hashes are unavailable.');
    $stmt->bind_param('s',$key);$stmt->execute();$result=$stmt->get_result();$hashes=[];
    while($row=$result->fetch_assoc())$hashes[]=(string)$row['payload_hash'];
    $stmt->close();return $hashes;
}
function rr_runtime_delta(mysqli $db,string $key,array $clientHashes): array {
    $stmt=$db->prepare('SELECT record_key,position_no,payload_hash FROM erp_runtime_records WHERE module_key=? ORDER BY position_no,record_key');
    if(!$stmt)throw new RuntimeException('Relational runtime delta index is unavailable.');
    $stmt->bind_param('s',$key);$stmt->execute();$result=$stmt->get_result();$index=[];$hashes=[];$changedKeys=[];
    while($row=$result->fetch_assoc()){
        $position=count($hashes);$hash=(string)$row['payload_hash'];$hashes[]=$hash;
        if((string)($clientHashes[$position]??'')!==$hash)$changedKeys[$position]=(string)$row['record_key'];
    }
    $stmt->close();
    $length=count($hashes);
    // A browser with an empty or stale baseline needs the full module. Avoid an
    // N+1 payload lookup for every row only to choose the full response later.
    if($length>0&&count($changedKeys)>$length*0.65)return ['length'=>$length,'items'=>[],'hashes'=>$hashes,'preferFull'=>true];
    $items=[];
    if($changedKeys){
        $positionByKey=array_flip($changedKeys);
        foreach(array_chunk(array_values($changedKeys),300) as $recordKeys){
            $placeholders=implode(',',array_fill(0,count($recordKeys),'?'));
            $payloadStmt=$db->prepare('SELECT record_key,payload_json FROM erp_runtime_records WHERE module_key=? AND record_key IN ('.$placeholders.')');
            if(!$payloadStmt)throw new RuntimeException('Relational runtime delta records are unavailable.');
            $params=array_merge([$key],$recordKeys);$payloadStmt->bind_param(str_repeat('s',count($params)),...$params);$payloadStmt->execute();$result=$payloadStmt->get_result();
            while($row=$result->fetch_assoc()){
                $position=$positionByKey[(string)$row['record_key']]??null;if($position===null)continue;
                $decoded=json_decode((string)$row['payload_json'],true);if(json_last_error()===JSON_ERROR_NONE)$items[(string)$position]=$decoded;
            }
            $payloadStmt->close();
        }
        ksort($items,SORT_NUMERIC);
    }
    return ['length'=>$length,'items'=>$items,'hashes'=>$hashes,'preferFull'=>false];
}

function rr_hydrate_user_permissions(mysqli $db,array $users): array {
    if(!rr_migration_applied($db,'20261016_10_user_permissions_authority')||!rr_table_exists($db,'erp_user_permissions'))return $users;
    $sql="SELECT u.username,p.permission_code,p.allowed FROM erp_users u JOIN erp_organizations o ON o.id=u.organization_id LEFT JOIN erp_user_permissions p ON p.user_id=u.id WHERE o.code='DEMOSOLAR' ORDER BY u.id,p.permission_code";
    $result=$db->query($sql);
    if(!$result)throw new RuntimeException('Database User Rights could not be loaded.');
    $permissions=[];
    while($row=$result->fetch_assoc()){
        $username=strtolower(trim((string)($row['username']??'')));
        if($username==='')continue;
        if(!isset($permissions[$username]))$permissions[$username]=[];
        $code=(string)($row['permission_code']??'');
        if($code!=='')$permissions[$username][$code]=(bool)$row['allowed'];
    }
    $result->free();
    foreach($users as &$user){
        if(!is_array($user))continue;
        $username=strtolower(trim((string)($user['username']??'')));
        $user['rights']=$permissions[$username]??[];
    }
    unset($user);
    return $users;
}

/**
 * Approved Sales Order deletions are permanent database operations. The
 * approval/audit rows remain for traceability, but the deleted business record
 * is removed from every active storage representation. IDs are used instead of
 * CO numbers so that a newly created order reusing the same CO is never removed.
 */
function rr_purge_approved_sales_order_deletions(mysqli $db,bool $forceReconcile=false): int {
    if(!rr_table_exists($db,'erp_runtime_records'))return 0;
    $requests=rr_runtime_read_records($db,'DEMOSOLAR_DELETION_REQUESTS_V1',true);
    $deletedIds=[];
    foreach($requests as $request){
        if(!is_array($request)||strtoupper(rr_text($request['type']??'',80))!=='DELETE_SALES_ORDER'||strtoupper(rr_text($request['status']??'',30))!=='APPROVED')continue;
        $id=rr_text($request['payload']['salesOrderId']??'',100);
        if($id!=='')$deletedIds[$id]=true;
    }
    if(!$deletedIds)return 0;

    $orders=rr_runtime_read_records($db,'DEMOSOLAR_SALES_ORDERS_V1',true);
    $cleanOrders=[];$removed=0;
    foreach($orders as $order){
        $id=is_array($order)?rr_text($order['id']??'',100):'';
        if($id!==''&&isset($deletedIds[$id])){$removed++;continue;}
        $cleanOrders[]=$order;
    }

    // Purge normalized rows by the immutable legacy ID even if an old runtime
    // browser snapshot has already disappeared.
    [$org,$plant]=rr_context($db);
    foreach(array_keys($deletedIds) as $legacyId){
        $orderId=rr_scalar($db,'SELECT id FROM erp_sales_orders WHERE organization_id=? AND legacy_id=? LIMIT 1','is',[$org,$legacyId]);
        if($orderId!==null&&rr_sales_order_dependency_count($db,(int)$orderId)===0)rr_delete_sales_order_row($db,(int)$orderId);
    }
    if($removed===0&&!$forceReconcile)return 0;

    $allocations=rr_runtime_read_records($db,'DEMOSOLAR_CO_ALLOCATIONS_V1',true);
    $cleanAllocations=array_values(array_filter($allocations,function($allocation) use($deletedIds): bool {
        if(!is_array($allocation))return true;
        $id=rr_text($allocation['salesOrderId']??'',100);
        return $id===''||!isset($deletedIds[$id]);
    }));
    $activeCos=[];
    foreach($cleanOrders as $order){
        if(!is_array($order))continue;
        $co=rr_text($order['coNumber']??'',100);
        if($co!=='')$activeCos[strtoupper($co)]=$co;
    }
    $cleanRegistry=array_values($activeCos);

    foreach([
        'DEMOSOLAR_SALES_ORDERS_V1'=>$cleanOrders,
        'DEMOSOLAR_CO_ALLOCATIONS_V1'=>$cleanAllocations,
        'DEMOSOLAR_SALES_CO_REGISTRY_V1'=>$cleanRegistry
    ] as $key=>$rows){
        $currentVersion=module_state_locked_version($db,$key);
        $nextRevision=is_numeric($currentVersion)?((int)$currentVersion+1):1;
        rr_sync_module($db,$key,$rows,$nextRevision);
        if(!module_state_write_in_transaction($db,$key,$rows))throw new RuntimeException('Approved Sales Order deletion could not be written to all database storage layers.');
    }
    return $removed;
}
function rr_runtime_is_authoritative(mysqli $db,string $key): bool {
    if(!rr_migration_applied($db,'20260930_08_runtime_records_authority'))return false;
    return rr_scalar($db,'SELECT 1 FROM erp_relational_sync_status WHERE module_key=? AND sync_status=\'SYNCED\' LIMIT 1','s',[$key])!==null;
}

function rr_sync_module(mysqli $db,string $key,$value,int $revision=0,bool $incremental=false): void {
    if(!rr_ready($db)||!is_array($value))return;
    [$org,$plant]=rr_context($db);$rows=array_values($value);
    $existingRuntime=rr_runtime_existing_index($db,$key);$runtimeEntries=rr_runtime_entries($rows);
    $changedRows=[];foreach($runtimeEntries as $recordKey=>$entry){$prior=$existingRuntime[$recordKey]??null;if(!$prior||!hash_equals((string)$prior['hash'],(string)$entry['hash']))$changedRows[]=$entry['row'];}
    rr_runtime_write_records($db,$key,$rows,$existingRuntime,$runtimeEntries);
    // Approval batches are record-patched, so only their changed rows are
    // normalized. Ordinary full saves retain the complete reconciliation path.
    $syncRows=$incremental?$changedRows:$rows;
    if($key==='DEMOSOLAR_USERS_PALLET_FORMAT_V7')rr_sync_users($db,$org,$syncRows);
    elseif($key==='DEMOSOLAR_DEPARTMENTS_MASTER_V1')foreach($syncRows as $row){if(!is_array($row)||($name=rr_text($row['name']??'',120))==='')continue;$legacy=rr_record_id($row,'DEPT');rr_exec($db,'INSERT INTO erp_departments(organization_id,legacy_id,code,name,active,created_at,created_by,legacy_payload) VALUES(?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),?,?) ON DUPLICATE KEY UPDATE code=VALUES(code),name=VALUES(name),active=VALUES(active),legacy_payload=VALUES(legacy_payload)','isssisss',[$org,$legacy,rr_slug($name,'DEPARTMENT'),$name,strtoupper(rr_text($row['status']??'ACTIVE'))==='INACTIVE'?0:1,rr_datetime($row['createdAt']??null),rr_text($row['createdBy']??'',100),rr_json($row)]);}
    elseif($key==='DEMOSOLAR_PRODUCTS_PALLET_FORMAT_V7')foreach($syncRows as $row){if(!is_array($row)||($name=rr_text($row['name']??'',200))==='')continue;$legacy=rr_record_id($row,'PRODUCT');$code='LEGACY_'.rr_slug($legacy,'PRODUCT');rr_exec($db,'INSERT INTO erp_products(organization_id,legacy_id,product_code,model_name,wattage,cell_type,hsn_code,active,legacy_payload) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE model_name=VALUES(model_name),wattage=VALUES(wattage),cell_type=VALUES(cell_type),hsn_code=VALUES(hsn_code),active=VALUES(active),legacy_payload=VALUES(legacy_payload)','isssdssis',[$org,$legacy,$code,$name,rr_number($row['watt']??0),rr_text($row['cellType']??'',40),rr_text($row['hsn']??'85414300',20),strtoupper(rr_text($row['status']??'ACTIVE'))==='INACTIVE'?0:1,rr_json($row)]);}
    elseif($key==='DEMOSOLAR_CUSTOMERS_MASTER_V1')foreach($syncRows as $row){if(!is_array($row)||($name=rr_text($row['name']??'',200))==='')continue;$legacy=rr_record_id($row,'CUSTOMER');$code='LEGACY_'.rr_slug($legacy,'CUSTOMER');rr_exec($db,'INSERT INTO erp_customers(organization_id,legacy_id,customer_code,customer_name,contact_person,contact_number,email,gstin,pan,address_line1,address_line2,taluka,district,state_name,pincode,active,created_at,created_by,legacy_payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),?,?) ON DUPLICATE KEY UPDATE customer_name=VALUES(customer_name),contact_person=VALUES(contact_person),contact_number=VALUES(contact_number),email=VALUES(email),gstin=VALUES(gstin),pan=VALUES(pan),address_line1=VALUES(address_line1),address_line2=VALUES(address_line2),taluka=VALUES(taluka),district=VALUES(district),state_name=VALUES(state_name),pincode=VALUES(pincode),active=VALUES(active),legacy_payload=VALUES(legacy_payload)','issssssssssssssisss',[$org,$legacy,$code,$name,rr_text($row['person']??'',160),rr_text($row['phone']??'',30),rr_text($row['email']??'',190),rr_text($row['gst']??'',15)?:null,rr_text($row['pan']??'',10)?:null,rr_text($row['addressLine1']??$row['address']??'',255),rr_text($row['addressLine2']??'',255),rr_text($row['taluka']??'',100),rr_text($row['district']??'',100),rr_text($row['state']??'',100),rr_text($row['pincode']??'',10),strtoupper(rr_text($row['status']??'ACTIVE'))==='INACTIVE'?0:1,rr_datetime($row['createdAt']??null),rr_text($row['createdBy']??'',100),rr_json($row)]);}
    elseif($key==='DEMOSOLAR_SALES_PEOPLE_V1')foreach($syncRows as $row){if(!is_array($row)||($name=rr_text($row['name']??'',160))==='')continue;$legacy=rr_record_id($row,'SALESPERSON');rr_exec($db,'INSERT INTO erp_sales_people(organization_id,legacy_id,name,status,created_at,legacy_payload) VALUES(?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),?) ON DUPLICATE KEY UPDATE name=VALUES(name),status=VALUES(status),legacy_payload=VALUES(legacy_payload)','isssss',[$org,$legacy,$name,rr_text($row['status']??'ACTIVE',30),rr_datetime($row['createdAt']??null),rr_json($row)]);}
    elseif($key==='DEMOSOLAR_SALES_ORDERS_V1')rr_sync_sales_orders($db,$org,$plant,$syncRows,!$incremental);
    elseif($key==='DEMOSOLAR_POS_PALLET_FORMAT_V7')rr_sync_production_orders($db,$org,$plant,$syncRows);
    elseif($key==='DEMOSOLAR_PRODUCTION_SHEET_V1')foreach($syncRows as $row){if(!is_array($row))continue;$id=rr_production_order_id($db,$org,rr_text($row['poNumber']??'',100));if(!$id)continue;rr_exec($db,'UPDATE erp_production_orders SET production_status=?,packing_status=?,bom_code=?,dispatch_mode=?,start_date=?,end_date=?,legacy_payload=?,updated_at=COALESCE(?,CURRENT_TIMESTAMP),updated_by=?,row_version=row_version+1 WHERE id=?','sssssssssi',[rr_text($row['productionStatus']??'PRODUCTION NOT STARTED',50),rr_text($row['packingStatus']??'IN LINE',40),rr_text($row['bom']??'',80),rr_text($row['dispatchMode']??'',80),rr_date($row['startDate']??null),rr_date($row['endDate']??null),rr_json($row),rr_datetime($row['updatedAt']??null),rr_text($row['updatedBy']??'',100),$id]);}
    elseif($key==='DEMOSOLAR_PRODUCTION_DAILY_V1')rr_sync_production_daily($db,$org,$syncRows);
    elseif($key==='DEMOSOLAR_STORE_SERIALS_STORAGE_V1')rr_sync_serials($db,$org,$syncRows);
    elseif($key==='DEMOSOLAR_STOCK_PALLET_FORMAT_V7')rr_sync_pallets($db,$org,$plant,$syncRows,'WAREHOUSE');
    elseif($key==='DEMOSOLAR_STOCK_BOOKINGS_V1')rr_sync_stock_bookings($db,$org,$syncRows);
    elseif($key==='DEMOSOLAR_TRANSPORTERS_MASTER_V7')rr_sync_transporters($db,$org,$syncRows);
    elseif($key==='DEMOSOLAR_DRIVERS_MASTER_V7')rr_sync_drivers($db,$org,$syncRows);
    elseif($key==='DEMOSOLAR_ACCOUNT_INVOICES_V1')rr_sync_invoices($db,$org,$syncRows);
    elseif($key==='DEMOSOLAR_DISPATCH_ARCHIVE_PALLET_FORMAT_V7')rr_sync_dispatches($db,$org,$plant,$syncRows);
    elseif($key==='DEMOSOLAR_ACCOUNT_RECEIPTS_V1')rr_sync_receipts($db,$org,$syncRows);
    elseif($key==='DEMOSOLAR_VEHICLE_BOOKINGS_V1')rr_sync_vehicle_bookings($db,$org,$syncRows);
    elseif($key==='DEMOSOLAR_ROUTE_FARES_V1')foreach($syncRows as $row){if(!is_array($row)||($route=rr_text($row['route']??$row['routeName']??'',200))==='')continue;$legacy=rr_record_id($row,'ROUTE');rr_exec($db,'INSERT INTO erp_route_fares(organization_id,legacy_id,route_name,vehicle_type,fare_amount,active,legacy_payload) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE route_name=VALUES(route_name),vehicle_type=VALUES(vehicle_type),fare_amount=VALUES(fare_amount),active=VALUES(active),legacy_payload=VALUES(legacy_payload)','isssdis',[$org,$legacy,$route,rr_text($row['vehicleType']??'',60),rr_number($row['fare']??$row['amount']??0),strtoupper(rr_text($row['status']??'ACTIVE'))==='INACTIVE'?0:1,rr_json($row)]);}
    elseif($key==='DEMOSOLAR_SALES_CO_REGISTRY_V1')foreach($syncRows as $row){$record=is_array($row)?$row:['coNumber'=>$row];if(($co=rr_text($record['coNumber']??$record['co']??'',100))==='')continue;$legacy=rr_record_id($record,'CO');$order=rr_sales_order_id($db,$org,$co);rr_exec($db,'INSERT INTO erp_sales_co_registry(organization_id,legacy_id,co_number,sales_order_id,status,legacy_payload,created_at,created_by) VALUES(?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),?) ON DUPLICATE KEY UPDATE sales_order_id=VALUES(sales_order_id),status=VALUES(status),legacy_payload=VALUES(legacy_payload)','ississss',[$org,$legacy,$co,$order,rr_text($record['status']??'ACTIVE',40),rr_json($row),rr_datetime($record['createdAt']??null),rr_text($record['createdBy']??'',100)]);}
    elseif($key==='DEMOSOLAR_CO_ALLOCATIONS_V1')rr_sync_allocations($db,$org,$syncRows);
    elseif($key==='DEMOSOLAR_DELETION_REQUESTS_V1'){
        foreach($syncRows as $row){if(!is_array($row))continue;$legacy=rr_record_id($row,'REQUEST');rr_exec($db,'INSERT INTO erp_approval_requests(organization_id,legacy_id,request_type,target_reference,reason,request_payload,status,requested_at,requested_by,reviewed_at,reviewed_by,review_remark) VALUES(?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),reviewed_at=VALUES(reviewed_at),reviewed_by=VALUES(reviewed_by),review_remark=VALUES(review_remark),request_payload=VALUES(request_payload),row_version=row_version+1','isssssssssss',[$org,$legacy,rr_text($row['type']??'',80),rr_text($row['targetId']??'',160),rr_text($row['reason']??'',4000),rr_json($row['payload']??[]),rr_text($row['status']??'PENDING',30),rr_datetime($row['requestedAt']??null),rr_text($row['requestedBy']??'SYSTEM',100),rr_datetime($row['reviewedAt']??null),rr_text($row['reviewedBy']??'',100),rr_text($row['adminRemark']??'',4000)]);}
        rr_purge_approved_sales_order_deletions($db);
    }
    $hash=hash('sha256',rr_json($value));rr_exec($db,'INSERT INTO erp_relational_sync_status(module_key,module_revision,record_count,payload_hash,sync_status,last_error) VALUES(?,?,?,?,\'SYNCED\',NULL) ON DUPLICATE KEY UPDATE module_revision=VALUES(module_revision),record_count=VALUES(record_count),payload_hash=VALUES(payload_hash),sync_status=\'SYNCED\',last_error=NULL,synced_at=CURRENT_TIMESTAMP','siis',[$key,$revision,count($rows),$hash]);
}

function rr_sync_users(mysqli $db,int $org,array $rows): void {
    foreach($rows as $row){
        if(!is_array($row)||($username=rr_text($row['username']??'',100))==='')continue;
        $departmentName=rr_text($row['department']??$row['role']??'',120);
        $department=$departmentName===''?null:rr_scalar($db,'SELECT id FROM erp_departments WHERE organization_id=? AND (name=? OR code=?) LIMIT 1','iss',[$org,$departmentName,rr_slug($departmentName,'')]);
        $legacy=rr_record_id($row,'USER');
        $hash=rr_text($row['passwordHash']??$row['password_hash']??'',255);
        if($hash===''&&rr_text($row['password']??'')!=='')$hash=password_hash((string)$row['password'],PASSWORD_DEFAULT);
        if($hash==='')$hash='!PASSWORD_RESET_REQUIRED!';
        rr_exec($db,'INSERT INTO erp_users(organization_id,department_id,legacy_id,employee_name,username,role_code,password_hash,status,legacy_payload) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE department_id=VALUES(department_id),employee_name=VALUES(employee_name),role_code=VALUES(role_code),password_hash=VALUES(password_hash),status=VALUES(status),legacy_payload=VALUES(legacy_payload),row_version=row_version+1,updated_at=CURRENT_TIMESTAMP','iisssssss',[$org,$department,$legacy,rr_text($row['name']??$username,160),$username,rr_text($row['role']??'',50),$hash,rr_text($row['status']??'ACTIVE',30),rr_json($row)]);
        $user=(int)rr_scalar($db,'SELECT id FROM erp_users WHERE organization_id=? AND username=?','is',[$org,$username]);
        // Replace the complete permission set so removed or renamed rights can
        // never remain active as stale database rows.
        rr_exec($db,'DELETE FROM erp_user_permissions WHERE user_id=?','i',[$user]);
        foreach(is_array($row['rights']??null)?$row['rights']:[] as $permission=>$allowed){
            rr_exec($db,'INSERT INTO erp_user_permissions(user_id,permission_code,allowed) VALUES(?,?,?)','isi',[$user,rr_text($permission,100),$allowed?1:0]);
        }
    }
}

function rr_sync_sales_orders(mysqli $db,int $org,int $plant,array $rows,bool $reconcileMissing=true): void {
    $activeCoNumbers=[];
    foreach($rows as $row){
        if(!is_array($row)||($co=rr_text($row['coNumber']??'',100))==='')continue;
        $activeCoNumbers[strtoupper($co)]=true;
        $customer=rr_customer_id($db,$org,rr_text($row['customerName']??'',200));
        $personLegacy=rr_text($row['salesPersonId']??'',100);
        $person=$personLegacy===''?null:rr_scalar($db,'SELECT id FROM erp_sales_people WHERE organization_id=? AND legacy_id=?','is',[$org,$personLegacy]);
        $qty=rr_number($row['totalOrderQty']??0);$sent=rr_number($row['dispatchQty']??0);$legacy=rr_record_id($row,'ORDER');
        rr_prepare_reused_sales_order_number($db,$org,$co,$legacy);
        rr_exec($db,'INSERT INTO erp_sales_orders(organization_id,plant_id,legacy_id,co_number,serial_no,financial_year,order_date,customer_id,sales_person_id,customer_po_number,model_number,module_watt,dcr_type,rate_per_watt,quantity,taxable_value,tax_rate,tax_amount,invoice_value,dispatched_quantity,pending_quantity,status,remarks,legacy_payload,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),?,?,?) ON DUPLICATE KEY UPDATE created_at=IF(legacy_id<=>VALUES(legacy_id),created_at,VALUES(created_at)),created_by=IF(legacy_id<=>VALUES(legacy_id),created_by,VALUES(created_by)),legacy_id=VALUES(legacy_id),plant_id=VALUES(plant_id),serial_no=VALUES(serial_no),financial_year=VALUES(financial_year),order_date=VALUES(order_date),customer_id=VALUES(customer_id),sales_person_id=VALUES(sales_person_id),customer_po_number=VALUES(customer_po_number),model_number=VALUES(model_number),module_watt=VALUES(module_watt),dcr_type=VALUES(dcr_type),rate_per_watt=VALUES(rate_per_watt),quantity=VALUES(quantity),taxable_value=VALUES(taxable_value),tax_rate=VALUES(tax_rate),tax_amount=VALUES(tax_amount),invoice_value=VALUES(invoice_value),dispatched_quantity=VALUES(dispatched_quantity),pending_quantity=VALUES(pending_quantity),status=VALUES(status),remarks=VALUES(remarks),legacy_payload=VALUES(legacy_payload),row_version=row_version+1,updated_at=VALUES(updated_at),updated_by=VALUES(updated_by)','iississiissdsddddddddsssssss',[$org,$plant,$legacy,$co,(int)($row['serialNo']??0),rr_text($row['monthYear']??'',20),rr_date($row['orderDate']??null),$customer,$person,rr_text($row['customerPurchaseOrderNo']??'',120),rr_text($row['modelNo']??'',200),rr_number($row['moduleWatt']??$row['wpModule']??0),rr_text($row['dcrNdcr']??'',40),rr_number($row['rateWp']??0),$qty,rr_number($row['totalOrderValue']??0),rr_number($row['taxRate']??0),rr_number($row['taxAmount']??0),rr_number($row['invoiceValue']??0),$sent,max(0,rr_number($row['pendingQty']??($qty-$sent))),rr_text($row['status']??'PENDING',50),rr_text($row['remarks']??'',1000),rr_json($row),rr_datetime($row['createdAt']??null),rr_text($row['createdBy']??'',100),rr_datetime($row['updatedAt']??null),rr_text($row['updatedBy']??'',100)]);
        $order=(int)rr_scalar($db,'SELECT id FROM erp_sales_orders WHERE organization_id=? AND co_number=?','is',[$org,$co]);
        rr_exec($db,'INSERT INTO erp_sales_co_registry(organization_id,co_number,sales_order_id,status,legacy_payload) VALUES(?,?,?,\'ACTIVE\',?) ON DUPLICATE KEY UPDATE sales_order_id=VALUES(sales_order_id),status=\'ACTIVE\',legacy_payload=VALUES(legacy_payload)','isis',[$org,$co,$order,rr_json(['coNumber'=>$co])]);
        $lines=is_array($row['lineItems']??null)&&count($row['lineItems'])?array_values($row['lineItems']):[[$row['modelNo']??'', $row['moduleWatt']??$row['wpModule']??0]];
        foreach($lines as $position=>$source){
            $line=is_array($source)&&array_key_exists('modelNo',$source)?$source:[
                'modelNo'=>$source[0]??$row['modelNo']??'', 'moduleWatt'=>$source[1]??$row['moduleWatt']??$row['wpModule']??0,
                'dcrNdcr'=>$row['dcrNdcr']??'', 'totalOrderQty'=>$qty, 'rateWp'=>$row['rateWp']??0,
                'totalOrderValue'=>$row['totalOrderValue']??0, 'taxRate'=>$row['taxRate']??0,
                'taxAmount'=>$row['taxAmount']??0, 'invoiceValue'=>$row['invoiceValue']??0
            ];
            $model=rr_text($line['modelNo']??'',200);$watt=rr_number($line['moduleWatt']??$line['wpModule']??0);
            $product=rr_product_id($db,$org,$model,$watt);$lineNo=$position+1;
            rr_exec($db,'INSERT INTO erp_sales_order_items(sales_order_id,line_number,product_id,model_number,module_watt,dcr_type,hsn_code,quantity,rate_per_watt,taxable_value,tax_rate,tax_amount,line_total,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE product_id=VALUES(product_id),model_number=VALUES(model_number),module_watt=VALUES(module_watt),dcr_type=VALUES(dcr_type),hsn_code=VALUES(hsn_code),quantity=VALUES(quantity),rate_per_watt=VALUES(rate_per_watt),taxable_value=VALUES(taxable_value),tax_rate=VALUES(tax_rate),tax_amount=VALUES(tax_amount),line_total=VALUES(line_total),updated_at=CURRENT_TIMESTAMP','iiisdssdddddd',[$order,$lineNo,$product,$model,$watt,rr_text($line['dcrNdcr']??'',40),rr_text($line['hsnCode']??$row['hsnCode']??'85414300',20),rr_number($line['totalOrderQty']??$line['quantity']??0),rr_number($line['rateWp']??0),rr_number($line['totalOrderValue']??0),rr_number($line['taxRate']??0),rr_number($line['taxAmount']??0),rr_number($line['invoiceValue']??0)]);
        }
        rr_exec($db,'DELETE FROM erp_sales_order_items WHERE sales_order_id=? AND line_number>?','ii',[$order,count($lines)]);
    }
    if(!$reconcileMissing)return;
    $result=$db->query('SELECT id,co_number FROM erp_sales_orders WHERE organization_id='.(int)$org);
    if($result){
        while($existing=$result->fetch_assoc()){
            if(isset($activeCoNumbers[strtoupper((string)$existing['co_number'])]))continue;
            $orderId=(int)$existing['id'];
            if(rr_sales_order_dependency_count($db,$orderId)===0)rr_delete_sales_order_row($db,$orderId);
        }
        $result->free();
    }
}
function rr_sync_production_orders(mysqli $db,int $org,int $plant,array $rows): void {foreach($rows as $row){if(!is_array($row)||($po=rr_text($row['poNumber']??'',100))==='')continue;$model=rr_text($row['product']??'',200);$watt=rr_number($row['watt']??0);$product=rr_product_id($db,$org,$model,$watt);rr_exec($db,'INSERT INTO erp_production_orders(organization_id,plant_id,po_number,product_id,model_name,wattage,target_quantity,print_format,external_order_number,status,legacy_payload) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE product_id=VALUES(product_id),model_name=VALUES(model_name),wattage=VALUES(wattage),target_quantity=VALUES(target_quantity),print_format=VALUES(print_format),external_order_number=VALUES(external_order_number),status=VALUES(status),legacy_payload=VALUES(legacy_payload),row_version=row_version+1','iisisddssss',[$org,$plant,$po,$product,$model,$watt,rr_number($row['qty']??0),rr_text($row['printFormat']??'',30),rr_text($row['kosolOrderNumber']??'',120),rr_text($row['status']??'OPEN',30),rr_json($row)]);}}
function rr_sync_production_daily(mysqli $db,int $org,array $rows): void {foreach($rows as $row){if(!is_array($row))continue;$order=rr_production_order_id($db,$org,rr_text($row['poNumber']??'',100));$date=rr_date($row['date']??null);if(!$order||!$date)continue;$legacy=rr_record_id($row,'DAILY');rr_exec($db,'INSERT INTO erp_production_daily(production_order_id,legacy_id,production_date,produced_quantity,grade_a_quantity,grade_b_quantity,grade_r_quantity,cell_rejection_percent,module_rejection_percent,production_status,delay_days,delay_reason,created_at,created_by,legacy_payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),?,?) ON DUPLICATE KEY UPDATE produced_quantity=VALUES(produced_quantity),grade_a_quantity=VALUES(grade_a_quantity),grade_b_quantity=VALUES(grade_b_quantity),grade_r_quantity=VALUES(grade_r_quantity),cell_rejection_percent=VALUES(cell_rejection_percent),module_rejection_percent=VALUES(module_rejection_percent),production_status=VALUES(production_status),delay_days=VALUES(delay_days),delay_reason=VALUES(delay_reason),legacy_payload=VALUES(legacy_payload)','issddddddsdssss',[$order,$legacy,$date,rr_number($row['productionQty']??0),rr_number($row['gradeA']??0),rr_number($row['gradeB']??0),rr_number($row['gradeR']??0),rr_number($row['cellRejectionPct']??0),rr_number($row['moduleRejectionPct']??0),rr_text($row['productionStatus']??'',50),rr_number($row['delayDays']??0),rr_text($row['delayReason']??'',500),rr_datetime($row['createdAt']??null),rr_text($row['createdBy']??'',100),rr_json($row)]);}}
function rr_sync_serials(mysqli $db,int $org,array $rows): void {
    foreach($rows as $row){
        if(!is_array($row))continue;
        $order=rr_production_order_id($db,$org,rr_text($row['poNumber']??'',100));
        if(!$order)continue;
        $legacy=rr_record_id($row,'BATCH');
        $rawSerials=is_array($row['serials']??null)?$row['serials']:[];
        $incoming=[];
        foreach($rawSerials as $serial){
            $serial=strtoupper(rr_text($serial,160));
            if($serial!=='')$incoming[$serial]=true;
        }
        rr_exec($db,'INSERT INTO erp_serial_import_batches(production_order_id,legacy_id,imported_at,imported_by,source_count,legacy_payload) VALUES(?,?,COALESCE(?,CURRENT_TIMESTAMP),?,?,?) ON DUPLICATE KEY UPDATE production_order_id=VALUES(production_order_id),source_count=VALUES(source_count),legacy_payload=VALUES(legacy_payload)','isssis',[$order,$legacy,rr_datetime($row['timestamp']??null),rr_text($row['createdBy']??'SYSTEM',100),count($incoming),rr_json($row)]);
        $batch=(int)rr_scalar($db,'SELECT id FROM erp_serial_import_batches WHERE legacy_id=?','s',[$legacy]);
        if(!$batch)continue;

        // A changed batch used to execute one UPSERT for every historical
        // serial. Large PPC batches therefore issued tens of thousands of
        // duplicate writes for a one-row edit. Diff the batch in memory and
        // touch only genuinely added or removed, unpacked serials.
        $existing=[];
        $stmt=$db->prepare('SELECT ms.id,ms.serial_number,EXISTS(SELECT 1 FROM erp_pallet_serials ps WHERE ps.serial_id=ms.id) packed FROM erp_module_serials ms WHERE ms.organization_id=? AND ms.import_batch_id=?');
        if(!$stmt)throw new RuntimeException('Serial batch lookup could not be prepared.');
        $stmt->bind_param('ii',$org,$batch);$stmt->execute();$result=$stmt->get_result();
        while($record=$result->fetch_assoc())$existing[strtoupper((string)$record['serial_number'])]=['id'=>(int)$record['id'],'packed'=>(bool)$record['packed']];
        $stmt->close();

        foreach($existing as $serial=>$record){
            if(isset($incoming[$serial]))continue;
            if($record['packed'])throw new RuntimeException("Packed serial {$serial} cannot be removed from its import batch.");
            rr_exec($db,'DELETE FROM erp_module_serials WHERE id=? AND NOT EXISTS(SELECT 1 FROM erp_pallet_serials ps WHERE ps.serial_id=erp_module_serials.id)','i',[$record['id']]);
        }
        foreach(array_keys($incoming) as $serial){
            if(isset($existing[$serial]))continue;
            rr_exec($db,'INSERT INTO erp_module_serials(organization_id,production_order_id,import_batch_id,serial_number,created_at,created_by) VALUES(?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),?) ON DUPLICATE KEY UPDATE production_order_id=VALUES(production_order_id),import_batch_id=VALUES(import_batch_id)','iiisss',[$org,$order,$batch,$serial,rr_datetime($row['timestamp']??null),rr_text($row['createdBy']??'SYSTEM',100)]);
        }
    }
}
function rr_upsert_pallet(mysqli $db,int $org,int $plant,array $row,string $status): ?int {
    $number=strtoupper(rr_text($row['pallet']??'',120));
    if($number==='')return null;
    $order=rr_production_order_id($db,$org,rr_text($row['po']??'',100));
    $serials=is_array($row['serials']??null)?$row['serials']:[];
    if(!$serials&&is_array($row['fullRows']??null))$serials=array_map(static fn($v)=>is_array($v)?($v['serial']??''):$v,$row['fullRows']);
    $incoming=[];
    foreach(array_values($serials) as $position=>$serial){
        $serial=strtoupper(rr_text($serial,160));
        if($serial!==''&&!isset($incoming[$serial]))$incoming[$serial]=$position+1;
    }
    $count=(int)($row['count']??count($incoming));
    rr_exec($db,'INSERT INTO erp_pallets(organization_id,plant_id,production_order_id,pallet_number,grade,model_name,wattage,binning,cell_type,capacity,module_count,stock_status,packed_date,legacy_payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE production_order_id=COALESCE(VALUES(production_order_id),production_order_id),grade=VALUES(grade),model_name=VALUES(model_name),wattage=VALUES(wattage),binning=VALUES(binning),cell_type=VALUES(cell_type),capacity=VALUES(capacity),module_count=VALUES(module_count),stock_status=VALUES(stock_status),packed_date=COALESCE(VALUES(packed_date),packed_date),legacy_payload=VALUES(legacy_payload),row_version=row_version+1','iiisssdssiisss',[$org,$plant,$order,$number,rr_text($row['grade']??'',30),rr_text($row['model']??'',200),rr_number($row['watt']??0),rr_text($row['binning']??'',40),rr_text($row['cellType']??'',40),(int)($row['capacity']??$count),$count,$status,rr_date($row['date']??null),rr_json($row)]);
    $pallet=(int)rr_scalar($db,'SELECT id FROM erp_pallets WHERE organization_id=? AND pallet_number=?','is',[$org,$number]);
    if(!$pallet)return null;

    $linked=[];
    $stmt=$db->prepare('SELECT ms.serial_number,ps.serial_id,ps.position_no FROM erp_pallet_serials ps JOIN erp_module_serials ms ON ms.id=ps.serial_id WHERE ps.pallet_id=?');
    if(!$stmt)throw new RuntimeException('Pallet serial lookup could not be prepared.');
    $stmt->bind_param('i',$pallet);$stmt->execute();$result=$stmt->get_result();
    while($record=$result->fetch_assoc())$linked[strtoupper((string)$record['serial_number'])]=['id'=>(int)$record['serial_id'],'position'=>(int)$record['position_no']];
    $stmt->close();

    foreach($linked as $serial=>$record){
        if(isset($incoming[$serial]))continue;
        rr_exec($db,'DELETE FROM erp_pallet_serials WHERE pallet_id=? AND serial_id=?','ii',[$pallet,$record['id']]);
    }
    foreach($incoming as $serial=>$position){
        if(isset($linked[$serial])){
            if($linked[$serial]['position']!==$position)rr_exec($db,'UPDATE erp_pallet_serials SET position_no=? WHERE pallet_id=? AND serial_id=?','iii',[$position,$pallet,$linked[$serial]['id']]);
            continue;
        }
        rr_exec($db,'INSERT INTO erp_module_serials(organization_id,production_order_id,serial_number) VALUES(?,?,?) ON DUPLICATE KEY UPDATE production_order_id=COALESCE(production_order_id,VALUES(production_order_id))','iis',[$org,$order,$serial]);
        $serialId=(int)rr_scalar($db,'SELECT id FROM erp_module_serials WHERE organization_id=? AND serial_number=?','is',[$org,$serial]);
        rr_exec($db,'INSERT INTO erp_pallet_serials(pallet_id,serial_id,position_no) VALUES(?,?,?) ON DUPLICATE KEY UPDATE pallet_id=VALUES(pallet_id),position_no=VALUES(position_no)','iii',[$pallet,$serialId,$position]);
    }
    return $pallet;
}
function rr_sync_pallets(mysqli $db,int $org,int $plant,array $rows,string $status): void {foreach($rows as $row)if(is_array($row))rr_upsert_pallet($db,$org,$plant,$row,$status);}
function rr_sync_stock_bookings(mysqli $db,int $org,array $rows): void {foreach($rows as $row){if(!is_array($row))continue;$palletNo=strtoupper(rr_text($row['pallet']??'',120));$pallet=$palletNo===''?null:rr_scalar($db,'SELECT id FROM erp_pallets WHERE organization_id=? AND pallet_number=?','is',[$org,$palletNo]);if(!$pallet)continue;$legacy=rr_record_id($row,'BOOKING');$order=rr_sales_order_id($db,$org,rr_text($row['coNumber']??'',100));rr_exec($db,'INSERT INTO erp_stock_bookings(legacy_id,pallet_id,sales_order_id,booking_batch_id,customer_name,remarks,booked_at,booked_by,status,cancelled_at,cancelled_by,legacy_payload) VALUES(?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),?,?,?,?,?) ON DUPLICATE KEY UPDATE pallet_id=VALUES(pallet_id),sales_order_id=VALUES(sales_order_id),status=VALUES(status),cancelled_at=VALUES(cancelled_at),cancelled_by=VALUES(cancelled_by),legacy_payload=VALUES(legacy_payload)','siisssssssss',[$legacy,(int)$pallet,$order,rr_text($row['bookingBatchId']??'',100),rr_text($row['customer']??'',200),rr_text($row['remarks']??'',500),rr_datetime($row['bookedDate']??null),rr_text($row['bookedBy']??'',100),rr_text($row['status']??'BOOKED',30),rr_datetime($row['cancelledAt']??null),rr_text($row['cancelledBy']??'',100),rr_json($row)]);}}

function rr_register_attachments(mysqli $db,string $entityType,string $reference,array $paths,string $attachmentType,string $uploadedBy): void {
    if(!rr_ready($db)||!$paths)return;[$org]=rr_context($db);
    foreach($paths as $path){$path=rr_text($path,500);if($path==='')continue;rr_exec($db,'INSERT INTO erp_attachments(organization_id,entity_type,entity_reference,attachment_type,original_name,storage_path,uploaded_by) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE entity_reference=VALUES(entity_reference),attachment_type=VALUES(attachment_type),uploaded_by=VALUES(uploaded_by),active=1','issssss',[$org,rr_text($entityType,60),rr_text($reference,160),rr_text($attachmentType,60),basename($path),$path,rr_text($uploadedBy,100)]);}
}
function rr_sync_transporters(mysqli $db,int $org,array $rows): void {foreach($rows as $row){if(!is_array($row)||($name=rr_text($row['name']??'',200))==='')continue;$legacy=rr_record_id($row,'TRANSPORTER');rr_exec($db,'INSERT INTO erp_transporters(organization_id,legacy_id,transporter_code,transporter_name,gstin,pan,contact_person,contact_number,email,address_text,active,legacy_payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE transporter_name=VALUES(transporter_name),gstin=VALUES(gstin),pan=VALUES(pan),contact_person=VALUES(contact_person),contact_number=VALUES(contact_number),email=VALUES(email),address_text=VALUES(address_text),active=VALUES(active),legacy_payload=VALUES(legacy_payload)','isssssssssis',[$org,$legacy,'LEGACY_'.rr_slug($legacy,'TRANSPORTER'),$name,rr_text($row['gst']??'',15)?:null,rr_text($row['pan']??'',10)?:null,rr_text($row['person']??'',160),rr_text($row['phone']??'',30),rr_text($row['email']??'',190),rr_text($row['address']??'',500),strtoupper(rr_text($row['status']??'ACTIVE'))==='INACTIVE'?0:1,rr_json($row)]);}}
function rr_sync_drivers(mysqli $db,int $org,array $rows): void {foreach($rows as $row){if(!is_array($row)||($name=rr_text($row['name']??$row['driverName']??'',160))==='')continue;$legacy=rr_record_id($row,'DRIVER');$transporter=rr_transporter_id($db,$org,rr_text($row['transporter']??'',200));rr_exec($db,'INSERT INTO erp_drivers(organization_id,transporter_id,legacy_id,driver_name,contact_number,licence_number,active,legacy_payload) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE transporter_id=VALUES(transporter_id),driver_name=VALUES(driver_name),contact_number=VALUES(contact_number),licence_number=VALUES(licence_number),active=VALUES(active),legacy_payload=VALUES(legacy_payload)','iissssis',[$org,$transporter,$legacy,$name,rr_text($row['phone']??$row['number']??'',30),rr_text($row['licence']??'',80),strtoupper(rr_text($row['status']??'ACTIVE'))==='INACTIVE'?0:1,rr_json($row)]);}}
function rr_sync_invoices(mysqli $db,int $org,array $rows): void {foreach($rows as $row){if(!is_array($row)||($number=rr_text($row['invoiceNumber']??'',100))==='')continue;$order=rr_sales_order_id($db,$org,rr_text($row['coNumber']??'',100));$date=rr_date($row['invoiceDate']??null);if(!$order||!$date)continue;$transporter=rr_transporter_id($db,$org,rr_text($row['transporterName']??'',200));$legacy=rr_record_id($row,'INVOICE');rr_exec($db,'INSERT INTO erp_account_invoices(organization_id,legacy_id,sales_order_id,transporter_id,invoice_number,invoice_date,quantity,rate_per_watt,taxable_value,tax_rate,tax_amount,invoice_value,vehicle_number,challan_number,delivery_order_number,lr_number,packing_type,mode_of_transport,hsn_code,status,legacy_payload,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),?) ON DUPLICATE KEY UPDATE sales_order_id=VALUES(sales_order_id),transporter_id=VALUES(transporter_id),quantity=VALUES(quantity),rate_per_watt=VALUES(rate_per_watt),taxable_value=VALUES(taxable_value),tax_rate=VALUES(tax_rate),tax_amount=VALUES(tax_amount),invoice_value=VALUES(invoice_value),vehicle_number=VALUES(vehicle_number),challan_number=VALUES(challan_number),delivery_order_number=VALUES(delivery_order_number),lr_number=VALUES(lr_number),packing_type=VALUES(packing_type),mode_of_transport=VALUES(mode_of_transport),hsn_code=VALUES(hsn_code),status=VALUES(status),legacy_payload=VALUES(legacy_payload),row_version=row_version+1','isiissddddddsssssssssss',[$org,$legacy,$order,$transporter,$number,$date,rr_number($row['quantity']??0),rr_number($row['ratePerWatt']??0),rr_number($row['totalValue']??0),rr_number($row['taxRate']??0),rr_number($row['taxAmount']??0),rr_number($row['invoiceValue']??0),rr_text($row['vehicleNumber']??'',50),rr_text($row['challanNo']??'',100),rr_text($row['deliveryOrderNo']??'',100),rr_text($row['lrNo']??'',100),rr_text($row['packingType']??'',60),rr_text($row['modeTransport']??'',60),rr_text($row['hsnCode']??'',20),rr_text($row['status']??'READY FOR DISPATCH',40),rr_json($row),rr_datetime($row['createdAt']??null),rr_text($row['createdBy']??'',100)]);$vehicle=strtoupper(rr_text($row['vehicleNumber']??'',50));if($vehicle!=='')rr_exec($db,'INSERT INTO erp_vehicles(organization_id,transporter_id,vehicle_number,vehicle_type) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE transporter_id=COALESCE(VALUES(transporter_id),transporter_id),vehicle_type=COALESCE(NULLIF(VALUES(vehicle_type),\'\'),vehicle_type),active=1,updated_at=CURRENT_TIMESTAMP','iiss',[$org,$transporter,$vehicle,rr_text($row['vehicleType']??'',60)]);}}
function rr_sync_dispatches(mysqli $db,int $org,int $plant,array $rows): void {foreach($rows as $row){if(!is_array($row)||($invoice=rr_text($row['invoice']??'',100))==='')continue;$order=rr_sales_order_id($db,$org,rr_text($row['coNumber']??'',100));$account=rr_invoice_id($db,$org,$invoice);$legacy=rr_record_id($row,'DISPATCH');rr_exec($db,'INSERT INTO erp_dispatches(organization_id,plant_id,legacy_id,sales_order_id,account_invoice_id,invoice_number,dispatch_date,customer_name,transporter_name,vehicle_number,driver_name,driver_number,challan_number,delivery_order_number,lr_number,mode_of_transport,packing_type,dispatched_quantity,status,legacy_payload,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),?) ON DUPLICATE KEY UPDATE sales_order_id=VALUES(sales_order_id),account_invoice_id=VALUES(account_invoice_id),dispatch_date=VALUES(dispatch_date),customer_name=VALUES(customer_name),transporter_name=VALUES(transporter_name),vehicle_number=VALUES(vehicle_number),driver_name=VALUES(driver_name),driver_number=VALUES(driver_number),challan_number=VALUES(challan_number),delivery_order_number=VALUES(delivery_order_number),lr_number=VALUES(lr_number),mode_of_transport=VALUES(mode_of_transport),packing_type=VALUES(packing_type),dispatched_quantity=VALUES(dispatched_quantity),status=VALUES(status),legacy_payload=VALUES(legacy_payload)','iisiissssssssssssdssss',[$org,$plant,$legacy,$order,$account,$invoice,rr_date($row['date']??null),rr_text($row['customer']??'',200),rr_text($row['transporter']??'',200),rr_text($row['vehicle']??'',50),rr_text($row['driverName']??'',160),rr_text($row['driverNo']??'',30),rr_text($row['challanNo']??'',100),rr_text($row['deliveryOrderNo']??'',100),rr_text($row['lrNo']??'',100),rr_text($row['modeTransport']??'',60),rr_text($row['packingType']??'',60),rr_number($row['dispatchedQty']??0),rr_text($row['status']??'DISPATCHED',40),rr_json($row),rr_datetime($row['createdAt']??null),rr_text($row['createdBy']??'SYSTEM',100)]);$dispatch=(int)rr_scalar($db,'SELECT id FROM erp_dispatches WHERE organization_id=? AND invoice_number=?','is',[$org,$invoice]);foreach(is_array($row['pallets']??null)?$row['pallets']:[] as $pallet){if(!is_array($pallet))continue;$pid=rr_upsert_pallet($db,$org,$plant,$pallet,'DISPATCHED');if($pid)rr_exec($db,'INSERT INTO erp_dispatch_pallets(dispatch_id,pallet_id,quantity) VALUES(?,?,?) ON DUPLICATE KEY UPDATE dispatch_id=VALUES(dispatch_id),quantity=VALUES(quantity)','iid',[$dispatch,$pid,rr_number($pallet['count']??count($pallet['serials']??[]))]);}foreach(is_array($row['photos']??null)?$row['photos']:[] as $path){$path=rr_text($path,500);if($path==='')continue;rr_exec($db,'INSERT IGNORE INTO erp_dispatch_photos(dispatch_id,storage_path) VALUES(?,?)','is',[$dispatch,$path]);rr_exec($db,'INSERT INTO erp_attachments(organization_id,entity_type,entity_id,entity_reference,attachment_type,storage_path) VALUES(?,\'DISPATCH\',?,?,\'PHOTO\',?) ON DUPLICATE KEY UPDATE entity_id=VALUES(entity_id),active=1','iiss',[$org,$dispatch,$invoice,$path]);}}}
function rr_sync_receipts(mysqli $db,int $org,array $rows): void {foreach($rows as $row){if(!is_array($row)||!($date=rr_date($row['date']??null)))continue;$legacy=rr_record_id($row,'RECEIPT');$customer=rr_customer_id($db,$org,rr_text($row['partyName']??'',200));$order=rr_sales_order_id($db,$org,rr_text($row['coNumber']??'',100));$personLegacy=rr_text($row['salesPersonId']??'',100);$person=$personLegacy===''?null:rr_scalar($db,'SELECT id FROM erp_sales_people WHERE organization_id=? AND legacy_id=?','is',[$org,$personLegacy]);rr_exec($db,'INSERT INTO erp_account_receipts(organization_id,legacy_id,customer_id,sales_order_id,receipt_date,amount,sales_person_id,reference_number,remarks,created_at,created_by,legacy_payload) VALUES(?,?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),?,?) ON DUPLICATE KEY UPDATE customer_id=VALUES(customer_id),sales_order_id=VALUES(sales_order_id),receipt_date=VALUES(receipt_date),amount=VALUES(amount),sales_person_id=VALUES(sales_person_id),reference_number=VALUES(reference_number),remarks=VALUES(remarks),legacy_payload=VALUES(legacy_payload)','isiisdisssss',[$org,$legacy,$customer,$order,$date,rr_number($row['amount']??0),$person,rr_text($row['referenceNumber']??'',120),rr_text($row['remarks']??'',500),rr_datetime($row['createdAt']??null),rr_text($row['createdBy']??'',100),rr_json($row)]);}}
function rr_sync_vehicle_bookings(mysqli $db,int $org,array $rows): void {foreach($rows as $row){if(!is_array($row))continue;$legacy=rr_record_id($row,'VEHICLE_BOOKING');$order=rr_sales_order_id($db,$org,rr_text($row['coNumber']??'',100));$invoice=rr_invoice_id($db,$org,rr_text($row['invoiceNumber']??'',100));$transporter=rr_transporter_id($db,$org,rr_text($row['transporterName']??'',200));rr_exec($db,'INSERT INTO erp_vehicle_bookings(organization_id,legacy_id,sales_order_id,account_invoice_id,transporter_id,vehicle_type,original_freight,unloading_charges,deduction_amount,final_payable,status,booked_at,booked_by,settled_at,settled_by,legacy_payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),?,?,?,?) ON DUPLICATE KEY UPDATE sales_order_id=VALUES(sales_order_id),account_invoice_id=VALUES(account_invoice_id),transporter_id=VALUES(transporter_id),vehicle_type=VALUES(vehicle_type),original_freight=VALUES(original_freight),unloading_charges=VALUES(unloading_charges),deduction_amount=VALUES(deduction_amount),final_payable=VALUES(final_payable),status=VALUES(status),settled_at=VALUES(settled_at),settled_by=VALUES(settled_by),legacy_payload=VALUES(legacy_payload)','isiiisddddssssss',[$org,$legacy,$order,$invoice,$transporter,rr_text($row['vehicleType']??'',60),rr_number($row['originalFreight']??0),rr_number($row['unloadingCharges']??0),rr_number($row['deductionAmount']??0),rr_number($row['finalPayable']??0),rr_text($row['status']??'BOOKED',40),rr_datetime($row['bookedAt']??null),rr_text($row['bookedBy']??'',100),rr_datetime($row['settledAt']??null),rr_text($row['settledBy']??'',100),rr_json($row)]);}}
function rr_sync_allocations(mysqli $db,int $org,array $rows): void {foreach($rows as $row){if(!is_array($row))continue;$legacy=rr_record_id($row,'ALLOCATION');$order=rr_sales_order_id($db,$org,rr_text($row['coNumber']??'',100));$production=rr_production_order_id($db,$org,rr_text($row['poNumber']??'',100));rr_exec($db,'INSERT INTO erp_co_allocations(organization_id,legacy_id,sales_order_id,production_order_id,allocated_quantity,status,legacy_payload,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),?,?,?) ON DUPLICATE KEY UPDATE sales_order_id=VALUES(sales_order_id),production_order_id=VALUES(production_order_id),allocated_quantity=VALUES(allocated_quantity),status=VALUES(status),legacy_payload=VALUES(legacy_payload),updated_at=VALUES(updated_at),updated_by=VALUES(updated_by)','isiidssssss',[$org,$legacy,$order,$production,rr_number($row['quantity']??$row['allocatedQty']??0),rr_text($row['status']??'ACTIVE',40),rr_json($row),rr_datetime($row['createdAt']??null),rr_text($row['createdBy']??'',100),rr_datetime($row['updatedAt']??null),rr_text($row['updatedBy']??'',100)]);}}
