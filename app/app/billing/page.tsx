import { ArrowDownLeft, ArrowUpRight, CircleDollarSign, WalletCards } from "lucide-react";
import { getBillingOverview } from "@/lib/billing/queries";
import { listActiveCreditProducts } from "@/lib/billing/catalog";
import { startCreditCheckout } from "@/lib/billing/actions";

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export default async function BillingPage() {
  const [{ wallet, lots, ledger, payments, available: billingAvailable }, products] = await Promise.all([
    getBillingOverview(),
    listActiveCreditProducts(),
  ]);
  const available = wallet?.available_credits ?? 0;
  const reserved = wallet?.reserved_credits ?? 0;

  return (
    <main className="app-content billing-page">
      <section className="workspace-heading">
        <div className="workspace-heading__copy">
          <span className="app-eyebrow"><WalletCards size={15} />Metered usage</span>
          <h1>Credits</h1>
          <p>Your real balance, reservations, grants, and charges.</p>
        </div>
      </section>

      {!billingAvailable && <div className="billing-notice">Credits are not activated in this environment yet. No balance or transaction has been simulated.</div>}

      <section className="billing-balances" aria-label="Credit balances">
        <article><span>Available</span><strong>{available.toLocaleString()}</strong><small>credits ready to use</small></article>
        <article><span>Reserved</span><strong>{reserved.toLocaleString()}</strong><small>held for active work</small></article>
        <article><span>Status</span><strong className="billing-status">{wallet?.status ?? "Not funded"}</strong><small>{wallet?.unrecovered_credits ? `${wallet.unrecovered_credits} under review` : "No unrecovered balance"}</small></article>
      </section>

      <section className="billing-grid">
        <article className="billing-panel">
          <header><div><h2>Transaction history</h2><p>Append-only wallet activity.</p></div></header>
          {ledger.length ? <ol className="billing-history">{ledger.map((entry) => {
            const delta = entry.available_delta + entry.reserved_delta;
            return <li key={entry.id}>
              <span className={delta >= 0 ? "is-positive" : "is-negative"}>{delta >= 0 ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}</span>
              <div><b>{entry.entry_type}</b><small>{new Date(entry.created_at).toLocaleString("en-MY")}</small></div>
              <strong>{signed(delta)}</strong>
            </li>;
          })}</ol> : <div className="billing-empty">No credit transactions yet.</div>}
        </article>

        <aside className="billing-panel billing-funding">
          <header><div><h2>Funding</h2><p>Payments are credited only after verified Stripe webhooks.</p></div></header>
          <div className="billing-funding__body"><CircleDollarSign size={24} />
            {products.length ? products.map((product) => <form action={startCreditCheckout} className="billing-product" key={product.id}>
              <input type="hidden" name="productKey" value={product.product_key} />
              <span><b>{product.credit_grant.toLocaleString()} credits</b><small>RM {(product.amount_sen / 100).toFixed(2)} · {product.kind}</small></span>
              <button className="button button--primary" type="submit">Choose</button>
            </form>) : <><b>Top-ups are not configured yet</b><p>No live or test product is shown until an effective Stripe product exists in the billing catalog.</p></>}
          </div>
          <dl><div><dt>Credit lots</dt><dd>{lots.length}</dd></div><div><dt>Payment events</dt><dd>{payments.length}</dd></div></dl>
        </aside>
      </section>
    </main>
  );
}
