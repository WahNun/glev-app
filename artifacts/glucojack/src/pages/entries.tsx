import React from "react";
import { useGetEntries, Entry } from "@workspace/api-client-react";
import { format, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Droplet, Cookie, Zap } from "lucide-react";

export default function Entries() {
  const { data, isLoading } = useGetEntries({ limit: 100 });

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
        <Skeleton className="h-10 w-48" />
        <Card><CardContent className="p-6"><Skeleton className="h-[600px] w-full" /></CardContent></Card>
      </div>
    );
  }

  const entries = data?.entries || [];

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Entry Log</h1>
        <p className="text-muted-foreground">Historical record of all inputs and evaluations.</p>
      </div>

      <Card>
        <div className="rounded-md border border-border/50 shadow-sm overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Glucose (mg/dL)</TableHead>
                <TableHead>Carbs (g)</TableHead>
                <TableHead>Insulin (u)</TableHead>
                <TableHead>Meal Type</TableHead>
                <TableHead>Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length > 0 ? (
                entries.map((entry) => (
                  <TableRow key={entry.id} className="hover:bg-muted/20">
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      <div>{format(parseISO(entry.timestamp), "MMM d")}</div>
                      <div className="text-muted-foreground">{format(parseISO(entry.timestamp), "HH:mm")}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-bold">{entry.glucoseBefore}</span>
                        {entry.glucoseAfter && (
                          <>
                            <span className="text-muted-foreground text-xs">→</span>
                            <span className="font-mono text-sm">{entry.glucoseAfter}</span>
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono">{entry.carbsGrams}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono font-medium text-primary">{entry.insulinUnits}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wider">{entry.mealType.replace('_', ' ')}</Badge>
                    </TableCell>
                    <TableCell>
                      <EvaluationBadge evalStatus={entry.evaluation} />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                    No entries found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function EvaluationBadge({ evalStatus }: { evalStatus?: string | null }) {
  if (!evalStatus) return <span className="text-muted-foreground text-xs">-</span>;
  
  let colorClass = "";
  switch(evalStatus) {
    case "GOOD": colorClass = "bg-green-500/10 text-green-600 border-green-500/20"; break;
    case "OVERDOSE": colorClass = "bg-red-500/10 text-red-600 border-red-500/20"; break;
    case "UNDERDOSE": colorClass = "bg-orange-500/10 text-orange-600 border-orange-500/20"; break;
    case "CHECK_CONTEXT": colorClass = "bg-gray-500/10 text-gray-500 border-gray-500/20"; break;
  }

  return (
    <Badge variant="outline" className={`text-[10px] ${colorClass}`}>
      {evalStatus.replace('_', ' ')}
    </Badge>
  );
}
