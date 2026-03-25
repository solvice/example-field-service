"use client";

import { useCallback, useState } from "react";
import type { DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { WorkOrderAssignment } from "@/lib/dispatch/types";
import type { DispatchAction } from "@/components/dispatch/DispatchProvider";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The `data` payload attached to each draggable item.
 * Set this via `useDraggable({ data: { ... } })` in your work order card.
 */
export interface DragData {
  workOrderId: string;
  /** null when dragging from the unplanned queue */
  fromTechnicianId: string | null;
  /** 1-based sequence within the technician's route, or null if unplanned */
  fromSequence: number | null;
}

/**
 * The `data` payload attached to each droppable zone.
 * Set this via `useDroppable({ data: { ... } })` on the technician column
 * or the unplanned queue.
 */
export interface DropData {
  /** null means the unplanned queue */
  technicianId: string | null;
  /** 1-based insertion sequence within the technician's route */
  sequence: number;
}

interface UseDragAndDropOptions {
  assignments: Map<string, WorkOrderAssignment>;
  dispatch: React.Dispatch<DispatchAction>;
}

interface UseDragAndDropResult {
  /** Configured dnd-kit sensors (pointer + keyboard) */
  sensors: ReturnType<typeof useSensors>;
  /** Currently-dragged work order ID, or null */
  activeWorkOrderId: string | null;
  /** Pass to `<DndContext onDragStart={...}>` */
  handleDragStart: (event: DragStartEvent) => void;
  /** Pass to `<DndContext onDragEnd={...}>` */
  handleDragEnd: (event: DragEndEvent) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine the 1-based insertion sequence for a drop onto a technician's
 * route. If the drop zone provides an explicit sequence, use it; otherwise
 * append at the end of the technician's current route.
 */
function getInsertionSequence(
  assignments: Map<string, WorkOrderAssignment>,
  technicianId: string,
  dropData: DropData,
): number {
  if (dropData.sequence !== undefined) return dropData.sequence;

  // Default: append after the last item (1-based)
  let maxSequence = 0;
  for (const a of assignments.values()) {
    if (a.technicianId === technicianId && a.sequence > maxSequence) {
      maxSequence = a.sequence;
    }
  }
  return maxSequence + 1;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Wraps @dnd-kit sensor configuration and drag event handlers for the
 * dispatch view. The actual `<DndContext>` must be rendered by the parent
 * component — this hook only provides the handlers and sensor config.
 *
 * Usage:
 * ```tsx
 * const { sensors, activeWorkOrderId, handleDragStart, handleDragEnd } =
 *   useDragAndDrop({ assignments, dispatch });
 *
 * return (
 *   <DndContext
 *     sensors={sensors}
 *     onDragStart={handleDragStart}
 *     onDragEnd={handleDragEnd}
 *   >
 *     ...
 *   </DndContext>
 * );
 * ```
 */
export function useDragAndDrop({
  assignments,
  dispatch,
}: UseDragAndDropOptions): UseDragAndDropResult {
  const [activeWorkOrderId, setActiveWorkOrderId] = useState<string | null>(
    null,
  );

  // --- Sensors ---
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // --- Drag Start ---
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as DragData | undefined;
    if (data?.workOrderId) {
      setActiveWorkOrderId(data.workOrderId);
    }
  }, []);

  // --- Drag End ---
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveWorkOrderId(null);

      const { active, over } = event;
      if (!over) return; // dropped outside any droppable

      const dragData = active.data.current as DragData | undefined;
      const dropData = over.data.current as DropData | undefined;

      if (!dragData?.workOrderId) return;

      const { workOrderId, fromTechnicianId } = dragData;
      const targetTechId = dropData?.technicianId ?? null;

      // --- Dropped onto the unplanned queue ---
      if (targetTechId === null) {
        if (fromTechnicianId !== null) {
          dispatch({ type: "UNSCHEDULE_WORK_ORDER", workOrderId });
        }
        return;
      }

      // --- Dropped onto a technician column ---
      const sequence = getInsertionSequence(
        assignments,
        targetTechId,
        dropData ?? { technicianId: targetTechId, sequence: 1 },
      );

      if (fromTechnicianId === null) {
        // From unplanned -> schedule
        dispatch({
          type: "SCHEDULE_WORK_ORDER",
          workOrderId,
          technicianId: targetTechId,
          sequence,
        });
      } else {
        // Move between technicians or reorder within same technician
        dispatch({
          type: "MOVE_WORK_ORDER",
          workOrderId,
          toTechnicianId: targetTechId,
          toSequence: sequence,
        });
      }
    },
    [assignments, dispatch],
  );

  return {
    sensors,
    activeWorkOrderId,
    handleDragStart,
    handleDragEnd,
  };
}
