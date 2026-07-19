# Aido workspace design direction

The authenticated Aido experience is an AI workbench, not a conventional SaaS dashboard.

## Reference character

- Calm and tool-first, in the family of Codex, Gemini, and Antigravity.
- A neutral, persistent left sidebar with lightweight navigation and recent assignments.
- One focused white working canvas. Avoid blue-tinted page backgrounds and grids of decorative cards.
- Compact controls, thin separators, quiet status colors, and generous whitespace.
- The expressive blue brand treatment belongs mainly to the public landing page. In the workspace, blue is an accent rather than the canvas.

## Product structure

- Use “assignment” in student-facing language. “Project” may remain an internal database or code term.
- The assignment page should feel like an ongoing working session: context, Aido output, files, approval questions, and the student's evolving work appear in one thread or canvas.
- Metadata is supporting context, not the main content. Present deadline, word count, citation style, and course policy in a compact strip.
- Destructive or infrequent actions belong in an overflow menu.
- On mobile, replace the persistent sidebar with a compact header and menu while preserving the same assignment canvas.

## Data integrity

- Never populate authenticated screens with demo balances, sample drafts, fake conversations, fake sources, or pretend pipeline progress.
- Render only records belonging to the authenticated user.
- If a pipeline is unavailable, show an honest inactive state. Do not make a disabled feature look completed.
- Temporary local QA fixtures must be removed after verification and must never be applied to the shared TutorPakar production project.

## Autopilot interaction

When assignment autopilot is implemented, its progress should remain in the assignment canvas. At meaningful decision gates, pause with one focused question and two or three numbered choices plus an “Other” response. After the student answers, continue from the same visible run rather than opening a separate dashboard workflow.
