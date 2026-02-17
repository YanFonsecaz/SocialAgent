import { db } from "../db/connection";
import { storeContent } from "../db/schema";
import { embedBatch } from "./embeddings";
import { eq } from "drizzle-orm";

const chunkText = (text: string, maxChars = 1000): string[] => {
  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    chunks.push(text.slice(cursor, cursor + maxChars));
    cursor += maxChars;
  }

  return chunks;
};

export const saveCleanContent = async (url: string, content: string) => {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Conteúdo vazio para salvar.");
  }

  // 1. Clean old content for this URL
  await db.delete(storeContent).where(eq(storeContent.url, url));

  const chunks = chunkText(trimmed, 1000);
  const embeddings = await embedBatch(chunks);

  if (embeddings.length !== chunks.length) {
    throw new Error("Falha ao gerar embeddings para todos os chunks.");
  }

  const rows = chunks.map((chunk, index) => {
    const embedding = embeddings[index];
    if (!embedding) {
      throw new Error(`Embedding ausente para o chunk ${index}.`);
    }

    return {
      url,
      content: chunk,
      embedding,
    };
  });

  const results = await db.insert(storeContent).values(rows).returning();

  return results;
};
