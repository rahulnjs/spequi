# Offline tools and model preview

These tools live under **Files > Affected files** and need no attached agent. Open the compact disclosure and choose **Scan files**; use **Scan again** when an analysis already exists.

## Analyze affected files

Matches the selected change's planning documents to current source, with no agent and no network. It explains explicit paths,
named symbols, related text and local dependencies separately from actual changed files.

Limits:

- At most 1,000 text files, 512 KB per file, and 8 MiB of source
- Planning documents limited to 2 MiB total
- Exclusions, skipped files, unresolved references and stale inputs are disclosed
- Dynamic references, aliases, external packages, and dependencies outside supported JS/TS, CSS and HTML forms can be missed

## Patch API (advanced)

Patch import is not shown in the workspace. The existing `POST /api/source-preview/patch` API remains available for integrations and stages a unified patch in a separate project copy.

- Add, modify or delete up to 30 eligible UTF-8 files
- 1 MiB limit for the patch and proposed content
- Renames are represented as a deletion plus an addition
- Review the saved diff, export it, comment on it, or apply it through the normal baseline conflict checks
- A failed import never publishes a partially completed preview

## Optional model generation

For generation without an agent session, add `previewModel` to `.spequi/config.json`, keeping the other settings:

```json
{
  "version": 1,
  "port": 4310,
  "previewModel": {
    "endpoint": "http://127.0.0.1:11434/v1/chat/completions",
    "model": "your-installed-model",
    "timeoutMs": 120000
  }
}
```

- The endpoint must accept Chat Completions-compatible JSON and return text at `choices[0].message.content`. A local runtime keeps generation offline.
- Hosted endpoints require HTTPS. Plain HTTP is accepted only for loopback hosts.
- If authentication is needed, set `"apiKeyEnv": "SPEQUI_PREVIEW_API_KEY"` and provide that environment variable to the viewer process. Never put a key in the endpoint URL.
- No model is installed or downloaded by Spequi.

Workflow: **Analyze first**, select 1 to 12 candidate files, then choose **Generate with model**.

**Privacy:** this action sends the change's planning documents and the selected files to the displayed destination, and nothing else.

Limits and guardrails:

- Combined input is limited to 256 KB; output to 30 edits and 1 MiB of proposed source
- Stale analyses require a new scan
- Existing files outside the selected context, secrets, planning artifacts, agent configuration and escaping paths cannot be edited
- Eligible new source files can be added
- The model returns file contents only. Spequi runs no tools, shell commands, installations or tests

Generated and imported previews show their origin and unrun-check status. Review and test before applying.
