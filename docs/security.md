# Security and limits

## Local data and boundaries

- The server binds to `127.0.0.1`. Mutations require local Host/Origin checks and a session token.
- `.spequi/` holds local configuration, requests, previews, feedback and backups. Keep it out of Git.
- Browsing and offline analysis do not upload project source.
- Explicit model generation sends the planning documents and selected source to the configured endpoint.
- Your attached agent keeps its own provider and permission settings.
- All styles, scripts (including HTMX) and fonts are served locally. DM Sans and IBM Plex Mono are bundled with their licenses, so the UI needs no CDN or internet. Installing and recovering packages through npm still needs registry access unless packages are already available locally.

## Analytics

Spequi sends usage and failure events to `https://data.rahulnjs.com/api/spequi/sub/events` (`app_name: spequi`, `subject: events`), falling back to `https://sber.eval.best/spequi/event` if the primary request fails. Payloads include a persistent identifier shared across projects on the same machine account, the reported agent CLI name (`cli_name`, or null when unknown), UTC timestamps, and event-specific identifiers, counts, and failure categories. Source files, prompts, review comments, and raw error messages are excluded.

Events cover daily project activity, new spec creation, viewed file diffs, failed requests, and unavailable or failed diffs. Delivery is best effort: each endpoint gets at most one attempt with a five-second timeout. Network errors, timeouts, and non-success HTTP responses trigger the fallback. Analytics failures do not block the workspace.

During interactive `spequi init`, you can opt in to sharing this project’s folder name and Git `user.name`. The default is No. Consent is saved only for this project as `analytics.shareIdentity` in `.spequi/config.json`; anonymous usage events continue either way. Existing projects and noninteractive initialization exclude these fields until you explicitly opt in. Repeated initialization preserves your choice. Set `analytics.shareIdentity` to `false` to withdraw identity sharing. There is no analytics environment-variable override.

The attached agent may send project context to its own provider. Optional model generation sends planning documents and selected source to the configured endpoint.

## Applying changes

- Previews are isolated copies of the project.
- Planning requests create or revise specification files in the original project; implementation previews use the isolated copy.
- Applying is always an explicit confirmation.
- The apply API checks retained hashes and baseline conflicts before writing, and keeps recoverable backups.
- LF and CRLF comparisons use normalized display lines; hashes, patches and application preserve the exact reviewed bytes.

## Known limitations

- A preview copy is **not an OS security sandbox**. The agent must honor its assigned working directory.
- Static impact evidence does not establish complete runtime behavior, dynamic references, aliases or external-package effects. Scan limitations stay visible in the UI.
- Agent attachment depends on the host agent resuming its session when background work completes.
