import type {EstimateDocument} from '../contracts/document.js';
import {checkEstimateDocument} from '../contracts/document-reader.js';
import {documentPresentation} from './presentation.js';
import {jcsCanonicalize} from '../core/canonical-json.js';
const json=(v:unknown)=>JSON.stringify(JSON.parse(jcsCanonicalize(v)),null,2);
/** v1 intentionally permits no unbounded free prose. Every byte is deterministic. */
export function renderDocumentMarkdown(value:EstimateDocument):string {
 const d=checkEstimateDocument(value),p=documentPresentation(d);
 return ['# Open Estimate — TEST参考見積','',`## ${p.headline}`,'',p.median===null?'未算出':`${p.median} 時間`,
 p.portion_median===null?'':`取得済み部分のみの参考工数：${p.portion_median} 時間（中央値）`,p.notice,'',
 `人日（1日8時間）：${p.person_days?.median??'未算出'} / 参考幅：${p.hours?.p25??'未算出'} - ${p.hours?.p75??'未算出'} 時間`,
 `機能規模：${p.measurement.cfp??'未算出'} CFP / 取得充足：${d.scope_coverage}（クライアント申告）`,
 `参考金額（${p.currency}）：${p.amount?.median??'未算出'}`,`測定日時：${d.measured_at}`,'',
 '対象：合意した実装の機能規模。設計・実装・テスト。企画・日々の運用は含みません。','',
 '## 固定した結果・品質・計算条件','', '```json',json(d),'```','',
 '## 文書と証明の範囲','',
 'TEST係数による参考値です。実工数・納期・市場価格を保証しません。',
 '取得充足・品質はクライアント申告です。ソース網羅性・AI意味判断・為替の真正性・提出者本人性は独立監査していません。',
 '数値検証の証明は別ファイルです。この文書だけでは証明取得済みを意味しません。PDF自体は未署名です。',
 '文書形式：oes/estimate-document/v1 / テンプレート：oes/estimate-markdown/v1',''].join('\n');
}
export function assertMarkdownBytes(markdown:string){
 if(typeof markdown!=='string'||markdown.charCodeAt(0)===0xfeff||markdown.includes('\r')||!markdown.endsWith('\n')||markdown.endsWith('\n\n')||new TextEncoder().encode(markdown).length>262144||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(markdown))throw new Error('DOCUMENT_BYTES_INVALID');
}
export function assertDocumentMarkdown(d:EstimateDocument,markdown:string){assertMarkdownBytes(markdown);if(renderDocumentMarkdown(d)!==markdown)throw new Error('DOCUMENT_CONTENT_MISMATCH');}
export function parseDocumentMarkdown(markdown:string):EstimateDocument {
 assertMarkdownBytes(markdown);const pieces=markdown.split('\n```json\n');if(pieces.length!==2)throw new Error('DOCUMENT_TEMPLATE_INVALID');
 const end=pieces[1].indexOf('\n```\n');if(end<0)throw new Error('DOCUMENT_TEMPLATE_INVALID');
 let d:EstimateDocument;try{d=checkEstimateDocument(JSON.parse(pieces[1].slice(0,end)));}catch{throw new Error('DOCUMENT_TEMPLATE_INVALID');}
 assertDocumentMarkdown(d,markdown);return d;
}
