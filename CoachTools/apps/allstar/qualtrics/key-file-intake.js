/* The worker and cooperative fallback use the same parser and header mapping. */
(function(root){
  'use strict';
  function createKeyReader(){
    const key=value=>String(value??'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const names=['Agent Name','Associate Name','Representative Name','Representative','Rep Name','Rep','Agent','CSR Name','SSR Name','Name'];
    const slots={
      qa:{label:'90 Day Evals / QA',hint:/\bqa\b|90.day|evaluation/i,fields:['Score %','Score Pct','QA Score','Call Quality','Average Score','Score']},
      coaching:{label:'Documented Coaching',hint:/documented|coaching/i,fields:['Coaching Date','Documented Coaching Date','Coaching Type','Coaching Type-Multi']},
      checklist:{label:'Checklist / Correctives',hint:/checklist|corrective/i,fields:['Incident','Incident Type','Incident Date','Corrective Type','Corrective Action','Discipline Type']},
      weeklyStats:{label:'Weekly Stats',hint:/weekly|stats/i,fields:['Date Column','Weekly Stats Date','Week Start Date','Week Starting','Week Start','Week Ending','Week End','Week Of','Week','Consumer Appointments','Consumer Opportunities','Cash Appointment Rate']}
    };
    function inspect(rows,name,fileName){
      let best=-1,index=0;
      rows.forEach((row,i)=>{
        const fields=row.map(key);
        const score=(fields.some(h=>names.some(n=>key(n)===h))?1000:0)+Object.values(slots).filter(slot=>slot.fields.some(h=>fields.includes(key(h)))).length*100+Math.min(60,row.filter(v=>String(v??'').trim()).length);
        if(score>best){best=score;index=i;}
      });
      const seen=new Map();
      const headers=Array.from(rows[index]||[],(value,i)=>{
        const h=String(value??'').trim()||'Column '+(i+1), count=(seen.get(h)||0)+1;
        seen.set(h,count);return count===1?h:h+' ('+count+')';
      });
      const fields=headers.map(key),rep=headers.find(h=>names.some(n=>key(n)===key(h)));
      const evidence={};
      for(const [slot,rule] of Object.entries(slots)){
        const matched=headers.filter(h=>rule.fields.some(f=>key(f)===key(h)));
        const hint=rule.hint.test(fileName+' '+name);
        evidence[slot]={matched,hint,score:rep&&matched.length?Math.min(matched.length,3)+2+(hint?2:0):0};
      }
      const candidates=Object.keys(slots).filter(s=>evidence[s].score>0).sort((a,b)=>evidence[b].score-evidence[a].score);
      return {name,index,headers,representative:rep||'',evidence,candidates,sample:rows.slice(index+1,index+4)};
    }
    async function* textRows(file){
      const prefix=new Uint8Array(await file.slice(0,65536).arrayBuffer());
      const encoding=prefix[0]===255&&prefix[1]===254?'utf-16le':prefix[0]===254&&prefix[1]===255?'utf-16be':'utf-8';
      const head=new TextDecoder(encoding).decode(prefix);
      let commas=0,tabs=0,inQuote=false,lines=0;
      for(let i=0;i<head.length&&lines<8;i++){
        const c=head[i];
        if(c==='"'){if(inQuote&&head[i+1]==='"')i++;else inQuote=!inQuote;}
        else if(!inQuote){if(c===',')commas++;if(c==='\t')tabs++;if(c==='\n')lines++;}
      }
      const delim=/\.tsv$/i.test(file.name)||tabs>commas?'\t':',',decoder=new TextDecoder(encoding);
      let quoted=false,afterQuote=false,cell='',row=[],skipLF=false;
      for(let offset=0;offset<file.size;offset+=65536){
        const end=Math.min(file.size,offset+65536);
        const chunk=decoder.decode(await file.slice(offset,end).arrayBuffer(),{stream:end<file.size});
        for(const c of chunk){
          if(skipLF){skipLF=false;if(c==='\n')continue;}
          if(quoted){
            if(afterQuote){afterQuote=false;if(c==='"'){cell+='"';continue;}quoted=false;}
            else{if(c==='"')afterQuote=true;else cell+=c;continue;}
          }
          if(c==='"'&&!cell)quoted=true;
          else if(c===delim){row.push(cell);cell='';}
          else if(c==='\n'||c==='\r'){row.push(cell);yield row;row=[];cell='';skipLF=c==='\r';}
          else cell+=c;
        }
      }
      if(quoted&&!afterQuote)throw new Error('A quoted field is missing its closing quotation mark.');
      if(cell||row.length){row.push(cell);yield row;}
    }
    // Cache values only for complete, small sheets within one review. Long or
    // very wide sheets are reopened using the confirmed worksheet selection.
    const replay=new Map(),capacity=8*1024*1024;
    let retained=0;
    async function read(file,selection,emit,check,fileId=file){
      const discover=!selection,canRetain=discover&&file.size<=3*1024*1024&&retained<capacity;
      const saved=replay.get(fileId)||new Map();
      const uncached=selection?.filter(sheet=>!saved.has(sheet.name));
      const excel=/\.xlsx?$/i.test(file.name);
      const workbook=excel&&(discover||uncached?.length)?XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true,...(discover?{sheetRows:canRetain?1537:96}:{sheets:uncached.map(s=>s.name)})}):null;
      for(const name of discover?(workbook?.SheetNames||['text/csv']):selection.map(s=>s.name)){
        const selected=selection?.find(s=>s.name===name);
        if(!discover&&!selected)continue;
        async function* readSheet(){
          if(!discover&&saved.has(name)){yield* saved.get(name);return;}
          if(!workbook){yield* textRows(file);return;}
          const ws=workbook.Sheets[name];
          if(!ws?.['!ref'])return;
          const range=XLSX.utils.decode_range(ws['!ref']);
          for(let start=range.s.r;start<=range.e.r;start+=96){
            check();
            const sub={s:{r:start,c:range.s.c},e:{r:Math.min(start+95,range.e.r),c:range.e.c}};
            yield* XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:'',range:sub,blankrows:true});
          }
        }
        if(discover){
          const ws=workbook?.Sheets[name],ref=ws?.['!ref'];
          let cache=canRetain&&(!ws?.['!fullref']||ws['!fullref']===ref);
          if(cache&&ref){
            const {s,e}=XLSX.utils.decode_range(ref);
            cache=(e.r-s.r+1)*(e.c-s.c+1)*24<=capacity-retained;
          }
          const prefix=[],all=[];let used=0;
          for await(const row of readSheet()){
            if(prefix.length<96)prefix.push(row);
            if(cache){
              used+=row.reduce((n,v)=>n+24+2*String(v??'').length,48);
              if(used<=capacity-retained)all.push(row);else{cache=false;all.length=0;}
            }
            if(!cache&&prefix.length>=96)break;
          }
          if(cache){retained+=used;saved.set(name,all);replay.set(fileId,saved);}
          await emit({sheet:inspect(prefix,name,file.name)});continue;
        }
        let index=-1,rows=[],bytes=0,start=performance.now();
        for await(const cells of readSheet()){
          if(++index<=selected.index||!cells.some(v=>String(v??'').trim()))continue;
          const row=Object.fromEntries(selected.headers.map((h,i)=>[h,cells[i]??'']));
          rows.push(row);bytes+=cells.reduce((n,v)=>n+2*String(v??'').length,selected.headers.length*16);
          if(rows.length>=350||bytes>=192*1024||performance.now()-start>=12){await emit({name,rows});check();rows=[];bytes=0;start=performance.now();}
        }
        if(rows.length)await emit({name,rows});
      }
    }
    return {read,slots,inspect,textRows};
  }
  const reader=createKeyReader();
  const sessions=new WeakMap();
  let offlineLibrary;
  function spreadsheetLibrary(){
    try{
      const parent=window.parent;
      const source=parent.__ALLSTAR_IMPORT_WORKER_LIBRARIES__?.xlsx||parent.document.querySelector('script[data-allstar-vendor="xlsx.full.min.js"]')?.textContent;
      if(source)return Promise.resolve({source});
    }catch{}
    const url=document.querySelector('script[src*="xlsx.full.min.js"]')?.src;
    if(url&&!url.startsWith('file:'))return Promise.resolve({url});
    if(!offlineLibrary){
      offlineLibrary=new Promise(resolve=>{
        const script=document.createElement('script');script.src=new URL('../js/import-worker-source.js',document.baseURI).href;
        script.onload=()=>{script.remove();resolve({source:window.__ALLSTAR_IMPORT_WORKER_LIBRARIES__?.xlsx});};
        script.onerror=()=>{script.remove();resolve({});};document.head.append(script);
      });
    }
    return offlineLibrary;
  }
  function workerMain(){
    const reader=createKeyReader();
    let ack;
    self.onmessage=async({data})=>{
      if(data.ack){ack?.();return;}
      if(data.library&&!self.XLSX){
        try{importScripts(data.library);}catch{self.postMessage({unsupported:true});return;}
      }
      try{
        await reader.read(data.file,data.selected,chunk=>new Promise(resolve=>{ack=resolve;self.postMessage({chunk});}),()=>{},data.fileId);
        self.postMessage({done:true});
      }catch(error){self.postMessage({error:error.message});}
    };
  }
  function dispose(session){
    session.worker?.terminate();session.worker=null;
    session.library=null;session.reader=null;
    clearTimeout(session.idle);
  }
  async function run(file,selected,onChunk,signal){
    const check=()=>{if(signal.aborted)throw new DOMException('Import canceled.','AbortError');};
    check();
    let session=sessions.get(signal);
    if(!session){
      session={ids:new WeakMap(),next:0};sessions.set(signal,session);
      signal.addEventListener('abort',()=>{dispose(session);sessions.delete(signal);},{once:true});
    }
    if(session.busy)throw new Error('Wait for the current file to finish before changing the batch.');
    session.busy=true;clearTimeout(session.idle);
    let fileId=session.ids.get(file);
    if(!fileId){fileId=++session.next;session.ids.set(file,fileId);}
    const fallback=()=>{session.reader ||= createKeyReader();return session.reader.read(file,selected,async chunk=>{check();await onChunk(chunk);await new Promise(resolve=>setTimeout(resolve,0));check();},check,fileId);};
    try{
      if(typeof Worker==='undefined'||session.unsupported)return await fallback();
      if(/\.xlsx?$/i.test(file.name)&&!session.library){
        const library=await spreadsheetLibrary();check();
        if(!library.source&&!library.url)return await fallback();
        // A file:// worker cannot import a second opaque-origin blob URL.
        // Include the offline library in the worker's own script instead.
        if(library.source&&session.worker){session.worker.terminate();session.worker=null;}
        session.library=library;
      }
      if(!session.worker){
        const url=URL.createObjectURL(new Blob([session.library?.source||'','\n',createKeyReader.toString(),'\n(',workerMain.toString(),')();'],{type:'text/javascript'}));
        try{session.worker=new Worker(url);}catch{session.unsupported=true;return await fallback();}
        finally{URL.revokeObjectURL(url);}
      }
      const worker=session.worker;let emitted=false;
      const supported=await new Promise((resolve,reject)=>{
        const abort=()=>reject(new DOMException('Import canceled.','AbortError'));
        signal.addEventListener('abort',abort,{once:true});
        const finish=fn=>value=>{signal.removeEventListener('abort',abort);worker.onmessage=null;worker.onerror=null;fn(value);};
        const fail=finish(reject),done=finish(resolve);
        worker.onerror=e=>emitted?fail(new Error(e.message||'Import worker stopped.')):done(false);
        worker.onmessage=async({data})=>{
          if(data.unsupported){done(false);return;}
          if(data.error){fail(new Error(data.error));return;}
          if(data.done){done(true);return;}
          try{emitted=true;check();await onChunk(data.chunk);check();worker.postMessage({ack:true});}catch(error){fail(error);}
        };
        worker.postMessage({file,selected,fileId,library:session.library?.url});
      });
      if(!supported){dispose(session);session.unsupported=true;return await fallback();}
    }finally{
      session.busy=false;
      // Abandoned review screens release decoded sheets and the vendor VM.
      if(!signal.aborted)session.idle=setTimeout(()=>dispose(session),60000);
    }
  }
  root.QualtricsKeyIntake={...reader,run};
  if(typeof module==='object'&&module.exports)module.exports=root.QualtricsKeyIntake;
})(globalThis);
