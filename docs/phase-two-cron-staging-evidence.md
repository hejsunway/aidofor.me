# Phase 2 cron and reconciliation staging evidence

> Verified: 2026-07-20
> Environment: isolated AidoForMe staging
> Supabase project: `vokjkogzvtohdinhxhkk`
> Vercel project: `aidofor-me-2afl` (`prj_B0ekOYIrsDQnukuD9HLbEqRcUiqU`)

No secret value or private financial row is recorded in this document.

## Deployed route protection

The production deployment for the staging project was
`dpl_BSfavseTsECCJP5BSzyPU338iJRY` on branch `codex/phase2-staging`.
Ordinary requests without `CRON_SECRET` were sent to both deployed routes:

| Route | Method | Result |
|---|---|---|
| `/api/internal/maintenance` | `GET` | HTTP 401 |
| `/api/internal/reconcile` | `GET` | HTTP 401 |

Vercel runtime logs independently recorded both 401 responses. This proves a
browser request cannot run either financial job.

## Authenticated staging verification

The repeatable secret-safe command is:

```bash
pnpm phase2:verify-cron-staging \
  --env-file /absolute/path/.env.staging.local \
  --output /absolute/private/path/cron-evidence.json
```

The verifier refuses any Supabase target except
`vokjkogzvtohdinhxhkk`, requires `AIDO_BILLING_CONFIG_TARGET=staging`,
requires a Stripe test-mode key, never prints credentials, and writes its
private JSON evidence outside the repository with mode `0600`. Read-only 401
checks have one bounded network retry. Authenticated POST requests are sent
exactly once and are never retried after an ambiguous network result.

The successful run at `2026-07-20T12:02:55.688Z` produced:

- maintenance HTTP 200;
- zero selected or expired reservations and credit lots;
- zero maintenance failures and `has_more: false`;
- reconciliation HTTP 200;
- persisted run `9d55511f-f8cc-4387-912e-c3d415611366` with scope
  `scheduled` and status `completed`;
- six internal checks, zero Stripe objects checked, zero provider invoices
  checked, zero reconciliation issues, and zero issue rows; and
- matching Vercel runtime-log entries for both successful POST requests.

The zero Stripe/invoice counts are expected because no real sandbox Checkout
or provider-invoice lifecycle has been completed. They are not evidence for
those separate exit criteria.

## Vercel Cron execution evidence

Vercel documents that Hobby cron jobs run once per day with hourly precision
(up to ±59 minutes), not exact-minute precision. Therefore completed run
`d28b1cb5-d2a9-4e97-9b07-3a088f02ade9` beginning at
`2026-07-21T02:37:14.559380Z` is within the deployed reconciliation schedule's
`02:00–02:59 UTC` Hobby window; its difference from `02:17` is not a timing
mismatch.

To retain fresh platform-origin evidence inside Hobby's one-hour log window,
deployment `dpl_B8vr2gWvRa7BjKbH9WDggXxwgRMp` temporarily registered both jobs
in the `21:00 UTC` hour. The Vercel Cron Jobs page showed both active paths and
its built-in `Run` action invoked them through Vercel:

| Vercel runtime log | Method | Result |
|---|---|---|
| `2026-07-21T21:50:26.64Z /api/internal/maintenance` | `GET` | HTTP 200 |
| `2026-07-21T21:50:32.48Z /api/internal/reconcile` | `GET` | HTTP 200 |

Reconciliation persisted run `944b3aca-e6c0-4980-8fa4-a490ac24154e`, starting
at `2026-07-21T21:50:33.884500Z`, with scope `scheduled`, status `completed`,
six internal checks, six Stripe objects checked, zero provider invoices,
zero issues, zero issue rows, and no failure code. Fresh ordinary GET requests
without `CRON_SECRET` still returned 401 for both paths. Private evidence is:

`/Users/hoeenjoe/Documents/AidoForMe-private/phase2-vercel-cron-run-2026-07-22.json`

The temporary evidence schedules were immediately restored to `47 1 * * *`
for maintenance and `17 2 * * *` for reconciliation in commit `c48d612`.
No production Supabase project or live Stripe account was accessed.

The Vercel cron execution/authorization gate is complete.

## Post-import provider reconciliation

After the exact OpenAI organization-usage artifact was imported, the same
secret-safe verifier ran once more on isolated staging. At
`2026-07-22T02:39:43.597818Z`, reconciliation run
`6e27c501-a8b6-444c-ad27-4765603f4fe7` began and completed at
`2026-07-22T02:39:46.448Z`. It recorded:

- six internal checks;
- six Stripe objects checked;
- one active provider invoice checked;
- zero reconciliation issues and zero issue rows;
- no failure code; and
- `provider_request_made: false`.

Unauthenticated requests again returned HTTP 401, while the single authenticated
maintenance and reconciliation requests returned HTTP 200. Private mode-`0600`
evidence is stored outside Git at
`/Users/hoeenjoe/Documents/AidoForMe-private/phase2-reconciliation-after-provider-import-2026-07-22.json`;
its SHA-256 is
`e1daed27bf01552403468634ad5324ad8c1ddf4f6ff18340840d5fe1e6e19ebe`.

Reference: [Vercel cron usage and Hobby precision](https://vercel.com/docs/cron-jobs/usage-and-pricing).
