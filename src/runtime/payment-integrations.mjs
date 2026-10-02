import {ApplicationError} from '../application.mjs';
import {validIntegration,sameIntegration} from '../payment-contract.mjs';
import {legacySquareIntegration} from './providers/square-configuration.mjs';

// Registry entries contain neutral references only; credentials/native configuration belong to adapters.
export async function resolveStoredIntegration(client,scope,attempt){
 if(attempt&&!attempt.integrationRef){
  const ref=legacySquareIntegration(attempt.binding,scope);
  if(!ref)throw new ApplicationError('Historical integration unavailable',409);
  return ref;
 }
 const pinned=attempt?.integrationRef;
 const {rows}=await client.query('select integration_ref from vega_private.payment_integrations where tenant_id=$1 and business_id=$2 and (($3::text is null and selected) or (integration_id=$3 and version=$4))',[scope.tenantId,scope.businessId,pinned?.id??null,pinned?.version??null]);
 if(rows.length!==1||!validIntegration(rows[0].integration_ref,scope)||(pinned&&!sameIntegration(pinned,rows[0].integration_ref)))throw new ApplicationError('Payment integration unavailable',503);
 return rows[0].integration_ref;
}
export function createAdapterRegistry(entries){
 return ref=>{
  const matches=entries.filter(e=>sameIntegration(e.integrationRef,ref));
  if(matches.length!==1)throw new ApplicationError('Provider integration unavailable',503);
  return matches[0].adapter;
 };
}
