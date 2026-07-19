# Shared TutorPakar / AidoFor.me authentication setup

This document explains how AidoFor.me re-uses the TutorPakar Supabase
project so the same email and password works on both products, while
keeping each product's data, roles, and permissions fully separate.

## Architecture in one paragraph

Both products point at the **same Supabase project**. `auth.users` is
shared, so a single email+password identity lives in one place. Each
product owns its own data tables in the `public` schema:

| Surface | Owner | Where it lives |
|---|---|---|
| `auth.users` | Supabase Auth | shared, read+write through the anon key only |
| `public.profiles`, `public.enrollments`, `public.admin_users`, `public.payments`, `public.courses`, `public.instructor_*`, `public.classroom_*` | **TutorPakar** | TutorPakar migrations only |
| `public.aido_product_memberships` | **AidoForMe** | this repo's migrations only |

TutorPakar's existing `handle_new_user()` trigger still creates a
`public.profiles` row on every signup. That is harmless: AidoForMe
never reads `public.profiles` and the trigger does **not** create any
enrollment, instructor record, or admin grant.

AidoForMe creates its own `aido_product_memberships` row lazily from a
server action on signup and on first login, never via a second
`AFTER INSERT ON auth.users` trigger. This avoids any failure-mode
coupling with TutorPakar's trigger.

## Session and cookie behaviour

- The two domains are unrelated root domains, so cookies are
  **host-only** on `aidofor.me` and `tutorpakar.com`. Signing in to
  one does **not** sign the other in. Each browser keeps its own
  session.
- AidoForMe's `proxy.ts` (Next.js 16 convention) refreshes the
  session cookie on every matched request using the official
  `@supabase/ssr` `getAll` / `setAll` pattern.
- `signOut` uses `scope: 'local'` per the current Supabase Auth docs,
  so AidoForMe logout only ends the current browser session — other
  TutorPakar devices, mobile sessions, or other browsers stay signed
  in. A future "sign out everywhere" control would be a separate,
  labelled action that calls `signOut({ scope: 'global' })`.

## Code map (where things live in this repo)

| File | Responsibility |
|---|---|
| `lib/supabase/client.ts` | Browser client (`createBrowserClient`). Recreated per call. |
| `lib/supabase/server.ts` | Per-request server client (`createServerClient` with async `cookies()`). |
| `lib/supabase/types.ts` | Hand-written types for the `aido_*` tables. Replace via `supabase gen types typescript --linked` once the project is linked. |
| `lib/auth/actions.ts` | All auth server actions: `loginAction`, `signupAction`, `requestRecoveryAction`, `resetPasswordAction`, `signOutAction`, `requireAuthOrRedirect`. |
| `lib/auth/safe-redirect.ts` | Open-redirect guard used by every action. |
| `lib/auth/error-messages.ts` | Maps Supabase error strings to user-safe copy. Never echoes the raw SDK message. |
| `proxy.ts` | Route gate for `/app/*` + auth surfaces. Refreshes the session cookie. |
| `app/auth/callback/route.ts` | Exchanges the PKCE `code` for a session. |
| `app/login/page.tsx`, `app/signup/page.tsx`, `app/forgot-password/page.tsx`, `app/reset-password/page.tsx` | Auth screens. |
| `app/app/layout.tsx` | Server-side `requireAuthOrRedirect` defense in depth. |
| `supabase/migrations/20260719000000_aido_product_memberships.sql` | AidoForMe-scoped table + RLS only. |
| `.env.example` | Names of env vars only. No real values. |

## Environment variables

Set these on every AidoForMe environment (Vercel preview, Vercel
production, local dev):

| Name | Required? | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Same value as TutorPakar. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | recommended | New `sb_publishable_…` key if Supabase has issued one for this project. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | fallback | Legacy JWT anon key. Read only when the publishable key is unset. |
| `NEXT_PUBLIC_SITE_URL` | yes | `https://aidofor.me` in production. |

**Never** add a `NEXT_PUBLIC_*` service-role key. The browser would
ship it to every visitor. Service-role operations (if ever needed)
must run in a server-only context with a non-public env var.

## Manual Supabase Dashboard checklist (user must complete)

1. **Authentication → URL Configuration → Site URL**
   - Leave this **as-is** (currently set for TutorPakar). Changing it
     breaks TutorPakar email links.

2. **Authentication → URL Configuration → Additional Redirect URLs** —
   add every line that applies to your environment:

   ```
   https://aidofor.me/auth/callback
   https://aidofor.me/reset-password
   https://aidofor.me/login
   https://aidofor.me/signup
   https://aidofor.me/app
   http://localhost:3000/auth/callback
   http://localhost:3000/reset-password
   http://localhost:3000/login
   http://localhost:3000/signup
   http://localhost:3000/app
   https://*-aidoforme.vercel.app/auth/callback
   https://*-aidoforme.vercel.app/reset-password
   https://*-aidoforme.vercel.app/login
   https://*-aidoforme.vercel.app/signup
   https://*-aidoforme.vercel.app/app
   ```

   The exact Vercel preview pattern depends on the production branch
   name; replace `*-aidoforme` with the actual pattern shown in
   Vercel's preview URL field.

3. **Authentication → Email Templates** — for each template that
   currently uses `{{ .SiteURL }}` (`Confirm signup`, `Magic link`,
   `Change email`, `Reset password`), change the action URL to:

   ```
   {{ .RedirectTo }}
   ```

   `{{ .RedirectTo }}` is populated from the `emailRedirectTo` we pass
   in the server actions. Without this, recovery links will return
   users to the TutorPakar domain even when they request a reset from
   AidoFor.me.

4. **Authentication → Sign In / Up → Email** — keep
   "Confirm email" **enabled** so signups always verify their email
   before they can sign in. This blocks random password guessing on
   arbitrary addresses.

5. **Authentication → Sign In / Up → Rate limits** — confirm the
   defaults are in place: `sign_in_sign_ups = 30` per 5 minutes per
   IP. Increase only after observing real abuse in production.

## Apply status

The AidoForMe-scoped migration
`supabase/migrations/20260719000000_aido_product_memberships.sql` has
been applied to project `gmqlmqdqpytgjxolgrwq` (TutorPakar's Website).
`supabase_migrations.schema_migrations` records `20260719000000
aido_product_memberships`. AidoForMe RLS lints clean on the new table;
the live project's pre-existing TutorPakar lints on `profiles` /
`enrollments` are unchanged and out of scope for this slice.

`supabase/config.toml` was pushed via `supabase config push` and the
remote reports `auth: up_to_date, storage: up_to_date, api: up_to_date`.
This file is now the source of truth for future migrations applied
from this repo.

## Vercel setup (per environment)

For every Vercel environment (production + each preview):

- `NEXT_PUBLIC_SUPABASE_URL` = the TutorPakar production URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = (preferred) or
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (legacy)
- `NEXT_PUBLIC_SITE_URL` = `https://aidofor.me` for production,
  `http://localhost:3000` for local, or the `*.vercel.app` URL for
  previews.

## Verifying the slice locally

1. Copy `.env.example` to `.env.local` and fill the Supabase values
   from the TutorPakar project.
2. `pnpm install`
3. `pnpm dev`
4. Visit `http://localhost:3000/login` and sign in with a known
   TutorPakar account. You should land on `/app`.
5. Visit `/app` while signed out — you should bounce to `/login?next=/app`.
6. Sign out — you should return to `/login`, but a parallel
   `tutorpakar.com` tab (if open) must stay signed in.
7. `pnpm lint && pnpm typecheck && pnpm build` — all three must pass.

## Security notes

- `getUser()` is the only authoritative server-side check. `getSession()`
  is never used for authorization in this repo.
- Open redirects: every `next` parameter passes through
  `lib/auth/safe-redirect.ts`. Only relative internal paths starting
  with a single `/` are accepted.
- Email enumeration: `/forgot-password` always returns the same
  neutral copy regardless of whether the email exists.
- Authorization: `aido_product_memberships` RLS restricts every row
  to `auth.uid() = user_id`. No policy relies on `user_metadata` or
  `raw_user_meta_data`.
- Service-role keys are never used by the auth slice. They are not
  required for login, signup, recovery, or logout.

## Open items still requiring user approval

1. Apply the SQL migration (paste into Supabase SQL editor, or run
   `supabase db push --linked` after linking the project).
2. Add the redirect URLs in the Supabase Dashboard (see checklist
   above).
3. Update each shared email template to use `{{ .RedirectTo }}`.
4. Set the env vars on Vercel.
5. Optional: add the new `aido_product_memberships` RLS policies to
   your Supabase security advisor review (Database → Security
   Advisor) to confirm no regressions.