import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {reportFont} from './report-font.js';
import {estimateView} from './estimate-view.js';
import type {EstimateResult,EstimateProof,PublishedEstimate} from '../contracts/estimate-result.js';
/** Worker and Node share the same embedded-font renderer; no filesystem or network. */
export async function renderStructuredEstimatePdf(result:EstimateResult,proof?:EstimateProof,publication?:PublishedEstimate){
 const v=estimateView(result,proof,publication),pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 pdf.setTitle('Open Estimate / TEST参考見積');pdf.setAuthor('Open Estimate');
 // The distributed TTF is already subsetted. A second fontkit subset can lose
 // CID/glyph mappings in Noto CJK; embed this bounded font intact in both runtimes.
 const font=await pdf.embedFont(Uint8Array.from(atob(reportFont),c=>c.charCodeAt(0)),{subset:false});
 let page=pdf.addPage([595.28,841.89]),y=790;
 const wrap=(s:string,size:number)=>{const lines:string[]=[];let part='';for(const c of s){if(part&&font.widthOfTextAtSize(part+c,size)>499){lines.push(part);part='';}part+=c;}lines.push(part);return lines;};
 const nextPage=()=>{page=pdf.addPage([595.28,841.89]);y=790;};
 const line=(s:string,size=11)=>{const parts=wrap(s,size),height=parts.length*(size*1.5+4);if(height<700&&y-height<55)nextPage();for(const part of parts){if(y<size+55)nextPage();page.drawText(part,{x:48,y,size,font,color:rgb(.13,.23,.26)});y-=size*1.5+4;}};
 line('OPEN ESTIMATE / TEST参考値',13);y-=12;line(v.headline,19);line(v.median===null?'未算出':`${v.median} 時間`,36);
 if(v.portion_median!==null)line(`取得済み部分のみの参考工数：${v.portion_median} 時間（中央値）`,15);line(v.notice);
 for(const s of v.sections){const sectionHeight=14+28+s.lines.reduce((sum,text)=>sum+wrap(text,11).length*20.5,0);if(sectionHeight<700&&y-sectionHeight<55)nextPage();y-=14;line(s.title,16);for(const text of s.lines)line(text);}
 const pages=pdf.getPages();for(let i=0;i<pages.length;i++)pages[i].drawText(`Open Estimate / TEST / ${i+1} of ${pages.length}`,{x:48,y:30,size:9,font});
 return pdf.save();
}
