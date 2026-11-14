# Architecture and development

## Stack

Node.js ES modules, server-rendered HTML, HTMX, WebSockets, plain CSS and JavaScript.
No frontend compilation and no hosted backend. Runtime dependencies handle file watching, Markdown sanitization,
syntax highlighting, diffs and WebSocket transport.

## Layout

```
bin/          Executable CLI
src/          Server, project reader, previews, impact and review implementation
public/       Runtime styles and browser JavaScript
skills/       Maintained portable agent skill
templates/    Self-contained project launcher template
scripts/      Maintenance scripts
test/         Tests
docs/         Documentation and README screenshots (excluded from the npm package)
```

## Development

```bash
npm ci
npm run check
npm pack --dry-run
npm publish --dry-run
```

There is no build step. `package.json` `files` limits the npm archive to runtime code and assets, the portable skill,
the launcher template, package metadata, README and license. Publication runs syntax checks first.

## Naming

The app is **Spequi**. The npm package, shell command and agent skill are all `spequi`: `$spequi` in Codex,
`/spequi` in tools that support command wrappers. Initialization creates `.spequi/` for local configuration, queued jobs,
previews, comments and backups.
