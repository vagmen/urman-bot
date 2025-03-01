import { PlanfixTaskData, PlanfixContactData } from "../types/planfix";
import axios from "axios";

const PLANFIX_BASE_URL = "https://urman.planfix.ru/rest";

// Весь код для работы с Планфикс

export const uploadFileToPlanfix = async (
  file: File,
  token: string
): Promise<string | null> => {
  try {
    const formData = new FormData();
    formData.append("file", file);

    const response = await axios.post(`${PLANFIX_BASE_URL}/file/`, formData, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return response.data.id;
  } catch (error) {
    console.error("Error uploading file:", error);
    return null;
  }
};

export const createContact = async (
  contactData: PlanfixContactData,
  token: string
): Promise<number> => {
  const response = await axios.post(
    `${PLANFIX_BASE_URL}/contact/`,
    {
      name: contactData.name,
      customFieldData: [
        {
          field: 133642,
          value: contactData.tags,
        },
      ],
      template: { id: 1 },
      description: contactData.additionalInfo,
      position: contactData.position,
      phones: [
        {
          number: contactData.phone.replace(/\D/g, ""),
          type: 6,
        },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  return response.data.id;
};

export const handlePlanfixTaskCreation = async ({
  name,
  description = "",
  priority = "3. Обычный",
  attachment,
  contactData,
  isRemote = false,
}: PlanfixTaskData): Promise<void> => {
  const token = process.env.PLANFIX_TOKEN;

  // Преобразуем проекты и программы в теги
  const tags = [
    ...(isRemote ? ["удалённо"] : []),
    ...contactData.projects,
    ...contactData.software,
  ].filter(Boolean);

  if (!token) {
    throw new Error("PLANFIX_TOKEN is not set");
  }

  // Создаем контакт
  const contactId = await createContact(
    {
      name: contactData.name,
      position: contactData.position,
      tags,
      additionalInfo: contactData.otherSkills,
      phone: contactData.phone,
    },
    token
  );

  // Создаем задачу
  const taskData = {
    name,
    description,
    template: {
      id: 199214, // Шаблон "Карточка удаленщика"
    },
    status: {
      id: 220, // Статус "Переговоры"
    },
    counterparty: {
      id: `contact:${contactId}`,
    },
    assignees: {
      users: [
        {
          id: "user:14",
          name: "Виктор Тарусов",
        },
      ],
      groups: [],
    },
    ...(attachment && {
      files: [{ id: await uploadFileToPlanfix(attachment, token) }],
    }),
  };

  await createTask(taskData, token);
};

const createTask = async (taskData: any, token: string): Promise<void> => {
  const response = await axios.post(`${PLANFIX_BASE_URL}/task/`, taskData, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  console.log("Task created successfully:", response.data);
};
