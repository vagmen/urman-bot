import { Telegraf } from "telegraf";
import { OpenAI } from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";

// Загружаем переменные окружения
dotenv.config();

// Конфигурация и проверка необходимых переменных окружения
const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_ENVIRONMENT = process.env.PINECONE_ENVIRONMENT;

if (
  !BOT_TOKEN ||
  !OPENAI_API_KEY ||
  !PINECONE_API_KEY ||
  !PINECONE_ENVIRONMENT
) {
  throw new Error("Отсутствуют необходимые переменные окружения");
}

// Инициализация клиентов
const bot = new Telegraf(BOT_TOKEN);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const pinecone = new Pinecone({
  apiKey: PINECONE_API_KEY,
  //   environment: PINECONE_ENVIRONMENT,
});

// Функция для генерации ответа с учетом контекста из базы знаний
async function generateResponse(userMessage: string) {
  try {
    // Здесь будет логика поиска релевантной информации в базе знаний

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            "Вы - AI-ассистент компании URMAN. Ваша задача - помогать клиентам, используя информацию из базы знаний компании.",
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error("Ошибка при генерации ответа:", error);
    return "Извините, произошла ошибка при обработке вашего запроса. Попробуйте позже.";
  }
}

// Обработчик команды /start
bot.start((ctx) => {
  ctx.reply(
    "Здравствуйте! Я AI-ассистент компании URMAN. Готов ответить на ваши вопросы о нашей компании и услугах."
  );
});

// Обработчик текстовых сообщений
bot.on("message", async (ctx) => {
  if ("text" in ctx.message) {
    const userMessage = ctx.message.text;
    const response = await generateResponse(userMessage);
    if (response) {
      await ctx.reply(response);
    }
  }
});

// Запуск бота
async function startBot() {
  await bot.launch();
  console.log("Бот успешно запущен");
}

startBot();

// Обработка ошибок и корректное завершение работы
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
