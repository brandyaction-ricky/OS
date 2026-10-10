export type ScheduleRules={enabled:boolean;days:string;times:string[];grace_minutes:number};
export type ScheduleRun={via:string;slot:string|null;started_at:string;browser_id:string};

export function kstScheduleDate(now=new Date()){
  return new Date(now.getTime()+9*3_600_000).toISOString().slice(0,10);
}

export function scheduledTimes(rules:ScheduleRules,now=new Date()){
  if(!rules.enabled)return [];
  const day=new Date(`${kstScheduleDate(now)}T00:00:00+09:00`).getUTCDay();
  if(rules.days==="weekdays"&&(day===0||day===6))return [];
  if(rules.days==="monday"&&day!==1)return [];
  return [...new Set(rules.times)].filter(time=>/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    .sort().map(slot=>({slot,at:new Date(`${kstScheduleDate(now)}T${slot}:00+09:00`)}));
}

export function upcomingScheduleSlots(rules:ScheduleRules,now=new Date(),days=21){
  const slots:{slot:string;at:Date}[]=[];
  for(let offset=0;offset<days;offset++){
    const day=new Date(now.getTime()+offset*86_400_000);
    slots.push(...scheduledTimes(rules,day).filter(({at})=>at>now));
  }
  return slots.sort((a,b)=>a.at.getTime()-b.at.getTime());
}

export function missedScheduleSlots(rules:ScheduleRules,runs:ScheduleRun[],mainBrowserId:string,now=new Date()){
  return scheduledTimes(rules,now).filter(({slot,at})=>
    now.getTime()>at.getTime()+rules.grace_minutes*60_000
    && !runs.some(run=>run.browser_id===mainBrowserId&&run.via==="sched"&&run.slot===slot
      &&kstScheduleDate(new Date(run.started_at))===kstScheduleDate(now)));
}

export function silentScheduleSlot(rules:ScheduleRules,runs:ScheduleRun[],mainBrowserId:string,now=new Date()){
  const latest=missedScheduleSlots(rules,runs,mainBrowserId,now).at(-1);
  if(!latest)return null;
  return runs.some(run=>run.browser_id===mainBrowserId&&new Date(run.started_at)>latest.at)?null:latest;
}
