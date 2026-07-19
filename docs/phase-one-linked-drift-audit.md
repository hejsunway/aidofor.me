# Phase 1 linked-production drift audit

> Audited: 2026-07-20  
> Project: shared TutorPakar production (`gmqlmqdqpytgjxolgrwq`)  
> Method: read-only catalog, policy, privilege, migration-history, and bucket-metadata queries  
> Production mutations: **none**

## Decision

The linked production environment is not at the reviewed Phase 1 release state.
Do not apply Phase 2 there and do not repair its migration history by assumption.
First prove all four Phase 1 migrations on isolated staging, then prepare a
separately reviewed production reconciliation plan.

## Observed drift

The deterministic report returned **3 passes and 10 failures out of 13 checks**.
The three passing surfaces were anonymous table isolation, the private assignment
bucket configuration, and the owner-scoped Storage policies.

| Surface | Reviewed Phase 1 state | Linked production on 2026-07-20 | Result |
|---|---|---|---|
| Migration history | Four Phase 1 versions recorded | Only `20260719000000` is recorded | Fail |
| Tables | Seven AidoForMe Phase 1 tables | Five base tables; `aido_project_policies` and `aido_project_deletion_audit` are absent | Fail |
| Document replacement | Three immutable replacement columns and replacement constraints/indexes | `replaces_document_id`, `replaced_by_document_id`, and `replaced_at` are absent | Fail |
| RPCs | Five client RPCs plus four internal/trigger functions | Replacement/deletion/document-limit functions are absent | Fail |
| RLS/policies | Owner policies on all seven tables plus three Storage policies | Base table and Storage policies exist; completion policies are absent with their tables | Fail |
| Table grants | Exact least-privilege grants | Authenticated inherits `TRUNCATE`, `TRIGGER`, and `REFERENCES` on live AidoForMe tables, plus unnecessary mutations on some append-only tables | **Critical fail** |
| Sequence grants | `USAGE` and `SELECT` only | The live activity identity sequence also exposes `UPDATE`; the completion sequence is absent with its table | Fail |
| Function grants | Internal functions unavailable to clients | `aido_set_updated_at()` is executable by `anon` and `authenticated` through existing defaults | Fail |
| Assignment bucket | Private; 25 MiB; PDF, DOC/DOCX, PNG/JPEG, and plain text only | Matches | Pass |
| Base enums/indexes/triggers | Match the base project migration | Match the base schema; completion objects are absent | Partial |
| Phase 2 schema | Must remain unreleased until the Phase 1 gate passes | No Phase 2 tables observed | Pass |

RLS cannot make `TRUNCATE` row-safe because `TRUNCATE` does not operate through
row policies. The additive migration
`20260719142000_aido_phase_one_privilege_hardening.sql` revokes all client-role
privileges on AidoForMe-owned Phase 1 objects and then grants only the required
table, sequence, and function operations. It intentionally leaves shared-project
default privileges unchanged so it does not alter TutorPakar's provisioning
behavior.

## Reproducible audit

Run [`scripts/audit-phase-one-schema.sql`](../scripts/audit-phase-one-schema.sql)
through a read-only SQL client or the Supabase SQL execution tool. It reads no
Auth user, project, assignment, or Storage-object rows. Every returned `pass`
value must be `true` on staging before Phase 2 staging work opens.

Relevant platform guidance:

- [Securing your API](https://supabase.com/docs/guides/api/securing-your-api)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Explicit Data API grants change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
