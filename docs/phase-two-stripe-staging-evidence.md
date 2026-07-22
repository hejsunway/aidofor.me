# Phase 2 Stripe staging evidence

> Verified: 2026-07-22
> Stripe account: `AidoForMe` (`acct_1Tv6yz1tdTVob40G`)
> Mode: sandbox/test only (`livemode: false`)

No secret or webhook signing value is recorded in this document.

## Products and prices

| Purpose | Product | Price | Verified terms |
|---|---|---|---|
| RM20 top-up | `prod_Uuwy6sHjowHeFo` | `price_1Tv74C1tdTVob40GsRVesOzt` | MYR 20.00 one-time; grants 2,000 credits; credits expire after 180 days |
| RM29 monthly | `prod_Uux0WCbJdLWarO` | `price_1Tv76M1tdTVob40GfIIOS4Gd` | MYR 29.00 monthly; grants 2,900 credits for each paid renewal; each grant expires after 35 days |

The product descriptions and product/price metadata record the approved credit
grant, expiry, product key, and staging environment. All four Stripe objects
were read back through the sandbox API and reported `livemode: false`.

On 2026-07-20, a secret-safe verifier compared those four objects with the
reviewed outside-repository configuration (SHA-256
`ee3d88a7d0e2662cb125cb6d3d0dcd6224b7f50b36e32a1194e88fb5e6bded51`).
It found that the amounts, billing modes, grants, expiry periods, and staging
flags were already correct, but all four `aido_product_key` metadata values
used older shortened keys. The verifier updated only those sandbox metadata
fields, read every object back, and passed. A second read-only run passed with
zero pending metadata changes, proving the catalog now matches the reviewed
product keys idempotently.

The apply and read-only verifier reports remain outside the repository with
mode `0600` at:

- `/Users/hoeenjoe/Documents/AidoForMe-private/phase2-stripe-catalog-metadata-apply-evidence-2026-07-20.json`
- `/Users/hoeenjoe/Documents/AidoForMe-private/phase2-stripe-catalog-evidence-2026-07-20.json`

No Checkout Session, charge, subscription, refund, dispute, credit grant, or
other financial lifecycle object was created by this metadata repair.

## Customer portal

Configuration `bpc_1Tv93i1tdTVob40Gc9FMuhaa` is active and named
`AidoForMe Staging cancellation-only`.

Verified feature policy:

- payment-method updates enabled;
- invoice history enabled;
- subscription cancellation enabled at the end of the current billing period;
- cancellation does not create prorations;
- cancellation reasons enabled;
- subscription updates disabled, including plan/price and quantity changes;
- customer profile updates disabled;
- hosted portal login page disabled.

## Webhook destination

Verified on 2026-07-20: the active sandbox webhook destination
`we_1TvATZ1tdTVob40Grp6oRzNM` is named `AidoForMe staging billing webhook` and
delivers to:

`https://aidofor-me-2afl.vercel.app/api/stripe/webhook`

It listens for exactly these events:

- `checkout.session.completed`
- `invoice.paid` and `invoice.payment_failed`
- `customer.subscription.created`, `customer.subscription.updated`, and
  `customer.subscription.deleted`
- `customer.subscription.paused` and `customer.subscription.resumed`
- `refund.created`
- `charge.dispute.created`

Its signing secret is stored only in the developer-owned staging environment
and the isolated Vercel staging project's server environment. The secret value
is intentionally not recorded here.

Deployment `dpl_DXAqB56QpptwmrLnj7RcYdchJXt5` from commit `623b88d` corrected
the failure boundary so a configured endpoint returns HTTP 400 for both a
missing signature and an invalid signature; HTTP 503 is reserved for a missing
server-side webhook secret. The secret-safe verifier observed both HTTP 400
responses at the stable staging URL. Vercel runtime logs independently recorded
the two POST requests against that exact deployment.

## Real top-up and duplicate delivery

The signed sandbox event `evt_1TvkZj1tdTVob40GuZuH0MAZ` represents the real
Aido Checkout Session `cs_test_a1BbGyjttpsEV7olC9mEvyi89PvHF24YxjjDtklnzasCRCejQJK3PbPYvz`
for the approved RM20 top-up. Stripe Workbench records:

- initial delivery: HTTP 500 at `2026-07-21T20:47:40Z`, before the settled
  balance transaction was available;
- automatic retry: HTTP 200 at `2026-07-21T20:47:55Z`;
- operator-requested redelivery of the same event: HTTP 200 at
  `2026-07-21T20:49:04Z`, labelled `Retried manually`.

After the successful automatic retry, the isolated staging database contained
exactly one processed payment event, one 2,000-credit top-up lot expiring 180
days after grant, one matching append-only grant entry, and a wallet with 2,000
available and zero reserved credits. A machine comparison after the manual
redelivery proved the payment, lot, grant, and wallet facts were byte-for-byte
unchanged. No second financial effect occurred and no balance was negative.

The secret-safe initial and post-redelivery reports remain outside Git with
mode `0600` at:

- `/Users/hoeenjoe/Documents/AidoForMe-private/phase2-topup-initial-2026-07-22.json`
- `/Users/hoeenjoe/Documents/AidoForMe-private/phase2-topup-post-redelivery-2026-07-22.json`

## Subscription lifecycle

Real subscription Checkout
`cs_test_a1mUSoWAyitt1vVTEJRRC6iqAqdKuopTQ9YdWTPFNmYPz1ceotcaKVcLBb`
created subscription `sub_1Tvkvj1tdTVob40G1UOr9bUp`. Initial paid invoice
`in_1Tvkvh1tdTVob40G13QMqB8T` emitted signed `invoice.paid` event
`evt_1Tvkvk1tdTVob40GrfNphs2I`. The first delivery exposed an invalid
over-deep Stripe expansion and returned 500. Commit `349678e` removed that
unsupported expansion; the deployed signed redelivery then succeeded.

The persisted effect is exactly one 2,900-credit subscription lot expiring
after 35 days and one grant. Checkout completion and subscription creation
produced zero financial rows, proving credits are granted only on
`invoice.paid`.

A controlled subscription-attached RM29 off-cycle renewal invoice
`in_1TvlA31tdTVob40GhUDzrn49` used Stripe's official decline-after-attach
sandbox payment method. It emitted `invoice.payment_failed` event
`evt_1TvlA71tdTVob40GK78vJPph`, projected `past_due`, recorded the failure
time, changed no wallet balance, and created no payment event. The evidence is
truthfully labelled off-cycle because its Stripe `billing_reason` is `manual`.

The customer cancelled through the real Stripe portal. The portal displayed
“Cancels Aug 21”; Stripe represented the end-of-period schedule with explicit
`cancel_at=2026-08-21T21:21:53Z` instead of the legacy boolean flag. Signed
subscription event `evt_1TvlEP1tdTVob40GrfuM4tLR` persisted that exact
timestamp with zero financial effect and an unchanged 4,637-credit wallet.

Private evidence files:

- `/Users/hoeenjoe/Documents/AidoForMe-private/phase2-subscription-initial-2026-07-22.json`
- `/Users/hoeenjoe/Documents/AidoForMe-private/phase2-subscription-failed-renewal-2026-07-22.json`
- `/Users/hoeenjoe/Documents/AidoForMe-private/phase2-subscription-portal-cancellation-2026-07-22.json`

## Refund and dispute reversal

Full refund `re_3TvkZh1tdTVob40G07xCuh4o` reversed the original RM20 top-up
through signed event `evt_3TvkZh1tdTVob40G07nzNa7n`. Because 263 of the 2,000
credits had already funded the real gateway call, the atomic reversal recovered
1,737, recorded 263 unrecovered, froze the wallet, and left 2,900 available.
No balance became negative.

A second real RM20 Checkout
`cs_test_a1HL1w16NLdyTvRY7GB9oiAhvTZtOg342gj4W5WQvG4Ef3dKDCYew0AdPZ`
used Stripe's official fraudulent-dispute sandbox card. Stripe created dispute
event `evt_1TvlJh1tdTVob40GIH0HEXHD` one second before Checkout event
`evt_1TvlJi1tdTVob40GOROp5Z22`. The initial reversal correctly failed closed
because its source purchase did not exist yet. Signed Checkout redelivery
created the single +2,000 grant; signed dispute redelivery then created the
single -2,000 reversal. The lot is reversed, the disputed purchase has net zero
credits, and the wallet remains frozen at 2,900 available plus the prior 263
unrecovered.

Private evidence files:

- `/Users/hoeenjoe/Documents/AidoForMe-private/phase2-refund-reversal-2026-07-22.json`
- `/Users/hoeenjoe/Documents/AidoForMe-private/phase2-dispute-reversal-2026-07-22.json`

## Stripe gate status

The real top-up, duplicate delivery, subscription paid invoice, failed renewal,
portal period-end cancellation, refund, dispute, out-of-order retry, frozen
exposure, and non-negative-wallet checks are complete. Stripe is no longer a
Phase 2 blocker. Provider export reconciliation and the final full regression
gate remain outside this document.
