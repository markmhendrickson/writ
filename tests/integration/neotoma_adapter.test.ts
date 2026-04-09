import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NeotomaAdapter } from "../../src/adapters/neotoma.js";
import type { Session } from "../../src/types.js";

const RUN_INTEGRATION =
  process.env.WRIT_INTEGRATION_TESTS === "1" ||
  process.env.WRIT_INTEGRATION_TESTS === "true";

const NEOTOMA_URL =
  process.env.WRIT_NEOTOMA_URL ?? "http://localhost:3080";

describe.skipIf(!RUN_INTEGRATION)("NeotomaAdapter integration", () => {
  let adapter: NeotomaAdapter;

  beforeAll(async () => {
    adapter = new NeotomaAdapter(NEOTOMA_URL);
    await adapter.init();
  });

  afterAll(async () => {
    await adapter.teardown();
  });

  it("reports correct capabilities", () => {
    const caps = adapter.getCapabilities();
    expect(caps.supports_history).toBe(true);
    expect(caps.supports_temporal_replay).toBe(true);
    expect(caps.supports_provenance).toBe(true);
  });

  it("stores and queries a session", async () => {
    await adapter.reset();

    const session: Session = {
      session_id: 1,
      timestamp: "2026-01-15T10:00:00Z",
      messages: [
        { role: "user", content: "I work at TestCorp as an engineer." },
        { role: "assistant", content: "Got it." },
      ],
    };

    await adapter.processSession(session);

    const result = await adapter.probe("Where do I work?", {
      mode: "native_memory",
    });

    expect(result.abstained).toBe(false);
    expect(result.answer.toLowerCase()).toContain("testcorp");
  });

  it("abstains in no_memory mode", async () => {
    const result = await adapter.probe("Where do I work?", {
      mode: "no_memory",
    });
    expect(result.abstained).toBe(true);
  });

  it("retrieves history for stored facts", async () => {
    await adapter.reset();

    await adapter.processSession({
      session_id: 1,
      timestamp: "2026-01-01T10:00:00Z",
      messages: [
        { role: "user", content: "I work at AlphaCo." },
      ],
    });

    await adapter.processSession({
      session_id: 2,
      timestamp: "2026-03-01T10:00:00Z",
      messages: [
        { role: "user", content: "I work at BetaCo now." },
      ],
    });

    const history = await adapter.getHistory("employer");
    expect(history).not.toBeNull();
    if (history) {
      expect(history.values.length).toBeGreaterThanOrEqual(1);
    }
  });
});
