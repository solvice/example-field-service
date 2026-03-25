"use client";

import { useEffect } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import type { WorkOrder, Technician } from "@/lib/types";
import type { WorkOrderAssignment } from "@/lib/dispatch/types";
import { DispatchProvider, useDispatch } from "./DispatchProvider";
import { useDragAndDrop } from "./hooks/useDragAndDrop";
import { useDistanceMatrix } from "./hooks/useDistanceMatrix";
import { useSchedulerEvaluate } from "./hooks/useSchedulerEvaluate";
import { DispatchMap } from "./DispatchMap";
import { DispatchTimeline } from "./DispatchTimeline";
import { UnplannedQueue } from "./UnplannedQueue";
import { DispatchKpiBar } from "./DispatchKpiBar";

/* ------------------------------------------------------------------ */
/*  Inner component (consumes DispatchProvider context)                 */
/* ------------------------------------------------------------------ */
function DispatchInner({
  initialWorkOrders,
  initialTechnicians,
}: {
  initialWorkOrders: WorkOrder[];
  initialTechnicians: Technician[];
}) {
  const { state, dispatch: dispatchAction } = useDispatch();
  const { workOrders, technicians, assignments } = state;

  /* --- Initialise state --- */
  useEffect(() => {
    dispatchAction({
      type: "INIT",
      workOrders: initialWorkOrders,
      technicians: initialTechnicians,
    });
  }, [dispatchAction, initialWorkOrders, initialTechnicians]);

  /* --- Fetch initial solve on mount --- */
  useEffect(() => {
    if (initialWorkOrders.length === 0) return;
    let cancelled = false;

    async function solve() {
      dispatchAction({ type: "SET_LOADING", isLoading: true });
      try {
        const res = await fetch("/api/dispatch/solve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workOrders: initialWorkOrders,
            technicians: initialTechnicians,
          }),
        });
        if (!res.ok) throw new Error(`Solve failed: ${res.status}`);
        const data = await res.json();

        if (cancelled) return;

        // Convert solve result assignments into Map for INIT
        if (data.assignments) {
          const assignmentMap = new Map<string, WorkOrderAssignment>();
          for (const a of data.assignments as WorkOrderAssignment[]) {
            assignmentMap.set(a.workOrderId, a);
          }
          dispatchAction({
            type: "INIT",
            workOrders: initialWorkOrders,
            technicians: initialTechnicians,
            assignments: assignmentMap,
          });
        }

        // Apply metrics if returned
        if (data.metrics) {
          dispatchAction({
            type: "SET_METRICS",
            metrics: data.metrics,
            source: "confirmed",
          });
        }

        // Apply violations if returned
        if (data.violations) {
          const violationMap = new Map<
            string,
            Array<{
              constraint: string;
              severity: "hard" | "medium" | "soft";
              penalty: number;
              workOrderId?: string;
              technicianId?: string;
              message?: string;
            }>
          >();
          for (const v of data.violations) {
            if (v.workOrderId) {
              const list = violationMap.get(v.workOrderId) ?? [];
              list.push(v);
              violationMap.set(v.workOrderId, list);
            }
          }
          dispatchAction({ type: "SET_VIOLATIONS", violations: violationMap });
        }
      } catch (err) {
        console.error("Dispatch solve error:", err);
      } finally {
        if (!cancelled) {
          dispatchAction({ type: "SET_LOADING", isLoading: false });
        }
      }
    }

    solve();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --- Distance matrix (for local estimates) --- */
  const { matrix } = useDistanceMatrix(workOrders, technicians);

  /* --- Two-tier evaluation --- */
  const { metrics, metricsSource, violations } = useSchedulerEvaluate({
    assignments,
    workOrders,
    technicians,
    matrix,
  });

  // Push evaluate results into state
  useEffect(() => {
    if (metrics) {
      dispatchAction({ type: "SET_METRICS", metrics, source: metricsSource });
    }
  }, [metrics, metricsSource, dispatchAction]);

  useEffect(() => {
    if (violations.size > 0) {
      dispatchAction({ type: "SET_VIOLATIONS", violations });
    }
  }, [violations, dispatchAction]);

  /* --- Drag and drop --- */
  const { sensors, handleDragStart, handleDragEnd } = useDragAndDrop({
    assignments,
    dispatch: dispatchAction,
  });

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col h-full gap-3">
        {/* KPI bar */}
        <DispatchKpiBar />

        {/* Main content: Map (left 40%) | Timeline + Queue (right 60%) */}
        <div className="flex-1 grid grid-cols-[2fr_3fr] gap-3 min-h-0">
          {/* Left: Map */}
          <div className="min-h-[300px]">
            <DispatchMap />
          </div>

          {/* Right: Timeline + Queue stacked */}
          <div className="flex flex-col gap-3 min-h-0">
            <div className="flex-1 min-h-0 overflow-auto">
              <DispatchTimeline />
            </div>
            <div className="h-[260px] min-h-0">
              <UnplannedQueue />
            </div>
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={null} />
    </DndContext>
  );
}

/* ------------------------------------------------------------------ */
/*  Public component                                                   */
/* ------------------------------------------------------------------ */
interface DispatchViewProps {
  workOrders: WorkOrder[];
  technicians: Technician[];
}

export function DispatchView({ workOrders, technicians }: DispatchViewProps) {
  return (
    <DispatchProvider>
      <DispatchInner
        initialWorkOrders={workOrders}
        initialTechnicians={technicians}
      />
    </DispatchProvider>
  );
}
