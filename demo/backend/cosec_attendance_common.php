<?php
declare(strict_types=1);

function cosec_attendance_ready(mysqli $db): bool {
    $result=$db->query("SELECT 1 FROM erp_schema_migrations WHERE migration_key='20261016_13_cosec_attendance' LIMIT 1");
    return (bool)($result&&$result->num_rows>0);
}
function cosec_attendance_bootstrap(mysqli $db): void {
    if(cosec_attendance_ready($db))return;
    $lock=$db->query("SELECT GET_LOCK('demosolar_erp_cosec_attendance_bootstrap',60)");
    if((int)($lock?$lock->fetch_row()[0]??0:0)!==1)throw new RuntimeException('Attendance initialization is busy.');
    try{
        if(cosec_attendance_ready($db))return;
        $sql=file_get_contents(__DIR__.'/migrate_cosec_attendance.sql');
        if(!is_string($sql)||trim($sql)===''||!$db->multi_query($sql))throw new RuntimeException('Attendance schema could not be initialized: '.$db->error);
        do{if($set=$db->store_result())$set->free();if(!$db->more_results())break;}while($db->next_result());
        if($db->errno)throw new RuntimeException('Attendance schema could not be initialized: '.$db->error);
    }finally{$db->query("SELECT RELEASE_LOCK('demosolar_erp_cosec_attendance_bootstrap')");}
}
function cosec_text(mixed $value,int $limit=255): string {
    $value=trim(preg_replace('/[\x00-\x1F\x7F]/u',' ',(string)$value)??'');
    return function_exists('mb_substr')?mb_substr($value,0,$limit):substr($value,0,$limit);
}
function cosec_date(?string $value): ?string {
    $value=trim((string)$value);if($value==='')return null;
    foreach(['Y-m-d','d/m/Y','d-m-Y','m/d/Y','Y/m/d','d.m.Y'] as $format){$date=DateTimeImmutable::createFromFormat('!'.$format,$value);$errors=DateTimeImmutable::getLastErrors();if($date&&($errors===false||((int)$errors['warning_count']===0&&(int)$errors['error_count']===0)))return $date->format('Y-m-d');}
    $timestamp=strtotime($value);return $timestamp===false?null:date('Y-m-d',$timestamp);
}
function cosec_time(?string $value): ?string {
    $value=trim((string)$value);if($value==='')return null;
    foreach(['H:i:s','H:i','h:i:s A','h:i A'] as $format){$time=DateTimeImmutable::createFromFormat('!'.$format,$value);$errors=DateTimeImmutable::getLastErrors();if($time&&($errors===false||((int)$errors['warning_count']===0&&(int)$errors['error_count']===0)))return $time->format('H:i:s');}
    $timestamp=strtotime($value);return $timestamp===false?null:date('H:i:s',$timestamp);
}
