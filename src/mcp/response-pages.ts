import {jcsSha256} from '../core/canonical.js';
import {mcpState} from './state.js';
import {getWorkspaceRoot} from '../collector/safe-paths.js';

export const RESPONSE_BYTES=65536;
// MCP carries structuredContent and its text fallback; budget both copies.
export const PAYLOAD_BYTES=30*1024;
export function bounded<T>(value:T):T{if(Buffer.byteLength(JSON.stringify(value))>PAYLOAD_BYTES)throw Error('RESPONSE_REQUIRES_PAGINATION');return value;}
export function pageRows(rows:unknown[],section:string,cursor?:string,limit=50,binding:unknown=null){
 if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('INVALID_PAGE_LIMIT');
 const revision=jcsSha256({binding,section,rows});let offset=0;
 if(cursor){const [hash,index,...extra]=cursor.split(':');if(hash!==revision||extra.length||!/^\d+$/.test(index??''))throw Error('PAGE_CURSOR_STALE');offset=Number(index);}
 const entries:any[]=[];
 for(const [index,value]of rows.entries()){
  const bytes=Buffer.from(JSON.stringify(value));if(bytes.length<=12*1024){entries.push({index,value});continue;}
  const count=Math.ceil(bytes.length/(12*1024));for(let part=0;part<count;part++)entries.push({index,fragment_index:part,fragment_count:count,encoding:'base64-json-utf8',data:bytes.subarray(part*12*1024,(part+1)*12*1024).toString('base64')});
 }
 if(!Number.isSafeInteger(offset)||offset<0||offset>entries.length)throw Error('INVALID_PAGE_CURSOR');
 const result:any={section,revision,total_records:rows.length,total_items:entries.length,offset,items:[],returned_items:0,has_more:false,next_cursor:null,byte_limit:RESPONSE_BYTES,json_payload_limit:PAYLOAD_BYTES};
 while(offset+result.items.length<entries.length&&result.items.length<limit){result.items.push(entries[offset+result.items.length]);if(Buffer.byteLength(JSON.stringify(result))>PAYLOAD_BYTES-1024){result.items.pop();break;}}
 result.returned_items=result.items.length;result.has_more=offset+result.items.length<entries.length;result.next_cursor=result.has_more?`${revision}:${offset+result.items.length}`:null;return bounded(result);
}
export function publicAcquisition(summary:any){
 const issues:Record<string,number>={};for(const i of summary.issues??[])issues[i.cause]=(issues[i.cause]??0)+1;
 return bounded({...Object.fromEntries(['totals','discovery_complete','limits','splittable','ready','all_selected_fit','selected_bytes','source_content_read','excluded_totals_complete'].map(k=>[k,summary[k]])),
  folders:Object.fromEntries(Object.entries(summary.folders??{}).sort((a:any,b:any)=>b[1]-a[1]).slice(0,10)),
  issue_count:(summary.issues??[]).length,issues_by_cause:issues,issues:(summary.issues??[]).slice(0,3),
  oversized_count:(summary.oversized??[]).length,oversized:(summary.oversized??[]).slice(0,3),
  excluded_metadata_not_enumerated:(summary.excluded_metadata_not_enumerated??[]).slice(0,3),excluded_metadata_omitted_count:(summary.excluded_metadata_not_enumerated??[]).length,
  protected_metadata_not_enumerated_count:(summary.protected_metadata_not_enumerated??[]).length,details_paginated:true});
}
export function publicDiscovery(summary:any){return bounded({files:summary.files,categories:summary.categories,top_level:Object.fromEntries(Object.entries(summary.top_level??{}).slice(0,15)),truncated:summary.truncated,source_content_read:false,scope:summary.scope.slice(0,10),scope_rule_count:summary.scope.length,fingerprint:summary.fingerprint,acquisition:publicAcquisition(summary.acquisition),details_paginated:true});}
export function snapshotEntry(id:string){const e=mcpState.getSnapshot(id);if(!e?.preparation)throw Error('SNAPSHOT_NOT_FOUND_OR_EXPIRED');if(e.workspace_root!==getWorkspaceRoot())throw Error('SNAPSHOT_WORKSPACE_MISMATCH');return e;}
export function collectorInput(id:string){const s=snapshotEntry(id).snapshot;return {...s.source_identity,manifest_hash:s.manifest_hash,manifest:structuredClone(s.manifest),analysis_complete:s.analysis_complete,acquisition:structuredClone(s.acquisition)};}
export function snapshotSummary(id:string){
 const e=snapshotEntry(id),s=e.snapshot,r:any=s.acquisition_record,issues:Record<string,number>={};for(const i of s.acquisition?.issues??[])issues[i.cause]=(issues[i.cause]??0)+1;
 const unread=e.tracker.exportReads().filter(f=>e.tracker.getDisposition(f.path)==='unread').length;
 return bounded({response_format:'oes/snapshot-summary/v2',status:s.analysis_ready?'READY_FOR_ANALYSIS':'ACQUISITION_INCOMPLETE',snapshot_id:id,assessment_id:e.preparation!.assessment_id,assessor_defaults:e.preparation!.assessor_defaults,manifest_hash:s.manifest_hash,analysis_ready:s.analysis_ready,scope_coverage:s.acquisition?.scope_coverage??'UNKNOWN',
  summary:{total_files:s.total_files,analyzed_candidates:s.analyzed_candidates,excluded_files:s.excluded_files,total_bytes:s.total_bytes,analysis_complete:s.analysis_complete,unread_files:unread,totals:r?.observed?.summary?.totals??null},
  issues:{total:(s.acquisition?.issues??[]).length,by_cause:issues,examples:(s.acquisition?.issues??[]).slice(0,3)},snapshot_reused:true,acquisition_performed:false,previous_snapshot_id:r?.previous_snapshot_id??null,
  byte_limit:RESPONSE_BYTES,json_payload_limit:PAYLOAD_BYTES,details:{tool:'get_repository_snapshot_page',sections:['manifest','issues','reads','exclusions','scope','acquisition_record']},
  next_action:s.analysis_ready?'PAGE_FILES_THEN_SAVE_ASSESSMENT_DRAFT':'ADJUST_OR_DECLARED_PARTIAL',notice:'取得事実はローカルで評価入力へ引き継ぎます。manifestや取得問題を再構築・再送せず、機能・根拠・判断を下書きへ保存してください。'});
}
export function snapshotPage(args:{snapshot_id:string;section:string;cursor?:string;limit?:number}){
 const e=snapshotEntry(args.snapshot_id),s=e.snapshot,r:any=s.acquisition_record;let rows:unknown[];
 switch(args.section){case 'manifest':{const roles=new Map((r?.observed?.files??[]).map((f:any)=>[f.path,f.role]));rows=s.manifest.files.map(f=>({...f,role:roles.get(f.path)??null}));break;}
 case 'issues':rows=s.acquisition?.issues??[];break;case 'reads':rows=e.tracker.exportReads();break;case 'exclusions':rows=s.manifest.files.filter(f=>f.disposition==='excluded');break;case 'scope':rows=r?.scope??[];break;case 'acquisition_record':rows=[r??null];break;default:throw Error('UNKNOWN_SNAPSHOT_SECTION');}
 return pageRows(rows,args.section,args.cursor,args.limit,{snapshot_id:args.snapshot_id,manifest_hash:s.manifest_hash});
}
