# CourtPlus LegalNER test metrics

Official labeled InLegalNER test split. Strict seqeval IOB2 entity matching; first subtoken and overlapping 256-token windows.
Official train trained the model; full official dev selected the checkpoint. Chhattisgarh orders were evaluation only.

**Combined test:** P 0.862, R 0.887, F1 0.874; 13351 entities in 4501 rows.

## Judgment passages

**Overall:** P 0.846, R 0.871, F1 0.859; 8707 entities in 4060 rows.

| Entity | Precision | Recall | F1 | Support |
|---|---:|---:|---:|---:|
| COURT | 0.920 | 0.895 | 0.907 | 799 |
| PETITIONER | 0.764 | 0.656 | 0.706 | 64 |
| RESPONDENT | 0.706 | 0.750 | 0.727 | 32 |
| JUDGE | 0.725 | 0.881 | 0.796 | 42 |
| LAWYER | 0.000 | 0.000 | 0.000 | 0 |
| DATE | 0.934 | 0.949 | 0.941 | 1110 |
| ORG | 0.684 | 0.755 | 0.718 | 912 |
| GPE | 0.749 | 0.773 | 0.761 | 719 |
| STATUTE | 0.915 | 0.928 | 0.922 | 974 |
| PROVISION | 0.932 | 0.935 | 0.934 | 1220 |
| PRECEDENT | 0.729 | 0.764 | 0.746 | 648 |
| CASE_NUMBER | 0.755 | 0.841 | 0.796 | 667 |
| WITNESS | 0.912 | 0.925 | 0.918 | 413 |
| OTHER_PERSON | 0.884 | 0.893 | 0.889 | 1107 |

## Preamble passages

**Overall:** P 0.892, R 0.915, F1 0.903; 4644 entities in 441 rows.

| Entity | Precision | Recall | F1 | Support |
|---|---:|---:|---:|---:|
| COURT | 0.898 | 0.943 | 0.920 | 422 |
| PETITIONER | 0.860 | 0.844 | 0.852 | 797 |
| RESPONDENT | 0.816 | 0.849 | 0.832 | 1080 |
| JUDGE | 0.926 | 0.964 | 0.945 | 548 |
| LAWYER | 0.956 | 0.964 | 0.960 | 1797 |
| DATE | 0.000 | 0.000 | 0.000 | 0 |
| ORG | 0.000 | 0.000 | 0.000 | 0 |
| GPE | 0.000 | 0.000 | 0.000 | 0 |
| STATUTE | 0.000 | 0.000 | 0.000 | 0 |
| PROVISION | 0.000 | 0.000 | 0.000 | 0 |
| PRECEDENT | 0.000 | 0.000 | 0.000 | 0 |
| CASE_NUMBER | 0.000 | 0.000 | 0.000 | 0 |
| WITNESS | 0.000 | 0.000 | 0.000 | 0 |
| OTHER_PERSON | 0.000 | 0.000 | 0.000 | 0 |

[Kalamkar et al. (2022)](https://aclanthology.org/2022.nllp-1.15/) report 0.810 strict F1 for InLegalBERT on the combined test; difference +0.064. The official split protocol matches, but model recipe, windowing, token alignment, and evaluator differ. First-subtoken alignment supports 13,351 entities versus 13,365 in the paper, so this is not an exact reproduction.
The official test contains 9 passages with normalized exact text matches in train/dev; document source overlap is 0. The official split is retained intact. Source hashes and settings are in `metrics.json`.

## Chhattisgarh order field check

Ten locally held published High Court orders were hand annotated from pypdf text. Values are deduplicated within each order; dates are compared as day/month/year, provisions by section number, statutes by named act/abbreviation, and case numbers by number/year. Person recall requires the entire written name in a predicted person span. The gold file and orders are git ignored.

| Field | Precision | Recall | TP | Predicted | Gold |
|---|---:|---:|---:|---:|---:|
| PROVISION | 0.778 | 0.389 | 14 | 18 | 36 |
| STATUTE | 0.444 | 0.174 | 4 | 9 | 23 |
| DATE | 1.000 | 0.077 | 2 | 2 | 26 |
| CASE_NUMBER | 1.000 | 0.048 | 1 | 1 | 21 |
| COURT | 0.909 | 1.000 | 10 | 11 | 10 |
| PERSON | n/a | 0.788 | 67 | 78 | 85 |

This convenience sample is small, English text layer only, and drawn from one court. Name recall does not establish safe anonymisation of addresses, relatives, or identifiers.

## Real bail-order adaptation

| Candidate | Official F1 combined | Judgment | Preamble | CG dates R | CG cases R | CG statutes R | CG names R | IBJ IPC P / R | IBJ court P / R / top accuracy | L-NER fold 3 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Current | 0.8742 | 0.8586 | 0.9035 | 0.077 | 0.048 | 0.174 | 0.788 | 0.695 / 0.794 | 0.117 / 0.420 / 0.335 | — |
| DAPT | 0.8746 | 0.8591 | 0.9036 | 0.000 | 0.000 | 0.174 | 0.753 | 0.685 / 0.802 | 0.115 / 0.380 / 0.280 | — |
| DAPT + L-NER | — | — | — | — | — | — | — | — | — | — |

**Release decision. Keep the current model.** Official combined F1 changed by +0.0004. CG recall improved in 0 of four gate fields (none). Release requires improvement in at least two CG fields and an official combined F1 loss of at most 0.005.

### Leakage and data sources

| Candidate source | Units | Official test | Official dev | CG gold | Excluded for overlap |
|---|---:|---:|---:|---:|---:|
| IBJ-1200 | 1200 | 13 | 17 | 0 | 29 |
| hf-tuner train | 6220 | 0 | 0 | 0 | 0 |
| hf-tuner validation | 613 | 9 | 613 | 0 | 613 |
| Figshare | 50 | 0 | 0 | 0 | 0 |

Counts can intersect across split columns. The audit compared normalized text and removed duplicate and near-duplicate IBJ orders. Seed 42 selected 200 held-out orders from 1009 eligible orders after also checking official train. The masked-language run used 824 PDF text layers for 1329 optimizer steps in 12.1 minutes. The objective used PDF text only. NER fine-tuning used official train and selected the checkpoint on official dev. [IndianBailJudgments-1200, CC BY 4.0](https://huggingface.co/datasets/SnehaDeshmukh/IndianBailJudgments-1200)

All 6,833 hf-tuner rows match normalized rows in official InLegalNER. The repackage was excluded. The 50-document Figshare workbook has token-level BILOU annotations with partial coverage and incompatible classes. For example, its date tag covers judgment dates and its party-type tag covers role markers. The workbook was excluded. [Indian Court Decision Annotated Corpus, CC BY 4.0](https://doi.org/10.6084/m9.figshare.19719088.v2)

IL-TUR returned HTTP 403 on the authenticated retry. The DAPT + L-NER candidate, L-NER fold 3, and the 20-document HLDC smoke test are unavailable. [IL-TUR, CC BY-NC-SA 4.0](https://huggingface.co/datasets/Exploration-Lab/IL-TUR)

IBJ compares distinct IPC section numbers and courts per order using the production intake model and rules. Section numbers ignore prefixes and subsections, and court names use normalized written aliases. Court top accuracy checks only the first suggestion. The author-provided IPC and court reference annotations were machine-generated with consistency checks and may be incomplete. [Dataset paper](https://arxiv.org/abs/2507.02506)

### Reproduce the IBJ-only run

From the repository root in PowerShell, use a Python environment for ml/ner and a built intake package from the same revision. The intermediate files default to E:/AI-cache/courtplus-ml/w28.

```powershell
$python = 'ml/ner/.venv/Scripts/python.exe'
$intake = 'packages/intake/dist'
$env:TEMP = 'E:/AI-cache/tmp'
$env:TMP = $env:TEMP
$env:HF_HOME = 'E:/AI-cache/huggingface'
& $python -I -B ml/ner/real_data.py audit
& $python -I -B ml/ner/real_data.py train
& $python -I -B ml/ner/real_data.py evaluate --candidate current --intake-dist $intake
& $python -I -B ml/ner/real_data.py evaluate --candidate dapt --intake-dist $intake
& $python -I -B ml/ner/real_data.py report
```
