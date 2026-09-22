import { mkdir,copyFile } from 'node:fs/promises';
const root=new URL('../',import.meta.url);
await mkdir(new URL('dist-frontdoor/',root),{recursive:true});
for(const file of ['index.html','styles.css','app.js','integration.js','session.js','request-journal.js','cancellation-ui.js','entitlements-ui.js','member-booking.js','member-cancellation.js','member-portal.js','staff-booking.js','reporting-audit.js'])await copyFile(new URL(`public/${file}`,root),new URL(`dist-frontdoor/${file}`,root));
console.log('Vega front door built from allowlisted public assets');
await copyFile(new URL('public/attendance-ui.js',root),new URL('dist-frontdoor/attendance-ui.js',root));
await copyFile(new URL('public/staff-waitlist.js',root),new URL('dist-frontdoor/staff-waitlist.js',root));
