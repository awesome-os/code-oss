#!/usr/bin/env node
/**
 * @file src/cli.mts
 * @description Zero-duplication `code-oss` CLI:
 *   - Default / `--upstream`: hydrates shared Electron + debloated Code - OSS `resources/app`
 *     + `b8g-ghost-abi-<os>.node` + Wave 2 TypeScript `6.0.3` (`typescript-6.0.3-programmable.tar.gz`)
 *     from `awesome-os/b8g-ghost @ cas-v1`, prepares `~/.b8g/cas/extensions/` for the 5 bundled
 *     Awesome-OS extensions, injects `B8G_GHOST_ABI_PATH`, `B8G_GHOST_CAS_DIR`,
 *     `AWESOME_OS_TYPESCRIPT_TSDK`, `TYPESCRIPT_TSDK`, `B8G_SHARED_EXTENSIONS_DIR`, and
 *     `AWESOME_OS_BUNDLED_EXTENSIONS`, and launches:
 *       `electron <cas>/code-oss/<sha256>/resources/app [user args]`
 *   - `--sectium` / `CODE_OSS_BACKEND=sectium`: routes via `sectium-electron` instead of
 *     upstream Electron.
 *   - `--dry-run`: resolves CAS entries and prints the launch plan JSON without spawning.
 *   - `--version` / `-v`: prints version and platform CAS keys.
 */

import { spawn } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AWESOME_OS_BUNDLED_EXTENSIONS,
  ensureCodeOssApp,
  ensureElectronBinary,
  ensureFastTypeScript,
  ensureGhostAbiAddonPath,
  ensureSharedExtensionsDir,
  fetchGhostIndex,
  getCodeOssAppAssetKey,
  getElectronAssetKey,
  getElectronExecutableRelPath,
  getGhostAbiAssetKey,
  getGhostCacheDir,
  getSharedExtensionsDir,
  getTypeScriptAssetKey,
  resolveElectronEntry,
  resolveGhostAbiEntry,
  resolveTypeScriptEntry,
  tryResolveCodeOssAppEntry,
  type BundledExtensionSpec,
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
  extensionsDir: string;
  bundledExtensions: readonly BundledExtensionSpec[];
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
  typescript: {
    assetKey: string;
    sha256: string;
    bytes: number;
    version: string | null;
    installDir: string;
    tsdkDir: string;
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
  const extensionsDir = getSharedExtensionsDir();

  const electronKey = getElectronAssetKey();
  const codeOssKey = getCodeOssAppAssetKey();
  const ghostAbiKey = getGhostAbiAssetKey();
  const typescriptKey = getTypeScriptAssetKey();

  const [electronEntry, codeOssEntry, ghostAbiEntry, typescriptEntry] = await Promise.all([
    resolveElectronEntry(electronKey, idx),
    tryResolveCodeOssAppEntry(codeOssKey, idx),
    resolveGhostAbiEntry(ghostAbiKey, idx),
    resolveTypeScriptEntry(typescriptKey, idx),
  ]);

  const electronExec = join(cacheDir, 'electron', electronEntry.sha256, getElectronExecutableRelPath());
  const codeOssAppDir = codeOssEntry
    ? join(cacheDir, 'code-oss', codeOssEntry.sha256, 'resources', 'app')
    : null;
  const ghostAbiPath = join(cacheDir, 'ghost-abi', ghostAbiEntry.sha256, ghostAbiEntry.filename);
  const tsInstallDir = join(cacheDir, 'typescript', typescriptEntry.sha256);
  const tsPackageLibDir = join(tsInstallDir, 'package', 'lib');
  const tsdkDir = existsSync(tsPackageLibDir) ? tsPackageLibDir : join(tsInstallDir, 'lib');

  return {
    version: getPackageVersion(),
    backend: parsed.backend,
    cacheDir,
    extensionsDir,
    bundledExtensions: AWESOME_OS_BUNDLED_EXTENSIONS,
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
    typescript: {
      assetKey: typescriptKey,
      sha256: typescriptEntry.sha256,
      bytes: typescriptEntry.bytes,
      version: typescriptEntry.version ?? '6.0.3',
      installDir: tsInstallDir,
      tsdkDir,
    },
    forwardArgs: parsed.forwardArgs,
  };
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const parsed = parseCliArgs(argv);

  if (parsed.showVersion) {
    console.log(
      `@awesome-os/code-oss ${getPackageVersion()} (${process.platform}/${process.arch} | electron=${getElectronAssetKey()} | app=${getCodeOssAppAssetKey()} | abi=${getGhostAbiAssetKey()} | ts=${getTypeScriptAssetKey()})`,
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

  const bundledExtensionIds = AWESOME_OS_BUNDLED_EXTENSIONS.map((ext) => ext.id).join(',');

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

    const [codeOssApp, ghostAbi, typescript] = await Promise.all([
      ensureCodeOssApp(),
      ensureGhostAbiAddonPath(),
      ensureFastTypeScript(),
    ]);
    const extensionsDir = ensureSharedExtensionsDir();

    if (process.env.CODE_OSS_VERBOSE === '1') {
      console.error(
        `[awesome-os/code-oss] sectium=${sectiumEntry} app=${codeOssApp.appDir} ghostAbi=${ghostAbi.addonPath} tsdk=${typescript.tsdkDir} extensionsDir=${extensionsDir}`,
      );
    }

    const child = spawn(process.execPath, [sectiumEntry, codeOssApp.appDir, ...parsed.forwardArgs], {
      stdio: 'inherit',
      windowsHide: false,
      env: {
        ...process.env,
        B8G_GHOST_ABI_PATH: ghostAbi.addonPath,
        B8G_GHOST_CAS_DIR: ghostAbi.cacheDir,
        AWESOME_OS_TYPESCRIPT_TSDK: typescript.tsdkDir,
        TYPESCRIPT_TSDK: typescript.tsdkDir,
        B8G_SHARED_EXTENSIONS_DIR: extensionsDir,
        AWESOME_OS_BUNDLED_EXTENSIONS: bundledExtensionIds,
      },
    });

    child.on('close', (code) => {
      process.exit(code ?? 0);
    });
    return;
  }

  const [electron, codeOssApp, ghostAbi, typescript] = await Promise.all([
    ensureElectronBinary(),
    ensureCodeOssApp(),
    ensureGhostAbiAddonPath(),
    ensureFastTypeScript(),
  ]);
  const extensionsDir = ensureSharedExtensionsDir();

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
    console.error(
      `[awesome-os/code-oss] typescript=${typescript.tsdkDir} (cacheHit=${typescript.cacheHit})`,
    );
    console.error(`[awesome-os/code-oss] extensionsDir=${extensionsDir}`);
  }

  // Link <electron_dir>/resources/app -> <code_oss_dir>/resources/app (zero-copy junction/symlink)
  // so process.resourcesPath + '/app' resolves TextMate onig.wasm & all 95 built-in extensions.
  const resourcesAppLink = join(electron.installDir, 'resources', 'app');
  let linkedApp = false;
  try {
    if (!existsSync(join(resourcesAppLink, 'package.json'))) {
      try {
        if (lstatSync(resourcesAppLink)) rmSync(resourcesAppLink, { recursive: true, force: true });
      } catch {
        // Not present yet
      }
      symlinkSync(codeOssApp.appDir, resourcesAppLink, process.platform === 'win32' ? 'junction' : 'dir');
    }
    linkedApp = existsSync(join(resourcesAppLink, 'package.json'));
  } catch {
    linkedApp = false;
  }

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    B8G_GHOST_ABI_PATH: ghostAbi.addonPath,
    B8G_GHOST_CAS_DIR: ghostAbi.cacheDir,
    AWESOME_OS_TYPESCRIPT_TSDK: typescript.tsdkDir,
    TYPESCRIPT_TSDK: typescript.tsdkDir,
    B8G_SHARED_EXTENSIONS_DIR: extensionsDir,
    AWESOME_OS_BUNDLED_EXTENSIONS: bundledExtensionIds,
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv.VSCODE_IPC_HOOK;
  delete childEnv.VSCODE_PID;

  const spawnArgs = linkedApp ? [...parsed.forwardArgs] : [codeOssApp.appDir, ...parsed.forwardArgs];
  const child = spawn(electron.executablePath, spawnArgs, {
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
