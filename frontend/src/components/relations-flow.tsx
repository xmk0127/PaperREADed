"use client";

import { useMemo } from "react";
import {
  MarkerType,
  Position,
  type Edge,
  type Node,
} from "@xyflow/react";

import { relationLabel } from "@/lib/presentation";
import type { RelationEntry } from "@/types/proposition";
import { ReadingFlow } from "./reading-flow";

const relationWidth = 216;
const relationHeight = 112;
const relationRowGap = 40;
const padding = 24;

type RelationsFlowProps = {
  relations: RelationEntry[];
  selectedIndex: number;
  onSelect: (index: number) => void;
};

const dependencyRelations = new Set([
  "orientation_dependency",
  "sign_justification",
  "proof_dependency",
]);

export function buildRelationEdges(relations: RelationEntry[]): Edge[] {
  return relations.map((relation, index) => {
    const relationNodeId = `relation-${index}`;
    const isDependency = dependencyRelations.has(relation.relation);

    return {
      id: `${relationNodeId}-edge`,
      source: isDependency ? relationNodeId : "proposition-4.1",
      target: isDependency ? "proposition-4.1" : relationNodeId,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      style: { strokeWidth: 1.4 },
    };
  });
}

export function RelationsFlow({ relations, selectedIndex, onSelect }: RelationsFlowProps) {
  const { nodes, edges, height } = useMemo(() => {
    const dependencies = relations
      .map((relation, index) => ({ relation, index }))
      .filter(({ relation }) => dependencyRelations.has(relation.relation));
    const downstream = relations
      .map((relation, index) => ({ relation, index }))
      .filter(({ relation }) => !dependencyRelations.has(relation.relation));

    const rows = Math.max(1, dependencies.length, downstream.length);
    const graphHeight = padding * 2 + rows * relationHeight + (rows - 1) * relationRowGap;

    const center: Node = {
      id: "proposition-4.1",
      position: { x: 320, y: (graphHeight - relationHeight) / 2 },
      style: { width: 240, height: relationHeight },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: false,
      connectable: false,
      selectable: false,
      className: "relation-flow-center",
      ariaLabel: "命题 4.1",
      data: {
        label: (
          <div className="relation-flow-center__content">
            <span>当前结论</span>
            <strong>命题 4.1</strong>
            <small>公式 (20)</small>
          </div>
        ),
      },
    };

    const relationNodes: Node[] = relations.map((relation, index) => {
      const isDependency = dependencyRelations.has(relation.relation);
      const group = isDependency ? dependencies : downstream;
      const groupIndex = group.findIndex((item) => item.index === index);
      const groupHeight = group.length * relationHeight + (group.length - 1) * relationRowGap;

      return {
        id: `relation-${index}`,
        position: {
          x: isDependency ? padding : 640,
          y: (graphHeight - groupHeight) / 2 + groupIndex * (relationHeight + relationRowGap),
        },
        style: { width: relationWidth, height: relationHeight },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        selected: selectedIndex === index,
        draggable: false,
        connectable: false,
        ariaLabel: `${relation.target}：${relationLabel(relation.relation)}`,
        className: "relation-flow-node",
        data: {
          label: (
            <div className="relation-flow-node__content">
              <span>{relationLabel(relation.relation)}</span>
              <strong>{relation.target}</strong>
              <small>PDF 第 {relation.source_page.pdf.join(", ")} 页</small>
            </div>
          ),
        },
      };
    });

    const relationEdges = buildRelationEdges(relations);

    return { nodes: [center, ...relationNodes], edges: relationEdges, height: graphHeight };
  }, [relations, selectedIndex]);

  return (
    <ReadingFlow
      nodes={nodes}
      edges={edges}
      width={880}
      height={height}
      label="命题关系图"
      className="relations-flow"
      onNodeClick={(_, node) => {
        if (node.id.startsWith("relation-")) {
          onSelect(Number(node.id.replace("relation-", "")));
        }
      }}
    />
  );
}
