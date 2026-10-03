# Bounded Development source verification package

Prepared for Joe + Chett review only. No deployment or job dispatch is authorized by running local tests. The private release copy of `scripts/refund-source-render-operator.ps1` pins the resulting candidate commit; the committed template rejects execution until sealed. It has no SQL, target, actor, connection, policy, or compute parameters. `-JoeAuthorized` is the sole execution switch.

## Authority and build

Use the existing unlocked Bitwarden operator session, folder `Dev Stack`, secure note `Vega Dev - Render Operator`, field `RENDER_API_KEY`. The credential stays in operator memory and is never supplied to the job. The key's existing authority can be broader than Development; this script constrains its own requests and does not change the credential's permissions.

Only service `srv-dao5cjbm8hqs73db51j0` / `vega-development-web`, owner `tea-dand3tajnfac7387vm30`, environment `evm-dao55pijnfac73akca10`, and the existing Vega GitHub repository are accepted. Normal startup remains `node scripts/start-web.mjs`; no endpoint, application startup, dependency, or service configuration changes are included.

Render takes the latest successful build, not a commit parameter. The latest listed deployment must therefore be the exact pinned candidate, live, with no active deployment. This is checked twice. The fixed job command checks `RENDER_GIT_COMMIT` before Node starts, and the runner checks it again before opening PostgreSQL. A mismatched build exits without reading the database. The job response has no build ID; Render's artifact/commit metadata remains a trust dependency. Deploying this candidate to Development is a separate prerequisite and review decision. This script never deploys it.

## Fixed verification

The entrypoint is `scripts/verify-refund-source-job.mjs`. Its composition uses the existing `APP_DATABASE_URL`, existing Development host/user/TLS validation, and `vega_app_runtime`. It never requests or accepts a private database handoff. It discards inherited environment secrets before loading the database driver, retaining the validated connection only in memory. The job inherits Render's environment snapshot; this does not introduce a new restricted credential or an infrastructure egress sandbox.

Target: tenant `vega-development`, business `vega-dance-lab`, purchase `3609b576-10f1-4d16-94df-e46e10ec7a96`, attempt `c5ddcda0-5d3f-4e1a-9916-03c6a990a2b1`. The established staff and member actors are fixed server-side probes; these are not fresh authentication tests or public impersonation endpoints.

Pinned baseline (previously observed, not re-read during package preparation):

| Meaning | Expected value |
|---|---|
| Revision | `127` |
| Historical PostgreSQL MD5 | `2697037513f331bcf116a37d2bd003bc` |
| Canonical state SHA256 | `d0871b339c712e6dd11f0288261174a579e25903877d2020c0d97d9c20c8c6c8` |
| Frozen terms SHA256 | `5774a6c42989d2f65fd2aaf48fca1cbbb98369734d85f4285ccaa8bed477b62e` |
| Projected payload SHA256 | Calculated independently from `{state,facts}` during the job; never substituted for another digest |

Each concrete source load uses one `REPEATABLE READ READ ONLY` transaction and ends with `ROLLBACK`. Independently constructed checkpoint transactions bracket the source/loader/assembler/validator chain. Connection defaults are also read-only. Before/after evidence compares revision, all state via canonical SHA256 and historical MD5, frozen terms, an SHA256 over component MD5s, and scoped visible command/recovery/member/integration record MD5s. Raw state is memory-only. No state, SQL, driver error, authentication material, or arbitrary log fields enter the receipt.

The source's state read is exact tenant/business; the closed loader selects the exact purchase/attempt and owned links. Its five probes are staff, member, missing purchase, foreign business, and foreign tenant. Staff assessment must remain blocked, all owned history incomplete, `provider_unknown`, and execution unauthorized. `REFUND_CUTOFF_POLICY_UNRESOLVED` and `RESTORED_USAGE_POLICY_UNRESOLVED` must remain present. No provider client, refund execution, write transaction, clocks, credits, entitlement, or fulfillment mutation is invoked. Square remains disabled in both public preflight and inherited runtime gates. Production is never selected.

## Bounds, failure, and cleanup

- Exactly one create-job POST; atomic local dispatch marker is written first. Existing relevant jobs or any ambiguous previous attempt stop execution. Never automatically remove the marker or retry a failed API request.
- Smallest documented non-cron job plan: `plan-srv-006`, 0.5 CPU / 512 MB. Node watchdog: 110 seconds. Outer process limit: 120 seconds, forced kill after another 5 seconds. PostgreSQL statements: 10 seconds, client query timeout: 12 seconds, idle transaction timeout: 15 seconds, pool maximum: one connection.
- Operator polls successful nonterminal status reads at five-second intervals; this is observation, not dispatch retry. At its 180-second dispatch deadline, or a subsequent status failure, it makes one cancellation request for the known job ID. API calls have a 15-second timeout. A blocked request may delay cancellation until approximately 200 seconds after dispatch; this is not a provider-guaranteed wall-clock limit.
- If submission returns no usable ID, the outcome stays uncertain: do not dispatch again. Astra reconciles the pinned service's jobs; the job's own process limit remains in effect. If cancellation cannot be confirmed, report that explicitly. A hard maximum bill cannot be guaranteed against provider outages or jobs that never start the timeout command.
- On normal exit Render deprovisions job compute; database transactions roll back and connections close. No app-state cleanup is necessary. No service, credential, or environment changes are made. Local markers and non-secret receipts remain for reconciliation; no destructive cleanup runs automatically.
- The operator requests logs for only the returned job ID, narrow time window, and fixed receipt prefix. One page, one receipt, strict allowlisted values; missing, truncated, delayed, ambiguous, or malformed evidence stops without claiming success. No raw log export. Success remains `passed_pending_independent_reconciliation`.

## Evidence and remaining trust

The release copy writes `refund-source-verification-<candidate>/dispatch-attempted.json` and `operator-receipt.json` beside itself. Evidence contains candidate, pinned service/deployment/job IDs, compute plan, sanitized status, distinct before/after digests, projected-payload digest, policy/coverage assertions, and boundary results. Failed runs provide a fixed stage and cancellation-request outcome, never raw error text.

Astra must independently compare the Development connector's before/after revision/state and relevant records after the live run. Staff RLS restricts command and other record visibility; equality inside the job does not prove equality of invisible records. Use the existing Development connector for that comparison, without attempting to become the runtime role. Current live verification remains pending. This package does not close the source-adapter slice by itself.

Generic adapter/loader/assembler/validator/evaluator contracts are unchanged. Vega IDs occur only in this bounded composition, operator pins, and tests. Previously reviewed uncommitted source/loader/assembler/validator files and their tests are included unchanged as required candidate dependencies. Operator selection, Render build metadata, TLS/pg, existing RLS, local receipt integrity, and independent connector comparison remain explicit trust dependencies.

Official API references checked during preparation: [one-off jobs](https://render.com/docs/one-off-jobs), [create job](https://api-docs.render.com/reference/post-job), [retrieve job](https://api-docs.render.com/reference/retrieve-job), [cancel job](https://api-docs.render.com/reference/cancel-job), and [Render OpenAPI](https://api-docs.render.com/openapi/render-public-api-1.json). Jobs are billed per second on the selected compute plan. The intended exposure is one job with at most 125 seconds of running command time; actual startup/queue/billing behavior and cancellation availability are provider dependencies.

Recommendation: READY FOR JOE + CHETT REVIEW of the prepared package. No live success or Commerce 6.10 closure is claimed.
