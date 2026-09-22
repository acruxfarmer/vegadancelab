// Only opaque intent hashes and request IDs persist, never form data or authority.
export function createRequestJournal(storage,cryptoApi=globalThis.crypto){
 const prefix='vega.development.pending.v1.';
 async function acquire(scope,path,body){
  const bytes=new TextEncoder().encode(JSON.stringify([scope,path,body]));
  const hash=Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  const key=prefix+hash;
  try{
   let requestId=storage.getItem(key);
   if(!requestId){requestId=cryptoApi.randomUUID();storage.setItem(key,requestId);}
   if(!/^[0-9a-f-]{36}$/i.test(requestId))throw new Error();
   return {key,requestId};
  }catch{throw new Error('Safe retry storage is unavailable. Enable tab storage and reload before confirming.');}
 }
 function complete(entry){storage.removeItem(entry.key);}
 return {acquire,complete};
}
