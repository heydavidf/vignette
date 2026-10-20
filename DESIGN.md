---
name: Vignette
# Palette revised 2026-10-19: enamel cream replaces the original Schiphol yellow band; vermilion #CF2E12 is the live-state colour (Stop square, recording dot, focus and selection on black). Band grammar unchanged.
description: A concourse of sign bands. Read one band, act, the next band appears, your link is the gate.
colors:
  cream: "#F1E8D0"
  vermilion: "#CF2E12"
  black: "#0B0B0B"
  frame: "#1A1A1A"
  grey: "#E6E6E6"
  white: "#FFFFFF"
  umber: "#5A4A1E"
  ash: "#B3B3B3"
  smoke: "#8C8C8C"
  slate: "#4A4A4A"
  rule-dark: "#333333"
typography:
  clock:
    fontFamily: "Fira Sans, Fira Sans Fallback, sans-serif"
    fontSize: "6rem"
    fontWeight: 700
    lineHeight: 0.8
    letterSpacing: "-0.02em"
    fontFeature: "tabular-nums"
  display:
    fontFamily: "Fira Sans, Fira Sans Fallback, sans-serif"
    fontSize: "2.986rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.012em"
  headline:
    fontFamily: "Fira Sans, Fira Sans Fallback, sans-serif"
    fontSize: "2.074rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.012em"
  title:
    fontFamily: "Fira Sans, Fira Sans Fallback, sans-serif"
    fontSize: "1.44rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  control:
    fontFamily: "Fira Sans, Fira Sans Fallback, sans-serif"
    fontSize: "1.2rem"
    fontWeight: 500
    lineHeight: 1.15
  body:
    fontFamily: "Fira Sans, Fira Sans Fallback, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  note:
    fontFamily: "Fira Sans, Fira Sans Fallback, sans-serif"
    fontSize: "1.2rem"
    fontWeight: 400
    lineHeight: 1.35
  small:
    fontFamily: "Fira Sans, Fira Sans Fallback, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.65
    fontFeature: "tabular-nums"
rounded:
  none: "0px"
  bubble: "50%"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  band-pad-narrow: "20px"
  band-pad: "24px"
  band-pad-current: "28px"
  gutter-narrow: "16px"
  gutter: "32px"
  col: "32px"
  sq: "3rem"
  sq-lg: "3.5rem"
  sq-sm: "2.75rem"
  line: "2px"
  wrap: "1600px"
components:
  band-current:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.black}"
    typography: "{typography.display}"
    padding: "28px 0"
  band-live:
    backgroundColor: "{colors.black}"
    textColor: "{colors.white}"
    typography: "{typography.display}"
    padding: "28px 0"
  band-closed:
    backgroundColor: "{colors.black}"
    textColor: "{colors.smoke}"
    typography: "{typography.title}"
    padding: "14px 0"
  band-done:
    backgroundColor: "{colors.black}"
    textColor: "{colors.white}"
    typography: "{typography.title}"
    padding: "10px 0"
  action-primary-on-cream:
    backgroundColor: "transparent"
    textColor: "{colors.black}"
    typography: "{typography.control}"
    rounded: "{rounded.none}"
    height: "{spacing.sq-lg}"
    padding: "10px 20px"
  action-primary-on-cream-hover:
    backgroundColor: "{colors.black}"
    textColor: "{colors.cream}"
  action-primary-on-black:
    backgroundColor: "transparent"
    textColor: "{colors.white}"
    typography: "{typography.control}"
    rounded: "{rounded.none}"
    height: "{spacing.sq-lg}"
    padding: "10px 20px"
  action-primary-on-black-hover:
    backgroundColor: "{colors.white}"
    textColor: "{colors.black}"
  action-quiet:
    backgroundColor: "transparent"
    typography: "{typography.control}"
    rounded: "{rounded.none}"
    height: "{spacing.sq}"
    padding: "6px 14px"
  square-on-cream:
    backgroundColor: "{colors.black}"
    textColor: "{colors.white}"
    size: "{spacing.sq}"
    rounded: "{rounded.none}"
  square-on-black:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.black}"
    size: "{spacing.sq}"
    rounded: "{rounded.none}"
  toggle-plate-lit:
    backgroundColor: "{colors.black}"
    textColor: "{colors.white}"
    size: "{spacing.sq}"
    rounded: "{rounded.none}"
  toggle-plate-unlit:
    backgroundColor: "{colors.black}"
    textColor: "{colors.smoke}"
    size: "{spacing.sq}"
    rounded: "{rounded.none}"
  input-text:
    backgroundColor: "{colors.grey}"
    textColor: "{colors.black}"
    typography: "{typography.control}"
    rounded: "{rounded.none}"
    height: "{spacing.sq-lg}"
    padding: "8px 14px"
  well:
    backgroundColor: "{colors.grey}"
    textColor: "{colors.black}"
    padding: "24px 0"
  error-panel:
    backgroundColor: "{colors.black}"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "14px 16px"
  share-link-box:
    backgroundColor: "{colors.black}"
    textColor: "{colors.white}"
    typography: "{typography.title}"
    rounded: "{rounded.none}"
    padding: "14px 16px"
  register-square:
    backgroundColor: "transparent"
    textColor: "{colors.white}"
    size: "{spacing.sq-sm}"
    rounded: "{rounded.none}"
  register-square-hover:
    backgroundColor: "{colors.white}"
    textColor: "{colors.black}"
---

# Design System: Vignette

## Overview

**Creative North Star: "Concourse Signs"**

Vignette is built like an international airport sign system. The page is a stack of full-width bands, one per step. The band you need now is cream; the steps not reached yet are narrow black panels; the steps you have finished stay as compact black bands with a check. Every control is a black inset square carrying a white pictogram, and primary actions lock that square to the end of a framed label, the way an arrow sits at the end of a gate sign. Numbers (the clock, the runtime, trim readouts, the register) are bold and tabular, set at monumental size where they are the proof that something is happening.

The world is flat and lit the same at every hour: there is no light variant, no shadow, no gradient, no radius anywhere except the webcam circle. Depth comes from paint, not from lift. Three surfaces (sign black, enamel cream, surface grey) each declare the colours their own controls draw with, so a square, a focus ring or a selection highlight is always the surface's opposite. Text is sentence case throughout; nothing is set in small caps or tracked uppercase. The memorable moment is a gate change: when recording starts, the current band repaints from cream to black and the counter runs in white.

Confirmed rejections: the SaaS workspace of rounded cards, a sidebar and a blue button; decoration between the user and the Record button; a cold or clinical register. Em-dashes do not appear in copy.

**Key Characteristics:**
- Full-width sign bands as the only layout unit; one cream band at a time
- Black inset squares with white pictograms as the control vocabulary, arrows locked to the band edge
- One humanist sans (Fira Sans) in three weights, sentence case, 1.2 ratio scale
- Bold tabular numerals at monumental size for clocks and runtimes
- Flat, single scheme, zero radius, 2px rules; the only circle is the webcam bubble
- Surface-scoped colour: each surface sets its own control, focus and selection colours

## Colors

Three flat paints (black, cream, grey) carry the whole system; the rest of the palette is text and rule tones tuned to sit legibly on one of them.

### Primary
- **Wayfinding Cream** (`cream`): the current step's band, the share page title band, the password gate. It is the one thing on a page that says "here". On black surfaces it also paints the inset square, the focus ring and the text selection, so it reads as the active path even away from the band.

### Neutral
- **Sign Black** (`black`): the page, the header strip, closed and done bands, the live recording band, every inset square on cream and grey, text on cream and grey. The page is black before anything else.
- **Panel Frame** (`frame`): the header's bottom rule, empty media plates (thumbnail, preview, register image), toggle plates on black, and the pressed state of actions. Where a rule has to sit on black it is too dark to be seen; use Rule Dark instead.
- **Surface Grey** (`grey`): the preview well, the share page video well, text inputs, the player plate, and the scrollbar thumb on black.
- **Sign White** (`white`): pictograms on black squares, text on black, the hover fill of actions on black, the inset rule of error panels.
- **Umber** (`umber`): secondary text on cream, 6.6:1.
- **Ash** (`ash`): secondary text on black, 9.4:1. Notes, dates, details body, the share page footer.
- **Smoke** (`smoke`): closed band titles, unlit toggle glyphs, register column headings, pictogram placeholders on frame plates, the Details summary at rest. 5.9:1 on black.
- **Slate** (`slate`): secondary text on grey, 7.1:1. Placeholders, the empty-well prompt, the share page facts.
- **Rule Dark** (`rule-dark`): rules between bands, table rows, the stage and board tops, and any rule that has to show on black.

### Named Rules
**The One Cream Band Rule.** Exactly one band is cream on a recorder page: the step being taken. Finished and unreached steps are black. The share page's title band and the password gate count as that page's one current step. Never use cream as decoration, a badge, a hover fill on a cream surface, or on more than one band.

**The Surface Sets The Square Rule.** Every surface declares `--sq-bg`, `--sq-fg`, `--line`, `--focus` and `--sel-bg`. On black the square is cream with a black glyph; on cream and grey it is black with a white glyph. Never hard-code a control colour; inherit it from the surface the control sits on.

**The Paired Tone Rule.** Secondary text has one tone per surface: Umber on cream, Ash on black, Slate on grey. Smoke is reserved for things that are not yet active (closed titles, unlit glyphs, column headings). Do not use the wrong pair to get a lighter grey.

## Typography

**Display Font:** Fira Sans 700 (with Fira Sans Fallback, a metric-matched local Arial / Liberation Sans)
**Body Font:** Fira Sans 400 and 500 (same fallback)
**Label/Mono Font:** none; tabular numerals in Fira Sans do the work of a mono face

**Character:** One humanist sans in three weights, always sentence case, built on a 1.2 ratio from 1rem. Headings are tight (1.1 leading, slight negative tracking); numerals are bold, tabular and allowed to go monumental. Nothing is uppercase, tracked out, or set in a second face.

The four vendored files are Fira Sans 400, 400 italic, 500 and 700 (OFL, `public/vendor/fonts/`), loaded with `font-display: swap`; 700 and 500 are preloaded. The fallback face was measured in Chromium at 1000px: Fira Sans ascent 0.935em, descent 0.265em, no line gap. Regular/medium fallback: `size-adjust: 101.52%; ascent-override: 92.1%; descent-override: 26.1%; line-gap-override: 0%`. Bold fallback: `size-adjust: 94.67%; ascent-override: 98.76%; descent-override: 27.99%; line-gap-override: 0%`. Keep these numbers with the font files; they are what makes the swap invisible.

### Hierarchy
- **Clock** (700, 6rem, 0.8, -0.02em, tabular): the recorder counter at the right of the preview well. Drops to 4.3rem under 720px. The runtime on the share page uses the display step with the same leading (0.85) and tracking.
- **Display** (700, 2.986rem, 1.1, -0.012em): the title of the current or live band ("1 Set up"). The number and the word sit on one baseline with a 0.35em gap.
- **Headline** (700, 2.074rem, 1.1, -0.012em): the share page title, the library empty-state title, the gate title on phones. The gate title on desktop is one step up (2.488rem); the share title on phones one step down (1.728rem).
- **Title** (700, 1.44rem, 1.1): the brand mark in the header (tracked -0.01em), closed and done band titles, the Details summary, and the share link box (at weight 500, 1.3 leading).
- **Control** (500, 1.2rem, 1.15): every action label, toggle label, header link, text input, register cell and band note. The step down to 1rem is for done-band tools, field labels and register headings.
- **Body** (400, 1rem, 1.5): the page default.
- **Note** (400, 1.2rem, 1.35): the one-line note under a band title, the empty-well prompt (1.4), the library empty-state text (1.45).
- **Small** (400, 0.875rem, 1.65, tabular): the Details readout, thumbnail hint, register dates on phones.

### Named Rules
**The Tabular Numeral Rule.** Any element that shows a number that can change (time, output, `.num`, `.tnum`, band numbers, the clock, runtimes, file sizes, dates, the share URL) sets `font-variant-numeric: tabular-nums`. Numerals that are the proof of state (clock, runtime, clip length, register runtime) are also bold (700).

**The Sentence Case Rule.** Every label, title, heading and button is sentence case in Fira Sans. No uppercase, no letterspaced labels, no kickers or eyebrows above a title. A band title is a number and a verb phrase, nothing more.

**The Two-Weight Control Rule.** Controls are 500; headings and numerals-as-proof are 700; running text is 400. There is no 600 and no 300.

## Layout

The page is a vertical stack of full-width bands separated by 2px rules in Rule Dark. Inside every band a `.wrap` holds content to a 1600px maximum with a 16px gutter, rising to 32px at 720px and above. Band vertical padding is 20px (24px at 720px and above); the current and live bands use 28px, closed bands 14px, done bands 10px.

A band's grid has three columns: title and note at the left, tools in the middle (right-aligned, wrapping, 16px by 28px gaps), the action at the right edge. Column gap is 32px, row gap 6px. The done band tightens to a four-column single row (title, note, tools, action). Step 3 collapses to a single column holding the editor, which is a two-column grid: the player and trim bar at left, a 300px to 400px side column for title, thumbnail and upload, with 24px by 40px gaps.

The preview well sits between step 1 and step 2 on surface grey, 24px of block padding, a 2px Rule Dark top. The well is a flex row: the monitor fills the column (16:9 or the shared picture's shape, at most 60vh) and the clock sits at the bottom right. The share page uses the same stack: header strip, cream title band (28px padding), grey well (24px top, 32px bottom), footer. The library is a departures-board register: fixed-layout table, 192px thumbnail column, 14px by 16px cell padding, 1px Rule Dark row rules, 8px top and 72px bottom board padding.

Spacing rhythm is 8 / 10 / 12 / 14 / 16 / 20 / 24 / 28 / 32 px; stacks inside a column use 8, 10, 14, 16 or 24px gaps. There is no spacing above 40px except band and board padding.

Responsive rules, in order:
- Below 1100px: the band grid drops the tools row under the title and note (two columns, then a full-width tools row). The editor goes single column. Done bands keep title, note and action in one row with tools beneath.
- Between 901px and 1180px: the register's status column is hidden; thumbnails shrink to 152px / 120px.
- At 900px and below: each register row recomposes into a small sign (112px thumbnail at the left, title, run / size / status, date, then the actions), the table header goes, and the square buttons show their word next to the pictogram.
- At 720px and below: bands go single column and the action stretches full width; the current band pads 24px top and 20px bottom; the well pads 16px and the clock moves into a row with the recording mark, counter at 4.3rem; the empty-well prompt sits at the top; the share page video bleeds to the gutters with no outline and the share actions become a grid of equal columns. The gate row stacks.

### Named Rules
**The Band Is The Unit Rule.** New content is a new band or a row inside one. Do not introduce a card, a column of cards, a sidebar or a modal; the share page and the library are built from the same bands and wells.

**The Action At The Edge Rule.** The band's primary action sits at the right edge of the wrap on desktop and stretches to the full width of the band on phones. Tools sit between the title and the action, never above the title.

## Elevation & Depth

Flat. There are no drop shadows, gradients or blur anywhere at rest. Depth is paint: three surfaces (black, cream, grey) butt against each other with 2px rules, and inset elements (the well, the frame, toggle plates, quiet squares, the error panel) are drawn with inset box-shadows of 2px in the surface's line colour, which is a border that never changes the box size. The webcam bubble is a black ring (3% of its diameter) around a grey or live disc. Hover on the bubble adds a two-colour ring (3px of the surface colour, then 2px of the foreground) that reads as a selection, not a lift.

### Shadow Vocabulary
- **Inset rule** (`box-shadow: inset 0 0 0 2px var(--line)`): the line around a quiet square, a toggle plate, the preview well, the error panel. Use instead of a border when the box must not grow.
- **Selection ring** (`box-shadow: 0 0 0 3px var(--surface), 0 0 0 5px var(--fg)`): the bubble on hover and while dragging. The trim handles use the same ring at 3px / 6px with the focus colour on focus.

### Named Rules
**The Flat Concourse Rule.** No element casts a shadow at rest, and no hover or pressed state lifts anything. A pressed action darkens (Panel Frame), a hovered action inverts (line colour fill, surface colour text). Transitions are 150ms for controls and 200ms for band repaints, on `cubic-bezier(.16, 1, .3, 1)`.

## Shapes

Square. Every box has 0 radius: bands, squares, inputs, plates, the trim handles, the progress bar, the share link box, the register images. Rules are 2px (bands, frames, inset rules, underlines) and 1px only for table rows. The pictogram square is the recurring silhouette: 3rem (48px) for toggles and quiet actions, 3.5rem (56px) for primary actions, 2.75rem (44px) in done bands and in the register. Pictograms are drawn on a 24px grid with 2.75 strokes, square caps and miter joins, filled with `currentColor`, and sit at 56% of the square (50% in the size strip). Unlit toggles strike their glyph with a 2.75 stroke over a 7-wide knockout in the plate colour.

The one circle is the webcam bubble: a 1:1 disc, 50% radius, with a 3% black ring. Its diameter in the frame is twice its radius share of the shorter edge: small 0.10, medium 0.14, large 0.20 (so 20%, 28% and 40% of the shorter edge), kept 2.5% of the shorter edge from the picture's border. Links underline with a 2px line offset 0.22em in the secondary tone, going to the foreground on hover.

## Components

### Sign Bands
The structural unit. A band is a full-width section with a 2px Rule Dark top and a `.wrap` grid inside. Its `data-state` drives colour, size and what shows:
- **Current** (cream surface, black text, Umber note; title at Display size; 28px padding): the step to take now. Controls on it are black squares with white glyphs; focus ring and selection are black.
- **Live** (black surface, white text, Ash note; title at Display size; 28px padding; the top rule turns black so the band and the well above fuse): recording in progress. The step 1 band above hides its tools and action and reads as done. The band repaints with a 200ms background and colour transition.
- **Closed** (black surface, Smoke title at Title size, 14px padding, no note or tools): a step not reached yet. It is a label, not a control.
- **Done** (black surface, white title at Title size preceded by a check glyph at 0.9em, note at Body size, 10px padding, tools at 2.75rem squares): a finished step that stays usable (share again, toggles). Open-state copy swaps to done-state copy via `.if-open` / `.if-done` / `.if-live`.
- **Band note**: one line under the title at Note size in the surface's secondary tone.
- **Band alert**: a message row under the grid, 12px above; errors become the black panel described under Messages.

### Pictogram Square
The control atom. A 3rem square (3.5rem in primary actions) painted in the surface's square colour with a glyph at 56%. Every action, toggle, segment and register button is built on it. The glyph is a `<use>` of `public/icons.svg` (25 symbols: arrows, record, stop, play, camera, mic, check, warning, copy, download, trash, library, scissors, frame, mark start and end, cut from and to, size s / m / l). Cut from and to pair the mark brackets with a struck rule.

### Buttons
- **Shape:** square corners (0), 2px line in the surface line colour, label 500 at 1.2rem with 1.15 leading.
- **Primary action (`.act`):** transparent fill, 2px outline, min height 3.5rem; the label pads 10px by 20px; the inset square (3.5rem) is locked to one end with a negative 2px margin so it fills the frame. The square goes on the end an arrow points to (right for "Share screen", "Continue"), on the left for record / stop / copy / download.
- **Hover:** fills with the line colour and inverts the text (black on cream surface becomes black fill with cream text; on black, white fill with black text). **Active:** Panel Frame fill, white text. **Disabled:** line at 30%, text at 45%, square at 30%, `not-allowed` cursor. **Busy:** the glyph hides and a 40% wide, 4px bar travels across the square every 900ms (static at 30% under reduced motion).
- **Quiet action (`.act--quiet`):** no outer frame, min height 3rem; a 3rem square drawn as a transparent plate with a 2px inset rule and a glyph in the foreground colour; label pads 6px by 14px. Hover fills the square with the line colour and underlines the label 2px. Used for "Set start here", "Use current frame", "Copy", "Use the same settings".
- **Register square (`.sqbtn`, library):** 2.75rem, transparent plate with a 2px Smoke inset rule, 1.375rem glyph, word visually hidden on desktop and shown beside the plate at 900px and below. Hover fills white with black glyph; active fills grey.
- **Word buttons (`.word`, library confirm):** 2.75rem tall, 14px side padding, 2px white inset rule, 500 at 1rem; `.word--solid` is white on black for the destructive confirm.

### Toggles
A black plate (`.tg`, Panel Frame on black surfaces, black on cream and grey) with the checkbox stretched invisibly over it and a white glyph. Unchecked: the glyph goes Smoke and a diagonal strike with a plate-coloured knockout appears. Label 500 at 1.2rem to the right with a 12px gap; hover underlines the label 2px; pressing scales the glyph to 0.86. Disabled: 45% text, 50% plate.

### Bubble Size Strip
Three 3rem segments in a row sharing one 2px inset rule (each after the first overlaps by 2px). Each holds a size glyph at 50%. The chosen segment fills with the foreground and shows its glyph in the surface's square glyph colour (black on cream). Hover on an unchosen segment thickens the inset rule to 4px.

### Inputs / Fields
- **Style:** surface grey fill, 2px black rule, 0 radius, min height 3.5rem, 8px by 14px padding, 500 at 1.2rem, black caret. Placeholder in Slate. Selection inside is cream on black.
- **Hover:** a further 1px inset black rule. **Focus:** 3px outline in the surface focus colour, 2px off.
- **Field label:** 500 at 1rem, 8px above the input.
- **Password gate:** a cream band with a 44rem single column; the input and the Continue action butt together (the action's left edge overlaps the rule by 2px) and stack with a 10px gap on phones.
- **Share link box:** a black panel with white text at 500, 1.44rem, 1.3 leading, tabular, cream caret, cream on black selection, grows to its content.

### Messages
Plain notes in the surface's secondary tone with a 12px gap, glyph hidden. With `data-tone="error"`: a black panel, white text, 14px by 16px padding, a white warning pictogram at the left, and a 2px white inset rule on black surfaces (none on cream or grey). Links inside use Ash underlines.

### Preview Well and Frame
A grey section (`.on-grey`) with a 24px block padding. The monitor is a 16:9 box up to 60vh with a 2px Panel Frame inset rule; spare width to each side of the picture is grey; the frame inside carries 2px Panel Frame side rules while empty and the Slate prompt at 1.2rem centred. When the source is live the monitor turns black with no rule and the canvas shows. The clock sits at the bottom right: a recording mark (record glyph at 1.1rem plus "Recording", 500 at 1.2rem) over the 6rem counter.

### Webcam Bubble
A draggable, focusable circle positioned by `--bx` / `--by` (centre as a share of the frame) and sized by `--bd` (diameter as a share of frame width). Black disc with a grey inner disc inset 3%; a camera glyph at 32% in black, going Slate and struck when the camera is off. Live: the video fills the disc. Hover and drag show the selection ring; dragging adds `cursor: grabbing`. Keyboard: arrows nudge 2% of the frame, Shift five times as far. Focus ring 4px off.

### Countdown Flap
One split-flap digit over the frame on a 60% black scrim. The flap is a black square 1.3em on a side at `min(36cqh, 20cqw)`, 700, white, with a 4px horizontal gap through the middle; the top half flips out over 200ms with a dimming filter and the bottom half flips in on the standard ease.

### Trim Bar
A 48px tall strip: a 14px track in black at 22% with the kept range in solid black. Two 18px wide, 48px tall black handles with a 2px by 22px white tick; hover goes Panel Frame, focus adds the selection ring in the focus colour. Readouts below are 500 at 1.2rem, outputs bold, tabular. A cut is the track knocked out to the surface colour and struck through by a 2px foreground rule between 2px end ticks (a struck rule means removed); a 2px by 30px foreground tick marks where a cut being marked starts. The cut list below is one row per cut: name 500, times 700 tabular, length in the secondary tone, and a quiet Remove square at the row's end.

### Register (Library)
A fixed-layout table on black: 500 Smoke headings at 1rem with a 2px Rule Dark bottom, cells at 1.2rem with 1px Rule Dark rows, hover rows in Panel Frame. Thumbnails are 160px 16:9 Panel Frame plates (120px, then 112px as the viewport narrows). Titles are 500 and ellipsise; runtime is 700 tabular; size and date tabular, date in Ash. Loading shows three ghost rows drawn in Panel Frame, not a spinner. The empty state is a 40rem column: Headline title, 1.2rem Ash text, then a primary action.

### Navigation
A black header strip, 3.5rem minimum height, 2px Panel Frame bottom rule. The brand at the left is "Vignette" in 700 at 1.44rem, tracked -0.01em, no underline. The one link at the right ("Library") is a glyph plus a word at 500, 1.2rem, 44px tall, underlining in cream on hover. The share page shows the brand alone. No menu, no tabs.

### Details
A black disclosure under the recorder: the summary is 700 at 1.44rem in Smoke on a 3.5rem row with a down arrow that rotates 180 degrees when open; hover goes white. The body is Ash at Small size with a 1.65 leading and tabular numerals, 32px bottom padding.

## Do's and Don'ts

### Do:
- **Do** build every new surface from bands and wells on the three paints: black page, one cream current band, grey wells for media and inputs.
- **Do** make every control a pictogram square (3rem toggles and quiet actions, 3.5rem primary actions, 2.75rem in done bands and the register) with a glyph from `icons.svg` at 2.75 stroke, square caps, miter joins.
- **Do** lock the primary action's square to the end the arrow points to, with a negative 2px margin so it fills the frame.
- **Do** set `tabular-nums` on every changing number and set numerals that prove state (clock, runtime, clip length) in 700.
- **Do** keep the type ramp on its fixed 1.2 steps (0.875, 1, 1.2, 1.44, 1.728, 2.074, 2.488, 2.986rem) plus the 6rem clock; drop one step on phones rather than inventing a size.
- **Do** inherit control colours from the surface (`--sq-bg`, `--line`, `--focus`, `--sel-bg`) and declare a new surface by setting those variables, never by styling the control.
- **Do** use 2px rules (1px only inside tables), inset box-shadows for lines that must not change the box, and `cubic-bezier(.16, 1, .3, 1)` at 150ms for controls and 200ms for band repaints.
- **Do** keep the fallback `@font-face` metrics with the font files and preload the 700 and 500 weights.
- **Do** show state with a check glyph, a strike, a fill or a repaint; show loading as a travelling bar in the square or ghost rows in the register's shape.

### Don't:
- **Don't** paint more than one band cream on a page, or use cream as a badge, a hover fill on cream, or a decorative accent.
- **Don't** round a corner on anything but the webcam bubble; no radius, no pill, no rounded card.
- **Don't** cast a shadow, add a gradient or lift anything on hover; invert or darken instead.
- **Don't** add a light scheme or `prefers-color-scheme` branch; the concourse is lit the same at every hour.
- **Don't** set text in uppercase, letterspaced labels, kickers or eyebrows; titles are a number and a sentence-case phrase.
- **Don't** introduce a second typeface, a mono face, weight 300 or 600, or a system display face; Fira Sans 400 / 500 / 700 is the whole kit.
- **Don't** use a sidebar, a card grid, a modal, a tab bar or a blue button; new content is a band or a row in one.
- **Don't** load fonts, icons, scripts or styles from outside the Worker's own static files; every page runs under `default-src 'none'` with self-hosted assets and a per-request nonce for inline script.
- **Don't** use a spinner; loading is the travelling bar or ghost rows.
- **Don't** put an em-dash in any copy.
