import { convertToWav } from "./wavEncoder";

export type ValidationResult = {
  uploadBlob: Blob;
  uploadMime: string;
  filename: string;
  validated: boolean;
  fellBackToWav: boolean;
  validationMs: number;
};

/**
 * Validates an audio blob by attempting a local AudioContext.decodeAudioData().
 * If decode succeeds, the original blob is returned as-is.
 * If decode fails (corrupt m4a container — known iOS Safari MediaRecorder quirk),
 * the blob is converted to WAV before upload so Voxtral never sees the corrupt container.
 */
export async function validateAndPrepare(
  blob: Blob,
  mimeType: string,
): Promise<ValidationResult> {
  const start = performance.now();

  try {
    const arrayBuf = await blob.arrayBuffer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    // slice(0) gives a fresh copy — decodeAudioData consumes the buffer
    await ctx.decodeAudioData(arrayBuf.slice(0));
    ctx.close();

    return {
      uploadBlob:   blob,
      uploadMime:   mimeType,
      filename:     filenameForMime(mimeType),
      validated:    true,
      fellBackToWav: false,
      validationMs: Math.round(performance.now() - start),
    };
  } catch (decodeErr) {
    // eslint-disable-next-line no-console
    console.warn("[audio] local decode failed, falling back to WAV", decodeErr);
    const wavBlob = await convertToWav(blob);
    return {
      uploadBlob:   wavBlob,
      uploadMime:   "audio/wav",
      filename:     "audio.wav",
      validated:    false,
      fellBackToWav: true,
      validationMs: Math.round(performance.now() - start),
    };
  }
}

function filenameForMime(mime: string): string {
  if (mime.startsWith("audio/mp4")) return "audio.m4a";
  if (mime.startsWith("audio/wav")) return "audio.wav";
  if (mime.startsWith("audio/webm")) return "audio.webm";
  return "audio.bin";
}
