import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkArchitecture, inspectSource } from '../check_boundaries.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const policy = JSON.parse(readFileSync(join(repo, 'tool', 'architecture.json'), 'utf8'));

/** A minimal tree that satisfies the real policy. Each test breaks exactly one thing. */
const baseline = {
  'package.json': JSON.stringify({ workspaces: ['packages/core', 'packages/ui', 'example'] }),
  'packages/core/package.json': JSON.stringify({
    name: '@react-starter/core',
    exports: { '.': './dist/index.js' },
  }),
  'packages/core/src/index.ts': `export * from './failure.js';\n`,
  'packages/core/src/failure.ts': `export type FailureKind = 'unexpected';\n`,
  'packages/ui/package.json': JSON.stringify({
    name: '@react-starter/ui',
    exports: { '.': './dist/index.js', './styles.css': './styles.css' },
    peerDependencies: { react: '^19.0.0' },
  }),
  'packages/ui/src/index.tsx': `import type { ReactNode } from 'react';\nexport function Box({ children }: { children?: ReactNode }) {\n  return <div className="box" style={{ margin: 0 }}>{children}</div>;\n}\n`,
  'example/src/l10n/strings.ts': `import type { FailureKind } from '@react-starter/core';\nexport const label = (kind: FailureKind) => kind;\n`,
  'example/src/design_system/branding.ts': `export const seed = '#315b54';\n`,
  'example/src/features/tasks/domain/task.ts': `import type { FailureKind } from '@react-starter/core';\nexport type Task = { id: string; failure?: FailureKind };\n`,
  'example/src/features/tasks/infrastructure/api.ts': `import type { Task } from '../domain/task';\nexport const load = async (): Promise<Task[]> => (await fetch('/tasks')).json();\n`,
  'example/src/features/tasks/presentation/Screen.tsx': `import { Box } from '@react-starter/ui';\nimport { useState } from 'react';\nimport type { Task } from '../domain/task';\nimport { label } from '../../../l10n/strings';\nexport function Screen() {\n  const [task] = useState<Task | null>(null);\n  return <Box>{task?.failure ? label(task.failure) : null}</Box>;\n}\n`,
  'example/src/app/App.tsx': `import { StrictMode } from 'react';\nimport { load } from '../features/tasks/infrastructure/api';\nimport { Screen } from '../features/tasks/presentation/Screen';\nimport { seed } from '../design_system/branding';\nexport function App() {\n  void load;\n  void seed;\n  void document.title;\n  return (\n    <StrictMode>\n      <Screen />\n    </StrictMode>\n  );\n}\n`,
};

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tree(changes = {}) {
  const root = mkdtempSync(join(tmpdir(), 'boundaries-'));
  roots.push(root);
  for (const [path, content] of Object.entries({ ...baseline, ...changes })) {
    if (content === null) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const rulesFor = (changes, file) =>
  checkArchitecture({ root: tree(changes), policy })
    .filter((violation) => !file || violation.file === file)
    .map((violation) => violation.rule);

const presentation = 'example/src/features/tasks/presentation/Screen.tsx';
const domain = 'example/src/features/tasks/domain/task.ts';

describe('checkArchitecture', () => {
  it('accepts the baseline tree and the real repository', () => {
    expect(checkArchitecture({ root: tree(), policy })).toEqual([]);
    expect(checkArchitecture({ root: repo, policy })).toEqual([]);
  });

  it('rejects a layer reaching a layer it may not depend on, by any import form', () => {
    const forms = [
      `import { load } from '../infrastructure/api';\nexport const x = load;\n`,
      `import type { load } from '../infrastructure/api';\nexport type X = typeof load;\n`,
      `export { load } from '../infrastructure/api';\n`,
      `export * from '../infrastructure/api';\n`,
      `export const x = () => import('../infrastructure/api');\n`,
      `export type X = import('../infrastructure/api').Missing;\n`,
    ];
    for (const source of forms)
      expect(rulesFor({ [presentation]: source }, presentation), source).toEqual(['layer']);
    expect(
      rulesFor({
        'packages/core/src/failure.ts': `import '@react-starter/ui';\nexport type FailureKind = 'unexpected';\n`,
      }),
    ).toEqual(['layer']);
    expect(
      rulesFor(
        {
          [domain]: `import { Box } from '@react-starter/ui';\nexport type Task = { id: string; box: typeof Box };\n`,
        },
        domain,
      ),
    ).toEqual(['layer']);
  });

  it('rejects external packages that are not allowlisted for the layer', () => {
    expect(
      rulesFor(
        {
          [domain]: `import { useState } from 'react';\nexport type Task = { id: string; s: typeof useState };\n`,
        },
        domain,
      ),
    ).toEqual(['external-package']);
    expect(
      rulesFor(
        {
          [domain]: `const fs = require('node:fs');\nexport type Task = { id: string; fs: typeof fs };\n`,
        },
        domain,
      ),
    ).toEqual(['external-package']);
    expect(rulesFor({ 'packages/ui/src/index.tsx': `export * from 'left-pad';\n` })).toEqual([
      'external-package',
    ]);
    expect(
      rulesFor(
        {
          [presentation]: `import { createRoot } from 'react-dom/client';\nexport const x = createRoot;\n`,
        },
        presentation,
      ),
    ).toEqual(['external-package']);
  });

  it('rejects reaching past a package public entry, by name or by path', () => {
    expect(
      rulesFor(
        {
          [domain]: `import type { FailureKind } from '@react-starter/core/src/failure';\nexport type Task = { id: string; f: FailureKind };\n`,
        },
        domain,
      ),
    ).toEqual(['internal-access']);
    expect(
      rulesFor(
        {
          [domain]: `import type { FailureKind } from '../../../../../packages/core/src/failure';\nexport type Task = { id: string; f: FailureKind };\n`,
        },
        domain,
      ),
    ).toEqual(['cross-package']);
    expect(
      rulesFor({ 'packages/core/src/index.ts': `export * from '@react-starter/core';\n` }),
    ).toEqual(['self-import']);
  });

  it('rejects coupling between features', () => {
    const other = 'example/src/features/billing/domain/invoice.ts';
    expect(
      rulesFor(
        {
          [other]: `import type { Task } from '../../tasks/domain/task';\nexport type Invoice = { task: Task };\n`,
        },
        other,
      ),
    ).toEqual(['cross-feature']);
  });

  it('rejects markup and styling outside the ui package', () => {
    expect(
      rulesFor({ [presentation]: `export const Screen = () => <div>raw</div>;\n` }, presentation),
    ).toEqual(['markup']);
    expect(
      rulesFor(
        {
          [presentation]: `import { Box } from '@react-starter/ui';\nexport const Screen = () => <Box className="x" />;\n`,
        },
        presentation,
      ),
    ).toEqual(['markup']);
    expect(
      rulesFor(
        { 'example/src/app/App.tsx': `export const App = () => <main style={{ margin: 0 }} />;\n` },
        'example/src/app/App.tsx',
      ),
    ).toEqual(['markup', 'markup']);
  });

  it('rejects platform globals outside infrastructure and composition, without false positives on local names', () => {
    expect(
      rulesFor(
        { [presentation]: `export const where = () => window.location.href;\n` },
        presentation,
      ),
    ).toEqual(['platform']);
    expect(
      rulesFor(
        {
          [domain]: `export type Task = { id: string };\nexport const save = () => localStorage.setItem('a', 'b');\n`,
        },
        domain,
      ),
    ).toEqual(['platform']);
    expect(
      rulesFor({
        'packages/core/src/failure.ts': `export type FailureKind = 'unexpected';\nexport const get = () => fetch('/x');\n`,
      }),
    ).toEqual(['platform']);
    // A property or a local binding with the same name is not the global.
    const local = `export type Task = { id: string; document: string };\nexport const read = (history: string[]) => {\n  const location = history.at(-1);\n  return { location, window: 1, text: ({} as { document: string }).document };\n};\n`;
    expect(rulesFor({ [domain]: local }, domain)).toEqual([]);
  });

  it('restricts which React symbols presentation may import', () => {
    expect(
      rulesFor(
        {
          [presentation]: `import { createElement } from 'react';\nexport const Screen = () => createElement('div');\n`,
        },
        presentation,
      ),
    ).toEqual(['react-symbol']);
    expect(
      rulesFor(
        {
          [presentation]: `import React from 'react';\nexport const Screen = () => React.createElement('div');\n`,
        },
        presentation,
      ),
    ).toEqual(['react-symbol']);
    expect(
      rulesFor(
        {
          [presentation]: `import * as React from 'react';\nexport const Screen = () => React.createElement('div');\n`,
        },
        presentation,
      ),
    ).toEqual(['react-symbol']);
  });

  it('rejects files it cannot classify or resolve', () => {
    const stray = 'example/src/misc/helper.ts';
    expect(rulesFor({ [stray]: `export const x = 1;\n` }, stray)).toEqual(['unclassified']);
    expect(
      rulesFor(
        {
          [domain]: `import { gone } from './missing';\nexport type Task = { id: string; g: typeof gone };\n`,
        },
        domain,
      ),
    ).toEqual(['missing-dependency']);
    expect(
      rulesFor(
        {
          [domain]: `const name = './task';\nexport const lazy = () => import(name);\nexport type Task = { id: string };\n`,
        },
        domain,
      ),
    ).toEqual(['unresolvable-import']);
    expect(rulesFor({ [domain]: `export type Task = {` }, domain)).toEqual(['parse']);
  });

  it('rejects dependency cycles', () => {
    const other = 'example/src/features/tasks/domain/status.ts';
    const violations = checkArchitecture({
      root: tree({
        [domain]: `import type { Status } from './status';\nexport type Task = { id: string; status: Status };\n`,
        [other]: `import type { Task } from './task';\nexport type Status = { of: Task };\n`,
      }),
      policy,
    });
    expect(violations.map((violation) => violation.rule)).toEqual(['cycle']);
    expect(violations[0].message).toContain('status.ts -> ');
  });

  it('rejects source symlinks instead of following them', () => {
    const root = tree();
    symlinkSync(
      join(root, 'packages/core/src/failure.ts'),
      join(root, 'example/src/features/tasks/domain/linked.ts'),
    );
    expect(checkArchitecture({ root, policy }).map((violation) => violation.rule)).toEqual([
      'symlink',
    ]);
  });

  it('rejects manifests that drift from the policy', () => {
    const corePackage = (extra) =>
      JSON.stringify({
        name: '@react-starter/core',
        exports: { '.': './dist/index.js' },
        ...extra,
      });
    expect(
      rulesFor({
        'packages/core/package.json': corePackage({ dependencies: { react: '^19.0.0' } }),
      }),
    ).toEqual(['manifest']);
    expect(
      rulesFor({
        'packages/core/package.json': corePackage({
          exports: { '.': './dist/index.js', './session': './dist/session.js' },
        }),
      }),
    ).toEqual(['manifest']);
    expect(rulesFor({ 'packages/core/package.json': corePackage({ name: 'core' }) })).toEqual([
      'manifest',
    ]);
    expect(
      rulesFor({ 'package.json': JSON.stringify({ workspaces: ['packages/core', 'example'] }) }),
    ).toEqual(['workspaces']);
  });
});

describe('inspectSource', () => {
  it('collects every form of module reference', () => {
    const facts = inspectSource(
      `import a from 'a';\nimport type { B } from 'b';\nexport { c } from 'c';\nexport * from 'd';\nconst e = import('e');\nconst f = require('f');\ntype G = import('g').G;\nimport h = require('h');\n`,
      'x.ts',
    );
    expect(facts.specifiers.sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });
});
