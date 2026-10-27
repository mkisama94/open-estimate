import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WorkspaceSession, scanStructure } from '../../src/mcp/workspace-session.js';
import { workspaceContext } from '../../src/collector/workspace-context.js';
import { getWorkspaceRoot } from '../../src/collector/safe-paths.js';
let root: string;
beforeAll(async () => {
 root = await fs.mkdtemp(path.join(os.tmpdir(), 'oes-discovery-'));
 await fs.mkdir(path.join(root,'src')); await fs.mkdir(path.join(root,'node_modules'));
 await fs.writeFile(path.join(root,'src','app.ts'),'SECRET_SOURCE_BODY');
 await fs.writeFile(path.join(root,'.env'),'SECRET_ENV');
});
function host(paths?: string[]) { return { getClientCapabilities: () => paths === undefined ? {} : { roots: {} }, listRoots: vi.fn(async () => ({roots: paths!.map(p => ({uri: pathToFileURL(p).href}))})) }; }
describe('Workspace discovery and confirmation',()=>{
 it('scans structure without reading file content',async()=>{
  const spy=vi.spyOn(fs,'readFile');
  try { const scan=await scanStructure(root); expect(scan.files).toBe(1); expect(scan.categories.source).toBe(1); expect(scan.excluded_sample).toContain('.env'); expect(spy).not.toHaveBeenCalled(); } finally {spy.mockRestore();}
 });
 it('requires a candidate and confirmation, supports cancellation',async()=>{
  const s=new WorkspaceSession(host() as any,()=>{});
  await expect(s.requireRoot()).rejects.toThrow('WORKSPACE_CONFIRMATION_REQUIRED');
  expect((await s.discover({})).status).toBe('PROJECT_SELECTION_REQUIRED');
  const c=await s.discover({context_path:root}); expect(c.origin).toBe('conversation_context_unverified');
  await expect(s.requireRoot()).rejects.toThrow('WORKSPACE_CONFIRMATION_REQUIRED');
  await expect(s.confirm({candidate_id:'invented',user_confirmed:true})).rejects.toThrow('CANDIDATE_NOT_FOUND');
  await s.confirm({candidate_id:c.candidate_id!,user_confirmed:false});
  await expect(s.requireRoot()).rejects.toThrow('WORKSPACE_CONFIRMATION_REQUIRED');
 });
 it('prefers roots and invalidates confirmation when they change',async()=>{
  const client=host([root]); const cleared=vi.fn(); const s=new WorkspaceSession(client as any,cleared);
  const c=await s.discover({}); expect(c.origin).toBe('mcp_roots');
  await s.confirm({candidate_id:c.candidate_id!,user_confirmed:true}); expect(await s.requireRoot()).toBe(root);
  client.listRoots.mockResolvedValue({roots:[]});
  await expect(s.requireRoot()).rejects.toThrow('PROJECT_CHANGED_RECONFIRM_REQUIRED');
  await expect(s.requireRoot()).rejects.toThrow('WORKSPACE_CONFIRMATION_REQUIRED'); expect(cleared).toHaveBeenCalled();
 });
 it('does not pick from multiple roots or bypass failed roots',async()=>{
  const client=host([root,path.dirname(root)]); const s=new WorkspaceSession(client as any,()=>{});
  expect((await s.discover({})).status).toBe('PROJECT_SELECTION_REQUIRED');
  await expect(s.discover({context_path:process.cwd()})).rejects.toThrow('PROJECT_NOT_IN_HOST_ROOTS');
  client.listRoots.mockRejectedValue(new Error('offline'));
  await expect(s.discover({context_path:root})).rejects.toThrow('HOST_ROOTS_UNAVAILABLE');
 });
 it('rejects relative paths, traversal and excluded subdirectories',async()=>{
  const s=new WorkspaceSession(host() as any,()=>{});
  await expect(s.discover({context_path:'src'})).rejects.toThrow('ABSOLUTE_PROJECT_PATH_REQUIRED');
  await expect(s.discover({context_path:root,relative_path:'../'})).rejects.toThrow();
  await expect(s.discover({context_path:root,relative_path:'node_modules'})).rejects.toThrow('EXCLUDED_TARGET_DIRECTORY');
 });
 it('narrows scope and invalidates earlier candidate ids',async()=>{
  const s=new WorkspaceSession(host() as any,()=>{}); const old=await s.discover({context_path:root}); const c=await s.discover({context_path:root,relative_path:'src'});
  await expect(s.confirm({candidate_id:old.candidate_id!,user_confirmed:true})).rejects.toThrow('CANDIDATE_NOT_FOUND');
  await s.confirm({candidate_id:c.candidate_id!,user_confirmed:true}); expect(await s.requireRoot()).toBe(path.join(root,'src'));
 });
 it('isolates overlapping async requests without changing env',async()=>{
  const original=process.env.OES_WORKSPACE_ROOT;
  expect(await Promise.all(['A','B'].map(p=>workspaceContext.run(p,async()=>{await Promise.resolve();return getWorkspaceRoot();})))).toEqual(['A','B']);
  expect(process.env.OES_WORKSPACE_ROOT).toBe(original);
 });
});
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../../src/mcp/server.js';
it('negotiates real MCP roots and invalidates pending candidates on notification',async()=>{
 const [ct,st]=InMemoryTransport.createLinkedPair();
 const server=createMcpServer(); const client=new Client({name:'roots-test',version:'1'},{capabilities:{roots:{listChanged:true}}});
 client.setRequestHandler(ListRootsRequestSchema,async()=>({roots:[{uri:pathToFileURL(root).href}]}));
 await server.connect(st);await client.connect(ct);
 try {
  await client.listTools();
  const c=await client.callTool({name:'discover_workspace',arguments:{}});
  expect(c.isError).not.toBe(true); expect(c.structuredContent?.origin).toBe('mcp_roots');
  await client.notification({method:'notifications/roots/list_changed'});
  const stale=await client.callTool({name:'confirm_workspace',arguments:{candidate_id:c.structuredContent?.candidate_id,user_confirmed:true}});
  expect(stale.isError).toBe(true);
  const next=await client.callTool({name:'discover_workspace',arguments:{}});
  const accepted=await client.callTool({name:'confirm_workspace',arguments:{candidate_id:next.structuredContent?.candidate_id,user_confirmed:true}});
  expect(accepted.structuredContent?.workspace_root).toBe(root);
  const prep=await client.callTool({name:'prepare_repository',arguments:{}});
  expect(prep.isError,JSON.stringify(prep)).not.toBe(true);
  expect((prep.structuredContent?.manifest as any).files.some((f:any)=>f.path==='src/app.ts')).toBe(true);
 }finally{await client.close();await server.close();}
});
