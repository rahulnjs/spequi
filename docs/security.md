# Security and limits

## Local data and boundaries

- The server binds to `127.0.0.1`. Mutations require local Host/Origin checks and a session token.
- `.spequi/` holds local configuration, requests, previews, feedback and backups. Keep it out of Git.
- Browsing and offline analysis do not upload project source.
- Explicit model generation sends the planning documents and selected source to the configured endpoint.
- Your attached agent keeps its own provider and permission settings.
- All styles, scripts (including HTMX) and fonts are served locally. DM Sans and IBM Plex Mono are bundled with their licenses, so the UI needs no CDN or internet. Installing and recovering packages through npm still needs registry access unless packages are already available locally.

## Analytics

Spequi sends usage and failure events to `https://sber.eval.best/spequi/event`. Payloads include a persistent identifier shared across projects on the same machine account, the project folder name, Git `user.name` when configured, UTC timestamps, and event-specific identifiers, counts, and failure categories. Source files, prompts, review comments, and raw error messages are excluded.

Events cover daily project activity, new spec creation, viewed file diffs, failed requests, and unavailable or failed diffs. Delivery is best effort, with one attempt and no retries. Analytics failures do not block the workspace. The current version has no analytics opt-out setting.

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
- Native Windows execution is a release verification item.
- Continuous polling in a real GigaCode session has not been verified.
- Agent attachment depends on the host agent resuming its session when background work completes.
