import { ApplicationError } from '../application.mjs';
import {createMediaPrincipalVerifier} from './media-resource-foundation.mjs';
import {revokeSession} from './sign-out.mjs';
import {createDirectPayments,sandboxPaymentEnabled,paymentPreparationEnabled} from './direct-payments.mjs';
import {createRefundWorkflow} from './refund-workflow.mjs';
import {createSquareRefundAdapter,refundTransportEnabled,refundProgramTransportEnabled,REFUND_CANDIDATE} from './providers/square-refunds.mjs';
import {reconcileRefundInventory} from '../refund-reconciliation.mjs';
import {createRefundProgram} from './refund-program-workflow.mjs';

const origin='https://cjdoczrxcjynjhgpgqop.supabase.co';
export async function readJson(req,limit=16384){
 if(!req.headers['content-type']?.startsWith('application/json'))throw new ApplicationError('JSON required',415);
 let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw new ApplicationError('Request too large',413);chunks.push(chunk);}
 try{const value=JSON.parse(Buffer.concat(chunks).toString());if(!value||Array.isArray(value)||typeof value!=='object')throw new Error();return value;}catch{throw new ApplicationError('Invalid JSON');}
}
export function createApplicationApi(env,store,fetcher=fetch){
 const payments=createDirectPayments(env,store,fetcher);
 const refundAdapter=createSquareRefundAdapter(env,fetcher);
 const refunds=createRefundWorkflow({store,adapter:refundAdapter,enabled:()=>refundTransportEnabled(env)});
 const program=createRefundProgram({store,adapter:refundAdapter,enabled:purchaseId=>refundProgramTransportEnabled(env)&&env.VEGA_REFUND_PROGRAM_PURCHASE_ID===purchaseId});
 const key=env.SUPABASE_PUBLISHABLE_KEY;
 const configured=()=>{if(!key||env.SUPABASE_URL!==origin)throw new ApplicationError('Application authentication is not configured',503);};
 async function principal(req,unscoped=false){
  configured();const token=req.headers.authorization;
  if(typeof token!=='string'||!/^Bearer [A-Za-z0-9._-]+$/.test(token)||token.length>8192)throw new ApplicationError('Sign in to continue',401);
  const response=await fetcher(`${origin}/auth/v1/user`,{headers:{apikey:key,Authorization:token},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new ApplicationError(response.status>=500?'Authentication unavailable':'Session expired or invalid',response.status>=500?503:401);
  const user=await response.json();if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id||''))throw new ApplicationError('Invalid session',401);const tenantId=req.headers['x-vega-tenant'],businessId=req.headers['x-vega-business'];
  if(unscoped)return {userId:user.id,email:user.email,confirmed:!!user.email_confirmed_at&&user.is_anonymous!==true};
  if(tenantId===undefined&&businessId===undefined)return user.id;
  if(typeof tenantId!=='string'||typeof businessId!=='string'||!tenantId.length||!businessId.length||tenantId.length>128||businessId.length>128)throw new ApplicationError('Choose an authorized business',403);
  return {userId:user.id,tenantId,businessId};
 }
 return async(req,res)=>{
  const url=new URL(req.url,'http://vega.local');if(!url.pathname.startsWith('/api/'))return false;
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try{
   const placementPlay=url.pathname.match(/^\/api\/media\/placements\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/play$/i);
   if(placementPlay){
    if(req.method!=='GET')throw new ApplicationError('Method not allowed',405);
    if(url.search)throw new ApplicationError('Invalid media link',400);
    if(!store?.mediaPlacementPlayback)throw new ApplicationError('Media temporarily unavailable',503);
    let viewerId=null;
    if(req.headers.authorization!==undefined){configured();viewerId=(await createMediaPrincipalVerifier({authOrigin:origin,publishableKey:key,fetcher})(req)).userId;}
    const bytes=await store.mediaPlacementPlayback(viewerId,placementPlay[1]);
    res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':bytes.length,'Cache-Control':'private, no-store','Content-Disposition':'inline','X-Content-Type-Options':'nosniff'});res.end(bytes);return true;
   }
   if(url.pathname.startsWith('/api/public/')){
    if(req.method!=='GET')throw new ApplicationError('Method not allowed',405);
    const match=url.pathname.match(/^\/api\/public\/studios\/([a-z0-9][a-z0-9-]{0,79})$/);
    if(!match||url.search)throw new ApplicationError('Studio not found',404);
    if(!store?.publicDiscovery)throw new ApplicationError('Public schedule temporarily unavailable',503);
    send(200,await store.publicDiscovery(match[1]));return true;
   }
   if(url.pathname==='/api/config'&&req.method==='GET'){send(200,{environment:'development',squareEnabled:sandboxPaymentEnabled(env),paymentMode:sandboxPaymentEnabled(env)?'sandbox_direct_only':'disabled',externalEffects:'disabled',authenticationConfigured:!!key,applicationConfigured:!!store});return true;}
   if(url.pathname==='/api/auth/sign-up'&&req.method==='POST'){
    configured();const body=await readJson(req);
    if(Object.keys(body).some(k=>!['email','password','studio','classId'].includes(k))||typeof body.email!=='string'||body.email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)||typeof body.password!=='string'||body.password.length<12||body.password.length>1024||! /^[a-z0-9][a-z0-9-]{0,79}$/.test(body.studio||'')||body.classId!==undefined&&(typeof body.classId!=='string'||! /^[A-Za-z0-9-]{1,128}$/.test(body.classId)))throw new ApplicationError('Enter a valid email and a password of at least 12 characters',400);
    if(!store?.publicDiscovery)throw new ApplicationError('Account setup unavailable',503);
    await store.publicDiscovery(body.studio);
    // Fixed application origin, never a caller-supplied redirect or role claim.
    const redirect=new URL('https://vega-development-web.onrender.com/join.html');redirect.searchParams.set('studio',body.studio);if(body.classId)redirect.searchParams.set('class',body.classId);
    const response=await fetcher(`${origin}/auth/v1/signup?redirect_to=${encodeURIComponent(redirect.href)}`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email:body.email.trim(),password:body.password}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new ApplicationError(response.status===429?'Please wait before trying again.':'Account creation could not be completed. Try signing in if you already have an account.',response.status===429?429:response.status>=500?503:400);
    const result=await response.json();
    if(typeof result.access_token==='string'&&typeof result.refresh_token==='string'&&Number.isFinite(result.expires_in)&&result.expires_in>60)send(200,{accessToken:result.access_token,refreshToken:result.refresh_token,expiresIn:result.expires_in});
    else send(200,{verificationRequired:true,message:'Check your email to confirm your account, then return here to sign in. If you already have an account, sign in.'});return true;
   }
   if(url.pathname==='/api/onboarding'&&req.method==='POST'){
    const actor=await principal(req,true);
    if(!actor.confirmed||typeof actor.email!=='string'){send(200,{status:'verification_required'});return true;}
    if(!store?.onboard)throw new ApplicationError('Account setup unavailable',503);
    send(200,await store.onboard(actor.userId,await readJson(req),actor.email));return true;
   }
   if(['/api/auth/sign-in','/api/auth/refresh'].includes(url.pathname)&&req.method==='POST'){
    configured();const body=await readJson(req);
    const refreshing=url.pathname==='/api/auth/refresh';
    if(refreshing){if(typeof body.refreshToken!=='string'||!body.refreshToken.length||body.refreshToken.length>8192)throw new ApplicationError('Session expired or invalid',401);}
    else if(typeof body.email!=='string'||body.email.length>254||typeof body.password!=='string'||body.password.length>1024)throw new ApplicationError('Email and password required');
    const response=await fetcher(`${origin}/auth/v1/token?grant_type=${refreshing?'refresh_token':'password'}`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify(refreshing?{refresh_token:body.refreshToken}:{email:body.email,password:body.password}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new ApplicationError(refreshing?'Session expired or invalid':'Unable to sign in with these details',response.status>=500?503:401);
    const session=await response.json();
    if(typeof session.access_token!=='string'||typeof session.refresh_token!=='string'||!Number.isFinite(session.expires_in)||session.expires_in<=60)throw new ApplicationError('Authentication unavailable',503);
    send(200,{accessToken:session.access_token,access_token:session.access_token,refreshToken:session.refresh_token,expiresIn:session.expires_in});return true;
   }
   if(url.pathname==='/api/auth/sign-out'&&req.method==='POST'){
    configured();const body=await readJson(req);
    const termination=await revokeSession({origin,key,authorization:req.headers.authorization,refreshToken:body.refreshToken,fetcher});
    // Security termination has already completed. Neither DB nor B2 may delay
    // its response. Persist evidence asynchronously; report capture gaps safely.
    if(store?.recordRevocation)void Promise.resolve().then(()=>store.recordRevocation({...termination,userId:req.headers['x-vega-tenant']&&req.headers['x-vega-business']?{userId:termination.userId,tenantId:req.headers['x-vega-tenant'],businessId:req.headers['x-vega-business']}:termination.userId})).catch(()=>console.error('Revocation evidence capture uncertain; provider termination remains effective'));
    send(200,{signedOut:true});return true;
   }
   const userId=await principal(req);
   if(!store)throw new ApplicationError('Application database handoff is pending',503);
   if(url.pathname==='/api/businesses'&&req.method==='GET'){send(200,{businesses:await store.memberships(userId)});return true;}
   const refundReport=url.pathname.match(/^\/api\/commerce\/purchases\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/refund-reconciliation$/i);
   if(refundReport){
    if(req.method!=='GET')throw new ApplicationError('Method not allowed',405);
    if([...url.searchParams.keys()].some(k=>k!=='operationId')||url.searchParams.getAll('operationId').length>1)throw new ApplicationError('Query parameters not accepted');
    const operationId=url.searchParams.get('operationId')??undefined;
    if(operationId&&!/^[a-f0-9]{40}$/.test(operationId))throw new ApplicationError('Invalid operation');
    const c=await store.refundContext(userId,refundReport[1],operationId,'finance.read');
    const evidence=await refundAdapter.inventory(c.purchase);
    // Recheck current membership and source state after external acquisition.
    const after=await store.refundContext(userId,refundReport[1],operationId,'finance.read');
    if(c.revision!==after.revision||c.stateDigest!==after.stateDigest||JSON.stringify(c.purchase)!==JSON.stringify(after.purchase))throw new ApplicationError('Purchase changed during reconciliation; refresh before review',409);
    const report=reconcileRefundInventory({purchase:c.purchase,operations:c.operations,evidence,at:new Date().toISOString()});
    // Provider identifiers and raw evidence remain server-side.
    const facts=c.programFacts;
    send(200,{contract:report.contract,purchaseId:report.purchaseId,status:report.status,reasonCodes:report.reasonCodes,completedMinor:report.completedMinor??null,pendingMinor:report.pendingMinor??null,remainingProviderMinor:report.remainingProviderMinor??null,currency:c.purchase.currency,matchedCount:report.matches.length,externalCount:report.external.length,cutoff:report.cutoff??null,evidenceDigest:report.evidenceDigest??null,revision:c.revision,executionAuthorized:false,readOnly:true,historicalCompleteness:'unknown',business:facts?{status:facts.status,reasonCodes:facts.reasonCodes,units:facts.units,remainingBusinessMinor:facts.remainingBusinessMinor??0,cutoff:facts.cutoff??null,policy:facts.policy}:null});return true;
   }
   const programAction=url.pathname.match(/^\/api\/commerce\/refund-program\/(prepare|execute|reconcile|release|external|resolve|bind)$/);
   if(programAction){
    if(req.method!=='POST')throw new ApplicationError('Method not allowed',405);
    if(url.search)throw new ApplicationError('Query parameters not accepted');
    const result=await program[programAction[1]](userId,await readJson(req));
    const o=result.refund;
    send(200,{...(o?{refund:{id:o.id,purchaseId:o.purchaseId,status:o.status,amountMinor:o.amountMinor,currency:o.currency}}:{}),...(result.independentReceipt?{independentReceipt:result.independentReceipt}:{}),...(result.externalRecorded!==undefined?{externalRecorded:result.externalRecorded}:{}),executionAuthorized:false});return true;
   }
   const refundAction=url.pathname.match(/^\/api\/commerce\/refunds\/(prepare|execute|reconcile|release)$/);
   if(refundAction){
    if(req.method!=='POST')throw new ApplicationError('Method not allowed',405);
    if(url.search)throw new ApplicationError('Query parameters not accepted');
    const result=await refunds[refundAction[1]](userId,await readJson(req));
    send(200,result);return true;
   }
   const refundAssessment=url.pathname.match(/^\/api\/commerce\/purchases\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/refund-assessment$/i);
   if(refundAssessment){
    if(req.method!=='GET')throw new ApplicationError('Method not allowed',405);
    if(url.search)throw new ApplicationError('Assessment query parameters are not accepted',400);
    const assessment=await store.assessRefund(userId,refundAssessment[1]);
    send(assessment.status==='denied'?403:200,assessment);return true;
   }
   const mediaPlay=url.pathname.match(/^\/api\/media\/([A-Za-z0-9-]{1,128})\/play$/);
   if(mediaPlay&&req.method==='GET'){
    if([...url.searchParams.keys()].some(k=>k!=='revision')||url.searchParams.getAll('revision').length!==1)throw new ApplicationError('Invalid media link');
    const bytes=await store.mediaPlayback(userId,mediaPlay[1],Number(url.searchParams.get('revision')));
    res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':bytes.length,'Cache-Control':'private, no-store','Content-Disposition':'inline','X-Content-Type-Options':'nosniff'});res.end(bytes);return true;
   }
   if(url.pathname==='/api/app'&&req.method==='GET'){
    const view=await store.read(userId),staff=view.context?.role==='staff';
    const allowed=p=>!staff||view.staffAccess?.permissions?.includes(p)===true;
    const pay=allowed('sales.manage')&&sandboxPaymentEnabled(env),refund=staff&&allowed('refunds.manage');
    send(200,{...view,squareEnabled:pay,paymentExecution:{enabled:pay,purchaseId:pay?env.VEGA_SANDBOX_PURCHASE_ID:null},refundWorkflow:{enabled:refund&&refundTransportEnabled(env),purchaseId:refund?REFUND_CANDIDATE:null},refundProgram:{enabled:refund&&refundProgramTransportEnabled(env),purchaseId:refund&&refundProgramTransportEnabled(env)?env.VEGA_REFUND_PROGRAM_PURCHASE_ID:null}});return true;}
   const operation=url.pathname.match(/^\/api\/recovery\/operations\/([a-f0-9]{64})$/);
   if(operation&&req.method==='GET'){const result=await store.operation(userId,operation[1]);send(result.pending?202:200,result);return true;}
   if(req.method!=='POST')throw new ApplicationError('Method not allowed',405);
   if(url.pathname==='/api/commerce/payments/prepare'){
    if(!paymentPreparationEnabled(env))throw new ApplicationError('Operation unavailable',404);
    send(202,await payments.prepare(userId,await readJson(req)));return true;
   }
   if(['/api/commerce/payments','/api/commerce/payments/resume'].includes(url.pathname)){
    if(!sandboxPaymentEnabled(env))throw new ApplicationError('Operation unavailable',404);
    const input=await readJson(req),result=await (url.pathname.endsWith('/resume')?payments.resume(userId,input):payments.start(userId,input));
    send(result.status==='succeeded'&&result.fulfillmentStatus==='issued'?200:202,result);return true;
   }
   const body=await readJson(req,url.pathname==='/api/media/save'?360000:16384),routes={'/api/entitlements/products':'entitlement-product','/api/entitlements/issue':'issue-entitlement','/api/credits/issue':'issue-credit','/api/classes/cancel':'cancel-class','/api/classes/policy':'class-policy','/api/reservations':'reserve','/api/classes':'class','/api/participants':'participant','/api/preferences':'preferences','/api/notifications':'notification'};
   if(url.pathname==='/api/classes/edit/review'){send(200,await store.reviewClassEdit(userId,body));return true;}
   if(url.pathname==='/api/classes/duplicate/review'){send(200,await store.reviewClassDuplicate(userId,body));return true;}
   routes['/api/media/groups']='media-group-save';routes['/api/media/organize']='media-organize';routes['/api/media/save']='media-save';routes['/api/media/publish']='media-publish';routes['/api/media/unpublish']='media-unpublish';
   routes['/api/classes/duplicate']='duplicate-class';
   routes['/api/commerce/drafts']='purchase-draft';
   routes['/api/commerce/front-desk/sales']='front-desk-sale';
   routes['/api/staff/register']='staff-register';
   routes['/api/staff/roles']='staff-role-set';
   routes['/api/profile']='profile-update';
   routes['/api/waivers/publish']='waiver-publish';
   routes['/api/waivers/accept']='waiver-accept';
   let action=url.pathname==='/api/classes/edit'?'edit-class':routes[url.pathname],id;
   const match=url.pathname.match(/^\/api\/reservations\/([A-Za-z0-9-]{1,128})\/(cancel|correct-cancellation|attendance|promote)$/);
   if(match){id=match[1];action=match[2];}
   if(!action)throw new ApplicationError('Operation unavailable',404);
   const result=await store.command(userId,{action,id,body});
   if(result.independentReceipt&&result.independentReceipt.state!=='acknowledged'){
    send(202,{pending:true,independentReceipt:result.independentReceipt,message:'Your change is recorded locally and awaits independent recovery confirmation. Retry the same details to check; do not submit a new operation.'});
   }else send(200,result);
  }catch(error){send(error instanceof ApplicationError?error.status:503,{error:error instanceof ApplicationError?error.message:'Application temporarily unavailable'});}
  return true;
 };
}
