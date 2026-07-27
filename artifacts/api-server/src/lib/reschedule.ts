/**
 * Cascade-Reschedule engine for Takt dependencies.
 *
 * After a takt's dates change (edit or new/deleted dependency) this module
 * walks the dependency graph in topological order and adjusts successor dates.
 *
 * Status rules:
 *   GEPLANT / ABGELEHNT / STORNIERT   → dates updated automatically
 *   VERGEBEN / ALTERNATIV / BESTAETIGT → NOT moved; returned as conflicts.
 *                                        Their ORIGINAL dates are used when
 *                                        computing downstream constraints so
 *                                        the propagation is based on actually-
 *                                        committed dates only.
 */
import { db } from "@workspace/db";
import { takteTable, taktDependenciesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Takt } from "@workspace/db";

// Derive the Drizzle transaction type from db.transaction's callback signature
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type RescheduleResult = {
  moved: Takt[];
  conflicts: { takt: Takt; requiredStart: string; requiredEnd: string }[];
};

const MOVEABLE = new Set(["GEPLANT", "ABGELEHNT", "STORNIERT"]);

/** Add `days` calendar days to an ISO date string (YYYY-MM-DD) */
function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Duration in whole days between two ISO date strings */
function durDays(start: string, end: string): number {
  return Math.round(
    (new Date(end + "T00:00:00Z").getTime() -
      new Date(start + "T00:00:00Z").getTime()) /
      86_400_000,
  );
}

/** Kahn's topological sort — throws "CYCLE_DETECTED" on cycles */
function topoSort(
  ids: string[],
  edges: { from: string; to: string }[],
): string[] {
  const inDeg = new Map<string, number>(ids.map((id) => [id, 0]));
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const { from, to } of edges) {
    adj.get(from)?.push(to);
    inDeg.set(to, (inDeg.get(to) ?? 0) + 1);
  }
  const queue = ids.filter((id) => inDeg.get(id) === 0);
  const out: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    out.push(n);
    for (const nb of adj.get(n) ?? []) {
      const d = (inDeg.get(nb) ?? 1) - 1;
      inDeg.set(nb, d);
      if (d === 0) queue.push(nb);
    }
  }
  if (out.length !== ids.length) throw new Error("CYCLE_DETECTED");
  return out;
}

/**
 * Returns true if adding predecessor→successor would create a cycle in
 * existingEdges. Caller should check this BEFORE inserting.
 */
export function wouldCreateCycle(
  existingEdges: { predecessorId: string; successorId: string }[],
  predecessorId: string,
  successorId: string,
): boolean {
  if (predecessorId === successorId) return true;
  const adj = new Map<string, string[]>();
  for (const e of existingEdges) {
    if (!adj.has(e.predecessorId)) adj.set(e.predecessorId, []);
    adj.get(e.predecessorId)!.push(e.successorId);
  }
  // BFS from successorId: if we reach predecessorId the new edge closes a cycle
  const visited = new Set<string>();
  const q = [successorId];
  while (q.length) {
    const cur = q.shift()!;
    if (cur === predecessorId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const nb of adj.get(cur) ?? []) q.push(nb);
  }
  return false;
}

/**
 * Load all takte + dependencies for projectId, propagate dates in topological
 * order, persist moveable changes inside tx, and return a summary of what
 * moved and what conflicted.
 *
 * Important: non-moveable (blocked) takte keep their ORIGINAL committed dates
 * when computing constraints for their own successors. Downstream propagation
 * is always based on actually-persisted dates so schedules remain consistent.
 */
export async function rescheduleTakte(
  projectId: string,
  tx: DbTx,
): Promise<RescheduleResult> {
  const takte = await tx
    .select()
    .from(takteTable)
    .where(eq(takteTable.projectId, projectId));

  const deps = await tx
    .select()
    .from(taktDependenciesTable)
    .where(eq(taktDependenciesTable.projectId, projectId));

  if (takte.length === 0 || deps.length === 0) return { moved: [], conflicts: [] };

  // Working date maps — initialised from committed (current) dates.
  // These are updated ONLY for moveable takte so downstream nodes always
  // compute their constraints against actually-committed predecessor dates.
  const S = new Map(takte.map((t) => [t.id, t.plannedStart]));
  const E = new Map(takte.map((t) => [t.id, t.plannedEnd]));

  const edges = deps.map((d) => ({ from: d.predecessorId, to: d.successorId }));
  let sorted: string[];
  try {
    sorted = topoSort(takte.map((t) => t.id), edges);
  } catch {
    return { moved: [], conflicts: [] }; // should never happen — cycle guard is in POST
  }

  // For each node in topological order, compute the required dates
  const reqS = new Map<string, string>();
  const reqE = new Map<string, string>();

  for (const id of sorted) {
    const takt = takte.find((t) => t.id === id)!;
    const dur = durDays(takt.plannedStart, takt.plannedEnd);

    let minStart: string | null = null;
    let minEnd: string | null = null;

    for (const dep of deps.filter((d) => d.successorId === id)) {
      // S/E maps always hold the committed (or just-moved) dates of predecessors
      const pS = S.get(dep.predecessorId)!;
      const pE = E.get(dep.predecessorId)!;

      if (dep.type === "EA") {
        const r = addDays(pE, dep.lagDays);
        if (!minStart || r > minStart) minStart = r;
      } else if (dep.type === "AA") {
        const r = addDays(pS, dep.lagDays);
        if (!minStart || r > minStart) minStart = r;
      } else if (dep.type === "EE") {
        const r = addDays(pE, dep.lagDays);
        if (!minEnd || r > minEnd) minEnd = r;
      }
    }

    let ns = S.get(id)!;
    let ne = E.get(id)!;

    if (minStart && minStart > ns) {
      ns = minStart;
      ne = addDays(ns, dur);
    }
    if (minEnd && minEnd > ne) {
      ne = minEnd;
      ns = addDays(ne, -dur);
    }

    reqS.set(id, ns);
    reqE.set(id, ne);

    // Only propagate to S/E if this takt is moveable.
    // Non-moveable takte leave S/E at their committed values so their
    // successors compute against real, persisted dates.
    if (MOVEABLE.has(takt.status)) {
      S.set(id, ns);
      E.set(id, ne);
    }
  }

  const moved: Takt[] = [];
  const conflicts: RescheduleResult["conflicts"] = [];

  for (const takt of takte) {
    const rs = reqS.get(takt.id) ?? takt.plannedStart;
    const re = reqE.get(takt.id) ?? takt.plannedEnd;
    if (rs === takt.plannedStart && re === takt.plannedEnd) continue;

    if (MOVEABLE.has(takt.status)) {
      const [updated] = await tx
        .update(takteTable)
        .set({ plannedStart: rs, plannedEnd: re })
        .where(eq(takteTable.id, takt.id))
        .returning();
      if (updated) moved.push(updated);
    } else {
      conflicts.push({ takt, requiredStart: rs, requiredEnd: re });
    }
  }

  return { moved, conflicts };
}
