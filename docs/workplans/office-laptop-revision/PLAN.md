# Spequi office-laptop revision

Status: implementation complete; awaiting user verification. All accepted phases P0–P9, including P7a, are implemented.
Created: 2026-11-21. Project: `/Users/krypton/openspec-ui`.
Baseline HEAD: `d2f4a88247eab85a6d967ea0bca844b73cd5e9b0`; package version: `0.1.8`.

## Instructions that survive a resumed session

- User wants extremely economical tokens, minimal code, and brief replies.
- This request is to create a plan, ask questions, and persist context. Q6 explicitly requires a separate implementation instruction; planning answers do not authorize implementation.
- Read root `AGENTS.md`. Do not add or run automated tests, suites, or exhaustive browser QA unless explicitly requested. The user will test. Only a brief sanity check is authorized.
- Preserve existing work. `.gitignore` was already modified before planning; that edit is not ours.
- Use existing helpers and components; no new framework, speculative abstraction, or dependency.
- Prefer the right panel for new information; preserve vertical space for code.
- Planning edits must remain planning-only. Diff generation makes code changes in its isolated copy, without validation/testing or test generation unless the spec explicitly requires test-file changes.
- Do not start a Spequi server, attach an agent, execute queued jobs, publish, commit, or push as a side effect of this planning request.
- Save every completed chunk and user decision here before ending a work session. No promise of automatic execution after a quota reset: the user can resume by pointing at `RESUME.md`.

## Authoritative scope from this conversation

1. **Safe spec revisions.** A request to change a command mentioned in a spec was mistakenly executed immediately, producing implementation changes during planning. Revision must treat mentioned commands as proposed document content, revise only planning artifacts, and never invoke implementation/apply or execute the described application command. Necessary OpenSpec planning operations remain distinct from those quoted instructions.
2. **File change summary.** It is unreliable and consumes diff height. Remove it completely, per Q1. Do not relocate it or add summary-generation work or another model call.
3. **Remove linked-spec overview.** Remove the full-width `2 linked spec sections / 2 of 4 changed lines linked / Expand quotes` bar. Quotes start collapsed; developers choose to expand them. Preserve accurate source links without a permanent vertical summary strip.
4. **Improve spec context.** More useful and engaging, compact styling; distinguish recorded evidence from suggested file context. Do not imply suggested context is a verified explanation. Keep spec context collapsed by default with an explicit user toggle, per Q1. No mandatory move to the right panel; prefer the right panel for future additions.
5. **Affected-file exploration.** Improve background, contrast, hierarchy, and readability in both themes without making it another large default-open section.
6. **Answer-needed marker.** Ongoing requests currently share a red dot with unanswered questions. Show a distinct, accessible marker/count/label when a reply is required, visible without opening Requests. It must clear after the answer and navigate directly to the question.
7. **Specification validation layout.** Fix the broken Workflow validation UI: spacing, feedback containment, result alignment, widths, and repeated status presentation. Scope includes both success and failure display.
8. **Empty verification report.** A completed verification showed only `Verify: <change> (<ticket>)`, without findings. Trace stored result and rendering; do not assume the renderer is the cause. Require substantive read-only verification output: scope, conclusions, findings/gaps, and unverified areas. Do not label a heading-only or empty result a successful complete report. Preserve compatibility with older saved jobs.
9. **Workflow redesign.** Show clear steps, meaning, prerequisites, current state, and the actual OpenSpec command or installed agent skill. Do not invent a shell command for an action implemented through an agent skill. Remove the redundant Commands dropdown, per Q2, while retaining useful supported actions/keyboard behavior in an appropriate place. Validation/verification stay explicitly optional and user-invoked.
10. **Per-project web consent.** On first web visit ask before sharing usage data. Choices: anonymous usage, optional Git username/project name sharing, or complete opt-out. Earlier policy that anonymous events always send is superseded. Persist per project; cover existing installations; do not let init, background jobs, or failures bypass the gate. No transmission before a saved affirmative choice is confirmed by Q3; include a later settings control. Disclose existing stable machine identifier/CLI metadata accurately instead of claiming stronger anonymity than delivered.
11. **GigaCode MCP discovery.** Require an actual discovery attempt (`gigacode mcp list`) before concluding discovery unsupported. Use current output, not old screenshots or the `/mcp` TUI. Publish names/status only, retain attachment identity, refresh at least every five minutes and on connection changes, and keep queue heartbeats independent. Verify capabilities before adding commands for other hosts; a static configuration/tool catalog is not proof of live health.
12. **Smart empty state.** Detect whether the configured OpenSpec directory exists. Give setup guidance only when absent; when initialized but empty, explain creating the first plan/spec. Account for existing changes with no main specs and archived-only projects. Remove duplicate generic hero copy and irrelevant actions; respect configured roots rather than hard-code `openspec`.
13. **Planning inline comments.** New-spec planning needs the same highlight/comment/revise workflow as Review, without forcing Finish planning first. Reuse existing snapshot-based feedback, anchors, comment rendering and revision routing across generated planning documents; preserve comments/history and keep revisions planning-only.
14. **`/spequi update`.** Refresh to current published code and managed project launchers/skills, then use that version. Check versions on startup and show a notice; updates are explicit via `/spequi update`, per Q4. Do not automatically update. Separate a package update from the existing `/update` planning-revision command. Preserve project data, consent, local customizations, and resumable jobs; do not assume replacing files updates an already running Node process or an agent's cached skill instructions. Handle offline/private-registry environments and Windows/macOS/Linux. Local development checkouts must not be silently overwritten or switched to a published runtime.
15. **Documentation at the end.** Once behavior is settled, update README, `public/index.html`, relevant docs, and shipped skill guidance together. Refresh the Graphify map after substantive implementation; use the existing graph as a map and verify current source.

## Observability draft: accepted direction and exclusions

The original user attachment is retained as `observability-notes.md`. It is evidence/proposals, not implementation instructions or verified host documentation.

- Useful: live MCP discovery guidance; accurate freshness UI; optional reliable CLI-approval indicators.
- Full tool activity feed is deferred: user expressed uncertainty; assistant recommended deferral. Do not build a tool-event endpoint, activity storage, read/edit/command feed, or general hook installer unless newly authorized.
- CLI-approval hooks and native approval indicators are deferred by Q5. Improve unanswered-question markers and honest check-your-CLI guidance only.
- Browser approval of native file edits/tool execution remains out of scope. A permission notification is not approval authority.
- If hooks are separately authorized in a future revision, confirm host support using primary host documentation first, opt in per project, map native host session to the actual Spequi attachment, correlate permission requests/resolutions, sanitize inputs, bound retention/latency, and preserve existing host config. Do not infer reliable state just from the newest event.
- Do not duplicate MCP probing or copy credentials into Spequi. Do not inspect transcripts to guess tool use.

## Findings verified against current source

| Area | Observed baseline | Likely touchpoints |
| --- | --- | --- |
| Planning safety | `revise-plan` routes to `openspec-update-change`; queued instruction and feedback boundaries need strengthening, not a new workflow | `src/jobs.mjs`, `src/feedback.mjs`, `src/lifecycle.mjs`, `skills/spequi/SKILL.md`, installed/generated copies |
| Review reuse | Planning renderer uses `renderPlanMarkdown`; review feedback already retains immutable snapshots | `src/studio-view.mjs`, `src/studio-documents.mjs`, `src/review-view.mjs`, `src/review-store.mjs`, `src/comment-view.mjs`, `src/comment-controls.mjs`, `src/feedback.mjs`, `public/review.js` |
| Diff chrome | Summary is full-width `job.result`; quotes render `open`; separate overview is emitted | `src/preview-view.mjs`, `src/spec-context-view.mjs`, `src/diff-view.mjs`, `public/app.js`, relevant CSS |
| Affected files | Existing expandable local analysis component can be restyled/reused | `src/source-preview-view.mjs`, `src/impact-view.mjs`, `public/diff.css`, `public/review.css` |
| Questions | Existing `awaiting-input` state, question payloads, notifications and topbar update path | `public/requests.js`, `public/session.js`, `src/requests.mjs`, `src/job-dialogue.mjs`, `src/views.mjs` |
| Workflow/results | `studio-view` finds completed verify jobs and renders `report.result`; job finish accepts a generic completion message | `src/studio-view.mjs`, `src/jobs.mjs`, `src/lifecycle.mjs`, `src/commands.mjs`, `public/studio.css`, `public/workflow.js` |
| Consent | Events send regardless of `shareIdentity`; init asks only whether to include identity; stable machine identifier exists | `src/analytics.mjs`, `src/project.mjs`, `bin/spequi.mjs`, `src/server.mjs`, configuration/UI |
| MCP | Server already matches attachment agent/session, validates display-only schema, and marks reports stale after 300000 ms or lost attachment | `src/agent-session.mjs`, `skills/spequi/SKILL.md`, `public/session.js`, docs |
| Empty state | Default view unconditionally recommends `openspec init` | `src/views.mjs`, `src/specs.mjs`, `src/workspace-state.mjs`, project configuration |
| Update | Project launcher prefers retained matching version or npm-execs a pinned version; init refreshes generated launchers and installs agent skills | `templates/cli.mjs`, `src/project.mjs`, `bin/spequi.mjs`, `skills/spequi/SKILL.md` |

`openspec/config.yaml` still describes older openspec-ui naming/state paths. Do not blindly propagate that stale context over actual Spequi code/user requirements. No need to change it as part of initial planning.

## Execution order and completion criteria

Planning and implementation are complete; user verification remains. Each chunk should be small enough to finish and checkpoint independently. Re-check callers before editing; record actual changed files and sanity checks in `RESUME.md`.

- [x] P0: Capture scope, decisions/questions, source observations, baseline and original attachment. No application changes or tests.
- [x] P1: Q1–Q6 resolved and recorded. User explicitly requires a separate implementation instruction; wait for it.
- [x] P2: Planning boundaries and reliable results. Tighten revision scope across ordinary conversation and immutable review feedback; remove the preview summary obligation and make verify completion requirements explicit without another AI call. Acceptance: asking to replace a command edits planning text only; blank/heading-only verification is not presented as complete evidence.
- [x] P3: Reuse inline comments in planning. Acceptance: select/highlight planning text, add/reopen comments, request a revision before Finish planning; keep anchors/snapshots scoped correctly through document switches and refreshes.
- [x] P4: Reclaim diff space. Remove change summary completely; remove overview strip; collapse quotes by default; improve context and affected-file component. Acceptance: no extra summary/coverage bands above the code, accessible disclosures, no layout shift on file switches, right-panel content follows the selected file.
- [x] P5: Requests and workflow. Distinct answer marker and direct question navigation; repair validation UI; redesign steps with real command/skill labels; remove/rehome Commands per Q2. Acceptance: queued/running/answer-needed/failed/completed remain distinct; outdated/empty reports cannot falsely suggest a finished check.
- [x] P6: Consent and empty onboarding. Enforce saved project consent before any event delivery; migrate existing identity-only settings without treating them as full usage consent; add first-visit consent UI and later settings control per Q3; improve empty-state guidance. Acceptance: decline sends no events including failure/startup events; names require explicit permission; separate projects do not inherit consent.
- [x] P7: MCP reliability. Fix live discovery guidance and retain existing freshness protections; no native approval hooks, indicators, or tool-activity feed in this revision. Acceptance: a stale/unavailable connection is never shown as freshly connected; no secrets/URLs/config in reports; heartbeat and queue serving still work.
- [x] P8: Fresh runtime update. Implement explicit update path and Q4 startup behavior, version feedback, launcher/skill refresh, safe restart/re-attach procedure and offline fallback. Acceptance: actual running version changes after update; active work/state survives; custom files/development checkout not overwritten; `/spequi update` cannot be confused with revising a plan.
- [x] P9: Final documentation and brief sanity check. Update public docs and skill copies coherently, inspect diff, perform only focused syntax/structure checks as appropriate, and record user manual acceptance scenarios. Do not run tests/exhaustive browser QA. Refresh Graphify only after real source changes. Report remaining limits accurately.

## Resolved questions (original choices for traceability; decisions below override recommendations)

Q1: Summary/spec placement: right-panel details plus a compact collapsed reference (recommended); all context in the right panel; or remove summary completely.

Q2: Workflow replaces Commands dropdown (recommended), or retain a compact advanced menu.

Q3: No event transmission before saved per-project choice, including existing projects; choices are anonymous usage, optional identity sharing, or no sharing. Add a later settings control (recommended), or no settings control yet.

Q4: Check on start and show an update notice; explicit `/spequi update` (recommended), or automatic update on start when idle, or explicit-only checking/updating.

Q5: Defer approval hooks and improve questions/CLI guidance now (recommended), or add opt-in project hooks for hosts whose support is verified. Full activity feed remains deferred either way.

Q6: Begin implementation once planning answers are resolved, or wait for a separate implementation instruction. No answer/elapsed time is permission.

## Decision ledger

All six user answers are saved in `state.json`. Confirmed decisions:

- Q1: Remove change summary completely. Spec context stays collapsed by default; user can toggle it.
- Q2: Remove Commands dropdown; show actual command or skill in Workflow steps.
- Q3: Consent before any sharing, per project including existing projects; anonymous, optional identity sharing, or complete opt-out; editable later.
- Q4: Check on startup and show a notice; update explicitly via `/spequi update`. No automatic update.
- Q5: Defer native approval integration. Full tool activity feed remains deferred.
- Q6: Wait for a separate implementation instruction. No application changes are authorized yet.

## User manual acceptance scenarios for later

- Revise a command in a planning document; confirm application files remain untouched.
- Comment and request a revision directly during new-spec planning, including after switching artifacts.
- Generate a file diff; verify readable code space, no change-summary section, collapsed evidence, clear suggestions and affected-file contrast in both themes.
- Have the agent ask a question with Requests closed; marker is obvious and opens the correct unanswered question, then clears after reply.
- Run optional validation with success/failure and verification with real findings, no findings, blank output, and an older saved title-only report; verify truthful display.
- Load an existing project and a new project with no consent; choose no sharing/anonymous/identity sharing and ensure choices remain independent and editable if selected.
- Open projects without OpenSpec, initialized with no artifacts, containing only changes, and archived-only content; guidance matches state.
- Attach GigaCode with live MCP discovery, then refresh after disconnection/staleness; status follows new evidence.
- Update an idle initialized project, an offline project, and a local source checkout; confirm running version and data preservation. Active-job handling follows Q4.

## Additional office observations (second batch)

User finished this batch with “thats al”. This closes observation collection; it does not override Q6's separate implementation instruction requirement.

16. **Windows archive directory lock.** Workflow archive failed with `Access is denied` / exit 1 when moving the selected change into its dated archive folder. `git mv` also failed and prompted interactively for retries. A different change directory could be renamed; stopping the Spequi server allowed the target archive move to succeed. This suggests a server-held handle/watcher, but the precise cause is not yet verified. Investigate watcher/file-handle lifetime, selected-change state and archive orchestration. Release Spequi-owned handles when necessary, restore monitoring reliably, and report actionable failure without retry loops, hanging shell prompts, destructive copy/delete workarounds, or killing unrelated processes. Preserve partially completed archive state and reconnect/refresh the UI correctly. Do not assume globally stopping the server is the desired fix.
17. **Main specification reading layout.** Selecting `specs/fx-deal-creation/spec.md` showed a duplicate change-style hero, generic workspace tagline, Planning badge and Files changed button above the actual specification. Main specifications need a focused document-reading layout. Remove irrelevant change actions/duplicate hero; retain useful breadcrumb, document identity, source/preview and download controls.
18. **Incorrect main specification metadata.** The main specification's right panel showed Change details, Status: Planning, Schema: spec-driven and Artifacts: 0 files. Do not derive a change lifecycle/status for a main specification or show misleading empty change metadata. Use document-specific information where helpful, or omit the panel content. Apply this consistently to header and right panel; do not relabel it “Complete” without evidence.
19. **Empty verification repeated.** Another screenshot confirms a completed verification still renders only `Verify: optional-trade-time (CALDERASEC-6251)`. This strengthens item 8; it is not a separate feature. Cover both new completion payloads and old title-only saved results, with truthful status and a clear rerun path.

### Phase integration

- P5 also removes change-only hero/actions and incorrect lifecycle metadata from main specification reading (items 17–18), reusing existing document rendering rather than creating a parallel reader.
- Add P7a after P7 and before P8: investigate and fix Windows archive locking (item 16), preserve archive semantics and queue ownership, and recover monitoring/UI state on both success and failure. Implementation uses Windows polling watchers and recoverable failure guidance; Windows-specific behavior has not been exercised on this macOS workspace.
- Item 19 remains part of P2/P5's verification completion and display fixes.

### Additional manual acceptance scenarios

- With the selected change open in a running Spequi server on Windows, archive it from Workflow. It must complete without directory-lock retry prompts; the archived content remains intact and navigation refreshes. If an external lock prevents archiving, show a clear recoverable failure rather than falsely reporting success or retrying forever.
- Read a main specification with no active change and with unrelated active changes. No Planning badge, Files changed action, generic change hero or fabricated change status/artifact count appears; document controls still work.
- Open an older title-only verification result. It is identified as missing report content, not marked as a valid completed verification.

## Checkpoint protocol

At every completed phase or interruption: save user answers first; update checkboxes and `state.json`; record changed files, checks, remaining risks and the exact next action in `RESUME.md`. Never store claim tokens, credentials, or server secrets in these docs. Resume from disk and current Git state, not assumptions about remembered chat.

## Final implementation checkpoint

All accepted changes are implemented and remain uncommitted. The existing `.gitignore` change was preserved. Shipped guidance, README and the public landing/embedded documentation are synchronized. Graphify was refreshed (708 nodes, 2,266 relationships).

Sanity checks: syntax of changed JavaScript, server-module import without starting the server, whitespace/diff integrity, and one focused mechanical design scan. No automated tests, test suites or browser QA were added or run, per the user. Windows archive behavior and an actual published-package update need user verification on the target setup. Native permission hooks/tool activity and automatic updates remain deferred.
