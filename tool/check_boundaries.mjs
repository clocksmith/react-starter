// Deterministic architecture checks, driven by tool/architecture.json.
//
// It parses every source file and checks each import, re-export, dynamic import, require and
// import type against the ownership policy. These are syntactic checks. They are not a security
// sandbox and they cannot prove that business logic sits in the right layer: review still owns
// meaning, and behaviour tests own observable correctness.
import { parse } from '@babel/parser';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const posix = (path) => path.split(sep).join('/');

function listSourceFiles(root, sourceRoot, extensions, violations) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = posix(relative(root, full));
      const info = lstatSync(full);
      if (info.isSymbolicLink()) {
        violations.push({
          file: rel,
          rule: 'symlink',
          message: 'Source symlinks are rejected, not followed.',
        });
      } else if (info.isDirectory()) {
        walk(full);
      } else if (extensions.some((extension) => name.endsWith(extension))) {
        files.push(rel);
      }
    }
  };
  const start = join(root, sourceRoot);
  if (existsSync(start)) walk(start);
  else
    violations.push({
      file: sourceRoot,
      rule: 'missing-root',
      message: 'Declared source root does not exist.',
    });
  return files;
}

function layerOf(file, policy) {
  const matches = Object.entries(policy.layers)
    .filter(([, layer]) => layer.paths.some((pattern) => new RegExp(pattern).test(file)))
    .map(([name]) => name);
  return matches.length === 1 ? matches[0] : matches.length === 0 ? null : matches;
}

/** Walks a Babel AST with parent links, without a traversal library. */
function walkAst(node, visit, parent = null, key = null) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent, key);
  for (const [childKey, value] of Object.entries(node)) {
    if (childKey === 'loc' || childKey === 'start' || childKey === 'end' || childKey === 'range')
      continue;
    if (Array.isArray(value)) for (const child of value) walkAst(child, visit, node, childKey);
    else if (value && typeof value === 'object') walkAst(value, visit, node, childKey);
  }
}

const literal = (node) =>
  node?.type === 'StringLiteral'
    ? node.value
    : node?.type === 'TemplateLiteral' && node.expressions.length === 0
      ? node.quasis[0].value.cooked
      : null;

/** Everything the policy cares about in one file. */
export function inspectSource(code, file) {
  const ast = parse(code, {
    sourceType: 'module',
    sourceFilename: file,
    plugins: ['typescript', 'jsx'],
    errorRecovery: false,
  });
  const specifiers = [];
  const unresolvable = [];
  const reactImports = [];
  const intrinsicElements = [];
  const markupAttributes = [];
  const identifiers = [];
  const declared = new Set();

  const declare = (pattern) =>
    walkAst(pattern, (node, parent, key) => {
      if (
        node.type === 'Identifier' &&
        !(parent?.type === 'ObjectProperty' && key === 'key' && !parent.computed)
      ) {
        declared.add(node.name);
      }
    });

  walkAst(ast.program, (node, parent, key) => {
    switch (node.type) {
      case 'ImportDeclaration': {
        specifiers.push(node.source.value);
        for (const specifier of node.specifiers) declared.add(specifier.local.name);
        if (node.source.value === 'react') {
          for (const specifier of node.specifiers) {
            reactImports.push(
              specifier.type === 'ImportSpecifier'
                ? (specifier.imported.name ?? specifier.imported.value)
                : specifier.type === 'ImportDefaultSpecifier'
                  ? 'default'
                  : '*',
            );
          }
        }
        break;
      }
      case 'ExportNamedDeclaration':
      case 'ExportAllDeclaration':
        if (node.source) specifiers.push(node.source.value);
        break;
      case 'TSImportType': {
        // Parser versions differ on where the path lives.
        const value =
          literal(node.source) ?? literal(node.argument) ?? literal(node.argument?.literal);
        if (value === null) unresolvable.push('import type');
        else specifiers.push(value);
        break;
      }
      case 'TSImportEqualsDeclaration':
        if (node.moduleReference?.type === 'TSExternalModuleReference') {
          specifiers.push(node.moduleReference.expression.value);
        }
        break;
      case 'ImportExpression': {
        const value = literal(node.source);
        if (value === null) unresolvable.push('dynamic import');
        else specifiers.push(value);
        break;
      }
      case 'CallExpression': {
        const isImport = node.callee.type === 'Import';
        const isRequire = node.callee.type === 'Identifier' && node.callee.name === 'require';
        if (isImport || isRequire) {
          const value = literal(node.arguments[0]);
          if (value === null) unresolvable.push(isImport ? 'dynamic import' : 'require');
          else specifiers.push(value);
        }
        break;
      }
      case 'JSXOpeningElement':
        if (node.name.type === 'JSXIdentifier' && /^[a-z]/.test(node.name.name)) {
          intrinsicElements.push(node.name.name);
        }
        break;
      case 'JSXAttribute':
        if (node.name.type === 'JSXIdentifier') markupAttributes.push(node.name.name);
        break;
      case 'VariableDeclarator':
        declare(node.id);
        break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
      case 'ClassMethod':
      case 'ObjectMethod':
        if (node.id) declared.add(node.id.name);
        for (const param of node.params) declare(param);
        break;
      case 'ClassDeclaration':
        if (node.id) declared.add(node.id.name);
        break;
      case 'CatchClause':
        if (node.param) declare(node.param);
        break;
      case 'Identifier': {
        const isMemberProperty =
          (parent?.type === 'MemberExpression' || parent?.type === 'OptionalMemberExpression') &&
          key === 'property' &&
          !parent.computed;
        const isKey =
          key === 'key' &&
          !parent?.computed &&
          [
            'ObjectProperty',
            'ObjectMethod',
            'ClassProperty',
            'ClassMethod',
            'TSPropertySignature',
            'TSMethodSignature',
          ].includes(parent?.type);
        const isTypeName = [
          'TSQualifiedName',
          'TSTypeReference',
          'TSExpressionWithTypeArguments',
        ].includes(parent?.type);
        const isLabel = ['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(
          parent?.type,
        );
        const isImportName =
          parent?.type?.startsWith('Import') || parent?.type?.startsWith('Export');
        if (!isMemberProperty && !isKey && !isTypeName && !isLabel && !isImportName)
          identifiers.push(node.name);
        break;
      }
    }
  });
  return {
    specifiers,
    unresolvable,
    reactImports,
    intrinsicElements,
    markupAttributes,
    identifiers,
    declared,
  };
}

function resolveRelative(root, fromFile, specifier, extensions) {
  const base = posix(relative(root, resolve(root, dirname(fromFile), specifier)));
  const withoutJs = base.replace(/\.jsx?$/, '');
  const candidates = [
    base,
    ...extensions.map((e) => withoutJs + e),
    ...extensions.map((e) => `${base}/index${e}`),
  ];
  for (const candidate of candidates) {
    const full = join(root, candidate);
    if (existsSync(full) && statSync(full).isFile()) return candidate;
  }
  return null;
}

function workspaceOf(file, policy) {
  return (
    policy.workspaces.find((workspace) => file === workspace || file.startsWith(`${workspace}/`)) ??
    null
  );
}

const featureOf = (file) => /\/features\/([^/]+)\//.exec(file)?.[1] ?? null;

function checkManifests(root, policy, violations) {
  const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
  const rootManifest = readJson('package.json');
  const declared = [...(rootManifest.workspaces ?? [])].sort();
  if (JSON.stringify(declared) !== JSON.stringify([...policy.workspaces].sort())) {
    violations.push({
      file: 'package.json',
      rule: 'workspaces',
      message: `Workspace list ${JSON.stringify(declared)} does not match the checked roots ${JSON.stringify(policy.workspaces)}.`,
    });
  }
  for (const [name, spec] of Object.entries(policy.workspacePackages)) {
    const path = `${spec.root}/package.json`;
    const manifest = readJson(path);
    const same = (actual, expected) =>
      JSON.stringify(Object.keys(actual ?? {}).sort()) === JSON.stringify([...expected].sort());
    if (manifest.name !== name)
      violations.push({ file: path, rule: 'manifest', message: `Expected package name ${name}.` });
    if (!same(manifest.dependencies, spec.dependencies)) {
      violations.push({
        file: path,
        rule: 'manifest',
        message: `Runtime dependencies must be exactly ${JSON.stringify(spec.dependencies)}.`,
      });
    }
    if (!same(manifest.peerDependencies, spec.peerDependencies)) {
      violations.push({
        file: path,
        rule: 'manifest',
        message: `Peer dependencies must be exactly ${JSON.stringify(spec.peerDependencies)}.`,
      });
    }
    if (!same(manifest.exports, spec.entries)) {
      violations.push({
        file: path,
        rule: 'manifest',
        message: `Public entries must be exactly ${JSON.stringify(spec.entries)}; internal files stay unreachable.`,
      });
    }
  }
}

function findCycle(graph) {
  const state = new Map();
  const stack = [];
  const visit = (file) => {
    state.set(file, 'open');
    stack.push(file);
    for (const next of graph.get(file) ?? []) {
      if (state.get(next) === 'open') return [...stack.slice(stack.indexOf(next)), next];
      if (!state.has(next)) {
        const cycle = visit(next);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    state.set(file, 'done');
    return null;
  };
  for (const file of [...graph.keys()].sort()) {
    if (!state.has(file)) {
      const cycle = visit(file);
      if (cycle) return cycle;
    }
  }
  return null;
}

/** Returns every violation of `policy` under `root`. An empty list means the tree conforms. */
export function checkArchitecture({ root, policy }) {
  const violations = [];
  const files = policy.sourceRoots.flatMap((sourceRoot) =>
    listSourceFiles(root, sourceRoot, policy.extensions, violations),
  );
  const fileSet = new Set(files);
  const graph = new Map();
  const report = (file, rule, message) => violations.push({ file, rule, message });

  checkManifests(root, policy, violations);

  for (const file of files) {
    const layerName = layerOf(file, policy);
    if (layerName === null) {
      report(file, 'unclassified', 'File is under a checked root but belongs to no layer.');
      continue;
    }
    if (Array.isArray(layerName)) {
      report(file, 'unclassified', `File matches more than one layer: ${layerName.join(', ')}.`);
      continue;
    }
    const layer = policy.layers[layerName];
    let facts;
    try {
      facts = inspectSource(readFileSync(join(root, file), 'utf8'), file);
    } catch (error) {
      report(file, 'parse', `Could not parse: ${error.message}`);
      continue;
    }
    const edges = new Set();
    graph.set(file, edges);

    for (const kind of facts.unresolvable) {
      report(file, 'unresolvable-import', `A ${kind} with a computed path cannot be checked.`);
    }

    for (const specifier of facts.specifiers) {
      if (specifier.startsWith('.')) {
        const target = resolveRelative(root, file, specifier, policy.extensions);
        if (target === null) {
          report(
            file,
            'missing-dependency',
            `Relative import "${specifier}" does not resolve to a file.`,
          );
          continue;
        }
        if (workspaceOf(target, policy) !== workspaceOf(file, policy)) {
          report(
            file,
            'cross-package',
            `"${specifier}" reaches into another package by path. Import its public name instead.`,
          );
          continue;
        }
        if (!fileSet.has(target)) {
          report(
            file,
            'unclassified',
            `"${specifier}" resolves to ${target}, which is outside the checked source roots.`,
          );
          continue;
        }
        edges.add(target);
        const targetLayer = layerOf(target, policy);
        if (typeof targetLayer !== 'string') continue; // reported for that file itself
        if (!layer.dependsOn.includes(targetLayer)) {
          report(file, 'layer', `${layerName} may not depend on ${targetLayer} ("${specifier}").`);
        }
        const from = featureOf(file);
        const to = featureOf(target);
        if (from && to && from !== to) {
          report(
            file,
            'cross-feature',
            `Feature "${from}" may not import feature "${to}" ("${specifier}").`,
          );
        }
        continue;
      }
      const owner = Object.entries(policy.workspacePackages).find(
        ([name]) => specifier === name || specifier.startsWith(`${name}/`),
      );
      if (owner) {
        const [name, spec] = owner;
        const entry = specifier === name ? '.' : `.${specifier.slice(name.length)}`;
        if (!spec.entries.includes(entry)) {
          report(file, 'internal-access', `"${specifier}" is not a public entry of ${name}.`);
        }
        if (workspaceOf(file, policy) === spec.root) {
          report(file, 'self-import', `${name} must import its own files by relative path.`);
        } else if (!layer.dependsOn.includes(spec.layer)) {
          report(file, 'layer', `${layerName} may not depend on ${spec.layer} ("${specifier}").`);
        }
        continue;
      }
      if (!layer.packages.includes(specifier)) {
        report(
          file,
          'external-package',
          `${layerName} may not import "${specifier}". Allowed: ${JSON.stringify(layer.packages)}.`,
        );
      }
    }

    if (layer.reactSymbols) {
      for (const name of facts.reactImports) {
        if (!layer.reactSymbols.includes(name)) {
          report(
            file,
            'react-symbol',
            `${layerName} may not import "${name}" from react. Allowed: ${layer.reactSymbols.join(', ')}.`,
          );
        }
      }
    }

    if (!layer.markup) {
      for (const element of new Set(facts.intrinsicElements)) {
        report(
          file,
          'markup',
          `${layerName} may not render <${element}>. Compose ui components instead.`,
        );
      }
      for (const attribute of new Set(facts.markupAttributes)) {
        if (policy.markupAttributes.includes(attribute)) {
          report(
            file,
            'markup',
            `${layerName} may not set "${attribute}". Layout and styling belong to the ui package.`,
          );
        }
      }
    }

    if (!layer.platform) {
      for (const name of new Set(facts.identifiers)) {
        if (policy.platformGlobals.includes(name) && !facts.declared.has(name)) {
          report(file, 'platform', `${layerName} may not use the platform global "${name}".`);
        }
      }
    }
  }

  const cycle = findCycle(graph);
  if (cycle) report(cycle[0], 'cycle', `Dependency cycle: ${cycle.join(' -> ')}`);

  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const policy = JSON.parse(readFileSync(join(root, 'tool', 'architecture.json'), 'utf8'));
  const violations = checkArchitecture({ root, policy });
  if (violations.length === 0) {
    console.log('Architecture boundaries hold.');
  } else {
    for (const violation of violations)
      console.error(`${violation.file}: [${violation.rule}] ${violation.message}`);
    console.error(
      `\n${violations.length} boundary violation(s). Fix the code; do not add exemptions.`,
    );
    process.exit(1);
  }
}
