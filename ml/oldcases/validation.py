"""Evaluate exported classifiers with the local ONNX Runtime CPU provider."""

import logging

import numpy as np
import onnxruntime as ort

from common import write_json


def quantize_weights(source, destination):
    from onnxruntime.quantization.matmul_nbits_quantizer import (
        DefaultWeightOnlyQuantConfig, MatMulNBitsQuantizer,
    )

    # Keep activations and the classifier head in fp32.
    config = DefaultWeightOnlyQuantConfig(
        bits=8, block_size=128, is_symmetric=True, accuracy_level=1,
        op_types_to_quantize=("MatMul",),
    )
    quantizer = MatMulNBitsQuantizer(str(source), algo_config=config)
    logger = logging.getLogger("onnxruntime.quantization.matmul_nbits_quantizer")
    previous = logger.level
    logger.setLevel(logging.WARNING)
    try:
        quantizer.process()
    finally:
        logger.setLevel(previous)
    quantizer.model.save_model_to_file(str(destination))


def logit_session(path):
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    return ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])


def logit_rows(session, inputs, pad_id):
    for offset in range(0, len(inputs), 16):
        batch = inputs[offset:offset + 16]
        width = max(map(len, batch))
        ids = np.full((len(batch), width), pad_id, dtype=np.int64)
        mask = np.zeros_like(ids)
        for i, row in enumerate(batch):
            ids[i, :len(row)] = row
            mask[i, :len(row)] = 1
        yield from session.run(["logits"], {"input_ids": ids, "attention_mask": mask})[0]


def pooled_logits(session, documents, pad_id, label_count):
    windows = [window for document in documents for window in document]
    order = sorted(range(len(windows)), key=lambda i: len(windows[i]))
    rows = np.empty((len(order), label_count), dtype=np.float32)
    rows[order] = list(logit_rows(session, [windows[i] for i in order], pad_id))
    cuts = np.cumsum([len(document) for document in documents])[:-1]
    return np.stack([window.max(axis=0) for window in np.split(rows, cuts)])


def onnx_parity(directory, task, documents, reference, pad_id, thresholds=None):
    """Use held-out inputs and compare predictions after window max-pooling."""
    results = {"samples": len(documents), "windows": sum(map(len, documents))}
    for name, file in (("fp32", "model.onnx"), ("int8", "model_quantized.onnx")):
        session = logit_session(directory / file)
        actual = pooled_logits(session, documents, pad_id, reference.shape[1])
        del session
        error = np.abs(actual - reference)
        if not np.isfinite(actual).all():
            raise ValueError(f"Non-finite {name} model output")
        metrics = {"mean_absolute_error": float(error.mean()), "max_absolute_error": float(error.max())}
        if task == "rr":
            agreement = (actual.argmax(axis=1) == reference.argmax(axis=1)).mean()
            metrics["top1_agreement"] = float(agreement)
        else:
            actual_top = np.argsort(-actual, axis=1, kind="stable")[:, :5]
            reference_top = np.argsort(-reference, axis=1, kind="stable")[:, :5]
            agreement = np.mean([len(set(a) & set(b)) / 5 for a, b in zip(actual_top, reference_top, strict=True)])
            metrics["mean_top5_overlap"] = float(agreement)
            cutoffs = np.log(np.asarray(thresholds) / (1 - np.asarray(thresholds)))
            metrics["threshold_agreement"] = float(((actual >= cutoffs) == (reference >= cutoffs)).mean())
        if name == "fp32":
            np.testing.assert_allclose(actual, reference, rtol=1e-3, atol=5e-4)
        results[name] = metrics
    write_json(directory / "parity.json", results)
    print({"parity": results}, flush=True)
