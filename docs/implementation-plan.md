# AidoFor.me Production Implementation Plan

> **Status:** Implementation planning baseline  
> **Date:** 2026-07-19  
> **Starting point:** Marketing site, Supabase authentication, protected workspace shell, preview-only project setup, and one Aido membership table  
> **Related:** [Main PRD](./aidofor-me-prd.md), [Assignment Autopilot](./assignment-autopilot.md), [Credit Usage and Margin Control](./credit-usage-and-margin-control.md)

## Delivery decision

AidoFor.me will be implemented as production-backed vertical slices. A feature is not complete merely because its interface renders. Each completed slice must save and retrieve real authorized data, call the approved real service where applicable, record usage and failures, enforce limits on the server, and pass its security and recovery checks.

Phase completion is evidence-based, not date-based. Later phases do not bypass an incomplete exit gate.

This document decomposes the PRD's higher-level roadmap into engineering delivery gates. If engineering sequence or phase numbering differs, this document controls implementation order while the PRD continues to control product scope and positioning.

## No-demo-data rule

The authenticated product must display only:

- real records owned by the signed-in user;
- honest empty states when no record exists;
- real processing, paused, completed, and failure states;
- real source metadata and evidence returned by configured providers;
- real credit balances, reservations, usage, and payment state.

It must not ship:

- seeded sample assignments, sources, evidence cards, balances, usage, or progress;
- hard-coded dashboard metrics or completed workflow steps;
- fake AI responses used as a successful fallback;
- generated placeholder citations or bibliographic metadata;
- a button that appears operational but only changes local component state;
- silent fallback from a failed provider to fabricated content.

Empty, unavailable, and failed are valid product states. Fake success is not.

Automated tests still require controlled fixtures. Those fixtures must exist only in an isolated local or CI database, be created by the test, and be removed after the run. They must never be seeded into developer, staging, or production user interfaces. Stripe test-mode transactions and developer-owned integration-test uploads are verification artifacts, not customer-facing demo data.

Static marketing illustrations may explain the intended workflow, but they must be clearly visual/educational and must not claim to be a live authenticated workspace or real research result.

## Environment and release model

| Environment | Purpose | Data rule |
|---|---|---|
| Local | Migration development, unit tests, RLS tests | Ephemeral test fixtures only |
| Staging | Full integration with real APIs and Stripe test mode | Developer-owned test accounts and files; no production copies |
| Production | Shared TutorPakar identity and real customers | Customer-created data only |

All database changes are developed locally, applied to staging, verified, and only then applied additively to the shared production Supabase project. Aido tables, buckets, queues, functions, and policies remain Aido-scoped and do not modify TutorPakar-owned tables or triggers.

The current repository uses imperative migrations. Create each migration through the Supabase CLI migration workflow, review the SQL, run database advisors, verify the migration list, regenerate types, and execute RLS tests before production application.

Supabase changed new public-schema table exposure in 2026, so Data API grants and RLS are treated as separate controls. Every exposed Aido table explicitly grants only required operations and enables ownership-aware RLS. [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security), [Data API exposure change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)

## Phase summary

| Phase | Production outcome | Indicative single-engineer duration |
|---|---|---:|
| 0 | Engineering, security, provider, and environment foundation | 1 week |
| 1 | Real projects, policy capture, and private uploads | 2 weeks |
| 2 | Credits, payments, provider gateway, and cost controls | 2–3 weeks |
| 3 | Real document ingestion and requirement confirmation | 2–3 weeks |
| 4 | Real scholarly discovery, source processing, and evidence | 3 weeks |
| 5 | Rubric outline, editor, citations, and provenance | 3 weeks |
| 6 | Human-in-the-loop Assignment Autopilot | 3–4 weeks |
| 7 | Verification, review center, and export | 2 weeks |
| 8 | Operational hardening and controlled production launch | 2 weeks |

Expected critical path: approximately 18–23 weeks for one experienced full-time engineer. A larger team may shorten calendar time, but the phase gates and real-service integration dependencies remain.

## Phase 0 — Production foundation

### Build

- Establish local, staging, and production environment configuration without committing secrets.
- Add CI gates for lint, TypeScript, production build, database tests, and integration tests.
- Add a product-data rule that forbids mock/demo/sample repositories under authenticated application code.
- Establish additive Aido migration conventions and generated Supabase types.
- Add structured server logging, correlation IDs, error monitoring, and secret redaction.
- Define server-only provider configuration for OpenAI, DeepSeek, MiniMax, scholarly APIs, Stripe, and email.
- Define provider adapters and a single provider gateway; authenticated feature code cannot call provider SDKs directly.
- Define job, provider usage, prompt version, and cost-reporting interfaces.
- Confirm retention, deletion, privacy, acceptable-use, refund, and academic-integrity policies before accepting student documents or payment.
- Remove or relabel authenticated preview-only behavior. An unfinished route shows an honest unavailable state instead of pretending to process data.

### Exit gate

- Local and staging environments build from a clean checkout.
- CI blocks type, lint, build, migration, and security-test failures.
- No secret is present in browser bundles, source control, or logs.
- No authenticated route imports a mock/demo data module.
- Provider calls can only be made through the metered gateway interface.
- The shared production database has not been used for migration experimentation.

## Phase 1 — Real projects and private assignment files

### Build

- Add `writing_projects`, `project_members`, `assignment_documents`, `project_policies`, and append-only activity records.
- Implement ownership-aware RLS for owner, unrelated authenticated user, and anonymous access.
- Create a private Aido assignment bucket with owner/project-scoped object paths.
- Enforce file-count, byte-size, MIME, magic-byte, and decompression limits.
- Replace `/app` hard-coded content with a query for the signed-in user's actual projects.
- Replace `/app/new` preview controls with validated server actions that create the project and upload selected files.
- Persist course, assignment type, deadline, word count, citation style, integrity mode, and exact policy text.
- Implement real project detail, delete, and retry-upload flows.
- Create activity events for project creation, policy confirmation, upload, replacement, and deletion.

Supabase Storage denies uploads without policies, and an upsert requires `SELECT` and `UPDATE` in addition to `INSERT`. Policies must be tested rather than inferred. [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)

### Exit gate

- A new user creates a project, uploads a real file, signs out, signs in, and sees the same persisted project and file metadata.
- A second authenticated user cannot read, list, change, download, or delete the first user's rows or objects.
- Failed uploads do not leave a misleading completed document record.
- Project deletion removes or schedules deletion of relational rows, storage objects, and derived artifacts.
- A user with no projects sees a genuine empty state, not a sample assignment.

## Phase 2 — Prepaid credits, payments, and provider gateway

This phase precedes chargeable AI work. No paid provider operation is exposed to students until reservation and cost capture work end to end.

### Build

- Add versioned provider-price and feature-rate-card tables.
- Add credit lots, wallet projection, append-only ledger, usage reservations, usage events, payment events, refunds, and reversals.
- Implement atomic reserve, settle, release, expire, refund, and chargeback operations.
- Implement idempotent Stripe webhook verification and credit grants.
- Add real balance, transaction history, subscription, and top-up interfaces.
- Enforce plan limits, minimum top-up, daily user caps, concurrent-job caps, and global provider kill switches.
- Implement the server-only provider gateway with hard token, tool, search, timeout, and cost ceilings.
- Capture provider-reported input, cached-input, output, tool, latency, request ID, and actual cost data.
- Add provider routing configuration so lower-cost models can be used only where approved by evaluations and privacy policy.
- Add reconciliation jobs for wallets, ledgers, Stripe events, reservations, usage, and provider invoices.

### Exit gate

- Two simultaneous requests cannot reserve the same credits.
- Duplicate webhook and job events have exactly one financial effect.
- Insufficient credit prevents the provider call.
- A failed job releases unused credits and records any provider expense as Aido loss.
- A successful job never captures more than the reserved maximum.
- Stripe test-mode purchase, refund, and dispute flows reconcile in staging.
- Direct browser attempts cannot grant credits, alter rates, choose an unapproved model, or mutate wallets.

## Phase 3 — Document ingestion and requirement confirmation

### Build

- Add durable background jobs and queue messages for document validation, parsing, OCR, chunking, and requirement extraction.
- Use Supabase Queues or an equivalent durable queue; do not keep long processing in the page request. Supabase Queues provides Postgres-native durable delivery and message visibility controls. [Supabase Queues](https://supabase.com/docs/guides/queues)
- Add malware scanning, content hashing, duplicate detection, parser routing, page/location anchors, and extraction-version tracking.
- Process real PDF, DOCX, image, and text inputs within documented limits.
- Store extracted text and chunks with project/source ownership.
- Extract assignment requirements through the metered provider gateway.
- Show every extracted requirement with its source document and page/location.
- Require the student to confirm or edit requirements and integrity mode before later phases unlock.
- Add retry, cancellation, worker crash recovery, and honest failed-document states.

### Exit gate

- A real brief and rubric produce a persisted, editable, source-anchored requirement matrix.
- Refreshing or closing the browser does not lose processing state.
- A duplicate upload reuses safe derived work where permitted and does not duplicate charges.
- Every AI call has a reservation, usage event, provider request trace, prompt version, and validation result.
- Extraction uncertainty is visible; the system never substitutes invented requirements.

## Phase 4 — Scholarly discovery, source library, and evidence

### Build

- Integrate real OpenAlex, Crossref, Semantic Scholar, and Unpaywall results according to their current terms and rate limits.
- Persist research plans, queries, provider traces, result ranks, canonical source records, identifiers, and access status.
- Deduplicate sources by DOI and normalized bibliographic identity.
- Provide real include, exclude, and maybe screening decisions with reasons.
- Import student-provided sources and permitted full text into the same canonical source model.
- Process source documents into anchored chunks and embeddings.
- Add evidence cards containing exact passage, page/location, source identity, interpretation, claim relationship, and student approval.
- Add an evidence matrix for supports, contradicts, qualifies, and background relationships.
- Block unsupported or unresolved citations from later drafting.

### Exit gate

- Search results are real provider results with visible identifiers and links; provider failure produces an error/retry state, not synthetic papers.
- At least ten real sources can be screened, imported, opened, and used to create anchored evidence cards.
- Cross-project and cross-user retrieval tests return no unrelated chunks.
- Canonical metadata, not model prose, generates bibliographic fields.
- Search, parsing, embedding, and evidence costs remain within the configured rate card.

## Phase 5 — Rubric outline, guided editor, citations, and authorship history

### Build

- Generate an outline from confirmed requirements and approved evidence.
- Persist outline versions, hierarchical nodes, requirement mappings, planned claims, evidence links, and word budgets.
- Require student approval before an outline becomes the drafting baseline.
- Add a section editor with autosave, version history, and diff-based accept/reject for AI suggestions.
- Retrieve only project-authorized evidence for grounded suggestions.
- Add deterministic CSL-based citations and bibliography generation from canonical source metadata.
- Record student edits, AI suggestions, approvals, rejections, and source changes in append-only provenance.
- Enforce integrity-mode capabilities on the server for every drafting action.

### Exit gate

- A confirmed requirement and evidence set produces a persisted, editable, rubric-mapped outline.
- A student can draft, refresh, sign out, resume, and inspect earlier versions.
- Suggested prose cannot cite a source without an approved evidence link.
- Citation style changes rerender from canonical metadata without asking a model to invent references.
- Planning-only and no-AI projects cannot access prohibited drafting endpoints, even through direct requests.

## Phase 6 — Assignment Autopilot

### Build

- Add `autopilot_runs`, idempotent steps, checkpoints, decision requests/answers, artifacts, and activity events.
- Implement the durable state machine defined in [Assignment Autopilot](./assignment-autopilot.md).
- Add preflight scope measurement, credit quote, maximum reservation, and provider-cost allocation by step.
- Execute analysis, research, evidence, outline, drafting, citation, and review as independently resumable steps.
- Add blocking decision cards with two or three choices plus **Other**, consequences, evidence context, and free-form student input.
- Pause for thesis, argument, evidence, personal-reflection, and unresolved-review decisions when applicable.
- Notify the student when input is required and resume from the persisted checkpoint.
- Add pause, cancel, insufficient-credit, provider-unavailable, and policy-blocked behavior.
- Require final student approval; do not implement autonomous LMS submission.

Long OpenAI reasoning calls may use Responses API background mode, while Aido retains canonical workflow state and checkpoints. OpenAI background mode supports asynchronous polling and cancellation, and conversation state can continue across turns; neither replaces Aido's durable job state. [OpenAI background mode](https://developers.openai.com/api/docs/guides/background), [OpenAI conversation state](https://developers.openai.com/api/docs/guides/conversation-state)

### Exit gate

- A real permitted assignment reaches a complete draft using real sources and measured credits.
- The run survives browser closure, sign-out, worker restart, and a multi-hour decision pause.
- Resume does not repeat completed provider calls or duplicate charges.
- Personal opinions, reflection, interviews, experiments, and data are never fabricated.
- The job stops before exceeding its credit or provider-cost ceiling.
- Every generated claim and citation can be traced to the run, prompt version, source, and evidence location.

## Phase 7 — Verification, review center, and export

### Build

- Add requirement coverage, argument structure, evidence sufficiency, contradiction, source quality, citation existence, metadata, claim support, and word-budget checks.
- Persist review runs, issues, severity, location, evidence, resolution, and rerun history.
- Block ready-for-export status on unresolved critical issues.
- Generate real DOCX, Markdown, bibliography, RIS/BibTeX where applicable, provenance summary, and AI-use disclosure artifacts.
- Store exports privately with version and verification status.
- Add user-controlled data export and project/account deletion workflows.

### Exit gate

- Known unsupported claims and invalid citations are detected by the evaluation set at the required threshold.
- Exported DOCX and references visually and structurally match the approved project state.
- Critical unresolved issues prevent a misleading verified/ready state.
- Export and deletion work across database rows, storage, chunks, embeddings, jobs, and artifacts.

## Phase 8 — Operational hardening and controlled launch

### Build

- Add aggregate admin views for revenue, credits, provider COGS, margin, queue depth, failures, latency, abuse, refunds, and reconciliation differences.
- Keep student document content unavailable to routine admin views.
- Add per-feature, per-plan, per-model, and per-provider margin alerts.
- Add queue dead-letter handling, stuck-job recovery, reservation expiry, and provider fail-closed behavior.
- Run load, concurrency, RLS, storage isolation, file-bomb, prompt-injection, webhook replay, and cost-runaway tests.
- Complete privacy, terms, refund, academic-integrity, provider-processing, and incident-response documentation.
- Run a controlled production pilot with real consenting users and strict spend limits.
- Reprice features from measured provider cost before broader release.

### Exit gate

- No severe RLS, storage, secret, payment, or cross-project retrieval finding remains open.
- Wallet, ledger, Stripe, job, and provider totals reconcile within the documented tolerance.
- Seven-day production pilot costs remain below the configured variable-cost ratio.
- Kill switches, refunds, deletion, incident response, and rollback have been exercised.
- Production contains no seeded sample assignments, sources, balances, usage, or fake completed states.

## Cross-phase definition of done

Every feature must satisfy all applicable items:

- Real authenticated persistence and retrieval.
- Ownership-aware RLS and explicit Data API grants.
- Honest loading, empty, unavailable, paused, error, and recovery states.
- Server-side validation and authorization.
- Idempotency for financial and background operations.
- Provider use only through the metered gateway.
- Token, tool, search, file, time, retry, credit, and provider-cost limits.
- Structured logs with secrets and student content minimized or redacted.
- Unit, database, RLS, integration, and failure-path tests.
- Accessibility and responsive UI verification.
- Migration, generated types, and operational documentation updated.
- No user-facing demo, mock, placeholder, or fabricated success data.

## First implementation milestone

The first milestone is not a dashboard mock. It is this real vertical slice:

```text
sign in
-> create project
-> save integrity mode and project facts
-> upload a private real brief and rubric
-> persist and display processing state
-> reserve credits granted by a verified staging payment or controlled admin grant
-> parse the actual documents
-> extract source-anchored requirements through the metered gateway
-> let the student confirm/edit them
-> sign out and resume later with the same state
```

This milestone spans Phases 0–3. It is the minimum acceptable proof that Aido's security, data, job, AI, and cost foundations work together without demo data.
