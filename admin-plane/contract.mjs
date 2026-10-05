import {createHash, verify} from 'node:crypto';

export const CONTRACT = 'acrux-administrative-manifest/1';
export const sha = value => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
export function requireThat(ok, code) { if (!ok) throw Error(code); }
const ref = x => typeof x === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$/.test(x);
const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const exact = (o, keys) => o && !Array.isArray(o) && Object.keys(o).sort().join() === keys.sort().join();

// This release cannot authorize migration execution, regardless of signer authority.
export function validateManifest(m, now = Date.now()) {
  requireThat(exact(m, ['contract','target','operation','runner','payloadDigest','approvalRef','attemptId','window','expectedPreState','job','executionAuthorized']), 'MANIFEST_SHAPE');
  requireThat(m.contract === CONTRACT && m.executionAuthorized === false, 'EXECUTION_DISABLED');
  requireThat(['qualify-direct-route','inspect-recovery'].includes(m.operation), 'OPERATION_DISABLED');
  requireThat(exact(m.target, ['tenant','business','environment','project','database','adapter']), 'TARGET_SHAPE');
  requireThat(Object.values(m.target).every(ref) && m.target.environment === 'development', 'TARGET_DENIED');
  requireThat(exact(m.runner, ['version','buildCommit','artifactDigest']) && ref(m.runner.version) && /^[a-f0-9]{40}$/.test(m.runner.buildCommit) && digest(m.runner.artifactDigest), 'RUNNER_BINDING');
  requireThat(digest(m.payloadDigest) && ref(m.approvalRef) && /^[a-z0-9-]{1,80}$/.test(m.attemptId), 'APPROVAL_BINDING');
  requireThat(exact(m.window, ['startsAt','endsAt']) && Number.isFinite(Date.parse(m.window.startsAt)) && Date.parse(m.window.startsAt) <= now && now < Date.parse(m.window.endsAt), 'WINDOW_DENIED');
  requireThat(exact(m.expectedPreState, ['catalog','revision','digest']) && ['absent','fully_applied','conflicting','unknown'].includes(m.expectedPreState.catalog) && Number.isSafeInteger(m.expectedPreState.revision) && digest(m.expectedPreState.digest), 'PRESTATE_BINDING');
  requireThat(exact(m.job, ['serviceId','identityRef']) && ref(m.job.serviceId) && ref(m.job.identityRef), 'JOB_BINDING');
  return m;
}

export function verifyApproval(envelope, publicKey, now) {
  requireThat(exact(envelope, ['manifest','signature']), 'APPROVAL_SHAPE');
  validateManifest(envelope.manifest, now);
  requireThat(typeof envelope.signature === 'string' && verify(null, Buffer.from(canonical(envelope.manifest)), publicKey, Buffer.from(envelope.signature, 'base64')), 'APPROVAL_SIGNATURE');
  return sha(canonical(envelope.manifest));
}

export function recoveryDisposition(classification) {
  return ({fully_applied:'complete_no_replay', absent:'review_required_no_resend', conflicting:'stop_conflict', unknown:'stop_reconcile_required'})[classification] ?? 'stop_reconcile_required';
}

export function verifyWorkerWindow(before, during, after) {
  requireThat(before.id === during.id && before.id === after.id, 'WORKER_IDENTITY');
  requireThat(during.autoDeploy === 'no' && during.pending === false && during.manualDeployExcluded === true, 'WORKER_WINDOW_OPEN');
  requireThat(before.commit === during.commit && before.commit === after.commit && before.hooksDigest === during.hooksDigest && before.hooksDigest === after.hooksDigest, 'WORKER_DRIFT');
  requireThat(after.autoDeploy === before.autoDeploy && after.trigger === before.trigger && after.pending === false, 'WORKER_RESTORE_UNVERIFIED');
  return {status:'verified', settingsRestored:true};
}
