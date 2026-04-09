import { describe, it, expect, beforeEach } from "vitest";
import { BaselineAdapter } from "../../src/adapters/baseline.js";
import type { Session } from "../../src/types.js";

describe("BaselineAdapter", () => {
  let adapter: BaselineAdapter;

  beforeEach(async () => {
    adapter = new BaselineAdapter();
    await adapter.init();
  });

  it("has correct name", () => {
    expect(adapter.name).toBe("baseline");
  });

  it("reports no capabilities", () => {
    const caps = adapter.getCapabilities();
    expect(caps.supports_history).toBe(false);
    expect(caps.supports_temporal_replay).toBe(false);
    expect(caps.supports_provenance).toBe(false);
    expect(caps.supports_abstention).toBe(false);
  });

  it("stores and retrieves simple facts", async () => {
    const session: Session = {
      session_id: 1,
      timestamp: "2026-01-01T10:00:00Z",
      messages: [
        { role: "user", content: "My name is Alice." },
        { role: "assistant", content: "Got it." },
      ],
    };

    await adapter.processSession(session);

    const result = await adapter.probe("What is my name?");
    expect(result.abstained).toBe(false);
    expect(result.answer.toLowerCase()).toContain("alice");
  });

  it("overwrites values on update", async () => {
    await adapter.processSession({
      session_id: 1,
      timestamp: "2026-01-01T10:00:00Z",
      messages: [{ role: "user", content: "My name is Alice." }],
    });

    await adapter.processSession({
      session_id: 2,
      timestamp: "2026-02-01T10:00:00Z",
      messages: [{ role: "user", content: "My name is Bob." }],
    });

    const result = await adapter.probe("What is my name?");
    expect(result.answer.toLowerCase()).toContain("bob");
  });

  it("abstains in no_memory mode", async () => {
    await adapter.processSession({
      session_id: 1,
      timestamp: "2026-01-01T10:00:00Z",
      messages: [{ role: "user", content: "My name is Alice." }],
    });

    const result = await adapter.probe("What is my name?", {
      mode: "no_memory",
    });
    expect(result.abstained).toBe(true);
  });

  it("uses oracle state in oracle_memory mode", async () => {
    const result = await adapter.probe("What is my name?", {
      mode: "oracle_memory",
      oracle_state: { name: "Charlie" },
    });
    expect(result.answer).toBe("Charlie");
    expect(result.confidence).toBe(1.0);
  });

  it("returns null for getHistory", async () => {
    expect(await adapter.getHistory("any")).toBeNull();
  });

  it("returns null for getStateAsOf", async () => {
    expect(await adapter.getStateAsOf("any", "2026-01-01")).toBeNull();
  });

  it("returns null for getProvenance", async () => {
    expect(await adapter.getProvenance("any")).toBeNull();
  });

  it("clears state on reset", async () => {
    await adapter.processSession({
      session_id: 1,
      timestamp: "2026-01-01T10:00:00Z",
      messages: [{ role: "user", content: "My name is Alice." }],
    });

    await adapter.reset();

    const result = await adapter.probe("What is my name?");
    expect(result.abstained).toBe(true);
  });

  it("ignores assistant messages", async () => {
    await adapter.processSession({
      session_id: 1,
      timestamp: "2026-01-01T10:00:00Z",
      messages: [
        { role: "assistant", content: "My name is Alice." },
      ],
    });

    const result = await adapter.probe("What is my name?");
    expect(result.abstained).toBe(true);
  });
});
