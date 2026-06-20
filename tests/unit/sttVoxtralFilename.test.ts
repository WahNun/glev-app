// tests/unit/sttVoxtralFilename.test.ts
//
// Regression test für den "Audio input could not be decoded" Voxtral 400-Fehler.
//
// Root cause: alle drei Transcribe-Routes übergaben `file as Blob` an die
// Mistral audio.transcriptions API ohne Dateinamen. Voxtral erkennt den Codec
// anhand der Dateiendung — fehlt sie, kommt HTTP 400 / Error 3310.
//
// Fix: `new File([blob], voxtralFileName(mimeType), { type })` in allen Routes.

import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const MISTRAL_ROUTE_SRC = readFileSync(
  join(process.cwd(), "app/api/transcribe/mistral/route.ts"),
  "utf-8",
);
const STREAM_ROUTE_SRC = readFileSync(
  join(process.cwd(), "app/api/transcribe/mistral/stream/route.ts"),
  "utf-8",
);

// ── 1. Kein "file as Blob" mehr in keiner der Routes ──────────────────────────

test("transcribe/mistral: kein nackter 'file as Blob' mehr", () => {
  expect(MISTRAL_ROUTE_SRC).not.toContain("file as Blob");
});

test("transcribe/mistral/stream: kein nackter 'file as Blob' mehr", () => {
  expect(STREAM_ROUTE_SRC).not.toContain("file as Blob");
});

// ── 2. new File(...) + voxtralFileName() vorhanden ────────────────────────────

test("transcribe/mistral: enthält new File() + voxtralFileName()", () => {
  expect(MISTRAL_ROUTE_SRC).toContain("new File(");
  expect(MISTRAL_ROUTE_SRC).toContain("voxtralFileName");
  expect(MISTRAL_ROUTE_SRC).toContain("audioFile");
});

test("transcribe/mistral/stream: enthält new File() + voxtralFileName()", () => {
  expect(STREAM_ROUTE_SRC).toContain("new File(");
  expect(STREAM_ROUTE_SRC).toContain("voxtralFileName");
  expect(STREAM_ROUTE_SRC).toContain("audioFile");
});

// ── 3. Voxtral-Call benutzt audioFile, nicht file direkt ──────────────────────

test("transcribe/mistral: Voxtral-Call benutzt audioFile Variable", () => {
  // Prüfen: audioFile wird AN complete() übergeben
  expect(MISTRAL_ROUTE_SRC).toContain("file: audioFile");
});

test("transcribe/mistral/stream: Voxtral-Call benutzt audioFile Variable", () => {
  expect(STREAM_ROUTE_SRC).toContain("file: audioFile");
});

// ── 4. voxtralFileName deckt den fehlgeschlagenen MIME-Type ab ────────────────

test("voxtralFileName: Fallback-Branch deckt audio/webm;codecs=opus ab", () => {
  // Der Default-Zweig (audio.webm) greift wenn kein spezifischer Match —
  // und audio/webm;codecs=opus fällt in den Default.
  // Wir prüfen dass der Kommentar im Code den Browser-MIME-Type dokumentiert.
  expect(MISTRAL_ROUTE_SRC).toContain("codecs=opus");
  expect(MISTRAL_ROUTE_SRC).toContain('"audio.webm"');
});

test("voxtralFileName: alle gängigen Audio-Formate haben Branches", () => {
  // m4a, mp3, ogg, wav, webm
  expect(MISTRAL_ROUTE_SRC).toContain('"audio.m4a"');
  expect(MISTRAL_ROUTE_SRC).toContain('"audio.mp3"');
  expect(MISTRAL_ROUTE_SRC).toContain('"audio.ogg"');
  expect(MISTRAL_ROUTE_SRC).toContain('"audio.wav"');
  expect(MISTRAL_ROUTE_SRC).toContain('"audio.webm"');
});

// ── 5. File wird mit korrrektem type-Feld konstruiert ─────────────────────────

test("transcribe/mistral: File-Konstruktor übergibt { type: file.type }", () => {
  expect(MISTRAL_ROUTE_SRC).toContain("{ type: file.type }");
});

test("transcribe/mistral/stream: File-Konstruktor übergibt { type: file.type }", () => {
  expect(STREAM_ROUTE_SRC).toContain("{ type: file.type }");
});
