import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const {token}=JSON.parse(await readFile(path.join(process.env.APPDATA,'com.vercel.cli/Data/auth.json'),'utf8'));
const projectId='prj_O9L2gdHX7KJfo7Q3NAvPx4hbHH3s',teamId='team_KfFBDNDExrmnkikvz7b5Kywd';
async function get(endpoint){const r=await fetch(`https://api.vercel.com${endpoint}${endpoint.includes('?')?'&':'?'}teamId=${teamId}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`Vercel read failed (${r.status})`);return r.json();}
const p=await get(`/v9/projects/${projectId}`),list=await get(`/v6/deployments?projectId=${projectId}&limit=30`);
if(p.id!==projectId||p.name!=='vega-development'||p.link?.productionBranch!=='main'||p.link?.repo!=='vegadancelab'||p.ssoProtection?.deploymentType!=='all')throw new Error('Preview project boundary changed');
const previews=list.deployments.filter(d=>d.target===null&&d.readyState==='READY');if(!previews.length)throw new Error('Existing READY Preview required');
const expected=process.argv[2];
const result={projectId,productionBranch:p.link.productionBranch,protection:p.ssoProtection,production:list.deployments.filter(d=>d.target==='production').map(d=>({id:d.uid,url:d.url})),preview:previews.slice(0,2).map(d=>({id:d.uid,url:d.url,commit:d.meta?.githubCommitSha})),candidate:expected?list.deployments.filter(d=>d.meta?.githubCommitSha===expected).map(d=>({id:d.uid,url:d.url,target:d.target,state:d.readyState,branch:d.meta?.githubCommitRef,commit:d.meta?.githubCommitSha})):[]};
if(result.candidate.some(d=>d.target!==null||d.branch!=='preview/vega-development'))throw new Error('Candidate is not expected Preview');
await writeFile(new URL('../docs/member-booking-preview.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
