/** One confirmation surface; a saved start never turns back into an editable form. */
export function createEstimateStartWidget(bridge:string,style:string){return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${style}</style><main id="view">開始条件を確認しています</main><script>${bridge}
let current,submitting=false;
function render(d){
 if(!d?.workflow_id||current&&current.workflow_id!==d.workflow_id)return;
 current=d;
 if(d.status!=='AWAITING_START_SELECTION'){
  document.getElementById('view').innerHTML='<h1>開始選択は保存済みです</h1><section><p>同じ確認への回答は不要です。既存の取得結果と読取記録を使って続行します。</p><p>読取：'+(d.selection?.read?'選択済み':'未選択')+' / 検証：'+(d.selection?.verify?'選択済み':'未選択')+' / 公開：'+(d.selection?.publish?'選択済み':'未選択')+'</p><p id="notice" aria-live="polite"></p></section>';return;
 }
 if(!d.terms)return;
 const details='<h1>見積の対象と処理を選択</h1><section><p>対象：'+esc(d.target)+'</p>'+(d.acquisition?'<p>計測対象 '+esc(d.acquisition.totals.measurement.files)+' 件 / '+esc(d.acquisition.totals.measurement.bytes)+' bytes、補助資料 '+esc(d.acquisition.totals.supporting.files)+' 件 / '+esc(d.acquisition.totals.supporting.bytes)+' bytes、対象外 '+esc(d.acquisition.totals.excluded.files)+' 件 / '+esc(d.acquisition.totals.excluded.bytes)+' bytes</p><p>1回 '+esc(d.acquisition.limits.bytes)+' bytes / 1ファイル '+esc(d.acquisition.limits.single)+' bytes。対象外はコピーも本文読取も行いません。</p><ul>'+(d.scope??[]).map(r=>'<li>'+esc(r.path)+'：'+esc(r.role)+'</li>').join('')+'</ul>':'')+(d.acquisition?.excluded_totals_complete===false?'<p>対象外フォルダー内の件数・容量は未集計です。対象外の表示値は、集計できた分だけを示します。</p>':'')+'<p>'+esc(d.notice)+'</p><p>'+esc(d.publication_notice)+'</p><p>検証先：'+esc(d.terms.services.proof_destination)+'</p><p>公開先：'+esc(d.terms.services.publication_destination)+'</p><p>通貨：'+esc(d.terms.display_currency)+' / ルール：'+esc(d.terms.ruleset_ref.revision)+'</p><p>MCPだけへ：匿名数値モデル・配布整合性・ルール・計算条件・集計結果。Webへ：集計結果・計算/為替条件・品質コード・証明。ソース・パス・名称・根拠・判断台帳・自由記述は送信しません。</p>';
 if(d.confirmation_mode==='chat'){document.getElementById('view').innerHTML=details+'<p>開始の選択はチャットで一度だけ回答してください。このカードには開始ボタンを表示しません。</p></section>';return;}
 document.getElementById('view').innerHTML=details+'<label><input id="read" type="checkbox">読取・解析（必須）</label><label><input id="verify" type="checkbox">匿名の数値検証・証明</label><label><input id="publish" type="checkbox">1年間（365日）のWeb保存公開</label><p id="notice" aria-live="polite">このカードで一度だけ選択してください。チャットの質問フォームへの重ねての回答は不要です。</p><button id="start">選択した内容で見積を開始する</button></section>';
 document.getElementById('verify').onchange=()=>{if(!document.getElementById('verify').checked)document.getElementById('publish').checked=false;};
 const button=document.getElementById('start');button.disabled=submitting;
 button.onclick=async()=>{
  if(submitting)return;
  const selection={read:document.getElementById('read').checked,verify:document.getElementById('verify').checked,publish:document.getElementById('publish').checked};
  if(!selection.read||selection.publish&&!selection.verify){document.getElementById('notice').textContent='読取は必須です。公開を選ぶ場合は検証も選んでください。';return;}
  const id=current.workflow_id,hash=current.terms_hash;submitting=true;button.disabled=true;
  try{
   const response=await call('start_estimate_workflow',{workflow_id:id,terms_hash:hash,selection,explicit_answer:'開始画面で項目を選び「選択した内容で見積を開始する」を押しました。'});
   render(response.structuredContent);
  }catch(e){document.getElementById('notice').textContent=e.message;submitting=false;button.disabled=false;return;}
  const prompt='見積workflow '+id+' の開始選択は保存済みです。show_estimate_workflowで状態を確認し、取得済みスナップショットがあれば再利用して承認範囲内の解析・算定と選択済み工程を継続してください。開始確認や対象探索をやり直さないでください。';
  try{if(window.openai?.sendFollowUpMessage)await window.openai.sendFollowUpMessage({prompt});else await rpc('ui/message',{role:'user',content:[{type:'text',text:prompt}]});}
  catch{document.getElementById('notice').textContent='開始選択は保存済みです。通知を送れなかったため、チャットでこの見積の続行を依頼してください。再度の開始選択は不要です。';}
 };
}render(window.openai?.toolOutput);
</script></html>`;}
