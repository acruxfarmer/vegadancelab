// Read-only catalog inventory. No execution or connections on import.
export async function inventory(client) {
  const relations = (await client.query(`SELECT c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,
    pg_get_userbyid(c.relowner) AS owner,c.relacl::text AS acl
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='vega_private' AND c.relname LIKE 'authorization_%' ORDER BY c.relname`)).rows;
  const columns = (await client.query(`SELECT c.relname,a.attname,a.attnum,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default_expression
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='vega_private' AND c.relname LIKE 'authorization_%' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`)).rows;
  const constraints = (await client.query(`SELECT c.relname,k.conname,pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='vega_private' AND c.relname LIKE 'authorization_%' ORDER BY c.relname,k.conname`)).rows;
  const functions = (await client.query(`SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition,p.proacl::text AS acl,pg_get_userbyid(p.proowner) AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='vega_private' AND p.proname LIKE 'authorization_%' ORDER BY p.proname,arguments`)).rows;
  const triggers = (await client.query(`SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='vega_private' AND c.relname LIKE 'authorization_%' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`)).rows;
  const indexes = (await client.query(`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='vega_private' AND tablename LIKE 'authorization_%' ORDER BY indexname`)).rows;
  const counts = {};
  for (const {relname} of relations.filter(row=>row.relkind==='r')) counts[relname] = (await client.query(`SELECT count(*)::int AS count FROM vega_private."${relname.replaceAll('"','""')}"`)).rows[0].count;
  return {relations,columns,constraints,functions,triggers,indexes,counts};
}
