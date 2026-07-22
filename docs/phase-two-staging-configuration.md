# Phase 2 staging configuration gate

> Date: 2026-07-22
> Rule: no placeholder products, prices, credit grants, model rates, or API calls

## Current state

The reviewed private configuration was applied atomically to the isolated
staging project on 2026-07-22. Import
`aad70ebe-6821-47ca-90cf-5ec2b70fbe95` records source SHA-256
`527f53f9bd3d4f28d7fd96b053250ffbdd48ceccbf956cde81511c4cccb7e53b`.
Read-back confirms one billing version, two provider prices, one feature rate
card, one approved mini route, two real credit products, four enabled controls,
and one deliberately disabled Luna model control. A real RM20 sandbox Checkout
now contributes exactly one processed payment event, one 2,000-credit top-up
lot, and one grant ledger entry. The real subscription lifecycle is also
persisted: the paid invoice granted exactly 2,900 credits, the failed renewal
granted none, and the customer-portal cancellation is scheduled for period
end.

The cache-write accounting migration is now live on isolated staging. A
read-only PostgREST probe confirms both new columns and the replacement usage
RPC signature. Two reviewed provider-price rows are applied, and the funded
gateway call persisted one usage event for response
`resp_07cf317ffb241b61016a5fdd5ee49081988b8fd78f97b2b5f4`: 103 input tokens,
56 output tokens, and 330 microusd with no cache-read or cache-write tokens.
The staging migration ledger was normalized only after all 13 alternate-
timestamp remote statements matched the canonical repository files byte for
byte. The connected Supabase plugin independently confirms the exact staging
project is healthy and all 14 canonical migrations are present. Hosted
advisors report one warning: leaked-password protection is disabled. The
signed-in staging dashboard confirms that this control is Pro-only while this
isolated project is on Free; no plan or billing change was made. The owner
accepts this platform limitation for isolated staging only. Leaked-password
protection remains mandatory before public or production launch. No shared-
production schema or data was changed.

Stripe is connected to the isolated `AidoForMe` sandbox account
`acct_1Tv6yz1tdTVob40G`. The two approved products/prices and the restricted
customer portal configuration have been created and verified with
`livemode: false`. See
[`phase-two-stripe-staging-evidence.md`](./phase-two-stripe-staging-evidence.md).
An active sandbox webhook delivers to the isolated Vercel staging project. A
real signed top-up event, automatic retry, and manual duplicate redelivery are
verified; the manual duplicate returned HTTP 200 without changing the single
payment, lot, grant, or wallet effect.

## Decision and gate state

1. ~~Approve each Aido top-up and subscription price in MYR and the exact
   credits granted by each purchase or renewal.~~ Complete.
2. ~~Approve the minimum top-up, target gross margin, payment-risk reserve,
   quote safety multiplier, and conservative MYR/USD budget rate.~~ Complete.
3. Approve each provider/model route only after price-source, quality, privacy, and
   data-retention review. A route is unusable until its `approved` flag and all
   global/feature/provider/model controls are enabled.
   The deterministic anchored-text evaluations pass automatic grounding, but
   the required human reviews failed. The latest table-aware v5 result reached
   66.7% critical recall and 54.8% anchor accuracy because some OCR rubric rows
   were split across anchors and four critical items remained missing. The v6
   row-aware request subsequently passed every automatic check, but its locked
   semantic review failed at 58.8% critical-requirement recall despite 96.4%
   requirement-anchor accuracy. Missing brief/learning-outcome requirements,
   an unreported ambiguity, and partial/contextual rows prevent approval. The
   v7 source-coverage request then recovered all previously missing items and
   reached 94.1% critical recall and 96.3% anchor accuracy, but one unsupported
   completion of truncated rubric text still fails the no-partial-row rule. The
   owner then approved exactly one `gpt-5.6-luna` comparison after rejecting
   Sol's cost. Luna corrected the unsupported truncated-text completion and all
   24 returned rows had valid anchors, but it misclassified both
   learning-outcome source blocks as context-only and omitted all four critical
   outcomes. The locked review therefore failed at 76.5% critical recall even
   though returned-row anchor accuracy was 100%. A deterministic structural
   guard now prevents those two action blocks from passing as context-only, but
   the one approved post-fix Luna request returned HTTP 200 without a completed
   response and was rejected. No retry or fallback call occurred. The next
   offline contract also guards requirements sourced from incomplete text.
   GPT-5.4 mini remains unapproved, but its 94.1% recall and lower measured cost
   made it the recommended next controlled candidate. The one approved guarded
   mini request then passed both new safety guards but failed automatic coverage
   validation: one required anchor was missing and two rubric anchors had
   conflicting duplicate classifications. Human review was therefore blocked.
   The coverage receipt is now a strict object with all 27 anchor IDs required
   exactly once. One approved v11 mini request proved that contract and passed
   every automatic check after an offline, content-neutral normalization of one
   null metadata anchor. The human review still failed at 88.2% critical recall
   and 96.3% anchor accuracy: one critical country-impact purpose was omitted
   and one truncated rubric fragment was completed with unsupported wording.
   The mini route therefore remains unapproved. The v13 contract
   binds the exact text and hash of five deterministic complete atomic clauses
   into the strict schema and requires a separate one-clause requirement for
   each receipt. The independently detected truncated rubric block produces no
   clause, cannot anchor semantic output, and may appear only in one fixed
   neutral ambiguity. Regression tests and an isolated-staging dry run passed.
   A private version-bound 17-item v13 checklist exists outside Git with mode
   `0600`; the owner reviewed SHA-256
   `3ee2e0dc9d71b53cc3c190aed861cfc7ca090ac10bb151a637715c105d4d1324`.
   The owner then approved exactly one mini request with no retry/fallback and
   a USD 0.048 cap. It completed for USD 0.017001 but failed one automatic
   consistency check: one source block was classified as an assignment
   requirement without any returned requirement citing it. Human review was
   blocked and the route remains unapproved. V14 requires every
   requirement-classified coverage receipt to name a real returned requirement
   that cites the same anchor; non-requirement and incomplete receipts must name
   `null`. Its regression suite and isolated-staging dry run passed. The owner
   then approved exactly one v14 mini request using reviewed checklist SHA-256
   `958c91b347b16456f9cdf8f158b1822e3e2cad910afbe771ad3792be5d0668a5`,
   no retry/fallback, and a USD 0.048 cap. Response
   `resp_07564adb0d24326c016a5fd4626c90819b82de380e473cef8a` completed for an
   estimated USD 0.018463. Offline removal of four unsupported optional labels
   allowed every automatic grounding guard to pass without another request,
   but the locked semantic review failed at 70.6% critical recall: all four
   explicit learning outcomes, the preventive-measures criterion, and one
   required ambiguity were missing. Anchor accuracy for the ten returned
   requirement rows was 100%. The owner clarified that this developer-owned
   pair is staging evidence, not a universal-perfection benchmark: rubrics vary
   materially by subject and student. The mini route is therefore accepted for
   isolated staging with student confirmation/editing required in Phase 3. The
   95% recall target is retained for the future consented, multi-subject
   evaluation set before public launch; the consumed evaluation request remains
   code-locked.
   Distinct cache-write pricing and usage accounting is now implemented and
   deployed to isolated staging. The reviewed configuration enables only the
   accepted mini route and its global, feature, provider, and model controls;
   Luna remains disabled. Evidence is
   recorded
   in [`phase-two-provider-decision-evidence.md`](./phase-two-provider-decision-evidence.md).
4. ~~Connect Stripe sandbox mode and create Aido-only test products/prices.~~
   Complete; exact IDs and terms are recorded in the Stripe evidence note. A
   guarded verifier also corrected the four legacy product-key metadata values
   and an immediate read-only rerun found no remaining catalog mismatch.
5. ~~Create a Stripe portal configuration that enables payment-method updates and
   cancellation at period end, while disabling subscription price and quantity
   changes.~~ Configuration `bpc_1Tv93i1tdTVob40Gc9FMuhaa` is verified; its ID
   is configured as `STRIPE_PORTAL_CONFIGURATION_ID` in the isolated staging
   server environment.
6. ~~Configure the staging webhook for:
   `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `customer.subscription.paused`,
   `customer.subscription.resumed`, `refund.created`, and
   `charge.dispute.created`.~~ Complete: the active destination and its
   non-secret identifier is recorded in the Stripe evidence note. The deployed
   endpoint returns HTTP 400 for missing and invalid signatures. Event
   `evt_1TvkZj1tdTVob40GuZuH0MAZ` also proves valid signed delivery, automatic
   retry after an initial 500, and a successful manual duplicate redelivery.
7. ~~Set only server-side secrets: `SUPABASE_SERVICE_ROLE_KEY`,
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`,
   `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, and `MINIMAX_API_KEY` as required by
   the approved routes.~~ The staging-required values are present and the
   secret-safe preflight reports only their status. Never prefix them with
   `NEXT_PUBLIC_`.

The latest preflight passes the exact staging project ref/URL, billing target,
Supabase service credential presence, Stripe test-mode key, webhook secret,
portal configuration ID, cron secret, and the approved mini route. The exact
reviewed file was then applied atomically as the import recorded above. This
configuration readiness is now backed by the completed real Stripe, gateway,
provider-export, and reconciliation lifecycles described below.

A pre-funding staging check now proves the applied mini route fails before
provider dispatch when the real account has insufficient credits. The quote
was valid under the active rate card, but the reservation returned `P0001:
Insufficient credits`; reservation, authorization, usage, and ledger counts
were unchanged. This closes the insufficient-credit guard only. It does not
replace the required funded gateway call and settlement evidence.

## Configuration application

The repository contains no example prices, placeholder models, or fallback
credit grants. Use the value-free
[`billing-configuration.schema.json`](./billing-configuration.schema.json) in
your editor, prepare a reviewed JSON file outside the repository, then run:

```bash
pnpm billing:config /absolute/path/reviewed-config.json
```

Validation is read-only. It rejects unknown/missing fields, unsupported
providers, unfunded credit products, routes without all four control scopes,
provider ceilings above the minimum-charge margin, and maximum route usage
above its declared provider ceiling.

Only after review, target the isolated staging environment and apply the exact
same file atomically:

```bash
AIDO_BILLING_CONFIG_TARGET=staging \
pnpm billing:config /absolute/path/reviewed-config.json --apply
```

The command requires staging Supabase server credentials. It hashes the source,
journals the import, and uses one database transaction; the same digest is
idempotent and a failed validation leaves no partial prices, products, routes,
or controls. The importer independently requires the Supabase URL to match the
approved project for the declared environment, so a staging-labelled import
cannot be sent to the shared production project by mismatched environment
variables. Production additionally requires `--confirm-production` and still
requires explicit deployment approval.

Before any external test, run the secret-safe preflight. It reports only
`set`, `missing`, or mode/target mismatches and never prints credential values:

```bash
pnpm phase2:preflight \
  --environment staging \
  --project-ref vokjkogzvtohdinhxhkk \
  --config /absolute/path/reviewed-config.json
```

Only API keys used by an approved route are required. A staging preflight
rejects live Stripe keys and a production preflight rejects test keys. It also
requires the declared environment, project ref, public Supabase URL, and
`AIDO_BILLING_CONFIG_TARGET` to agree before reporting ready.

## Required exit evidence

- [x] One test top-up grants exactly one lot after a settled signed webhook.
- [x] Duplicate webhook delivery produces one financial effect.
- [x] One test subscription projects active status, grants only from `invoice.paid`,
  records a failed renewal, and reflects cancellation at period end.
- [x] A refund and dispute produce compensating entries and freeze unrecovered
  exposure without making the wallet negative.
- [x] An insufficient balance blocks the provider call before network access.
- [x] Concurrent reservations cannot overspend one wallet.
- [x] One real provider response records ordinary input, cache-read input,
  cache-write input, output, tools/search, latency, request ID, and the
  database-recomputed actual provider cost.
- [x] One real provider invoice/export is imported by hash and reconciles to recorded
  usage. Import `64b0d0ed-a136-4780-8a40-980ed8b11d12` records artifact
  SHA-256 `3fca4456d34909942a1ce3be7d1bc4b6c50df8f163f196be1224b6c453a07684`;
  reconciliation run `6e27c501-a8b6-444c-ad27-4765603f4fe7` checked one
  active invoice with zero issues.
- [x] The scheduled reconciliation route creates a completed run and the browser
  cannot invoke it without `CRON_SECRET`.
- [x] The scheduled maintenance route releases overdue reservations, expires due
  unreserved lots, and the browser cannot invoke it without `CRON_SECRET`.
- [x] Security/performance advisors, `scripts/audit-phase-two-schema.sql`, database
  tests, concurrency tests, billing-boundary tests, provider contracts,
  no-demo check, lint, typecheck, and build all pass. The clean local suite
  passed 288/288 assertions; linked audit passed 8/8; linked lint found no
  schema errors; live advisors had no high/critical finding.

Vercel Cron dashboard execution now proves both registered jobs return 200
when invoked through Vercel while ordinary requests return 401. Maintenance
completed without failures, and reconciliation persisted completed run
`944b3aca-e6c0-4980-8fa4-a490ac24154e` with zero issues. See
[`phase-two-cron-staging-evidence.md`](./phase-two-cron-staging-evidence.md).

After the provider import, a fresh authenticated staging verification again
returned 401 for unauthenticated maintenance/reconciliation, HTTP 200 for both
single authenticated invocations, and persisted completed reconciliation run
`6e27c501-a8b6-444c-ad27-4765603f4fe7`. It checked six internal categories,
six Stripe objects, and one provider invoice with zero issues and no provider
request. The mode-`0600` evidence artifact SHA-256 is
`e1daed27bf01552403468634ad5324ad8c1ddf4f6ff18340840d5fe1e6e19ebe`.

Vercel invokes configured cron paths only for production deployments, so the
staging Vercel project needs its own production deployment. Stripe portal
features are controlled by the selected portal configuration; disabling
subscription updates prevents unsupported price/quantity changes.

References:

- [Vercel cron job configuration](https://vercel.com/docs/cron-jobs/quickstart)
- [Stripe customer portal configuration](https://docs.stripe.com/customer-management/configure-portal)
- [Stripe portal session API](https://docs.stripe.com/api/customer_portal/sessions/create)
