# Planning workflow

## Start a spec from an idea

Choose **New spec** in the left panel. Describe the idea and give it an unused lowercase change name, and optionally a Git branch name, then pick:

- **Start with the next artifact** (default), or
- **Generate the full plan** to create proposal, specs, design and tasks only (following the project schema). It never invokes an apply workflow or changes application code.

Continue queues one planning request for the attached agent. Its questions stay in the app, replies survive reloads,
and the generated change opens in its draft workspace when the request completes. Partial plans offer the next
schema-ready artifact. Planning never starts implementation automatically.

Ideas save under **Drafts** in the left panel. Return there to resume or delete a draft. Deleting a draft can also remove
its generated planning files, after confirmation.

## Planning and workflow

New specs and unfinished drafts show their planning artifact tabs directly. **Workflow** stays available beside the artifact and Files tabs. Choose **Finish planning** to move the change from Drafts into Review. This does not generate implementation code.
Existing changes open in document review from the left panel. Continue a draft or open a planning request from **Requests** to return to its planning workspace.

### Planning artifacts

- Select a planning artifact tab and use **Revise spec** to request an update, or **Ask a question** for a read-only exploration. Inline passage comments and **Update spec** are available during planning, before Finish planning. All planning Markdown artifacts can retain exact reviewed snapshots.
- Commands in revision requests are proposed document content. Asking to use a different command changes the planned command; it does not execute it or implement code.
- Changes appear as highlighted sections with a document summary. Highlights begin with revisions to existing text.
- Artifacts with several documents use a dropdown showing each file's relative path and a description from its content.
- **Planning actions** offers the next artifact or the full plan.
- Documents are read-only in the viewer.

### Review files

- Open **Files** in Review to generate and inspect an isolated implementation diff. The existing view stays visible while Files loads; a delayed tab label indicates slower requests.
- Reopening Files uses the saved diff without generating another implementation.
- Browse changed files in the left panel. OpenSpec planning artifacts and `apply-instr.json` are excluded from source diffs.
- Previous/next controls, the selected file and diff tools stay above the independently scrolling code.
- Inspect the actual diff, then confirm **Apply changes**. A changed spec or a source conflict prevents applying.
- A preview becomes stale when its planning documents change. Generate a fresh one before applying.

Task checkbox updates are retained separately and applied with the reviewed code, using the same conflict checks. Other planning edits are not applied.

Optional local file analysis and configured model proposals are available under **Explore affected files**. Patch import is not shown in the workspace. See [Offline tools](offline-and-model.md).

### Workflow

Open **Workflow** for the numbered steps: prepare the plan; generate, review and apply; optionally validate specs and verify implementation; sync specs; archive. Each step explains what it does, shows its current state, and identifies its actual OpenSpec command or agent skill. The separate Commands dropdown has been removed. Validation and verification run only when explicitly requested. Archive confirmations appear in the conversation.

Status, task readiness and strict validation use the installed `openspec` CLI locally, with no agent required.
Missing or incompatible CLI capabilities disable those actions with an explanation. Checked task boxes alone do not
prove the implementation is correct.

## Commands

Workflow is the primary action guide. The conversation composer still accepts these guarded app commands:

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

- A distinct **answer needed** marker in the header separates unanswered questions from ordinary ongoing requests. Open it to see the question in the inbox.
- Pending questions and reply controls appear directly in the Agent panel and Requests inbox. Replies survive live list refreshes.
- Queued and awaiting-input requests can be cancelled. Cancelling an old waiting request frees the queue and keeps existing files. If its owner is disconnected, you can save an answer and resume the same coding session.
- Longer requests can take a few minutes. Results appear in the workspace when ready. Check your CLI for permissions or other actions waiting for you.
- Completion appears in an in-app toast. Open the header bell and choose **Enable notifications** to receive optional browser notifications while the page is in the background.
- A running request can be ended only after its owning session's heartbeat expires. Stop the old agent in your coding tool first; ending a request does not terminate its process or undo its edits.
- Keep the agent session attached to continue waiting work.

## Branches

An optional branch name on a new spec applies before the first agent request, including planning. The agent claim creates or switches to that branch before returning the work. Existing branches require confirmation before reuse. You can save or clear the branch for an existing change in **Workflow**. Git refuses a switch that would overwrite local changes; Spequi never stashes, resets or force-switches.

## Diff generation scope

**Generate file diff** only makes the file changes required by the selected specs in an isolated copy. It does not run validation, builds, linters, type checks or tests. Test files change only when the specs require them. The generating agent records exact spec links as it edits. Quotes start collapsed and can be toggled individually. The full-width summary and link-coverage bars have been removed; suggested context stays separately labelled.

## Native tool and file permissions

Questions sent through Spequi’s agent protocol can be answered in the Agent panel or Requests inbox. Permission prompts raised by the coding agent itself, such as approving a shell command or a file edit, remain in that agent’s CLI or host. The current skill connection cannot intercept these prompts across all agents. If progress pauses, check that coding session for an approval. Spequi’s **Apply changes** confirmation is separate from the agent’s own permissions.

## Planning history

Planning versions are kept under `.spequi/studio/`. A revision stores the exact Markdown before a request and after it completes.
The most recent 40 versions are retained, with at most 8 MiB of planning documents per version.
This is local review evidence; the files under `openspec/` remain the source of truth.

## Verification reports

Verification is read-only and does not run tests or builds. The agent writes a Markdown report to `.spequi/verification/<job-id>.md` with inspected requirements/files, conclusions, findings with evidence and limitations. Completion ingests the report; a heading or generic “Completed” message is rejected. Earlier title-only results show **Report missing** and offer a rerun rather than a successful verification badge.

## Runtime updates

Run `/spequi update` in the host coding agent to refresh Spequi itself. This is different from the browser composer's `/update`, which revises planning documents. Startup checks show a version notice only; no automatic update occurs. Resolve active requests before updating, stop the project server, update, reload the skill from disk and restart/reattach. Queued work and project state are retained.
