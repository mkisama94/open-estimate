import { it,expect } from "vitest";
import { Miniflare,convertV4MiniflareOptions } from "miniflare";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { previewFixture } from "../fixtures/owner-preview.js";
import { PreviewTransferRepository } from "../../src/web/preview-transfer-repository.js";
import { PreviewTransferService } from "../../src/web/preview-transfer.js";
import type { CertificateDatabase } from "../../src/web/certificate-repository.js";
it("OP11/12/21 real local D1 serializes approval/submission and global capacity guards; failed batches roll back",async()=>{
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:"export default {fetch(){return new Response('isolated D1 test')}}",compatibilityDate:"2026-09-25",d1Databases:{DB:"preview-test"}})),f=previewFixture();
  try{
    const db=await mf.getD1Database("DB");
    for(const file of ["0001_certificates","0002_web_approval_grants","0003_browser_sessions","0004_preview_transfers"]){
      const text=fs.readFileSync("migrations/"+file+".sql","utf8").replace(/^--.*$/gm,"");for(const sql of text.split(";").map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
    }
    const repo=new PreviewTransferRepository(db as unknown as CertificateDatabase),service=new PreviewTransferService(repo,f.config),s=await service.create(f.creation,randomUUID(),null,f.now.value) as any;
    const approvals=await Promise.allSettled([service.approve(s.transfer_id,"owner-a",s.user_code,f.now.value),service.approve(s.transfer_id,"owner-b",s.user_code,f.now.value)]);
    expect(approvals.filter(a=>a.status==="fulfilled")).toHaveLength(1);const row=await repo.get(s.transfer_id);expect(row!.owner_id).toMatch(/^owner-[ab]$/);
    const results=await Promise.all([service.submit(s.transfer_id,f.secret,f.body,f.now.value),service.submit(s.transfer_id,f.secret,f.body,f.now.value)]);expect(results[0]).toEqual(results[1]);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM certificate_previews").first<{n:number}>())!.n).toBe(1);
    const another=await service.create(f.creation,randomUUID(),null,f.now.value) as any;
    await service.approve(another.transfer_id,"different-owner",another.user_code,f.now.value);
    // Force the second statement to fail after the DB guard succeeds: duplicate preview primary key.
    const old=await db.prepare("SELECT draft_json,draft_hash FROM certificate_previews").first<{draft_json:string;draft_hash:string}>();
    await expect(repo.commit((await repo.get(another.transfer_id))!,results[0].preview_id!,JSON.parse(old!.draft_json),old!.draft_hash,f.now.value)).rejects.toThrow();
    expect((await repo.get(another.transfer_id))!.state).toBe("APPROVED");expect((await db.prepare("SELECT COUNT(*) AS n FROM operation_guards").first<{n:number}>())!.n).toBe(0);
    // Populate 99 active transfers, then race for the single final slot in the real D1 batch implementation.
    for(let i=2;i<99;i++)await service.create(f.creation,randomUUID(),null,f.now.value);
    const race=await Promise.allSettled([service.create(f.creation,randomUUID(),null,f.now.value),service.create(f.creation,randomUUID(),null,f.now.value)]);
    expect(race.filter(x=>x.status==="fulfilled")).toHaveLength(1);expect((await db.prepare("SELECT COUNT(*) AS n FROM preview_transfers").first<{n:number}>())!.n).toBe(100);
  }finally{f.db.sqlite.close();await mf.dispose();}
},60000);
