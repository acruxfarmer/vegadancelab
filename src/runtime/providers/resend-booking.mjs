// The only provider-specific boundary. Payload and idempotency identity are frozen.
export function createResendBookingAdapter(key,fetcher=fetch){
 return {async send(message,idempotencyKey){
  if(!key)return {state:'failed',reason:'provider_not_configured'};
  try{
   const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify(message),signal:AbortSignal.timeout(15000)});
   if(response.ok){const body=await response.json();return typeof body.id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(body.id)?{state:'provider_accepted',providerId:body.id}:{state:'uncertain',reason:'response_unconfirmed'};}
   // Never persist provider bodies: they may contain recipient or secret diagnostics.
   if(response.status>=500||[408,409,429].includes(response.status))return {state:'uncertain',reason:'response_unconfirmed'};
   return {state:'failed',reason:'provider_rejected'};
  }catch{return {state:'uncertain',reason:'response_unconfirmed'};}
 }};
}
