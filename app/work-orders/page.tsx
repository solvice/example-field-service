import { ClipboardList } from "lucide-react";
import workOrders from "@/data/work-orders.json";
import type { WorkOrder } from "@/lib/types";

function StatusBadge({ status }: { status: WorkOrder["status"] }) {
  const styles = {
    Pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
    Scheduled: "bg-blue-50 text-blue-700 border-blue-200",
    Completed: "bg-green-50 text-green-700 border-green-200",
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-BE", { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function WorkOrdersPage() {
  const orders = workOrders as WorkOrder[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-6 w-6 text-orange-600" />
          <h1 className="text-2xl font-bold">Work Orders</h1>
        </div>
        <span className="text-sm text-neutral-500">{orders.length} orders</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50">
              <th className="px-4 py-3 text-left font-medium text-neutral-600">ID</th>
              <th className="px-4 py-3 text-left font-medium text-neutral-600">Customer</th>
              <th className="px-4 py-3 text-left font-medium text-neutral-600">Service Type</th>
              <th className="px-4 py-3 text-left font-medium text-neutral-600">Appointment Window</th>
              <th className="px-4 py-3 text-left font-medium text-neutral-600">Duration</th>
              <th className="px-4 py-3 text-left font-medium text-neutral-600">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {orders.map((order) => (
              <tr key={order.id} className="hover:bg-neutral-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-neutral-500">{order.id}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{order.customerName}</div>
                  <div className="text-xs text-neutral-400">{order.address}</div>
                </td>
                <td className="px-4 py-3">{order.serviceType}</td>
                <td className="px-4 py-3 text-neutral-600">
                  {formatTime(order.appointmentWindow.from)} – {formatTime(order.appointmentWindow.to)}
                </td>
                <td className="px-4 py-3 text-neutral-600">{formatDuration(order.estimatedDuration)}</td>
                <td className="px-4 py-3"><StatusBadge status={order.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
