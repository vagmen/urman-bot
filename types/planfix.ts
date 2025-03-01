interface PlanfixTaskData {
  name: string;
  description?: string;
  priority?: "1. Сегодня" | "2. На неделе" | "3. Обычный";
  customFieldData?: {
    field: number;
    value: string;
  }[];
  attachment?: File;
  contactData: {
    name: string;
    position: string;
    projects: string[];
    software: string[];
    otherSkills: string;
    phone: string;
  };
  isRemote?: boolean;
}

interface PlanfixContactData {
  name: string;
  position: string;
  tags: string[];
  additionalInfo?: string;
  phone: string;
}

export type { PlanfixTaskData, PlanfixContactData };
