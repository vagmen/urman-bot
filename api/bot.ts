import { VercelRequest, VercelResponse } from "@vercel/node";
import { Telegraf } from "telegraf";
import { OpenAI } from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";

// Загружаем переменные окружения (на локальной машине)
dotenv.config();

// Получаем переменные окружения (на Vercel их задаем через Dashboard)
const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
// const PINECONE_ENVIRONMENT = process.env.PINECONE_ENVIRONMENT;

if (!BOT_TOKEN || !OPENAI_API_KEY || !PINECONE_API_KEY) {
  throw new Error("Отсутствуют необходимые переменные окружения");
}

// Инициализация клиентов
const bot = new Telegraf(BOT_TOKEN);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const pinecone = new Pinecone({
  apiKey: PINECONE_API_KEY,
  // Можно раскомментировать, если потребуется
  // environment: PINECONE_ENVIRONMENT,
});

// Функция для генерации ответа с учетом контекста из базы знаний
async function generateResponse(userMessage: string) {
  try {
    // 1. Получаем эмбеддинг вопроса пользователя
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: userMessage,
    });
    const userEmbedding = embeddingResponse.data[0].embedding;

    // 2. Ищем релевантные фрагменты в Pinecone
    const indexName = "urman-knowledge";
    const index = pinecone.Index(indexName);

    const queryResponse = await index.query({
      vector: userEmbedding,
      topK: 3,
      includeMetadata: true,
    });

    // 3. Формируем контекст из найденных фрагментов
    let contextText = "";
    queryResponse.matches?.forEach((match, i) => {
      if (match.metadata?.text) {
        contextText += `Фрагмент ${i + 1}:\n${match.metadata.text}\n\n`;
      }
    });

    // 4. Генерируем ответ с учётом контекста
    const completion = await openai.chat.completions.create({
      model: "gpt-4", // Используем более мощную модель вместо gpt-4o-mini
      messages: [
        {
          role: "system",
          content: `Вы - AI-ассистент компании URMAN. Используйте предоставленные фрагменты базы знаний, чтобы ответить пользователю достоверно.
Если в предоставленном контексте нет достаточной информации для ответа, честно признайте это. Не выдумывайте информацию.
Отвечайте профессионально и дружелюбно.`,
        },
        {
          role: "user",
          content: `Контекст из базы знаний:\n${contextText}\n\nВопрос пользователя: ${userMessage}`,
        },
      ],
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error("Ошибка при генерации ответа:", error);
    return "Извините, произошла ошибка при обработке вашего запроса. Попробуйте позже.";
  }
}

// Настраиваем обработчики бота
bot.start((ctx) => {
  ctx.reply(
    "Здравствуйте! Я AI-ассистент компании URMAN. Готов ответить на ваши вопросы о нашей компании и услугах."
  );
});

bot.on("message", async (ctx) => {
  if ("text" in ctx.message) {
    const userMessage = ctx.message.text;
    const response = await generateResponse(userMessage);
    if (response) {
      await ctx.reply(response);
    }
  }
});

// Экспортируем функцию-обработчик для Vercel
export default async (req: VercelRequest, res: VercelResponse) => {
  try {
    // Передаем тело запроса Telegraf'у для обработки обновления
    await bot.handleUpdate(req.body, res);
    res.status(200).end();
  } catch (error) {
    console.error("Ошибка обработки обновления:", error);
    res.status(500).end();
  }
};
