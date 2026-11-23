"""Download the pinned base model and official InLegalNER splits for development."""

from __future__ import annotations

import os
from pathlib import Path

from huggingface_hub import hf_hub_download, snapshot_download

from data_utils import DATA, OFFICIAL_FILES
from train import MODEL_ID, MODEL_REVISION


DATASET_ID = "opennyaiorg/InLegalNER"
DATASET_REVISION = "2e32a46e6714424979db8677b39dbc0aa7e308e7"


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        MODEL_ID, revision=MODEL_REVISION, local_dir=DATA / "base-model",
        allow_patterns=["config.json", "pytorch_model.bin", "vocab.txt",
                        "tokenizer_config.json", "special_tokens_map.json"],
    )
    token = Path(os.environ["HF_TOKEN_PATH"]).read_text(encoding="utf-8").strip()
    for filename in OFFICIAL_FILES.values():
        hf_hub_download(DATASET_ID, f"data/{filename}", repo_type="dataset",
                        revision=DATASET_REVISION, local_dir=DATA / "official", token=token)
    print("Downloaded pinned base model and official train/dev/test parquet files")


if __name__ == "__main__":
    main()
