import fs from 'node:fs';
import path from 'node:path';
import {canonical, sha, verifyApproval, requireThat} from './contract.mjs';

const transitions = {
  claimed: ['observation_started','outcome_unknown'],
  observation_started: ['qualified','reconciled_absent','reconciled_fully_applied','reconciled_conflicting','outcome_unknown'],
  outcome_unknown: [], qualified: [], reconciled_absent: [], reconciled_fully_applied: [], reconciled_conflicting: []
};
const evidenceKeys = new Set(['resultDigest','catalogDigest','catalogClassification','backendPid','sessionAffinity','tlsVerified','lockAcquired','competingRejected','released','revisionUnchanged','migrationDispatched']);
function safeEvidence(value) {
  requireThat(value && !Array.isArray(value) && Object.keys(value).every(k => evidenceKeys.has(k)), 'EVIDENCE_FIELDS');
  for (const [key, v] of Object.entries(value)) {
    if (key.endsWith('Digest')) requireThat(typeof v === 'string' && /^[a-f0-9]{64}$/.test(v), 'EVIDENCE_DIGEST');
    else if (key === 'catalogClassification') requireThat(['absent','fully_applied','conflicting','unknown'].includes(v), 'EVIDENCE_CLASSIFICATION');
    else if (key === 'backendPid') requireThat(Number.isSafeInteger(v) && v > 0, 'EVIDENCE_PID');
    else requireThat(typeof v === 'boolean' && (key !== 'migrationDispatched' || v === false), 'EVIDENCE_BOOLEAN');
  }
}

// Single authoritative process. An unclean shutdown leaves the lock in place:
// operators must reconcile disk/journal before explicitly removing it. Never steal it.
export class Journal {
  constructor(root, publicKey, credentials, now = () => Date.now()) {
    requireThat(fs.statSync(root).isDirectory() && !fs.lstatSync(root).isSymbolicLink(), 'JOURNAL_ROOT');
    this.root = root; this.publicKey = publicKey; this.credentials = credentials; this.now = now;
    this.lock = path.join(root, 'writer.lock');
    this.fd = fs.openSync(this.lock, 'wx', 0o600);
    fs.writeFileSync(this.fd, 'single-writer-v1\n'); fs.fsyncSync(this.fd);
  }
  close() { fs.closeSync(this.fd); fs.unlinkSync(this.lock); }
  rows() {
    const file = path.join(this.root, 'events.jsonl');
    if (!fs.existsSync(file)) return [];
    requireThat(!fs.lstatSync(file).isSymbolicLink(), 'JOURNAL_SYMLINK');
    const raw = fs.readFileSync(file, 'utf8');
    requireThat(raw.endsWith('\n'), 'JOURNAL_TORN');
    let previous = null;
    return raw.slice(0,-1).split('\n').map((line,i) => {
      const row = JSON.parse(line), {digest,...body} = row;
      requireThat(row.sequence === i && row.previous === previous && digest === sha(canonical(body)), 'JOURNAL_ALTERED');
      previous = digest; return row;
    });
  }
  authenticate(token, manifestDigest, action) {
    requireThat(typeof token === 'string' && token.length >= 32 && token.length <= 512, 'JOURNAL_AUTH');
    const c = this.credentials[sha(token)];
    requireThat(c && c.manifestDigest === manifestDigest && c.actions.includes(action) && c.revoked === false && Date.parse(c.startsAt) <= this.now() && this.now() < Date.parse(c.expiresAt), 'JOURNAL_AUTH');
  }
  write(body) {
    const rows = this.rows();
    const row = {...body,sequence:rows.length,previous:rows.at(-1)?.digest ?? null,observedAt:new Date(this.now()).toISOString()};
    row.digest = sha(canonical(row));
    const file = path.join(this.root,'events.jsonl');
    const fd = fs.openSync(file, rows.length ? 'a' : 'wx', 0o600);
    try { fs.writeFileSync(fd,canonical(row)+'\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    // Linux cloud deployment additionally synchronizes directory creation metadata.
    if (process.platform !== 'win32') { const d = fs.openSync(this.root,'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); } }
    return row;
  }
  claim(envelope, token) {
    const manifestDigest = verifyApproval(envelope,this.publicKey,this.now());
    this.authenticate(token,manifestDigest,'claim');
    const m = envelope.manifest, rows = this.rows();
    requireThat(!rows.some(r => r.attemptId === m.attemptId), 'ATTEMPT_ALREADY_CLAIMED');
    const targetDigest = sha(canonical(m.target));
    const latest = new Map(rows.map(r => [r.attemptId,r]));
    // Recovery gets a distinct signed read-only attempt; it does not clear or
    // re-authorize the uncertain original attempt.
    requireThat(m.operation === 'inspect-recovery' || ![...latest.values()].some(r => r.targetDigest === targetDigest && ['claimed','observation_started','outcome_unknown'].includes(r.state)), 'UNRESOLVED_ATTEMPT');
    return this.write({attemptId:m.attemptId,manifestDigest,targetDigest,approvalRef:m.approvalRef,job:m.job,state:'claimed',evidence:{migrationDispatched:false}});
  }
  append(envelope, token, state, evidence) {
    const manifestDigest = verifyApproval(envelope,this.publicKey,this.now());
    this.authenticate(token,manifestDigest,'append'); safeEvidence(evidence);
    const last = this.rows().filter(r => r.attemptId === envelope.manifest.attemptId).at(-1);
    requireThat(last?.manifestDigest === manifestDigest && transitions[last.state]?.includes(state), 'STATE_TRANSITION');
    return this.write({attemptId:last.attemptId,manifestDigest,targetDigest:last.targetDigest,approvalRef:last.approvalRef,job:last.job,state,evidence});
  }
  inspect(manifestDigest, token) {
    this.authenticate(token,manifestDigest,'inspect');
    return this.rows().filter(r => r.manifestDigest === manifestDigest);
  }
}
