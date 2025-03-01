import { Pinecone } from "@pinecone-database/pinecone";
import { OpenAI } from "openai";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY!;
// const PINECONE_ENVIRONMENT = process.env.PINECONE_ENVIRONMENT || "gcp-starter";

const pinecone = new Pinecone({
  apiKey: PINECONE_API_KEY,
});
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Функция для разбиения текста на чанки
function chunkText(text: string, maxChunkLength: number = 2500): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split("\n\n");

  let currentChunk = "";

  for (const paragraph of paragraphs) {
    // Если параграф сам по себе больше максимального размера
    if (paragraph.length > maxChunkLength) {
      // Если есть накопленный чанк, сохраняем его
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = "";
      }

      // Разбиваем большой параграф на предложения
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      let sentenceChunk = "";

      for (const sentence of sentences) {
        if ((sentenceChunk + sentence).length <= maxChunkLength) {
          sentenceChunk += (sentenceChunk ? " " : "") + sentence;
        } else {
          if (sentenceChunk) chunks.push(sentenceChunk);
          sentenceChunk = sentence;
        }
      }

      if (sentenceChunk) chunks.push(sentenceChunk);
    } else if (currentChunk.length + paragraph.length > maxChunkLength) {
      chunks.push(currentChunk);
      currentChunk = paragraph;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
    }
  }

  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

async function run() {
  try {
    // 1. Работаем с индексом
    const indexName = "urman-knowledge";
    let index;

    try {
      index = pinecone.Index(indexName);
      console.log("Индекс найден, продолжаем...");
    } catch (e) {
      console.error("Ошибка:", e);
      console.log("Убедитесь, что индекс создан в консоли Pinecone");
      return;
    }

    // 2. Сканируем папку со статьями
    const knowledgeDir = path.join(process.cwd(), "knowledge");
    const files = fs.readdirSync(knowledgeDir);

    for (const file of files) {
      const content = fs.readFileSync(path.join(knowledgeDir, file), "utf8");
      const chunks = chunkText(content);

      // Обрабатываем каждый чанк
      for (const [i, chunk] of chunks.entries()) {
        // Вычисляем эмбеддинг для чанка
        const embeddingResponse = await openai.embeddings.create({
          model: "text-embedding-ada-002",
          input: chunk,
        });

        const embedding = embeddingResponse.data[0].embedding;

        // Создаем вектор для Pinecone
        const vector = {
          id: `${file}-chunk-${i}`,
          values: embedding,
          metadata: {
            text: chunk,
            source: file,
            chunkIndex: i,
          },
        };

        // Загружаем в Pinecone
        await index.upsert([vector]);

        console.log(`Загружен чанк ${i + 1} из файла ${file}`);
      }
    }

    console.log("Загрузка в Pinecone завершена!");
  } catch (error) {
    console.error("Ошибка при загрузке:", error);
  }
}

run();
