import React, { useState } from "react";
import { useLocation } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useCreateEntry, CreateEntryBodyMealType } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Droplet, Cookie, Zap, Clock, ArrowRight, Wheat } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const formSchema = z.object({
  glucoseBefore: z.coerce.number().min(20).max(600),
  carbsGrams: z.coerce.number().min(0).max(500),
  fiberGrams: z.string().transform(val => val === "" ? null : Number(val)).nullable(),
  insulinUnits: z.coerce.number().min(0).max(100),
  mealType: z.enum([
    CreateEntryBodyMealType.FAST_CARBS,
    CreateEntryBodyMealType.HIGH_FAT,
    CreateEntryBodyMealType.HIGH_PROTEIN,
    CreateEntryBodyMealType.BALANCED,
  ]),
  glucoseAfter: z.string().transform(val => val === "" ? null : Number(val)).nullable(),
  notes: z.string().optional(),
});

export default function QuickLog() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createEntry = useCreateEntry();
  const queryClient = useQueryClient();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      glucoseBefore: "" as any,
      carbsGrams: "" as any,
      fiberGrams: null,
      insulinUnits: "" as any,
      mealType: CreateEntryBodyMealType.BALANCED,
      glucoseAfter: null,
      notes: "",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    try {
      await createEntry.mutateAsync({ data: { ...values, fiberGrams: values.fiberGrams ?? undefined } as any });
      toast({
        title: "Entry Logged",
        description: "Your glucose and insulin data has been recorded.",
      });
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["/api/insights/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/entries"] });
      setLocation("/");
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to log entry. Please try again.",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Quick Log</h1>
        <p className="text-muted-foreground">Fast, precise entry for immediate tracking.</p>
      </div>

      <Card>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardHeader>
              <CardTitle>New Entry</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="glucoseBefore"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Droplet className="w-4 h-4 text-primary" />
                        Pre-Meal Glucose (mg/dL)
                      </FormLabel>
                      <FormControl>
                        <Input type="number" inputMode="decimal" placeholder="e.g. 105" className="text-2xl font-mono h-14" autoFocus {...field} />
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
                        Carbs (g)
                      </FormLabel>
                      <FormControl>
                        <Input type="number" inputMode="decimal" placeholder="e.g. 45" className="text-2xl font-mono h-14" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="fiberGrams"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Wheat className="w-4 h-4 text-green-600" />
                        Fiber (g) <span className="text-muted-foreground text-xs font-normal ml-1">optional</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          inputMode="decimal"
                          placeholder="e.g. 8"
                          className="text-2xl font-mono h-14"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormDescription>Reduces net carb load used for dosing</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="insulinUnits"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-blue-500" />
                        Insulin (Units)
                      </FormLabel>
                      <FormControl>
                        <Input type="number" inputMode="decimal" step="0.5" placeholder="e.g. 4.5" className="text-2xl font-mono h-14" {...field} />
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
                          <SelectTrigger className="h-14 text-lg">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={CreateEntryBodyMealType.BALANCED}>Balanced</SelectItem>
                          <SelectItem value={CreateEntryBodyMealType.FAST_CARBS}>Fast Carbs</SelectItem>
                          <SelectItem value={CreateEntryBodyMealType.HIGH_FAT}>High Fat</SelectItem>
                          <SelectItem value={CreateEntryBodyMealType.HIGH_PROTEIN}>High Protein</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="pt-4 border-t">
                <h3 className="text-sm font-medium text-muted-foreground mb-4 uppercase tracking-wider">Optional Data</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="glucoseAfter"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <Droplet className="w-4 h-4 text-muted-foreground" />
                          Post-Meal Glucose (mg/dL)
                        </FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            inputMode="decimal" 
                            placeholder="Optional" 
                            className="font-mono" 
                            value={field.value || ""} 
                            onChange={field.onChange} 
                          />
                        </FormControl>
                        <FormDescription>Usually 2 hours after meal</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Exercise, stress, sickness, etc." className="resize-none" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" size="lg" className="w-full text-lg h-14 font-semibold" disabled={createEntry.isPending}>
                {createEntry.isPending ? "Saving..." : (
                  <>Save Entry <ArrowRight className="ml-2 w-5 h-5" /></>
                )}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
