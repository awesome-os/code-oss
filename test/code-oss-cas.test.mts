import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildLaunchPlan,
  ensureGhostAbiAddonPath,
  fetchGhostIndex,
  getCodeOssAppAssetKey,
  getElectronAssetKey,
  getGhostAbiAssetKey,
  parseCliArgs,
  resolveElectronEntry,
  resolveGhostAbiEntry,
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

test('CLI --version and --dry-run execute cleanly and resolve CAS plan', async () => {
  const versionOut = execFileSync(process.execPath, [CLI_PATH, '--version'], {
    encoding: 'utf8',
  }).trim();
  assert.match(versionOut, /^@awesome-os\/code-oss 0\.1\.0 /);
  assert.ok(versionOut.includes(getElectronAssetKey()));
  assert.ok(versionOut.includes(getCodeOssAppAssetKey()));
  assert.ok(versionOut.includes(getGhostAbiAssetKey()));

  const dryRunOut = execFileSync(process.execPath, [CLI_PATH, '--dry-run', 'workspace'], {
    encoding: 'utf8',
  });
  const plan = JSON.parse(dryRunOut) as Awaited<ReturnType<typeof buildLaunchPlan>>;
  assert.equal(plan.backend, 'upstream');
  assert.equal(plan.electron.assetKey, getElectronAssetKey());
  assert.match(plan.electron.sha256, /^[a-f0-9]{64}$/);
  assert.equal(plan.ghostAbi.assetKey, getGhostAbiAssetKey());
  assert.match(plan.ghostAbi.sha256, /^[a-f0-9]{64}$/);
  assert.ok(plan.codeOssApp.status === 'resolved' || plan.codeOssApp.status === 'pending-ingest');
  assert.deepEqual(plan.forwardArgs, ['workspace']);
});
