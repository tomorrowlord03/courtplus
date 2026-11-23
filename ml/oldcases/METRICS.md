# Old-case research evaluation

F1 and ROUGE below are on a 0–1 scale. The benchmark reference is the [IL-TUR paper, Tables 3 and 19–23](https://aclanthology.org/2024.acl-long.618.pdf).

| Official test | Metric | w30 | w30b | IL-TUR reference |
| --- | --- | ---: | ---: | ---: |
| LSI, 13,019 documents | Macro-F1 | 0.2218 | 0.3669 | 0.2808, LeSICiN |
| LSI, 13,019 documents | Micro-F1 | 0.3645 | 0.4584 | — |
| RR, 2,197 sentences, CL + IT | Macro-F1 | 0.3843 | 0.4062 | 0.6901, MTL-BERT |
| RR, 2,197 sentences, CL + IT | Micro-F1 | 0.5257 | 0.5794 | — |
| RR, 1,339 CL sentences | Macro-F1 | 0.3073 | 0.3729 | 0.69, MTL-BERT |
| RR, 858 IT sentences | Macro-F1 | 0.4284 | 0.4193 | 0.70, MTL-BERT |
| PCR, 237 queries and 1,727 candidates | Micro-F1 at dev-selected K | 0.2195 at K=8 | — | 0.3915, event-based |

w30 LSI trained on a seeded 8,000-document sample of the 42,750-document official train split. The full 10,181-document dev set selected threshold 0.35 with macro-F1 of 0.2195. CUDA training and evaluation took 1,417 seconds before ONNX export. The paper's InLegalBERT + LSTM-Attn baseline scored 0.2623 macro-F1.

w30b LSI completed two passes over 42,750 documents in 2,672 optimizer steps. The selected checkpoint reached 0.3529 macro-F1 on the full dev split. At its original global threshold of 0.525, it scored 0.3503 macro-F1 and 0.4579 micro-F1 on the official test. Training and official evaluation took 7,759 seconds before export and recalibration.

All 100 labels met the 20-positive minimum on the 10,063 dev rows used for calibration. The per-label thresholds reached 0.3837 macro-F1 on that dev subset. The fitted global fallback was 0.50. On the 12,866 test rows without exact training overlap, the calibrated checkpoint scored 0.3670 macro-F1 and 0.4591 micro-F1.

w30 RR training used 16,845 sentences and selected on 2,142 dev sentences. The selected checkpoint reached 0.3540 macro-F1 on dev. The CUDA run took 708 seconds including test evaluation, before ONNX export.

w30b RR trained on the same CL and IT sentences with adjacent-sentence inputs and weighted role loss. Epoch 2 had the best dev macro-F1 of 0.4209. Eight epochs and official evaluation took 941 seconds. The contextual checkpoint improved combined and CL macro-F1. IT macro-F1 declined by 0.0090.

PCR selected lexical weight 0.95 and cutoff 8 on the official dev split. Hybrid retrieved 398 of 1,730 cited cases within that cutoff. Three references were absent from the official test candidates and count in the denominator. BM25 alone scored 0.2184 at K=8 and dense alone scored 0.0525 at K=21, using each method's dev-selected cutoff. The cutoff protocol comes from the [IL-PCR paper, §5](https://aclanthology.org/2023.acl-long.777.pdf).

## ONNX export parity

| Agreement with PyTorch fp32 on held-out inputs | Sample | ONNX fp32 | ONNX int8 |
| --- | --- | ---: | ---: |
| LSI mean top-five overlap | 128 documents, 712 windows | 100% | 98.91% |
| LSI label decisions at the calibrated thresholds | 128 documents | 100% | 99.95% |
| RR top-role agreement | 128 sentences | 100% | 100% |

The fp32 exports differed from the reference by less than 0.000014 in each logit. Weight-only int8 quantization improved LSI top-five overlap from 75.00% and RR top-role agreement from 89.84% on the same held-out samples compared with the initial dynamic int8 exports.

## Extractive summaries

The w30 extractive systems use six sentences per judgment on the same 100-document SUMM test. ROUGE uses lowercase alphanumeric tokens and F1 from unigram and bigram overlap and the longest common subsequence. The reference paper's top ROUGE-L was 0.33 for Legal-LED, an abstractive model with a different length budget.

| Extractive system | ROUGE-1 | ROUGE-2 | ROUGE-L |
| --- | ---: | ---: | ---: |
| Role and position | 0.2857 | 0.1296 | 0.1669 |
| Lead-6 | 0.1345 | 0.0430 | 0.0871 |

## 2026 Chhattisgarh High Court order check

| Orders with a cited IPC or mapped BNS section among the fp32 top five | w30 | w30b |
| --- | ---: | ---: |
| All sampled orders | 21/200 (10.5%) | 26/200 (13.0%) |
| Orders with an IPC or BNS citation found by the regex | 21/55 (38.2%) | 26/55 (47.3%) |
| Orders with a citation in the IPC labels or BNS crosswalk | 21/32 (65.6%) | 26/32 (81.3%) |

w30b matched an IPC suggestion in 12 orders and a mapped BNS suggestion in 15. For w30 those counts were nine and 13. One order matched both in each run.

The reproducible sample used four archive parts with 59, 66, 54 and 21 readable orders. The model received complete order text, including explicit references. The reference regex covers labelled IPC and BNS section lists. It can miss citations with other formatting.

## Government precedent index

Extraction covered all 51 downloaded archives. It recovered 110,610 text layers, found 144 PDF members without matching metadata and skipped 14 matching PDFs without usable text. Deduplication by PDF identity leaves 110,601 judgments in a **242,569,549-byte index (242.57 MB)**.

| Court | Indexed judgments |
| --- | ---: |
| Chhattisgarh High Court, 2025 | 61,302 |
| Chhattisgarh High Court, 2026 | 44,209 |
| Supreme Court of India, English, 2020–2026 | 5,090 |

## Leakage checks

The official LSI train set shared 81 normalised text hashes with dev and 109 with test. The 8,000-document training sample shared 27 normalised hashes with each split and zero IDs. Those hashes account for 62 dev rows and 65 test rows. The table uses the complete official test set, including those rows. Exact text overlap can inflate the comparison.

The prestarted w30b LSI run used the full training split. Of its 42,750 rows, 210 overlap with dev and 254 overlap with test, with 325 distinct training rows in the union. There are 118 overlapping rows in dev and 153 in test. A training run filtered on this hash would have 42,425 rows. w30b selects per-label thresholds on the 10,063 dev rows without exact overlap. The official test score retains all 13,019 rows.

RR train had zero shared document IDs and zero shared normalised document hashes with CL dev, IT dev, CL test and IT test. PCR train queries had zero shared IDs with dev or test queries and one shared normalised document with test. PCR train candidates shared 436 IDs and 437 normalised documents with dev candidates, and 740 IDs and 742 normalised documents with test candidates. The official candidate pools overlap. The encoder used the pinned base model, and fusion weight and K were chosen on dev.

RR training and SUMM test had zero shared IDs or normalised document hashes.
