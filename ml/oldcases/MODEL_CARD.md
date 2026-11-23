# CourtPlus old-case research models

## Intended use

These artifacts support human-reviewed research on Indian judgments. Section suggestions propose IPC provisions and include BNS correspondences from the repository crosswalk where available. Search ranks past judgments by textual relevance. Rhetorical roles label sentences from an existing judgment. Summaries quote up to six sentences from the supplied judgment and retain their source positions. Display **Hint - the judge decides** with each result. CJPE and BAIL data were excluded. The package provides research hints and has no verdict or outcome prediction interface.

## Data and licences

| Input | Use | Licence and provenance |
| --- | --- | --- |
| IL-TUR LSI | Official IPC label catalogue and statute classifier | CC BY-NC-SA 4.0, non-commercial research use. [IL-TUR paper](https://aclanthology.org/2024.acl-long.618/) |
| IL-TUR RR, CL and IT | Sentence labels and model selection | Same IL-TUR research terms |
| IL-TUR PCR | Dev selection of fusion weight and cutoff, official test benchmark | Same IL-TUR research terms. [IL-PCR metric protocol](https://aclanthology.org/2023.acl-long.777/) |
| IL-TUR SUMM | Comparison with human-written summaries | Same IL-TUR research terms |
| English Supreme Court judgments and Chhattisgarh High Court orders | Local search index and 2026 order spot check | CC BY 4.0. [Supreme Court AWS Open Data archive](https://registry.opendata.aws/indian-supreme-court-judgments/), [High Court AWS Open Data archive](https://registry.opendata.aws/indian-high-court-judgments/) |
| InLegalBERT | Both classifiers and the mean-pooled retrieval encoder | MIT, pinned revision `b5ecfed8ed6cf9d25a3cb8225a8c52f161f7401a`. [InLegalBERT](https://huggingface.co/law-ai/InLegalBERT) |
| IPC–BNS crosswalk | Section and subsection correspondences | Repository `data/crosswalk/offences.csv`, with provenance per row |

Treat IL-TUR fine-tuned artifacts as non-commercial research assets and preserve attribution and applicable share-alike terms. The government search index uses only public judgments and their official metadata. Its records retain case citations or numbers, dates, courts, judges and official source URLs. For Supreme Court judgments, use the citation to locate the record on the official SCR portal.

## Training and evaluation

The two classifiers started from the pinned InLegalBERT checkpoint. Retrieval uses the frozen base encoder.

- LSI uses the 100 official labels and a 512-token window with 128-token overlap. It max-pools logits by label across the document. The w30 run trained with weighted binary cross-entropy on a seeded 8,000-document sample and selected a global threshold on dev. The w30b run started from all 42,750 training rows, including rows with normalised text shared with dev or test. Post-training calibration excludes overlapping dev rows and fits per-label thresholds where dev contains at least 20 positives. The other labels use a global dev threshold. The full official test supplies macro-F1 and micro-F1.
- RR fine-tunes one classifier on CL and IT training judgments. In w30b, each 256-token input is framed as `[CLS] previous [SEP] target [SEP] next [SEP]`. The model uses the end of the previous sentence and the start of the next. Context stops at judgment boundaries. Square-root inverse-frequency class weights, capped at 8, give rare roles more weight. The combined dev split selects the checkpoint. Test metrics cover the official combined, CL and IT samples across all 13 roles.
- PCR combines BM25 with cosine similarity from mean-pooled, L2-normalised InLegalBERT vectors. The index stores the first 384 components in fp16, keeps the first 512 lexical tokens and encodes up to 128 WordPiece tokens per case. The official PCR candidate split is used for each evaluation split. Fusion weight and a fixed result cutoff are selected on dev. The shipped candidates come from the government archives.
- SUMM applies the RR model to the official test sentence boundaries. It prioritises facts and issues near the beginning and ratio and ruling near the end. The same six-sentence budget applies to the lead baseline. ROUGE-1/2/L uses per-document F1 averaged over the official 100-judgment test set.
- Leakage checks compare document IDs and SHA-256 hashes of Unicode-normalised, case-folded text between the training and evaluation splits. Summary testing also compares against RR training documents. Near-duplicates, translated versions and base-model pretraining overlap remain unmeasured. See [measured results](METRICS.md).

## Reproduce

From the repository root in Git Bash, use the NER virtual environment in `ml/ner/.venv`.

```bash
PY_OLDCASES='ml/ner/.venv/Scripts/python.exe'
W30B='E:/AI-cache/courtplus-ml/oldcases-w30b'
"$PY_OLDCASES" -I -B -u ml/oldcases/train.py rr --rr-context --epochs 8 --batch 12 --accumulate 2 --freeze 4 --minutes 70 --output "$W30B"
"$PY_OLDCASES" -I -B -u ml/oldcases/train.py lsi --epochs 2 --minutes 150 --keep-checkpoint --output "$W30B"
"$PY_OLDCASES" -I -B -u ml/oldcases/calibrate_lsi.py "$W30B/lsi" --checkpoint "$W30B/lsi/best.safetensors"
"$PY_OLDCASES" -I -B -u ml/oldcases/retrieval.py benchmark --batch 16
"$PY_OLDCASES" -I -B -u ml/oldcases/retrieval.py export --cpu
"$PY_OLDCASES" -I -B -u ml/oldcases/government.py --workers 6
"$PY_OLDCASES" -I -B -u ml/oldcases/retrieval.py build
"$PY_OLDCASES" -I -B -u ml/oldcases/evaluate.py summ
"$PY_OLDCASES" -I -B -u ml/oldcases/evaluate.py cg-2026 --output "$W30B"
```

Place official archive and parquet data under `E:/AI-cache/datasets/gov/{sc,hc-cg}`. The extractor streams tar archives and parses bounded batches with pypdf. It records unavailable text layers, unmatched PDFs and failed archives. Re-run it after adding archives, then rebuild the index. Model fine-tuning and evaluation use the local benchmark files in `E:/AI-cache/datasets/il-tur`.

Artifacts are in `E:/AI-cache/courtplus-ml/oldcases`. Install `lsi/`, `rr/`, `pcr-encoder/` and `pcr-index/` in the configured model folder. Compare each candidate with w30 on official-test macro-F1 before promoting it. Preserve the previous classifier folder with a `-w30` suffix if the candidate wins. The classifier and encoder folders contain ONNX weights, a tokenizer and a manifest. The classifier int8 exports quantize constant encoder matrix weights and compute with fp32 activations and a fp32 head. The held-out parity checks compare both ONNX exports with PyTorch fp32. The passage extraction cache stays in the training directory. The retrieval budget covers `pcr-index/`. The encoder is a separate artifact.

## Limits

The section model is limited to 100 IPC labels. BNS entries represent crosswalk correspondences. They require review of the applicable law and subsection. The order spot check uses a citation regex on complete order text as a proxy for sections cited, so explicit references are also visible to the model. Search does not assess precedential authority or later treatment. Retrieval only indexes a limited text prefix from each readable PDF and covers the specified courts and years. Rhetorical-role context ends after the adjoining sentences, and long target sentences may be truncated within the 256-token budget. Role labels and summaries can degrade on scanned or heavily corrupted text, unusual case types and languages outside the training data.
