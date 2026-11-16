// ============================================================================
// Cloudflare Workers Advertisement Management & History Module
// Supports Public Display, DWIN HMI Synchronization, Play Now, and Priority Controls
// ============================================================================

import { authenticateAdmin, jsonResponse } from './auth.js';
import { generateRandomHex } from './crypto.js';

export const memoryAds = [];
export let activeAdId = null;

/**
 * GET /api/advertisements
 * Admin endpoint: retrieves all advertisements with product metadata
 */
export async function handleListAdvertisements(request, env) {
  if (env && env.DB) {
    try {
      const ads = await env.DB.prepare(`
        SELECT a.*, p.name as product_name, c.name as category_name,
               s.start_time, s.end_time, s.duration_sec, s.is_active as schedule_active
        FROM advertisements a
        LEFT JOIN products p ON a.product_id = p.id
        LEFT JOIN categories c ON a.category_id = c.id
        LEFT JOIN advertisement_schedules s ON a.id = s.advertisement_id
        ORDER BY a.priority DESC, a.updated_at DESC
      `).all();
      if (ads && Array.isArray(ads.results)) {
        return jsonResponse({ advertisements: ads.results });
      }
    } catch (err) {}
  }

  // Central Cloud Store Fallback
  try {
    const cloudRes = await fetch('https://ai-advertising-robot-8.onrender.com/api/advertisements');
    if (cloudRes.ok) {
      const d = await cloudRes.json();
      if (d && Array.isArray(d.advertisements)) {
        return jsonResponse({ advertisements: d.advertisements });
      }
    }
  } catch (e) {}

  return jsonResponse({ advertisements: memoryAds });
}

/**
 * GET /api/advertisements/active
 * Consumed by Display and ESP32-S3 Main Controller
 */
export async function handleGetActiveAdvertisement(request, env) {
  try {
    if (env.DB) {
      let activeAd = await env.DB.prepare(`
        SELECT a.*, p.name as product_name, p.specs_json, p.faq_json, p.availability,
               c.name as category_name
        FROM advertisements a
        LEFT JOIN products p ON a.product_id = p.id
        LEFT JOIN categories c ON a.category_id = c.id
        WHERE a.status = 'active'
        ORDER BY a.priority DESC, a.updated_at DESC
        LIMIT 1
      `).first();

      if (activeAd) {
        let parsedSpecs = {};
        try {
          if (activeAd.specs_json) parsedSpecs = JSON.parse(activeAd.specs_json);
        } catch {}

        return jsonResponse({
          ...activeAd,
          specs: parsedSpecs
        });
      }
    }
  } catch (err) {}

  // In-memory fallback
  let active = memoryAds.find(a => a.id === activeAdId && a.status === 'active');
  if (!active) {
    active = memoryAds.find(a => a.status === 'active') || memoryAds[0] || null;
  }
  return jsonResponse(active || { status: 'idle', message: 'No active advertisements' });
}

/**
 * POST /api/advertisements
 */
export async function handleCreateAdvertisement(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const data = await request.json();
    if (!data.title || !data.poster_url) {
      return jsonResponse({ error: 'Title and Poster URL are required.' }, 400);
    }

    const id = data.id || `ad_${generateRandomHex(8)}`;
    const pageId = data.display_page_id ? parseInt(data.display_page_id) : 1;
    const priority = data.priority ? parseInt(data.priority) : 1;
    const status = data.status || 'draft';

    const newAd = {
      id,
      title: data.title,
      product_id: data.product_id || null,
      category_id: data.category_id || null,
      poster_url: data.poster_url,
      short_desc: data.short_desc || '',
      short_desc_ml: data.short_desc_ml || '',
      detailed_desc: data.detailed_desc || '',
      detailed_desc_ml: data.detailed_desc_ml || '',
      price: data.price !== undefined ? parseFloat(data.price) : null,
      features: data.features || '',
      promo_info: data.promo_info || '',
      priority,
      status,
      display_page_id: pageId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Store in memory
    const existingIdx = memoryAds.findIndex(a => a.id === id);
    if (existingIdx !== -1) {
      memoryAds[existingIdx] = newAd;
    } else {
      memoryAds.unshift(newAd);
    }

    if (status === 'active') {
      activeAdId = id;
    }

    // Attempt DB storage if attached
    if (env && env.DB) {
      try {
        await env.DB.prepare(`
          INSERT INTO advertisements (
            id, title, product_id, category_id, poster_url, short_desc, 
            short_desc_ml, detailed_desc, detailed_desc_ml, price, features, 
            promo_info, priority, status, display_page_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            product_id = excluded.product_id,
            category_id = excluded.category_id,
            poster_url = excluded.poster_url,
            short_desc = excluded.short_desc,
            short_desc_ml = excluded.short_desc_ml,
            detailed_desc = excluded.detailed_desc,
            detailed_desc_ml = excluded.detailed_desc_ml,
            price = excluded.price,
            features = excluded.features,
            promo_info = excluded.promo_info,
            priority = excluded.priority,
            status = excluded.status,
            display_page_id = excluded.display_page_id,
            updated_at = CURRENT_TIMESTAMP
        `).bind(
          id,
          newAd.title,
          newAd.product_id,
          newAd.category_id,
          newAd.poster_url,
          newAd.short_desc,
          newAd.short_desc_ml,
          newAd.detailed_desc,
          newAd.detailed_desc_ml,
          newAd.price,
          newAd.features,
          newAd.promo_info,
          newAd.priority,
          newAd.status,
          newAd.display_page_id
        ).run();

        if (data.start_time && data.end_time) {
          const scheduleId = `sch_${generateRandomHex(8)}`;
          await env.DB.prepare(`
            INSERT INTO advertisement_schedules (id, advertisement_id, start_time, end_time, duration_sec, priority, is_active)
            VALUES (?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(id) DO NOTHING
          `).bind(scheduleId, id, data.start_time, data.end_time, data.duration_sec || 30, priority).run();
        }
      } catch (dbErr) {
        console.warn('[D1 Ad Insert Notice]:', dbErr.message);
      }
    }

    // Central Cloud Store Sync
    try {
      await fetch('https://ai-advertising-robot-8.onrender.com/api/advertisements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAd)
      });
    } catch (syncErr) {}

    return jsonResponse({ success: true, message: 'Advertisement created successfully', id, advertisement: newAd }, 201);
  } catch (err) {
    return jsonResponse({ error: 'Failed to create advertisement: ' + err.message }, 500);
  }
}

/**
 * PUT /api/advertisements/:id
 */
export async function handleUpdateAdvertisement(request, env, id) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const data = await request.json();

    // Update in memory
    const idx = memoryAds.findIndex(a => a.id === id);
    if (idx !== -1) {
      memoryAds[idx] = {
        ...memoryAds[idx],
        ...data,
        updated_at: new Date().toISOString()
      };
    }

    // Update in DB if attached
    if (env && env.DB) {
      try {
        await env.DB.prepare(`
          UPDATE advertisements SET
            title = ?, product_id = ?, category_id = ?, poster_url = ?, short_desc = ?, 
            short_desc_ml = ?, detailed_desc = ?, detailed_desc_ml = ?, price = ?, 
            features = ?, promo_info = ?, priority = ?, status = ?, display_page_id = ?, 
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(
          data.title,
          data.product_id || null,
          data.category_id || null,
          data.poster_url,
          data.short_desc || '',
          data.short_desc_ml || '',
          data.detailed_desc || '',
          data.detailed_desc_ml || '',
          data.price !== undefined ? parseFloat(data.price) : null,
          data.features || '',
          data.promo_info || '',
          data.priority !== undefined ? parseInt(data.priority) : 1,
          data.status || 'draft',
          data.display_page_id !== undefined ? parseInt(data.display_page_id) : 1,
          id
        ).run();
      } catch (dbErr) {
        console.warn('[D1 Ad Update Notice]:', dbErr.message);
      }
    }

    // Central Cloud Store Sync
    try {
      await fetch(`https://ai-advertising-robot-8.onrender.com/api/advertisements/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    } catch (syncErr) {}

    return jsonResponse({ success: true, message: 'Advertisement updated successfully' });
  } catch (err) {
    return jsonResponse({ error: 'Failed to update advertisement: ' + err.message }, 500);
  }
}

/**
 * DELETE /api/advertisements/:id
 */
export async function handleDeleteAdvertisement(request, env, id) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  // Remove from memory
  const idx = memoryAds.findIndex(a => a.id === id);
  if (idx !== -1) {
    memoryAds.splice(idx, 1);
  }

  // Remove from DB if attached
  if (env && env.DB) {
    try {
      await env.DB.prepare('DELETE FROM advertisements WHERE id = ?').bind(id).run();
    } catch (e) {
      console.warn('[D1 Ad Delete Notice]:', e.message);
    }
  }

  // Central Cloud Store Sync
  try {
    await fetch(`https://ai-advertising-robot-8.onrender.com/api/advertisements/${id}`, { method: 'DELETE' });
  } catch (syncErr) {}

  return jsonResponse({ success: true, message: 'Advertisement deleted successfully' });
}

/**
 * POST /api/advertisements/:id/play-now (Manual Override)
 */
export async function handlePlayNow(request, env, id) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  let targetTitle = 'Advertisement';
  let targetPageId = 1;

  // In memory
  memoryAds.forEach(a => {
    if (a.id === id) {
      a.status = 'active';
      targetTitle = a.title;
      targetPageId = a.display_page_id || 1;
    } else if (a.status === 'active') {
      a.status = 'scheduled';
    }
  });
  activeAdId = id;

  if (env.DB) {
    try {
      const ad = await env.DB.prepare('SELECT id, title, display_page_id FROM advertisements WHERE id = ?').bind(id).first();
      if (ad) {
        targetTitle = ad.title;
        targetPageId = ad.display_page_id || 1;
      }
      await env.DB.batch([
        env.DB.prepare("UPDATE advertisements SET status = 'scheduled' WHERE status = 'active'"),
        env.DB.prepare("UPDATE advertisements SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id),
        env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('active_ad_id', ?)").bind(id),
        env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('active_ad_page_id', ?)").bind(String(targetPageId))
      ]);
    } catch (e) {}
  }

  return jsonResponse({
    success: true,
    message: `Advertisement "${targetTitle}" is now broadcasting live on display.`,
    activeAdId: id,
    displayPageId: targetPageId
  });
}

/**
 * POST /api/advertisements/:id/pause
 */
export async function handlePauseAdvertisement(request, env, id) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const idx = memoryAds.findIndex(a => a.id === id);
  if (idx !== -1) memoryAds[idx].status = 'paused';

  if (env.DB) {
    try {
      await env.DB.prepare("UPDATE advertisements SET status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
    } catch (e) {}
  }

  return jsonResponse({ success: true, message: 'Advertisement paused.' });
}

/**
 * POST /api/advertisements/:id/resume
 */
export async function handleResumeAdvertisement(request, env, id) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const idx = memoryAds.findIndex(a => a.id === id);
  if (idx !== -1) memoryAds[idx].status = 'active';

  if (env.DB) {
    try {
      await env.DB.prepare("UPDATE advertisements SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
    } catch (e) {}
  }

  return jsonResponse({ success: true, message: 'Advertisement resumed.' });
}

/**
 * GET /api/advertisements/history
 */
export async function handleAdvertisementHistory(request, env) {
  if (env.DB) {
    try {
      const history = await env.DB.prepare(`
        SELECT h.*, a.title as ad_title, a.poster_url 
        FROM advertisement_history h 
        LEFT JOIN advertisements a ON h.advertisement_id = a.id 
        ORDER BY h.activation_time DESC LIMIT 50
      `).all();
      if (history && history.results) {
        return jsonResponse({ history: history.results });
      }
    } catch (e) {}
  }

  return jsonResponse({ history: [] });
}
