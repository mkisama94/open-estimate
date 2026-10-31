import {it,expect,vi} from 'vitest';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createEstimateStartWidget} from '../../src/local/start-widget.js';
function harness(mode='card',callTool:any=vi.fn(async()=>({structuredContent:{workflow_id:'wf',status:'STARTED',selection:{read:true,verify:true,publish:true}}})),extra:any={}){
 const elements:Record<string,any>={};let html='';
 const view={get innerHTML(){return html;},set innerHTML(v:string){html=v;for(const k of Object.keys(elements))delete elements[k];for(const m of v.matchAll(/id="([^"]+)"/g))elements[m[1]]={checked:false,disabled:false,textContent:''};}};
 const d={workflow_id:'wf',status:'AWAITING_EXTERNAL_SELECTION',confirmation_mode:mode,terms_hash:'hash',target:'synthetic',notice:'scope',publication_notice:'365日',terms:{display_currency:'JPY',ruleset_ref:{revision:'a'.repeat(64)},services:{proof_destination:'https://issuer.example/mcp',publication_destination:'https://web.example/api/results'}}};
 Object.assign(d,extra);const follow=vi.fn(async()=>{throw Error('HOST_MESSAGE_FAILED');});
 const window={openai:{toolOutput:d,callTool,sendFollowUpMessage:follow}},document={getElementById:(id:string)=>id==='view'?view:elements[id]};
 const bridge="const esc=v=>String(v??'');const call=(n,a)=>window.openai.callTool(n,a);const rpc=()=>Promise.reject(Error('UNEXPECTED_RPC'));";
 const markup=createEstimateStartWidget(bridge,''),script=markup.slice(markup.indexOf('<script>')+8,markup.indexOf('</script>'));vm.runInNewContext(script,{window,document,crypto:webcrypto});
 return {elements,view,callTool,follow,d};
}
it('offers only unchecked external choices and does not send on display or no selection',async()=>{
 const h=harness();expect(h.elements.read).toBeUndefined();expect(h.elements.start).toBeUndefined();
 expect(h.elements.verify.checked).toBe(false);expect(h.elements.publish.checked).toBe(false);
 expect(h.view.innerHTML).toContain('回答を待たず');expect(h.view.innerHTML).toContain('https://issuer.example/mcp');expect(h.view.innerHTML).toContain('365日');
 await h.elements.approve.onclick();expect(h.callTool).not.toHaveBeenCalled();
});
it('records a single external approval despite double click and follow-up failure',async()=>{
 let finish!:(v:any)=>void;const call=vi.fn(()=>new Promise(resolve=>{finish=resolve;})),h=harness('card',call);
 h.elements.publish.checked=true;h.elements.publish.onchange();expect(h.elements.verify.checked).toBe(true);
 const button=h.elements.approve,first=button.onclick();await button.onclick();expect(call).toHaveBeenCalledTimes(1);
 expect(call).toHaveBeenCalledWith('approve_estimate_transmission',expect.objectContaining({selection:{verify:true,publish:true}}));
 finish({structuredContent:{workflow_id:'wf',status:'STARTED'}});await first;await button.onclick();
 expect(call).toHaveBeenCalledTimes(1);expect(h.elements.notice.textContent).toContain('保存済み');
});
it('retries a failed save without inventing approval and hides forms on local-only status',async()=>{
 const call=vi.fn(async()=>{throw Error('SAVE_FAILED');}),h=harness('card',call);h.elements.verify.checked=true;
 await h.elements.approve.onclick();expect(h.elements.approve.disabled).toBe(false);expect(h.elements.notice.textContent).toBe('SAVE_FAILED');
 const local=harness('card',undefined,{status:'STARTED'});expect(local.elements.approve).toBeUndefined();expect(local.elements.read).toBeUndefined();
});
