// Mediabunny helpers for the edit step: re-package, measure, trim, export
// and grab thumbnails. MediaRecorder writes a wrong duration header (0.16 s
// for a 4 s clip in Chrome), so every recording is re-packaged here before
// preview or upload. Cuts live in cuts.js; the two-track render in render.js.
import {
  Input, Output, Conversion, ALL_FORMATS, BlobSource, BufferTarget, Mp4OutputFormat, CanvasSink,
} from './vendor/mediabunny-1.61.6.min.mjs';
import { keptRanges, reencodeRanges } from './cuts.js';

export const openInput = (blob) => new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });

// Converts `blob` to a fast-start MP4, optionally keeping only start..end
// seconds. Streams are copied where possible; Mediabunny re-encodes only
// what it must (for example, when a trim does not start on a keyframe).
async function convert(blob, trim, onProgress) {
  const input = openInput(blob);
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const conversion = await Conversion.init(trim ? { input, output, trim } : { input, output });
  if (!conversion.isValid) {
    const reasons = conversion.discardedTracks.map((d) => d.reason).join(', ');
    throw new Error(`This recording cannot be converted to MP4 (${reasons || 'unknown reason'}).`);
  }
  if (onProgress) conversion.onProgress = onProgress;
  await conversion.execute();
  return new Blob([output.target.buffer], { type: 'video/mp4' });
}

// Reads duration, picture size and codecs from a media file.
export async function probe(blob) {
  const input = openInput(blob);
  const duration = await input.computeDuration();
  const video = await input.getPrimaryVideoTrack();
  const audio = await input.getPrimaryAudioTrack();
  return {
    duration,
    width: video ? video.displayWidth : null,
    height: video ? video.displayHeight : null,
    videoCodec: video ? await video.getCodecParameterString() : null,
    audioCodec: audio ? await audio.getCodecParameterString() : null,
  };
}

// Re-packages a raw MediaRecorder file into a seekable MP4 with a correct
// duration. Returns {blob, ...probe(blob)}.
export async function repackage(rawBlob, onProgress) {
  const blob = await convert(rawBlob, null, onProgress);
  return { blob, ...(await probe(blob)) };
}

// Keeps only start..end seconds of an MP4.
export function trimVideo(blob, start, end, onProgress) {
  return convert(blob, { start, end }, onProgress);
}

// Keeps start..end of an MP4 without the cut stretches. With nothing cut
// out of the middle this is the trim copy path; otherwise the kept
// stretches are re-encoded back to back (see cuts.js).
export async function exportClip(blob, { start, end, cuts = [], onProgress }) {
  const kept = keptRanges(start, end, cuts);
  if (!kept.length) throw new Error('the cuts take out the whole clip');
  if (kept.length === 1) return trimVideo(blob, kept[0].start, kept[0].end, onProgress);
  return reencodeRanges(blob, kept, onProgress);
}

// The decoded frame of `blob` showing at `time` (or the first frame), as a
// canvas `width` pixels wide, or null when the file has no video.
export async function frameAt(blob, time, width) {
  const input = openInput(blob);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const sink = new CanvasSink(track, { width });
    // getCanvas returns null when there is no frame at that time; fall back to the first frame.
    const frame = (await sink.getCanvas(Math.max(0, time))) || (await sink.getCanvas(await track.getFirstTimestamp()));
    return frame?.canvas || null;
  } finally {
    input.dispose();
  }
}

// A canvas as a JPEG Blob. Mediabunny hands back an HTMLCanvasElement in
// pages and an OffscreenCanvas in workers.
export function toJpeg(canvas) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  return new Promise((resolve, reject) => canvas.toBlob(
    (b) => (b ? resolve(b) : reject(new Error('Could not encode the thumbnail.'))), 'image/jpeg', 0.82,
  ));
}

// Returns a JPEG of the frame at `time` seconds, `width` pixels wide.
export async function grabFrame(blob, time, width = 640) {
  const canvas = await frameAt(blob, time, width);
  if (!canvas) throw new Error('Could not decode a frame for the thumbnail.');
  return toJpeg(canvas);
}
