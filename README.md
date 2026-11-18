# React starter

Reusable packages named **core** and **ui**, with a task example that consumes their public
entries. It is the React sibling of the Flutter starter and keeps the same ownership rules, with
React's built-in hooks in place of a state library.

The project targets Node **22**, React **19** and TypeScript in strict mode. `.nvmrc` records the
Node pin; `package-lock.json` records dependency resolution.

| Location        | Owns                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/core` | Framework-free session lifecycle, revocable session handles, typed failures, safe diagnostics                           |
| `packages/ui`   | Theme tokens, layout, accessible controls, loading/error surfaces and interaction states                                |
| `example`       | App bootstrap, context composition, task models, repository reconciliation, synthetic backend, navigation, local drafts |
| `tool`          | Formatting, type checks, boundary checks, tests, independent consumer verification                                      |

Neither package depends on a state library, and `core` does not depend on React. The example
injects its services through one context at the root and reads external state with
`useSyncExternalStore`. Task caches, optimistic completion, idempotency and conflict rules belong
to the example feature.

## Run and verify

```sh
npm ci
bash tool/check.sh     # the full gate
npm run dev            # build the packages, then serve the example
```

`tool/check.sh` runs, in order: Prettier, the TypeScript build of all three workspaces, a type
check of the tests, the architecture check, every test (including the checker's negative
fixtures), the independent consumer, and a production build of the example.

Run one part while working:

```sh
npm run build          # tsc -b: packages first, then the example
npm test               # all tests
npx vitest run packages/core
npm run boundaries
npm run verify:consumer
```

The example imports the packages through their built output, so run `npm run build` (or
`tsc -b --watch`) after changing a package.

Unit and component tests run in Node and jsdom. They do not establish real-browser behaviour,
assistive-technology behaviour, or anything about a real server.

## Consume from another app

The packages are private and unpublished. From a sibling checkout, depend on them by path:

```json
{
  "dependencies": {
    "@react-starter/core": "file:../react_starter/packages/core",
    "@react-starter/ui": "file:../react_starter/packages/ui"
  }
}
```

Use the public entries only:

```ts
import { SessionCoordinator, AppFailure } from '@react-starter/core';
import { UiTheme, PageSurface, ActionButton } from '@react-starter/ui';
import '@react-starter/ui/styles.css'; // once, at the app root
```

Each package's `exports` field makes every other path unimportable, and
`tool/verify_consumer.mjs` proves it from a throwaway project.

The names are scoped because unscoped `core` and `ui` already exist on the public npm registry;
a scope removes any chance of installing someone else's package by mistake.

## What is real and what is not

- Accounts are synthetic: "A" and "B", with no authentication.
- The server is in memory, with simulated latency and two failure modes for the recovery flows.
- There is no URL router; navigation is state inside the session boundary.
- There is no production adapter for transport, storage or credentials.

See [the architecture contract](docs/architecture.md) for ownership, lifecycle rules and what the
checks do and do not prove.
