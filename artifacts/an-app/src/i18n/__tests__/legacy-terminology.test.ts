import { describe, expect, it } from "vitest";
import de from "../de.json";

const legacyTerms = /\b(?:TaktKoord|Taktfenster|Taktvorschlag|Takte?|takte?)\b/i;

function translationValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(translationValues);
}

describe("German AN terminology", () => {
  it("does not expose legacy Takt terminology in translated UI text", () => {
    expect(translationValues(de).filter((value) => legacyTerms.test(value))).toEqual([]);
  });
});