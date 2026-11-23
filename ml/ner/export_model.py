"""Export the fine-tuned classifier in transformers.js ONNX layout."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import AutoTokenizer

from data_utils import ROOT
from train import RUN_DIR


def main():
    run = RUN_DIR
    with (run / "run.json").open(encoding="utf-8") as stream:
        settings = json.load(stream)
    if not settings["full_training"]:
        raise RuntimeError("Refusing to export a diagnostic or incomplete run")
    best = run / "best"
    artifact = ROOT / "artifacts" / "courtplus-legalner"
    onnx_dir = artifact / "onnx"
    onnx_dir.mkdir(parents=True, exist_ok=True)
    cli = Path(sys.executable).parent / "optimum-cli.exe"
    subprocess.run([
        str(cli), "export", "onnx", "--model", str(best),
        "--task", "token-classification", "--opset", "17", str(onnx_dir),
    ], check=True)
    model_path = onnx_dir / "model.onnx"
    if not model_path.exists():
        raise FileNotFoundError(model_path)
    AutoTokenizer.from_pretrained(str(best)).save_pretrained(str(artifact))
    (artifact / "config.json").write_bytes((best / "config.json").read_bytes())
    quantize_dynamic(str(model_path), str(onnx_dir / "model_quantized.onnx"), weight_type=QuantType.QInt8)
    print(f"Exported {model_path} ({model_path.stat().st_size / 1024**2:.1f} MiB)")
    print(f"Quantized {(onnx_dir / 'model_quantized.onnx').stat().st_size / 1024**2:.1f} MiB")


if __name__ == "__main__":
    main()
