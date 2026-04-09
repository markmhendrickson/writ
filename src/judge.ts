import type { JudgeVerdict } from "./types.js";

export interface JudgeInput {
  probe_answer: string;
  expected_value: unknown;
  rubric_prompt: string;
}

const verdictCache = new Map<string, JudgeVerdict>();

function cacheKey(input: JudgeInput): string {
  return JSON.stringify({
    a: input.probe_answer,
    e: input.expected_value,
    r: input.rubric_prompt,
  });
}

export async function judge(input: JudgeInput): Promise<JudgeVerdict> {
  const key = cacheKey(input);
  const cached = verdictCache.get(key);
  if (cached) return cached;

  const model = process.env.WRIT_JUDGE_MODEL ?? "gpt-4o-mini";
  const apiKey = process.env.WRIT_JUDGE_API_KEY ?? process.env.OPENAI_API_KEY;
  const baseUrl =
    process.env.WRIT_JUDGE_BASE_URL ?? "https://api.openai.com/v1";

  if (!apiKey) {
    return fallbackJudge(input);
  }

  const systemPrompt = `You are a benchmark evaluator for the WRIT (Write Integrity Test) AI memory benchmark. Your job is to evaluate whether a memory system's response is correct.

You MUST respond with exactly this JSON format and nothing else:
{"correct": true/false, "partial_score": 0.0-1.0, "reasoning": "brief explanation"}

Scoring:
- 1.0 = fully correct, all required information present and accurate
- 0.5-0.9 = partially correct, some required information present
- 0.1-0.4 = mostly incorrect but shows some relevant knowledge
- 0.0 = completely wrong or missing`;

  const userPrompt = `${input.rubric_prompt}

Expected value: ${JSON.stringify(input.expected_value)}

System response: ${input.probe_answer}

Evaluate this response and return your JSON verdict.`;

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      return fallbackJudge(input);
    }

    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
    };

    const content = data.choices[0]?.message?.content;
    if (!content) return fallbackJudge(input);

    const parsed = JSON.parse(content) as {
      correct?: boolean;
      partial_score?: number;
      reasoning?: string;
    };

    const verdict: JudgeVerdict = {
      correct: parsed.correct ?? false,
      partial_score: parsed.partial_score ?? (parsed.correct ? 1.0 : 0.0),
      reasoning: parsed.reasoning ?? "No reasoning provided",
    };

    verdictCache.set(key, verdict);
    return verdict;
  } catch {
    return fallbackJudge(input);
  }
}

function fallbackJudge(input: JudgeInput): JudgeVerdict {
  const answer = input.probe_answer.toLowerCase();
  const expected = String(input.expected_value).toLowerCase();

  if (answer.includes(expected)) {
    return {
      correct: true,
      partial_score: 1.0,
      reasoning: "Fallback: exact substring match found",
    };
  }

  const words = expected.split(/\s+/).filter((w) => w.length > 3);
  if (words.length > 0) {
    const matched = words.filter((w) => answer.includes(w)).length;
    const score = matched / words.length;
    return {
      correct: score >= 0.8,
      partial_score: score,
      reasoning: `Fallback: ${matched}/${words.length} key terms matched`,
    };
  }

  return {
    correct: false,
    partial_score: 0,
    reasoning: "Fallback: no match found",
  };
}

export function clearJudgeCache(): void {
  verdictCache.clear();
}
