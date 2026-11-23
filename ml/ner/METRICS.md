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
