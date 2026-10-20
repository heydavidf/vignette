# Mid-section cuts build spec

Added after the MVP and before the first release: cutting a mistake out of the middle is the first thing a recorder needs beyond trimming. This spec adds cutting out ranges from the middle of a recording. It keeps the MVP's trim as the fast path and adds a re-encode path only when a cut exists.

## What the user sees

On the edit step (band 3), beneath the existing trim bar:

- **Cut from here / Cut to here.** Two square actions in the same pictogram-plus-word style as Set start here / Set end here. The first marks the player's current time as the start of a new cut; the second closes it. A cut must be at least 0.3 s long and must lie inside the kept trim range.
- **Cuts drawn on the bar.** Each cut is a struck-through stretch on the trim bar (sign grammar: a struck rule means removed). The kept stretch stays solid.
- **Cut list.** Below the bar, one row per cut: "Cut 1  0:12.4 to 0:18.0  (5.6 s)" with a square Remove action. Empty state: nothing shown.
- **Clip length** already shown next to the bar now subtracts the cuts.
- **Preview skips cuts.** While the preview plays, when `currentTime` enters a cut it jumps to the cut's end, so the user hears the result before exporting.
- **Export label.** When any cut exists, the Export and Upload actions say what will happen: "Re-encoding 1 cut" in the progress text, with the progress bar driven by the re-encode.
- Keyboard: the trim and cut controls stay reachable with the keyboard; the cut list rows are buttons with accessible names.

## How export works

`editor.js` gains `exportClip(blob, {start, end, cuts, onProgress})`:

1. **No cuts:** unchanged, the existing `trimVideo` copy path through `Conversion`.
2. **Cuts present:** re-encode. Compute the kept ranges: `[start, end]` minus the cuts, sorted, merged if overlapping. Then:
   - `const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) })`, get the primary video track and the primary audio track (audio may be absent; handle that).
   - `const vSink = new VideoSampleSink(videoTrack)` and `const aSink = new AudioSampleSink(audioTrack)` (Mediabunny 1.61, vendored).
   - `const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })`.
   - `const vSrc = new VideoSampleSource({ codec: 'avc', quality: new Quality({ bitrate: 5e6 }) })`, `output.addVideoTrack(vSrc, { frameRate: 30 })`; `const aSrc = new AudioSampleSource({ codec: 'aac', quality: new Quality({ bitrate: 128e3 }) })`, `output.addAudioTrack(aSrc)` when audio exists. `await output.start()`.
   - For each kept range `[s, e]` with running `offset`: `for await (const sample of vSink.samples(s, e))`, skip samples with `timestamp < s` or `>= e`, `sample.setTimestamp(offset + sample.timestamp - s)`, `await vSrc.add(sample, { keyFrame: firstOfSegment })`, `sample.close()`. Same for audio samples; for an audio sample that straddles a range edge, keep it whole if its start is inside the range (a few milliseconds of overlap is acceptable for this version; note it in a comment). Interleave: process video and audio per range, not all video then all audio, so the muxer does not buffer a whole track.
   - `offset += e - s` after each range. `vSrc.close(); aSrc.close(); await output.finalize();` then `new Blob([output.target.buffer], { type: 'video/mp4' })`.
   - Progress: samples processed over an estimate (`(e - s) * 30` frames per range).
   - Free memory: close every sample after adding it. If the re-encode throws, the error panel says "Could not re-encode the cuts" and the Download and Upload actions stay usable with the trim-only export.
3. The thumbnail picker and duration shown after export use the exported blob, as today.

## Tests

In `test/e2e.mjs`, a new step: record about 8 s, set trim 1 s to 7 s, add a cut from 3 s to 5 s via the buttons (seek the preview with `page.evaluate` then click Cut from here / Cut to here), assert the cut list shows one row and the clip length reads about 4.0 s, export, assert the exported duration is 4.0 s within 0.3 s, the file has audio and video tracks, and a decoded frame at 1 s is not black. Also: preview playback from 2.5 s jumps past 5 s within one second of play. Also: Remove on the cut row restores the clip length. The multipart, bubble and all other steps stay as they are.

Per the repo standard, a different agent writes an independent scenario test before the change is accepted; the builder does not write that one.

## Out of scope

Filler-word removal (needs a transcript; see BACKLOG.md), ripple-editing of the thumbnail time, undo history beyond Remove, cuts on the share page.

## Definition of done

- `npm test` and `BACKGROUND=1 npm test` print E2E OK with the new step.
- The independent scenario test passes.
- No file over ~500 lines (split `editor.js` into `editor.js` and `cuts.js` if needed).
- No new dependencies, no em-dashes, DESIGN.md's rules followed for the new controls (pictogram squares, struck rule for removed, tabular numerals).
- BACKLOG.md updated: mid-section cuts moved to done, filler words still listed.
