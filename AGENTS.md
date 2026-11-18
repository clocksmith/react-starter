# React starter

When working inside Deco, follow [the workspace operating rules](../AGENTS.md).
This file adds repository-specific guidance; standalone checkouts use it directly.

Build reusable packages `@react-starter/core` and `@react-starter/ui`, plus a runnable example
that consumes only their public entries. This is the React sibling of `flutter_starter`; keep
the two aligned in ownership and lifecycle rules, not in syntax.

## Architecture

- Follow the ownership and lifecycle rules in the [architecture contract](docs/architecture.md).
- `packages/core` is plain TypeScript: session lifecycle, typed failures and safe diagnostics. It
  imports no React, no state library, no transport client and no app feature.
- `packages/ui` contains React components, layout and accessibility. Apps supply localized text,
  the brand, navigation and feature behaviour.
- The example owns task models, repository reconciliation, transport adapters, context
  composition, the session gate and navigation.
- State uses React's built-in hooks only: context for injection, `useSyncExternalStore` for
  external state, effects for lifecycle. Do not add a state library.
- One services context at the root; session keys isolate accounts, late work, effects and local
  drafts.
- Never put credentials or user payloads in diagnostics; use synthetic data in the example.
- Add abstractions only when a consumer exercises them; no generic CRUD framework.

## Validation

- `tool/architecture.json` defines checked ownership; the architecture contract owns the component
  map and lifecycle rules. Change both together when deliberately moving a boundary.
- Run the touched package's tests (`npx vitest run packages/core`, `packages/ui`, `example` or
  `tool`); reserve the full `tool/check.sh` for releases and cross-package or `tool/` changes.
- Rebuild (`npm run build`) after changing a package before running the example or its tests.
- Add meaningful tests for lifecycle races, stale responses, cleanup and component interaction.
- Keep documentation explicit about fake authentication, missing production adapters and
  real-browser validation.
- Do not publish packages, create remote repositories or deploy without user direction.

## Workflow

Preserve unrelated files. Use plain language and no emojis. Do not predict implementation timelines.
