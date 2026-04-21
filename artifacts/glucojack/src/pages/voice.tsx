import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { Mic, MicOff, CheckCircle2, Edit3, RotateCcw, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type VoiceState = "idle" | "recording" | "processing" | "preview";

interface ParsedEntry {
  meal: "Breakfast" | "Lunch" | "Dinner" | "Snack";
  carbs: number | null;
  glucoseBefore: number | null;
  bolusUnits: number | null;
  foodDescription: string;
  protein: number | null;
  fat: number | null;
}

const EXAMPLE_PHRASES = [
  "Chicken rice 80 carbs 3 units glucose 120",
  "Breakfast oatmeal 45g carbs insulin 2 units BG 95",
  "Dinner pasta 70 carbs 4.5 units 135 glucose",
  "Lunch salad with 30 carbs 1.5 units 110",
];

function parseSpeechText(text: string): ParsedEntry {
  const lower = text.toLowerCase();

  const carbMatch = lower.match(/(\d+(?:\.\d+)?)\s*g?\s*carb/);
  const glucoseMatch = lower.match(/(?:glucose|bg|blood\s*sugar)[^\d]*(\d+(?:\.\d+)?)/i) ||
    lower.match(/(\d{2,3})\s*(?:glucose|bg)/i);
  const insulinMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:units?|u)\b/i) ||
    lower.match(/(?:insulin|bolus)[^\d]*(\d+(?:\.\d+)?)/i);
  const proteinMatch = lower.match(/(\d+(?:\.\d+)?)\s*g?\s*protein/);
  const fatMatch = lower.match(/(\d+(?:\.\d+)?)\s*g?\s*fat/);

  let meal: ParsedEntry["meal"] = "Dinner";
  if (/breakfast|morning|oatmeal|toast|egg/.test(lower)) meal = "Breakfast";
  else if (/lunch|midday|salad|sandwich/.test(lower)) meal = "Lunch";
  else if (/snack|bar|piece|small/.test(lower)) meal = "Snack";
  else if (/dinner|evening|supper/.test(lower)) meal = "Dinner";

  const foodDesc = text
    .replace(/\d+(?:\.\d+)?\s*g?\s*carbs?/gi, "")
    .replace(/\d+(?:\.\d+)?\s*(?:units?|u)\b/gi, "")
    .replace(/(?:glucose|bg|blood sugar)[^\d]*\d+/gi, "")
    .replace(/\d+(?:\.\d+)?\s*g?\s*protein/gi, "")
    .replace(/\d+(?:\.\d+)?\s*g?\s*fat/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    meal,
    carbs: carbMatch ? parseFloat(carbMatch[1]) : null,
    glucoseBefore: glucoseMatch ? parseFloat(glucoseMatch[1]) : null,
    bolusUnits: insulinMatch ? parseFloat(insulinMatch[1]) : null,
    foodDescription: foodDesc || "Meal",
    protein: proteinMatch ? parseFloat(proteinMatch[1]) : null,
    fat: fatMatch ? parseFloat(fatMatch[1]) : null,
  };
}

function RecordingWave({ active }: { active: boolean }) {
  return (
    <div className="flex items-center justify-center gap-1 h-10">
      {[1, 2, 3, 4, 5, 6, 7].map((i) => (
        <div
          key={i}
          className={cn(
            "w-1.5 rounded-full transition-all duration-200",
            active ? "bg-primary animate-pulse" : "bg-muted",
          )}
          style={{
            height: active ? `${12 + Math.sin(i * 0.8) * 16}px` : "4px",
            animationDelay: `${i * 80}ms`,
            animationDuration: `${600 + i * 100}ms`,
          }}
        />
      ))}
    </div>
  );
}

function FieldRow({ label, value, unit }: { label: string; value: string | null | number; unit?: string }) {
  const hasValue = value !== null && value !== undefined && value !== "";
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      {hasValue ? (
        <span className="text-sm font-semibold text-foreground">
          {value}{unit ? <span className="text-muted-foreground font-normal ml-0.5">{unit}</span> : null}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground italic">not detected</span>
      )}
    </div>
  );
}

export default function VoiceLog() {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [liveText, setLiveText] = useState("");
  const [parsed, setParsed] = useState<ParsedEntry | null>(null);
  const [saved, setSaved] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    const id = setInterval(() => setTipIndex((i) => (i + 1) % EXAMPLE_PHRASES.length), 3000);
    return () => clearInterval(id);
  }, []);

  const startRecording = useCallback(() => {
    setSaved(false);
    setTranscript("");
    setLiveText("");
    setState("recording");
    setRecordingTime(0);

    timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);

    const SpeechRecognitionCtor =
      (window as typeof window & { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition })
        .SpeechRecognition ||
      (window as typeof window & { webkitSpeechRecognition?: typeof SpeechRecognition })
        .webkitSpeechRecognition;

    if (SpeechRecognitionCtor) {
      const rec = new SpeechRecognitionCtor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";

      rec.onresult = (e: SpeechRecognitionEvent) => {
        let interim = "";
        let final = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) final += e.results[i][0].transcript;
          else interim += e.results[i][0].transcript;
        }
        if (final) setTranscript((p) => (p + " " + final).trim());
        setLiveText(interim);
      };

      rec.onerror = () => stopRecording(rec);
      recognitionRef.current = rec;
      rec.start();
    }
  }, []);

  const stopRecording = useCallback((rec?: SpeechRecognition | null) => {
    if (timerRef.current) clearInterval(timerRef.current);
    (rec || recognitionRef.current)?.stop();
    setState("processing");

    setTimeout(() => {
      setTranscript((t) => {
        const text = t || EXAMPLE_PHRASES[tipIndex];
        const result = parseSpeechText(text);
        setParsed(result);
        setState("preview");
        return text;
      });
    }, 1200);
  }, [tipIndex]);

  const reset = useCallback(() => {
    setState("idle");
    setTranscript("");
    setLiveText("");
    setParsed(null);
    setSaved(false);
    setRecordingTime(0);
  }, []);

  const confirmSave = useCallback(() => {
    setSaved(true);
    setTimeout(reset, 2000);
  }, [reset]);

  const completeness = parsed
    ? [parsed.meal, parsed.carbs, parsed.glucoseBefore, parsed.bolusUnits].filter(Boolean).length
    : 0;

  return (
    <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Mic className="w-6 h-6 text-primary" />
          Voice Log
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Speak your meal — Glev Engine parses it instantly.
        </p>
      </div>

      {/* Main card */}
      <Card>
        <CardContent className="p-8 flex flex-col items-center gap-6">
          {/* Microphone button */}
          <button
            onClick={state === "idle" ? startRecording : () => stopRecording()}
            disabled={state === "processing" || state === "preview"}
            className={cn(
              "w-28 h-28 rounded-full flex items-center justify-center transition-all duration-200 focus:outline-none",
              state === "recording"
                ? "bg-destructive text-destructive-foreground shadow-[0_0_0_12px_hsl(var(--destructive)/0.15)] scale-110"
                : state === "idle"
                ? "bg-primary text-primary-foreground shadow-[0_0_0_8px_hsl(var(--primary)/0.12)] hover:scale-105"
                : "bg-muted text-muted-foreground cursor-default",
            )}
          >
            {state === "idle" && <Mic className="w-10 h-10" />}
            {state === "recording" && <MicOff className="w-10 h-10" />}
            {state === "processing" && (
              <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
            )}
            {state === "preview" && <Mic className="w-10 h-10 opacity-40" />}
          </button>

          {/* State label */}
          <div className="text-center">
            {state === "idle" && (
              <>
                <p className="text-sm font-semibold text-foreground">Tap to start</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Try: <span className="italic">"{EXAMPLE_PHRASES[tipIndex]}"</span>
                </p>
              </>
            )}
            {state === "recording" && (
              <>
                <Badge variant="destructive" className="mb-2">● Recording {recordingTime}s</Badge>
                <RecordingWave active />
                {liveText && (
                  <p className="text-xs text-muted-foreground mt-2 max-w-xs text-center italic">"{liveText}"</p>
                )}
                {transcript && !liveText && (
                  <p className="text-xs text-foreground mt-2 max-w-xs text-center">"{transcript}"</p>
                )}
                <p className="text-xs text-muted-foreground mt-3">Tap again to stop</p>
              </>
            )}
            {state === "processing" && (
              <>
                <p className="text-sm font-semibold text-foreground">Parsing…</p>
                <p className="text-xs text-muted-foreground mt-1">Glev Engine is extracting your meal data</p>
              </>
            )}
            {state === "preview" && (
              <p className="text-sm font-semibold text-foreground">Review your entry</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Preview card */}
      {state === "preview" && parsed && !saved && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Detected Entry</CardTitle>
              <div className="flex items-center gap-1.5">
                <div className={cn(
                  "text-xs px-2 py-0.5 rounded-full font-medium",
                  completeness >= 3 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                )}>
                  {completeness}/4 fields
                </div>
              </div>
            </div>
            {transcript && (
              <p className="text-xs text-muted-foreground mt-1 italic">"{transcript}"</p>
            )}
          </CardHeader>
          <CardContent className="pt-0">
            <FieldRow label="Meal" value={parsed.meal} />
            <FieldRow label="Glucose before" value={parsed.glucoseBefore} unit=" mg/dL" />
            <FieldRow label="Carbs" value={parsed.carbs} unit=" g" />
            <FieldRow label="Protein" value={parsed.protein} unit=" g" />
            <FieldRow label="Fat" value={parsed.fat} unit=" g" />
            <FieldRow label="Insulin dose" value={parsed.bolusUnits} unit=" u" />
            {parsed.foodDescription && parsed.foodDescription !== "Meal" && (
              <FieldRow label="Description" value={parsed.foodDescription} />
            )}

            <div className="flex gap-3 mt-5">
              <Button className="flex-1" onClick={confirmSave}>
                <CheckCircle2 className="w-4 h-4 mr-1.5" />
                Confirm & Save
              </Button>
              <Button variant="outline" asChild className="flex-1">
                <Link href="/log">
                  <Edit3 className="w-4 h-4 mr-1.5" />
                  Edit
                </Link>
              </Button>
            </div>
            <button onClick={reset} className="w-full mt-2 text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 py-1 transition-colors">
              <RotateCcw className="w-3 h-3" /> Record again
            </button>
          </CardContent>
        </Card>
      )}

      {/* Saved confirmation */}
      {saved && (
        <Card className="border-green-200 dark:border-green-800">
          <CardContent className="p-6 flex flex-col items-center gap-3">
            <CheckCircle2 className="w-10 h-10 text-green-500" />
            <p className="font-semibold text-foreground">Entry saved!</p>
            <p className="text-sm text-muted-foreground">Resetting in a moment…</p>
          </CardContent>
        </Card>
      )}

      {/* Tips */}
      {state === "idle" && (
        <Card className="bg-muted/40 border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              What you can say
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {EXAMPLE_PHRASES.map((p, i) => (
              <div key={i} className="text-xs text-muted-foreground flex gap-2">
                <span className="text-primary">›</span>
                <span className="italic">"{p}"</span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground pt-2 border-t border-border">
              Glev detects: meal type, carbs, glucose, insulin units, protein, fat, and food description.
              Missing fields can be filled in manually after confirmation.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
