# `.agents/`

Everything AI-tooling-related for this repository, kept in one place so that adding a
new assistant means adding a folder here rather than another dotfile at the project root.

## Layout

```
.agents/
  README.md          You are here. Explains the folder.
  ARCHITECTURE.md    How JDDC works: data model, layers, invariants.
  .claude/           Claude Code: settings and skills.
    skills/
      run-desktop/   Launch and drive the packaged Electron app.
  .codex/            (add as needed)
```

## Which document answers which question

| Question | Read |
|---|---|
| What is this app for, and how do I run it? | [`../ONBOARDING.md`](../ONBOARDING.md) |
| How does it work internally? | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| How do I contribute, branch, and release? | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) |
| Why was it built this way, and what's next? | [`../FUTURE_CONSIDERATIONS.md`](../FUTURE_CONSIDERATIONS.md) |

The root [`AGENTS.md`](../AGENTS.md) is the short entrypoint most agent tools discover
automatically; it points here for depth.

## Conventions

- **Tool-agnostic content goes at this level** (`ARCHITECTURE.md`), not inside a
  vendor folder. Only genuinely tool-specific configuration belongs in `.claude/`,
  `.codex/`, and friends.
- **These documents describe the code as it is**, not as it is planned to be.
  Aspirations belong in `FUTURE_CONSIDERATIONS.md` or `ROADMAP.md`. A stale
  architecture doc is worse than none, because it is trusted.
- **When the source and a document disagree, the source wins** and the document is
  the bug. Fix it in the same change.
