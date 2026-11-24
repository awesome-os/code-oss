#!/usr/bin/env node
/**
 * @file src/cli.mts
 * @description Zero-duplication `code-oss` CLI:
 *   - Default / `--upstream`: hydrates shared Electron + debloated Code - OSS `resources/app`
 *     + `b8g-ghost-abi-<os>.node` from `awesome-os/b8g-ghost @ cas-v1`, injects
 *     `B8G_GHOST_ABI_PATH` and `B8G_GHOST_CAS_DIR`, and launches:
 *       `electron <cas>/code-oss/<sha256>/resources/app [user args]`
 *   - `--sectium` / `CODE_OSS_BACKEND=sectium`: routes via `sectium-electron` instead of
 *     upstream Electron.
 *   - `--dry-run`: resolves CAS entries and prints the launch plan JSON without spawning.
 *   - `--version` / `-v`: prints version and platform CAS keys.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureCodeOssApp,
  ensureElectronBinary,
  ensureGhostAbiAddonPath,
  fetchGhostIndex,
  getCodeOssAppAssetKey,
  getElectronAssetKey,
  getElectronExecutableRelPath,
  getGhostAbiAssetKey,
  getGhostCacheDir,
  resolveElectronEntry,
  resolveGhostAbiEntry,
  tryResolveCodeOssAppEntry,
} from './hydrate.mts';

export interface ParsedCliArgs {
  backend: 'sectium' | 'upstream';
  dryRun: boolean;
  showVersion: boolean;
  showHelp: boolean;
  forwardArgs: string[];
}

export interface LaunchPlan {
  version: string;
  backend: 'sectium' | 'upstream';
  cacheDir: string;
  electron: {
    assetKey: string;
    sha256: string;
    bytes: number;
    executablePath: string;
    sectiumEntrypoint: string | null;
  };
  codeOssApp: {
    assetKey: string;
    status: 'resolved' | 'pending-ingest';
    sha256: string | null;
    bytes: number | null;
    appVersion: string | null;
    appDir: string | null;
  };
  ghostAbi: {
    assetKey: string;
    sha256: string;
    bytes: number;
    addonPath: string;
  };
  forwardArgs: string[];
}

export function getPackageVersion(): string {
  try {
    const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.1.0';
  } catch {
    return '0.1.0';
  }
}

export function parseCliArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): ParsedCliArgs {
  const forwardArgs: string[] = [];
  let backendOverride: 'sectium' | 'upstream' | undefined;
  let dryRun = false;
  let showVersion = false;
  let showHelp = false;
  let passthrough = false;

  for (const arg of argv) {
    if (!passthrough && arg === '--') {
      passthrough = true;
      forwardArgs.push(arg);
      continue;
    }
    if (!passthrough && arg === '--sectium') {
      backendOverride = 'sectium';
      continue;
    }
    if (!passthrough && arg === '--upstream') {
      backendOverride = 'upstream';
      continue;
    }
    if (!passthrough && arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (!passthrough && (arg === '--version' || arg === '-v')) {
      showVersion = true;
      continue;
    }
    if (!passthrough && (arg === '--help' || arg === '-h')) {
      showHelp = true;
      continue;
    }
    forwardArgs.push(arg);
  }

  const envBackend = (env.CODE_OSS_BACKEND ?? env.ELECTRON_BACKEND)?.trim().toLowerCase();
  const backend: 'sectium' | 'upstream' =
    backendOverride === 'sectium' || (backendOverride !== 'upstream' && envBackend === 'sectium')
      ? 'sectium'
      : 'upstream';

  return { backend, dryRun, showVersion, showHelp, forwardArgs };
}

export function resolveSectiumEntrypoint(): string | null {
  const req = createRequire(import.meta.url);
  for (const specifier of ['sectium-electron/cli', 'sectium-electron/src/cli.mts']) {
    try {
      return req.resolve(specifier);
    } catch {
      // Try next candidate
    }
  }
  try {
    const pkgPath = req.resolve('sectium-electron/package.json');
    const pkgDir = dirname(pkgPath);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      bin?: string | Record<string, string>;
      main?: string;
    };
    const binRel =
      typeof pkg.bin === 'string'
        ? pkg.bin
        : pkg.bin?.['sectium-electron'] ?? pkg.bin?.electron ?? pkg.main;
    if (binRel) {
      const candidate = resolve(pkgDir, binRel);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  } catch {
    // sectium-electron not installed in module resolution path
  }
  return null;
}

export async function buildLaunchPlan(parsed: ParsedCliArgs): Promise<LaunchPlan> {
  const idx = await fetchGhostIndex();
  const cacheDir = getGhostCacheDir();

  const electronKey = getElectronAssetKey();
  const codeOssKey = getCodeOssAppAssetKey();
  const ghostAbiKey = getGhostAbiAssetKey();

  const [electronEntry, codeOssEntry, ghostAbiEntry] = await Promise.all([
    resolveElectronEntry(electronKey, idx),
    tryResolveCodeOssAppEntry(codeOssKey, idx),
    resolveGhostAbiEntry(ghostAbiKey, idx),
  ]);

  const electronExec = join(cacheDir, 'electron', electronEntry.sha256, getElectronExecutableRelPath());
  const codeOssAppDir = codeOssEntry
    ? join(cacheDir, 'code-oss', codeOssEntry.sha256, 'resources', 'app')
    : null;
  const ghostAbiPath = join(cacheDir, 'ghost-abi', ghostAbiEntry.sha256, ghostAbiEntry.filename);

  return {
    version: getPackageVersion(),
    backend: parsed.backend,
    cacheDir,
    electron: {
      assetKey: electronKey,
      sha256: electronEntry.sha256,
      bytes: electronEntry.bytes,
      executablePath: electronExec,
      sectiumEntrypoint: parsed.backend === 'sectium' ? resolveSectiumEntrypoint() : null,
    },
    codeOssApp: {
      assetKey: codeOssKey,
      status: codeOssEntry ? 'resolved' : 'pending-ingest',
      sha256: codeOssEntry?.sha256 ?? null,
      bytes: codeOssEntry?.bytes ?? null,
      appVersion: codeOssEntry?.version ?? null,
      appDir: codeOssAppDir,
    },
    ghostAbi: {
      assetKey: ghostAbiKey,
      sha256: ghostAbiEntry.sha256,
      bytes: ghostAbiEntry.bytes,
      addonPath: ghostAbiPath,
    },
    forwardArgs: parsed.forwardArgs,
  };
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const parsed = parseCliArgs(argv);

  if (parsed.showVersion) {
    console.log(
      `@awesome-os/code-oss ${getPackageVersion()} (${process.platform}/${process.arch} | electron=${getElectronAssetKey()} | app=${getCodeOssAppAssetKey()} | abi=${getGhostAbiAssetKey()})`,
    );
    return;
  }

  if (parsed.showHelp) {
    console.log(
      [
        `code-oss ${getPackageVersion()} — Telemetry-free Code - OSS on shared Electron + b8g-ghost CAS`,
        '',
        'Usage: code-oss [options] [files/folders...]',
        '',
        'Options:',
        '  --sectium     Route through sectium-electron instead of shared upstream Electron',
        '  --upstream    Force shared upstream Electron from b8g-ghost cas-v1 (default)',
        '  --dry-run     Resolve CAS entries and print launch plan JSON without launching',
        '  -v, --version Print version and platform CAS asset keys',
        '  -h, --help    Show this help message',
      ].join('\n'),
    );
    return;
  }

  if (parsed.dryRun) {
    const plan = await buildLaunchPlan(parsed);
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (parsed.backend === 'sectium') {
    const sectiumEntry = resolveSectiumEntrypoint();
    if (!sectiumEntry) {
      console.error(
        [
          '[awesome-os/code-oss] Sectium backend requested (--sectium / CODE_OSS_BACKEND=sectium),',
          'but `sectium-electron` is not installed in this workspace.',
          '',
          'Install the sovereign Sectium Electron runtime:',
          '  pnpm add github:awesome-os/sectium-electron',
          '',
          'Or run on shared debloated upstream Electron:',
          '  code-oss --upstream [args]',
        ].join('\n'),
      );
      process.exit(1);
    }

    const [codeOssApp, ghostAbi] = await Promise.all([
      ensureCodeOssApp(),
      ensureGhostAbiAddonPath(),
    ]);

    if (process.env.CODE_OSS_VERBOSE === '1') {
      console.error(
        `[awesome-os/code-oss] sectium=${sectiumEntry} app=${codeOssApp.appDir} ghostAbi=${ghostAbi.addonPath}`,
      );
    }

    const child = spawn(process.execPath, [sectiumEntry, codeOssApp.appDir, ...parsed.forwardArgs], {
      stdio: 'inherit',
      windowsHide: false,
      env: {
        ...process.env,
        B8G_GHOST_ABI_PATH: ghostAbi.addonPath,
        B8G_GHOST_CAS_DIR: ghostAbi.cacheDir,
      },
    });

    child.on('close', (code) => {
      process.exit(code ?? 0);
    });
    return;
  }

  const [electron, codeOssApp, ghostAbi] = await Promise.all([
    ensureElectronBinary(),
    ensureCodeOssApp(),
    ensureGhostAbiAddonPath(),
  ]);

  if (process.env.CODE_OSS_VERBOSE === '1') {
    console.error(
      `[awesome-os/code-oss] electron=${electron.executablePath} (cacheHit=${electron.cacheHit})`,
    );
    console.error(
      `[awesome-os/code-oss] app=${codeOssApp.appDir} (cacheHit=${codeOssApp.cacheHit})`,
    );
    console.error(
      `[awesome-os/code-oss] ghostAbi=${ghostAbi.addonPath} (cacheHit=${ghostAbi.cacheHit})`,
    );
  }

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    B8G_GHOST_ABI_PATH: ghostAbi.addonPath,
    B8G_GHOST_CAS_DIR: ghostAbi.cacheDir,
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv.VSCODE_IPC_HOOK;
  delete childEnv.VSCODE_PID;

  const child = spawn(electron.executablePath, [codeOssApp.appDir, ...parsed.forwardArgs], {
    stdio: 'inherit',
    windowsHide: false,
    env: childEnv,
  });

  child.on('close', (code) => {
    process.exit(code ?? 0);
  });
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  await runCli();
}
