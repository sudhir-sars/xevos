import { embed } from "ai";
import { google } from "@ai-sdk/google";

import { EMBEDDING_DIMS } from "../../db/schema";

const MODEL = google.textEmbedding("gemini-embedding-001");

/**
 * Embed text for memory-warehouse recall. Pinned to EMBEDDING_DIMS (the width of
 * the sqlite-vec `vec_memory` table) and L2-normalized, so sqlite-vec's L2
 * distance ranks results the same way cosine similarity would.
 */
export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: MODEL,
    value: text,
    providerOptions: {
      google: { outputDimensionality: EMBEDDING_DIMS },
    },
  });

  return normalize(embedding);
}

function normalize(vec: number[]): number[] {
  let sum = 0;
  for (const x of vec) sum += x * x;
  const norm = Math.sqrt(sum);
  return norm > 0 ? vec.map((x) => x / norm) : vec;
}
