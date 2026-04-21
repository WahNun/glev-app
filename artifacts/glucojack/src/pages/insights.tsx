import React from "react";
import { useGetMealPatterns } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function Insights() {
  const { data, isLoading } = useGetMealPatterns();

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  const patterns = data?.patterns || [];

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Insights & Patterns</h1>
        <p className="text-muted-foreground">Analyze your metabolic response across different meal types.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Meal Composition Performance</CardTitle>
          <CardDescription>How different macronutrient profiles affect your control.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Meal Type</TableHead>
                  <TableHead className="text-right">Entries</TableHead>
                  <TableHead className="text-right">Avg Carbs</TableHead>
                  <TableHead className="text-right">Avg Insulin</TableHead>
                  <TableHead className="text-right">Insulin:Carb Ratio</TableHead>
                  <TableHead className="text-right">Avg Delta (mg/dL)</TableHead>
                  <TableHead className="text-right">Control Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {patterns.length > 0 ? (
                  patterns.map((pattern) => (
                    <TableRow key={pattern.mealType}>
                      <TableCell className="font-medium text-xs">
                        <Badge variant="outline">{pattern.mealType.replace('_', ' ')}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{pattern.count}</TableCell>
                      <TableCell className="text-right">{pattern.avgCarbsGrams.toFixed(0)}g</TableCell>
                      <TableCell className="text-right">{pattern.avgInsulinUnits.toFixed(1)}u</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">1u : {(10 / pattern.insulinToCarb).toFixed(1)}g</TableCell>
                      <TableCell className="text-right">
                        <span className={pattern.avgDelta && pattern.avgDelta > 50 ? "text-orange-500 font-bold" : "text-green-500 font-bold"}>
                          {pattern.avgDelta ? (pattern.avgDelta > 0 ? `+${pattern.avgDelta.toFixed(0)}` : pattern.avgDelta.toFixed(0)) : '-'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-bold">{pattern.goodRate.toFixed(0)}%</span>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                      No pattern data available yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="bg-muted/30 border-dashed">
          <CardContent className="p-6 text-center text-sm text-muted-foreground space-y-2">
            <h3 className="font-semibold text-foreground">Understanding Insulin:Carb Ratio</h3>
            <p>This ratio shows how many grams of carbohydrate are covered by 1 unit of insulin for a specific meal type, based on your historical successful entries.</p>
          </CardContent>
        </Card>
        
        <Card className="bg-muted/30 border-dashed">
          <CardContent className="p-6 text-center text-sm text-muted-foreground space-y-2">
            <h3 className="font-semibold text-foreground">Control Rate</h3>
            <p>The percentage of entries for this meal type that resulted in a "GOOD" evaluation (in range, steady speed) without extreme spikes or drops.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
