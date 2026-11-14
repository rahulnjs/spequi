# Planning workflow

## Start a spec from an idea

Choose **New spec** in the left panel. Describe the idea and give it an unused lowercase change name, then pick:

- **Start with the next artifact** (default), or
- **Generate the full plan** to request all required planning artifacts.

Continue queues one planning request for the attached agent. Its questions stay in the app, replies survive reloads,
and the generated change opens in its draft workspace when the request completes. Partial plans offer the next
schema-ready artifact. Planning never starts implementation automatically.

Ideas save under **Drafts** in the left panel. Return there to resume or delete a draft. Deleting a draft can also remove
its generated planning files, after confirmation.

## Build tabs

New specs and unfinished drafts show three tabs in the header: **Shape spec**, **Implement**, **Validate & archive**.
Existing changes open the same **Build** workspace from the left panel.

### Shape spec

- Select a planning artifact tab and use **Revise spec** to request an update, or **Ask a question** for a read-only exploration.
- Changes appear as highlighted sections with a document summary. Highlights begin with revisions to existing text.
- Capabilities with several documents show file tabs below their artifact tab.
- **Planning actions** offers the next artifact or the full plan.
- Documents are read-only in the viewer.

### Implement

- Generate an isolated preview and choose its version.
- Browse changed files beneath the selected change in the left panel. The **Files** button brings the list into view.
- Previous/next controls, the selected file and diff tools stay above the independently scrolling code.
- Inspect the actual diff, then confirm **Apply reviewed preview**. A changed spec or a source conflict prevents applying.
- A preview becomes stale when its planning documents change. Generate a fresh one before applying.

Offline analysis, optional model proposals and patch import also live here. See [Offline tools](offline-and-model.md).

### Validate & archive

Distinguishes local **spec validation** from agent **implementation verification**, and exposes sync and archive with
their normal prerequisites. Archive confirmations appear in the conversation.

Status, task readiness and strict validation use the installed `openspec` CLI locally, with no agent required.
Missing or incompatible CLI capabilities disable those actions with an explanation. Checked task boxes alone do not
prove the implementation is correct.

## Commands

The **Commands** picker and slash commands in the planning workspace use the same guarded operations:

| Command | Purpose |
| --- | --- |
| `/new` | Start a new spec |
| `/explore <question>` | Read-only exploration |
| `/continue` | Create the next planning artifact |
| `/propose` | Generate the full plan |
| `/update <revision>` | Request a planning revision |
| `/apply` | Generate an isolated implementation preview (writing files still needs the separate Apply confirmation) |
| `/status` | Show change status |
| `/validate` | Run strict spec validation |
| `/verify` | Verify implementation with the agent |
| `/sync` | Sync specs |
| `/archive` | Archive the change |

`/opsx:<name>` and `/opsx-<name>` aliases also work. These are app commands, independent of the host agent's slash-command installation.

## Questions and agent handoff

Reasoning and writing requests use the current session running the viewer skill. The agent asks questions with
`agent ask` and waits for the app's reply with `agent input --wait 300`. The job resumes with the same ownership token.

- Queued and awaiting-input requests can be cancelled.
- A running request can be ended only after its owning session's heartbeat expires. Stop the old agent in your coding tool first; ending a request does not terminate its process or undo its edits.
- Keep the agent session attached to continue waiting work.

## Planning history

Planning versions are kept under `.spequi/studio/`. A revision stores the exact Markdown before a request and after it completes.
The most recent 40 versions are retained, with at most 8 MiB of planning documents per version.
This is local review evidence; the files under `openspec/` remain the source of truth.
