# GitHub and npm metadata for Spequi

## Repo description (About box, max 350 chars)

Local web UI for OpenSpec: plan specs with your coding agent, preview its code in an isolated copy, review diffs against the spec, and apply only what you approve. Works with Claude Code, Codex and other skill-capable agents. No API key, no cloud.

Shorter alternative:

Plan with your agent. Review every change. A local review UI for OpenSpec with spec-linked diffs.

## Topics

openspec, spec-driven-development, code-review, coding-agents, ai-agents, claude-code, codex, diff-viewer, developer-tools, htmx, nodejs, local-first

(GitHub allows 20. Lead with the four you asked for.)

## Set it from the terminal

```bash
gh repo edit rahulnjs/spequi \
  --description "Local web UI for OpenSpec: plan specs with your coding agent, preview its code in an isolated copy, review diffs against the spec, and apply only what you approve." \
  --add-topic openspec,spec-driven-development,code-review,coding-agents,ai-agents,claude-code,codex,diff-viewer,developer-tools,htmx,nodejs,local-first
```

Optional: `--homepage https://www.npmjs.com/package/spequi`

## package.json fields to add

```json
{
  "description": "Local web UI for OpenSpec: plan specs with your coding agent, review spec-linked diffs, apply only what you approve.",
  "keywords": ["openspec", "spec-driven-development", "code-review", "coding-agents", "ai-agents", "claude-code", "codex", "diff-viewer"],
  "homepage": "https://github.com/rahulnjs/spequi#readme",
  "repository": { "type": "git", "url": "git+https://github.com/rahulnjs/spequi.git" },
  "bugs": { "url": "https://github.com/rahulnjs/spequi/issues" },
  "license": "MIT"
}
```

## Social preview image

Settings > General > Social preview, 1280x640 PNG. Use the dark-mode review screenshot (`docs/screenshots/file-review-dark.png`)
cropped to the diff with the quoted spec visible, with "Spequi - Plan with your agent. Review every change." overlaid.

## Recording the 20-second demo GIF (docs/demo.gif)

Use a project with one small, real OpenSpec change so nothing is mocked. Target 860 px wide, under 5 MB.

| Time | Show |
| --- | --- |
| 0-3s | **New spec**: type a one-line idea, click Continue |
| 3-7s | Agent's plan appears beside the conversation |
| 7-10s | **Implement**, request preview, files list fills in |
| 10-16s | Open a file: split diff, then the quoted requirement above a changed block |
| 16-20s | Add an inline comment, click **Apply reviewed preview** |

Tools: ScreenToGif (Windows), Kap (macOS), or any screen recorder, then convert:

```bash
ffmpeg -i demo.mp4 -vf "fps=12,scale=860:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" docs/demo.gif
```

If the GIF is too large, host an MP4 via a GitHub issue/PR attachment and link a poster image instead.

## Housekeeping checklist

- [ ] Add `docs/demo.gif`
- [ ] Rename `openspec-ui.code-workspace` to `spequi.code-workspace` (or delete it)
- [ ] Merge `docs/agent-workflow-addendum.md` into the existing `docs/agent-workflow.md`, then delete the addendum
- [ ] Confirm `docs/` is still excluded in `package.json` `files`
- [ ] Tag a release (`v0.1.0`) with short notes
- [ ] Add `CONTRIBUTING.md` and issue templates (bug report with Node version, OS, agent name)
- [ ] Verify the npm badge once the package is published
- [ ] Post in the OpenSpec community/discussions with the GIF
