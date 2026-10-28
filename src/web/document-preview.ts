import type {TrustedDocumentKey,DocumentProof} from '../contracts/document.js';
import {verifyDocumentProof} from '../proof/verify.js';
import {assertMarkdownBytes} from '../document/markdown.js';
import {decodeBase64url} from '../proof/crypto.js';
export const documentPreviewHeaders={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store, max-age=0','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'};
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Restricted Markdown: no raw HTML, URLs, images, embeds or badge generation. */
export function safeMarkdown(markdown:string){let code=false;return markdown.split('\n').map(line=>{if(line.startsWith('```')){code=!code;return code?'<pre><code>':'</code></pre>';}if(code)return escape(line)+'\n';const h=line.match(/^(#{1,3}) (.*)$/);return h?`<h${h[1].length}>${escape(h[2])}</h${h[1].length}>`:line?`<p>${escape(line)}</p>`:'';}).join('\n')+(code?'</code></pre>':'');}
function page(content:string){return '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open Estimate 文書表示</title><style>body{font:16px/1.7 system-ui;color:#173e35;max-width:900px;margin:32px auto;padding:20px;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f6f4;padding:16px}aside{border:2px solid #527768;padding:16px}h2{margin-top:32px}article>h2:first-of-type+p{font-size:42px;font-weight:750;line-height:1.3}summary{cursor:pointer}</style>'+content+'</html>';}
export function documentSelectionPage(){
 const html=page('<h1>見積文書を表示</h1><p>estimate.md と任意の proof.json を選び、「Webで表示」を押してください。ログイン・保存は行いません。URLだけでは後日復元できません。</p><form method="post" action="/preview" enctype="application/x-www-form-urlencoded"><label>Markdown <input id="md" type="file" accept=".md,text/markdown" required></label><p><label>任意の証明 <input id="proof" type="file" accept=".json,application/json"></label></p><input type="hidden" name="format" value="oes/document-display/v1"><input type="hidden" name="encoding" value="utf8-base64url"><input type="hidden" name="markdown" id="text"><input type="hidden" name="proof" id="prooftext"><button>Webで表示（文書を送信）</button></form><p id="error"></p><script>document.querySelector("form").onsubmit=async e=>{e.preventDefault();const md=document.getElementById("md").files[0],p=document.getElementById("proof").files[0];if(!md||md.size>262144||p&&p.size>32768){document.getElementById("error").textContent="文書または証明の容量上限を超えています。";return;}const encode=async file=>{let binary="";for(const byte of new Uint8Array(await file.arrayBuffer()))binary+=String.fromCharCode(byte);return btoa(binary).split("+").join("-").split("/").join("_").split("=").join("");};document.getElementById("text").value=await encode(md);document.getElementById("prooftext").value=p?await encode(p):"";e.target.submit();};</script>');
 return new Response(html,{headers:{...documentPreviewHeaders,'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}});
}
export async function documentPreview(request:Request,keys:readonly TrustedDocumentKey[]=[]):Promise<Response>{
 if(request.method==='GET')return documentSelectionPage();
 if(request.method!=='POST')return new Response('Method not allowed',{status:405,headers:{...documentPreviewHeaders,Allow:'GET, POST'}});
 const error=(status:number)=>new Response(page('<h1>文書を表示できません</h1><p>形式または容量を確認してください。文書は保存していません。</p>'),{status,headers:documentPreviewHeaders});
 if(request.headers.has('content-encoding')||!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??''))return error(400);
 if(Number(request.headers.get('content-length'))>1048576)return error(413);
 const reader=request.body?.getReader();if(!reader)return error(400);let length=0;const chunks:Uint8Array[]=[];
 try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>1048576){await reader.cancel();return error(413);}chunks.push(value);}}catch{return error(400);}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const b of chunks){bytes.set(b,offset);offset+=b.length;}
 try{
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(/%(?![a-f0-9]{2})/i.test(raw))return error(400);
  // Reject malformed percent-encoded UTF-8 before URLSearchParams can replace it.
  for(const part of raw.split('&'))for(const value of part.split('='))decodeURIComponent(value.replace(/\+/g,' '));
  const params=new URLSearchParams(raw);if([...params.keys()].some(k=>!['format','encoding','markdown','proof'].includes(k))||[...params.keys()].some(k=>params.getAll(k).length!==1)||params.get('format')!=='oes/document-display/v1'||params.getAll('markdown').length!==1)return error(400);
  const encoding=params.get('encoding');if(encoding!==null&&encoding!=='utf8-base64url')return error(400);
  const decode=(s:string)=>encoding&&s?new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(decodeBase64url(s)):s;
  const markdown=decode(params.get('markdown')!),proofText=decode(params.get('proof')??'');
  if(new TextEncoder().encode(markdown).length>262144||new TextEncoder().encode(proofText).length>32768)return error(413);
  assertMarkdownBytes(markdown);
  let badge='<strong>未証明の文書</strong><p>証明データは添付されていません。</p>';
  if(proofText){let proof:unknown;try{proof=JSON.parse(proofText);}catch{return error(400);}const v=await verifyDocumentProof(markdown,proof,keys),valid=v.schema==='VALID'&&v.signature==='VALID'&&v.document==='MATCH'&&v.issuer==='TRUSTED';
   const statement=v.schema==='VALID'?(proof as DocumentProof).statement:null;
   badge='<strong>'+(valid?(statement?.environment==='test'?'TEST環境：':'')+'数値整合の証明を確認':'証明を確認できません')+'</strong><details><summary>署名・文書一致・発行元・失効状態</summary><p>'+escape(JSON.stringify(v))+'</p>'+(statement?'<p>付属証明の申告情報：'+escape(statement.proof_id)+' / '+escape(statement.issuer)+' / '+escape(statement.environment)+' / '+escape(statement.verification)+'</p>':'')+'<p>署名・文書一致・発行元信頼を個別に確認しています。現在の失効状態：未確認。提出者本人性・ソース網羅性・AI意味判断は独立監査していません。</p></details>';}
  return new Response(page('<aside aria-label="証明の検証状態">'+badge+'</aside><p>保存なし表示。再表示には元の文書が必要です。</p><article aria-label="受信文書">'+safeMarkdown(markdown)+'</article>'),{headers:documentPreviewHeaders});
 }catch{return error(400);}
}
