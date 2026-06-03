# Mistral Support — voxtral-mini-tts-2603 Style Prefix Issue

**Subject:** voxtral-mini-tts-2603 — Style prefix read aloud verbatim; seeking guidance on correct approach

---

Hi Mistral Support Team,

We've been integrating `voxtral-mini-tts-2603` into a health app (T1D insulin decision-support) and ran into an issue with speaking-style control that we'd love your guidance on.

---

## What we tried

We wanted the TTS output to sound warm, calm, and conversational rather than robotic. Based on documentation and community examples suggesting voxtral is LLM-based and responds to natural-language style instructions, we prepended a style instruction to the `input` field before sending it to `POST /v1/audio/speech`:

```json
{
  "model": "voxtral-mini-tts-2603",
  "input": "Sprich warm, ruhig und natürlich — wie ein vertrauter Assistent beim Gespräch unter vier Augen. Keine übertriebene Betonung, keine Pausen zwischen Wörtern, fließend und menschlich.\n\nHere is the actual message.",
  "voice_id": "Jane",
  "response_format": "mp3"
}
```

---

## What happened

The model read the style instruction **verbatim** as part of the audio output — i.e., the user heard:

> *"Sprich warm, ruhig und natürlich — wie ein vertrauter Assistent beim Gespräch unter vier Augen. Keine übertriebene Betonung…"*

…followed by the actual content. The instruction was **not** interpreted as a style or behavior directive — it was treated as plain text to synthesize.

---

## Our fix

We removed the style prefix entirely. The `input` field now contains only the actual text to be spoken. Voice character is controlled via `voice_id: "Jane"` and optionally a `ref_audio` voice clone. This resolved the issue.

---

## Our questions

1. **Is text-prepend the intended mechanism for style control in voxtral-mini-tts-2603**, or is there a dedicated API field (e.g. `speaking_style`, `voice_instructions`, `system_prompt`) for this purpose that doesn't get synthesized as speech?

2. **Is there a recommended format** (e.g. special delimiters, XML-style tags like `<style>...</style>`, or a bracket/parenthesis convention) that tells the model to treat a section as a style instruction rather than text to read?

3. **Does `ref_audio` alone handle style/tone**, or is there a way to combine a voice clone with a style directive without risking the instruction being read aloud?

4. **Is this behavior model-version-specific?** Will a future release of voxtral support a structured style channel?

Any guidance appreciated — happy to share more context or test specific API shapes if that helps.

Thanks,
Lucas / Glev Team

---

## Mistral Support Response (2026-06-03)

> Your observation is correct: voxtral-mini-tts-2603 treats all input as speech content, not instructions.
> There is no dedicated field like `speaking_style` or `system_prompt` for TTS control.
> Any prepended text will be synthesized verbatim.
>
> For style control, Voxtral uses **"voice-as-an-instruction"**:
> Provide a `ref_audio` sample to convey tone (warm, calm, conversational).
> The model follows its intonation, rhythm, and emotion directly.
>
> Delimiters or tags (e.g. `<style>`) are not supported and will still be read aloud.
> This behavior is expected for current versions; style is driven by voice selection and audio prompting, not text instructions.

**Takeaway:** Style = `ref_audio` only. No text-based style control exists in the current API. Our fix (removing the prefix, relying on voice clone) is the correct and intended approach.
