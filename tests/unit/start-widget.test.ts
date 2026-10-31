import {it,expect,vi} from 'vitest';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createEstimateStartWidget} from '../../src/local/start-widget.js';
function harness(mode='card',callTool:any=vi.fn(async()=>({structuredContent:{workflow_id:'wf',status:'STARTED',selection:{read:true,verify:true,publish:true}}})),extra:any={}){
 const elements:Record<string,any>={};let html='';
 const view={get innerHTML(){return html;},set innerHTML(v:string){html=v;for(const k of Object.keys(elements))delete elements[k];for(const m of v.matchAll(/id="([^"]+)"/g))elements[m[1]]={checked:false,disabled:false,textContent:''};}};
 const d={workflow_id:'wf',status:'AWAITING_START_SELECTION',confirmation_mode:mode,terms_hash:'hash',target:'synthetic',notice:'scope',publication_notice:'365日',terms:{display_currency:'JPY',ruleset_ref:{revision:'a'.repeat(64)},services:{proof_destination:'https://issuer.example/mcp',publication_destination:'https://web.example/api/results'}}};
 Object.assign(d,extra);const follow=vi.fn(async()=>{throw Error('HOST_MESSAGE_FAILED');});
 const window={openai:{toolOutput:d,callTool,sendFollowUpMessage:follow}},document={getElementById:(id:string)=>id==='view'?view:elements[id]};
 const bridge="const esc=v=>String(v??'');const call=(n,a)=>window.openai.callTool(n,a);const rpc=()=>Promise.reject(Error('UNEXPECTED_RPC'));";
 const markup=createEstimateStartWidget(bridge,''),script=markup.slice(markup.indexOf('<script>')+8,markup.indexOf('</script>'));vm.runInNewContext(script,{window,document,crypto:webcrypto});
 return {elements,view,callTool,follow,d};
}
it('has one unchecked card choice, blocks double-clicks and never reopens consent after a follow-up failure',async()=>{
 let finish!:(v:any)=>void;const call=vi.fn(()=>new Promise(resolve=>{finish=resolve;})),h=harness('card',call);
 for(const id of ['read','verify','publish'])expect(h.elements[id].checked).toBe(false);
 for(const id of ['read','verify','publish'])h.elements[id].checked=true;
 const button=h.elements.start,first=button.onclick();await button.onclick();expect(call).toHaveBeenCalledTimes(1);expect(button.disabled).toBe(true);
 finish({structuredContent:{workflow_id:'wf',status:'STARTED',selection:{read:true,verify:true,publish:true}}});await first;
 expect(h.view.innerHTML).toContain('保存済み');expect(h.elements.start).toBeUndefined();expect(h.elements.notice.textContent).toContain('再度の開始選択は不要');
 await button.onclick();expect(call).toHaveBeenCalledTimes(1);expect(h.follow).toHaveBeenCalledTimes(1);
});
it('does not render another start form when chat fallback is selected',()=>{const h=harness('chat');expect(h.elements.start).toBeUndefined();expect(h.elements.read).toBeUndefined();expect(h.view.innerHTML).toContain('チャットで一度だけ');});
it('rejects invalid selections locally and allows retry only when saving itself failed',async()=>{
 const call=vi.fn(async()=>{throw Error('SAVE_FAILED');}),h=harness('card',call);
 await h.elements.start.onclick();expect(call).not.toHaveBeenCalled();h.elements.read.checked=true;
 await h.elements.start.onclick();expect(call).toHaveBeenCalledTimes(1);expect(h.elements.start.disabled).toBe(false);expect(h.elements.notice.textContent).toBe('SAVE_FAILED');
});
const methods=[{method:'NEW',label:'過去の評価を使わず、新規に見積',enabled:true},{method:'RECALCULATE',label:'過去の見積を引き継いで再計算',enabled:true},{method:'RESUME',label:'中断した処理を再開',enabled:false,reason:'未完了の処理なし'}];
it('keeps the non-card fallback readable without inactive method controls',()=>{const h=harness('chat',undefined,{start_methods:methods,start_history:{items:[],has_more:false}});expect(h.elements.method).toBeUndefined();expect(h.elements.start).toBeUndefined();expect(h.view.innerHTML).toContain('過去の見積を引き継いで再計算');expect(h.view.innerHTML).toContain('チャットで一度だけ');});
it('defaults to NEW only when there is no history and keeps remote choices unchecked',()=>{const h=harness('card',undefined,{start_methods:methods,start_history:{items:[],has_more:false}});expect(h.elements.method.value).toBe('NEW');expect(h.elements.start.disabled).toBe(false);expect(h.elements.verify.checked).toBe(false);expect(h.view.innerHTML).toContain('未完了の処理なし');});
it('requires an explicit method/source, shows useful history, and changes workflow before requesting new approval',async()=>{
 let h:ReturnType<typeof harness>;const call=vi.fn(async()=>({structuredContent:{...h.d,workflow_id:'new-workflow',start_method:'RECALCULATE',method_selection_explicit:true}}));
 h=harness('card',call,{start_methods:methods,start_history:{items:[{value:{workflow_id:'old',run_id:'run',estimated_at:'2026-10-31',target:'合成対象',scope:[{path:'src',role:'measurement'}],project_effort:null,acquired_portion_effort:{median:'66'},cfp:22,evaluation_status:'RUN_SAVED',proof_status:'VERIFIED',publication_status:'PUBLISHED',can_recalculate:true,can_resume:false}}],has_more:false}});
 expect(h.elements.start.disabled).toBe(true);expect(h.view.innerHTML).toContain('2026-10-31');expect(h.view.innerHTML).toContain('66');expect(h.view.innerHTML).toContain('全体未算出');
 h.elements.method.value='RECALCULATE';await h.elements.method.onchange();expect(call).not.toHaveBeenCalled();h.elements.source.value='0';await h.elements.source.onchange();expect(call).toHaveBeenCalledWith('select_estimate_start',expect.objectContaining({workflow_id:'wf',start_method:'RECALCULATE',source_workflow_id:'old',source_run_id:'run'}));expect(h.elements.start.disabled).toBe(false);expect(h.elements.verify.checked).toBe(false);expect(h.elements.publish.checked).toBe(false);
});
