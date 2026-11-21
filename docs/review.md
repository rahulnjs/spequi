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

Paste a clipboard image into a comment editor or use **Add image** to choose files. Each comment supports up to four PNG, JPEG or WebP images, 5 MiB each and 40 megapixels in the browser. Image-only comments are supported. Thumbnails open the retained original; remove a draft attachment before saving if it is not needed.

Feedback exports include local image paths and hashes, so the attached agent can inspect the same reference images using its host’s image viewer. The downloaded Markdown refers to local files; it does not bundle image bytes. Images are stored locally with the review, and exporting or updating the spec checks that they have not changed.

- **Export MD** downloads an immutable Markdown review brief.
- **Update spec** queues a planning revision for the attached agent from that exact snapshot.

Exporting feedback does not edit a specification or apply code. Spec revisions and implementation previews are separate actions.
Generate a fresh preview when the plan changes.

The conversation omits repeated empty-state instructions. **Comments and revisions** provides a compact disclosure for review notes while leaving more space for the discussion and code.

## Requests inbox

Open **Requests** in the header for an inbox grouped by spec.

- Questions, failures and stalled work appear first, then running and queued work.
- The ordinary badge counts inbox groups; a distinct **answer needed** marker identifies unanswered questions without opening Requests.
- A collapsed **Recent** section holds the latest five completed specs. Cancelled and older work stays in **All history**, with status filters and pagination.
- **Dismiss** clears settled items from the inbox while preserving requests, previews and comments.
- Cancel and supported retry actions stay available. Destructive deletion is confined to history.
- Active work stays visible while you browse another spec. Partially edited planning work must be reviewed before continuing.

Requests, Agent and MCPs stay in the header. Open **Settings** for Docs, appearance, optional desktop notifications, per-project usage sharing and version information. Header panels share the same top and right alignment.
