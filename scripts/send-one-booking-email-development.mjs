// One authorized Development test; unattended delivery stays disabled.
import assert from 'node:assert/strict';
import pg from 'pg';
import {applicationDatabaseOptions} from '../src/runtime/refund-application-database.mjs';
import {prepareBookingEmails,deliverBookingEmail} from '../src/runtime/booking-email.mjs';
import {createResendBookingAdapter} from '../src/runtime/providers/resend-booking.mjs';
if(process.env.VEGA_ENV!=='development'||process.env.RENDER_SERVICE_ID!=='srv-dao5cjbm8hqs73db51j0'||process.env.BOOKING_EMAIL_DELIVERY==='enabled')throw Error('Manual Development delivery required');
const expected=process.argv[2];assert.match(expected||'',/^[a-f0-9]{64}$/);assert.ok(process.env.RESEND_API_KEY,'Existing Resend credential required');
const pool=new pg.Pool(applicationDatabaseOptions(process.env.APP_DATABASE_URL));
try{
 const pending=await pool.query('select * from vega_private.pending_booking_email_messages()');
 assert.equal(pending.rows.length,1,'Exactly one approved pending message required');
 const row=pending.rows[0];assert.equal(row.id,expected);assert.equal(row.recipient,'admin@vegadancelab.com');assert.equal(row.configuration.businessId,'vega-dance-lab');assert.equal(row.configuration.sender,'admin@acrux.co');
 await prepareBookingEmails(pool);
 const adapter=createResendBookingAdapter(process.env.RESEND_API_KEY);
 const bounded={send:async(message,key)=>{assert.equal(key,`booking-email/${expected}`);assert.deepEqual(message.to,['admin@vegadancelab.com']);return adapter.send(message,key);}};
 console.log(JSON.stringify(await deliverBookingEmail(pool,bounded)));
}finally{await pool.end();}
