import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import { env } from '../env';
import { badRequest } from './http';

const EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

/** Guarda una imagen del local y devuelve su ruta relativa ("<storeId>/<uuid>.jpg"). */
export async function saveImage(storeId: string, data: Buffer, mimetype: string) {
  const ext = EXT[mimetype];
  if (!ext) throw badRequest('invalid_image');
  const dir = join(env.UPLOAD_DIR, storeId);
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}${ext}`;
  await writeFile(join(dir, name), data);
  return `${storeId}/${name}`;
}

export function openImage(storeId: string, rel: string) {
  const clean = normalize(rel).replace(/^([/\\])+/, '');
  if (!clean.startsWith(`${storeId}/`) || clean.includes('..')) return null;
  const full = join(env.UPLOAD_DIR, clean);
  if (!existsSync(full)) return null;
  return { stream: createReadStream(full), type: TYPES[extname(full)] ?? 'application/octet-stream' };
}

/** Lee una imagen de un pedido multipart (y los campos que vinieron antes). null si no mandaron foto. */
export async function readImage(req: FastifyRequest) {
  if (!req.isMultipart()) return null;
  const file: MultipartFile | undefined = await req.file();
  if (!file) return null;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(file.fields)) {
    const val = (v as { value?: unknown } | undefined)?.value;
    if (typeof val === 'string') fields[k] = val;
  }
  const data = await file.toBuffer();
  return { data, mimetype: file.mimetype, fields };
}

export const fileUrl = (rel: string | null) => (rel ? `/api/files/${rel}` : null);
