// ============================================================================
// Cloudflare Workers Media & R2 Storage Management Module
// Handles Advertisement Posters, Product Images, and Asset Serving
// ============================================================================

import { authenticateAdmin, jsonResponse } from './auth.js';
import { generateRandomHex } from './crypto.js';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * POST /api/media/upload
 * Handles multipart/form-data upload of advertisement posters and product images
 */
export async function handleMediaUpload(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return jsonResponse({ error: 'Content-Type must be multipart/form-data' }, 400);
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return jsonResponse({ error: 'No file provided in form-data' }, 400);
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return jsonResponse({ error: `Unsupported file type: ${file.type}. Allowed: JPEG, PNG, WEBP, BMP.` }, 400);
    }

    if (file.size > MAX_FILE_SIZE) {
      return jsonResponse({ error: 'File size exceeds maximum limit of 10MB' }, 400);
    }

    // Determine extension
    let ext = 'jpg';
    if (file.type === 'image/png') ext = 'png';
    else if (file.type === 'image/webp') ext = 'webp';
    else if (file.type === 'image/bmp') ext = 'bmp';

    const objectKey = `posters/${Date.now()}_${generateRandomHex(8)}.${ext}`;

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const base64Data = btoa(binary);

    // Upload to Cloudflare R2 bucket if attached
    if (env.MEDIA_BUCKET) {
      try {
        await env.MEDIA_BUCKET.put(objectKey, buffer, {
          httpMetadata: { contentType: file.type }
        });
      } catch (r2Err) {}
    }

    // Persist to Cloudflare D1 media_files so images are permanent across all devices
    if (env.DB) {
      try {
        await env.DB.prepare(`
          INSERT INTO media_files (id, mime_type, data_base64, file_size)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data_base64 = excluded.data_base64
        `).bind(objectKey, file.type, base64Data, file.size).run();
      } catch (dbErr) {}
    }

    const publicUrl = `/api/media/download/${objectKey}`;

    return jsonResponse({
      success: true,
      url: publicUrl,
      key: objectKey,
      fileSize: file.size,
      mimeType: file.type
    }, 201);
  } catch (err) {
    return jsonResponse({ error: 'Upload failed: ' + err.message }, 500);
  }
}

/**
 * GET /api/media/download/*
 * Serves uploaded asset directly from Cloudflare R2 bucket or D1 database with proper caching
 */
export async function handleMediaDownload(request, env, objectKey) {
  // 1. Try Cloudflare R2 bucket
  if (env.MEDIA_BUCKET) {
    try {
      const object = await env.MEDIA_BUCKET.get(objectKey);
      if (object) {
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Cache-Control', 'public, max-age=86400');
        headers.set('Access-Control-Allow-Origin', '*');
        return new Response(object.body, { headers });
      }
    } catch (e) {}
  }

  // 2. Try Cloudflare D1 Database media_files table
  if (env.DB) {
    try {
      const row = await env.DB.prepare('SELECT mime_type, data_base64 FROM media_files WHERE id = ?').bind(objectKey).first();
      if (row && row.data_base64) {
        const binaryString = atob(row.data_base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return new Response(bytes.buffer, {
          status: 200,
          headers: {
            'Content-Type': row.mime_type || 'image/jpeg',
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    } catch (e) {}
  }

  return new Response('Media file not found', { status: 404 });
}
