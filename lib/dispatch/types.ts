/**
 * Dispatch-specific types for the field service scheduling UI.
 *
 * These types use domain language (WorkOrder, Technician) — NOT the Solvice
 * API terminology (Job, Resource). The mapping between the two lives
 * exclusively in `solvice-client.ts`.
 */

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

/** A work order assigned to a technician with a scheduled arrival time. */
export interface WorkOrderAssignment {
  /** Work order ID (e.g. "WO-001"). */
  workOrderId: string;
  /** Technician ID (e.g. "TECH-001"). */
  technicianId: string;
  /** Planned arrival time (ISO 8601). */
  arrival: string;
  /** On-site service duration in seconds. */
  serviceTime: number;
  /** Position within the technician's route (1-based). */
  sequence: number;
}

// ---------------------------------------------------------------------------
// Change tracking (for undo)
// ---------------------------------------------------------------------------

/** A single modification to the schedule, enabling undo/redo. */
export interface ScheduleChange {
  /** Unique change identifier. */
  id: string;
  /** What kind of change was made. */
  type: "assign" | "unassign" | "move" | "reorder" | "reoptimize";
  /** ISO 8601 timestamp when the change occurred. */
  timestamp: string;
  /** Human-readable description (e.g. "Moved WO-003 to TECH-002"). */
  description: string;
  /** Assignments before the change (for undo). */
  previousAssignments: WorkOrderAssignment[];
  /** Assignments after the change. */
  newAssignments: WorkOrderAssignment[];
}

// ---------------------------------------------------------------------------
// Violations
// ---------------------------------------------------------------------------

/** Severity of a schedule constraint violation. */
export type ViolationSeverity = "hard" | "medium" | "soft";

/** A constraint violation detected during evaluation. */
export interface ScheduleViolation {
  /** Which constraint was violated (e.g. "TIME_WINDOW_CONFLICT"). */
  constraint: string;
  /** Severity — hard violations make the schedule infeasible. */
  severity: ViolationSeverity;
  /** Penalty value — higher means worse. */
  penalty: number;
  /** The work order involved, if applicable. */
  workOrderId?: string;
  /** The technician involved, if applicable. */
  technicianId?: string;
  /** Human-readable explanation. */
  message?: string;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** Aggregate metrics for the current schedule. */
export interface DispatchMetrics {
  /** Total travel time across all technicians, in seconds. */
  travelTimeSeconds: number;
  /** Total travel distance across all technicians, in metres. */
  distanceMeters: number;
  /** Total estimated cost (hourly rate x active time). */
  cost: number;
  /** Total on-site service time in seconds. */
  serviceTimeSeconds: number;
  /** Total idle / waiting time in seconds. */
  waitTimeSeconds: number;
  /** Whether all hard constraints are satisfied. */
  feasible: boolean;
}

// ---------------------------------------------------------------------------
// Distance matrix
// ---------------------------------------------------------------------------

/** Pre-computed NxN distance/duration matrix for a set of coordinates. */
export interface DistanceMatrix {
  /** NxN matrix of travel durations in seconds. */
  durations: number[][];
  /** NxN matrix of travel distances in metres. */
  distances: number[][];
  /** Maps a "lat,lng" string key to its row/column index in the matrices. */
  coordIndex: Map<string, number>;
}

// ---------------------------------------------------------------------------
// Suggestion
// ---------------------------------------------------------------------------

/** A solver-recommended placement for an unassigned work order. */
export interface PlacementSuggestion {
  /** The technician to assign the work order to. */
  technicianId: string;
  /** Suggested arrival time (ISO 8601). */
  arrival: string;
  /** Whether this placement satisfies all hard constraints. */
  feasible: boolean;
  /** Violations introduced by this placement. */
  violations: ScheduleViolation[];
}

// ---------------------------------------------------------------------------
// Solve result
// ---------------------------------------------------------------------------

/** Result of a full schedule solve or reoptimize. */
export interface SolveResult {
  /** The computed assignments. */
  assignments: WorkOrderAssignment[];
  /** Aggregate metrics for the solution. */
  metrics: DispatchMetrics;
  /** Work order IDs that could not be assigned. */
  unplanned: string[];
  /** Constraint violations, if any. */
  violations: ScheduleViolation[];
}

/** Result of an evaluate call. */
export interface EvaluateResult {
  /** Aggregate metrics for the evaluated assignment. */
  metrics: DispatchMetrics;
  /** Constraint violations detected. */
  violations: ScheduleViolation[];
}
