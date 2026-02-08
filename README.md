# Habit Manager API (Backend)

Это серверная часть приложения для управления групповыми списками. Построена с акцентом на типобезопасность и высокую производительность.

## 🚀 Стек технологий
* **Framework:** Fastify
* **ORM:** Prisma (работа с базой данных)
* **Validation:** Zod + Fastify Type Provider Zod (строгая валидация запросов)
* **Database:** PostgreSQL
* **Language:** TypeScript

## 🛠 Ключевые особенности
* **Device ID Auth:** Авторизация через заголовки (`x-device-id`), реализована через middleware.
* **Type Safety:** Полная синхронизация типов между схемой базы данных и API-роутами.
* **Collaborative Lists:** Система приглашений по ключу для совместного ведения списков.

## 📦 Как запустить локально
1. `npm install`
2. Создайте `.env` на основе `.env.example`
3. `npx prisma migrate dev` — создание таблиц в БД
4. `npm run dev` — запуск сервера
