(function(){
  const definitions={
    jsbarcode:{url:"https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js",ready:()=>typeof window.JsBarcode==="function"},
    xlsx:{url:"https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",ready:()=>Boolean(window.XLSX)},
    jspdf:{url:"https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",ready:()=>Boolean(window.jspdf?.jsPDF)},
    html2canvas:{url:"https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",ready:()=>typeof window.html2canvas==="function"},
    pdfjs:{url:"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",ready:()=>Boolean(window.pdfjsLib)},
    exceljs:{url:"assets/exceljs.min.js?v=4.4.0",ready:()=>Boolean(window.ExcelJS)},
    pdflib:{url:"assets/pdf-lib.min.js?v=1.17.1",ready:()=>Boolean(window.PDFLib)},
    dsc:{url:"assets/pdf-dsc-engine.min.js?v=20261024-dsc-v1",ready:()=>Boolean(window.DemoSolarPdfDsc)},
    hls:{url:"assets/hls.min.js?v=1.7.3",ready:()=>Boolean(window.Hls)},
    qrcode:{url:"assets/qrcode-generator.min.js?v=20261016-nfc-v2",ready:()=>typeof window.qrcode==="function"}
  };
  const pending=new Map();
  window.ensureErpLibrary=function(name){
    const definition=definitions[name];
    if(!definition)return Promise.reject(new Error(`Unknown ERP library: ${name}`));
    if(definition.ready())return Promise.resolve();
    if(pending.has(name))return pending.get(name);
    const promise=new Promise((resolve,reject)=>{
      const script=document.createElement("script");script.src=definition.url;script.async=true;script.dataset.erpLibrary=name;
      script.onload=()=>definition.ready()?resolve():reject(new Error(`${name} loaded without its expected API.`));
      script.onerror=()=>reject(new Error(`${name} could not be loaded.`));document.head.appendChild(script);
    }).finally(()=>pending.delete(name));
    pending.set(name,promise);return promise;
  };
  window.ensureErpLibraries=names=>Promise.all([...new Set(names||[])].map(window.ensureErpLibrary));
  window.ensureErpLibrariesForView=function(viewId){
    const view=String(viewId||"");let names=[];
    if(view.startsWith("cctv"))names=["hls"];
    else if(view==="utilitiesPdfStudio")names=["pdflib","pdfjs","dsc"];
    else if(view==="utilitiesCodeMaker"||view==="adminNfcCards")names=["qrcode","jsbarcode"];
    else if(view.startsWith("packing"))names=["jsbarcode","xlsx","exceljs","jspdf","html2canvas"];
    else if(view.startsWith("dispatch"))names=["exceljs","jspdf","html2canvas"];
    else if(view.startsWith("store"))names=["xlsx","jspdf"];
    else if(view.startsWith("reports")||view.startsWith("accounts"))names=["exceljs","jspdf","html2canvas"];
    else if(view.startsWith("purchaseOrder"))names=["jspdf","html2canvas","pdfjs"];
    else if(view.startsWith("hrTour"))names=["xlsx"];
    return window.ensureErpLibraries(names);
  };
  window.warmErpLibrariesForUser=function(user){
    const role=String(user?.role||"").toLowerCase();let names=[];
    if(role==="admin")names=["exceljs","jspdf","html2canvas"];
    else if(role==="packing")names=["jsbarcode","exceljs"];
    else if(role==="store")names=["xlsx"];
    else if(role==="accounts")names=["exceljs","jspdf","html2canvas"];
    else if(role==="dispatch")names=["exceljs","jspdf","html2canvas"];
    else if(role==="sales")names=["exceljs","jspdf"];
    else if(role==="purchase")names=["jspdf","html2canvas","pdfjs"];
    const warm=()=>window.ensureErpLibraries(names).catch(error=>console.warn("Optional ERP libraries deferred:",error));
    if(names.length)(window.requestIdleCallback?window.requestIdleCallback(warm,{timeout:6000}):window.setTimeout(warm,4000));
  };
})();
