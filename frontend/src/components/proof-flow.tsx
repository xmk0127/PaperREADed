"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkerType, Position, type Edge, type Node, type OnNodesChange } from "@xyflow/react";

import { proofTypeLabel } from "@/lib/presentation";
import type { ProofStep } from "@/types/proposition";

import { MathText } from "./math-text";
import { ProofStepDetail } from "./proof-step-detail";
import { ReadingFlow } from "./reading-flow";

type ProofFlowProps = {
  steps: ProofStep[];
  selectedId: string;
  onSelect: (id: string) => void;
};

export function buildProofEdges(steps: ProofStep[]): Edge[] {
  const stepIds = new Set(steps.map((step) => step.id));
  return steps.flatMap((step) =>
    step.depends_on
      .filter((dependency) => stepIds.has(dependency))
      .map((dependency) => ({
        id: `${dependency}->${step.id}`,
        source: dependency,
        target: step.id,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        style: { strokeWidth: 1.5 },
      })),
  );
}

export function ProofFlow({ steps, selectedId, onSelect }: ProofFlowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<string | null>(null);
  const [width, setWidth] = useState(816);
  const [measurements, setMeasurements] = useState<Record<string, { width: number; height: number }>>({});

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(320, Math.min(880, entry.contentRect.width)));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const selectStep = useCallback((id: string) => {
    pendingScroll.current = id || null;
    onSelect(id);
  }, [onSelect]);

  const updateDimensions: OnNodesChange = useCallback((changes) => {
    const dimensions = changes.filter((change) => change.type === "dimensions");
    if (!dimensions.length) return;
    setMeasurements((previous) => {
      let next = previous;
      for (const change of dimensions) {
        const size = change.dimensions;
        if (!size?.height || !size.width) continue;
        const existing = previous[change.id];
        if (existing && Math.abs(existing.height - size.height) < 1 && Math.abs(existing.width - size.width) < 1) continue;
        if (next === previous) next = { ...previous };
        next[change.id] = size;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const id = pendingScroll.current;
    if (!id || id !== selectedId || (measurements[id]?.height ?? 0) < 300) return;
    const frame = requestAnimationFrame(() => {
      const node = Array.from(containerRef.current?.querySelectorAll<HTMLElement>("[data-id]") ?? [])
        .find((element) => element.dataset.id === id);
      node?.scrollIntoView({ block: "start", behavior: "instant" });
      pendingScroll.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [measurements, selectedId]);

  const { nodes, edges, height } = useMemo(() => {
    const heights = steps.map((step) =>
      measurements[step.id]?.height ?? (step.id === selectedId ? 1200 : 132),
    );
    const flowNodes: Node[] = steps.map((step, index) => {
      const expanded = step.id === selectedId;
      const y = 16 + heights.slice(0, index).reduce((total, item) => total + item + 28, 0);
      const node: Node = {
        id: step.id,
        position: { x: 44, y },
        style: { width: width - 60 },
        measured: measurements[step.id],
        sourcePosition: Position.Left,
        targetPosition: Position.Left,
        selected: expanded,
        draggable: false,
        connectable: false,
        ariaLabel: `证明步骤 ${index + 1}：${proofTypeLabel(step.type)}`,
        className: "proof-flow-node proof-guide-node",
        data: {
          label: (
            <div className="proof-guide-node__content">
              <button
                type="button"
                className="proof-step-toggle nodrag nopan"
                aria-expanded={expanded}
                aria-label={`步骤 ${index + 1}：${step.analysis.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  selectStep(expanded ? "" : step.id);
                }}
              >
                <span className="proof-step-toggle__meta">
                  <span>步骤 {String(index + 1).padStart(2, "0")} · {proofTypeLabel(step.type)}</span>
                  <span>{expanded ? "收起详解 −" : "展开详解 +"}</span>
                </span>
                <strong>{step.analysis.title}</strong>
                <span className="proof-step-summary"><MathText>{step.analysis.summary}</MathText></span>
              </button>
              {expanded && <ProofStepDetail step={step} steps={steps} onSelect={selectStep} />}
            </div>
          ),
        },
      };
      return node;
    });
    const height = 16 + heights.reduce((total, item) => total + item + 28, 0);
    return { nodes: flowNodes, edges: buildProofEdges(steps), height };
  }, [steps, selectedId, width, measurements, selectStep]);

  return (
    <div className="proof-guide-container" ref={containerRef}>
      <ReadingFlow
        nodes={nodes}
        edges={edges}
        width={width}
        height={height}
        label="证明依赖图"
        className="proof-flow proof-guide-flow"
        onNodesChange={updateDimensions}
        onNodeClick={(_, node) => {
          if (node.id !== selectedId) selectStep(node.id);
        }}
      />
    </div>
  );
}
