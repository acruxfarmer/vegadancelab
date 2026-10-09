import {createScaleEngineDelivery,scaleEngineDeliveryOrigin} from './providers/scaleengine-delivery.mjs';
export function mediaDeliveryAdapters(env){
 if(env.VEGA_ENV!=='development'||env.VEGA_NATIVE_MEDIA_ENABLED!=='true')return {};
 return {scaleengine:createScaleEngineDelivery({environment:env.VEGA_ENV,cdnId:env.SCALEENGINE_CDN_ID,apiSecret:env.SCALEENGINE_API_SECRET})};
}
export function mediaDeliveryOrigins(env){return env.VEGA_ENV==='development'&&env.VEGA_NATIVE_MEDIA_ENABLED==='true'?[scaleEngineDeliveryOrigin]:[];}
