# --- ЭТАП 1: Сборка (Builder) ---
FROM node:20-alpine AS builder

# Устанавливаем рабочую директорию
WORKDIR /app

# Сначала копируем только файлы зависимостей (для кэширования слоев)
COPY package*.json ./
COPY prisma ./prisma/

# Устанавливаем все зависимости (включая devDependencies для билда)
RUN npm install

# Копируем остальной код
COPY . .

# Генерируем клиент Prisma
RUN npx prisma generate

# Если у тебя TypeScript, раскомментируй строку ниже:
# RUN npm run build


# --- ЭТАП 2: Финальный образ (Runner) ---
FROM node:20-alpine

WORKDIR /app

# Копируем из первого этапа только самое нужное
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist 
# ^ (если используешь TS, копируй папку dist, если чистый JS — просто копируй файлы .js)

# Копируем исходники (если это чистый JS без билда)
COPY . .

# Пробрасываем порт Fastify
EXPOSE 3000

# Команда запуска
# Сначала применяем миграции к базе, потом стартуем
CMD npx prisma migrate deploy && node index.js
