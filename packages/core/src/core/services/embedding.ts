import { embed } from "ai";
import { google } from "@ai-sdk/google";

import { EMBEDDING_DIMS } from "../../db/schema";

const MODEL = google.textEmbedding("gemini-embedding-001");

/**
 * Embed text for memory-warehouse recall. Pinned to EMBEDDING_DIMS (the width of
 * the sqlite-vec `vec_memory` table). Returns the RAW embedding: the vec_memory
 * table uses cosine distance, which is magnitude-invariant, so no normalization
 * is applied — keeping the stored vectors portable to a cloud vector DB later.
 */
export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: MODEL,
    value: text,
    providerOptions: {
      google: { outputDimensionality: EMBEDDING_DIMS },
    },
  });

  return embedding;
}
