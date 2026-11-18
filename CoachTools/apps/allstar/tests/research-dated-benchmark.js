// Optional arguments are Allstar app directories for a same-machine comparison.
// Seven repetitions per build. Calculations exclude workbook parsing, storage and browser paint.
const path=require('node:path');
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const rows=Array.from({length:561*12},(_,i)=>({Name:'Person '+(i%561),Sheet:'Coach '+((i%561)%23),Date:new Date(Date.UTC(2026,0,4)+Math.floor(i/561)*7*86400000).toISOString().slice(0,10),'Total Appointments':i%11,'Total Opportunities':13,'Consumer Appointments':i%10,'Consumer Opportunities':12}));
const quantile=(v,p)=>[...v].sort((a,b)=>a-b)[Math.ceil(p*v.length)-1];
async function run(folder){
  const E=require(path.resolve(folder,'js/dated-stats.js'));
  const headers=Object.keys(rows[0]),base=E.defaultConfig('weeklyRetail',headers);
  const config={...base,calendar:{reviewed:true,frequency:'week',label:'ending',offsetDays:0}};
  const metric=E.normalizeMetric({id:'ar',name:'Appointment Rate',source:'weeklyRetail',statistic:'total_ar',aggregation:'combined_rate'});
  const second=E.normalizeMetric({id:'cash',name:'Consumer appointment rate',source:'weeklyRetail',statistic:'consumer_ar',aggregation:'combined_rate'});
  const results={cold:[],warm:[]},hashes=new Set();
  for(let i=0;i<7;i++){
    const start=performance.now(),pack=E.categorize(rows,config,{headers});results.cold.push(performance.now()-start);
    const compute=performance.now(),output=[];
    for(const m of [metric,second]){
      const r=await E.research(pack.observations,m,{mode:'changing',groupBy:'coach'},[]);
      if(r.data.length!==12*23||r.data.some(p=>!Number.isFinite(p.value)||!p.denominator))throw new Error('Invalid fixture result');
      output.push(r.data.map(p=>[p.label,p.line,p.value,p.numerator,p.denominator,p.eligibleRepresentatives,p.missingRepresentatives]));
    }
    results.warm.push(performance.now()-compute);hashes.add(crypto.createHash('sha256').update(JSON.stringify(output)).digest('hex'));
  }
  return {build:folder,rows:rows.length,metrics:2,reps:561,weeks:12,coaches:23,runs:7,categorizationP50:quantile(results.cold,.5),categorizationP95:quantile(results.cold,.95),calculationP50:quantile(results.warm,.5),calculationP95:quantile(results.warm,.95),resultHashes:[...hashes]};
}
(async()=>{for(const folder of (process.argv.slice(2).length?process.argv.slice(2):[path.resolve(__dirname,'..')]))console.log(JSON.stringify(await run(folder)));})().catch(e=>{console.error(e);process.exitCode=1;});
