# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

Layout: **single-context**. The monorepo (`api`, `web`, `mobile`, `shared`) holds one business domain.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root: it is this repo's glossary (French ↔ English) and functional context. Wherever a skill mentions `GLOSSARY.md`, read and write `CONTEXT.md` instead. Never create a separate `GLOSSARY.md`.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

## ADRs

- `docs/adr/0001` to `0011` are inherited from the template repo and are **non-negotiable**. Never edit them.
- A new decision is proposed as a new ADR from `docs/adr/0000-modele-adr.md`, with status `proposé`, and waits for explicit validation by the functional owner.

## File structure

```
/
├── CONTEXT.md          ← glossary + application context
├── docs/adr/
│   ├── 0000-modele-adr.md
│   ├── 0001-topologie.md … 0011-execution-locale.md
└── api/ web/ mobile/ shared/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`: the French term in documentation and tickets, the English identifier in code. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (ask the functional owner; never invent a business rule).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contredit l'ADR-0007 (Docker), mais mérite d'être rouvert parce que…_
