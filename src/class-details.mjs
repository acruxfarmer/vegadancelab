// The single creation contract, also used for occurrence edit review and commit.
const text=(value,max=200)=>typeof value==='string'&&value.trim()&&value.length<=max;
export function classDetails(body,fail){
 if(!text(body.title)||!text(body.instructor)||!text(body.location)||!Number.isInteger(body.capacity)||body.capacity<1||body.capacity>1000||!Number.isFinite(Date.parse(body.startsAt))||!Number.isInteger(body.duration)||body.duration<1||body.duration>1440)fail('Invalid class details');
 if(body.cancellationCutoffMinutes!==undefined&&(!Number.isInteger(body.cancellationCutoffMinutes)||body.cancellationCutoffMinutes<0||body.cancellationCutoffMinutes>10080))fail('Invalid cancellation cutoff');
 return {cancellationCutoffMinutes:body.cancellationCutoffMinutes??90,creditRequired:body.creditRequired===true,title:body.title,instructor:body.instructor,location:body.location,capacity:body.capacity,startsAt:new Date(body.startsAt).toISOString(),duration:body.duration,category:text(body.category)?body.category:'Class',waitlistEnabled:body.waitlistEnabled===true};
}
