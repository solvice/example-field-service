/**
 * Distance Matrix — Client-Side Travel Metric Estimation
 *
 * Builds and queries a distance matrix for instant travel-time and distance
 * lookups between any pair of locations (work orders and technician depots).
 *
 * How it works:
 * 1. Extract unique coordinates from work orders and technicians.
 * 2. Send them to a matrix API (e.g. Solvice /matrix or OSRM /table) and
 *    receive NxN durations + distances arrays.
 * 3. Build a DistanceMatrix with a coordIndex map for O(1) key-based lookups.
 * 4. Walk each technician's work order sequence (depot -> wo1 -> wo2 -> ... -> depot)
 *    to compute total travel time, distance, and cost.
 *
 * Coordinate key format:
 *   - Work orders:  the work order ID itself, e.g. "WO-001"
 *   - Technicians:  "technician:<id>:start" and "technician:<id>:end"
 *
 * The NxN arrays are indexed positionally — row i, column j gives the
 * duration/distance from coordinate i to coordinate j. The coordIndex map
 * translates string keys to those integer indices.
 *
 * Framework-agnostic — pure TypeScript, no UI dependencies.
 */

import type { WorkOrder, Technician } from "@/lib/types";
import type { WorkOrderAssignment, DistanceMatrix } from "./types";

// Re-export DistanceMatrix so consumers can import from this module directly.
export type { DistanceMatrix };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single coordinate with a lookup key. */
export interface Coordinate {
  /** Unique identifier — work order ID or "technician:<id>:start|end" */
  key: string;
  /** Longitude (x-axis). Note: matrix APIs typically expect [lng, lat]. */
  lng: number;
  /** Latitude (y-axis). */
  lat: number;
}

/**
 * Aggregated travel metrics for a complete schedule.
 * This is the distance-matrix-level estimate; for the full dispatch metrics
 * (including wait time, feasibility, etc.) see `DispatchMetrics` in types.ts.
 */
export interface EstimatedMetrics {
  /** Total travel time across all technicians, in seconds. */
  travelTimeSeconds: number;
  /** Total travel distance across all technicians, in meters. */
  distanceMeters: number;
  /** Estimated cost (e.g. hourly rate * total working hours). */
  cost: number;
}

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

/**
 * Default hourly rate for cost estimation.
 * Override this with the customer's actual technician cost.
 */
const DEFAULT_HOURLY_RATE = 50;

// ---------------------------------------------------------------------------
// Step 1: Extract coordinates from work orders and technicians
// ---------------------------------------------------------------------------

/**
 * Build a deduplicated list of coordinates from all work orders and technicians.
 *
 * Work orders contribute one coordinate each (their service location).
 * Technicians contribute two: a start depot and an end depot (both are the
 * home base — field technicians typically start and end at home).
 *
 * @param workOrders   - Array of work orders.
 * @param technicians  - Array of technicians.
 * @returns Ordered array of unique coordinates.
 *
 * @example
 * ```ts
 * const coords = extractCoordinates(workOrders, technicians);
 * // [
 * //   { key: "WO-001", lng: 4.3528, lat: 50.8466 },
 * //   { key: "technician:TECH-001:start", lng: 4.3792, lat: 50.8676 },
 * //   { key: "technician:TECH-001:end", lng: 4.3792, lat: 50.8676 },
 * //   ...
 * // ]
 * ```
 */
export function extractCoordinates(
  workOrders: WorkOrder[],
  technicians: Technician[],
): Coordinate[] {
  const coords: Coordinate[] = [];
  const seen = new Set<string>();

  // Helper: add a coordinate if it has valid lat/lng and hasn't been seen.
  const add = (key: string, lat: number | undefined, lng: number | undefined) => {
    if (lat == null || lng == null || seen.has(key)) return;
    seen.add(key);
    coords.push({ key, lng, lat });
  };

  // --- Work orders: one coordinate per work order ---
  for (const wo of workOrders) {
    if (!wo.id) continue;
    add(wo.id, wo.latitude, wo.longitude);
  }

  // --- Technicians: start + end depot (both home base) ---
  for (const tech of technicians) {
    if (!tech.id) continue;

    add(
      `technician:${tech.id}:start`,
      tech.homeBase?.latitude,
      tech.homeBase?.longitude,
    );
    add(
      `technician:${tech.id}:end`,
      tech.homeBase?.latitude,
      tech.homeBase?.longitude,
    );
  }

  return coords;
}

// ---------------------------------------------------------------------------
// Step 2: Build the distance matrix from the API response
// ---------------------------------------------------------------------------

/**
 * Combine extracted coordinates with the raw matrix API response to produce
 * a DistanceMatrix with a key-based lookup index.
 *
 * The API response must contain NxN `durations` and `distances` arrays
 * in the same order as the coordinates that were sent.
 *
 * @param coordinates  - The coordinates array (from extractCoordinates).
 * @param apiResponse  - The raw response from the matrix API.
 * @returns A DistanceMatrix ready for lookupLeg() calls.
 *
 * @example
 * ```ts
 * const coords = extractCoordinates(workOrders, technicians);
 * const response = await fetchDistanceMatrix(coords);
 * const matrix = buildDistanceMatrix(coords, response);
 * ```
 */
export function buildDistanceMatrix(
  coordinates: Coordinate[],
  apiResponse: {
    durations: number[][];
    distances: number[][];
  },
): DistanceMatrix {
  // Build the key -> index lookup map.
  // coordinates[0] -> index 0, coordinates[1] -> index 1, etc.
  const coordIndex = new Map<string, number>();
  coordinates.forEach((c, i) => coordIndex.set(c.key, i));

  return {
    durations: apiResponse.durations,
    distances: apiResponse.distances,
    coordIndex,
  };
}

// ---------------------------------------------------------------------------
// Step 3: Look up a single leg (origin -> destination)
// ---------------------------------------------------------------------------

/**
 * Safe lookup of travel duration and distance between two coordinate keys.
 *
 * Returns null if either key is missing from the matrix — this can happen
 * when a work order has no location or a technician depot wasn't included.
 *
 * @param matrix   - The distance matrix.
 * @param fromKey  - Origin coordinate key (e.g. "technician:TECH-001:start").
 * @param toKey    - Destination coordinate key (e.g. "WO-001").
 * @returns `{ duration, distance }` or null if the pair is not in the matrix.
 *
 * @example
 * ```ts
 * const leg = lookupLeg(matrix, "technician:TECH-001:start", "WO-001");
 * if (leg) {
 *   console.log(`Travel: ${leg.duration}s, ${leg.distance}m`);
 * }
 * ```
 */
export function lookupLeg(
  matrix: DistanceMatrix,
  fromKey: string,
  toKey: string,
): { duration: number; distance: number } | null {
  const fromIdx = matrix.coordIndex.get(fromKey);
  const toIdx = matrix.coordIndex.get(toKey);
  if (fromIdx == null || toIdx == null) return null;

  const duration = matrix.durations[fromIdx]?.[toIdx];
  const distance = matrix.distances[fromIdx]?.[toIdx];
  if (duration == null || distance == null) return null;

  return { duration, distance };
}

// ---------------------------------------------------------------------------
// Step 4: Compute estimated metrics for the entire schedule
// ---------------------------------------------------------------------------

/**
 * Walk every technician's work order sequence and sum all travel legs +
 * service times to produce estimated schedule metrics from the cached
 * distance matrix.
 *
 * Route per technician:
 *   depot_start -> wo1 -> wo2 -> ... -> woN -> depot_end
 *
 * The function:
 * 1. Groups assignments by technician.
 * 2. Sorts each group by arrival time.
 * 3. Looks up travel for: depot->first, wo->wo (consecutive), last->depot.
 * 4. Sums service durations from the work order definitions.
 * 5. Computes cost as (travel + service hours) * hourly rate.
 *
 * Performance: O(total_work_orders) — sub-millisecond for typical schedule
 * sizes (50-200 work orders), so it can be called on every assignment change
 * for instant feedback.
 *
 * @param matrix       - The distance matrix (from buildDistanceMatrix).
 * @param assignments  - Current assignment map (workOrderId -> WorkOrderAssignment).
 * @param workOrders   - Work order definitions.
 * @param technicians  - Technician definitions.
 * @returns Aggregated travel metrics for the entire schedule.
 *
 * @example
 * ```ts
 * const metrics = computeEstimatedMetrics(matrix, assignments, workOrders, technicians);
 * // { travelTimeSeconds: 7200, distanceMeters: 85000, cost: 250 }
 * ```
 */
export function computeEstimatedMetrics(
  matrix: DistanceMatrix,
  assignments: Map<string, WorkOrderAssignment>,
  workOrders: WorkOrder[],
  technicians: Technician[],
): EstimatedMetrics {
  // --- Group assignments by technician, sorted by arrival ---
  const byTechnician = new Map<string, WorkOrderAssignment[]>();
  for (const assignment of assignments.values()) {
    const list = byTechnician.get(assignment.technicianId) ?? [];
    list.push(assignment);
    byTechnician.set(assignment.technicianId, list);
  }

  // --- Build a quick lookup for work order service durations ---
  // estimatedDuration is in minutes, convert to seconds for consistency
  const woDurations = new Map<string, number>();
  for (const wo of workOrders) {
    if (wo.id != null && wo.estimatedDuration != null) {
      woDurations.set(wo.id, wo.estimatedDuration * 60);
    }
  }

  let totalTravelTime = 0;
  let totalDistance = 0;
  let totalServiceTime = 0;

  for (const [technicianId, techWorkOrders] of byTechnician) {
    // Sort by arrival time to get the correct sequence
    const sorted = [...techWorkOrders].sort(
      (a, b) => new Date(a.arrival).getTime() - new Date(b.arrival).getTime(),
    );

    const startKey = `technician:${technicianId}:start`;
    const endKey = `technician:${technicianId}:end`;

    // Leg: depot_start -> first work order
    if (sorted.length > 0) {
      const leg = lookupLeg(matrix, startKey, sorted[0].workOrderId);
      if (leg) {
        totalTravelTime += leg.duration;
        totalDistance += leg.distance;
      }
    }

    // Legs: wo[i] -> wo[i+1], plus accumulate service times
    for (let i = 0; i < sorted.length; i++) {
      // Add service time for this work order
      const serviceDuration = woDurations.get(sorted[i].workOrderId) ?? 3600;
      totalServiceTime += serviceDuration;

      // Leg to next work order (if not the last)
      if (i < sorted.length - 1) {
        const leg = lookupLeg(
          matrix,
          sorted[i].workOrderId,
          sorted[i + 1].workOrderId,
        );
        if (leg) {
          totalTravelTime += leg.duration;
          totalDistance += leg.distance;
        }
      }
    }

    // Leg: last work order -> depot_end
    if (sorted.length > 0) {
      const leg = lookupLeg(
        matrix,
        sorted[sorted.length - 1].workOrderId,
        endKey,
      );
      if (leg) {
        totalTravelTime += leg.duration;
        totalDistance += leg.distance;
      }
    }
  }

  // Cost: total working hours * hourly rate
  const totalHours = (totalTravelTime + totalServiceTime) / 3600;
  const cost = totalHours * DEFAULT_HOURLY_RATE;

  return {
    travelTimeSeconds: totalTravelTime,
    distanceMeters: totalDistance,
    cost,
  };
}
