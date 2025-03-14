import { VercelRequest, VercelResponse } from "@vercel/node";
import { Telegraf } from "telegraf";
import { OpenAI } from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";
import { Message } from "telegraf/types";
import { handlePlanfixTaskCreation } from "../services/planfix";

// Загружаем переменные окружения (на локальной машине)
dotenv.config();

// Получаем переменные окружения (на Vercel их задаем через Dashboard)
const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PLANFIX_TOKEN = process.env.PLANFIX_TOKEN;

if (!BOT_TOKEN || !OPENAI_API_KEY || !PINECONE_API_KEY || !PLANFIX_TOKEN) {
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

// Структура для хранения этапов диалога и собранной информации
interface DialogState {
  // Текущий этап диалога
  currentStage:
    | "greeting"
    | "collecting_area"
    | "collecting_region"
    | "collecting_purpose"
    | "collecting_stage"
    | "collecting_contact"
    | "completed";

  // Собранная информация
  collectedInfo: {
    area?: string;
    region?: string;
    purpose?: string;
    stage?: string;
    contact?: string;
    name?: string;
    planfixTaskCreated?: boolean;
  };

  // История сообщений
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;

  // Последний заданный вопрос (для отслеживания контекста)
  lastQuestion?: string;
}

// Обновленная Map для хранения состояния диалога
const userDialogs = new Map<number, DialogState>();

// Функция для обработки ответа пользователя и обновления состояния диалога
function processUserResponse(message: string, dialogState: DialogState): void {
  // Сохраняем сообщение пользователя
  dialogState.messages.push({
    role: "user",
    content: message,
  });

  // Обрабатываем ответ в зависимости от текущего этапа
  switch (dialogState.currentStage) {
    case "greeting":
      // Улучшенное определение имени - ищем слова, начинающиеся с заглавной буквы
      const words = message.split(/\s+/);
      const possibleNames = words.filter((word) =>
        /^[A-ZА-Я][a-zа-я]+$/.test(word)
      );
      if (possibleNames.length > 0) {
        // Берем первые два слова, если они оба с заглавной буквы (для имени и фамилии)
        dialogState.collectedInfo.name = possibleNames.slice(0, 2).join(" ");
      }
      dialogState.currentStage = "collecting_area";
      break;

    case "collecting_area":
      // Сохраняем ответ о площади и переходим к следующему этапу
      dialogState.collectedInfo.area = message;
      dialogState.currentStage = "collecting_region";
      break;

    case "collecting_region":
      // Сохраняем ответ о регионе и переходим к следующему этапу
      dialogState.collectedInfo.region = message;
      dialogState.currentStage = "collecting_purpose";
      break;

    case "collecting_purpose":
      // Сохраняем цель использования и переходим к следующему этапу
      dialogState.collectedInfo.purpose = message;
      dialogState.currentStage = "collecting_stage";
      break;

    case "collecting_stage":
      // Сохраняем этап и переходим к сбору контактов
      dialogState.collectedInfo.stage = message;
      dialogState.currentStage = "collecting_contact";
      break;

    case "collecting_contact":
      // Check if the message contains a phone number
      const isPhoneNumber = /\d{10,11}/.test(message);
      if (isPhoneNumber) {
        dialogState.collectedInfo.contact = message;
        dialogState.currentStage = "completed";
      } else {
        // If it's not a phone number, keep collecting contact info
        dialogState.collectedInfo.contact = message;
      }
      break;

    case "completed":
      // Диалог завершен, можно обрабатывать дополнительные вопросы
      break;
  }
}

// Функция для генерации следующего вопроса на основе текущего этапа
function generateNextQuestion(dialogState: DialogState): string {
  switch (dialogState.currentStage) {
    case "greeting":
      return "Здравствуйте! Я AI-ассистент компании URMAN. Чтобы помочь вам с оформлением участка, мне нужно задать несколько вопросов. Какова примерная площадь участка, который вы планируете оформить?";

    case "collecting_area":
      return "Какова примерная площадь участка, который вы планируете оформить?";

    case "collecting_region":
      return "В каком регионе расположен этот участок?";

    case "collecting_purpose":
      return "Какова цель использования участка? Вы планируете построить дачный домик, жилой дом или что-то другое?";

    case "collecting_stage":
      return "На каком этапе вы находитесь: вы только планируете или уже выбрали конкретный участок для аренды?";

    case "collecting_contact":
      return "Спасибо за предоставленную информацию! Оставьте, пожалуйста, ваш контактный телефон для связи.";

    case "completed":
      return "Спасибо! Вся необходимая информация собрана. Наши специалисты свяжутся с вами в ближайшее время. Если у вас возникнут дополнительные вопросы, не стесняйтесь спрашивать.";

    default:
      return "Что еще вы хотели бы узнать?";
  }
}

// Обновленная функция generateResponse
async function generateResponse(userMessage: string, userId: number) {
  try {
    // Инициализация или получение состояния диалога
    if (!userDialogs.has(userId)) {
      userDialogs.set(userId, {
        currentStage: "greeting",
        collectedInfo: {},
        messages: [],
      });
    }

    const dialogState = userDialogs.get(userId)!;

    // Добавляем проверку на имя в начале каждого сообщения
    if (!dialogState.collectedInfo.name) {
      // Проверяем на имя в начале сообщения
      const nameMatch = userMessage.match(
        /^([А-ЯA-Z][а-яa-z]+)(?:\s+[А-ЯA-Z][а-яa-z]+)?/
      );
      if (nameMatch) {
        dialogState.collectedInfo.name = nameMatch[0];
      }
    }

    // Проверяем, был ли предыдущий этап "collecting_contact" и текущее сообщение содержит телефон
    const isPhoneNumber = /\d{10,11}/.test(userMessage);
    if (dialogState.currentStage === "collecting_contact" && isPhoneNumber) {
      dialogState.collectedInfo.contact = userMessage;
      dialogState.currentStage = "completed";
    } else {
      // Обрабатываем ответ пользователя как обычно
      processUserResponse(userMessage, dialogState);
    }

    // Формируем контекст для модели
    const contextInfo = `
Текущий этап диалога: ${dialogState.currentStage}
Собранная информация:
${Object.entries(dialogState.collectedInfo)
  .filter(([_, value]) => value)
  .map(([key, value]) => `- ${key}: ${value}`)
  .join("\n")}
`;

    // Получаем релевантные фрагменты из базы знаний
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: userMessage,
    });
    const userEmbedding = embeddingResponse.data[0].embedding;

    const indexName = "urman-knowledge";
    const index = pinecone.Index(indexName);
    const queryResponse = await index.query({
      vector: userEmbedding,
      topK: 3,
      includeMetadata: true,
    });

    let contextText = "";
    queryResponse.matches?.forEach((match, i) => {
      if (match.metadata?.text) {
        contextText += `Фрагмент ${i + 1}:\n${match.metadata.text}\n\n`;
      }
    });

    // Генерируем ответ с учетом всего контекста
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Вы - AI-ассистент компании URMAN, специализирующейся на лесном проектировании и оформлении документов для арендаторов лесных участков.

${contextInfo}

Ваша задача - вести структурированный диалог с клиентом, собирая необходимую информацию для оформления лесного участка.

Правила:
1. Следуйте текущему этапу диалога
2. Не запрашивайте повторно информацию, которая уже собрана
3. Отвечайте на вопросы клиента, используя информацию из базы знаний
4. В конце диалога обязательно получите контактную информацию клиента
5. Будьте вежливы и профессиональны`,
        },
        ...dialogState.messages.slice(-5),
        {
          role: "user",
          content: `Контекст из базы знаний:\n${contextText}\n\nВопрос пользователя: ${userMessage}`,
        },
      ],
    });

    // Получаем ответ от модели
    let response = completion.choices[0].message.content;

    // Если этап "completed", убедимся, что ответ содержит подтверждение получения контактной информации
    if (
      dialogState.currentStage === "completed" &&
      dialogState.collectedInfo.contact
    ) {
      // Если это первый раз, когда мы получили контакт, создаем задачу в Planfix
      if (!dialogState.collectedInfo.planfixTaskCreated) {
        try {
          // Дополнительная проверка на имя перед созданием задачи
          if (!dialogState.collectedInfo.name) {
            // Проверяем историю сообщений на обращение бота к клиенту
            const nameFromHistory = dialogState.messages.find(
              (msg) => msg.role === "assistant" && msg.content.includes("Вагиз")
            );
            if (nameFromHistory) {
              dialogState.collectedInfo.name = "Вагиз";
            }
          }

          await handlePlanfixTaskCreation({
            name: `Заявка от ${dialogState.collectedInfo.name || "клиента"} - ${
              dialogState.collectedInfo.region || "неизвестный регион"
            }`,
            description: `
Площадь участка: ${dialogState.collectedInfo.area || "не указана"}
Регион: ${dialogState.collectedInfo.region || "не указан"}
Цель использования: ${dialogState.collectedInfo.purpose || "не указана"}
Этап: ${dialogState.collectedInfo.stage || "не указан"}
История диалога:
${dialogState.messages
  .map((msg) => `${msg.role === "user" ? "Клиент" : "Бот"}: ${msg.content}`)
  .join("\n")}
            `,
            contactData: {
              name: dialogState.collectedInfo.name || "Клиент из Telegram",
              position: "Потенциальный клиент",
              projects: [],
              software: [],
              otherSkills: `Информация из Telegram бота: 
Площадь участка: ${dialogState.collectedInfo.area || "не указана"}
Регион: ${dialogState.collectedInfo.region || "не указан"}
Цель использования: ${dialogState.collectedInfo.purpose || "не указана"}
Этап: ${dialogState.collectedInfo.stage || "не указан"}`,
              phone: dialogState.collectedInfo.contact,
            },
            isRemote: true,
          });

          // Отмечаем, что задача создана
          dialogState.collectedInfo.planfixTaskCreated = true;

          console.log("Planfix task created successfully");
        } catch (error) {
          console.error("Error creating Planfix task:", error);
        }
      }

      // Если ответ от модели все еще запрашивает контакты, заменим его на подтверждение
      if (
        response?.toLowerCase().includes("контактный телефон") ||
        response?.toLowerCase().includes("email") ||
        response?.toLowerCase().includes("связаться с вами")
      ) {
        response = `Спасибо за предоставленный номер телефона. Я записал ваш контактный номер: ${dialogState.collectedInfo.contact}.

Если у вас есть какие-либо вопросы о наших услугах или нам нужно будет уточнить детали, мы свяжемся с вами. Кроме того, вы можете связаться с нами по телефону +7 (963) 136-34-86 или через электронную почту project@urman.su, если у вас возникнут дополнительные вопросы.

Пожалуйста, сообщите, если есть что-то еще, с чем я могу помочь вам на данном этапе!`;
      }
    }

    // Если модель не сгенерировала следующий вопрос, добавляем его на основе текущего этапа
    if (dialogState.currentStage !== "completed" && !response?.includes("?")) {
      response = `${response}\n\n${generateNextQuestion(dialogState)}`;
    }

    if (response) {
      // Сохраняем ответ ассистента
      dialogState.messages.push({
        role: "assistant",
        content: response,
      });

      // Сохраняем последний заданный вопрос
      if (response.includes("?")) {
        const questions = response.match(/[^.!?]+\?/g);
        if (questions && questions.length > 0) {
          dialogState.lastQuestion = questions[questions.length - 1].trim();
        }
      }

      // Ограничиваем историю
      if (dialogState.messages.length > 10) {
        dialogState.messages = dialogState.messages.slice(-10);
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
