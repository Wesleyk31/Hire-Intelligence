#!/usr/bin/env node
/**
 * Prepare source artifacts for a NEW isolated AppDeploy staging app.
 * This does not deploy, install packages, authenticate, seed data or invoke cron.
 * Files are complete UTF-8 contents; the deploy caller must diff template files
 * against the exact fresh scaffold and follow current AppDeploy instructions.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_FILES = [
  'index.html', 'package.json', 'pnpm-lock.yaml', 'postcss.config.js',
  'tailwind.config.js', 'tsconfig.json', 'tsconfig.backend.json', 'vite.config.ts',
];
const EXCLUDED_RULES = [
  'tests/runtime/**', 'tests/browser/**', 'tests/unit/**', 'types/**',
  'vite.verification.config.ts', 'vitest.config.ts', 'playwright.config.ts',
  'public/resources/approved-homepage.jpg', 'docs/**', 'hardening/**',
  'node_modules/**', 'dist/**', '.local/**', 'tmp/**', 'test-results/**',
  '.git/**', '.agents/**', '.codex/**', '.env*', 'scripts/**',
  'tests/tests.txt (existing-app update contract; unchanged)',
  'All other files outside the explicit allowlist',
];
const SOURCE_EXTENSIONS = /\.(?:[cm]?tsx?|jsx?|css|json|svg)$/i;
const OMIT_DIRS = new Set(['node_modules', 'dist', '.local', '__tests__', '__fixtures__']);
const comparePath = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const digest = value => createHash('sha256').update(value).digest('hex');
const toPosix = value => value.split(path.sep).join('/');
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const requireText = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' must be nonempty text');
};
function validateTests(tests) {
  if (!Array.isArray(tests) || tests.length < 3 || tests.length > 5) {
    throw new Error('Staging tests must be a bare JSON array of 3–5 independent workflows');
  }
  const names = new Set();
  for (const test of tests) {
    if (!test || typeof test !== 'object' || Array.isArray(test)) throw new Error('Invalid test entry');
    for (const key of ['name', 'description', 'expected']) requireText(test[key], 'Test ' + key);
    if (names.has(test.name)) throw new Error('Staging test names must be unique');
    names.add(test.name);
    if (!['desktop', 'mobile'].includes(test.viewport)) throw new Error('Test viewport must be desktop or mobile');
    for (const key of ['covers', 'steps']) {
      if (!Array.isArray(test[key]) || !test[key].length) throw new Error('Test ' + key + ' must be a nonempty array');
      for (const item of test[key]) requireText(item, 'Test ' + key + ' item');
    }
    if (test.sanity !== undefined && typeof test.sanity !== 'boolean') throw new Error('sanity must be boolean');
    const allowed = new Set(['name', 'viewport', 'covers', 'description', 'steps', 'expected', 'sanity', 'setup', 'qa_faults']);
    for (const key of Object.keys(test)) if (!allowed.has(key)) throw new Error('Unsupported staging test field: ' + key);
    if(test.setup!==undefined)throw new Error('Validate prerequisite setup against the current platform contract');
    if(test.qa_faults!==undefined){
      if(!Array.isArray(test.qa_faults)||!test.qa_faults.length)throw new Error('Faults must be a nonempty array');
      for(const fault of test.qa_faults){
        if(fault.method!=='GET'||typeof fault.path!=='string'||!fault.path.startsWith('/api/')||!Number.isInteger(fault.status)||fault.status<400||fault.status>599||!fault.body_json||typeof fault.body_json!=='object')throw new Error('Only explicit read-only API fault responses are allowed');
      }
    }
  }
  if (tests.filter(test => test.sanity === true).length !== 1) throw new Error('Staging tests require exactly one sanity workflow');
}
async function readSource(projectRoot, relative) {
  const absolute = path.join(projectRoot, relative);
  const before = await fs.lstat(absolute);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Source must be a regular file: ' + relative);
  const bytes = await fs.readFile(absolute);
  const after = await fs.lstat(absolute);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Source changed during read; rerun after edits settle: ' + relative);
  const content = decoder.decode(bytes);
  if (content.includes('\0')) throw new Error('Binary content is excluded: ' + relative);
  return { content, sourceSha256: digest(bytes) };
}
async function walkSources(projectRoot, directory) {
  const absolute = path.join(projectRoot, directory);
  const info = await fs.lstat(absolute);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Source directory must not be a link: ' + directory);
  const result = [];
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => comparePath(a.name, b.name))) {
    if (entry.name.startsWith('.') || OMIT_DIRS.has(entry.name)) continue;
    const relative = directory + '/' + entry.name;
    if (entry.isSymbolicLink()) throw new Error('Linked source is excluded: ' + relative);
    if (entry.isDirectory()) result.push(...await walkSources(projectRoot, relative));
    else if (entry.isFile() && SOURCE_EXTENSIONS.test(entry.name) && !/\.(test|spec)\./i.test(entry.name)) result.push(relative);
  }
  return result;
}
export async function collectRelease(projectRoot) {
  const root = path.resolve(projectRoot);
  const paths = [...ROOT_FILES, ...await walkSources(root, 'src'), ...await walkSources(root, 'backend')];
  const resources = path.join(root, 'public/resources');
  const resourceDirectory = await fs.lstat(resources);
  if (!resourceDirectory.isDirectory() || resourceDirectory.isSymbolicLink()) throw new Error('Resources must be a real directory');
  for (const file of await fs.readdir(resources, { withFileTypes: true })) {
    if (/\.svg$/i.test(file.name)) {
      if (!file.isFile() || file.isSymbolicLink()) throw new Error('SVG asset must be a regular file');
      paths.push('public/resources/' + file.name);
    }
  }
  if (!paths.some(name => name.endsWith('.svg'))) throw new Error('Replacement SVG artwork is required');
  const staged = [];
  for (const sourcePath of paths.sort(comparePath)) {
    const source = await readSource(root, sourcePath);
    if (sourcePath === 'package.json') {
      const pkg = JSON.parse(source.content);
      for (const bucket of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        if (Object.keys(pkg[bucket] || {}).some(name => name.startsWith('@appdeploy/'))) {
          throw new Error('Do not bundle a platform-provided SDK dependency in package.json');
        }
      }
    }
    if ((sourcePath.startsWith('src/') || sourcePath.startsWith('backend/') || sourcePath === 'vite.config.ts') &&
        /tests[\\/]runtime|vite\.verification|hire-test-user|\/__qa(?:\/|['"])/i.test(source.content)) {
      throw new Error('Production source references a synthetic runtime: ' + sourcePath);
    }
    if (sourcePath.endsWith('.svg') &&
        /<(?:script|foreignObject)\b|(?:href|xlink:href)\s*=\s*["'](?!#)/i.test(source.content)) {
      throw new Error('Staging artwork must be self-contained SVG: ' + sourcePath);
    }
    staged.push({ path: sourcePath, sourcePath, ...source });
  }
  const testSource = await readSource(root, 'tests/staging/tests.json');
  const tests = JSON.parse(testSource.content);
  validateTests(tests);
  staged.push({ path: 'tests/tests.json', sourcePath: 'tests/staging/tests.json', ...testSource });
  const cronSource = await readSource(root, 'cron.json');
  staged.push({
    path: 'cron.json', sourcePath: 'cron.json', content: '[]\n',
    sourceSha256: cronSource.sourceSha256,
    transformation: 'New isolated staging only: disable every scheduled job',
  });
  staged.sort((a, b) => comparePath(a.path, b.path));
  const files = staged.map(({ path: name, content }) => ({ path: name, content }));
  const fileManifest = staged.map(({ path: name, sourcePath, content, sourceSha256, transformation }) => ({
    path: name, sourcePath, bytes: Buffer.byteLength(content, 'utf8'),
    sha256: digest(Buffer.from(content, 'utf8')), sourceSha256,
    ...(transformation ? { transformation } : {}),
  }));
  const manifest = {
    schemaVersion: 1,
    target: 'new-isolated-appdeploy-staging',
    format: 'Complete UTF-8 source files; not a deployment tool request',
    bundleSha256: digest(JSON.stringify(fileManifest.map(file => [file.path, file.sha256]))),
    fileCount: files.length,
    totalBytes: fileManifest.reduce((sum, file) => sum + file.bytes, 0),
    workflowCount: tests.length, sanityTestCount: 1, cronDisabled: true,
    sdk: 'Use the platform-provided SDK; no SDK dependency or synthetic implementation included',
    exclusions: EXCLUDED_RULES,
    files: fileManifest,
  };
  return { manifest, files };
}
async function assertOutputPath(projectRoot, outputDirectory) {
  const localRoot = path.join(projectRoot, '.local');
  const output = path.resolve(projectRoot, outputDirectory);
  const relative = path.relative(localRoot, output);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Output must be a child directory under this project .local');
  }
  // Reject existing directory/file links before writing across any boundary.
  for (let current = localRoot; ; ) {
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Output path cannot use a link: ' + current); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current === output) break;
    const remaining = path.relative(current, output).split(path.sep);
    current = path.join(current, remaining[0]);
  }
  return output;
}
async function main() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  let outputDirectory = '.local/release-staging', checkOnly = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--check') checkOnly = true;
    else if (args[index] === '--out' && args[index + 1]) outputDirectory = args[++index];
    else throw new Error('Usage: node scripts/prepare-release.mjs [--check] [--out .local/release-staging]');
  }
  const { manifest, files } = await collectRelease(projectRoot);
  let output;
  if (!checkOnly) {
    output = await assertOutputPath(projectRoot, outputDirectory);
    await fs.mkdir(output, { recursive: true });
    for (const [name, data] of [['manifest.json', manifest], ['files.json', files]]) {
      const destination = path.join(output, name);
      try { if ((await fs.lstat(destination)).isSymbolicLink()) throw new Error('Artifact cannot overwrite a link'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.writeFile(destination, JSON.stringify(data, null, 2) + '\n', 'utf8');
    }
  }
  console.log(JSON.stringify({
    mode: checkOnly ? 'validated-only' : 'source-artifacts-written',
    ...(output ? { output: toPosix(path.relative(projectRoot, output)) } : {}),
    fileCount: manifest.fileCount, totalBytes: manifest.totalBytes,
    workflowCount: manifest.workflowCount, cronDisabled: true,
    bundleSha256: manifest.bundleSha256,
    deploymentPerformed: false,
  }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
