-- Add only placement-scoped public availability to the existing safe commerce projection.
begin;
create or replace function media_private.commerce_material(placement uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p media_private.placements; r media_private.resources; s jsonb; links jsonb; offers jsonb; availability jsonb; rental_availability jsonb;
begin
 select * into p from media_private.placements where id=placement for share;
 if not found or p.document->>'authorized'<>'true' or p.document->>'visible'<>'true' or p.document->'policy'->>'kind'<>'pay_on_demand' then return null; end if;
 select * into r from media_private.resources where id=p.resource_id for share;
 if not found or r.document->>'lifecycle'<>'active' or r.document->'owner'->>'kind'<>'business' or r.document->'owner'->>'tenantId' is distinct from p.tenant_id or r.document->'owner'->>'businessId' is distinct from p.business_id then return null; end if;
 select state into s from vega_private.app_state where tenant_id=p.tenant_id and business_id=p.business_id;
 select coalesce(jsonb_agg(l),'[]') into links from jsonb_array_elements(coalesce(s->'mediaCommerceLinks','[]')) l where l->>'placementId'=placement::text and l->>'tenantId'=p.tenant_id and l->>'businessId'=p.business_id;
 select coalesce(jsonb_agg(o),'[]') into offers from jsonb_array_elements(coalesce(s->'commerceOffers','[]')) o where o->>'tenantId'=p.tenant_id and o->>'businessId'=p.business_id and exists(select 1 from jsonb_array_elements(links) l where l->>'offerId'=o->>'id' and l->'offerVersion'=o->'version');
 select coalesce(jsonb_agg(a),'[]') into availability from jsonb_array_elements(coalesce(s->'commerceOfferAvailability','[]')) a where a->>'tenantId'=p.tenant_id and a->>'businessId'=p.business_id and exists(select 1 from jsonb_array_elements(offers) o where o->>'id'=a->>'offerId' and o->'version'=a->'offerVersion');
 select coalesce(jsonb_agg(jsonb_build_object('placementId',placement,'tenantId',p.tenant_id,'businessId',p.business_id,'status',a->>'status')),'[]') into rental_availability from jsonb_array_elements(coalesce(s->'mediaAvailability','[]')) a where a->>'placementId'=placement::text and a->>'tenantId'=p.tenant_id and a->>'businessId'=p.business_id;
 return jsonb_build_object('placement',p.document,'resource',jsonb_build_object('id',r.id,'owner',r.document->'owner','lifecycle',r.document->'lifecycle'),'commerceState',jsonb_build_object('mediaCommerceLinks',links,'commerceOffers',offers,'commerceOfferAvailability',availability,'mediaAvailability',rental_availability));
end; $$;
commit;
