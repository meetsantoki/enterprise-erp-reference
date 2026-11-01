<?php
declare(strict_types=1);

function tour_expenses_ensure_schema(mysqli $db): void {
  $db->query("CREATE TABLE IF NOT EXISTS erp_employee_tours (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    employee_username VARCHAR(100) NOT NULL,
    employee_name VARCHAR(160) NOT NULL,
    starting_point VARCHAR(160) NOT NULL DEFAULT '',
    destination VARCHAR(160) NOT NULL,
    purpose VARCHAR(240) NOT NULL DEFAULT '',
    start_date DATE NOT NULL,
    return_date DATE NULL,
    trip_notes TEXT NULL,
    status ENUM('ONGOING','SUBMITTED','APPROVED','REJECTED','SETTLED') NOT NULL DEFAULT 'ONGOING',
    review_note VARCHAR(1200) NULL,
    reviewed_by VARCHAR(100) NULL,
    reviewed_at DATETIME NULL,
    settled_by VARCHAR(100) NULL,
    settled_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_tour_employee_date (employee_username,start_date),
    KEY idx_tour_status_date (status,start_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
  $startingPointColumn=$db->query("SHOW COLUMNS FROM erp_employee_tours LIKE 'starting_point'");
  if(!$startingPointColumn||$startingPointColumn->num_rows===0){if(!$db->query("ALTER TABLE erp_employee_tours ADD COLUMN starting_point VARCHAR(160) NOT NULL DEFAULT '' AFTER employee_name"))throw new RuntimeException('Starting point column could not be added.');}
  $statusColumn=$db->query("SHOW COLUMNS FROM erp_employee_tours LIKE 'status'");$statusDefinition=$statusColumn?$statusColumn->fetch_assoc():null;
  if(!$statusDefinition||stripos((string)($statusDefinition['Type']??''),'SETTLED')===false){if(!$db->query("ALTER TABLE erp_employee_tours MODIFY status ENUM('ONGOING','SUBMITTED','APPROVED','REJECTED','SETTLED') NOT NULL DEFAULT 'ONGOING'"))throw new RuntimeException('Trip reimbursement status could not be added.');}
  $settledByColumn=$db->query("SHOW COLUMNS FROM erp_employee_tours LIKE 'settled_by'");if(!$settledByColumn||$settledByColumn->num_rows===0){if(!$db->query("ALTER TABLE erp_employee_tours ADD COLUMN settled_by VARCHAR(100) NULL AFTER reviewed_at"))throw new RuntimeException('Trip reimbursement operator column could not be added.');}
  $settledAtColumn=$db->query("SHOW COLUMNS FROM erp_employee_tours LIKE 'settled_at'");if(!$settledAtColumn||$settledAtColumn->num_rows===0){if(!$db->query("ALTER TABLE erp_employee_tours ADD COLUMN settled_at DATETIME NULL AFTER settled_by"))throw new RuntimeException('Trip reimbursement date column could not be added.');}
  $db->query("CREATE TABLE IF NOT EXISTS erp_employee_tour_expenses (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    trip_id BIGINT UNSIGNED NOT NULL,
    category VARCHAR(80) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    expense_date DATE NOT NULL,
    paid_by ENUM('EMPLOYEE','COMPANY','ADVANCE') NOT NULL DEFAULT 'EMPLOYEE',
    payment_method VARCHAR(40) NOT NULL DEFAULT 'Cash',
    reference_number VARCHAR(120) NOT NULL DEFAULT '',
    vendor_name VARCHAR(180) NOT NULL DEFAULT '',
    description VARCHAR(1200) NOT NULL,
    receipt_path VARCHAR(255) NULL,
    receipt_name VARCHAR(180) NULL,
    receipt_mime VARCHAR(80) NULL,
    created_by VARCHAR(100) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_tour_expense_trip_date (trip_id,expense_date),
    CONSTRAINT fk_tour_expense_trip FOREIGN KEY (trip_id) REFERENCES erp_employee_tours(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
  $policyColumns=[
    'policy_level'=>"CHAR(1) NOT NULL DEFAULT ''",
    'claim_basis'=>"VARCHAR(20) NOT NULL DEFAULT 'ACTUAL'",
    'travel_mode'=>"VARCHAR(30) NOT NULL DEFAULT ''",
    'travel_class'=>"VARCHAR(100) NOT NULL DEFAULT ''",
    'vehicle_type'=>"VARCHAR(20) NOT NULL DEFAULT ''",
    'distance_km'=>"DECIMAL(10,2) NOT NULL DEFAULT 0",
    'unit_rate'=>"DECIMAL(10,2) NOT NULL DEFAULT 0",
    'policy_quantity'=>"INT UNSIGNED NOT NULL DEFAULT 0",
    'eligible_amount'=>"DECIMAL(12,2) NOT NULL DEFAULT 0",
    'policy_note'=>"VARCHAR(500) NOT NULL DEFAULT ''",
    'special_approved_amount'=>"DECIMAL(12,2) NOT NULL DEFAULT 0",
    'approved_amount'=>"DECIMAL(12,2) NOT NULL DEFAULT 0",
    'hr_approval_note'=>"VARCHAR(500) NOT NULL DEFAULT ''"
  ];
  $expenseColumnResult=$db->query('SHOW COLUMNS FROM erp_employee_tour_expenses');$expenseColumnNames=[];if($expenseColumnResult){while($columnRow=$expenseColumnResult->fetch_assoc())$expenseColumnNames[(string)$columnRow['Field']]=true;}
  foreach($policyColumns as $column=>$definition){if(!isset($expenseColumnNames[$column])){if(!$db->query("ALTER TABLE erp_employee_tour_expenses ADD COLUMN `{$column}` {$definition}"))throw new RuntimeException('TA/DA policy column could not be added: '.$column);}}
}

function tour_expenses_text($value, int $max): string {
  $text = trim((string)($value ?? ''));
  if (function_exists('mb_substr')) return mb_substr($text, 0, $max, 'UTF-8');
  return substr($text, 0, $max);
}

function tour_expenses_valid_date($value, bool $optional = false): ?string {
  $date = trim((string)($value ?? ''));
  if ($date === '' && $optional) return null;
  $parsed = DateTime::createFromFormat('!Y-m-d', $date);
  return $parsed && $parsed->format('Y-m-d') === $date ? $date : null;
}

function tour_expenses_policy_level(array $actor): string {
  $level=strtoupper(trim((string)($actor['employeeLevel']??'')));
  $level=preg_replace('/^LEVEL\s+/','',$level)??'';
  return in_array($level,['A','B','C'],true)?$level:'';
}

function tour_expenses_policy(string $level): ?array {
  $policies=[
    'A'=>['hotelMin'=>2000.0,'hotelMax'=>5000.0,'foodRate'=>200.0,'mobileMax'=>859.0,'vehicle'=>'CAR','vehicleRate'=>6.0,'BUS'=>['GSRTC Premium','Volvo','AC Sleeper Coach'],'TRAIN'=>['1A - First AC','EC - Executive Chair','2A - AC 2 Tier'],'FLIGHT'=>['Business','Premium Economy']],
    'B'=>['hotelMin'=>1000.0,'hotelMax'=>3000.0,'foodRate'=>150.0,'mobileMax'=>799.0,'vehicle'=>'CAR','vehicleRate'=>6.0,'BUS'=>['GSRTC Within AC','Sleeper Coach'],'TRAIN'=>['3E - AC 3 Economy','3A - AC 3 Tier','CC - AC Chair','SL - Sleeper'],'FLIGHT'=>['Economy']],
    'C'=>['hotelMin'=>1000.0,'hotelMax'=>2000.0,'foodRate'=>150.0,'mobileMax'=>0.0,'vehicle'=>'BIKE','vehicleRate'=>3.0,'BUS'=>['GSRTC Express','AC Coach','Gurjarnagri'],'TRAIN'=>['SL - Sleeper','2S - Second Seating'],'FLIGHT'=>[]]
  ];
  return $policies[$level]??null;
}

function tour_expenses_policy_claim(array $actor,array $data,string $category,float $amount): array {
  $legacy=['Travel'=>'TRAVEL','Hotel'=>'HOTEL','Meals'=>'FOOD','Local transport'=>'LOCAL_TRANSPORT','Fuel'=>'FUEL','Parking / toll'=>'PARKING_TOLL','Other'=>'OTHER'];
  $category=strtoupper(trim($legacy[$category]??$category));
  $controlled=in_array($category,['TRAVEL','HOTEL','FOOD','BREAKFAST','LUNCH','DINNER','MOBILE'],true);
  $level=tour_expenses_policy_level($actor);$policy=tour_expenses_policy($level);
  if($controlled&&!$policy)respond(['status'=>'error','message'=>'Employee Level A, B, or C must be assigned before adding this policy-controlled expense.'],409);
  $basis=strtoupper(tour_expenses_text($data['claimBasis']??'ACTUAL',20));if(!in_array($basis,['ACTUAL','POLICY'],true))$basis='ACTUAL';
  $mode=strtoupper(tour_expenses_text($data['travelMode']??'',30));$class=tour_expenses_text($data['travelClass']??'',100);$vehicle=strtoupper(tour_expenses_text($data['vehicleType']??'',20));
  $distance=max(0.0,(float)($data['distanceKm']??0));$quantity=max(0,(int)($data['quantity']??0));$rate=0.0;$eligible=$amount;$note='Recorded for HR review.';
  if($category==='HOTEL'){
    $eligible=(float)$policy['hotelMax'];$note='Level '.$level.' hotel actual-bill limit: ₹'.number_format($eligible,2).' (policy band ₹'.number_format((float)$policy['hotelMin'],2).'–₹'.number_format($eligible,2).').';
    if($amount>$eligible)$note.=' Excess ₹'.number_format($amount-$eligible,2).' requires HR special approval.';
  }elseif(in_array($category,['FOOD','BREAKFAST','LUNCH','DINNER'],true)){
    $mealLabel=$category==='FOOD'?'Food':ucfirst(strtolower($category));$rate=(float)$policy['foodRate'];$quantity=max(1,$quantity);$eligible=round($quantity*$rate,2);$note='Level '.$level.' '.$mealLabel.' policy: '.$quantity.' × ₹'.number_format($rate,2).'.';if($amount>$eligible)$note.=' Excess ₹'.number_format($amount-$eligible,2).' requires HR special approval.';
  }elseif($category==='MOBILE'){
    $eligible=(float)$policy['mobileMax'];if($eligible<=0)respond(['status'=>'error','message'=>'Mobile usage reimbursement is not applicable for Level '.$level.'.'],400);$note='Level '.$level.' mobile plan limit: ₹'.number_format($eligible,2).' for 84 days.';if($amount>$eligible)$note.=' Excess ₹'.number_format($amount-$eligible,2).' requires HR special approval.';
  }elseif($category==='TRAVEL'){
    if(!in_array($mode,['BUS','TRAIN','FLIGHT','PERSONAL'],true))respond(['status'=>'error','message'=>'Choose the mode of travel.'],400);
    if($mode==='PERSONAL'){$vehicleRequired=(string)$policy['vehicle'];if($vehicle!==$vehicleRequired)respond(['status'=>'error','message'=>'Level '.$level.' personal travel permits '.strtolower($vehicleRequired).' only.'],400);if($distance<=0)respond(['status'=>'error','message'=>'Enter the personal-vehicle distance in kilometres.'],400);$rate=(float)$policy['vehicleRate'];$eligible=round($distance*$rate,2);$note='Level '.$level.' personal '.strtolower($vehicle).' mileage: '.number_format($distance,2).' km × ₹'.number_format($rate,2).'/km.';if($amount>$eligible)$note.=' Excess ₹'.number_format($amount-$eligible,2).' requires HR special approval.';}
    else{$allowed=$policy[$mode]??[];if(!$allowed)respond(['status'=>'error','message'=>ucfirst(strtolower($mode)).' travel is not applicable for Level '.$level.'.'],400);if($class===''||!in_array($class,$allowed,true))respond(['status'=>'error','message'=>'Choose an eligible '.strtolower($mode).' class for Level '.$level.'.'],400);$note='Level '.$level.' eligible '.strtolower($mode).' class: '.$class.'.';}
  }
  return compact('category','level','basis','mode','class','vehicle','distance','rate','quantity','eligible','note');
}

function tour_expenses_storage_segment(string $value, string $fallback): string {
  $value = trim($value);
  if ($value === '') return $fallback;
  if (function_exists('transliterator_transliterate')) {
    $ascii = transliterator_transliterate('Any-Latin; Latin-ASCII', $value);
    if (is_string($ascii) && $ascii !== '') $value = $ascii;
  }
  $value = preg_replace('/[^A-Za-z0-9._-]+/', '-', $value) ?? '';
  $value = trim($value, '.-_');
  return $value !== '' ? substr($value, 0, 100) : $fallback;
}

function tour_expenses_trip_storage(int $tripId, string $employeeUsername): array {
  if ($tripId < 1) throw new InvalidArgumentException('A valid trip ID is required for bill storage.');
  $employeeFolder = tour_expenses_storage_segment($employeeUsername, 'employee');
  $tripFolder = 'TRIP-'.str_pad((string)$tripId, 10, '0', STR_PAD_LEFT);
  $relative = 'trip_expense/'.$employeeFolder.'/'.$tripFolder;
  return [
    'relative'=>$relative,
    'absolute'=>erp_persistent_storage_path($relative),
    'employeeFolder'=>$employeeFolder,
    'tripFolder'=>$tripFolder
  ];
}

function tour_expenses_ensure_trip_storage(int $tripId, string $employeeUsername): array {
  $storage = tour_expenses_trip_storage($tripId, $employeeUsername);
  if (!is_dir($storage['absolute']) && !mkdir($storage['absolute'], 0750, true) && !is_dir($storage['absolute'])) {
    throw new RuntimeException('The trip bill folder could not be created.');
  }
  return $storage;
}

function tour_expenses_is_managed_file(string $file): bool {
  return erp_path_is_inside($file, erp_persistent_storage_path('trip_expense'))
    || erp_path_is_inside($file, erp_persistent_storage_path('tour_expenses'));
}

function tour_expenses_attachment(array $file, int $tripId, string $employeeUsername): ?array {
  $error = (int)($file['error'] ?? UPLOAD_ERR_NO_FILE);
  if ($error === UPLOAD_ERR_NO_FILE) return null;
  $tmp = (string)($file['tmp_name'] ?? '');
  $size = (int)($file['size'] ?? 0);
  if ($error !== UPLOAD_ERR_OK || $size <= 0 || $size > 5 * 1024 * 1024 || !is_uploaded_file($tmp)) {
    respond(['status'=>'error','message'=>'Receipt upload failed or exceeds 5 MB.'], 400);
  }
  $mime = (new finfo(FILEINFO_MIME_TYPE))->file($tmp) ?: '';
  $extensions = ['image/jpeg'=>'jpg', 'image/png'=>'png', 'application/pdf'=>'pdf'];
  if (!isset($extensions[$mime])) respond(['status'=>'error','message'=>'Attach a JPG, PNG, or PDF receipt (maximum 5 MB).'], 415);
  try { $storage = tour_expenses_ensure_trip_storage($tripId, $employeeUsername); }
  catch (Throwable $error) { error_log('Trip receipt folder failed: '.$error->getMessage()); respond(['status'=>'error','message'=>'The trip bill folder could not be created.'], 500); }
  $filename = bin2hex(random_bytes(18)).'.'.$extensions[$mime];
  if (!move_uploaded_file($tmp, $storage['absolute'].DIRECTORY_SEPARATOR.$filename)) {
    respond(['status'=>'error','message'=>'The receipt could not be saved.'], 500);
  }
  return [
    'path'=>$storage['relative'].'/'.$filename,
    'name'=>tour_expenses_text($file['name'] ?? 'receipt', 180),
    'mime'=>$mime,
    'tripFolder'=>$storage['tripFolder']
  ];
}

function tour_expenses_is_hr(array $actor): bool {
  $role=strtolower(trim((string)($actor['role']??'')));
  $department=(string)($actor['department']??'');
  return $role==='hr' || preg_match('/\bhr\b|human resources?/i',$department)===1;
}

function tour_expenses_right(array $actor, string $right): bool {
  $rights=is_array($actor['rights']??null)?$actor['rights']:[];
  if (array_key_exists($right,$rights)) return has_assigned_right($actor,[$right]);
  return tour_expenses_is_hr($actor);
}

function tour_expenses_actor_can_view_all(array $actor): bool {
  return admin($actor) || tour_expenses_right($actor,'hrTourExpensesViewAll');
}

function tour_expenses_designation_name(mysqli $db, array $user): string {
  $designationId=(string)($user['designationId']??'');
  if(function_exists('approval_designation_names_cached')){
    $names=approval_designation_names_cached($db);
    if($designationId!==''&&!empty($names[$designationId]))return strtoupper(trim((string)$names[$designationId]));
  }
  return strtoupper(trim((string)($user['designation']??'')));
}

function tour_expenses_is_hr_manager(mysqli $db, array $user): bool {
  if(strtoupper(trim((string)($user['status']??'ACTIVE')))!=='ACTIVE')return false;
  $department=strtoupper(trim((string)preg_replace('/\s+/',' ',(string)($user['department']??''))));
  if(!preg_match('/^(?:HR|HUMAN RESOURCES?)$/',$department))return false;
  $designation=tour_expenses_designation_name($db,$user);
  return in_array($designation,['MANAGER','HR MANAGER','HUMAN RESOURCE MANAGER','HUMAN RESOURCES MANAGER'],true);
}

function tour_expenses_hr_managers(mysqli $db): array {
  $managers=[];
  foreach(all_users($db) as $user){
    if(!is_array($user)||!tour_expenses_is_hr_manager($db,$user))continue;
    $username=trim((string)($user['username']??''));
    if($username!=='')$managers[strtolower($username)]=$user;
  }
  return array_values($managers);
}

function tour_expenses_actor_can_approve(mysqli $db, array $actor): bool {
  return tour_expenses_is_hr_manager($db,$actor);
}

function tour_expenses_actor_can_export(array $actor): bool {
  return admin($actor) || tour_expenses_right($actor,'hrTourExpensesExport');
}

function tour_expenses_actor_can_reimburse(array $actor): bool {
  if(strtoupper(trim((string)($actor['status']??'ACTIVE')))!=='ACTIVE')return false;
  $department=strtoupper(trim((string)preg_replace('/\s+/',' ',(string)($actor['department']??''))));
  return admin($actor)||preg_match('/ACCOUNT|FINANCE/',$department)===1;
}

function tour_expenses_handle(mysqli $db, array $actor, string $action, string $method): void {
  if ($action !== 'tour_expenses' && $action !== 'tour_receipt') return;
  $username = tour_expenses_text($actor['username'] ?? '', 100);
  $employeeName = tour_expenses_text($actor['name'] ?? $username, 160);
  // Every authenticated employee may manage their own trips. Cross-employee
  // visibility, approval, and HR export remain separately permission-checked.
  try { tour_expenses_ensure_schema($db); }
  catch (Throwable $error) { error_log('Tour expense schema unavailable: '.$error->getMessage()); respond(['status'=>'error','message'=>'Tour Expenses could not connect to its database tables. Contact IT.'], 503); }

  if ($action === 'tour_receipt' && $method === 'GET') {
    $id = (int)($_GET['id'] ?? 0);
    $tripId = (int)($_GET['tripId'] ?? 0);
    if ($id < 1 || $tripId < 1) respond(['status'=>'error','message'=>'A valid trip and expense entry are required.'], 400);
    $stmt = $db->prepare('SELECT e.receipt_path,e.receipt_name,e.receipt_mime,t.employee_username FROM erp_employee_tour_expenses e JOIN erp_employee_tours t ON t.id=e.trip_id WHERE e.id=? AND e.trip_id=? LIMIT 1');
    if (!$stmt) respond(['status'=>'error','message'=>'Receipt could not be loaded.'], 500);
    $stmt->bind_param('ii', $id, $tripId); $stmt->execute(); $row = $stmt->get_result()->fetch_assoc(); $stmt->close();
    if (!$row || empty($row['receipt_path'])) respond(['status'=>'error','message'=>'Receipt not found.'], 404);
    $owns = hash_equals((string)$row['employee_username'], $username);
    if (!$owns && !tour_expenses_actor_can_view_all($actor) && !tour_expenses_actor_can_approve($db,$actor) && !tour_expenses_actor_can_export($actor) && !tour_expenses_actor_can_reimburse($actor)) respond(['status'=>'error','message'=>'You cannot view this receipt.'], 403);
    $file = erp_existing_storage_path((string)$row['receipt_path']);
    if (!tour_expenses_is_managed_file($file) || !is_file($file)) respond(['status'=>'error','message'=>'Receipt file not found.'], 404);
    $mode = strtolower(trim((string)($_GET['mode'] ?? 'preview')));
    $disposition = $mode === 'download' ? 'attachment' : 'inline';
    $safeName = str_replace('"','',preg_replace('/[^A-Za-z0-9._ -]/','_',basename((string)$row['receipt_name'])) ?: 'receipt');
    header_remove('Content-Type'); header('Content-Type: '.((string)$row['receipt_mime'] ?: 'application/octet-stream'));
    header('Content-Length: '.(string)filesize($file)); header('Content-Disposition: '.$disposition.'; filename="'.$safeName.'"');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-store, private'); readfile($file); exit;
  }

  if ($method === 'GET') {
    $scope = (string)($_GET['scope'] ?? 'mine');
    if ($scope === 'all' && !tour_expenses_actor_can_view_all($actor)) respond(['status'=>'error','message'=>'You do not have permission to view all employee trips.'], 403);
    if ($scope === 'pending' && !tour_expenses_actor_can_approve($db,$actor)) respond(['status'=>'error','message'=>'Only the active Human Resources Manager can approve trip expenses.'], 403);
    if ($scope === 'approved' && !tour_expenses_actor_can_export($actor)) respond(['status'=>'error','message'=>'HR Excel export access is required.'], 403);
    if ($scope === 'reimburse' && !tour_expenses_actor_can_reimburse($actor)) respond(['status'=>'error','message'=>'Only an authorized Accounts user can access reimbursements.'], 403);
    $where = '1=1'; $filterOwn = false; $recordId = 0; $recordWithOwner = false;
    if ($scope === 'record') {
      $recordId=(int)($_GET['tripId']??0);if($recordId<1)respond(['status'=>'error','message'=>'Choose a valid trip record.'],400);
      if(tour_expenses_actor_can_view_all($actor)||tour_expenses_actor_can_approve($db,$actor)||tour_expenses_actor_can_export($actor))$where='t.id=?';
      else{$where='t.id=? AND t.employee_username=?';$recordWithOwner=true;}
    }
    elseif ($scope === 'reimburse') $where .= " AND t.status IN ('APPROVED','SETTLED')";
    elseif ($scope === 'pending') $where .= " AND t.status='SUBMITTED'";
    elseif ($scope === 'approved') $where .= " AND t.status='APPROVED'";
    elseif ($scope === 'mine' || (!tour_expenses_actor_can_view_all($actor) && !tour_expenses_actor_can_approve($db,$actor) && !tour_expenses_actor_can_export($actor))) { $where = 't.employee_username=?'; $filterOwn=true; }
    $sql = "SELECT t.id,t.employee_username,t.employee_name,t.starting_point,t.destination,t.purpose,t.start_date,t.return_date,t.trip_notes,t.status,t.review_note,t.reviewed_by,t.reviewed_at,t.settled_by,t.settled_at,t.created_at,COALESCE(SUM(e.amount),0) AS total_amount,COUNT(e.id) AS expense_count,COALESCE(SUM(CASE WHEN e.paid_by='EMPLOYEE' THEN e.amount ELSE 0 END),0) AS employee_paid FROM erp_employee_tours t LEFT JOIN erp_employee_tour_expenses e ON e.trip_id=t.id WHERE {$where} GROUP BY t.id ORDER BY FIELD(t.status,'APPROVED','SETTLED','SUBMITTED','REJECTED','ONGOING'),t.start_date DESC,t.id DESC";
    $stmt = $db->prepare($sql); if (!$stmt) respond(['status'=>'error','message'=>'Trips could not be loaded.'], 500);
    if($recordWithOwner)$stmt->bind_param('is',$recordId,$username);elseif($scope==='record')$stmt->bind_param('i',$recordId);elseif($filterOwn)$stmt->bind_param('s',$username);
    $stmt->execute(); $result=$stmt->get_result(); $trips=[]; $ids=[];
    while($row=$result->fetch_assoc()) { $id=(int)$row['id']; $ids[]=$id; $trips[$id]=[
      'id'=>$id,'employeeUsername'=>$row['employee_username'],'employeeName'=>$row['employee_name'],'startingPoint'=>$row['starting_point'],'destination'=>$row['destination'],'purpose'=>$row['purpose'],'startDate'=>$row['start_date'],'returnDate'=>$row['return_date'],'notes'=>$row['trip_notes'],'status'=>$row['status'],'reviewNote'=>$row['review_note'],'reviewedBy'=>$row['reviewed_by'],'reviewedAt'=>$row['reviewed_at'],'settledBy'=>$row['settled_by'],'settledAt'=>$row['settled_at'],'createdAt'=>$row['created_at'],'total'=>(float)$row['total_amount'],'expenseCount'=>(int)$row['expense_count'],'employeePaid'=>(float)$row['employee_paid'],'expenses'=>[]]; }
    $stmt->close();
    if ($ids) {
      $expenseWhere = $where;
      $expenseSql = "SELECT e.id,e.trip_id,e.category,e.amount,e.expense_date,e.paid_by,e.payment_method,e.reference_number,e.vendor_name,e.description,e.receipt_path,e.receipt_name,e.receipt_mime,e.policy_level,e.claim_basis,e.travel_mode,e.travel_class,e.vehicle_type,e.distance_km,e.unit_rate,e.policy_quantity,e.eligible_amount,e.policy_note,e.special_approved_amount,e.approved_amount,e.hr_approval_note,e.created_at FROM erp_employee_tour_expenses e JOIN erp_employee_tours t ON t.id=e.trip_id WHERE {$expenseWhere} ORDER BY e.expense_date,e.id";
      $expenseStmt=$db->prepare($expenseSql); if(!$expenseStmt)respond(['status'=>'error','message'=>'Expense lines could not be loaded.'],500);
      if($recordWithOwner)$expenseStmt->bind_param('is',$recordId,$username);elseif($scope==='record')$expenseStmt->bind_param('i',$recordId);elseif($filterOwn)$expenseStmt->bind_param('s',$username);
      $expenseStmt->execute();$expenseResult=$expenseStmt->get_result();
      while($row=$expenseResult->fetch_assoc()){ $tripId=(int)$row['trip_id']; if(!isset($trips[$tripId]))continue; $expenseId=(int)$row['id']; $trips[$tripId]['expenses'][]=[
        'id'=>$expenseId,'tripId'=>$tripId,'category'=>$row['category'],'amount'=>(float)$row['amount'],'date'=>$row['expense_date'],'paidBy'=>$row['paid_by'],'paymentMethod'=>$row['payment_method'],'reference'=>$row['reference_number'],'vendor'=>$row['vendor_name'],'description'=>$row['description'],'policyLevel'=>$row['policy_level'],'claimBasis'=>$row['claim_basis'],'travelMode'=>$row['travel_mode'],'travelClass'=>$row['travel_class'],'vehicleType'=>$row['vehicle_type'],'distanceKm'=>(float)$row['distance_km'],'unitRate'=>(float)$row['unit_rate'],'quantity'=>(int)$row['policy_quantity'],'eligibleAmount'=>(float)$row['eligible_amount'],'policyNote'=>$row['policy_note'],'specialApprovedAmount'=>(float)$row['special_approved_amount'],'approvedAmount'=>(float)$row['approved_amount'],'hrApprovalNote'=>$row['hr_approval_note'],'receiptUrl'=>empty($row['receipt_path'])?'':'backend/api.php?action=tour_receipt&id='.$expenseId.'&tripId='.$tripId,'receiptName'=>$row['receipt_name'],'receiptMime'=>$row['receipt_mime'],'createdAt'=>$row['created_at']]; }
      $expenseStmt->close();
    }
    respond(['status'=>'success','scope'=>$scope,'trips'=>array_values($trips)]);
  }

  if ($action !== 'tour_expenses' || $method !== 'POST') respond(['status'=>'error','message'=>'Unsupported Tour Expenses request.'], 405);
  $data = str_starts_with(strtolower((string)($_SERVER['CONTENT_TYPE'] ?? '')), 'multipart/form-data') ? $_POST : json_body();
  $operation = (string)($data['operation'] ?? '');
  $canAll = tour_expenses_actor_can_view_all($actor);
  $lookupTrip = static function(int $tripId) use($db,$username,$canAll): ?array {
    $stmt=$db->prepare('SELECT id,employee_username,status FROM erp_employee_tours WHERE id=? LIMIT 1');
    if(!$stmt)return null; $stmt->bind_param('i',$tripId);$stmt->execute();$trip=$stmt->get_result()->fetch_assoc();$stmt->close();
    if(!$trip||(!hash_equals((string)$trip['employee_username'],$username)&&!$canAll))return null; return $trip;
  };
  try {
    if ($operation === 'create_trip') {
      $startingPoint=tour_expenses_text($data['startingPoint']??'',160);$destination=tour_expenses_text($data['destination']??'',160); $purpose=tour_expenses_text($data['purpose']??'',240); $start=tour_expenses_valid_date($data['startDate']??''); $return=tour_expenses_valid_date($data['returnDate']??'',true); $notes=tour_expenses_text($data['notes']??'',4000);
      if($startingPoint===''||$destination===''||$purpose===''||!$start||($return&&$return<$start))respond(['status'=>'error','message'=>'Enter the starting point, destination, purpose, and valid trip dates.'],400);
      $open=$db->prepare("SELECT id FROM erp_employee_tours WHERE employee_username=? AND status IN ('ONGOING','REJECTED') LIMIT 1");if(!$open)throw new RuntimeException('Active trip could not be checked.');$open->bind_param('s',$username);$open->execute();$openTrip=$open->get_result()->fetch_assoc();$open->close();if($openTrip)respond(['status'=>'error','message'=>'Finish or resubmit your current trip before starting another one.'],409);
      $stmt=$db->prepare("INSERT INTO erp_employee_tours(employee_username,employee_name,starting_point,destination,purpose,start_date,return_date,trip_notes,status) VALUES(?,?,?,?,?,?,?,?,'ONGOING')");if(!$stmt)throw new RuntimeException('Trip could not be prepared.');$stmt->bind_param('ssssssss',$username,$employeeName,$startingPoint,$destination,$purpose,$start,$return,$notes);if(!$stmt->execute())throw new RuntimeException('Trip could not be saved.');$id=(int)$stmt->insert_id;$stmt->close();
      try{$storage=tour_expenses_ensure_trip_storage($id,$username);}catch(Throwable $storageError){$cleanup=$db->prepare('DELETE FROM erp_employee_tours WHERE id=?');if($cleanup){$cleanup->bind_param('i',$id);$cleanup->execute();$cleanup->close();}throw $storageError;}
      respond(['status'=>'success','message'=>'Trip started.','id'=>$id,'tripUid'=>$storage['tripFolder']]);
    }
    if ($operation === 'add_expense') {
      $tripId=(int)($data['tripId']??0);$trip=$lookupTrip($tripId);if(!$trip||(!hash_equals((string)$trip['employee_username'],$username)&&!admin($actor)))respond(['status'=>'error','message'=>'Trip not found or you cannot edit it.'],404);
      if(!in_array($trip['status'],['ONGOING','REJECTED'],true))respond(['status'=>'error','message'=>'This trip is locked after submission.'],409);
      $category=tour_expenses_text($data['category']??'',80);$amount=(float)($data['amount']??0);$date=tour_expenses_valid_date($data['expenseDate']??'');$paidByMap=['Employee paid'=>'EMPLOYEE','EMPLOYEE'=>'EMPLOYEE','Company paid'=>'COMPANY','COMPANY'=>'COMPANY','Company advance'=>'ADVANCE','ADVANCE'=>'ADVANCE'];$paidBy=$paidByMap[(string)($data['paidBy']??'Employee paid')]??'EMPLOYEE';$method=tour_expenses_text($data['paymentMethod']??'Cash',40);$reference=tour_expenses_text($data['reference']??'',120);$vendor=tour_expenses_text($data['vendor']??'',180);$description=tour_expenses_text($data['description']??'',1200);
      if($category===''||$amount<=0||$amount>999999999||!$date||$description==='')respond(['status'=>'error','message'=>'Enter an expense type, amount, date, and details.'],400);
      $policyClaim=tour_expenses_policy_claim($actor,$data,$category,$amount);$category=$policyClaim['category'];$policyLevel=$policyClaim['level'];$claimBasis=$policyClaim['basis'];$travelMode=$policyClaim['mode'];$travelClass=$policyClaim['class'];$vehicleType=$policyClaim['vehicle'];$distanceKm=(float)$policyClaim['distance'];$unitRate=(float)$policyClaim['rate'];$policyQuantity=(int)$policyClaim['quantity'];$eligibleAmount=(float)$policyClaim['eligible'];$policyNote=$policyClaim['note'];
      $receipt=isset($_FILES['receipt'])?tour_expenses_attachment($_FILES['receipt'],$tripId,(string)$trip['employee_username']):null;
      $path=$receipt['path']??null;$receiptName=$receipt['name']??null;$mime=$receipt['mime']??null;
      $stmt=$db->prepare('INSERT INTO erp_employee_tour_expenses(trip_id,category,amount,expense_date,paid_by,payment_method,reference_number,vendor_name,description,receipt_path,receipt_name,receipt_mime,created_by,policy_level,claim_basis,travel_mode,travel_class,vehicle_type,distance_km,unit_rate,policy_quantity,eligible_amount,policy_note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');if(!$stmt)throw new RuntimeException('Expense could not be prepared.');$types='isd'.str_repeat('s',15).'ddids';$stmt->bind_param($types,$tripId,$category,$amount,$date,$paidBy,$method,$reference,$vendor,$description,$path,$receiptName,$mime,$username,$policyLevel,$claimBasis,$travelMode,$travelClass,$vehicleType,$distanceKm,$unitRate,$policyQuantity,$eligibleAmount,$policyNote);if(!$stmt->execute()){if($receipt)@unlink(erp_persistent_storage_path($receipt['path']));throw new RuntimeException('Expense could not be saved.');}$id=(int)$stmt->insert_id;$stmt->close();$savedMessage=$policyLevel!==''?'Expense saved under the Level '.$policyLevel.' TA/DA policy.':'Expense saved for HR review.';respond(['status'=>'success','message'=>$savedMessage,'id'=>$id,'eligibleAmount'=>$eligibleAmount]);
    }
    if($operation==='save_expense_special_approval'){
      if(!tour_expenses_actor_can_approve($db,$actor))respond(['status'=>'error','message'=>'Only the active Human Resources Manager can approve excess claims.'],403);$expenseId=(int)($data['expenseId']??0);$special=max(0.0,(float)($data['specialAmount']??0));$hrNote=tour_expenses_text($data['hrNote']??'',500);
      $check=$db->prepare("SELECT e.amount,e.eligible_amount,t.status FROM erp_employee_tour_expenses e JOIN erp_employee_tours t ON t.id=e.trip_id WHERE e.id=? LIMIT 1");$check->bind_param('i',$expenseId);$check->execute();$expense=$check->get_result()->fetch_assoc();$check->close();if(!$expense||$expense['status']!=='SUBMITTED')respond(['status'=>'error','message'=>'This expense is not awaiting HR approval.'],409);
      $claimed=(float)$expense['amount'];$allowed=(float)$expense['eligible_amount'];if($allowed<=0||$allowed>$claimed)$allowed=$claimed;$difference=max(0.0,$claimed-$allowed);if($special>$difference)respond(['status'=>'error','message'=>'Special approval cannot exceed the policy difference of ₹'.number_format($difference,2).'.'],400);if($special>0&&$hrNote==='')respond(['status'=>'error','message'=>'Add an HR note for the special approval amount.'],400);$approved=round($allowed+$special,2);
      $save=$db->prepare('UPDATE erp_employee_tour_expenses SET special_approved_amount=?,approved_amount=?,hr_approval_note=? WHERE id=?');$save->bind_param('ddsi',$special,$approved,$hrNote,$expenseId);$save->execute();$save->close();respond(['status'=>'success','message'=>'Expense approval values saved.','approvedAmount'=>$approved]);
    }
    if ($operation === 'delete_expense') {
      $expenseId=(int)($data['expenseId']??0);$stmt=$db->prepare('SELECT e.trip_id,e.receipt_path,t.employee_username,t.status FROM erp_employee_tour_expenses e JOIN erp_employee_tours t ON t.id=e.trip_id WHERE e.id=? LIMIT 1');if(!$stmt)throw new RuntimeException('Expense could not be checked.');$stmt->bind_param('i',$expenseId);$stmt->execute();$row=$stmt->get_result()->fetch_assoc();$stmt->close();if(!$row||(!hash_equals((string)$row['employee_username'],$username)&&!admin($actor))||!in_array($row['status'],['ONGOING','REJECTED'],true))respond(['status'=>'error','message'=>'Expense not found or locked.'],404);$del=$db->prepare('DELETE FROM erp_employee_tour_expenses WHERE id=?');$del->bind_param('i',$expenseId);$del->execute();$del->close();if(!empty($row['receipt_path'])){@unlink(erp_existing_storage_path((string)$row['receipt_path']));}respond(['status'=>'success','message'=>'Expense removed.']);
    }
    if ($operation === 'delete_trip') {
      $tripId=(int)($data['tripId']??0);$trip=$lookupTrip($tripId);if(!$trip||(!hash_equals((string)$trip['employee_username'],$username)&&!admin($actor)))respond(['status'=>'error','message'=>'Trip not found or you cannot delete it.'],404);
      $tripStatus=strtoupper((string)($trip['status']??''));if($tripStatus==='APPROVED')respond(['status'=>'error','message'=>'An approved trip is protected for the HR, Accounts, and audit records.'],409);if(!in_array($tripStatus,['ONGOING','REJECTED','SUBMITTED'],true))respond(['status'=>'error','message'=>'This trip cannot be deleted in its current status.'],409);
      $files=$db->prepare('SELECT receipt_path FROM erp_employee_tour_expenses WHERE trip_id=?');$files->bind_param('i',$tripId);$files->execute();$fileResult=$files->get_result();$paths=[];while($fileRow=$fileResult->fetch_assoc())if(!empty($fileRow['receipt_path']))$paths[]=(string)$fileRow['receipt_path'];$files->close();
      $del=$db->prepare('DELETE FROM erp_employee_tours WHERE id=?');if(!$del)throw new RuntimeException('Trip could not be deleted.');$del->bind_param('i',$tripId);$del->execute();$changed=$del->affected_rows;$del->close();if(!$changed)respond(['status'=>'error','message'=>'Trip was already deleted.'],404);
      $auditId=null;$auditLegacy=null;
      try{$audit=append_audit_event($db,$actor,'HR','TRIP_EXPENSE_DELETED','Deleted own trip expense #'.$tripId.' while its status was '.$tripStatus.'.');[$auditId,$auditLegacy]=erp_notification_audit_link($db,$audit);}catch(Throwable $auditError){error_log('Trip deletion audit failed: '.$auditError->getMessage());}
      if($tripStatus==='SUBMITTED'){try{erp_notification_resolve_group($db,'TRIP_EXPENSE:'.$tripId.':MANAGER',$employeeName.' (cancelled)',$auditId,$auditLegacy);}catch(Throwable $notificationError){error_log('Trip deletion notification resolution failed: '.$notificationError->getMessage());}}
      foreach($paths as $path){$file=erp_existing_storage_path($path);if(tour_expenses_is_managed_file($file)&&is_file($file))@unlink($file);}respond(['status'=>'success','message'=>$tripStatus==='SUBMITTED'?'Trip deleted and pending approval cancelled.':'Trip and its expenses were deleted.']);
    }
    if ($operation === 'submit_trip') {
      $tripId=(int)($data['tripId']??0);$trip=$lookupTrip($tripId);if(!$trip||!hash_equals((string)$trip['employee_username'],$username))respond(['status'=>'error','message'=>'Trip not found or you cannot submit it.'],404);if(!in_array($trip['status'],['ONGOING','REJECTED'],true))respond(['status'=>'error','message'=>'This trip is already finished and sent for approval.'],409);
      $count=$db->prepare('SELECT COUNT(*) AS n FROM erp_employee_tour_expenses WHERE trip_id=?');$count->bind_param('i',$tripId);$count->execute();$n=(int)($count->get_result()->fetch_assoc()['n']??0);$count->close();if($n<1)respond(['status'=>'error','message'=>'Add at least one expense before finishing the trip.'],400);
      $hrManagers=tour_expenses_hr_managers($db);if(!$hrManagers)respond(['status'=>'error','message'=>'No active Human Resources Manager is configured. Ask IT to assign the Manager designation in the Human Resource department.'],409);
      $stmt=$db->prepare("UPDATE erp_employee_tours SET status='SUBMITTED',review_note=NULL,reviewed_by=NULL,reviewed_at=NULL WHERE id=?");$stmt->bind_param('i',$tripId);$stmt->execute();$stmt->close();
      $audit=append_audit_event($db,$actor,'HR','TRIP_EXPENSE_SUBMITTED','Submitted trip expense #'.$tripId.' directly for Human Resources Manager approval.');[$auditId,$auditLegacy]=erp_notification_audit_link($db,$audit);
      $notice=[
        'type'=>'APPROVAL','category'=>'APPROVAL','priority'=>'HIGH','title'=>'Trip expense needs approval',
        'message'=>$employeeName.' submitted trip #'.$tripId.' with '.$n.' expense entr'.($n===1?'y':'ies').'.',
        'entityType'=>'TRIP_EXPENSE','entityId'=>(string)$tripId,'targetView'=>'hrTourExpenses','targetPayload'=>['scope'=>'pending','tripId'=>$tripId],
        'approvalGroupKey'=>'TRIP_EXPENSE:'.$tripId.':MANAGER','actionable'=>true,'auditEventId'=>$auditId,'auditLegacyId'=>$auditLegacy
      ];
      foreach($hrManagers as $hrManager)erp_notification_create($db,$hrManager,$notice);
      respond(['status'=>'success','message'=>'Trip finished and sent directly to the Human Resources Manager for approval.']);
    }
    if ($operation === 'review_trip') {
      if(!tour_expenses_actor_can_approve($db,$actor))respond(['status'=>'error','message'=>'Only the active Human Resources Manager can approve or reject trip expenses.'],403);$tripId=(int)($data['tripId']??0);$decision=strtoupper((string)($data['decision']??''));$note=tour_expenses_text($data['reviewNote']??'',1200);if(!in_array($decision,['APPROVED','REJECTED'],true))respond(['status'=>'error','message'=>'Choose approve or reject.'],400);if($decision==='REJECTED'&&$note==='')respond(['status'=>'error','message'=>'Add a reason when rejecting a trip.'],400);
      $ownerStmt=$db->prepare("SELECT employee_username,employee_name,destination FROM erp_employee_tours WHERE id=? AND status='SUBMITTED' LIMIT 1");if(!$ownerStmt)throw new RuntimeException('Trip owner could not be checked.');$ownerStmt->bind_param('i',$tripId);$ownerStmt->execute();$tripOwner=$ownerStmt->get_result()->fetch_assoc();$ownerStmt->close();if(!$tripOwner)respond(['status'=>'error','message'=>'This trip is no longer waiting for approval. Refresh the approvals list.'],409);
      if($decision==='APPROVED'){$calculate=$db->prepare('UPDATE erp_employee_tour_expenses SET approved_amount=LEAST(amount,IF(eligible_amount>0,eligible_amount,amount))+LEAST(special_approved_amount,GREATEST(0,amount-LEAST(amount,IF(eligible_amount>0,eligible_amount,amount)))) WHERE trip_id=?');$calculate->bind_param('i',$tripId);$calculate->execute();$calculate->close();}
      $stmt=$db->prepare("UPDATE erp_employee_tours SET status=?,review_note=?,reviewed_by=?,reviewed_at=NOW() WHERE id=? AND status='SUBMITTED'");if(!$stmt)throw new RuntimeException('Review could not be prepared.');$reviewer=tour_expenses_text($actor['name']??$username,160);$stmt->bind_param('sssi',$decision,$note,$reviewer,$tripId);$stmt->execute();$changed=$stmt->affected_rows;$stmt->close();if(!$changed)respond(['status'=>'error','message'=>'This trip is no longer waiting for approval. Refresh the approvals list.'],409);
      $audit=append_audit_event($db,$actor,'HR','TRIP_EXPENSE_'.$decision,ucfirst(strtolower($decision)).' trip expense #'.$tripId.' for '.(string)$tripOwner['employee_username'].'.');[$auditId,$auditLegacy]=erp_notification_audit_link($db,$audit);
      erp_notification_resolve_group($db,'TRIP_EXPENSE:'.$tripId.':MANAGER',$reviewer,$auditId,$auditLegacy);
      erp_notification_send_to_username($db,(string)$tripOwner['employee_username'],[
        'type'=>$decision==='APPROVED'?'SUCCESS':'WARNING','category'=>'APPROVAL','priority'=>$decision==='APPROVED'?'NORMAL':'HIGH',
        'title'=>$decision==='APPROVED'?'Trip expense approved':'Trip expense returned',
        'message'=>$decision==='APPROVED'?$reviewer.' approved trip #'.$tripId.'.':$reviewer.' returned trip #'.$tripId.($note!==''?': '.$note:''),
        'entityType'=>'TRIP_EXPENSE','entityId'=>(string)$tripId,'targetView'=>'hrTourExpenses','targetPayload'=>['scope'=>'mine','tripId'=>$tripId],
        'auditEventId'=>$auditId,'auditLegacyId'=>$auditLegacy
      ]);
      respond(['status'=>'success','message'=>$decision==='APPROVED'?'Trip approved by the Human Resources Manager.':'Trip returned to the employee with your note.']);
    }
    if ($operation === 'settle_trip') {
      if(!tour_expenses_actor_can_reimburse($actor))respond(['status'=>'error','message'=>'Only an authorized Accounts user can settle reimbursements.'],403);
      $tripId=(int)($data['tripId']??0);if($tripId<1)respond(['status'=>'error','message'=>'Choose a valid approved trip.'],400);
      $ownerStmt=$db->prepare("SELECT employee_username,employee_name,destination FROM erp_employee_tours WHERE id=? AND status='APPROVED' LIMIT 1");if(!$ownerStmt)throw new RuntimeException('Reimbursement could not be checked.');$ownerStmt->bind_param('i',$tripId);$ownerStmt->execute();$tripOwner=$ownerStmt->get_result()->fetch_assoc();$ownerStmt->close();if(!$tripOwner)respond(['status'=>'error','message'=>'This trip is not awaiting reimbursement or has already been settled.'],409);
      $settledBy=tour_expenses_text($actor['name']??$username,100);$stmt=$db->prepare("UPDATE erp_employee_tours SET status='SETTLED',settled_by=?,settled_at=NOW() WHERE id=? AND status='APPROVED'");if(!$stmt)throw new RuntimeException('Reimbursement could not be prepared.');$stmt->bind_param('si',$settledBy,$tripId);$stmt->execute();$changed=$stmt->affected_rows;$stmt->close();if(!$changed)respond(['status'=>'error','message'=>'This reimbursement was already processed. Refresh the list.'],409);
      $audit=append_audit_event($db,$actor,'ACCOUNTS','TRIP_REIMBURSEMENT_SETTLED','Settled HR-approved trip reimbursement #'.$tripId.' for '.(string)$tripOwner['employee_username'].'.');[$auditId,$auditLegacy]=erp_notification_audit_link($db,$audit);
      erp_notification_send_to_username($db,(string)$tripOwner['employee_username'],[
        'type'=>'SUCCESS','category'=>'APPROVAL','priority'=>'NORMAL','title'=>'Trip reimbursement settled',
        'message'=>$settledBy.' marked trip #'.$tripId.' as settled by Accounts.',
        'entityType'=>'TRIP_EXPENSE','entityId'=>(string)$tripId,'targetView'=>'hrTourExpenses','targetPayload'=>['scope'=>'mine','tripId'=>$tripId],
        'auditEventId'=>$auditId,'auditLegacyId'=>$auditLegacy
      ]);
      respond(['status'=>'success','message'=>'The trip reimbursement has been marked as settled.']);
    }
    respond(['status'=>'error','message'=>'Unsupported Tour Expenses operation.'],400);
  } catch (Throwable $error) { error_log('Tour Expenses write failed: '.$error->getMessage()); respond(['status'=>'error','message'=>'The trip or expense could not be saved. Contact IT if the problem continues.'],500); }
}
