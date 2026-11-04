# MobileCLIP2-B – Textteil (verkleinert)

Textteil von Apple MobileCLIP2-B (https://huggingface.co/apple/MobileCLIP2-B, Lizenz apple-amlr),
ONNX-Export von https://huggingface.co/plhery/mobileclip2-onnx (`onnx/b/text_model.onnx`, fp32, 254 MB),
hier auf 8 Bit verkleinert (onnxruntime `quantize_dynamic`, QUInt8, per_channel) → 65 MB.
Übereinstimmung mit dem Original (Kosinus): Mittel 0,968, Minimum 0,956.

Eingang `input_ids` [n, 77] (CLIP-Wörterbuch, aufgefüllt mit 0), Ausgang `text_embeds` [n, 512].
Wörterbuch und Bild-Vorverarbeitung: wie `Xenova/mobileclip_blt` (geprüft: gleiche Token).
