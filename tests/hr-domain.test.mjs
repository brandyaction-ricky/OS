import test from 'node:test';
import assert from 'node:assert/strict';
import {addDays,addMonths,todayKst,validDate,periodOf,balance,leavePreview,promotion,retirement,accruals,workDays,headcount,calendarRange,hrBadges,leaveMetrics} from '../lib/hr/domain.ts';
import {emptyHrData} from '../lib/hr/types.ts';
const today='2026-10-09';
const employee=(id,hire_date)=>({id,hire_date,retire_date:null,status:'active',profile_id:null});
const data=()=>{const d=emptyHrData();d.holidays=[{day:'2026-10-09',name:'가상 공휴일'},{day:'2026-12-25',name:'가상 공휴일'}];return d;};
const request=(id,e,start,end,days,status='approved',type='annual')=>({id,hr_employee_id:e,start_date:start,end_date:end,days,status,leave_type:type,deducts:true});
const notice=(e,day,reply_days=null,step='notice_1')=>({hr_employee_id:e,period_start:'2025-12-01',step,sent_at:day,reply_at:reply_days===null?null:'2026-09-08',reply_days});

test('HR KST day boundaries, leap dates and clamped month arithmetic',()=>{
 assert.equal(todayKst(new Date('2026-10-08T15:01:00Z')),today);
 assert.equal(todayKst(new Date('2026-12-31T16:00:00Z')),'2027-01-01');
 assert.equal(addMonths('2025-01-31',1),'2025-02-28');
 assert.equal(validDate('2026-02-30'),false);
 assert.equal(validDate('2028-02-29'),true);
 assert.deepEqual(periodOf('2024-02-29','2027-10-09'),{start:'2027-02-28',end:'2028-02-28',first:false,year:3});
 assert.equal(addDays(periodOf('2024-02-29','2027-10-09').end,1),periodOf('2024-02-29','2028-02-29').start);
 assert.equal(periodOf('2024-02-29','2028-02-29').end,'2029-02-27');
});
test('HR accrual caps, separate first-year months and anniversary grants',()=>{
 const e=employee('a','2025-01-31'),rows=accruals(e,'2026-01-31');
 assert.equal(rows[0].entry_date,'2025-02-28');assert.equal(rows.length,12);
 assert.equal(rows.at(-1).days,15);assert.equal(rows.slice(0,11).reduce((s,x)=>s+x.days,0),11);
 assert.equal(accruals(employee('b','1990-01-01'),'2026-01-01').at(-1).days,25);
});
test('HR five reference balances keep pending separate from approved reservations',()=>{
 const d=data(),cases=[['a','2023-03-02',16,2],['b','2023-05-15',15,0],['c','2023-01-09',16,.5],['d','2025-12-01',9.5,0],['e','2023-04-03',15,0]];
 d.requests=[request('r1','a','2026-10-19','2026-10-20',2,'pending'),request('r2','b','2026-10-23','2026-10-23',1),request('r3','c','2026-10-14','2026-10-14',.5,'pending','half_pm'),request('r4','d','2026-10-08','2026-10-08',.5,'approved','half_am'),request('r5','e','2026-09-30','2026-09-30',1)];
 for(const [id,hire,left,pending] of cases){const b=balance(d,employee(id,hire),today);assert.equal(b.left,left,id);assert.equal(b.pending,pending,id);}
});
test('HR stored auto credits are never double-counted with projected accruals',()=>{
 const d=data(),e=employee('a','2025-12-01');d.credits=accruals(e,today);assert.equal(balance(d,e,today).left,10);
});
test('HR workdays, future-period leave, half holiday, overlap and crossing guards',()=>{
 const d=data(),e=employee('a','2023-03-02'),junior=employee('b','2025-12-01');
 assert.equal(workDays('2026-12-23','2026-12-28',d.holidays).days,3);
 assert.equal(leavePreview(d,e,'annual','2026-12-23','2026-12-28',today).after,13);
 const future=leavePreview(d,junior,'annual','2026-12-23','2026-12-28',today);assert.equal(future.balance.left,15);assert.equal(future.after,12);
 assert.equal(leavePreview(d,e,'half_am','2026-10-12','2026-10-12',today).days,.5);
 assert.ok(leavePreview(d,e,'half_am',today,today,today).errors.includes('NO_WORKDAYS'));
 assert.ok(leavePreview(d,junior,'annual','2026-11-30','2026-12-01',today).errors.includes('CROSSES_PERIOD'));
 d.requests=[request('r','b','2026-10-08','2026-10-08',.5)];
 assert.equal(leavePreview(d,junior,'annual','2026-10-13','2026-10-23',today).after,.5);
 d.holidays.push({day:'2026-10-14',name:'가상 휴일'});
 assert.equal(leavePreview(d,junior,'annual','2026-10-13','2026-10-14',today).days,1);
 assert.ok(leavePreview(d,junior,'annual','2026-10-08','2026-10-08',today).errors.includes('OVERLAP_SELF'));
 assert.ok(leavePreview(d,junior,'annual','2026-10-12','2026-11-20',today).errors.includes('INSUFFICIENT_LEAVE'));
 assert.ok(!leavePreview(d,junior,'unpaid','2026-10-12','2026-11-20',today).errors.includes('INSUFFICIENT_LEAVE'));
});
test('HR promotion deadline order and under-one-year extra notice',()=>{
 const d=data(),a=employee('a','2023-04-03'),b=employee('b','2023-03-02'),c=employee('c','2025-12-01'),e=employee('e','2023-05-15'),f=employee('f','2023-01-09');
 d.requests=[request('half','c','2026-10-08','2026-10-08',.5)];d.promotions=[notice('c','2026-09-02',6),{...notice('f','2026-07-10'),period_start:'2026-01-09'}];
 const pa=promotion(d,a,today);assert.equal(pa.rank,0);assert.equal(pa.firstEnd,'2026-10-12');
 assert.equal(promotion(d,b,today).rank,1);
 const pc=promotion(d,c,today);assert.equal(pc.rank,2);assert.equal(pc.target,3.5);assert.equal(pc.secondDue,'2026-10-31');assert.equal(pc.extra.days,2);assert.equal(pc.extra.start,'2026-11-01');assert.equal(pc.extra.due,'2026-11-20');
 assert.equal(promotion(d,f,today).secondDue,'2026-11-08');assert.equal(promotion(d,f,today).rank,2);
 assert.equal(promotion(d,e,today).rank,4);
 d.credits=[{hr_employee_id:'e',kind:'adjustment',source:'manual',entry_date:today,period_start:'2026-05-15',days:-16}];assert.equal(promotion(d,e,today).rank,7);
});
test('HR retirement projects credits through termination and preserves retention date',()=>{
 const d=data(),e=employee('a','2025-12-01');d.requests=[request('r','a','2026-10-08','2026-10-08',.5)];
 const r=retirement(d,e,'2026-11-20',today);assert.equal(r.balance,10.5);assert.equal(r.tenure,'11개월');assert.equal(r.retentionUntil,'2029-11-20');
});
test('HR headcount excludes nonworkers, shared accounts and already-effective retirement',()=>{
 const d=data();d.employees=[employee('a','2023-01-01'),{...employee('b','2023-01-01'),profile_id:'p'}, {...employee('c','2023-01-01'),retire_date:'2026-10-08'}];d.profiles=[{id:'p',person_kind:'owner',is_shared_account:false}];assert.equal(headcount(d,today).count,1);
});

test('HR calendar bounds remain six complete weeks across month and year changes', () => {
  assert.deepEqual(calendarRange('2026-10-09', 'month'), {from:'2026-09-27',to:'2026-11-07',count:42});
  assert.deepEqual(calendarRange('2027-01-01', 'week'), {from:'2026-12-27',to:'2027-01-02',count:7});
});
test('HR action badges reflect pending requests, actionable letters and document completeness', () => {
  const d=data(),e=employee('a','2023-04-03'); d.employees=[e];
  d.requests=[request('r','a','2026-10-22','2026-10-22',1,'pending')];
  const first=hrBadges(d,today); assert.equal(first['/hr/leave'],1);assert.equal(first['/hr/leave-ledger'],1);assert.equal(first['/hr/documents'],6);
  d.requests[0].status='approved';d.promotions=[{...notice('a',today),period_start:'2026-04-03'}];
  assert.equal(hrBadges(d,today)['/hr/leave'],0);assert.equal(hrBadges(d,today)['/hr/leave-ledger'],0);
});

test('HR leave summary counts unique people across month boundaries and excludes closed days today', () => {
 const d=data();d.requests=[request('a','p','2026-09-30','2026-10-12',3),request('b','p','2026-10-22','2026-10-22',1),request('c','q','2026-10-30','2026-11-02',2),request('d','r','2026-10-12','2026-10-12',1,'pending')];
 assert.equal(leaveMetrics(d,today).today,0);
 assert.deepEqual(leaveMetrics(d,today).month,['p','q']);
 assert.equal(leaveMetrics(d,'2026-10-12').today,1);
});
