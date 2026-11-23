"""Fine-tune InLegalBERT on pinned Indian legal NER annotations."""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import time
from pathlib import Path

import numpy as np
import torch
from seqeval.metrics import f1_score, precision_score, recall_score
from seqeval.scheme import IOB2
from transformers import (
    AutoModelForTokenClassification, AutoTokenizer, DataCollatorForTokenClassification,
    Trainer, TrainerCallback, TrainingArguments, set_seed,
)

from data_utils import LABELS, LABEL_TO_ID, ROOT, load_official, tokenize_spans


MODEL_ID = "law-ai/InLegalBERT"
MODEL_REVISION = "b5ecfed8ed6cf9d25a3cb8225a8c52f161f7401a"
MODEL_PATH = ROOT / "data" / "base-model"
RUN_DIR = ROOT / "runs" / "legalner-official"


def sequences(predictions, references):
    predicted, expected = [], []
    for prediction, reference in zip(predictions, references):
        keep = reference != -100
        predicted.append([LABELS[int(value)] for value in prediction[keep]])
        expected.append([LABELS[int(value)] for value in reference[keep]])
    return predicted, expected


def score(eval_prediction):
    predicted, expected = sequences(eval_prediction.predictions.argmax(axis=-1), eval_prediction.label_ids)
    return {
        "precision": precision_score(expected, predicted, mode="strict", scheme=IOB2),
        "recall": recall_score(expected, predicted, mode="strict", scheme=IOB2),
        "f1": f1_score(expected, predicted, mode="strict", scheme=IOB2),
    }


class TimeBudget(TrainerCallback):
    def __init__(self, max_seconds=7200):
        self.started = time.perf_counter()
        self.max_seconds = max_seconds

    def on_step_end(self, args, state, control, **kwargs):
        if state.global_step == 100:
            elapsed = time.perf_counter() - self.started
            projected = elapsed * state.max_steps / 100
            print(f"BENCHMARK 100 steps: {elapsed:.1f}s; projected {projected / 60:.1f} min for {state.max_steps} steps", flush=True)
            if projected > self.max_seconds:
                print("Projection exceeds two hours; stopping after the benchmark.", flush=True)
                control.should_training_stop = True
        return control


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--cpu", action="store_true")
    parser.add_argument("--limit-train", type=int, default=0, help="Diagnostic only; never report its scores as full evaluation")
    args = parser.parse_args()

    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    set_seed(42)
    random.seed(42)
    np.random.seed(42)
    use_cuda = torch.cuda.is_available() and not args.cpu
    print(f"device={'cuda' if use_cuda else 'cpu'}; GPU={torch.cuda.get_device_name(0) if use_cuda else 'unavailable'}", flush=True)
    if not use_cuda:
        args.batch_size = min(args.batch_size, 2)
        args.epochs = min(args.epochs, 1)
        print("Reduced CPU plan: batch 2, one epoch", flush=True)

    tokenizer = AutoTokenizer.from_pretrained(str(MODEL_PATH), local_files_only=True, use_fast=True)
    model = AutoModelForTokenClassification.from_pretrained(
        str(MODEL_PATH), local_files_only=True, num_labels=len(LABELS),
        id2label={i: label for i, label in enumerate(LABELS)}, label2id=LABEL_TO_ID,
    )
    train = load_official("train")
    dev = load_official("dev")
    if args.limit_train:
        train = train.select(range(min(args.limit_train, len(train))))
    print(f"official source rows: train={len(train)}, dev={len(dev)}", flush=True)
    train = train.map(lambda batch: tokenize_spans(batch, tokenizer), batched=True, remove_columns=train.column_names)
    dev = dev.map(lambda batch: tokenize_spans(batch, tokenizer), batched=True, remove_columns=dev.column_names)
    print(f"tokenized chunks: train={len(train)}, dev={len(dev)}", flush=True)
    run_dir = RUN_DIR
    run_dir.mkdir(parents=True, exist_ok=True)
    effective_batch = 32
    accumulation = math.ceil(effective_batch / args.batch_size)
    training_args = TrainingArguments(
        output_dir=str(run_dir), learning_rate=5e-5, num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size, per_device_eval_batch_size=args.batch_size,
        gradient_accumulation_steps=accumulation, fp16=use_cuda,
        eval_strategy="epoch", save_strategy="epoch", logging_steps=50,
        load_best_model_at_end=True, metric_for_best_model="f1", greater_is_better=True,
        save_total_limit=2, seed=42, data_seed=42, report_to="none",
        dataloader_num_workers=0,
    )
    trainer = Trainer(
        model=model, args=training_args, train_dataset=train, eval_dataset=dev,
        data_collator=DataCollatorForTokenClassification(tokenizer),
        processing_class=tokenizer, compute_metrics=score, callbacks=[TimeBudget()],
    )
    trainer.train()
    print(f"best checkpoint: {trainer.state.best_model_checkpoint}", flush=True)
    trainer.save_model(str(run_dir / "best"))
    tokenizer.save_pretrained(str(run_dir / "best"))
    with (run_dir / "run.json").open("w", encoding="utf-8") as stream:
        json.dump({"model_id": MODEL_ID, "model_revision": MODEL_REVISION,
                   "seed": 42, "epochs": args.epochs, "batch_size": args.batch_size,
                   "gradient_accumulation": accumulation,
                   "training_split": "official train", "selection_split": "official dev",
                   "full_training": not args.limit_train and trainer.state.global_step >= trainer.state.max_steps}, stream, indent=2)


if __name__ == "__main__":
    main()
