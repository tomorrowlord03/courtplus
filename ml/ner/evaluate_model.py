"""Strict entity-level evaluation on the held-out Legal NER test split."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import argparse
import pyarrow.parquet as parquet
import torch
from seqeval.metrics import classification_report
from seqeval.scheme import IOB2
from transformers import AutoModelForTokenClassification, AutoTokenizer, DataCollatorForTokenClassification, Trainer, TrainingArguments

from data_utils import DATA, ENTITY_TYPES, OFFICIAL_FILES, ROOT, load_official, tokenize_spans
from train import RUN_DIR, sequences


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def signature(text: str) -> str:
    return re.sub(r"\W", "", text, flags=re.UNICODE).casefold()


def document_sources(split: str, data_dir: Path = DATA) -> set[str]:
    path = data_dir / "official" / "data" / OFFICIAL_FILES[split]
    return {match.group(0) for row in parquet.read_table(path, columns=["meta"]).to_pylist()
            if (match := re.search(r"https?://\S+", row["meta"]["source"]))}


def evaluate_test(best: Path, test, output_dir: Path):
    tokenizer = AutoTokenizer.from_pretrained(str(best), local_files_only=True)
    model = AutoModelForTokenClassification.from_pretrained(str(best), local_files_only=True)
    args = TrainingArguments(
        output_dir=str(output_dir),
        per_device_eval_batch_size=8 if torch.cuda.is_available() else 2,
        report_to="none", fp16=torch.cuda.is_available(),
    )
    trainer = Trainer(model=model, args=args, data_collator=DataCollatorForTokenClassification(tokenizer), processing_class=tokenizer,
                      preprocess_logits_for_metrics=lambda logits, _: logits.argmax(dim=-1))
    scores = {}
    all_predicted, all_expected = [], []
    for part in ("judgment", "preamble"):
        subset = test.filter(lambda row: row["part"] == part)
        tokenized = subset.map(lambda batch: tokenize_spans(batch, tokenizer), batched=True,
                               remove_columns=subset.column_names)
        output = trainer.predict(tokenized)
        predicted, expected = sequences(output.predictions, output.label_ids)
        all_predicted.extend(predicted)
        all_expected.extend(expected)
        report = classification_report(expected, predicted, mode="strict", scheme=IOB2,
                                       output_dict=True, zero_division=0)
        overall = {"precision": report["micro avg"]["precision"],
                   "recall": report["micro avg"]["recall"],
                   "f1": report["micro avg"]["f1-score"],
                   "support": int(report["micro avg"]["support"])}
        labels = {name: {"precision": report.get(name, {}).get("precision", 0),
                         "recall": report.get(name, {}).get("recall", 0),
                         "f1": report.get(name, {}).get("f1-score", 0),
                         "support": int(report.get(name, {}).get("support", 0))}
                  for name in ENTITY_TYPES}
        scores[part] = {"rows": len(subset), "chunks": len(tokenized),
                        "overall": overall, "per_label": labels}
        print(f"TEST {part}: P={overall['precision']:.4f} R={overall['recall']:.4f} "
              f"F1={overall['f1']:.4f} rows={len(subset)}", flush=True)
    combined = classification_report(all_expected, all_predicted, mode="strict", scheme=IOB2,
                                     output_dict=True, zero_division=0)["micro avg"]
    overall = {"precision": combined["precision"], "recall": combined["recall"],
               "f1": combined["f1-score"], "support": int(combined["support"])}
    print(f"TEST combined: P={overall['precision']:.4f} R={overall['recall']:.4f} "
          f"F1={overall['f1']:.4f} rows={len(test)}", flush=True)
    return overall, scores


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, default=RUN_DIR)
    parser.add_argument("--data-dir", type=Path, default=DATA)
    parser.add_argument("--output", type=Path, help="Write aggregate JSON to a separate experiment file")
    args = parser.parse_args()
    best = args.run_dir / "best"
    with (args.run_dir / "run.json").open(encoding="utf-8") as stream:
        run = json.load(stream)
    if not run["full_training"] or run["selection_split"] != "official dev":
        raise RuntimeError("Refusing to report scores from an incomplete or nonofficial run")
    train, dev, test = (load_official(split, args.data_dir) for split in ("train", "dev", "test"))
    known = {signature(row["text"]) for row in train}
    known.update(signature(row["text"]) for row in dev)
    overlap = sum(signature(row["text"]) in known for row in test)
    source_overlap = len(document_sources("test", args.data_dir) &
                         (document_sources("train", args.data_dir) | document_sources("dev", args.data_dir)))
    print(f"test rows={len(test)}; normalized exact-text overlap with train/dev={overlap}", flush=True)
    if source_overlap:
        raise RuntimeError("Official test shares document sources with train/dev")
    eval_dir = args.output.parent / "evaluation" if args.output else ROOT / "runs" / "evaluation-official"
    overall, scores = evaluate_test(best, test, eval_dir)
    combined_overall = overall
    metrics = {
        "protocol": "official train/dev/test; seqeval IOB2 strict entity F1; first subtoken; overlapping windows masked",
        "overall": overall,
        "scores": scores,
        "dataset": {
            "id": "opennyaiorg/InLegalNER", "revision": "2e32a46e6714424979db8677b39dbc0aa7e308e7",
            "rows": {"train": len(train), "dev": len(dev), "test": len(test)},
            "normalized_exact_test_overlap_with_train_dev": overlap,
            "test_document_source_overlap_with_train_dev": source_overlap,
            "sha256": {name: digest(args.data_dir / "official" / "data" / filename)
                       for name, filename in OFFICIAL_FILES.items()},
        },
        "model": run,
        "reference_strict_f1": 0.810,
        "reference_entity_support": 13365,
        "aligned_entity_support_difference": overall["support"] - 13365,
        "f1_difference_from_reference": overall["f1"] - 0.810,
        "reference_protocol_split_matches": True,
        "reference_implementation_exactly_reproduced": False,
    }
    output = args.output or ROOT / "metrics.json"
    output.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    if args.output:
        return
    lines = [
        "# CourtPlus LegalNER test metrics", "",
        "Official labeled InLegalNER test split. Strict seqeval IOB2 entity matching; first subtoken and overlapping 256-token windows.",
        "Official train trained the model; full official dev selected the checkpoint. Chhattisgarh orders were evaluation only.", "",
        f"**Combined test:** P {overall['precision']:.3f}, R {overall['recall']:.3f}, F1 {overall['f1']:.3f}; {overall['support']} entities in {len(test)} rows.", "",
    ]
    for part, score in scores.items():
        overall = score["overall"]
        lines += [f"## {part.capitalize()} passages", "",
                  f"**Overall:** P {overall['precision']:.3f}, R {overall['recall']:.3f}, F1 {overall['f1']:.3f}; {overall['support']} entities in {score['rows']} rows.", "",
                  "| Entity | Precision | Recall | F1 | Support |", "|---|---:|---:|---:|---:|"]
        for name, item in score["per_label"].items():
            lines.append(f"| {name} | {item['precision']:.3f} | {item['recall']:.3f} | {item['f1']:.3f} | {item['support']} |")
        lines.append("")
    lines += [f"[Kalamkar et al. (2022)](https://aclanthology.org/2022.nllp-1.15/) report 0.810 strict F1 for InLegalBERT on the combined test; difference {combined_overall['f1'] - 0.810:+.3f}. The official split protocol matches, but model recipe, windowing, token alignment, and evaluator differ. First-subtoken alignment supports {combined_overall['support']} entities versus 13,365 in the paper, so this is not an exact reproduction.",
              f"The official test contains {overlap} passages with normalized exact text matches in train/dev; document source overlap is {source_overlap}. The official split is retained intact. Source hashes and settings are in `metrics.json`."]
    (ROOT / "METRICS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
