# Reading app — design guide

Governs `apps/voyager` alone. `docs/DESIGN.md` governs `apps/orbit` and does not apply here.
Approved by the user 2026-09-07 from the canvas in `private/design-lectura/`.

## The direction: Impreso

- Dark is the primary look. Light is the same design inverted, not a second design.
- Set the ground in warm near-black, never neutral grey. It reads as ink on paper; a neutral grey
  reads as a generic dark app.
- Lead with the English headword. The entry fits at once.
- Rule between senses with a hairline. Never a card, never a border box.

## Tokens

Dark, the primary:

| role | value |
|---|---|
| ground | `#14130F` |
| raised (the box, a chip) | `#1C1B16` |
| line | `#2A2820` |
| border | `#302E25` |
| ink | `#F0EBDD` |
| ink, secondary | `#E6E0D0` |
| muted | `#9A9484` |
| muted, quietest | `#6C6759` |
| accent | `#D9805F` |

Light, the same design inverted:

| role | value |
|---|---|
| ground | `#FAF8F2` |
| raised | `#FFFFFF` |
| line | `#E4DFD2` |
| border | `#DED8C8` |
| ink | `#17160F` |
| muted | `#6B675A` |
| muted, quietest | `#A5A093` |
| accent | `#9A3B24` |

- The accent is a different hex per mode, not one colour at two opacities. `#9A3B24` has too little
  contrast on the dark ground; `#D9805F` has too little on the light one.

## Type

- Headwords, translations and definitions: **Newsreader**, fallback `Georgia, serif`.
- Labels, metadata, controls and interface copy: **IBM Plex Sans**, fallback `system-ui, sans-serif`.
- Set a part-of-speech label at 11 px, 600, `letter-spacing: 0.12em`, uppercase, in the accent.
- Set a headword at 34 px / 500 / `-0.02em`. Set a translation line at 21 px / 1.5.

## Metadata labels

- Set a metadata label — where a translation came from, what kind of answer this is — in the same
  shape as a part-of-speech label (11 px, 600, `letter-spacing: 0.12em`, uppercase) but in **muted**,
  never in the accent. The accent names a part of speech; a second accented label competes with it.
- **Never a coloured badge.** A green chip for the device and a blue one for the network import two
  hues this design does not have and read as a status pill from another app. The origin is metadata:
  it sits under the translation as a quiet line, and the reader who does not care never notices it.

## What the data forces

Measured over the built asset, 64,258 entries. Design for these, not for the rare case.

- Senses per headword: median **1**, p90 1, p99 2, max 6.
- Translations per entry: median **1**, p90 4, max 25.
- With a definition: **80.3%**. With IPA: **56.6%** — the null IPA is the common case, not the edge.
- A typical answer is four lines. Design the one-sense answer first; let six senses degrade.
- Headwords reach **85 characters with no space to break on**. Every list of headwords truncates.
  `Button` pins `flex-shrink: 0`, so a `Text truncate` inside a flex row does nothing — clamp with
  `Grid`, whose `minmax(0, 1fr)` governs the item regardless.

## Viewport

- Build the narrow viewport first. RNL-03 is the requirement.
- Hold a 32 px floor on every tap target's shorter side. `TapTarget` owns it for a link.
- Centre the reading column above ~660 px and cap its measure at **620 px**. The phone is the case
  the app is designed for; the desktop is the case it must not look neglected in.
- **A bottom bar carries the sections, at every width.** Buscar, Registro, Cuenta — three, and it
  never holds an action, a filter or a count. Decided by the user 2026-09-08, over a sidebar.
- **The 620 px cap is a reading measure, not a page width.** It governs the screens that are prose —
  Palabra, Frase, Flexión, Sin resultado, Inicio, Instalando, Fallo, Sugerencias, Fuente. Registro,
  Cuenta and Dispositivos are a list and a set of controls: they take the width they need. Applying
  the reading measure to them wasted half the desktop and made the list harder to read, which is
  what this line exists to prevent.
- **Fuente is not a section.** RL-15 asks for the source, the edition and the licence **one tap from
  the box** — nothing more. It rides as a quiet muted link on the screens that carry the box, never
  as a fourth item in the bar: a credits page read once does not deserve the weight of Buscar.
- **What was here before, and why it was wrong.** This line used to read «Never a sidebar. A tab bar
  carries the sections… Inside Lectura the screen is still one box and one answer.» It arrived
  2026-09-07 in the commit that renamed the two apps — a rename, not a design decision. It forbade a
  sidebar, prescribed a tab bar **nobody ever built**, and named a section «Lectura» that exists in
  neither app. It was written as the negation of orbit's `docs/DESIGN.md:32`, which is the same
  cross-app borrowing `AGENTS.md` forbids, in reverse.

## Failure

- No error colour exists in this palette, and none should be added: a red pulled in from outside
  reads as a different app's alarm, not this one's ink.
- Mark a failure with what the design already has: a hairline above it to set it off from whatever
  state came before, the failure line in full-weight **ink** (never muted, never the accent — a
  failure is not metadata), and the retry action in the ordinary accent-coloured button. The accent
  the reader already reads as "act here" carries the recovery; the weight and the hairline carry the
  break.

## The canvas, and which of its boards are stale

- The approved direction is **Impreso**, in dark as the primary look. The tokens above are its warm
  inversion, not a second design.
- **The five `Noche*.dc.html` boards are gone.** They were the losing direction — Archivo over
  Newsreader, a cool `#0E0F12` ground over the warm `#14130F`, an amber `#E0A458` accent over
  `#D9805F`, and cards this design forbids — and the canvas dropped them when it was rebuilt on
  2026-09-07. Checked 2026-09-08: the published canvas contains the string `Noche` zero times.
  Nothing on it contradicts this file any more.
- When a board and this file disagree, **this file wins**.
- **The canvas designs the half of the app that looks a word up, and none of the half that keeps
  it.** Its 39 boards are Inicio, Palabra, Frase, FraseOferta, Flexión, SinResultado, Sugerencias,
  Instalando, Fuente and Fallo. There is no board for `/registro`, for exporting, for an account, for
  syncing, or for devices — and this file names none of them either. A screen for any of those is
  designed from scratch, not derived from a board.
- **`Main.dc.html` is Palabra · dark · mobile.** It carries no `Palabra` in its name because it is
  the canvas entry file, so a search for `PalabraOscuroMovil` finds nothing and the set looks short
  by one. It is not: all four of light/dark × desktop/mobile exist for every state. Grep the boards
  for a token with a case-insensitive match — they are written lowercase (`#14130f`).

## Settled

- **A headword can be heard, in the browser's own voice.** Decided by the user 2026-09-08 over
  recorded audio and over doing nothing, and written as RL-26. It is the option that serves the
  **27,938 entries with no IPA** exactly as well as the 36,320 that have one, and it adds nothing to
  the 8.2 MB the dictionary already costs. Known price, and it is not small: the system voice varies
  a lot between devices and is poor on some.
- **The speak control has no board yet, and RL-26 is not built until it does.** It sits on the
  Palabra screen, which is the one screen this file calls settled — so drawing it means reopening a
  settled screen, deliberately, on the canvas. It is an icon-sized control beside the headword, never
  a labelled button competing with the headword's weight, and it does not become a second accent: the
  accent already names the part of speech there.

- **The English headword leads.** Decided by the user 2026-09-07, `Impreso · Palabra` over
  `Mixto · Palabra`. The headword anchors the answer in the text the reader was reading; the Spanish
  translation sits under it at 21 px. Nothing on this screen is open any more.
