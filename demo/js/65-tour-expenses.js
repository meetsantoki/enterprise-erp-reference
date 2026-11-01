// Employee tour expenses: server-backed, permission-checked workflow.
const tourExpenseState = { scope: "mine", trips: [], rechargeClaims: [], tripId: 0, activeTripId: 0, expenseFormOpen: false, requestId: 0 };
const tourEsc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const tourMoney = value => "₹" + Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const tourLocalDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const TOUR_EXPENSE_CATEGORY_LABELS = { TRAVEL:"Travel / T.A.", HOTEL:"Hotel / Night Hold", FOOD:"Food / D.A.", BREAKFAST:"Breakfast", LUNCH:"Lunch", DINNER:"Dinner", LOCAL_TRANSPORT:"Local transport", FUEL:"Fuel", PARKING_TOLL:"Parking / toll", MOBILE:"Mobile usage / Recharge", OTHER:"Other" };
const TOUR_TADA_POLICY = {
  A:{title:"Management Level A",hotelMin:2000,hotelMax:5000,foodRate:200,mobileMax:859,mobilePlan:"2 GB/day · ₹859 for 84 days",vehicle:"CAR",vehicleRate:6,bus:["GSRTC Premium","Volvo","AC Sleeper Coach"],train:["1A - First AC","EC - Executive Chair","2A - AC 2 Tier"],flight:["Business","Premium Economy"]},
  B:{title:"Managerial & Senior Level B",hotelMin:1000,hotelMax:3000,foodRate:150,mobileMax:799,mobilePlan:"1.5 GB/day · ₹799 for 84 days",vehicle:"CAR",vehicleRate:6,bus:["GSRTC Within AC","Sleeper Coach"],train:["3E - AC 3 Economy","3A - AC 3 Tier","CC - AC Chair","SL - Sleeper"],flight:["Economy"]},
  C:{title:"Executive Level C",hotelMin:1000,hotelMax:2000,foodRate:150,mobileMax:0,mobilePlan:"Not applicable",vehicle:"BIKE",vehicleRate:3,bus:["GSRTC Express","AC Coach","Gurjarnagri"],train:["SL - Sleeper","2S - Second Seating"],flight:[]}
};
function tourEmployeeLevel(){const raw=String(currentLoggedInUser?.employeeLevel||"").trim().toUpperCase().replace(/^LEVEL\s+/,"");return ["A","B","C"].includes(raw)?raw:"";}
function tourCurrentPolicy(){return TOUR_TADA_POLICY[tourEmployeeLevel()]||null;}
function renderTourPolicy(){
  const level=tourEmployeeLevel(),policy=tourCurrentPolicy();
  const set=(id,value)=>{const node=document.getElementById(id);if(node)node.textContent=value;};
  set("tourPolicyLevelBadge",level||"—"); set("tourPolicyLevelTitle",policy?.title||"Employee level is not assigned");
  set("tourPolicyHotel",policy?`Actual bill · eligible band ${tourMoney(policy.hotelMin)}–${tourMoney(policy.hotelMax)}`:"Ask HR/IT to assign Level A, B, or C");
  set("tourPolicyFood",policy?`Actual bill or ${tourMoney(policy.foodRate)} per dish`:"—");
  set("tourPolicyMobile",policy?.mobilePlan||"—");
  set("tourPolicyVehicle",policy?`${policy.vehicle==="CAR"?"Car":"Bike"} only · ${tourMoney(policy.vehicleRate)}/km`:"—");
  set("tourPolicyTravel",policy?`Bus: ${policy.bus.join(", ")} · Train: ${policy.train.join(", ")} · Flight: ${policy.flight.length?policy.flight.join(", "):"Not applicable"}`:"Assign the employee level before recording policy-controlled expenses.");
  window.tourExpensePolicyChanged?.();
}
window.tourExpensePolicyChanged=function(){
  const policy=tourCurrentPolicy(),category=document.getElementById("tourCategory")?.value||"",mode=document.getElementById("tourTravelMode")?.value||"";
  const meal=["FOOD","BREAKFAST","LUNCH","DINNER"].includes(category),claimBasis=document.getElementById("tourClaimBasis"),hasReceipt=Boolean(document.getElementById("tourReceipt")?.files?.length);if(claimBasis)claimBasis.value=meal&&!hasReceipt?"POLICY":"ACTUAL";const basis=claimBasis?.value||"ACTUAL";
  const fields=document.getElementById("tourPolicyExpenseFields"),travelModeGroup=document.getElementById("tourTravelModeGroup"),travelClassGroup=document.getElementById("tourTravelClassGroup"),vehicleGroup=document.getElementById("tourVehicleTypeGroup"),distanceGroup=document.getElementById("tourDistanceGroup"),quantityGroup=document.getElementById("tourQuantityGroup"),travelClass=document.getElementById("tourTravelClass"),vehicle=document.getElementById("tourVehicleType"),notice=document.getElementById("tourPolicyEligibility");
  const controlled=["TRAVEL","HOTEL","FOOD","BREAKFAST","LUNCH","DINNER","MOBILE"].includes(category); if(fields)fields.hidden=!controlled;
  if(travelModeGroup)travelModeGroup.hidden=category!=="TRAVEL"; if(quantityGroup)quantityGroup.hidden=!(meal&&basis==="POLICY");
  const personal=category==="TRAVEL"&&mode==="PERSONAL"; if(vehicleGroup)vehicleGroup.hidden=!personal;if(distanceGroup)distanceGroup.hidden=!personal;
  const classMode=category==="TRAVEL"&&["BUS","TRAIN","FLIGHT"].includes(mode);if(travelClassGroup)travelClassGroup.hidden=!classMode;
  if(policy&&vehicle&&personal){vehicle.value=policy.vehicle;vehicle.querySelectorAll("option").forEach(option=>{if(option.value)option.disabled=option.value!==policy.vehicle;});}
  if(travelClass&&classMode&&policy){const current=travelClass.value;const options=mode==="BUS"?policy.bus:mode==="TRAIN"?policy.train:policy.flight;travelClass.innerHTML='<option value="">Choose eligible class</option>'+options.map(item=>`<option value="${tourEsc(item)}">${tourEsc(item)}</option>`).join("");if(options.includes(current))travelClass.value=current;}
  if(!notice)return;if(!category){notice.textContent="Select an expense type to check policy eligibility.";notice.dataset.state="";return;}if(controlled&&!policy){notice.textContent="Employee Level A, B, or C must be assigned before this policy-controlled expense can be saved.";notice.dataset.state="blocked";return;}
  let text="This expense will be recorded for HR review.",state="allowed";
  if(category==="HOTEL")text=`Hotel claim: actual bill, maximum eligible amount ${tourMoney(policy.hotelMax)} (policy band starts at ${tourMoney(policy.hotelMin)}).`;
  if(meal){const mealName=TOUR_EXPENSE_CATEGORY_LABELS[category]||"Food",quantity=Math.max(1,Number(document.getElementById("tourPolicyQuantity")?.value||1));text=basis==="POLICY"?`${mealName} allowance: ${quantity} × ${tourMoney(policy.foodRate)} = ${tourMoney(quantity*policy.foodRate)} eligible.`:`${mealName} claim: actual bill; policy reference is ${tourMoney(policy.foodRate)} per dish.`;}
  if(category==="MOBILE"){if(!policy.mobileMax){text="Mobile usage reimbursement is not applicable for Level C.";state="blocked";}else text=`Mobile plan eligibility: ${policy.mobilePlan}.`;}
  if(category==="TRAVEL"){if(!mode){text="Choose the mode of travel to view eligible class or mileage.";state="warning";}else if(mode==="FLIGHT"&&!policy.flight.length){text="Flight travel is not eligible for this employee level.";state="blocked";}else if(personal){const km=Number(document.getElementById("tourDistanceKm")?.value||0);text=`Personal ${policy.vehicle.toLowerCase()} claim: ${km||0} km × ${tourMoney(policy.vehicleRate)} = ${tourMoney(km*policy.vehicleRate)} eligible.`;}else{text=`Eligible ${mode.toLowerCase()} class: ${(mode==="BUS"?policy.bus:mode==="TRAIN"?policy.train:policy.flight).join(", ")||"Not applicable"}.`;}}
  notice.textContent=text;notice.dataset.state=state;
};
async function tourExpenseRequest(scope, payload, tripId = 0) {
  const url = "backend/api.php?action=tour_expenses" + (scope ? "&scope=" + encodeURIComponent(scope) : "") + (tripId ? "&tripId=" + encodeURIComponent(tripId) : "");
  const isForm = payload instanceof FormData;
  const response = await erpFetchWithTimeout(url, {
    method: payload ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
    headers: payload && !isForm ? { "Content-Type": "application/json" } : undefined,
    body: payload ? (isForm ? payload : JSON.stringify(payload)) : undefined
  }, 20000);
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.status !== "success") throw new Error(result.message || "Tour Expenses could not be loaded.");
  return result;
}
function tourNotice(title, message, type = "success") { window.showNotification?.({ title, message, type }); }
function ensureTourReceiptPreview() {
  let modal = document.getElementById("tourReceiptPreviewModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "tourReceiptPreviewModal";
  modal.className = "tour-receipt-modal";
  modal.hidden = true;
  modal.innerHTML = `<section class="tour-receipt-dialog" role="dialog" aria-modal="true" aria-labelledby="tourReceiptPreviewTitle">
    <header><div><span class="tour-receipt-eyebrow">TRIP EXPENSE · BILL PREVIEW</span><h3 id="tourReceiptPreviewTitle">Uploaded bill</h3><p id="tourReceiptPreviewMeta"></p></div><button type="button" class="tour-receipt-close" aria-label="Close bill preview">×</button></header>
    <div id="tourReceiptPreviewBody" class="tour-receipt-preview-body"></div>
    <footer><span id="tourReceiptPreviewFile"></span><a id="tourReceiptDownload" class="btn btn-success" href="#">↓ Download bill</a><button type="button" class="btn btn-secondary tour-receipt-dismiss">Close</button></footer>
  </section>`;
  modal.addEventListener("click", event => { if (event.target === modal || event.target.closest(".tour-receipt-close,.tour-receipt-dismiss")) window.closeTourReceiptPreview(); });
  document.body.appendChild(modal);
  return modal;
}
window.closeTourReceiptPreview = function() {
  const modal = document.getElementById("tourReceiptPreviewModal");
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("tour-receipt-open");
  const body = document.getElementById("tourReceiptPreviewBody");
  if (body) body.replaceChildren();
};
window.openTourReceiptPreview = function(expenseId, tripId) {
  const trip = tourExpenseState.trips.find(item => Number(item.id) === Number(tripId));
  const expense = trip?.expenses?.find(item => Number(item.id) === Number(expenseId) && Number(item.tripId) === Number(tripId));
  if (!trip || !expense || !expense.receiptUrl) { tourNotice("Bill unavailable", "This bill is not linked to the selected trip expense.", "danger"); return; }
  const modal = ensureTourReceiptPreview();
  const previewUrl = `${expense.receiptUrl}&mode=preview`;
  const downloadUrl = `${expense.receiptUrl}&mode=download`;
  const body = modal.querySelector("#tourReceiptPreviewBody");
  const mime = String(expense.receiptMime || "").toLowerCase();
  const title = `${expense.category || "Expense"} bill`;
  modal.querySelector("#tourReceiptPreviewTitle").textContent = title;
  modal.querySelector("#tourReceiptPreviewMeta").textContent = `${trip.startingPoint || "Trip"} → ${trip.destination || "Destination"} · ${expense.date || ""} · ${tourMoney(expense.amount)}`;
  modal.querySelector("#tourReceiptPreviewFile").textContent = expense.receiptName || "Uploaded bill";
  const download = modal.querySelector("#tourReceiptDownload");
  download.href = downloadUrl;
  download.download = expense.receiptName || "trip-bill";
  body.replaceChildren();
  if (mime.startsWith("image/")) {
    const image = document.createElement("img");
    image.src = previewUrl; image.alt = title; image.className = "tour-receipt-image";
    body.appendChild(image);
  } else if (mime === "application/pdf") {
    const frame = document.createElement("iframe");
    frame.src = previewUrl; frame.title = title; frame.className = "tour-receipt-frame";
    body.appendChild(frame);
  } else {
    body.innerHTML = '<div class="tour-empty">Preview is unavailable for this file type. Use Download bill to open it.</div>';
  }
  modal.hidden = false;
  document.body.classList.add("tour-receipt-open");
  modal.querySelector(".tour-receipt-close")?.focus();
};
document.addEventListener("keydown", event => { if (event.key === "Escape" && !document.getElementById("tourReceiptPreviewModal")?.hidden) window.closeTourReceiptPreview(); });
function canReviewDepartmentPermissions() {
  const role = String(currentLoggedInUser?.role || "").toLowerCase();
  return role === "admin" || String(currentLoggedInUser?.username || "").toUpperCase() === "IT" || currentLoggedInUser?.rights?.requestsApprove === true;
}
function canReviewTripExpenses() {
  const department = String(currentLoggedInUser?.department || "").trim().replace(/\s+/g, " ").toUpperCase();
  const designationRecord = (designationsDb || []).find(item => String(item?.id || "") === String(currentLoggedInUser?.designationId || ""));
  const designation = String(designationRecord?.name || currentLoggedInUser?.designation || "").trim().toUpperCase();
  const isHumanResources = /^(?:HR|HUMAN RESOURCES?)$/.test(department);
  const isManager = ["MANAGER","HR MANAGER","HUMAN RESOURCE MANAGER","HUMAN RESOURCES MANAGER"].includes(designation);
  return isHumanResources && isManager;
}
function canSettleTripReimbursements() {
  const role = String(currentLoggedInUser?.role || "").toLowerCase();
  const department = String(currentLoggedInUser?.department || "").toUpperCase();
  return role === "admin" || /ACCOUNT|FINANCE/.test(department);
}
window.updateHrUnifiedApprovalBadge = function() {
  const tripCount = canReviewTripExpenses() && tourExpenseState.scope === "pending"
    ? tourExpenseState.trips.filter(trip => String(trip.status || "").toUpperCase() === "SUBMITTED").length
    : 0;
  const rechargeCount = canReviewTripExpenses() && tourExpenseState.scope === "pending"
    ? tourExpenseState.rechargeClaims.filter(claim => String(claim.status || "").toUpperCase() === "SUBMITTED").length
    : 0;
  const total = tripCount + rechargeCount;
  const badge = document.getElementById("hrUnifiedApprovalBadge");
  if (badge) { badge.textContent = total.toLocaleString("en-IN"); badge.style.display = total > 0 ? "inline-block" : "none"; }
};
function configureTourWorkspace(scope) {
  const approvals = scope === "pending";
  const reimbursements = scope === "reimburse";
  const heroEyebrow = document.getElementById("tourHeroEyebrow");
  const heroTitle = document.getElementById("tourHeroTitle");
  const heroDescription = document.getElementById("tourHeroDescription");
  const tripPanel = document.getElementById("tourTripListPanel");
  const metrics = document.getElementById("tourMetrics");
  if (heroEyebrow) heroEyebrow.textContent = reimbursements ? "ACCOUNTS · EMPLOYEE REIMBURSEMENTS" : approvals ? "HUMAN RESOURCES · APPROVAL CONTROL" : "HUMAN RESOURCES · TRAVEL";
  if (heroTitle) heroTitle.textContent = reimbursements ? "Reimburse" : approvals ? "Approval Center" : "Trip Expenses";
  if (heroDescription) heroDescription.textContent = reimbursements ? "Review HR-approved trip claims, verify attached bills, and mark completed reimbursements as settled." : approvals ? "Review employee trip and recharge expense claims awaiting HR approval." : "Record business trips, attach receipts, and follow each claim through approval.";
  if (tripPanel) tripPanel.hidden = approvals && !canReviewTripExpenses();
  metrics?.classList.remove("unified-approvals");
}
window.openHrTourExpenses = async function(button, scope = "mine", tripId = 0) {
  const rights = currentLoggedInUser?.rights || {};
  const isAdmin = String(currentLoggedInUser?.role || "").toLowerCase() === "admin";
  const needs = { mine: "hrTourExpenses", all: "hrTourExpensesViewAll", pending: "hrTourExpensesApprove", approved: "hrTourExpensesExport", record: "hrTourExpensesApprove", reimburse: "accountsReimburse" };
  const unifiedApprovalAllowed = scope === "pending" && canReviewTripExpenses();
  const reimbursementAllowed = scope === "reimburse" && canSettleTripReimbursements();
  if (!unifiedApprovalAllowed && !reimbursementAllowed && !isAdmin && rights[needs[scope]] !== true) { tourNotice("Access denied", "Your User Rights do not allow this Tour Expenses section.", "danger"); return; }
  // Set and clear the scope before the shared page becomes visible. This stops
  // records from a previously opened HR list flashing inside My Trips.
  tourExpenseState.scope = scope;
  tourExpenseState.tripId = Number(tripId) || 0;
  tourExpenseState.trips = [];
  tourExpenseState.requestId += 1;
  const existingList = document.getElementById("tourTripList");
  if (existingList) existingList.innerHTML = '<div class="tour-empty">Loading your trip records…</div>';
  const pageTitle = scope === "reimburse" ? "Accounts > Reimburse" : scope === "pending" ? "HR > Expense Approvals" : scope === "all" ? "HR > All Employee Trips" : "Expenses > " + ({mine:"My Trips",approved:"HR Approved Export",record:"Notification Record"}[scope] || "My Trips");
  if (await switchView("hrTourExpenses", button, pageTitle) === false) return;
  configureTourWorkspace(scope);
  tourExpenseState.expenseFormOpen = false;
  if (scope !== "mine") tourExpenseState.activeTripId = 0;
  const labels = { mine: "My trips", all: "All employee trips", pending: "Trips waiting for approval", approved: "Approved trips for HR", record:"Trip notification record", reimburse:"Employee reimbursements" };
  document.getElementById("tourListTitle").textContent = labels[scope] || labels.mine;
  document.getElementById("tourExpenseForms").style.display = scope === "mine" ? "grid" : "none";
  document.getElementById("tourExcelExport").hidden = scope !== "approved";
  const userName = currentLoggedInUser?.name || currentLoggedInUser?.username || "Signed-in employee";
  document.getElementById("tourCurrentUser").textContent = "👤 " + userName;
  renderTourPolicy();
  await loadHrTourExpenses();
};
window.openAccountsReimburse = function(button) { return window.openHrTourExpenses(button, "reimburse"); };
async function rechargeExpenseRequest(payload=null,scope="mine"){const isForm=payload instanceof FormData,url="backend/api.php?action=recharge_expenses"+(scope?"&scope="+encodeURIComponent(scope):"");const response=await erpFetchWithTimeout(url,{method:payload?"POST":"GET",credentials:"same-origin",cache:"no-store",headers:payload&&!isForm?{"Content-Type":"application/json"}:undefined,body:payload?(isForm?payload:JSON.stringify(payload)):undefined},20000);const result=await response.json().catch(()=>({}));if(!response.ok||result.status!=="success")throw new Error(result.message||"Recharge expenses could not be loaded.");return result;}
function renderRechargePolicy(){const level=tourEmployeeLevel(),policy=tourCurrentPolicy(),badge=document.getElementById("rechargeLevelBadge"),summary=document.getElementById("rechargePolicySummary"),plan=document.getElementById("rechargePlan"),amount=document.getElementById("rechargeAmount"),submit=document.getElementById("rechargeSubmitButton");if(badge)badge.textContent=level||"—";const eligible=Boolean(policy?.mobileMax);if(plan)plan.placeholder=eligible?`Enter plan details (policy: ${policy.mobilePlan})`:"Mobile recharge is not applicable";if(amount){amount.removeAttribute("max");amount.placeholder=eligible?`Policy allows ${tourMoney(policy.mobileMax)}; higher claims need HR approval`:"Not applicable";}if(summary){summary.classList.toggle("blocked",!eligible);summary.textContent=eligible?`Level ${level} eligibility: ${policy.mobilePlan}. The policy allows ${tourMoney(policy.mobileMax)}; a higher actual claim may be submitted for HR special approval.`:level?`Mobile recharge reimbursement is not applicable for Level ${level}.`:`Employee Level A, B, or C must be assigned before submitting a recharge claim.`;}if(submit)submit.disabled=!eligible;}
window.openRechargeExpenses = async function(button) {if(await switchView("expensesRecharge",button,"Expenses > Recharge")===false)return;renderRechargePolicy();await window.loadRechargeExpenses();};
window.loadRechargeExpenses=async function(){const list=document.getElementById("rechargeExpenseList");if(!list)return;list.innerHTML='<div class="tour-empty">Loading recharge claims…</div>';try{const result=await rechargeExpenseRequest();const claims=Array.isArray(result.claims)?result.claims:[];list.innerHTML=claims.length?claims.map(claim=>`<article class="recharge-claim"><div><h4>${tourEsc(claim.operator)} · ${tourEsc(claim.mobileNumber)} <span class="recharge-status">${tourEsc(claim.status)}</span></h4><p>Level ${tourEsc(claim.level)} · ${tourEsc(claim.plan)} · ${tourEsc(claim.date)}${claim.reference?` · Ref: ${tourEsc(claim.reference)}`:""}</p>${claim.notes?`<p>${tourEsc(claim.notes)}</p>`:""}${claim.receiptUrl?`<p><a class="tour-receipt-link" href="${tourEsc(claim.receiptUrl)}" target="_blank" rel="noopener">▣ Preview receipt</a></p>`:""}</div><strong>${tourMoney(claim.amount)}</strong></article>`).join(""):'<div class="tour-empty">No recharge claims have been submitted yet.</div>';}catch(error){list.innerHTML=`<div class="tour-empty">${tourEsc(error.message)}</div>`;}};
async function loadHrTourExpenses() {
  const list = document.getElementById("tourTripList"); if (!list) return;
  list.innerHTML = '<div class="tour-empty">Loading trip records…</div>';
  const requestedScope = tourExpenseState.scope;
  const requestedTripId = tourExpenseState.tripId;
  const requestId = ++tourExpenseState.requestId;
  try {
    const shouldLoadTripQueue = requestedScope !== "pending" || canReviewTripExpenses();
    const tripLoad = shouldLoadTripQueue
      ? tourExpenseRequest(requestedScope, null, requestedTripId)
      : Promise.resolve({ status: "success", scope: requestedScope, trips: [] });
    const rechargeLoad = ["pending","reimburse"].includes(requestedScope) ? rechargeExpenseRequest(null,requestedScope).catch(()=>({claims:[]})) : Promise.resolve({claims:[]});
    const [result, rechargeResult] = await Promise.all([tripLoad, rechargeLoad]);
    // Ignore an older All/Approval request if the user has already switched to
    // My Trips. Otherwise a slow response can leak the old list into this view.
    if (requestId !== tourExpenseState.requestId || requestedScope !== tourExpenseState.scope) return;
    const returnedTrips = Array.isArray(result.trips) ? result.trips : [];
    const loggedInUsername = String(currentLoggedInUser?.username || "").trim().toLowerCase();
    tourExpenseState.trips = requestedScope === "mine"
      ? returnedTrips.filter(trip => String(trip?.employeeUsername || "").trim().toLowerCase() === loggedInUsername)
      : returnedTrips;
    tourExpenseState.rechargeClaims=Array.isArray(rechargeResult.claims)?rechargeResult.claims:[];
    renderHrTourExpenses();
    window.updateHrUnifiedApprovalBadge?.();
  } catch (error) {
    if (requestId === tourExpenseState.requestId && requestedScope === tourExpenseState.scope) list.innerHTML = `<div class="tour-empty">${tourEsc(error.message)}</div>`;
  }
}
window.refreshHrUnifiedApprovals = async function() {
  await loadHrTourExpenses();
};
function expensePolicyAllowed(expense){const claimed=Number(expense.amount||0),eligible=Number(expense.eligibleAmount||0);return Math.min(claimed,eligible>0?eligible:claimed);}
function expenseFinalApproved(expense){const claimed=Number(expense.amount||0),allowed=expensePolicyAllowed(expense),special=Math.max(0,Number(expense.specialApprovedAmount||0));return Math.min(claimed,allowed+special);}
function expenseMonthPeriod(dateValue){const date=new Date(String(dateValue||"")+"T00:00:00");if(Number.isNaN(date.getTime()))return "Expense period";const last=new Date(date.getFullYear(),date.getMonth()+1,0).getDate();return `01–${String(last).padStart(2,"0")} ${date.toLocaleString("en-IN",{month:"short",year:"numeric"})}`;}
window.updateTourExpenseFinalApproval=function(id,claimed,allowed){const input=document.getElementById(`expenseSpecial-${id}`),output=document.getElementById(`expenseFinal-${id}`);if(!output)return;const special=Math.max(0,Number(input?.value||0));output.textContent=tourMoney(Math.min(Number(claimed||0),Number(allowed||0)+special));};
function renderExpenseCategoryTable(category,expenses,scope){const label=TOUR_EXPENSE_CATEGORY_LABELS[category]||category;return `<section class="expense-approval-category"><h5>${tourEsc(label)}</h5><div class="table-scroll"><table class="custom-table expense-approval-table"><thead><tr><th>Date / Details</th><th>Claimed</th><th>Policy Allowed</th><th>Difference</th><th>Special Approval</th><th>Final Approved</th></tr></thead><tbody>${expenses.map(expense=>{const claimed=Number(expense.amount||0),allowed=expensePolicyAllowed(expense),difference=Math.max(0,claimed-allowed),final=expenseFinalApproved(expense),editable=scope==="pending"&&difference>0,id=Number(expense.id);return `<tr><td><strong>${tourEsc(expense.vendor||expense.description||label)}</strong><small>${tourEsc(expense.date||"")} · ${tourEsc(expense.policyNote||"")}</small>${expense.receiptUrl?`<button class="tour-receipt-link" onclick="openTourReceiptPreview(${id},${Number(expense.tripId)})">▣ Bill</button>`:""}</td><td>${tourMoney(claimed)}</td><td>${tourMoney(allowed)}</td><td class="${difference>0?"expense-over-limit":""}">${tourMoney(difference)}</td><td>${editable?`<input id="expenseSpecial-${id}" class="expense-special-input" type="number" min="0" max="${difference}" step="0.01" value="${Number(expense.specialApprovedAmount||0)}" oninput="updateTourExpenseFinalApproval(${id},${claimed},${allowed})"><input id="expenseHrNote-${id}" class="expense-note-input" placeholder="HR reason" value="${tourEsc(expense.hrApprovalNote||"")}">`:tourMoney(expense.specialApprovedAmount||0)}</td><td class="expense-final-approval-cell"><strong id="expenseFinal-${id}">${tourMoney(final)}</strong>${editable?`<button class="btn btn-secondary expense-save-approval" onclick="saveTourExpenseSpecialApproval(${id})">Save</button>`:""}</td></tr>`;}).join("")}</tbody></table></div></section>`;}
function renderConsolidatedExpenseCenter(scope){const trips=tourExpenseState.trips,recharges=tourExpenseState.rechargeClaims;const people={};const ensure=(username,name,date)=>{const month=String(date||"").slice(0,7)||"unknown",key=`${username}|${month}`;return people[key]||(people[key]={username,name:name||username,firstDate:date,trips:[],recharges:[]});};trips.forEach(trip=>ensure(String(trip.employeeUsername),trip.employeeName,trip.startDate).trips.push(trip));recharges.forEach(claim=>ensure(String(claim.employeeUsername),claim.employeeName,claim.date).recharges.push(claim));const entries=Object.values(people);if(!entries.length)return `<div class="tour-empty">No employee expense claims are available.</div>`;return `<div class="expense-approval-center">${entries.map(person=>{const claimed=person.trips.reduce((s,t)=>s+(t.expenses||[]).reduce((a,e)=>a+Number(e.amount||0),0),0)+person.recharges.reduce((s,r)=>s+Number(r.amount||0),0);const final=person.trips.reduce((s,t)=>s+(t.expenses||[]).reduce((a,e)=>a+expenseFinalApproved(e),0),0)+person.recharges.reduce((s,r)=>{const policy=TOUR_TADA_POLICY[String(r.level||"")]?.mobileMax||0;return s+(Number(r.approvedAmount||0)||Math.min(Number(r.amount||0),policy)+Number(r.specialApprovedAmount||0));},0);return `<details class="expense-employee-card"><summary><span><b>${tourEsc(person.name)}</b><small>@${tourEsc(person.username)} · ${expenseMonthPeriod(person.firstDate)}</small></span><span><b>${tourMoney(final)}</b><small>Claimed ${tourMoney(claimed)}</small></span></summary><div class="expense-employee-body">${person.trips.map(trip=>{const groups={};(trip.expenses||[]).forEach(e=>(groups[e.category]||(groups[e.category]=[])).push(e));const tripFinal=(trip.expenses||[]).reduce((s,e)=>s+expenseFinalApproved(e),0);return `<details class="expense-trip-card"><summary><span><b>Trip #${Number(trip.id)} · ${tourEsc(trip.startingPoint)} → ${tourEsc(trip.destination)}</b><small>${tourEsc(trip.startDate)}${trip.returnDate?` to ${tourEsc(trip.returnDate)}`:""} · ${tourEsc(trip.purpose)}</small></span><strong>${tourMoney(tripFinal)}</strong></summary><div class="expense-trip-body">${Object.entries(groups).map(([category,items])=>renderExpenseCategoryTable(category,items,scope)).join("")}<div class="expense-trip-actions">${scope==="pending"?`<button class="btn btn-success" onclick="reviewTourTrip(${Number(trip.id)},'APPROVED')">Approve Trip</button><button class="btn btn-danger" onclick="reviewTourTrip(${Number(trip.id)},'REJECTED')">Return</button>`:`<button class="btn btn-success" onclick="settleTourReimbursement(${Number(trip.id)})">Mark Trip Settled</button>`}<strong>Trip Approved Total: ${tourMoney(tripFinal)}</strong></div></div></details>`;}).join("")}${person.recharges.length?`<section class="expense-approval-category recharge-approval-table"><h5>Mobile Recharge</h5><div class="table-scroll"><table class="custom-table"><thead><tr><th>Date / Plan</th><th>Claimed</th><th>Policy Allowed</th><th>Difference</th><th>Special Approval</th><th>Final Approved</th><th>Action</th></tr></thead><tbody>${person.recharges.map(claim=>{const claimed=Number(claim.amount||0),allowed=Math.min(claimed,TOUR_TADA_POLICY[String(claim.level||"")]?.mobileMax||0),difference=Math.max(0,claimed-allowed),final=Number(claim.approvedAmount||0)||Math.min(claimed,allowed+Number(claim.specialApprovedAmount||0));return `<tr><td><strong>${tourEsc(claim.operator)} · ${tourEsc(claim.mobileNumber)}</strong><small>${tourEsc(claim.date)} · ${tourEsc(claim.plan)}</small>${claim.receiptUrl?`<a class="tour-receipt-link" href="${tourEsc(claim.receiptUrl)}" target="_blank">▣ Receipt</a>`:""}</td><td>${tourMoney(claimed)}</td><td>${tourMoney(allowed)}</td><td class="${difference>0?"expense-over-limit":""}">${tourMoney(difference)}</td><td>${scope==="pending"&&difference>0?`<input id="rechargeSpecial-${Number(claim.id)}" class="expense-special-input" type="number" min="0" max="${difference}" step="0.01" value="${Number(claim.specialApprovedAmount||0)}"><input id="rechargeHrNote-${Number(claim.id)}" class="expense-note-input" placeholder="HR reason" value="${tourEsc(claim.hrApprovalNote||"")}">`:tourMoney(claim.specialApprovedAmount||0)}</td><td><strong>${tourMoney(final)}</strong></td><td>${scope==="pending"?`${difference>0?`<button class="btn btn-secondary" onclick="saveRechargeSpecialApproval(${Number(claim.id)})">Save</button>`:""}<button class="btn btn-success" onclick="reviewRechargeClaim(${Number(claim.id)},'APPROVED')">Approve</button><button class="btn btn-danger" onclick="reviewRechargeClaim(${Number(claim.id)},'REJECTED')">Return</button>`:`${claim.status==="APPROVED"?`<button class="btn btn-success" onclick="settleRechargeClaim(${Number(claim.id)})">Settle</button>`:"Settled"}`}</td></tr>`;}).join("")}</tbody></table></div></section>`:""}<div class="expense-grand-total"><span>Employee Grand Total</span><strong>${tourMoney(final)}</strong></div></div></details>`;}).join("")}</div>`;}
function rechargeFinalApproved(claim){const claimed=Number(claim.amount||0),policy=Number(TOUR_TADA_POLICY[String(claim.level||"")]?.mobileMax||0),allowed=Math.min(claimed,policy),special=Math.max(0,Number(claim.specialApprovedAmount||0));return Number(claim.approvedAmount||0)||Math.min(claimed,allowed+special);}
function renderEmployeeReimbursementCenter(scope){
  const people={};
  const groupedByEmployee=scope==="reimburse";
  const ensure=(username,name,date)=>{
    const month=String(date||"").slice(0,7)||"unknown";
    const key=groupedByEmployee?String(username).toLowerCase():`${String(username).toLowerCase()}|${month}`;
    if(!people[key])people[key]={username:String(username),name:name||username,firstDate:date,trips:[],recharges:[]};
    return people[key];
  };
  tourExpenseState.trips.forEach(trip=>ensure(trip.employeeUsername,trip.employeeName,trip.startDate).trips.push(trip));
  tourExpenseState.rechargeClaims.forEach(claim=>ensure(claim.employeeUsername,claim.employeeName,claim.date).recharges.push(claim));
  const entries=Object.values(people).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  if(!entries.length)return `<div class="tour-empty">No HR-approved employee reimbursements are available.</div>`;
  return `<div class="expense-approval-center">${entries.map(person=>{
    const allExpenses=person.trips.flatMap(trip=>trip.expenses||[]);
    const tripApproved=allExpenses.filter(expense=>String(expense.category)!=="FUEL").reduce((sum,expense)=>sum+expenseFinalApproved(expense),0);
    const fuelApproved=allExpenses.filter(expense=>String(expense.category)==="FUEL").reduce((sum,expense)=>sum+expenseFinalApproved(expense),0);
    const rechargeApproved=person.recharges.reduce((sum,claim)=>sum+rechargeFinalApproved(claim),0);
    const grandTotal=tripApproved+fuelApproved+rechargeApproved;
    const claimed=allExpenses.reduce((sum,expense)=>sum+Number(expense.amount||0),0)+person.recharges.reduce((sum,claim)=>sum+Number(claim.amount||0),0);
    const statuses=[...person.trips.map(trip=>String(trip.status||"")),...person.recharges.map(claim=>String(claim.status||""))];
    const fullySettled=statuses.length>0&&statuses.every(status=>status==="SETTLED");
    const statusText=scope==="reimburse"?(fullySettled?"Settled":"Awaiting settlement"):"Awaiting HR approval";
    const statusClass=fullySettled?"settled":"pending";
    const totals=scope==="reimburse"?`<div class="reimburse-parameter-grid"><article><span>Trips</span><strong>${tourMoney(tripApproved)}</strong></article><article><span>Fuel</span><strong>${tourMoney(fuelApproved)}</strong></article><article><span>Recharge</span><strong>${tourMoney(rechargeApproved)}</strong></article><article class="grand"><span>Grand Total</span><strong>${tourMoney(grandTotal)}</strong></article></div>`:"";
    const trips=person.trips.map(trip=>{
      const groups={};(trip.expenses||[]).forEach(expense=>(groups[expense.category]||(groups[expense.category]=[])).push(expense));
      const tripFinal=(trip.expenses||[]).reduce((sum,expense)=>sum+expenseFinalApproved(expense),0);
      const tripStatus=String(trip.status||"");
      const actions=scope==="pending"?`<button class="btn btn-success" onclick="reviewTourTrip(${Number(trip.id)},'APPROVED')">Approve Trip</button><button class="btn btn-danger" onclick="reviewTourTrip(${Number(trip.id)},'REJECTED')">Return</button>`:tripStatus==="APPROVED"?`<button class="btn btn-success" onclick="settleTourReimbursement(${Number(trip.id)})">Mark Trip Settled</button>`:`<span class="reimburse-status settled">✓ Settled${trip.settledAt?` · ${tourEsc(trip.settledAt)}`:""}</span>`;
      return `<details class="expense-trip-card"><summary><span><b>Trip #${Number(trip.id)} · ${tourEsc(trip.startingPoint)} → ${tourEsc(trip.destination)}</b><small>${tourEsc(trip.startDate)}${trip.returnDate?` to ${tourEsc(trip.returnDate)}`:""} · ${tourEsc(trip.purpose)} · ${tourEsc(tripStatus)}</small></span><strong>${tourMoney(tripFinal)}</strong></summary><div class="expense-trip-body">${Object.entries(groups).map(([category,items])=>renderExpenseCategoryTable(category,items,scope)).join("")}<div class="expense-trip-actions">${actions}<strong>Approved Total: ${tourMoney(tripFinal)}</strong></div></div></details>`;
    }).join("");
    const recharges=person.recharges.length?`<section class="expense-approval-category recharge-approval-table"><h5>Mobile Recharge</h5><div class="table-scroll"><table class="custom-table"><thead><tr><th>Date / Plan</th><th>Claimed</th><th>Policy Allowed</th><th>Difference</th><th>Special Approval</th><th>Final Approved</th><th>Action</th></tr></thead><tbody>${person.recharges.map(claim=>{const claimedAmount=Number(claim.amount||0),policy=Number(TOUR_TADA_POLICY[String(claim.level||"")]?.mobileMax||0),allowed=Math.min(claimedAmount,policy),difference=Math.max(0,claimedAmount-allowed),final=rechargeFinalApproved(claim),claimStatus=String(claim.status||"");const action=scope==="pending"?`${difference>0?`<button class="btn btn-secondary" onclick="saveRechargeSpecialApproval(${Number(claim.id)})">Save</button>`:""}<button class="btn btn-success" onclick="reviewRechargeClaim(${Number(claim.id)},'APPROVED')">Approve</button><button class="btn btn-danger" onclick="reviewRechargeClaim(${Number(claim.id)},'REJECTED')">Return</button>`:claimStatus==="APPROVED"?`<button class="btn btn-success" onclick="settleRechargeClaim(${Number(claim.id)})">Mark Settled</button>`:`<span class="reimburse-status settled">✓ Settled</span>`;return `<tr><td><strong>${tourEsc(claim.operator)} · ${tourEsc(claim.mobileNumber)}</strong><small>${tourEsc(claim.date)} · ${tourEsc(claim.plan)} · ${tourEsc(claimStatus)}</small>${claim.receiptUrl?`<a class="tour-receipt-link" href="${tourEsc(claim.receiptUrl)}" target="_blank" rel="noopener">▣ Receipt</a>`:""}</td><td>${tourMoney(claimedAmount)}</td><td>${tourMoney(allowed)}</td><td class="${difference>0?"expense-over-limit":""}">${tourMoney(difference)}</td><td>${scope==="pending"&&difference>0?`<input id="rechargeSpecial-${Number(claim.id)}" class="expense-special-input" type="number" min="0" max="${difference}" step="0.01" value="${Number(claim.specialApprovedAmount||0)}"><input id="rechargeHrNote-${Number(claim.id)}" class="expense-note-input" placeholder="HR reason" value="${tourEsc(claim.hrApprovalNote||"")}">`:tourMoney(claim.specialApprovedAmount||0)}</td><td><strong>${tourMoney(final)}</strong></td><td>${action}</td></tr>`;}).join("")}</tbody></table></div></section>`:"";
    return `<details class="expense-employee-card reimbursement-employee-card"><summary><span><b>${tourEsc(person.name)}</b><small>@${tourEsc(person.username)} · ${person.trips.length} approved trip(s) · ${person.recharges.length} recharge claim(s)</small></span><span><b>${tourMoney(grandTotal)}</b><small>Claimed ${tourMoney(claimed)}</small><em class="reimburse-status ${statusClass}">${statusText}</em></span></summary><div class="expense-employee-body">${totals}${trips}${recharges}<div class="expense-grand-total"><span>Employee Grand Total</span><strong>${tourMoney(grandTotal)}</strong></div></div></details>`;
  }).join("")}</div>`;
}
window.saveTourExpenseSpecialApproval=async function(id){const special=Number(document.getElementById(`expenseSpecial-${id}`)?.value||0),hrNote=document.getElementById(`expenseHrNote-${id}`)?.value||"";try{await tourExpenseRequest("",{operation:"save_expense_special_approval",expenseId:id,specialAmount:special,hrNote});tourNotice("Special approval saved","The transaction approval amount has been updated.");await loadHrTourExpenses();}catch(error){tourNotice("Could not save approval",error.message,"danger");}};
window.saveRechargeSpecialApproval=async function(id){const special=Number(document.getElementById(`rechargeSpecial-${id}`)?.value||0),hrNote=document.getElementById(`rechargeHrNote-${id}`)?.value||"";try{await rechargeExpenseRequest({operation:"save_special",id,specialAmount:special,hrNote},"pending");tourNotice("Special approval saved","The recharge approval amount has been updated.");await loadHrTourExpenses();}catch(error){tourNotice("Could not save approval",error.message,"danger");}};
window.reviewRechargeClaim=async function(id,decision){if(!confirm(`${decision==="APPROVED"?"Approve":"Return"} this recharge claim?`))return;try{await rechargeExpenseRequest({operation:"review",id,decision},"pending");tourNotice("Recharge updated",`The recharge claim was ${decision.toLowerCase()}.`);await loadHrTourExpenses();}catch(error){tourNotice("Could not update recharge",error.message,"danger");}};
window.settleRechargeClaim=async function(id){if(!confirm("Mark this recharge reimbursement as settled?"))return;try{await rechargeExpenseRequest({operation:"settle",id},"reimburse");tourNotice("Recharge settled","Accounts marked the recharge reimbursement as settled.");await loadHrTourExpenses();}catch(error){tourNotice("Could not settle recharge",error.message,"danger");}};
function renderHrTourExpenses() {
  const all = tourExpenseState.trips;
  const query = String(document.getElementById("tourTripSearch")?.value || "").trim().toLowerCase();
  const trips = all.filter(t => !query || [t.employeeName,t.employeeUsername,t.startingPoint,t.destination,t.purpose].some(value => String(value || "").toLowerCase().includes(query)));
  const total = all.reduce((sum, trip) => sum + Number(trip.total || 0), 0) + tourExpenseState.rechargeClaims.reduce((sum,claim)=>sum+Number(claim.amount||0),0);
  const entryCount = all.reduce((sum, trip) => sum + Number(trip.expenseCount || 0), 0) + tourExpenseState.rechargeClaims.length;
  document.getElementById("tourTotalSpend").textContent = tourMoney(total);
  const countLabel = document.getElementById("tourTripCountLabel");
  const matchingTrips = tourExpenseState.scope === "pending" ? all.filter(t => t.status === "SUBMITTED") : tourExpenseState.scope === "approved" ? all.filter(t => t.status === "APPROVED") : tourExpenseState.scope === "reimburse" ? all.filter(t => t.status === "APPROVED") : all.filter(t => t.status === "ONGOING");
  if (countLabel) countLabel.textContent = tourExpenseState.scope === "pending" ? "Waiting for Approval" : tourExpenseState.scope === "approved" ? "Approved Trips" : tourExpenseState.scope === "reimburse" ? "Awaiting Reimbursement" : "Trips in Progress";
  document.getElementById("tourOngoingCount").textContent = matchingTrips.length + (["pending","reimburse"].includes(tourExpenseState.scope)?tourExpenseState.rechargeClaims.filter(claim=>tourExpenseState.scope==="pending"?claim.status==="SUBMITTED":claim.status==="APPROVED").length:0);
  document.getElementById("tourEntryCount").textContent = entryCount.toLocaleString("en-IN");
  const editableTrips = all.filter(t => ["ONGOING","REJECTED"].includes(String(t.status || "").toUpperCase()));
  const startPanel = document.getElementById("tourStartPanel");
  const expensePanel = document.getElementById("tourAddExpensePanel");
  if (tourExpenseState.scope !== "mine" || editableTrips.length === 0) tourExpenseState.expenseFormOpen = false;
  if (startPanel) startPanel.hidden = tourExpenseState.scope !== "mine" || editableTrips.length > 0;
  if (expensePanel) expensePanel.hidden = tourExpenseState.scope !== "mine" || !tourExpenseState.expenseFormOpen || editableTrips.length === 0;
  const select = document.getElementById("tourExpenseTrip");
  if (select) {
    const saved = select.value || String(tourExpenseState.activeTripId || "");
    select.innerHTML = editableTrips.length ? '<option value="">Choose a trip</option>' + editableTrips.map(t => `<option value="${Number(t.id)}">${tourEsc(t.startingPoint || "Starting point")} → ${tourEsc(t.destination)} · ${tourEsc(t.startDate)}</option>`).join("") : '<option value="">Start a trip first</option>';
    if (editableTrips.some(t => String(t.id) === saved)) select.value = saved;
    else if (editableTrips.length === 1) select.value = String(editableTrips[0].id);
    tourExpenseState.activeTripId = Number(select.value) || 0;
  }
  const list = document.getElementById("tourTripList");
  if(["pending","reimburse"].includes(tourExpenseState.scope)){list.innerHTML=renderEmployeeReimbursementCenter(tourExpenseState.scope);return;}
  list.innerHTML = trips.length ? trips.map(trip => {
    const status = String(trip.status || "ONGOING");
    const statusLabel = ({ONGOING:"In progress",SUBMITTED:"Waiting for HR Manager",APPROVED:"Approved by HR Manager",REJECTED:"Needs changes",SETTLED:"Settled by Accounts"})[status] || status;
    const ownsTrip = String(trip.employeeUsername || "").trim().toLowerCase() === String(currentLoggedInUser?.username || "").trim().toLowerCase();
    const canManage = Number(trip.id) > 0 && (ownsTrip || String(currentLoggedInUser?.role || "").toLowerCase() === "admin");
    const canAdd = canManage && ["ONGOING","REJECTED"].includes(status) && tourExpenseState.scope === "mine";
    const canDeleteTrip = ownsTrip && tourExpenseState.scope === "mine" && status !== "APPROVED";
    const rows = (trip.expenses || []).map(expense => { const policyMeta=[expense.policyLevel?`Level ${expense.policyLevel}`:"",expense.travelMode||"",expense.travelClass||"",expense.distanceKm?`${Number(expense.distanceKm)} km`:""].filter(Boolean).join(" · "); return `<tr><td><strong>${tourEsc(TOUR_EXPENSE_CATEGORY_LABELS[expense.category] || expense.category)}</strong><small>${tourEsc(expense.date || "")}${policyMeta?` · ${tourEsc(policyMeta)}`:""}</small></td><td>${tourEsc(expense.vendor || "-")}<small>${tourEsc(expense.description)}</small>${expense.policyNote?`<small class="tour-policy-line">Policy: ${tourEsc(expense.policyNote)}</small>`:""}</td><td>${tourEsc(expense.paymentMethod)} · ${tourEsc(({EMPLOYEE:"Employee",COMPANY:"Company",ADVANCE:"Advance"})[expense.paidBy] || expense.paidBy)}${expense.reference ? `<small>Bill: ${tourEsc(expense.reference)}</small>` : ""}${expense.receiptUrl ? `<small class="tour-receipt-file">📎 ${tourEsc(expense.receiptName || "Uploaded bill")}</small><button type="button" class="tour-receipt-link" onclick="openTourReceiptPreview(${Number(expense.id)},${Number(trip.id)})">▣ Preview bill</button>` : ""}</td><td>${tourMoney(expense.amount)}${expense.eligibleAmount?`<small>Eligible: ${tourMoney(expense.eligibleAmount)}</small>`:""}${canAdd ? `<small><button class="btn btn-danger" style="padding:3px 6px;margin-top:3px;font-size:9px;" onclick="deleteTourExpense(${Number(expense.id)})">Remove</button></small>` : ""}</td></tr>`; }).join("");
    const buttons = [];
    if (canAdd) {
      buttons.push(`<button class="btn btn-primary" onclick="selectTourExpenseTrip(${Number(trip.id)})">＋ Add expense</button>`);
      if (Number(trip.expenseCount) > 0) buttons.push(`<button class="btn btn-success" onclick="submitTourTrip(${Number(trip.id)})">Finish trip &amp; send for approval</button>`);
      else buttons.push(`<span class="tour-finish-hint">Add an expense before finishing this trip.</span>`);
    }
    if (canDeleteTrip) buttons.push(`<button class="btn btn-danger" onclick="deleteTourTrip(${Number(trip.id)})">🗑️ Delete Trip</button>`);
    if (tourExpenseState.scope === "pending" && status === "SUBMITTED") buttons.push(`<button class="btn btn-success" onclick="reviewTourTrip(${Number(trip.id)},'APPROVED')">Approve</button>`, `<button class="btn btn-danger" onclick="reviewTourTrip(${Number(trip.id)},'REJECTED')">Return to employee</button>`);
    if (tourExpenseState.scope === "reimburse" && status === "APPROVED") buttons.push(`<button class="btn btn-success" onclick="settleTourReimbursement(${Number(trip.id)})">✓ Mark as settled</button>`);
    const note = trip.reviewNote ? `<div class="tour-warning" style="margin-top:10px;"><b>Manager note:</b> ${tourEsc(trip.reviewNote)}${trip.reviewedBy ? ` · ${tourEsc(trip.reviewedBy)}` : ""}</div>` : "";
    const route = trip.startingPoint ? `${tourEsc(trip.startingPoint)} <span aria-hidden="true">→</span> ${tourEsc(trip.destination)}` : tourEsc(trip.destination);
    const settlement = status === "SETTLED" ? `<div class="tour-warning tour-settled-note"><b>Settled by Accounts:</b> ${tourEsc(trip.settledBy || "Accounts")}${trip.settledAt ? ` · ${tourEsc(trip.settledAt)}` : ""}</div>` : "";
    return `<article class="tour-trip" data-trip-id="${Number(trip.id)}"><div class="tour-trip-head"><div class="tour-trip-main"><h4>${route} <span class="tour-status ${["APPROVED","SETTLED"].includes(status) ? "done" : ""}">${tourEsc(statusLabel)}</span></h4><p>${tourEsc(trip.purpose || "Business travel")} · ${tourEsc(trip.startDate)}${trip.returnDate ? " to " + tourEsc(trip.returnDate) : ""}${tourExpenseState.scope !== "mine" ? ` · ${tourEsc(trip.employeeName)} (@${tourEsc(trip.employeeUsername)})` : ""}</p></div><div class="tour-trip-total"><strong>${tourMoney(trip.total)}</strong><small>${Number(trip.expenseCount || 0)} expense(s) · Employee paid ${tourMoney(trip.employeePaid)}</small></div></div>${trip.notes ? `<p class="tour-mode-note">${tourEsc(trip.notes)}</p>` : ""}${note}${settlement}${rows ? `<div style="overflow-x:auto;"><table class="tour-expenses-table"><thead><tr><th>Type / date</th><th>Place / details</th><th>Payment / bill</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="tour-empty" style="padding:13px 5px;">No expenses added yet.</div>`}${buttons.length ? `<div class="tour-trip-actions">${buttons.join("")}</div>` : ""}</article>`;
  }).join("") : `<div class="tour-empty">${query ? "No trips match your search." : (tourExpenseState.scope === "pending" ? "No trips are waiting for approval." : tourExpenseState.scope === "approved" ? "No approved trips are ready for HR export." : tourExpenseState.scope === "reimburse" ? "No HR-approved trip reimbursements are available." : "No trips have been recorded here yet.")}</div>`;
}
window.selectTourExpenseTrip = function(id) { const select=document.getElementById("tourExpenseTrip");if(select)select.value=String(id);tourExpenseState.activeTripId=Number(id)||0;tourExpenseState.expenseFormOpen=true;renderHrTourExpenses();if(select){select.value=String(id);document.getElementById("tourAddExpensePanel")?.scrollIntoView({behavior:"smooth",block:"center"});select.focus();} };
window.closeTourExpenseForm = function() { tourExpenseState.expenseFormOpen=false;renderHrTourExpenses(); };
window.submitTourTrip = async function(id) {
  const trip=tourExpenseState.trips.find(item=>Number(item.id)===Number(id));
  if(!trip)return;
  if(!window.confirm(`Finish the trip to ${trip.destination} and send all saved expenses directly to the Human Resources Manager for approval? You will not be able to add more expenses unless the HR Manager returns it.`))return;
  try {
    await tourExpenseRequest("",{operation:"submit_trip",tripId:id});
    tourExpenseState.expenseFormOpen=false;
    tourNotice("Trip finished and sent","The Human Resources Manager can now review this trip.");
    await loadHrTourExpenses();
  } catch(error) { tourNotice("Could not finish trip",error.message,"danger"); }
};
window.deleteTourExpense = async function(id) { if(!window.confirm("Remove this expense from the trip?"))return;try{await tourExpenseRequest("",{operation:"delete_expense",expenseId:id});tourNotice("Expense removed","The expense has been removed from the trip.");await loadHrTourExpenses();}catch(error){tourNotice("Could not remove expense",error.message,"danger");} };
window.deleteTourTrip = async function(id) {
  const trip = tourExpenseState.trips.find(item => Number(item.id) === Number(id));
  if (!trip) return;
  const waiting = String(trip.status || "").toUpperCase() === "SUBMITTED";
  const message = waiting
    ? "Delete this submitted trip, cancel its pending approval, and remove all expense entries? This cannot be undone."
    : "Delete this trip and all of its expense entries? This cannot be undone.";
  if (!window.confirm(message)) return;
  try {
    await tourExpenseRequest("", { operation: "delete_trip", tripId: id });
    if (Number(tourExpenseState.activeTripId) === Number(id)) tourExpenseState.activeTripId = 0;
    tourExpenseState.expenseFormOpen = false;
    tourNotice("Trip deleted", waiting ? "The trip was removed and its pending approval was cancelled." : "The trip and its expenses were removed.");
    await loadHrTourExpenses();
  } catch(error) { tourNotice("Could not delete trip", error.message, "danger"); }
};
window.reviewTourTrip = async function(id, decision) { let reviewNote="";if(decision==="APPROVED"){if(!window.confirm("Approve this trip expense as the Human Resources Manager?"))return;}else{reviewNote=window.prompt("Why are you returning this trip to the employee? (required)")||"";if(!reviewNote.trim())return;}try{await tourExpenseRequest("",{operation:"review_trip",tripId:id,decision,reviewNote});tourNotice(decision==="APPROVED"?"Trip approved":"Trip returned",decision==="APPROVED"?"The trip expense has received final HR Manager approval.":"The employee can update the expenses and send it again.");await loadHrTourExpenses();}catch(error){tourNotice("Could not update approval",error.message,"danger");} };
window.settleTourReimbursement = async function(id) { const trip=tourExpenseState.trips.find(item=>Number(item.id)===Number(id));if(!trip)return;if(!window.confirm(`Mark the reimbursement for ${trip.employeeName || trip.employeeUsername} — Trip #${id} as settled?`))return;try{await tourExpenseRequest("",{operation:"settle_trip",tripId:id});tourNotice("Reimbursement settled","The employee has been notified that Accounts completed the reimbursement.");await loadHrTourExpenses();}catch(error){tourNotice("Could not settle reimbursement",error.message,"danger");} };
window.exportTourExpensesExcel = function() {
  if(tourExpenseState.scope!=="approved"){tourNotice("HR export only","Open HR Approved Export to download approved expenses.","warning");return;}
  const trips=tourExpenseState.trips.filter(t=>t.status==="APPROVED");if(!trips.length){tourNotice("Nothing to export","There are no approved trips yet.","warning");return;}
  if(!window.XLSX?.utils){tourNotice("Excel export unavailable","Refresh the ERP and try again.","danger");return;}
  const wb=XLSX.utils.book_new();
  const tripRows=trips.map(t=>({"Trip ID":t.id,"Employee":t.employeeName,"Employee Login":t.employeeUsername,"Starting Point":t.startingPoint||"","Destination":t.destination,"Purpose":t.purpose,"Start Date":t.startDate,"Return Date":t.returnDate||"","Status":t.status,"Total Expenses":Number(t.total||0),"Employee Paid":Number(t.employeePaid||0),"Approved By":t.reviewedBy||"","Approved At":t.reviewedAt||"","Trip Notes":t.notes||""}));
  const expenseRows=trips.flatMap(t=>(t.expenses||[]).map(e=>({"Trip ID":t.id,"Employee":t.employeeName,"Starting Point":t.startingPoint||"","Destination":t.destination,"Expense Date":e.date,"Expense Type":TOUR_EXPENSE_CATEGORY_LABELS[e.category]||e.category,"Employee Level":e.policyLevel?`Level ${e.policyLevel}`:"","Claim Basis":e.claimBasis||"","Travel Mode":e.travelMode||"","Travel Class":e.travelClass||"","Vehicle":e.vehicleType||"","Distance KM":Number(e.distanceKm||0),"Policy Rate":Number(e.unitRate||0),"Units / Dishes":Number(e.quantity||0),"Claim Amount":Number(e.amount||0),"Eligible Amount":Number(e.eligibleAmount||0),"Policy Note":e.policyNote||"","Paid By":({EMPLOYEE:"Employee",COMPANY:"Company",ADVANCE:"Company Advance"})[e.paidBy]||e.paidBy,"Payment Method":e.paymentMethod,"Shop / Hotel / Place":e.vendor,"Bill / Reference":e.reference,"Expense Details":e.description,"Receipt":e.receiptName||""})));
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(tripRows),"Approved Trips");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(expenseRows),"Expense Details");
  XLSX.writeFile(wb,`Approved_Tour_Expenses_${tourLocalDate()}.xlsx`);
};
const tourTripForm=document.getElementById("tourTripForm");
const tourExpenseForm=document.getElementById("tourExpenseForm");
if(tourTripForm){const date=tourTripForm.elements.startDate;if(date)date.value=tourLocalDate();tourTripForm.addEventListener("submit",async event=>{event.preventDefault();const data=new FormData(tourTripForm);const payload={operation:"create_trip",startingPoint:data.get("startingPoint"),destination:data.get("destination"),purpose:data.get("purpose"),startDate:data.get("startDate"),returnDate:data.get("returnDate"),notes:data.get("notes")};try{const result=await tourExpenseRequest("",payload);tourTripForm.reset();tourTripForm.elements.startDate.value=tourLocalDate();tourExpenseState.activeTripId=Number(result.id)||0;tourExpenseState.expenseFormOpen=false;tourNotice("Trip started","Use Add expense to record costs, then finish the trip to send it for approval.");await loadHrTourExpenses();}catch(error){tourNotice("Could not start trip",error.message,"danger");}});}
if(tourExpenseForm){const date=tourExpenseForm.elements.expenseDate;if(date)date.value=tourLocalDate();document.getElementById("tourExpenseTrip")?.addEventListener("change",event=>{tourExpenseState.activeTripId=Number(event.target.value)||0;});tourExpenseForm.addEventListener("submit",async event=>{event.preventDefault();const data=new FormData(tourExpenseForm);data.set("operation","add_expense");try{await tourExpenseRequest("",data);const selectedTripId=Number(data.get("tripId"))||tourExpenseState.activeTripId;tourExpenseState.activeTripId=selectedTripId;tourExpenseState.expenseFormOpen=true;tourExpenseForm.reset();tourExpenseForm.elements.expenseDate.value=tourLocalDate();const quantity=document.getElementById("tourPolicyQuantity");if(quantity)quantity.value="1";tourExpensePolicyChanged();tourNotice("Expense saved","This cost has been added to the trip under the applicable TA/DA policy.");await loadHrTourExpenses();}catch(error){tourNotice("Could not save expense",error.message,"danger");}});}
const rechargeExpenseForm=document.getElementById("rechargeExpenseForm");if(rechargeExpenseForm){rechargeExpenseForm.elements.rechargeDate.value=tourLocalDate();rechargeExpenseForm.addEventListener("submit",async event=>{event.preventDefault();const button=document.getElementById("rechargeSubmitButton");if(button)button.disabled=true;try{await rechargeExpenseRequest(new FormData(rechargeExpenseForm));rechargeExpenseForm.reset();rechargeExpenseForm.elements.rechargeDate.value=tourLocalDate();renderRechargePolicy();tourNotice("Recharge claim submitted","Your mobile recharge claim is saved and ready for review.");await window.loadRechargeExpenses();}catch(error){tourNotice("Could not submit recharge",error.message,"danger");}finally{renderRechargePolicy();}});}
document.getElementById("tourTripSearch")?.addEventListener("input",renderHrTourExpenses);

