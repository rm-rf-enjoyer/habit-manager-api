import 'dotenv/config';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import z from 'zod';
import { generateInviteKey } from './utils/generateKey';
import cors from '@fastify/cors';

const prisma = new PrismaClient();
const fastify = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

fastify.register(cors, {
  origin: "*", // Для тестов разрешаем всем
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-device-id"],
  credentials: true
});
fastify.setValidatorCompiler(validatorCompiler);
fastify.setSerializerCompiler(serializerCompiler);

/**
 * Утилита для получения deviceId из заголовков без конфликтов типов Zod
 */
const getDeviceId = (headers: any): string | null => {
  // Ищем в любом регистре
  const id = headers['x-device-id'] || headers['X-Device-Id'];
  if (!id) return null;
  return Array.isArray(id) ? id[0] : id;
};

// --- РОУТЫ ---

// Проверка связи
fastify.get('/', async () => {
  return { status: 'ok', server: 'Habit Manager API' };
});

// 1. Регистрация устройства
fastify.post('/register-device', async (request, reply) => {
  const { deviceId } = request.body as { deviceId: string };
  console.log("=== ПОПЫТКА РЕГИСТРАЦИИ ===");
  console.log("ID:", deviceId);

  try {
    const user = await prisma.user.upsert({
      where: { id: deviceId },
      update: {},
      create: { id: deviceId },
    });
    console.log("=== УСПЕХ ===");
    return user;
  } catch (e: any) {
    // ВОТ ЭТО САМОЕ ВАЖНОЕ:
    console.error("!!! ОШИБКА PRISMA !!!");
    console.error(e);

    // Возвращаем текст ошибки прямо в браузер, чтобы не гадать
    return reply.status(500).send({
      error: 'Database error',
      prismaMessage: e.message,
      prismaCode: e.code
    });
  }
});

// 2. Создание списка
fastify.post('/lists', {
  schema: {
    body: z.object({ title: z.string().min(1) }),
  },
}, async (request, reply) => {
  const { title } = request.body;
  const deviceId = getDeviceId(request.headers);

  if (!deviceId) return reply.status(401).send({ error: 'Missing x-device-id' });

  try {
    return await prisma.list.create({
      data: {
        title,
        inviteKey: generateInviteKey(),
        ownerId: deviceId,
        members: { create: { userId: deviceId } }
      },
    });
  } catch (e) {
    return reply.status(500).send({ error: 'Could not create list' });
  }
});

// 3. Присоединение по ключу
fastify.post('/lists/join', {
  schema: {
    body: z.object({ inviteKey: z.string() }),
  },
}, async (request, reply) => {
  const { inviteKey } = request.body;
  const deviceId = getDeviceId(request.headers);

  if (!deviceId) return reply.status(401).send({ error: 'Missing x-device-id' });

  const list = await prisma.list.findUnique({ where: { inviteKey } });
  if (!list) return reply.status(404).send({ error: 'Invalid invite key' });

  try {
    await prisma.collaborator.upsert({
      where: { userId_listId: { userId: deviceId, listId: list.id } },
      update: {},
      create: { userId: deviceId, listId: list.id }
    });
    return list;
  } catch (e) {
    fastify.log.error(e); // Это выведет подробности Prisma в терминал
    return reply.status(500).send({
      error: 'Database error',
      message: e instanceof Error ? e.message : 'Unknown error'
    });
  }
});

// 4. Получение списка по ID
fastify.get('/lists/:id', {
  schema: {
    params: z.object({ id: z.string() }),
  },
}, async (request, reply) => {
  const { id } = request.params;
  const deviceId = getDeviceId(request.headers);

  if (!deviceId) return reply.status(401).send({ error: 'Missing x-device-id' });

  const membership = await prisma.collaborator.findUnique({
    where: { userId_listId: { userId: deviceId, listId: id } },
    include: { list: { include: { tasks: true } } }
  });

  if (!membership) return reply.status(403).send({ error: 'Access denied' });
  return membership.list;
});

// 5. Обновление задачи
fastify.patch('/tasks/:id', {
  schema: {
    params: z.object({ id: z.string() }),
    body: z.object({ completed: z.boolean() }),
  },
}, async (request, reply) => {
  const { id } = request.params;
  const { completed } = request.body;

  try {
    return await prisma.task.update({
      where: { id },
      data: { isDone: completed },
    });
  } catch (e) {
    return reply.status(404).send({ error: 'Task not found' });
  }
});

// 6. Удаление списка (Только владелец)
fastify.delete('/lists/:id', {
  schema: {
    params: z.object({ id: z.string() }),
  },
}, async (request, reply) => {
  const { id } = request.params;
  const deviceId = getDeviceId(request.headers);

  if (!deviceId) return reply.status(401).send({ error: 'Missing x-device-id' });

  const list = await prisma.list.findUnique({ where: { id } });
  if (!list) return reply.status(404).send({ error: 'Not found' });
  if (list.ownerId !== deviceId) return reply.status(403).send({ error: 'Not an owner' });

  await prisma.list.delete({ where: { id } });
  return reply.status(204).send();
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log(`✅ Server is running on port 3000`);
  } catch (err) {
    process.exit(1);
  }
};

start();
