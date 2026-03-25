import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import type { WorkOrder, Technician } from "@/lib/types";
import type { WorkOrderAssignment } from "@/lib/dispatch/types";

const SOLVER_BASE = "https://api.solvice.io";

/**
 * Map a service type to the skill tag used for Solvice Job.tags.
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

/**
 * POST /api/dispatch/solve
 *
 * Builds a VRP request from work orders and technicians, submits it to the
 * Solvice async solver, polls for the result, and returns the solution
 * mapped back to domain types.
 *
 * Request body:
 *   { pinnedAssignments?: WorkOrderAssignment[] }
 *   If provided, pinned assignments are locked in place during reoptimize.
 *
 * Response:
 *   { assignments: WorkOrderAssignment[], metrics: DispatchMetrics, unplanned: string[], violations: ScheduleViolation[] }
 */
export async function POST(request: Request) {
  const apiKey = process.env.SOLVICE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "SOLVICE_API_KEY is not configured" },
      { status: 500 },
    );
  }

  let body: { pinnedAssignments?: WorkOrderAssignment[] };
  try {
    body = await request.json();
  } catch {
    // Empty body is OK — means a fresh solve with no pinned assignments
    body = {};
  }

  const { pinnedAssignments } = body;

  try {
    // Read domain data from JSON files
    const dataDir = path.join(process.cwd(), "data");
    const [workOrdersRaw, techniciansRaw] = await Promise.all([
      fs.readFile(path.join(dataDir, "work-orders.json"), "utf-8"),
      fs.readFile(path.join(dataDir, "technicians.json"), "utf-8"),
    ]);
    const workOrders: WorkOrder[] = JSON.parse(workOrdersRaw);
    const technicians: Technician[] = JSON.parse(techniciansRaw);

    // Build pinned assignment lookup
    const pinnedMap = new Map(
      (pinnedAssignments ?? []).map((a) => [a.workOrderId, a]),
    );

    // Build Solvice jobs
    const jobs = workOrders.map((wo) => {
      const baseJob = {
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

      // If this work order is pinned, add constraint + warm-start fields
      const pinned = pinnedMap.get(wo.id);
      if (pinned) {
        return {
          ...baseJob,
          plannedResource: pinned.technicianId,
          plannedArrival: pinned.arrival,
          initialResource: pinned.technicianId,
          initialArrival: pinned.arrival,
        };
      }

      return baseJob;
    });

    // Build Solvice resources
    const resources = technicians.map((tech) => ({
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
      hourlyCost: 45,
    }));

    // Calculate solve time based on problem size (cap at 30s)
    const millis = Math.min(
      30_000,
      (Math.ceil(jobs.length / 10) + 1) * 1000,
    );

    // Submit async solve
    const solveResponse = await fetch(
      `${SOLVER_BASE}/v2/vrp/solve?millis=${millis}`,
      {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jobs,
          resources,
          options: {
            partialPlanning: true,
            polylines: true,
          },
          ...(pinnedAssignments?.length
            ? { label: "Reoptimize" }
            : { label: "Initial solve" }),
        }),
      },
    );

    if (!solveResponse.ok) {
      const errorText = await solveResponse.text().catch(() => "");
      return NextResponse.json(
        {
          error: "VRP solve request failed",
          details: `${solveResponse.status} ${solveResponse.statusText}${errorText ? ` — ${errorText}` : ""}`,
        },
        { status: solveResponse.status },
      );
    }

    const jobStatus = await solveResponse.json();
    const jobId: string = jobStatus.id;

    // Poll for solution
    const solution = await pollForSolution(apiKey, jobId);

    // Extract assignments from trips
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

    // Build metrics
    let cost = 0;
    for (const trip of solution.trips ?? []) {
      const workTimeHours = (trip.workTime ?? 0) / 3600;
      cost += workTimeHours * 45;
    }

    const metrics = {
      travelTimeSeconds: solution.totalTravelTimeInSeconds ?? 0,
      distanceMeters: solution.totalTravelDistanceInMeters ?? 0,
      serviceTimeSeconds: solution.totalServiceTimeInSeconds ?? 0,
      waitTimeSeconds: solution.totalWaitTimeInSeconds ?? 0,
      cost: Math.round(cost * 100) / 100,
      feasible: solution.score?.feasible ?? false,
    };

    // Map violations
    const severityMap: Record<string, string> = {
      HARD: "hard",
      MEDIUM: "medium",
      SOFT: "soft",
    };
    const violations = (solution.violations ?? []).map(
      (v: {
        name: string | null;
        level: string | null;
        value: number | null;
      }) => ({
        constraint: v.name ?? "UNKNOWN",
        severity: severityMap[v.level ?? "SOFT"] ?? "soft",
        penalty: v.value ?? 0,
      }),
    );

    const unplanned: string[] = solution.unserved ?? [];

    return NextResponse.json({
      assignments,
      metrics,
      unplanned,
      violations,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Solve failed", details: message },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Polling helper
// ---------------------------------------------------------------------------

/**
 * Poll the solver until the job reaches a terminal status (SOLVED or ERROR).
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
      {
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
      },
    );

    if (!statusRes.ok) {
      const errorText = await statusRes.text().catch(() => "");
      throw new Error(
        `Failed to check job ${jobId} status: ${statusRes.status}${errorText ? ` — ${errorText}` : ""}`,
      );
    }

    const status = await statusRes.json();

    if (status.status === "ERROR") {
      const msgs = status.errors
        ?.map((e: { message: string }) => e.message)
        .join("; ");
      throw new Error(
        `Solver job ${jobId} failed: ${msgs || "unknown error"}`,
      );
    }

    if (status.status === "SOLVED") {
      const solutionRes = await fetch(
        `${SOLVER_BASE}/v2/vrp/jobs/${jobId}/solution`,
        {
          headers: {
            Authorization: apiKey,
            "Content-Type": "application/json",
          },
        },
      );

      if (!solutionRes.ok) {
        const errorText = await solutionRes.text().catch(() => "");
        throw new Error(
          `Failed to fetch solution for job ${jobId}: ${solutionRes.status}${errorText ? ` — ${errorText}` : ""}`,
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
