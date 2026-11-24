# `@awesome-os/code-oss`

Telemetry-free **Code - OSS** (VS Code MIT) hydrated on **shared debloated Electron** + **`b8g-ghost` CAS (`cas-v1`)** with a **`~120 KB` native C11 launcher** — eliminating VSCodium's `~350 MB` duplicate installers and per-app Chromium/Electron bloat.

---

## Why `@awesome-os/code-oss`?

Traditional VSCodium / VS Code installations ship a full, isolated copy of Electron (`~250 MB`), Chromium locales, `icudtl.dat`, `ffmpeg`, and `v8_context_snapshot.bin` inside every IDE build (`~350 MB` total per installation).

`@awesome-os/code-oss` splits the stack into three deduplicated, SHA-256-verified CAS layers stored once per machine in `~/.b8g/cas/` (Keep-Last-5 retention):

| Layer | `cas-v1` Asset | Local CAS Path | Purpose |
| :--- | :--- | :--- | :--- |
| **Native Launcher** | `code-oss.exe` / `code-oss` (`src/code_oss_launcher.c`) | `~120 KB` binary | Zero-dep C11 launcher; direct-spawns warm CAS or hydrates via `src/cli.mts` |
| **Shared Electron** | `electron-<os>.tar.zst` | `~/.b8g/cas/electron/<sha256>/` | Debloated rolling-latest upstream Electron shared across all apps |
| **Code - OSS App** | `code-oss-app-<os>.tar.zst` | `~/.b8g/cas/code-oss/<sha256>/resources/app/` | Pure telemetry-free Code - OSS workbench + built-in extensions only |
| **Ghost ABI Bridge** | `b8g-ghost-abi-<os>.node` | `~/.b8g/cas/ghost-abi/<sha256>/` | Injected as `B8G_GHOST_ABI_PATH` for zero-copy `B8G_ARENA_V1` IPC |

---

## Usage

```bash
# Run via Node 22+ erasable TypeScript directly
node src/cli.mts [files/folders...]

# Inspect resolved CAS entries and launch plan without spawning Electron
node src/cli.mts --dry-run

# Print version and platform CAS asset keys
node src/cli.mts --version

# Route through sovereign sectium-electron instead of upstream Electron
node src/cli.mts --sectium [files/folders...]
```

### Environment Variables

- `B8G_GHOST_CACHE_DIR` — Override local CAS root (default: `~/.b8g/cas`).
- `B8G_GHOST_INDEX_URL` — Override `manifests/index.json` URL.
- `B8G_GHOST_CAS_URL` — Override `cas-v1` base download URL.
- `ELECTRON_GHOST_SHA256` — Pin Electron to any SHA-256 in the Keep-Last-5 history.
- `CODE_OSS_GHOST_SHA256` — Pin Code - OSS `resources/app` to any SHA-256 in the Keep-Last-5 history.
- `CODE_OSS_BACKEND=sectium` — Default to `sectium-electron`.
- `CODE_OSS_VERBOSE=1` — Print CAS hydration paths and hit/miss status to stderr.

---

## Building the Native C11 Launcher

```bash
# Linux ELF64
mkdir -p dist
gcc -std=c11 -Os -s -Wall -Wextra src/code_oss_launcher.c -o dist/code-oss

# Windows x64 (with Zig cc + Lumi White Dragon icon resource)
zig cc -target x86_64-windows-gnu -std=c11 -Os -s src/code_oss_launcher.c lumi.res -o dist/code-oss.exe
```

---

## Testing

```bash
node --test test/code-oss-cas.test.mts
```

---

## License

MIT — see [LICENSE](./LICENSE).
