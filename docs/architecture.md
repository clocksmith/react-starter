# Architecture contract

**Status:** Canonical ownership and lifecycle contract for this starter. The task reference is
implemented with synthetic accounts and an in-memory server. Production capabilities need their
own adapters and real-browser evidence; they are not implied by the starter's tests.

## Enforced ownership

| Boundary                 | Path                                         | Allowed responsibility                                                                     |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Domain                   | `example/src/features/*/domain/`             | Types and repository contracts. No React, no platform APIs                                 |
| Application, when needed | `example/src/features/*/application/`        | Business operations over domain contracts, never concrete adapters                         |
| Infrastructure           | `example/src/features/*/infrastructure/`     | API adapters, persistence, repository reconciliation. No React                             |
| Presentation             | `example/src/features/*/presentation/`       | Hooks that project repository state, local drafts, and screens composed from ui components |
| Composition              | `example/src/app/`, `example/src/main.tsx`   | Service creation, context providers, the session gate, navigation, bootstrap               |
| Design system            | `packages/ui/`, `example/src/design_system/` | Visual components, layout, tokens, interaction and accessibility; app branding             |
| Shared domain utilities  | `packages/core/`                             | Sessions, failures, diagnostics                                                            |
| Localization             | `example/src/l10n/`                          | Labels and safe failure-to-text mapping                                                    |

The task flow needs no application layer today: presentation calls the repository contract and
infrastructure owns reconciliation. Add orchestration only when a business rule requires it.

Who may import what:

| Layer          | May import                                        | External packages              |
| -------------- | ------------------------------------------------- | ------------------------------ |
| core           | core                                              | none                           |
| ui             | ui                                                | `react`                        |
| domain         | core, domain                                      | none                           |
| application    | core, domain, application                         | none                           |
| infrastructure | core, domain, infrastructure                      | none                           |
| presentation   | core, ui, domain, application, presentation, l10n | `react` (hooks and types only) |
| composition    | everything                                        | `react`, `react-dom/client`    |
| design         | ui, design                                        | none                           |
| l10n           | core, l10n                                        | none                           |

## What the checker enforces

`tool/architecture.json` is the machine-readable policy. `tool/check_boundaries.mjs` parses every
file under the source roots and checks each import, re-export, dynamic import, `require` and
`import()` type. It rejects:

- a file that belongs to no layer, or to more than one;
- a layer importing a layer it may not depend on, including type-only imports;
- one feature importing another;
- an external package that is not allowlisted for the layer;
- reaching into a package past its public entry, by name or by relative path;
- an import that does not resolve, or whose path is computed;
- dependency cycles between files;
- source symlinks, which are rejected and not followed;
- HTML elements, `className`, `style` or `dangerouslySetInnerHTML` outside the ui package, so
  feature code supplies content and never layout values;
- platform globals (`window`, `document`, `fetch`, storage, `crypto` and others) outside
  infrastructure and composition;
- React imports beyond hooks and types in presentation, so markup cannot be built by hand there;
- package manifests that drift from the policy: dependencies, peer dependencies, public entries
  and the workspace list.

These are syntactic, deterministic checks. They are not a security sandbox, and they cannot prove
that business logic sits in the right layer. Review owns business meaning; behaviour tests own
observable correctness. Do not add exemptions to accommodate misplaced code: change the policy
and this document together when deliberately moving a boundary.

`tool/test/check_boundaries.test.mjs` holds the negative fixtures. Each one breaks a single rule
in a minimal tree and asserts that exactly that rule fires.

## Lifecycle rules

**Sessions.** `SessionCoordinator` owns the account boundary. A switch revokes the current handle
synchronously, runs its cleanups in reverse order, and publishes only the latest request. A
failed cleanup leaves the app in a failed state with no account exposed, and the switch can be
retried. A `SessionKey` identifies one activation: signing in to the same account again is a new
session.

**After every await.** Work that crosses an `await` checks the session before it publishes or
mutates. A response that arrives after an account switch is dropped; a write in flight rejects
with `sessionExpired`.

**The session gate.** `SessionGate` renders the private subtree under a React `key` taken from the
session key. A new session unmounts everything below, including navigation and unsent drafts, so
no state of one account can appear in another.

**Composition.** `ServicesProvider` supplies the coordinator and adapters; tests supply their own.
`SessionScope` creates the concrete repository for a session and closes it when the session ends.
Both it and `StarterRoot` create their objects inside an effect and hold them in state, because
React may mount, unmount and mount again in development and an object created during render
would be closed while still in use.

**External state.** The coordinator and the repository expose `subscribe`/`watch` and a snapshot.
Components read them with `useSyncExternalStore`. A snapshot is the same object until the state
it describes changes; returning a fresh object each time would re-render without end.

**Writes.** A completion is optimistic and carries an operation id and the server's precondition
token. A second tap while one is in flight shares its outcome and sends nothing. A rejected
write rolls back. An uncertain outcome (the response was lost) keeps the operation, makes the
form read-only, and offers a retry of the same operation, which the server treats as idempotent.
A list fetched before a write cannot regress the result of that write.

**Diagnostics.** Events carry an operation, an outcome, a failure category and a duration,
nothing else. The serializer copies only those fields, so free text cannot be smuggled in. A
failing sink never interrupts a user operation.

## Accessibility baseline

Controls are native buttons and form fields with visible focus. Sizes are in `rem`, so the
interface follows the user's text size. Loading uses a labelled progress element. Errors and
notices appear in live regions that are present before any message, so they are announced
without moving focus. Decorative marks are hidden from assistive technology. The component
tests assert roles, names and keyboard operation; they do not replace testing with a real
screen reader.

## Differences from the Flutter starter

| Flutter                                          | React                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Riverpod providers and `ProviderScope` overrides | One services context; tests pass their own services                            |
| `Stream` from the coordinator and repository     | `subscribe`/`watch` plus a stable snapshot, read with `useSyncExternalStore`   |
| `KeyedSubtree(key: ValueKey(session.key))`       | `<Fragment key={session.key.id}>`                                              |
| `SessionKey` value equality                      | Object identity, with a string `id` for React keys                             |
| Synchronous throw from `complete`                | Always a rejected promise, so callers have one error path                      |
| `Navigator` inside the gate                      | Route state inside the gate; add a URL router there when needed                |
| Material widgets and `ThemeExtension`            | React components and CSS variables                                             |
| `dart format`, `flutter analyze`                 | Prettier, `tsc` in strict mode                                                 |
| `check_boundaries.dart`                          | `check_boundaries.mjs`, with markup and platform rules added                   |
| Device integration test                          | Not included; the journey runs in jsdom. A real-browser run is a separate step |
