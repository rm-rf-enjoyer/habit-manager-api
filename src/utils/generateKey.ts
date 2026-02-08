import { customAlphabet } from 'nanoid';

// Создаем алфавит: только заглавные буквы и цифры, без похожих символов
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const nanoid = customAlphabet(alphabet, 6);

export function generateInviteKey(): string {
  const code = nanoid();
  // Возвращаем в формате ABC-DEF
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}
