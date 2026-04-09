import { describe, it, expect, beforeEach } from "vitest";
import { judge, clearJudgeCache } from "../../src/judge.js";

beforeEach(() => {
  clearJudgeCache();
});

describe("judge (fallback mode, no API key)", () => {
  it("returns correct=true for exact substring match", async () => {
    const verdict = await judge({
      probe_answer: "You work at Initech as a software engineer.",
      expected_value: "Initech",
      rubric_prompt: "Does the response correctly identify the employer?",
    });

    expect(verdict.correct).toBe(true);
    expect(verdict.partial_score).toBe(1.0);
    expect(verdict.reasoning).toContain("substring match");
  });

  it("returns partial score for partial keyword matches", async () => {
    const verdict = await judge({
      probe_answer: "You lived in Portland and then moved to a new city.",
      expected_value: "Portland then Seattle then Denver",
      rubric_prompt: "Does the response list all cities?",
    });

    expect(verdict.partial_score).toBeGreaterThan(0);
    expect(verdict.partial_score).toBeLessThan(1.0);
  });

  it("returns correct=false for no match", async () => {
    const verdict = await judge({
      probe_answer: "I have no information about your employer.",
      expected_value: "Initech",
      rubric_prompt: "Does the response correctly identify the employer?",
    });

    expect(verdict.correct).toBe(false);
    expect(verdict.partial_score).toBe(0);
  });

  it("returns correct=false for empty answer", async () => {
    const verdict = await judge({
      probe_answer: "",
      expected_value: "some value",
      rubric_prompt: "Is the value correct?",
    });

    expect(verdict.correct).toBe(false);
    expect(verdict.partial_score).toBe(0);
  });

  it("caches identical requests", async () => {
    const input = {
      probe_answer: "Answer is Alice",
      expected_value: "Alice",
      rubric_prompt: "Is the name correct?",
    };

    const first = await judge(input);
    const second = await judge(input);

    expect(first).toEqual(second);
  });

  it("handles numeric expected values", async () => {
    const verdict = await judge({
      probe_answer: "The budget is $5000.",
      expected_value: 5000,
      rubric_prompt: "Is the amount correct?",
    });

    expect(verdict.correct).toBe(true);
  });
});
