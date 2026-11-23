"""Audit and calibrate a completed LSI run on the official dev split."""

import argparse
from functools import partial
import json
from pathlib import Path
import sys
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import torch
from safetensors.torch import load_model

from common import BASE, DATA, chunks, digest, split, tokenizer, write_json
from evaluate import LocalModel
from train import Classifier, predict, scores
from validation import onnx_parity, pooled_logits, quantize_weights


THRESHOLD_GRID = np.arange(1, 20) / 20
MIN_DEV_POSITIVES = 20


def calibrate(logits, gold, min_positives=MIN_DEV_POSITIVES):
    thresholds = THRESHOLD_GRID
    support = gold.astype(bool)
    positive_count = support.sum(axis=0)
    per_label_f1 = []
    for threshold in thresholds:
        decisions = logits >= np.log(threshold / (1 - threshold))
        found = (decisions & support).sum(axis=0)
        per_label_f1.append(2 * found / np.maximum(1, decisions.sum(axis=0) + positive_count))
    grid = np.stack(per_label_f1)
    fallback = thresholds[grid.mean(axis=1).argmax()]

    # Try the fallback first, then neighboring thresholds, so ties prefer the fallback.
    order = np.argsort(np.abs(thresholds - fallback), kind="stable")
    tuned = thresholds[order[grid[order].argmax(axis=0)]]
    return float(fallback), [float(t) if n >= min_positives else None for t, n in zip(tuned, positive_count, strict=True)]


def audit(train, dev, test):
    train_hashes = [digest(row["text"]) for row in train]
    dev_hashes = [digest(row["text"]) for row in dev]
    test_hashes = [digest(row["text"]) for row in test]
    train_set, dev_set, test_set = map(set, (train_hashes, dev_hashes, test_hashes))
    report = {
        "train_rows": len(train_hashes),
        "shared_dev_hashes": len(train_set & dev_set),
        "shared_test_hashes": len(train_set & test_set),
        "train_rows_overlapping_dev": sum(key in dev_set for key in train_hashes),
        "train_rows_overlapping_test": sum(key in test_set for key in train_hashes),
        "train_rows_overlapping_either": sum(key in dev_set or key in test_set for key in train_hashes),
        "dev_rows_overlapping_train": sum(key in train_set for key in dev_hashes),
        "test_rows_overlapping_train": sum(key in train_set for key in test_hashes),
    }
    clean_dev = np.array([key not in train_set for key in dev_hashes])
    clean_test = np.array([key not in train_set for key in test_hashes])
    return report, clean_dev, clean_test


def inputs(rows, tok, manifest):
    windows = []
    gold = np.zeros((len(rows), len(manifest["labels"])), dtype=np.float32)
    for offset in range(0, len(rows), 256):
        batch = rows[offset:offset + 256]
        windows.extend(chunks(tok, [" ".join(row["text"]) for row in batch], manifest["length"], manifest["stride"]))
        for i, row in enumerate(batch, offset):
            gold[i, row["labels"]] = 1
    return windows, gold


def predict_onnx(model, windows):
    return pooled_logits(model.session, windows, model.tokenizer.pad_token_id, len(model.manifest["labels"]))


def checkpoint_logits(model, tok, options, device, windows):
    return predict(model, (windows, None), tok, options, device)[0]


def infer_split(name, rows, tok, manifest, infer):
    windows, gold = inputs(rows, tok, manifest)
    print(f"{name}: {len(windows)} documents, {sum(map(len, windows))} windows", flush=True)
    logits = infer(windows)
    print(f"Finished {name} inference", flush=True)
    return logits, gold, windows


def evaluate(args):
    train, dev, test = (split(args.data, "lsi", name) for name in ("train", "dev", "test"))
    leakage, clean_dev, clean_test = audit(train, dev, test)
    print({"normalized_text_overlap": leakage}, flush=True)
    if args.audit_only:
        return
    if args.limit:
        dev, test = dev[:args.limit], test[:args.limit]
        clean_dev, clean_test = clean_dev[:args.limit], clean_test[:args.limit]
    del train

    model = None
    options = SimpleNamespace(eval_batch=args.eval_batch)
    if args.checkpoint:
        manifest = json.loads((args.artifact / "manifest.json").read_text(encoding="utf-8"))
        tok = tokenizer(args.artifact)
        torch.set_num_threads(min(6, torch.get_num_threads()))
        device = torch.device("cuda" if not args.cpu and torch.cuda.is_available() else "cpu")
        model = Classifier(args.base, len(manifest["labels"]), 0)
        load_model(model, args.checkpoint)
        model.to(device)
        infer = partial(checkpoint_logits, model, tok, options, device)
    else:
        artifact = LocalModel(args.artifact)
        manifest, tok = artifact.manifest, artifact.tokenizer
        infer = partial(predict_onnx, artifact)
    dev_logits, dev_gold, _ = infer_split("dev", dev, tok, manifest, infer)
    fallback, thresholds = calibrate(dev_logits[clean_dev], dev_gold[clean_dev])
    effective = np.array([fallback if t is None else t for t in thresholds])
    test_logits, test_gold, windows = infer_split("test", test, tok, manifest, infer)
    original = json.loads((args.artifact / "metrics.json").read_text(encoding="utf-8"))["threshold"]
    value = {
        "official_test": scores("lsi", test_logits, test_gold, effective),
        "test_without_exact_train_overlap": scores("lsi", test_logits[clean_test], test_gold[clean_test], effective),
        "test_original_threshold": scores("lsi", test_logits, test_gold, original),
        "clean_dev": scores("lsi", dev_logits[clean_dev], dev_gold[clean_dev], effective),
        "fallback": fallback, "label_threshold_count": sum(t is not None for t in thresholds),
        "min_dev_positives": MIN_DEV_POSITIVES, "normalized_text_overlap": leakage,
    }
    print(value, flush=True)
    if args.limit:
        return
    if not (args.artifact / "model_quantized.onnx").is_file():
        quantize_weights(args.artifact / "model.onnx", args.artifact / "model_quantized.onnx")
    sample = np.linspace(0, len(windows) - 1, min(128, len(windows)), dtype=int)
    held_out = [windows[i] for i in sample]
    if model is not None:
        reference = checkpoint_logits(model.cpu().float(), tok, options, torch.device("cpu"), held_out)
    else:
        reference = test_logits[sample]
    onnx_parity(args.artifact, "lsi", held_out, reference, tok.pad_token_id, effective)
    write_json(args.artifact / "calibration.json", value)
    write_json(args.artifact / "manifest.json", {**manifest, "threshold": fallback, "thresholds": thresholds})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path)
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--base", type=Path, default=BASE)
    parser.add_argument("--checkpoint", type=Path, help="Use the matching training checkpoint for faster inference")
    parser.add_argument("--cpu", action="store_true", help="Use CPU for checkpoint inference")
    parser.add_argument("--eval-batch", type=int, default=32)
    parser.add_argument("--limit", type=int, help="Read-only smoke run on a subset")
    parser.add_argument("--audit-only", action="store_true")
    evaluate(parser.parse_args())
