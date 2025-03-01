# Установка и запуск

1. Установите Node.js и npm на ваш компьютер.
2. Склонируйте репозиторий в локальную директорию.
3. В корне репозитория создайте файл `.env` с следующими переменными окружения:

```bash
BOT_TOKEN=YOUR_BOT_TOKEN
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
PINECONE_API_KEY=YOUR_PINECONE_API_KEY
```

4. Запустите команду `npm install` в корне репозитория для установки зависимостей.
5. Для загрузки базы знаний выполните команду:

```bash
npx ts-node scripts/uploadKnowledge.ts
```
