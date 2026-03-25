"use server";

/**
 * Solvice API client for the field service dispatch dashboard.
 *
 * This is the ONLY module that knows about Solvice API types.
 * It translates between domain types (WorkOrder, Technician) and
 * Solvice types (Job, Resource) in both directions.
 *
 * Auth: `Authorization: <apiKey>` header (no Bearer prefix).
 * Routing API: https://routing.solvice.io
 * Solver API:  https://api.solvice.io
 */

import type { WorkOrder, Technician } from "@/lib/types";
import type {
  WorkOrderAssignment,
  DispatchMetrics,
  ScheduleViolation,
  ViolationSeverity,
  PlacementSuggestion,
  SolveResult,
  EvaluateResult,
  DistanceMatrix,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOLVER_BASE = "https://api.solvice.io";
const ROUTING_BASE = "https://routing.solvice.io";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getApiKey(): string {
  const key = process.env.SOLVICE_API_KEY;
  if (!key) {
    throw new Error(
      "SOLVICE_API_KEY is not set. Add it to your .env.local file.",
    );
  }
  return key;
}

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: apiKey,
    "Content-Type": "application/json",
  };
}

async function throwOnError(
  response: Response,
  context: string,
): Promise<never> {
  const body = await response.text().catch(() => "");
  throw new Error(
    `${context}: ${response.status} ${response.statusText}` +
      (body ? ` — ${body}` : ""),
  );
}

// ---------------------------------------------------------------------------
// Mapping helpers: Domain -> Solvice
// ---------------------------------------------------------------------------

/**
 * Map a service type to a tag name for skill matching.
 * The technicians.json uses broad categories like "HVAC", "Plumbing",
 * "Electrical", "Maintenance". We map work order service types to
 * whichever tag they require.
 */
function serviceTypeToTag(serviceType: string): string {
  const mapping: Record<string, string> = {
    "AC Repair": "HVAC",
    "Furnace Install": "HVAC",
    "Maintenance Check": "Maintenance",
    "Electrical Inspection": "Electrical",
    "Plumbing Repair": "Plumbing",
  };
  return mapping[serviceType] ?? serviceType;
}

/** Convert a WorkOrder to a Solvice Job. */
function workOrderToJob(wo: WorkOrder) {
  return {
    name: wo.id,
    location: { latitude: wo.latitude, longitude: wo.longitude },
    duration: wo.estimatedDuration * 60, // minutes -> seconds
    windows: [
      {
        from: wo.appointmentWindow.from,
        to: wo.appointmentWindow.to,
        hard: true,
      },
    ],
    tags: [{ name: serviceTypeToTag(wo.serviceType), hard: true }],
  };
}

/** Convert a Technician to a Solvice Resource. */
function technicianToResource(tech: Technician) {
  return {
    name: tech.id,
    shifts: [
      {
        from: tech.shiftStart,
        to: tech.shiftEnd,
        start: {
          latitude: tech.homeBase.latitude,
          longitude: tech.homeBase.longitude,
        },
        end: {
          latitude: tech.homeBase.latitude,
          longitude: tech.homeBase.longitude,
        },
      },
    ],
    tags: tech.skills,
    hourlyCost: 45, // default hourly rate for cost estimation
  };
}

// ---------------------------------------------------------------------------
// Mapping helpers: Solvice -> Domain
// ---------------------------------------------------------------------------

/**
 * Map a Solvice solution violation to our domain ScheduleViolation.
 * Translates constraint names and severity levels.
 */
function mapViolation(v: {
  name: string | null;
  level: "HARD" | "MEDIUM" | "SOFT" | null;
  value: number | null;
}): ScheduleViolation {
  const severityMap: Record<string, ViolationSeverity> = {
    HARD: "hard",
    MEDIUM: "medium",
    SOFT: "soft",
  };
  return {
    constraint: v.name ?? "UNKNOWN",
    severity: severityMap[v.level ?? "SOFT"] ?? "soft",
    penalty: v.value ?? 0,
  };
}

/**
 * Extract assignments and metrics from a Solvice VRP solution.
 * Walks the trips/visits structure to build flat WorkOrderAssignment[].
 */
function extractSolveResult(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  solution: any,
): SolveResult {
  const assignments: WorkOrderAssignment[] = [];

  for (const trip of solution.trips ?? []) {
    const technicianId: string = trip.resource;
    let sequence = 0;

    for (const visit of trip.visits ?? []) {
      if (!visit.job) continue; // skip depot visits
      sequence++;
      assignments.push({
        workOrderId: visit.job,
        technicianId,
        arrival: visit.arrival,
        serviceTime: visit.serviceTime ?? 0,
        sequence,
      });
    }
  }

  const metrics: DispatchMetrics = {
    travelTimeSeconds: solution.totalTravelTimeInSeconds ?? 0,
    distanceMeters: solution.totalTravelDistanceInMeters ?? 0,
    serviceTimeSeconds: solution.totalServiceTimeInSeconds ?? 0,
    waitTimeSeconds: solution.totalWaitTimeInSeconds ?? 0,
    cost: 0,
    feasible: solution.score?.feasible ?? false,
  };

  // Estimate cost from trip-level work time and default hourly rate
  for (const trip of solution.trips ?? []) {
    const workTimeHours = (trip.workTime ?? 0) / 3600;
    metrics.cost += workTimeHours * 45; // default hourly rate
  }
  metrics.cost = Math.round(metrics.cost * 100) / 100;

  const violations: ScheduleViolation[] = (solution.violations ?? []).map(
    mapViolation,
  );

  const unplanned: string[] = solution.unserved ?? [];

  return { assignments, metrics, unplanned, violations };
}

// ---------------------------------------------------------------------------
// 1. Distance Matrix
// ---------------------------------------------------------------------------

/**
 * Fetch an NxN distance/duration matrix from the Solvice routing API.
 *
 * Coordinates must be `[longitude, latitude]` (GeoJSON order).
 *
 * @param coordinates - Array of [lng, lat] pairs
 * @returns Object with `durations` (seconds) and `distances` (metres) matrices
 */
export async function fetchDistanceMatrix(
  coordinates: [number, number][],
): Promise<{ durations: number[][]; distances: number[][] }> {
  const apiKey = getApiKey();

  if (coordinates.length < 2) {
    throw new Error("At least 2 coordinates are required for a matrix");
  }

  const response = await fetch(`${ROUTING_BASE}/table/sync`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      coordinates,
      vehicleType: "CAR",
      annotations: ["duration", "distance"],
    }),
  });

  if (!response.ok) {
    await throwOnError(response, "Distance matrix request failed");
  }

  const data = await response.json();

  if (!Array.isArray(data.durations) || !Array.isArray(data.distances)) {
    throw new Error(
      "Invalid distance matrix response: expected durations and distances arrays",
    );
  }

  return { durations: data.durations, distances: data.distances };
}

/**
 * Build a DistanceMatrix with coordinate index from work orders and technicians.
 *
 * Collects all unique coordinates (technician home bases + work order locations),
 * fetches the matrix, and returns it with a lookup map.
 *
 * @param workOrders  - All work orders to include
 * @param technicians - All technicians to include (home bases)
 * @returns DistanceMatrix with coordIndex for O(1) lookups
 */
export async function buildDistanceMatrix(
  workOrders: WorkOrder[],
  technicians: Technician[],
): Promise<DistanceMatrix> {
  const coordIndex = new Map<string, number>();
  const coords: [number, number][] = [];

  function addCoord(lat: number, lng: number) {
    const key = `${lat},${lng}`;
    if (!coordIndex.has(key)) {
      coordIndex.set(key, coords.length);
      coords.push([lng, lat]); // Solvice routing API uses [lng, lat]
    }
  }

  for (const tech of technicians) {
    addCoord(tech.homeBase.latitude, tech.homeBase.longitude);
  }
  for (const wo of workOrders) {
    addCoord(wo.latitude, wo.longitude);
  }

  const { durations, distances } = await fetchDistanceMatrix(coords);
  return { durations, distances, coordIndex };
}

// ---------------------------------------------------------------------------
// 2. Solve Schedule
// ---------------------------------------------------------------------------

/**
 * Build a VRP request and solve it to produce an optimised schedule.
 *
 * Maps WorkOrders to Jobs and Technicians to Resources, submits to the
 * async solver, polls for the result, and maps the solution back to
 * domain types.
 *
 * @param workOrders       - Work orders to schedule
 * @param technicians      - Available technicians
 * @param pinnedAssignments - Optional: assignments to lock in place (for reoptimize)
 * @returns Solved assignments, metrics, unplanned work orders, and violations
 */
export async function solveSchedule(
  workOrders: WorkOrder[],
  technicians: Technician[],
  pinnedAssignments?: WorkOrderAssignment[],
): Promise<SolveResult> {
  const apiKey = getApiKey();

  // Build Solvice jobs
  const jobs = workOrders.map((wo) => {
    const job = workOrderToJob(wo);

    // If this work order has a pinned assignment, add warm-start + lock fields
    const pinned = pinnedAssignments?.find(
      (a) => a.workOrderId === wo.id,
    );
    if (pinned) {
      return {
        ...job,
        plannedResource: pinned.technicianId,
        plannedArrival: pinned.arrival,
        initialResource: pinned.technicianId,
        initialArrival: pinned.arrival,
      };
    }

    return job;
  });

  // Build Solvice resources
  const resources = technicians.map(technicianToResource);

  // Calculate solve time based on problem size (cap at 30s)
  const millis = Math.min(30_000, (Math.ceil(jobs.length / 10) + 1) * 1000);

  // Submit async solve
  const solveResponse = await fetch(
    `${SOLVER_BASE}/v2/vrp/solve?millis=${millis}`,
    {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({
        jobs,
        resources,
        options: {
          partialPlanning: true,
          polylines: true,
        },
      }),
    },
  );

  if (!solveResponse.ok) {
    await throwOnError(solveResponse, "VRP solve request failed");
  }

  const jobStatus = await solveResponse.json();
  const jobId: string = jobStatus.id;

  // Poll for solution
  const solution = await pollForSolution(apiKey, jobId);

  return extractSolveResult(solution);
}

/**
 * Poll the Solvice solver until the job reaches a terminal status.
 *
 * @param apiKey     - Solvice API key
 * @param jobId      - Solver job ID from the solve submission
 * @param intervalMs - Poll interval (default 2000ms)
 * @param timeoutMs  - Max wait time (default 120s)
 * @returns The completed VRP solution
 */
async function pollForSolution(
  apiKey: string,
  jobId: string,
  intervalMs = 2_000,
  timeoutMs = 120_000,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const statusRes = await fetch(
      `${SOLVER_BASE}/v2/vrp/jobs/${jobId}/status`,
      { headers: headers(apiKey) },
    );

    if (!statusRes.ok) {
      await throwOnError(statusRes, `Failed to check job ${jobId} status`);
    }

    const status = await statusRes.json();

    if (status.status === "ERROR") {
      const msgs = status.errors?.map(
        (e: { message: string }) => e.message,
      ).join("; ");
      throw new Error(
        `Solver job ${jobId} failed: ${msgs || "unknown error"}`,
      );
    }

    if (status.status === "SOLVED") {
      const solutionRes = await fetch(
        `${SOLVER_BASE}/v2/vrp/jobs/${jobId}/solution`,
        { headers: headers(apiKey) },
      );

      if (!solutionRes.ok) {
        await throwOnError(
          solutionRes,
          `Failed to fetch solution for job ${jobId}`,
        );
      }

      return solutionRes.json();
    }

    // Still QUEUED or SOLVING — wait and retry
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Polling timed out after ${timeoutMs}ms for job ${jobId}. ` +
      `The solver may still be running — check status manually.`,
  );
}

// ---------------------------------------------------------------------------
// 3. Evaluate Schedule
// ---------------------------------------------------------------------------

/**
 * Evaluate an existing set of assignments without re-solving.
 *
 * Maps each assignment to the warm-start fields (initialResource + initialArrival)
 * required by the Solvice evaluate endpoint, then returns metrics and violations.
 *
 * @param workOrders   - All work orders (including unassigned ones)
 * @param technicians  - All available technicians
 * @param assignments  - Current assignments to evaluate
 * @returns Metrics and violations for the given assignments
 */
export async function evaluateSchedule(
  workOrders: WorkOrder[],
  technicians: Technician[],
  assignments: WorkOrderAssignment[],
): Promise<EvaluateResult> {
  const apiKey = getApiKey();

  // Build a lookup for quick assignment access
  const assignmentMap = new Map(
    assignments.map((a) => [a.workOrderId, a]),
  );

  // Build Solvice jobs — only include assigned work orders with warm-start fields
  const jobs = workOrders
    .filter((wo) => assignmentMap.has(wo.id))
    .map((wo) => {
      const assignment = assignmentMap.get(wo.id)!;
      return {
        ...workOrderToJob(wo),
        initialResource: assignment.technicianId,
        initialArrival: assignment.arrival,
      };
    });

  if (jobs.length === 0) {
    return {
      metrics: {
        travelTimeSeconds: 0,
        distanceMeters: 0,
        cost: 0,
        serviceTimeSeconds: 0,
        waitTimeSeconds: 0,
        feasible: true,
      },
      violations: [],
    };
  }

  const resources = technicians.map(technicianToResource);

  const response = await fetch(`${SOLVER_BASE}/v2/vrp/evaluate/sync`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ jobs, resources }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");

    // Surface shift boundary violations with a clear message
    const shiftMatch = errorText.match(
      /Initial resource (.+?) for (.+?) is not available/,
    );
    if (shiftMatch) {
      throw new Error(
        `Shift boundary violation: technician "${shiftMatch[1]}" is not available ` +
          `at the scheduled time for work order "${shiftMatch[2]}". ` +
          `Adjust the arrival time or reassign this work order.`,
      );
    }

    throw new Error(
      `Evaluate request failed: ${response.status} ${response.statusText}` +
        (errorText ? ` — ${errorText}` : ""),
    );
  }

  const solution = await response.json();

  const metrics: DispatchMetrics = {
    travelTimeSeconds: solution.totalTravelTimeInSeconds ?? 0,
    distanceMeters: solution.totalTravelDistanceInMeters ?? 0,
    serviceTimeSeconds: solution.totalServiceTimeInSeconds ?? 0,
    waitTimeSeconds: solution.totalWaitTimeInSeconds ?? 0,
    cost: 0,
    feasible: solution.score?.feasible ?? false,
  };

  // Estimate cost from trip-level work time
  for (const trip of solution.trips ?? []) {
    const workTimeHours = (trip.workTime ?? 0) / 3600;
    metrics.cost += workTimeHours * 45;
  }
  metrics.cost = Math.round(metrics.cost * 100) / 100;

  const violations: ScheduleViolation[] = (solution.violations ?? []).map(
    mapViolation,
  );

  return { metrics, violations };
}

// ---------------------------------------------------------------------------
// 4. Suggest Placement
// ---------------------------------------------------------------------------

/**
 * Get solver-powered placement suggestions for a specific unassigned work order.
 *
 * The existing assignments are warm-started (locked in place), and the target
 * work order is left unassigned so the solver recommends the best positions.
 *
 * @param workOrders        - All work orders
 * @param technicians       - All technicians
 * @param assignments       - Current assignments (will be warm-started)
 * @param targetWorkOrderId - The work order to get suggestions for
 * @param maxSuggestions    - Maximum number of suggestions (default 5, max 10)
 * @returns Array of placement suggestions ranked by quality
 */
export async function suggestPlacement(
  workOrders: WorkOrder[],
  technicians: Technician[],
  assignments: WorkOrderAssignment[],
  targetWorkOrderId: string,
  maxSuggestions = 5,
): Promise<PlacementSuggestion[]> {
  const apiKey = getApiKey();

  const targetWO = workOrders.find((wo) => wo.id === targetWorkOrderId);
  if (!targetWO) {
    throw new Error(`Work order "${targetWorkOrderId}" not found`);
  }

  // Build a lookup for quick assignment access
  const assignmentMap = new Map(
    assignments.map((a) => [a.workOrderId, a]),
  );

  // Build warm-started jobs for all assigned work orders EXCEPT the target
  const warmStartedJobs = workOrders
    .filter((wo) => assignmentMap.has(wo.id) && wo.id !== targetWorkOrderId)
    .map((wo) => {
      const assignment = assignmentMap.get(wo.id)!;
      return {
        ...workOrderToJob(wo),
        initialResource: assignment.technicianId,
        initialArrival: assignment.arrival,
      };
    });

  // Combine warm-started jobs with the target (no warm-start fields)
  const jobs = [
    ...warmStartedJobs,
    workOrderToJob(targetWO),
  ];

  const resources = technicians.map(technicianToResource);

  const clampedMax = Math.max(1, Math.min(Math.floor(maxSuggestions), 10));

  const response = await fetch(`${SOLVER_BASE}/v2/vrp/suggest/sync`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      jobs,
      resources,
      options: {
        maxSuggestions: clampedMax,
        onlyFeasibleSuggestions: false,
      },
    }),
  });

  if (!response.ok) {
    await throwOnError(response, "Suggest request failed");
  }

  const solution = await response.json();

  // Extract suggestions for the target work order
  const suggestions: PlacementSuggestion[] = [];

  for (const suggestion of solution.suggestions ?? []) {
    for (const assignment of suggestion.assignments ?? []) {
      if (assignment.job === targetWorkOrderId) {
        suggestions.push({
          technicianId: assignment.resource,
          arrival: assignment.suggestedArrival ?? assignment.executedAfter,
          feasible: suggestion.score?.feasible ?? false,
          violations: (assignment.violations ?? [])
            .filter(Boolean)
            .map(
              (v: { constraint: string; score: string }) => ({
                constraint: v.constraint,
                severity: "hard" as ViolationSeverity,
                penalty: 0,
                message: v.score,
              }),
            ),
        });
      }
    }
  }

  return suggestions;
}
