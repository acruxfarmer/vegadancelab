-- Extend only the existing communication intent vocabulary. No role, function,
-- business state, schedule, booking, or delivery configuration changes.
begin;
do $$ begin
 if exists(select 1 from vega_private.booking_email_configuration where enabled) then
  raise exception 'Development communication delivery must remain disabled';
 end if;
end $$;
alter table vega_private.booking_email_intents drop constraint booking_email_intents_kind_check;
alter table vega_private.booking_email_intents add constraint booking_email_intents_kind_check
 check(kind in ('booking_confirmation','booking_cancellation','rebooking_confirmation','waitlist_promotion','class_cancelled','waitlist_joined','waitlist_removed'));
commit;
