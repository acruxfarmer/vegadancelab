import {createDevelopmentServer} from '../src/runtime/refund-web.mjs';
import {publicDiscovery} from '../src/public-discovery.mjs';
import {ApplicationError} from '../src/application.mjs';
const classes=[{id:'flow',title:'Contemporary flow',instructor:'Morgan Ellis',startsAt:'2026-10-10T17:30:00-07:00',duration:60,location:'Studio 01',category:'Movement',capacity:12,reservedCount:4,status:'open'}, {id:'full',title:'Ballet foundations',instructor:'Jamie Chen',startsAt:'2026-10-11T18:00:00-07:00',duration:75,location:'Studio 02',category:'Ballet',capacity:8,reservedCount:8,status:'open'}, {id:'cancelled',title:'Stretch & restore',instructor:'Studio teaching team',startsAt:'2026-10-12T18:00:00-07:00',duration:45,location:'Studio 01',category:'Movement',capacity:12,reservedCount:0,status:'cancelled'}];
const store={publicDiscovery:async slug=>{
 if(!['vega','willow','empty'].includes(slug))throw new ApplicationError('Studio not found',404);
 return publicDiscovery({studio:{slug,name:slug==='willow'?'Willow Movement':'Vega Dance Lab',description:'A space to move, learn and find your rhythm. Explore our classes and make a little room for yourself.',timeZone:slug==='willow'?'America/New_York':'America/Los_Angeles',development:true},classes:slug==='empty'?[]:classes,offers:[{id:'pass',version:1,productName:'Three-class pass',productType:'class_pack',quantity:3,validDays:30,priceMinor:6000,taxMinor:0,currency:'USD',categories:['Movement'],classIds:[],validityStart:'confirmed_payment'}]});
}};
createDevelopmentServer({VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled'},null,null,store).listen(10003,'127.0.0.1',()=>console.log('Public discovery fixture preview: http://127.0.0.1:10003'));
