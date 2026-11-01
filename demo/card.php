<?php
declare(strict_types=1);
$nonce=base64_encode(random_bytes(18));
$cardId=strtoupper(trim((string)($_GET['id']??'')));
$publicCard=null;
$cardLoadFailed=false;
if(preg_match('/^SB[A-HJ-NP-Z2-9]{8}$/',$cardId)){
  try{
    require_once __DIR__.'/backend/persistent_paths.php';
    $dbConfig=['db_host'=>getenv('ERP_DB_HOST')?:'127.0.0.1','db_port'=>(int)(getenv('ERP_DB_PORT')?:3306),'db_name'=>getenv('ERP_DB_NAME')?:'demosolar_erp','db_user'=>getenv('ERP_DB_USER')?:'root','db_pass'=>getenv('ERP_DB_PASSWORD')?:''];
    $dbConfigPath=erp_config_path();
    if(is_file($dbConfigPath)){$localConfig=require $dbConfigPath;if(is_array($localConfig))$dbConfig=array_replace($dbConfig,$localConfig);}
    mysqli_report(MYSQLI_REPORT_OFF);
    $db=@new mysqli((string)$dbConfig['db_host'],(string)$dbConfig['db_user'],(string)$dbConfig['db_pass'],(string)$dbConfig['db_name'],(int)$dbConfig['db_port']);
    if($db->connect_error)throw new RuntimeException('The card database is unavailable.');
    $db->set_charset('utf8mb4');
    require_once __DIR__.'/backend/module_state.php';
    $cards=module_state_read($db,'DEMOSOLAR_NFC_CARDS_V1');
    foreach(is_array($cards)?$cards:[] as $card){
      if(!is_array($card)||strtoupper((string)($card['id']??''))!==$cardId||($card['publicApproved']??false)!==true)continue;
      $publicCard=[];
      foreach(['id','fullName','jobTitle','department','phone','whatsapp','email','officeAddress','linkedin','instagram','website','googleMaps','photoUrl','brochureUrl'] as $field)$publicCard[$field]=substr((string)($card[$field]??''),0,2000);
      $publicCard['publicApproved']=true;
      break;
    }
    $db->close();
  }catch(Throwable $error){$cardLoadFailed=true;}
}
header('Content-Type: text/html; charset=UTF-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('X-Frame-Options: DENY');
header('Cache-Control: no-store');
header("Content-Security-Policy: default-src 'none'; script-src 'nonce-{$nonce}'; style-src 'nonce-{$nonce}'; img-src 'self' https: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta name="theme-color" content="#0876a6">
  <title>DemoSolar Industries | Employee Card</title>
  <style nonce="<?= htmlspecialchars($nonce, ENT_QUOTES, 'UTF-8') ?>">
    :root{--blue:#0876a6;--green:#60a900;--ink:#17232c;--muted:#61717b;--line:#e2e9ec;--page:#f2f6f7}
    *{box-sizing:border-box}body{margin:0;padding:24px 14px 40px;background:var(--page);color:var(--ink);font:16px/1.45 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
    .wrap{max-width:540px;margin:auto}.brand,.profile,.message{background:#fff;border:1px solid var(--line);border-radius:20px;box-shadow:0 12px 34px #1736470c}
    .brand{overflow:hidden;text-align:center;padding:15px 18px 0}.brand img{width:min(100%,330px);height:100px;object-fit:contain;display:block;margin:auto auto 10px}
    .slogan{margin:0 -18px;padding:10px 12px;color:#fff;font-weight:750;background:linear-gradient(100deg,var(--blue),var(--green))}
    .profile{margin-top:16px;overflow:hidden}.hero{text-align:center;padding:24px 20px 16px}.portrait{display:none;width:120px;height:120px;border-radius:50%;object-fit:cover;object-position:center;margin:0 auto 13px;border:4px solid #e7f0f3;box-shadow:0 4px 16px #17364722}
    h1{font-size:25px;line-height:1.2;letter-spacing:.02em;margin:0}.title{font-weight:650;color:var(--muted);margin:6px 0 0}.department{margin:3px 0 0;color:var(--blue);font-weight:700}
    .actions{padding:0 14px 14px}.action{display:flex;align-items:center;gap:12px;min-height:58px;margin-top:9px;padding:10px 13px;border:1px solid var(--line);border-radius:14px;background:#fff;color:var(--ink);text-decoration:none;overflow-wrap:anywhere}
    .action:hover{background:#f8fcfd;border-color:#add1dc}.icon{display:grid;place-items:center;flex:0 0 32px;width:32px;height:32px;border-radius:10px;background:#e9f4f7;color:var(--blue);font-weight:800}
    .label{display:block;font-size:12px;color:var(--muted);line-height:1.2}.value{display:block;font-weight:650;margin-top:2px}.address{padding:0 18px 18px;color:var(--muted);font-size:14px;text-align:center}
    .save{display:flex;justify-content:center;margin:0 14px 16px;padding:13px;border-radius:13px;background:var(--blue);color:#fff;font-weight:750;text-decoration:none}.save:hover{background:#05648f}
    .message{margin-top:16px;padding:22px;text-align:center;color:var(--muted)}.message h1{font-size:22px;color:var(--ink);margin-bottom:8px}.footer{text-align:center;color:#74828a;font-size:12px;padding:16px 8px}[hidden]{display:none!important}
  </style>
</head>
<body>
  <main class="wrap">
    <header class="brand" id="brand" hidden><img src="assets/demo-logo.svg" alt="DemoSolar Industries Pvt. Ltd."><p class="slogan">Think Solar. Think DemoSolar</p></header>
    <section class="message" id="message" aria-live="polite" <?= $publicCard||preg_match('/^SB[A-HJ-NP-Z2-9]{8}$/',$cardId)?'hidden':'' ?>><h1><?= $cardLoadFailed?'Card temporarily unavailable':'Employee card not available' ?></h1><?php if(!$cardLoadFailed): ?><p><?= preg_match('/^SB[A-HJ-NP-Z2-9]{8}$/',$cardId)?'In ERP, save this employee profile and mark it approved for public display, then use its current card link.':'Scan an employee’s NFC card or QR code to open their profile.' ?></p><?php else: ?><p>Please try again later or contact DemoSolar Industries.</p><?php endif; ?></section>
    <script type="application/json" id="publicCardData" nonce="<?= htmlspecialchars($nonce, ENT_QUOTES, 'UTF-8') ?>"><?= $publicCard?json_encode($publicCard,JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES):'null' ?></script>
    <section class="profile" id="profile" aria-label="DemoSolar employee digital business card" hidden>
      <div class="hero"><img class="portrait" id="photo" alt=""><h1 id="name"></h1><p class="title" id="title" hidden></p><p class="department" id="department">DemoSolar Industries Pvt. Ltd.</p></div>
      <nav class="actions" id="actions" aria-label="Contact options"></nav>
      <p class="address" id="address" hidden></p>
      <a class="save" id="saveContact" href="#" download hidden>Save Contact</a>
    </section>
    <footer class="footer" id="footer" hidden>DemoSolar Industries Pvt. Ltd. · Think Solar, Think DemoSolar</footer>
  </main>
  <script nonce="<?= htmlspecialchars($nonce, ENT_QUOTES, 'UTF-8') ?>">
  (()=>{
    const $=id=>document.getElementById(id);
    const showMessage=(heading,detail)=>{const box=$('message');box.hidden=false;box.replaceChildren();const h=document.createElement('h1');h.textContent=heading;box.append(h);if(detail){const p=document.createElement('p');p.textContent=detail;box.append(p);}};
    const safeHttps=value=>{try{const u=new URL(String(value||''));return u.protocol==='https:'?u.href:'';}catch(_){return '';}};
    const safePhoto=value=>{const raw=String(value||'');if(/^backend\/api\.php\?action=public_nfc_photo&id=SB[A-HJ-NP-Z2-9]{8}$/.test(raw))return new URL(raw,location.href).href;return safeHttps(raw);};
    const safeBrochure=value=>{const raw=String(value||'').trim();if(/^backend\/api\.php\?action=public_nfc_brochure&id=SB[A-HJ-NP-Z2-9]{8}$/.test(raw))return new URL(raw,location.href).href;return '';};
    const safeWhatsApp=value=>{try{const u=new URL(String(value||'').trim());if(u.protocol!=='https:'||u.hostname.toLowerCase()!=='wa.me'||u.username||u.password||u.search||u.hash)return '';return /^\/91\d{10}\/?$/.test(u.pathname)?'https://wa.me'+u.pathname.replace(/\/$/,''):'';}catch(_){return '';}};
    const digits=value=>String(value||'').replace(/\D/g,'');
    const addAction=(icon,label,value,href,external=false)=>{if(!value||!href)return;const a=document.createElement('a');a.className='action';a.href=href;if(external){a.target='_blank';a.rel='noopener noreferrer';}const mark=document.createElement('span');mark.className='icon';mark.textContent=icon;const copy=document.createElement('span');const caption=document.createElement('span');caption.className='label';caption.textContent=label;const text=document.createElement('span');text.className='value';text.textContent=value;copy.append(caption,text);a.append(mark,copy);$('actions').append(a);};
    const esc=value=>String(value||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
    const render=card=>{document.title=`${card.fullName} | DemoSolar Industries`;$('message').hidden=true;$('brand').hidden=false;$('profile').hidden=false;$('footer').hidden=false;$('name').textContent=card.fullName;if(card.jobTitle){$('title').textContent=card.jobTitle;$('title').hidden=false;}if(card.department)$('department').textContent=card.department;const photo=safePhoto(card.photoUrl);if(photo){$('photo').src=photo;$('photo').alt=card.fullName;$('photo').style.display='block';$('photo').addEventListener('error',()=>{$('photo').style.display='none';},{once:true});}
      const phone=String(card.phone||'').trim();if(phone)addAction('☎','Phone',phone,`tel:${phone.replace(/[^+\d]/g,'')}`);const email=String(card.email||'').trim();if(email&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))addAction('✉','Email',email,`mailto:${email}`);const wa=safeWhatsApp(card.whatsapp);if(wa)addAction('W','WhatsApp','Open direct WhatsApp chat',wa,true);const linkedin=safeHttps(card.linkedin);if(linkedin)addAction('in','LinkedIn','View LinkedIn profile',linkedin,true);const instagram=safeHttps(card.instagram);if(instagram)addAction('◎','Instagram','View Instagram profile',instagram,true);const website=safeHttps(card.website);if(website)addAction('↗','Website',new URL(website).hostname,website,true);const maps=safeHttps(card.googleMaps);if(maps)addAction('⌖','Google Maps','Open office location',maps,true);const brochure=safeBrochure(card.brochureUrl);if(brochure)addAction('📄','Company Brochure','Open company brochure PDF',brochure,true);if(card.officeAddress){$('address').textContent=card.officeAddress;$('address').hidden=false;}
      const vcard=['BEGIN:VCARD','VERSION:3.0',`N:${esc(card.fullName)}`,`FN:${esc(card.fullName)}`,card.jobTitle?`TITLE:${esc(card.jobTitle)}`:'',card.department?`ORG:DemoSolar Industries Pvt. Ltd.;${esc(card.department)}`:'ORG:DemoSolar Industries Pvt. Ltd.',phone?`TEL;TYPE=WORK,VOICE:${esc(phone)}`:'',email?`EMAIL;TYPE=WORK:${esc(email)}`:'',card.officeAddress?`ADR;TYPE=WORK:;;${esc(card.officeAddress)}`:'',linkedin?`URL:${linkedin}`:'','END:VCARD'].filter(Boolean).join('\r\n');$('saveContact').href=URL.createObjectURL(new Blob([vcard],{type:'text/vcard;charset=utf-8'}));$('saveContact').download=`${String(card.fullName).replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')||'demosolar-contact'}.vcf`;$('saveContact').hidden=false;};
    const id=new URLSearchParams(location.search).get('id');if(!id||!/^SB[A-HJ-NP-Z2-9]{8}$/.test(id)){showMessage('Employee card not found','Scan an employee’s NFC card or QR code to open their profile.');return;}
    let card=null;try{card=JSON.parse($('publicCardData').textContent||'null');}catch(_){}
    if(card&&card.publicApproved===true&&card.id===id&&card.fullName){render(card);return;}
    fetch(`backend/api.php?action=public_nfc_card&id=${encodeURIComponent(id)}`,{cache:'no-store',credentials:'omit'})
      .then(async response=>{
        let result={};try{result=await response.json();}catch(_){}
        if(response.status===404){showMessage('Employee card not available','In ERP, save this employee profile and mark it approved for public display, then use its current card link.');return null;}
        if(!response.ok)throw new Error('Card service unavailable');
        return result;
      })
      .then(result=>{if(!result)return;const loaded=result?.card;if(result?.status!=='success'||!loaded||loaded.publicApproved!==true||loaded.id!==id||!loaded.fullName){showMessage('Employee card not available','In ERP, save this employee profile and mark it approved for public display, then use its current card link.');return;}render(loaded);})
      .catch(()=>showMessage('Card temporarily unavailable','Please try again later or contact DemoSolar Industries.'));
  })();
  </script>
</body>
</html>
