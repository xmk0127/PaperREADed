"use client";

import { ReactFlow, type Edge, type Node, type NodeMouseHandler, type OnNodesChange } from "@xyflow/react";

const readingViewport = { x: 0, y: 0, zoom: 1 };

type ReadingFlowProps = {
  nodes: Node[];
  edges: Edge[];
  width: number;
  height: number;
  label: string;
  className: string;
  onNodeClick: NodeMouseHandler;
  onNodesChange?: OnNodesChange;
};

/** The diagram occupies its natural size; the document owns scrolling. */
export function ReadingFlow({
  nodes, edges, width, height, label, className, onNodeClick, onNodesChange,
}: ReadingFlowProps) {
  return (
    <div className={`flow-canvas ${className}`} aria-label={label}>
      <div className="reading-flow__stage" style={{ width, height }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodeClick={onNodeClick}
          onNodesChange={onNodesChange}
          viewport={readingViewport}
          minZoom={1}
          maxZoom={1}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          zoomActivationKeyCode={null}
          panActivationKeyCode={null}
          selectionKeyCode={null}
          panOnDrag={false}
          panOnScroll={false}
          preventScrolling={false}
          selectionOnDrag={false}
          autoPanOnNodeFocus={false}
          autoPanOnNodeDrag={false}
          nodesDraggable={false}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
        />
      </div>
    </div>
  );
}
