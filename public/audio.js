// Sound on its way to the encoder. Browsers encode AAC at 44.1 and 48 kHz
// only (Chrome refuses AAC-LC at 24 kHz, and for 24 kHz and below Mediabunny
// asks for HE-AAC, which no browser encodes), while a Bluetooth headset's
// microphone, AirPods for one, makes the recording 24 kHz or 16 kHz. So any
// other rate is resampled to 48 kHz here, by linear interpolation between
// neighbouring frames, which keeps a voice clear. Used by render.js and cuts.js.
import { AudioSample } from './vendor/mediabunny-1.61.6.min.mjs';

const KEPT = [44100, 48000]; // encoded as they are
const RATE = 48000;

// Returns feed(sample): the same sample when its rate encodes as it is,
// otherwise a new sample at 48 kHz (the caller closes it as well), or null
// when this sample adds no output frame yet. One feed per stretch of sound:
// it carries the last frame over, so consecutive samples join without a step.
export function audioFeed() {
  let rate = 0, prev = null, pos = 0; // pos: the next output frame, in input frames from the next sample's first
  return (sample) => {
    const { sampleRate, numberOfFrames: n, numberOfChannels: ch } = sample;
    if (KEPT.includes(sampleRate)) return sample;
    if (sampleRate !== rate || prev?.length !== ch) { rate = sampleRate; prev = null; pos = 0; }
    const step = rate / RATE;
    const planes = [];
    for (let c = 0; c < ch; c++) {
      const p = new Float32Array(n);
      sample.copyTo(p, { planeIndex: c, format: 'f32-planar' });
      planes.push(p);
    }
    const start = prev ? pos : Math.max(0, pos); // before 0 only with a previous frame to lean on
    const count = n && start <= n - 1 ? Math.floor((n - 1 - start) / step) + 1 : 0;
    const data = new Float32Array(count * ch);
    for (let c = 0; c < ch; c++) {
      const x = planes[c];
      for (let j = 0; j < count; j++) {
        const q = start + j * step, i = Math.floor(q), f = q - i;
        const a = i < 0 ? prev[c] : x[i];
        data[c * count + j] = f && i + 1 < n ? a + (x[i + 1] - a) * f : a; // i + 1 < n guards rounding at the end
      }
    }
    if (n) { pos = start + count * step - n; prev = planes.map((x) => x[n - 1]); }
    if (!count) return null;
    return new AudioSample({ data, format: 'f32-planar', numberOfChannels: ch, sampleRate: RATE, timestamp: sample.timestamp + start / rate });
  };
}
