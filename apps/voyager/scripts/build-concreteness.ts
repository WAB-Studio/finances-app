/**
 * Turns Brysbaert, Warriner & Kuperman's concreteness norms into the closed
 * set RL-36's photo route gates on: every dictionary headword that carries a
 * noun sense (`pos === "n"`) and scores at least `THRESHOLD` for concreteness.
 *
 * Source: `private/concreteness.xlsx`, the supplementary material of
 * "Concreteness ratings for 40 thousand generally known English word
 * lemmas" (Behavior Research Methods, 2014), 39 954 lemmas. `Word` is
 * column 1, `Conc.M` (1–5) column 3. That file states no licence; the user
 * took it knowingly on 2026-09-11 and it is credited in `/cuenta` all the
 * same (`components/account/account-info.tsx`).
 *
 * A noun-only filter was measured and refused: 12 of 12 probed abstract
 * headwords carry a noun sense too (`private/pertinencia-openverse.md`).
 * Concreteness is what actually separates `dog` (4.85) from `grudge`
 * (2.14); the threshold of 3.0 was chosen there, not here.
 *
 * Committed is the derived set alone, never the scores and never the
 * 2.2 MB source file (`private/` is gitignored) — the smallest artefact the
 * route needs to answer "does this headword ever get a photo" with no
 * spreadsheet on disk in production.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import ExcelJS from "exceljs";

import { MANIFEST_PATH, manifestSchema, normaliseHeadword, type DictionaryPayload } from "../lib/dictionary/format";

const APP_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(APP_DIR, "..", "..");
const CONCRETENESS_XLSX = path.join(REPO_ROOT, "private", "concreteness.xlsx");
const OUTPUT_PATH = path.join(APP_DIR, "lib", "word", "concreteness.generated.json");

// Below `dog` (4.85) and `bridge` (4.97), above every abstract headword
// probed (`grudge` 2.14, `irony` 1.59) — see `docs/voyager/SPEC.md`, RL-36.
const THRESHOLD = 3.0;
const WORD_COLUMN = 1;
const CONCRETENESS_COLUMN = 3;

// Concreteness plus `pos === "n"` still lets two classes through: Wiktionary
// grants a noun sense to the corporate "we", and a norm like "hour" rates
// concrete despite naming no object. Decided by the user 2026-09-11, after
// `we` returned an axe head that at 76px in dark mode read as a blank
// square. A closed list, checked against the dictionary's own noun senses
// for this headword — never a POS rule, which was measured and refused
// (`docs/voyager/DESIGN.md`, RL-36: 8.8% of legitimate photos lost, and
// still leaves `we`, `him`, `time`, `hour`, `minute`, `week` and `sale`
// through).
//
// A headword is skipped here only when every noun sense the dictionary
// lists for it is a pronoun or a stretch of time — never on a hunch. A
// dictionary check ruled several look-alikes back IN: `mine` also names an
// excavation, `one` also names the digit, `spring` also names a coil and a
// fountain, `quarter` also names a room, a barracks, a neighbourhood,
// `second` also names a gear, and `march`/`may` in this edition carry no
// month sense at all (a parade; the hawthorn). Excluding any of those would
// cost a real photo to fix none of the ten reported.
const EXCLUDED_HEADWORDS: ReadonlySet<string> = new Set([
  // Personal and possessive pronouns, plus their reflexive forms — every
  // sense the dictionary lists for each is the pronoun, none names a thing.
  "i", "me", "you", "he", "him", "her", "his", "she", "we", "us", "them",
  "yourself", "himself", "herself", "yourselves", "oneself",

  // Units and stretches of time: no dictionary sense for any of these
  // names an object, only a duration or a point in the calendar.
  "time", "hour", "minute", "day", "week", "month", "year", "decade",
  "morning", "evening", "night", "midnight", "dawn", "dusk", "weekend", "yesterday",
  "season", "summer", "autumn", "winter",
  "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",

  // Not pronouns, not time — the one judgement call the fix asks for.
  // `war` (guerra) and `sale` (venta, rebajas) name an event, never a
  // graspable thing, the same imprecision that let `we` through. `spare`
  // stays IN: its only noun sense here is "recambio, refacción, repuesto"
  // — a spare part or tire, a real object — so it is left off this list.
  "war", "sale",
]);

function log(step: string): void {
  console.log(`[concreteness:build] ${step}`);
}

async function loadConcretenessScores(): Promise<Map<string, number>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(CONCRETENESS_XLSX);
  const sheet = workbook.worksheets[0];
  const scores = new Map<string, number>();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header: Word, Bigram, Conc.M, ...
    const word = row.getCell(WORD_COLUMN).value;
    const concreteness = row.getCell(CONCRETENESS_COLUMN).value;
    if (typeof word !== "string" || typeof concreteness !== "number") return;
    scores.set(word.trim().toLowerCase(), concreteness);
  });
  return scores;
}

async function loadDictionaryPayload(): Promise<DictionaryPayload> {
  const manifestFsPath = path.join(APP_DIR, "public", ...MANIFEST_PATH.split("/").filter(Boolean));
  const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestFsPath, "utf8")));
  const assetFsPath = path.join(APP_DIR, "public", ...manifest.asset.path.split("/").filter(Boolean));
  return JSON.parse(await readFile(assetFsPath, "utf8")) as DictionaryPayload;
}

async function main() {
  const [scores, payload] = await Promise.all([loadConcretenessScores(), loadDictionaryPayload()]);
  log(`concreteness rows: ${scores.size}`);
  log(`dictionary entries: ${payload.entries.length}`);

  const nounHeadwords = new Set<string>();
  for (const entry of payload.entries) {
    if (entry[1] === "n") nounHeadwords.add(normaliseHeadword(entry[0]));
  }
  log(`noun headwords: ${nounHeadwords.size}`);

  const scoredNouns = [...nounHeadwords].filter((headword) => scores.has(headword));
  log(`noun headwords with a concreteness score: ${scoredNouns.length}`);

  const concreteEnough = [...nounHeadwords].filter((headword) => (scores.get(headword) ?? 0) >= THRESHOLD);
  log(`passing >= ${THRESHOLD}: ${concreteEnough.length}`);

  const headwords = concreteEnough.filter((headword) => !EXCLUDED_HEADWORDS.has(headword)).sort();
  log(`excluded as pronoun/time/judged: ${concreteEnough.length - headwords.length}`);
  log(`final headwords: ${headwords.length}`);

  const output = {
    source: "Brysbaert, Warriner & Kuperman (2014), Concreteness ratings for 40 thousand generally known English word lemmas",
    threshold: THRESHOLD,
    headwords,
  };
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  log(`wrote ${path.relative(APP_DIR, OUTPUT_PATH)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
