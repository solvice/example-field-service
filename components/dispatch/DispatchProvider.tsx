"use client";

import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type { WorkOrder, Technician } from "@/lib/types";
import type {
  WorkOrderAssignment,
  ScheduleViolation,
  DispatchMetrics,
  ScheduleChange,
} from "@/lib/dispatch/types";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface DispatchState {
  workOrders: WorkOrder[];
  technicians: Technician[];
  /** workOrderId -> assignment */
  assignments: Map<string, WorkOrderAssignment>;
  /** Work order IDs not assigned to any technician */
  unplannedQueue: string[];
  selectedWorkOrder: string | null;
  /** workOrderId -> violations */
  violations: Map<string, ScheduleViolation[]>;
  metrics: DispatchMetrics | null;
  metricsSource: "estimate" | "confirmed";
  pendingChanges: ScheduleChange[];
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  isLoading: boolean;
}

const initialState: DispatchState = {
  workOrders: [],
  technicians: [],
  assignments: new Map(),
  unplannedQueue: [],
  selectedWorkOrder: null,
  violations: new Map(),
  metrics: null,
  metricsSource: "estimate",
  pendingChanges: [],
  hasUnsavedChanges: false,
  isSaving: false,
  isLoading: true,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type DispatchAction =
  | {
      type: "INIT";
      workOrders: WorkOrder[];
      technicians: Technician[];
      assignments?: Map<string, WorkOrderAssignment>;
    }
  | {
      type: "MOVE_WORK_ORDER";
      workOrderId: string;
      toTechnicianId: string;
      toSequence: number;
    }
  | { type: "UNSCHEDULE_WORK_ORDER"; workOrderId: string }
  | {
      type: "SCHEDULE_WORK_ORDER";
      workOrderId: string;
      technicianId: string;
      sequence: number;
    }
  | { type: "SELECT_WORK_ORDER"; workOrderId: string | null }
  | { type: "SET_VIOLATIONS"; violations: Map<string, ScheduleViolation[]> }
  | {
      type: "SET_METRICS";
      metrics: DispatchMetrics;
      source: "estimate" | "confirmed";
    }
  | { type: "UNDO" }
  | { type: "SET_LOADING"; isLoading: boolean };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let changeCounter = 0;
function nextChangeId(): string {
  return `change-${++changeCounter}-${Date.now()}`;
}

/**
 * Reindex sequence positions (1-based) for all work orders assigned
 * to a technician, preserving their relative order.
 */
function reindexTechnician(
  assignments: Map<string, WorkOrderAssignment>,
  technicianId: string,
): void {
  const entries = [...assignments.entries()]
    .filter(([, a]) => a.technicianId === technicianId)
    .sort(([, a], [, b]) => a.sequence - b.sequence);

  entries.forEach(([woId, assignment], idx) => {
    assignments.set(woId, { ...assignment, sequence: idx + 1 });
  });
}

/** Derive the unplanned queue from work orders and assignments */
function deriveUnplanned(
  workOrders: WorkOrder[],
  assignments: Map<string, WorkOrderAssignment>,
): string[] {
  return workOrders.map((wo) => wo.id).filter((id) => !assignments.has(id));
}

/** Build a default assignment with placeholder arrival */
function makeAssignment(
  workOrderId: string,
  technicianId: string,
  sequence: number,
  workOrders: WorkOrder[],
): WorkOrderAssignment {
  const wo = workOrders.find((w) => w.id === workOrderId);
  return {
    workOrderId,
    technicianId,
    arrival: wo?.appointmentWindow.from ?? new Date().toISOString(),
    serviceTime: (wo?.estimatedDuration ?? 60) * 60,
    sequence,
  };
}

/** Snapshot current assignments as an array (for undo tracking) */
function snapshotAssignments(
  assignments: Map<string, WorkOrderAssignment>,
): WorkOrderAssignment[] {
  return [...assignments.values()];
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function dispatchReducer(
  state: DispatchState,
  action: DispatchAction,
): DispatchState {
  switch (action.type) {
    case "INIT": {
      const assignments = action.assignments ?? new Map();
      return {
        ...state,
        workOrders: action.workOrders,
        technicians: action.technicians,
        assignments,
        unplannedQueue: deriveUnplanned(action.workOrders, assignments),
        isLoading: false,
        hasUnsavedChanges: false,
        pendingChanges: [],
      };
    }

    case "MOVE_WORK_ORDER": {
      const { workOrderId, toTechnicianId, toSequence } = action;
      const prev = state.assignments.get(workOrderId) ?? null;
      const previousAssignments = snapshotAssignments(state.assignments);
      const next = new Map(state.assignments);

      // Remove from previous position (if any)
      if (prev) {
        next.delete(workOrderId);
        reindexTechnician(next, prev.technicianId);
      }

      // Bump sequences at and after the insertion point
      for (const [id, a] of next) {
        if (
          a.technicianId === toTechnicianId &&
          a.sequence >= toSequence
        ) {
          next.set(id, { ...a, sequence: a.sequence + 1 });
        }
      }

      const newAssignment = makeAssignment(
        workOrderId,
        toTechnicianId,
        toSequence,
        state.workOrders,
      );
      next.set(workOrderId, newAssignment);

      const fromDesc = prev
        ? `from ${prev.technicianId} seq ${prev.sequence}`
        : "from unplanned";

      const change: ScheduleChange = {
        id: nextChangeId(),
        type: "move",
        timestamp: new Date().toISOString(),
        description: `Moved ${workOrderId} ${fromDesc} to ${toTechnicianId} seq ${toSequence}`,
        previousAssignments,
        newAssignments: snapshotAssignments(next),
      };

      return {
        ...state,
        assignments: next,
        unplannedQueue: deriveUnplanned(state.workOrders, next),
        pendingChanges: [...state.pendingChanges, change],
        hasUnsavedChanges: true,
      };
    }

    case "UNSCHEDULE_WORK_ORDER": {
      const { workOrderId } = action;
      const prev = state.assignments.get(workOrderId) ?? null;
      if (!prev) return state; // already unplanned

      const previousAssignments = snapshotAssignments(state.assignments);
      const next = new Map(state.assignments);
      next.delete(workOrderId);
      reindexTechnician(next, prev.technicianId);

      const change: ScheduleChange = {
        id: nextChangeId(),
        type: "unassign",
        timestamp: new Date().toISOString(),
        description: `Unscheduled ${workOrderId} from ${prev.technicianId}`,
        previousAssignments,
        newAssignments: snapshotAssignments(next),
      };

      return {
        ...state,
        assignments: next,
        unplannedQueue: deriveUnplanned(state.workOrders, next),
        pendingChanges: [...state.pendingChanges, change],
        hasUnsavedChanges: true,
      };
    }

    case "SCHEDULE_WORK_ORDER": {
      const { workOrderId, technicianId, sequence } = action;
      const previousAssignments = snapshotAssignments(state.assignments);
      const next = new Map(state.assignments);

      // Bump sequences at and after the insertion point
      for (const [id, a] of next) {
        if (a.technicianId === technicianId && a.sequence >= sequence) {
          next.set(id, { ...a, sequence: a.sequence + 1 });
        }
      }

      const newAssignment = makeAssignment(
        workOrderId,
        technicianId,
        sequence,
        state.workOrders,
      );
      next.set(workOrderId, newAssignment);

      const change: ScheduleChange = {
        id: nextChangeId(),
        type: "assign",
        timestamp: new Date().toISOString(),
        description: `Scheduled ${workOrderId} to ${technicianId} at seq ${sequence}`,
        previousAssignments,
        newAssignments: snapshotAssignments(next),
      };

      return {
        ...state,
        assignments: next,
        unplannedQueue: deriveUnplanned(state.workOrders, next),
        pendingChanges: [...state.pendingChanges, change],
        hasUnsavedChanges: true,
      };
    }

    case "SELECT_WORK_ORDER":
      return { ...state, selectedWorkOrder: action.workOrderId };

    case "SET_VIOLATIONS":
      return { ...state, violations: action.violations };

    case "SET_METRICS":
      return {
        ...state,
        metrics: action.metrics,
        metricsSource: action.source,
      };

    case "UNDO": {
      if (state.pendingChanges.length === 0) return state;

      const changes = [...state.pendingChanges];
      const last = changes.pop()!;

      // Restore assignments from the snapshot before the undone change
      const restored = new Map<string, WorkOrderAssignment>();
      for (const a of last.previousAssignments) {
        restored.set(a.workOrderId, a);
      }

      return {
        ...state,
        assignments: restored,
        unplannedQueue: deriveUnplanned(state.workOrders, restored),
        pendingChanges: changes,
        hasUnsavedChanges: changes.length > 0,
      };
    }

    case "SET_LOADING":
      return { ...state, isLoading: action.isLoading };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context + Provider
// ---------------------------------------------------------------------------

interface DispatchContextValue {
  state: DispatchState;
  dispatch: Dispatch<DispatchAction>;
}

const DispatchContext = createContext<DispatchContextValue | null>(null);

export function DispatchProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(dispatchReducer, initialState);

  return (
    <DispatchContext.Provider value={{ state, dispatch }}>
      {children}
    </DispatchContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDispatch(): DispatchContextValue {
  const ctx = useContext(DispatchContext);
  if (!ctx) {
    throw new Error("useDispatch must be used within a <DispatchProvider>");
  }
  return ctx;
}
