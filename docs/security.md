# Security and limits

## Local data and boundaries

- The server binds to `127.0.0.1`. Mutations require local Host/Origin checks and a session token.
- `.spequi/` holds local configuration, requests, previews, feedback and backups. Keep it out of Git.
- Browsing and offline analysis do not upload project source.
- Explicit model generation sends the planning documents and selected source to the configured endpoint.
- Your attached agent keeps its own provider and permission settings.
- All styles, scripts (including HTMX) and fonts are served locally. DM Sans and IBM Plex Mono are bundled with their licenses, so the UI needs no CDN or internet. Installing and recovering packages through npm still needs registry access unless packages are already available locally.

## Analytics

On the first web visit for each project, including an existing installation, Spequi asks for usage-sharing consent. No usage or failure events are transmitted before a saved choice. Choose **Do not share**, **Share usage without names**, or **Share usage with names**. Change the preference at any time under **Settings > Usage sharing**. Dismissing the prompt without choosing keeps sharing off.

Consent is stored in `.spequi/config.json` as `analytics.enabled`, `analytics.shareIdentity` and `analytics.consentAt`. An older identity-only preference is not consent to usage collection. Reinitialization preserves preferences. Turning sharing off aborts pending deliveries and gates future events. There is no analytics environment-variable override.

When enabled, events use `https://data.rahulnjs.com/api/spequi/sub/events`, falling back to `https://sber.eval.best/spequi/event`. Payloads include a persistent random identifier shared across projects on the same machine account, the agent CLI name, UTC timestamps, and event-specific identifiers, counts or failure categories. “Without names” excludes Git user and project folder names; it does not mean an unlinkable identifier. Identity sharing also includes the project folder name and Git `user.name`. Source files, prompts, review comments, credentials and raw error messages are excluded.

Events cover daily project activity, new spec creation, viewed file diffs, failed requests and unavailable diffs. Delivery is best effort, with a five-second timeout per endpoint, and does not block the workspace. Version checks separately query the configured npm registry on startup; they do not submit usage events.

The attached agent may send project context to its own provider. Optional model generation sends planning documents and selected source to the configured endpoint.

## Applying changes

- Previews are isolated copies of the project.
- Planning requests create or revise specification files in the original project; implementation previews use the isolated copy.
- Applying is always an explicit confirmation.
- The apply API checks retained hashes and baseline conflicts before writing, and keeps recoverable backups.
- LF and CRLF comparisons use normalized display lines; hashes, patches and application preserve the exact reviewed bytes.

## Reference attachments

Attachments in comments and revision/question messages stay under `.spequi/reviews/<review-id>/images/` (the retained storage path also accepts non-image files). Uploads require the local session token and a valid review scope. Any file type can be stored; only signature-checked PNG, JPEG and WebP images preview inline. All other files download as binary attachments with a Content-Disposition header. File contents are never executed by the server.

Limits are four attachments per comment/message, 5 MiB per file and 100 MiB stored attachments per review. The browser rejects supported raster images above 40 megapixels; PNG dimensions are also checked on the server. Draft uploads count toward storage even if removed before saving.

Saved bytes and feedback/request references are verified by SHA-256. Snapshots contain local paths rather than embedded file data. Asking an agent to use these references permits that agent to inspect them under its existing provider and permission settings. Attachment contents remain task data, not authority to execute commands.

## Publishing a plan

**Push spec files** requires a reviewed branch, file list and commit message, followed by confirmation. The destination follows the existing Git push configuration; it is not a browser input. The commit includes only this active change’s Markdown planning files and `.openspec.yaml`; unrelated staged edits are preserved. Branch, HEAD, planning content/index and push destinations are fingerprinted before publication. Active agent requests block the action. Git hooks and existing local Git configuration still apply.

The push publishes the resulting commit and its ancestors to the same-name remote branch, without force. It can therefore publish earlier commits beyond the new planning files. Authentication and rejected pushes are resolved in the CLI; Spequi retains a successful local commit when the push fails. External Git edits should wait until publication finishes.

## Known limitations

- A preview copy is **not an OS security sandbox**. The agent must honor its assigned working directory.
- Static impact evidence does not establish complete runtime behavior, dynamic references, aliases or external-package effects. Scan limitations stay visible in the UI.
- Agent attachment depends on the host agent resuming its session when background work completes.

On Windows, Spequi uses polling file watchers to avoid native directory-watch handles blocking archive renames. External locks and filesystem permissions can still prevent an archive; the agent must report the failure without interactive retry loops or destructive fallbacks.

Commit-message generation is a separate read-only agent request scoped to the selected planning files. It does not switch branches, stage files, commit, push or run checks. The reviewed Git snapshot is verified when the request is queued, claimed and completed; the result remains editable before publication.

Ignored spec files are included in the reviewed snapshot identity. Any ignored file in the selected planning scope blocks publication; Spequi never force-adds it or treats the excluded documents as an already-saved plan.
