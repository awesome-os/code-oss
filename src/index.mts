/**
 * @file src/index.mts
 * @description Public API for @awesome-os/code-oss: CAS hydration and launch helpers.
 */

export {
  ensureCodeOssApp,
  ensureElectronBinary,
  ensureGhostAbiAddonPath,
  fetchGhostIndex,
  GHOST_CAS_BASE_URL,
  GHOST_INDEX_URL,
  getCodeOssAppAssetKey,
  getElectronAssetKey,
  getElectronExecutableRelPath,
  getGhostAbiAssetKey,
  getGhostCacheDir,
  hydrateCodeOssStack,
  resolveCodeOssAppEntry,
  resolveElectronEntry,
  resolveGhostAbiEntry,
  tryResolveCodeOssAppEntry,
  type GhostCasEntry,
  type GhostCasHistoryItem,
  type GhostIndex,
  type HydratedCodeOssAppResult,
  type HydratedCodeOssStack,
  type HydratedElectronResult,
  type HydratedGhostAbiResult,
} from './hydrate.mts';

export {
  buildLaunchPlan,
  getPackageVersion,
  parseCliArgs,
  resolveSectiumEntrypoint,
  runCli,
  type LaunchPlan,
  type ParsedCliArgs,
} from './cli.mts';
