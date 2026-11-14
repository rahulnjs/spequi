<div align="center">

# Spequi

**Plan with your agent. Review every change.**

A local web UI for [OpenSpec](https://openspec.dev/): shape specs with the coding agent you already use,
preview its implementation in an isolated copy, review the diff against the spec, and apply only what you approve.

[![npm](https://img.shields.io/npm/v/spequi?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/spequi)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-43853d?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-3f62b5)](LICENSE)
[![No build step](https://img.shields.io/badge/Frontend-no%20build%20step-626f83)](docs/architecture.md)

<img src="docs/demo.gif" alt="Spequi demo: plan a spec, preview the agent's implementation, review the diff next to the spec, apply" width="860">

</div>

---

## Why Spequi?

Coding agents are fast. Reading what they changed, and checking it against what you *asked for*, is the slow part.
A plain diff shows **what** changed, not **why**.

- **Spec-linked diffs.** Each changed code block shows the requirement or scenario behind it, with source path and line range.
- **Nothing touches your project until you say so.** The agent works in an isolated copy. Applying is a separate, explicit step with conflict checks and backups.
- **Bring your own agent.** Claude Code, Codex, or any skill-capable agent. No extra model, no API key, no cloud backend.
- **Local only.** Binds to `127.0.0.1`. Your source never leaves your machine unless you opt into model generation.

## Quickstart

```bash
cd /path/to/your-project      # a project that contains OpenSpec files
npx spequi@latest init        # sets up .spequi/ and registers the agent skill
node .spequi/server.mjs       # then open http://127.0.0.1:4310
```

That is enough to browse specs, review diffs and leave comments.
For agent-driven planning and implementation, attach your agent:

| Agent | Run after `init` |
| --- | --- |
| Claude Code | `/spequi` |
| Codex | `$spequi` |
| Other skill-capable agents | load `.agents/skills/spequi/SKILL.md` |

> **Requirements:** Node.js 20+ and npm. For agent-driven work you also need the OpenSpec CLI and its workflow skills
> (current OpenSpec needs Node.js 22.12+). See [Getting started](docs/getting-started.md).

## How it works

1. **Plan.** Click **New spec**, describe an idea, and shape the plan beside your agent's conversation. Drafts save automatically.
2. **Preview.** Open **Implement** and request a preview. The agent builds in a separate copy of your project.
3. **Review.** Read Proposal, Design and Tasks, then inspect real diffs with the quoted spec beside each change, dependency impact, and inline comments.
4. **Apply.** Confirm explicitly. Spequi checks hashes and baseline conflicts, writes the files, and keeps recoverable backups. Then validate and archive.

<table>
  <tr>
    <td><img src="docs/screenshots/build-light.png" alt="Planning a spec beside the agent conversation"></td>
    <td><img src="docs/screenshots/file-review-light.png" alt="Reviewing a diff with spec context and inline comments"></td>
  </tr>
  <tr>
    <td align="center"><sub>Plan beside your agent</sub></td>
    <td align="center"><sub>Review the diff against the spec</sub></td>
  </tr>
</table>

## Features

- **Full lifecycle:** drafts, spec refinement, implementation preview, validate, archive
- **Unified and split diffs** with syntax highlighting, changed-word emphasis, folding and wrapping
- **Impact analysis:** direct and downstream dependencies, related tests, export changes
- **Precise feedback:** comments on files, code ranges and Markdown passages; export a review brief or queue a spec update
- **Requests inbox:** see questions, failures and running work across all specs
- **Works offline:** browsing, review, affected-file analysis and patch import need no agent
- **Light and dark themes**

## Documentation

| | |
| --- | --- |
| [Getting started](docs/getting-started.md) | Install, initialize, attach an agent, what `init` creates |
| [Planning workflow](docs/planning.md) | New specs, drafts, slash commands, Build tabs |
| [Review workflow](docs/review.md) | Diffs, spec context, comments, requests inbox |
| [Offline tools and model preview](docs/offline-and-model.md) | Affected-file analysis, patch import, optional model endpoint |
| [Agent workflow](docs/agent-workflow.md) | Queue, heartbeat, questions, MCP reports |
| [Security and limits](docs/security.md) | Local data, boundaries, known limitations |
| [Architecture](docs/architecture.md) | Stack, repo layout, development, packaging |

## Status

Spequi is early. It is tested with Claude Code and Codex flows; continuous polling in a real GigaCode session and
native Windows execution are not yet verified. Static impact analysis can miss dynamic references and aliases.
See [Security and limits](docs/security.md) for the full list.

Feedback and bug reports are welcome in [Issues](https://github.com/rahulnjs/spequi/issues).

## Contributing

```bash
git clone https://github.com/rahulnjs/spequi.git
cd spequi
npm ci
npm run check
node bin/spequi.mjs init  --root /path/to/test-project
node bin/spequi.mjs start --root /path/to/test-project
```

See [Architecture](docs/architecture.md) for the repo layout.

## License

[MIT](LICENSE)
