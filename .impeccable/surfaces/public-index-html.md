---
version: 1
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: ["public/library.html","worker/index.js"]
---

# Surface brief: recorder (public/index.html), library (public/library.html), share page (worker/index.js template)

Scope: the whole visual world of Vignette's three surfaces. Visitor mode: Operate (recorder, library); the share page is Operate for the viewer (watch, seek, copy link) and inherits the world.

Audience and job: one person at a desk, mid-task, recording a two-minute walkthrough and sending the link. Action: Share screen, Start recording, Stop, Upload and get link. Proof: the preview and the live counter. Constraints: no framework, no bundler, no runtime CDN; fonts vendored; files under ~500 lines; Chrome first; tests in test/e2e.mjs must stay green; keep the three-step flow; webcam bubble must be draggable.

Chosen direction: Concourse Signs, chosen by David on 2026-10-19 over the assigned Festival Programme. Memorable moment: when recording starts, the step band repaints from cream to black like a gate change and the counter runs at monumental size.

Unresolved: light variant (a concourse is lit the same at all hours, so none planned); owner branding on share pages (open).

## Direction contract

THESIS: A concourse of sign bands. Each band shows only the next decision; the next band appears when the step is done. Refuses the SaaS workspace of rounded cards, sidebar and blue button.

OWN-WORLD: enamel cream #F1E8D0 bands (revised 2026-10-19 from Schiphol yellow, David's choice C of four palettes; vermilion #CF2E12 for the live state) owning full width; sign black #0B0B0B inset squares carrying white pictograms and arrows locked to the band edge; surface grey #E6E6E6 as the preview well; panel frame #1A1A1A rules; one humanist sans (Fira Sans, vendored OFL) in sentence case, numerals bold and tabular at monumental scale. Recording state: the band repaints black, counter white.

STORY: Arrive, read one band, act, next band, your link is the gate.

FIRST VIEWPORT: Black header strip, Vignette left, Library pictogram right. Full-width cream band "1 Set up" with Share screen as black arrow-square plus label, webcam and mic as black pictogram toggles. Preview well below in surface grey with 00:00 monumental at right. Bands 2 and 3 closed as narrow dark panels beneath.

FORM: Concourse Signs, challenger (competitive), user-chosen over assigned candidate 6; seed key be01608d.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
