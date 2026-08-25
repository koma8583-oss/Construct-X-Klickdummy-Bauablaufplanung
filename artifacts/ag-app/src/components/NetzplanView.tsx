import React, { useMemo, useState, useCallback, useRef } from 'react';
import type { Takt, TaktDependency, TaktDependencyType, TaktStatus } from '@workspace/api-client-react';
import { format } from 'date-fns';
import type { AlternativeImpact } from '@/lib/alternative-impact';

// ── Constants ─────────────────────────────────────────────────────────────────

const NODE_W = 168;
const NODE_H = 62;
const H_GAP = 96;   // horizontal gap between layers
const V_GAP = 28;   // vertical gap between nodes in same layer
const PADDING = 32; // canvas padding

const STATUS_COLOR: Record<TaktStatus, string> = {
  GEPLANT:    '#64748b',
  VERGEBEN:   '#f59e0b',
  ALTERNATIV: '#3b82f6',
  BESTAETIGT: '#10b981',
  ABGELEHNT:  '#ef4444',
  STORNIERT:  '#94a3b8',
};

const STATUS_LABEL: Record<TaktStatus, string> = {
  GEPLANT:    'Geplant',
  VERGEBEN:   'Vergeben',
  ALTERNATIV: 'Gegenvorschlag',
  BESTAETIGT: 'Bestätigt',
  ABGELEHNT:  'Abgelehnt',
  STORNIERT:  'Storniert',
};

const DEP_TYPE_COLOR: Record<TaktDependencyType, string> = {
  EA: '#10b981',
  AA: '#3b82f6',
  EE: '#f59e0b',
};

const DEP_TYPE_LABEL: Record<TaktDependencyType, string> = {
  EA: 'Ende → Anfang',
  AA: 'Anfang → Anfang',
  EE: 'Ende → Ende',
};

const CRITICAL_COLOR = '#ef4444';
const CRITICAL_NODE_RING = '#ef4444';
const PREDECESSOR_IMPACT_COLOR = '#f97316';
const SUCCESSOR_IMPACT_COLOR = '#e11d48';

// ── Types ─────────────────────────────────────────────────────────────────────

interface NodePos {
  x: number;
  y: number;
  layer: number;
}

interface LayoutResult {
  positions: Map<string, NodePos>;
  svgWidth: number;
  svgHeight: number;
}

interface CriticalPathResult {
  criticalNodes: Set<string>;
  criticalEdges: Set<string>;
}

// ── Layout ────────────────────────────────────────────────────────────────────

function taktDurationDays(t: Takt): number {
  return Math.max(
    1,
    Math.ceil(
      (new Date(t.plannedEnd).getTime() - new Date(t.plannedStart).getTime()) /
        86_400_000,
    ),
  );
}

function computeLayout(takte: Takt[], deps: TaktDependency[]): LayoutResult {
  if (takte.length === 0) {
    return { positions: new Map(), svgWidth: 0, svgHeight: 0 };
  }

  const ids = new Set(takte.map(t => t.id));
  // Only consider deps between known takte
  const validDeps = deps.filter(d => ids.has(d.predecessorId) && ids.has(d.successorId));

  const successors = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();
  for (const t of takte) {
    successors.set(t.id, []);
    predecessors.set(t.id, []);
  }
  for (const dep of validDeps) {
    successors.get(dep.predecessorId)?.push(dep.successorId);
    predecessors.get(dep.successorId)?.push(dep.predecessorId);
  }

  // Kahn's topological sort
  const inDegree = new Map<string, number>();
  for (const t of takte) inDegree.set(t.id, predecessors.get(t.id)!.length);
  const queue = takte.filter(t => inDegree.get(t.id) === 0).map(t => t.id);
  const topo: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    topo.push(id);
    for (const succ of successors.get(id) ?? []) {
      const d = (inDegree.get(succ) ?? 1) - 1;
      inDegree.set(succ, d);
      if (d === 0) queue.push(succ);
    }
  }
  // Any nodes not reached (cycle) — append at end
  for (const t of takte) {
    if (!topo.includes(t.id)) topo.push(t.id);
  }

  // Assign layer = longest path from any source (longest predecessor chain)
  const layer = new Map<string, number>();
  for (const id of topo) {
    const preds = predecessors.get(id) ?? [];
    const maxPredLayer = preds.length === 0 ? -1 : Math.max(...preds.map(p => layer.get(p) ?? 0));
    layer.set(id, maxPredLayer + 1);
  }

  const maxLayer = Math.max(...layer.values(), 0);

  // Group nodes by layer; sort within layer by topological index for stable ordering
  const layerGroups = new Map<number, string[]>();
  for (let l = 0; l <= maxLayer; l++) layerGroups.set(l, []);
  for (const id of topo) {
    const l = layer.get(id) ?? 0;
    layerGroups.get(l)!.push(id);
  }

  // Compute positions
  const maxNodesInLayer = Math.max(...[...layerGroups.values()].map(v => v.length), 1);
  const totalContentHeight = maxNodesInLayer * NODE_H + (maxNodesInLayer - 1) * V_GAP;

  const positions = new Map<string, NodePos>();
  for (let l = 0; l <= maxLayer; l++) {
    const nodes = layerGroups.get(l)!;
    const colHeight = nodes.length * NODE_H + (nodes.length - 1) * V_GAP;
    const offsetY = (totalContentHeight - colHeight) / 2;
    nodes.forEach((id, i) => {
      positions.set(id, {
        x: PADDING + l * (NODE_W + H_GAP),
        y: PADDING + offsetY + i * (NODE_H + V_GAP),
        layer: l,
      });
    });
  }

  const svgWidth = PADDING * 2 + (maxLayer + 1) * (NODE_W + H_GAP) - H_GAP;
  const svgHeight = PADDING * 2 + totalContentHeight;

  return { positions, svgWidth, svgHeight };
}

// ── Critical Path ─────────────────────────────────────────────────────────────

function computeCriticalPath(
  takte: Takt[],
  deps: TaktDependency[],
): CriticalPathResult {
  if (takte.length === 0) return { criticalNodes: new Set(), criticalEdges: new Set() };

  const ids = new Set(takte.map(t => t.id));
  const validDeps = deps.filter(d => ids.has(d.predecessorId) && ids.has(d.successorId));

  const predecessors = new Map<string, Array<{ id: string; lagDays: number; depId: string }>>();
  const successors = new Map<string, string[]>();
  for (const t of takte) {
    predecessors.set(t.id, []);
    successors.set(t.id, []);
  }
  for (const dep of validDeps) {
    predecessors.get(dep.successorId)!.push({ id: dep.predecessorId, lagDays: dep.lagDays, depId: dep.id });
    successors.get(dep.predecessorId)!.push(dep.successorId);
  }

  const inDegree = new Map<string, number>();
  for (const t of takte) inDegree.set(t.id, predecessors.get(t.id)!.length);
  const queue = takte.filter(t => inDegree.get(t.id) === 0).map(t => t.id);
  const topo: string[] = [];
  const q = [...queue];
  while (q.length > 0) {
    const id = q.shift()!;
    topo.push(id);
    for (const succ of successors.get(id) ?? []) {
      const d = (inDegree.get(succ) ?? 1) - 1;
      inDegree.set(succ, d);
      if (d === 0) q.push(succ);
    }
  }
  for (const t of takte) {
    if (!topo.includes(t.id)) topo.push(t.id);
  }

  const taktById = new Map(takte.map(t => [t.id, t]));

  // DP: longest path ending at each node (weighted by duration in days)
  const dp = new Map<string, { dist: number; prev: string | null; depId: string | null }>();
  for (const id of topo) {
    const dur = taktDurationDays(taktById.get(id)!);
    const preds = predecessors.get(id)!;
    if (preds.length === 0) {
      dp.set(id, { dist: dur, prev: null, depId: null });
    } else {
      let best = { dist: -1, prev: null as string | null, depId: null as string | null };
      for (const { id: predId, lagDays, depId } of preds) {
        const predDp = dp.get(predId);
        if (!predDp) continue;
        const total = predDp.dist + lagDays + dur;
        if (total > best.dist) {
          best = { dist: total, prev: predId, depId };
        }
      }
      if (best.dist < 0) {
        dp.set(id, { dist: dur, prev: null, depId: null });
      } else {
        dp.set(id, best);
      }
    }
  }

  // Find node with max dp value
  let maxDist = -1;
  let endNode: string | null = null;
  for (const [id, { dist }] of dp) {
    if (dist > maxDist) { maxDist = dist; endNode = id; }
  }

  const criticalNodes = new Set<string>();
  const criticalEdges = new Set<string>();
  let cur: string | null = endNode;
  while (cur) {
    criticalNodes.add(cur);
    const entry = dp.get(cur);
    if (entry?.depId) criticalEdges.add(entry.depId);
    cur = entry?.prev ?? null;
  }

  return { criticalNodes, criticalEdges };
}

// ── Edge path ─────────────────────────────────────────────────────────────────

function edgePath(
  src: NodePos,
  dst: NodePos,
  depType: TaktDependencyType,
): string {
  // Source and destination anchor points depend on dep type
  // EA: src right-middle → dst left-middle
  // AA: src left-middle  → dst left-middle
  // EE: src right-middle → dst right-middle
  let x1: number, y1: number, x2: number, y2: number;
  let cp1x: number, cp2x: number;

  const srcRight  = src.x + NODE_W;
  const srcLeft   = src.x;
  const srcMidY   = src.y + NODE_H / 2;
  const dstLeft   = dst.x;
  const dstRight  = dst.x + NODE_W;
  const dstMidY   = dst.y + NODE_H / 2;

  if (depType === 'AA') {
    x1 = srcLeft;  y1 = srcMidY;
    x2 = dstLeft;  y2 = dstMidY;
    const bend = -60;
    cp1x = x1 + bend; cp2x = x2 + bend;
    return `M ${x1} ${y1} C ${cp1x} ${y1} ${cp2x} ${y2} ${x2} ${y2}`;
  } else if (depType === 'EE') {
    x1 = srcRight;  y1 = srcMidY;
    x2 = dstRight;  y2 = dstMidY;
    const bend = 60;
    cp1x = x1 + bend; cp2x = x2 + bend;
    return `M ${x1} ${y1} C ${cp1x} ${y1} ${cp2x} ${y2} ${x2} ${y2}`;
  } else {
    // EA (default)
    x1 = srcRight; y1 = srcMidY;
    x2 = dstLeft;  y2 = dstMidY;
    const bendX = (x2 - x1) / 2;
    cp1x = x1 + bendX; cp2x = x2 - bendX;
    return `M ${x1} ${y1} C ${cp1x} ${y1} ${cp2x} ${y2} ${x2} ${y2}`;
  }
}

// Mid-point of the bezier for label placement
function edgeMidpoint(
  src: NodePos,
  dst: NodePos,
  depType: TaktDependencyType,
): { x: number; y: number } {
  const srcMidY = src.y + NODE_H / 2;
  const dstMidY = dst.y + NODE_H / 2;

  if (depType === 'AA') {
    return { x: src.x - 30, y: (srcMidY + dstMidY) / 2 };
  } else if (depType === 'EE') {
    return { x: dst.x + NODE_W + 30, y: (srcMidY + dstMidY) / 2 };
  } else {
    return {
      x: (src.x + NODE_W + dst.x) / 2,
      y: (srcMidY + dstMidY) / 2 - 8,
    };
  }
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

interface TooltipState {
  taktId: string;
  x: number;
  y: number;
}

// ── Main Component ────────────────────────────────────────────────────────────

interface NetzplanViewProps {
  takte: Takt[];
  deps: TaktDependency[];
  alternativeImpacts?: AlternativeImpact[];
}

export default function NetzplanView({ takte, deps, alternativeImpacts = [] }: NetzplanViewProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  const { positions, svgWidth, svgHeight } = useMemo(
    () => computeLayout(takte, deps),
    [takte, deps],
  );

  const { criticalNodes, criticalEdges } = useMemo(
    () => computeCriticalPath(takte, deps),
    [takte, deps],
  );

  const taktById = useMemo(() => new Map(takte.map(t => [t.id, t])), [takte]);
  const ids = useMemo(() => new Set(takte.map(t => t.id)), [takte]);
  const validDeps = useMemo(
    () => deps.filter(d => ids.has(d.predecessorId) && ids.has(d.successorId)),
    [deps, ids],
  );
  const impactedTaktIds = useMemo(
    () => new Set(alternativeImpacts.map(impact => impact.relatedTaktId)),
    [alternativeImpacts],
  );
  const impactedDependencyIds = useMemo(
    () => new Set(alternativeImpacts.map(impact => impact.dependencyId)),
    [alternativeImpacts],
  );
  const predecessorImpactIds = useMemo(
    () => new Set(alternativeImpacts.filter(impact => impact.direction === 'PREDECESSOR').map(impact => impact.relatedTaktId)),
    [alternativeImpacts],
  );
  const successorImpactIds = useMemo(
    () => new Set(alternativeImpacts.filter(impact => impact.direction === 'SUCCESSOR').map(impact => impact.relatedTaktId)),
    [alternativeImpacts],
  );

  const hoveredTakt = tooltip ? taktById.get(tooltip.taktId) : null;

  const handleNodeEnter = useCallback(
    (id: string, e: React.MouseEvent<SVGGElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setTooltip({ taktId: id, x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [],
  );

  const handleNodeLeave = useCallback(() => setTooltip(null), []);

  const handleNodeMove = useCallback(
    (id: string, e: React.MouseEvent<SVGGElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setTooltip({ taktId: id, x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [],
  );

  if (takte.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-16">
        <p className="text-sm">Noch keine Leistungen vorhanden.</p>
      </div>
    );
  }

  if (validDeps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-16 space-y-2">
        <p className="text-sm font-medium">Keine Abhängigkeiten definiert.</p>
        <p className="text-xs">Legen Sie Anordnungsbeziehungen im Bearbeiten-Dialog an, um den Netzplan zu sehen.</p>
      </div>
    );
  }

  const scaledW = svgWidth * zoom;
  const scaledH = svgHeight * zoom;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-background/80 shrink-0">
        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          {/* Status legend */}
          {(Object.entries(STATUS_LABEL) as [TaktStatus, string][]).map(([s, label]) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm border" style={{ background: STATUS_COLOR[s] + '33', borderColor: STATUS_COLOR[s] }} />
              {label}
            </span>
          ))}
          <span className="flex items-center gap-1.5 border-l border-border/50 pl-4">
            <span className="inline-block w-2.5 h-2.5 rounded-sm border-2" style={{ borderColor: CRITICAL_COLOR, background: 'transparent' }} />
            Kritischer Pfad
          </span>
          {alternativeImpacts.length > 0 && (
            <>
              <span className="flex items-center gap-1.5 border-l border-border/50 pl-4">
                <span className="inline-block w-2.5 h-2.5 rounded-sm border-2" style={{ borderColor: PREDECESSOR_IMPACT_COLOR, background: PREDECESSOR_IMPACT_COLOR + '22' }} />
                Vorgänger betroffen
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-sm border-2" style={{ borderColor: SUCCESSOR_IMPACT_COLOR, background: SUCCESSOR_IMPACT_COLOR + '22' }} />
                Nachfolger betroffen
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            className="w-7 h-7 rounded border border-border text-xs font-bold hover:bg-muted transition-colors"
            onClick={() => setZoom(z => Math.max(0.4, +(z - 0.15).toFixed(2)))}
          >−</button>
          <span className="text-xs text-muted-foreground w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button
            className="w-7 h-7 rounded border border-border text-xs font-bold hover:bg-muted transition-colors"
            onClick={() => setZoom(z => Math.min(2.0, +(z + 0.15).toFixed(2)))}
          >+</button>
          <button
            className="ml-1 px-2 h-7 rounded border border-border text-xs hover:bg-muted transition-colors"
            onClick={() => setZoom(1)}
          >Reset</button>
        </div>
      </div>

      {/* Diagram */}
      <div ref={containerRef} className="flex-1 overflow-auto relative bg-[hsl(var(--card)/0.5)]">
        <svg
          width={scaledW}
          height={scaledH}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          style={{ display: 'block', minWidth: scaledW, minHeight: scaledH }}
        >
          <defs>
            {/* Arrow markers per dep type + critical */}
            {(['EA', 'AA', 'EE'] as TaktDependencyType[]).map(type => (
              <marker
                key={`arrow-${type}`}
                id={`arrow-${type}`}
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L0,6 L8,3 z" fill={DEP_TYPE_COLOR[type]} />
              </marker>
            ))}
            <marker
              id="arrow-critical"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L0,6 L8,3 z" fill={CRITICAL_COLOR} />
            </marker>
          </defs>

          {/* Edges */}
          {validDeps.map(dep => {
            const srcPos = positions.get(dep.predecessorId);
            const dstPos = positions.get(dep.successorId);
            if (!srcPos || !dstPos) return null;

            const isCritical = criticalEdges.has(dep.id);
            const type = dep.type as TaktDependencyType;
            const isImpact = impactedDependencyIds.has(dep.id);
            const impactColor = alternativeImpacts.find(impact => impact.dependencyId === dep.id)?.direction === 'PREDECESSOR'
              ? PREDECESSOR_IMPACT_COLOR
              : SUCCESSOR_IMPACT_COLOR;
            const color = isCritical ? CRITICAL_COLOR : isImpact ? impactColor : DEP_TYPE_COLOR[type];
            const path = edgePath(srcPos, dstPos, type);
            const mid = edgeMidpoint(srcPos, dstPos, type);
            const label = isCritical
              ? `${dep.type}${dep.lagDays > 0 ? ` +${dep.lagDays}d` : ''}`
              : `${dep.type}${dep.lagDays > 0 ? ` +${dep.lagDays}d` : ''}`;

            return (
              <g key={dep.id}>
                <path
                  d={path}
                  fill="none"
                  stroke={color}
                   strokeWidth={isCritical || isImpact ? 2.5 : 1.5}
                   strokeDasharray={isCritical ? undefined : isImpact ? '7,3' : type === 'AA' ? '5,3' : type === 'EE' ? '2,3' : undefined}
                   opacity={isCritical || isImpact ? 1 : 0.7}
                  markerEnd={`url(#arrow-${isCritical ? 'critical' : type})`}
                />
                {/* Edge label */}
                <rect
                  x={mid.x - 18}
                  y={mid.y - 9}
                  width={dep.lagDays > 0 ? 40 : 22}
                  height={16}
                  rx={4}
                  fill={color + '22'}
                  stroke={color + '66'}
                  strokeWidth={1}
                />
                <text
                  x={mid.x + (dep.lagDays > 0 ? 2 : -7)}
                  y={mid.y + 4}
                  fontSize={9}
                  fontWeight={600}
                  fill={color}
                  textAnchor={dep.lagDays > 0 ? 'middle' : 'start'}
                  fontFamily="inherit"
                >
                  {label}
                </text>
              </g>
            );
          })}

          {/* Nodes */}
          {takte.map(takt => {
            const pos = positions.get(takt.id);
            if (!pos) return null;

            const isCritical = criticalNodes.has(takt.id);
            const isPredecessorImpact = predecessorImpactIds.has(takt.id);
            const isSuccessorImpact = successorImpactIds.has(takt.id);
            const isImpact = isPredecessorImpact || isSuccessorImpact;
            const color = STATUS_COLOR[takt.status as TaktStatus] ?? '#64748b';
            const impactColor = isPredecessorImpact ? PREDECESSOR_IMPACT_COLOR : SUCCESSOR_IMPACT_COLOR;
            const rx = 8;

            return (
              <g
                key={takt.id}
                onMouseEnter={e => handleNodeEnter(takt.id, e)}
                onMouseMove={e => handleNodeMove(takt.id, e)}
                onMouseLeave={handleNodeLeave}
                style={{ cursor: 'default' }}
              >
                {/* Shadow */}
                <rect
                  x={pos.x + 2}
                  y={pos.y + 3}
                  width={NODE_W}
                  height={NODE_H}
                  rx={rx}
                  fill="rgba(0,0,0,0.12)"
                />
                {/* Background */}
                <rect
                  x={pos.x}
                  y={pos.y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={rx}
                  fill={color + '18'}
                  stroke={isCritical ? CRITICAL_NODE_RING : isImpact ? impactColor : color}
                  strokeWidth={isCritical || isImpact ? 2.5 : 1.5}
                />
                {/* Colored header strip */}
                <rect
                  x={pos.x}
                  y={pos.y}
                  width={NODE_W}
                  height={18}
                  rx={rx}
                  fill={color + '40'}
                />
                <rect
                  x={pos.x}
                  y={pos.y + 10}
                  width={NODE_W}
                  height={8}
                  fill={color + '40'}
                />

                {/* Takt designation */}
                <text
                  x={pos.x + 8}
                  y={pos.y + 13}
                  fontSize={10}
                  fontWeight={700}
                  fill={color}
                  fontFamily="inherit"
                >
                  {takt.taktBezeichnung}
                </text>

                {/* Gewerk (main label) */}
                <text
                  x={pos.x + 8}
                  y={pos.y + 32}
                  fontSize={11}
                  fontWeight={600}
                  fill="hsl(var(--foreground))"
                  fontFamily="inherit"
                >
                  {takt.gewerk.length > 18 ? takt.gewerk.slice(0, 17) + '…' : takt.gewerk}
                </text>

                {/* Zone */}
                <text
                  x={pos.x + 8}
                  y={pos.y + 46}
                  fontSize={9}
                  fill="hsl(var(--muted-foreground))"
                  fontFamily="inherit"
                >
                  {takt.zone && takt.zone.length > 20 ? takt.zone.slice(0, 19) + '…' : (takt.zone || 'Keine Zone')}
                </text>

                {/* Duration */}
                <text
                  x={pos.x + NODE_W - 8}
                  y={pos.y + 13}
                  fontSize={9}
                  fill={color}
                  fontFamily="inherit"
                  textAnchor="end"
                >
                  {taktDurationDays(takt)}d
                </text>

                {/* Critical badge */}
                {isCritical && (
                  <rect
                    x={pos.x + NODE_W - 20}
                    y={pos.y + NODE_H - 14}
                    width={14}
                    height={10}
                    rx={3}
                    fill={CRITICAL_COLOR + '30'}
                    stroke={CRITICAL_COLOR + '80'}
                    strokeWidth={1}
                  />
                )}
                {isImpact && (
                  <>
                    <circle
                      cx={pos.x + NODE_W - 28}
                      cy={pos.y + NODE_H - 9}
                      r={5}
                      fill={impactColor + '30'}
                      stroke={impactColor}
                      strokeWidth={1}
                    />
                    <text
                      x={pos.x + NODE_W - 28}
                      y={pos.y + NODE_H - 6}
                      fontSize={8}
                      fontWeight={700}
                      fill={impactColor}
                      textAnchor="middle"
                      fontFamily="inherit"
                    >
                      !
                    </text>
                  </>
                )}
                {isCritical && (
                  <text
                    x={pos.x + NODE_W - 13}
                    y={pos.y + NODE_H - 6}
                    fontSize={8}
                    fontWeight={700}
                    fill={CRITICAL_COLOR}
                    textAnchor="middle"
                    fontFamily="inherit"
                  >
                    !
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Hover Tooltip */}
        {tooltip && hoveredTakt && (() => {
          const color = STATUS_COLOR[hoveredTakt.status as TaktStatus] ?? '#64748b';
          const preds = deps.filter(d => d.successorId === hoveredTakt.id && ids.has(d.predecessorId));
           const succs = deps.filter(d => d.predecessorId === hoveredTakt.id && ids.has(d.successorId));
           const nodeImpacts = alternativeImpacts.filter(impact => impact.relatedTaktId === hoveredTakt.id);
          // Position tooltip: prefer right of cursor, flip if too close to right edge
          const containerW = containerRef.current?.clientWidth ?? 600;
          const tipW = 240;
          const left = tooltip.x + 12 + tipW > containerW ? tooltip.x - tipW - 4 : tooltip.x + 12;

          return (
            <div
              style={{
                position: 'absolute',
                left,
                top: tooltip.y + 8,
                width: tipW,
                background: 'hsl(var(--popover))',
                color: 'hsl(var(--popover-foreground))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 10,
                padding: '10px 12px',
                boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
                pointerEvents: 'none',
                zIndex: 50,
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: color }} />
                <span style={{ fontWeight: 700, fontSize: 13 }}>{hoveredTakt.taktBezeichnung}</span>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 10,
                    fontWeight: 600,
                    background: color + '22',
                    color,
                    padding: '1px 6px',
                    borderRadius: 4,
                    border: `1px solid ${color}44`,
                  }}
                >
                  {STATUS_LABEL[hoveredTakt.status as TaktStatus] ?? hoveredTakt.status}
                </span>
              </div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{hoveredTakt.gewerk}</div>
              <div style={{ color: 'hsl(var(--muted-foreground))', fontSize: 11, marginBottom: 6 }}>
                Zone: {hoveredTakt.zone || 'Keine Zone'}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'hsl(var(--muted-foreground))', marginBottom: 6 }}>
                <span>{format(new Date(hoveredTakt.plannedStart), 'dd.MM.yyyy')}</span>
                <span>→</span>
                <span>{format(new Date(hoveredTakt.plannedEnd), 'dd.MM.yyyy')}</span>
                <span style={{ color, fontWeight: 600 }}>{taktDurationDays(hoveredTakt)} Tage</span>
              </div>
              {criticalNodes.has(hoveredTakt.id) && (
                <div style={{ fontSize: 10, fontWeight: 700, color: CRITICAL_COLOR, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>●</span> Auf kritischem Pfad
                </div>
              )}
              {preds.length > 0 && (
                <div style={{ marginTop: 4, borderTop: '1px solid hsl(var(--border)/0.5)', paddingTop: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Vorgänger</div>
                  {preds.map(d => {
                    const pred = taktById.get(d.predecessorId);
                    return (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, marginBottom: 2 }}>
                        <span style={{
                          background: DEP_TYPE_COLOR[d.type as TaktDependencyType] + '22',
                          color: DEP_TYPE_COLOR[d.type as TaktDependencyType],
                          padding: '0 4px', borderRadius: 3, fontSize: 9, fontWeight: 700,
                          border: `1px solid ${DEP_TYPE_COLOR[d.type as TaktDependencyType]}44`,
                        }}>{d.type}</span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {pred?.taktBezeichnung ?? '?'} · {pred?.gewerk ?? '?'}
                        </span>
                        {d.lagDays > 0 && <span style={{ color: 'hsl(var(--muted-foreground))', fontSize: 10 }}>+{d.lagDays}d</span>}
                      </div>
                    );
                  })}
                </div>
              )}
              {succs.length > 0 && (
                <div style={{ marginTop: 4, borderTop: '1px solid hsl(var(--border)/0.5)', paddingTop: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Nachfolger</div>
                  {succs.map(d => {
                    const succ = taktById.get(d.successorId);
                    return (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, marginBottom: 2 }}>
                        <span style={{
                          background: DEP_TYPE_COLOR[d.type as TaktDependencyType] + '22',
                          color: DEP_TYPE_COLOR[d.type as TaktDependencyType],
                          padding: '0 4px', borderRadius: 3, fontSize: 9, fontWeight: 700,
                          border: `1px solid ${DEP_TYPE_COLOR[d.type as TaktDependencyType]}44`,
                        }}>{d.type}</span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {succ?.taktBezeichnung ?? '?'} · {succ?.gewerk ?? '?'}
                        </span>
                        {d.lagDays > 0 && <span style={{ color: 'hsl(var(--muted-foreground))', fontSize: 10 }}>+{d.lagDays}d</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            {nodeImpacts.length > 0 && (
              <div className="mt-2 border-t border-border/50 pt-2">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600">Alternativtermin-Auswirkung</div>
                {nodeImpacts.map((impact, index) => (
                  <div key={`${impact.dependencyId}-${index}`} className="text-xs text-amber-700">
                    {impact.direction === 'PREDECESSOR' ? 'Vorgänger' : 'Nachfolger'} betroffen · {impact.type} · Puffer +{impact.lagDays}d
                  </div>
                ))}
              </div>
            )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
