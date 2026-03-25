import workOrdersData from "@/data/work-orders.json";
import techniciansData from "@/data/technicians.json";
import type { WorkOrder, Technician } from "@/lib/types";
import { DispatchView } from "@/components/dispatch";

export default function DispatchPage() {
  const workOrders = workOrdersData as WorkOrder[];
  const technicians = techniciansData as Technician[];

  return <DispatchView workOrders={workOrders} technicians={technicians} />;
}
