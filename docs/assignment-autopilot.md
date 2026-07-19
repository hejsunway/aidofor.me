# Assignment Autopilot

> **Status:** Product and architecture decision record  
> **Date:** 2026-07-19  
> **Scope:** Human-in-the-loop assignment completion for AidoFor.me  
> **Related:** [Main PRD](./aidofor-me-prd.md), [Credit usage and margin control](./credit-usage-and-margin-control.md)

## Decision

AidoFor.me may offer a premium **Assignment Autopilot** that completes the research and writing workflow while pausing for meaningful student decisions. It may create a complete draft and export it, but it must not fabricate the student's opinion, personal experience, interviews, experiments, data, quotations, or evidence. The student must review and approve the final artifact; automatic LMS submission is out of scope.

This is not available in every academic-integrity mode:

| Integrity mode | Autopilot capability |
|---|---|
| No AI permitted | Disabled |
| Planning only | Stops after research plan and outline |
| Assistive writing | Produces section suggestions with approval gates; no one-click complete paper |
| Open/required AI | Full guided Autopilot, with provenance and final approval |
| Unknown | Disabled until the assignment policy is confirmed |

The server, rather than the prompt or browser, enforces these capabilities.

## Student experience

1. Upload the brief, rubric, template, policy, and any required sources.
2. Confirm assignment facts and academic-integrity mode.
3. Receive a fixed credit quote and maximum possible charge.
4. Start Autopilot.
5. Watch progress through analysis, research, evidence, outline, drafting, verification, and review.
6. Answer blocking decision cards when Aido needs a genuine student choice.
7. Review the completed draft, citations, warnings, and AI-use disclosure.
8. Approve and export.

Decision cards use two or three concise choices plus a free-form **Other** response. Each option explains its consequence. Example:

> Which position best represents your view?
>
> 1. Responsibility should primarily sit with platforms.
> 2. Responsibility should primarily sit with individual users.
> 3. A shared-responsibility approach is more defensible.
> 4. Other — write my own position.

Students can ask Aido to explain the options or show the supporting evidence before choosing. Asking or answering a decision card does not consume credits; subsequent work may consume the credits already quoted.

## Workflow

```text
project setup
-> brief and rubric analysis
-> research plan
-> source discovery and screening
-> thesis decision
-> source processing and evidence matrix
-> argument/evidence decision
-> rubric-mapped outline
-> section drafting
-> personal-opinion or reflection decision when required
-> citation and claim-support verification
-> weakness-resolution decision when required
-> final review
-> student approval
-> export and disclosure
```

High-impact decisions are blocking. Autopilot must not silently choose a personal position simply to keep the run moving. Low-impact formatting and workflow decisions may use saved student preferences when policy permits.

## Durable state machine

Primary states:

```text
queued
analysing
researching
waiting_for_student
outlining
drafting
verifying
waiting_for_final_approval
completed
```

Terminal or exceptional states:

```text
paused
cancelled
failed
insufficient_credits
policy_blocked
```

Before entering `waiting_for_student`, the worker must finish or safely stop the current atomic step, persist its artifacts and provider usage, create a decision request, and release any credits that are no longer required. Resuming creates a new idempotent work attempt from the saved checkpoint; it does not rerun completed provider calls.

## Logical data model

| Entity | Purpose |
|---|---|
| `autopilot_runs` | Overall run, integrity mode, limits, status, current step, and credit reservation |
| `autopilot_steps` | Idempotent units of analysis, research, drafting, and verification |
| `autopilot_checkpoints` | Resumable state and references to completed artifacts |
| `decision_requests` | Blocking/non-blocking question, options, reason, and evidence context |
| `decision_answers` | Selected option or custom student response |
| `assignment_artifacts` | Requirements, research plan, source set, evidence, outline, drafts, and export |
| `autopilot_activity` | Append-only provenance covering AI actions, student choices, revisions, and approvals |

Every project-owned row must be protected by ownership or project-membership RLS. Students may read their own activity and answer their own pending decisions, but only trusted server workers may advance run state, mark steps complete, or settle credits.

## Orchestration requirements

- Aido owns the workflow state. Provider conversation IDs are implementation details, not the source of truth.
- Each step has a unique idempotency key, input version, output schema version, provider/model/prompt version, and cost budget.
- Long model calls may run in provider background mode, but human pauses are controlled by Aido's durable state machine.
- A worker checks integrity policy, remaining credits, remaining provider-cost budget, and input versions before every external call.
- Generated claims may only cite resolved sources and stored evidence passages.
- Citation formatting is deterministic from canonical metadata.
- Failed calls cannot cause unlimited retries. One controlled retry is the default maximum.
- The final export includes unresolved warnings and an AI-use disclosure when applicable.

## Initial credit hypotheses

These are internal launch hypotheses and must be recalibrated from measured production usage before public commitment.

| Bundle | Limits | Working price |
|---|---|---:|
| Short | Up to 1,500 words and 6 sources | 900 credits |
| Standard | Up to 3,000 words and 10 sources | 1,500 credits |
| Extended | Up to 5,000 words and 15 sources | 2,400 credits |

OCR, unusually large inputs, additional sources, and premium-model review require a new quote. The preflight UI shows estimated credits, maximum reserved credits, included limits, and what will cause a pause or additional charge.

## Acceptance criteria

- The run survives browser closure, sign-out, worker restart, and a long student pause.
- Completed steps are not repeated after resume.
- Duplicate requests do not duplicate provider work or credit charges.
- A student can inspect the source and rationale behind every blocking choice.
- Personal reflection is never invented.
- Disallowed integrity-mode actions fail on the server.
- Every final citation resolves to canonical metadata and an available evidence location.
- No export is marked ready while blocking verification issues remain unresolved.
- Credits are reserved before provider work and settled from measured usage according to the linked margin-control design.

## Open validation questions

1. How many student decisions produce genuine authorship without creating excessive interruption?
2. Should students configure decision frequency as guided, balanced, or minimal within the integrity-mode ceiling?
3. Which assignment categories must always require personal-input gates?
4. What percentage of Autopilot drafts are materially revised before export?
5. Will lecturers accept the proposed provenance and disclosure export?

