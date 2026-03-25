"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { WorkOrder, Technician } from "@/lib/types";
import type {
  WorkOrderAssignment,
  ScheduleViolation,
  DispatchMetrics,
  DistanceMatrix,
  EvaluateResult,
} from "@/lib/dispatch/types";
import { computeEstimatedMetrics } from "@/lib/dispatch/distance-matrix";

interface UseSchedulerEvaluateOptions {
  assignments: Map<string, WorkOrderAssignment>;
  workOrders: WorkOrder[];
  technicians: Technician[];
  matrix: DistanceMatrix | null;
  /** Debounce delay for Tier 2 server call (default 500ms) */
  debounceMs?: number;
}

interface UseSchedulerEvaluateResult {
  metrics: DispatchMetrics | null;
  metricsSource: "estimate" | "confirmed";
  violations: Map<string, ScheduleViolation[]>;
  isEvaluating: boolean;
}

// ---------------------------------------------------------------------------
// Tier 1 — instant local estimate using the distance matrix
// ---------------------------------------------------------------------------

/**
 * Wraps `computeEstimatedMetrics` to produce a full `DispatchMetrics` from
 * the lightweight `EstimatedMetrics` returned by the distance-matrix module.
 * Fields that require server-side constraint evaluation (waitTimeSeconds,
 * feasible) are filled with optimistic defaults.
 */
function estimateMetricsLocally(
  assignments: Map<string, WorkOrderAssignment>,
  workOrders: WorkOrder[],
  technicians: Technician[],
  matrix: DistanceMatrix,
): DispatchMetrics {
  const estimated = computeEstimatedMetrics(
    matrix,
    assignments,
    workOrders,
    technicians,
  );

  // Sum service time from assignments
  let serviceTimeSeconds = 0;
  for (const a of assignments.values()) {
    serviceTimeSeconds += a.serviceTime;
  }

  return {
    travelTimeSeconds: estimated.travelTimeSeconds,
    distanceMeters: estimated.distanceMeters,
    cost: estimated.cost,
    serviceTimeSeconds,
    waitTimeSeconds: 0, // Only the server can compute real wait times
    feasible: true, // Optimistic — Tier 2 will correct this
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Two-tier evaluation hook.
 *
 * - Tier 1: Instant local estimate using the cached distance matrix.
 *   Runs synchronously on every assignment change. Metrics are marked
 *   as "estimate" so the UI can prefix values with "~".
 *
 * - Tier 2: Debounced (500ms) server call to `/api/dispatch/evaluate`.
 *   When the server responds, metrics are promoted to "confirmed" and
 *   violations are populated. In-flight requests are cancelled when new
 *   changes arrive, preventing stale data from overwriting fresh estimates.
 */
export function useSchedulerEvaluate({
  assignments,
  workOrders,
  technicians,
  matrix,
  debounceMs = 500,
}: UseSchedulerEvaluateOptions): UseSchedulerEvaluateResult {
  const [metrics, setMetrics] = useState<DispatchMetrics | null>(null);
  const [metricsSource, setMetricsSource] = useState<"estimate" | "confirmed">(
    "estimate",
  );
  const [violations, setViolations] = useState<
    Map<string, ScheduleViolation[]>
  >(new Map());
  const [isEvaluating, setIsEvaluating] = useState(false);

  // Generation counter for stale-response detection
  const generationRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Serialise assignments for dependency tracking
  const assignmentsKeyRef = useRef("");

  const evaluate = useCallback(
    (currentAssignments: Map<string, WorkOrderAssignment>) => {
      // --- Tier 1: instant local estimate ---
      if (matrix) {
        const estimated = estimateMetricsLocally(
          currentAssignments,
          workOrders,
          technicians,
          matrix,
        );
        setMetrics(estimated);
        setMetricsSource("estimate");
      }

      // --- Tier 2: debounced server evaluation ---
      // Cancel any pending debounce
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Cancel any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const thisGeneration = ++generationRef.current;

      debounceTimerRef.current = setTimeout(async () => {
        const controller = new AbortController();
        abortControllerRef.current = controller;
        setIsEvaluating(true);

        try {
          // Serialise the assignment Map as an array for JSON transport
          const payload = [...currentAssignments.values()];

          const res = await fetch("/api/dispatch/evaluate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assignments: payload }),
            signal: controller.signal,
          });

          if (!res.ok) {
            throw new Error(`Evaluate API responded with ${res.status}`);
          }

          // Stale check — discard if a newer generation has started
          if (thisGeneration !== generationRef.current) return;

          const data: EvaluateResult = await res.json();

          // Only apply if still the latest generation
          if (thisGeneration !== generationRef.current) return;

          setMetrics(data.metrics);
          setMetricsSource("confirmed");

          // Group violations by work order
          const violationMap = new Map<string, ScheduleViolation[]>();
          for (const v of data.violations) {
            if (v.workOrderId) {
              const list = violationMap.get(v.workOrderId) ?? [];
              list.push(v);
              violationMap.set(v.workOrderId, list);
            }
          }
          setViolations(violationMap);
        } catch (err) {
          // Ignore aborted requests
          if (err instanceof DOMException && err.name === "AbortError") return;
          // Stale — ignore
          if (thisGeneration !== generationRef.current) return;
          // On error, keep the Tier 1 estimate visible
          console.error("[useSchedulerEvaluate] Tier 2 failed:", err);
        } finally {
          if (thisGeneration === generationRef.current) {
            setIsEvaluating(false);
          }
        }
      }, debounceMs);
    },
    [matrix, workOrders, technicians, debounceMs],
  );

  // Trigger evaluation whenever assignments change
  useEffect(() => {
    // Build a stable string key to detect actual changes
    const entries = [...assignments.entries()]
      .map(([id, a]) => `${id}:${a.technicianId}:${a.sequence}`)
      .sort()
      .join("|");

    if (entries === assignmentsKeyRef.current) return;
    assignmentsKeyRef.current = entries;

    evaluate(assignments);
  }, [assignments, evaluate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
      generationRef.current++;
    };
  }, []);

  return { metrics, metricsSource, violations, isEvaluating };
}
