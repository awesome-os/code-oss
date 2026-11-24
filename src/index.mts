/**
 * @file src/index.mts
 * @description Public API for @awesome-os/code-oss: CAS hydration and launch helpers.
 */

export {
  AWESOME_OS_BUNDLED_EXTENSIONS,
  ensureCodeOssApp,
  ensureElectronBinary,
  ensureFastTypeScript,
  ensureGhostAbiAddonPath,
  ensureSharedExtensionsDir,
  fetchGhostIndex,
  GHOST_CAS_BASE_URL,
  GHOST_INDEX_URL,
  getCodeOssAppAssetKey,
  getElectronAssetKey,
  getElectronExecutableRelPath,
  getGhostAbiAssetKey,
  getGhostCacheDir,
  getSharedExtensionsDir,
  getTypeScriptAssetKey,
  hydrateCodeOssStack,
  resolveCodeOssAppEntry,
  resolveElectronEntry,
  resolveGhostAbiEntry,
  resolveTypeScriptEntry,
  tryResolveCodeOssAppEntry,
  type BundledExtensionSpec,
  type GhostCasEntry,
  type GhostCasHistoryItem,
  type GhostIndex,
  type HydratedCodeOssAppResult,
  type HydratedCodeOssStack,
  type HydratedElectronResult,
  type HydratedGhostAbiResult,
  type HydratedTypeScriptResult,
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
