import {it,expect} from "vitest";
import {previewFixture} from "../fixtures/owner-preview.js";
it("saves only after owner confirmation, survives preview expiry, extends and deletes",async()=>{
  const f=previewFixture();try{
    const t=await f.create();await f.approve(t);
    const r=await f.service.submit(t.transfer_id,f.secret,f.body,f.now.value);
    const base=f.config.origin+"/manage/estimates";
    const get=(url:string,owner="a")=>f.controller.fetch(new Request(url,{headers:{Cookie:"owner="+owner}}),f.now.value);
    const post=async(url:string,consent="yes")=>{
      const html=await (await get(url)).text(),csrf=html.match(/name="csrf" value="([^"]+)"/)![1];
      return f.controller.fetch(new Request(url,{method:"POST",headers:{Cookie:"owner=a",Origin:f.config.origin,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({csrf,consent})}),f.now.value);
    };
    const url=base+"/save/"+r.preview_id;
    expect((await get(url)).status).toBe(200);expect(f.db.count("saved_estimates")).toBe(0);
    expect((await post(url,"no")).status).toBe(403);
    expect((await get(url,"b")).status).toBe(404);
    const saved=await post(url);expect(saved.status).toBe(303);const link=saved.headers.get("Location")!;
    await post(url);expect(f.db.count("saved_estimates")).toBe(1);
    f.now.value+=86400000;
    expect((await get(link)).status).toBe(200);expect((await get(link,"b")).status).toBe(404);
    expect((await get(base)).status).toBe(200);
    expect((await post(link+"/extend")).status).toBe(303);
    expect((await post(link+"/delete")).status).toBe(303);
    expect((await get(link)).status).toBe(404);expect(f.db.count("saved_estimates")).toBe(0);
  }finally{f.db.sqlite.close();}
});
