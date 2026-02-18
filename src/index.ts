import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import 'dotenv/config';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import z from 'zod';
import { generateInviteKey } from './utils/generateKey';
import cors from '@fastify/cors';

const prisma = new PrismaClient();
const fastify = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

// Настройка Zod
fastify.setValidatorCompiler(validatorCompiler);
fastify.setSerializerCompiler(serializerCompiler);

// Регистрация Swagger
await fastify.register(fastifySwagger, {
    openapi: {
        info: {
            title: 'My API',
            description: 'Документация моего Fullstack проекта',
            version: '1.0.0',
        },
    },
    transform: jsonSchemaTransform, // ЭТА МАГИЯ связывает Zod и Swagger автоматически
});

// Регистрация UI
await fastify.register(fastifySwaggerUi, {
    routePrefix: '/docs',
});

// Регистрация CORS
fastify.register(cors, {
  origin:"*",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-device-id", "Origin", "Accept"],
  credentials: true,
  strictPreflight: false,
  optionsSuccessStatus: 204
});

const getDeviceId = (headers: any): string | null => {
  const id = headers['x-device-id'] || headers['X-Device-Id'];
  if (!id) return null;
  return Array.isArray(id) ? id[0] : id;
};

// --- РОУТЫ ---

fastify.get('/', {
  schema: {
    description: 'Проверка статуса сервера',
    tags: ['Health Check'], // Группировка в Swagger
    response: {
      200: z.object({
        status: z.string().describe('Статус работы сервера'),
        server: z.string().describe('Название API')
      })
    }
  }
},  async () => {
  return { status: 'ok', server: 'Habit Manager API' };
});

fastify.post('/register-device', {
  schema: {
    description: 'Регистрация или вход устройства (UPSERT)',
    tags: ['Auth'],
    body: z.object({
      deviceId: z.string().describe('Уникальный ID устройства')
    }),
    response: {
      200: z.object({
        id: z.string(),
        createdAt: z.date().optional() // Если в Prisma есть эти поля
      })
    }
  }
}, async (request, reply) => {
  const { deviceId } = request.body as { deviceId: string };
  try {
    const user = await prisma.user.upsert({
      where: { id: deviceId },
      update: {},
      create: { id: deviceId },
    });
    return user;
  } catch (e: any) {
    return reply.status(500).send({ error: 'Database error', message: e.message });
  }
});

fastify.post('/lists', {
  schema: {
    description: 'Создание нового списка задач',
    tags: ['Lists'],
    headers: z.object({
      'x-device-id': z.string().describe('ID устройства для авторизации')
    }),
    body: z.object({
      title: z.string().min(1).describe('Название списка')
    }),
    response: {
      200: z.object({
        id: z.number(),
        title: z.string(),
        inviteKey: z.string(),
        ownerId: z.string()
      }),
      401: z.object({ error: z.string() })
    }
  }
}, async (request, reply) => {
  const { title } = request.body;
  const deviceId = getDeviceId(request.headers);
  if (!deviceId) return reply.status(401).send({ error: 'Missing x-device-id' });

  // ЗАЩИТА: проверяем/создаем юзера прямо здесь перед созданием списка
  await prisma.user.upsert({
    where: { id: deviceId },
    update: {},
    create: { id: deviceId }
  });

  return await prisma.list.create({
    data: {
      title,
      inviteKey: generateInviteKey(),
      ownerId: deviceId,
      members: { create: { userId: deviceId } }
    },
  });
});

fastify.post('/lists/join', {
  schema: {
    description: 'Присоединиться к существующему списку по ключу',
    tags: ['Lists'],
    headers: z.object({
      'x-device-id': z.string()
    }),
    body: z.object({ 
      inviteKey: z.string().describe('Код приглашения (например, 6 знаков)') 
    }),
    response: {
      200: z.object({ id: z.number(), title: z.string() }),
      404: z.object({ error: z.string() }),
      401: z.object({ error: z.string() })
    }
  },
}, async (request, reply) => {
  const { inviteKey } = request.body;
  const deviceId = getDeviceId(request.headers);
  if (!deviceId) return reply.status(401).send({ error: 'Missing x-device-id' });

  const list = await prisma.list.findUnique({ where: { inviteKey } });
  if (!list) return reply.status(404).send({ error: 'Invalid invite key' });

  await prisma.collaborator.upsert({
    where: { userId_listId: { userId: deviceId, listId: list.id } },
    update: {},
    create: { userId: deviceId, listId: list.id }
  });
  return list;
});

fastify.post('/tasks', {
  schema: {
    description: 'Добавить задачу в список, к которому у пользователя есть доступ',
    tags: ['Tasks'],
    headers: z.object({
      'x-device-id': z.string()
    }),
    body: z.object({
      listId: z.string().describe('ID списка из БД'),
      title: z.string().min(1).describe('Текст самой задачи')
    }),
    response: {
      201: z.object({
        id: z.string(), // или z.number(), смотря что в Prisma
        text: z.string(),
        isDone: z.boolean(),
        listId: z.string()
      }),
      401: z.object({ error: z.string() }),
      403: z.object({ error: z.string().describe('Нет доступа к списку') })
    }
  }
}, async (request, reply) => {
  const { listId, title } = request.body;
  const deviceId = getDeviceId(request.headers);

  if (!deviceId) return reply.status(401).send({ error: 'Missing x-device-id' });

  // 1. Проверяем, есть ли у пользователя доступ к этому списку
  const hasAccess = await prisma.collaborator.findUnique({
    where: { userId_listId: { userId: deviceId, listId } }
  });

  if (!hasAccess) return reply.status(403).send({ error: 'No access to this list' });

  // 2. Создаем задачу
  const newTask = await prisma.task.create({
    data: {
      text: title,
      listId,
      isDone: false
    }
  });

  return newTask; // Возвращаем задачу с её реальным ID из БД
});

fastify.get('/lists/:id', {
  schema: {
    description: 'Получить содержимое списка вместе со всеми задачами',
    tags: ['Lists'],
    headers: z.object({ 'x-device-id': z.string() }),
    params: z.object({ id: z.string().describe('ID списка') }),
    response: {
      200: z.object({
        id: z.string(),
        title: z.string(),
        tasks: z.array(z.object({
          id: z.string(),
          text: z.string(),
          isDone: z.boolean()
        }))
      }),
      401: z.object({ error: z.string() }),
      403: z.object({ error: z.string().describe('Доступ запрещен') })
    }
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

fastify.patch('/tasks/:id', {
  schema: {
    description: 'Переключить статус выполнения задачи (выполнено/не выполнено)',
    tags: ['Tasks'],
    params: z.object({ id: z.string().describe('Уникальный ID задачи') }),
    body: z.object({ 
      completed: z.boolean().describe('Новое состояние задачи') 
    }),
    response: {
      200: z.object({
        id: z.string(),
        text: z.string(),
        isDone: z.boolean(),
        listId: z.string()
      }),
      404: z.object({ error: z.string().describe('Задача не найдена') })
    }
  },
}, async (request, reply) => {
  const { id } = request.params;
  const { completed } = request.body;
  
  try {
    return await prisma.task.update({
      where: { id },
      data: { isDone: completed },
    });
  } catch (error: any) {
    // Код P2025 в Prisma означает "Record not found"
    if (error.code === 'P2025') {
      return reply.status(404).send({ error: "Task not found in cloud database" });
    }
    throw error; // Остальные ошибки (база упала и т.д.) пусть летят как 500
  }
});

fastify.delete('/lists/:id', {
  schema: {
    description: 'Полное удаление списка и всех его задач (только для владельца)',
    tags: ['Lists'],
    headers: z.object({
      'x-device-id': z.string().describe('ID устройства владельца')
    }),
    params: z.object({
      id: z.string().describe('ID списка для удаления')
    }),
    response: {
      204: z.null().describe('Успешно удалено, контента нет'),
      401: z.object({ error: z.string() }),
      403: z.object({ error: z.string().describe('Попытка удалить чужой список') }),
      404: z.object({ error: z.string().describe('Список не найден в базе') })
    }
  },
}, async (request, reply) => {
  const { id } = request.params;
  const deviceId = getDeviceId(request.headers);

  if (!deviceId) return reply.status(401).send({ error: 'Missing x-device-id' });

  // 1. Ищем список
  const list = await prisma.list.findUnique({ where: { id } });

  // 2. Если списка нет — 404
  if (!list) return reply.status(404).send({ error: 'List not found' });

  // 3. ПРОВЕРКА ПРАВ: Только владелец (ownerId) может удалить весь список из облака
  if (list.ownerId !== deviceId) {
    return reply.status(403).send({ error: 'Only the owner can delete this cloud list' });
  }

  // 4. Удаление (благодаря Cascade Delete в Prisma, задачи удалятся сами)
  await prisma.list.delete({ where: { id } });

  return reply.status(204).send(); 
});

fastify.delete('/tasks/:id', {
  schema: {
    description: 'Удаление задачи из списка. Проверяет, является ли пользователь участником списка.',
    tags: ['Tasks'],
    headers: z.object({
      'x-device-id': z.string().describe('ID устройства (авторизация)')
    }),
    params: z.object({
      id: z.string().describe('ID задачи')
    }),
    response: {
      200: z.object({
        success: z.boolean()
      }),
      401: z.object({ error: z.string() }),
      403: z.object({ error: z.string().describe('Доступ запрещен или задача не существует в ваших списках') }),
      500: z.object({ error: z.string() })
    }
  }
}, async (request, reply) => {
  const { id } = request.params;
  const deviceId = getDeviceId(request.headers);

  if (!deviceId) return reply.status(401).send({ error: 'Missing x-device-id' });

  try {
    // 1. Сначала проверяем, есть ли у пользователя доступ к списку, которому принадлежит задача
    // Мы ищем коллаборатора, у которого список содержит эту задачу
    const hasAccess = await prisma.collaborator.findFirst({
      where: {
        userId: deviceId,
        list: {
          tasks: {
            some: { id: id }
          }
        }
      }
    });

    if (!hasAccess) {
      return reply.status(403).send({ error: 'Access denied or task not found' });
    }

    // 2. Если доступ есть — удаляем задачу
    await prisma.task.delete({
      where: { id: id }
    });

    return { success: true };
  } catch (e: any) {
    request.log.error(e);
    return reply.status(500).send({ error: 'Failed to delete task' });
  }
});

// Запуск
const start = async () => {
  try {
    const address = await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log(`✅ Server is running on ${address}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();

