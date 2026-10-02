import {isDeepStrictEqual} from 'node:util';
export const PAYMENT_BINDING=Object.freeze({environment:'sandbox',tenantId:'vega-development',businessId:'vega-dance-lab',applicationId:'sandbox-sq0idb-iQmG15i6Pe5yMJMLmu_miw',merchantId:'MLJGVWY9QZ66R',locationId:'L7EMFD4DPV27P',host:'connect.squareupsandbox.com',currency:'USD'});
export const SQUARE_INTEGRATION=Object.freeze({id:'vega-development-card',version:1,tenantId:'vega-development',businessId:'vega-dance-lab',provider:'square',environment:'sandbox'});
export function squareConfigurationMatches(e){const b=PAYMENT_BINDING;return e.SQUARE_ENVIRONMENT===b.environment&&e.SQUARE_APPLICATION_ID===b.applicationId&&e.SQUARE_MERCHANT_ID===b.merchantId&&e.SQUARE_LOCATION_ID===b.locationId;}
// Legacy evidence is read, never rewritten. Only the exact approved historical binding maps.
export function legacySquareIntegration(binding,scope){return isDeepStrictEqual(binding,PAYMENT_BINDING)&&scope.tenantId===PAYMENT_BINDING.tenantId&&scope.businessId===PAYMENT_BINDING.businessId?{...SQUARE_INTEGRATION}:null;}
