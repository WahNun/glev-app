import { type ClassificationResult, MEAL_LABELS, type MealType } from "@/lib/mealClassifier";
import { Sparkles, AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  classification: ClassificationResult | null;
  activeMealType: MealType;
  isOverridden: boolean;
  onSelectType: (t: MealType) => void;
  onClearOverride: () => void;
}

const TYPE_COLORS: Record<MealType, { pill: string; dot: string }> = {
  FAST_CARBS:   { pill: "bg-orange-50 text-orange-700 border-orange-200",  dot: "bg-orange-400" },
  HIGH_FAT:     { pill: "bg-purple-50 text-purple-700 border-purple-200",  dot: "bg-purple-400" },
  HIGH_PROTEIN: { pill: "bg-blue-50 text-blue-700 border-blue-200",        dot: "bg-blue-400"   },
  BALANCED:     { pill: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-400" },
};

export function MacroClassifier({ classification, activeMealType, isOverridden, onSelectType, onClearOverride }: Props) {
  if (!classification) return null;

  const colors = TYPE_COLORS[classification.mealType];
  const overrideColors = TYPE_COLORS[activeMealType];

  return (
    <div className="rounded-xl border bg-muted/30 p-3 space-y-3">
      {/* Suggested type row */}
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          {classification.fastSugarMatch ? (
            <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />
          ) : (
            <Sparkles className="w-3.5 h-3.5 text-primary" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
              {classification.fastSugarMatch ? "Fast sugar detected" : "Auto-classified"}
            </span>
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border ${colors.pill}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
              {MEAL_LABELS[classification.mealType]}
            </span>
            {isOverridden && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-amber-50 text-amber-700 border-amber-200">
                Override active
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{classification.reasoning}</p>
        </div>
      </div>

      {/* Macro bar */}
      {classification.carbPct + classification.fatPct + classification.proteinPct > 0 && (
        <div className="space-y-1">
          <div className="flex h-2 rounded-full overflow-hidden gap-px">
            <div className="bg-orange-400 transition-all" style={{ width: `${classification.carbPct}%` }} title={`Carbs ${classification.carbPct.toFixed(0)}%`} />
            <div className="bg-blue-400 transition-all"   style={{ width: `${classification.proteinPct}%` }} title={`Protein ${classification.proteinPct.toFixed(0)}%`} />
            <div className="bg-purple-400 transition-all" style={{ width: `${classification.fatPct}%` }} title={`Fat ${classification.fatPct.toFixed(0)}%`} />
          </div>
          <div className="flex gap-3 text-[10px] text-muted-foreground">
            <span><span className="inline-block w-2 h-2 rounded-sm bg-orange-400 mr-1" />Carbs {classification.carbPct.toFixed(0)}%</span>
            <span><span className="inline-block w-2 h-2 rounded-sm bg-blue-400 mr-1" />Protein {classification.proteinPct.toFixed(0)}%</span>
            <span><span className="inline-block w-2 h-2 rounded-sm bg-purple-400 mr-1" />Fat {classification.fatPct.toFixed(0)}%</span>
          </div>
        </div>
      )}

      {/* Override selector */}
      <div>
        <div className="text-[11px] text-muted-foreground mb-1.5 font-medium">Override meal type:</div>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(MEAL_LABELS) as MealType[]).map((t) => {
            const tc = TYPE_COLORS[t];
            const isActive = activeMealType === t;
            return (
              <button
                key={t}
                onClick={() => (isActive && isOverridden ? onClearOverride() : onSelectType(t))}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                  isActive
                    ? `${tc.pill} shadow-sm`
                    : "bg-background text-muted-foreground border-border hover:border-muted-foreground"
                }`}
              >
                {MEAL_LABELS[t]}
                {isActive && isOverridden && (
                  <RotateCcw className="inline w-2.5 h-2.5 ml-1 opacity-60" />
                )}
              </button>
            );
          })}
        </div>
        {isOverridden && (
          <button
            onClick={onClearOverride}
            className="mt-1.5 text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Reset to auto-detect
          </button>
        )}
      </div>
    </div>
  );
}
