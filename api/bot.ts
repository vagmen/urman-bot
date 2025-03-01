import { VercelRequest, VercelResponse } from "@vercel/node";
import { Telegraf } from "telegraf";
import { OpenAI } from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";
import { Message } from "telegraf/types";

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

// Добавляем интерфейс для хранения истории диалога
interface DialogHistory {
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
}

// Создаем Map для хранения истории диалогов по userId
const userDialogs = new Map<number, DialogHistory>();

// Функция для генерации ответа с учетом контекста из базы знаний
async function generateResponse(userMessage: string, userId: number) {
  try {
    // Получаем или создаем историю диалога для пользователя
    if (!userDialogs.has(userId)) {
      userDialogs.set(userId, { messages: [] });
    }
    const dialogHistory = userDialogs.get(userId)!;

    // Добавляем сообщение пользователя в историю
    dialogHistory.messages.push({
      role: "user",
      content: userMessage,
    });

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

    // 4. Генерируем ответ с учётом контекста и истории диалога
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Вы - AI-ассистент компании URMAN, специализирующейся на лесном проектировании и оформлении документов для арендаторов лесных участков.

Ваши основные задачи:
1. Выявление потребностей клиента через естественный диалог
2. Сбор необходимой информации для оформления лесного участка
3. Предоставление релевантной информации об услугах компании

Правила ведения диалога:
1. Задавайте по одному вопросу за раз
2. Начинайте с открытых вопросов, постепенно переходя к конкретным деталям
3. Если клиент интересуется оформлением участка, последовательно соберите информацию:
   - Площадь участка
   - Регион расположения
   - Цель использования
   - Текущий этап (только планируют или уже выбрали участок)
   - Наличие документации
4. Отвечайте профессионально и дружелюбно
5. Используйте информацию из базы знаний для точных ответов
6. Если информации недостаточно, честно признайте это

Помните: Ваша цель - помочь клиенту и собрать необходимую информацию для дальнейшей работы.`,
        },
        // Добавляем предыдущие сообщения из истории (не более 5 последних)
        ...dialogHistory.messages.slice(-5),
        {
          role: "user",
          content: `Контекст из базы знаний:\n${contextText}\n\nВопрос пользователя: ${userMessage}`,
        },
      ],
    });

    const response = completion.choices[0].message.content;

    if (response) {
      // Сохраняем ответ ассистента в историю только если он не null
      dialogHistory.messages.push({
        role: "assistant",
        content: response,
      });

      // Ограничиваем историю последними 10 сообщениями
      if (dialogHistory.messages.length > 10) {
        dialogHistory.messages = dialogHistory.messages.slice(-10);
      }
    }

    return response;
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
    const userId = ctx.message.from.id;
    const response = await generateResponse(userMessage, userId);
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
