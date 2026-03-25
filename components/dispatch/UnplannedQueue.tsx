"use client";

import { useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDispatch } from "./DispatchProvider";
import type { WorkOrder } from "@/lib/types";
import type { DragData, DropData } from "./hooks/useDragAndDrop";

/* ------------------------------------------------------------------ */
/*  Single draggable unplanned item                                    */
/* ------------------------------------------------------------------ */
function UnplannedItem({ wo }: { wo: WorkOrder }) {
  const { state, dispatch: dispatchAction } = useDispatch();
  const isSelected = state.selectedWorkOrder === wo.id;

  const dragData: DragData = {
    workOrderId: wo.id,
    fromTechnicianId: null,
    fromSequence: null,
  };

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `unplanned-${wo.id}`,
      data: dragData,
    });

  const style: React.CSSProperties = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50 }
    : {};

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      onClick={() =>
        dispatchAction({
          type: "SELECT_WORK_ORDER",
          workOrderId: isSelected ? null : wo.id,
        })
      }
      className={cn(
        "rounded-lg border border-neutral-200 bg-white p-3 cursor-grab",
        "hover:border-orange-300 hover:shadow-sm transition-all",
        isDragging && "opacity-50 shadow-lg",
        isSelected && "ring-2 ring-orange-400 border-orange-400",
      )}
      style={style}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-neutral-800 truncate">
            {wo.customerName}
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">{wo.serviceType}</div>
        </div>
        <span className="text-[10px] font-mono text-neutral-400 whitespace-nowrap">
          {wo.estimatedDuration}m
        </span>
      </div>
      <div className="flex items-center gap-2 mt-1.5 text-[11px] text-neutral-400">
        <span>
          {wo.appointmentWindow.from}&ndash;{wo.appointmentWindow.to}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Queue component                                                    */
/* ------------------------------------------------------------------ */
export function UnplannedQueue() {
  const { state } = useDispatch();
  const { workOrders, unplannedQueue } = state;
  const [search, setSearch] = useState("");

  // Drop target — drag a scheduled work order here to unschedule
  const dropData: DropData = { technicianId: null, sequence: 0 };
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: "unplanned-queue",
    data: dropData,
  });

  const unplannedSet = new Set(unplannedQueue);

  const unplanned = workOrders.filter((wo) => {
    if (!unplannedSet.has(wo.id)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      wo.customerName.toLowerCase().includes(q) ||
      wo.serviceType.toLowerCase().includes(q)
    );
  });

  return (
    <div
      ref={setDropRef}
      className={cn(
        "flex flex-col h-full rounded-lg border border-neutral-200 bg-neutral-50 overflow-hidden",
        isOver && "border-orange-400 bg-orange-50/30",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-200 bg-white">
        <h3 className="text-sm font-semibold text-neutral-800">Unplanned</h3>
        <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-neutral-200 text-[11px] font-semibold text-neutral-600">
          {unplannedQueue.length}
        </span>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-neutral-100 bg-white">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter work orders..."
            className="w-full rounded-md border border-neutral-200 bg-neutral-50 py-1.5 pl-8 pr-3 text-xs text-neutral-700 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-400/40 focus:border-orange-300"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
        {unplanned.length === 0 ? (
          <p className="text-xs text-neutral-400 text-center py-6">
            {search ? "No matching work orders" : "All work orders assigned"}
          </p>
        ) : (
          unplanned.map((wo) => <UnplannedItem key={wo.id} wo={wo} />)
        )}
      </div>
    </div>
  );
}
