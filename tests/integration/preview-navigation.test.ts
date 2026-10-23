import {it,expect} from "vitest";
import {previewFixture} from "../fixtures/owner-preview.js";

it("keeps the owner in the browser after approval and opens only the completed private result",async()=>{
  const f=previewFixture();
  try {
    const transfer=await f.create();
    const approved=await f.approve(transfer);
    expect(approved.status).toBe(200);
    expect(approved.headers.get("Refresh")).toBe("0; url="+transfer.verification_url);
    const request=()=>new Request(transfer.verification_url,{headers:{Cookie:"owner=a"}});
    const waiting=await f.controller.fetch(request(),f.now.value);
    expect(waiting.status).toBe(200);
    expect(waiting.headers.get("Refresh")).toBe("5");
    expect(await waiting.text()).toContain("試算結果を準備しています");
    const result=await f.service.submit(transfer.transfer_id,f.secret,f.body,f.now.value);
    const ready=await f.controller.fetch(request(),f.now.value);
    expect(ready.status).toBe(303);
    expect(ready.headers.get("Location")).toBe(result.preview_url);
    const stranger=await f.controller.fetch(new Request(transfer.verification_url,{headers:{Cookie:"owner=b"}}),f.now.value);
    expect(stranger.status).toBe(404);
    expect(stranger.headers.get("Location")).toBeNull();
    f.now.value+=16*60*1000;
    const expired=await f.controller.fetch(request(),f.now.value);
    expect(expired.status).toBe(410);
    expect(expired.headers.get("Refresh")).toBeNull();
  } finally {f.db.sqlite.close();}
});
