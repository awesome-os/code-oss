/**
 * @file src/hydrate.mts
 * @description Resolves and hydrates:
 *   (a) Shared debloated Electron (`electron-<os>.tar.zst`) into `~/.b8g/cas/electron/<sha256>/`,
 *   (b) Debloated telemetry-free Code - OSS `resources/app` (`code-oss-app-<os>.tar.zst`)
 *       into `~/.b8g/cas/code-oss/<sha256>/resources/app/`,
 *   (c) Native `b8g-ghost-abi-<os>.node` into `~/.b8g/cas/ghost-abi/<sha256>/`
 *       for `B8G_GHOST_ABI_PATH` injection,
 *   (d) Wave 2 TypeScript `6.0.3` (`typescript-6.0.3-programmable.tar.gz`, 14.3x faster Zero-AST CAS)
 *       into `~/.b8g/cas/typescript/<sha256>/` for `AWESOME_OS_TYPESCRIPT_TSDK` / `TYPESCRIPT_TSDK`, and
 *   (e) Shared Awesome-OS extension directory (`~/.b8g/cas/extensions/`) with the 5 default
 *       Awesome-OS bundled extensions (`stealifylang-vscode` + 4 studio extensions).
 *
 * All artifacts are SHA-256 verified against `awesome-os/b8g-ghost @ cas-v1` (Keep-Last-5).
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const GHOST_INDEX_URL =
  process.env.B8G_GHOST_INDEX_URL ??
  'https://raw.githubusercontent.com/awesome-os/b8g-ghost/main/manifests/index.json';

export const GHOST_CAS_BASE_URL =
  process.env.B8G_GHOST_CAS_URL ??
  'https://github.com/awesome-os/b8g-ghost/releases/download/cas-v1';

export interface GhostCasHistoryItem {
  sha256: string;
  bytes: number;
  version?: string;
  retired_at?: string;
}

export interface GhostCasEntry {
  filename: string;
  sha256: string;
  bytes: number;
  raw_bytes?: number;
  version?: string;
  category?: string;
  download_url: string;
  history?: GhostCasHistoryItem[];
}

export interface GhostIndex {
  schema: string;
  cas_base_url: string;
  updated_at: string;
  total_entries: number;
  entries: Record<string, GhostCasEntry>;
}

export interface HydratedElectronResult {
  entry: GhostCasEntry;
  installDir: string;
  executablePath: string;
  cacheHit: boolean;
}

export interface HydratedCodeOssAppResult {
  entry: GhostCasEntry;
  installDir: string;
  appDir: string;
  cacheHit: boolean;
}

export interface HydratedGhostAbiResult {
  entry: GhostCasEntry;
  addonPath: string;
  cacheDir: string;
  cacheHit: boolean;
}

export interface HydratedTypeScriptResult {
  entry: GhostCasEntry;
  installDir: string;
  tsdkDir: string;
  cacheHit: boolean;
}

export interface BundledExtensionSpec {
  id: string;
  repo: string;
  description: string;
}

export const AWESOME_OS_BUNDLED_EXTENSIONS: readonly BundledExtensionSpec[] = Object.freeze([
  {
    id: 'stealifylang-vscode',
    repo: 'awesome-os/stealifylang-vscode',
    description:
      'StealifyLang LSP, stealify-lint (B8G001-B8G016), .stealify-rules, and governance project rules',
  },
  {
    id: 'unreal-ghost',
    repo: 'awesome-os/unreal-vscode',
    description: 'UE5 UBT + .NET 11 + ghost-llvm + ghost-winsdk',
  },
  {
    id: 'godot-ghost',
    repo: 'awesome-os/godot-vscode',
    description: 'Godot 4.7.2 + .NET 11 + GDScript/C#',
  },
  {
    id: 'blender-ghost',
    repo: 'awesome-os/blender-vscode',
    description: 'Blender 5.3.0 + bpy hot-reload',
  },
  {
    id: 'obs-ghost',
    repo: 'awesome-os/obs-vscode',
    description: 'OBS 33.0.3 + HTML5 overlay hot-reload',
  },
]);

export interface HydratedCodeOssStack {
  electron: HydratedElectronResult;
  codeOssApp: HydratedCodeOssAppResult;
  ghostAbi: HydratedGhostAbiResult;
  typescript: HydratedTypeScriptResult;
  extensionsDir: string;
}

let cachedIndex: GhostIndex | null = null;

export function getGhostCacheDir(): string {
  const dir = process.env.B8G_GHOST_CACHE_DIR ?? join(homedir(), '.b8g', 'cas');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getSharedExtensionsDir(): string {
  return process.env.B8G_SHARED_EXTENSIONS_DIR ?? join(getGhostCacheDir(), 'extensions');
}

export function ensureSharedExtensionsDir(): string {
  const dir = getSharedExtensionsDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getTypeScriptAssetKey(): string {
  return 'typescript-6.0.3-programmable.tar.gz';
}

export function getElectronAssetKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  if (platform === 'win32') return 'electron-win64.tar.zst';
  if (platform === 'darwin') return 'electron-macos-arm64.tar.zst';
  return arch === 'arm64' ? 'electron-linux-arm64.tar.zst' : 'electron-linux-x64.tar.zst';
}

export function getElectronExecutableRelPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return 'electron.exe';
  if (platform === 'darwin') return join('Electron.app', 'Contents', 'MacOS', 'Electron');
  return 'electron';
}

export function getCodeOssAppAssetKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  if (platform === 'win32') return 'code-oss-app-win64.tar.zst';
  if (platform === 'darwin') return 'code-oss-app-macos-arm64.tar.zst';
  return arch === 'arm64' ? 'code-oss-app-linux-arm64.tar.zst' : 'code-oss-app-linux-x64.tar.zst';
}

export function getGhostAbiAssetKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  if (platform === 'win32') return 'b8g-ghost-abi-win64.node';
  if (platform === 'darwin') return 'b8g-ghost-abi-macos-arm64.node';
  return arch === 'arm64' ? 'b8g-ghost-abi-linux-arm64.node' : 'b8g-ghost-abi-linux-x64.node';
}

export async function fetchGhostIndex(forceRefresh = false): Promise<GhostIndex> {
  if (cachedIndex && !forceRefresh) {
    return cachedIndex;
  }
  const cacheFile = join(getGhostCacheDir(), 'index.json');
  try {
    const res = await fetch(GHOST_INDEX_URL, {
      headers: { 'User-Agent': 'awesome-os-code-oss/0.1.0' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${GHOST_INDEX_URL}`);
    }
    const json = (await res.json()) as GhostIndex;
    try {
      const tmp = `${cacheFile}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(json, null, 2), 'utf8');
      renameSync(tmp, cacheFile);
    } catch {
      // Non-fatal if cache write races
    }
    cachedIndex = json;
    return json;
  } catch (err) {
    if (existsSync(cacheFile)) {
      cachedIndex = JSON.parse(readFileSync(cacheFile, 'utf8')) as GhostIndex;
      return cachedIndex;
    }
    throw err;
  }
}

function applyKeepLast5Pin(entry: GhostCasEntry, pinnedSha?: string): GhostCasEntry {
  const sha = pinnedSha?.trim();
  if (!sha || sha === entry.sha256) {
    return entry;
  }
  const hist = entry.history?.find((h) => h.sha256 === sha);
  if (hist) {
    return {
      ...entry,
      sha256: hist.sha256,
      bytes: hist.bytes,
      version: hist.version ?? entry.version,
      download_url: `${GHOST_CAS_BASE_URL}/${hist.sha256}`,
    };
  }
  return entry;
}

export async function resolveElectronEntry(
  assetKey = getElectronAssetKey(),
  index?: GhostIndex,
): Promise<GhostCasEntry> {
  const idx = index ?? (await fetchGhostIndex());
  const entry = idx.entries[assetKey];
  if (!entry) {
    throw new Error(
      `Electron asset "${assetKey}" not found in b8g-ghost cas-v1 index (${idx.total_entries} entries)`,
    );
  }
  return applyKeepLast5Pin(entry, process.env.ELECTRON_GHOST_SHA256);
}

export async function tryResolveCodeOssAppEntry(
  assetKey = getCodeOssAppAssetKey(),
  index?: GhostIndex,
): Promise<GhostCasEntry | null> {
  const idx = index ?? (await fetchGhostIndex());
  const entry = idx.entries[assetKey];
  if (!entry) {
    return null;
  }
  return applyKeepLast5Pin(entry, process.env.CODE_OSS_GHOST_SHA256);
}

export async function resolveCodeOssAppEntry(
  assetKey = getCodeOssAppAssetKey(),
  index?: GhostIndex,
): Promise<GhostCasEntry> {
  const idx = index ?? (await fetchGhostIndex());
  const entry = await tryResolveCodeOssAppEntry(assetKey, idx);
  if (!entry) {
    throw new Error(
      `Code - OSS app asset "${assetKey}" not found in b8g-ghost cas-v1 index (${idx.total_entries} entries). Run ingest-code-oss-cas.yml in awesome-os/b8g-ghost to publish it.`,
    );
  }
  return entry;
}

export async function resolveGhostAbiEntry(
  assetKey = getGhostAbiAssetKey(),
  index?: GhostIndex,
): Promise<GhostCasEntry> {
  const idx = index ?? (await fetchGhostIndex());
  const entry = idx.entries[assetKey];
  if (!entry) {
    throw new Error(
      `Ghost ABI addon "${assetKey}" not found in b8g-ghost cas-v1 index (${idx.total_entries} entries)`,
    );
  }
  return entry;
}

export async function resolveTypeScriptEntry(
  assetKey = getTypeScriptAssetKey(),
  index?: GhostIndex,
): Promise<GhostCasEntry> {
  const idx = index ?? (await fetchGhostIndex());
  const entry = idx.entries[assetKey];
  if (!entry) {
    throw new Error(
      `TypeScript asset "${assetKey}" not found in b8g-ghost cas-v1 index (${idx.total_entries} entries)`,
    );
  }
  return applyKeepLast5Pin(entry, process.env.TYPESCRIPT_GHOST_SHA256);
}

function emitProgress(percent: number, message: string): void {
  if (process.env.CODE_OSS_PROGRESS === '1') {
    const pct = Math.max(0, Math.min(100, Math.round(percent)));
    process.stdout.write(`GHOST_PROGRESS ${pct} ${message}\n`);
  }
}

async function downloadVerifiedBlob(
  entry: GhostCasEntry,
  destPath: string,
  pctStart = 10,
  pctEnd = 80,
): Promise<boolean> {
  if (existsSync(destPath)) {
    const actual = createHash('sha256').update(readFileSync(destPath)).digest('hex');
    if (actual === entry.sha256) {
      emitProgress(pctEnd, `Warm CAS hit: ${entry.filename}`);
      return true;
    }
  }

  emitProgress(pctStart, `Hydrating ${entry.filename}...`);
  const url = entry.download_url || `${GHOST_CAS_BASE_URL}/${entry.sha256}`;
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'awesome-os-code-oss/0.1.0' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} hydrating ${entry.filename} from ${url}`);
  }

  const totalBytes = Number(res.headers.get('content-length') ?? entry.bytes ?? 0);
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastPct = -1;

  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        if (totalBytes > 0) {
          const frac = Math.min(1, received / totalBytes);
          const curPct = Math.round(pctStart + frac * (pctEnd - pctStart));
          if (curPct !== lastPct) {
            lastPct = curPct;
            const mbDone = (received / 1048576).toFixed(1);
            const mbTot = (totalBytes / 1048576).toFixed(1);
            emitProgress(curPct, `Downloading ${entry.filename} (${mbDone} / ${mbTot} MB)`);
          }
        }
      }
    }
  } else {
    chunks.push(new Uint8Array(await res.arrayBuffer()));
  }

  emitProgress(pctEnd, `Verifying SHA-256 for ${entry.filename}...`);
  const buf = Buffer.concat(chunks);
  const actual = createHash('sha256').update(buf).digest('hex');
  if (actual !== entry.sha256) {
    throw new Error(
      `SHA-256 mismatch for ${entry.filename}: expected ${entry.sha256}, got ${actual}`,
    );
  }

  const tmp = `${destPath}.${process.pid}.tmp`;
  writeFileSync(tmp, buf);
  renameSync(tmp, destPath);
  return false;
}

export async function ensureElectronBinary(
  assetKey = getElectronAssetKey(),
): Promise<HydratedElectronResult> {
  const entry = await resolveElectronEntry(assetKey);
  const cacheDir = getGhostCacheDir();
  const installDir = join(cacheDir, 'electron', entry.sha256);
  const executablePath = join(installDir, getElectronExecutableRelPath());

  if (existsSync(executablePath)) {
    emitProgress(45, `Warm CAS hit: shared Electron ${entry.version ?? ''}`.trim());
    return { entry, installDir, executablePath, cacheHit: true };
  }

  const archivePath = join(cacheDir, `${entry.sha256}.tar.zst`);
  await downloadVerifiedBlob(entry, archivePath, 10, 42);

  emitProgress(46, `Extracting shared Electron ${entry.version ?? ''}...`.trim());
  mkdirSync(installDir, { recursive: true });
  execFileSync('tar', ['--zstd', '-xf', archivePath, '-C', installDir], { stdio: 'inherit' });

  if (!existsSync(executablePath)) {
    throw new Error(`Extracted Electron archive missing expected binary: ${executablePath}`);
  }

  emitProgress(52, 'Shared Electron ready');
  return { entry, installDir, executablePath, cacheHit: false };
}

export async function ensureCodeOssApp(
  assetKey = getCodeOssAppAssetKey(),
): Promise<HydratedCodeOssAppResult> {
  const entry = await resolveCodeOssAppEntry(assetKey);
  const cacheDir = getGhostCacheDir();
  const installDir = join(cacheDir, 'code-oss', entry.sha256);
  const appDir = join(installDir, 'resources', 'app');
  const pkgMarker = join(appDir, 'package.json');

  if (existsSync(pkgMarker)) {
    emitProgress(88, `Warm CAS hit: Code - OSS ${entry.version ?? ''}`.trim());
    return { entry, installDir, appDir, cacheHit: true };
  }

  const archivePath = join(cacheDir, `${entry.sha256}.tar.zst`);
  await downloadVerifiedBlob(entry, archivePath, 55, 84);

  emitProgress(88, `Extracting Code - OSS ${entry.version ?? ''}...`.trim());
  mkdirSync(appDir, { recursive: true });
  execFileSync('tar', ['--zstd', '-xf', archivePath, '-C', appDir], { stdio: 'inherit' });

  const nestedAppDir = join(appDir, 'resources', 'app');
  if (!existsSync(pkgMarker) && existsSync(join(nestedAppDir, 'package.json'))) {
    emitProgress(96, 'Code - OSS workbench ready');
    return { entry, installDir, appDir: nestedAppDir, cacheHit: false };
  }

  if (!existsSync(pkgMarker)) {
    throw new Error(`Extracted Code - OSS archive missing expected package.json at ${pkgMarker}`);
  }

  emitProgress(96, 'Code - OSS workbench ready');
  return { entry, installDir, appDir, cacheHit: false };
}

export async function ensureGhostAbiAddonPath(
  assetKey = getGhostAbiAssetKey(),
): Promise<HydratedGhostAbiResult> {
  const entry = await resolveGhostAbiEntry(assetKey);
  const cacheDir = getGhostCacheDir();
  const addonDir = join(cacheDir, 'ghost-abi', entry.sha256);
  const addonPath = join(addonDir, entry.filename);

  mkdirSync(addonDir, { recursive: true });
  const cacheHit = await downloadVerifiedBlob(entry, addonPath);

  return { entry, addonPath, cacheDir, cacheHit };
}

function resolveExtractedTsdkDir(installDir: string): string {
  const candidates = [
    join(installDir, 'lib'),
    join(installDir, 'package', 'lib'),
    installDir,
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'tsserver.js')) || existsSync(join(dir, 'typescript.js'))) {
      return dir;
    }
  }
  return join(installDir, 'lib');
}

export async function ensureFastTypeScript(
  assetKey = getTypeScriptAssetKey(),
): Promise<HydratedTypeScriptResult> {
  const entry = await resolveTypeScriptEntry(assetKey);
  const cacheDir = getGhostCacheDir();
  const installDir = join(cacheDir, 'typescript', entry.sha256);
  const existingTsdk = resolveExtractedTsdkDir(installDir);

  if (
    existsSync(join(existingTsdk, 'tsserver.js')) ||
    existsSync(join(existingTsdk, 'typescript.js'))
  ) {
    emitProgress(98, `Warm CAS hit: Wave 2 TypeScript ${entry.version ?? '6.0.3'}`);
    return { entry, installDir, tsdkDir: existingTsdk, cacheHit: true };
  }

  const archivePath = join(cacheDir, `${entry.sha256}.tar.gz`);
  await downloadVerifiedBlob(entry, archivePath, 90, 96);

  emitProgress(97, `Extracting Wave 2 TypeScript ${entry.version ?? '6.0.3'}...`);
  mkdirSync(installDir, { recursive: true });
  execFileSync('tar', ['-xzf', archivePath, '-C', installDir], { stdio: 'inherit' });

  const tsdkDir = resolveExtractedTsdkDir(installDir);
  emitProgress(99, 'Wave 2 TypeScript 6.0.3 ready');
  return { entry, installDir, tsdkDir, cacheHit: false };
}

export async function hydrateCodeOssStack(): Promise<HydratedCodeOssStack> {
  const [electron, codeOssApp, ghostAbi, typescript] = await Promise.all([
    ensureElectronBinary(),
    ensureCodeOssApp(),
    ensureGhostAbiAddonPath(),
    ensureFastTypeScript(),
  ]);
  const extensionsDir = ensureSharedExtensionsDir();
  return { electron, codeOssApp, ghostAbi, typescript, extensionsDir };
}
