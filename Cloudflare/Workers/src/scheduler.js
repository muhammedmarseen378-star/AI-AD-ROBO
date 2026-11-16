// ============================================================================
// Cloudflare Workers Server-Side Advertisement Scheduler
// Automated ad evaluation using Cloudflare Cron Triggers & Asia/Kolkata Timezone
// ============================================================================

import { generateRandomHex } from './crypto.js';
import { authenticateAdmin, jsonResponse } from './auth.js';

export const memorySchedules = [];

/**
 * Get current ISO time string in Asia/Kolkata (IST = UTC + 5:30)
 */
export function getKolkataTime() {
  const now = new Date();
  // Format to Asia/Kolkata YYYY-MM-DD HH:mm:ss
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  return formatter.format(now).replace(',', '');
}

/**
 * Core Scheduler Evaluation Function
 * Runs via Cloudflare Cron Trigger (every 60 seconds) or via manual API trigger
 */
export async function evaluateAdvertisementSchedules(env) {
  if (!env || !env.DB) {
    return { action: 'DB_NOT_CONFIGURED', message: 'D1 Database not yet linked.' };
  }
  const currentTimeKolkata = getKolkataTime();
  const nowUtc = new Date().toISOString();

  // Find all active schedules valid for the current time
  // Matches start_time <= current AND end_time >= current AND is_active = 1
  const validSchedules = await env.DB.prepare(`
    SELECT s.id as schedule_id, s.priority as schedule_priority, s.duration_sec,
           a.id as ad_id, a.title, a.priority as ad_priority, a.status, a.display_page_id
    FROM advertisement_schedules s
    JOIN advertisements a ON s.advertisement_id = a.id
    WHERE s.is_active = 1 
      AND a.status != 'paused' 
      AND a.status != 'draft'
      AND s.start_time <= ? 
      AND s.end_time >= ?
    ORDER BY s.priority DESC, a.priority DESC, s.start_time ASC
  `).bind(currentTimeKolkata, currentTimeKolkata).all();

  const candidates = validSchedules.results || [];

  if (candidates.length === 0) {
    // If no specific schedule matches current time window, pick default active or highest priority scheduled ad
    const fallbackAd = await env.DB.prepare(`
      SELECT id, title, display_page_id, status FROM advertisements 
      WHERE status != 'paused' AND status != 'draft' 
      ORDER BY priority DESC, updated_at DESC LIMIT 1
    `).first();

    if (fallbackAd && fallbackAd.status !== 'active') {
      await activateAd(env, fallbackAd.id, fallbackAd.title, fallbackAd.display_page_id || 1, 'FALLBACK_SCHEDULE');
      return { action: 'ACTIVATED_FALLBACK', adId: fallbackAd.id };
    }
    return { action: 'NO_CANDIDATE_FOUND', message: 'Current active ad maintained.' };
  }

  // Winning candidate is the highest priority ad (index 0)
  const winner = candidates[0];

  // Get currently active ad from system_settings
  const activeSetting = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'active_ad_id'").first();
  const currentActiveAdId = activeSetting ? activeSetting.value : null;

  // Idempotency: If the winner is already active, do nothing
  if (currentActiveAdId === winner.ad_id) {
    return { action: 'ALREADY_ACTIVE', adId: winner.ad_id, title: winner.title };
  }

  // Otherwise, activate the new winner
  await activateAd(env, winner.ad_id, winner.title, winner.display_page_id || 1, 'SCHEDULED_TRANSITION');

  return {
    action: 'SWITCHED_ADVERTISEMENT',
    previousAdId: currentActiveAdId,
    newAdId: winner.ad_id,
    title: winner.title,
    pageId: winner.display_page_id || 1,
    time: currentTimeKolkata
  };
}

/**
 * Helper to activate an advertisement and notify ESP32 robot
 */
async function activateAd(env, adId, title, pageId, triggerType) {
  const currentActive = await env.DB.prepare("SELECT id FROM advertisements WHERE status = 'active'").first();

  await env.DB.batch([
    // Update statuses
    env.DB.prepare("UPDATE advertisements SET status = 'scheduled' WHERE status = 'active'"),
    env.DB.prepare("UPDATE advertisements SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(adId),
    env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('active_ad_id', ?)").bind(adId),
    env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('active_ad_page_id', ?)").bind(String(pageId)),
    // Record in history
    env.DB.prepare(`
      INSERT INTO advertisement_history (id, advertisement_id, activation_time, previous_ad_id, trigger_type, details)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
    `).bind(
      generateRandomHex(16),
      adId,
      currentActive?.id || null,
      triggerType,
      `Automatic schedule switch: Activated "${title}" (DWIN Page ${pageId})`
    )
  ]);

  // Push SYNC_AD command for the ESP32 Main Controller
  const commandId = `cmd_${generateRandomHex(8)}`;
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  await env.DB.prepare(`
    INSERT INTO robot_commands (id, device_id, command_type, payload_json, status, expires_at)
    VALUES (?, 'ESP32_MAIN_ROBOT_01', 'SYNC_AD', ?, 'PENDING', ?)
  `).bind(commandId, JSON.stringify({ adId, pageId }), expiresAt).run();
}

/**
 * POST /api/schedules/evaluate (Admin trigger or testing)
 */
export async function handleEvaluateScheduleApi(request, env) {
  const result = await evaluateAdvertisementSchedules(env);
  return jsonResponse({ success: true, evaluation: result });
}

/**
 * GET /api/schedules (List all schedule rules)
 */
export async function handleListSchedules(request, env) {
  if (env && env.DB) {
    try {
      const schedules = await env.DB.prepare(`
        SELECT s.*, a.title as ad_title, a.poster_url, a.display_page_id
        FROM advertisement_schedules s
        LEFT JOIN advertisements a ON s.advertisement_id = a.id
        ORDER BY s.priority DESC, s.start_time ASC
      `).all();

      if (schedules && Array.isArray(schedules.results)) {
        return jsonResponse({ schedules: schedules.results });
      }
    } catch (e) {
      console.warn('[D1 Schedule List Notice]:', e.message);
    }
  }

  // 2. Secondary: Central Cloud Store Fallback (if D1 is unprovisioned)
  try {
    const cloudRes = await fetch('https://ai-advertising-robot-8.onrender.com/api/schedules', {
      headers: { 'Accept': 'application/json' }
    });
    if (cloudRes.ok) {
      const d = await cloudRes.json();
      if (d && Array.isArray(d.schedules)) {
        return jsonResponse({ schedules: d.schedules });
      }
    }
  } catch (cloudErr) {}

  return jsonResponse({ schedules: memorySchedules });
}

/**
 * POST /api/schedules
 */
export async function handleCreateSchedule(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const data = await request.json();
    const newSchedule = {
      id: data.id || `sched_${Date.now().toString(36)}`,
      advertisement_id: data.advertisement_id || '',
      ad_title: data.ad_title || '',
      display_page_id: parseInt(data.display_page_id || 1),
      start_time: data.start_time || '09:00',
      end_time: data.end_time || '21:00',
      duration_sec: parseInt(data.duration_sec || 30),
      days: data.days || 'Every Day',
      priority: parseInt(data.priority || 2),
      is_active: data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1,
      created_at: data.created_at || new Date().toISOString()
    };

    // 1. Isolate memory
    const existingIdx = memorySchedules.findIndex(s => s.id === newSchedule.id);
    if (existingIdx !== -1) {
      memorySchedules[existingIdx] = newSchedule;
    } else {
      memorySchedules.push(newSchedule);
    }

    // 2. Primary: Cloudflare D1 with ON CONFLICT
    if (env && env.DB) {
      try {
        await env.DB.prepare(`
          INSERT INTO advertisement_schedules (id, advertisement_id, start_time, end_time, duration_sec, priority, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            advertisement_id = excluded.advertisement_id,
            start_time = excluded.start_time,
            end_time = excluded.end_time,
            duration_sec = excluded.duration_sec,
            priority = excluded.priority,
            is_active = excluded.is_active
        `).bind(
          newSchedule.id,
          newSchedule.advertisement_id,
          newSchedule.start_time,
          newSchedule.end_time,
          newSchedule.duration_sec,
          newSchedule.priority,
          newSchedule.is_active
        ).run();
      } catch (e) {
        console.warn('[D1 Schedule Upsert Notice]:', e.message);
      }
    }

    // 3. Central Cloud Store Sync
    try {
      await fetch('https://ai-advertising-robot-8.onrender.com/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSchedule)
      });
    } catch (e) {}

    return jsonResponse({ success: true, schedule: newSchedule }, 201);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

/**
 * PUT /api/schedules/:id
 */
export async function handleUpdateSchedule(request, env, id) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const data = await request.json();
    const idx = memorySchedules.findIndex(s => s.id === id);
    if (idx !== -1) {
      memorySchedules[idx] = { ...memorySchedules[idx], ...data, updated_at: new Date().toISOString() };
    }

    if (env && env.DB) {
      try {
        await env.DB.prepare(`
          UPDATE advertisement_schedules 
          SET start_time = ?, end_time = ?, duration_sec = ?, priority = ?, is_active = ?
          WHERE id = ?
        `).bind(data.start_time, data.end_time, data.duration_sec, data.priority, data.is_active ? 1 : 0, id).run();
      } catch (e) {}
    }

    // Central Cloud Store Sync
    try {
      await fetch(`https://ai-advertising-robot-8.onrender.com/api/schedules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    } catch (e) {}

    return jsonResponse({ success: true, schedule: memorySchedules[idx] || data });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

/**
 * DELETE /api/schedules/:id
 */
export async function handleDeleteSchedule(request, env, id) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const idx = memorySchedules.findIndex(s => s.id === id);
    if (idx !== -1) {
      memorySchedules.splice(idx, 1);
    }

    if (env && env.DB) {
      try {
        await env.DB.prepare('DELETE FROM advertisement_schedules WHERE id = ?').bind(id).run();
      } catch (e) {}
    }

    // Central Cloud Store Sync
    try {
      await fetch(`https://ai-advertising-robot-8.onrender.com/api/schedules/${id}`, {
        method: 'DELETE'
      });
    } catch (e) {}

    return jsonResponse({ success: true, message: 'Schedule deleted successfully.' });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

/**
 * POST /api/schedules/:id/toggle
 */
export async function handleToggleSchedule(request, env, id) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const idx = memorySchedules.findIndex(s => s.id === id);
    let activeVal = 1;
    if (idx !== -1) {
      memorySchedules[idx].is_active = memorySchedules[idx].is_active ? 0 : 1;
      activeVal = memorySchedules[idx].is_active;
    }

    if (env && env.DB) {
      try {
        await env.DB.prepare('UPDATE advertisement_schedules SET is_active = ? WHERE id = ?').bind(activeVal, id).run();
      } catch (e) {}
    }

    // Central Cloud Store Sync
    try {
      await fetch(`https://ai-advertising-robot-8.onrender.com/api/schedules/${id}/toggle`, {
        method: 'POST'
      });
    } catch (e) {}

    return jsonResponse({ success: true, schedule: memorySchedules[idx] });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}
