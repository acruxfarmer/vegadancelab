import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { checkServerIdentity } from 'node:tls';

export const databaseCaFingerprint = '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA';
const ca = readFileSync(new URL('../../config/certificates/supabase-prod-ca-2021.crt', import.meta.url), 'utf8');
const certificate = new X509Certificate(ca);
if (!certificate.ca || certificate.fingerprint256 !== databaseCaFingerprint || Date.now() < Date.parse(certificate.validFrom) || Date.now() > Date.parse(certificate.validTo)) throw new Error('Approved database CA unavailable or invalid');

// Application-scoped trust: do not change Windows/system trust or accept arbitrary roots.
// Equivalent to verify-full: verify the CA chain AND the requested database hostname.
export function databaseTls(hostname) {
  return { ca, rejectUnauthorized: true, servername: hostname, checkServerIdentity };
}
