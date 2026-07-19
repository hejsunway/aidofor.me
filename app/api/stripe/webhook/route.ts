import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { createBillingAdminClient } from "@/lib/billing/admin";
import { createStripeClient } from "@/lib/billing/stripe";

export const runtime = "nodejs";

function objectId(value: string | { id: string } | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

async function processCheckout(event: Stripe.Event, session: Stripe.Checkout.Session, digest: string) {
  if (session.mode !== "payment" || session.payment_status !== "paid") return;
  const stripe = createStripeClient();
  const customerId = objectId(session.customer);
  const paymentIntentId = objectId(session.payment_intent);
  if (!customerId || !paymentIntentId) throw new Error("Paid Checkout session is missing customer or payment intent.");

  const [expandedSession, paymentIntent] = await Promise.all([
    stripe.checkout.sessions.retrieve(session.id, { expand: ["line_items.data.price"] }),
    stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge.balance_transaction"] }),
  ]);
  const lineItems = expandedSession.line_items?.data ?? [];
  if (lineItems.length !== 1 || lineItems[0].quantity !== 1) throw new Error("Checkout session has an invalid credit-product quantity.");
  const priceId = objectId(lineItems[0].price);
  const charge = paymentIntent.latest_charge;
  if (!priceId || !charge || typeof charge === "string") throw new Error("Checkout payment details are incomplete.");
  const balance = charge.balance_transaction;
  if (!balance || typeof balance === "string") throw new Error("Stripe net settlement is not available yet.");
  if (expandedSession.amount_total == null || expandedSession.currency?.toUpperCase() !== "MYR") {
    throw new Error("Checkout amount or currency is invalid.");
  }

  const { error } = await createBillingAdminClient().rpc("aido_process_verified_purchase_event", {
    p_stripe_event_id: event.id,
    p_stripe_event_type: event.type,
    p_event_kind: event.type === "invoice.paid" ? "renewal" : "purchase",
    p_livemode: event.livemode,
    p_stripe_object_id: charge.id,
    p_stripe_customer_id: customerId,
    p_stripe_price_id: priceId,
    p_currency: "MYR",
    p_amount_gross_sen: expandedSession.amount_total,
    p_amount_net_sen: balance.net,
    p_payload_sha256: digest,
  });
  if (error) throw error;
}

async function processPaidInvoice(event: Stripe.Event, invoice: Stripe.Invoice, digest: string) {
  if (invoice.status !== "paid" || invoice.amount_paid <= 0) return;
  const customerId = objectId(invoice.customer);
  const lines = invoice.lines.data.filter((line) => line.amount > 0);
  const priceId = lines.length === 1
    ? objectId(lines[0].pricing?.price_details?.price ?? null)
    : null;
  if (!customerId || !priceId || invoice.currency.toUpperCase() !== "MYR") {
    throw new Error("Paid subscription invoice has unsupported billing facts.");
  }

  const stripe = createStripeClient();
  const invoicePayments = await stripe.invoicePayments.list({
    invoice: invoice.id,
    status: "paid",
    limit: 10,
    expand: ["data.payment.payment_intent.latest_charge.balance_transaction", "data.payment.charge.balance_transaction"],
  });
  const paid = invoicePayments.data.find((payment) => payment.status === "paid");
  if (!paid) throw new Error("Paid invoice has no settled Stripe payment.");
  let charge: Stripe.Charge | null = null;
  if (paid.payment.payment_intent) {
    const paymentIntent = typeof paid.payment.payment_intent === "string"
      ? await stripe.paymentIntents.retrieve(paid.payment.payment_intent, { expand: ["latest_charge.balance_transaction"] })
      : paid.payment.payment_intent;
    charge = typeof paymentIntent.latest_charge === "string" || !paymentIntent.latest_charge
      ? null
      : paymentIntent.latest_charge;
  } else if (paid.payment.charge) {
    charge = typeof paid.payment.charge === "string"
      ? await stripe.charges.retrieve(paid.payment.charge, { expand: ["balance_transaction"] })
      : paid.payment.charge;
  }
  const balance = charge?.balance_transaction;
  if (!charge || !balance || typeof balance === "string") {
    throw new Error("Subscription settlement net amount is not available yet.");
  }

  const { error } = await createBillingAdminClient().rpc("aido_process_verified_purchase_event", {
    p_stripe_event_id: event.id,
    p_stripe_event_type: event.type,
    p_event_kind: "renewal",
    p_livemode: event.livemode,
    p_stripe_object_id: charge.id,
    p_stripe_customer_id: customerId,
    p_stripe_price_id: priceId,
    p_currency: "MYR",
    p_amount_gross_sen: invoice.amount_paid,
    p_amount_net_sen: balance.net,
    p_payload_sha256: digest,
  });
  if (error) throw error;
}

async function processReversal(event: Stripe.Event, digest: string) {
  const object = event.data.object;
  let stripeObjectId: string;
  let originalChargeId: string | null;
  let amount: number;
  let reversalType: "refund" | "chargeback";
  if (event.type === "refund.created") {
    const refund = object as Stripe.Refund;
    stripeObjectId = refund.id;
    originalChargeId = objectId(refund.charge);
    amount = refund.amount;
    reversalType = "refund";
  } else if (event.type === "charge.dispute.created") {
    const dispute = object as Stripe.Dispute;
    stripeObjectId = dispute.id;
    originalChargeId = objectId(dispute.charge);
    amount = dispute.amount;
    reversalType = "chargeback";
  } else {
    return;
  }
  if (!originalChargeId) throw new Error("Stripe reversal is missing its original charge.");
  const { error } = await createBillingAdminClient().rpc("aido_process_verified_reversal_event", {
    p_stripe_event_id: event.id,
    p_stripe_event_type: event.type,
    p_livemode: event.livemode,
    p_stripe_object_id: stripeObjectId,
    p_original_stripe_object_id: originalChargeId,
    p_amount_sen: amount,
    p_payload_sha256: digest,
    p_reversal_type: reversalType,
  });
  if (error) throw error;
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) return new Response("Webhook is not configured.", { status: 503 });
  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = createStripeClient().webhooks.constructEvent(body, signature, webhookSecret);
  } catch {
    return new Response("Invalid Stripe signature.", { status: 400 });
  }

  try {
    const digest = createHash("sha256").update(body).digest("hex");
    if (event.type === "checkout.session.completed") {
      await processCheckout(event, event.data.object as Stripe.Checkout.Session, digest);
    } else if (event.type === "invoice.paid") {
      await processPaidInvoice(event, event.data.object as Stripe.Invoice, digest);
    } else if (event.type === "refund.created" || event.type === "charge.dispute.created") {
      await processReversal(event, digest);
    }
    return Response.json({ received: true });
  } catch {
    return new Response("Stripe event could not be reconciled.", { status: 500 });
  }
}
