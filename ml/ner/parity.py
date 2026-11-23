"""Compare PyTorch, fp32 ONNX, and dynamic-int8 ONNX on held-out passages."""

from __future__ import annotations

import json
import re

import numpy as np
import onnxruntime as ort
import torch
from datasets import Dataset
from seqeval.metrics import f1_score
from seqeval.scheme import IOB2
from transformers import AutoModelForTokenClassification, AutoTokenizer

from data_utils import LABELS, ROOT, load_official, tokenize_spans
from train import RUN_DIR


def test_sentences(test, tokenizer, limit=25):
    per_document = []
    for row in test:
        sentences = []
        for match in re.finditer(r"[^.!?]+(?:[.!?]+|$)", row["text"]):
            raw = match.group()
            left = len(raw) - len(raw.lstrip())
            right = len(raw.rstrip())
            start, end = match.start() + left, match.start() + right
            if end <= start or len(row["text"][start:end].split()) < 5:
                continue
            if len(tokenizer(row["text"][start:end])["input_ids"]) > 256:
                continue
            entities = [
                {"start": item["start"] - start, "end": item["end"] - start, "label": item["label"]}
                for item in row["entities"] if start <= item["start"] and item["end"] <= end
            ]
            if not entities:
                continue
            sentences.append({"text": row["text"][start:end], "entities": entities})
        per_document.append(sentences)
    result = []
    for position in range(max(map(len, per_document))):
        for sentences in per_document:
            if position < len(sentences):
                result.append(sentences[position])
                if len(result) == limit:
                    return Dataset.from_list(result)
    raise RuntimeError(f"Only {len(result)} held-out sentences; need {limit}")


def main():
    artifact = ROOT / "artifacts" / "courtplus-legalner"
    best = RUN_DIR / "best"
    tokenizer = AutoTokenizer.from_pretrained(str(artifact), local_files_only=True)
    model = AutoModelForTokenClassification.from_pretrained(str(best), local_files_only=True).eval()
    sessions = {
        "fp32": ort.InferenceSession(str(artifact / "onnx" / "model.onnx"), providers=["CPUExecutionProvider"]),
        "int8": ort.InferenceSession(str(artifact / "onnx" / "model_quantized.onnx"), providers=["CPUExecutionProvider"]),
    }
    test = load_official("test")
    sentences = Dataset.from_list([
        row for part in ("judgment", "preamble")
        for row in test_sentences(test.filter(lambda row: row["part"] == part), tokenizer)
    ])
    passages = sentences.map(lambda batch: tokenize_spans(batch, tokenizer), batched=True, remove_columns=sentences.column_names)
    if len(passages) != 50:
        raise RuntimeError("A test sentence overflowed the 256-token window")
    predictions = {name: [] for name in ("torch", "fp32", "int8")}
    gold = []
    agreements = {name: [0, 0] for name in ("fp32", "int8")}
    for row in passages.select(range(50)):
        inputs = {key: np.asarray([value], dtype=np.int64) for key, value in row.items() if key != "labels"}
        keep = np.asarray(row["labels"]) != -100
        gold.append([LABELS[value] for value in np.asarray(row["labels"])[keep]])
        with torch.no_grad():
            torch_logits = model(**{key: torch.from_numpy(value) for key, value in inputs.items()}).logits.numpy()[0]
        logits = {"torch": torch_logits}
        for name, session in sessions.items():
            feed = {item.name: inputs[item.name] for item in session.get_inputs()}
            logits[name] = session.run(None, feed)[0][0]
        for name, values in logits.items():
            predictions[name].append([LABELS[int(value)] for value in np.argmax(values, axis=-1)[keep]])
        for name in agreements:
            agreements[name][0] += sum(a == b for a, b in zip(predictions["torch"][-1], predictions[name][-1]))
            agreements[name][1] += len(gold[-1])
    scores = {name: f1_score(gold, values, mode="strict", scheme=IOB2) for name, values in predictions.items()}
    report = {
        "official_test_rows": len(test), "sentences": 50,
        "sentence_mix": {"judgment": 25, "preamble": 25},
        "strict_entity_f1": scores,
        "label_agreement": {name: same / total for name, (same, total) in agreements.items()},
        "entity_f1_delta_from_torch": {name: scores[name] - scores["torch"] for name in agreements},
    }
    (ROOT / "parity.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    for name in agreements:
        print(f"PARITY {name}: label agreement={report['label_agreement'][name]:.4f}; "
              f"entity F1 delta={report['entity_f1_delta_from_torch'][name]:+.4f}; sentences=50")


if __name__ == "__main__":
    main()
