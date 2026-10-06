import {ApplicationError} from './application.mjs';

const text=(value,max=500)=>typeof value==='string'?value.slice(0,max):'';
const unique=(rows,id)=>rows.filter(r=>r?.id===id).length===1;
// Only the database's deliberately published projection enters this function.
// Rebuild every response field: never spread source records into a public result.
export function publicDiscovery(source,at=new Date().toISOString()){
 if(!source?.studio)throw new ApplicationError('Studio not found',404);
 const s=source.studio,now=Date.parse(at);
 if(!Number.isFinite(now))throw new ApplicationError('Schedule unavailable',503);
 let timeZone=text(s.timeZone,80)||'UTC';
 try{new Intl.DateTimeFormat('en',{timeZone});}catch{timeZone='UTC';}
 const offers=(source.offers||[]).filter(o=>unique(source.offers,o.id)&&o.productType==='class_pack'&&Number.isSafeInteger(o.priceMinor)&&o.priceMinor>=0&&/^[A-Z]{3}$/.test(o.currency)&&Number.isSafeInteger(o.quantity)&&o.quantity>0&&Number.isSafeInteger(o.validDays)&&o.validDays>0).map(o=>({id:text(o.id,128),name:text(o.productName,160),version:o.version,quantity:o.quantity,validDays:o.validDays,currency:o.currency,priceMinor:o.priceMinor,taxMinor:Number.isSafeInteger(o.taxMinor)&&o.taxMinor>=0?o.taxMinor:null,categories:(o.categories||[]).map(x=>text(x,120)),classIds:(o.classIds||[]).map(x=>text(x,128)),validityStart:text(o.validityStart,80)}));
 const classes=(source.classes||[]).filter(c=>unique(source.classes,c.id)&&Number.isFinite(Date.parse(c.startsAt))&&Date.parse(c.startsAt)>=now).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)||String(a.id).localeCompare(String(b.id))).map(c=>{
  const validCapacity=Number.isSafeInteger(c.capacity)&&c.capacity>0&&Number.isSafeInteger(c.reservedCount)&&c.reservedCount>=0;
  const availability=c.status==='cancelled'?'cancelled':c.status!=='open'||!validCapacity?'unavailable':c.reservedCount>=c.capacity?'full':'available';
  return {id:text(c.id,128),title:text(c.title,160),instructor:text(c.instructor,160),startsAt:c.startsAt,duration:Number.isSafeInteger(c.duration)&&c.duration>0?c.duration:null,location:text(c.location,160),category:text(c.category,120),availability,creditRequired:c.creditRequired===true,waitlistEnabled:c.waitlistEnabled===true,placesLeft:availability==='available'?Math.max(0,c.capacity-c.reservedCount):availability==='full'?0:null,offerIds:offers.filter(o=>(!o.classIds.length||o.classIds.includes(c.id))&&(!o.categories.length||o.categories.includes(c.category))).map(o=>o.id)};
 });
 return {studio:{slug:text(s.slug,80),name:text(s.name,160),description:text(s.description,1000),timeZone,visit:text(s.visit,500),development:s.development===true},classes,offers,asOf:at,readOnly:true};
}
