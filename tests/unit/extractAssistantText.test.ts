import { test, expect } from "@playwright/test";
import { extractAssistantText } from "@/hooks/useTTS";

// ── clean assistant text ──────────────────────────────────────────────────────

test("extractAssistantText: clean reply passes through unchanged", () => {
  const reply = "Deine letzte Mahlzeit hatte 45 g Kohlenhydrate.";
  expect(extractAssistantText(reply)).toBe(reply);
});

test("extractAssistantText: multi-line clean reply is joined with single spaces", () => {
  const input = "Erste Zeile.\nZweite Zeile.\nDritte Zeile.";
  expect(extractAssistantText(input)).toBe("Erste Zeile. Zweite Zeile. Dritte Zeile.");
});

test("extractAssistantText: empty string returns empty string", () => {
  expect(extractAssistantText("")).toBe("");
});

test("extractAssistantText: whitespace-only string returns empty string", () => {
  expect(extractAssistantText("   \n\n\t  ")).toBe("");
});

// ── system-prompt line stripping ──────────────────────────────────────────────

test("extractAssistantText: strips lines starting with 'Strikte Grenzen' (case-insensitive)", () => {
  const input = "Strikte Grenzen: Du darfst keine Dosen nennen.\nDas ist eine normale Antwort.";
  expect(extractAssistantText(input)).toBe("Das ist eine normale Antwort.");
});

test("extractAssistantText: strips lines starting with 'Deine Aufgabe' (case-insensitive)", () => {
  const input = "Deine Aufgabe ist es, dem Nutzer zu helfen.\nHier die echte Antwort.";
  expect(extractAssistantText(input)).toBe("Hier die echte Antwort.");
});

test("extractAssistantText: strips lines starting with 'Tools (' (tool-section header)", () => {
  const input = "Tools (Read):\n- get_meals\nHier steht die Antwort.";
  // "- get_meals" is also stripped by the tool-function-name regex
  expect(extractAssistantText(input)).toBe("Hier steht die Antwort.");
});

test("extractAssistantText: strips lines starting with 'write-tools'", () => {
  const input = "write-tools:\n- upsert_meal\nOkay, ich habe das notiert.";
  expect(extractAssistantText(input)).toBe("- upsert_meal Okay, ich habe das notiert.");
});

test("extractAssistantText: strips lines starting with 'read-tools'", () => {
  const input = "read-tools:\n- get_meals\nDeine Mahlzeiten wurden geladen.";
  // "- get_meals" is also stripped by the tool-function-name regex
  expect(extractAssistantText(input)).toBe("Deine Mahlzeiten wurden geladen.");
});

test("extractAssistantText: strips lines starting with 'user-memory'", () => {
  const input = "user-memory: { icr: 10 }\nDein ICR liegt bei etwa 10.";
  expect(extractAssistantText(input)).toBe("Dein ICR liegt bei etwa 10.");
});

test("extractAssistantText: strip prefixes are case-insensitive", () => {
  const input = "STRIKTE GRENZEN bitte nicht.\nNormale Antwort hier.";
  expect(extractAssistantText(input)).toBe("Normale Antwort hier.");
});

// ── markdown heading stripping ────────────────────────────────────────────────

test("extractAssistantText: strips h2 markdown headings (##)", () => {
  const input = "## System Prompt\nDas hier ist die echte Antwort.";
  expect(extractAssistantText(input)).toBe("Das hier ist die echte Antwort.");
});

test("extractAssistantText: strips h3 markdown headings (###)", () => {
  const input = "### Abschnitt\nAntwort folgt hier.";
  expect(extractAssistantText(input)).toBe("Antwort folgt hier.");
});

test("extractAssistantText: strips any heading level up to h6", () => {
  const headings = ["# H1", "## H2", "### H3", "#### H4", "##### H5", "###### H6"];
  for (const h of headings) {
    expect(extractAssistantText(`${h}\nNachricht.`)).toBe("Nachricht.");
  }
});

test("extractAssistantText: does NOT strip a line that starts with # but has no space (not a heading)", () => {
  const input = "#hashtag ist keine Überschrift.\nNormale Zeile.";
  expect(extractAssistantText(input)).toBe("#hashtag ist keine Überschrift. Normale Zeile.");
});

// ── mixed content (real reply + echoed prompt fragment) ───────────────────────

test("extractAssistantText: strips system-prompt echo lines, keeps real reply", () => {
  const input = [
    "## Glev AI – Persona",
    "Strikte Grenzen: keine Dosisangaben.",
    "Deine Aufgabe: unterstützen.",
    "Alles klar! Deine letzte Mahlzeit hatte 60 g Kohlenhydrate.",
    "Du hast 5 IE Insulin gespritzt — das sieht gut aus.",
  ].join("\n");

  const result = extractAssistantText(input);
  expect(result).toBe(
    "Alles klar! Deine letzte Mahlzeit hatte 60 g Kohlenhydrate. Du hast 5 IE Insulin gespritzt — das sieht gut aus."
  );
});

test("extractAssistantText: handles prompt fragment interspersed between reply lines", () => {
  const input = [
    "Kurze Einleitung.",
    "Deine Aufgabe ist es, zu helfen.",
    "Weiterer normaler Text.",
  ].join("\n");

  expect(extractAssistantText(input)).toBe("Kurze Einleitung. Weiterer normaler Text.");
});

// ── 600-char soft cap ─────────────────────────────────────────────────────────

test("extractAssistantText: text under 600 chars is returned as-is", () => {
  const input = "A".repeat(599);
  const result = extractAssistantText(input);
  expect(result).toBe(input);
  expect(result.endsWith(" …")).toBe(false);
});

test("extractAssistantText: text exactly 600 chars is returned as-is", () => {
  const input = "A".repeat(600);
  expect(extractAssistantText(input)).toBe(input);
});

test("extractAssistantText: text over 600 chars is truncated and appended with ' …'", () => {
  const input = "A".repeat(700);
  const result = extractAssistantText(input);
  expect(result.endsWith(" …")).toBe(true);
  expect(result.length).toBeLessThanOrEqual(603); // 600 chars + " …"
});

test("extractAssistantText: truncated output slice is at most 600 chars before the ellipsis", () => {
  const input = "Wort ".repeat(200); // 1000 chars
  const result = extractAssistantText(input);
  const withoutEllipsis = result.replace(/ …$/, "");
  expect(withoutEllipsis.length).toBeLessThanOrEqual(600);
  expect(result.endsWith(" …")).toBe(true);
});
