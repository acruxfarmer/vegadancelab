import pg from 'pg';
import { databaseOptions, checkIngestionDatabase } from './runtime/database.mjs';
import { databaseCaFingerprint } from './runtime/database-tls.mjs';
const knownCodes = new Set(['ENOTFOUND','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','ECONNREFUSED','ETIMEDOUT','ECONNRESET','28P01','28000','3D000','53300','57P03','SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID']);
export function connectionFailure(error) {
  const codes=[error?.code,...(error?.errors||[]).map(e=>e.code)].filter(c=>knownCodes.has(c));
  const safe=[...new Set(codes.length?codes:['UNCLASSIFIED_CONNECTION_FAILURE'])];
  const tls=safe.some(c=>/CERT|SELF_SIGNED|ISSUER|SIGNATURE/.test(c));
  return {codes:safe,category:tls?'tls_trust_or_identity':safe.some(c=>['28P01','28000'].includes(c))?'authentication_or_login_permission':'connection',...(tls?{authentication:'not_reached'}:{})};
}
export async function diagnoseRestrictedDatabase(databaseUrl,{Client=pg.Client}={}) {
  const report={item:'Vega Dev - Supabase',field:'DATABASE_URL',tlsVerification:'verify-full-equivalent',caSource:'project-bundled Supabase Root 2021 CA',caFingerprint256:databaseCaFingerprint,credentialsChanged:false,operatorConnectionAttempted:false};
  let client;let stage='restricted_configuration';
  try {
    const config=databaseOptions(databaseUrl);
    report.configuredRoute=config.host.startsWith('db.')?'direct':'pooler';report.configuredPort=config.port;
    stage='restricted_database_connection';client=new Client(config);await client.connect();
    report.authentication='passed';stage='restricted_database_privilege_verification';
    await checkIngestionDatabase((sql,values)=>client.query(sql,values));
    return {...report,status:'restricted_connection_verified'};
  }catch(error){return {...report,status:'failed',stage,...connectionFailure(error)};}
  finally{try{await client?.end();}catch{}}
}
