import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "@/app/api/insulin/_helpers";
import { getMistralChatClient } from "@/lib/ai/openaiClient";
import type { IntentEnvelope } from "@/lib/ai/intentClassifier";

/**
 * POST /api/ai/classify-intent
 *
 * Classifies a voice transcript into a Glev intent envelope using a
 * compact mistral-small-3 call. Called by lib/ai/intentClassifier when the
 * fast-path regex heuristics don't match.
 *
 * Auth: requires a valid Supabase session (401 otherwise).
 * Body: { transcript: string }
 * Response: { intent: IntentEnvelope }
 *
 * On any classification error the route returns a fallback_chat intent
 * instead of a 5xx, so the caller can continue with the chat pipeline.
 */

const CLASSIFICATION_PROMPT = `You are a voice intent classifier for Glev, a Type 1 Diabetes management app.
Classify the user's spoken transcript into exactly one of these intents and return a JSON object only. No explanation, no markdown, no wrapping.

Intent types:
- log_bolus: user wants to log an insulin bolus dose they already took
- log_meal: user wants to log a meal or food intake
- log_exercise: user wants to log physical activity / a workout
- log_symptom: user reports a body symptom (hypo feeling, headache, fatigue, dizziness, nausea, etc.)
- edit_macro: user wants to correct a specific macro field (carbs/protein/fat/calories) in an already-open form
- navigate: user wants to navigate to a specific app screen
- fallback_chat: anything else — questions, analysis, general conversation

Response shapes (JSON only):
log_bolus:    {"type":"log_bolus","payload":{"units":4,"insulin_name":"NovoRapid"}}
log_meal:     {"type":"log_meal","payload":{"input_text":"Pasta Bolognese","carbs_grams":70}}
log_exercise: {"type":"log_exercise","payload":{"duration_minutes":30,"exercise_type":"cardio","intensity":"medium"}}
log_symptom:  {"type":"log_symptom","payload":{"symptom_types":["dizziness","fatigue"]}}
edit_macro:   {"type":"edit_macro","payload":{"field":"carbs","value":60}}
navigate:     {"type":"navigate","payload":{"screen":"insights"}}
fallback_chat:{"type":"fallback_chat","payload":{"transcript":"..."}}

Allowed values:
  exercise_type: cardio | strength | yoga | cycling | swimming | run | hiit | football | tennis | volleyball | basketball | breathwork | hot_shower | cold_shower
  intensity: low | medium | high
  symptom_types (pick one or more): headache | fatigue | cramps | nausea | cravings | low_mood | sleep_disturbance | brain_fog | bloating | anxiety | irritability | back_pain | breast_tenderness | dizziness | mouth_dryness | polyuria | water_retention
  screen: dashboard | entries | engine | insights | settings

Rules:
- For log_bolus the "units" field is mandatory; only classify as log_bolus if a number is clearly stated.
- Never invent numbers that aren't in the transcript.
- For log_meal include carbs_grams only when the user states them explicitly.
- Respond with exactly one JSON object and nothing else.`;

const KNOWN_INTENT_TYPES = new Set([
  "log_bolus",
  "log_meal",
  "log_exercise",
  "log_symptom",
  "edit_macro",
  "navigate",
  "fallback_chat",
]);

export async function POST(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let transcript: string;
  try {
    const body = (await req.json()) as { transcript?: unknown };
    if (typeof body.transcript !== "string" || !body.transcript.trim()) {
      return NextResponse.json(
        { error: "Missing or empty transcript" },
        { status: 400 },
      );
    }
    transcript = body.transcript.trim().slice(0, 500);
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  try {
    const openai = getMistralChatClient();
    const response = await openai.chat.completions.create({
      model: "mistral-small-3",
      messages: [
        { role: "system", content: CLASSIFICATION_PROMPT },
        { role: "user", content: transcript },
      ],
      max_tokens: 150,
      temperature: 0.1,
      response_format: { type: "json_object" },
    });

    const raw = response.choices?.[0]?.message?.content ?? "";
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) throw new Error("Empty model response");

    const intent = JSON.parse(text) as IntentEnvelope;

    if (!intent?.type || !KNOWN_INTENT_TYPES.has(intent.type)) {
      return NextResponse.json({
        intent: { type: "fallback_chat", payload: { transcript } },
      });
    }

    return NextResponse.json({ intent });
  } catch {
    return NextResponse.json({
      intent: { type: "fallback_chat", payload: { transcript } },
    });
  }
}
