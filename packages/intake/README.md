# CourtPlus order intake

The package reads text PDFs, scanned PDFs and PNG or JPEG photos. It extracts text page by page, uses bundled English and Hindi OCR for pages with fewer than 20 letters or digits, and runs the local CourtPlus LegalNER model. The API returns unconfirmed suggestions with their source sentences and page numbers.

## Build and run

Use Node.js 22 or later. Run these commands from the repository root.

```powershell
npm install
npm run fetch:ocr -w @courtplus/intake
npm run build -w @courtplus/contracts
npm run build -w @courtplus/intake
npm test -w @courtplus/intake
node packages/intake/dist/cli.js <file> --model <dir>
node packages/intake/scripts/eval-real.mjs <pdf-folder> --model <dir>
node packages/intake/scripts/eval-real.mjs <pdf-folder> --model <dir> --gold <cg_gold.json>
```

The OCR assets are checked in under `assets/tessdata/` and total about 5.2 MB. The fetch command verifies the bundled files and restores missing or damaged copies from the pinned upstream release. Downloads happen during setup. OCR reads the installed files directly and runs without a disk cache. [Tesseract language data](https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0)

Point `--model` or the second argument to `importOrder` at the w3 Transformers.js export directory. It contains `config.json`, `tokenizer.json`, the tokenizer configuration and `onnx/model.onnx`. A directory containing `onnx/model_quantized.onnx` also works. Intake prefers FP32 with native ONNX Runtime on CPU and falls back to the installed WASM runtime if native model loading fails. The WASM fallback prefers the quantized export to reduce memory use. The tokenizer must be BERT WordPiece. Intake uses Transformers.js token indices to group BIO predictions and recover the original character offsets. [Transformers.js token classification](https://github.com/huggingface/transformers.js/blob/4.3.2/packages/transformers/src/pipelines/token-classification.js)

## Runtime integration

Call `importOrder({ name, bytes }, modelDir)` in the Electron main process or the appliance server. Keep the model directory on disk and accessible by absolute path. Include the package's `assets/tessdata/` beside `dist/` and ship the installed PDF.js, canvas, Tesseract and ONNX runtime dependencies. In an Electron distribution, put the Tesseract worker, its WASM core, the OCR language data, ONNX runtime binaries and the canvas native binding in unpacked files.

`extractText` exposes the page text, one-based page number, extraction method, confidence on a 0–1 scale, and zero-based UTF-16 start and exclusive end offsets. Text-layer pages report `1` for extraction confidence. The combined text uses a form-feed separator between pages. `importOrder` returns the page count required by the shared contract.

Charge proposals use the `section` field and values such as `IPC 379`, `BNS 303(2)` or `NDPS 20(b)`. A provision cited as a legal bar in reasoning uses `citedProvision`, so it is not mistaken for a charge. BNSS procedural sections also use `citedProvision`; BNSS is not a charge act in the shared contract. Dates use role fields such as `arrestedOn`, `firstRemandOn`, `remandOn`, `chargesheetOn`, `bailGrantedOn` and `custodySince`. Ambiguous dates use `date`. `firstRemandOn` requires a first or initial remand cue. Text is normalised before NER to repair broken lines and spacing; the returned offsets refer to the normalised text.

`parseChargeSuggestion` converts a charge proposal such as `NDPS 20(b)` to the contract-shaped `{ act: 'NDPS', section: '20', subsection: 'b' }` for human review. It rejects procedural BNSS provisions.

The local evaluator reads PDFs sequentially and prints aggregate counts only: orders processed, fields found per order, masked name occurrences and possible address or relative leaks. `--gold` adds field recall against a local annotation file. It does not run in CI or print order text.

On the same ten locally annotated orders, the raw pypdf/model baseline in `ml/ner/METRICS.md` found DATE 2/26 (0.077), PROVISION 14/36 (0.389), STATUTE 4/23 (0.174), and CASE_NUMBER 1/21 (0.048). The intake rules plus model found DATE 25/26 (0.962), PROVISION 25/36 (0.694), STATUTE 17/23 (0.739), and CASE_NUMBER 18/21 (0.857). These are recall checks on a small convenience sample, not precision measurements.

`anonymise` returns masked text and an in-memory map from detected names to placeholders. Pass `{ maskIds: true }` to include CNR and FIR numbers. `importOrder` enables that option and returns the masked text. The original text, suggestions and CLI output can still contain personal information. Review every suggested field and redaction before release. The w3 model was trained on English legal text, so Hindi OCR and rules can read and suggest fields even where name tagging is unreliable.
