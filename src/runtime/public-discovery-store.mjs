import {publicDiscovery} from '../public-discovery.mjs';
export async function readPublicDiscovery(pool,slug){
 const client=await pool.connect();
 try{
  await client.query('begin isolation level repeatable read read only');
  const {rows}=await client.query('select vega_private.public_studio_discovery($1) as projection',[slug]);
  const result=publicDiscovery(rows[0]?.projection);
  await client.query('commit');return result;
 }catch(error){await client.query('rollback').catch(()=>{});throw error;}finally{client.release();}
}
