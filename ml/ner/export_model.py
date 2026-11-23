"""Export the fine-tuned classifier in transformers.js ONNX layout."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import AutoTokenizer

from data_utils import ROOT
from train import RUN_DIR


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, default=RUN_DIR)
    parser.add_argument("--artifact", type=Path, default=ROOT / "artifacts" / "courtplus-legalner")
    parser.add_argument("--fp32-only", action="store_true")
    args = parser.parse_args()
    run = args.run_dir
    with (run / "run.json").open(encoding="utf-8") as stream:
        settings = json.load(stream)
    if not settings["full_training"]:
        raise RuntimeError("Refusing to export a diagnostic or incomplete run")
    best = run / "best"
    artifact = args.artifact
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
    print(f"Exported {model_path} ({model_path.stat().st_size / 1024**2:.1f} MiB)")
    if not args.fp32_only:
        quantized = onnx_dir / "model_quantized.onnx"
        quantize_dynamic(str(model_path), str(quantized), weight_type=QuantType.QInt8)
        print(f"Quantized {quantized.stat().st_size / 1024**2:.1f} MiB")


if __name__ == "__main__":
    main()
