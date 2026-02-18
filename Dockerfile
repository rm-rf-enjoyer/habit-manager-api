FROM node:20-alpine
WORKDIR /app

# Системные либы
RUN apk add --no-cache openssl libc6-compat

# Копируем только то, что нужно для установки
COPY package*.json ./
COPY prisma ./prisma/

# Устанавливаем всё
RUN npm install

# Копируем исходники
COPY . .

# Генерируем клиент и собираем проект в JS
RUN npx prisma generate
RUN npx tsup src/index.ts --format esm --clean

EXPOSE 3000

# Запускаем через node, а не npx, чтобы не тратить ресурсы.
# Ограничиваем использование памяти самим Node.js
ENV NODE_OPTIONS="--max-old-space-size=512"
CMD npx prisma migrate deploy && node dist/index.mjs
