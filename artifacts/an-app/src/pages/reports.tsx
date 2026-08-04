/**
 * Berichte — placeholder for Phase 13 reporting content.
 * Route: /reports
 */
import { BarChart2 } from "lucide-react";

export default function ReportsPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto animate-in fade-in duration-300">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Berichte</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          KPIs und Auswertungen für Ihr Unternehmen
        </p>
      </div>

      <div className="flex flex-col items-center justify-center py-32 gap-4 border border-dashed rounded-xl">
        <BarChart2 className="w-14 h-14 text-muted-foreground opacity-30" />
        <div className="text-center space-y-1">
          <p className="font-semibold text-foreground">Berichte — Phase 13</p>
          <p className="text-muted-foreground text-sm max-w-xs">
            Auswertungen, KPIs und CSV-/JSON-Export werden in Phase 13 bereitgestellt.
          </p>
        </div>
      </div>
    </div>
  );
}
