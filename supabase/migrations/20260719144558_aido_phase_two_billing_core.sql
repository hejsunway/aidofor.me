-- =============================================================================
-- Migration: aido_phase_two_billing_core
-- Date: 2026-07-19
--
-- Purpose
--   Establish the loss-resistant Phase 2 financial and provider-control data
--   model. This migration intentionally seeds no products, prices, routes,
--   credits, or balances. Trusted server configuration must create effective
--   versions before a paid job can be quoted or reserved.
--
-- Accounting units
--   - customer credits: integer bigint
--   - MYR: integer sen
--   - provider USD: integer micro-dollars
--   Floating-point money is not used anywhere in this schema.
--
-- Data API boundary
--   - authenticated users can SELECT only their own wallet/history rows;
--   - users cannot mutate wallets, lots, ledgers, payments, or usage;
--   - pricing, routing, controls, provider budgets, and customer mappings are
--     service-role only;
--   - anon receives no access;
--   - all public tables have RLS enabled independently of GRANT privileges.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Domain enums
-- ----------------------------------------------------------------------------
CREATE TYPE public.aido_wallet_status AS ENUM (
  'active',
  'frozen',
  'closed'
);

CREATE TYPE public.aido_credit_product_kind AS ENUM (
  'topup',
  'subscription',
  'semester',
  'promotion'
);

CREATE TYPE public.aido_credit_lot_source AS ENUM (
  'topup',
  'subscription',
  'semester',
  'promotion',
  'refund',
  'admin'
);

CREATE TYPE public.aido_credit_lot_status AS ENUM (
  'active',
  'depleted',
  'expired',
  'reversed'
);

CREATE TYPE public.aido_ledger_entry_type AS ENUM (
  'grant',
  'reserve',
  'capture',
  'release',
  'expiry',
  'refund',
  'reversal',
  'adjustment'
);

CREATE TYPE public.aido_usage_reservation_status AS ENUM (
  'reserved',
  'running',
  'settled',
  'released',
  'failed',
  'expired'
);

CREATE TYPE public.aido_usage_outcome AS ENUM (
  'succeeded',
  'failed',
  'cancelled'
);

CREATE TYPE public.aido_payment_event_status AS ENUM (
  'received',
  'processed',
  'ignored',
  'failed'
);

CREATE TYPE public.aido_payment_event_kind AS ENUM (
  'purchase',
  'renewal',
  'refund',
  'dispute',
  'other'
);

CREATE TYPE public.aido_credit_reversal_type AS ENUM (
  'refund',
  'chargeback',
  'admin_reversal'
);

CREATE TYPE public.aido_control_scope AS ENUM (
  'global',
  'feature',
  'provider',
  'model'
);

-- ----------------------------------------------------------------------------
-- Immutable pricing and product configuration
-- ----------------------------------------------------------------------------
CREATE TABLE public.aido_billing_config_versions (
  id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version                             integer NOT NULL,
  currency                            text NOT NULL DEFAULT 'MYR',
  credits_per_retail_myr              bigint NOT NULL,
  net_revenue_sen_per_1000_credits    bigint NOT NULL,
  provider_cost_target_bps            integer NOT NULL,
  quote_safety_multiplier_bps         integer NOT NULL,
  payment_risk_reserve_bps            integer NOT NULL,
  budget_myr_sen_per_usd              bigint NOT NULL,
  minimum_topup_sen                   bigint NOT NULL,
  effective_from                      timestamptz NOT NULL,
  effective_to                        timestamptz,
  created_at                          timestamptz NOT NULL DEFAULT now(),
  created_by                          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT aido_billing_config_version_unique UNIQUE (version),
  CONSTRAINT aido_billing_config_currency CHECK (currency = 'MYR'),
  CONSTRAINT aido_billing_config_positive_values CHECK (
    credits_per_retail_myr > 0
    AND net_revenue_sen_per_1000_credits > 0
    AND budget_myr_sen_per_usd > 0
    AND minimum_topup_sen > 0
  ),
  CONSTRAINT aido_billing_config_bps CHECK (
    provider_cost_target_bps BETWEEN 1 AND 10000
    AND quote_safety_multiplier_bps >= 10000
    AND payment_risk_reserve_bps BETWEEN 0 AND 10000
  ),
  CONSTRAINT aido_billing_config_effective_range CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

CREATE INDEX idx_aido_billing_config_effective
  ON public.aido_billing_config_versions (effective_from DESC, effective_to);
CREATE INDEX idx_aido_billing_config_created_by
  ON public.aido_billing_config_versions (created_by)
  WHERE created_by IS NOT NULL;

CREATE TABLE public.aido_provider_prices (
  id                                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                                text NOT NULL,
  model                                   text NOT NULL,
  version                                 integer NOT NULL,
  currency                                text NOT NULL DEFAULT 'USD',
  input_microusd_per_million_tokens       bigint NOT NULL DEFAULT 0,
  cached_input_microusd_per_million_tokens bigint NOT NULL DEFAULT 0,
  output_microusd_per_million_tokens      bigint NOT NULL DEFAULT 0,
  tool_call_microusd                      bigint NOT NULL DEFAULT 0,
  search_call_microusd                    bigint NOT NULL DEFAULT 0,
  effective_from                          timestamptz NOT NULL,
  effective_to                            timestamptz,
  source_reference                        text NOT NULL,
  created_at                              timestamptz NOT NULL DEFAULT now(),
  created_by                              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT aido_provider_prices_version_unique UNIQUE (provider, model, version),
  CONSTRAINT aido_provider_prices_names CHECK (
    char_length(btrim(provider)) BETWEEN 1 AND 80
    AND char_length(btrim(model)) BETWEEN 1 AND 160
  ),
  CONSTRAINT aido_provider_prices_currency CHECK (currency = 'USD'),
  CONSTRAINT aido_provider_prices_nonnegative CHECK (
    input_microusd_per_million_tokens >= 0
    AND cached_input_microusd_per_million_tokens >= 0
    AND output_microusd_per_million_tokens >= 0
    AND tool_call_microusd >= 0
    AND search_call_microusd >= 0
  ),
  CONSTRAINT aido_provider_prices_has_cost CHECK (
    input_microusd_per_million_tokens
    + cached_input_microusd_per_million_tokens
    + output_microusd_per_million_tokens
    + tool_call_microusd
    + search_call_microusd > 0
  ),
  CONSTRAINT aido_provider_prices_effective_range CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),
  CONSTRAINT aido_provider_prices_source_length CHECK (
    char_length(btrim(source_reference)) BETWEEN 1 AND 1000
  )
);

CREATE INDEX idx_aido_provider_prices_effective
  ON public.aido_provider_prices (provider, model, effective_from DESC, effective_to);
CREATE INDEX idx_aido_provider_prices_created_by
  ON public.aido_provider_prices (created_by)
  WHERE created_by IS NOT NULL;

CREATE TABLE public.aido_feature_rate_cards (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key                     text NOT NULL,
  version                         integer NOT NULL,
  billing_config_id               uuid NOT NULL REFERENCES public.aido_billing_config_versions(id) ON DELETE RESTRICT,
  base_credits                    bigint NOT NULL DEFAULT 0,
  credits_per_1000_input_tokens   bigint NOT NULL DEFAULT 0,
  credits_per_1000_output_tokens  bigint NOT NULL DEFAULT 0,
  credits_per_page                bigint NOT NULL DEFAULT 0,
  credits_per_source              bigint NOT NULL DEFAULT 0,
  credits_per_search              bigint NOT NULL DEFAULT 0,
  minimum_credits                 bigint NOT NULL,
  maximum_credits                 bigint NOT NULL,
  max_provider_cost_microusd      bigint NOT NULL,
  max_input_tokens                integer NOT NULL,
  max_output_tokens               integer NOT NULL,
  max_tool_calls                  integer NOT NULL DEFAULT 0,
  max_search_calls                integer NOT NULL DEFAULT 0,
  max_pages                       integer NOT NULL DEFAULT 0,
  max_sources                     integer NOT NULL DEFAULT 0,
  max_retries                     integer NOT NULL DEFAULT 0,
  timeout_ms                      integer NOT NULL,
  daily_user_credit_cap           bigint NOT NULL,
  concurrent_job_cap              integer NOT NULL,
  effective_from                  timestamptz NOT NULL,
  effective_to                    timestamptz,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  created_by                      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT aido_feature_rate_cards_version_unique UNIQUE (feature_key, version),
  CONSTRAINT aido_feature_rate_cards_feature_key CHECK (
    feature_key ~ '^[a-z][a-z0-9_.-]{2,79}$'
  ),
  CONSTRAINT aido_feature_rate_cards_credit_values CHECK (
    base_credits >= 0
    AND credits_per_1000_input_tokens >= 0
    AND credits_per_1000_output_tokens >= 0
    AND credits_per_page >= 0
    AND credits_per_source >= 0
    AND credits_per_search >= 0
    AND minimum_credits > 0
    AND maximum_credits >= minimum_credits
    AND daily_user_credit_cap >= maximum_credits
  ),
  CONSTRAINT aido_feature_rate_cards_limits CHECK (
    max_provider_cost_microusd > 0
    AND max_input_tokens > 0
    AND max_output_tokens > 0
    AND max_tool_calls >= 0
    AND max_search_calls >= 0
    AND max_pages >= 0
    AND max_sources >= 0
    AND max_retries BETWEEN 0 AND 10
    AND timeout_ms BETWEEN 1000 AND 3600000
    AND concurrent_job_cap BETWEEN 1 AND 100
  ),
  CONSTRAINT aido_feature_rate_cards_effective_range CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

CREATE INDEX idx_aido_feature_rate_cards_billing_config
  ON public.aido_feature_rate_cards (billing_config_id);
CREATE INDEX idx_aido_feature_rate_cards_effective
  ON public.aido_feature_rate_cards (feature_key, effective_from DESC, effective_to);
CREATE INDEX idx_aido_feature_rate_cards_created_by
  ON public.aido_feature_rate_cards (created_by)
  WHERE created_by IS NOT NULL;

CREATE TABLE public.aido_provider_routes (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_rate_card_id        uuid NOT NULL REFERENCES public.aido_feature_rate_cards(id) ON DELETE RESTRICT,
  provider_price_id           uuid NOT NULL REFERENCES public.aido_provider_prices(id) ON DELETE RESTRICT,
  priority                    smallint NOT NULL,
  evaluation_reference        text NOT NULL,
  privacy_policy_version      text NOT NULL,
  approved                    boolean NOT NULL DEFAULT false,
  effective_from              timestamptz NOT NULL,
  effective_to                timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT aido_provider_routes_rate_price_unique UNIQUE (feature_rate_card_id, provider_price_id),
  CONSTRAINT aido_provider_routes_priority CHECK (priority BETWEEN 1 AND 1000),
  CONSTRAINT aido_provider_routes_references CHECK (
    char_length(btrim(evaluation_reference)) BETWEEN 1 AND 1000
    AND char_length(btrim(privacy_policy_version)) BETWEEN 1 AND 160
  ),
  CONSTRAINT aido_provider_routes_effective_range CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

CREATE INDEX idx_aido_provider_routes_rate_priority
  ON public.aido_provider_routes (feature_rate_card_id, approved, priority);
CREATE INDEX idx_aido_provider_routes_provider_price
  ON public.aido_provider_routes (provider_price_id);
CREATE INDEX idx_aido_provider_routes_created_by
  ON public.aido_provider_routes (created_by)
  WHERE created_by IS NOT NULL;

CREATE TABLE public.aido_credit_products (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_key           text NOT NULL,
  version               integer NOT NULL,
  kind                  public.aido_credit_product_kind NOT NULL,
  stripe_product_id     text NOT NULL,
  stripe_price_id       text NOT NULL,
  currency              text NOT NULL DEFAULT 'MYR',
  amount_sen            bigint NOT NULL,
  credit_grant          bigint NOT NULL,
  expires_after_days    integer,
  effective_from        timestamptz NOT NULL,
  effective_to          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT aido_credit_products_version_unique UNIQUE (product_key, version),
  CONSTRAINT aido_credit_products_stripe_price_unique UNIQUE (stripe_price_id),
  CONSTRAINT aido_credit_products_key CHECK (
    product_key ~ '^[a-z][a-z0-9_.-]{2,79}$'
  ),
  CONSTRAINT aido_credit_products_stripe_ids CHECK (
    stripe_product_id ~ '^prod_[A-Za-z0-9]+$'
    AND stripe_price_id ~ '^price_[A-Za-z0-9]+$'
  ),
  CONSTRAINT aido_credit_products_values CHECK (
    currency = 'MYR'
    AND amount_sen > 0
    AND credit_grant > 0
    AND (expires_after_days IS NULL OR expires_after_days BETWEEN 1 AND 3650)
  ),
  CONSTRAINT aido_credit_products_effective_range CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

CREATE INDEX idx_aido_credit_products_effective
  ON public.aido_credit_products (product_key, effective_from DESC, effective_to);
CREATE INDEX idx_aido_credit_products_created_by
  ON public.aido_credit_products (created_by)
  WHERE created_by IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Mutable operational controls. No rows are seeded: absent control is treated
-- as disabled by trusted reservation/provider functions.
-- ----------------------------------------------------------------------------
CREATE TABLE public.aido_system_controls (
  id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type                          public.aido_control_scope NOT NULL,
  scope_key                           text NOT NULL,
  is_enabled                          boolean NOT NULL DEFAULT false,
  daily_provider_budget_microusd      bigint NOT NULL DEFAULT 0,
  max_concurrent_calls                integer NOT NULL DEFAULT 0,
  updated_at                          timestamptz NOT NULL DEFAULT now(),
  updated_by                          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT aido_system_controls_scope_unique UNIQUE (scope_type, scope_key),
  CONSTRAINT aido_system_controls_scope_key CHECK (
    char_length(btrim(scope_key)) BETWEEN 1 AND 200
  ),
  CONSTRAINT aido_system_controls_limits CHECK (
    daily_provider_budget_microusd >= 0
    AND max_concurrent_calls BETWEEN 0 AND 10000
  )
);

CREATE INDEX idx_aido_system_controls_updated_by
  ON public.aido_system_controls (updated_by)
  WHERE updated_by IS NOT NULL;

CREATE TRIGGER aido_set_system_controls_updated_at
  BEFORE UPDATE ON public.aido_system_controls
  FOR EACH ROW EXECUTE FUNCTION public.aido_set_updated_at();

CREATE TABLE public.aido_provider_budget_usage (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usage_date                  date NOT NULL,
  scope_type                  public.aido_control_scope NOT NULL,
  scope_key                   text NOT NULL,
  reserved_microusd           bigint NOT NULL DEFAULT 0,
  incurred_microusd           bigint NOT NULL DEFAULT 0,
  version                     bigint NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aido_provider_budget_usage_scope_unique UNIQUE (usage_date, scope_type, scope_key),
  CONSTRAINT aido_provider_budget_usage_values CHECK (
    reserved_microusd >= 0
    AND incurred_microusd >= 0
    AND version >= 0
  )
);

CREATE INDEX idx_aido_provider_budget_usage_scope_date
  ON public.aido_provider_budget_usage (scope_type, scope_key, usage_date DESC);

CREATE TRIGGER aido_set_provider_budget_usage_updated_at
  BEFORE UPDATE ON public.aido_provider_budget_usage
  FOR EACH ROW EXECUTE FUNCTION public.aido_set_updated_at();

-- ----------------------------------------------------------------------------
-- Stripe identity and verified event journal. Raw webhook payloads are not
-- stored; only the signature-verified event identifiers and a SHA-256 digest.
-- ----------------------------------------------------------------------------
CREATE TABLE public.aido_payment_customers (
  user_id                 uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id      text NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aido_payment_customers_stripe_unique UNIQUE (stripe_customer_id),
  CONSTRAINT aido_payment_customers_stripe_format CHECK (
    stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
  )
);

CREATE TRIGGER aido_set_payment_customers_updated_at
  BEFORE UPDATE ON public.aido_payment_customers
  FOR EACH ROW EXECUTE FUNCTION public.aido_set_updated_at();

CREATE TABLE public.aido_payment_events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id         text NOT NULL,
  stripe_event_type       text NOT NULL,
  event_kind              public.aido_payment_event_kind NOT NULL,
  livemode                boolean NOT NULL,
  stripe_object_id        text NOT NULL,
  related_payment_event_id uuid REFERENCES public.aido_payment_events(id) ON DELETE RESTRICT,
  user_id                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  credit_product_id       uuid REFERENCES public.aido_credit_products(id) ON DELETE RESTRICT,
  currency                text,
  amount_gross_sen        bigint,
  amount_net_sen          bigint,
  credits_affected        bigint,
  payload_sha256          text NOT NULL,
  status                  public.aido_payment_event_status NOT NULL DEFAULT 'received',
  failure_code            text,
  failure_message         text,
  received_at             timestamptz NOT NULL DEFAULT now(),
  processed_at            timestamptz,
  CONSTRAINT aido_payment_events_stripe_event_unique UNIQUE (stripe_event_id),
  CONSTRAINT aido_payment_events_stripe_event_format CHECK (
    stripe_event_id ~ '^evt_[A-Za-z0-9]+$'
  ),
  CONSTRAINT aido_payment_events_type_length CHECK (
    char_length(btrim(stripe_event_type)) BETWEEN 1 AND 160
    AND char_length(btrim(stripe_object_id)) BETWEEN 1 AND 255
  ),
  CONSTRAINT aido_payment_events_payload_hash CHECK (
    payload_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT aido_payment_events_amounts CHECK (
    (currency IS NULL OR currency = 'MYR')
    AND (amount_gross_sen IS NULL OR amount_gross_sen >= 0)
    AND (amount_net_sen IS NULL OR amount_net_sen >= 0)
    AND (credits_affected IS NULL OR credits_affected >= 0)
  ),
  CONSTRAINT aido_payment_events_status_consistency CHECK (
    (status = 'received' AND processed_at IS NULL AND failure_code IS NULL AND failure_message IS NULL)
    OR (status IN ('processed', 'ignored') AND processed_at IS NOT NULL AND failure_code IS NULL AND failure_message IS NULL)
    OR (status = 'failed' AND processed_at IS NOT NULL AND failure_code IS NOT NULL)
  )
);

CREATE INDEX idx_aido_payment_events_user_received
  ON public.aido_payment_events (user_id, received_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX idx_aido_payment_events_product
  ON public.aido_payment_events (credit_product_id)
  WHERE credit_product_id IS NOT NULL;
CREATE INDEX idx_aido_payment_events_object
  ON public.aido_payment_events (stripe_object_id, received_at DESC);
CREATE INDEX idx_aido_payment_events_related
  ON public.aido_payment_events (related_payment_event_id)
  WHERE related_payment_event_id IS NOT NULL;
CREATE INDEX idx_aido_payment_events_pending
  ON public.aido_payment_events (received_at)
  WHERE status = 'received';

-- ----------------------------------------------------------------------------
-- Wallet projection and credit lots
-- ----------------------------------------------------------------------------
CREATE TABLE public.aido_credit_wallets (
  user_id                       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  available_credits             bigint NOT NULL DEFAULT 0,
  reserved_credits              bigint NOT NULL DEFAULT 0,
  unrecovered_credits           bigint NOT NULL DEFAULT 0,
  status                        public.aido_wallet_status NOT NULL DEFAULT 'active',
  version                       bigint NOT NULL DEFAULT 0,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aido_credit_wallets_nonnegative CHECK (
    available_credits >= 0
    AND reserved_credits >= 0
    AND unrecovered_credits >= 0
    AND version >= 0
  )
);

CREATE INDEX idx_aido_credit_wallets_status
  ON public.aido_credit_wallets (status)
  WHERE status <> 'closed';

CREATE TRIGGER aido_set_credit_wallets_updated_at
  BEFORE UPDATE ON public.aido_credit_wallets
  FOR EACH ROW EXECUTE FUNCTION public.aido_set_updated_at();

CREATE TABLE public.aido_credit_lots (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source                  public.aido_credit_lot_source NOT NULL,
  credit_product_id       uuid REFERENCES public.aido_credit_products(id) ON DELETE RESTRICT,
  payment_event_id        uuid REFERENCES public.aido_payment_events(id) ON DELETE RESTRICT,
  granted_credits         bigint NOT NULL,
  remaining_credits       bigint NOT NULL,
  reserved_credits        bigint NOT NULL DEFAULT 0,
  status                  public.aido_credit_lot_status NOT NULL DEFAULT 'active',
  expires_at              timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aido_credit_lots_payment_event_unique UNIQUE (payment_event_id),
  CONSTRAINT aido_credit_lots_balances CHECK (
    granted_credits > 0
    AND remaining_credits BETWEEN 0 AND granted_credits
    AND reserved_credits BETWEEN 0 AND remaining_credits
  ),
  CONSTRAINT aido_credit_lots_status_consistency CHECK (
    (status = 'active' AND remaining_credits > 0)
    OR (status IN ('depleted', 'expired', 'reversed') AND remaining_credits = 0 AND reserved_credits = 0)
  )
);

CREATE INDEX idx_aido_credit_lots_user_spend_order
  ON public.aido_credit_lots (
    user_id,
    expires_at ASC NULLS LAST,
    created_at ASC,
    id
  )
  WHERE status = 'active' AND remaining_credits > reserved_credits;
CREATE INDEX idx_aido_credit_lots_product
  ON public.aido_credit_lots (credit_product_id)
  WHERE credit_product_id IS NOT NULL;
CREATE INDEX idx_aido_credit_lots_expiry
  ON public.aido_credit_lots (expires_at)
  WHERE status = 'active' AND expires_at IS NOT NULL;

CREATE TRIGGER aido_set_credit_lots_updated_at
  BEFORE UPDATE ON public.aido_credit_lots
  FOR EACH ROW EXECUTE FUNCTION public.aido_set_updated_at();

-- ----------------------------------------------------------------------------
-- Usage reservation and provider usage journal
-- ----------------------------------------------------------------------------
CREATE TABLE public.aido_usage_reservations (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                         uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  project_id                      uuid REFERENCES public.aido_writing_projects(id) ON DELETE SET NULL,
  feature_key                     text NOT NULL,
  feature_rate_card_id            uuid NOT NULL REFERENCES public.aido_feature_rate_cards(id) ON DELETE RESTRICT,
  provider_route_id               uuid NOT NULL REFERENCES public.aido_provider_routes(id) ON DELETE RESTRICT,
  job_key                         text NOT NULL,
  idempotency_key                 text NOT NULL,
  quoted_credits                  bigint NOT NULL,
  maximum_credits                 bigint NOT NULL,
  captured_credits                bigint NOT NULL DEFAULT 0,
  released_credits                bigint NOT NULL DEFAULT 0,
  provider_budget_microusd        bigint NOT NULL,
  actual_provider_cost_microusd   bigint NOT NULL DEFAULT 0,
  status                          public.aido_usage_reservation_status NOT NULL DEFAULT 'reserved',
  expires_at                      timestamptz NOT NULL,
  started_at                      timestamptz,
  settled_at                      timestamptz,
  released_at                     timestamptz,
  failure_category                text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aido_usage_reservations_job_unique UNIQUE (job_key),
  CONSTRAINT aido_usage_reservations_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT aido_usage_reservations_keys CHECK (
    char_length(btrim(job_key)) BETWEEN 8 AND 200
    AND char_length(btrim(idempotency_key)) BETWEEN 8 AND 200
    AND feature_key ~ '^[a-z][a-z0-9_.-]{2,79}$'
  ),
  CONSTRAINT aido_usage_reservations_credit_values CHECK (
    quoted_credits > 0
    AND maximum_credits >= quoted_credits
    AND captured_credits >= 0
    AND released_credits >= 0
    AND captured_credits + released_credits <= maximum_credits
  ),
  CONSTRAINT aido_usage_reservations_cost_values CHECK (
    provider_budget_microusd > 0
    AND actual_provider_cost_microusd >= 0
    AND (status <> 'settled' OR actual_provider_cost_microusd <= provider_budget_microusd)
  ),
  CONSTRAINT aido_usage_reservations_expiry CHECK (expires_at > created_at),
  CONSTRAINT aido_usage_reservations_status_consistency CHECK (
    (status = 'reserved' AND started_at IS NULL AND settled_at IS NULL AND released_at IS NULL)
    OR (status = 'running' AND started_at IS NOT NULL AND settled_at IS NULL AND released_at IS NULL)
    OR (
      status = 'settled'
      AND settled_at IS NOT NULL
      AND released_at IS NOT NULL
      AND captured_credits + released_credits = maximum_credits
      AND failure_category IS NULL
    )
    OR (
      status IN ('released', 'failed', 'expired')
      AND released_at IS NOT NULL
      AND settled_at IS NULL
      AND captured_credits = 0
      AND released_credits = maximum_credits
    )
  )
);

CREATE INDEX idx_aido_usage_reservations_user_created
  ON public.aido_usage_reservations (user_id, created_at DESC);
CREATE INDEX idx_aido_usage_reservations_project
  ON public.aido_usage_reservations (project_id, created_at DESC)
  WHERE project_id IS NOT NULL;
CREATE INDEX idx_aido_usage_reservations_rate_card
  ON public.aido_usage_reservations (feature_rate_card_id);
CREATE INDEX idx_aido_usage_reservations_route
  ON public.aido_usage_reservations (provider_route_id);
CREATE INDEX idx_aido_usage_reservations_active_user
  ON public.aido_usage_reservations (user_id, feature_key, created_at DESC)
  WHERE status IN ('reserved', 'running');
CREATE INDEX idx_aido_usage_reservations_expirable
  ON public.aido_usage_reservations (expires_at)
  WHERE status IN ('reserved', 'running');

CREATE TRIGGER aido_set_usage_reservations_updated_at
  BEFORE UPDATE ON public.aido_usage_reservations
  FOR EACH ROW EXECUTE FUNCTION public.aido_set_updated_at();

CREATE TABLE public.aido_usage_events (
  id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id              uuid NOT NULL REFERENCES public.aido_usage_reservations(id) ON DELETE RESTRICT,
  user_id                     uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  provider_route_id           uuid NOT NULL REFERENCES public.aido_provider_routes(id) ON DELETE RESTRICT,
  provider                    text NOT NULL,
  model                       text NOT NULL,
  provider_request_id         text,
  idempotency_key             text NOT NULL,
  attempt                     smallint NOT NULL DEFAULT 1,
  prompt_version              text NOT NULL,
  input_tokens                bigint NOT NULL DEFAULT 0,
  cached_input_tokens         bigint NOT NULL DEFAULT 0,
  output_tokens               bigint NOT NULL DEFAULT 0,
  tool_calls                  integer NOT NULL DEFAULT 0,
  search_calls                integer NOT NULL DEFAULT 0,
  processed_pages             integer NOT NULL DEFAULT 0,
  latency_ms                  integer NOT NULL,
  provider_cost_microusd      bigint NOT NULL DEFAULT 0,
  outcome                     public.aido_usage_outcome NOT NULL,
  billable_to_student         boolean NOT NULL DEFAULT false,
  failure_category            text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aido_usage_events_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT aido_usage_events_keys CHECK (
    char_length(btrim(idempotency_key)) BETWEEN 8 AND 200
    AND char_length(btrim(prompt_version)) BETWEEN 1 AND 160
    AND char_length(btrim(provider)) BETWEEN 1 AND 80
    AND char_length(btrim(model)) BETWEEN 1 AND 160
  ),
  CONSTRAINT aido_usage_events_usage_values CHECK (
    attempt BETWEEN 1 AND 100
    AND input_tokens >= 0
    AND cached_input_tokens >= 0
    AND cached_input_tokens <= input_tokens
    AND output_tokens >= 0
    AND tool_calls >= 0
    AND search_calls >= 0
    AND processed_pages >= 0
    AND latency_ms >= 0
    AND provider_cost_microusd >= 0
  ),
  CONSTRAINT aido_usage_events_outcome_consistency CHECK (
    (outcome = 'succeeded' AND failure_category IS NULL)
    OR (outcome IN ('failed', 'cancelled') AND billable_to_student = false)
  )
);

CREATE UNIQUE INDEX idx_aido_usage_events_provider_request_unique
  ON public.aido_usage_events (provider, provider_request_id)
  WHERE provider_request_id IS NOT NULL;
CREATE INDEX idx_aido_usage_events_reservation
  ON public.aido_usage_events (reservation_id, created_at);
CREATE INDEX idx_aido_usage_events_user_created
  ON public.aido_usage_events (user_id, created_at DESC);
CREATE INDEX idx_aido_usage_events_route
  ON public.aido_usage_events (provider_route_id, created_at DESC);
CREATE INDEX idx_aido_usage_events_provider_cost
  ON public.aido_usage_events (created_at, provider, model);

-- ----------------------------------------------------------------------------
-- Canonical append-only ledger. The wallet and lot balances are projections of
-- these deltas plus the reservation-allocation detail below.
-- ----------------------------------------------------------------------------
CREATE TABLE public.aido_credit_ledger (
  id                              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id                         uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  entry_type                      public.aido_ledger_entry_type NOT NULL,
  credit_lot_id                   uuid REFERENCES public.aido_credit_lots(id) ON DELETE RESTRICT,
  reservation_id                  uuid REFERENCES public.aido_usage_reservations(id) ON DELETE RESTRICT,
  payment_event_id                uuid REFERENCES public.aido_payment_events(id) ON DELETE RESTRICT,
  related_ledger_id               bigint REFERENCES public.aido_credit_ledger(id) ON DELETE RESTRICT,
  available_delta                 bigint NOT NULL DEFAULT 0,
  reserved_delta                  bigint NOT NULL DEFAULT 0,
  unrecovered_delta               bigint NOT NULL DEFAULT 0,
  available_balance_after         bigint NOT NULL,
  reserved_balance_after          bigint NOT NULL,
  unrecovered_balance_after       bigint NOT NULL,
  idempotency_key                 text NOT NULL,
  metadata                        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aido_credit_ledger_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT aido_credit_ledger_has_delta CHECK (
    available_delta <> 0 OR reserved_delta <> 0 OR unrecovered_delta <> 0
  ),
  CONSTRAINT aido_credit_ledger_balances_nonnegative CHECK (
    available_balance_after >= 0
    AND reserved_balance_after >= 0
    AND unrecovered_balance_after >= 0
  ),
  CONSTRAINT aido_credit_ledger_idempotency_length CHECK (
    char_length(btrim(idempotency_key)) BETWEEN 8 AND 200
  ),
  CONSTRAINT aido_credit_ledger_metadata_object CHECK (
    jsonb_typeof(metadata) = 'object'
  )
);

CREATE INDEX idx_aido_credit_ledger_user_created
  ON public.aido_credit_ledger (user_id, created_at DESC, id DESC);
CREATE INDEX idx_aido_credit_ledger_lot
  ON public.aido_credit_ledger (credit_lot_id, id)
  WHERE credit_lot_id IS NOT NULL;
CREATE INDEX idx_aido_credit_ledger_reservation
  ON public.aido_credit_ledger (reservation_id, id)
  WHERE reservation_id IS NOT NULL;
CREATE INDEX idx_aido_credit_ledger_payment
  ON public.aido_credit_ledger (payment_event_id, id)
  WHERE payment_event_id IS NOT NULL;
CREATE INDEX idx_aido_credit_ledger_related
  ON public.aido_credit_ledger (related_ledger_id)
  WHERE related_ledger_id IS NOT NULL;

CREATE TABLE public.aido_credit_reservation_allocations (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id              uuid NOT NULL REFERENCES public.aido_usage_reservations(id) ON DELETE RESTRICT,
  credit_lot_id               uuid NOT NULL REFERENCES public.aido_credit_lots(id) ON DELETE RESTRICT,
  user_id                     uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  allocated_credits           bigint NOT NULL,
  captured_credits            bigint NOT NULL DEFAULT 0,
  released_credits            bigint NOT NULL DEFAULT 0,
  capture_ledger_entry_id     bigint REFERENCES public.aido_credit_ledger(id) ON DELETE RESTRICT,
  release_ledger_entry_id     bigint REFERENCES public.aido_credit_ledger(id) ON DELETE RESTRICT,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aido_credit_reservation_allocations_unique UNIQUE (reservation_id, credit_lot_id),
  CONSTRAINT aido_credit_reservation_allocations_values CHECK (
    allocated_credits > 0
    AND captured_credits >= 0
    AND released_credits >= 0
    AND captured_credits + released_credits <= allocated_credits
  )
);

CREATE INDEX idx_aido_credit_reservation_allocations_lot
  ON public.aido_credit_reservation_allocations (credit_lot_id, reservation_id);
CREATE INDEX idx_aido_credit_reservation_allocations_user
  ON public.aido_credit_reservation_allocations (user_id, created_at DESC);
CREATE INDEX idx_aido_credit_reservation_allocations_capture_ledger
  ON public.aido_credit_reservation_allocations (capture_ledger_entry_id)
  WHERE capture_ledger_entry_id IS NOT NULL;
CREATE INDEX idx_aido_credit_reservation_allocations_release_ledger
  ON public.aido_credit_reservation_allocations (release_ledger_entry_id)
  WHERE release_ledger_entry_id IS NOT NULL;

CREATE TRIGGER aido_set_credit_reservation_allocations_updated_at
  BEFORE UPDATE ON public.aido_credit_reservation_allocations
  FOR EACH ROW EXECUTE FUNCTION public.aido_set_updated_at();

CREATE TABLE public.aido_credit_reversals (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  credit_lot_id               uuid NOT NULL REFERENCES public.aido_credit_lots(id) ON DELETE RESTRICT,
  payment_event_id            uuid REFERENCES public.aido_payment_events(id) ON DELETE RESTRICT,
  ledger_entry_id             bigint NOT NULL REFERENCES public.aido_credit_ledger(id) ON DELETE RESTRICT,
  reversal_type               public.aido_credit_reversal_type NOT NULL,
  requested_credits           bigint NOT NULL,
  recovered_credits           bigint NOT NULL,
  unrecovered_credits         bigint NOT NULL,
  idempotency_key             text NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aido_credit_reversals_ledger_unique UNIQUE (ledger_entry_id),
  CONSTRAINT aido_credit_reversals_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT aido_credit_reversals_values CHECK (
    requested_credits > 0
    AND recovered_credits >= 0
    AND unrecovered_credits >= 0
    AND recovered_credits + unrecovered_credits = requested_credits
  ),
  CONSTRAINT aido_credit_reversals_idempotency_length CHECK (
    char_length(btrim(idempotency_key)) BETWEEN 8 AND 200
  )
);

CREATE INDEX idx_aido_credit_reversals_user_created
  ON public.aido_credit_reversals (user_id, created_at DESC);
CREATE INDEX idx_aido_credit_reversals_lot
  ON public.aido_credit_reversals (credit_lot_id, created_at DESC);
CREATE INDEX idx_aido_credit_reversals_payment
  ON public.aido_credit_reversals (payment_event_id)
  WHERE payment_event_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Immutability guards for historical versions and append-only journals.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aido_reject_historical_mutation()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; insert a new version or compensating entry',
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER aido_immutable_billing_config_versions
  BEFORE UPDATE OR DELETE ON public.aido_billing_config_versions
  FOR EACH ROW EXECUTE FUNCTION public.aido_reject_historical_mutation();
CREATE TRIGGER aido_immutable_provider_prices
  BEFORE UPDATE OR DELETE ON public.aido_provider_prices
  FOR EACH ROW EXECUTE FUNCTION public.aido_reject_historical_mutation();
CREATE TRIGGER aido_immutable_feature_rate_cards
  BEFORE UPDATE OR DELETE ON public.aido_feature_rate_cards
  FOR EACH ROW EXECUTE FUNCTION public.aido_reject_historical_mutation();
CREATE TRIGGER aido_immutable_provider_routes
  BEFORE UPDATE OR DELETE ON public.aido_provider_routes
  FOR EACH ROW EXECUTE FUNCTION public.aido_reject_historical_mutation();
CREATE TRIGGER aido_immutable_credit_products
  BEFORE UPDATE OR DELETE ON public.aido_credit_products
  FOR EACH ROW EXECUTE FUNCTION public.aido_reject_historical_mutation();
CREATE TRIGGER aido_immutable_usage_events
  BEFORE UPDATE OR DELETE ON public.aido_usage_events
  FOR EACH ROW EXECUTE FUNCTION public.aido_reject_historical_mutation();
CREATE TRIGGER aido_immutable_credit_ledger
  BEFORE UPDATE OR DELETE ON public.aido_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.aido_reject_historical_mutation();
CREATE TRIGGER aido_immutable_credit_reversals
  BEFORE UPDATE OR DELETE ON public.aido_credit_reversals
  FOR EACH ROW EXECUTE FUNCTION public.aido_reject_historical_mutation();

REVOKE ALL ON FUNCTION public.aido_reject_historical_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
ALTER TABLE public.aido_billing_config_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aido_provider_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aido_feature_rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aido_provider_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aido_credit_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aido_system_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aido_provider_budget_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aido_payment_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aido_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aido_credit_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aido_credit_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aido_usage_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aido_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aido_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aido_credit_reservation_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aido_credit_reversals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Aido users read own payment events"
  ON public.aido_payment_events FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Aido users read own wallet"
  ON public.aido_credit_wallets FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Aido users read own credit lots"
  ON public.aido_credit_lots FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Aido users read own usage reservations"
  ON public.aido_usage_reservations FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Aido users read own usage events"
  ON public.aido_usage_events FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Aido users read own credit ledger"
  ON public.aido_credit_ledger FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Aido users read own credit allocations"
  ON public.aido_credit_reservation_allocations FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Aido users read own credit reversals"
  ON public.aido_credit_reversals FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- Explicit Data API grants. RLS and GRANT are intentionally separate layers.
-- ----------------------------------------------------------------------------
REVOKE ALL ON TABLE
  public.aido_billing_config_versions,
  public.aido_provider_prices,
  public.aido_feature_rate_cards,
  public.aido_provider_routes,
  public.aido_credit_products,
  public.aido_system_controls,
  public.aido_provider_budget_usage,
  public.aido_payment_customers,
  public.aido_payment_events,
  public.aido_credit_wallets,
  public.aido_credit_lots,
  public.aido_usage_reservations,
  public.aido_usage_events,
  public.aido_credit_ledger,
  public.aido_credit_reservation_allocations,
  public.aido_credit_reversals
FROM anon, authenticated;

GRANT SELECT ON TABLE
  public.aido_payment_events,
  public.aido_credit_wallets,
  public.aido_credit_lots,
  public.aido_usage_reservations,
  public.aido_usage_events,
  public.aido_credit_ledger,
  public.aido_credit_reservation_allocations,
  public.aido_credit_reversals
TO authenticated;

GRANT ALL ON TABLE
  public.aido_billing_config_versions,
  public.aido_provider_prices,
  public.aido_feature_rate_cards,
  public.aido_provider_routes,
  public.aido_credit_products,
  public.aido_system_controls,
  public.aido_provider_budget_usage,
  public.aido_payment_customers,
  public.aido_payment_events,
  public.aido_credit_wallets,
  public.aido_credit_lots,
  public.aido_usage_reservations,
  public.aido_usage_events,
  public.aido_credit_ledger,
  public.aido_credit_reservation_allocations,
  public.aido_credit_reversals
TO service_role;

REVOKE ALL ON SEQUENCE
  public.aido_usage_events_id_seq,
  public.aido_credit_ledger_id_seq
FROM anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE
  public.aido_usage_events_id_seq,
  public.aido_credit_ledger_id_seq
TO service_role;

NOTIFY pgrst, 'reload schema';
