import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AWESOME_OS_BUNDLED_EXTENSIONS,
  buildLaunchPlan,
  ensureFastTypeScript,
  ensureGhostAbiAddonPath,
  ensureSharedExtensionsDir,
  fetchGhostIndex,
  getCodeOssAppAssetKey,
  getElectronAssetKey,
  getGhostAbiAssetKey,
  getSharedExtensionsDir,
  getTypeScriptAssetKey,
  parseCliArgs,
  resolveElectronEntry,
  resolveGhostAbiEntry,
  resolveTypeScriptEntry,
  tryResolveCodeOssAppEntry,
} from '../src/index.mts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_PATH = resolve(REPO_ROOT, 'src', 'cli.mts');

test('resolves shared debloated Electron and b8g-ghost-abi.node from live cas-v1 index', async () => {
  const index = await fetchGhostIndex(true);
  assert.ok(index.total_entries > 0, 'Expected non-empty cas-v1 index');

  const electronKey = getElectronAssetKey();
  const electron = await resolveElectronEntry(electronKey, index);
  assert.equal(electron.filename, electronKey);
  assert.match(electron.sha256, /^[a-f0-9]{64}$/);
  assert.ok(electron.bytes > 10_000_000, 'Expected real shared Electron archive (>10 MB)');

  const abiKey = getGhostAbiAssetKey();
  const abi = await resolveGhostAbiEntry(abiKey, index);
  assert.equal(abi.filename, abiKey);
  assert.match(abi.sha256, /^[a-f0-9]{64}$/);
  assert.ok(abi.bytes > 1_000, 'Expected real native N-API Ghost ABI addon');
});

test('resolves and hydrates Wave 2 TypeScript 6.0.3 (typescript-6.0.3-programmable.tar.gz) from live cas-v1', async () => {
  const index = await fetchGhostIndex();
  const tsKey = getTypeScriptAssetKey();
  assert.equal(tsKey, 'typescript-6.0.3-programmable.tar.gz');

  const tsEntry = await resolveTypeScriptEntry(tsKey, index);
  assert.equal(tsEntry.filename, tsKey);
  assert.match(tsEntry.sha256, /^[a-f0-9]{64}$/);
  assert.ok(tsEntry.bytes > 500_000, 'Expected real Wave 2 TypeScript 6.0.3 archive (>500 KB)');

  const first = await ensureFastTypeScript(tsKey);
  assert.equal(first.entry.sha256, tsEntry.sha256);
  assert.equal(existsSync(first.installDir), true);
  assert.ok(
    existsSync(resolve(first.tsdkDir, 'tsserver.js')) ||
      existsSync(resolve(first.tsdkDir, 'typescript.js')),
    `Expected tsserver.js or typescript.js in ${first.tsdkDir}`,
  );

  const second = await ensureFastTypeScript(tsKey);
  assert.equal(second.tsdkDir, first.tsdkDir);
  assert.equal(second.cacheHit, true);
});

test('exports all 5 Awesome-OS bundled extensions and shared ~/.b8g/cas/extensions directory', () => {
  assert.equal(AWESOME_OS_BUNDLED_EXTENSIONS.length, 5);

  const expected = [
    { id: 'stealifylang-vscode', repo: 'awesome-os/stealifylang-vscode' },
    { id: 'unreal-ghost', repo: 'awesome-os/unreal-vscode' },
    { id: 'godot-ghost', repo: 'awesome-os/godot-vscode' },
    { id: 'blender-ghost', repo: 'awesome-os/blender-vscode' },
    { id: 'obs-ghost', repo: 'awesome-os/obs-vscode' },
  ];

  for (const exp of expected) {
    const found = AWESOME_OS_BUNDLED_EXTENSIONS.find((ext) => ext.id === exp.id);
    assert.ok(found, `Expected bundled extension ${exp.id}`);
    assert.equal(found.repo, exp.repo);
    assert.ok(found.description.length > 0);
  }

  const sharedDir = getSharedExtensionsDir();
  assert.ok(sharedDir.endsWith('extensions'), `Expected extensions dir, got ${sharedDir}`);
  const ensuredDir = ensureSharedExtensionsDir();
  assert.equal(ensuredDir, sharedDir);
  assert.equal(existsSync(ensuredDir), true);
});

test('checks code-oss-app-* entry in live cas-v1 index if published', async () => {
  const index = await fetchGhostIndex();
  const appKey = getCodeOssAppAssetKey();
  const appEntry = await tryResolveCodeOssAppEntry(appKey, index);

  if (appEntry) {
    assert.equal(appEntry.filename, appKey);
    assert.match(appEntry.sha256, /^[a-f0-9]{64}$/);
    assert.ok(appEntry.bytes > 1_000_000, 'Expected real debloated Code - OSS app archive (>1 MB)');
    if (appEntry.raw_bytes) {
      assert.ok(
        appEntry.bytes < appEntry.raw_bytes,
        `Expected debloated app zst (${appEntry.bytes}) < full VSCodium archive (${appEntry.raw_bytes})`,
      );
    }
  } else {
    assert.equal(appEntry, null);
  }
});

test('hydrates b8g-ghost-abi.node live into ~/.b8g/cas/ with SHA-256 verification and cache hit', async () => {
  const expectedKey = getGhostAbiAssetKey();
  const first = await ensureGhostAbiAddonPath(expectedKey);
  assert.equal(first.entry.filename, expectedKey);
  assert.match(first.entry.sha256, /^[a-f0-9]{64}$/);
  assert.equal(existsSync(first.addonPath), true);
  assert.ok(first.addonPath.endsWith('.node'), `Expected .node addon path, got ${first.addonPath}`);

  const second = await ensureGhostAbiAddonPath(expectedKey);
  assert.equal(second.addonPath, first.addonPath);
  assert.equal(second.cacheHit, true);
});

test('parses CLI flags (--sectium, --upstream, --dry-run, --version, passthrough)', () => {
  const sectium = parseCliArgs(['--sectium', '--dry-run', '.', '--', '--version']);
  assert.equal(sectium.backend, 'sectium');
  assert.equal(sectium.dryRun, true);
  assert.equal(sectium.showVersion, false);
  assert.deepEqual(sectium.forwardArgs, ['.', '--', '--version']);

  const envBackend = parseCliArgs(['.'], { CODE_OSS_BACKEND: 'sectium' });
  assert.equal(envBackend.backend, 'sectium');

  const upstreamOverride = parseCliArgs(['--upstream', '.'], { CODE_OSS_BACKEND: 'sectium' });
  assert.equal(upstreamOverride.backend, 'upstream');
});

test('CLI --version and --dry-run execute cleanly and resolve CAS plan with TypeScript & 5 bundled extensions', async () => {
  const versionOut = execFileSync(process.execPath, [CLI_PATH, '--version'], {
    encoding: 'utf8',
  }).trim();
  assert.match(versionOut, /^@awesome-os\/code-oss 0\.1\.0 /);
  assert.ok(versionOut.includes(getElectronAssetKey()));
  assert.ok(versionOut.includes(getCodeOssAppAssetKey()));
  assert.ok(versionOut.includes(getGhostAbiAssetKey()));
  assert.ok(versionOut.includes(getTypeScriptAssetKey()));

  const dryRunOut = execFileSync(process.execPath, [CLI_PATH, '--dry-run', 'workspace'], {
    encoding: 'utf8',
  });
  const plan = JSON.parse(dryRunOut) as Awaited<ReturnType<typeof buildLaunchPlan>>;
  assert.equal(plan.backend, 'upstream');
  assert.equal(plan.electron.assetKey, getElectronAssetKey());
  assert.match(plan.electron.sha256, /^[a-f0-9]{64}$/);
  assert.equal(plan.ghostAbi.assetKey, getGhostAbiAssetKey());
  assert.match(plan.ghostAbi.sha256, /^[a-f0-9]{64}$/);
  assert.equal(plan.typescript.assetKey, 'typescript-6.0.3-programmable.tar.gz');
  assert.match(plan.typescript.sha256, /^[a-f0-9]{64}$/);
  assert.ok(plan.typescript.tsdkDir.includes('typescript'));
  assert.equal(plan.extensionsDir, getSharedExtensionsDir());
  assert.equal(plan.bundledExtensions.length, 5);
  assert.deepEqual(
    plan.bundledExtensions.map((ext) => ext.id),
    ['stealifylang-vscode', 'unreal-ghost', 'godot-ghost', 'blender-ghost', 'obs-ghost'],
  );
  assert.ok(plan.codeOssApp.status === 'resolved' || plan.codeOssApp.status === 'pending-ingest');
  assert.deepEqual(plan.forwardArgs, ['workspace']);
});
