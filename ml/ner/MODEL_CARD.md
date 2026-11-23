# CourtPlus LegalNER model card

## Purpose and intended use

InLegalBERT fine-tuned for 14 named entity types in English Indian court text: COURT, PETITIONER, RESPONDENT, JUDGE, LAWYER, DATE, ORG, GPE, STATUTE, PROVISION, PRECEDENT, CASE_NUMBER, WITNESS, and OTHER_PERSON. It suggests source spans for human-confirmed extraction and helps draft anonymisation of names. An operator must check the text, every suggested field, and every redaction before display or export. The model is an extraction aid, not an authority.

## Out of scope

No bail eligibility determination, risk scoring, recidivism or flight-risk prediction, outcome prediction, credibility assessment, or automated release decision. The [Supreme Court's *draft* Regulations for Use of Artificial Intelligence in Courts, 2026, regulation 20(1)(d)](https://hcs.gov.in/hcs/sites/default/files/Notification/Final_draft_with_Notice_v2.pdf) explicitly lists bail-eligibility risk scoring among prohibited uses in court processes. The draft also treats anonymisation as a potentially permissible use under regulation 19(1)(i), subject to its approval and supervision requirements. This model card does not assert that the draft is in force.

## Data and licences

The base [InLegalBERT](https://huggingface.co/law-ai/InLegalBERT) model and the [official InLegalNER corpus](https://huggingface.co/datasets/opennyaiorg/InLegalNER) are marked MIT. Their exact revisions and source files are pinned in `README.md`. The 10,995 official training rows train the classifier, the 1,074 official dev rows select the checkpoint, and the 4,501 labeled official test rows measure performance. The ten Chhattisgarh orders were used only for a separate field-level check, never training or model selection.

## Evaluation

On the official labeled test split, strict entity precision is 0.862, recall 0.887, and F1 0.874 overall (13,351 aligned entities). Judgment passages score 0.859 F1; preambles score 0.903 F1. See `METRICS.md` and `metrics.json` for all 14 labels and support. [Kalamkar et al., NLLP 2022](https://aclanthology.org/2022.nllp-1.15/) report 81.0 strict F1 for InLegalBERT fine-tuning on combined preambles and judgment sentences. The official train/dev/test split protocol matches; model recipe, windowing, token alignment, and evaluator differ, so this is a comparison rather than an exact reproduction. First-subtoken alignment yields 14 fewer supported entities than the paper's 13,365. The official test contains nine normalized exact passage matches with train/dev, though no document-source overlap. `parity.json` compares 25 judgment and 25 preamble sentence segments across PyTorch, fp32 ONNX, and dynamic int8 ONNX. Fp32 had 100% token-label agreement and zero strict-F1 delta; int8 had 97.66% label agreement and +0.0034 F1 delta on this sample. The ONNX exporter reported a 3.45e-5 maximum logit difference, above its 1e-5 tolerance. The default runtime artifact is fp32.

On ten local Chhattisgarh High Court orders, field precision/recall were PROVISION 0.778/0.389, STATUTE 0.444/0.174, DATE 1.000/0.077, and CASE_NUMBER 1.000/0.048. Person-name recall for draft anonymisation was 67/85 (0.788). These are distinct written values per order, with hand-annotated gold held only in an ignored local file. The low recall means field suggestions and name masking cannot be trusted without manual review and correction.

## Limitations

The training set is English legal text; Hindi and other Indian languages are not covered. OCR noise, page furniture, split lines, unusual citations, and scanned orders can cause misses or incorrect boundaries. The Chhattisgarh field check covers ten English text-layer orders from one court, a convenience sample that cannot establish wider performance. Name masking can miss people, relatives, addresses, and identifiers, so it cannot be treated as complete anonymisation. The output requires a human review gate.
