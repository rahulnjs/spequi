# Review workflow

Choose **Review - Inspect & comment** to examine a change through **Proposal**, **Design**, **Tasks** and **Files**.

## Documents

Proposal, Design and Tasks support rendered Markdown and a source view.

## Files and diffs

Files compares the current project with the proposed implementation:

- Unified or Split diffs
- Syntax highlighting and changed-word emphasis
- Context folding and line wrapping
- An inspector that follows the selected file with dependency impact and saved comments

## Spec context in diffs

In both diff modes, linked change blocks show the requirement, scenario or planning decision behind the edit.
Each quote includes its source path and line range from the preview's retained baseline. Collapse a quote to focus on
code; repeated links point back to the first quote.

The attached agent records code-to-spec locations while implementing. Older previews and imported patches can show
**Suggested - file-level** context when the saved plan mentions the file or a changed symbol. Suggestions need reviewer
confirmation, and files without a supported match say so explicitly.

To enable recorded links for new previews, refresh the skill: `node .spequi/cli.mjs skill install`.
Format details: [agent metadata format](agent-workflow.md#spec-links-in-implementation-previews).

## Impact analysis

The inspector lists direct and downstream dependencies, related tests and export changes, with explicit static-analysis
limitations. See [Security and limits](security.md#known-limitations).

## Comments and feedback

Comment on a whole file, a code range, or a passage in Proposal or Design. Notes retain the exact reviewed version.

- **Export MD** downloads an immutable Markdown review brief.
- **Update spec** queues a planning revision for the attached agent from that exact snapshot.

Exporting feedback does not edit a specification or apply code. Spec revisions and implementation previews are separate actions.
Generate a fresh preview when the plan changes.

## Requests inbox

Open **Requests** in the header for an inbox grouped by spec.

- Questions, failures and stalled work appear first, then running and queued work.
- The badge counts specs needing attention.
- A collapsed **Recent** section holds the latest five completed specs. Cancelled and older work stays in **All history**, with status filters and pagination.
- **Dismiss** clears settled items from the inbox while preserving requests, previews and comments.
- Cancel and supported retry actions stay available. Destructive deletion is confined to history.
- Active work stays visible while you browse another spec. Partially edited planning work must be reviewed before continuing.
