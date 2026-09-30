'use strict';
function opportunities(detail = [['Manager One','Coach A','Alex Reed','Fiscal LW (2026-09-20 – 2026-09-26)',2,1,'50%',10,6,'60%',20,19,'95%']]) {
 return [
 ['Manager','Coach','Representative','Fiscal Period','','','','','','','','',''],
 ['','','','','COMMERCIAL','','','CONSUMER','','','INSURANCE','',''],
 ['','','','','Opportunities','Appointments','Appt Rate','Opportunities','Appointments','Appt Rate','Opportunities','Appointments','Appt Rate'],
 ['Grand Total','Total','Total','Total',999,999,'100%',999,999,'100%',999,999,'100%'],
 ['Manager One','Total','Total','Total',999,999,'100%',999,999,'100%',999,999,'100%'],
 ['Manager One','Coach A','Total','Total',999,999,'100%',999,999,'100%',999,999,'100%'],...detail
 ];
}
function wipers(detail = [['9/27/2026','Coach A','Reed, Alex',3,8]]) {
 return [['REPORT DATE','EMPLOYEE_IMMEDIATE_SUPERVISOR_NAME','EMPLOYEE_FULL_NAME','COUNT_WIPERS_ACCEPTED','COUNT_WIPERS_OFFERED'],['Grand Total','Total','Total',99,199],['9/27/2026','Coach A','Total',99,199],...detail];
}
module.exports={opportunities,wipers};
