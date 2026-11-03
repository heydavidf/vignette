// The two tracks. With the webcam on, the screen and the camera are recorded
// side by side as two files, and the bubble is drawn later, at export
// (render.js), wherever the edit step leaves it. This file starts and stops
// the two recorders, notes when the camera started after the screen, and
// keeps the camera in step with the screen in the edit step's preview.
// With the webcam off there is one recorder, exactly as before.

const DRIFT = 0.08; // seconds the preview's camera may wander before it is put back in step

// Never hard-code an H.264 level: let the browser pick. The camera file has
// no sound, so its list is the same one without the audio codecs.
export function pickMimeType(withAudio = true) {
  const candidates = withAudio
    ? ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

// The JavaScript heap's high-water mark, for the Details panel. Chrome and
// Edge report it; elsewhere `text()` says it cannot be measured.
export const heap = {
  peak: 0,
  sample() { const used = performance.memory?.usedJSHeapSize; if (used > this.peak) this.peak = used; },
  reset() { this.peak = 0; this.sample(); },
  text() { return performance.memory ? `${(this.peak / 1024 / 1024).toFixed(0)} MB JavaScript heap at most` : 'not measurable in this browser'; },
};

function recorder(stream, mimeType, bitrate) {
  const r = new MediaRecorder(stream, { mimeType: mimeType || undefined, videoBitsPerSecond: bitrate });
  const chunks = [];
  r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  // Created now, so a recorder that stops on its own (its camera unplugged)
  // still counts as stopped when Stop is pressed later.
  const stopped = new Promise((resolve) => r.addEventListener('stop', resolve, { once: true }));
  return { r, chunks, stopped, blob: () => new Blob(chunks, { type: r.mimeType || 'video/webm' }) };
}

// One audio track mixing tab audio and the microphone, or none.
function mixAudio(screen, mic) {
  const sources = [screen, mic].filter((s) => s?.getAudioTracks().length);
  if (!sources.length) return { tracks: [], context: null };
  const context = new AudioContext();
  const dest = context.createMediaStreamDestination();
  sources.forEach((s) => context.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(dest));
  return { tracks: dest.stream.getAudioTracks(), context };
}

/**
 * Starts recording. The screen file gets the screen's video and the mixed
 * sound; the camera file (when `cam` is given) gets the camera's video only.
 * Both start in the same tick; cameraOffset is how much later the camera's
 * start() ran, in seconds. Throws if the screen cannot be recorded; a camera
 * that cannot be recorded is left out and reported through onCamera.
 * @returns {{mimeType: string, cameraOffset: number|null, stop: () => Promise<object>}}
 */
export function startTracks({ screen, cam, mic, onScreenError, onCamera }) {
  const audio = mixAudio(screen, mic);
  let main;
  try {
    main = recorder(new MediaStream([...screen.getVideoTracks(), ...audio.tracks]), pickMimeType(true), 5_000_000);
  } catch (err) {
    audio.context?.close();
    throw err;
  }
  let side = null;
  if (cam) {
    try {
      side = recorder(new MediaStream(cam.getVideoTracks()), pickMimeType(false), 2_500_000);
    } catch (err) {
      onCamera?.(`could not be recorded (${err.message}); the video has no bubble`);
    }
  }
  main.r.onerror = (e) => onScreenError?.(e.error);
  let cameraLostAt = null;
  if (side) {
    side.r.onerror = (e) => onCamera?.(`recorder error (${e.error?.message || 'unknown'}); keeping what was recorded`);
    // Unplugged or permission taken back: the screen carries on and the
    // camera file simply ends early. The renderer holds its last frame.
    cam.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (cameraLostAt !== null || session.stopping) return;
      cameraLostAt = (performance.now() - screenStart) / 1000;
      onCamera?.(`lost ${cameraLostAt.toFixed(1)} s in; the screen kept recording, and the bubble holds the camera's last frame from there`);
      if (side.r.state !== 'inactive') side.r.stop();
    });
  }

  const screenStart = performance.now();
  main.r.start(1000);
  const cameraStart = performance.now();
  side?.r.start(1000);

  const session = {
    mimeType: main.r.mimeType,
    cameraOffset: side ? (cameraStart - screenStart) / 1000 : null,
    stopping: null,
    // Stops both (once) and resolves to {screen, camera, cameraOffset, cameraLostAt}: two Blobs, or one and null.
    stop() {
      this.stopping ||= (async () => {
        for (const x of [main, side]) if (x && x.r.state !== 'inactive') x.r.stop();
        await Promise.all([main.stopped, side?.stopped]);
        audio.context?.close();
        const camera = side?.blob();
        return { screen: main.blob(), camera: camera?.size ? camera : null, cameraOffset: this.cameraOffset, cameraLostAt };
      })();
      return this.stopping;
    },
  };
  return session;
}

/**
 * Keeps a muted camera <video> in step with the screen <video> it sits over:
 * the same play state, and camera time = screen time - offset whenever the
 * two drift more than 80 ms apart. Trim and cuts move the screen; the camera
 * follows. Past the camera's end it stays on its last frame.
 * @returns {() => void} unhooks it
 */
export function followScreen(screen, camera, offset) {
  const align = () => {
    let want = Math.max(0, screen.currentTime - offset);
    if (Number.isFinite(camera.duration)) want = Math.min(want, Math.max(0, camera.duration - 0.001));
    if (Math.abs(camera.currentTime - want) > DRIFT) camera.currentTime = want;
  };
  const handlers = {
    play() { align(); if (!(camera.currentTime >= camera.duration)) camera.play().catch(() => {}); },
    pause() { camera.pause(); align(); },
    seeking: align, seeked: align, timeupdate: align,
    ratechange() { camera.playbackRate = screen.playbackRate; },
  };
  for (const [type, fn] of Object.entries(handlers)) screen.addEventListener(type, fn);
  camera.addEventListener('loadedmetadata', align);
  return () => {
    for (const [type, fn] of Object.entries(handlers)) screen.removeEventListener(type, fn);
    camera.removeEventListener('loadedmetadata', align);
    camera.pause();
  };
}
