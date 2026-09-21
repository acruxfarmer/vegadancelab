import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=new URL('../',import.meta.url),team='team_KfFBDNDExrmnkikvz7b5Kywd',project='prj_O9L2gdHX7KJfo7Q3NAvPx4hbHH3s';
let stage='existing Vercel authentication';
try{
 const auth=JSON.parse(await readFile(path.join(process.env.APPDATA,'com.vercel.cli/Data/auth.json'),'utf8'));
 if(!auth.token)throw new Error('authentication_required');
 async function request(url,options={}){const r=await fetch(`https://api.vercel.com${url}${url.includes('?')?'&':'?'}teamId=${team}`,{...options,headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`http_${r.status}`);return r.json();}
 stage='verify protected development project';
 const p=await request(`/v9/projects/${project}`);
 if(p.id!==project||p.name!=='vega-development'||p.accountId!==team||p.ssoProtection?.deploymentType!=='all')throw new Error('project_boundary_mismatch');
 stage='prepare allowlisted front door';
 const files=[];
 for(const file of ['public/index.html','public/styles.css','public/app.js','public/integration.js','scripts/build-frontdoor.mjs','vercel.json'])files.push({file,data:(await readFile(new URL(file,root))).toString('base64'),encoding:'base64'});
 stage='create Preview deployment';
 // Omitting target means Preview; never promote or attach a production domain.
 const d=await request('/v13/deployments',{method:'POST',body:JSON.stringify({name:'vega-development',project,files,projectSettings:{framework:null,buildCommand:'node scripts/build-frontdoor.mjs',installCommand:'',outputDirectory:'dist-frontdoor'},meta:{purpose:'vega-operational-development'}})});
 const receipt={status:d.readyState||d.status,id:d.id,url:d.url,target:d.target||'preview',createdAt:new Date().toISOString()};
 await writeFile(new URL('docs/frontdoor-deployment.json',root),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}catch(e){console.log(JSON.stringify({status:'blocked',stage,code:/^http_\d+$/.test(e.message)?e.message:'authentication_or_configuration_required'}));process.exitCode=1;}
