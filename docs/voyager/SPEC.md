# Reading dictionary — specification

> **For the implementing agent:** section 1 is the contract and section 4 fixes
> the stack. If something is not in section 1, it does not get built. This
> document makes no implementation decisions: how each requirement is satisfied
> is decided at implementation time, as long as the non-functional requirements
> hold.

---

## 1. Specification

### Context

A person reads English on paper and hits a word they do not know. The phone is
already in the other hand. The app is a dictionary that remembers: it is opened
mid-sentence, typed into, read, and closed, dozens of times in one sitting, on a
bus or in a bed, often with no connection.

The central unit is the **headword**: an English entry with its senses, its part
of speech, its IPA and its Spanish translations. The dictionary is shipped with
the app and installed onto the device, so that looking a word up is a local
lookup and not a request.

A whole sentence is a second, rarer path. It is translated by the device when
the device can, and over the network when it cannot.

Interface language: Spanish. Source language of the dictionary: English.

### Scope

This slice is the box and the answer: look a word up, look a sentence up, and
have the dictionary on the device.

**Out of scope:** books, reading sessions, spaced repetition and notes. None of
this gets built, and no schema, table or column is "prepared for" it.

### Functional requirements

#### The box

- [ ] **RL-01** — The app opens on one search box. It has focus, it sits in the thumb's reach, and it answers as the person types.
- [x] **RL-02** — The box takes a word or a whole sentence. The person never picks a mode and never sees one.
- [x] **RL-03** — The typed string is looked up whole in the local dictionary first, so a multi-word entry such as `give up` answers as a word. It is treated as a sentence only when that lookup misses **and** the string has more than one token.

#### The word

- [ ] **RL-04** — A headword's answer shows every sense the dictionary carries for it, grouped by part of speech, each with its IPA when one exists and all of its Spanish translations.
- [x] **RL-06** — An inflected form resolves to its headword, and the answer names both the form typed and the headword reached: `left` finds `leave`, `went` finds `go`, `children` finds `child`, `studies` finds `study`.
  - Measured 2026-09-07 by `apps/voyager/scripts/check-dictionary.ts` (D9), over a sample of 2,345 regular surface forms generated from 301 stride-sampled single-word letter headwords by applying the regular suffix rules, plus all 386 `IRREGULAR_FORMS` surfaces: the real coverage figure is the **irregular-only rate, 367/386 = 95.1%**, the only non-circular signal since those surfaces come from a hand-written table no rule can reach. The generated forms resolve at 2345/2345 = 100.0%, a closed loop that proves the resolver inverts its own suffix rules, not real coverage. Blended (generated + irregular together, the number that includes the closed loop): 2712/2731 = 99.3%.
- [ ] **RL-07** — Autocomplete appears only while the string is being treated as a word. A sentence never raises it.
- [ ] **RL-26** — A headword's answer can be heard. The device speaks it with the voice the browser
  already carries, so a headword with no IPA is spoken exactly like one that has it. Decided by the
  user 2026-09-08: **27,938 of the 64,258 entries carry no IPA at all** (36,320 do), and written
  transcription therefore answers barely half of them. Nothing is downloaded and nothing is
  recorded — no audio file ships with the dictionary and none is fetched.
- [x] **RL-18** — While the string is being treated as a word and the typing has not settled, up to
  ten headwords that begin with it are offered. Choosing one answers it. The offer withdraws once
  the typing settles: the answer is already on screen and the list has nothing left to add.

#### The sentence

- [ ] **RL-08** — A sentence is translated by the device's own translator when the browser offers one and it is ready. Whether it does is asked of the browser at runtime, on every open, and never inferred from the browser's name or version.
- [x] **RL-09** — When the device offers no translator, the sentence is translated over the network, and the answer says the translation came from the network. *This is the app's only server surface and the single exception to "no backend": one route handler that holds the provider's identity and any key it needs off the client and makes the provider a one-file change. Nothing on the word path passes through it, ever.*
- [ ] **RL-10** — While the device's translator is downloading what it needs, the interface says so and the box stays usable.
- [x] **RL-11** — When the device has a translator that is not yet installed, that sentence is translated over the network and a single control offers to install the translator. Activating that control is what starts the download; every sentence after it is translated on the device. A person who never activates it keeps getting network translations and is never blocked.

#### The payload

- [ ] **RL-12** — The dictionary is fetched once, as a static asset, and installed onto the device. Its progress is shown and the box stays typeable throughout.
- [x] **RL-13** — An interrupted install leaves no partial dictionary. The next open finds the dictionary whole or absent, never in between, and starts it again from zero.
- [x] **RL-14** — Once installed, looking a word up touches the network in no way, on no keystroke.
- [x] **RL-15** — The dictionary's source, its edition and its CC BY-SA 3.0 licence are named in the interface, one tap from the box, linking to the source and to the licence text, and stating that what the app ships is a reformatted extract distributed under the same licence.

#### The shell

- [ ] **RL-16** — The app opens with no connection and shows its box, and it can be launched from the phone's home screen without a browser around it. This holds from the second time it is opened onwards: the first open needs the network to deliver the app itself.
- [ ] **RL-21** — Every lookup a reader settles on is recorded on the device, from the app's first
  day: what was typed, whether it was answered as a word or a sentence, the headword it actually
  reached when an inflected form was typed, whether it found anything at all, and when. The record
  only ever gains rows: nothing edits or deletes one. No screen on the read path shows it. It is read
  to take it off the device — to a file, or to the copy held by the reader's account — and to bring
  back what the same reader's other devices recorded; never on the path that answers a lookup.
- [ ] **RL-22** — A reader can keep their record in an account of their own: they sign in through a
  link sent to their address and, from then on, what this device records is copied to that account
  and what their other devices recorded comes down to this one **and stays in its local record,
  beside its own**. It is a copy: a lookup is still answered from the device, with an account or
  without one, online or offline.
- [ ] **RL-23** — Turning the copy on in a device sends up the record already there and brings down
  what the reader's other devices recorded. The reader knows both figures before anything happens:
  they are told how many searches will go up and how many will come down, and turning it on is what
  authorises it.
- [ ] **RL-24** — The copy never edits a row. A row names the device that recorded it and the number
  it carried there, so copying it twice does not duplicate it, going up or coming down, and what one
  device copies never overwrites what another wrote. An interrupted merge leaves the record whole in
  every sense that matters: what came down is valid, what did not comes down next time.

  The only thing it deletes is retiring a device, and it deletes exactly this: the searches that
  device had copied leave the copy, and that device stops syncing. **What had already come down to
  another device stays on that device**, and leaves it by clearing the app's data in that browser.
  The app says this before confirming and promises no more.
- [ ] **RL-25** — The reader sees the list of devices that have copied to their account: which one is
  in their hand, when each was last seen, and how many searches it has copied. They can retire any of
  them, their own included.
- [x] **RL-20** — The log can be exported from the app as a single file the reader saves onto their
  device: every recorded search, with its date and the headword it reached, in a documented and
  versioned shape. The export is deliberate: it is reached from outside the search screen and
  nothing triggers it on its own.

### Non-functional requirements

- [x] **RNL-01** — A word lookup answers in under 10 ms with the dictionary installed.
  - **What the 10 ms measures, settled 2026-09-07 before module 22 was written:** the lookup itself —
    the worker round trip, from the message posted to the answer received. Measured that way against
    the live app: p50 0,10 ms, p95 0,30 ms, max 1,30 ms over 200 sequential lookups.
  - Keystroke to painted answer is a **different and larger** number — p50 17 ms, p95 41 ms measured
    through Playwright — because it also carries React's render and commit and the driver's own
    dispatch. It is recorded here so nobody reads one number and cites the other. This requirement
    governs the first; no assertion anywhere enforces the second.
- [ ] **RNL-02** — Every string a person reads comes from the message catalogue. The interface is Spanish.
- [ ] **RNL-03** — The app holds at a 360 px viewport: no horizontal overflow, no overlapping control, no tap target under 32 px on its shorter side. It is used one-handed, standing, holding a book. It also holds at a wide viewport: the reading column keeps a maximum measure and centres, so at 1440 px the box and the answer read as a column rather than stretching the full width. The phone is the case the app is designed for; the desktop is the case it must not look neglected in.
  - Widened 2026-09-07 from the 360 px case alone. The code was unticked and nothing had been verified against it, so no tick is invalidated; the alternative was retiring it for a successor, which buys nothing here.
- [x] **RNL-04** — The dictionary asset is built from its source by a script kept in the repository, and the build records the source URL, the edition, the licence and the entry counts beside the asset.
- [x] **RNL-05** — The sentence path never fires on a keystroke: it waits for the typing to settle, does not fire below a minimum number of tokens, never fires twice for the same text, and cancels a request already in flight when the text changes. The word path is never throttled and never delayed.
- [x] **RNL-06** — Recording a lookup never delays, blocks or fails a lookup. The write is never awaited on the path that produces an answer, a failure to write is swallowed, and the log's storage is a separate database from the dictionary's, so a write can never contend with a read of the payload.
- [ ] **RNL-07** — The reader chooses light or dark, and the choice is remembered on the device. The app opens in the system's mode until a choice is made. Dark is the design's primary look; light is the same design inverted, and both carry the palettes in `docs/voyager/DESIGN.md`.
- [x] **RNL-08** — Exporting never touches the read path: building the file happens on a screen that
  is not the box, mounts no dictionary Worker, and with the export never opened the app behaves
  exactly as before.
- [ ] **RNL-09** — The copy is never on the read path: **with no account turned on the app opens not
  one connection, and the box still opens, focuses and answers the same**; with the box in view not
  one request leaves while typing; the copy fires only when the tab is hidden or when the reader asks
  for it; and a lookup answers in the same time with a ten-thousand-row merge in flight as without
  one.
- [ ] **RNL-10** — A reader's record is read and written by that reader alone. The access policies in
  the database decide it, not the query, and they are proved by driving them. No service path evades
  them.

### Retired

Dead codes. The number stays burned and the tick stays as it was.

- [x] **RL-19** — Every lookup a reader settles on is recorded on the device, from the app's first
  day: what was typed, whether it was answered as a word or a sentence, the headword it actually
  reached when an inflected form was typed, whether it found anything at all, and when. The record
  is append-only. It is read back only where the reader asks for it — to carry the words they looked
  up into practice, or to take them off the device — and never on the path that answers a lookup. _Retired 2026-09-08. Successor: RL-21._
- [ ] **RL-05** — While the string is being treated as a word, up to ten headwords that begin with
  it are offered. Choosing one answers it. _Retired 2026-09-07. Successor: RL-18._
- [x] **RL-17** — Every lookup a reader settles on is recorded on the device, from the app's first
  day: what was typed, whether it was answered as a word or a sentence, the headword it actually
  reached when an inflected form was typed, whether it found anything at all, and when. The record
  is append-only and nothing in the interface shows it. _Retired 2026-09-07. Successor: RL-19._

---

## 2. Model and invariants

### The source

The dictionary is one published edition of one published file. These are
measurements taken from it, not estimates:

| Fact | Value |
|---|---|
| Source | `https://download.freedict.org/dictionaries/eng-spa/2025.11.23/freedict-eng-spa-2025.11.23.src.tar.xz` |
| Format | TEI XML |
| Edition | 2025.11.23 |
| Licence | CC BY-SA 3.0 |
| Entries carrying a Spanish translation | 64,258 |
| Entries carrying IPA | 36,320 |
| Multi-word entries | 16,112 |
| Extracted payload | 8.2 MB raw, 2.9 MB gzipped |

The 16,112 multi-word entries are why RL-03 looks the whole string up before it
counts tokens: `give up` is a headword, not a sentence.

### Invariants

Rules the model must always guarantee, regardless of how they are implemented:

- The dictionary is data, never state. Nothing the reader does mutates it.
- A headword is a group of senses, never a row. Its senses, its parts of speech,
  its pronunciations and its translations answer together or not at all.
- The word path never touches the network.
- The payload is installed whole or not at all. There is no partial dictionary
  a lookup could read from.
- The interface never asserts a browser capability it has not asked for at
  runtime.
- The device holds exactly one copy of the payload.
- The record only ever gains rows, on the device and in the copy alike. A row is identified by the
  device that wrote it and the number it carried there.

---

## 3. Architecture

A Next.js application whose data lives on the device.

Principles, not recipes:

- **The read path has no backend.** The dictionary ships as a static asset and is read locally;
  looking a word up touches the network on no keystroke (RL-14). The app has two server surfaces and
  neither is on that path: the sentence translation (RL-09), and the copy of the reader's record
  (RL-22), which runs on the same Supabase as `apps/orbit`, in a schema of its own, and only once the
  reader opened an account on purpose. With no account, nothing of the reader's leaves the device
  (RNL-09).
- **One route handler is the single exception**, `app/api/translate/route.ts`,
  and it exists for the sentence path alone (RL-09). It is justified by two
  things a client cannot do: keep the translation provider's identity and key
  off the client, and make swapping the provider a one-file change. The word
  path never passes through it.
- **IndexedDB is the durable payload cache.** It is the only store with the
  volume for 8.2 MB and the transaction boundary RL-13 needs to make the install
  whole-or-nothing.
- **A Worker is the query engine.** The dictionary is parsed and searched off
  the main thread, so that RNL-01 and RL-01 hold on the same keystroke.
- **A service worker caches the shell**, and only the shell: everything except
  the payload and the translate route. The payload has its own store and its own
  progress; the route must never answer from a cache.

---

## 4. Stack

| Need | Choice | What it saves |
|---|---|---|
| Framework | **Next 16.3.3** | Routing, the static export of the payload, and the one route handler the sentence path needs. |
| UI | **React 19.2.8** | The version Next 16.3.3 pairs with. |
| Language | **next-intl 4** | The Spanish catalogue RNL-02 requires, with date and number formatting. |
| Validation | **Zod 4** | One schema serves the translate route's input and its types. |
| Components | **Radix Themes 3** | Layout, typography, controls and theming as components with props, one stylesheet, no build step. |
| Icons | **lucide-react** | An icon set, chosen independently of the component library. |
| Types | **TypeScript**, with **@typescript/native-preview** | `tsgo` checks the project in seconds. |
| Lint | **eslint**, with **eslint-config-next** | The rules the framework's own conventions need. |
| Browser verification | **Playwright** | Drives a real browser for the facts no server-side check reaches: the offline open, the install progress, the 360 px viewport and the tap targets. |
| Postgres | **postgres 3 + drizzle-orm 0.45** | The copy of the record over the Supabase orbit already has, with the same client and the same ORM. |
| Migrations | **drizzle-kit 0.31** (dev) | The `reading` schema versioned in the repository, with a migration journal of its own. |
| Auth | **@supabase/ssr 0.12** | The cookie session and the magic link, with the same claim verification orbit uses. |
| TEI parse | **fast-xml-parser** | Streams the source TEI into the payload; the build script's only dependency. |

Playwright and `fast-xml-parser` are development dependencies. `fast-xml-parser`
is build-time only: it runs in the script RNL-04 names and never reaches the
bundle.

### Do not install

| Library | Use instead |
|---|---|
| Any client-side database or ORM | IndexedDB directly: the payload is one store, read-only after install. |
| Tailwind, shadcn/ui | Radix Themes is the system. |
| Zustand / Redux | State is one worker and one hook. |
| `localStorage` for the payload | IndexedDB: 8.2 MB does not fit and would not survive. |
| A wrapper library around IndexedDB | The store is 80 lines. |
| Workbox, or any service-worker framework | The worker is 80 lines, and caching a hashed build output needs no library. |
| Any NLP or stemming package | The inflection module is 200 lines and a table. |
