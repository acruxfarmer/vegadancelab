// Presentation only: callers retain the full canonical roster for all business rules.
export const defaultRosterFilters=()=>({text:'',booking:'all',attendance:'all'});
export const attendanceValue=status=>status||'not_recorded';
export const attendanceLabel=status=>({present:'Present',absent:'Absent',not_recorded:'Not recorded'}[attendanceValue(status)]||`Unrecognized (${status})`);
export function rosterResults(data,occurrenceId,filters=defaultRosterFilters()){
 if(data?.context?.role!=='staff'||!occurrenceId||!data.classes.some(c=>c.id===occurrenceId))return {rows:[],total:0,error:''};
 const rows=data.reservations.filter(r=>r.classId===occurrenceId);
 if(!['all','reserved','waitlisted','cancelled'].includes(filters.booking)||!['all','present','absent','not_recorded'].includes(filters.attendance))return {rows:[],total:rows.length,error:'Choose an available roster status filter.'};
 const query=filters.text.trim().toLowerCase();
 return {total:rows.length,error:'',rows:rows.filter(r=>(!query||String(data.participants.find(p=>p.id===r.participantId)?.name||'').toLowerCase().includes(query))&&(filters.booking==='all'||r.status===filters.booking)&&(filters.attendance==='all'||attendanceValue(r.attendanceStatus)===filters.attendance))};
}
export function rosterFilterControls(filters,result,e){
 return `<section aria-label="Find a participant"><h3>Find a participant</h3><p>Filters change only the roster rows below. Booked totals, capacity and the waitlist remain unchanged.</p><form id="roster-filters"><div class="form-grid"><label class="field">Participant name<input type="search" name="text" maxlength="200" value="${e(filters.text)}"></label><label class="field">Booking status<select name="booking">${['all','reserved','waitlisted','cancelled'].map(s=>`<option value="${s}" ${filters.booking===s?'selected':''}>${s==='all'?'All booking statuses':s}</option>`).join('')}</select></label><label class="field">Attendance status<select name="attendance">${['all','present','absent','not_recorded'].map(s=>`<option value="${s}" ${filters.attendance===s?'selected':''}>${s==='all'?'All attendance statuses':attendanceLabel(s)}</option>`).join('')}</select></label></div><div class="row"><button class="button secondary">Apply roster filters</button><button type="button" class="text-button" data-reset-roster-filters>Reset roster filters</button></div></form><p role="${result.error?'alert':'status'}">${result.error?e(result.error):`Showing ${result.rows.length} of ${result.total} reservation rows`}</p></section>`;
}
