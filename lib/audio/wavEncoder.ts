/**
 * Converts a WebM/Opus blob to WAV (16 kHz, mono, 16-bit PCM little-endian).
 * Used for the non-iOS recording path before upload to Voxtral.
 *
 * Web Audio API decodes the source format (any browser-supported codec),
 * OfflineAudioContext resamples to 16 kHz mono, then we write a standard
 * PCM WAV header in the ArrayBuffer so Mistral accepts the file directly.
 */
export async function convertToWav(blob: Blob): Promise<Blob> {
  const arrayBuf = await blob.arrayBuffer();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const decodeCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const decoded = await decodeCtx.decodeAudioData(arrayBuf);

  const targetRate = 16000;
  let pcmFloat: Float32Array;
  if (decoded.sampleRate === targetRate && decoded.numberOfChannels === 1) {
    pcmFloat = decoded.getChannelData(0);
  } else {
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * targetRate),
      targetRate,
    );
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    pcmFloat = rendered.getChannelData(0);
  }

  const pcm16 = new Int16Array(pcmFloat.length);
  for (let i = 0; i < pcmFloat.length; i++) {
    const s = Math.max(-1, Math.min(1, pcmFloat[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + pcm16.byteLength);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm16.byteLength, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);  // PCM
  view.setUint16(22, 1, true);  // mono
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);  // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(view, 36, "data");
  view.setUint32(40, pcm16.byteLength, true);
  new Int16Array(buffer, headerSize).set(pcm16);

  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}
