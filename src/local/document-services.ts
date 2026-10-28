import services from '../../profiles/document-services.json' with {type:'json'};
/** Operator-owned package configuration. Never accept destination overrides from tool input. */
export function validateDocumentServices(value:{environment:string;proof_destination:string;web_destination:string}){
 if(!['test','production'].includes(value.environment))throw new Error('DOCUMENT_SERVICE_CONFIGURATION_INVALID');
 for(const [address,pathname] of [[value.proof_destination,'/mcp'],[value.web_destination,'/preview']]){
  const url=new URL(address);
  if(url.protocol!=='https:'||url.pathname!==pathname||url.search||url.hash||url.username||url.password||url.href!==address)throw new Error('DOCUMENT_SERVICE_CONFIGURATION_INVALID');
  if(value.environment==='production'&&url.origin!=='https://open-estimate.ai-orchestration.jp')throw new Error('DOCUMENT_SERVICE_CONFIGURATION_INVALID');
  if(value.environment==='test'&&!url.hostname.endsWith('.workers.dev'))throw new Error('DOCUMENT_SERVICE_CONFIGURATION_INVALID');
 }
 return value;
}
const configured=validateDocumentServices(services);
export const PROOF_DESTINATION=configured.proof_destination;
export const WEB_DESTINATION=configured.web_destination;
