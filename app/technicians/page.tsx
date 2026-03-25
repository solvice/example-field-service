import { Users } from "lucide-react";
import technicians from "@/data/technicians.json";
import type { Technician } from "@/lib/types";

function SkillBadge({ skill }: { skill: string }) {
  const colors: Record<string, string> = {
    HVAC: "bg-blue-50 text-blue-700 border-blue-200",
    Electrical: "bg-amber-50 text-amber-700 border-amber-200",
    Plumbing: "bg-cyan-50 text-cyan-700 border-cyan-200",
    Maintenance: "bg-green-50 text-green-700 border-green-200",
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${colors[skill] || "bg-neutral-50 text-neutral-600 border-neutral-200"}`}>
      {skill}
    </span>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-BE", { hour: "2-digit", minute: "2-digit" });
}

export default function TechniciansPage() {
  const techs = technicians as Technician[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-orange-600" />
          <h1 className="text-2xl font-bold">Technicians</h1>
        </div>
        <span className="text-sm text-neutral-500">{techs.length} technicians</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50">
              <th className="px-4 py-3 text-left font-medium text-neutral-600">Name</th>
              <th className="px-4 py-3 text-left font-medium text-neutral-600">Skills</th>
              <th className="px-4 py-3 text-left font-medium text-neutral-600">Home Base</th>
              <th className="px-4 py-3 text-left font-medium text-neutral-600">Shift</th>
              <th className="px-4 py-3 text-left font-medium text-neutral-600">Phone</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {techs.map((tech) => (
              <tr key={tech.id} className="hover:bg-neutral-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium">{tech.name}</div>
                  <div className="text-xs text-neutral-400">{tech.id}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {tech.skills.map((skill) => (
                      <SkillBadge key={skill} skill={skill} />
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-neutral-600">{tech.homeBase.address}</td>
                <td className="px-4 py-3 text-neutral-600">
                  {formatTime(tech.shiftStart)} – {formatTime(tech.shiftEnd)}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-neutral-500">{tech.phone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
