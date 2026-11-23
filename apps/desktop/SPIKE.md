# Windows portable packaging and desktop smoke

## Desktop wiring build

The Windows x64 portable executable built with Electron 45.4.1 and electron-builder 26.18.0 was **723,253,922 bytes**. Its SHA-256 was `16b5df542683369c4ce15ca4b29a61d4bbde0f0abb33bee62677b305648bfb9c`. It includes both trained ONNX models, the English and Hindi Tesseract data, the language pack, fonts, templates and statistics.

The manual portable diagnostics launch returned exit code 0 and reported `packaged: true` and `portable: true`. SQLCipher and Windows key wrapping, native ONNX inference and Devanagari PDF printing passed. The Playwright smoke passed on the portable executable and the unpacked Windows build. It imported a fictional text PDF with the trained model, saved a case, checked the board and its 180-day counter, exported the signed bundle, and verified the unchanged PDF in the separate window.

`npm test` passed in all six test workspaces. **18 test files and 198 tests passed**. The local Cloud integration test passed bearer login, anonymised case and card writes, handoff delivery and acknowledgement, and decoding a draft QR to a public receipt page that verified the signature.

## Build and run

```powershell
npm install
npm run dev -w @courtplus/desktop
npm run dist -w @courtplus/desktop
```

The distribution command writes `apps/desktop/release/CourtPlus-0.0.0-x64-portable.exe`. Set `COURTPLUS_MODEL_SOURCE` to the trained model directory if it lives outside the default w3-ml worktree. The verified build used `ELECTRON_BUILDER_COMPRESSION_LEVEL=3` and a temporary directory on D:.

In the desktop app, choose **Import order**, review the extracted facts, and select **Save confirmed case**. **Drafts** exports a signed PDF, receipt, and manifest into the same folder. **CourtPlus → Open verifier** and the `--verifier` flag open the separate verifier window. A second computer can trust the issuer by importing the office public key exported from **Settings**.

Leave the backend URL blank for local use. To enable Cloud, save its origin in **Settings** and sign in with a Cloud account. The account role controls server actions. For public QR drafts, export the office public key from **Settings** and enroll it with the appliance’s `trust-issuer` command using the same issuing-office name. Development can use a loopback HTTP origin.

```powershell
npm test
npm run build -w @courtplus/appliance
npm run test:cloud -w @courtplus/desktop
$env:COURTPLUS_SMOKE_EXE = (Resolve-Path 'apps/desktop/release/CourtPlus-0.0.0-x64-portable.exe').Path
npm run test:smoke -w @courtplus/desktop
```

The test runner starts a local appliance listener with temporary fictional accounts. The Electron workflow generates its fictional order inside the test. Open saved PDFs from the selected folder. The shared renderer’s inline preview uses a `file://` iframe that the desktop CSP blocks.

## Original shell packaging spike

### Results

Windows x64 (build 26300), Electron 45.4.1, electron-builder 26.18.0. The portable launcher returned exit code 0 after the sandboxed renderer invoked `diag`. The startup log reported `packaged: true` and `portable: true`.

The tested executable was 135,520,149 bytes. Its SHA-256 was `7ff83297cb3cd974ef16fdc75ba53c2f2390cc6daafb3209ceafd242448da5c4`.

| Check | Observed result |
| --- | --- |
| SQLCipher and Windows DPAPI | Wrapped the 32-byte key, wrote a probe row, reopened the database, and read the row back. A keyless query returned `SQLITE_NOTADB`. The audit chain verified and its delete trigger rejected deletion. |
| Native ONNX | `onnxruntime-node` loaded the bundled identity model and returned 23 on the CPU. |
| Devanagari PDF | Chromium `printToPDF` produced a 9,935-byte PDF. `pdftotext -enc UTF-8` extracted `देवनागरी न्याय परीक्षण` intact. |

The unpacked Windows build also passed the WASM fallback check. With the native binding temporarily withheld, ONNX Runtime reported `The specified module could not be found.` for `onnxruntime_binding.node` and `onnxruntime-web` ran the same model locally, returning 23. The native binding was restored after the check.

`npm run build` passed. Vitest reported **Test Files 3 passed (3)** and **Tests 10 passed (10)**.

### Run from the repository root

```powershell
npm install
npm run build
npm test
npm run dev -w @courtplus/desktop
npm run dist -w @courtplus/desktop
```

Set `COURTPLUS_RENDERER_URL` to the loopback Vite server URL for live development. The packaged app loads the built `apps/ui/dist` from its resources. This worktree used the placeholder because the UI workspace was absent. The packages are unsigned. SQLite and ONNX ship Node-API prebuilds. The rebuild script uses `@electron/rebuild` for ABI-dependent addons and keeps those two prebuilds.

The distribution command produces `apps/desktop/release/CourtPlus-0.0.0-x64-portable.exe` and `apps/desktop/release/win-unpacked/CourtPlus.exe`. Run the portable executable with an isolated profile to repeat the startup checks.

```powershell
$desktop = (Resolve-Path 'apps/desktop').Path
$exe = Join-Path $desktop 'release/CourtPlus-0.0.0-x64-portable.exe'
$profile = Join-Path $desktop ('out/portable-spike-' + [guid]::NewGuid())
$process = Start-Process -FilePath $exe -WindowStyle Hidden -Wait -PassThru -ArgumentList @(
  '--courtplus-diagnostics',
  ('"--courtplus-diagnostics-profile={0}"' -f $profile)
)
$process.ExitCode
Get-Content -LiteralPath (Join-Path $profile 'diagnostics.json')
pdftotext -enc UTF-8 (Join-Path $profile 'diagnostics-devanagari.pdf') -
```

The launcher extracts the application to Windows' temporary directory. On the verification host, the system drive ran out of space during the first launch. Setting `TEMP` and `TMP` for the test process to a directory on the workspace drive resolved it.

A regular packaged launch writes the report and PDF in Electron's `userData` directory. Diagnostic mode also enables the hidden `diag` IPC and exits after reading the result through the preload bridge.
