import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const STAGING_PROJECT_REF = "vokjkogzvtohdinhxhkk";
const STAGING_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
const STAGING_APP_URL = "https://aidofor-me-2afl.vercel.app";
const STRIPE_ACCOUNT_ID = "acct_1Tv6yz1tdTVob40G";
const TOPUP_PRODUCT_KEY = "credits.topup.rm20";
const TOPUP_PRICE_ID = "price_1Tv74C1tdTVob40GsRVesOzt";
const TOPUP_AMOUNT_SEN = 2_000;
const TOPUP_CREDITS = 2_000;
const TOPUP_EXPIRY_DAYS = 180;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseEnvFile(source) {
  const values = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'")))
    ) value = value.slice(1, -1);
    values[name] = value;
  }
  return values;
}

function requireValue(values, name) {
  const value = values[name] || process.env[name];
  if (!value) throw new Error(`${name} is missing.`);
  return value;
}

function assertOutsideRepository(path, label) {
  const repositoryRoot = resolve(".");
  const resolvedPath = resolve(path);
  if (
    resolvedPath === repositoryRoot
    || resolvedPath.startsWith(`${repositoryRoot}${sep}`)
  ) throw new Error(`${label} must be outside the repository.`);
  return resolvedPath;
}

function one(rows, label) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`${label} expected exactly one row; found ${rows?.length ?? 0}.`);
  }
  return rows[0];
}

function objectId(value) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function digestIdentifier(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function stripInternalIds(snapshot) {
  return {
    payment_event_id_sha256: digestIdentifier(snapshot.payment.id),
    credit_lot_id_sha256: digestIdentifier(snapshot.lot.id),
    ledger_entry_id_sha256: digestIdentifier(snapshot.ledger.id),
    payment: {
      stripe_event_id: snapshot.payment.stripe_event_id,
      stripe_event_type: snapshot.payment.stripe_event_type,
      event_kind: snapshot.payment.event_kind,
      livemode: snapshot.payment.livemode,
      stripe_object_id: snapshot.payment.stripe_object_id,
      currency: snapshot.payment.currency,
      amount_gross_sen: snapshot.payment.amount_gross_sen,
      amount_net_sen: snapshot.payment.amount_net_sen,
      credits_affected: snapshot.payment.credits_affected,
      status: snapshot.payment.status,
      received_at: snapshot.payment.received_at,
      processed_at: snapshot.payment.processed_at,
    },
    lot: {
      source: snapshot.lot.source,
      granted_credits: snapshot.lot.granted_credits,
      remaining_credits: snapshot.lot.remaining_credits,
      reserved_credits: snapshot.lot.reserved_credits,
      status: snapshot.lot.status,
      expires_at: snapshot.lot.expires_at,
      created_at: snapshot.lot.created_at,
    },
    ledger: {
      entry_type: snapshot.ledger.entry_type,
      available_delta: snapshot.ledger.available_delta,
      reserved_delta: snapshot.ledger.reserved_delta,
      unrecovered_delta: snapshot.ledger.unrecovered_delta,
      available_balance_after: snapshot.ledger.available_balance_after,
      reserved_balance_after: snapshot.ledger.reserved_balance_after,
      unrecovered_balance_after: snapshot.ledger.unrecovered_balance_after,
      created_at: snapshot.ledger.created_at,
    },
    wallet: {
      available_credits: snapshot.wallet.available_credits,
      reserved_credits: snapshot.wallet.reserved_credits,
      unrecovered_credits: snapshot.wallet.unrecovered_credits,
      status: snapshot.wallet.status,
    },
    counts: snapshot.counts,
  };
}

async function discoverEvent(stripe, createdAfter) {
  const created = createdAfter
    ? { gte: Math.floor(new Date(createdAfter).valueOf() / 1_000) }
    : undefined;
  if (createdAfter && !Number.isFinite(created.gte)) {
    throw new Error("--created-after must be an ISO-8601 instant.");
  }
  const events = await stripe.events.list({
    type: "checkout.session.completed",
    limit: 100,
    ...(created ? { created } : {}),
  });
  const matches = events.data.filter((event) => {
    const session = event.data.object;
    return !event.livemode
      && session.object === "checkout.session"
      && session.mode === "payment"
      && session.payment_status === "paid"
      && session.metadata?.aido_product_key === TOPUP_PRODUCT_KEY
      && session.currency === "myr"
      && session.amount_total === TOPUP_AMOUNT_SEN
      && UUID.test(session.client_reference_id ?? "");
  });
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one real paid RM20 Aido top-up event in the search window; found ${matches.length}. Pass --event-id to select a reviewed event explicitly.`,
    );
  }
  return matches[0];
}

async function databaseSnapshot(admin, eventId) {
  const paymentResult = await admin
    .from("aido_payment_events")
    .select("id,stripe_event_id,stripe_event_type,event_kind,livemode,stripe_object_id,user_id,credit_product_id,currency,amount_gross_sen,amount_net_sen,credits_affected,status,received_at,processed_at")
    .eq("stripe_event_id", eventId);
  if (paymentResult.error) throw paymentResult.error;
  const payment = one(paymentResult.data, "payment event");

  const [lotResult, ledgerResult, walletResult, productResult, customerResult] = await Promise.all([
    admin
      .from("aido_credit_lots")
      .select("id,user_id,source,credit_product_id,payment_event_id,granted_credits,remaining_credits,reserved_credits,status,expires_at,created_at")
      .eq("payment_event_id", payment.id),
    admin
      .from("aido_credit_ledger")
      .select("id,user_id,entry_type,credit_lot_id,payment_event_id,available_delta,reserved_delta,unrecovered_delta,available_balance_after,reserved_balance_after,unrecovered_balance_after,created_at")
      .eq("payment_event_id", payment.id),
    admin
      .from("aido_credit_wallets")
      .select("user_id,available_credits,reserved_credits,unrecovered_credits,status")
      .eq("user_id", payment.user_id),
    admin
      .from("aido_credit_products")
      .select("id,product_key,kind,stripe_price_id,amount_sen,credit_grant,expires_after_days")
      .eq("id", payment.credit_product_id),
    admin
      .from("aido_payment_customers")
      .select("user_id,stripe_customer_id")
      .eq("user_id", payment.user_id),
  ]);
  for (const result of [lotResult, ledgerResult, walletResult, productResult, customerResult]) {
    if (result.error) throw result.error;
  }
  return {
    payment,
    lot: one(lotResult.data, "credit lot"),
    ledger: one(ledgerResult.data, "ledger grant"),
    wallet: one(walletResult.data, "wallet"),
    product: one(productResult.data, "credit product"),
    customer: one(customerResult.data, "payment customer"),
    counts: {
      payment_events: paymentResult.data.length,
      credit_lots: lotResult.data.length,
      ledger_entries: ledgerResult.data.length,
      wallets: walletResult.data.length,
    },
  };
}

function assertDatabaseSnapshot(snapshot, stripeFacts) {
  const { payment, lot, ledger, wallet, product, customer } = snapshot;
  if (
    payment.stripe_event_type !== "checkout.session.completed"
    || payment.event_kind !== "purchase"
    || payment.livemode
    || payment.stripe_object_id !== stripeFacts.charge_id
    || payment.currency !== "MYR"
    || payment.amount_gross_sen !== TOPUP_AMOUNT_SEN
    || payment.amount_net_sen !== stripeFacts.net_amount_sen
    || payment.credits_affected !== TOPUP_CREDITS
    || payment.status !== "processed"
    || !payment.processed_at
  ) throw new Error("The processed payment event does not reconcile with Stripe.");
  if (
    product.product_key !== TOPUP_PRODUCT_KEY
    || product.kind !== "topup"
    || product.stripe_price_id !== TOPUP_PRICE_ID
    || product.amount_sen !== TOPUP_AMOUNT_SEN
    || product.credit_grant !== TOPUP_CREDITS
    || product.expires_after_days !== TOPUP_EXPIRY_DAYS
  ) throw new Error("The payment event is not linked to the approved top-up product.");
  if (
    customer.stripe_customer_id !== stripeFacts.customer_id
    || customer.user_id !== payment.user_id
    || lot.user_id !== payment.user_id
    || ledger.user_id !== payment.user_id
    || wallet.user_id !== payment.user_id
  ) throw new Error("The Stripe customer and financial rows do not belong to the same Aido account.");
  if (
    lot.source !== "topup"
    || lot.credit_product_id !== payment.credit_product_id
    || lot.payment_event_id !== payment.id
    || lot.granted_credits !== TOPUP_CREDITS
    || lot.remaining_credits !== TOPUP_CREDITS
    || lot.reserved_credits !== 0
    || lot.status !== "active"
    || !lot.expires_at
  ) throw new Error("The top-up credit lot is incomplete or has an unexpected balance.");
  const expiryDays = (new Date(lot.expires_at) - new Date(lot.created_at)) / 86_400_000;
  if (Math.abs(expiryDays - TOPUP_EXPIRY_DAYS) > 0.01) {
    throw new Error(`The top-up credit lot expiry is ${expiryDays.toFixed(4)} days, not 180 days.`);
  }
  if (
    ledger.entry_type !== "grant"
    || ledger.credit_lot_id !== lot.id
    || ledger.payment_event_id !== payment.id
    || ledger.available_delta !== TOPUP_CREDITS
    || ledger.reserved_delta !== 0
    || ledger.unrecovered_delta !== 0
  ) throw new Error("The top-up did not produce exactly one matching ledger grant.");
  for (const value of [
    ledger.available_balance_after,
    ledger.reserved_balance_after,
    ledger.unrecovered_balance_after,
    wallet.available_credits,
    wallet.reserved_credits,
    wallet.unrecovered_credits,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("A wallet or ledger balance is invalid or negative.");
  }
  if (
    wallet.available_credits !== ledger.available_balance_after
    || wallet.reserved_credits !== ledger.reserved_balance_after
    || wallet.unrecovered_credits !== ledger.unrecovered_balance_after
  ) throw new Error("The wallet projection does not match the last top-up ledger entry.");
}

const envPath = option("--env-file");
const outputPath = option("--output");
const eventIdOption = option("--event-id");
const createdAfter = option("--created-after");
const baselinePath = option("--baseline");
const workbenchRedeliveryAt = option("--workbench-redelivery-at");
if (!envPath || !outputPath || (!eventIdOption && !createdAfter)) {
  throw new Error(
    "Usage: node scripts/verify-phase-two-topup-lifecycle.mjs --env-file /absolute/path/.env.staging.local (--event-id evt_... | --created-after 2026-07-22T00:00:00.000Z) --output /absolute/private/path/evidence.json [--baseline /absolute/private/path/initial-evidence.json --workbench-redelivery-at 2026-07-21T20:49:04.000Z]",
  );
}
if (eventIdOption && !/^evt_[A-Za-z0-9]+$/.test(eventIdOption)) {
  throw new Error("--event-id must be a Stripe event ID.");
}

const resolvedOutputPath = assertOutsideRepository(outputPath, "Lifecycle evidence");
const resolvedBaselinePath = baselinePath
  ? assertOutsideRepository(baselinePath, "Lifecycle baseline")
  : null;
const envValues = parseEnvFile(await readFile(resolve(envPath), "utf8"));
const supabaseUrl = requireValue(envValues, "NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
const billingTarget = requireValue(envValues, "AIDO_BILLING_CONFIG_TARGET");
const serviceRoleKey = requireValue(envValues, "SUPABASE_SERVICE_ROLE_KEY");
const stripeKey = requireValue(envValues, "STRIPE_SECRET_KEY");
const siteUrl = requireValue(envValues, "NEXT_PUBLIC_SITE_URL").replace(/\/$/, "");
if (
  supabaseUrl !== STAGING_SUPABASE_URL
  || billingTarget !== "staging"
  || siteUrl !== STAGING_APP_URL
) throw new Error("The lifecycle verifier must target isolated AidoForMe staging exactly.");
if (!stripeKey.startsWith("sk_test_") && !stripeKey.startsWith("rk_test_")) {
  throw new Error("The lifecycle verifier requires a Stripe sandbox key.");
}

const stripe = new Stripe(stripeKey);
const account = await stripe.accounts.retrieve();
if (account.id !== STRIPE_ACCOUNT_ID) {
  throw new Error("The Stripe key does not belong to the approved AidoForMe sandbox account.");
}
const event = eventIdOption
  ? await stripe.events.retrieve(eventIdOption)
  : await discoverEvent(stripe, createdAfter);
if (event.type !== "checkout.session.completed" || event.livemode) {
  throw new Error("The selected Stripe event is not a sandbox Checkout completion.");
}
const eventSession = event.data.object;
if (eventSession.object !== "checkout.session") {
  throw new Error("The selected event does not contain a Checkout session.");
}
const session = await stripe.checkout.sessions.retrieve(eventSession.id, {
  expand: ["line_items.data.price", "payment_intent.latest_charge.balance_transaction"],
});
const lineItems = session.line_items?.data ?? [];
const paymentIntent = session.payment_intent;
const charge = typeof paymentIntent === "string" || !paymentIntent
  ? null
  : paymentIntent.latest_charge;
const balance = !charge || typeof charge === "string" ? null : charge.balance_transaction;
const customerId = objectId(session.customer);
if (
  session.mode !== "payment"
  || session.payment_status !== "paid"
  || session.metadata?.aido_product_key !== TOPUP_PRODUCT_KEY
  || session.currency !== "myr"
  || session.amount_total !== TOPUP_AMOUNT_SEN
  || lineItems.length !== 1
  || lineItems[0].quantity !== 1
  || objectId(lineItems[0].price) !== TOPUP_PRICE_ID
  || !UUID.test(session.client_reference_id ?? "")
  || !customerId
  || !charge
  || typeof charge === "string"
  || !balance
  || typeof balance === "string"
) throw new Error("The selected Checkout does not match the approved paid RM20 top-up contract.");

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const snapshot = await databaseSnapshot(admin, event.id);
const stripeFacts = {
  event_id: event.id,
  event_created_at: new Date(event.created * 1_000).toISOString(),
  checkout_session_id: session.id,
  payment_intent_id: paymentIntent.id,
  charge_id: charge.id,
  customer_id: customerId,
  price_id: TOPUP_PRICE_ID,
  currency: "MYR",
  gross_amount_sen: session.amount_total,
  net_amount_sen: balance.net,
  livemode: event.livemode,
};
assertDatabaseSnapshot(snapshot, stripeFacts);
const publicSnapshot = stripInternalIds(snapshot);

let redelivery = null;
if (resolvedBaselinePath) {
  const observedRedelivery = new Date(workbenchRedeliveryAt ?? "");
  if (
    !workbenchRedeliveryAt
    || !Number.isFinite(observedRedelivery.valueOf())
    || observedRedelivery.toISOString() !== workbenchRedeliveryAt
  ) {
    throw new Error("Post-redelivery verification requires --workbench-redelivery-at as an ISO-8601 UTC instant observed in Stripe Workbench.");
  }
  const baseline = JSON.parse(await readFile(resolvedBaselinePath, "utf8"));
  if (baseline.stage !== "initial_delivery" || baseline.stripe?.event_id !== event.id) {
    throw new Error("The redelivery baseline does not describe this event's initial delivery.");
  }
  const baselineSnapshot = JSON.stringify(baseline.database);
  const currentSnapshot = JSON.stringify(publicSnapshot);
  if (baselineSnapshot !== currentSnapshot) {
    throw new Error("Financial rows changed after Stripe redelivery; idempotency failed.");
  }
  redelivery = {
    verified: true,
    baseline_sha256: createHash("sha256")
      .update(await readFile(resolvedBaselinePath))
      .digest("hex"),
    workbench_attempt: {
      observed_at: workbenchRedeliveryAt,
      http_status: 200,
      delivery_type: "retried_manually",
    },
    financial_effects_unchanged: true,
    note: "The Workbench delivery timestamp/status is operator-observed; database equality is machine-verified.",
  };
}

const evidence = {
  verified_at: new Date().toISOString(),
  stage: resolvedBaselinePath ? "post_redelivery" : "initial_delivery",
  target_environment: "staging",
  staging_project_ref: STAGING_PROJECT_REF,
  stripe_account_id: account.id,
  stripe_mode: "test",
  stripe: stripeFacts,
  database: publicSnapshot,
  redelivery,
};

await mkdir(dirname(resolvedOutputPath), { recursive: true, mode: 0o700 });
await writeFile(resolvedOutputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
console.log(JSON.stringify({
  passed: true,
  stage: evidence.stage,
  stripe_event_id: event.id,
  payment_event_count: publicSnapshot.counts.payment_events,
  credit_lot_count: publicSnapshot.counts.credit_lots,
  ledger_grant_count: publicSnapshot.counts.ledger_entries,
  wallet_balances_nonnegative: true,
  private_evidence_path: resolvedOutputPath,
}, null, 2));
