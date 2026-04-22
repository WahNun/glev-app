import { Router, type IRouter } from "express";
import OpenAI from "openai";

const router: IRouter = Router();

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

router.post("/parse-food", async (req, res) => {
  const { text } = req.body ?? {};
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "text is required" });
  }

  const systemPrompt = `You are a food quantity parser for a diabetes management app.
Given a free-form text description of food, extract each food item and its quantity in grams.
Use typical serving sizes when quantity is vague (e.g. "a banana" = 120g, "handful of nuts" = 28g).
Return ONLY valid JSON — no markdown, no explanation, no code block.
The JSON must be an array of objects: [{"name": string, "grams": number}, ...]
Round grams to the nearest whole number.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";

    let parsed: { name: string; grams: number }[] = [];
    try {
      parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) parsed = [];
    } catch {
      return res.status(422).json({ error: "LLM returned unparseable JSON", raw });
    }

    return res.json({ raw, parsed });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? "OpenAI request failed" });
  }
});

export default router;
