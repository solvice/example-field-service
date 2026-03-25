"use client";

import dynamic from "next/dynamic";
import workOrdersData from "@/data/work-orders.json";
import techniciansData from "@/data/technicians.json";
import type { WorkOrder, Technician } from "@/lib/types";

const DispatchView = dynamic(
  () => import("@/components/dispatch").then((m) => m.DispatchView),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-screen">
        <p className="text-neutral-400">Loading dispatch...</p>
      </div>
    ),
  }
);

export default function DispatchPage() {
  const workOrders = workOrdersData as WorkOrder[];
  const technicians = techniciansData as Technician[];

  return <DispatchView workOrders={workOrders} technicians={technicians} />;
}
