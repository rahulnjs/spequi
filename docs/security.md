# Security and limits

## Local data and boundaries

- The server binds to `127.0.0.1`. Mutations require local Host/Origin checks and a session token.
- `.spequi/` holds local configuration, requests, previews, feedback and backups. Keep it out of Git.
- Browsing and offline analysis do not upload project source.
- Explicit model generation sends the planning documents and selected source to the configured endpoint.
- Your attached agent keeps its own provider and permission settings.
- All styles, scripts (including HTMX) and fonts are served locally. DM Sans and IBM Plex Mono are bundled with their licenses, so the UI needs no CDN or internet. Installing and recovering packages through npm still needs registry access unless packages are already available locally.

## Analytics

On the first web visit for each project, including an existing installation, Spequi asks for usage-sharing consent. No usage or failure events are transmitted before a saved choice. Choose **Do not share**, **Share usage without names**, or **Share usage with names**. Change the preference at any time from the header’s usage-sharing icon. Dismissing the prompt without choosing keeps sharing off.

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

## Known limitations

- A preview copy is **not an OS security sandbox**. The agent must honor its assigned working directory.
- Static impact evidence does not establish complete runtime behavior, dynamic references, aliases or external-package effects. Scan limitations stay visible in the UI.
- Agent attachment depends on the host agent resuming its session when background work completes.

On Windows, Spequi uses polling file watchers to avoid native directory-watch handles blocking archive renames. External locks and filesystem permissions can still prevent an archive; the agent must report the failure without interactive retry loops or destructive fallbacks.
