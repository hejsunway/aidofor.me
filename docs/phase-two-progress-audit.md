# Phase 2 Progress Audit

> Date: 2026-07-19  
> Scope: prepaid credits, Stripe payments, provider gateway, and loss controls  
> Release status: local implementation only; not applied to the linked TutorPakar production project

## Completed locally

- Versioned billing configuration, provider prices, feature rate cards, approved provider routes, credit products, and operational kill switches.
- Non-negative wallets, expiring credit lots, append-only ledger, reservations, allocations, provider authorizations, usage events, verified payment events, refunds, chargebacks, and unrecovered-credit freezes.
- Service-only atomic grant, reserve, authorize, usage-record, settle, release, expiry, refund, chargeback, and reconciliation functions. Browser roles have read-own RLS only and cannot execute financial mutations.
- Exactly-once validation rejects reuse of a job, usage, provider, settlement, release, or Stripe event key when any material facts change.
- Global, feature, provider, and model daily budgets and concurrent-call controls. Missing controls, rates, routes, wallets, or secrets fail closed.
- Server-only integer quote calculation with a configured FX buffer and provider-cost margin floor.
- Server-only OpenAI Responses gateway with database authorization before every call, hard token/tool/search/page/cost ceilings, timeout, provider idempotency header, actual usage capture, output validation, settlement, and release-on-failure.
- Stripe Checkout for effective one-time top-up and subscription products, raw-body webhook signature verification, settled net-amount retrieval, one-time purchase and paid-invoice credit grants, refund reversal, and dispute reversal.
- Real `/app/billing` wallet, lot, ledger, and payment history. Environments without the Phase 2 schema show an honest unavailable state and no simulated balance.
- Read-only reconciliation output for wallet-to-lot, wallet-to-ledger, reservation-to-usage, and payment-to-financial-effect mismatches.

## Requirement-by-requirement state

| Phase 2 plan requirement | Current evidence | State |
|---|---|---|
| Versioned provider prices and feature rate cards | Core migration plus server-side integer quote calculation | Complete locally |
| Lots, wallet, append-only ledger, reservations, usage, payments, refunds, reversals | Core and atomic migrations; pgTAP invariants | Complete locally |
| Atomic reserve, settle, release, expire, refund, chargeback | Service-only functions plus concurrency test | Complete locally |
| Verified, idempotent Stripe grants | Raw-signature route and atomic event functions | Code complete; external staging evidence missing |
| Real balance, history, subscription, and top-up interfaces | Real wallet/history and Checkout; no subscription status or portal | Partial |
| Plan/user/concurrency/provider controls and kill switches | Rate cards, system controls, provider budget authorization | Complete locally |
| Server-only gateway with hard ceilings | OpenAI Responses gateway and database authorization | Complete locally; external call evidence missing |
| Provider-reported usage and actual-cost capture | Token/cache/tool/search/latency/request/cost fields and settlement | Complete locally; invoice comparison missing |
| Approved lower-cost routing | Versioned approved route table and fail-closed lookup | Mechanism complete; no reviewed effective configuration |
| Automated financial and provider-invoice reconciliation | Read-only database mismatch function | Partial; scheduled runner and invoice import missing |

## Verification evidence

```text
supabase db reset --local --no-seed        pass
supabase db lint --local --level warning   no schema errors
supabase test db --local                   104/104 pass
pnpm test:phase2                           concurrent duplicate/overspend pass
supabase db advisors --local --fail-on warn no issues
pnpm check:no-demo                         pass
pnpm lint                                  pass
pnpm typecheck                             pass
pnpm build                                 pass
```

The concurrency test makes two simultaneous identical reservations and proves one reservation/ledger effect. It then makes two distinct simultaneous 80-credit reservations against a 100-credit wallet and proves exactly one succeeds. The test is localhost-only, requires `AIDO_ALLOW_LOCAL_DB_RESET=1`, and resets the isolated database afterward so no fixture data remains.

## Not complete / not authorized for release

- No staging Supabase project or Stripe test-mode account is configured, so end-to-end Checkout, webhook delivery, refund, dispute, and provider API calls have not been exercised against real external test services.
- No provider API key was used and no chargeable provider call was made.
- Subscription Checkout and `invoice.paid` renewal-grant code paths exist, but the subscription lifecycle is incomplete and externally unverified: there is no persisted subscription-status projection, cancellation/customer-portal interface, or test-mode webhook evidence.
- Provider invoice reconciliation still needs a scheduled runner and external invoice/usage import. Network failures with no provider-reported usage require that external reconciliation to discover any late provider charge.
- Product prices, credit grants, provider rates, approved models, privacy approvals, limits, and kill switches have no seed data. They require reviewed real configuration before any paid feature can run.
- The two Phase 2 migrations have not been applied to the linked shared production database. Applying them requires a reviewed staging run and explicit approval.
- No student-facing AI feature invokes the gateway yet. Phase 3’s real requirement-analysis slice is the first intended low-risk feature.

## Release decision

Keep Phase 2 disabled in production. The Phase 1 staging gate must close first. After that, the Phase 2 exit gate still requires staging Stripe/provider flows, a complete subscription lifecycle and policy, scheduled reconciliation, real rate configuration, and an approved additive production migration.
