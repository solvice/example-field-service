/**
 * Drag-and-Drop Sequence Utilities
 *
 * Pure functions for computing arrival times after a work order is dragged to
 * a new position on the timeline. These handle the "cascade" effect: when you
 * insert a work order into a sequence, all subsequent work orders shift in
 * time because the travel legs change.
 *
 * Key concepts:
 *
 *   Chain arrival: The arrival time at a work order depends on the previous
 *   work order's departure + travel time. If the work order has a hard
 *   appointment window that starts later, the technician waits
 *   (arrival = max(chain, windowStart)).
 *
 *   Cascade: After inserting or removing a work order, ALL subsequent arrivals
 *   on that technician must be recomputed because every travel leg may change.
 *
 *   Insertion slot model: The timeline is divided into slots that tile
 *   0-100% of the visible area. Slot boundaries sit at each work order's
 *   midpoint (arrival + serviceTime/2). Dropping before a work order's
 *   midpoint inserts before it; dropping after inserts after. This means
 *   there are no "gaps" in the drop targets — every pixel of the timeline
 *   maps to a valid insertion index.
 *
 * Framework-agnostic — pure TypeScript, no UI dependencies.
 * The actual drag-and-drop interaction (mouse events, touch events, HTML5
 * DnD API) is left to the consumer's framework.
 */

import type { WorkOrder, Technician } from "@/lib/types";
import type { WorkOrderAssignment, DistanceMatrix } from "./types";
import { lookupLeg } from "./distance-matrix";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An arrival time computed for a specific work order in a sequence. */
export interface SequencedArrival {
  workOrderId: string;
  /** ISO 8601 datetime string, e.g. "2026-03-25T09:30:00Z" */
  arrival: string;
}

/** Result of computing a cascade after a drop operation. */
export interface CascadeResult {
  /** The arrival time for the dropped work order itself. */
  primaryArrival: string;
  /**
   * All recomputed arrivals — includes every work order on the target
   * technician, and every work order on the source technician if it was
   * a cross-technician move.
   */
  allCascadedArrivals: SequencedArrival[];
}

/**
 * Parameters for computeCascadeForDrop.
 */
export interface CascadeForDropParams {
  /** The work order being moved. */
  workOrderId: string;
  /** The technician the work order is being dropped onto. */
  targetTechnicianId: string;
  /** The insertion index within the target technician's work order sequence. */
  insertionIndex: number;
  /** The active date (ISO date string, e.g. "2026-03-25"). */
  activeDate: string;
  /** The cached distance matrix. */
  matrix: DistanceMatrix;
  /** Work order definitions. */
  workOrders: WorkOrder[];
  /** Technician definitions. */
  technicians: Technician[];
  /** Current assignment map (workOrderId -> WorkOrderAssignment). */
  workingAssignments: Map<string, WorkOrderAssignment>;
  /** The technician the work order was on before the move (undefined for initial schedule). */
  sourceTechnicianId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a millisecond timestamp as a UTC ISO string.
 * Example: 1705312200000 -> "2025-01-15T09:30:00Z"
 */
function formatIso(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`
  );
}

/**
 * Get the shift start time for a technician on a given date.
 * Uses the technician's shiftStart field; falls back to 08:00 if missing.
 */
function getShiftStart(
  technicianId: string,
  activeDate: string,
  technicians: Technician[],
): number {
  const tech = technicians.find((t) => t.id === technicianId);
  if (tech?.shiftStart) {
    // If the shiftStart matches the active date, use it directly
    if (tech.shiftStart.startsWith(activeDate)) {
      return new Date(tech.shiftStart).getTime();
    }
    // Otherwise extract the time portion and combine with the active date
    const timePart = tech.shiftStart.slice(11); // "08:00:00+01:00"
    return new Date(`${activeDate}T${timePart}`).getTime();
  }
  return new Date(`${activeDate}T08:00:00`).getTime();
}

/**
 * Get the service duration in seconds for a work order.
 * Prefers the assignment's serviceTime (matches rendered block width),
 * falls back to the work order's estimatedDuration (minutes -> seconds),
 * then a 1-hour default.
 */
function getWorkOrderDuration(
  workOrderId: string,
  workOrders: WorkOrder[],
  assignmentMap: Map<string, WorkOrderAssignment>,
): number {
  // Prefer assignment serviceTime — this is what the UI renders
  const fromAssignment = assignmentMap.get(workOrderId)?.serviceTime;
  if (fromAssignment != null && fromAssignment > 0) return fromAssignment;

  // Fall back to work order definition (estimatedDuration is in minutes)
  const wo = workOrders.find((w) => w.id === workOrderId);
  if (wo?.estimatedDuration != null) return wo.estimatedDuration * 60;

  return 3600;
}

// ---------------------------------------------------------------------------
// Core: Compute chain arrival for a single work order
// ---------------------------------------------------------------------------

/**
 * Compute the arrival time for a single work order in a chain, given the
 * previous stop's departure time and the travel duration from the distance
 * matrix.
 *
 * If the work order has a hard appointment window, the technician waits
 * until the window opens. This prevents arriving "too early" at a customer
 * who specified a service window.
 *
 * Formula:
 *   arrival = max(prevDeparture + travelDuration, windowStart)
 *
 * @param prevDeparture    - Departure time from the previous stop (ms).
 * @param travelDuration   - Travel time in seconds from prev to this work order.
 * @param workOrder        - The work order definition (needs appointmentWindow).
 * @returns Arrival time in milliseconds.
 *
 * @example
 * ```ts
 * // Previous work order departs at 10:00, travel takes 30 min
 * // But this work order has a window starting at 11:00
 * const arrival = computeChainArrival(
 *   Date.parse("2026-03-25T10:00:00Z"),
 *   1800,  // 30 minutes in seconds
 *   { appointmentWindow: { from: "2026-03-25T11:00:00+01:00", to: "..." } },
 * );
 * // arrival = 11:00 (waits for window, not 10:30)
 * ```
 */
export function computeChainArrival(
  prevDeparture: number,
  travelDuration: number,
  workOrder: {
    appointmentWindow?: { from: string; to: string } | null;
  },
): number {
  const travelMs = travelDuration * 1000;
  const earliestByChain = prevDeparture + travelMs;

  // Respect the appointment window — the technician must wait until the
  // window opens, even if they could arrive earlier.
  const windowStart = workOrder.appointmentWindow?.from
    ? new Date(workOrder.appointmentWindow.from).getTime()
    : -Infinity;

  return Math.max(earliestByChain, windowStart);
}

// ---------------------------------------------------------------------------
// Compute sequenced arrivals for an ordered list of work orders
// ---------------------------------------------------------------------------

/**
 * Compute cascaded arrival times for an ordered sequence of work orders on
 * a single technician, starting from the technician's depot.
 *
 * The function "walks" the chain:
 *   depot_start -> wo[0] -> wo[1] -> ... -> wo[N-1]
 *
 * At each step, it looks up the travel time from the distance matrix,
 * computes the arrival (respecting appointment windows), then advances the
 * cursor by the work order's service duration to get the departure time.
 *
 * @param orderedWorkOrderIds - Work order IDs in visit order (first to last).
 * @param technicianId        - The technician performing these work orders.
 * @param activeDate          - The active date (ISO date, e.g. "2026-03-25").
 * @param matrix              - The cached distance matrix.
 * @param workOrders          - Work order definitions.
 * @param technicians         - Technician definitions.
 * @param assignments         - Current assignment map for service time lookup.
 * @returns Array of { workOrderId, arrival } in visit order.
 *
 * @example
 * ```ts
 * const arrivals = computeSequencedArrivals(
 *   ["WO-001", "WO-002", "WO-003"],
 *   "TECH-001",
 *   "2026-03-25",
 *   matrix,
 *   workOrders,
 *   technicians,
 *   assignments,
 * );
 * // [
 * //   { workOrderId: "WO-001", arrival: "2026-03-25T08:30:00Z" },
 * //   { workOrderId: "WO-002", arrival: "2026-03-25T10:15:00Z" },
 * //   { workOrderId: "WO-003", arrival: "2026-03-25T11:45:00Z" },
 * // ]
 * ```
 */
export function computeSequencedArrivals(
  orderedWorkOrderIds: string[],
  technicianId: string,
  activeDate: string,
  matrix: DistanceMatrix,
  workOrders: WorkOrder[],
  technicians: Technician[],
  assignments: Map<string, WorkOrderAssignment>,
): SequencedArrival[] {
  // Start the time cursor at the technician's shift start
  let cursor = getShiftStart(technicianId, activeDate, technicians);
  const result: SequencedArrival[] = [];

  for (let i = 0; i < orderedWorkOrderIds.length; i++) {
    const woId = orderedWorkOrderIds[i];

    // Origin key: depot for first work order, previous work order for subsequent
    const fromKey =
      i === 0
        ? `technician:${technicianId}:start`
        : orderedWorkOrderIds[i - 1];

    // Look up travel time from the distance matrix
    const leg = lookupLeg(matrix, fromKey, woId);
    const travelDuration = leg?.duration ?? 0;

    // Find the work order definition for appointment window checking
    const wo = workOrders.find((w) => w.id === woId);

    // Compute arrival, respecting appointment windows
    const arrivalMs = computeChainArrival(
      cursor,
      travelDuration,
      wo ?? {},
    );

    result.push({ workOrderId: woId, arrival: formatIso(arrivalMs) });

    // Advance cursor: arrival + service duration = departure
    const serviceSec = getWorkOrderDuration(woId, workOrders, assignments);
    cursor = arrivalMs + serviceSec * 1000;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Determine insertion index from a drop position
// ---------------------------------------------------------------------------

/**
 * Determine where to insert a work order among existing assignments based
 * on where the user dropped it on the timeline.
 *
 * The insertion slot model:
 * ```
 *   |  slot 0  |  slot 1  |  slot 2  |  slot 3  |
 *   |          |          |          |          |
 *   0    M1    M2   M3    M4   M5    M6        100%
 *        ^          ^          ^
 *       wo1        wo2        wo3
 * ```
 *
 * Slot boundaries sit at each work order's midpoint (arrival + serviceTime/2).
 * If the drop time is before wo1's midpoint, insert at index 0 (before wo1).
 * If between wo1 and wo2 midpoints, insert at index 1. And so on.
 *
 * This means every position on the timeline maps to a valid slot — there
 * are no "dead zones" where a drop would be ignored.
 *
 * @param dropTimeMs          - The timestamp (ms) where the user dropped.
 * @param existingAssignments - The technician's current assignments, sorted
 *                              by arrival time.
 * @returns The zero-based insertion index.
 *
 * @example
 * ```ts
 * // WO-001 runs 09:00-10:00, WO-002 runs 10:30-11:30
 * // Drop at 09:45 -> midpoint of WO-001 is 09:30, so drop is after it
 * // -> midpoint of WO-002 is 11:00, so drop is before it -> index 1
 * const index = determineInsertionIndex(
 *   Date.parse("2026-03-25T09:45:00Z"),
 *   sortedAssignments,
 * );
 * // index = 1 (between wo1 and wo2)
 * ```
 */
export function determineInsertionIndex(
  dropTimeMs: number,
  existingAssignments: WorkOrderAssignment[],
): number {
  for (let i = 0; i < existingAssignments.length; i++) {
    const a = existingAssignments[i];
    const arrivalMs = new Date(a.arrival).getTime();
    // Midpoint = arrival + half of service time
    const midpointMs = arrivalMs + (a.serviceTime * 1000) / 2;

    // If the drop is before this work order's midpoint, insert before it
    if (dropTimeMs < midpointMs) return i;
  }

  // Drop is after all work orders — append at the end
  return existingAssignments.length;
}

// ---------------------------------------------------------------------------
// Cascade computation for a drop (move or schedule)
// ---------------------------------------------------------------------------

/**
 * Compute all cascaded arrival times after dropping a work order onto a
 * technician at a specific insertion index.
 *
 * This is the main function you call when a drop completes:
 *
 * 1. Build the new work order sequence for the target technician (splice the
 *    dropped work order at the insertion index).
 * 2. Resequence all work orders on the target technician using the distance
 *    matrix.
 * 3. If this was a cross-technician move, also resequence the source
 *    technician (the remaining work orders close the gap left by the moved
 *    work order).
 *
 * @param params - See CascadeForDropParams.
 * @returns The primary arrival (for the dropped work order) and all cascaded arrivals.
 *
 * @example
 * ```ts
 * // User drags "WO-005" from TECH-001 to TECH-002 at position 2
 * const result = computeCascadeForDrop({
 *   workOrderId: "WO-005",
 *   targetTechnicianId: "TECH-002",
 *   insertionIndex: 2,
 *   activeDate: "2026-03-25",
 *   matrix,
 *   workOrders,
 *   technicians,
 *   workingAssignments: assignments,
 *   sourceTechnicianId: "TECH-001",
 * });
 *
 * // Apply all cascaded arrivals to state
 * for (const { workOrderId, arrival } of result.allCascadedArrivals) {
 *   assignments.get(workOrderId)!.arrival = arrival;
 * }
 * ```
 */
export function computeCascadeForDrop(
  params: CascadeForDropParams,
): CascadeResult {
  const {
    workOrderId,
    targetTechnicianId,
    insertionIndex,
    activeDate,
    matrix,
    workOrders,
    technicians,
    workingAssignments,
    sourceTechnicianId,
  } = params;

  // --- Build the new work order sequence for the target technician ---
  // Get existing work orders on target (excluding the moved work order,
  // in case of same-technician reorder)
  const targetWorkOrders = Array.from(workingAssignments.values())
    .filter(
      (a) =>
        a.technicianId === targetTechnicianId &&
        a.arrival.startsWith(activeDate) &&
        a.workOrderId !== workOrderId,
    )
    .sort(
      (a, b) => new Date(a.arrival).getTime() - new Date(b.arrival).getTime(),
    );

  // Splice the dropped work order at the insertion index
  const targetOrder = targetWorkOrders.map((a) => a.workOrderId);
  targetOrder.splice(insertionIndex, 0, workOrderId);

  // --- Resequence the target technician ---
  const targetArrivals = computeSequencedArrivals(
    targetOrder,
    targetTechnicianId,
    activeDate,
    matrix,
    workOrders,
    technicians,
    workingAssignments,
  );

  // Extract the primary arrival for the dropped work order
  const primaryEntry = targetArrivals.find((a) => a.workOrderId === workOrderId);
  const primaryArrival = primaryEntry?.arrival ?? formatIso(Date.now());

  let allCascaded = [...targetArrivals];

  // --- Resequence the source technician (cross-technician move) ---
  // When a work order moves from technician A to technician B, technician A
  // has a gap that needs closing. The remaining work orders' arrivals shift
  // because the travel leg that used to go through the removed work order
  // is now skipped.
  if (sourceTechnicianId && sourceTechnicianId !== targetTechnicianId) {
    const sourceWorkOrders = Array.from(workingAssignments.values())
      .filter(
        (a) =>
          a.technicianId === sourceTechnicianId &&
          a.arrival.startsWith(activeDate) &&
          a.workOrderId !== workOrderId,
      )
      .sort(
        (a, b) => new Date(a.arrival).getTime() - new Date(b.arrival).getTime(),
      );

    if (sourceWorkOrders.length > 0) {
      const sourceOrder = sourceWorkOrders.map((a) => a.workOrderId);
      const sourceArrivals = computeSequencedArrivals(
        sourceOrder,
        sourceTechnicianId,
        activeDate,
        matrix,
        workOrders,
        technicians,
        workingAssignments,
      );
      allCascaded = [...allCascaded, ...sourceArrivals];
    }
  }

  return { primaryArrival, allCascadedArrivals: allCascaded };
}

// ---------------------------------------------------------------------------
// Cascade for Unschedule
// ---------------------------------------------------------------------------

/**
 * Compute cascaded arrivals after removing a work order from a technician.
 *
 * When a work order is dragged to the unplanned queue (unscheduled), the
 * remaining work orders on that technician need resequencing because the
 * travel legs change.
 *
 * @param removedId      - The work order being unscheduled.
 * @param technicianId   - The technician the work order is being removed from.
 * @param activeDate     - Current schedule date.
 * @param matrix         - Cached distance matrix for travel time lookups.
 * @param workingAssignments - Current assignment map.
 * @param workOrders     - Work order definitions (for appointment windows, durations).
 * @param technicians    - Technician definitions (for shift start times).
 * @returns Cascaded arrivals for the remaining work orders on the technician.
 *
 * @example
 * ```ts
 * const cascaded = computeCascadeForUnschedule(
 *   "WO-003", "TECH-001", "2026-03-25",
 *   matrix, assignments, workOrders, technicians,
 * );
 * // Apply cascaded arrivals to update the remaining work orders' times
 * for (const { workOrderId, arrival } of cascaded) {
 *   assignments.get(workOrderId)!.arrival = arrival;
 * }
 * ```
 */
export function computeCascadeForUnschedule(
  removedId: string,
  technicianId: string,
  activeDate: string,
  matrix: DistanceMatrix,
  workingAssignments: Map<string, WorkOrderAssignment>,
  workOrders: WorkOrder[],
  technicians: Technician[],
): SequencedArrival[] {
  // Get all assignments for this technician EXCEPT the removed work order, in order
  const remainingWorkOrders = Array.from(workingAssignments.values())
    .filter(
      (a) => a.technicianId === technicianId && a.workOrderId !== removedId,
    )
    .sort(
      (a, b) => new Date(a.arrival).getTime() - new Date(b.arrival).getTime(),
    );

  if (remainingWorkOrders.length === 0) return [];

  const orderedIds = remainingWorkOrders.map((a) => a.workOrderId);
  return computeSequencedArrivals(
    orderedIds,
    technicianId,
    activeDate,
    matrix,
    workOrders,
    technicians,
    workingAssignments,
  );
}
