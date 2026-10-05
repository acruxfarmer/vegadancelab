// Execute only inside the isolated journal service's trusted Render shell.
// Signing private key stays on the service disk, unavailable to one-off jobs.
import fs from 'node:fs';
import path from 'node:path';
import {sign} from 'node:crypto';
import {canonical,validateManifest,requireThat} from './contract.mjs';
const [input,output] = process.argv.slice(2);
requireThat(process.env.RENDER === 'true' && process.env.ACRUX_JOURNAL_ROOT && input && output, 'CLOUD_AUTHORIZATION_EDGE_REQUIRED');
const manifest = validateManifest(JSON.parse(fs.readFileSync(input,'utf8')));
const key = fs.readFileSync(path.join(process.env.ACRUX_JOURNAL_ROOT,'approval-private.pem'));
const envelope = {manifest,signature:sign(null,Buffer.from(canonical(manifest)),key).toString('base64')};
const fd = fs.openSync(output,'wx',0o600);
try { fs.writeFileSync(fd,JSON.stringify(envelope,null,2)+'\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
