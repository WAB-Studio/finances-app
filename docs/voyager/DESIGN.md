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
- **The canvas is 156 boards**, counted 2026-09-09 from the published file after the critic's drive.
  The last twenty are the five decisions of that afternoon, each drawn light and dark × desktop and
  mobile before any worker was dispatched, each carrying an annotation that says what was refused:
  `SugerenciasPausadas` (the prefix that keeps its list), `SinEntradaFraseEnlaces` (every block a way
  back in), `CuentaSinRed` (the one screen allowed to name the connection), `PalabraDefinicionPlegada`
  and `PalabraDefinicionAbierta` (the English definition's two states). The older count follows:
- **The canvas was 112 boards**, counted 2026-09-09 from the published file: Inicio, Palabra,
  PalabraCategoria, PalabraHistorial, Frase, FraseOferta, Flexión, SinResultado, SinResultadoIA,
  SinResultadoIAFallo, SinResultadoSinPista, SinEntrada, SinEntradaEstados, Sugerencias, Instalando,
  Fuente, Fallo, Registro, RegistroVacío, RegistroEstudio, RegistroEstudioEstados, Cuenta,
  CuentaDentro, CuentaCopia, CuentaCopiaEstados, CuentaInformacion, Dispositivos and
  **BarraSidebar**, each in light/dark × desktop/mobile. The nine that arrived 2026-09-09 are T2,
  T3, T4 and T5; the count is the only thing that changed.
- **An answer the AI wrote already has boards** — `SinResultadoIA` and `SinResultadoIAFallo`, both
  in all four. Whatever RL-29 becomes, it is not drawing from nothing.
- **Nothing is drawn for exporting or for syncing**, and this file names neither. A screen for
  either is designed from scratch, not derived from a board.
- **This slice's boards, named.** `FraseOferta`, `SinResultadoIA`, `SinResultadoIAFallo`,
  `SinResultadoSinPista`, `Registro`, `RegistroVacío`, `Cuenta`, `CuentaDentro`,
  `BarraSidebarClaroMovil`, `BarraSidebarClaroEscritorio`, `BarraSidebarOscuroMovil` and
  `BarraSidebarOscuroEscritorio` already exist. `BarraSidebar` (T1) draws the theme control at the
  sidebar's foot, which is what the user approved for desktop; see `## Settled`. T2, T3, T4 and T5
  landed 2026-09-09 and the user approved them the same day: `RegistroEstudio`,
  `RegistroEstudioEstados` and `PalabraHistorial` (T2); `SinEntrada` and `SinEntradaEstados` (T3);
  `CuentaCopia`, `CuentaCopiaEstados` and `CuentaInformacion` (T4); `PalabraCategoria` (T5).
- **`/registro/<palabra>` has no empty state drawn.** `PalabraHistorial` (T2) draws the word's own
  history full and nothing else. Module 12 shipped it reusing the strings of
  `RegistroEstudioEstados`, so the screen a reader reaches for a word with no rows is a reuse
  nobody approved, not a decision. Draw it before the next change to that screen.
- **`Fuente`'s four boards draw a route that is being retired.** The decision below takes `/fuente`
  out; `CuentaInformacion` (T4) is the credit's only board from now on. The `Fuente` boards stay on
  the canvas as stale — never cite one in a dispatch.
- **The one board still missing is the photo.** RL-36 draws a photo inside the word's answer and no
  board in any of the four faces has a state for it. No module of the 2026-09-08 slice draws one, so
  it blocks nothing today — and the first module that does opens the amendment before it writes a
  line.
- **The two dark `BarraSidebar` boards marked «Claro» selected in the theme control**, drawn dark.
  Fixed in place 2026-09-09. A worker copying that builds a control that contradicts the page it
  sits on.
- **The canvas is seven pages, one per area of the app, and each carries light and dark side by
  side.** Instalación, Buscar · la palabra, Buscar · sin respuesta, Buscar · la frase, Registro,
  Cuenta, Cáscara. It was two pages — `Claro` and `Oscuro` — of 56 boards each, stacked over
  25,000 px, and at that height the user could not read it: «demasiadas pantallas que ya no se ve
  nada», 2026-09-09. Light sits at x 0 and 480, dark at 1900 and 2380, so a board and its dark twin
  are legible together for the first time. Adding a family means adding it to its area's page, never
  a ninth page and never a second canvas.
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
  - **A typo gets a correction, computed on the device.** Edit distance over the 58,944 headwords:
    of 1,955 generated one-edit typos it found the intended word **100% of the time**, 288 with more
    than one candidate, at **0.04 ms** a search. No network, no cost. `recieve` → `receive`.
    Boards: `SinResultadoSugerencia`, light/dark × desktop/mobile.
  - **A real word the dictionary lacks gets a button, never an automatic call.** `fettle` is English,
    absent from the 58,944, and confirmed in Wiktionary as having twelve senses **and no Spanish
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
  **27,899 entries with no IPA** exactly as well as the 36,359 that have one, and it adds nothing to
  the 8.0 MiB the dictionary already costs. Known price, and it is not small: the system voice varies
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
  for the width it now gets. `BarraSidebar` (T1) drew the shell 2026-09-08; `RegistroEstudio`,
  `SinEntrada`, `CuentaCopia` and `CuentaInformacion` drew the screens inside it 2026-09-09.
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
  RL-33. Drawn 2026-09-09 as `CuentaInformacion`, in all four faces: a two-tab strip at the head of
  `/cuenta`, the dictionary and its edition, then the CC BY-SA 3.0 credit, then the app's version.
- **`/registro` becomes the study, and a word opens its full history.** Decided by the user
  2026-09-08. The record groups by word — one row, a count, ordered by frequency — and replaces the
  chronological list this same slice had just settled on (`Registro`/`RegistroVacío`, above);
  tapping a word opens every one of its searches with its date. Written as RL-32. Drawn 2026-09-09
  as `RegistroEstudio`, `RegistroEstudioEstados` and `PalabraHistorial`; `Registro` and
  `RegistroVacío` as drawn are the chronological list this decision retires from the reading path,
  and they stay on the canvas as what was replaced.
- **The theme control has two homes, one per shape of the navigation.** Decided by the user
  2026-09-08, looking at the `BarraSidebar` board: the sidebar's foot on desktop, inside `/cuenta`
  on the phone. Two surfaces, not one, because the bar that carries the phone's navigation has no
  foot to put a control in and the sidebar does. **This gives RNL-07 a home; it does not build it —
  RNL-07 stays unticked.** `app/theme.css:14-17` admits today that the reader does not choose: the
  OS preference alone picks the mode, and no toggle lives there yet.

- **A word's photo is online-only, and it never sits behind a tap.** Decided by the user 2026-09-08,
  on their own words: **«las fotos no es obligatorio para sesiones offline»**. Embedding one photo
  per entry measured at **≈247 MB** for the 64,258 entries — 29 times today's asset — against an
  average thumbnail of **3,846 bytes** for a 100 px width, sampled over 9 real words
  (`private/reportes/investigacion-oraciones-e-imagen-2026-09-08.md`). That weight is the reason it
  is never installed: with no connection there is no photo, and the word's answer draws exactly as it
  does today. No count of how many entries are even photographable exists: the loose upper bound is
  37,567 entries tagged as a noun, which does not tell `apple` from `anxiety`. The user also chose
  that the photo **draws by itself as the answer is drawn**, never behind a tap — and that clause is
  what **retires RL-14**: a keystroke can now reach the network, on the very screen that used to
  touch nothing at all. `SPEC.md` opens its successors as **RL-35** (the text, unchanged) and
  **RL-36** (the photo, the new exception).
- **The photo goes straight to Wikimedia, with no route handler of the app's own in front of it.**
  Decided by the user 2026-09-08, asked plainly whether it mattered that a third party sees which
  word the reader is looking up: they chose to let it go direct, over building a fifth route handler
  (the shape RL-09 already has for the sentence path) to hide it. Say this as the price it is, not as
  an implementation detail: everywhere else in this app a lookup never leaves the device — RL-35 (the
  word's text), RNL-09 (the copy), the consent the account screen already asks for — and the photo is
  the one deliberate exception, telling Wikimedia both the word and the reader's IP address.
- **No board draws a photo in the answer.** The canvas has no state for it in `Palabra`, in any of
  the four combinations of light/dark × desktop/mobile. It needs an amendment to the `Palabra` board
  before any module draws one, and until that amendment exists, none does.
- **Wikimedia's licence is per file, and this app hides licences in a tab today.** CC BY-SA, CC0 and
  public domain sit mixed across individual files, so every photo carries its own attribution, unlike
  the CC BY-SA 3.0 that covers the whole dictionary asset under one credit. `/cuenta` is where this
  app already puts a licence (RL-33's source and licence, in an information tab). A per-image credit
  cannot hide there. A per-image attribution has to sit next to its image to mean anything, which is the
  opposite instinct. **Open, not resolved here:** where does a photo's attribution go?

- **A sense group carries one category label, and the group's IPA sits on that label's row.**
  Decided by the user 2026-09-09, looking at `PalabraCategoria`, over the alternative of giving every
  sense its own IPA. `like` draws SUSTANTIVO once, not twice. The IPA on the label row is the first
  sense's; a sense whose IPA differs from it draws its own above its translation, and a sense whose
  IPA matches never repeats it. This is what RL-04 has asked for since it was written and what
  `sense-list.tsx` has never done. Known price: a reader glancing at the label row sees an IPA that
  belongs to the first sense of the group, not to the group.
- **The study replaces the download as the weight of `/registro`.** Decided by the user 2026-09-09,
  approving `RegistroEstudio`. The grouped rows are the screen; «Descargar el registro» drops from a
  filled button to an underlined link at the foot. The three other states are drawn:
  a four-row skeleton while loading, «Todavía no has buscado nada» when empty, and «No pude leer el
  registro» with a retry when the store fails — no system red, per `## Failure`.
- **The no-entry screen names the string and answers each word under it.** Decided by the user
  2026-09-09, approving `SinEntrada`. At most eight word blocks; the rest becomes one line. Over
  sixty words there is one line and no block at all. A word the dictionary also lacks draws its own
  «El diccionario tampoco tiene esta palabra», never a gap.
- **`measure="full"` takes no maximum width on desktop.** Decided by the user 2026-09-09, after
  three candidates were rendered on the real app with the same rows: no cap, 1120px, 960px. A row
  runs 1680px on a 1920 window and 2320px on a 2560 one, and the known price is the distance a
  reader's eye crosses between a word and its translation — 925px at 2560. `width: auto` is what
  keeps the screen from overflowing the sidebar's 240px; a maximum is a separate rule and there is
  none. Any new `measure="full"` screen inherits this.
- **A sentence that fails to translate falls to the per-word breakdown, always.** Decided by the
  user 2026-09-09, after the code was measured rather than assumed. «The translation comes back
  empty» is not a state this app has: `app/api/translate/route.ts` turns an empty `translatedText`,
  a quota warning and a non-200 `responseStatus` each into a 502, which `translateOverNetwork`
  throws and `search-screen.tsx` renders as `failed`. So the fallback hangs off `failed`, and a
  module built on «done with empty text» would have landed dark. Written as **RL-37**; RL-31 is
  untouched, because its own claim — a string *not* treated as a sentence never gets silence —
  stays true.
- **`SinResultadoIAFallo` is stale in all four faces.** «La IA no pudo responder» is the state the
  decision above replaces. The boards stay on the canvas as a record of what was; never cite one in
  a dispatch. The screen a failed translation reaches from now on is `SinEntradaFrase`.
- **The app says nothing about being offline, and `offline.notice` goes.** Decided by the user
  2026-09-09, with both readings drawn side by side on the canvas's «Cáscara» page. The string
  existed — «Estás usando la app instalada en el dispositivo, sin conexión» — and it only explains:
  there is nothing to act on, and the app answers a lookup offline exactly as it does online, which
  is what RL-16 promises. `## Type`'s rule wins: write what a person acts on, cut what only explains.
  **`SinConexionCallado` is the approved board; `SinConexionAviso` is stale** — it exists only to
  record what was refused. Known price, and the user took it: a reader who needs the network for
  something that needs it — translating a phrase, copying to the account — is told nothing about why.
- **The error boundary covers the whole app and keeps the shell.** Decided by the user 2026-09-09,
  approving `Error` in all four faces on the «Cáscara» page. One `app/error.tsx` at the root: the
  bottom bar or the sidebar stay put, so a reader can leave for another section without reloading.
  It draws `error.title` and `error.retry`, which were written long before any screen called them.
  It obeys `## Failure` — a hairline sets the break off, the line is full-weight ink, and the accent
  is spent only on the button that recovers. No error colour, here or anywhere.
- **A word block on `SinEntradaFrase` carries its translations alone — no IPA, no definition.**
  Decided by the user 2026-09-09, once the screen's real height was measured. It applies to this
  screen only: looking a word up on its own still answers in full. A reader scrolling a failed
  sentence does not need the full entry for «the». Known price: the fallback answers less completely
  than a direct lookup, and it needs a `SenseList` variant. **The four `SinEntradaFrase` boards were
  redrawn to the trimmed block 2026-09-09 and are current.** The same redraw gave the word the
  dictionary also lacks a heading of its own: it had none, so the one word that made the sentence
  fail was the only one unfindable among the eight. Approved by the user the same day.
- **«El diccionario no tiene esa palabra» never shows over an unfinished prefix.** Decided by the
  user 2026-09-09, after the critic drove it: typing `ru` and pausing 900ms — to think, to look back
  at the book — withdrew a correct suggestion list and left the not-found line over a prefix the
  dictionary certainly has, in the gesture the app repeats most. The message is suppressed while the
  text is still a prefix of at least one suggestion already offered, and kept for when nothing
  matches at all. **`SUGGESTIONS_SETTLE_MS` does not change** — raising it was offered and refused —
  **and RL-18 does not change**: the list still withdraws on settle. What was wrong is RL-18's own
  stated reason, «the answer is already on screen»: on an unfinished prefix there is no answer.
- **`SinEntradaFrase` draws the phrase fallback, and the screen it makes is tall.** Approved by the
  user 2026-09-09, four boards on the canvas's «Buscar · sin respuesta» page at y 5200, light and
  dark × desktop and mobile. «she kept her fettle through the long and bitter winter» with no
  translation: eight word blocks, then «y 2 palabras más» for the rest. `fettle` is block 4, so the
  «El diccionario tampoco tiene esta palabra» line is drawn **inside** the fallback and not only
  beside it. Two alternatives were offered and refused — cutting to four or five blocks, and skipping
  articles and prepositions — so the breakdown stays every word, in order.
  **The height was given wrong twice, and the boards still carry the wrong figure.** They say 1560px
  desktop and 1880px mobile — that sized the content column, not the page, and it is the number the
  approval was given against. A first correction said 3022/3155. Driving the built app 2026-09-09
  measured **3508px desktop and 3805px mobile** for a nine-word failing phrase: four or five phone
  screens of scrolling to reach the word the reader wanted. Measure the page, never the artboard,
  when a screen is approved on its height.
  **The three figures are reconciled, 2026-09-09, and the number is 2851px desktop / 2944px mobile.**
  They never contradicted each other: 3022/3155 was the block before the trim, and 3508/3805 was a
  different phrase on a version with no eight-block cap. A validator re-measured 2851/2944
  independently and hit the worker's figure exactly. **The method is the number**:
  `document.documentElement.scrollHeight`, production build, the phrase
  `dog cat zzqx bird fish mouse horse cow pig`, read 1000ms after the fill. Measure the page, never
  the artboard. The four boards still print 1560/1880 — the content column, not the page — and are
  stale until redrawn.
- **A phrase the translation cannot answer falls back to the per-word breakdown.** Decided by the
  user 2026-09-09, closing the gap `SinEntrada`'s eight-block cut left. `schedulePhrase` sends every
  3-to-60-token phrase to `PhraseAnswer` today, so the breakdown ran at exactly two tokens and
  `MAX_BLOCKS = 8` never fired. From now on, a 3-to-60-token phrase whose translation comes back
  empty drops to `NoEntryAnswer`: at most eight word blocks, the rest one line. The cut and the «N
  más» line become reachable, and the board that draws that fallback does not exist yet.
- **`/fuente` is retired, and the credit lives in `/cuenta` alone.** Decided by the user 2026-09-09.
  The route was orphaned from module 6 — no screen linked it, `source.open` had no caller — and it
  is a leftover of RL-15, retired 2026-09-08. RL-33 already puts the source, the edition and the CC
  BY-SA 3.0 licence in an information tab inside `/cuenta`, so **no live requirement changes and
  nothing is retired from the SPEC.** `app/fuente/`, its strings and its boards go.
- **Every attribution the app owes is named in `/cuenta`'s information tab, and nowhere else.**
  Decided by the user 2026-09-09, settling the question open since 2026-09-08. Tatoeba's per-sentence
  credit and Wikimedia's per-image credit join the dictionary's in `CuentaInformacion`; the reading
  screen carries no credit line and no per-block affix. The tab reads with no session, which is what
  keeps the credit reachable to whoever uses the work.
- **The account screen shows a state, never a control.** Decided by the user 2026-09-09, approving
  `CuentaCopia`. With a session it reads «Copiando a tu cuenta» and when the last copy was; there is
  no button and neither of the two figures RL-23 used to name. Copying now, never copied, failed
  with its retry, and signed-out are each drawn. The only way out stays signing out, per RL-30.

- **The AI is parked, and no provider is chosen.** Decided by the user 2026-09-08, after the numbers
  came in. RL-28 and RL-29 stay open and unbuilt; nothing in the app calls a model, so picking a
  provider now would be deciding without a caller. What was measured that day, and what it is worth
  re-reading before this reopens (`private/reportes/proveedores-ia-oracion-2026-09-08.md`):
  - The 46.7% failure rate that started this was **never the provider**. It was
    `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, `quotaValue: 20` — a per-project daily cap
    on `gemini-3.8-flash`, shared by every lane. Spacing calls 5 s apart changed nothing; the same
    model measured **0/35** the next day, when the day's 20 were already gone.
  - **Google publishes no free-tier daily limit.** Its own rate-limit page says to look in AI Studio.
    Community guides say ~1,500 requests a day for free Flash; this project measured 20. A figure
    read off the open web would have confirmed a false diagnosis and bought a migration for nothing.
  - Two models in the same family and project have no such wall: `gemini-3.5-flash-lite` measured
    **19/20**, `gemini-3.1-flash-lite` **16/20**, on the same 20 headwords. The one failure of the
    first was **our own client timeout**, not theirs.
  - Published prices per MTok, read 2026-09-08: `gemini-3.1-flash-lite` $0.25/$1.50,
    `gemini-3.5-flash-lite` $0.30/$2.50, `gemini-3.8-flash` $0.75/$3.75 — **doubling to $1.50/$7.50
    on 2027-01-01** — Claude Haiku 4.5 $1.00/$5.00.
  - Nobody has compared the one thing that decides this: **which model writes a better Spanish
    example sentence for a reader.** Price does not separate them at this volume; quality is unmeasured.
- **Read a price, measure a reliability. Never the other way round.** The rule this day earned. Half
  the published comparisons confuse Flash with Flash-Lite, and none of them knows this project's
  quota, prompt or words.

- **`global-error.tsx` gets a test hook, and only outside production.** Decided by the user
  2026-09-09. `app/layout.tsx` throws on a signal that an environment variable arms, so `check:e2e`
  can drive the root-layout crash; the production build strips it and no reader can reach it.
  Prove the stripping, or the hole comes back wearing a hook. Until that module lands, the only
  proof this screen renders is a hand-made hook a validator wrote and deleted.

- **The 429 stays proven by reading, not by driving.** Decided by the user 2026-09-09: no vitest, no
  jest, one test layer in this repo. `apps/voyager/app/actions/account.ts` classifies
  `error.status === 429` into its own line, and a validator mutation confirmed 2026-09-09 that
  breaking that branch reddens nothing in `check:e2e`. The type it leans on is
  `AuthError.status: number | undefined`. Known gap, not an oversight.

- **The false-inflection filter stops where grammar stops.** Decided by the user 2026-09-09. The
  grammatical filter took 931 headwords claiming a false comparative or superlative to 0 without
  losing a legitimate one. What survives is semantic: `cutter` still reduces to `cut`, because
  `cut` carries an adjective sense. Closing that needs NLP — excluded by SPEC §4 — or a hand-built
  gradability list. Neither is worth it at this residue.

- **No lookup is lost when the tab dies, and the grouping stays.** Decided by the user 2026-09-09,
  after a critic drove it: `lemon` searched, 2.0s wait, tab closed — the row was gone, and only
  landed after **5.8s** of quiet (`SETTLE_MS` 800 + `MAX_PENDING_MS` 5000, `lib/log/record.ts:18-19`).
  RL-21 says «**every** lookup a reader settles on is recorded» and its own context is «typed into,
  read, and **closed**». The listeners were never missing: `pagehide` and `visibilitychange` both
  call the flush. What loses is the race — `commit` fires `void writeRow(row).then(…)` and the page
  dies before the IndexedDB transaction commits. Two alternatives were refused: writing at settle
  (800ms), which fills the record with prefix rows «bo», «boo», «book»; and rewriting RL-21 to
  promise less.

- **A paused prefix keeps its suggestions on screen.** Decided by the user 2026-09-09. Typing `ru`
  and waiting left `main.innerText` empty at 900ms (`SUGGESTIONS_SETTLE_MS`,
  `components/search/search-screen.tsx:35`): **640px of nothing** on a 360×740 phone, light and
  dark, and the ten candidates the reader was reading went with it. From now the list stays until
  the text itself changes. The price, taken knowingly: the list coexists with the answer when the
  prefix is also a word (`book`), which is what RL-18 set out to avoid.

- **Every block of the breakdown is a way back in.** Decided by the user 2026-09-09. On a failed
  phrase the eight blocks and the «…y N palabras más» line carry no control at all — the only
  interactive element in `main` was the box's own clear button, so `winter` had to be retyped. Each
  block and that line now lead to `/?q=<word>`. The price: the reader loses the breakdown on the
  jump. Two alternatives were refused earlier and are not reopened — cutting to four blocks, and
  skipping articles and prepositions. This also closes the compact block's other hole: it draws a
  34px headword identical to a real answer, with no IPA, no definition, no speak and, until now, no
  door to the full entry.

- **The email screen names the connection when there is none.** Decided by the user 2026-09-09, as
  an explicit exception to the same day's decision that the app says nothing about being offline.
  Driven offline at 360px, the button sat on «Enviando…» at 2, 5, 8, 12 and **30 seconds** with no
  failure line, no retry and no way out but a reload. This is the one screen that genuinely needs
  the network, so it is the one screen allowed to say so. Everywhere else the silence holds.

- **The English definition folds away behind a tap.** Decided by the user 2026-09-09. **51,622 of
  64,258 entries (80.3%)** carry a «Definición» block whose prose is English — `her` → «The form of
  she used after a preposition…» — under a Spanish heading, for someone who has just demonstrated
  they did not understand an English word. Folding keeps it for the reader who does read some
  English and shortens the app's longest screen for the one who does not. Removing it outright was
  refused: the information is real. The fold's two states must be drawn, and which one opens is a
  drawing decision, not a code one.
