# Getting started

## Requirements

- **Node.js 20+** and npm
- A target project containing [OpenSpec](https://openspec.dev/) files

For agent-driven planning and implementation you also need:

- The OpenSpec CLI and its workflow skills, available to your coding agent
- A skill-capable coding agent, attached with the `spequi` skill

The current OpenSpec CLI [requires Node.js 22.12+](https://github.com/Fission-AI/OpenSpec/blob/main/package.json),
independently of Spequi's Node.js 20 minimum. Use Node.js 22.12+ for the complete setup.

Browsing, review, offline affected-file analysis and patch import work without an attached agent.
Initializing this package installs the UI skill and command wrappers; OpenSpec setup and its workflow skills are separate.

## Initialize with npx

```bash
cd /path/to/your-project
npx spequi@latest init
```

## Start with your agent

Open the same project in **your existing coding agent** and invoke the Spequi skill in the agent's input, using its command below. These are agent commands, not terminal commands. Spequi does not launch a model or need a separate provider API key.

| Agent | Invoke after initialization |
| --- | --- |
| Claude Code | `/spequi` (use `/spequi init` for setup) |
| Codex | `$spequi`, or select the viewer skill |
| Sber/GitVerse GigaCode CLI | `/skills spequi` or `/spequi` |
| Other skill-capable agents | Load `.agents/skills/spequi/SKILL.md` using the tool's own convention |

Reload your agent if newly generated commands or skills do not appear.

The skill starts the local server, shares its URL, and consumes queued requests. Open the URL it provides, normally **http://127.0.0.1:4310**, or use your agent's browser tools. Browser opening is not automatic. Keep the agent session running while using the workspace.

Without an attached agent, planning and implementation
requests wait in the queue and everything else keeps working. Closing the agent pauses consumption and leaves requests saved.

Each job runs the matching installed OpenSpec workflow in the same agent session:

| Job | Workflow skill |
| --- | --- |
| Preview implementation | `openspec-apply-change` |
| Proposals | `openspec-propose` |
| Feedback updates | `openspec-update-change` |
| Archive | `openspec-archive-change` |

Exploration and verification use their corresponding workflows when available, with read-only fallbacks. Impact reports run directly.
Missing required workflows fail the job with an explanation; they are never installed automatically.

To upgrade an initialized project, refresh its managed launchers and skill, then invoke the skill again:

```bash
npx spequi@latest init
```

### GigaCode notes

GigaCode uses monitored Shell calls with `is_background: true` for the server and five-minute `agent wait` calls.
Background completion must resume the host session for unattended idle attachment to work. The skill includes a check and
a foreground fallback. GigaCode CLI has also been tested on Windows.

## Other installation options

### Global installation

```bash
npm install -g spequi
cd /path/to/your-project
spequi init
```

Then [invoke the Spequi skill in your agent](#start-with-your-agent).

### Run from source

```bash
git clone https://github.com/rahulnjs/spequi.git
cd spequi
npm ci

node bin/spequi.mjs init --root "/path/to/your-project"
```

Open the target project in your coding agent and invoke the Spequi skill to start the workspace.
This repository does not ship sample OpenSpec plans. An empty project shows setup guidance.

## What initialization creates

```
your-project/
├── .spequi/
│   ├── config.json       # Port and initialized viewer version
│   ├── cli.mjs           # Project command launcher
│   ├── server.mjs        # Server launcher
│   ├── jobs/             # Queued agent requests
│   ├── previews/         # Isolated baseline and proposed files
│   └── backups/          # Recoverable applied-file backups
├── .agents/skills/spequi/SKILL.md
├── .claude/commands/spequi.md
└── .gigacode/
    ├── skills/spequi/SKILL.md
    └── commands/spequi.md
```

- Feedback storage is created when needed.
- `/.spequi/`, `/.agents/`, `/.claude/` and `/.gigacode/` are appended to `.gitignore`. Existing rules are preserved; already-tracked files stay tracked.
- `skill install --global` writes registrations under your home directory instead.
- Repeat initialization preserves configuration, comments, previews, applied files and custom launchers. Explicit reinitialization refreshes managed launchers and registration.
- If the cached package disappears, the launcher can retrieve the initialized version through npm (registry access required).

Spequi starts fresh in `.spequi/`. It does not import, move or delete data from earlier tools.

## Usage sharing and updates

The first web visit asks for per-project usage consent, including existing projects. Until a choice is saved, no usage/failure events are sent. Choose no sharing, usage without names, or usage including the project folder and Git user name. The header’s usage-sharing control lets you change this later; initialization no longer asks a terminal-only identity question.

Startup checks for a newer version using the project's configured npm registry. A red dot on the usage-sharing icon points to plain update text in its panel. Offline checks do not stop the server, and a notice never installs an update automatically. Run `/spequi update` in your host agent when no request is active. The skill stops its project server, updates managed launchers/skills, reads the refreshed skill, and starts/reattaches. For a legacy runtime without the update command, use `npx spequi@latest init` after retaining any customized managed files. Local source checkouts are refreshed with `node bin/spequi.mjs init`; published updates do not overwrite them.
