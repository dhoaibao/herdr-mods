<!-- b-init-managed:start -->
# Docs

Search for an existing doc and update it in place before creating one.

| Folder | Holds |
| --- | --- |
| `references/` | Material sourced from external research |
| `runbooks/` | Guides to set up or operate the project |
| `decisions/` | ADRs |
| `architecture/` | As-built structure and diagrams (from b-drawio or b-excalidraw) |
| `specs/` | Requirements and approved plans |

Where does a doc go: facts from outside -> `references/`; steps to do something -> `runbooks/`; why we chose X -> `decisions/`; how it is built now -> `architecture/`; what to build -> `specs/`.

Naming: lowercase kebab-case ASCII `.md`, no dates in filenames. Exceptions: `README.md` and `DESIGN.md` (`docs/DESIGN.md` stays at the docs root, owned by b-design).
<!-- b-init-managed:end -->

## Index

- Architecture: [git-graph](architecture/git-graph.md)
- Decisions: [ADR-001 keep GitHub access read-only](decisions/ADR-001-keep-github-access-read-only.md), [ADR-002 report status as plain text](decisions/ADR-002-report-status-as-plain-text.md), [ADR-003 guard Push](decisions/ADR-003-guard-push.md), [ADR-004 installer never creates keys.json](decisions/ADR-004-installer-never-creates-keys-json.md), [ADR-005 quality tooling](decisions/ADR-005-use-bun-eslint-tsc-prettier-husky.md), [ADR-006 share mods in Herdr's layout](decisions/ADR-006-share-mods-in-herdr-layout.md), [ADR-007 allow guarded local writes](decisions/ADR-007-allow-guarded-local-writes.md)
- Runbooks: [set up development](runbooks/set-up-development.md), [sync the live copy](runbooks/sync-live-copy.md), [take the preview image](runbooks/take-preview-image.md), [publish a mod](runbooks/publish-mod.md), [test the installer](runbooks/test-installer.md)
- Specs: [git-graph expansion](specs/git-graph-expansion.md)
- References: [Herdr mod sharing](references/herdr-mod-sharing.md)
