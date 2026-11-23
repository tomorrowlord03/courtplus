"""Continue masked-language modeling on the audited IBJ training texts."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import torch
from datasets import Dataset
from transformers import (
    AutoModelForMaskedLM, AutoTokenizer, DataCollatorForLanguageModeling,
    Trainer, TrainerCallback, TrainingArguments, set_seed,
)


class Deadline(TrainerCallback):
    def __init__(self, seconds: int):
        self.seconds = seconds
        self.started = 0.0

    def on_train_begin(self, args, state, control, **kwargs):
        self.started = time.monotonic()

    def on_step_end(self, args, state, control, **kwargs):
        if time.monotonic() - self.started >= self.seconds:
            control.should_training_stop = True
        return control


def pretrain(base: Path, texts: list[str], output: Path, seconds: int = 1650) -> dict:
    if not torch.cuda.is_available():
        raise RuntimeError("DAPT requires CUDA")
    if not texts or not 0 < seconds <= 1800:
        raise ValueError("DAPT needs audited training texts and a GPU budget up to 30 minutes")
    set_seed(42)
    tokenizer = AutoTokenizer.from_pretrained(base, local_files_only=True)
    model = AutoModelForMaskedLM.from_pretrained(base, local_files_only=True)

    def encode(batch):
        features = tokenizer(batch["text"], max_length=256, truncation=True,
                             return_overflowing_tokens=True, return_special_tokens_mask=True,
                             verbose=False)
        del features["overflow_to_sample_mapping"]
        return features

    dataset = Dataset.from_dict({"text": texts}).map(encode, batched=True, remove_columns=["text"])
    deadline = Deadline(seconds)
    trainer = Trainer(
        model=model,
        args=TrainingArguments(
            output_dir=str(output), learning_rate=5e-5, num_train_epochs=3,
            per_device_train_batch_size=8, gradient_accumulation_steps=4,
            fp16=True, save_strategy="no", logging_steps=25, report_to="none",
            seed=42, data_seed=42, dataloader_num_workers=0,
        ),
        train_dataset=dataset,
        processing_class=tokenizer,
        data_collator=DataCollatorForLanguageModeling(tokenizer, mlm_probability=0.15, seed=42),
        callbacks=[deadline],
    )
    trainer.train()
    trainer.save_model(str(output))
    report = {
        "orders": len(texts), "chunks": len(dataset), "seed": 42, "epochs": trainer.state.epoch,
        "steps": trainer.state.global_step, "planned_steps": trainer.state.max_steps,
        "elapsed_seconds": round(time.monotonic() - deadline.started, 1),
        "gpu_limit_seconds": seconds, "max_length": 256, "mlm_probability": 0.15,
    }
    (output / "dapt.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"DAPT complete: {report['steps']} steps, {report['orders']} orders, "
          f"{report['elapsed_seconds']} seconds", flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    texts = [Path(item).read_text(encoding="utf-8") for item in manifest["dapt_text_paths"]]
    pretrain(args.base, texts, args.output)


if __name__ == "__main__":
    main()
