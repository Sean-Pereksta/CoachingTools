/* One ordered email at a time crosses into the packaging worker. */
(function(root){
  'use strict';
  let idleWorker,idleTimer,reserved=false,libraryPromise;

  function workerMain(){
    let zip;
    self.onmessage=async({data})=>{
      try{
        if(data.action==='start')zip=new JSZip();
        if(data.action==='entry'){
          const e=data.entry,encode=e.kind==='report'?makeEml:individualEml;
          zip.file(e.name,encode(...e.args,e.stamp),{date:new Date(e.stamp.time)});
        }
        if(data.action==='finish'){
          let last=-1;
          const bytes=await zip.generateAsync({type:'arraybuffer'},meta=>{
            const percent=Math.floor(meta.percent);
            if(percent!==last){last=percent;self.postMessage({progress:percent});}
          });
          zip=null;self.postMessage({bytes},[bytes]);return;
        }
        self.postMessage({ok:true});
      }catch(error){self.postMessage({error:String(error.message||error)});}
    };
  }
  function workerLibrary(){
    const inline=document.querySelector('script[data-allstar-vendor="jszip.min.js"]')?.textContent;
    if(inline)return Promise.resolve(inline);
    const script=document.querySelector('script[src*="jszip.min.js"]');
    if(script?.src&&!script.src.startsWith('file:'))return Promise.resolve('importScripts('+JSON.stringify(script.src)+');');
    try{
      const source=root.__ALLSTAR_IMPORT_WORKER_LIBRARIES__?.zip||root.parent.__ALLSTAR_IMPORT_WORKER_LIBRARIES__?.zip;
      if(source)return Promise.resolve(source);
    }catch{}
    if(!libraryPromise)libraryPromise=new Promise(resolve=>{
      const tag=document.createElement('script');
      let base=new URL('../js/import-worker-source.js',document.baseURI);
      try{if(root.parent!==root)base=new URL('js/import-worker-source.js',root.parent.document.baseURI);}catch{}
      tag.src=base.href;
      tag.onload=()=>{tag.remove();resolve(root.__ALLSTAR_IMPORT_WORKER_LIBRARIES__?.zip);};
      tag.onerror=()=>{tag.remove();resolve(null);};document.head.append(tag);
    });
    return libraryPromise;
  }
  function create(isCurrent=()=>true){
    const replay=[];
    let worker,ownsWorker=false,started=false,finished=false,closed=false;
    function check(){
      if(closed||!isCurrent())throw new DOMException('Email inputs changed.','AbortError');
    }
    function discardWorker(){if(worker){worker.terminate();worker=null;}}
    function send(message,onProgress){
      return new Promise((resolve,reject)=>{
        worker.onerror=event=>{event.preventDefault();reject(Error(event.message||'Email packaging worker stopped.'));};
        worker.onmessage=({data})=>{
          try{
            check();
            if(data.progress!=null){onProgress?.({percent:data.progress});return;}
            if(data.error)throw Error(data.error);
            resolve(data.bytes);
          }catch(error){reject(error);}
        };
        worker.postMessage(message);
      });
    }
    async function start(){
      started=true;
      if(typeof Worker==='undefined'||reserved)return;
      reserved=true;ownsWorker=true;clearTimeout(idleTimer);
      worker=idleWorker;idleWorker=null;
      if(!worker){
        const library=await workerLibrary();check();
        if(!library)return;
        const code=new Blob([library,'\n',esc.toString(),'\n',makeEml.toString(),'\n',individualEml.toString(),'\n(',workerMain.toString(),')();'],{type:'text/javascript'});
        const url=URL.createObjectURL(code);
        try{worker=new Worker(url);}finally{URL.revokeObjectURL(url);}
      }
      await send({action:'start'});
    }
    function recover(error){discardWorker();if(error.name==='AbortError')throw error;}
    return {
      async add(name,kind,args){
        check();
        const entry={name,kind,args,stamp:{time:Date.now(),suffix:Math.random().toString(36).slice(2)}};
        replay.push(entry);
        try{
          if(!started)await start();
          if(worker)await send({action:'entry',entry});
        }catch(error){recover(error);}
        check();
      },
      async finish(progress){
        check();
        if(worker){
          try{
            const bytes=await send({action:'finish'},progress);
            check();finished=true;return new Blob([bytes],{type:'application/zip'});
          }catch(error){recover(error);}
        }
        // On startup, encoding, or packaging failure, replay the same inputs,
        // timestamps, and MIME boundaries without recalculating the report.
        const zip=new JSZip();
        let deadline=performance.now()+12;
        for(const e of replay){
          if(performance.now()>=deadline){await new Promise(resolve=>setTimeout(resolve,0));check();deadline=performance.now()+12;}
          const encode=e.kind==='report'?makeEml:individualEml;
          zip.file(e.name,encode(...e.args,e.stamp),{date:new Date(e.stamp.time)});
        }
        const blob=await zip.generateAsync({type:'blob'},progress);
        check();finished=true;return blob;
      },
      close(){
        if(closed)return;
        closed=true;replay.length=0;
        if(!ownsWorker)return;
        reserved=false;
        if(!finished){discardWorker();return;}
        if(worker){
          worker.onmessage=null;worker.onerror=null;idleWorker=worker;worker=null;
          idleTimer=setTimeout(()=>{idleWorker?.terminate();idleWorker=null;},30000);
        }
      }
    };
  }
  root.QualtricsEmailPackage={create};
})(globalThis);
