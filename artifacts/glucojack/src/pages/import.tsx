import React, { useState } from "react";
import { useImportBatch, CreateEntryBody, CreateEntryBodyMealType } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, AlertCircle, FileText, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";

export default function ImportData() {
  const [pasteData, setPasteData] = useState("");
  const [parsedEntries, setParsedEntries] = useState<CreateEntryBody[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const importBatch = useImportBatch();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSuccess, setIsSuccess] = useState(false);
  const [importedCount, setImportedCount] = useState(0);

  const parseTabSeparated = (text: string) => {
    setError(null);
    try {
      const lines = text.trim().split("\n");
      if (lines.length === 0) return;

      const entries: CreateEntryBody[] = [];
      
      // Skip header row if present
      const startIdx = lines[0].toLowerCase().includes("glucose") ? 1 : 0;

      for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = line.split("\t");
        
        // Expected format: timestamp, glucoseBefore, carbs, insulin, mealType, [glucoseAfter], [notes]
        if (cols.length < 5) {
          throw new Error(`Line ${i + 1} has insufficient columns (expected at least 5).`);
        }

        const glucoseBefore = Number(cols[1]);
        const carbsGrams = Number(cols[2]);
        const insulinUnits = Number(cols[3]);
        
        let mealTypeStr = cols[4].trim().toUpperCase();
        // Fallback or mapping
        if (!Object.values(CreateEntryBodyMealType).includes(mealTypeStr as any)) {
          mealTypeStr = CreateEntryBodyMealType.BALANCED;
        }

        if (isNaN(glucoseBefore) || isNaN(carbsGrams) || isNaN(insulinUnits)) {
          throw new Error(`Line ${i + 1} contains invalid numeric data.`);
        }

        const entry: CreateEntryBody = {
          timestamp: cols[0] ? new Date(cols[0]).toISOString() : new Date().toISOString(),
          glucoseBefore,
          carbsGrams,
          insulinUnits,
          mealType: mealTypeStr as CreateEntryBodyMealType,
        };

        if (cols.length > 5 && cols[5].trim() !== "") {
          const after = Number(cols[5]);
          if (!isNaN(after)) entry.glucoseAfter = after;
        }
        
        if (cols.length > 6 && cols[6].trim() !== "") {
          entry.notes = cols[6].trim();
        }

        entries.push(entry);
      }
      
      setParsedEntries(entries);
    } catch (err: any) {
      setError(err.message || "Failed to parse data");
      setParsedEntries([]);
    }
  };

  const handlePasteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setPasteData(text);
    if (text.trim()) {
      parseTabSeparated(text);
    } else {
      setParsedEntries([]);
      setError(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        // Simple CSV parse (comma separated)
        try {
          const lines = text.trim().split("\n");
          if (lines.length === 0) return;
          const entries: CreateEntryBody[] = [];
          const startIdx = lines[0].toLowerCase().includes("glucose") ? 1 : 0;
          
          for (let i = startIdx; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const cols = line.split(",").map(c => c.replace(/^"|"$/g, '').trim()); // handle basic quotes
            
            if (cols.length < 5) continue; // skip bad lines
            
            const glucoseBefore = Number(cols[1]);
            const carbsGrams = Number(cols[2]);
            const insulinUnits = Number(cols[3]);
            let mealTypeStr = cols[4].toUpperCase();
            if (!Object.values(CreateEntryBodyMealType).includes(mealTypeStr as any)) mealTypeStr = CreateEntryBodyMealType.BALANCED;
            
            if (isNaN(glucoseBefore) || isNaN(carbsGrams) || isNaN(insulinUnits)) continue;
            
            entries.push({
              timestamp: cols[0] ? new Date(cols[0]).toISOString() : undefined,
              glucoseBefore,
              carbsGrams,
              insulinUnits,
              mealType: mealTypeStr as CreateEntryBodyMealType,
            });
          }
          setParsedEntries(entries);
          setError(null);
        } catch (err) {
          setError("Failed to parse CSV file");
        }
      }
    };
    reader.readAsText(file);
  };

  const submitImport = async () => {
    if (parsedEntries.length === 0) return;
    
    try {
      const result = await importBatch.mutateAsync({ data: { entries: parsedEntries } });
      setImportedCount(result.imported);
      setIsSuccess(true);
      setParsedEntries([]);
      setPasteData("");
      
      queryClient.invalidateQueries({ queryKey: ["/api/insights/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/entries"] });
      
      toast({
        title: "Import Successful",
        description: `Imported ${result.imported} entries.`,
      });
    } catch (err) {
      toast({
        title: "Import Failed",
        description: "There was an error importing your data.",
        variant: "destructive",
      });
    }
  };

  if (isSuccess) {
    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6 text-center py-20">
        <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center text-green-500 mx-auto mb-6">
          <CheckCircle2 className="w-10 h-10" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Import Complete</h1>
        <p className="text-muted-foreground text-lg mb-8">Successfully imported {importedCount} entries into your log.</p>
        <div className="flex justify-center gap-4">
          <Button onClick={() => setIsSuccess(false)} variant="outline">Import More</Button>
          <Button asChild><Link href="/entries">View Entries</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Import Data</h1>
        <p className="text-muted-foreground">Bulk import history from other devices or spreadsheets.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" /> Paste Data
            </CardTitle>
            <CardDescription>Paste tab-separated values from Excel/Sheets</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea 
              className="font-mono text-sm min-h-[200px]" 
              placeholder="Timestamp&#9;GlucoseBefore&#9;Carbs&#9;Insulin&#9;MealType"
              value={pasteData}
              onChange={handlePasteChange}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" /> Upload CSV
            </CardTitle>
            <CardDescription>Upload a comma-separated file</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center min-h-[200px] border-2 border-dashed border-border rounded-md bg-muted/30">
            <input 
              type="file" 
              accept=".csv" 
              className="hidden" 
              id="csv-upload" 
              onChange={handleFileChange} 
            />
            <label htmlFor="csv-upload" className="cursor-pointer flex flex-col items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
              <Upload className="w-10 h-10" />
              <span className="font-medium">Click to select CSV file</span>
            </label>
          </CardContent>
        </Card>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Parsing Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {parsedEntries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Preview ({parsedEntries.length} entries)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border max-h-[300px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Glucose Before</TableHead>
                    <TableHead>Carbs</TableHead>
                    <TableHead>Insulin</TableHead>
                    <TableHead>Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedEntries.slice(0, 10).map((entry, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Now'}
                      </TableCell>
                      <TableCell className="font-bold">{entry.glucoseBefore}</TableCell>
                      <TableCell>{entry.carbsGrams}g</TableCell>
                      <TableCell>{entry.insulinUnits}u</TableCell>
                      <TableCell className="text-xs">{entry.mealType}</TableCell>
                    </TableRow>
                  ))}
                  {parsedEntries.length > 10 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        ...and {parsedEntries.length - 10} more rows
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end border-t p-4 bg-muted/10">
            <Button size="lg" onClick={submitImport} disabled={importBatch.isPending}>
              {importBatch.isPending ? "Importing..." : `Confirm Import ${parsedEntries.length} Entries`}
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
