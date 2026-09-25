# Deterministic recovery discovery — candidate v1

This is the candidate procedure, not a completed recovery drill or closure record.

## Distinct records

1. Local command journal: primary transaction/idempotency record; not independently durable.
2. Outbox intent: immutable encrypted receipt and stable sequence committed locally with the mutation; not an external acknowledgment.
3. Canonical independent receipt: existing encrypted content-addressed B2 object; unchanged.
4. Deterministic discovery/index record: signed binding from tenant/business/stream/sequence to operation ID, predecessor sequence, canonical name and encrypted-payload SHA-256.
5. Independent completion checkpoint: signed object binding a sequence to the exact index digest, published only after canonical receipt and index upload acknowledgments. A separate signed announcement binds its expected digest and exposes interrupted publication.

## Baseline contract

A verified baseline must pin archive/bucket/prefix, schema `vega.receipt-discovery.v1`, the Ed25519 verification public key/fingerprint, existing RSA decryption-key custody/fingerprint, and an explicit registry of required tenant/business streams. Each stream records kind (`business` or `security`) and included sequence as a decimal integer string. Business sequence is its state revision; security sequence has no business mutation meaning. Missing or uninitialized streams must be resolved before baseline qualification. Baseline creation must ensure its database/Auth snapshot and these checkpoints refer to one consistent recovery point; this document does not manufacture that baseline.

## Deterministic names

`streamId = SHA256(canonicalJSON(["vega.receipt-discovery.v1", tenantId, businessId, kind]))`.

For positive sequence N, encode N as exactly 16 lower-case hexadecimal digits, including leading zeroes. Maximum is signed PostgreSQL bigint 9223372036854775807. Under `vega-development/independent-discovery/v1/<streamId>/`:

- `entries/<hexN>.json`: signed index.
- `completed/<hexN>.json`: signed completion checkpoint.
- `tree/<hexN>.json`: signed publication announcement binding the completion digest.
- `tree/root.json`, then `tree/<prefix>.json` for each 1–15 digit prefix: signed immutable routing markers.

Routing markers contain only stream identity and their prefix, so all retries of a shared marker are byte-identical. The worker publishes routing markers, announcement, canonical encrypted receipt, index, completion, then local discovery acknowledgment. Existing canonical names remain `vega-development/independent-receipts/v1/<business-hash>/<event-id>/<payload-digest>.json`.

## Read-only recovery

Establish that archive publication is quiescent before certifying a final endpoint. This is an operator prerequisite, not something readFiles credentials or two equal scans can prove. The fixture uses a unique synthetic stream with no concurrent producer. During a real incident, fence surviving publishers and reconcile in-flight work through the documented operational authority before certifying completion. A scan of a changing archive is only a provisional prefix.

For controlled hosted verification while the primary exists, each delivery holds a shared session advisory lock on hashtextextended('vega:receipt:publication:v1',0). An operator's exclusive lock on the same key drains existing delivery and prevents new claims until released. This fences publication only; it does not block immediate security termination. The independent recovery child receives no database credential. After primary loss, this database lock is unavailable: surviving publisher processes must instead be fenced through the established operational controls. Database-less discovery and operational fencing are distinct responsibilities.

Authenticate the existing Restorer and require exactly the established readFiles-only scope. Use B2 download-by-name GET; never list. Verify the signed root using the pinned public key. Starting at the root, derive its 16 hexadecimal child names; recursively visit present branches above the baseline checkpoint and within the signed bigint range. Only B2's documented HTTP 404 with code `not_found` is an absent child; authentication, transport, timeout, malformed response, cap or other errors stop recovery.

For every announcement, require its completion at the deterministic name and matching digest/signature. Require the referenced index bytes/digest/signature, exact stream/sequence/predecessor, canonical receipt bytes/digest, authenticated decryption, operation identity, and business revision or security schema. Do not replay until the complete bounded scan validates. Sort by integer sequence and require an uninterrupted N+1 through H. Missing middle sequences, missing announced completions, missing indices/payloads, invalid signatures, wrong streams and conflicting logical identities stop recovery. The highest validated completed sequence H is the independent completion frontier for that quiescent stream. A read budget failure is incomplete inspection, never completion.

Reconstruction remains a separate step: apply business deltas against the verified baseline with predecessor revision and before/after state-digest checks. Security records are evidence, not business deltas and not an instruction to recreate a session.

## Integrity and operational limits

This scheme assumes the independent B2 archive faithfully retains acknowledged objects, gives current authenticated named reads, and trusted signing custody and immutable outbox bindings are preserved. It does not prove absence of wholesale archive deletion, suppression of an entire unknown tail, or compromise of the signer. A readFiles-only reader cannot enumerate hidden historical B2 versions or prove that every unseen physical version is identical. Delivery therefore enforces immutable bytes for a logical binding; observed conflicting copies fail closed. Retention/Object Lock and an independent witness against archive rollback are separate, unproven controls.

Completion certifies externally published receipts, not all local mutations. Work lost before any external publication cannot be discovered by an external reader; it must not have received final business confirmation. An announcement without completion is explicitly incomplete. Root-only or branches overlapping the baseline do not establish whether an unannounced attempt existed. The immediate-security-termination exception also cannot be silently promoted into guaranteed evidence capture before local intent persistence.

The present decoder requires an explicit archiveQuiescent assertion; it cannot independently verify that assertion. Do not treat the candidate's local tests as proving live fencing or provider fault behavior.

Reference: [B2 download by name](https://www.backblaze.com/apidocs/b2-download-file-by-name), documented readFiles authorization and 404/not_found semantics. No additional provider permissions are needed for these named reads.
