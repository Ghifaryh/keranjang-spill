import type { APIRoute } from 'astro';
import { fetchTelegramPhotoResponse } from '../../../lib/telegram';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const fileId = params.fileId?.trim() || '';

  if (!/^[A-Za-z0-9_-]{5,256}$/.test(fileId)) {
    return new Response('Invalid file ID', { status: 400 });
  }

  const upstream = await fetchTelegramPhotoResponse(fileId);
  if (!upstream) {
    return new Response('Image not found', { status: 404 });
  }

  return upstream;
};

