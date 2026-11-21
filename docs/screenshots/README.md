# Workspace screenshots

These PNGs show the real workspace in light and dark themes: planning, file review, Workflow with optional plan publication, and Settings. The README uses planning and review images; the public landing page embeds the review pair.

| Workflow | Settings |
| --- | --- |
| ![Workflow with planning publication](workflow-light.png) | ![Grouped workspace settings](settings-light.png) |

Dark versions: [Workflow](workflow-dark.png), [Settings](settings-dark.png), [planning](build-dark.png), [file review](file-review-dark.png).

Regenerate from the repository root with Node and installed Google Chrome:

```bash
node docs/screenshots/capture.mjs
```

An optional first argument selects another Chrome executable. The script launches headless Chrome with a disposable profile and a temporary example OpenSpec project. It creates local fixture plans, comments and a frozen preview, captures the UI at 1440 × 960, and refreshes the landing page’s embedded images. It does not edit the real project’s runtime data, execute an agent, commit, or push. The fixture uses saved readiness data to show completed planning artifacts without requiring an OpenSpec CLI installation. Temporary project, server and browser processes are cleaned up when capture finishes.
