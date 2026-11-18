// Proves the packages work for an app outside this workspace: pack both, install the tarballs into
// a throwaway project, type-check a consumer in strict mode, run it, and confirm that nothing but
// the public entries can be imported. Needs the packages built (`npm run build`) and network or a
// warm npm cache for React and TypeScript.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const versions = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies;
const reactVersion = JSON.parse(readFileSync(join(root, 'example', 'package.json'), 'utf8'))
  .dependencies.react;

const work = mkdtempSync(join(tmpdir(), 'react-starter-consumer-'));
try {
  const tarballs = {};
  for (const name of ['core', 'ui']) {
    const directory = join(root, 'packages', name);
    if (!existsSync(join(directory, 'dist', 'index.js'))) {
      throw new Error(`packages/${name} is not built. Run "npm run build" first.`);
    }
    const [packed] = JSON.parse(
      run('npm', ['pack', '--json', '--pack-destination', work], directory),
    );
    const files = packed.files.map((file) => file.path);
    const unexpected = files.filter(
      (path) => !/^(dist\/|package\.json$|styles\.css$|README\.md$)/.test(path),
    );
    if (unexpected.length > 0)
      throw new Error(`${packed.name} would publish unexpected files: ${unexpected.join(', ')}`);
    if (files.some((path) => /\.test\.|^src\/|^test\//.test(path)))
      throw new Error(`${packed.name} would publish sources or tests`);
    tarballs[packed.name] = `file:${join(work, packed.filename)}`;
  }

  const consumer = join(work, 'consumer');
  run('mkdir', ['-p', join(consumer, 'src')], work);
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify(
      {
        name: 'independent-consumer',
        private: true,
        type: 'module',
        dependencies: { ...tarballs, react: reactVersion, 'react-dom': reactVersion },
        devDependencies: {
          typescript: versions.typescript,
          '@types/react': versions['@types/react'],
          '@types/react-dom': versions['@types/react-dom'],
          '@types/node': versions['@types/node'],
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022', 'DOM'],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        jsx: 'react-jsx',
        strict: true,
        noUncheckedIndexedAccess: true,
        verbatimModuleSyntax: true,
        skipLibCheck: false,
        types: ['node'],
        rootDir: 'src',
        outDir: 'out',
      },
      include: ['src'],
    }),
  );
  writeFileSync(
    join(consumer, 'src', 'main.tsx'),
    `import { AppFailure, Diagnostics, SessionCoordinator, type FailureKind, type SessionState } from '@react-starter/core';
import { ActionButton, AsyncContent, NoticeHost, PageSurface, UiTheme } from '@react-starter/ui';
import { renderToStaticMarkup } from 'react-dom/server';

const records: unknown[] = [];
const coordinator = new SessionCoordinator({ diagnostics: new Diagnostics({ sink: (record) => records.push(record) }) });
const seen: SessionState['status'][] = [];
coordinator.watch((state) => seen.push(state.status));
await coordinator.activate({ accountId: 'consumer' });
const session = coordinator.state.session;
if (!session?.isActive) throw new Error('session did not become ready');
await coordinator.signOut();
if (session.isActive) throw new Error('session was not revoked on sign-out');
const kind: FailureKind = new AppFailure('conflict').kind;
await coordinator.dispose();

const html = renderToStaticMarkup(
  <UiTheme seedColor="#315b54">
    <NoticeHost>
      <PageSurface title="Consumer">
        <AsyncContent loadingLabel="Loading" emptyLabel="Empty" retryLabel="Retry" content={<p>content</p>} />
        <ActionButton label="Go" pendingLabel="Going" onPress={() => {}} />
      </PageSurface>
    </NoticeHost>
  </UiTheme>,
);
if (!html.includes('<h1') || !html.includes('Go') || !html.includes('content')) throw new Error('ui did not render');

// The stylesheet is a public entry; internal files are not reachable by any path.
import.meta.resolve('@react-starter/ui/styles.css');
for (const internal of ['@react-starter/core/dist/session.js', '@react-starter/core/src/session.ts', '@react-starter/ui/dist/theme.js']) {
  let reachable = true;
  try {
    await import(internal);
  } catch {
    reachable = false;
  }
  if (reachable) throw new Error(internal + ' must not be importable');
}
console.log(JSON.stringify({ seen, kind, diagnostics: records.length, rendered: html.length > 0 }));
`,
  );

  run('npm', ['install', '--no-audit', '--no-fund', '--prefer-offline'], consumer);
  run(join(consumer, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json'], consumer);
  const output = JSON.parse(run('node', ['out/main.js'], consumer).trim().split('\n').at(-1));
  const expected = {
    seen: ['signedOut', 'transitioning', 'ready', 'transitioning', 'signedOut', 'closed'],
    kind: 'conflict',
    diagnostics: 1,
    rendered: true,
  };
  if (JSON.stringify(output) !== JSON.stringify(expected)) {
    throw new Error(
      `Consumer output differs.\n expected ${JSON.stringify(expected)}\n received ${JSON.stringify(output)}`,
    );
  }
  console.log(
    'Independent consumer: packed, installed, type-checked and ran against the public entries only.',
  );
} catch (error) {
  console.error(error.stdout || '', error.stderr || '');
  console.error(String(error.message ?? error));
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
