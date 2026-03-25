"use client";

import { useDroppable } from "@dnd-kit/core";
import { useDispatch } from "./DispatchProvider";
import { techColor } from "./DispatchMap";
import { WorkOrderBlock } from "./WorkOrderBlock";
import type { DropData } from "./hooks/useDragAndDrop";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const HOUR_START = 8;
const HOUR_END = 18;
const TOTAL_HOURS = HOUR_END - HOUR_START;
const ROW_HEIGHT = 56; // px
const HEADER_HEIGHT = 28; // px for time axis
const LABEL_WIDTH = 120; // px for technician names

/** Convert "HH:MM" time string to a percentage (0-100) of the visible timeline. */
function timePct(time: string): number {
  const [h, m] = time.split(":").map(Number);
  const minutes = h * 60 + m - HOUR_START * 60;
  return Math.max(0, Math.min(100, (minutes / (TOTAL_HOURS * 60)) * 100));
}

/** Parse various time formats into "HH:MM". */
function formatTime(isoOrTime: string): string {
  if (isoOrTime.includes("T")) {
    const d = new Date(isoOrTime);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return isoOrTime.slice(0, 5);
}

/** Add minutes to an "HH:MM" string and return "HH:MM". */
function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const rh = Math.floor(total / 60);
  const rm = total % 60;
  return `${String(rh).padStart(2, "0")}:${String(rm).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/*  Single technician row (droppable)                                  */
/* ------------------------------------------------------------------ */
function TechRow({
  techId,
  techName,
  techIndex,
  shiftStart,
  shiftEnd,
}: {
  techId: string;
  techName: string;
  techIndex: number;
  shiftStart: string;
  shiftEnd: string;
}) {
  const { state } = useDispatch();
  const { assignments, workOrders, violations } = state;

  const dropData: DropData = { technicianId: techId, sequence: 1 };
  const { setNodeRef, isOver } = useDroppable({
    id: `timeline-row-${techId}`,
    data: dropData,
  });

  // Get this technician's assignments, sorted by sequence
  const techAssignments = [...assignments.entries()]
    .filter(([, a]) => a.technicianId === techId)
    .sort(([, a], [, b]) => a.sequence - b.sequence);

  // Violation lookup
  const violationWoIds = new Set<string>();
  for (const [woId, vList] of violations) {
    if (vList.length > 0) violationWoIds.add(woId);
  }

  const shiftStartPct = timePct(formatTime(shiftStart));
  const shiftEndPct = timePct(formatTime(shiftEnd));

  return (
    <div
      className="flex border-b border-neutral-100"
      style={{ height: ROW_HEIGHT }}
    >
      {/* Technician label */}
      <div
        className="flex items-center px-3 border-r border-neutral-200 shrink-0 bg-neutral-50"
        style={{ width: LABEL_WIDTH }}
      >
        <span
          className="w-2.5 h-2.5 rounded-full mr-2 shrink-0"
          style={{ background: techColor(techIndex) }}
        />
        <span className="text-xs font-medium text-neutral-700 truncate">
          {techName}
        </span>
      </div>

      {/* Track area */}
      <div
        ref={setNodeRef}
        className={`relative flex-1 ${isOver ? "bg-orange-50/60" : ""}`}
      >
        {/* Shift window background */}
        <div
          className="absolute inset-y-0 bg-neutral-50/80"
          style={{
            left: `${shiftStartPct}%`,
            width: `${shiftEndPct - shiftStartPct}%`,
          }}
        />

        {/* Hour gridlines */}
        {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => (
          <div
            key={i}
            className="absolute inset-y-0 w-px bg-neutral-100"
            style={{ left: `${(i / TOTAL_HOURS) * 100}%` }}
          />
        ))}

        {/* Work order blocks */}
        {techAssignments.map(([woId, assignment]) => {
          const wo = workOrders.find((w) => w.id === woId);
          if (!wo) return null;

          // Use arrival from assignment (or fall back to appointment window)
          const arrivalTime = formatTime(
            assignment.arrival || wo.appointmentWindow.from,
          );
          const durationMinutes = Math.round(
            (assignment.serviceTime || wo.estimatedDuration * 60) / 60,
          );
          const departureTime = addMinutes(arrivalTime, durationMinutes);

          const leftPct = timePct(arrivalTime);
          const rightPct = timePct(departureTime);
          const widthPct = Math.max(rightPct - leftPct, 2);

          return (
            <div
              key={woId}
              className="absolute inset-y-0"
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
            >
              <WorkOrderBlock
                workOrderId={woId}
                technicianId={techId}
                customerName={wo.customerName}
                serviceType={wo.serviceType}
                arrival={arrivalTime}
                departure={departureTime}
                techIndex={techIndex}
                sequence={assignment.sequence}
                hasViolation={violationWoIds.has(woId)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main timeline                                                      */
/* ------------------------------------------------------------------ */
export function DispatchTimeline() {
  const { state } = useDispatch();
  const { technicians } = state;

  // Current time marker
  const now = new Date();
  const nowPct = timePct(
    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
  );
  const showNowLine = nowPct > 0 && nowPct < 100;

  return (
    <div className="relative rounded-lg border border-neutral-200 bg-white overflow-hidden">
      {/* Time axis header */}
      <div
        className="flex border-b border-neutral-200"
        style={{ height: HEADER_HEIGHT }}
      >
        <div
          className="shrink-0 border-r border-neutral-200 bg-neutral-50"
          style={{ width: LABEL_WIDTH }}
        />
        <div className="relative flex-1">
          {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => {
            const hour = HOUR_START + i;
            const pct = (i / TOTAL_HOURS) * 100;
            return (
              <span
                key={hour}
                className="absolute top-0 text-[10px] text-neutral-400 -translate-x-1/2"
                style={{ left: `${pct}%`, lineHeight: `${HEADER_HEIGHT}px` }}
              >
                {String(hour).padStart(2, "0")}:00
              </span>
            );
          })}
        </div>
      </div>

      {/* Technician rows */}
      <div className="relative">
        {technicians.map((tech, idx) => (
          <TechRow
            key={tech.id}
            techId={tech.id}
            techName={tech.name}
            techIndex={idx}
            shiftStart={tech.shiftStart}
            shiftEnd={tech.shiftEnd}
          />
        ))}

        {/* Current-time indicator */}
        {showNowLine && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-orange-500 pointer-events-none z-20"
            style={{
              left: `calc(${LABEL_WIDTH}px + (100% - ${LABEL_WIDTH}px) * ${nowPct / 100})`,
            }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-orange-500" />
          </div>
        )}
      </div>
    </div>
  );
}
