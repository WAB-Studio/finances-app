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
- **A bottom bar carries the sections on the phone; a sidebar carries them on the desktop.** Buscar,
  Registro, Cuenta — three either way, and neither surface ever holds an action, a filter or a count.
  Decided by the user 2026-09-08. The earlier reading of this line — bar at every width, over a
  sidebar — was taken about the phone and is not withdrawn there; the desktop was never the case it
  answered. **The bar becomes a sidebar at 1024 px.** Decided by the user 2026-09-08; see
  `## Settled`. This is a second breakpoint, distinct from the ~660 px the reading column centres
  above: a vertical tablet stays on the bar, and only a wide tablet or a desktop gets the sidebar.
  The bar ships with two of its three first; see `## Settled` for which and why.
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
- **The canvas is 76 boards**, counted 2026-09-08 from the published file: Inicio, Palabra, Frase,
  FraseOferta, Flexión, SinResultado, SinResultadoIA, SinResultadoIAFallo, SinResultadoSinPista,
  Sugerencias, Instalando, Fuente, Fallo, Registro, RegistroVacío, Cuenta, CuentaDentro,
  Dispositivos and **BarraSidebar**, each in light/dark × desktop/mobile. `BarraSidebar` is T1,
  published after the count of 72 that stood here; the count is the only thing that changed.
- **An answer the AI wrote already has boards** — `SinResultadoIA` and `SinResultadoIAFallo`, both
  in all four. Whatever RL-29 becomes, it is not drawing from nothing.
- **Nothing is drawn for exporting or for syncing**, and this file names neither. A screen for
  either is designed from scratch, not derived from a board.
- **This slice's boards, named.** `FraseOferta`, `SinResultadoIA`, `SinResultadoIAFallo`,
  `SinResultadoSinPista`, `Registro`, `RegistroVacío`, `Cuenta`, `CuentaDentro`,
  `BarraSidebarClaroMovil`, `BarraSidebarClaroEscritorio`, `BarraSidebarOscuroMovil` and
  `BarraSidebarOscuroEscritorio` already exist. `BarraSidebar` (T1) draws the theme control at the
  sidebar's foot, which is what the user has just approved for desktop; see `## Settled`. **Nothing
  exists** for the record grouped and counted by word (T2), for the no-entry state (T3), for the
  account with its automatic copy (T4), for the sense-category amendment to `Palabra` (T5), or for
  the information tab RL-33 puts inside `/cuenta`.
- **Reading the published canvas costs 2.7 MB**, and the head of it is the editor's own stylesheet,
  not the design. Read it to a file and grep the file for `\.dc\.html` names; never read it into a
  conversation twice.
- **`Main.dc.html` is Palabra · dark · mobile.** It carries no `Palabra` in its name because it is
  the canvas entry file, so a search for `PalabraOscuroMovil` finds nothing and the set looks short
  by one. It is not: all four of light/dark × desktop/mobile exist for every state. Grep the boards
  for a token with a case-insensitive match — they are written lowercase (`#14130f`).

## Settled

- **A search with no result offers two things, and they are not the same thing.** Decided by the
  user 2026-09-08, written as RL-28 and RL-29.
  - **A typo gets a correction, computed on the device.** Edit distance over the 58,946 headwords:
    of 1,955 generated one-edit typos it found the intended word **100% of the time**, 288 with more
    than one candidate, at **0.04 ms** a search. No network, no cost. `recieve` → `receive`.
    Boards: `SinResultadoSugerencia`, light/dark × desktop/mobile.
  - **A real word the dictionary lacks gets a button, never an automatic call.** `fettle` is English,
    absent from the 58,946, and confirmed in Wiktionary as having twelve senses **and no Spanish
    pair** — which is why DBnary never extracted it. Edit distance answers it *wrong*, offering
    `kettle/mettle/nettle/settle`, so the correction must not fire here. Only a model closes it.
    Nothing leaves the device until the reader taps. Boards: `SinResultadoIA`, `SinResultadoIAFallo`.
  - **The guard between them:** the correction shows only when a candidate is within one edit of a
    headword. `zzqqxv` gets neither line, and that is the case the guard exists for.
  - **The answer is labelled.** An AI answer carries `RESPONDIDO POR IA` above it; the reader always
    knows what came from the dictionary and what did not.
  - **A failure is a failure.** Measured 2026-09-08: 3 of ~12 calls failed (two 403, one 503). The
    board for it exists and says so plainly, with a retry in the ordinary accent button and **no new
    error colour**.
- **The provider is Gemini, `gemini-3.8-flash`.** Decided by the user 2026-09-08 after running both
  candidates against the real gap words. Flash writes what a reader uses (`fettle` → *estado, casi
  siempre en «in fine fettle»*); Flash-Lite pads every note with «Se usa para describir…», which is
  text that only explains and `AGENTS.md` forbids. Flash also costs less per answer at 55–92 output
  tokens against ~95.

- **A headword can be heard, in the browser's own voice.** Decided by the user 2026-09-08 over
  recorded audio and over doing nothing, and written as RL-26. It is the option that serves the
  **27,938 entries with no IPA** exactly as well as the 36,320 that have one, and it adds nothing to
  the 8.2 MB the dictionary already costs. Known price, and it is not small: the system voice varies
  a lot between devices and is poor on some.
- **The speak control is drawn, on the four `Palabra` boards and on no other.** Counted 2026-09-08 in
  the published file: a 44 px tap target immediately after the headword, holding a 22 px speaker
  glyph in **muted** — `#9a9484` in dark, `#6b675a` in light — never in the accent, because the accent
  already names the part of speech there. It is icon-sized and never a labelled button competing with
  the headword's weight. RL-26 has its board and is buildable.
- **Grep this board set for a shape, not a word.** The control carries no label, no `aria-label` and
  no word in its markup — it is the path `M4 9v6h4l5 4V5L8 9H4z` plus two arcs. A search for `speak`,
  `altavoz` or `hablar` finds nothing and reads as a missing board. It cost this exact mistake once.

- **The English headword leads.** Decided by the user 2026-09-07, `Impreso · Palabra` over
  `Mixto · Palabra`. The headword anchors the answer in the text the reader was reading; the Spanish
  translation sits under it at 21 px. Nothing on this screen is open any more.

- **The record is read inside the app, not only counted and downloaded.** Decided by the user
  2026-09-08, against the alternative of leaving `/registro` as a number and a download button.
  A row carries three things and no more: the word, its translation, and how the answer was reached
  — Exacta, Flexionada, Traducida or Sin resultado. The boards are `Registro` and `RegistroVacío`,
  in all four of light/dark × desktop/mobile.
- **This reopens `/registro`, which shipped as neither.** `app/registro/page.tsx` mounts
  `ExportPanel`, and that renders `t("count")` and a download button — it lists nothing. The list is
  a screen nobody has built, and it belongs to no module in any plan.

- **Two English words the dictionary has no entry for get a screen, not silence.** Decided by the
  user 2026-09-08. Today anything of two tokens that is not a headword — and anything over sixty —
  parks in `waiting` and renders nothing at all: `PHRASE_MIN_TOKENS` is 3 (`lib/query/classify.ts:10`),
  `search-screen.tsx:182` parks there, and `phrase-answer.tsx:42` returns `null` for it. Nothing ever
  leaves that state. The screen names what was not found and offers the word answer for each word
  under it. It is chosen over lowering the phrase floor because it answers **offline**, where the
  network path cannot, and over one line of copy because the dictionary holds both words.
- **A lookup has a URL.** Decided by the user 2026-09-08. `/?q=book`, written on settle. Back walks
  the reader's own lookups instead of leaving the app — which is what it does today, since `/` is the
  only history entry there has ever been, and on a home-screen install that gesture closes the
  dictionary. It also ends the retype that every trip to `/fuente` or `/registro` costs. RL-14 is
  untouched: the answer still comes from IndexedDB and no keystroke reaches the network. Known price,
  and the user was told it: a reader's queries enter browser history, which on a shared phone is a
  real change.
- **The bottom bar ships with two items first — Buscar and Registro — and gains Cuenta with the
  account slice.** The user left the count to this file on 2026-09-08. Three is what the bar is for
  and what every board draws; `/cuenta` is a route that does not exist, and a permanent tab onto a
  dead end is worse than a bar that grows. The reason to build it now is that `/registro` is
  currently reachable only through a link labelled «Ver origen», behind the credits page.

- **The desktop gets a design of its own, and it starts with the sidebar.** Decided by the user
  2026-09-08, on their own words: «en desktop no se ve bien, es como el mobile», and «en desktop
  deberían ser un sidebar porque hay más información». Voyager has no desktop design today — it
  centres the phone layout and stops, which is what `/registro` stretching edge to edge showed. The
  sidebar is the first piece, not the whole answer: every screen that is not prose has to be drawn
  for the width it now gets. **No board exists for any of it.**
- **Copying to an account is automatic, not an act.** Decided by the user 2026-09-08, on their own
  words: «no tiene sentido que sea manual, debería linkearse automáticamente. No es una pregunta, es
  algo que se hace solo». With an account, the copy starts by itself and is never asked about. This
  **retires RL-23**, which the 2026-09-08 slice had just built, and with it the consent screen that
  named the two figures. **RNL-09 is untouched**: with no account, nothing leaves the device — the
  account is still the whole of the consent. **No switch survives.** Asked whether one does, the
  user answered **none but signing out**: with an account, the copy runs; the only way to stop it is
  to close the session. Written as RL-30.
- **The licence hides in an information tab inside `/cuenta`.** Decided by the user 2026-09-08, on
  their own words: «LA LICENCIA SE ESCONDE EN UNA PESTAÑA DE INFORMACION EN LA CUENTA DONDE NO VA
  QUEDAR VISIBLE A LA GENTE (A MI)». It leaves the search screen, where it bothered the user, and
  lands in `/cuenta`, which already renders with no session — so the credit CC BY-SA 3.0 requires
  stays reachable by whoever uses the app, signed in or not. This retires RL-15 and is written as
  RL-33. **No board exists for this tab.**
- **`/registro` becomes the study, and a word opens its full history.** Decided by the user
  2026-09-08. The record groups by word — one row, a count, ordered by frequency — and replaces the
  chronological list this same slice had just settled on (`Registro`/`RegistroVacío`, above);
  tapping a word opens every one of its searches with its date. Written as RL-32. **No board exists
  for the grouped rows or for a word's opened history**; `Registro` and `RegistroVacío` as drawn are
  the chronological list this decision retires from the reading path, not the study's boards.
- **The theme control has two homes, one per shape of the navigation.** Decided by the user
  2026-09-08, looking at the `BarraSidebar` board: the sidebar's foot on desktop, inside `/cuenta`
  on the phone. Two surfaces, not one, because the bar that carries the phone's navigation has no
  foot to put a control in and the sidebar does. **This gives RNL-07 a home; it does not build it —
  RNL-07 stays unticked.** `app/theme.css:14-17` admits today that the reader does not choose: the
  OS preference alone picks the mode, and no toggle lives there yet.
