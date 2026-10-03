import {assembleRefundAssessment} from './refund-inventory-assembler.mjs';
import {reportRefundEvidenceGaps} from './refund-evidence-gaps.mjs';
import {createOwnedRefundSnapshotLoader} from './refund-snapshot-loader.mjs';

const denied=()=>({status:'denied',reasonCodes:['OWNERSHIP_SCOPE_DENIED'],staffApprovalRequired:true,executionAuthorized:false});
// Trusted server inputs only; never bind this function directly to a request body.
// The original assessment is preserved verbatim; diagnostics cannot authorize it.
export function composeRefundInventoryAssessment(input={}){
 const {authority:a,context:c,ownedSnapshot:s}=input,scope=c?.scope;
 if(a?.role!=='staff'||!scope||a.tenantId!==scope.tenantId||a.businessId!==scope.businessId)return denied();
 const purchase=s?.state?.purchaseDrafts?.find(p=>p.id===scope.purchaseId&&p.tenantId===scope.tenantId&&p.businessId===scope.businessId);
 if(!purchase)return denied();
 const assessment=assembleRefundAssessment(input);
 if(assessment.status==='denied')return denied();
 const result={status:assessment.status,reasonCodes:assessment.reasonCodes,staffApprovalRequired:true,executionAuthorized:false,assessment};
 // Pre-inventory failures have no trustworthy envelope to disclose or diagnose.
 if(assessment.envelope)result.gapReport=reportRefundEvidenceGaps({envelope:assessment.envelope,authority:a,context:c,trustedEvidence:input.attestations?.evidence,projectedPayloadSha256:input.attestations?.snapshot?.payloadDigest});
 return result;
}

// Opt-in seam only: no runtime route, connection or provider integration is added.
export function createRefundInventoryComposition({source}){
 return createOwnedRefundSnapshotLoader({source,assess:composeRefundInventoryAssessment});
}
