import type {OsRecord} from "./record-types";
/** Browser-memory fixture only; callers must explicitly be in demo mode. */
export function demoRecord(input:Record<string,unknown>,owner:string,current?:OsRecord):OsRecord {
 const now=new Date().toISOString();
 const row:OsRecord={id:crypto.randomUUID(),record_type:"task",title:"",description:"",status:"planned",priority:"normal",stage:"",brand:"",team:"",owner_id:owner,assignee_id:null,parent_id:null,due_date:null,starts_at:null,ends_at:null,progress:0,metric_target:null,metric_current:null,metric_unit:"",amount:null,currency:"KRW",source_url:null,tags:[],metadata:{},version:0,created_by:owner,updated_by:owner,created_at:now,updated_at:now,archived_at:null,...current};
 const columns:Record<string,string>={recordType:"record_type",assigneeId:"assignee_id",parentId:"parent_id",dueDate:"due_date",startsAt:"starts_at",sourceUrl:"source_url"};
 for(const [key,value]of Object.entries(input)){const column=columns[key]??key;if(column in row&&column!=="version")Object.assign(row,{[column]:value});}
 return {...row,version:row.version+1,updated_at:now};
}
