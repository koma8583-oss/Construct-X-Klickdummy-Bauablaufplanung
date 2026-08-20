import type { Takt, TaktDependency, TaktDependencyType } from '@workspace/api-client-react';

const DAY_MS = 86_400_000;

export type AlternativeImpactDirection = 'PREDECESSOR' | 'SUCCESSOR';

export interface AlternativeImpact {
  direction: AlternativeImpactDirection;
  dependencyId: string;
  relatedTaktId: string;
  type: TaktDependencyType;
  lagDays: number;
  proposedStart: string;
  proposedEnd: string;
  requiredStart: string;
  requiredEnd: string;
}

export interface AlternativeWindow {
  proposedStart: string;
  proposedEnd: string;
}

function day(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toISOString().slice(0, 10);
}

function addDays(value: string, amount: number): string {
  const date = new Date(`${day(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function dayDiff(start: string, end: string): number {
  return Math.max(1, Math.round(
    (new Date(`${day(end)}T00:00:00Z`).getTime() -
      new Date(`${day(start)}T00:00:00Z`).getTime()) / DAY_MS,
  ));
}

function earlierThan(actual: string, limit: string): boolean {
  return day(actual) > day(limit);
}

function laterThan(actual: string, minimum: string): boolean {
  return day(actual) < day(minimum);
}

/**
 * Compares one proposed window with the existing dependency graph.
 *
 * The traversal propagates only real violations. This means a predecessor or
 * successor with enough existing slack absorbs the alternative and does not
 * create a misleading warning for the rest of the chain.
 */
export function findAlternativeImpacts(
  targetId: string,
  alternative: AlternativeWindow,
  takte: Takt[],
  deps: TaktDependency[],
): AlternativeImpact[] {
  const taktById = new Map(takte.map(takt => [takt.id, takt]));
  if (!taktById.has(targetId)) return [];

  const impacts: AlternativeImpact[] = [];
  const seen = new Set<string>();

  type Visit = { nodeId: string; start: string; end: string };
  const upstream: Visit[] = [{
    nodeId: targetId,
    start: day(alternative.proposedStart),
    end: day(alternative.proposedEnd),
  }];
  const downstream: Visit[] = [...upstream];

  while (upstream.length) {
    const current = upstream.shift()!;
    for (const dep of deps.filter(item => item.successorId === current.nodeId)) {
      const predecessor = taktById.get(dep.predecessorId);
      if (!predecessor) continue;
      const duration = dayDiff(predecessor.plannedStart, predecessor.plannedEnd);
      let requiredStart = predecessor.plannedStart;
      let requiredEnd = predecessor.plannedEnd;

      if (dep.type === 'AA') {
        requiredStart = addDays(current.start, -dep.lagDays);
        requiredEnd = addDays(requiredStart, duration);
      } else {
        requiredEnd = addDays(dep.type === 'EE' ? current.end : current.start, -dep.lagDays);
        requiredStart = addDays(requiredEnd, -duration);
      }

      const violates = dep.type === 'AA'
        ? earlierThan(predecessor.plannedStart, requiredStart)
        : earlierThan(predecessor.plannedEnd, requiredEnd);
      if (!violates) continue;

      const key = `PREDECESSOR:${dep.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        impacts.push({
          direction: 'PREDECESSOR',
          dependencyId: dep.id,
          relatedTaktId: predecessor.id,
          type: dep.type,
          lagDays: dep.lagDays,
          proposedStart: current.start,
          proposedEnd: current.end,
          requiredStart,
          requiredEnd,
        });
      }
      upstream.push({ nodeId: predecessor.id, start: requiredStart, end: requiredEnd });
    }
  }

  while (downstream.length) {
    const current = downstream.shift()!;
    for (const dep of deps.filter(item => item.predecessorId === current.nodeId)) {
      const successor = taktById.get(dep.successorId);
      if (!successor) continue;
      const duration = dayDiff(successor.plannedStart, successor.plannedEnd);
      let requiredStart = successor.plannedStart;
      let requiredEnd = successor.plannedEnd;

      if (dep.type === 'EE') {
        requiredEnd = addDays(current.end, dep.lagDays);
        requiredStart = addDays(requiredEnd, -duration);
      } else {
        requiredStart = addDays(dep.type === 'AA' ? current.start : current.end, dep.lagDays);
        requiredEnd = addDays(requiredStart, duration);
      }

      const violates = dep.type === 'EE'
        ? laterThan(successor.plannedEnd, requiredEnd)
        : laterThan(successor.plannedStart, requiredStart);
      if (!violates) continue;

      const key = `SUCCESSOR:${dep.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        impacts.push({
          direction: 'SUCCESSOR',
          dependencyId: dep.id,
          relatedTaktId: successor.id,
          type: dep.type,
          lagDays: dep.lagDays,
          proposedStart: current.start,
          proposedEnd: current.end,
          requiredStart,
          requiredEnd,
        });
      }
      downstream.push({ nodeId: successor.id, start: requiredStart, end: requiredEnd });
    }
  }

  return impacts;
}