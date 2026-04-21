import React, { useState, useEffect, useCallback, useRef } from "react";
import { RecommendationRequestMealType } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Zap, Droplet, Cookie, ShieldCheck, AlertTriangle, Info,
  ChevronRight, Clock, Layers, BookOpen, Gauge, ToggleLeft
} from "lucide-react";

type MealType = "FAST_CARBS" | "HIGH_FAT" | "HIGH_PROTEIN" | "BALANCED";
type Mode = "minimal" | "standard" | "advanced";

interface RecommendationResult {
  recommendedUnits: number;
  minUnits: number;
  maxUnits: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  timing: string;
  reasoning: string;
  basedOnEntries: number;
  similarMealCount: number;
  recentCount: number;
  carbRatio: number;
}

const BASE_URL = import.meta.env.BASE_URL;

async function fetchRecommendation(
  carbsGrams: number,
  glucoseBefore: number,
  mealType: MealType
): Promise<RecommendationResult | null> {
  if (carbsGrams <= 0 || glucoseBefore <= 0) return null;
  try {
    const res = await fetch(`${BASE_URL}api/recommendations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carbsGrams, glucoseBefore, mealType }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function ConfidencePill({ confidence, count }: { confidence: "HIGH" | "MEDIUM" | "LOW"; count: number }) {
  const map = {
    HIGH: { icon: ShieldCheck, color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
    MEDIUM: { icon: Info, color: "text-blue-600 bg-blue-50 border-blue-200" },
    LOW: { icon: AlertTriangle, color: "text-amber-600 bg-amber-50 border-amber-200" },
  };
  const { icon: Icon, color } = map[confidence];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${color}`}>
      <Icon className="w-3.5 h-3.5" />
      {confidence} · {count} records
    </span>
  );
}

function TimingBadge({ timing }: { timing: string }) {
  const label = timing.replace(/_/g, " ");
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border bg-muted text-muted-foreground">
      <Clock className="w-3.5 h-3.5" />
      {label}
    </span>
  );
}

function ResultPanel({ result, loading, compact = false }: {
  result: RecommendationResult | null;
  loading: boolean;
  compact?: boolean;
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <span className="text-sm">Calculating from your data…</span>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-center text-muted-foreground">
        <Zap className="w-10 h-10 opacity-15" />
        <p className="text-sm max-w-[200px]">Enter glucose and carbs to get a live recommendation.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Big dose number */}
      <div className="flex flex-col items-center py-5 rounded-xl bg-primary/5 border border-primary/15">
        <span className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-medium">Suggested Bolus</span>
        <div className="flex items-baseline gap-1.5">
          <span className="text-6xl font-black tracking-tight text-foreground">{result.recommendedUnits.toFixed(1)}</span>
          <span className="text-2xl text-muted-foreground font-normal">u</span>
        </div>
        <span className="text-sm text-muted-foreground font-mono mt-1">
          Range {result.minUnits.toFixed(1)} – {result.maxUnits.toFixed(1)} u
        </span>
      </div>

      {/* Metadata row */}
      <div className="flex flex-wrap gap-2">
        <ConfidencePill confidence={result.confidence} count={result.basedOnEntries} />
        <TimingBadge timing={result.timing} />
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border bg-muted text-muted-foreground">
          <Gauge className="w-3.5 h-3.5" />
          1u per {result.carbRatio}g
        </span>
      </div>

      {/* Stats row */}
      {!compact && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-3 rounded-lg bg-muted/60 border">
            <div className="text-muted-foreground mb-0.5">Similar meals</div>
            <div className="font-bold text-base text-foreground">{result.similarMealCount}</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/60 border">
            <div className="text-muted-foreground mb-0.5">Recent entries used</div>
            <div className="font-bold text-base text-foreground">{result.recentCount}</div>
          </div>
        </div>
      )}

      {/* Reasoning */}
      <div className="p-3 rounded-lg bg-muted/40 border text-xs text-muted-foreground leading-relaxed">
        <div className="flex items-center gap-1.5 text-foreground font-medium mb-1.5">
          <BookOpen className="w-3.5 h-3.5" /> Reasoning
        </div>
        {result.reasoning}
      </div>
    </div>
  );
}

// ───────────────────────── MINIMAL MODE ─────────────────────────
function MinimalMode() {
  const [glucose, setGlucose] = useState<string>("");
  const [carbs, setCatbs] = useState<string>("");
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [loading, setLoading] = useState(false);

  const dGlucose = useDebounce(glucose, 300);
  const dCarbs = useDebounce(carbs, 300);

  useEffect(() => {
    const g = Number(dGlucose);
    const c = Number(dCarbs);
    if (!g || !c || g < 20 || c < 5) { setResult(null); return; }
    setLoading(true);
    fetchRecommendation(c, g, "BALANCED")
      .then((r) => { setResult(r); setLoading(false); })
      .catch(() => setLoading(false));
  }, [dGlucose, dCarbs]);

  const glucoseColor =
    Number(glucose) < 70 ? "border-red-400 ring-red-200"
    : Number(glucose) > 180 ? "border-orange-400 ring-orange-200"
    : "";

  return (
    <div className="grid md:grid-cols-2 gap-6 items-start">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" /> Quick Bolus
          </CardTitle>
          <p className="text-xs text-muted-foreground -mt-1">Two inputs. Instant result. Uses your personal carb ratio.</p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-sm">
              <Droplet className="w-3.5 h-3.5 text-primary" /> Current glucose (mg/dL)
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              placeholder="e.g. 115"
              value={glucose}
              onChange={(e) => setGlucose(e.target.value)}
              className={`text-2xl font-mono h-14 transition-all ${glucoseColor}`}
              autoFocus
            />
            {Number(glucose) < 70 && glucose && (
              <p className="text-xs text-red-500 font-medium">Below hypo threshold — dose will be reduced</p>
            )}
            {Number(glucose) > 180 && glucose && (
              <p className="text-xs text-orange-500 font-medium">High glucose — correction added</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-sm">
              <Cookie className="w-3.5 h-3.5 text-orange-500" /> Planned carbs (g)
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              placeholder="e.g. 60"
              value={carbs}
              onChange={(e) => setCatbs(e.target.value)}
              className="text-2xl font-mono h-14"
            />
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <ToggleLeft className="w-3.5 h-3.5" />
            Using Balanced meal type. Switch to Standard for more options.
          </p>
        </CardContent>
      </Card>

      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="text-base">Recommendation</CardTitle>
        </CardHeader>
        <CardContent>
          <ResultPanel result={result} loading={loading} compact />
        </CardContent>
      </Card>
    </div>
  );
}

// ───────────────────────── STANDARD MODE ─────────────────────────
function StandardMode() {
  const [glucose, setGlucose] = useState<string>("");
  const [carbs, setCarbs] = useState<string>("");
  const [mealType, setMealType] = useState<MealType>("BALANCED");
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [loading, setLoading] = useState(false);

  const dGlucose = useDebounce(glucose, 350);
  const dCarbs = useDebounce(carbs, 350);
  const dMealType = useDebounce(mealType, 100);

  useEffect(() => {
    const g = Number(dGlucose);
    const c = Number(dCarbs);
    if (!g || !c || g < 20 || c < 5) { setResult(null); return; }
    setLoading(true);
    fetchRecommendation(c, g, dMealType)
      .then((r) => { setResult(r); setLoading(false); })
      .catch(() => setLoading(false));
  }, [dGlucose, dCarbs, dMealType]);

  const MEAL_LABELS: Record<MealType, string> = {
    BALANCED: "Balanced",
    FAST_CARBS: "Fast Carbs",
    HIGH_FAT: "High Fat",
    HIGH_PROTEIN: "High Protein",
  };

  return (
    <div className="grid md:grid-cols-2 gap-6 items-start">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" /> Bolus Parameters
          </CardTitle>
          <p className="text-xs text-muted-foreground -mt-1">Live calculation — no submit needed.</p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-sm">
              <Droplet className="w-3.5 h-3.5 text-primary" /> Current glucose (mg/dL)
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              placeholder="e.g. 115"
              value={glucose}
              onChange={(e) => setGlucose(e.target.value)}
              className="text-xl font-mono h-12"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-sm">
              <Cookie className="w-3.5 h-3.5 text-orange-500" /> Planned carbs (g)
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              placeholder="e.g. 60"
              value={carbs}
              onChange={(e) => setCarbs(e.target.value)}
              className="text-xl font-mono h-12"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Meal composition</Label>
            <Select value={mealType} onValueChange={(v) => setMealType(v as MealType)}>
              <SelectTrigger className="h-12">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(MEAL_LABELS) as MealType[]).map((k) => (
                  <SelectItem key={k} value={k}>{MEAL_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="pt-2 border-t text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Adjustments applied</p>
            <p>• Glucose correction: BG &lt;90 reduces dose, BG &gt;140 increases</p>
            <p>• Fast carbs: +0.5u, take 15 min before eating</p>
            <p>• High fat: −0.5u, split dose recommended</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="text-base">Recommendation</CardTitle>
        </CardHeader>
        <CardContent>
          <ResultPanel result={result} loading={loading} />
        </CardContent>
      </Card>
    </div>
  );
}

// ───────────────────────── ADVANCED MODE ─────────────────────────
function AdvancedMode() {
  const [glucose, setGlucose] = useState<string>("");
  const [carbs, setCarbs] = useState<string>("");
  const [mealType, setMealType] = useState<MealType>("BALANCED");
  const [manualOverride, setManualOverride] = useState<number | null>(null);
  const [overrideSlider, setOverrideSlider] = useState<number[]>([0]);
  const [useOverride, setUseOverride] = useState(false);
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [loading, setLoading] = useState(false);

  const dGlucose = useDebounce(glucose, 350);
  const dCarbs = useDebounce(carbs, 350);
  const dMealType = useDebounce(mealType, 100);

  useEffect(() => {
    const g = Number(dGlucose);
    const c = Number(dCarbs);
    if (!g || !c || g < 20 || c < 5) { setResult(null); return; }
    setLoading(true);
    fetchRecommendation(c, g, dMealType)
      .then((r) => {
        setResult(r);
        if (r) setOverrideSlider([r.recommendedUnits]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [dGlucose, dCarbs, dMealType]);

  const displayUnits = useOverride && result ? overrideSlider[0] : result?.recommendedUnits ?? null;
  const glucoseBefore = Number(glucose);

  const mealTips: Record<MealType, string> = {
    FAST_CARBS: "Peaks at 30–60 min. Take full dose 10–15 min before eating. Watch for rapid spike.",
    HIGH_FAT: "Peaks at 2–4 hrs. Split: 60% now, 40% after 90 min. Pizza effect is real.",
    HIGH_PROTEIN: "Modest effect at 2–3 hrs. Protein converts to glucose slowly. Monitor at 3 hrs.",
    BALANCED: "Peaks at 60–90 min. Standard pre-meal bolus. Aim for 15 min before eating.",
  };

  return (
    <div className="space-y-5">
      <div className="grid md:grid-cols-3 gap-5">
        {/* Inputs */}
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm">Inputs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Glucose (mg/dL)</Label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="e.g. 115"
                value={glucose}
                onChange={(e) => setGlucose(e.target.value)}
                className="text-lg font-mono h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Carbs (g)</Label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="e.g. 60"
                value={carbs}
                onChange={(e) => setCarbs(e.target.value)}
                className="text-lg font-mono h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Meal composition</Label>
              <Select value={mealType} onValueChange={(v) => setMealType(v as MealType)}>
                <SelectTrigger className="h-10 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BALANCED">Balanced</SelectItem>
                  <SelectItem value="FAST_CARBS">Fast Carbs</SelectItem>
                  <SelectItem value="HIGH_FAT">High Fat</SelectItem>
                  <SelectItem value="HIGH_PROTEIN">High Protein</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Result + override */}
        <Card className="md:col-span-1 border-primary/20">
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Calculated Dose</span>
              {result && (
                <ConfidencePill confidence={result.confidence} count={result.basedOnEntries} />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="flex justify-center py-6">
                <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              </div>
            ) : result ? (
              <>
                <div className="flex flex-col items-center py-4 rounded-xl bg-primary/5 border border-primary/10">
                  <div className="flex items-baseline gap-1">
                    <span className="text-5xl font-black tracking-tight">
                      {useOverride ? overrideSlider[0].toFixed(1) : result.recommendedUnits.toFixed(1)}
                    </span>
                    <span className="text-xl text-muted-foreground">u</span>
                  </div>
                  <span className="text-xs text-muted-foreground font-mono mt-0.5">
                    {result.minUnits.toFixed(1)} – {result.maxUnits.toFixed(1)} u
                  </span>
                  {useOverride && (
                    <Badge variant="outline" className="mt-2 text-amber-600 border-amber-300 bg-amber-50 text-xs">
                      Manual override active
                    </Badge>
                  )}
                </div>

                {/* Manual override slider */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">Manual override</Label>
                    <button
                      onClick={() => setUseOverride((v) => !v)}
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full border transition-colors ${
                        useOverride
                          ? "bg-amber-100 text-amber-700 border-amber-300"
                          : "bg-muted text-muted-foreground border-transparent"
                      }`}
                    >
                      {useOverride ? "ON" : "OFF"}
                    </button>
                  </div>
                  <Slider
                    min={0.5}
                    max={Math.max(result.maxUnits * 1.5, 15)}
                    step={0.5}
                    value={overrideSlider}
                    onValueChange={(v) => { setOverrideSlider(v); setUseOverride(true); }}
                    disabled={!useOverride}
                    className="my-1"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>0.5u</span>
                    <span>{Math.max(result.maxUnits * 1.5, 15).toFixed(1)}u</span>
                  </div>
                </div>

                <TimingBadge timing={result.timing} />
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Zap className="w-8 h-8 opacity-15 mb-2" />
                <p className="text-xs text-center">Fill in inputs to calculate</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Context panel */}
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm">Context & Timing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-xs text-muted-foreground">
            {/* Glucose status */}
            {glucose && (
              <div className="p-2.5 rounded-lg border bg-muted/40 space-y-1">
                <p className="font-medium text-foreground text-[11px] uppercase tracking-wide">Glucose Status</p>
                {glucoseBefore < 70 && <p className="text-red-600 font-semibold">HYPO — Treat low first. Delay bolus.</p>}
                {glucoseBefore >= 70 && glucoseBefore < 90 && <p className="text-orange-600">Low-normal. Dose reduced slightly.</p>}
                {glucoseBefore >= 90 && glucoseBefore <= 140 && <p className="text-emerald-600">In range. No correction needed.</p>}
                {glucoseBefore > 140 && glucoseBefore <= 180 && <p className="text-orange-600">Elevated. +0.5u correction applied.</p>}
                {glucoseBefore > 180 && <p className="text-red-600">High. +1u correction applied. Check CGM trend.</p>}
              </div>
            )}

            {/* Meal type advice */}
            <div className="p-2.5 rounded-lg border bg-muted/40 space-y-1">
              <p className="font-medium text-foreground text-[11px] uppercase tracking-wide">{mealType.replace("_", " ")} Profile</p>
              <p>{mealTips[mealType]}</p>
            </div>

            {/* Split dose calculator */}
            {mealType === "HIGH_FAT" && result && (
              <div className="p-2.5 rounded-lg border bg-amber-50 border-amber-200 space-y-1">
                <p className="font-medium text-amber-700 text-[11px] uppercase tracking-wide">Split Dose Guide</p>
                <p className="text-amber-800">
                  Now: <strong>{((useOverride ? overrideSlider[0] : result.recommendedUnits) * 0.6).toFixed(1)}u</strong>
                </p>
                <p className="text-amber-800">
                  In 90 min: <strong>{((useOverride ? overrideSlider[0] : result.recommendedUnits) * 0.4).toFixed(1)}u</strong>
                </p>
              </div>
            )}

            {/* Data source summary */}
            {result && (
              <div className="p-2.5 rounded-lg border bg-muted/40 space-y-1">
                <p className="font-medium text-foreground text-[11px] uppercase tracking-wide">Data Sources</p>
                <p>Similar meals: {result.similarMealCount}</p>
                <p>Recent entries: {result.recentCount}</p>
                <p>Carb ratio: 1u per {result.carbRatio}g</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Reasoning expanded */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <BookOpen className="w-4 h-4" /> Full Reasoning
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed">{result.reasoning}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ───────────────────────── MAIN PAGE ─────────────────────────────
export default function Recommend() {
  const [mode, setMode] = useState<Mode>("standard");

  const tabs: { id: Mode; label: string; icon: React.ReactNode; desc: string }[] = [
    { id: "minimal", label: "Minimal", icon: <Zap className="w-4 h-4" />, desc: "2 inputs, instant" },
    { id: "standard", label: "Standard", icon: <Layers className="w-4 h-4" />, desc: "Glucose + carbs + meal type" },
    { id: "advanced", label: "Advanced", icon: <Gauge className="w-4 h-4" />, desc: "Full controls + override" },
  ];

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Decision Support</h1>
        <p className="text-muted-foreground text-sm">Personalised bolus calculator · learns from your data · updates in real time</p>
      </div>

      {/* Mode switcher */}
      <div className="flex gap-1 p-1 bg-muted rounded-xl w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setMode(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              mode === tab.id
                ? "bg-background shadow text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
            <span className={`text-xs hidden md:inline ${mode === tab.id ? "text-muted-foreground" : "opacity-0"}`}>
              — {tab.desc}
            </span>
          </button>
        ))}
      </div>

      {/* Mode content */}
      <div>
        {mode === "minimal" && <MinimalMode />}
        {mode === "standard" && <StandardMode />}
        {mode === "advanced" && <AdvancedMode />}
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-muted-foreground text-center border-t pt-4">
        This tool provides decision support only and is not a substitute for medical advice. Always verify with your healthcare team.
      </p>
    </div>
  );
}
