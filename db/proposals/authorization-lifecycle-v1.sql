-- PROPOSAL ONLY. Never applied by this slice. Existing app_members is untouched.
-- Owner/admin issuance only; application runtime receives no write/execute grant.
-- Operational issuer authentication, provisioning and DB concurrency validation
-- remain prerequisites. Run only in an explicitly approved future migration.
BEGIN;
CREATE TABLE vega_private.authorization_policy_versions (
 tenant_id text NOT NULL, business_id text NOT NULL, policy_id text NOT NULL,
 policy_version text NOT NULL, owner_ref text NOT NULL, issuer_ref text NOT NULL,
 effective_from timestamptz NOT NULL, expires_at timestamptz,
 recorded_at timestamptz NOT NULL, provenance_ref text NOT NULL,
 rules jsonb NOT NULL CHECK (jsonb_typeof(rules)='object'),
 PRIMARY KEY (tenant_id,business_id,policy_id,policy_version),
 CHECK (effective_from=recorded_at), CHECK (expires_at IS NULL OR expires_at>effective_from)
);
CREATE TABLE vega_private.authorization_policy_status_events (
 tenant_id text NOT NULL, business_id text NOT NULL, policy_id text NOT NULL,
 policy_version text NOT NULL, kind text NOT NULL CHECK (kind IN ('withdraw','supersede')),
 effective_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL,
 reason text NOT NULL CHECK (length(reason)>0), issuer_ref text NOT NULL,
 provenance_ref text NOT NULL, replacement_id text, replacement_version text,
 PRIMARY KEY (tenant_id,business_id,policy_id,policy_version),
 FOREIGN KEY (tenant_id,business_id,policy_id,policy_version) REFERENCES vega_private.authorization_policy_versions,
 FOREIGN KEY (tenant_id,business_id,replacement_id,replacement_version) REFERENCES vega_private.authorization_policy_versions,
 CHECK (effective_at=recorded_at),
 CHECK ((kind='withdraw' AND replacement_id IS NULL AND replacement_version IS NULL) OR
        (kind='supersede' AND replacement_id IS NOT NULL AND replacement_version IS NOT NULL
         AND (replacement_id,replacement_version)<>(policy_id,policy_version)))
);
-- Trusted prospective grant approvals; never populated from membership snapshots.
CREATE TABLE vega_private.authorization_origin_proofs (
 tenant_id text NOT NULL,business_id text NOT NULL,proof_ref text NOT NULL,
 assignment_id text NOT NULL,principal_id uuid NOT NULL,issuer_ref text NOT NULL,
 command_id text NOT NULL,authorized_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 provenance_ref text NOT NULL,
 PRIMARY KEY(tenant_id,business_id,proof_ref),CHECK(expires_at>authorized_at)
);
CREATE TABLE vega_private.authorization_assignment_heads (
 tenant_id text NOT NULL, business_id text NOT NULL, assignment_id text NOT NULL,
 principal_id uuid NOT NULL, head_version bigint NOT NULL CHECK (head_version>0),
 previous_assignment_id text,
 PRIMARY KEY (tenant_id,business_id,assignment_id),
 FOREIGN KEY (tenant_id,business_id,previous_assignment_id)
 REFERENCES vega_private.authorization_assignment_heads(tenant_id,business_id,assignment_id)
);
CREATE TABLE vega_private.authorization_assignment_events (
 tenant_id text NOT NULL, business_id text NOT NULL, assignment_id text NOT NULL,
 version bigint NOT NULL CHECK(version>0), previous_version bigint,
 kind text NOT NULL CHECK(kind IN ('grant','change','revoke')),
 command_id text NOT NULL, recorded_at timestamptz NOT NULL,
 effective_from timestamptz NOT NULL, expires_at timestamptz,
 policy_id text NOT NULL, policy_version text NOT NULL,
 issuer_ref text NOT NULL, provenance_ref text NOT NULL, origin_proof_ref text NOT NULL,
 revoked_at timestamptz, revocation_reason text, facts jsonb NOT NULL CHECK(jsonb_typeof(facts)='object'
 AND coalesce(length(facts->>'role'),0)>0
 AND coalesce(length(facts->>'purchaseId'),0)>0
 AND coalesce(length(facts->>'attemptId'),0)>0
 AND jsonb_typeof(facts->'permissions') IS NOT DISTINCT FROM 'array'),
 PRIMARY KEY(tenant_id,business_id,assignment_id,version),
 UNIQUE(tenant_id,business_id,command_id),
 FOREIGN KEY(tenant_id,business_id,assignment_id) REFERENCES vega_private.authorization_assignment_heads,
 FOREIGN KEY(tenant_id,business_id,assignment_id,previous_version)
 REFERENCES vega_private.authorization_assignment_events(tenant_id,business_id,assignment_id,version) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(tenant_id,business_id,policy_id,policy_version) REFERENCES vega_private.authorization_policy_versions,
 CHECK((version=1 AND previous_version IS NULL AND kind='grant') OR
       (version>1 AND previous_version=version-1 AND kind IN ('change','revoke'))),
 CHECK(effective_from=recorded_at),
 CHECK(expires_at IS NULL OR expires_at>effective_from OR kind='revoke'),
 CHECK((kind='revoke' AND revoked_at IS NOT NULL AND revocation_reason IS NOT NULL AND revoked_at=effective_from AND length(revocation_reason)>0) OR
       (kind<>'revoke' AND revoked_at IS NULL AND revocation_reason IS NULL))
);
ALTER TABLE vega_private.authorization_assignment_heads ADD CONSTRAINT authorization_head_event_fk
 FOREIGN KEY(tenant_id,business_id,assignment_id,head_version)
 REFERENCES vega_private.authorization_assignment_events(tenant_id,business_id,assignment_id,version)
 DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE vega_private.authorization_commands (
 tenant_id text NOT NULL,business_id text NOT NULL,command_id text NOT NULL,
 command jsonb NOT NULL,assignment_id text NOT NULL,result_version bigint NOT NULL,
 PRIMARY KEY(tenant_id,business_id,command_id),
 FOREIGN KEY(tenant_id,business_id,assignment_id,result_version)
 REFERENCES vega_private.authorization_assignment_events(tenant_id,business_id,assignment_id,version)
 DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE vega_private.authorization_migration_observations (
 observation_id text PRIMARY KEY,tenant_id text NOT NULL,business_id text NOT NULL,
 observed_at timestamptz NOT NULL,observed_membership jsonb NOT NULL,provenance_ref text NOT NULL,
 unknown_pre_migration_history boolean NOT NULL DEFAULT true CHECK(unknown_pre_migration_history),
 grants_authority boolean NOT NULL DEFAULT false CHECK(NOT grants_authority)
);
CREATE FUNCTION vega_private.authorization_immutable() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Immutable authorization evidence'; END $$;
CREATE TRIGGER authorization_origin_immutable BEFORE UPDATE OR DELETE ON vega_private.authorization_origin_proofs
 FOR EACH ROW EXECUTE FUNCTION vega_private.authorization_immutable();
CREATE TRIGGER authorization_event_immutable BEFORE UPDATE OR DELETE ON vega_private.authorization_assignment_events
 FOR EACH ROW EXECUTE FUNCTION vega_private.authorization_immutable();
CREATE TRIGGER authorization_policy_immutable BEFORE UPDATE OR DELETE ON vega_private.authorization_policy_versions
 FOR EACH ROW EXECUTE FUNCTION vega_private.authorization_immutable();
CREATE TRIGGER authorization_policy_status_immutable BEFORE UPDATE OR DELETE ON vega_private.authorization_policy_status_events
 FOR EACH ROW EXECUTE FUNCTION vega_private.authorization_immutable();
CREATE TRIGGER authorization_command_immutable BEFORE UPDATE OR DELETE ON vega_private.authorization_commands
 FOR EACH ROW EXECUTE FUNCTION vega_private.authorization_immutable();
CREATE TRIGGER authorization_observation_immutable BEFORE UPDATE OR DELETE ON vega_private.authorization_migration_observations
 FOR EACH ROW EXECUTE FUNCTION vega_private.authorization_immutable();
CREATE FUNCTION vega_private.authorization_head_identity_immutable() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF (NEW.tenant_id,NEW.business_id,NEW.assignment_id,NEW.principal_id,NEW.previous_assignment_id)
 IS DISTINCT FROM (OLD.tenant_id,OLD.business_id,OLD.assignment_id,OLD.principal_id,OLD.previous_assignment_id)
 THEN RAISE EXCEPTION 'Assignment identity immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER authorization_head_identity BEFORE UPDATE ON vega_private.authorization_assignment_heads
 FOR EACH ROW EXECUTE FUNCTION vega_private.authorization_head_identity_immutable();
-- Deferred validation closes BOTH orphan directions at transaction commit.
CREATE FUNCTION vega_private.authorization_check_head() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE h bigint; n bigint; top bigint;
BEGIN
 SELECT head_version INTO h FROM vega_private.authorization_assignment_heads
 WHERE tenant_id=NEW.tenant_id AND business_id=NEW.business_id AND assignment_id=NEW.assignment_id;
 SELECT count(*),max(version) INTO n,top FROM vega_private.authorization_assignment_events
 WHERE tenant_id=NEW.tenant_id AND business_id=NEW.business_id AND assignment_id=NEW.assignment_id;
 IF h IS NULL OR top IS NULL OR h<>top OR n<>top THEN RAISE EXCEPTION 'Event/head divergence'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER authorization_event_head_consistency AFTER INSERT ON vega_private.authorization_assignment_events
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vega_private.authorization_check_head();
CREATE CONSTRAINT TRIGGER authorization_head_event_consistency AFTER INSERT OR UPDATE ON vega_private.authorization_assignment_heads
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vega_private.authorization_check_head();
-- Narrow proposed atomic writer; SECURITY INVOKER, owner-only until an approved
-- authenticated issuer composition exists. No runtime grant, no SECURITY DEFINER.
CREATE FUNCTION vega_private.authorization_append_assignment(c jsonb) RETURNS bigint
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE t text:=c->'scope'->>'tenantId'; b text:=c->'scope'->>'businessId';
 aid text:=c->>'assignmentId'; cid text:=c->>'commandId'; k text:=c->>'kind';
 expected bigint:=(c->>'expectedVersion')::bigint; v bigint;
 now_at timestamptz:=clock_timestamp(); old_event vega_private.authorization_assignment_events%ROWTYPE;
 replay vega_private.authorization_commands%ROWTYPE;
BEGIN
 -- A business-scoped transaction lock also serializes conflicting command IDs.
 -- Hash collision only causes extra serialization, never loss of exclusion.
 PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(t,b)::text,0));
 SELECT * INTO replay FROM vega_private.authorization_commands
 WHERE tenant_id=t AND business_id=b AND command_id=cid;
 IF FOUND THEN
  IF replay.command IS DISTINCT FROM c THEN RAISE EXCEPTION 'Command replay conflict'; END IF;
  RETURN replay.result_version;
 END IF;
 IF k NOT IN ('grant','change','revoke') OR expected IS NULL OR expected<0
 OR coalesce(c->>'issuerId','')='' OR coalesce(c->>'provenanceRef','')=''
 OR coalesce(c->>'originProofRef','')='' THEN RAISE EXCEPTION 'Invalid lifecycle command'; END IF;
 SELECT head_version INTO v FROM vega_private.authorization_assignment_heads
 WHERE tenant_id=t AND business_id=b AND assignment_id=aid FOR UPDATE;
 IF k='grant' THEN
  IF FOUND OR expected<>0 THEN RAISE EXCEPTION 'Expected version conflict'; END IF;
  IF NOT EXISTS(SELECT 1 FROM vega_private.authorization_origin_proofs o
   WHERE o.tenant_id=t AND o.business_id=b AND o.proof_ref=c->>'originProofRef'
   AND o.assignment_id=aid AND o.principal_id=(c->>'principalId')::uuid
   AND o.issuer_ref=c->>'issuerId' AND o.command_id=cid
   AND o.authorized_at<=now_at AND now_at<o.expires_at)
   THEN RAISE EXCEPTION 'Origin proof unavailable'; END IF;
  IF c->>'previousAssignmentId' IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM vega_private.authorization_assignment_heads h
   JOIN vega_private.authorization_assignment_events e ON e.tenant_id=h.tenant_id AND e.business_id=h.business_id AND e.assignment_id=h.assignment_id AND e.version=h.head_version
   WHERE h.tenant_id=t AND h.business_id=b AND h.assignment_id=c->>'previousAssignmentId'
    AND h.principal_id=(c->>'principalId')::uuid AND e.kind='revoke'
    AND e.facts->>'purchaseId'=c->'facts'->>'purchaseId' AND e.facts->>'attemptId'=c->'facts'->>'attemptId')
   THEN RAISE EXCEPTION 'Regrant lineage invalid'; END IF;
  IF EXISTS(SELECT 1 FROM vega_private.authorization_assignment_heads h
   JOIN vega_private.authorization_assignment_events e ON e.tenant_id=h.tenant_id AND e.business_id=h.business_id AND e.assignment_id=h.assignment_id AND e.version=h.head_version
   WHERE h.tenant_id=t AND h.business_id=b AND h.principal_id=(c->>'principalId')::uuid AND e.kind<>'revoke'
    AND (e.expires_at IS NULL OR now_at<e.expires_at)
    AND e.facts->>'purchaseId'=c->'facts'->>'purchaseId' AND e.facts->>'attemptId'=c->'facts'->>'attemptId')
   THEN RAISE EXCEPTION 'Overlapping assignment'; END IF;
  INSERT INTO vega_private.authorization_assignment_heads VALUES
   (t,b,aid,(c->>'principalId')::uuid,1,c->>'previousAssignmentId');
  v:=0;
 ELSE
  IF NOT FOUND OR v<>expected THEN RAISE EXCEPTION 'Expected version conflict'; END IF;
  SELECT * INTO old_event FROM vega_private.authorization_assignment_events
   WHERE tenant_id=t AND business_id=b AND assignment_id=aid AND version=v;
  IF old_event.kind='revoke' OR now_at<=old_event.recorded_at THEN RAISE EXCEPTION 'Terminal or invalid lineage'; END IF;
  IF k='change' AND (old_event.facts->>'purchaseId',old_event.facts->>'attemptId')
   IS DISTINCT FROM (c->'facts'->>'purchaseId',c->'facts'->>'attemptId')
   THEN RAISE EXCEPTION 'Assignment scope immutable'; END IF;
 END IF;
 -- Exact policy version only; withdrawal never edits the original interval.
 IF k<>'revoke' AND NOT EXISTS(
  SELECT 1 FROM vega_private.authorization_policy_versions p
  WHERE p.tenant_id=t AND p.business_id=b AND p.policy_id=c->>'policyId' AND p.policy_version=c->>'policyVersion'
   AND p.effective_from<=now_at AND (p.expires_at IS NULL OR now_at<p.expires_at)
   AND p.rules->'roles' ? (c->'facts'->>'role')
   AND jsonb_typeof(c->'facts'->'permissions')='array'
   AND (p.rules->'roles'->(c->'facts'->>'role')->'permissions') @> (c->'facts'->'permissions')
   AND NOT EXISTS(SELECT 1 FROM vega_private.authorization_policy_status_events z
    WHERE z.tenant_id=t AND z.business_id=b AND z.policy_id=p.policy_id AND z.policy_version=p.policy_version AND z.effective_at<=now_at)
 ) THEN RAISE EXCEPTION 'Policy unavailable'; END IF;
 INSERT INTO vega_private.authorization_assignment_events VALUES
 (t,b,aid,v+1,CASE WHEN v=0 THEN NULL ELSE v END,k,cid,now_at,now_at,
 CASE WHEN k='revoke' THEN old_event.expires_at ELSE (c->>'expiresAt')::timestamptz END,
 CASE WHEN k='revoke' THEN old_event.policy_id ELSE c->>'policyId' END,
 CASE WHEN k='revoke' THEN old_event.policy_version ELSE c->>'policyVersion' END,
 c->>'issuerId',c->>'provenanceRef',CASE WHEN v=0 THEN c->>'originProofRef' ELSE old_event.origin_proof_ref END,
 CASE WHEN k='revoke' THEN now_at ELSE NULL END,CASE WHEN k='revoke' THEN c->>'reason' ELSE NULL END,
 CASE WHEN k='revoke' THEN old_event.facts ELSE c->'facts' END);
 UPDATE vega_private.authorization_assignment_heads SET head_version=v+1
 WHERE tenant_id=t AND business_id=b AND assignment_id=aid AND head_version=CASE WHEN v=0 THEN 1 ELSE v END;
 IF NOT FOUND THEN RAISE EXCEPTION 'Head advancement conflict'; END IF;
 INSERT INTO vega_private.authorization_commands VALUES(t,b,cid,c,aid,v+1);
 RETURN v+1;
END $$;
REVOKE ALL ON FUNCTION vega_private.authorization_append_assignment(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION vega_private.authorization_immutable(),vega_private.authorization_check_head(),vega_private.authorization_head_identity_immutable() FROM PUBLIC;
REVOKE ALL ON vega_private.authorization_origin_proofs,vega_private.authorization_policy_versions,vega_private.authorization_policy_status_events,
 vega_private.authorization_assignment_heads,vega_private.authorization_assignment_events,
 vega_private.authorization_commands,vega_private.authorization_migration_observations
 FROM PUBLIC,anon,authenticated,vega_app_runtime;
-- No operational read grants/RLS or issuer grants are activated by this proposal.
-- These require separate scope/issuer review before any deployment.
COMMIT;
