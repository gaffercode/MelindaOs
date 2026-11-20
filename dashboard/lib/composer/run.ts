import { submitDailyDocument } from "../daily/daily-documents";
import { DirectorApiError, rateLimit } from "../director/director-api";
import type { DirectorAuthConfiguration } from "../director/director-auth";
import { DirectorStoreError } from "../director/director-store";
import { logError, logInfo } from "../log";
import type { MedifySnapshot } from "../medify/medify-snapshot-contract";
import { MelindaBriefValidationError, parseMelindaBrief } from "../melinda/melinda-brief-contract";
import { readMelindaBrief } from "../melinda/melinda-brief-store";
import { findPatientIdentifiers } from "../phi-guard";
import { readSatusehatSnapshot } from "../satusehat/satusehat-snapshot-store";
import { forRules, isFinal } from "../tasks/rules";
import { board } from "../tasks/store";
import { composeBrief, STATUS_WITH_ANALYSIS, STATUS_WITHOUT_ANALYSIS } from "./compose";
import { detectFacts } from "./facts";
import { writeNarrative } from "./narrative";

export type ComposeOutcome = "stored" | "stored_without_analysis" | "kept_existing" | "skipped";

const stringsIn = (value: unknown): string[] =>
  typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(stringsIn) : value !== null && typeof value === "object" ? Object.values(value).flatMap(stringsIn) : [];

async function openInstructions(config: DirectorAuthConfiguration, now: Date) {
  try {
    const { instructions } = await board(config, { now: now.toISOString() });
    return instructions.filter((row) => !isFinal(forRules(row))).map((row) => ({ id: row.id, title: row.itemTitle, pic: row.pic }));
  } catch (error) {
    logError("brief_composer_board", error);
    return [];
  }
}

/** The store's window is fixed: it starts at the first call and resets 24 hours later, so this bounds model calls to four per such window. */
async function withinLimit(config: DirectorAuthConfiguration): Promise<boolean> {
  try {
    await rateLimit(config, "brief-composer", 4, 86_400);
    return true;
  } catch (error) {
    if (error instanceof DirectorApiError && error.status === 429) return false;
    throw error;
  }
}

/**
 * Detects the facts, asks the model for the prose, composes the brief and stores it. A model failure or a reached limit ends in
 * "stored_without_analysis", or in "kept_existing" when a brief with analysis is already stored for the date; such a brief is never
 * replaced by one without analysis, and an unreadable store ends in "skipped". A contract, patient-identifier or store-conflict failure
 * is logged by code and ends in "skipped". Every returned outcome writes one `brief_composer_run` line of codes and counts.
 */
export async function composeAndStoreBrief(config: DirectorAuthConfiguration, snapshot: MedifySnapshot, snapshotHash: string, now = new Date()): Promise<ComposeOutcome> {
  const satusehatRead = await readSatusehatSnapshot(snapshot.date, now);
  const facts = detectFacts(snapshot, satusehatRead.snapshot);
  const open = await openInstructions(config, now);
  const called = await withinLimit(config);
  const narrative = called ? await writeNarrative(facts) : null;
  const done = (outcome: ComposeOutcome): ComposeOutcome => {
    logInfo("brief_composer_run", { outcome, facts: facts.length, model: called ? "called" : "rate_limited" });
    return outcome;
  };
  const brief = composeBrief({ snapshot, satusehatSnapshot: satusehatRead.snapshot, facts, narrative, openInstructions: open });
  // Stamped before the store write so the page can say how the brief was produced; kept_existing
  // and skipped never reach the store, so the stamp only ever describes a stored brief.
  brief.composer = {
    outcome: brief.status === STATUS_WITH_ANALYSIS ? "stored" : "stored_without_analysis",
    at: now.toISOString(),
    modelCalled: called,
    facts: facts.length,
    decisions: (narrative?.decisions ?? []).length,
  };
  if (brief.status === STATUS_WITHOUT_ANALYSIS) {
    const existing = await readMelindaBrief(snapshot.date, 0);
    if (existing.status === "invalid") {
      logError("brief_composer_read", null);
      return done("skipped");
    }
    if (existing.status === "current" && existing.brief.status === STATUS_WITH_ANALYSIS) return done("kept_existing");
  }
  try {
    parseMelindaBrief(brief);
  } catch (error) {
    logError("brief_composer_invalid", error);
    // The contract path names a field (for example `brief.decisions.items[0].kode`), never its content.
    if (error instanceof MelindaBriefValidationError) logInfo("brief_composer_invalid_path", { path: error.path });
    return done("skipped");
  }
  if (stringsIn(brief).some((text) => findPatientIdentifiers(text).length > 0)) {
    logError("brief_composer_phi", null);
    return done("skipped");
  }
  try {
    await submitDailyDocument(config, "management_brief", { producerId: "melinda-composer", key: `brief-${snapshotHash.slice(0, 32)}`, date: snapshot.date, payload: brief });
  } catch (error) {
    if (error instanceof DirectorStoreError && error.status === 409) {
      logError("brief_composer_conflict", error);
      return done("skipped");
    }
    throw error;
  }
  return done(brief.status === STATUS_WITH_ANALYSIS ? "stored" : "stored_without_analysis");
}
