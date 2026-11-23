# CourtPlus LegalNER training

This directory trains a 14-type BIO token classifier for extraction and human-reviewed anonymisation. It does not make bail decisions. The ONNX artifact runs offline; training code and Python packages are development tools.

## Provenance

| Resource | Pinned revision | Files used |
|---|---|---|
| Base model: [law-ai/InLegalBERT](https://huggingface.co/law-ai/InLegalBERT) | `b5ecfed8ed6cf9d25a3cb8225a8c52f161f7401a` | `config.json`, `pytorch_model.bin`, `vocab.txt`, `tokenizer_config.json`, `special_tokens_map.json` |
| Official [opennyaiorg/InLegalNER](https://huggingface.co/datasets/opennyaiorg/InLegalNER) | `2e32a46e6714424979db8677b39dbc0aa7e308e7` | Labeled train (10,995), dev (1,074), and test (4,501) parquet files |
| MIT mirror [AjayMukundS/Indian_Legal_NER_Dataset](https://huggingface.co/datasets/AjayMukundS/Indian_Legal_NER_Dataset) | `84f8b4533691b65148d8420025788bb0ca1b5deb` | Used only in the earlier w3 run; not used for this checkpoint or score |

The official test file has entity annotations. The full official train split trains the model; the full official dev split selects the checkpoint; the official test split is evaluated once, separately for judgment passages and preambles and combined. The mirror's train annotations contain the same text/label multiset as the official train file in a different row order. The mirror dev file has 27 differing annotated rows, and w3 selected only on preambles, so this run retrains using the official files. The ten Chhattisgarh orders are held out from all training and checkpoint selection.

The official split source file SHA-256 hashes and normalized text overlap checks are in `metrics.json`.

## Reproduce on Windows

From the repository root, create `ml/ner/.venv` with Python 3.13. The task-local `.gitignore` excludes the environment, source data, checkpoints, and ONNX weights. Install CUDA PyTorch from the [official wheel index](https://pytorch.org/get-started/previous-versions/) and the pinned Python packages:

```powershell
uv venv ml/ner/.venv --python 3.13
uv pip install --python ml/ner/.venv/Scripts/python.exe torch==2.11.0 --index-url https://download.pytorch.org/whl/cu128
uv pip install --python ml/ner/.venv/Scripts/python.exe -r ml/ner/requirements.txt
ml/ner/.venv/Scripts/python.exe -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

Set `HF_TOKEN_PATH` to a file containing a Hugging Face token with access to the official dataset. Download the pinned model and official files, then run:

```powershell
ml/ner/.venv/Scripts/python.exe ml/ner/prepare_data.py
ml/ner/.venv/Scripts/python.exe ml/ner/train.py
ml/ner/.venv/Scripts/python.exe ml/ner/evaluate_model.py
ml/ner/.venv/Scripts/python.exe ml/ner/export_model.py
ml/ner/.venv/Scripts/python.exe ml/ner/parity.py
ml/ner/.venv/Scripts/python.exe ml/ner/predict.py path/to/file.txt
```

For the local order check, place ten manually reviewed order annotations in ignored `ml/ner/data/cg_gold.json` and the corresponding PDFs in the local `orders/` directory, then run `ml/ner/.venv/Scripts/python.exe ml/ner/evaluate_cg.py`. The evaluator reads the PDFs with pypdf and commits only aggregate numbers to the metrics files.

Training uses 256-token windows with stride 64, first-subtoken labels, seed 42, fp16 on CUDA, microbatch 8, gradient accumulation 4 (effective batch 32), learning rate 5e-5, three epochs, and best checkpoint by full-dev strict entity F1. The first 100 optimizer steps print a time projection. This run finished 1,140 steps in 429 seconds on an RTX 4050 Laptop GPU. CPU mode reduces to one epoch and batch 2. Evaluation uses seqeval IOB2 strict entity matching: the official combined test scored P 0.862 / R 0.887 / F1 0.874. The ten-order field check found low recall for dates, case numbers, statutes, and names, so human correction remains mandatory. `metrics.json` and `METRICS.md` hold all measured scores. `artifacts/courtplus-legalner/onnx/model.onnx` is the default fp32 runtime model; `model_quantized.onnx` is provided for parity comparison on 25 held-out judgment and 25 held-out preamble sentences.

The output entity labels follow the `@courtplus/contracts` `Entity.label` union. `predict.py` prints `label`, `text`, character `start` and `end`, and `score`; page assignment and human confirmation happen in the intake app.
