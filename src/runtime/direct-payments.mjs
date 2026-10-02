// Development composition root: shared workflow receives an adapter and activation policy.
import {HISTORICAL_DRAFTS} from '../payments.mjs';
import {createPaymentWorkflow} from './payment-workflow.mjs';
import {createAdapterRegistry} from './payment-integrations.mjs';
import {createSquareAdapter,squareExecutionReady} from './providers/square.mjs';
import {SQUARE_INTEGRATION,squareConfigurationMatches} from './providers/square-configuration.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const scope=e=>e.VEGA_ENV==='development'&&e.VEGA_EXTERNAL_EFFECTS==='disabled'&&uuid.test(e.VEGA_SANDBOX_PURCHASE_ID||'')&&!HISTORICAL_DRAFTS.has(e.VEGA_SANDBOX_PURCHASE_ID);
export function paymentPreparationEnabled(e){return scope(e)&&e.VEGA_PAYMENT_ATTEMPT_PREPARATION==='enabled'&&e.VEGA_SANDBOX_PAYMENT_EXECUTION==='disabled'&&squareConfigurationMatches(e);}
export function sandboxPaymentEnabled(e){return scope(e)&&e.VEGA_SANDBOX_PAYMENT_EXECUTION==='authorized'&&squareExecutionReady(e);}
export function createDirectPayments(env,store,fetcher=fetch){
 return createPaymentWorkflow({store,resolveAdapter:createAdapterRegistry([{integrationRef:SQUARE_INTEGRATION,adapter:createSquareAdapter(env,fetcher)}]),policy:(mode,id)=>id===env.VEGA_SANDBOX_PURCHASE_ID&&(mode==='execute'?sandboxPaymentEnabled(env):paymentPreparationEnabled(env))});
}
