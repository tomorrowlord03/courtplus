# CourtPlus document export

Run from the workspace root after installing dependencies.

```powershell
npm run build -w @courtplus/contracts
npm run build -w @courtplus/export
npm test -w @courtplus/export
npm run samples -w @courtplus/export
```

The sample script writes fictional documents to the ignored `packages/export/out/` directory. Set `COURTPLUS_LOCALIZATION_ROOT` to preview another directory containing `data/i18n` and `assets/fonts`.

## Desktop integration

- `renderHtml(kind, data, lang)` creates a complete HTML document. Use `DLSA_HANDOFF` to print the hash for the day's audit-log handoff. The shell supplies confirmed case facts and checks that the person remains in custody before issuing a seven-day intimation.
- `printDraft(kind, data, lang, print)` passes HTML to the shell's print callback. Load it from an app-controlled temporary file in isolated Electron web contents, await `document.fonts.ready`, and return the bytes from `webContents.printToPDF({ preferCSSPageSize: true, printBackground: true })`. In Node tests, pass `checkHtml` as the callback to check and return the HTML.
- `exportSignedDraft(kind, data, lang, options)` prints the QR-bearing HTML and returns the exact PDF bytes, canonical signed receipt and canonical signed manifest. Pass the issuer, screening inputs, screening result, active key and PDF print callback. For the application, the result displayed in the draft supplies the receipt metadata. Persist the returned files together.
- `createStoredKey` and `retireStoredKey` use the shell's load/save callbacks. The signing calls take the current key record. The shell owns private key protection and should load that record at the time of use. `exportPublicKey` returns the trust-store entry, which can verify previous receipts after retirement.
- `verify({ pdf, receipt, manifest, trustStore, anchor, auditLogHead })` authenticates both JSON files and their binding before comparing the PDF hash. A PDF receives `unchanged` only when the bundle is verifiable and its bytes match. Supply both hashes to compare the handoff anchor and audit-log head. `decodeReceiptQr` accepts RGBA pixels from the shell's image decoder. Its three lookup fields locate a receipt. Use the signed bundle to verify it.
- `renderScReturnXlsx(rows)` and `renderScReturnCsv(rows)` emit the same columns with prisoner aliases and ISO civil dates. CSV uses a first row for the version note, followed by the column headings. The workbook carries the note in cell A1. [Supreme Court order of 19 November 2024, paragraph 10](https://api.sci.gov.in/supremecourt/2013/18545/18545_2013_4_10_57306_Order_19-Nov-2024.pdf)

The build packages templates and any language assets present in the workspace. Pass `localizationRoot` to use a separate installed language pack. Rights cards fall back to English when a requested catalog is absent or incomplete. Hindi legal drafts carry the fluent-reader review banner.
