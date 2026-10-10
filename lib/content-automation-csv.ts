export type AutomationExportPeriod="today"|"week"|"month"|"last"|"all";

function kstDateParts(now:Date){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const value=(type:"year"|"month"|"day")=>Number(parts.find(part=>part.type===type)?.value);
  return {year:value("year"),month:value("month"),day:value("day")};
}

function kstMidnight(year:number,month:number,day:number){
  return new Date(Date.UTC(year,month-1,day,-9)).toISOString();
}

export function automationExportRange(period:AutomationExportPeriod,now=new Date()){
  if(period==="all")return {start:null,end:null};
  const {year,month,day}=kstDateParts(now);
  const today=kstMidnight(year,month,day);
  if(period==="today")return {start:today,end:kstMidnight(year,month,day+1)};
  if(period==="week"){
    const weekday=new Date(Date.UTC(year,month-1,day)).getUTCDay();
    const mondayOffset=(weekday+6)%7;
    return {start:kstMidnight(year,month,day-mondayOffset),end:kstMidnight(year,month,day-mondayOffset+7)};
  }
  if(period==="last")return {start:kstMidnight(year,month-1,1),end:kstMidnight(year,month,1)};
  return {start:kstMidnight(year,month,1),end:kstMidnight(year,month+1,1)};
}

export function formatKstCsvDate(value:unknown){
  if(typeof value!=="string"||!value)return "";
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return "";
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date);
  const part=(type:string)=>parts.find(item=>item.type===type)?.value??"";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

export function automationCsv(headers:readonly string[],rows:readonly (readonly unknown[])[]){
  const cell=(value:unknown)=>{
    const raw=String(value??"");
    const safe=/^[\s\x00-\x1f]*[=+\-@]/.test(raw)?`'${raw}`:raw;
    return `"${safe.replaceAll('"','""')}"`;
  };
  return "\uFEFF"+[headers,...rows].map(row=>row.map(cell).join(",")).join("\r\n")+"\r\n";
}
