"""Fine-tune the local InLegalBERT encoder on the official LSI or RR split."""

import argparse
from contextlib import nullcontext
import json
import math
from pathlib import Path
import random
import sys
import time

# Isolated Python omits the script directory. Add only this trusted code directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pyarrow.parquet as pq
from sklearn.metrics import f1_score
import torch
from torch import nn
from torch.utils.checkpoint import checkpoint as recompute_forward
from transformers import AutoModel

from common import BASE, DATA, OUTPUT, ROLES, STRIDE, WINDOW
from common import chunks, export_onnx, overlap, split, statutes, tokenizer, truncate, write_json


class Classifier(nn.Module):
    def __init__(self, base, labels, freeze):
        super().__init__()
        self.encoder = AutoModel.from_pretrained(
            base, local_files_only=True, trust_remote_code=False, attn_implementation="sdpa",
        )
        self.encoder.embeddings.requires_grad_(False)
        for layer in self.encoder.encoder.layer[:freeze]:
            layer.requires_grad_(False)
        self.head = nn.Linear(self.encoder.config.hidden_size, labels)
        self.dropout = nn.Dropout(0.1)

    def forward(self, input_ids, attention_mask):
        hidden = self.encoder(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
        return self.head(self.dropout(hidden[:, 0]))


def minibatches(inputs, size, shuffle):
    # Bucket by padded length and number of windows to avoid padding short inputs to 512.
    order = sorted(range(len(inputs)), key=lambda i: (len(inputs[i]), len(inputs[i][0]) // 32))
    batches = [order[start:start + size] for start in range(0, len(order), size)]
    if shuffle:
        random.shuffle(batches)
    return batches


def forward(model, inputs, padding, device, chunk_batch):
    windows = [window for item in inputs for window in item]
    logits = []
    recompute = model.training and len(windows) > chunk_batch * 3
    for start in range(0, len(windows), chunk_batch):
        batch = windows[start:start + chunk_batch]
        width = max(map(len, batch))
        ids = torch.tensor([row + [padding] * (width - len(row)) for row in batch], device=device)
        mask = torch.tensor([[1] * len(row) + [0] * (width - len(row)) for row in batch], device=device)
        logits.append(recompute_forward(model, ids, mask, use_reentrant=False) if recompute else model(ids, mask))
    separated = torch.cat(logits).split([len(item) for item in inputs])
    return torch.stack([item.amax(dim=0) for item in separated])


def predict(model, data, tok, args, device):
    inputs, targets = data
    predictions = np.empty((len(inputs), model.head.out_features), dtype=np.float32)
    model.eval()
    with torch.inference_mode():
        for batch in minibatches(inputs, args.eval_batch, False):
            with precision(device):
                logits = forward(model, [inputs[i] for i in batch], tok.pad_token_id, device, args.eval_batch)
            predictions[batch] = logits.float().cpu().numpy()
    return predictions, targets


def precision(device):
    return torch.autocast("cuda", dtype=torch.float16) if device.type == "cuda" else nullcontext()


def scores(task, predictions, gold, threshold=None):
    if task == "lsi":
        predicted = predictions >= math.log(threshold / (1 - threshold))
        labels = None
    else:
        predicted = predictions.argmax(axis=1)
        labels = list(range(len(ROLES)))
    return {
        name: float(f1_score(gold, predicted, average=name, labels=labels, zero_division=0))
        for name in ("macro", "micro")
    }


def prepare(args, tok):
    names = ("train", "dev", "test")
    if args.task == "lsi":
        labels = statutes(args.data)
        rows = {name: split(args.data, "lsi", name) for name in names}
        schema = pq.ParquetFile(next((args.data / "lsi").glob("train-*.parquet"))).schema_arrow
        label_names = json.loads(schema.metadata[b"huggingface"])["info"]["features"]["labels"][0]["names"]
        if label_names != [label["label"] for label in labels]:
            raise ValueError("Official class indices differ from statute catalog order")
        leakage = {f"train_{name}": overlap(rows["train"], rows[name], "text") for name in names[1:]}
        result = {}
        for name, examples in rows.items():
            if name == "train" and args.train_limit and args.train_limit < len(examples):
                usable = random.Random(args.seed).sample(examples, args.train_limit)
            else:
                usable = examples[:args.limit] if args.limit else examples
            expected = np.zeros((len(usable), len(labels)), dtype=np.float32)
            inputs = []
            for start in range(0, len(usable), 256):
                batch = usable[start:start + 256]
                inputs.extend(chunks(tok, [" ".join(row["text"]) for row in batch]))
                for i, row in enumerate(batch, start):
                    expected[i, row["labels"]] = 1
            result[name] = (inputs, expected)
            print(f"{name}: {len(inputs)} documents, {sum(map(len, inputs))} windows", flush=True)
        return labels, result, leakage, {}

    rows = {name: [split(args.data, "rr", f"{kind}_{name}") for kind in ("CL", "IT")] for name in names}
    train_documents = rows["train"][0] + rows["train"][1]
    leakage = {
        f"train_{kind}_{name}": overlap(train_documents, documents, "text")
        for name in names[1:] for kind, documents in zip(("CL", "IT"), rows[name])
    }
    result, test_sizes = {}, {}
    for name, sets in rows.items():
        sentences, targets = [], []
        for kind, documents in zip(("CL", "IT"), sets):
            count = 0
            for row in documents:
                pairs = list(zip(row["text"], row["labels"], strict=True))
                sentences.extend(text for text, _ in pairs)
                targets.extend(label for _, label in pairs)
                count += len(pairs)
            if name == "test":
                test_sizes[kind] = count
        stop = args.limit or len(sentences)
        result[name] = (
            [[ids] for ids in truncate(tok, sentences[:stop], args.rr_length)],
            np.asarray(targets[:stop], dtype=np.int64),
        )
        print(f"{name}: {len(result[name][0])} sentences", flush=True)
    return ROLES, result, leakage, test_sizes


def train(args):
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type == "cpu":
        torch.set_num_threads(min(6, torch.get_num_threads()))
    tok = tokenizer(args.base)
    labels, data, leakage, test_sizes = prepare(args, tok)
    model = Classifier(args.base, len(labels), args.freeze).to(device)
    inputs, targets = data["train"]
    optimizer = torch.optim.AdamW((p for p in model.parameters() if p.requires_grad), lr=args.lr)
    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")
    loss_fn = nn.CrossEntropyLoss()
    if args.task == "lsi":
        counts = targets.sum(axis=0)
        weights = np.sqrt((len(targets) - counts) / np.maximum(1, counts)).clip(1, 25)
        loss_fn = nn.BCEWithLogitsLoss(pos_weight=torch.tensor(weights, device=device))
    location = args.output / args.task
    location.mkdir(parents=True, exist_ok=True)
    checkpoint = location / "best.safetensors"
    from safetensors.torch import load_model, save_model

    started = time.monotonic()
    best_score, best_threshold, steps, seen = -1, None, 0, 0
    for epoch in range(args.epochs):
        model.train()
        batches = minibatches(inputs, args.batch, True)
        optimizer.zero_grad(set_to_none=True)
        for i, batch in enumerate(batches):
            seen += len(batch)
            size = min(args.accumulate, len(batches) - (i // args.accumulate) * args.accumulate)
            with precision(device):
                logits = forward(model, [inputs[j] for j in batch], tok.pad_token_id, device, args.batch)
                loss = loss_fn(logits, torch.as_tensor(targets[batch], device=device)) / size
            scaler.scale(loss).backward()
            if (i + 1) % args.accumulate == 0 or i + 1 == len(batches):
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1)
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad(set_to_none=True)
                steps += 1
                if steps % 100 == 0:
                    print(f"{steps} optimizer steps, {time.monotonic() - started:.0f}s", flush=True)
            if time.monotonic() - started >= args.minutes * 60:
                break
        logits, gold = predict(model, data["dev"], tok, args, device)
        options = np.linspace(0.15, 0.85, 29) if args.task == "lsi" else [None]
        candidates = [(scores(args.task, logits, gold, t)["macro"], t) for t in options]
        dev_score, threshold = max(candidates, key=lambda result: result[0])
        print(f"Epoch {epoch + 1}: dev macro-F1 {dev_score:.4f}, threshold {threshold}", flush=True)
        if dev_score > best_score:
            best_score, best_threshold = dev_score, threshold
            save_model(model, checkpoint)
        if time.monotonic() - started >= args.minutes * 60:
            break

    load_model(model, checkpoint)
    logits, gold = predict(model, data["test"], tok, args, device)
    metrics = {
        "test": scores(args.task, logits, gold, best_threshold), "dev_macro": best_score,
        "threshold": best_threshold, "steps": steps, "train_items_seen": seen,
        "device": str(device), "leakage": leakage,
        "split_items": {key: len(value[0]) for key, value in data.items()},
        "training_and_evaluation_seconds": round(time.monotonic() - started),
        "seed": args.seed, "frozen_encoder_layers": args.freeze, "smoke_limit": args.limit,
    }
    offset = 0
    if not args.limit:
        for kind, length in test_sizes.items():
            metrics[kind] = scores(args.task, logits[offset:offset + length], gold[offset:offset + length])
            offset += length
    write_json(location / "metrics.json", metrics)
    print(metrics, flush=True)
    if args.no_export:
        return
    del optimizer, scaler
    export_onnx(model, tok, location, "logits")
    if args.task == "lsi":
        from onnxruntime.quantization import QuantType, quantize_dynamic

        quantize_dynamic(
            str(location / "model.onnx"), str(location / "model_quantized.onnx"),
            weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul", "Gemm"],
        )
    write_json(location / "manifest.json", {
        "labels": labels, "length": WINDOW if args.task == "lsi" else args.rr_length,
        "stride": STRIDE if args.task == "lsi" else 0, "threshold": best_threshold,
        "source": "IL-TUR (ACL 2024), InLegalBERT", "license": "CC BY-NC-SA 4.0",
    })
    checkpoint.unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("task", choices=("lsi", "rr"))
    parser.add_argument("--data", type=Path, default=DATA)
    parser.add_argument("--base", type=Path, default=BASE)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--limit", type=int, help="Limit each split for a smoke run")
    parser.add_argument("--train-limit", type=int, help="Sample this many LSI training examples, leaving evaluation intact")
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--freeze", type=int, default=8)
    parser.add_argument("--lr", type=float, default=5e-5)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--eval-batch", type=int, default=24)
    parser.add_argument("--accumulate", type=int, default=4)
    parser.add_argument("--minutes", type=float, default=45, help="Time budget for optimizer steps")
    parser.add_argument("--rr-length", type=int, default=256)
    parser.add_argument("--no-export", action="store_true")
    train(parser.parse_args())
