# Loop 2: floating self-view (build spec)

Branch `v0.2-tracks-layouts`, on top of loop 1. While recording, a small always-on-top window shows what is being recorded, the elapsed time, a recording dot and Stop, so the user can work in any app without hunting for the Vignette tab. An optional script panel (teleprompter) lives in the same window. Nothing about recording, rendering, upload or the share page changes. Plan decision: composite view by default, camera-only toggle.

## What changes for the user

- Pressing **Start recording** opens a small floating window next to the countdown. It shows 3, 2, 1, then the live picture with a red dot, the elapsed time, a view toggle (picture with bubble, or camera only) and a Stop square. Stop there is the same as Stop on the page. The window closes when the recording stops.
- Closing the window by hand does **not** stop the recording. The page's step 2 band gets a quiet "Show window" action to open it again (a click gives the gesture the browser needs).
- When the whole screen is being recorded, the floating window is itself part of the picture (it is a real window on top of everything). In that case the window opens in camera-only view, and a one-line note in the window and on the page says: "Recording the whole screen puts this window in the recording. Move it to a second screen, or share a window instead." The toggle still allows the composite.
- With the webcam off, the window shows the screen (composite without a bubble), the timer and Stop; camera-only is disabled.
- Under the webcam toggle in step 1, a new **Script** toggle (off by default) reveals a plain text box. When text is present, the floating window gets a panel below the picture that scrolls the text slowly; a speed control (slower, pause, faster as pictogram squares) and the scroll wheel adjust it. The text is kept only for the session (sessionStorage), never uploaded.
- Browsers without Document Picture-in-Picture (Safari, Firefox today) fall back to classic picture-in-picture of a video: the composite with the timer and dot drawn into the frame, no Stop, no script. The Details panel says which was used.

## Recorder (`public/recorder.js`, new `public/selfview.js`, new `public/selfview.css`; keep every file under 500 lines)

- Open the window **synchronously in the Start click handler**, before the countdown awaits; `documentPictureInPicture.requestWindow({ width, height })` needs transient activation, and the countdown must not spend it. Size: 360 wide; height from the picture's aspect plus the controls, plus the script panel when on. If the request throws (user blocked it, or a window is already open), carry on recording without it and say so in Details; never fail the recording for the self-view.
- The window's document gets `selfview.css` through a `<link>` (copy the `app.css` link too for tokens, or keep the tokens the panel needs in `selfview.css`; builder's call, but the panel must render correctly on its own). Its content: a `<canvas>` painted by the same ticker that paints the preview (one extra `drawImage` of the preview canvas per tick, or the composite for camera-only drawn from `camVideo` directly), the timer, the dot, the view toggle, Stop, the optional script panel. Painting stops when the window closes.
- The page and the window share one state: the timer text, the phase, and the view choice. `selfview.js` exports `open(opts)`, `close()`, `setClock(text)`, `setPhase(phase)`, `isOpen()`; the recorder calls them. Stop in the window calls the recorder's `stopRecording` through a callback passed in `open`.
- `pagehide` on the window (the user closed it): keep recording; show "Show window" in the step 2 band. On Stop, close the window (`window.close()` on the PiP window) before `onRecordingStopped` runs.
- Fallback when `window.documentPictureInPicture` is absent: a hidden `<video>` fed by `canvas.captureStream(FPS)` of a dedicated self-view canvas (not the preview canvas; loop 1 removed `captureStream` from it and the preview stays preview only) with the clock and dot drawn into the frame, then `requestPictureInPicture()` from the Start click. Exit PiP on Stop. If classic PiP is also unavailable, nothing opens, Details says "self-view: not available in this browser".
- `displaySurface` (already read in `share()`) decides the default view and the whole-screen note.

## Script panel (teleprompter)

- Step 1: a `Script` toggle (pictogram square, a new `i-script` glyph in `icons.svg`: three horizontal lines with a short fourth) and a `<textarea>` under the step 1 tools, hidden until the toggle is on. Placeholder: "Notes to read while you record. Only you see them." Stored in `sessionStorage` under `vignette.script`.
- Window: the panel is a scrolling region at Body size in white on the black panel, about 40% of the window height, auto-scrolling at a default of one line every 2.5 s; squares for slower, pause/play and faster (speeds 0.5x, 1x, 1.5x, 2x). Wheel or drag scrolls it by hand and pauses the auto-scroll for 3 s. Under reduced motion the auto-scroll is off and the panel is scrolled by hand.
- No script text: no panel, no toggle in the window.

## Design

Concourse Signs (`DESIGN.md`): the window is a black Live band in miniature. Picture at the top with no frame, the timer in the tabular Display face at Title size, the red dot as today, the Stop square at 3rem with the stop glyph, the view toggle as two pictogram squares (frame glyph for composite, camera glyph for camera only), the script controls as 2.75rem squares. Nothing cream in the window; it floats over other apps and must read as a Vignette panel, not a web page. Add a "Self-view window" component section to `DESIGN.md` describing it. The finish review covers the window and the step 1 Script toggle.

## Tests

`test/e2e.mjs` plus a new `test/selfview-step.mjs` (builder):
- Headless Chromium may not provide Document Picture-in-Picture. The step must prove the real code path either way: install, through `addInitScript`, a stand-in `documentPictureInPicture.requestWindow` that returns `window.open('', '_blank', 'popup,width=360,height=420')` when the real API is absent, and log clearly whether the real API or the stand-in was used. Playwright sees the window as a page (`context.waitForEvent('page')`), so the test asserts: it opens from Start, shows 3-2-1 then the clock advancing past 00:02, the red dot, the view toggle default (composite when the fake display surface is not a monitor; camera-only when the test forces `displaySurface: 'monitor'` through a `getSettings` stand-in), the whole-screen note in that case, the canvas painting (two frames differ over 500 ms), Stop in the window ends the recording and the window closes, and closing the window by hand keeps the recording going and shows "Show window", which reopens it.
- Script: text typed in step 1 appears in the window, scrolls (scrollTop grows over 3 s), pauses on the pause square, is absent when the text is empty, and survives a reload within the session.
- Fallback: with `documentPictureInPicture` deleted by an init script, Start enters classic picture-in-picture (`document.pictureInPictureElement` is the hidden video) and Stop leaves it; Details says "classic picture-in-picture".
- Webcam off: the window opens with the screen only and the camera-only square disabled.
- Existing steps stay green, including `BACKGROUND=1`. Memory: the self-view adds no more than 60 MB to the peak memory note in a 20 s recording (compare with the window closed).

Independent scenario test (a different agent, repo rule 5, `test/selfview-scenario.mjs`): the request for the window is refused (stand-in throws); the window is closed during the countdown; Stop pressed in the window and on the page at the same moment; a 5,000 character script; the window reopened three times in one recording; the screen share ending while the window is open (the window must close and the recording stop as before); peak memory with the window open for 60 s.

## Docs

README: a short "While you record" paragraph (the floating window, what it shows, the whole-screen note, the script panel, the Safari fallback). Limits: Document Picture-in-Picture is Chrome and Edge. AGENTS.md file map (`selfview.js`, `selfview.css`, `selfview-step.mjs`, `selfview-scenario.mjs`). CHANGELOG under "Unreleased". DESIGN.md as above.

## Decided during the build (deviations from the text above)

Recorded here so the spec and the code agree; the CHANGELOG carries the user-facing versions.

- The whole-screen note reads "This window is in the recording. Move it to another screen, or share a window instead." (shorter, two lines at 360 wide; the finish review found the original ran to three lines) and sits under the bar in the window, not between the picture and the bar; the page's step 2 band shows the same text in its tools area while the window is open.
- The classic picture-in-picture fallback draws the dot and the clock on a black strip under the picture (about 11% of the width), never over it, so the bubble is not covered; and it too opens on the camera alone when the whole screen is shared with the webcam on, since it has no toggle and would otherwise film itself.
- Stop in the window is disabled during the countdown, matching the page's Stop.
- Reopening the window keeps the script's place, speed and paused state within one recording; a new recording starts it from the top at 1x.
- The lit view plate is set by the code (a `data-on` attribute written by `show()`), not by the radio's `:checked` paint, which the real window did not repaint reliably; the radios stay for semantics and keyboard.
- The Script toggle is the third toggle in step 1's tools row, and its text box is a grid area under the tools that spans to the action's right edge on desktop and sits between the tools and Share screen at 720px and below. The script module is `public/prompter.js`, separate from `selfview.js`.
- Show window also appears during the countdown and after the browser refused the window, so a fresh click can retry. Under reduced motion the script starts paused and the window's flap does not flip.
- Headless Chromium has the real Document Picture-in-Picture, so the tests run the real window; the `window.open` stand-in is installed only where the API is missing (`SELFVIEW_STANDIN=1` forces it).

## Done when

- `npm test` and `BACKGROUND=1 npm test` print E2E OK with the new steps; the independent scenario test passes; the finish review of the window and the Script toggle says ship. No Worker change, so no security review unless the diff touches `worker/`.
- David starts a recording, works in another app with the window in a corner, reads a script from it, presses Stop there, and the recording and the window end together.
