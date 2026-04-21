import React, { useMemo } from "react";
import { Link } from "wouter";
import { useGetDashboardStats, useGetGlucoseTrend } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Droplet, Zap, Target, Plus, AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell, ReferenceLine } from "recharts";
import { format, parseISO } from "date-fns";

const EVALUATION_COLORS: Record<string, string> = {
  GOOD: "hsl(var(--chart-1))",
  SLIGHT_OVERDOSE: "hsl(var(--chart-4))",
  OVERDOSE: "hsl(var(--chart-2))",
  SLIGHT_UNDERDOSE: "hsl(142 71% 45%)",
  UNDERDOSE: "hsl(var(--chart-3))",
  CHECK_CONTEXT: "hsl(var(--chart-5))",
};

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: trendData, isLoading: trendLoading } = useGetGlucoseTrend({ days: 7 });

  const evaluationChartData = useMemo(() => {
    if (!stats?.evaluationBreakdown) return [];
    return [
      { name: "In Range", value: stats.evaluationBreakdown.GOOD, color: EVALUATION_COLORS.GOOD },
      { name: "Overdose Risk", value: stats.evaluationBreakdown.OVERDOSE, color: EVALUATION_COLORS.OVERDOSE },
      { name: "Underdose Risk", value: stats.evaluationBreakdown.UNDERDOSE, color: EVALUATION_COLORS.UNDERDOSE },
      { name: "Check Context", value: stats.evaluationBreakdown.CHECK_CONTEXT, color: EVALUATION_COLORS.CHECK_CONTEXT },
    ].filter((item) => item.value > 0);
  }, [stats?.evaluationBreakdown]);

  const trendChartData = useMemo(() => {
    if (!trendData?.points) return [];
    return trendData.points.map((p) => ({
      ...p,
      formattedTime: format(parseISO(p.timestamp), "MMM d, HH:mm"),
    }));
  }, [trendData?.points]);

  if (statsLoading || trendLoading) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-20 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  if (!stats || stats.totalEntries === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] p-6 text-center space-y-6">
        <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center text-primary">
          <Activity className="w-10 h-10" />
        </div>
        <div className="space-y-2 max-w-md">
          <h1 className="text-3xl font-bold tracking-tight">Welcome to GlucoJack</h1>
          <p className="text-muted-foreground">
            Your personal control system for glucose and insulin management. Log your first entry to see your stats.
          </p>
        </div>
        <Button asChild size="lg" className="font-semibold">
          <Link href="/log">
            <Plus className="mr-2 h-5 w-5" />
            Log First Entry
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">Your recent metabolic performance.</p>
        </div>
        <Button asChild className="font-semibold shadow-sm">
          <Link href="/log">
            <Plus className="mr-2 h-4 w-4" /> Quick Log
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-l-4" style={{ borderLeftColor: "hsl(var(--primary))" }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Control Score</CardTitle>
            <Target className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.controlScore.toFixed(0)}<span className="text-lg text-muted-foreground font-normal">/100</span></div>
            <p className="text-xs text-muted-foreground mt-1">
              Overall control quality
            </p>
          </CardContent>
        </Card>
        
        <Card className="border-l-4" style={{ borderLeftColor: EVALUATION_COLORS.GOOD }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Time In Range</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.goodRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground mt-1">
              Good evaluations
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4" style={{ borderLeftColor: EVALUATION_COLORS.UNDERDOSE }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Spike Rate</CardTitle>
            <Droplet className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.spikeRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground mt-1">
              Hyperglycemia risk events
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4" style={{ borderLeftColor: EVALUATION_COLORS.OVERDOSE }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Hypo Rate</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.hypoRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground mt-1">
              Hypoglycemia risk events
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-7 lg:grid-cols-3">
        <Card className="md:col-span-4 lg:col-span-2 flex flex-col">
          <CardHeader>
            <CardTitle>Recent Glucose Trend</CardTitle>
            <CardDescription>Pre-meal glucose over the last 7 days</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 min-h-[300px]">
            {trendChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="formattedTime" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} minTickGap={30} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <RechartsTooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '0.5rem' }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <ReferenceLine y={70} stroke="hsl(var(--destructive))" strokeDasharray="3 3" />
                  <ReferenceLine y={180} stroke="hsl(var(--chart-3))" strokeDasharray="3 3" />
                  <Line 
                    type="monotone" 
                    dataKey="glucoseBefore" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={3}
                    dot={{ r: 4, fill: "hsl(var(--background))", strokeWidth: 2 }}
                    activeDot={{ r: 6 }} 
                    name="Glucose (mg/dL)"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">Not enough data</div>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-3 lg:col-span-1 flex flex-col">
          <CardHeader>
            <CardTitle>Evaluation Breakdown</CardTitle>
            <CardDescription>Outcome distribution</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 min-h-[300px] flex items-center justify-center">
            {evaluationChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={evaluationChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {evaluationChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '0.5rem' }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-muted-foreground">No evaluations yet</div>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
