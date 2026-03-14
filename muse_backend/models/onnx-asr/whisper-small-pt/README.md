
---
language: 
- pt

license: apache-2.0
---

# OVOS - Whisper Small Portuguese

This model is an ONNX-format export of the model available at [remynd/whisper-small-pt](https://huggingface.co/remynd/whisper-small-pt),
for ease of use in edge devices and CPU-based inference environments.

# Requirements

The export is based on:
- [optimum](https://github.com/huggingface/optimum) for exporting the model
- [onnx-asr](https://github.com/istupakov/onnx-asr) for inference

The requirements can be installed as

```bash
$ pip install optimum[onnxruntime] onnx-asr
```

# Usage

```python
import onnx_asr
model = onnx_asr.load_model("OpenVoiceOS/whisper-small-pt-onnx")
print(model.recognize("test.wav"))
```

# Export

According to [onnx-asr/convert-model-to-onnx](https://github.com/istupakov/onnx-asr?tab=readme-ov-file#convert-model-to-onnx)):

```bash
$ export FORCE_ONNX_EXTERNAL_DATA=1
$ optimum-cli export onnx --task automatic-speech-recognition-with-past --model remynd/whisper-small-pt whisper-onnx
$ cd whisper-onnx && rm decoder.onnx* decoder_with_past_model.onnx*  # only the merged decoder is needed
```

# Licensing

The license is derived from the original model: Apache 2.0. For more details, please refer to [remynd/whisper-small-pt](https://huggingface.co/remynd/whisper-small-pt).

