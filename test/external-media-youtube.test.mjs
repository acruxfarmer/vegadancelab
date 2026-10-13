import test from 'node:test';
import assert from 'node:assert/strict';
import {createYouTubeConnectionAdapter} from '../src/runtime/providers/external-media-youtube.mjs';
const scope='https://www.googleapis.com/auth/youtube.readonly';
const config={clientId:'client',clientSecret:'secret',redirectUri:'https://vega-development-web.onrender.com/api/media-connections/youtube/callback',now:()=>1000};
const json=value=>new Response(JSON.stringify(value));
test('YouTube requests only read-only scope, offline authorization and explicit selection',()=>{
 const url=new URL(createYouTubeConnectionAdapter(config).authorizationUrl('a'.repeat(64)));
 assert.equal(url.searchParams.get('scope'),scope);assert.equal(url.searchParams.get('include_granted_scopes'),'false');assert.equal(url.searchParams.get('access_type'),'offline');assert.match(url.searchParams.get('prompt'),/select_account/);
});
test('YouTube account and sample proof exposes no discovered video IDs or tokens',async()=>{
 const replies=[{access_token:'access',refresh_token:'refresh',token_type:'Bearer',expires_in:3600,scope},{items:[{id:'UC123',snippet:{title:'Channel'},contentDetails:{relatedPlaylists:{uploads:'UU123'}}}]},{items:[{contentDetails:{videoId:'video123'}}]}],calls=[];
 const adapter=createYouTubeConnectionAdapter({...config,fetcher:async(url,options)=>{calls.push({url,options});return json(replies.shift());}});
 const credentials=await adapter.exchange('code'),proof=await adapter.verify(credentials);
 assert.equal(proof.accountId,'UC123');assert.equal(proof.sampleCount,1);assert.equal(JSON.stringify(proof).includes('video123'),false);assert.equal(JSON.stringify(proof).includes('refresh'),false);
 assert.match(calls[2].url,/maxResults=2/);assert.equal(calls[0].options.redirect,'error');
});
test('refresh preserves an existing refresh token when provider omits a replacement',async()=>{
 const adapter=createYouTubeConnectionAdapter({...config,fetcher:async()=>json({access_token:'new-access',token_type:'Bearer',expires_in:1800,scope})});
 const credentials=await adapter.refresh({accessToken:'old-access',refreshToken:'old-refresh',scopes:[scope]});
 assert.equal(credentials.refreshToken,'old-refresh');assert.equal(credentials.accessToken,'new-access');assert.equal(credentials.expiresAt,new Date(1801000).toISOString());
});
test('revoked refresh authorization and ambiguous channels fail closed',async()=>{
 const adapter=createYouTubeConnectionAdapter({...config,fetcher:async()=>new Response(JSON.stringify({error:'invalid_grant',error_description:'secret'}),{status:400})});
 await assert.rejects(adapter.refresh({refreshToken:'refresh',scopes:[scope]}),/reconnect_required/);
 const ambiguous=createYouTubeConnectionAdapter({...config,fetcher:async()=>json({items:[{},{}]})});
 await assert.rejects(ambiguous.verify({accessToken:'access',scopes:[scope],expiresAt:new Date(99999).toISOString()}),/provider_account_selection_required/);
});
test('no refresh token or excessive scope cannot establish a durable connection',async()=>{
 for(const result of [{access_token:'access',token_type:'Bearer',expires_in:3600,scope},{access_token:'access',refresh_token:'refresh',token_type:'Bearer',expires_in:3600,scope:scope+' upload'}]){
  const adapter=createYouTubeConnectionAdapter({...config,fetcher:async url=>url.endsWith('/revoke')?new Response(''):json(result)});
  await assert.rejects(adapter.exchange('code'),/reconnect_required|scope_mismatch/);
 }
});
