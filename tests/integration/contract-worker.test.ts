import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import net from 'node:net';
it('validates UI and Web transfer contracts inside the actual Worker request context',async()=>{
 const listener=net.createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));
 const port=(listener.address() as net.AddressInfo).port;await new Promise<void>(resolve=>listener.close(()=>resolve()));
 const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','tests/fixtures/contract-worker-probe.ts','--config','wrangler.mcp.jsonc','--local','--port',String(port)],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false',BROWSER:'none'}});
 let logs='',stopped=false;child.stdout.on('data',b=>logs=(logs+b).slice(-2000));child.stderr.on('data',b=>logs=(logs+b).slice(-2000));child.on('exit',()=>{stopped=true});child.on('error',e=>{logs=e.message;stopped=true});
 try{let result:any;const deadline=Date.now()+45000;while(!result&&!stopped&&Date.now()<deadline){try{result=await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(2000)}).then(r=>r.json());}catch{await new Promise(r=>setTimeout(r,250));}}
 expect(result,logs).toEqual({ok:true,stage:'scope',rejected:2});
 }finally{child.kill();await new Promise<void>(resolve=>{if(stopped)resolve();else{child.once('exit',()=>resolve());setTimeout(resolve,3000).unref();}});}
},60000);
