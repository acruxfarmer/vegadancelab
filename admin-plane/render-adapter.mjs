import {validateManifest,requireThat} from './contract.mjs';

// Produces a reviewable request only. No provider credential or dispatch capability
// is imported by the job. Actual control-plane dispatch is separately authorized.
export function jobRequest(manifest, digest, now) {
  validateManifest(manifest,now);
  requireThat(/^[a-f0-9]{64}$/.test(digest), 'MANIFEST_DIGEST');
  return {serviceId:manifest.job.serviceId,body:{startCommand:`node admin-plane/job.mjs ${manifest.attemptId} ${digest}`,planId:'plan-srv-006'},automaticRetry:false};
}

export function requireIsolatedEnvironment(env) {
  requireThat(!env.RENDER_API_KEY && !env.RENDER_API_TOKEN && !env.NODE_OPTIONS && env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'JOB_ENVIRONMENT_DENIED');
}
