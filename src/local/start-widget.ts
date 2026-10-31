/** Optional external approval. Local work is already running and never waits for this view. */
export function createEstimateStartWidget(bridge:string,style:string){return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${style}</style><main id="view">送信条件を表示しています</main><script>${bridge}
let current,submitting=false;
function render(d){
 if(!d?.workflow_id)return;current=d;
 if(d.status!=='AWAITING_EXTERNAL_SELECTION'){document.getElementById('view').innerHTML='<h1>見積の進行状況</h1><p>ローカルの取得・解析を継続します。読取の追加確認は不要です。</p><p id="notice"></p>';return;}
 const t=d.terms;
 document.getElementById('view').innerHTML='<h1>希望する外部操作の確認</h1><p>ローカルの見積はこの画面への回答を待たずに進みます。数値は算定後に確定し、品質判定・部分試算・同じ要求の再試行では再確認しません。</p><p>対象：'+esc(d.target)+'</p><p>検証先：'+esc(t.services.proof_destination)+'</p><p>Web保存先：'+esc(t.services.publication_destination)+'</p><p>MCPだけへ：匿名数値モデル・配布整合性・ルール・計算条件・構造化結果。Webへ：集計結果・計算/為替条件・品質集計・規定コード・証明。</p><p>ソース本文・抜粋・アーカイブ、対象パス・対象ソースhash、企業名・案件名・機能名、根拠・判断台帳・自由記述はOpen Estimateへ送りません。AI解析では、利用中のAIサービスのモデル提供元で処理される場合があります。</p><p>通貨：'+esc(t.display_currency)+' / ルール：'+esc(t.ruleset_ref.revision)+'</p><p>取得不足や未読がある結果は全体工数を未算出とし、部分値と品質を表示します。</p><p>公開URLを知る人はログインなしで閲覧できます。最初の公開から365日で終了し、閲覧や再送では延長しません。手元のPDFは期限後も読めます。公開には検証・証明が必要です。</p><label><input id="verify" type="checkbox">検証・証明</label><label><input id="publish" type="checkbox">365日のWeb公開</label><button id="approve">選んだ外部操作を承認する</button><p id="notice" aria-live="polite"></p>';
 document.getElementById('publish').onchange=()=>{if(document.getElementById('publish').checked)document.getElementById('verify').checked=true;};
 document.getElementById('verify').onchange=()=>{if(!document.getElementById('verify').checked)document.getElementById('publish').checked=false;};
 document.getElementById('approve').onclick=async()=>{
  if(submitting)return;const selection={verify:document.getElementById('verify').checked,publish:document.getElementById('publish').checked};
  if(!selection.verify){document.getElementById('notice').textContent='外部操作は未選択です。ローカル見積を継続します。';return;}
  let saved=false;submitting=true;document.getElementById('approve').disabled=true;
  try{const r=await call('approve_estimate_transmission',{workflow_id:d.workflow_id,terms_hash:d.terms_hash,selection,explicit_answer:'送信条件を表示した画面で、選択した外部操作の承認ボタンを押しました。'});saved=true;render(r.structuredContent);
   const prompt='見積workflow '+d.workflow_id+' の外部承認を保存しました。ローカル解析を継続し、固定結果があれば同じworkflowの未完工程を再開してください。再確認は不要です。';
   if(window.openai?.sendFollowUpMessage)await window.openai.sendFollowUpMessage({prompt});else await rpc('ui/message',{role:'user',content:[{type:'text',text:prompt}]});
  }catch(e){const n=document.getElementById('notice');if(n)n.textContent=saved?'外部承認は保存済みです。同じ承認をやり直さず既存workflowを続行してください。':e.message;if(saved)return;submitting=false;const b=document.getElementById('approve');if(b)b.disabled=false;}
 };
}
render(window.openai?.toolOutput);
</script></html>`;}
