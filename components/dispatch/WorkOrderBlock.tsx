"use client";

import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { useDispatch } from "./DispatchProvider";
import { techColor } from "./DispatchMap";
import type { DragData } from "./hooks/useDragAndDrop";

interface WorkOrderBlockProps {
  workOrderId: string;
  technicianId: string;
  customerName: string;
  serviceType: string;
  arrival: string;
  departure: string;
  techIndex: number;
  sequence: number;
  hasViolation: boolean;
}

export function WorkOrderBlock({
  workOrderId,
  technicianId,
  customerName,
  serviceType,
  arrival,
  departure,
  techIndex,
  sequence,
  hasViolation,
}: WorkOrderBlockProps) {
  const { state, dispatch: dispatchAction } = useDispatch();
  const isSelected = state.selectedWorkOrder === workOrderId;

  const dragData: DragData = {
    workOrderId,
    fromTechnicianId: technicianId,
    fromSequence: sequence,
  };

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `wo-${workOrderId}`,
      data: dragData,
    });

  const color = techColor(techIndex);

  const style: React.CSSProperties = {
    borderLeftColor: hasViolation ? "#ef4444" : color,
    ...(transform
      ? {
          transform: `translate(${transform.x}px, ${transform.y}px)`,
          zIndex: 50,
        }
      : {}),
  };

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        dispatchAction({
          type: "SELECT_WORK_ORDER",
          workOrderId: isSelected ? null : workOrderId,
        });
      }}
      className={cn(
        "absolute inset-x-0 top-1 bottom-1 rounded border-l-3 bg-white px-1.5 py-0.5 shadow-sm cursor-grab",
        "hover:shadow-md transition-shadow text-[11px] leading-tight overflow-hidden",
        isDragging && "opacity-50 shadow-lg",
        isSelected && "ring-2 ring-orange-400 ring-offset-1",
        hasViolation && "bg-red-50",
      )}
      style={style}
    >
      <div className="font-medium text-neutral-800 truncate">{customerName}</div>
      <div className="text-neutral-500 truncate">{serviceType}</div>
      <div className="text-neutral-400 font-mono">
        {arrival}&ndash;{departure}
      </div>
    </div>
  );
}
