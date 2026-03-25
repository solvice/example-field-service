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
 * POST /api/dispatch/evaluate
 *
 * Evaluates an existing set of assignments without re-solving.
 * Reads work orders and technicians from JSON, maps assignments to
 * Solvice warm-start fields, and calls the sync evaluate endpoint.
 *
 * Request body:
 *   { assignments: WorkOrderAssignment[] }
 *
 * Response:
 *   { metrics: DispatchMetrics, violations: ScheduleViolation[] }
 */
export async function POST(request: Request) {
  const apiKey = process.env.SOLVICE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "SOLVICE_API_KEY is not configured" },
      { status: 500 },
    );
  }

  let body: { assignments?: WorkOrderAssignment[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { assignments } = body;
  if (!Array.isArray(assignments)) {
    return NextResponse.json(
      { error: "assignments array is required" },
      { status: 400 },
    );
  }

  try {
    // Read domain data from JSON files
    const dataDir = path.join(process.cwd(), "data");
    const [workOrdersRaw, techniciansRaw] = await Promise.all([
      fs.readFile(path.join(dataDir, "work-orders.json"), "utf-8"),
      fs.readFile(path.join(dataDir, "technicians.json"), "utf-8"),
    ]);
    const workOrders: WorkOrder[] = JSON.parse(workOrdersRaw);
    const technicians: Technician[] = JSON.parse(techniciansRaw);

    // Build assignment lookup
    const assignmentMap = new Map(
      assignments.map((a) => [a.workOrderId, a]),
    );

    // Build Solvice jobs — only assigned work orders, with warm-start fields
    const jobs = workOrders
      .filter((wo) => assignmentMap.has(wo.id))
      .map((wo) => {
        const assignment = assignmentMap.get(wo.id)!;
        return {
          name: wo.id,
          location: { latitude: wo.latitude, longitude: wo.longitude },
          duration: wo.estimatedDuration * 60,
          windows: [
            {
              from: wo.appointmentWindow.from,
              to: wo.appointmentWindow.to,
              hard: true,
            },
          ],
          tags: [{ name: serviceTypeToTag(wo.serviceType), hard: true }],
          initialResource: assignment.technicianId,
          initialArrival: assignment.arrival,
        };
      });

    if (jobs.length === 0) {
      return NextResponse.json({
        metrics: {
          travelTimeSeconds: 0,
          distanceMeters: 0,
          cost: 0,
          serviceTimeSeconds: 0,
          waitTimeSeconds: 0,
          feasible: true,
        },
        violations: [],
      });
    }

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

    // Call Solvice evaluate endpoint (synchronous)
    const response = await fetch(`${SOLVER_BASE}/v2/vrp/evaluate/sync`, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jobs, resources }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return NextResponse.json(
        {
          error: "Evaluate request failed",
          details: `${response.status} ${response.statusText}${errorText ? ` — ${errorText}` : ""}`,
        },
        { status: response.status },
      );
    }

    const solution = await response.json();

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
      (v: { name: string | null; level: string | null; value: number | null }) => ({
        constraint: v.name ?? "UNKNOWN",
        severity: severityMap[v.level ?? "SOFT"] ?? "soft",
        penalty: v.value ?? 0,
      }),
    );

    return NextResponse.json({ metrics, violations });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Evaluation failed", details: message },
      { status: 500 },
    );
  }
}
