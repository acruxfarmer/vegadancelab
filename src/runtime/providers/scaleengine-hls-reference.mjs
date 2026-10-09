import {scaleEngineAssetScope} from './scaleengine-asset-scope.mjs';

const fail=()=>{throw new Error('HLS reference rejected');};
// Prepared for review only: neither the proof runner nor ordinary delivery uses
// this helper yet. Validate literal paths before URL normalization hides traversal.
// Returned URLs remain private; callers must apply the provider-returned ticket.
export function resolveScaleEngineHlsReference(binding,reference){
 const base=new URL(scaleEngineAssetScope(binding).playbackRef);
 if(typeof reference!=='string'||!reference||reference.length>8192||/[\s\\#]/.test(reference))fail();
 const literalPath=reference.split('?')[0];
 if(literalPath.includes('%')||literalPath.split('/').some(p=>p==='.'||p==='..'))fail();
 let child;try{child=new URL(reference,base);}catch{fail();}
 const prefix=base.pathname.slice(0,base.pathname.lastIndexOf('/')+1);
 if(child.protocol!=='https:'||child.origin!==base.origin||child.username||child.password||child.hash||!child.pathname.startsWith(prefix)||child.pathname===prefix||/%|\\/.test(child.pathname))fail();
 // Only the exact literal names observed in the provider playlist are accepted.
 // Reject encoded aliases, duplicate names, unknown names and incomplete pairs.
 if(reference.includes('?')){
  const parts=reference.slice(reference.indexOf('?')+1).split('&');
  const names=parts.map(p=>p.slice(0,p.indexOf('=')));
  if(parts.length!==2||parts.some(p=>!p.includes('=')||!p.slice(p.indexOf('=')+1))||new Set(names).size!==2||!names.includes('key')||!names.includes('pass'))fail();
 }
 return child;
}
