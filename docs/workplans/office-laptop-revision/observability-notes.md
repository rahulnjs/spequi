# Spequi — Agent Observability: MCP status to tool confirmations

Design notes for making the Spequi web UI show what the attached coding agent is
actually doing: which MCP servers are connected, which tools it calls, which files
it touches, and what it is waiting on your approval for.

Status: draft, not implemented. Targets an upstream contribution to Spequi, not a
per-project customization.

---

## 1. Scope

Two related but independent features:

| Feature | Question it answers | Difficulty |
| --- | --- | --- |
| **MCP connection status** | "Are my MCP servers healthy right now?" | Low — data already exists, delivery is broken |
| **Tool activity feed** | "What is the agent doing / waiting on?" | Medium — needs a new route, storage, UI |

They share a transport (`POST /api/agent/*`), an auth model, and a host-adapter
problem, so it is reasonable to ship them together.

---

## 2. Part A — MCP connection status

### 2.1 Current behaviour

`SKILL.md` already instructs the agent to publish MCP health:

```jsonc
// .spequi/<report>.json
{
  "sessionId": "…",
  "mcps": { "supported": true, "connections": [{ "name": "…", "status": "connected" }] }
}
```

Allowed statuses: `connected`, `disconnected`, `unavailable`, `unknown`.
The skill also says: *"If authoritative discovery is unavailable, use
`mcps: { supported: false, connections: [] }`."*

### 2.2 The failure observed in practice

The agent concluded discovery was unavailable and wrote `supported: false`, so the
web UI showed nothing. The information was actually available from the host CLI:

```text
$ gigacode mcp list
✓ pixso:       https://…/mcp   - Connected
✓ jira:        https://…/jira/mcp - Connected
✓ confluence:  https://…/confluence/mcp - Connected
```

The agent had only grepped Spequi's own files and never looked for a host command.
Separately, the user's `/mcp` TUI panel showed `confluence` as **disconnected** —
a different answer from the CLI at a different moment.

### 2.3 Two distinct defects

**Defect A1 — instruction gap (cheap fix).** The skill permits giving up without
running a discovery command. Agents read "if unavailable" as "if you don't know of
one", then stop.

**Defect A2 — no verification (structural).** Nothing checks that the reported
`sessionId` belongs to a live server process, that a report was refreshed within
the heartbeat window, or that its contents are plausible. A stale report from a
dead session is indistinguishable from a fresh one in the current schema.

### 2.4 Part A changes

**A-1. Skill wording.** Require an explicit discovery attempt before concluding
unavailable. Provide a per-host command table:

| Host | Discovery command |
| --- | --- |
| GigaCode CLI | `gigacode mcp list` |
| Claude Code | `claude mcp list` |
| Codex | `codex mcp list` (verify) |
| Other | host help / config file read |

Rule: run the command, record what it printed *now*, and only fall back to
`supported: false` if no such command exists. A static config file or a tool
catalog does not prove connection health; a live handshake does.

**A-2. Server-side freshness.** Extend `src/agent-session.mjs` so that a report
carries `expiresAt` and is rejected (rendered as `unknown`) if stale. The skill
already asks for a refresh every five minutes; the server should enforce rather
than trust it.

**A-3. Optional server-side probe.** Spequi could probe configured MCP endpoints
itself, but that requires knowing transport and credentials — explicitly out of
scope. The skill forbids copying credentials, and duplicating host responsibility
creates a second source of truth that will disagree with the first.

---

## 3. Part B — Tool activity feed

### 3.1 What exists today

| Piece | Location | Notes |
| --- | --- | --- |
| Agent route dispatcher | `src/server.mjs:61` | `POST /api/agent/<operation>`, Bearer `agentToken`, rejects requests carrying an `Origin` header |
| Operations | `src/server.mjs:64-98` | `next`, `wait`, `report`, `ask`, `input`, `log`, `finish`, `fail`, `list` |
| Log writer | `src/jobs.mjs:239` `updateJob` | appends `{ at, message }`, caps array at 200 |
| Log reader | `public/requests.js:126` | renders `job.logs?.slice(-30)` under an "Activity" heading |

So an HTTP hook *could* post to the existing `log` operation today — but it would
need the per-job `claimToken`, which a hook cannot know in advance, and its output
would be flattened into the 200-entry prose log.

### 3.2 Why a hook cannot use `log` as-is

`updateJob` requires:

```js
if (job.status !== 'running' || !token || token !== job.claimToken) throw new Error(...)
```

`claimToken` is generated per job at claim time and only exists in the agent's
memory and the job record. A hook process started by the host has no access to it.
The one identifier a host *does* provide to hooks is its own **session id** — and
the server already stores that as `job.agentSessionId`.

**Key insight: resolve the job by session id, not by claim token.** That single
decision is what makes the feature agent-agnostic.

### 3.3 Proposed route

```text
POST /api/agent/tool-event
Authorization: Bearer <agentToken>

{
  "sessionId": "…",          // host session id, not a Spequi job id
  "event": "PostToolUse",    // PostToolUse | PostToolUseFailure | PermissionRequest | PermissionDenied | PreToolUse
  "tool": "write_file",
  "target": "src/forms/…",   // whitelisted, see 3.5
  "outcome": "ok",           // ok | error | blocked | pending
  "at": "2026-11-19T04:22:31.000Z"
}
```

Server resolves:

```js
const job = jobs.find(j => j.status === 'running' && j.agentSessionId === payload.sessionId);
if (!job) return { accepted: false, reason: 'no-active-session' };
```

No job → respond `200` with `accepted: false`. Hooks must never fail loudly; a
missing job is normal (the hook fires between jobs, or after `finish`).

### 3.4 Storage — separate from `job.logs`

```jsonc
job.toolEvents = [
  { "at": "…", "event": "PostToolUse", "tool": "write_file",
    "target": "src/x.ts", "outcome": "ok" }
]
```

Reasons for a separate array:

- `job.logs` caps at 200 and renders 30. A busy job produces far more tool events
  than that and would evict the agent's own reports.
- Two different things are being shown: *what the agent says* (prose, occasional)
  vs *what the agent did* (mechanical, frequent). Mixing them makes both worse.
- Different retention is defensible: logs are the job's record, events are
  transient telemetry.

Cap at ~500 entries, drop oldest first. Also cap `target` length (~200 chars).

### 3.5 Redaction boundary — the part that must not be skimped

Hook input contains `tool_input` and `tool_response`, which may include file
contents, shell command lines, tokens, or customer data. **Do not store them.**

Whitelist on ingest:

| Field | Source | Rule |
| --- | --- | --- |
| `tool` | `tool_name` | as-is, truncate 64 |
| `target` | derived | for file tools: the path; for shell: the first token only; else `null` |
| `outcome` | derived | enum, not free text |
| `at` | `timestamp` | normalized ISO |
| `event` | `hook_event_name` | enum |

Unknown event names → `unknown`, still recorded. No passthrough of arbitrary
fields, no `additionalContext`.

### 3.6 UI

New section in `public/requests.js` `requestRow`, next to the existing Activity:

```text
Tool activity
04:22:31  write_file         src/forms/ui/…        ✓
04:22:19  run_shell_command  npm                    ✓
04:21:58  read_file          src/schemas…          ✓
```

Compact, virtualized or sliced like the log list, with its own scroll. A separate
heading keeps prose and telemetry visually distinct.

`PermissionRequest` deserves special treatment: when an event with
`outcome: pending` is the newest, the job row can show "waiting for approval",
which explains a job that looks stalled without the agent having to log anything.

---

## 4. Transport and delivery — making it host-independent

A server route alone changes nothing. Every host needs a hook that fires it.

### 4.1 Two configuration strategies

| Strategy | Where it lives | Portable? | Verdict |
| --- | --- | --- | --- |
| Per-project wrapper script + hand-written hook config | `.gigacode/settings.json` in one repo | No — one project only | Rejected |
| Bundled sender + `hook install` command | Spequi package, writes host config | Yes | **Chosen** |

### 4.2 `hook install` command

```text
node .spequi/cli.mjs hook install --host gigacode [--scope project|user]
node .spequi/cli.mjs hook install --host claude
node .spequi/cli.mjs hook install --host codex
node .spequi/cli.mjs hook install --print     # print JSON, write nothing
```

Behaviour:

1. Detect existing hooks; merge, never overwrite (idempotent re-run).
2. Write the host's settings file at the requested scope.
3. Point the hook at the bundled sender, resolving the project root at call time.
4. Print the exact command a user must run to undo it (`hook uninstall`).

### 4.3 Bundled sender

`bin/hook-sender.mjs` — one script, all hosts:

```text
stdin  → JSON event from the host
        → extract session_id, hook_event_name, tool_name, tool_input
        → derive target per whitelist
        → read .spequi/server.json for origin + token
        → POST /api/agent/tool-event
        → exit 0, always
```

Hard rules:

- **Always exit 0.** Exit 2 blocks the tool call in GigaCode; a telemetry failure
  must never block a user's work.
- **Bounded latency.** ~500 ms timeout; drop the event on timeout. Consider
  `async: true` in the hook config where supported so the tool call is not
  delayed at all.
- **No secrets in argv.** Token comes from `server.json`, never a command line.

### 4.4 Suggested default matchers

Firing on every tool floods the feed with `read_file` noise. Defaults:

```jsonc
"PostToolUse": [ { "matcher": "^(write_file|edit|run_shell_command)$", … } ]
"PostToolUseFailure": [ { "matcher": "*", … } ]
"PermissionRequest": [ { "matcher": "*", … } ]
```

Reads are opt-in via `hook install --include-reads`.

### 4.5 Host matrix

| Host | Events | Payload shape | Config |
| --- | --- | --- | --- |
| GigaCode CLI | `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied` | `session_id`, `tool_name`, `tool_input`, `tool_response` | `.gigacode/settings.json` |
| Claude Code | same family | same | `.claude/settings.json` |
| Codex | TBD — verify event set | TBD | TBD |

Because the payloads across the Claude-family CLIs share field names, one sender
covers them. Any host that can run a command on tool events can be supported by
adding an adapter that maps its payload to the four whitelisted fields.

---

## 5. Retention — the open question

**Should tool events survive job completion?**

- **Transient (recommended for v1).** Clear `toolEvents` on `finish`/`fail`.
  No unbounded growth across history, no new GC job, no storage policy. Cost: you
  cannot audit a completed job's tool activity afterwards.
- **Persistent.** Useful for audit, but then every historical job carries up to
  500 events; a repo with hundreds of jobs accumulates megabytes with no owner.
  Would need a total-size cap or TTL, which is a policy decision better made with
  real usage data.

Ship transient, revisit if someone asks for history.

---

## 6. Suggested PR breakdown

| # | Change | Files | Reviewable alone |
| --- | --- | --- | --- |
| 1 | Skill wording + per-host discovery table | `skills/*/SKILL.md` | Yes |
| 2 | Report freshness (`expiresAt`) | `src/agent-session.mjs` | Yes |
| 3 | `toolEvents` storage + cap | `src/jobs.mjs` | Yes |
| 4 | `/api/agent/tool-event` route + whitelist | `src/server.mjs` | Yes |
| 5 | UI section | `public/requests.js`, `public/*.css` | Yes |
| 6 | `hook install/uninstall/--print` + sender | `bin/`, `src/commands.mjs` | Yes |
| 7 | Docs, one page per host | `docs/` | Yes |

Parts A (1–2) are small and independently valuable — ship them first. Part B (3–7)
is one coherent feature; splitting 6 out keeps the server diff reviewable.

---

## 7. Testing notes

- Route: reject wrong token, reject `Origin` header, unknown session, no active
  job, unknown event name, oversized `target`.
- Storage: cap enforcement, drop-oldest ordering, no growth after `finish` under
  the transient model.
- Sender: garbage stdin, missing `server.json`, server down, slow server — all
  must exit 0 within the timeout.
- Whitelist: a `tool_input` containing a secret must not appear anywhere in the
  written job record.

---

## 8. Explicit non-goals

- Reading agent transcripts to infer tool calls. Host-specific, fragile, and
  duplicates the hook mechanism.
- Streaming live output into the web UI.
- Proxying the host's approval dialog into the browser. `PermissionRequest` is a
  *notification*, not a control surface — approval stays in the terminal.
- Spequi probing MCP endpoints directly (see A-3).

---

## 9. Open decisions

1. Transient vs persistent tool events (section 5) — recommend transient.
2. Default matchers — recommend writes + shell + all failures + all permission
   events; reads opt-in.
3. `hook install` scope default — project vs user. Project is safer (committed
   config affects collaborators); user is less intrusive but per-machine.
4. Codex support in v1 or deferred.
5. Whether `PermissionRequest` pending state should also suppress the existing
   "stalled" hint, since the new state explains the same symptom more precisely.