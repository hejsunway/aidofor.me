-- =============================================================================
-- Migration: aido_phase_two_atomic_operations
-- Date: 2026-07-19
--
-- Purpose
--   Add the trusted, concurrency-safe operations for Phase 2. All mutation
--   logic executes as SECURITY INVOKER and is callable only by service_role.
--   Public wrappers exist solely so trusted server code can call the functions
--   through PostgREST; the financial implementation lives in aido_private,
--   which is not an exposed Data API schema.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS aido_private;
REVOKE ALL ON SCHEMA aido_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA aido_private TO service_role;

CREATE TYPE public.aido_provider_call_status AS ENUM (
  'authorized',
  'consumed',
  'released'
);

CREATE TABLE public.aido_provider_call_authorizations (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id                  uuid NOT NULL REFERENCES public.aido_usage_reservations(id) ON DELETE RESTRICT,
  user_id                         uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  idempotency_key                 text NOT NULL,
  attempt                         smallint NOT NULL,
  estimated_cost_microusd         bigint NOT NULL,
  estimated_input_tokens          bigint NOT NULL DEFAULT 0,
  estimated_output_tokens         bigint NOT NULL DEFAULT 0,
  estimated_tool_calls            integer NOT NULL DEFAULT 0,
  estimated_search_calls          integer NOT NULL DEFAULT 0,
  estimated_pages                 integer NOT NULL DEFAULT 0,
  status                          public.aido_provider_call_status NOT NULL DEFAULT 'authorized',
  actual_cost_microusd            bigint,
  usage_event_id                  bigint REFERENCES public.aido_usage_events(id) ON DELETE RESTRICT,
  expires_at                      timestamptz NOT NULL,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  consumed_at                     timestamptz,
  released_at                     timestamptz,
  CONSTRAINT aido_provider_call_authorizations_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT aido_provider_call_authorizations_usage_event_unique UNIQUE (usage_event_id),
  CONSTRAINT aido_provider_call_authorizations_key CHECK (
    char_length(btrim(idempotency_key)) BETWEEN 8 AND 200
  ),
  CONSTRAINT aido_provider_call_authorizations_estimates CHECK (
    attempt BETWEEN 1 AND 100
    AND estimated_cost_microusd > 0
    AND estimated_input_tokens >= 0
    AND estimated_output_tokens >= 0
    AND estimated_tool_calls >= 0
    AND estimated_search_calls >= 0
    AND estimated_pages >= 0
    AND expires_at > created_at
  ),
  CONSTRAINT aido_provider_call_authorizations_status CHECK (
    (status = 'authorized' AND actual_cost_microusd IS NULL AND usage_event_id IS NULL AND consumed_at IS NULL AND released_at IS NULL)
    OR (status = 'consumed' AND actual_cost_microusd IS NOT NULL AND usage_event_id IS NOT NULL AND consumed_at IS NOT NULL AND released_at IS NULL)
    OR (status = 'released' AND actual_cost_microusd IS NULL AND usage_event_id IS NULL AND consumed_at IS NULL AND released_at IS NOT NULL)
  )
);

CREATE INDEX idx_aido_provider_call_authorizations_reservation
  ON public.aido_provider_call_authorizations (reservation_id, created_at);
CREATE INDEX idx_aido_provider_call_authorizations_user
  ON public.aido_provider_call_authorizations (user_id, created_at DESC);
CREATE INDEX idx_aido_provider_call_authorizations_expiry
  ON public.aido_provider_call_authorizations (expires_at)
  WHERE status = 'authorized';

ALTER TABLE public.aido_provider_call_authorizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Aido users read own provider call authorizations"
  ON public.aido_provider_call_authorizations FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

REVOKE ALL ON public.aido_provider_call_authorizations FROM anon, authenticated;
GRANT SELECT ON public.aido_provider_call_authorizations TO authenticated;
GRANT ALL ON public.aido_provider_call_authorizations TO service_role;

-- One capture and at most one release ledger entry can exist for a reservation.
-- The reservation row itself is also locked by every terminal operation.
CREATE UNIQUE INDEX idx_aido_credit_ledger_reservation_capture_unique
  ON public.aido_credit_ledger (reservation_id)
  WHERE entry_type = 'capture';
CREATE UNIQUE INDEX idx_aido_credit_ledger_reservation_release_unique
  ON public.aido_credit_ledger (reservation_id)
  WHERE entry_type = 'release';

-- ----------------------------------------------------------------------------
-- Provider budget helpers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aido_private.reserve_provider_budget(
  p_feature_key text,
  p_provider text,
  p_model text,
  p_amount_microusd bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_control record;
  v_usage public.aido_provider_budget_usage%ROWTYPE;
  v_active_count bigint;
BEGIN
  IF p_amount_microusd <= 0 THEN
    RAISE EXCEPTION 'Provider budget reservation must be positive' USING ERRCODE = '22023';
  END IF;

  FOR v_control IN
    WITH required(scope_type, scope_key) AS (
      VALUES
        ('global'::public.aido_control_scope, '*'),
        ('feature'::public.aido_control_scope, p_feature_key),
        ('provider'::public.aido_control_scope, p_provider),
        ('model'::public.aido_control_scope, p_provider || '/' || p_model)
    )
    SELECT
      required.scope_type,
      required.scope_key,
      controls.id,
      controls.is_enabled,
      controls.daily_provider_budget_microusd,
      controls.max_concurrent_calls
    FROM required
    LEFT JOIN public.aido_system_controls controls
      ON controls.scope_type = required.scope_type
     AND controls.scope_key = required.scope_key
    ORDER BY required.scope_type::text, required.scope_key
  LOOP
    IF v_control.id IS NULL OR NOT v_control.is_enabled THEN
      RAISE EXCEPTION 'Provider access disabled for %:%', v_control.scope_type, v_control.scope_key
        USING ERRCODE = '42501';
    END IF;
    IF v_control.daily_provider_budget_microusd <= 0 THEN
      RAISE EXCEPTION 'No provider budget configured for %:%', v_control.scope_type, v_control.scope_key
        USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.aido_provider_budget_usage (
      usage_date, scope_type, scope_key
    ) VALUES (
      (now() AT TIME ZONE 'UTC')::date,
      v_control.scope_type,
      v_control.scope_key
    )
    ON CONFLICT (usage_date, scope_type, scope_key) DO NOTHING;

    SELECT usage.*
    INTO v_usage
    FROM public.aido_provider_budget_usage usage
    WHERE usage.usage_date = (now() AT TIME ZONE 'UTC')::date
      AND usage.scope_type = v_control.scope_type
      AND usage.scope_key = v_control.scope_key
    FOR UPDATE;

    IF v_usage.reserved_microusd + v_usage.incurred_microusd + p_amount_microusd
       > v_control.daily_provider_budget_microusd THEN
      RAISE EXCEPTION 'Daily provider budget exhausted for %:%', v_control.scope_type, v_control.scope_key
        USING ERRCODE = 'P0001';
    END IF;

    IF v_control.max_concurrent_calls > 0 THEN
      CASE v_control.scope_type
        WHEN 'global' THEN
          SELECT count(*) INTO v_active_count
          FROM public.aido_usage_reservations reservation
          WHERE reservation.status IN ('reserved', 'running');
        WHEN 'feature' THEN
          SELECT count(*) INTO v_active_count
          FROM public.aido_usage_reservations reservation
          WHERE reservation.status IN ('reserved', 'running')
            AND reservation.feature_key = p_feature_key;
        WHEN 'provider' THEN
          SELECT count(*) INTO v_active_count
          FROM public.aido_usage_reservations reservation
          JOIN public.aido_provider_routes route ON route.id = reservation.provider_route_id
          JOIN public.aido_provider_prices price ON price.id = route.provider_price_id
          WHERE reservation.status IN ('reserved', 'running')
            AND price.provider = p_provider;
        WHEN 'model' THEN
          SELECT count(*) INTO v_active_count
          FROM public.aido_usage_reservations reservation
          JOIN public.aido_provider_routes route ON route.id = reservation.provider_route_id
          JOIN public.aido_provider_prices price ON price.id = route.provider_price_id
          WHERE reservation.status IN ('reserved', 'running')
            AND price.provider = p_provider
            AND price.model = p_model;
      END CASE;

      IF v_active_count >= v_control.max_concurrent_calls THEN
        RAISE EXCEPTION 'Concurrent provider limit reached for %:%', v_control.scope_type, v_control.scope_key
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    UPDATE public.aido_provider_budget_usage
    SET reserved_microusd = reserved_microusd + p_amount_microusd,
        version = version + 1
    WHERE id = v_usage.id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION aido_private.finalize_provider_budget(
  p_feature_key text,
  p_provider text,
  p_model text,
  p_usage_date date,
  p_reserved_microusd bigint,
  p_incurred_microusd bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_scope record;
  v_usage public.aido_provider_budget_usage%ROWTYPE;
BEGIN
  IF p_reserved_microusd <= 0 OR p_incurred_microusd < 0 THEN
    RAISE EXCEPTION 'Invalid provider budget finalization values' USING ERRCODE = '22023';
  END IF;

  FOR v_scope IN
    SELECT required.scope_type, required.scope_key
    FROM (VALUES
      ('global'::public.aido_control_scope, '*'),
      ('feature'::public.aido_control_scope, p_feature_key),
      ('provider'::public.aido_control_scope, p_provider),
      ('model'::public.aido_control_scope, p_provider || '/' || p_model)
    ) AS required(scope_type, scope_key)
    ORDER BY required.scope_type::text, required.scope_key
  LOOP
    SELECT usage.*
    INTO v_usage
    FROM public.aido_provider_budget_usage usage
    WHERE usage.usage_date = p_usage_date
      AND usage.scope_type = v_scope.scope_type
      AND usage.scope_key = v_scope.scope_key
    FOR UPDATE;

    IF NOT FOUND OR v_usage.reserved_microusd < p_reserved_microusd THEN
      RAISE EXCEPTION 'Provider budget projection is inconsistent for %:%', v_scope.scope_type, v_scope.scope_key
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.aido_provider_budget_usage
    SET reserved_microusd = reserved_microusd - p_reserved_microusd,
        incurred_microusd = incurred_microusd + p_incurred_microusd,
        version = version + 1
    WHERE id = v_usage.id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION aido_private.reserve_provider_budget(text, text, text, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aido_private.finalize_provider_budget(text, text, text, date, bigint, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aido_private.reserve_provider_budget(text, text, text, bigint)
  TO service_role;
GRANT EXECUTE ON FUNCTION aido_private.finalize_provider_budget(text, text, text, date, bigint, bigint)
  TO service_role;

-- ----------------------------------------------------------------------------
-- Credit grant
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aido_private.grant_credits(
  p_user_id uuid,
  p_amount bigint,
  p_source public.aido_credit_lot_source,
  p_expires_at timestamptz,
  p_idempotency_key text,
  p_payment_event_id uuid,
  p_credit_product_id uuid
)
RETURNS TABLE (
  credit_lot_id uuid,
  ledger_entry_id bigint,
  available_credits bigint,
  reserved_credits bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_wallet public.aido_credit_wallets%ROWTYPE;
  v_existing public.aido_credit_ledger%ROWTYPE;
  v_existing_lot public.aido_credit_lots%ROWTYPE;
  v_lot_id uuid;
  v_ledger_id bigint;
  v_payment public.aido_payment_events%ROWTYPE;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Credit grant must be positive' USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'Invalid idempotency key' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'Credit expiry must be in the future' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.aido_product_memberships membership
    WHERE membership.user_id = p_user_id
      AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Active Aido membership required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.aido_credit_wallets (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT wallet.*
  INTO v_wallet
  FROM public.aido_credit_wallets wallet
  WHERE wallet.user_id = p_user_id
  FOR UPDATE;

  SELECT ledger.*
  INTO v_existing
  FROM public.aido_credit_ledger ledger
  WHERE ledger.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    SELECT lot.* INTO v_existing_lot
    FROM public.aido_credit_lots lot
    WHERE lot.id = v_existing.credit_lot_id;

    IF v_existing.user_id <> p_user_id
       OR v_existing.entry_type <> 'grant'
       OR COALESCE((v_existing.metadata ->> 'amount')::bigint, -1) <> p_amount
       OR COALESCE(v_existing.metadata ->> 'source', '') <> p_source::text
       OR NOT FOUND
       OR v_existing_lot.user_id <> p_user_id
       OR v_existing_lot.source <> p_source
       OR v_existing_lot.granted_credits <> p_amount
       OR v_existing_lot.expires_at IS DISTINCT FROM p_expires_at
       OR v_existing_lot.payment_event_id IS DISTINCT FROM p_payment_event_id
       OR v_existing_lot.credit_product_id IS DISTINCT FROM p_credit_product_id THEN
      RAISE EXCEPTION 'Idempotency key reused with different grant parameters'
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT
      v_existing.credit_lot_id,
      v_existing.id,
      v_existing.available_balance_after,
      v_existing.reserved_balance_after;
    RETURN;
  END IF;

  IF p_payment_event_id IS NOT NULL THEN
    SELECT payment.*
    INTO v_payment
    FROM public.aido_payment_events payment
    WHERE payment.id = p_payment_event_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payment event not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_payment.user_id IS DISTINCT FROM p_user_id
       OR v_payment.status NOT IN ('received', 'processed')
       OR v_payment.credit_product_id IS DISTINCT FROM p_credit_product_id THEN
      RAISE EXCEPTION 'Payment event does not match credit grant' USING ERRCODE = '22023';
    END IF;
  ELSIF p_source IN ('topup', 'subscription', 'semester') THEN
    RAISE EXCEPTION 'Paid credit grants require a verified payment event' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.aido_credit_lots (
    user_id,
    source,
    credit_product_id,
    payment_event_id,
    granted_credits,
    remaining_credits,
    expires_at
  ) VALUES (
    p_user_id,
    p_source,
    p_credit_product_id,
    p_payment_event_id,
    p_amount,
    p_amount,
    p_expires_at
  )
  RETURNING id INTO v_lot_id;

  UPDATE public.aido_credit_wallets AS wallet
  SET available_credits = wallet.available_credits + p_amount,
      version = wallet.version + 1
  WHERE wallet.user_id = p_user_id
  RETURNING * INTO v_wallet;

  INSERT INTO public.aido_credit_ledger (
    user_id,
    entry_type,
    credit_lot_id,
    payment_event_id,
    available_delta,
    available_balance_after,
    reserved_balance_after,
    unrecovered_balance_after,
    idempotency_key,
    metadata
  ) VALUES (
    p_user_id,
    'grant',
    v_lot_id,
    p_payment_event_id,
    p_amount,
    v_wallet.available_credits,
    v_wallet.reserved_credits,
    v_wallet.unrecovered_credits,
    p_idempotency_key,
    jsonb_build_object(
      'amount', p_amount,
      'source', p_source::text,
      'expires_at', p_expires_at
    )
  )
  RETURNING id INTO v_ledger_id;

  IF p_payment_event_id IS NOT NULL AND v_payment.status = 'received' THEN
    UPDATE public.aido_payment_events
    SET status = 'processed',
        processed_at = now()
    WHERE id = p_payment_event_id;
  END IF;

  RETURN QUERY SELECT
    v_lot_id,
    v_ledger_id,
    v_wallet.available_credits,
    v_wallet.reserved_credits;
END;
$$;

CREATE OR REPLACE FUNCTION public.aido_grant_credits(
  p_user_id uuid,
  p_amount bigint,
  p_source public.aido_credit_lot_source,
  p_expires_at timestamptz,
  p_idempotency_key text,
  p_payment_event_id uuid,
  p_credit_product_id uuid
)
RETURNS TABLE (
  credit_lot_id uuid,
  ledger_entry_id bigint,
  available_credits bigint,
  reserved_credits bigint
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM aido_private.grant_credits(
    p_user_id,
    p_amount,
    p_source,
    p_expires_at,
    p_idempotency_key,
    p_payment_event_id,
    p_credit_product_id
  );
$$;

REVOKE ALL ON FUNCTION aido_private.grant_credits(
  uuid, bigint, public.aido_credit_lot_source, timestamptz, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aido_private.grant_credits(
  uuid, bigint, public.aido_credit_lot_source, timestamptz, text, uuid, uuid
) TO service_role;
REVOKE ALL ON FUNCTION public.aido_grant_credits(
  uuid, bigint, public.aido_credit_lot_source, timestamptz, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aido_grant_credits(
  uuid, bigint, public.aido_credit_lot_source, timestamptz, text, uuid, uuid
) TO service_role;

-- ----------------------------------------------------------------------------
-- Atomic reservation. Wallet row locks serialize requests for one user;
-- provider-budget rows serialize platform/provider/model exposure globally.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aido_private.reserve_credits(
  p_user_id uuid,
  p_project_id uuid,
  p_feature_key text,
  p_feature_rate_card_id uuid,
  p_provider_route_id uuid,
  p_job_key text,
  p_idempotency_key text,
  p_quoted_credits bigint,
  p_maximum_credits bigint,
  p_provider_budget_microusd bigint,
  p_expires_at timestamptz
)
RETURNS TABLE (
  reservation_id uuid,
  available_credits bigint,
  reserved_credits bigint,
  maximum_credits bigint,
  provider_budget_microusd bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_wallet public.aido_credit_wallets%ROWTYPE;
  v_rate public.aido_feature_rate_cards%ROWTYPE;
  v_route public.aido_provider_routes%ROWTYPE;
  v_price public.aido_provider_prices%ROWTYPE;
  v_existing public.aido_usage_reservations%ROWTYPE;
  v_reservation_id uuid;
  v_daily_exposure bigint;
  v_active_jobs bigint;
  v_remaining bigint;
  v_take bigint;
  v_lot record;
BEGIN
  IF char_length(btrim(p_job_key)) NOT BETWEEN 8 AND 200
     OR char_length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 190 THEN
    RAISE EXCEPTION 'Invalid reservation key' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at <= now() OR p_expires_at > now() + interval '24 hours' THEN
    RAISE EXCEPTION 'Reservation expiry must be within 24 hours' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.aido_product_memberships membership
    WHERE membership.user_id = p_user_id AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Active Aido membership required' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.aido_writing_projects project
    WHERE project.id = p_project_id AND project.owner_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Project is not owned by the user' USING ERRCODE = '42501';
  END IF;

  SELECT rate.* INTO v_rate
  FROM public.aido_feature_rate_cards rate
  WHERE rate.id = p_feature_rate_card_id
    AND rate.feature_key = p_feature_key
    AND rate.effective_from <= now()
    AND (rate.effective_to IS NULL OR rate.effective_to > now());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No effective feature rate card' USING ERRCODE = 'P0002';
  END IF;

  SELECT route.* INTO v_route
  FROM public.aido_provider_routes route
  WHERE route.id = p_provider_route_id
    AND route.feature_rate_card_id = p_feature_rate_card_id
    AND route.approved
    AND route.effective_from <= now()
    AND (route.effective_to IS NULL OR route.effective_to > now());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider route is not approved and effective' USING ERRCODE = '42501';
  END IF;

  SELECT price.* INTO v_price
  FROM public.aido_provider_prices price
  WHERE price.id = v_route.provider_price_id
    AND price.effective_from <= now()
    AND (price.effective_to IS NULL OR price.effective_to > now());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No effective provider price' USING ERRCODE = 'P0002';
  END IF;

  IF p_quoted_credits < v_rate.minimum_credits
     OR p_maximum_credits < p_quoted_credits
     OR p_maximum_credits > v_rate.maximum_credits
     OR p_provider_budget_microusd <= 0
     OR p_provider_budget_microusd > v_rate.max_provider_cost_microusd THEN
    RAISE EXCEPTION 'Reservation exceeds the approved rate card' USING ERRCODE = '22023';
  END IF;

  SELECT wallet.* INTO v_wallet
  FROM public.aido_credit_wallets wallet
  WHERE wallet.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient credits' USING ERRCODE = 'P0001';
  END IF;

  SELECT reservation.* INTO v_existing
  FROM public.aido_usage_reservations reservation
  WHERE reservation.idempotency_key = p_idempotency_key
     OR reservation.job_key = p_job_key
  ORDER BY reservation.created_at
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.user_id <> p_user_id
       OR v_existing.project_id IS DISTINCT FROM p_project_id
       OR v_existing.feature_key <> p_feature_key
       OR v_existing.job_key <> p_job_key
       OR v_existing.idempotency_key <> p_idempotency_key
       OR v_existing.feature_rate_card_id <> p_feature_rate_card_id
       OR v_existing.provider_route_id <> p_provider_route_id
       OR v_existing.quoted_credits <> p_quoted_credits
       OR v_existing.maximum_credits <> p_maximum_credits
       OR v_existing.provider_budget_microusd <> p_provider_budget_microusd
       OR v_existing.expires_at <> p_expires_at THEN
      RAISE EXCEPTION 'Reservation key reused with different parameters' USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT
      v_existing.id,
      v_wallet.available_credits,
      v_wallet.reserved_credits,
      v_existing.maximum_credits,
      v_existing.provider_budget_microusd;
    RETURN;
  END IF;

  IF v_wallet.status <> 'active' THEN
    RAISE EXCEPTION 'Wallet is not active' USING ERRCODE = '42501';
  END IF;
  IF v_wallet.available_credits < p_maximum_credits THEN
    RAISE EXCEPTION 'Insufficient credits' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(sum(
    CASE
      WHEN reservation.status IN ('reserved', 'running') THEN reservation.maximum_credits
      WHEN reservation.status = 'settled' THEN reservation.captured_credits
      ELSE 0
    END
  ), 0)
  INTO v_daily_exposure
  FROM public.aido_usage_reservations reservation
  WHERE reservation.user_id = p_user_id
    AND reservation.created_at >= (
      date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    );

  IF v_daily_exposure + p_maximum_credits > v_rate.daily_user_credit_cap THEN
    RAISE EXCEPTION 'Daily user credit limit reached' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_active_jobs
  FROM public.aido_usage_reservations reservation
  WHERE reservation.user_id = p_user_id
    AND reservation.feature_key = p_feature_key
    AND reservation.status IN ('reserved', 'running');
  IF v_active_jobs >= v_rate.concurrent_job_cap THEN
    RAISE EXCEPTION 'Concurrent job limit reached' USING ERRCODE = 'P0001';
  END IF;

  PERFORM aido_private.reserve_provider_budget(
    p_feature_key,
    v_price.provider,
    v_price.model,
    p_provider_budget_microusd
  );

  INSERT INTO public.aido_usage_reservations (
    user_id,
    project_id,
    feature_key,
    feature_rate_card_id,
    provider_route_id,
    job_key,
    idempotency_key,
    quoted_credits,
    maximum_credits,
    provider_budget_microusd,
    expires_at
  ) VALUES (
    p_user_id,
    p_project_id,
    p_feature_key,
    p_feature_rate_card_id,
    p_provider_route_id,
    p_job_key,
    p_idempotency_key,
    p_quoted_credits,
    p_maximum_credits,
    p_provider_budget_microusd,
    p_expires_at
  )
  RETURNING id INTO v_reservation_id;

  v_remaining := p_maximum_credits;
  FOR v_lot IN
    SELECT
      lot.id,
      lot.remaining_credits,
      lot.reserved_credits
    FROM public.aido_credit_lots lot
    WHERE lot.user_id = p_user_id
      AND lot.status = 'active'
      AND lot.remaining_credits > lot.reserved_credits
      AND (lot.expires_at IS NULL OR lot.expires_at > p_expires_at)
    ORDER BY
      CASE WHEN lot.source = 'promotion' THEN 0 ELSE 1 END,
      lot.expires_at ASC NULLS LAST,
      lot.created_at,
      lot.id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining = 0;
    v_take := LEAST(v_remaining, v_lot.remaining_credits - v_lot.reserved_credits);

    UPDATE public.aido_credit_lots AS lot
    SET reserved_credits = lot.reserved_credits + v_take
    WHERE lot.id = v_lot.id;

    INSERT INTO public.aido_credit_reservation_allocations (
      reservation_id, credit_lot_id, user_id, allocated_credits
    ) VALUES (
      v_reservation_id, v_lot.id, p_user_id, v_take
    );

    v_remaining := v_remaining - v_take;
  END LOOP;

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'Wallet and credit lots require reconciliation' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.aido_credit_wallets AS wallet
  SET available_credits = wallet.available_credits - p_maximum_credits,
      reserved_credits = wallet.reserved_credits + p_maximum_credits,
      version = wallet.version + 1
  WHERE wallet.user_id = p_user_id
  RETURNING * INTO v_wallet;

  INSERT INTO public.aido_credit_ledger (
    user_id,
    entry_type,
    reservation_id,
    available_delta,
    reserved_delta,
    available_balance_after,
    reserved_balance_after,
    unrecovered_balance_after,
    idempotency_key,
    metadata
  ) VALUES (
    p_user_id,
    'reserve',
    v_reservation_id,
    -p_maximum_credits,
    p_maximum_credits,
    v_wallet.available_credits,
    v_wallet.reserved_credits,
    v_wallet.unrecovered_credits,
    p_idempotency_key || ':ledger',
    jsonb_build_object(
      'quoted_credits', p_quoted_credits,
      'maximum_credits', p_maximum_credits,
      'feature_key', p_feature_key,
      'feature_rate_card_id', p_feature_rate_card_id,
      'provider_route_id', p_provider_route_id,
      'provider_budget_microusd', p_provider_budget_microusd
    )
  );

  RETURN QUERY SELECT
    v_reservation_id,
    v_wallet.available_credits,
    v_wallet.reserved_credits,
    p_maximum_credits,
    p_provider_budget_microusd;
END;
$$;

CREATE OR REPLACE FUNCTION public.aido_reserve_credits(
  p_user_id uuid,
  p_project_id uuid,
  p_feature_key text,
  p_feature_rate_card_id uuid,
  p_provider_route_id uuid,
  p_job_key text,
  p_idempotency_key text,
  p_quoted_credits bigint,
  p_maximum_credits bigint,
  p_provider_budget_microusd bigint,
  p_expires_at timestamptz
)
RETURNS TABLE (
  reservation_id uuid,
  available_credits bigint,
  reserved_credits bigint,
  maximum_credits bigint,
  provider_budget_microusd bigint
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM aido_private.reserve_credits(
    p_user_id,
    p_project_id,
    p_feature_key,
    p_feature_rate_card_id,
    p_provider_route_id,
    p_job_key,
    p_idempotency_key,
    p_quoted_credits,
    p_maximum_credits,
    p_provider_budget_microusd,
    p_expires_at
  );
$$;

CREATE OR REPLACE FUNCTION aido_private.mark_reservation_running(
  p_reservation_id uuid
)
RETURNS public.aido_usage_reservations
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_reservation public.aido_usage_reservations%ROWTYPE;
BEGIN
  SELECT reservation.* INTO v_reservation
  FROM public.aido_usage_reservations reservation
  WHERE reservation.id = p_reservation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_reservation.status = 'running' THEN
    RETURN v_reservation;
  END IF;
  IF v_reservation.status <> 'reserved' THEN
    RAISE EXCEPTION 'Reservation cannot start from status %', v_reservation.status USING ERRCODE = '55000';
  END IF;
  IF v_reservation.expires_at <= now() THEN
    RAISE EXCEPTION 'Reservation has expired' USING ERRCODE = '55000';
  END IF;

  UPDATE public.aido_usage_reservations
  SET status = 'running',
      started_at = now()
  WHERE id = p_reservation_id
  RETURNING * INTO v_reservation;
  RETURN v_reservation;
END;
$$;

CREATE OR REPLACE FUNCTION public.aido_mark_reservation_running(
  p_reservation_id uuid
)
RETURNS public.aido_usage_reservations
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM aido_private.mark_reservation_running(p_reservation_id);
$$;

-- A worker must obtain this authorization immediately before each provider
-- call. Pending authorizations are included in every ceiling calculation so
-- parallel calls cannot collectively overspend the reservation.
CREATE OR REPLACE FUNCTION aido_private.authorize_provider_call(
  p_reservation_id uuid,
  p_idempotency_key text,
  p_attempt smallint,
  p_estimated_cost_microusd bigint,
  p_estimated_input_tokens bigint,
  p_estimated_output_tokens bigint,
  p_estimated_tool_calls integer,
  p_estimated_search_calls integer,
  p_estimated_pages integer,
  p_expires_at timestamptz
)
RETURNS public.aido_provider_call_authorizations
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_reservation public.aido_usage_reservations%ROWTYPE;
  v_rate public.aido_feature_rate_cards%ROWTYPE;
  v_existing public.aido_provider_call_authorizations%ROWTYPE;
  v_authorization public.aido_provider_call_authorizations%ROWTYPE;
  v_actual record;
  v_pending record;
BEGIN
  IF char_length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 200
     OR p_estimated_cost_microusd <= 0
     OR p_estimated_input_tokens < 0
     OR p_estimated_output_tokens < 0
     OR p_estimated_tool_calls < 0
     OR p_estimated_search_calls < 0
     OR p_estimated_pages < 0
     OR p_expires_at <= now()
     OR p_expires_at > now() + interval '30 minutes' THEN
    RAISE EXCEPTION 'Invalid provider-call authorization' USING ERRCODE = '22023';
  END IF;

  SELECT reservation.* INTO v_reservation
  FROM public.aido_usage_reservations reservation
  WHERE reservation.id = p_reservation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT auth_call.* INTO v_existing
  FROM public.aido_provider_call_authorizations auth_call
  WHERE auth_call.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.reservation_id <> p_reservation_id
       OR v_existing.estimated_cost_microusd <> p_estimated_cost_microusd
       OR v_existing.attempt <> p_attempt
       OR v_existing.estimated_input_tokens <> p_estimated_input_tokens
       OR v_existing.estimated_output_tokens <> p_estimated_output_tokens
       OR v_existing.estimated_tool_calls <> p_estimated_tool_calls
       OR v_existing.estimated_search_calls <> p_estimated_search_calls
       OR v_existing.estimated_pages <> p_estimated_pages
       OR v_existing.expires_at <> p_expires_at THEN
      RAISE EXCEPTION 'Provider authorization key reused with different parameters'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_existing;
  END IF;

  IF v_reservation.status <> 'running' OR v_reservation.expires_at <= now() THEN
    RAISE EXCEPTION 'Reservation is not running' USING ERRCODE = '55000';
  END IF;

  SELECT rate.* INTO v_rate
  FROM public.aido_feature_rate_cards rate
  WHERE rate.id = v_reservation.feature_rate_card_id;

  SELECT
    COALESCE(sum(event.input_tokens), 0) AS input_tokens,
    COALESCE(sum(event.output_tokens), 0) AS output_tokens,
    COALESCE(sum(event.tool_calls), 0) AS tool_calls,
    COALESCE(sum(event.search_calls), 0) AS search_calls,
    COALESCE(sum(event.processed_pages), 0) AS pages,
    COALESCE(sum(event.provider_cost_microusd), 0) AS cost
  INTO v_actual
  FROM public.aido_usage_events event
  WHERE event.reservation_id = p_reservation_id;

  SELECT
    COALESCE(sum(auth_call.estimated_input_tokens), 0) AS input_tokens,
    COALESCE(sum(auth_call.estimated_output_tokens), 0) AS output_tokens,
    COALESCE(sum(auth_call.estimated_tool_calls), 0) AS tool_calls,
    COALESCE(sum(auth_call.estimated_search_calls), 0) AS search_calls,
    COALESCE(sum(auth_call.estimated_pages), 0) AS pages,
    COALESCE(sum(auth_call.estimated_cost_microusd), 0) AS cost
  INTO v_pending
  FROM public.aido_provider_call_authorizations auth_call
  WHERE auth_call.reservation_id = p_reservation_id
    AND auth_call.status = 'authorized'
    AND auth_call.expires_at > now();

  IF p_attempt > v_rate.max_retries + 1
     OR v_actual.input_tokens + v_pending.input_tokens + p_estimated_input_tokens > v_rate.max_input_tokens
     OR v_actual.output_tokens + v_pending.output_tokens + p_estimated_output_tokens > v_rate.max_output_tokens
     OR v_actual.tool_calls + v_pending.tool_calls + p_estimated_tool_calls > v_rate.max_tool_calls
     OR v_actual.search_calls + v_pending.search_calls + p_estimated_search_calls > v_rate.max_search_calls
     OR v_actual.pages + v_pending.pages + p_estimated_pages > v_rate.max_pages
     OR v_actual.cost + v_pending.cost + p_estimated_cost_microusd > v_reservation.provider_budget_microusd THEN
    RAISE EXCEPTION 'Provider call would exceed a hard reservation ceiling' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.aido_provider_call_authorizations (
    reservation_id,
    user_id,
    idempotency_key,
    attempt,
    estimated_cost_microusd,
    estimated_input_tokens,
    estimated_output_tokens,
    estimated_tool_calls,
    estimated_search_calls,
    estimated_pages,
    expires_at
  ) VALUES (
    p_reservation_id,
    v_reservation.user_id,
    p_idempotency_key,
    p_attempt,
    p_estimated_cost_microusd,
    p_estimated_input_tokens,
    p_estimated_output_tokens,
    p_estimated_tool_calls,
    p_estimated_search_calls,
    p_estimated_pages,
    p_expires_at
  )
  RETURNING * INTO v_authorization;

  RETURN v_authorization;
END;
$$;

CREATE OR REPLACE FUNCTION public.aido_authorize_provider_call(
  p_reservation_id uuid,
  p_idempotency_key text,
  p_attempt smallint,
  p_estimated_cost_microusd bigint,
  p_estimated_input_tokens bigint,
  p_estimated_output_tokens bigint,
  p_estimated_tool_calls integer,
  p_estimated_search_calls integer,
  p_estimated_pages integer,
  p_expires_at timestamptz
)
RETURNS public.aido_provider_call_authorizations
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM aido_private.authorize_provider_call(
    p_reservation_id,
    p_idempotency_key,
    p_attempt,
    p_estimated_cost_microusd,
    p_estimated_input_tokens,
    p_estimated_output_tokens,
    p_estimated_tool_calls,
    p_estimated_search_calls,
    p_estimated_pages,
    p_expires_at
  );
$$;

CREATE OR REPLACE FUNCTION aido_private.record_usage_event(
  p_authorization_id uuid,
  p_idempotency_key text,
  p_provider_request_id text,
  p_prompt_version text,
  p_input_tokens bigint,
  p_cached_input_tokens bigint,
  p_output_tokens bigint,
  p_tool_calls integer,
  p_search_calls integer,
  p_processed_pages integer,
  p_latency_ms integer,
  p_provider_cost_microusd bigint,
  p_outcome public.aido_usage_outcome,
  p_billable_to_student boolean,
  p_failure_category text
)
RETURNS public.aido_usage_events
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_authorization_ref public.aido_provider_call_authorizations%ROWTYPE;
  v_authorization public.aido_provider_call_authorizations%ROWTYPE;
  v_reservation public.aido_usage_reservations%ROWTYPE;
  v_rate public.aido_feature_rate_cards%ROWTYPE;
  v_route public.aido_provider_routes%ROWTYPE;
  v_price public.aido_provider_prices%ROWTYPE;
  v_existing public.aido_usage_events%ROWTYPE;
  v_usage public.aido_usage_events%ROWTYPE;
  v_totals record;
BEGIN
  SELECT auth_call.* INTO v_authorization_ref
  FROM public.aido_provider_call_authorizations auth_call
  WHERE auth_call.id = p_authorization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider authorization not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT reservation.* INTO v_reservation
  FROM public.aido_usage_reservations reservation
  WHERE reservation.id = v_authorization_ref.reservation_id
  FOR UPDATE;

  SELECT auth_call.* INTO v_authorization
  FROM public.aido_provider_call_authorizations auth_call
  WHERE auth_call.id = p_authorization_id
  FOR UPDATE;

  SELECT event.* INTO v_existing
  FROM public.aido_usage_events event
  WHERE event.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.reservation_id <> v_reservation.id
       OR NOT EXISTS (
         SELECT 1
         FROM public.aido_provider_call_authorizations auth_call
         WHERE auth_call.id = p_authorization_id
           AND auth_call.usage_event_id = v_existing.id
       )
       OR v_existing.provider_request_id IS DISTINCT FROM p_provider_request_id
       OR v_existing.prompt_version <> p_prompt_version
       OR v_existing.input_tokens <> p_input_tokens
       OR v_existing.cached_input_tokens <> p_cached_input_tokens
       OR v_existing.output_tokens <> p_output_tokens
       OR v_existing.tool_calls <> p_tool_calls
       OR v_existing.search_calls <> p_search_calls
       OR v_existing.processed_pages <> p_processed_pages
       OR v_existing.latency_ms <> p_latency_ms
       OR v_existing.provider_cost_microusd <> p_provider_cost_microusd
       OR v_existing.outcome <> p_outcome
       OR v_existing.billable_to_student <> (
         CASE WHEN p_outcome = 'succeeded' THEN p_billable_to_student ELSE false END
       )
       OR v_existing.failure_category IS DISTINCT FROM p_failure_category THEN
      RAISE EXCEPTION 'Usage key reused with different provider facts' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing;
  END IF;

  IF v_authorization.status <> 'authorized'
     OR v_authorization.expires_at <= now()
     OR v_reservation.status <> 'running' THEN
    RAISE EXCEPTION 'Provider call authorization is not active' USING ERRCODE = '55000';
  END IF;

  IF p_provider_request_id IS NOT NULL THEN
    SELECT event.* INTO v_existing
    FROM public.aido_usage_events event
    JOIN public.aido_provider_routes route ON route.id = event.provider_route_id
    JOIN public.aido_provider_prices price ON price.id = route.provider_price_id
    WHERE price.provider = (
      SELECT provider_price.provider
      FROM public.aido_provider_routes provider_route
      JOIN public.aido_provider_prices provider_price ON provider_price.id = provider_route.provider_price_id
      WHERE provider_route.id = v_reservation.provider_route_id
    )
      AND event.provider_request_id = p_provider_request_id;
    IF FOUND THEN
      IF v_existing.reservation_id <> v_reservation.id
         OR NOT EXISTS (
           SELECT 1
           FROM public.aido_provider_call_authorizations auth_call
           WHERE auth_call.id = p_authorization_id
             AND auth_call.usage_event_id = v_existing.id
         )
         OR v_existing.idempotency_key <> p_idempotency_key
         OR v_existing.prompt_version <> p_prompt_version
         OR v_existing.input_tokens <> p_input_tokens
         OR v_existing.cached_input_tokens <> p_cached_input_tokens
         OR v_existing.output_tokens <> p_output_tokens
         OR v_existing.tool_calls <> p_tool_calls
         OR v_existing.search_calls <> p_search_calls
         OR v_existing.processed_pages <> p_processed_pages
         OR v_existing.latency_ms <> p_latency_ms
         OR v_existing.provider_cost_microusd <> p_provider_cost_microusd
         OR v_existing.outcome <> p_outcome
         OR v_existing.billable_to_student <> (
           CASE WHEN p_outcome = 'succeeded' THEN p_billable_to_student ELSE false END
         )
         OR v_existing.failure_category IS DISTINCT FROM p_failure_category THEN
        RAISE EXCEPTION 'Provider request ID reused with different provider facts' USING ERRCODE = '23505';
      END IF;
      RETURN v_existing;
    END IF;
  END IF;

  IF p_input_tokens < 0
     OR p_cached_input_tokens < 0
     OR p_cached_input_tokens > p_input_tokens
     OR p_output_tokens < 0
     OR p_tool_calls < 0
     OR p_search_calls < 0
     OR p_processed_pages < 0
     OR p_latency_ms < 0
     OR p_provider_cost_microusd < 0
     OR (p_outcome = 'succeeded' AND p_failure_category IS NOT NULL)
     OR (p_outcome <> 'succeeded' AND p_billable_to_student) THEN
    RAISE EXCEPTION 'Invalid provider usage values' USING ERRCODE = '22023';
  END IF;

  SELECT rate.* INTO v_rate
  FROM public.aido_feature_rate_cards rate
  WHERE rate.id = v_reservation.feature_rate_card_id;
  SELECT route.* INTO v_route
  FROM public.aido_provider_routes route
  WHERE route.id = v_reservation.provider_route_id;
  SELECT price.* INTO v_price
  FROM public.aido_provider_prices price
  WHERE price.id = v_route.provider_price_id;

  SELECT
    COALESCE(sum(event.input_tokens), 0) AS input_tokens,
    COALESCE(sum(event.output_tokens), 0) AS output_tokens,
    COALESCE(sum(event.tool_calls), 0) AS tool_calls,
    COALESCE(sum(event.search_calls), 0) AS search_calls,
    COALESCE(sum(event.processed_pages), 0) AS pages,
    COALESCE(sum(event.provider_cost_microusd), 0) AS cost
  INTO v_totals
  FROM public.aido_usage_events event
  WHERE event.reservation_id = v_reservation.id;

  IF p_outcome = 'succeeded' AND (
    p_provider_cost_microusd > v_authorization.estimated_cost_microusd
    OR v_totals.input_tokens + p_input_tokens > v_rate.max_input_tokens
    OR v_totals.output_tokens + p_output_tokens > v_rate.max_output_tokens
    OR v_totals.tool_calls + p_tool_calls > v_rate.max_tool_calls
    OR v_totals.search_calls + p_search_calls > v_rate.max_search_calls
    OR v_totals.pages + p_processed_pages > v_rate.max_pages
    OR v_totals.cost + p_provider_cost_microusd > v_reservation.provider_budget_microusd
  ) THEN
    RAISE EXCEPTION 'Successful provider usage exceeds its authorization' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.aido_usage_events (
    reservation_id,
    user_id,
    provider_route_id,
    provider,
    model,
    provider_request_id,
    idempotency_key,
    attempt,
    prompt_version,
    input_tokens,
    cached_input_tokens,
    output_tokens,
    tool_calls,
    search_calls,
    processed_pages,
    latency_ms,
    provider_cost_microusd,
    outcome,
    billable_to_student,
    failure_category
  ) VALUES (
    v_reservation.id,
    v_reservation.user_id,
    v_reservation.provider_route_id,
    v_price.provider,
    v_price.model,
    p_provider_request_id,
    p_idempotency_key,
    v_authorization.attempt,
    p_prompt_version,
    p_input_tokens,
    p_cached_input_tokens,
    p_output_tokens,
    p_tool_calls,
    p_search_calls,
    p_processed_pages,
    p_latency_ms,
    p_provider_cost_microusd,
    p_outcome,
    CASE WHEN p_outcome = 'succeeded' THEN p_billable_to_student ELSE false END,
    p_failure_category
  )
  RETURNING * INTO v_usage;

  UPDATE public.aido_provider_call_authorizations
  SET status = 'consumed',
      actual_cost_microusd = p_provider_cost_microusd,
      usage_event_id = v_usage.id,
      consumed_at = now()
  WHERE id = p_authorization_id;

  UPDATE public.aido_usage_reservations
  SET actual_provider_cost_microusd = actual_provider_cost_microusd + p_provider_cost_microusd
  WHERE id = v_reservation.id;

  RETURN v_usage;
END;
$$;

CREATE OR REPLACE FUNCTION public.aido_record_usage_event(
  p_authorization_id uuid,
  p_idempotency_key text,
  p_provider_request_id text,
  p_prompt_version text,
  p_input_tokens bigint,
  p_cached_input_tokens bigint,
  p_output_tokens bigint,
  p_tool_calls integer,
  p_search_calls integer,
  p_processed_pages integer,
  p_latency_ms integer,
  p_provider_cost_microusd bigint,
  p_outcome public.aido_usage_outcome,
  p_billable_to_student boolean,
  p_failure_category text
)
RETURNS public.aido_usage_events
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM aido_private.record_usage_event(
    p_authorization_id,
    p_idempotency_key,
    p_provider_request_id,
    p_prompt_version,
    p_input_tokens,
    p_cached_input_tokens,
    p_output_tokens,
    p_tool_calls,
    p_search_calls,
    p_processed_pages,
    p_latency_ms,
    p_provider_cost_microusd,
    p_outcome,
    p_billable_to_student,
    p_failure_category
  );
$$;

-- ----------------------------------------------------------------------------
-- Terminal reservation operations
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aido_private.settle_reservation(
  p_reservation_id uuid,
  p_capture_credits bigint,
  p_idempotency_key text
)
RETURNS TABLE (
  reservation_id uuid,
  capture_ledger_entry_id bigint,
  release_ledger_entry_id bigint,
  captured_credits bigint,
  released_credits bigint,
  available_credits bigint,
  reserved_credits bigint,
  actual_provider_cost_microusd bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_reservation public.aido_usage_reservations%ROWTYPE;
  v_wallet public.aido_credit_wallets%ROWTYPE;
  v_route public.aido_provider_routes%ROWTYPE;
  v_price public.aido_provider_prices%ROWTYPE;
  v_capture_ledger_id bigint;
  v_capture_idempotency_key text;
  v_release_ledger_id bigint;
  v_unused bigint;
  v_capture_remaining bigint;
  v_allocation record;
  v_take bigint;
  v_usage_cost bigint;
BEGIN
  IF p_capture_credits <= 0 OR char_length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 180 THEN
    RAISE EXCEPTION 'Invalid settlement values' USING ERRCODE = '22023';
  END IF;

  SELECT reservation.* INTO v_reservation
  FROM public.aido_usage_reservations reservation
  WHERE reservation.id = p_reservation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_reservation.status = 'settled' THEN
    SELECT ledger.id, ledger.idempotency_key
    INTO v_capture_ledger_id, v_capture_idempotency_key
    FROM public.aido_credit_ledger ledger
    WHERE ledger.reservation_id = p_reservation_id AND ledger.entry_type = 'capture';
    SELECT ledger.id INTO v_release_ledger_id
    FROM public.aido_credit_ledger ledger
    WHERE ledger.reservation_id = p_reservation_id AND ledger.entry_type = 'release';
    SELECT wallet.* INTO v_wallet
    FROM public.aido_credit_wallets wallet
    WHERE wallet.user_id = v_reservation.user_id;

    IF v_reservation.captured_credits <> p_capture_credits
       OR v_capture_idempotency_key <> p_idempotency_key THEN
      RAISE EXCEPTION 'Reservation settlement key reused with different facts' USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT
      v_reservation.id,
      v_capture_ledger_id,
      v_release_ledger_id,
      v_reservation.captured_credits,
      v_reservation.released_credits,
      v_wallet.available_credits,
      v_wallet.reserved_credits,
      v_reservation.actual_provider_cost_microusd;
    RETURN;
  END IF;

  IF v_reservation.status NOT IN ('reserved', 'running') THEN
    RAISE EXCEPTION 'Reservation is already terminal with status %', v_reservation.status USING ERRCODE = '55000';
  END IF;
  IF p_capture_credits > v_reservation.maximum_credits THEN
    RAISE EXCEPTION 'Capture exceeds reserved maximum' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.aido_usage_events event
    WHERE event.reservation_id = p_reservation_id
      AND event.outcome = 'succeeded'
      AND event.billable_to_student
  ) THEN
    RAISE EXCEPTION 'Captured reservation requires successful billable usage' USING ERRCODE = '55000';
  END IF;

  SELECT COALESCE(sum(event.provider_cost_microusd), 0)
  INTO v_usage_cost
  FROM public.aido_usage_events event
  WHERE event.reservation_id = p_reservation_id;
  IF v_usage_cost > v_reservation.provider_budget_microusd THEN
    RAISE EXCEPTION 'Successful job exceeds provider budget' USING ERRCODE = 'P0001';
  END IF;

  SELECT wallet.* INTO v_wallet
  FROM public.aido_credit_wallets wallet
  WHERE wallet.user_id = v_reservation.user_id
  FOR UPDATE;
  IF NOT FOUND OR v_wallet.reserved_credits < v_reservation.maximum_credits THEN
    RAISE EXCEPTION 'Wallet reservation projection is inconsistent' USING ERRCODE = 'P0001';
  END IF;

  v_unused := v_reservation.maximum_credits - p_capture_credits;

  UPDATE public.aido_credit_wallets AS wallet
  SET reserved_credits = wallet.reserved_credits - v_reservation.maximum_credits,
      available_credits = wallet.available_credits + v_unused,
      version = wallet.version + 1
  WHERE wallet.user_id = v_reservation.user_id
  RETURNING * INTO v_wallet;

  INSERT INTO public.aido_credit_ledger (
    user_id,
    entry_type,
    reservation_id,
    reserved_delta,
    available_balance_after,
    reserved_balance_after,
    unrecovered_balance_after,
    idempotency_key,
    metadata
  ) VALUES (
    v_reservation.user_id,
    'capture',
    p_reservation_id,
    -p_capture_credits,
    v_wallet.available_credits - v_unused,
    v_wallet.reserved_credits + v_unused,
    v_wallet.unrecovered_credits,
    p_idempotency_key,
    jsonb_build_object(
      'captured_credits', p_capture_credits,
      'actual_provider_cost_microusd', v_usage_cost
    )
  )
  RETURNING id INTO v_capture_ledger_id;

  IF v_unused > 0 THEN
    INSERT INTO public.aido_credit_ledger (
      user_id,
      entry_type,
      reservation_id,
      available_delta,
      reserved_delta,
      available_balance_after,
      reserved_balance_after,
      unrecovered_balance_after,
      idempotency_key,
      metadata
    ) VALUES (
      v_reservation.user_id,
      'release',
      p_reservation_id,
      v_unused,
      -v_unused,
      v_wallet.available_credits,
      v_wallet.reserved_credits,
      v_wallet.unrecovered_credits,
      p_idempotency_key || ':unused',
      jsonb_build_object('released_credits', v_unused, 'settlement', true)
    )
    RETURNING id INTO v_release_ledger_id;
  END IF;

  v_capture_remaining := p_capture_credits;
  FOR v_allocation IN
    SELECT
      allocation.id,
      allocation.credit_lot_id,
      allocation.allocated_credits,
      lot.remaining_credits,
      lot.reserved_credits
    FROM public.aido_credit_reservation_allocations allocation
    JOIN public.aido_credit_lots lot ON lot.id = allocation.credit_lot_id
    WHERE allocation.reservation_id = p_reservation_id
    ORDER BY
      CASE WHEN lot.source = 'promotion' THEN 0 ELSE 1 END,
      lot.expires_at ASC NULLS LAST,
      lot.created_at,
      lot.id
    FOR UPDATE OF allocation, lot
  LOOP
    v_take := LEAST(v_capture_remaining, v_allocation.allocated_credits);

    UPDATE public.aido_credit_lots AS lot
    SET reserved_credits = lot.reserved_credits - v_allocation.allocated_credits,
        remaining_credits = lot.remaining_credits - v_take,
        status = CASE
          WHEN lot.remaining_credits - v_take = 0 THEN 'depleted'::public.aido_credit_lot_status
          ELSE 'active'::public.aido_credit_lot_status
        END
    WHERE lot.id = v_allocation.credit_lot_id;

    UPDATE public.aido_credit_reservation_allocations
    SET captured_credits = v_take,
        released_credits = v_allocation.allocated_credits - v_take,
        capture_ledger_entry_id = v_capture_ledger_id,
        release_ledger_entry_id = CASE WHEN v_unused > 0 THEN v_release_ledger_id ELSE NULL END
    WHERE id = v_allocation.id;

    v_capture_remaining := v_capture_remaining - v_take;
  END LOOP;

  IF v_capture_remaining <> 0 THEN
    RAISE EXCEPTION 'Credit allocation projection is inconsistent' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.aido_usage_reservations
  SET status = 'settled',
      captured_credits = p_capture_credits,
      released_credits = v_unused,
      actual_provider_cost_microusd = v_usage_cost,
      settled_at = now(),
      released_at = now(),
      failure_category = NULL
  WHERE id = p_reservation_id
  RETURNING * INTO v_reservation;

  UPDATE public.aido_provider_call_authorizations AS auth_call
  SET status = 'released', released_at = now()
  WHERE auth_call.reservation_id = p_reservation_id
    AND auth_call.status = 'authorized';

  SELECT route.* INTO v_route
  FROM public.aido_provider_routes route WHERE route.id = v_reservation.provider_route_id;
  SELECT price.* INTO v_price
  FROM public.aido_provider_prices price WHERE price.id = v_route.provider_price_id;
  PERFORM aido_private.finalize_provider_budget(
    v_reservation.feature_key,
    v_price.provider,
    v_price.model,
    (v_reservation.created_at AT TIME ZONE 'UTC')::date,
    v_reservation.provider_budget_microusd,
    v_usage_cost
  );

  RETURN QUERY SELECT
    v_reservation.id,
    v_capture_ledger_id,
    v_release_ledger_id,
    v_reservation.captured_credits,
    v_reservation.released_credits,
    v_wallet.available_credits,
    v_wallet.reserved_credits,
    v_reservation.actual_provider_cost_microusd;
END;
$$;

CREATE OR REPLACE FUNCTION public.aido_settle_reservation(
  p_reservation_id uuid,
  p_capture_credits bigint,
  p_idempotency_key text
)
RETURNS TABLE (
  reservation_id uuid,
  capture_ledger_entry_id bigint,
  release_ledger_entry_id bigint,
  captured_credits bigint,
  released_credits bigint,
  available_credits bigint,
  reserved_credits bigint,
  actual_provider_cost_microusd bigint
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM aido_private.settle_reservation(
    p_reservation_id, p_capture_credits, p_idempotency_key
  );
$$;

CREATE OR REPLACE FUNCTION aido_private.release_reservation(
  p_reservation_id uuid,
  p_terminal_status public.aido_usage_reservation_status,
  p_failure_category text,
  p_idempotency_key text
)
RETURNS TABLE (
  reservation_id uuid,
  release_ledger_entry_id bigint,
  released_credits bigint,
  available_credits bigint,
  reserved_credits bigint,
  actual_provider_cost_microusd bigint,
  status public.aido_usage_reservation_status
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_reservation public.aido_usage_reservations%ROWTYPE;
  v_wallet public.aido_credit_wallets%ROWTYPE;
  v_route public.aido_provider_routes%ROWTYPE;
  v_price public.aido_provider_prices%ROWTYPE;
  v_release_ledger_id bigint;
  v_release_idempotency_key text;
  v_usage_cost bigint;
  v_allocation record;
BEGIN
  IF p_terminal_status NOT IN ('released', 'failed', 'expired')
     OR char_length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 200
     OR (p_terminal_status = 'failed' AND NULLIF(btrim(p_failure_category), '') IS NULL) THEN
    RAISE EXCEPTION 'Invalid reservation release values' USING ERRCODE = '22023';
  END IF;

  SELECT reservation.* INTO v_reservation
  FROM public.aido_usage_reservations reservation
  WHERE reservation.id = p_reservation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_reservation.status IN ('released', 'failed', 'expired') THEN
    SELECT ledger.id, ledger.idempotency_key
    INTO v_release_ledger_id, v_release_idempotency_key
    FROM public.aido_credit_ledger ledger
    WHERE ledger.reservation_id = p_reservation_id AND ledger.entry_type = 'release';
    SELECT wallet.* INTO v_wallet
    FROM public.aido_credit_wallets wallet WHERE wallet.user_id = v_reservation.user_id;

    IF v_reservation.status <> p_terminal_status
       OR v_reservation.failure_category IS DISTINCT FROM NULLIF(btrim(p_failure_category), '')
       OR v_release_idempotency_key <> p_idempotency_key THEN
      RAISE EXCEPTION 'Reservation release key reused with different facts' USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT
      v_reservation.id,
      v_release_ledger_id,
      v_reservation.released_credits,
      v_wallet.available_credits,
      v_wallet.reserved_credits,
      v_reservation.actual_provider_cost_microusd,
      v_reservation.status;
    RETURN;
  END IF;

  IF v_reservation.status = 'settled' THEN
    RAISE EXCEPTION 'Settled reservation cannot be released' USING ERRCODE = '55000';
  END IF;

  SELECT COALESCE(sum(event.provider_cost_microusd), 0)
  INTO v_usage_cost
  FROM public.aido_usage_events event
  WHERE event.reservation_id = p_reservation_id;

  SELECT wallet.* INTO v_wallet
  FROM public.aido_credit_wallets wallet
  WHERE wallet.user_id = v_reservation.user_id
  FOR UPDATE;
  IF NOT FOUND OR v_wallet.reserved_credits < v_reservation.maximum_credits THEN
    RAISE EXCEPTION 'Wallet reservation projection is inconsistent' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.aido_credit_wallets AS wallet
  SET reserved_credits = wallet.reserved_credits - v_reservation.maximum_credits,
      available_credits = wallet.available_credits + v_reservation.maximum_credits,
      version = wallet.version + 1
  WHERE wallet.user_id = v_reservation.user_id
  RETURNING * INTO v_wallet;

  INSERT INTO public.aido_credit_ledger (
    user_id,
    entry_type,
    reservation_id,
    available_delta,
    reserved_delta,
    available_balance_after,
    reserved_balance_after,
    unrecovered_balance_after,
    idempotency_key,
    metadata
  ) VALUES (
    v_reservation.user_id,
    'release',
    p_reservation_id,
    v_reservation.maximum_credits,
    -v_reservation.maximum_credits,
    v_wallet.available_credits,
    v_wallet.reserved_credits,
    v_wallet.unrecovered_credits,
    p_idempotency_key,
    jsonb_build_object(
      'released_credits', v_reservation.maximum_credits,
      'terminal_status', p_terminal_status::text,
      'failure_category', p_failure_category,
      'aido_provider_loss_microusd', v_usage_cost
    )
  )
  RETURNING id INTO v_release_ledger_id;

  FOR v_allocation IN
    SELECT allocation.id, allocation.credit_lot_id, allocation.allocated_credits
    FROM public.aido_credit_reservation_allocations allocation
    JOIN public.aido_credit_lots lot ON lot.id = allocation.credit_lot_id
    WHERE allocation.reservation_id = p_reservation_id
    ORDER BY
      CASE WHEN lot.source = 'promotion' THEN 0 ELSE 1 END,
      lot.expires_at ASC NULLS LAST,
      lot.created_at,
      lot.id
    FOR UPDATE OF allocation, lot
  LOOP
    UPDATE public.aido_credit_lots AS lot
    SET reserved_credits = lot.reserved_credits - v_allocation.allocated_credits
    WHERE lot.id = v_allocation.credit_lot_id;

    UPDATE public.aido_credit_reservation_allocations
    SET released_credits = v_allocation.allocated_credits,
        release_ledger_entry_id = v_release_ledger_id
    WHERE id = v_allocation.id;
  END LOOP;

  UPDATE public.aido_usage_reservations
  SET status = p_terminal_status,
      captured_credits = 0,
      released_credits = maximum_credits,
      actual_provider_cost_microusd = v_usage_cost,
      released_at = now(),
      failure_category = NULLIF(btrim(p_failure_category), '')
  WHERE id = p_reservation_id
  RETURNING * INTO v_reservation;

  UPDATE public.aido_provider_call_authorizations AS auth_call
  SET status = 'released', released_at = now()
  WHERE auth_call.reservation_id = p_reservation_id
    AND auth_call.status = 'authorized';

  SELECT route.* INTO v_route
  FROM public.aido_provider_routes route WHERE route.id = v_reservation.provider_route_id;
  SELECT price.* INTO v_price
  FROM public.aido_provider_prices price WHERE price.id = v_route.provider_price_id;
  PERFORM aido_private.finalize_provider_budget(
    v_reservation.feature_key,
    v_price.provider,
    v_price.model,
    (v_reservation.created_at AT TIME ZONE 'UTC')::date,
    v_reservation.provider_budget_microusd,
    v_usage_cost
  );

  RETURN QUERY SELECT
    v_reservation.id,
    v_release_ledger_id,
    v_reservation.released_credits,
    v_wallet.available_credits,
    v_wallet.reserved_credits,
    v_reservation.actual_provider_cost_microusd,
    v_reservation.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.aido_release_reservation(
  p_reservation_id uuid,
  p_terminal_status public.aido_usage_reservation_status,
  p_failure_category text,
  p_idempotency_key text
)
RETURNS TABLE (
  reservation_id uuid,
  release_ledger_entry_id bigint,
  released_credits bigint,
  available_credits bigint,
  reserved_credits bigint,
  actual_provider_cost_microusd bigint,
  status public.aido_usage_reservation_status
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM aido_private.release_reservation(
    p_reservation_id, p_terminal_status, p_failure_category, p_idempotency_key
  );
$$;

CREATE OR REPLACE FUNCTION public.aido_expire_reservation(
  p_reservation_id uuid,
  p_idempotency_key text
)
RETURNS TABLE (
  reservation_id uuid,
  release_ledger_entry_id bigint,
  released_credits bigint,
  available_credits bigint,
  reserved_credits bigint,
  actual_provider_cost_microusd bigint,
  status public.aido_usage_reservation_status
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.aido_usage_reservations reservation
    WHERE reservation.id = p_reservation_id
      AND reservation.expires_at <= now()
  ) THEN
    RAISE EXCEPTION 'Reservation is not due for expiry' USING ERRCODE = '55000';
  END IF;

  RETURN QUERY SELECT * FROM aido_private.release_reservation(
    p_reservation_id,
    'expired'::public.aido_usage_reservation_status,
    'reservation_expired',
    p_idempotency_key
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- Credit-lot expiry and compensating reversals
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aido_private.expire_credit_lot(
  p_credit_lot_id uuid,
  p_idempotency_key text
)
RETURNS TABLE (
  credit_lot_id uuid,
  expired_credits bigint,
  ledger_entry_id bigint,
  available_credits bigint,
  reserved_credits bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_lot public.aido_credit_lots%ROWTYPE;
  v_wallet public.aido_credit_wallets%ROWTYPE;
  v_existing public.aido_credit_ledger%ROWTYPE;
  v_ledger_id bigint;
  v_expired bigint;
BEGIN
  IF char_length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'Invalid expiry idempotency key' USING ERRCODE = '22023';
  END IF;

  SELECT lot.* INTO v_lot
  FROM public.aido_credit_lots lot
  WHERE lot.id = p_credit_lot_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit lot not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT wallet.* INTO v_wallet
  FROM public.aido_credit_wallets wallet
  WHERE wallet.user_id = v_lot.user_id
  FOR UPDATE;
  SELECT lot.* INTO v_lot
  FROM public.aido_credit_lots lot
  WHERE lot.id = p_credit_lot_id
  FOR UPDATE;

  SELECT ledger.* INTO v_existing
  FROM public.aido_credit_ledger ledger
  WHERE ledger.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.credit_lot_id <> p_credit_lot_id OR v_existing.entry_type <> 'expiry' THEN
      RAISE EXCEPTION 'Expiry key reused for another operation' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT
      p_credit_lot_id,
      -v_existing.available_delta,
      v_existing.id,
      v_existing.available_balance_after,
      v_existing.reserved_balance_after;
    RETURN;
  END IF;

  IF v_lot.status IN ('expired', 'depleted', 'reversed') THEN
    RAISE EXCEPTION 'Credit lot is already terminal' USING ERRCODE = '55000';
  END IF;
  IF v_lot.expires_at IS NULL OR v_lot.expires_at > now() THEN
    RAISE EXCEPTION 'Credit lot is not due for expiry' USING ERRCODE = '55000';
  END IF;
  IF v_lot.reserved_credits > 0 THEN
    RAISE EXCEPTION 'Release or expire active reservations before expiring this lot'
      USING ERRCODE = '55000';
  END IF;

  v_expired := v_lot.remaining_credits;
  IF v_expired <= 0 OR v_wallet.available_credits < v_expired THEN
    RAISE EXCEPTION 'Wallet and lot require reconciliation' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.aido_credit_lots AS lot
  SET remaining_credits = 0,
      reserved_credits = 0,
      status = 'expired'
  WHERE lot.id = p_credit_lot_id;

  UPDATE public.aido_credit_wallets AS wallet
  SET available_credits = wallet.available_credits - v_expired,
      version = wallet.version + 1
  WHERE wallet.user_id = v_lot.user_id
  RETURNING * INTO v_wallet;

  INSERT INTO public.aido_credit_ledger (
    user_id,
    entry_type,
    credit_lot_id,
    available_delta,
    available_balance_after,
    reserved_balance_after,
    unrecovered_balance_after,
    idempotency_key,
    metadata
  ) VALUES (
    v_lot.user_id,
    'expiry',
    p_credit_lot_id,
    -v_expired,
    v_wallet.available_credits,
    v_wallet.reserved_credits,
    v_wallet.unrecovered_credits,
    p_idempotency_key,
    jsonb_build_object('expired_credits', v_expired, 'expires_at', v_lot.expires_at)
  )
  RETURNING id INTO v_ledger_id;

  RETURN QUERY SELECT
    p_credit_lot_id,
    v_expired,
    v_ledger_id,
    v_wallet.available_credits,
    v_wallet.reserved_credits;
END;
$$;

CREATE OR REPLACE FUNCTION public.aido_expire_credit_lot(
  p_credit_lot_id uuid,
  p_idempotency_key text
)
RETURNS TABLE (
  credit_lot_id uuid,
  expired_credits bigint,
  ledger_entry_id bigint,
  available_credits bigint,
  reserved_credits bigint
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM aido_private.expire_credit_lot(p_credit_lot_id, p_idempotency_key);
$$;

CREATE OR REPLACE FUNCTION aido_private.reverse_credits(
  p_user_id uuid,
  p_credit_lot_id uuid,
  p_payment_event_id uuid,
  p_reversal_type public.aido_credit_reversal_type,
  p_requested_credits bigint,
  p_idempotency_key text
)
RETURNS TABLE (
  reversal_id uuid,
  ledger_entry_id bigint,
  requested_credits bigint,
  recovered_credits bigint,
  unrecovered_credits bigint,
  wallet_status public.aido_wallet_status,
  available_credits bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_wallet public.aido_credit_wallets%ROWTYPE;
  v_lot public.aido_credit_lots%ROWTYPE;
  v_payment public.aido_payment_events%ROWTYPE;
  v_existing public.aido_credit_reversals%ROWTYPE;
  v_prior_requested bigint;
  v_recoverable bigint;
  v_recovered bigint;
  v_unrecovered bigint;
  v_ledger_id bigint;
  v_reversal_id uuid;
  v_entry_type public.aido_ledger_entry_type;
BEGIN
  IF p_requested_credits <= 0 OR char_length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 190 THEN
    RAISE EXCEPTION 'Invalid credit reversal' USING ERRCODE = '22023';
  END IF;

  SELECT reversal.* INTO v_existing
  FROM public.aido_credit_reversals reversal
  WHERE reversal.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.user_id <> p_user_id
       OR v_existing.credit_lot_id <> p_credit_lot_id
       OR v_existing.payment_event_id IS DISTINCT FROM p_payment_event_id
       OR v_existing.requested_credits <> p_requested_credits
       OR v_existing.reversal_type <> p_reversal_type THEN
      RAISE EXCEPTION 'Reversal key reused with different parameters' USING ERRCODE = '23505';
    END IF;
    SELECT wallet.* INTO v_wallet
    FROM public.aido_credit_wallets wallet WHERE wallet.user_id = p_user_id;
    RETURN QUERY SELECT
      v_existing.id,
      v_existing.ledger_entry_id,
      v_existing.requested_credits,
      v_existing.recovered_credits,
      v_existing.unrecovered_credits,
      v_wallet.status,
      v_wallet.available_credits;
    RETURN;
  END IF;

  SELECT wallet.* INTO v_wallet
  FROM public.aido_credit_wallets wallet
  WHERE wallet.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT lot.* INTO v_lot
  FROM public.aido_credit_lots lot
  WHERE lot.id = p_credit_lot_id
  FOR UPDATE;
  IF NOT FOUND OR v_lot.user_id <> p_user_id THEN
    RAISE EXCEPTION 'Credit lot not found for user' USING ERRCODE = 'P0002';
  END IF;

  IF p_payment_event_id IS NOT NULL THEN
    SELECT payment.* INTO v_payment
    FROM public.aido_payment_events payment
    WHERE payment.id = p_payment_event_id
    FOR UPDATE;
    IF NOT FOUND
       OR v_payment.user_id IS DISTINCT FROM p_user_id
       OR v_payment.status NOT IN ('received', 'processed')
       OR v_payment.event_kind NOT IN ('refund', 'dispute') THEN
      RAISE EXCEPTION 'Payment reversal event does not match lot' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT COALESCE(sum(reversal.requested_credits), 0)
  INTO v_prior_requested
  FROM public.aido_credit_reversals reversal
  WHERE reversal.credit_lot_id = p_credit_lot_id;
  IF v_prior_requested + p_requested_credits > v_lot.granted_credits THEN
    RAISE EXCEPTION 'Reversal exceeds original credit grant' USING ERRCODE = '22023';
  END IF;

  v_recoverable := GREATEST(v_lot.remaining_credits - v_lot.reserved_credits, 0);
  v_recovered := LEAST(p_requested_credits, v_recoverable, v_wallet.available_credits);
  v_unrecovered := p_requested_credits - v_recovered;

  UPDATE public.aido_credit_lots AS lot
  SET remaining_credits = lot.remaining_credits - v_recovered,
      status = CASE
        WHEN lot.remaining_credits - v_recovered = 0 AND lot.reserved_credits = 0
          THEN 'reversed'::public.aido_credit_lot_status
        ELSE 'active'::public.aido_credit_lot_status
      END
  WHERE lot.id = p_credit_lot_id;

  UPDATE public.aido_credit_wallets AS wallet
  SET available_credits = wallet.available_credits - v_recovered,
      unrecovered_credits = wallet.unrecovered_credits + v_unrecovered,
      status = CASE WHEN v_unrecovered > 0 THEN 'frozen'::public.aido_wallet_status ELSE wallet.status END,
      version = wallet.version + 1
  WHERE wallet.user_id = p_user_id
  RETURNING * INTO v_wallet;

  v_entry_type := CASE
    WHEN p_reversal_type = 'refund' THEN 'refund'::public.aido_ledger_entry_type
    ELSE 'reversal'::public.aido_ledger_entry_type
  END;

  INSERT INTO public.aido_credit_ledger (
    user_id,
    entry_type,
    credit_lot_id,
    payment_event_id,
    available_delta,
    unrecovered_delta,
    available_balance_after,
    reserved_balance_after,
    unrecovered_balance_after,
    idempotency_key,
    metadata
  ) VALUES (
    p_user_id,
    v_entry_type,
    p_credit_lot_id,
    p_payment_event_id,
    -v_recovered,
    v_unrecovered,
    v_wallet.available_credits,
    v_wallet.reserved_credits,
    v_wallet.unrecovered_credits,
    p_idempotency_key || ':ledger',
    jsonb_build_object(
      'reversal_type', p_reversal_type::text,
      'requested_credits', p_requested_credits,
      'recovered_credits', v_recovered,
      'unrecovered_credits', v_unrecovered
    )
  )
  RETURNING id INTO v_ledger_id;

  INSERT INTO public.aido_credit_reversals (
    user_id,
    credit_lot_id,
    payment_event_id,
    ledger_entry_id,
    reversal_type,
    requested_credits,
    recovered_credits,
    unrecovered_credits,
    idempotency_key
  ) VALUES (
    p_user_id,
    p_credit_lot_id,
    p_payment_event_id,
    v_ledger_id,
    p_reversal_type,
    p_requested_credits,
    v_recovered,
    v_unrecovered,
    p_idempotency_key
  )
  RETURNING id INTO v_reversal_id;

  IF p_payment_event_id IS NOT NULL AND v_payment.status = 'received' THEN
    UPDATE public.aido_payment_events
    SET status = 'processed', processed_at = now()
    WHERE id = p_payment_event_id;
  END IF;

  RETURN QUERY SELECT
    v_reversal_id,
    v_ledger_id,
    p_requested_credits,
    v_recovered,
    v_unrecovered,
    v_wallet.status,
    v_wallet.available_credits;
END;
$$;

CREATE OR REPLACE FUNCTION public.aido_reverse_credits(
  p_user_id uuid,
  p_credit_lot_id uuid,
  p_payment_event_id uuid,
  p_reversal_type public.aido_credit_reversal_type,
  p_requested_credits bigint,
  p_idempotency_key text
)
RETURNS TABLE (
  reversal_id uuid,
  ledger_entry_id bigint,
  requested_credits bigint,
  recovered_credits bigint,
  unrecovered_credits bigint,
  wallet_status public.aido_wallet_status,
  available_credits bigint
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM aido_private.reverse_credits(
    p_user_id,
    p_credit_lot_id,
    p_payment_event_id,
    p_reversal_type,
    p_requested_credits,
    p_idempotency_key
  );
$$;

-- ----------------------------------------------------------------------------
-- Signature verification occurs in server code against the raw Stripe body.
-- These functions accept only the already-verified event facts and atomically
-- journal the event plus its single financial effect.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aido_private.process_verified_purchase_event(
  p_stripe_event_id text,
  p_stripe_event_type text,
  p_event_kind public.aido_payment_event_kind,
  p_livemode boolean,
  p_stripe_object_id text,
  p_stripe_customer_id text,
  p_stripe_price_id text,
  p_currency text,
  p_amount_gross_sen bigint,
  p_amount_net_sen bigint,
  p_payload_sha256 text
)
RETURNS TABLE (
  payment_event_id uuid,
  credit_lot_id uuid,
  ledger_entry_id bigint,
  user_id uuid,
  granted_credits bigint,
  available_credits bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_customer public.aido_payment_customers%ROWTYPE;
  v_product public.aido_credit_products%ROWTYPE;
  v_config public.aido_billing_config_versions%ROWTYPE;
  v_event public.aido_payment_events%ROWTYPE;
  v_lot public.aido_credit_lots%ROWTYPE;
  v_grant record;
  v_source public.aido_credit_lot_source;
  v_expires_at timestamptz;
  v_inserted boolean := false;
BEGIN
  IF p_event_kind NOT IN ('purchase', 'renewal')
     OR p_currency <> 'MYR'
     OR p_amount_gross_sen <= 0
     OR p_amount_net_sen <= 0
     OR p_amount_net_sen > p_amount_gross_sen
     OR p_payload_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid verified purchase event values' USING ERRCODE = '22023';
  END IF;

  SELECT customer.* INTO v_customer
  FROM public.aido_payment_customers customer
  WHERE customer.stripe_customer_id = p_stripe_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stripe customer is not mapped to an Aido user' USING ERRCODE = 'P0002';
  END IF;

  SELECT product.* INTO v_product
  FROM public.aido_credit_products product
  WHERE product.stripe_price_id = p_stripe_price_id
    AND product.effective_from <= now()
    AND (product.effective_to IS NULL OR product.effective_to > now());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stripe price is not an effective Aido credit product' USING ERRCODE = 'P0002';
  END IF;
  IF v_product.amount_sen <> p_amount_gross_sen OR v_product.currency <> p_currency THEN
    RAISE EXCEPTION 'Stripe amount or currency does not match the credit product' USING ERRCODE = '22023';
  END IF;

  IF v_product.kind = 'topup' THEN
    SELECT config.* INTO v_config
    FROM public.aido_billing_config_versions config
    WHERE config.effective_from <= now()
      AND (config.effective_to IS NULL OR config.effective_to > now())
    ORDER BY config.effective_from DESC
    LIMIT 1;
    IF NOT FOUND OR p_amount_gross_sen < v_config.minimum_topup_sen THEN
      RAISE EXCEPTION 'Top-up is below the configured minimum' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.aido_payment_events (
    stripe_event_id,
    stripe_event_type,
    event_kind,
    livemode,
    stripe_object_id,
    related_payment_event_id,
    user_id,
    credit_product_id,
    currency,
    amount_gross_sen,
    amount_net_sen,
    credits_affected,
    payload_sha256
  ) VALUES (
    p_stripe_event_id,
    p_stripe_event_type,
    p_event_kind,
    p_livemode,
    p_stripe_object_id,
    NULL,
    v_customer.user_id,
    v_product.id,
    p_currency,
    p_amount_gross_sen,
    p_amount_net_sen,
    v_product.credit_grant,
    p_payload_sha256
  )
  ON CONFLICT (stripe_event_id) DO NOTHING
  RETURNING * INTO v_event;
  v_inserted := FOUND;

  IF NOT v_inserted THEN
    SELECT payment.* INTO v_event
    FROM public.aido_payment_events payment
    WHERE payment.stripe_event_id = p_stripe_event_id
    FOR UPDATE;

    IF v_event.payload_sha256 <> p_payload_sha256
       OR v_event.stripe_event_type <> p_stripe_event_type
       OR v_event.event_kind <> p_event_kind
       OR v_event.livemode <> p_livemode
       OR v_event.stripe_object_id <> p_stripe_object_id
       OR v_event.related_payment_event_id IS NOT NULL
       OR v_event.user_id IS DISTINCT FROM v_customer.user_id
       OR v_event.credit_product_id IS DISTINCT FROM v_product.id
       OR v_event.currency IS DISTINCT FROM p_currency
       OR v_event.amount_gross_sen IS DISTINCT FROM p_amount_gross_sen
       OR v_event.amount_net_sen IS DISTINCT FROM p_amount_net_sen
       OR v_event.credits_affected IS DISTINCT FROM v_product.credit_grant THEN
      RAISE EXCEPTION 'Stripe event ID reused with different payload facts' USING ERRCODE = '23505';
    END IF;

    SELECT lot.* INTO v_lot
    FROM public.aido_credit_lots lot
    WHERE lot.payment_event_id = v_event.id;
    IF FOUND THEN
      RETURN QUERY SELECT
        v_event.id,
        v_lot.id,
        ledger.id,
        v_customer.user_id,
        v_lot.granted_credits,
        ledger.available_balance_after
      FROM public.aido_credit_ledger ledger
      WHERE ledger.credit_lot_id = v_lot.id AND ledger.entry_type = 'grant';
      RETURN;
    END IF;
  END IF;

  v_source := v_product.kind::text::public.aido_credit_lot_source;
  v_expires_at := CASE
    WHEN v_product.expires_after_days IS NULL THEN NULL
    ELSE now() + make_interval(days => v_product.expires_after_days)
  END;

  SELECT * INTO v_grant
  FROM aido_private.grant_credits(
    v_customer.user_id,
    v_product.credit_grant,
    v_source,
    v_expires_at,
    'stripe:' || p_stripe_event_id || ':grant',
    v_event.id,
    v_product.id
  );

  RETURN QUERY SELECT
    v_event.id,
    v_grant.credit_lot_id,
    v_grant.ledger_entry_id,
    v_customer.user_id,
    v_product.credit_grant,
    v_grant.available_credits;
END;
$$;

CREATE OR REPLACE FUNCTION public.aido_process_verified_purchase_event(
  p_stripe_event_id text,
  p_stripe_event_type text,
  p_event_kind public.aido_payment_event_kind,
  p_livemode boolean,
  p_stripe_object_id text,
  p_stripe_customer_id text,
  p_stripe_price_id text,
  p_currency text,
  p_amount_gross_sen bigint,
  p_amount_net_sen bigint,
  p_payload_sha256 text
)
RETURNS TABLE (
  payment_event_id uuid,
  credit_lot_id uuid,
  ledger_entry_id bigint,
  user_id uuid,
  granted_credits bigint,
  available_credits bigint
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM aido_private.process_verified_purchase_event(
    p_stripe_event_id,
    p_stripe_event_type,
    p_event_kind,
    p_livemode,
    p_stripe_object_id,
    p_stripe_customer_id,
    p_stripe_price_id,
    p_currency,
    p_amount_gross_sen,
    p_amount_net_sen,
    p_payload_sha256
  );
$$;

CREATE OR REPLACE FUNCTION aido_private.process_verified_reversal_event(
  p_stripe_event_id text,
  p_stripe_event_type text,
  p_livemode boolean,
  p_stripe_object_id text,
  p_original_stripe_object_id text,
  p_amount_sen bigint,
  p_payload_sha256 text,
  p_reversal_type public.aido_credit_reversal_type
)
RETURNS TABLE (
  payment_event_id uuid,
  reversal_id uuid,
  ledger_entry_id bigint,
  user_id uuid,
  requested_credits bigint,
  recovered_credits bigint,
  unrecovered_credits bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_original public.aido_payment_events%ROWTYPE;
  v_event public.aido_payment_events%ROWTYPE;
  v_lot public.aido_credit_lots%ROWTYPE;
  v_existing public.aido_credit_reversals%ROWTYPE;
  v_requested bigint;
  v_reversal record;
  v_kind public.aido_payment_event_kind;
  v_inserted boolean := false;
BEGIN
  IF p_amount_sen <= 0
     OR p_payload_sha256 !~ '^[0-9a-f]{64}$'
     OR p_reversal_type NOT IN ('refund', 'chargeback') THEN
    RAISE EXCEPTION 'Invalid verified reversal event values' USING ERRCODE = '22023';
  END IF;

  SELECT payment.* INTO v_original
  FROM public.aido_payment_events payment
  WHERE payment.stripe_object_id = p_original_stripe_object_id
    AND payment.event_kind IN ('purchase', 'renewal')
    AND payment.status = 'processed'
  ORDER BY payment.processed_at DESC
  LIMIT 1;
  IF NOT FOUND OR v_original.amount_gross_sen IS NULL OR p_amount_sen > v_original.amount_gross_sen THEN
    RAISE EXCEPTION 'Original processed purchase was not found or reversal amount is invalid'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT lot.* INTO v_lot
  FROM public.aido_credit_lots lot
  WHERE lot.payment_event_id = v_original.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original credit lot not found' USING ERRCODE = 'P0002';
  END IF;

  v_requested := ceil(
    v_lot.granted_credits::numeric * p_amount_sen::numeric
    / v_original.amount_gross_sen::numeric
  )::bigint;
  v_kind := CASE
    WHEN p_reversal_type = 'refund' THEN 'refund'::public.aido_payment_event_kind
    ELSE 'dispute'::public.aido_payment_event_kind
  END;

  INSERT INTO public.aido_payment_events (
    stripe_event_id,
    stripe_event_type,
    event_kind,
    livemode,
    stripe_object_id,
    related_payment_event_id,
    user_id,
    credit_product_id,
    currency,
    amount_gross_sen,
    amount_net_sen,
    credits_affected,
    payload_sha256
  ) VALUES (
    p_stripe_event_id,
    p_stripe_event_type,
    v_kind,
    p_livemode,
    p_stripe_object_id,
    v_original.id,
    v_original.user_id,
    v_original.credit_product_id,
    v_original.currency,
    p_amount_sen,
    p_amount_sen,
    v_requested,
    p_payload_sha256
  )
  ON CONFLICT (stripe_event_id) DO NOTHING
  RETURNING * INTO v_event;
  v_inserted := FOUND;

  IF NOT v_inserted THEN
    SELECT payment.* INTO v_event
    FROM public.aido_payment_events payment
    WHERE payment.stripe_event_id = p_stripe_event_id
    FOR UPDATE;

    IF v_event.payload_sha256 <> p_payload_sha256
       OR v_event.stripe_event_type <> p_stripe_event_type
       OR v_event.event_kind <> v_kind
       OR v_event.livemode <> p_livemode
       OR v_event.stripe_object_id <> p_stripe_object_id
       OR v_event.related_payment_event_id IS DISTINCT FROM v_original.id
       OR v_event.user_id IS DISTINCT FROM v_original.user_id
       OR v_event.credit_product_id IS DISTINCT FROM v_original.credit_product_id
       OR v_event.currency IS DISTINCT FROM v_original.currency
       OR v_event.amount_gross_sen IS DISTINCT FROM p_amount_sen
       OR v_event.amount_net_sen IS DISTINCT FROM p_amount_sen
       OR v_event.credits_affected IS DISTINCT FROM v_requested THEN
      RAISE EXCEPTION 'Stripe event ID reused with different reversal facts' USING ERRCODE = '23505';
    END IF;

    SELECT reversal.* INTO v_existing
    FROM public.aido_credit_reversals reversal
    WHERE reversal.payment_event_id = v_event.id;
    IF FOUND THEN
      RETURN QUERY SELECT
        v_event.id,
        v_existing.id,
        v_existing.ledger_entry_id,
        v_existing.user_id,
        v_existing.requested_credits,
        v_existing.recovered_credits,
        v_existing.unrecovered_credits;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_reversal
  FROM aido_private.reverse_credits(
    v_original.user_id,
    v_lot.id,
    v_event.id,
    p_reversal_type,
    v_requested,
    'stripe:' || p_stripe_event_id || ':reversal'
  );

  RETURN QUERY SELECT
    v_event.id,
    v_reversal.reversal_id,
    v_reversal.ledger_entry_id,
    v_original.user_id,
    v_reversal.requested_credits,
    v_reversal.recovered_credits,
    v_reversal.unrecovered_credits;
END;
$$;

CREATE OR REPLACE FUNCTION public.aido_process_verified_reversal_event(
  p_stripe_event_id text,
  p_stripe_event_type text,
  p_livemode boolean,
  p_stripe_object_id text,
  p_original_stripe_object_id text,
  p_amount_sen bigint,
  p_payload_sha256 text,
  p_reversal_type public.aido_credit_reversal_type
)
RETURNS TABLE (
  payment_event_id uuid,
  reversal_id uuid,
  ledger_entry_id bigint,
  user_id uuid,
  requested_credits bigint,
  recovered_credits bigint,
  unrecovered_credits bigint
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM aido_private.process_verified_reversal_event(
    p_stripe_event_id,
    p_stripe_event_type,
    p_livemode,
    p_stripe_object_id,
    p_original_stripe_object_id,
    p_amount_sen,
    p_payload_sha256,
    p_reversal_type
  );
$$;

-- ----------------------------------------------------------------------------
-- Reconciliation. A trusted scheduled worker can call this read-only function
-- and alert on every returned row; zero rows is the healthy state.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aido_private.find_reconciliation_issues()
RETURNS TABLE (category text, entity_id text, details jsonb)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH lot_totals AS (
    SELECT
      wallet.user_id,
      wallet.available_credits,
      wallet.reserved_credits,
      COALESCE(sum(lot.remaining_credits - lot.reserved_credits), 0)::bigint AS lot_available,
      COALESCE(sum(lot.reserved_credits), 0)::bigint AS lot_reserved
    FROM public.aido_credit_wallets wallet
    LEFT JOIN public.aido_credit_lots lot ON lot.user_id = wallet.user_id
    GROUP BY wallet.user_id, wallet.available_credits, wallet.reserved_credits
  ), latest_ledger AS (
    SELECT DISTINCT ON (ledger.user_id)
      ledger.user_id,
      ledger.available_balance_after,
      ledger.reserved_balance_after,
      ledger.unrecovered_balance_after
    FROM public.aido_credit_ledger ledger
    ORDER BY ledger.user_id, ledger.id DESC
  ), usage_totals AS (
    SELECT
      reservation.id,
      reservation.status,
      reservation.actual_provider_cost_microusd,
      reservation.captured_credits,
      COALESCE(sum(event.provider_cost_microusd), 0)::bigint AS usage_cost,
      count(event.id)::bigint AS usage_count
    FROM public.aido_usage_reservations reservation
    LEFT JOIN public.aido_usage_events event ON event.reservation_id = reservation.id
    GROUP BY reservation.id
  )
  SELECT
    'wallet_lot_projection', totals.user_id::text,
    jsonb_build_object(
      'wallet_available', totals.available_credits,
      'lot_available', totals.lot_available,
      'wallet_reserved', totals.reserved_credits,
      'lot_reserved', totals.lot_reserved
    )
  FROM lot_totals totals
  WHERE totals.available_credits <> totals.lot_available
     OR totals.reserved_credits <> totals.lot_reserved
  UNION ALL
  SELECT
    'wallet_ledger_projection', wallet.user_id::text,
    jsonb_build_object(
      'wallet_available', wallet.available_credits,
      'ledger_available', latest.available_balance_after,
      'wallet_reserved', wallet.reserved_credits,
      'ledger_reserved', latest.reserved_balance_after,
      'wallet_unrecovered', wallet.unrecovered_credits,
      'ledger_unrecovered', latest.unrecovered_balance_after
    )
  FROM public.aido_credit_wallets wallet
  LEFT JOIN latest_ledger latest ON latest.user_id = wallet.user_id
  WHERE latest.user_id IS NULL
     OR wallet.available_credits <> latest.available_balance_after
     OR wallet.reserved_credits <> latest.reserved_balance_after
     OR wallet.unrecovered_credits <> latest.unrecovered_balance_after
  UNION ALL
  SELECT
    'reservation_usage_projection', usage.id::text,
    jsonb_build_object(
      'reservation_cost', usage.actual_provider_cost_microusd,
      'usage_cost', usage.usage_cost,
      'status', usage.status,
      'captured_credits', usage.captured_credits,
      'usage_count', usage.usage_count
    )
  FROM usage_totals usage
  WHERE usage.actual_provider_cost_microusd <> usage.usage_cost
     OR (usage.status = 'settled' AND usage.captured_credits > 0 AND usage.usage_count = 0)
  UNION ALL
  SELECT
    'payment_effect_missing', payment.id::text,
    jsonb_build_object('event_kind', payment.event_kind, 'stripe_event_id', payment.stripe_event_id)
  FROM public.aido_payment_events payment
  WHERE payment.status = 'processed'
    AND (
      (payment.event_kind IN ('purchase', 'renewal') AND NOT EXISTS (
        SELECT 1 FROM public.aido_credit_lots lot WHERE lot.payment_event_id = payment.id
      ))
      OR (payment.event_kind IN ('refund', 'dispute') AND NOT EXISTS (
        SELECT 1 FROM public.aido_credit_reversals reversal WHERE reversal.payment_event_id = payment.id
      ))
    );
$$;

CREATE OR REPLACE FUNCTION public.aido_reconciliation_issues()
RETURNS TABLE (category text, entity_id text, details jsonb)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM aido_private.find_reconciliation_issues();
$$;

-- ----------------------------------------------------------------------------
-- Function privileges
-- ----------------------------------------------------------------------------
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA aido_private
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA aido_private TO service_role;

REVOKE ALL ON FUNCTION public.aido_reserve_credits(
  uuid, uuid, text, uuid, uuid, text, text, bigint, bigint, bigint, timestamptz
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aido_mark_reservation_running(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aido_authorize_provider_call(
  uuid, text, smallint, bigint, bigint, bigint, integer, integer, integer, timestamptz
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aido_record_usage_event(
  uuid, text, text, text, bigint, bigint, bigint, integer, integer, integer,
  integer, bigint, public.aido_usage_outcome, boolean, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aido_settle_reservation(uuid, bigint, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aido_release_reservation(
  uuid, public.aido_usage_reservation_status, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aido_expire_reservation(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aido_expire_credit_lot(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aido_reverse_credits(
  uuid, uuid, uuid, public.aido_credit_reversal_type, bigint, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aido_process_verified_purchase_event(
  text, text, public.aido_payment_event_kind, boolean, text, text, text, text,
  bigint, bigint, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aido_process_verified_reversal_event(
  text, text, boolean, text, text, bigint, text, public.aido_credit_reversal_type
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aido_reconciliation_issues()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.aido_reserve_credits(
  uuid, uuid, text, uuid, uuid, text, text, bigint, bigint, bigint, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.aido_mark_reservation_running(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.aido_authorize_provider_call(
  uuid, text, smallint, bigint, bigint, bigint, integer, integer, integer, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.aido_record_usage_event(
  uuid, text, text, text, bigint, bigint, bigint, integer, integer, integer,
  integer, bigint, public.aido_usage_outcome, boolean, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.aido_settle_reservation(uuid, bigint, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.aido_release_reservation(
  uuid, public.aido_usage_reservation_status, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.aido_expire_reservation(uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.aido_expire_credit_lot(uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.aido_reverse_credits(
  uuid, uuid, uuid, public.aido_credit_reversal_type, bigint, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.aido_process_verified_purchase_event(
  text, text, public.aido_payment_event_kind, boolean, text, text, text, text,
  bigint, bigint, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.aido_process_verified_reversal_event(
  text, text, boolean, text, text, bigint, text, public.aido_credit_reversal_type
) TO service_role;
GRANT EXECUTE ON FUNCTION public.aido_reconciliation_issues()
  TO service_role;

NOTIFY pgrst, 'reload schema';
