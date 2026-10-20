# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: the maintainer, a product leader working solo at a desk, mid-task, who needs to send a quick asynchronous walkthrough (a screen with his face in a corner) to a client, collaborator or candidate, then get back to work. Secondary, confirmed: solo makers like him who self-host one copy of Vignette for themselves. Viewers of share links are anyone who receives one; they need no account and may be on a phone.

## Product Purpose

Vignette is an open-source screen recorder that runs entirely in the browser. Open a web page, record your screen with an optional webcam bubble and microphone, trim the start and end, give it a title, upload, and get a share link. It exists so a person can own their recordings on their own free Cloudflare account instead of renting a SaaS tool. Success is: a recording made and shared in under two minutes with no install, and a stranger self-hosting it in about ten minutes.

## Positioning

Nothing to install and nothing to sign up for. Cap (23k stars) is a desktop app with a full backend; Screenity (19k stars) is a Chrome extension. Vignette is a web page plus one Worker, small enough to read in an afternoon, and it self-hosts on one account with no storage keys.

## Operating Context

Used in Chrome or Edge on a laptop, usually with other windows open, often with the recorder tab in the background while the user demonstrates something elsewhere. Browser permission prompts appear every session. Recordings are 30 seconds to 10 minutes. The share page is opened from a chat message or email, frequently on a phone. The owner's library is visited rarely, to copy a link or delete something.

## Capabilities and Constraints

- Record screen, window or tab; optional webcam bubble composited on a canvas capped at 1080p; optional microphone mixed with tab audio. With the webcam off, the screen is recorded directly.
- Three-step flow on one page, revealed in order: set up, record (with a 3-2-1 countdown), edit and upload (trim start and end, cut out the middle, title, thumbnail frame).
- Upload in 20 MB parts to Cloudflare R2 via one Worker; share page at `/v/<id>`; owner library at `/library`; single owner password.
- No framework, no bundler, no build step, no external fonts or CDN requests at runtime. Plain ES modules. Every file under about 500 lines.
- Chrome and Edge first; Safari and Firefox must load without crashing.
- Links are unlisted, not private.
- Decided 2026-10-19: keep the three-step flow; otherwise nothing is sacred. Dark-or-light is open.
- Undecided: whether share pages ever carry the owner's branding.

## Brand Commitments

Name: Vignette (a short, self-contained scene). Chosen to sit alongside David's other tools, Folio and Dovecote: quiet, old, tangible nouns. Voice: plain, short, honest about limits (the README has a "Limits and honesty" section). No em-dashes anywhere. Must not read as a generic SaaS dashboard, must not be cold or clinical, and must not put decoration between the user and the Record button.

## Evidence on Hand

- A working product with end-to-end tests (`npm test`).
- Competitor facts (Cap, Screenity) in the Positioning section above, checked against their repositories on 2026-10-19.
- No logo, no screenshots, no testimonials, no user counts. Do not fabricate any.

## Product Principles

1. The Record button is the product; everything else steps aside.
2. Small enough to read, honest enough to trust.
3. Own your recordings: one account, no keys, no lock-in.
4. Chrome-first, phone-friendly to watch.
5. Character through precise details, not decoration.
