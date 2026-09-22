import {test} from 'node:test';
import assert from 'node:assert/strict';
import {entitlementsUI} from '../public/entitlements-ui.js';
test('member entitlement surface explains restricted terms without issuance controls or staff audit',()=>{
 const d={context:{role:'member'},participants:[{id:'p',name:'Member'}],passes:[{id:'pass',participantId:'p',label:'Drop-in',entitlement:{source:'simulated_purchase',productType:'drop_in',validFrom:'2026-10-01',expiresAt:'2026-10-03',categories:['Dance'],classIds:['c']}}],creditUnits:[{passId:'pass',status:'available'}]};
 const ui=entitlementsUI({escape:v=>String(v),getData:()=>d});const html=ui.render('passes');
 assert.match(html,/simulated_purchase/);assert.match(html,/2026-10-03/);assert.match(html,/Categories: Dance/);assert.match(html,/1 unspent/);assert.doesNotMatch(html,/<form|Issuance audit/);
 d.context.role='staff';assert.match(ui.render('people'),/Define entitlement product/);
});
