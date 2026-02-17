import OpenAI from "openai";
import { envValid } from "../envSchema";

const client = new OpenAI({
  apiKey: envValid.OPENAI_API_KEY,
});

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

export const embedText = async (text: string): Promise<number[]> => {
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  const embedding = response.data[0]?.embedding;

  if (!embedding) {
    throw new Error("Embedding generation failed.");
  }

  return embedding;
};

export const embedBatch = async (texts: string[]): Promise<number[][]> => {
  if (texts.length === 0) return [];

  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  return response.data.map((item) => item.embedding);
};
