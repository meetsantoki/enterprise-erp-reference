(function () {
  "use strict";

  const PAGE_SIZES = {
    A0:[2383.94,3370.39], A1:[1683.78,2383.94], A2:[1190.55,1683.78], A3:[841.89,1190.55], A4:[595.28,841.89], A5:[419.53,595.28], A6:[297.64,419.53],
    B4:[708.66,1000.63], B5:[498.90,708.66], LETTER:[612,792], LEGAL:[612,1008], TABLOID:[792,1224], EXECUTIVE:[522,756], FOLIO:[612,936],
    PHOTO4X6:[288,432], PHOTO5X7:[360,504], PHOTO8X10:[576,720], DL:[311.81,623.62], C5:[459.21,649.13]
  };
  const PAGE_SIZE_LABELS={A0:"A0",A1:"A1",A2:"A2",A3:"A3",A4:"A4",A5:"A5",A6:"A6",B4:"B4",B5:"B5",LETTER:"US Letter",LEGAL:"US Legal",TABLOID:"Tabloid",EXECUTIVE:"Executive",FOLIO:"Folio",PHOTO4X6:"Photo 4 × 6",PHOTO5X7:"Photo 5 × 7",PHOTO8X10:"Photo 8 × 10",DL:"DL Envelope",C5:"C5 Envelope",CUSTOM:"Custom"};
  const state = {
    pages:[], sources:new Map(), selectedPage:-1, selectedObject:null, zoom:1, renderScale:1,
    history:[], future:[], dragging:null, imageCache:new Map(), nextId:1, inspectorTab:"document", workspaceObserver:null, workspaceResizeTimer:null, centerAfterRender:true, canvasRenderSeq:0
  };
  let quickImage=null,quickImageFile=null,quickImageResult=null,quickImagePreviewUrl="",quickImagePreviewTimer=null,quickImageJob=0;
  let dscP12Bytes = null;
  let dscCertificate = null;

  function el(id){ return document.getElementById(id); }
  function uid(prefix){ return `${prefix}-${Date.now()}-${state.nextId++}`; }
  function notify(title,message,type="success"){
    if(window.showNotification) window.showNotification({title,message,type});
    else alert(`${title}\n${message}`);
  }
  function clonePages(){ return JSON.parse(JSON.stringify(state.pages)); }
  function checkpoint(){
    state.history.push(clonePages());
    if(state.history.length>40) state.history.shift();
    state.future=[]; updateHistoryButtons();
  }
  function updateHistoryButtons(){
    if(el("pdfStudioUndoBtn")) el("pdfStudioUndoBtn").disabled=!state.history.length;
    if(el("pdfStudioRedoBtn")) el("pdfStudioRedoBtn").disabled=!state.future.length;
  }
  function currentPage(){ return state.pages[state.selectedPage] || null; }
  function currentObject(){ return currentPage()?.objects.find(o=>o.id===state.selectedObject) || null; }
  function pageSizeFromControls(){
    const key=el("pdfNewPageSize")?.value||"A4";let base;
    if(key==="CUSTOM"){
      const factor=el("pdfCustomUnit")?.value==="in"?72:el("pdfCustomUnit")?.value==="pt"?1:72/25.4;
      base=[Math.max(10,Number(el("pdfCustomWidth")?.value)||210)*factor,Math.max(10,Number(el("pdfCustomHeight")?.value)||297)*factor];
    }else base=[...(PAGE_SIZES[key]||PAGE_SIZES.A4)];
    if(el("pdfNewPageOrientation")?.value==="landscape") base.reverse();
    return base;
  }
  function newBlankPage(){ const [width,height]=pageSizeFromControls(); return {id:uid("page"),sourceId:null,pageNo:null,width,height,rotation:0,objects:[]}; }

  window.openPdfStudio=function(btn){ return window.switchView("utilitiesPdfStudio",btn,"UTILITIES > PDF STUDIO"); };
  window.openUtilitiesImageOptimizer=function(btn){ return window.switchView("utilitiesImageOptimizer",btn,"UTILITIES > IMAGE OPTIMIZER"); };
  window.openUtilitiesCodeMaker=function(btn){ return window.switchView("utilitiesCodeMaker",btn,"UTILITIES > QR & BARCODE MAKER"); };
  window.openUtilitiesSavedDocuments=function(btn){ return window.switchView("utilitiesSavedDocuments",btn,"UTILITIES > SAVED DOCUMENTS"); };
  window.pdfStudioActivate=function(){
    if(!state.pages.length) window.pdfStudioNewDocument(false);
    state.centerAfterRender=true;
    window.pdfStudioInspectorTab(state.inspectorTab||"document",true);syncPageSetupControls();syncZoomControls();renderAll();bindCanvas();bindWorkspaceResize();
  };
  window.utilitiesImageOptimizerActivate=function(){if(quickImage)window.utilityScheduleImagePreview();};
  window.utilitiesCodeMakerActivate=function(){const input=el("utilityCodeValue");if(!input)return;if(input.value.trim()==="https://erp.example.test/")input.value="";input.placeholder="Paste a link, text, or words you want to convert into a QR code.";};
  window.utilitiesSavedDocumentsActivate=function(){bindSavedDocumentDropzone();loadSavedDocuments();};

  window.pdfStudioNewDocument=async function(confirmFirst=true){
    if(confirmFirst && state.pages.length && !confirm("Start a new PDF? Unsaved studio changes will be cleared.")) return;
    state.pages=[newBlankPage()]; state.sources.clear(); state.selectedPage=0; state.selectedObject=null; state.history=[]; state.future=[]; state.centerAfterRender=true;
    if(el("pdfDocFileName")) el("pdfDocFileName").value="DemoSolar-Document.pdf";
    syncPageSetupControls();renderAll();
  };
  window.pdfStudioAddBlankPage=function(){ checkpoint(); state.pages.push(newBlankPage()); state.selectedPage=state.pages.length-1; state.selectedObject=null; state.centerAfterRender=true; renderAll(); };

  async function loadPdfSource(bytes,id){
    if(!window.PDFLib) throw new Error("PDF engine could not load. Refresh the page and try again.");
    if(window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const copy=bytes instanceof Uint8Array?new Uint8Array(bytes):new Uint8Array(bytes);
    const libDoc=await PDFLib.PDFDocument.load(copy,{ignoreEncryption:false,updateMetadata:false});
    const pdfjs=window.pdfjsLib?await window.pdfjsLib.getDocument({data:copy.slice()}).promise:null;
    const source={id,bytes:copy,pdfjs}; state.sources.set(id,source);
    return {source,libDoc};
  }
  window.pdfStudioImportDocument=function(files){const list=Array.from(files||[]);if(!list.length)return;const hasWork=state.pages.length>1||state.pages.some(page=>page.sourceId||page.objects.length);if(hasWork&&!confirm("Importing a PDF will replace the current document. Continue?")){if(el("pdfStudioImportInput"))el("pdfStudioImportInput").value="";return;}return window.pdfStudioImportFiles(list,"replace");};
  window.pdfStudioMergeFiles=function(files){return window.pdfStudioImportFiles(files,"merge");};
  window.pdfStudioImportFiles=async function(files,mode="merge"){
    const list=Array.from(files||[]); if(!list.length)return;
    try{
      checkpoint();
      if(mode==="replace"||(state.pages.length===1&&!state.pages[0].sourceId&&!state.pages[0].objects.length))state.pages=[];const firstImportedPage=state.pages.length;
      for(const file of list){
        setStatus(`Opening ${file.name}…`);
        const id=uid("source"), bytes=new Uint8Array(await file.arrayBuffer());
        const {libDoc}=await loadPdfSource(bytes,id);
        libDoc.getPages().forEach((p,index)=>{ const s=p.getSize(); state.pages.push({id:uid("page"),sourceId:id,pageNo:index,width:s.width,height:s.height,rotation:0,objects:[]}); });
      }
      state.selectedPage=Math.max(0,firstImportedPage);state.selectedObject=null;state.centerAfterRender=true;syncPageSetupControls();renderAll();
      notify(mode==="replace"?"PDF Imported":"PDFs Merged",mode==="replace"?`${list[0].name} opened as a new document.`:`${list.length} PDF file${list.length===1?"":"s"} added to the current document.`);
    }catch(err){ state.history.pop(); notify("Cannot Open PDF",err.message||"The PDF may be password protected or damaged.","danger"); }
    finally{if(el("pdfStudioImportInput"))el("pdfStudioImportInput").value="";if(el("pdfStudioMergeInput"))el("pdfStudioMergeInput").value="";setStatus("Ready");}
  };

  function defaultObject(type,extra={}){
    const page=currentPage(); return {id:uid("object"),type,x:50,y:65,w:Math.min(260,(page?.width||595)-100),h:40,text:"",fontFamily:"Helvetica",fontSize:18,color:"#123b56",fillColor:"#e6f7f1",strokeColor:"#0a9f75",strokeWidth:1.5,opacity:1,rotation:0,...extra};
  }
  function addObject(obj){ if(!currentPage()) return; checkpoint(); currentPage().objects.push(obj); state.selectedObject=obj.id; window.pdfStudioInspectorTab("object",true); renderAll(); }
  window.pdfStudioAddText=function(){ addObject(defaultObject("text",{text:"Type your text here",fontSize:20,h:34})); };
  window.pdfStudioAddAddress=function(){ addObject(defaultObject("text",{text:"DEMOSOLAR ENERGY PVT LTD\nSurvey No. 243, Bhayla, Ahmedabad, Gujarat\nIndia",fontFamily:"Helvetica",fontSize:11,w:280,h:54})); };
  window.pdfStudioAddShape=function(kind){ addObject(defaultObject(kind,{w:kind==="line"?240:180,h:kind==="line"?3:90,opacity:.8})); };
  window.pdfStudioAddWhiteout=function(){ addObject(defaultObject("rect",{w:220,h:45,fillColor:"#ffffff",strokeColor:"#ffffff",strokeWidth:0,opacity:1,text:"Whiteout"})); };
  function brandScopeMarkup(){return `<div class="pdf-brand-scope"><label>Apply on</label><label class="pdf-page-scope-option"><input id="pdfBrandScopeAll" type="checkbox" onchange="pdfStudioBrandScopeChanged('all')"><span>Apply to all pages</span></label><label class="pdf-page-scope-option"><input id="pdfBrandScopeOnly" type="checkbox" onchange="pdfStudioBrandScopeChanged('only')"><span>Only to pages</span></label><div id="pdfBrandPagesWrap" hidden><label for="pdfBrandPages">Page numbers</label><textarea id="pdfBrandPages" rows="3" placeholder="Enter page numbers separated by spaces, commas or new lines"></textarea><small>Example: 1, 3 5 or one page number per line.</small></div><small>Leave both options unchecked to apply only on the current page (${state.selectedPage+1}).</small></div>`;}
  window.pdfStudioBrandScopeChanged=function(mode){const all=el("pdfBrandScopeAll"),only=el("pdfBrandScopeOnly"),wrap=el("pdfBrandPagesWrap");if(mode==="all"&&all?.checked&&only)only.checked=false;if(mode==="only"&&only?.checked&&all)all.checked=false;if(wrap)wrap.hidden=!only?.checked;};
  function brandTargets(){
    if(el("pdfBrandScopeAll")?.checked)return state.pages.map((page,index)=>({page,index}));if(!el("pdfBrandScopeOnly")?.checked)return [{page:currentPage(),index:state.selectedPage}];
    const raw=el("pdfBrandPages")?.value||"",numbers=[...new Set(raw.split(/[\s,;]+/).filter(Boolean).map(Number))],invalid=numbers.filter(n=>!Number.isInteger(n)||n<1||n>state.pages.length);
    if(!numbers.length||invalid.length){notify("Check Page Numbers",`Enter page numbers from 1 to ${state.pages.length}, separated by commas, spaces or new lines.`,"danger");return null;}
    return numbers.map(number=>({page:state.pages[number-1],index:number-1}));
  }
  function toggleBrandFromCurrentPage(tool,label){const page=currentPage();if(!page)return false;const present=page.objects.some(o=>o.brandTool===tool);if(!present)return false;checkpoint();page.objects=page.objects.filter(o=>o.brandTool!==tool);if(!page.objects.some(o=>o.id===state.selectedObject))state.selectedObject=null;renderAll();notify(`${label} Removed`,`Removed from page ${state.selectedPage+1}.`);return true;}
  function applyBrandTool(tool,label,factory){
    const targets=brandTargets();if(!targets?.length)return;checkpoint();let selected=null;targets.forEach(({page,index})=>{page.objects=page.objects.filter(o=>o.brandTool!==tool);const object={...factory(page,index),id:uid("object"),brandTool:tool};page.objects.push(object);if(index===state.selectedPage)selected=object.id;});state.selectedObject=selected;closeModal();renderAll();notify(`${label} Added`,targets.length===1?`Applied to page ${targets[0].index+1}.`:`Applied to ${targets.length} selected pages.`);
  }
  window.pdfStudioOpenStamp=function(){
    if(toggleBrandFromCurrentPage("stamp","Stamp"))return;
    openModal("Add Document Stamp",`<div class="form-group"><label>Stamp</label><select id="pdfStampText"><option>APPROVED</option><option>CONFIDENTIAL</option><option>DRAFT</option><option>PAID</option><option>RECEIVED</option><option>FOR REVIEW</option></select></div><div class="grid-2"><div class="form-group"><label>Colour</label><input id="pdfStampColor" type="color" value="#059669"></div><div class="form-group"><label>Angle</label><input id="pdfStampAngle" type="number" value="-12" min="-90" max="90"></div></div>${brandScopeMarkup()}`,[{label:"Place Stamp",className:"btn btn-success",action:()=>{const text=el("pdfStampText").value,color=el("pdfStampColor").value,angle=Number(el("pdfStampAngle").value)||0;applyBrandTool("stamp","Stamp",page=>({type:"text",x:50,y:65,w:Math.min(240,page.width-100),h:48,text,fontFamily:"HelveticaBold",fontSize:30,color,opacity:1,rotation:angle,align:"center"}));}}]);
  };
  window.pdfStudioAddImageFile=async function(file){
    if(!file)return; if(!/^image\/(png|jpeg)$/.test(file.type)){notify("Unsupported Image","Use a PNG or JPG image.","danger");return;}
    const dataUrl=await readDataUrl(file); const img=await loadImage(dataUrl); const max=240, ratio=img.naturalWidth/img.naturalHeight;
    addObject(defaultObject("image",{dataUrl,w:ratio>=1?max:max*ratio,h:ratio>=1?max/ratio:max,text:file.name}));
    el("pdfStudioImageInput").value="";
  };
  window.pdfStudioAddPageNumbers=function(){
    if(!state.pages.length||toggleBrandFromCurrentPage("pageNumber","Page Number"))return;
    openModal("Add Page Numbers",`${brandScopeMarkup()}<p class="pdf-brand-help">Page numbers remain dynamic after pages are reordered, added or removed.</p>`,[{label:"Add Page Numbers",className:"btn btn-success",action:()=>applyBrandTool("pageNumber","Page Number",page=>({type:"text",x:page.width/2-70,y:page.height-34,w:140,h:20,text:"Page {{page}} of {{pages}}",fontFamily:"Helvetica",fontSize:9,color:"#64748b",opacity:1,rotation:0,align:"center"}))}]);
  };

  window.pdfStudioOpenWatermark=function(){
    if(toggleBrandFromCurrentPage("watermark","Watermark"))return;
    openModal("Add Watermark",`<div class="form-group"><label>Watermark text</label><input id="pdfWatermarkText" value="CONFIDENTIAL"></div><div class="grid-2"><div class="form-group"><label>Colour</label><input id="pdfWatermarkColor" type="color" value="#168f78"></div><div class="form-group"><label>Opacity</label><input id="pdfWatermarkOpacity" type="range" min="5" max="70" value="18"></div></div>${brandScopeMarkup()}`,[{label:"Add Watermark",className:"btn btn-success",action:()=>{const text=el("pdfWatermarkText").value||"CONFIDENTIAL",color=el("pdfWatermarkColor").value,opacity=Number(el("pdfWatermarkOpacity").value)/100;applyBrandTool("watermark","Watermark",page=>({type:"text",x:page.width*.12,y:page.height*.44,w:page.width*.76,h:80,text,fontFamily:"HelveticaBold",fontSize:Math.max(30,page.width/11),color,opacity,rotation:-35,align:"center"}));}}]);
  };
  window.pdfStudioOpenSignature=function(){
    if(toggleBrandFromCurrentPage("signature","Signature"))return;
    openModal("Add Signature",`<div class="form-group"><label>Draw signature</label><canvas id="pdfSignaturePad" class="signature-pad" width="560" height="140"></canvas></div><div class="utility-action-row"><button class="btn btn-secondary" type="button" onclick="pdfStudioClearSignature()">Clear</button><label class="btn btn-secondary" style="cursor:pointer;">Upload PNG/JPG<input id="pdfSignatureUpload" type="file" accept="image/png,image/jpeg" hidden onchange="pdfStudioPreviewSignatureFile(this.files[0])"></label></div><div id="pdfSignatureUploadPreview" class="pdf-signature-upload-preview" hidden><div><b>Uploaded signature preview</b><span id="pdfSignatureUploadName"></span></div><img id="pdfSignatureUploadImage" alt="Uploaded signature preview"></div>${brandScopeMarkup()}<p style="font-size:11px;color:#64748b;line-height:1.5;">This places a visual signature on the PDF. Certificate-based cryptographic signing requires an organization-issued signing certificate and is intentionally kept separate.</p>`,[{label:"Place Signature",className:"btn btn-success",action:placeSignature}]);
    initSignaturePad();
  };
  let signatureUploadData=null, signatureDrawing=false;
  function initSignaturePad(){
    const c=el("pdfSignaturePad"),ctx=c?.getContext("2d"); if(!c)return; signatureUploadData=null; ctx.lineWidth=2.2;ctx.lineCap="round";ctx.strokeStyle="#0f172a";
    const pos=e=>{const r=c.getBoundingClientRect(),p=e.touches?.[0]||e;return[(p.clientX-r.left)*c.width/r.width,(p.clientY-r.top)*c.height/r.height]};
    const start=e=>{e.preventDefault();signatureUploadData=null;const preview=el("pdfSignatureUploadPreview"),image=el("pdfSignatureUploadImage");if(preview)preview.hidden=true;if(image)image.removeAttribute("src");signatureDrawing=true;ctx.beginPath();ctx.moveTo(...pos(e))}; const move=e=>{if(!signatureDrawing)return;e.preventDefault();ctx.lineTo(...pos(e));ctx.stroke()}; const stop=()=>signatureDrawing=false;
    c.onpointerdown=start;c.onpointermove=move;c.onpointerup=stop;c.onpointerleave=stop;
  }
  window.pdfStudioClearSignature=function(){const c=el("pdfSignaturePad"),preview=el("pdfSignatureUploadPreview"),image=el("pdfSignatureUploadImage"),input=el("pdfSignatureUpload");c?.getContext("2d").clearRect(0,0,c.width,c.height);signatureUploadData=null;if(preview)preview.hidden=true;if(image)image.removeAttribute("src");if(input)input.value="";};
  window.pdfStudioPreviewSignatureFile=async function(file){
    const preview=el("pdfSignatureUploadPreview"),image=el("pdfSignatureUploadImage"),name=el("pdfSignatureUploadName");
    if(!file){window.pdfStudioClearSignature();return;}
    if(!/^image\/(png|jpeg)$/i.test(file.type||"")){notify("Unsupported Signature","Please upload a PNG or JPG signature image.","danger");window.pdfStudioClearSignature();return;}
    signatureUploadData=await readDataUrl(file);if(image)image.src=signatureUploadData;if(name)name.textContent=`${file.name} · ${Math.max(1,Math.round(file.size/1024))} KB`;if(preview)preview.hidden=false;
  };
  function placeSignature(){ const c=el("pdfSignaturePad"),data=signatureUploadData||c?.toDataURL("image/png"); if(!data)return;applyBrandTool("signature","Signature",()=>({type:"image",x:50,y:65,w:180,h:60,text:"Signature",dataUrl:data,opacity:1,rotation:0})); }

  window.pdfStudioSelectPage=function(i){ state.selectedPage=Number(i);state.selectedObject=null;state.centerAfterRender=true;window.pdfStudioInspectorTab("document",true);syncPageSetupControls();renderAll(); };
  window.pdfStudioDeletePage=function(i=state.selectedPage){
    if(state.pages.length<=1){notify("Page Required","A PDF must contain at least one page.","danger");return;} checkpoint();state.pages.splice(Number(i),1);state.selectedPage=Math.min(state.selectedPage,state.pages.length-1);state.selectedObject=null;state.centerAfterRender=true;renderAll();
  };
  window.pdfStudioDuplicatePage=function(){const p=currentPage();if(!p)return;checkpoint();const copy=JSON.parse(JSON.stringify(p));copy.id=uid("page");copy.objects.forEach(o=>o.id=uid("object"));state.pages.splice(state.selectedPage+1,0,copy);state.selectedPage++;state.centerAfterRender=true;renderAll();};
  window.pdfStudioMovePage=function(i,dir){i=Number(i);const n=i+Number(dir);if(n<0||n>=state.pages.length)return;checkpoint();[state.pages[i],state.pages[n]]=[state.pages[n],state.pages[i]];state.selectedPage=n;state.centerAfterRender=true;renderAll();};
  window.pdfStudioRotatePage=function(amount){if(!currentPage())return;checkpoint();currentPage().rotation=(currentPage().rotation+Number(amount)+360)%360;renderAll();};
  window.pdfStudioDeleteSelected=function(){const p=currentPage();if(!p||!state.selectedObject)return;checkpoint();p.objects=p.objects.filter(o=>o.id!==state.selectedObject);state.selectedObject=null;window.pdfStudioInspectorTab("layers",true);renderAll();};
  window.pdfStudioDuplicateSelected=function(){const o=currentObject();if(!o)return;checkpoint();const c=JSON.parse(JSON.stringify(o));c.id=uid("object");c.x+=14;c.y+=14;currentPage().objects.push(c);state.selectedObject=c.id;renderAll();};
  window.pdfStudioLayerMove=function(dir){const p=currentPage(),i=p?.objects.findIndex(o=>o.id===state.selectedObject);if(i==null||i<0)return;const n=Math.max(0,Math.min(p.objects.length-1,i+Number(dir)));if(n===i)return;checkpoint();const [o]=p.objects.splice(i,1);p.objects.splice(n,0,o);renderAll();};
  window.pdfStudioSelectObject=function(id){state.selectedObject=id;window.pdfStudioInspectorTab("object",true);renderInspector();renderCanvas();};
  window.pdfStudioInspectorTab=function(tab,silent=false){
    state.inspectorTab=["document","object","layers"].includes(tab)?tab:"document";
    document.querySelectorAll("#view-utilitiesPdfStudio [data-pdf-inspector-pane]").forEach(p=>p.classList.toggle("active",p.dataset.pdfInspectorPane===state.inspectorTab));
    document.querySelectorAll("#view-utilitiesPdfStudio .pdf-inspector-tabs button").forEach(b=>b.classList.toggle("active",b.id===`pdfInspectorTab-${state.inspectorTab}`));
    if(!silent) el("pdfStudioInspector")?.scrollTo({top:0,behavior:"smooth"});
  };
  window.pdfStudioUpdateSelected=function(key,value){const o=currentObject();if(!o)return;if(!o._editingCheckpoint){checkpoint();o._editingCheckpoint=true;setTimeout(()=>{if(o)o._editingCheckpoint=false},500)};o[key]=["fontSize","rotation","w","h"].includes(key)?Number(value):value;if(key==="color"){if(el("pdfObjColor"))el("pdfObjColor").value=value;if(el("pdfObjColorText"))el("pdfObjColorText").value=value}renderCanvas();renderLayers();};
  window.pdfStudioZoom=function(delta){state.zoom=Math.max(.35,Math.min(1.6,state.zoom+Number(delta)));state.centerAfterRender=true;syncZoomControls();renderCanvas();};
  window.pdfStudioSetZoom=function(percent){state.zoom=Math.max(.35,Math.min(1.6,Number(percent)/100));state.centerAfterRender=true;syncZoomControls();renderCanvas();};
  function syncZoomControls(){const value=Math.round(state.zoom*100);if(el("pdfStudioZoomLabel"))el("pdfStudioZoomLabel").textContent=value+"%";if(el("pdfStudioZoomRange"))el("pdfStudioZoomRange").value=value;}
  function detectPageSize(width,height){
    const portrait=width<=height,[pw,ph]=portrait?[width,height]:[height,width];let found="CUSTOM",best=Infinity;
    Object.entries(PAGE_SIZES).forEach(([key,size])=>{const score=Math.abs(size[0]-pw)+Math.abs(size[1]-ph);if(score<best&&score<5){best=score;found=key}});
    return {key:found,orientation:portrait?"portrait":"landscape"};
  }
  function ptToUnit(points,unit){return unit==="in"?points/72:unit==="pt"?points:points*25.4/72;}
  function syncPageSetupControls(){
    const p=currentPage();if(!p||!el("pdfNewPageSize"))return;const detected=detectPageSize(p.width,p.height);el("pdfNewPageSize").value=detected.key;el("pdfNewPageOrientation").value=detected.orientation;
    if(detected.key==="CUSTOM"){const unit=el("pdfCustomUnit")?.value||"mm",portrait=detected.orientation==="portrait",w=portrait?p.width:p.height,h=portrait?p.height:p.width;el("pdfCustomWidth").value=Number(ptToUnit(w,unit).toFixed(2));el("pdfCustomHeight").value=Number(ptToUnit(h,unit).toFixed(2));}
    el("pdfCustomSizeFields").hidden=detected.key!=="CUSTOM";updatePageSizePreview();
  }
  function updatePageSizePreview(){
    if(!el("pdfSizePreviewSheet"))return;const [w,h]=pageSizeFromControls(),key=el("pdfNewPageSize").value,orientation=el("pdfNewPageOrientation").value,max=Math.max(w,h);el("pdfSizePreviewSheet").style.width=`${Math.max(20,w/max*48)}px`;el("pdfSizePreviewSheet").style.height=`${Math.max(20,h/max*48)}px`;el("pdfSizePreviewName").textContent=`${PAGE_SIZE_LABELS[key]||key} · ${orientation[0].toUpperCase()+orientation.slice(1)}`;el("pdfSizePreviewDimensions").textContent=`${(w*25.4/72).toFixed(1)} × ${(h*25.4/72).toFixed(1)} mm · ${(w/72).toFixed(2)} × ${(h/72).toFixed(2)} in`;
  }
  let customSizeTimer=null;
  window.pdfStudioPageSetupChanged=function(){if(el("pdfCustomSizeFields"))el("pdfCustomSizeFields").hidden=el("pdfNewPageSize").value!=="CUSTOM";updatePageSizePreview();};
  window.pdfStudioCustomSizeChanged=function(){updatePageSizePreview();clearTimeout(customSizeTimer);customSizeTimer=setTimeout(updatePageSizePreview,180);};
  window.pdfStudioPageScopeChanged=function(mode){const all=el("pdfApplySizeAllPages"),only=el("pdfApplySizeOnlyPages"),pages=el("pdfApplySizePageNumbers");if(mode==="all"&&all?.checked&&only)only.checked=false;if(mode==="only"&&only?.checked&&all)all.checked=false;if(pages)pages.disabled=!only?.checked;};
  function pdfStudioSelectedPageIndexes(){const raw=String(el("pdfApplySizePageNumbers")?.value||"").trim();if(!raw){notify("Page Numbers Required","Enter one or more page numbers separated by spaces, commas or new lines.","danger");return null;}const tokens=raw.split(/[\s,]+/).filter(Boolean),indexes=[],invalid=[];tokens.forEach(token=>{const page=Number(token);if(!Number.isInteger(page)||page<1||page>state.pages.length)invalid.push(token);else if(!indexes.includes(page-1))indexes.push(page-1);});if(invalid.length){notify("Invalid Page Numbers",`Use page numbers from 1 to ${state.pages.length}. Check: ${invalid.join(", ")}`,"danger");return null;}return indexes;}
  window.pdfStudioApplyScopedPageSetup=function(){if(el("pdfApplySizeAllPages")?.checked)return window.pdfStudioApplyPageSetup("all");if(el("pdfApplySizeOnlyPages")?.checked){const indexes=pdfStudioSelectedPageIndexes();if(!indexes?.length)return;return window.pdfStudioApplyPageSetup(indexes);}return window.pdfStudioApplyPageSetup("current");};
  window.pdfStudioApplyPageSetup=function(scope="current"){
    if(!currentPage())return;const [width,height]=pageSizeFromControls();if(!Number.isFinite(width)||!Number.isFinite(height)||width<20||height<20)return;const indexes=Array.isArray(scope)?scope:null,targets=scope==="all"?state.pages:indexes?indexes.map(index=>state.pages[index]).filter(Boolean):[currentPage()];
    if(!targets.length)return;if(targets.every(p=>Math.abs(p.width-width)<.1&&Math.abs(p.height-height)<.1)){updatePageSizePreview();notify("Page Size Unchanged","The selected pages already use this page size.");return;}checkpoint();targets.forEach(p=>resizePageModel(p,width,height));state.centerAfterRender=true;renderAll();const sizeName=PAGE_SIZE_LABELS[el("pdfNewPageSize").value]||"Selected size",scopeLabel=scope==="all"?`all ${targets.length} pages`:indexes?`page${targets.length===1?"":"s"} ${indexes.map(index=>index+1).join(", ")}`:`page ${state.selectedPage+1}`;notify("Page Size Applied",`${sizeName} applied to ${scopeLabel}.`);
  };
  function resizePageModel(page,width,height){const sx=width/page.width,sy=height/page.height,textScale=Math.min(sx,sy);page.objects.forEach(o=>{o.x*=sx;o.y*=sy;o.w*=sx;o.h*=sy;if(o.fontSize)o.fontSize=Math.max(5,o.fontSize*textScale);if(o.strokeWidth)o.strokeWidth*=textScale});page.width=width;page.height=height;}
  window.pdfStudioUndo=function(){if(!state.history.length)return;state.future.push(clonePages());state.pages=state.history.pop();state.selectedPage=Math.min(state.selectedPage,state.pages.length-1);state.selectedObject=null;syncPageSetupControls();renderAll();};
  window.pdfStudioRedo=function(){if(!state.future.length)return;state.history.push(clonePages());state.pages=state.future.pop();state.selectedPage=Math.min(state.selectedPage,state.pages.length-1);state.selectedObject=null;syncPageSetupControls();renderAll();};

  function renderAll(){renderPages();renderCanvas();renderInspector();updateHistoryButtons();syncBrandToolButtons();}
  function syncBrandToolButtons(){
    const page=currentPage();document.querySelectorAll("#view-utilitiesPdfStudio [data-brand-tool]").forEach(button=>{const active=!!page?.objects.some(o=>o.brandTool===button.dataset.brandTool);button.classList.toggle("active",active);button.setAttribute("aria-pressed",String(active));button.title=active?`Click again to remove from page ${state.selectedPage+1}`:"Add to selected pages";});
  }
  async function renderPages(){
    const box=el("pdfStudioPages");if(!box)return; el("pdfStudioPageCount").textContent=state.pages.length;
    box.innerHTML=state.pages.map((p,i)=>`<div class="pdf-page-thumb ${i===state.selectedPage?"active":""}" onclick="pdfStudioSelectPage(${i})"><canvas id="pdfThumb${i}" width="140" height="180"></canvas><span>Page ${i+1}${p.rotation?` · ${p.rotation}°`:""}</span><div class="thumb-actions"><button title="Move up" onclick="event.stopPropagation();pdfStudioMovePage(${i},-1)">↑</button><button title="Move down" onclick="event.stopPropagation();pdfStudioMovePage(${i},1)">↓</button><button title="Delete" onclick="event.stopPropagation();pdfStudioDeletePage(${i})">×</button></div></div>`).join("");
    state.pages.forEach((p,i)=>renderPageToCanvas(p,el(`pdfThumb${i}`),Math.min(140/p.width,170/p.height),false,i));
  }
  async function renderCanvas(){
    const renderSeq=++state.canvasRenderSeq,page=currentPage(),canvas=el("pdfStudioCanvas"),stage=el("pdfStudioCanvasStage"),empty=el("pdfStudioEmpty");if(!canvas||!stage)return;
    if(!page){stage.hidden=true;empty.hidden=false;return;} stage.hidden=false;empty.hidden=true;
    state.renderScale=calculateWorkspaceFitScale(page)*state.zoom;
    await renderPageToCanvas(page,canvas,state.renderScale,true,state.selectedPage);if(renderSeq!==state.canvasRenderSeq)return;updatePageRulers(page,canvas);scheduleLiveThumbnail();
    if(state.centerAfterRender){state.centerAfterRender=false;requestAnimationFrame(centerCanvasViewport);}
    if(el("pdfStudioDimensions"))el("pdfStudioDimensions").textContent=`${Math.round(page.width)} × ${Math.round(page.height)} pt · Rotation ${page.rotation}°`;
  }
  function centerCanvasViewport(){const wrap=el("pdfStudioCanvasWrap"),stage=el("pdfStudioCanvasStage");if(!wrap||!stage)return;const left=stage.offsetLeft+stage.offsetWidth/2-wrap.clientWidth/2,top=stage.offsetTop+stage.offsetHeight/2-wrap.clientHeight/2;wrap.scrollLeft=Math.max(0,Math.min(left,wrap.scrollWidth-wrap.clientWidth));wrap.scrollTop=Math.max(0,Math.min(top,wrap.scrollHeight-wrap.clientHeight));}
  function calculateWorkspaceFitScale(page){
    const wrap=el("pdfStudioCanvasWrap");if(!wrap||!page)return 1;
    const style=getComputedStyle(wrap),horizontal=(parseFloat(style.paddingLeft)||0)+(parseFloat(style.paddingRight)||0),vertical=(parseFloat(style.paddingTop)||0)+(parseFloat(style.paddingBottom)||0);
    const availableWidth=Math.max(80,wrap.clientWidth-horizontal-4),availableHeight=Math.max(80,wrap.clientHeight-vertical-4);
    return Math.max(.05,Math.min(availableWidth/page.width,availableHeight/page.height));
  }
  function bindWorkspaceResize(){
    const wrap=el("pdfStudioCanvasWrap");if(!wrap||wrap.dataset.resizeBound)return;wrap.dataset.resizeBound="1";
    const rerender=()=>{clearTimeout(state.workspaceResizeTimer);state.workspaceResizeTimer=setTimeout(()=>{if(el("view-utilitiesPdfStudio")?.classList.contains("active")){state.centerAfterRender=true;renderCanvas();}},80)};
    if(window.ResizeObserver){state.workspaceObserver=new ResizeObserver(rerender);state.workspaceObserver.observe(wrap)}else window.addEventListener("resize",rerender);
  }
  let liveThumbnailTimer=null;
  function scheduleLiveThumbnail(){
    clearTimeout(liveThumbnailTimer);liveThumbnailTimer=setTimeout(()=>{const page=currentPage(),thumb=el(`pdfThumb${state.selectedPage}`);if(page&&thumb?.isConnected)renderPageToCanvas(page,thumb,Math.min(140/page.width,170/page.height),false,state.selectedPage);},90);
  }
  function updatePageRulers(page,canvas){
    const top=el("pdfStudioRulerTop"),left=el("pdfStudioRulerLeft");if(!top||!left)return;const tick=Math.max(12,(72/25.4)*10*state.renderScale);top.style.width=canvas.width+"px";top.style.setProperty("--ruler-tick",tick+"px");left.style.height=canvas.height+"px";left.style.setProperty("--ruler-tick",tick+"px");top.querySelector("span").textContent=`${(page.width*25.4/72).toFixed(0)} mm`;left.querySelector("span").textContent=`${(page.height*25.4/72).toFixed(0)} mm`;}
  async function renderPageToCanvas(page,canvas,scale,selection,pageIndex){
    if(!canvas)return;const token=(Number(canvas.dataset.pdfRenderToken)||0)+1;canvas.dataset.pdfRenderToken=String(token);const previousTask=canvas._pdfRenderTask;if(previousTask){try{previousTask.cancel();await previousTask.promise}catch(e){}if(token!==Number(canvas.dataset.pdfRenderToken))return;}
    canvas.width=Math.max(1,Math.round(page.width*scale));canvas.height=Math.max(1,Math.round(page.height*scale));const ctx=canvas.getContext("2d");ctx.save();ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.restore();
    if(page.sourceId){try{const source=state.sources.get(page.sourceId);const pdfPage=await source?.pdfjs?.getPage(page.pageNo+1);if(pdfPage){const viewport=pdfPage.getViewport({scale}),task=pdfPage.render({canvasContext:ctx,viewport});canvas._pdfRenderTask=task;await task.promise;if(canvas._pdfRenderTask===task)canvas._pdfRenderTask=null;}}catch(e){if(e?.name!=="RenderingCancelledException"){ctx.fillStyle="#fee2e2";ctx.fillRect(0,0,canvas.width,canvas.height);}}}
    if(token!==Number(canvas.dataset.pdfRenderToken))return;
    for(const obj of page.objects) await drawCanvasObject(ctx,obj,scale,pageIndex);
    if(selection){const o=currentObject();if(o){ctx.save();ctx.strokeStyle="#0ea5e9";ctx.lineWidth=1.5;ctx.setLineDash([5,3]);ctx.strokeRect(o.x*scale,o.y*scale,o.w*scale,o.h*scale);ctx.setLineDash([]);ctx.fillStyle="#0ea5e9";ctx.fillRect((o.x+o.w)*scale-5,(o.y+o.h)*scale-5,10,10);ctx.restore();}}
  }
  async function drawCanvasObject(ctx,o,s,pageIndex){
    ctx.save();ctx.globalAlpha=Math.max(.05,Math.min(1,Number(o.opacity)||1));ctx.translate((o.x+o.w/2)*s,(o.y+o.h/2)*s);ctx.rotate((Number(o.rotation)||0)*Math.PI/180);ctx.translate(-(o.x+o.w/2)*s,-(o.y+o.h/2)*s);
    if(o.type==="text"){ctx.fillStyle=o.color||"#111827";ctx.font=`${/Bold/.test(o.fontFamily)?"700 ":""}${(o.fontSize||14)*s}px ${/Times/.test(o.fontFamily)?"Georgia":/Courier/.test(o.fontFamily)?"monospace":"Arial"}`;ctx.textBaseline="top";const text=tokenText(o.text,pageIndex),lines=wrapCanvasText(ctx,text,o.w*s);const lh=(o.fontSize||14)*1.22*s;lines.forEach((line,i)=>{let x=o.x*s;if(o.align==="center")x+=(o.w*s-ctx.measureText(line).width)/2;else if(o.align==="right")x+=o.w*s-ctx.measureText(line).width;ctx.fillText(line,x,o.y*s+i*lh)});
    }else if(o.type==="image"){try{const img=await loadImage(o.dataUrl);ctx.drawImage(img,o.x*s,o.y*s,o.w*s,o.h*s)}catch(e){}
    }else if(o.type==="rect"){ctx.fillStyle=o.fillColor||"transparent";ctx.strokeStyle=o.strokeColor||o.color;ctx.lineWidth=(o.strokeWidth||1)*s;ctx.fillRect(o.x*s,o.y*s,o.w*s,o.h*s);ctx.strokeRect(o.x*s,o.y*s,o.w*s,o.h*s);
    }else if(o.type==="line"){ctx.strokeStyle=o.strokeColor||o.color;ctx.lineWidth=Math.max(1,(o.strokeWidth||2)*s);ctx.beginPath();ctx.moveTo(o.x*s,o.y*s);ctx.lineTo((o.x+o.w)*s,(o.y+o.h)*s);ctx.stroke();}ctx.restore();
  }
  function tokenText(text,pageIndex){return String(text||"").replaceAll("{{page}}",String(pageIndex+1)).replaceAll("{{pages}}",String(state.pages.length)).replaceAll("{{date}}",new Date().toLocaleDateString("en-IN"));}
  function wrapCanvasText(ctx,text,maxWidth){const out=[];String(text).split("\n").forEach(raw=>{const words=raw.split(/\s+/);let line="";words.forEach(w=>{const test=line?line+" "+w:w;if(ctx.measureText(test).width>maxWidth&&line){out.push(line);line=w}else line=test});out.push(line)});return out;}

  function renderInspector(){
    const o=currentObject(),panel=el("pdfObjectProperties");if(!panel)return;panel.style.display=o?"block":"none";
    if(el("pdfObjectEmpty"))el("pdfObjectEmpty").style.display=o?"none":"flex";
    if(el("pdfStudioDeleteObjectBtn"))el("pdfStudioDeleteObjectBtn").disabled=!o;
    if(!o){renderLayers();return;}
    const isText=o.type==="text";el("pdfObjText").parentElement.style.display=isText?"block":"none";el("pdfObjFont").closest(".grid-2").style.display=isText?"grid":"none";
    el("pdfObjText").value=o.text||"";el("pdfObjFont").value=o.fontFamily||"Helvetica";el("pdfObjFontSize").value=o.fontSize||14;el("pdfObjColorText").value=o.color||"#123b56";el("pdfObjColor").value=o.color||"#123b56";el("pdfObjOpacity").value=Math.round((o.opacity??1)*100);el("pdfObjRotation").value=o.rotation||0;el("pdfObjWidth").value=Math.round(o.w);el("pdfObjHeight").value=Math.round(o.h);renderLayers();
  }
  function renderLayers(){const box=el("pdfStudioLayers"),p=currentPage();if(!box)return;box.innerHTML=p?.objects.length?p.objects.slice().reverse().map(o=>`<div class="pdf-layer-row ${o.id===state.selectedObject?"active":""}" onclick="pdfStudioSelectObject('${o.id}')"><b>${o.type==="text"?"T":o.type==="image"?"▧":o.type==="line"?"╱":"□"}</b><span>${escapeHtml((o.text||o.type).slice(0,32))}</span></div>`).join(""):`<div style="font-size:11px;color:#94a3b8;">No objects on this page.</div>`;}
  function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function bindCanvas(){const canvas=el("pdfStudioCanvas");if(!canvas||canvas.dataset.bound)return;canvas.dataset.bound="1";canvas.addEventListener("pointerdown",e=>{const p=currentPage();if(!p)return;const scale=state.renderScale||1,r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)/scale,y=(e.clientY-r.top)/scale;const chosen=[...p.objects].reverse().find(o=>x>=o.x&&x<=o.x+o.w&&y>=o.y&&y<=o.y+o.h);state.selectedObject=chosen?.id||null;if(chosen){window.pdfStudioInspectorTab("object",true);checkpoint();const resize=Math.abs(x-(chosen.x+chosen.w))<12&&Math.abs(y-(chosen.y+chosen.h))<12;state.dragging={x,y,ox:chosen.x,oy:chosen.y,ow:chosen.w,oh:chosen.h,resize};canvas.setPointerCapture(e.pointerId)}renderInspector();renderCanvas()});canvas.addEventListener("pointermove",e=>{if(!state.dragging)return;const o=currentObject(),scale=state.renderScale||1,r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)/scale,y=(e.clientY-r.top)/scale,d=state.dragging;if(d.resize){o.w=Math.max(12,d.ow+x-d.x);o.h=Math.max(8,d.oh+y-d.y)}else{o.x=Math.max(0,Math.min(currentPage().width-o.w,d.ox+x-d.x));o.y=Math.max(0,Math.min(currentPage().height-o.h,d.oy+y-d.y))}renderCanvas()});canvas.addEventListener("pointerup",()=>{state.dragging=null;renderInspector()});}

  window.pdfStudioSaveProject=function(){
    return window.pdfStudioExport();
  };
  window.pdfStudioLoadProject=async function(file){if(!file)return;try{setStatus("Opening project…");const project=JSON.parse(await file.text());if(project.format!=="DEMOSOLAR_PDF_STUDIO")throw new Error("This is not a DemoSolar PDF Studio project.");state.sources.clear();for(const s of project.sources||[])await loadPdfSource(base64ToBytes(s.data),s.id);state.pages=project.pages||[];state.selectedPage=0;state.selectedObject=null;state.history=[];state.future=[];state.centerAfterRender=true;el("pdfDocFileName").value=project.document?.fileName||"DemoSolar-Document.pdf";el("pdfDocTitle").value=project.document?.title||"";renderAll();notify("Project Opened",`${state.pages.length} pages restored.`)}catch(e){notify("Cannot Open Project",e.message,"danger")}finally{el("pdfStudioProjectInput").value="";setStatus("Ready")}};

  window.pdfStudioExport=async function(){
    if(!state.pages.length){notify("Nothing to Export","Add at least one page.","danger");return;}
    try{
      setStatus("Building PDF on this device…");const bytes=await buildPdfBytes(),signature=String.fromCharCode(...bytes.slice(0,5));if(signature!=="%PDF-")throw new Error("The generated document is not a valid PDF file.");const fileName=safePdfName(el("pdfDocFileName")?.value);downloadBlob(new Blob([bytes],{type:"application/pdf"}),fileName);notify("PDF Exported",`${fileName} · ${state.pages.length} page${state.pages.length===1?"":"s"} created.`);setStatus("Export complete");
    }catch(e){console.error(e);notify("Export Failed",e.message||"The PDF could not be created.","danger");setStatus("Export failed");}
  };
  window.pdfStudioPrint=async function(){
    if(!state.pages.length){notify("Nothing to Print","Add at least one page.","danger");return;}try{setStatus("Preparing print preview…");const bytes=await buildPdfBytes(),url=URL.createObjectURL(new Blob([bytes],{type:"application/pdf"})),frame=document.createElement("iframe");frame.style.cssText="position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";frame.onload=()=>setTimeout(()=>{try{frame.contentWindow.focus();frame.contentWindow.print()}finally{setTimeout(()=>{URL.revokeObjectURL(url);frame.remove()},60000)}},500);frame.src=url;document.body.appendChild(frame);setStatus("Print dialog opened");}catch(e){console.error(e);notify("Print Failed",e.message||"The print preview could not be prepared.","danger");setStatus("Print failed");}
  };
  async function buildPdfBytes(){
      const out=await PDFLib.PDFDocument.create();const loaded=new Map(),fontCache=new Map(),imageCache=new Map();
      for(const [id,s] of state.sources) loaded.set(id,await PDFLib.PDFDocument.load(s.bytes,{updateMetadata:false}));
      for(let pi=0;pi<state.pages.length;pi++){
        const model=state.pages[pi];let page;if(model.sourceId){const copied=await out.copyPages(loaded.get(model.sourceId),[model.pageNo]);page=out.addPage(copied[0]);const original=page.getSize();if(Math.abs(original.width-model.width)>.1||Math.abs(original.height-model.height)>.1){const sx=model.width/original.width,sy=model.height/original.height;page.scaleContent(sx,sy);page.scaleAnnotations(sx,sy);page.setSize(model.width,model.height)}}else page=out.addPage([model.width,model.height]);
        const baseAngle=page.getRotation()?.angle||0;page.setRotation(PDFLib.degrees((baseAngle+model.rotation)%360));
        for(const o of model.objects) await drawPdfObject(out,page,o,pi,fontCache,imageCache,model);
      }
      out.setTitle(el("pdfDocTitle")?.value||"DemoSolar Document");out.setAuthor(el("pdfDocAuthor")?.value||"DemoSolar Industries Pvt. Ltd.");out.setCreator("DemoSolar ERP PDF Studio");out.setProducer("DemoSolar ERP in-browser PDF engine");out.setCreationDate(new Date());out.setModificationDate(new Date());
      return out.save({useObjectStreams:true,addDefaultPage:false});
  }
  async function drawPdfObject(doc,page,o,pageIndex,fontCache,imageCache,model){
    const opacity=Math.max(.05,Math.min(1,Number(o.opacity)||1)),rotation=PDFLib.degrees(Number(o.rotation)||0);
    if(o.type==="text"){
      const fontName=PDFLib.StandardFonts[o.fontFamily]||PDFLib.StandardFonts.Helvetica;if(!fontCache.has(fontName))fontCache.set(fontName,await doc.embedFont(fontName));const font=fontCache.get(fontName),size=Number(o.fontSize)||14,color=hexRgb(o.color),text=tokenText(o.text,pageIndex);const lines=wrapPdfText(text,font,size,o.w);let y=model.height-o.y-size;
      lines.forEach((line,i)=>{let x=o.x;const tw=font.widthOfTextAtSize(line,size);if(o.align==="center")x+=(o.w-tw)/2;else if(o.align==="right")x+=o.w-tw;page.drawText(line,{x,y:y-i*size*1.22,size,font,color,opacity,rotate:rotation,maxWidth:o.w})});
    }else if(o.type==="image"){
      let img=imageCache.get(o.dataUrl);if(!img){const bytes=dataUrlBytes(o.dataUrl);img=o.dataUrl.startsWith("data:image/png")?await doc.embedPng(bytes):await doc.embedJpg(bytes);imageCache.set(o.dataUrl,img)}page.drawImage(img,{x:o.x,y:model.height-o.y-o.h,width:o.w,height:o.h,opacity,rotate:rotation});
    }else if(o.type==="rect"){page.drawRectangle({x:o.x,y:model.height-o.y-o.h,width:o.w,height:o.h,color:hexRgb(o.fillColor),borderColor:hexRgb(o.strokeColor),borderWidth:Number(o.strokeWidth)||1,opacity,borderOpacity:opacity,rotate:rotation});
    }else if(o.type==="line"){page.drawLine({start:{x:o.x,y:model.height-o.y},end:{x:o.x+o.w,y:model.height-o.y-o.h},thickness:Number(o.strokeWidth)||2,color:hexRgb(o.strokeColor),opacity});}
  }
  function wrapPdfText(text,font,size,max){const lines=[];String(text).split("\n").forEach(raw=>{let line="";raw.split(/\s+/).forEach(w=>{const t=line?line+" "+w:w;if(font.widthOfTextAtSize(t,size)>max&&line){lines.push(line);line=w}else line=t});lines.push(line)});return lines;}
  function hexRgb(hex){let h=String(hex||"#000000").replace("#","");if(h.length===3)h=h.split("").map(c=>c+c).join("");return PDFLib.rgb(parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4,6),16)/255);}

  window.pdfStudioOpenDsc=function(){
    dscP12Bytes=null;dscCertificate=null;
    const audit=readDscAudit().slice(0,5).map(row=>`<div style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:11px;"><b>${escapeHtml(row.subject)}</b><br><span style="color:#64748b;">${escapeHtml(row.fileName)} · ${escapeHtml(row.signedAt)}</span></div>`).join("")||`<div style="font-size:11px;color:#94a3b8;">No PDFs signed on this browser yet.</div>`;
    openModal("Certificate-based DSC Signing",`<div style="padding:11px 13px;margin-bottom:14px;border:1px solid #a7f3d0;border-radius:10px;background:#ecfdf5;color:#065f46;font-size:11px;line-height:1.55;"><b>Private and local:</b> the certificate, password and private key stay inside this browser tab. They are never stored in ERP or uploaded to the server.</div><div class="grid-2"><div class="form-group"><label>Organisation certificate (.p12 / .pfx) *</label><input id="pdfDscFile" type="file" accept=".p12,.pfx,application/x-pkcs12" onchange="pdfDscReadFile(this.files[0])"></div><div class="form-group"><label>Certificate password / PIN *</label><input id="pdfDscPassword" type="password" autocomplete="off" placeholder="Used only for this signing action" oninput="pdfDscCertificateChanged()"></div></div><div class="utility-action-row" style="margin-bottom:12px;"><button class="btn btn-secondary" onclick="pdfDscInspectCertificate()">🔍 Validate Certificate</button></div><div id="pdfDscCertificateInfo" style="display:none;padding:12px;margin-bottom:14px;border:1px solid #dbe6ed;border-radius:10px;background:#f8fafc;font-size:11px;line-height:1.65;"></div><div class="grid-2"><div class="form-group"><label>Signing reason</label><input id="pdfDscReason" value="Approved and digitally signed"></div><div class="form-group"><label>Signing location</label><input id="pdfDscLocation" value="India"></div></div><div class="grid-2"><div class="form-group"><label>Contact / department</label><input id="pdfDscContact" value="DemoSolar Industries Pvt. Ltd."></div><div class="form-group"><label>Signature page</label><select id="pdfDscPage">${state.pages.map((_,i)=>`<option value="${i}" ${i===state.selectedPage?"selected":""}>Page ${i+1}</option>`).join("")}</select></div></div><label style="display:flex;gap:8px;align-items:flex-start;font-size:11px;color:#475569;margin:4px 0 14px;"><input id="pdfDscVisible" type="checkbox" checked style="width:auto;margin-top:2px;">Add a visible certificate block to the selected page before applying the cryptographic signature</label><details><summary style="cursor:pointer;font-size:11px;font-weight:800;color:#334155;">Recent signing audit on this device</summary><div>${audit}</div></details>`,[{label:"Digitally Sign & Download",className:"btn btn-success",action:applyDscSignature}]);
  };
  window.pdfDscReadFile=async function(file){dscCertificate=null;dscP12Bytes=file?new Uint8Array(await file.arrayBuffer()):null;const box=el("pdfDscCertificateInfo");if(box){box.style.display="block";box.innerHTML=dscP12Bytes?`Certificate loaded locally. Enter its password and click <b>Validate Certificate</b>.`:"Choose a certificate file.";}};
  window.pdfDscCertificateChanged=function(){dscCertificate=null;const box=el("pdfDscCertificateInfo");if(box){box.style.display="none";box.innerHTML="";}};
  window.pdfDscInspectCertificate=async function(){
    const box=el("pdfDscCertificateInfo");if(!dscP12Bytes){notify("Certificate Required","Choose a .p12 or .pfx certificate first.","danger");return;}try{box.style.display="block";box.textContent="Validating certificate locally…";dscCertificate=window.DemoSolarPdfDsc.inspectP12(dscP12Bytes,el("pdfDscPassword").value);const status=dscCertificate.expired?"EXPIRED":dscCertificate.notYetValid?"NOT YET VALID":"VALID";box.innerHTML=`<b style="color:${status==="VALID"?"#047857":"#b91c1c"};">${status}</b><br><b>Holder:</b> ${escapeHtml(dscCertificate.subject)}<br><b>Issuer:</b> ${escapeHtml(dscCertificate.issuer)}<br><b>Valid:</b> ${new Date(dscCertificate.validFrom).toLocaleDateString("en-IN")} to ${new Date(dscCertificate.validTo).toLocaleDateString("en-IN")}<br><b>Serial:</b> ${escapeHtml(dscCertificate.serialNumber)}<br><b>SHA-256:</b> <span style="word-break:break-all;">${escapeHtml(dscCertificate.fingerprint)}</span>`;}catch(e){dscCertificate=null;box.style.display="block";box.innerHTML=`<b style="color:#b91c1c;">Certificate could not be opened.</b><br>${escapeHtml(dscErrorMessage(e))}`;}
  };
  async function applyDscSignature(){
    if(!dscP12Bytes){notify("Certificate Required","Choose your .p12 or .pfx signing certificate.","danger");return;}if(!dscCertificate)await window.pdfDscInspectCertificate();if(!dscCertificate)return;if(dscCertificate.expired||dscCertificate.notYetValid){notify("Certificate Not Valid","The selected certificate is outside its validity period.","danger");return;}
    const password=el("pdfDscPassword").value,pageIndex=Number(el("pdfDscPage").value)||0,reason=el("pdfDscReason").value.trim()||"Digitally signed",location=el("pdfDscLocation").value.trim()||"India",contactInfo=el("pdfDscContact").value.trim()||"DemoSolar Industries Pvt. Ltd.";
    try{
      setStatus("Applying certificate-based digital signature…");
      if(el("pdfDscVisible").checked){checkpoint();const p=state.pages[pageIndex],text=`DIGITALLY SIGNED\n${dscCertificate.subject}\n${new Date().toLocaleString("en-IN")} · ${reason}`;p.objects.push({id:uid("object"),type:"text",x:Math.max(30,p.width-255),y:Math.max(30,p.height-92),w:225,h:58,text,fontFamily:"HelveticaBold",fontSize:8,color:"#047857",opacity:1,rotation:0});renderAll();}
      const unsigned=await buildPdfBytes();const signed=await window.DemoSolarPdfDsc.signP12(unsigned,dscP12Bytes,password,{name:dscCertificate.subject,reason,location,contactInfo,pageIndex,signatureLength:24576});const fileName=fileStem(el("pdfDocFileName")?.value)+"-digitally-signed.pdf";downloadBlob(new Blob([signed],{type:"application/pdf"}),fileName);writeDscAudit({fileName,subject:dscCertificate.subject,issuer:dscCertificate.issuer,fingerprint:dscCertificate.fingerprint,reason,signedAt:new Date().toLocaleString("en-IN")});el("pdfDscPassword").value="";dscP12Bytes=null;dscCertificate=null;closeModal();notify("PDF Digitally Signed","A certificate-based PAdES/CMS signature was applied locally. Open the downloaded PDF in Adobe Acrobat to inspect the signature and trust chain.");setStatus("Digital signature complete");
    }catch(e){console.error(e);notify("Digital Signing Failed",dscErrorMessage(e),"danger");setStatus("Digital signing failed");}
  }
  function dscErrorMessage(error){const raw=String(error?.message||error||"");if(/password|mac could not be verified|pkcs12/i.test(raw))return"The certificate password is incorrect, or this certificate format is not supported.";if(/signature exceeds/i.test(raw))return"The certificate chain is larger than the reserved signature space. Contact IT to increase the DSC signature placeholder.";return raw||"The certificate could not sign this PDF.";}
  function readDscAudit(){try{return JSON.parse(localStorage.getItem("demosolarPdfDscAudit")||"[]")}catch(e){return[]}}
  function writeDscAudit(row){const rows=[row,...readDscAudit()].slice(0,25);localStorage.setItem("demosolarPdfDscAudit",JSON.stringify(rows));}

  function openModal(title,content,buttons=[]){el("pdfStudioModalTitle").textContent=title;el("pdfStudioModalContent").innerHTML=content;el("pdfStudioModalFooter").innerHTML="";buttons.forEach(b=>{const x=document.createElement("button");x.className=b.className||"btn btn-primary";x.textContent=b.label;x.onclick=b.action;el("pdfStudioModalFooter").appendChild(x)});el("pdfStudioModal").classList.add("open");}
  function closeModal(){el("pdfStudioModal")?.classList.remove("open");}
  window.pdfStudioCloseModal=function(){ closeModal(); };
  function setStatus(v){if(el("pdfStudioStatus"))el("pdfStudioStatus").textContent=v;}
  function readDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)})}
  function loadImage(src){if(state.imageCache.has(src))return state.imageCache.get(src);const p=new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=src});state.imageCache.set(src,p);return p;}
  function downloadBlob(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1500)}
  function safePdfName(name){const cleaned=String(name||"DemoSolar-Document").trim().replace(/[\\/:*?"<>|]+/g,"-").replace(/\.[^.]+$/,""),stem=cleaned.replace(/[. ]+$/g,"")||"DemoSolar-Document";return stem+".pdf";}
  function fileStem(name){return safePdfName(name).replace(/\.pdf$/i,"");}
  function bytesToBase64(bytes){let out="";const step=32768;for(let i=0;i<bytes.length;i+=step)out+=String.fromCharCode(...bytes.subarray(i,i+step));return btoa(out)}
  function base64ToBytes(v){const b=atob(v),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u}
  function dataUrlBytes(v){return base64ToBytes(String(v).split(",")[1]||"")}

  window.utilityLoadImage=async function(file){
    if(!file)return;try{quickImageFile=file;quickImage=await loadImage(await readDataUrl(file));quickImageResult=null;el("utilityImageWidth").value=quickImage.naturalWidth;el("utilityImageHeight").value=quickImage.naturalHeight;el("utilityImageOriginalInfo").innerHTML=`<span>ORIGINAL</span><b>${escapeHtml(file.name)}</b><em>${quickImage.naturalWidth.toLocaleString("en-IN")} × ${quickImage.naturalHeight.toLocaleString("en-IN")} px · ${formatBytes(file.size)}</em>`;await window.utilityPreviewImage();}catch(e){notify("Cannot Open Image",e.message||"Choose a valid PNG, JPG or WebP image.","danger")}
  };
  window.utilityImageDimensionChanged=function(axis){
    if(!quickImage)return;if(el("utilityImageLockRatio").checked){const ratio=quickImage.naturalWidth/quickImage.naturalHeight;if(axis==="width")el("utilityImageHeight").value=Math.max(1,Math.round((Number(el("utilityImageWidth").value)||1)/ratio));else el("utilityImageWidth").value=Math.max(1,Math.round((Number(el("utilityImageHeight").value)||1)*ratio));}window.utilityScheduleImagePreview();
  };
  window.utilitySetImageTarget=function(kb){el("utilityImageTargetKb").value=kb;window.utilityScheduleImagePreview();};
  window.utilityScheduleImagePreview=function(){quickImageResult=null;if(el("utilityImageDownloadBtn"))el("utilityImageDownloadBtn").disabled=true;clearTimeout(quickImagePreviewTimer);quickImagePreviewTimer=setTimeout(()=>window.utilityPreviewImage(),260);};
  window.utilityPreviewImage=async function(){
    if(!quickImage)return;const job=++quickImageJob,resultBox=el("utilityImageResultInfo"),preview=el("utilityImagePreview"),button=el("utilityImageDownloadBtn");button.disabled=true;resultBox.innerHTML=`<span>OPTIMIZING</span><b>Creating live preview…</b>`;
    try{const result=await optimizeUtilityImage();if(job!==quickImageJob)return;quickImageResult=result;if(quickImagePreviewUrl)URL.revokeObjectURL(quickImagePreviewUrl);quickImagePreviewUrl=URL.createObjectURL(result.blob);preview.innerHTML=`<img src="${quickImagePreviewUrl}" alt="Optimized image preview">`;const saved=quickImageFile?.size?Math.max(0,Math.round((1-result.blob.size/quickImageFile.size)*100)):0;resultBox.innerHTML=`<span>ESTIMATED OUTPUT</span><b>${formatBytes(result.blob.size)} · ${result.width.toLocaleString("en-IN")} × ${result.height.toLocaleString("en-IN")} px</b><em>${saved>0?`${saved}% smaller · `:""}${Math.round(result.quality*100)}% effective quality</em>`;button.disabled=false;}catch(e){if(job!==quickImageJob)return;resultBox.innerHTML=`<span>PREVIEW ERROR</span><b>${escapeHtml(e.message||"Unable to optimize image")}</b>`;}
  };
  async function optimizeUtilityImage(){
    let maxW=Math.max(1,Math.round(Number(el("utilityImageWidth").value)||quickImage.naturalWidth)),maxH=Math.max(1,Math.round(Number(el("utilityImageHeight").value)||quickImage.naturalHeight));const allowUpscale=el("utilityImageAllowUpscale").checked,mode=el("utilityImageResizeMode").value,type=el("utilityImageFormat").value,target=Math.max(0,Number(el("utilityImageTargetKb").value)||0)*1024,startQuality=Math.max(.1,Math.min(1,Number(el("utilityImageQuality").value)/100));
    let width=maxW,height=maxH;if(mode==="fit"){let scale=Math.min(maxW/quickImage.naturalWidth,maxH/quickImage.naturalHeight);if(!allowUpscale)scale=Math.min(1,scale);width=Math.max(1,Math.round(quickImage.naturalWidth*scale));height=Math.max(1,Math.round(quickImage.naturalHeight*scale));}else if(!allowUpscale){width=Math.min(width,quickImage.naturalWidth);height=Math.min(height,quickImage.naturalHeight);}
    let best=await encodeUtilityImage(width,height,type,startQuality),quality=startQuality;if(target>0&&best.blob.size>target){for(let round=0;round<9&&best.blob.size>target;round++){if(type!=="image/png"){let low=.05,high=quality,candidate=null;for(let i=0;i<7;i++){const q=(low+high)/2,test=await encodeUtilityImage(width,height,type,q);if(test.blob.size<=target){candidate=test;low=q}else high=q}if(candidate){best=candidate;quality=low;break;}quality=.06;best=await encodeUtilityImage(width,height,type,quality);}const factor=Math.max(.55,Math.min(.92,Math.sqrt(target/Math.max(1,best.blob.size))*.96));width=Math.max(32,Math.round(width*factor));height=Math.max(32,Math.round(height*factor));best=await encodeUtilityImage(width,height,type,type==="image/png"?1:quality);}}
    return {...best,quality};
  }
  function encodeUtilityImage(width,height,type,quality){return new Promise((resolve,reject)=>{const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;const ctx=canvas.getContext("2d",{alpha:type!=="image/jpeg"});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";if(type==="image/jpeg"){ctx.fillStyle="#fff";ctx.fillRect(0,0,width,height)}ctx.drawImage(quickImage,0,0,width,height);canvas.toBlob(blob=>blob?resolve({blob,width,height}):reject(new Error("This browser could not encode the selected format.")),type,quality)});}
  window.utilityExportImage=async function(){if(!quickImage){notify("Choose an Image","Select an image first.","danger");return;}if(!quickImageResult)await window.utilityPreviewImage();if(!quickImageResult)return;const type=el("utilityImageFormat").value,ext=type.split("/")[1].replace("jpeg","jpg"),base=String(quickImageFile?.name||"image").replace(/\.[^.]+$/,"").replace(/[\\/:*?"<>|]+/g,"-");downloadBlob(quickImageResult.blob,`${base}-optimized-${quickImageResult.width}x${quickImageResult.height}.${ext}`);};
  function formatBytes(bytes){if(bytes<1024)return `${bytes} B`;if(bytes<1048576)return `${(bytes/1024).toFixed(bytes<10240?1:0)} KB`;return `${(bytes/1048576).toFixed(2)} MB`;}
  window.utilityGenerateCode=function(){const value=el("utilityCodeValue").value.trim();if(!value){notify("Enter a Value","Add the text or number to encode.","danger");return;}const type=el("utilityCodeType").value,canvas=el("utilityCodeCanvas"),preview=el("utilityCodePreview");preview.innerHTML="";preview.appendChild(canvas);try{if(type==="QR"){const qr=qrcode(0,"M");qr.addData(value);qr.make();const count=qr.getModuleCount(),cell=Math.max(3,Math.floor(240/count));canvas.width=canvas.height=count*cell+24;const ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle="#0b5274";for(let r=0;r<count;r++)for(let c=0;c<count;c++)if(qr.isDark(r,c))ctx.fillRect(12+c*cell,12+r*cell,cell,cell)}else JsBarcode(canvas,value,{format:type,displayValue:true,text:el("utilityCodeCaption").value||value,lineColor:"#0b5274",background:"#ffffff",margin:16,height:90});}catch(e){notify("Cannot Generate Code",e.message,"danger")}};
  window.utilityDownloadCode=function(){const c=el("utilityCodeCanvas");if(!c?.width){notify("Generate First","Generate the code before downloading.","danger");return;}c.toBlob(b=>downloadBlob(b,"demosolar-code.png"),"image/png")};

  let savedDocumentFiles=[],savedDocumentRecords=[];
  function savedDocumentIcon(category){return ({pdf:"📕",images:"🖼️",excel:"📊",documents:"📘",presentations:"📽️",archives:"🗜️",engineering:"📐",other:"📎"})[category]||"📎";}
  function savedDocumentDate(value){const date=new Date(value);return Number.isNaN(date.getTime())?"—":date.toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});}
  async function savedDocumentRequest(action,options={}){const response=await erpFetchWithTimeout(`backend/api.php?action=${encodeURIComponent(action)}`,{credentials:"same-origin",cache:"no-store",...options},120000);const data=await response.json().catch(()=>({status:"error",message:"The server returned an invalid response."}));if(!response.ok||String(data.status).toLowerCase()!=="success")throw new Error(data.message||"Saved Documents request failed.");return data;}
  async function loadSavedDocuments(){const list=el("savedDocumentsList");if(!list)return;list.innerHTML='<div class="saved-doc-empty"><span>⏳</span><b>Loading your documents…</b></div>';try{const data=await savedDocumentRequest("saved_documents");savedDocumentRecords=Array.isArray(data.files)?data.files:[];if(el("savedDocumentsOwner"))el("savedDocumentsOwner").textContent=data.username||currentLoggedInUser?.username||"User";renderSavedDocuments();}catch(error){list.innerHTML=`<div class="saved-doc-empty error"><span>!</span><b>${escapeHtml(error.message)}</b><button class="btn btn-secondary" onclick="utilitiesSavedDocumentsActivate()">Try again</button></div>`;}}
  function renderSavedDocuments(){
    const list=el("savedDocumentsList");if(!list)return;const search=String(el("savedDocumentsSearch")?.value||"").trim().toLowerCase(),category=el("savedDocumentsCategory")?.value||"ALL";const records=savedDocumentRecords.filter(file=>(category==="ALL"||file.category===category)&&(!search||`${file.name} ${file.categoryLabel} ${file.extension}`.toLowerCase().includes(search)));
    const total=savedDocumentRecords.reduce((sum,file)=>sum+(Number(file.size)||0),0),categories=new Set(savedDocumentRecords.map(file=>file.category)).size;if(el("savedDocumentsTotal"))el("savedDocumentsTotal").textContent=savedDocumentRecords.length.toLocaleString("en-IN");if(el("savedDocumentsSize"))el("savedDocumentsSize").textContent=formatBytes(total);if(el("savedDocumentsTypes"))el("savedDocumentsTypes").textContent=categories.toLocaleString("en-IN");if(el("savedDocumentsResultCount"))el("savedDocumentsResultCount").textContent=`${records.length} of ${savedDocumentRecords.length} files`;
    if(!records.length){list.innerHTML=`<div class="saved-doc-empty"><span>🗂️</span><b>${savedDocumentRecords.length?"No files match the selected filters.":"Your private document library is empty."}</b><small>${savedDocumentRecords.length?"Change the search or file type.":"Choose or drop files above to save them securely."}</small></div>`;return;}
    list.innerHTML=records.map(file=>`<article class="saved-doc-row"><div class="saved-doc-file-icon ${escapeHtml(file.category)}">${savedDocumentIcon(file.category)}</div><div class="saved-doc-file-info"><b title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</b><span>${escapeHtml(file.categoryLabel)} · ${escapeHtml(file.extension)} · ${formatBytes(Number(file.size)||0)}</span><small>Saved ${savedDocumentDate(file.uploadedAt)}</small></div><div class="saved-doc-actions">${file.previewable?`<button class="btn btn-secondary" onclick="utilityPreviewSavedDocument('${file.id}')">Preview</button>`:""}<button class="btn btn-primary" onclick="utilityDownloadSavedDocument('${file.id}')">Download</button><button class="btn btn-danger" onclick="utilityDeleteSavedDocument('${file.id}')">Delete</button></div></article>`).join("");
  }
  window.utilityFilterSavedDocuments=function(){renderSavedDocuments();};
  window.utilityOpenSavedDocumentPicker=function(event){event?.stopPropagation();el("savedDocumentsFileInput")?.click();};
  window.utilityChooseSavedDocuments=function(files){const incoming=Array.from(files||[]);savedDocumentFiles=incoming.slice(0,10);const box=el("savedDocumentsQueue"),button=el("savedDocumentsUploadBtn");if(!box||!button)return;if(!savedDocumentFiles.length){box.innerHTML="";box.hidden=true;button.disabled=true;return;}box.hidden=false;button.disabled=false;box.innerHTML=`<div><b>${savedDocumentFiles.length} file${savedDocumentFiles.length===1?"":"s"} ready</b><span>${formatBytes(savedDocumentFiles.reduce((sum,file)=>sum+file.size,0))}</span></div><button type="button" onclick="utilityClearSavedDocumentQueue()">Clear</button>`;};
  window.utilityClearSavedDocumentQueue=function(){savedDocumentFiles=[];if(el("savedDocumentsFileInput"))el("savedDocumentsFileInput").value="";window.utilityChooseSavedDocuments([]);};
  window.utilityUploadSavedDocuments=async function(){if(!savedDocumentFiles.length){notify("Choose Files","Select at least one file to save.","danger");return;}const button=el("savedDocumentsUploadBtn"),form=new FormData();savedDocumentFiles.forEach(file=>form.append("files[]",file,file.name));const old=button.textContent;button.disabled=true;button.textContent="Saving…";try{const data=await savedDocumentRequest("saved_documents_upload",{method:"POST",body:form});window.utilityClearSavedDocumentQueue();notify("Documents Saved",data.rejected?.length?`${data.saved.length} saved; ${data.rejected.length} rejected.`:data.message||"Your files are ready.",data.rejected?.length?"warning":"success");await loadSavedDocuments();}catch(error){notify("Upload Failed",error.message,"danger");}finally{button.textContent=old;button.disabled=!savedDocumentFiles.length;}};
  function savedDocumentById(id){return savedDocumentRecords.find(file=>file.id===id);}
  window.utilityPreviewSavedDocument=function(id){const file=savedDocumentById(id);if(file?.previewable)window.open(file.previewUrl,"_blank","noopener,noreferrer");};
  window.utilityDownloadSavedDocument=function(id){const file=savedDocumentById(id);if(!file)return;const anchor=document.createElement("a");anchor.href=file.downloadUrl;anchor.download=file.name;document.body.appendChild(anchor);anchor.click();anchor.remove();};
  window.utilityDeleteSavedDocument=async function(id){const file=savedDocumentById(id);if(!file||!confirm(`Delete "${file.name}" from your Saved Documents?`))return;try{await savedDocumentRequest("saved_document_delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});notify("Document Deleted",`${file.name} was removed.`);await loadSavedDocuments();}catch(error){notify("Delete Failed",error.message,"danger");}};
  function bindSavedDocumentDropzone(){const zone=el("savedDocumentsDropzone");if(!zone||zone.dataset.bound)return;zone.dataset.bound="1";["dragenter","dragover"].forEach(type=>zone.addEventListener(type,event=>{event.preventDefault();zone.classList.add("dragging")}));["dragleave","drop"].forEach(type=>zone.addEventListener(type,event=>{event.preventDefault();zone.classList.remove("dragging")}));zone.addEventListener("drop",event=>window.utilityChooseSavedDocuments(event.dataTransfer?.files));}

  document.addEventListener("keydown",e=>{if(!el("view-utilitiesPdfStudio")?.classList.contains("active"))return;const input=/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();e.shiftKey?window.pdfStudioRedo():window.pdfStudioUndo()}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){e.preventDefault();window.pdfStudioRedo()}else if(!input&&(e.key==="Delete"||e.key==="Backspace")){e.preventDefault();window.pdfStudioDeleteSelected()}else if(!input&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="d"){e.preventDefault();window.pdfStudioDuplicateSelected()}});
})();
