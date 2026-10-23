export const previewUiUri="ui://open-estimate/preview.html";
export const previewUiHtml=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px/1.65 system-ui;padding:16px;color:light-dark(#15343d,#edf6f5);background:light-dark(#fff,#18252b)}a{display:inline-block;padding:12px 18px;border-radius:8px;background:light-dark(#15343d,#bde6e1);color:light-dark(#fff,#15343d)}small{display:block;margin-top:16px}</style><h2>本人用ページを作成</h2><p>送信内容を確認し、公式Webのボタンで同意すると試算を進めます。</p><p>ソースコードをOpen Estimateのサーバーへ送信することはありません。</p><p>AI解析ではモデル提供元（OpenAI、Anthropicなど、ご利用中のAIサービスのモデルを提供する事業者）へコードが送られる場合があります。</p><a id="confirm" hidden target="_blank" rel="noopener noreferrer">送信内容を確認する</a><p id="status" role="status">確認先を読み込んでいます。</p><small>本人限定の一時表示は15分。30日間の保存は結果画面で別途選択できます。発行・一般公開は行いません。</small><script>
let sequence=0;
const send=(method,params)=>window.parent.postMessage({jsonrpc:'2.0',id:++sequence,method,params},'*');
window.addEventListener('message',event=>{
 if(event.source!==window.parent || event.data?.jsonrpc!=='2.0')return;
 const message=event.data;
 if(message.id===1 && message.result)window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},'*');
 if(message.method!=='ui/notifications/tool-result')return;
 const id=message.params?.structuredContent?.transfer_id;
 if(typeof id!=='string' || !/^pt_[a-f0-9]{32}$/.test(id))return;
 const link=document.getElementById('confirm');link.href='https://open-estimate.ai-orchestration.jp/manage/preview-transfers/'+id;link.hidden=false;
 document.getElementById('status').textContent='確認画面でログインし、ローカルに表示された照合コードを入力してください。';
});
send('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'Open Estimate',version:'1.0.0'},appCapabilities:{}});
</script></html>`;
