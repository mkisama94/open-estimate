/** Acquisition and measured-source coverage are independent of interpretation certainty. */
export function wholeMeasuredScope(acquisition:string,unread?:{in_scope:number;scope_unknown:number}){
 return acquisition==='COMPLETE'&&unread!==undefined&&unread.in_scope===0&&unread.scope_unknown===0;
}
