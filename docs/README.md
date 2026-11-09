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
