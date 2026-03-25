import Link from "next/link";
import { ClipboardList, Users } from "lucide-react";

export default function Home() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">FieldFlow</h1>
        <p className="mt-1 text-neutral-500">
          HVAC service management — work orders and technician scheduling.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          href="/work-orders"
          className="flex items-start gap-4 rounded-lg border border-neutral-200 bg-white p-6 hover:border-neutral-300 transition-colors"
        >
          <ClipboardList className="h-6 w-6 text-orange-600 shrink-0 mt-0.5" />
          <div>
            <h2 className="font-semibold">Work Orders</h2>
            <p className="mt-1 text-sm text-neutral-500">
              View and manage service requests from customers.
            </p>
          </div>
        </Link>

        <Link
          href="/technicians"
          className="flex items-start gap-4 rounded-lg border border-neutral-200 bg-white p-6 hover:border-neutral-300 transition-colors"
        >
          <Users className="h-6 w-6 text-orange-600 shrink-0 mt-0.5" />
          <div>
            <h2 className="font-semibold">Technicians</h2>
            <p className="mt-1 text-sm text-neutral-500">
              Manage your field service team and their skills.
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}
