import { FFmpeg } from "@ffmpeg/ffmpeg";

const CORE_CDN =
  "https://cdn.jsdelivr.net/npm/@ffmpeg/core-st@0.12.6/dist/umd";

let _ff: FFmpeg | null = null;
let _loadPromise: Promise<void> | null = null;
let _busy = false;
const _queue: Array<() => void> = [];

async function ensureLoaded(): Promise<FFmpeg> {
  if (_ff?.loaded) return _ff;
  if (!_loadPromise) {
    const ff = new FFmpeg();
    _ff = ff;
    _loadPromise = ff.load({
      coreURL: `${CORE_CDN}/ffmpeg-core.js`,
      wasmURL: `${CORE_CDN}/ffmpeg-core.wasm`,
    });
  }
  await _loadPromise;
  return _ff!;
}

async function execSerial(fn: (ff: FFmpeg) => Promise<void>): Promise<void> {
  if (_busy) {
    await new Promise<void>((resolve) => _queue.push(resolve));
  }
  _busy = true;
  try {
    const ff = await ensureLoaded();
    await fn(ff);
  } finally {
    _busy = false;
    _queue.shift()?.();
  }
}

export function isWebm(mimeType: string): boolean {
  return mimeType.startsWith("audio/webm");
}

/**
 * Convert a WebM/Opus blob to 16 kHz mono WAV.
 * Voxtral rejects WebM (code 3310); WAV is universally accepted.
 * Uses a module-level FFmpeg instance loaded once from jsDelivr CDN.
 */
export async function convertWebmToWav(
  blob: Blob,
): Promise<{ buffer: Buffer; mimeType: "audio/wav" }> {
  const id = Math.random().toString(36).slice(2, 10);
  const inputName = `in_${id}.webm`;
  const outputName = `out_${id}.wav`;
  let wavData: Uint8Array | undefined;

  await execSerial(async (ff) => {
    const arrayBuf = await blob.arrayBuffer();
    await ff.writeFile(inputName, new Uint8Array(arrayBuf));
    await ff.exec([
      "-i", inputName,
      "-ar", "16000",
      "-ac", "1",
      "-f", "wav",
      outputName,
    ]);
    wavData = (await ff.readFile(outputName)) as Uint8Array;
    await ff.deleteFile(inputName);
    await ff.deleteFile(outputName);
  });

  return { buffer: Buffer.from(wavData!), mimeType: "audio/wav" };
}
