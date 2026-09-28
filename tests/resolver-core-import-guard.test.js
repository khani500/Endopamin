// Guard: no production code (api/, src/) may import anything under core/.
// core/ is publisher-owned (EndopaminRegistry scripts/publishRegistry.mjs) and
// stays unused until an explicit activation decision. See CLAUDE.md.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as espree from 'espree';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['api', 'src'];
const SCAN_EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs']);
const TS_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const SKIP_RE = /\.(test|spec|fixture)\./;

// 17 (ES2026) is the highest numeric ecmaVersion espree 11.2.0 accepts.
const PARSE_OPTIONS = {
  ecmaVersion: 17,
  sourceType: 'module',
  ecmaFeatures: { jsx: true },
  loc: true,
};

function isInside(parent, target) {
  const rel = path.relative(parent, target);
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith('..' + path.sep);
}

function literalValue(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

function walk(node, visit) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range') continue;
    const value = node[key];
    if (value && typeof value === 'object') walk(value, visit);
  }
}

function checkSpecifier(spec, importer, root) {
  const coreDir = path.join(root, 'core');
  if (spec === 'espree' || spec.startsWith('espree/')) {
    return { resolved: null, reason: 'production code must not import espree' };
  }
  if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
    const resolved = path.resolve(path.dirname(importer), spec);
    return { resolved, reason: isInside(coreDir, resolved) ? 'relative path resolves into core/' : null };
  }
  if (spec === 'core' || spec.startsWith('core/')) {
    return { resolved: null, reason: 'bare "core" specifier' };
  }
  if (spec.startsWith('/')) {
    const hit = spec === '/core' || spec.startsWith('/core/') || isInside(coreDir, path.resolve(spec));
    return { resolved: path.resolve(spec), reason: hit ? 'absolute path into core/' : null };
  }
  return { resolved: null, reason: null };
}

/**
 * Pure: parse sourceText as if it lived at virtualFilePath and check every
 * import/export/require specifier against the core/ boundary.
 * Throws on parse error.
 */
export function analyzeSource(sourceText, virtualFilePath, root) {
  const ast = espree.parse(sourceText, PARSE_OPTIONS);
  const specifiers = [];
  const violations = [];
  const rel = path.relative(root, virtualFilePath);

  const handle = (construct, sourceNode, ownerNode) => {
    const line = (sourceNode || ownerNode).loc.start.line;
    const value = literalValue(sourceNode);
    if (value === null) {
      violations.push({
        file: rel,
        line,
        construct,
        reason: `non-literal specifier (${sourceNode ? sourceNode.type : 'missing'})`,
      });
      return;
    }
    const { resolved, reason } = checkSpecifier(value, virtualFilePath, root);
    specifiers.push({ value, line, construct, resolved });
    if (reason) violations.push({ file: rel, line, construct, specifier: value, reason });
  };

  walk(ast, (node) => {
    switch (node.type) {
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
        handle(node.type, node.source, node);
        break;
      case 'ExportNamedDeclaration':
        if (node.source) handle(node.type, node.source, node);
        break;
      case 'ImportExpression':
        handle(node.type, node.source, node);
        break;
      case 'CallExpression':
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          handle('require()', node.arguments[0], node);
        }
        break;
      default:
        break;
    }
  });

  return { specifiers, violations };
}

function collectFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    // Fail closed: a symlink could reach core/ through a lexically clean path.
    if (entry.isSymbolicLink()) {
      out.symlinks.push(full);
    } else if (entry.isDirectory()) {
      collectFiles(full, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (TS_EXTS.has(ext)) out.ts.push(full);
      else if (SCAN_EXTS.has(ext) && !SKIP_RE.test(entry.name)) out.js.push(full);
    }
  }
  return out;
}

function scanRepo(root) {
  const perDir = {};
  const ts = [];
  const symlinks = [];
  const parseErrors = [];
  const byFile = new Map();
  for (const dir of SCAN_DIRS) {
    const abs = path.join(root, dir);
    const empty = { js: [], ts: [], symlinks: [] };
    const found = fs.existsSync(abs) ? collectFiles(abs, empty) : empty;
    perDir[dir] = { exists: fs.existsSync(abs), files: found.js.length };
    ts.push(...found.ts);
    symlinks.push(...found.symlinks);
    for (const file of found.js) {
      try {
        byFile.set(file, analyzeSource(fs.readFileSync(file, 'utf8'), file, root));
      } catch (err) {
        parseErrors.push(`${path.relative(root, file)}: ${err.message}`);
      }
    }
  }
  return { perDir, ts, symlinks, parseErrors, byFile };
}

const fmt = (v) => `${v.file}:${v.line} ${v.construct} ${v.specifier ?? ''} — ${v.reason}`;

describe('analyzeSource controls (in memory)', () => {
  const apiFile = path.join(ROOT, 'api', 'virtual.js');
  const deepFile = path.join(ROOT, 'src', 'lib', 'deep', 'virtual.js');
  const deepJsx = path.join(ROOT, 'src', 'lib', 'deep', 'virtual.jsx');

  const mustFlag = [
    ['static import', apiFile, "import { pin } from '../core/lib/plan/slotPin.js';"],
    ['side-effect import', deepFile, "import '../../../core/data/x.js';"],
    ['export all', apiFile, "export * from '../core/x.js';"],
    ['export named from', apiFile, "export { a } from '../core/x.js';"],
    ['dynamic import', apiFile, "const m = import('../core/x.js');"],
    ['require', apiFile, "const m = require('../core/x.js');"],
    ['template import without interpolation', apiFile, 'const m = import(`../core/x.js`);'],
    ['computed template import', apiFile, 'const name = "a"; const m = import(`./${name}.js`);'],
    ['computed require', apiFile, 'const someVar = "x"; const m = require(someVar);'],
    ['bare core specifier', apiFile, "import x from 'core/lib/plan/x.js';"],
    ['absolute /core specifier', apiFile, "import x from '/core/x.js';"],
    ['espree from production', deepFile, "import * as espree from 'espree';"],
  ];

  for (const [label, file, code] of mustFlag) {
    it(`flags: ${label}`, () => {
      const { violations } = analyzeSource(code, file, ROOT);
      expect(violations.length, label).toBeGreaterThan(0);
    });
  }

  const mustNotFlag = [
    ['normal relative import', apiFile, "import { v } from '../src/lib/profileValidation.js';"],
    ['data string "core"', apiFile, "export const m = { muscle: 'core' };"],
    ['commented import', apiFile, "// import x from '../core/a.js';\nexport const y = 1;"],
    ['string that looks like an import', apiFile, `export const s = "import('../core/x')";`],
    ['corex sibling directory', apiFile, "import a from '../corex/a.js';"],
    ['JSX className core', deepJsx, 'export const C = () => <div className="core" />;'],
  ];

  for (const [label, file, code] of mustNotFlag) {
    it(`does not flag: ${label}`, () => {
      const { violations } = analyzeSource(code, file, ROOT);
      expect(violations).toEqual([]);
    });
  }

  it('collectFiles records symlinks and does not follow them', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-core-guard-'));
    try {
      const regular = path.join(tmp, 'regular.js');
      const link = path.join(tmp, 'link.js');
      fs.writeFileSync(regular, 'export const a = 1;\n');
      fs.symlinkSync(regular, link);
      const out = collectFiles(tmp, { js: [], ts: [], symlinks: [] });
      expect(out.symlinks).toEqual([link]);
      expect(out.js).toEqual([regular]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('production surface scan (api/, src/)', () => {
  const scan = scanRepo(ROOT);

  it('contains no TypeScript files (espree cannot parse them)', () => {
    expect(scan.ts.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it('contains no symlinks under api/ or src/', () => {
    expect(scan.symlinks.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it('parses every production file', () => {
    expect(scan.parseErrors).toEqual([]);
  });

  it('is not vacuous', () => {
    for (const dir of SCAN_DIRS) {
      expect(scan.perDir[dir].exists, `${dir}/ exists`).toBe(true);
      expect(scan.perDir[dir].files, `${dir}/ scanned files`).toBeGreaterThan(0);
    }

    let total = 0;
    for (const result of scan.byFile.values()) total += result.specifiers.length;
    expect(total).toBeGreaterThan(0);

    const app = scan.byFile.get(path.join(ROOT, 'src', 'App.jsx'));
    expect(app, 'src/App.jsx scanned').toBeDefined();
    expect(app.specifiers.some((s) => s.construct === 'ImportExpression')).toBe(true);

    const saveProfile = scan.byFile.get(path.join(ROOT, 'api', 'save-profile.js'));
    expect(saveProfile, 'api/save-profile.js scanned').toBeDefined();
    const target = path.join(ROOT, 'src', 'lib', 'profileValidation.js');
    expect(saveProfile.specifiers.some((s) => s.resolved === target)).toBe(true);
  });

  it('has zero core/ boundary violations', () => {
    const violations = [];
    for (const result of scan.byFile.values()) violations.push(...result.violations);
    expect(violations.map(fmt)).toEqual([]);
  });
});
