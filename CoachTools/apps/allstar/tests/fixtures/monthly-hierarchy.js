'use strict';
const period='Fiscal LW (2026-09-20 – 2026-09-26)';
const header=[['','','','',...Array(12).fill('OPPORTUNITY_LATEST_SEGMENT')],['','','','',...['COMMERCIAL','CONSUMER','INSURANCE'].flatMap(s=>Array(4).fill(s))],['','','','',...Array.from({length:3},()=>['Opportunities','Appointments','Appt Rate','SMS Rate']).flat()]];
const row=(manager,coach,name,counts,sms=['0%','60%','80%'],label=period)=>[manager,coach,name,label,...counts.flatMap((n,i)=>[n,n, n===null?'':'100%',sms[i]])];
// Rep detail intentionally differs from exported counts: totals must remain authoritative.
const opportunity=[...header,
 row('Grand Total','Total','Total',[50,30,120],[],'Total'),
 row('Manager A','Total','Total',[50,30,120],[],'Total'),
 row('Manager A','Coach A','Total',[20,15,65],[],'Total'),
 row('Manager A','Coach A','Rep One',[5,5,40]),
 row('Manager A','Coach A','Rep Two',[5,5,40]),
 row('Manager A','Coach B','Total',[30,10,60],[],'Total'),
 row('Manager A','Coach B','Rep Three',[30,10,60],['20%','20%','20%'])];
const wiper=[['REPORT DATE','EMPLOYEE_IMMEDIATE_SUPERVISOR_NAME','EMPLOYEE_FULL_NAME','COUNT_WIPERS_ACCEPTED','COUNT_WIPERS_OFFERED'],
 ['Grand Total','Total','Total',20,50],['9/6/2026','Total','Total',15,40],['9/6/2026','Coach A','Total',6,20],
 ['9/6/2026','Coach A','Rep One',2,10],['9/6/2026','Coach A','Wiper Only',3,7],['9/6/2026','Coach A','',1,3],
 ['9/6/2026','Coach B','Rep One',4,10],['9/6/2026','Unknown Coach','Unknown Rep',5,10],
 ['9/13/2026','Coach A','Rep One',5,10]];
module.exports={opportunity,wiper,row,header,period};
