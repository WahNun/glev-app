import React, { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useGetRecommendation, RecommendationRequestMealType, Recommendation } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Droplet, Cookie, Zap, Calculator, AlertTriangle, ShieldCheck, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const formSchema = z.object({
  glucoseBefore: z.coerce.number().min(20).max(600),
  carbsGrams: z.coerce.number().min(0).max(500),
  mealType: z.enum([
    RecommendationRequestMealType.FAST_CARBS,
    RecommendationRequestMealType.HIGH_FAT,
    RecommendationRequestMealType.HIGH_PROTEIN,
    RecommendationRequestMealType.BALANCED,
  ]),
});

export default function Recommend() {
  const getRecommendation = useGetRecommendation();
  const [result, setResult] = useState<Recommendation | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      glucoseBefore: "" as any,
      carbsGrams: "" as any,
      mealType: RecommendationRequestMealType.BALANCED,
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    try {
      const res = await getRecommendation.mutateAsync({ data: values });
      setResult(res);
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Decision Support</h1>
        <p className="text-muted-foreground">Data-driven bolus calculations based on your metabolic history.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 items-start">
        <Card>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="w-5 h-5" /> Parameters
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="glucoseBefore"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Droplet className="w-4 h-4 text-primary" />
                        Current Glucose (mg/dL)
                      </FormLabel>
                      <FormControl>
                        <Input type="number" inputMode="decimal" placeholder="e.g. 140" className="text-xl h-12 font-mono" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="carbsGrams"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Cookie className="w-4 h-4 text-orange-500" />
                        Planned Carbs (g)
                      </FormLabel>
                      <FormControl>
                        <Input type="number" inputMode="decimal" placeholder="e.g. 60" className="text-xl h-12 font-mono" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="mealType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Meal Composition</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="h-12 text-md">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={RecommendationRequestMealType.BALANCED}>Balanced</SelectItem>
                          <SelectItem value={RecommendationRequestMealType.FAST_CARBS}>Fast Carbs</SelectItem>
                          <SelectItem value={RecommendationRequestMealType.HIGH_FAT}>High Fat</SelectItem>
                          <SelectItem value={RecommendationRequestMealType.HIGH_PROTEIN}>High Protein</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
              <CardFooter>
                <Button type="submit" size="lg" className="w-full" disabled={getRecommendation.isPending}>
                  {getRecommendation.isPending ? "Calculating..." : "Calculate Bolus"}
                </Button>
              </CardFooter>
            </form>
          </Form>
        </Card>

        <div className="space-y-6">
          {result ? (
            <Card className="border-2 border-primary/20 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-sm font-medium uppercase tracking-wider text-primary">Recommendation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex flex-col items-center justify-center p-6 bg-card rounded-lg border shadow-sm">
                  <div className="text-sm text-muted-foreground mb-2">Suggested Dose</div>
                  <div className="text-6xl font-bold text-foreground flex items-baseline gap-2">
                    {result.recommendedUnits.toFixed(1)}
                    <span className="text-2xl text-muted-foreground font-normal">u</span>
                  </div>
                  <div className="text-sm text-muted-foreground mt-2 font-mono">
                    Range: {result.minUnits.toFixed(1)} - {result.maxUnits.toFixed(1)} u
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center p-3 bg-card rounded-md border text-sm">
                    <span className="text-muted-foreground">Timing</span>
                    <span className="font-semibold text-foreground flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      {result.timing.replace('_', ' ')}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center p-3 bg-card rounded-md border text-sm">
                    <span className="text-muted-foreground">Confidence</span>
                    <span className="font-semibold flex items-center gap-2">
                      {result.confidence === 'HIGH' && <ShieldCheck className="w-4 h-4 text-green-500" />}
                      {result.confidence === 'MEDIUM' && <Info className="w-4 h-4 text-blue-500" />}
                      {result.confidence === 'LOW' && <AlertTriangle className="w-4 h-4 text-orange-500" />}
                      {result.confidence} ({result.basedOnEntries} records)
                    </span>
                  </div>

                  <Alert variant="default" className="bg-card">
                    <Zap className="h-4 w-4 text-primary" />
                    <AlertTitle className="text-sm">Reasoning</AlertTitle>
                    <AlertDescription className="text-xs text-muted-foreground mt-1">
                      {result.reasoning}
                    </AlertDescription>
                  </Alert>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="h-full min-h-[400px] flex items-center justify-center border-dashed bg-muted/20">
              <div className="text-center text-muted-foreground max-w-sm p-6">
                <Zap className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <h3 className="font-medium text-foreground mb-2">Awaiting Parameters</h3>
                <p className="text-sm">Enter your current glucose and planned meal details to get a personalized insulin recommendation based on your historical data.</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Clock(props: any) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinelinejoin="round" {...props}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
}
