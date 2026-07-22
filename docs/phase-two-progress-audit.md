# Phase 2 Progress Audit

> Date: 2026-07-22
> Scope: prepaid credits, Stripe payments, provider gateway, and loss controls
> Release status: Phase 2 exit gate complete on isolated staging; production promotion remains separately unauthorized

## Completed locally

- Versioned billing configuration, provider prices, feature rate cards, approved provider routes, credit products, and operational kill switches.
- Non-negative wallets, expiring credit lots, append-only ledger, reservations, allocations, provider authorizations, usage events, verified payment events, refunds, chargebacks, and unrecovered-credit freezes.
- Service-only atomic grant, reserve, authorize, usage-record, settle, release, expiry, refund, chargeback, and reconciliation functions. Browser roles have read-own RLS only and cannot execute financial mutations.
- Exactly-once validation rejects reuse of a job, usage, provider, settlement, release, or Stripe event key when any material facts change.
- Global, feature, provider, and model daily budgets and concurrent-call controls. Missing controls, rates, routes, wallets, or secrets fail closed.
- Server-only integer quote calculation with a configured FX buffer and provider-cost margin floor.
- Distinct immutable pricing and append-only usage fields for prompt-cache
  reads and writes. Quotes and authorizations reserve against the most
  expensive input-token class, while the database independently recomputes
  actual provider cost from the reservation's price snapshot and rejects a
  mismatched submitted cost.
- One server-only gateway with fixed-endpoint adapters for OpenAI Responses, DeepSeek Chat Completions, and MiniMax Chat Completions. The immutable reservation selects the provider/model; feature and browser code cannot override it.
- A one-way provider-dispatch claim prevents a crashed retry from issuing the same paid request twice. Expired dispatched calls without usage become durable critical reconciliation issues.
- Ambiguous dispatched calls remain reconciliation issues even after student credits are released, so a late provider invoice cannot silently erase the exposure.
- Hard token/tool/search/page/cost ceilings, timeout, actual usage capture, output validation, settlement, and release-on-known-failure. Network or protocol ambiguity remains fail-closed for reconciliation instead of risking a duplicate provider charge.
- Strict real-configuration command (`pnpm billing:config /path/config.json`) with no defaults or bundled product data. It validates exact fields, provider routes, control coverage, credit funding, and conservative minimum-charge margin; `--apply` calls one idempotent, transactional service-only database import.
- Configuration preflight and apply are bound to the approved project ref for each environment. A staging-labelled import fails before network access if its Supabase URL points at the shared production project or any other project.
- Stripe Checkout for effective one-time top-up and subscription products, raw-body webhook signature verification, settled net-amount retrieval, one-time purchase and paid-invoice credit grants, refund reversal, and dispute reversal.
- Webhook processing verifies the event's `livemode` against the configured Stripe secret-key mode, preventing test/live environment crossover.
- Server-written subscription projection for all Stripe lifecycle states, an append-only verified-event journal, stale-event protection, failed-payment state, duplicate-subscription guard, and a customer portal action bound to a reviewed portal configuration.
- Real `/app/billing` wallet, lot, ledger, payment, and subscription status. Environments without the Phase 2 schema show an honest unavailable state and no simulated balance.
- Daily, secret-protected reconciliation runner with durable run/issue records. It compares wallet/ledger/reservation/payment effects, recent Stripe objects, subscription projections, and immutable provider-invoice imports without moving credits.
- Separate daily, secret-protected financial maintenance expires overdue reservations before overdue credit lots. It processes bounded batches, isolates row failures, and leaves overdue state visible to reconciliation until successfully resolved.
- Real provider-invoice import command (`pnpm billing:import-provider-invoice`) hashes the supplied invoice record and accepts no built-in sample or fallback data.
- Secret-safe deployed-cron verifier proves unauthenticated denial, invokes each staging production route exactly once, and verifies the persisted reconciliation run without printing credentials or retrying ambiguous mutations.

## Requirement-by-requirement state

| Phase 2 plan requirement | Current evidence | State |
|---|---|---|
| Versioned provider prices and feature rate cards | Core migration plus server-side integer quote calculation | Complete locally |
| Lots, wallet, append-only ledger, reservations, usage, payments, refunds, reversals | Core and atomic migrations; pgTAP invariants | Complete locally |
| Atomic reserve, settle, release, expire, refund, chargeback | Service-only functions plus concurrency test | Complete locally |
| Verified, idempotent Stripe grants | Signed top-up event `evt_1TvkZj1tdTVob40GuZuH0MAZ`, paid-invoice event `evt_1Tvkvk1tdTVob40GrfNphs2I`, and duplicate redelivery with unchanged counts | Complete on isolated staging |
| Real balance, history, subscription, and top-up interfaces | Real top-up and subscription Checkout, failed renewal projection, portal period-end cancellation, refund, dispute, and frozen-wallet history | Complete on isolated staging |
| Plan/user/concurrency/provider controls and kill switches | Rate cards, system controls, provider budget authorization | Complete locally |
| Server-only gateway with hard ceilings | OpenAI, DeepSeek, and MiniMax adapters; database authorization plus single-dispatch claim | Complete; v14 automatic grounding passed after transparent offline sanitization, with limitations retained for student confirmation |
| Provider-reported usage and actual-cost capture | Response `resp_07cf317ffb241b61016a5fdd5ee49081988b8fd78f97b2b5f4` recorded 103 input, 56 output, 330 microusd, one dispatch, 263 captured credits, and 95 released credits; the exact one-minute OpenAI organization-usage row independently matched | Complete on isolated staging |
| Approved lower-cost routing | Versioned approved route table and fail-closed lookup | One mini route and four required controls atomically applied to isolated staging; Luna remains disabled |
| Automated financial and provider-invoice reconciliation | Import `64b0d0ed-a136-4780-8a40-980ed8b11d12` records the exact 330-microusd artifact SHA-256 `3fca4456d34909942a1ce3be7d1bc4b6c50df8f163f196be1224b6c453a07684`; run `6e27c501-a8b6-444c-ad27-4765603f4fe7` checked one active invoice with zero issues | Complete on isolated staging |

## Verification evidence

```text
supabase db reset --local --no-seed        pass
supabase db lint --local --level warning   no schema errors
supabase migration up --local              cache-write migration pass
supabase test db --local                   288/288 pass across seven files
pnpm test:phase2                           concurrent duplicate/overspend pass
pnpm test:billing-config                   environment/project boundary pass
pnpm test:providers                        OpenAI/DeepSeek/MiniMax contracts pass
pnpm phase2:evaluate-provider --self-test  v14 source/requirement binding guards pass; no provider request
v14 isolated-staging evaluator dry run     35 anchors / 27 coverage rows / 5 clauses; no provider request
pnpm phase2:verify-cron-staging            deployed 401/200 and persisted-run checks pass
phase2 insufficient-credit staging check  P0001 before reservation; no authorization, dispatch, usage, or ledger side effect
phase2 real gateway staging check         one dispatch; 330 microusd; 263 capture / 95 release; pass
phase2 OpenAI organization usage export   exact minute/model/request/tokens; 330 microusd; pass
phase2 provider invoice import             immutable source hash 3fca4456...a07684; pass
phase2 post-import reconciliation          one invoice checked; zero issues; pass
phase2 subscription initial/failed/cancel 2,900 invoice-only grant; zero failed/cancel financial effect; pass
phase2 refund/dispute lifecycle           1,737 refund recovery + 263 freeze; disputed grant net zero; pass
phase2 Vercel Cron dashboard run          maintenance/reconcile GET 200; completed zero-issue run; pass
supabase db advisors --local --fail-on warn no issues
supabase db push --linked --dry-run         exactly one staging migration
supabase db push --linked                   cache-write migration applied
supabase db query --linked audit SQL        8/8 grouped staging checks pass
supabase db lint --linked --level warning   no schema errors
linked security advisors                    no high/critical; accepted Free-plan WARN plus deny-by-default INFO
linked performance advisors                 INFO-only unused indexes on the tiny staging dataset
staging PostgREST schema/RPC probe          both columns and new RPC signature pass
pnpm check:no-demo                         pass
pnpm lint                                  pass
pnpm typecheck                             pass
pnpm build                                 pass
```

The 2026-07-22 live read-only recheck against the exact isolated staging ref
`vokjkogzvtohdinhxhkk` passed all eight grouped schema/privilege audit rows.
Billing configuration, provider prices/routes, and both credit products are
applied. The real RM20 sandbox Checkout now contributes one processed payment
event, one 2,000-credit top-up lot, and one matching grant ledger entry;
subscription, subscription-event, usage, refund, dispute, and reconciliation
tables now contain the verified staging lifecycle records. The provider
invoice-import table contains the exact independently exported 330-microusd row
as immutable import `64b0d0ed-a136-4780-8a40-980ed8b11d12`.
The secret-safe preflight passes the staging target, exact Supabase URL,
service credential, Stripe test mode, webhook secret, portal configuration,
cron secret, and the accepted mini route. The reviewed configuration is now
applied; remaining exit work is real financial/provider lifecycle evidence,
not another single-rubric tuning loop.

The real signed-in staging account was also tested before funding against the
applied `assignment.requirement_extraction` mini route. Its valid 263-credit
quote and 356-credit safety reservation failed atomically with PostgreSQL code
`P0001` and message `Insufficient credits`. Counts for reservations, provider
authorizations, usage events, and ledger entries were identical before and
after the attempt, proving the gateway cannot dispatch a provider request when
the wallet has no funds. The private evidence file is stored outside Git and
contains only non-secret identifiers plus a hash of the staging account ID.

The concurrency test makes two simultaneous identical reservations and proves one reservation/ledger effect. It then makes two distinct simultaneous 80-credit reservations against a 100-credit wallet and proves exactly one succeeds. The test is localhost-only, requires `AIDO_ALLOW_LOCAL_DB_RESET=1`, and resets the isolated database afterward so no fixture data remains.

## Staging limitations and production boundary

- The isolated `AidoForMe Staging` Supabase project
  (`vokjkogzvtohdinhxhkk`, Singapore, $0/month) now contains all canonical
  Phase 1 migrations and all ten Phase 2 migrations through
  `aido_phase_two_cache_write_accounting`. Before the new migration was
  applied, the 13 existing remote ledger entries were compared with the
  corresponding repository SQL and every statement body matched byte for
  byte; their alternate timestamps were then normalized to the canonical
  versions. A final dry run listed only the cache-write migration. Read-only
  staging probes confirm the cache-write price column, usage column, and new
  service RPC signature are live. The provider-price and usage tables now
  contain the reviewed prices and the one verified gateway usage event. Local
  database advisors report no issues. The connected Supabase plugin
  independently confirms that the exact staging project is healthy, all 14
  canonical migrations are present, and the only warning-level hosted finding
  is disabled leaked-password protection. The signed-in staging dashboard
  confirms that this control is available only on Supabase Pro while the
  isolated project is on Free. No plan or billing change was made. The owner
  explicitly accepts this limitation for isolated staging only; leaked-password
  protection remains a hard requirement before any public or production launch.
- Stripe is now authenticated to the isolated `AidoForMe` sandbox account
  `acct_1Tv6yz1tdTVob40G`. The approved RM20/2,000-credit top-up and
  RM29/2,900-credit monthly prices are verified with `livemode: false`, and the
  expiry descriptions/metadata record 180 days and 35 days respectively. The
  cancellation-only portal configuration `bpc_1Tv93i1tdTVob40Gc9FMuhaa` is
  active with payment-method updates and invoice history enabled, cancellation
  at period end, and plan/quantity changes disabled. An active sandbox webhook
  destination now points at the isolated Vercel staging deployment and its
  signing secret is stored server-side only. See
  [`phase-two-stripe-staging-evidence.md`](./phase-two-stripe-staging-evidence.md).
  Real top-up event `evt_1TvkZj1tdTVob40GuZuH0MAZ` first received HTTP 500
  while Stripe settlement details were not yet available, then Stripe's
  automatic retry received HTTP 200 at `2026-07-21T20:47:55Z`. The resulting
  database state is exactly one processed payment event, one 2,000-credit lot
  expiring after 180 days, one grant ledger entry, and a non-negative 2,000
  available-credit wallet. A Workbench manual resend received HTTP 200 at
  `2026-07-21T20:49:04Z`; machine comparison against the pre-redelivery
  baseline proved the payment, lot, grant, and wallet state were unchanged.
  The paid subscription invoice granted exactly 2,900 credits; Checkout and
  subscription creation granted zero. A controlled RM29 failed renewal created
  no credit effect, the portal scheduled cancellation for the period end, the
  original RM20 refund recovered 1,737 credits and froze 263 unrecovered, and a
  disputed RM20 Checkout produced a +2,000/-2,000 net-zero effect. The dispute
  event preceded Checkout completion by one second; signed event redelivery
  after the source grant proved safe out-of-order recovery.
- Controlled OpenAI staging evaluations were executed against the uploaded
  developer-owned brief/rubric. The completed saved response failed real
  PDF-page/excerpt anchor validation. After explicit approval, a deterministic
  anchored-text retry completed with 10 requirements and 16 canonical anchors;
  all automatic source/page/text-hash validation checks pass. Human checklist
  review against the real PDFs then failed: 37.5% critical recall, 90% anchor
  accuracy, nine missing critical requirements, three partly correct rows, and
  incomplete coverage. The table parser omitted the visible rubric criteria
  from the provider input. After explicit approval, a table-aware local-OCR v5
  request completed with 26 requirements and 41 anchors and passed automatic
  validation, but human review failed at 66.7% critical recall and 54.8% anchor
  accuracy. Four critical items were missing and seven rows were partly
  correct. After explicit approval, the v6 row-aware request completed with 25
  requirements and 48 materialized anchors and passed every automatic check.
  Its locked semantic review still failed: 58.8% critical-requirement recall
  and 96.4% requirement-anchor accuracy, with six brief/learning-outcome
  requirements omitted, one required ambiguity missed, one unsupported
  completion of truncated rubric text, and two contextual notices promoted to
  requirements. After explicit approval, v7 recovered every previously missing
  learning outcome, instruction, ambiguity, and context classification. Four
  identical coverage rows were safely canonicalized offline without another
  provider request. The semantic review still failed narrowly at 94.1%
  critical recall and 96.3% anchor accuracy because one row completed truncated
  source text with unsupported wording. After explicit approval, one v8 Luna
  comparison completed with 24 requirements and 34 anchors. Automatic
  validation passed, all returned rows were supported, and the prior truncated
  completion was corrected. The locked semantic review still failed because
  all four learning outcomes were misclassified as context-only: critical
  recall fell to 76.5% (13 of 17), although returned-row anchor accuracy was
  100%. The evaluator now has a deterministic guard that prevents the two
  numbered, student-directed action blocks from passing as context-only. One
  approved post-fix Luna request returned HTTP 200 without a completed response
  and was rejected; no retry or mini fallback occurred. The next offline
  contract also requires low confidence, student confirmation, and an ambiguity
  for any requirement based on incomplete source text. The route remains
  unapproved. Non-secret
  metrics and the decision
  are recorded in
  [`phase-two-provider-decision-evidence.md`](./phase-two-provider-decision-evidence.md).
- The owner rejected GPT-5.6 Sol on cost and selected `gpt-5.6-luna` for one
  controlled comparison, with the failed `gpt-5.4-mini-2026-03-17` result
  retained only as a manual technical fallback. The Luna request used the
  exact v7 prompt/schema and locked checklist, `reasoning.effort: none`,
  `store: false`, and no tools/search. It took 14,527 ms, used 5,062 input,
  5,059 cache-write input, and 3,492 output tokens, and was estimated at USD
  0.0273. The comparable completed mini request cost USD 0.0202 and came much
  closer to the locked recall threshold, so mini is the recommended next
  controlled candidate, not an approved route. One subsequently approved
  guarded mini request completed for USD 0.0209. Both new safety guards passed,
  but automatic coverage validation failed because one of 27 required anchors
  was missing and two rubric anchors had conflicting duplicate classifications.
  The private report was retained, semantic review was blocked, and no retry or
  fallback request was made. The array-shaped coverage receipt has now been
  replaced offline by a strict object with all 27 anchor IDs as required unique
  properties. After explicit approval, one v11 mini request used this contract
  and returned every required anchor exactly once. A shape-only null-metadata
  anchor was removed by a deterministic offline canonicalizer, after which all
  automatic checks passed without another provider request. The locked human
  review nevertheless failed: critical recall was 88.2% (15 of 17) and anchor
  accuracy was 96.3% (26 of 27). One critical country-impact purpose was
  omitted and one truncated rubric fragment was completed with unsupported
  wording. Mini therefore remains unapproved. The offline v13 contract now
  creates five deterministic complete atomic clauses, binds the exact text and
  hash of each clause into the strict schema, and requires a different
  one-clause requirement for every receipt. It independently marks the
  truncated OCR block, emits no atomic clause from it, prohibits that block
  from all semantic extraction, and permits only one fixed neutral ambiguity.
  Regression tests reject merged or omitted clauses and any guessed completion.
  The v13 isolated-staging dry run passed with no provider request. The owner
  then reviewed checklist SHA-256
  `3ee2e0dc9d71b53cc3c190aed861cfc7ca090ac10bb151a637715c105d4d1324`
  and approved exactly one mini request with no retry, no fallback, and a USD
  0.048 cap. It completed as
  `resp_04f69099eeeb93be016a5fcce9cfe48199b3f26bb488957481` in 13,186 ms,
  using 8,111 input and 2,426 output tokens for an estimated USD 0.017001. The
  pre-dispatch conservative ceiling was USD 0.047172. All schema, anchor,
  atomic-clause, uniqueness, incomplete-text, and truncation guards passed,
  but one of 27 coverage receipts classified a block as an assignment
  requirement without any returned requirement citing it. Automatic
  validation failed, human review was blocked, and no retry or fallback was
  made. V14 requires each requirement-classified receipt to name a
  real returned requirement that cites the same anchor, while every other
  receipt must name `null`. Its regression suite and isolated-staging dry run
  passed without a provider request. A private v14 checklist was stored outside
  Git with mode `0600`; its reviewed SHA-256 was
  `958c91b347b16456f9cdf8f158b1822e3e2cad910afbe771ad3792be5d0668a5`.
  It was bound to the exact v14 prompt, v11 schema, v7 anchoring contract,
  isolated staging project, two document hashes, `gpt-5.4-mini-2026-03-17`,
  no retry or fallback, and a USD 0.048 maximum. The approved request completed
  as `resp_07564adb0d24326c016a5fd4626c90819b82de380e473cef8a` for an estimated
  USD 0.018463. After a transparent offline sanitizer removed four unsupported
  optional labels without changing requirement text or anchors, every
  automatic guard passed. The locked review recorded 70.6% critical recall and
  100% returned requirement-anchor accuracy. The owner explicitly clarified
  that one subject-specific rubric is staging evidence rather than a universal
  perfection gate. Mini is accepted only for isolated staging with student
  confirmation/editing required; the 95% recall target remains a broader
  multi-subject pre-launch gate. The consumed evaluation request is code-locked.
  The evaluator requires an explicit private `provider_request_approval` block
  bound to the exact staging project, model, prompt, schema, anchoring version,
  document hashes, cost ceiling, retry policy, and fallback policy before any
  paid provider request can run.
  The cache-write accounting defect is closed in code and on isolated staging.
  Reviewed configuration SHA-256
  `527f53f9bd3d4f28d7fd96b053250ffbdd48ceccbf956cde81511c4cccb7e53b`
  was applied atomically as import `aad70ebe-6821-47ca-90cf-5ec2b70fbe95`.
  Read-back confirms one approved mini route, two credit products, four enabled
  controls, and one disabled Luna control. The real top-up lifecycle has now
  created the single verified payment/lot/grant described above.
- The Stripe Sandbox catalog now matches the reviewed configuration exactly for
  both product keys, amounts, billing modes, grants, and expiry. A guarded
  metadata repair updated only the four mismatched sandbox product-key fields;
  compensating rollback was available, read-back passed, and an immediate
  read-only rerun found zero pending changes. Deployment
  `dpl_DXAqB56QpptwmrLnj7RcYdchJXt5` also returns HTTP 400 for both missing and
  invalid webhook signatures, independently confirmed by Vercel runtime logs.
  Test-mode top-up, subscription, portal cancellation, failed renewal, refund,
  dispute, duplicate delivery, and out-of-order retry are now verified.
- The staging production deployment now has Vercel Cron evidence. Dashboard
  `Run` invoked both registered jobs through Vercel itself; runtime logs show
  GET 200 for maintenance at `2026-07-21T21:50:26Z` and reconciliation at
  `2026-07-21T21:50:32Z`. Reconciliation persisted completed run
  `944b3aca-e6c0-4980-8fa4-a490ac24154e` with zero issues. Ordinary browser
  requests without `CRON_SECRET` remain HTTP 401. Vercel documents Hobby cron
  precision as hourly, so the earlier automatic run at `02:37Z` falls within
  the configured `02:17Z` hour rather than representing a timing mismatch.
  See [`phase-two-cron-staging-evidence.md`](./phase-two-cron-staging-evidence.md).
- The exact OpenAI organization-usage result for `2026-07-21T20:58:00Z` through
  `20:59:00Z` was exported on 2026-07-22. The source export SHA-256 is
  `d44bc6c5e5ebb90ee4bc3b2eab580f881675b60bdbdac3ef2a2d6114ae740555`;
  its mode-`0600` import artifact SHA-256 is
  `3fca4456d34909942a1ce3be7d1bc4b6c50df8f163f196be1224b6c453a07684`.
  Immutable import `64b0d0ed-a136-4780-8a40-980ed8b11d12` records 330
  microusd. Fresh reconciliation run
  `6e27c501-a8b6-444c-ad27-4765603f4fe7` completed at
  `2026-07-22T02:39:46.448Z`, checked one provider invoice, and persisted zero
  issues. The verifier recorded `provider_request_made: false`. Private
  evidence remains outside Git at
  `/Users/hoeenjoe/Documents/AidoForMe-private/phase2-openai-usage-import-2026-07-22.json`
  and
  `/Users/hoeenjoe/Documents/AidoForMe-private/phase2-reconciliation-after-provider-import-2026-07-22.json`.
- The private, outside-repository reviewed configuration contains the approved
  Stripe products, grants/expiry, Luna and mini price snapshots, margin/FX
  controls, and operational limits. The same file was applied atomically to
  isolated staging; mini and its four control scopes are enabled, while Luna
  remains disabled.
- Secret-safe local inspection on 2026-07-20 found `.env.local` still targets the shared production Supabase URL and does not define the Phase 2 service-role, Stripe, cron, target, or provider variables. It must not be used for staging evidence; configure a separate staging environment without committing or printing secret values.
- No Phase 2 migration was applied to the shared production database. The
  local CLI was found linked to shared production, was relinked to the exact
  isolated staging ref before any push, and every remote operation was guarded
  by that staging ref. Production promotion still requires explicit approval
  after the external staging gate.
- No student-facing AI feature invokes the gateway yet. Phase 3’s real requirement-analysis slice is the first intended low-risk feature.

## Release decision

Keep Phase 2 disabled in production. All real Stripe, provider-gateway, wallet,
provider-invoice, and Vercel Cron staging lifecycles are complete. The only
final schema, advisor, database, concurrency, billing-boundary,
provider-contract, no-demo, lint, typecheck, and build gates passed on
2026-07-22. Phase 2 is exit-gate complete for isolated staging, so Phase 3 may
begin there. Production promotion remains separately unauthorized, and leaked-
password protection plus the retained multi-subject quality gate remain hard
requirements before public or production launch.
