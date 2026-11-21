# Review workflow

Open an active change to examine its **Proposal**, **Specs**, **Design**, **Tasks** and **Files**. Finished planning stays in Review when reopening documents.

## Documents

Planning documents support rendered Markdown, source view, and inline review comments, including during new-spec planning. Main specifications use a focused document reader, without change-only Planning status, artifact counts or Files changed controls.

## Files and diffs

Files compares the current project with the proposed implementation:

- Unified or Split diffs
- Syntax highlighting and changed-word emphasis
- Context folding and line wrapping
- An inspector that follows the selected file with dependency impact and saved comments

The generating agent checks off completed implementation tasks in the isolated `tasks.md`. **Apply changes** saves those checkbox updates together with the reviewed code, with the same conflict checks and backups. Unperformed tests, checks and manual review tasks stay unchecked. Regenerate older previews that did not include task updates.

## Spec context in diffs

In both diff modes, linked change blocks show the requirement, scenario or planning decision behind the edit.
Each quote includes its source path and line range from the preview's retained baseline. Quotes start collapsed; expand one when you want its evidence. There is no full-width summary or coverage strip above the code; repeated links point back to the first quote.

The attached agent records code-to-spec locations while implementing. Older previews and imported patches can show
**Suggested - file-level** context when the saved plan mentions the file or a changed symbol. Suggestions need reviewer
confirmation, and unsupported associations are omitted. Invalid recorded-link notices appear in the inspector.

To enable recorded links for new previews, refresh the skill: `node .spequi/cli.mjs skill install`.
Format details: [agent metadata format](agent-workflow.md#spec-links-in-implementation-previews).

## Impact analysis

The inspector lists direct and downstream dependencies, related tests and export changes, with explicit static-analysis
limitations. See [Security and limits](security.md#known-limitations).

## Comments and feedback

Comment on a whole file, a code range, or a passage in a planning document, before or after Finish planning. Notes retain the exact reviewed version.

Use **Attach files** beside Save/Cancel, or beside Send in the revision/question composer. Choose any file type, up to four files per comment or message and 5 MiB each. Ordinary text paste stays in the editor; clipboard images and files become attachments. Image-only and file-only comments or messages are supported. Supported raster images show thumbnails; other files download instead of executing in the browser.

Retained feedback snapshots and queued requests include retained local paths and SHA-256 hashes. The agent reads those exact references with its file/image tools and asks in the app if a format is unsupported. The browser checks supported raster images against a 40-megapixel limit.

**Update spec** saves an immutable feedback snapshot and queues a planning revision for the attached agent. There is no separate instructions download.

Saving the feedback snapshot does not apply code. Spec revisions and implementation previews are separate actions.
Generate a fresh preview when the plan changes.

The conversation omits repeated empty-state instructions. **Planning comments** appears when a draft has review notes while leaving more space for the discussion and code.

## Requests inbox

Open **Requests** in the header for an inbox grouped by spec.

- Questions, failures and stalled work appear first, then running and queued work.
- The ordinary badge counts inbox groups; a distinct **answer needed** marker identifies unanswered questions without opening Requests.
- A collapsed **Recent** section holds the latest five completed specs. Cancelled and older work stays in **All history**, with status filters and pagination.
- **Dismiss** clears settled items from the inbox while preserving requests, previews and comments.
- Cancel and supported retry actions stay available. Destructive deletion is confined to history.
- Active work stays visible while you browse another spec. Partially edited planning work must be reviewed before continuing.

Requests, Agent and MCPs stay in the header. Open **Settings** for Docs, the conditional Light/Dark mode action, optional desktop notifications, per-project usage sharing and version information. Header panels share the same top and right alignment.

In expanded conversation mode, the composer follows the same content width as the discussion, with no surrounding tinted strip or top border. Detailed Activity logs stay in the CLI; the UI keeps status, questions, failures and final results.
