import services from '../../profiles/estimate-services.json' with {type:'json'};
export interface EstimateServices {environment:'test'|'production';proof_destination:string;publication_destination:string;result_origin:string}
export function validateEstimateServices(v:EstimateServices){
 for(const [address,pathname] of [[v.proof_destination,'/mcp'],[v.publication_destination,'/api/results'],[v.result_origin,'/']]){const u=new URL(address);if(u.protocol!=='https:'||u.pathname!==pathname||u.search||u.hash||u.username||u.password||(pathname==='/'?u.origin!==address:u.href!==address))throw Error('ESTIMATE_SERVICE_CONFIGURATION_INVALID');if(v.environment==='production'&&u.origin!=='https://open-estimate.ai-orchestration.jp'||v.environment==='test'&&!u.hostname.endsWith('.workers.dev'))throw Error('ESTIMATE_SERVICE_CONFIGURATION_INVALID');}
 if(!['test','production'].includes(v.environment)||new URL(v.publication_destination).origin!==v.result_origin)throw Error('ESTIMATE_SERVICE_CONFIGURATION_INVALID');return structuredClone(v);
}
export const estimateServices=validateEstimateServices(services as EstimateServices);
