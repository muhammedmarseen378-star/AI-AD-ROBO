// ============================================================================
// Cloudflare Workers Robot Communication & Telemetry Module
// Secure device authentication, live telemetry, command dispatch, and emergency stop
// ============================================================================

import { authenticateAdmin, jsonResponse } from './auth.js';
import { generateRandomHex, sha256Hex } from './crypto.js';

const DEFAULT_MAIN_ROBOT_ID = 'ESP32_MAIN_ROBOT_01';
const DEFAULT_CAM_ID = 'ESP32_CAM_AI_01';

// Resilient In-Memory State for ESP32 Communication & Live Telemetry
export const memoryRobot = {
  lastSeen: 0,
  ipAddress: null,
  firmwareVersion: '1.0.0',
  telemetry: {
    operating_mode: 'MANUAL',
    motor_state: 'STOPPED',
    speed_left: 0,
    speed_right: 0,
    front_distance_cm: 120.0,
    obstacle_detected: 0,
    person_detected: 0,
    tracking_active: 0,
    tracking_id: 0,
    target_pos_x: 0,
    wifi_rssi: -58,
    battery_volts: 12.6,
    emergency_stopped: 0
  },
  emergencyStopActive: false,
  activeAdId: null,
  activePageId: 1,
  pendingCommands: []
};

// Resilient In-Memory State for Dedicated ESP32-S3 AI Camera
export const memoryCamera = {
  lastSeen: 0,
  ipAddress: null,
  fps: 25,
  resolution: '1280x720',
  streamActive: false,
  streamUrl: null
};

/**
 * Verify Device Authentication Header
 */
async function authenticateDevice(request, env) {
  const deviceKey = request.headers.get('X-Device-Key');
  const deviceId = request.headers.get('X-Device-Id') || DEFAULT_MAIN_ROBOT_ID;

  if (!deviceKey) return null;

  // 1. Check against master Worker secret
  const expectedPsk = env.ROBOT_PSK_SECRET || 'SevenSemi_ESP32_Secret_2026';
  if (deviceKey === expectedPsk) {
    return { deviceId, authorized: true };
  }

  // 2. Check against hash in devices table if DB is available
  if (env.DB) {
    try {
      const keyHash = await sha256Hex(deviceKey);
      const dev = await env.DB.prepare('SELECT id, device_type FROM devices WHERE id = ? AND api_key_hash = ?')
        .bind(deviceId, keyHash).first();

      if (dev) {
        return { deviceId: dev.id, deviceType: dev.device_type, authorized: true };
      }
    } catch (e) {}
  }

  return null;
}

/**
 * POST /api/robot/heartbeat
 * Consumed every 2-5 seconds by SevenSemi ESP32-S3 Main Controller
 */
export async function handleRobotHeartbeat(request, env) {
  const devAuth = await authenticateDevice(request, env);
  if (!devAuth) {
    return jsonResponse({ error: 'Device authentication failed. Invalid X-Device-Key.' }, 401);
  }

  try {
    const data = await request.json();
    const nowIso = new Date().toISOString();
    const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';

    // Update in-memory telemetry state for immediate real-time dashboard readout
    memoryRobot.lastSeen = Date.now();
    memoryRobot.ipAddress = ip;
    memoryRobot.firmwareVersion = data.firmwareVersion || '1.0.0';
    memoryRobot.telemetry = {
      operating_mode: data.operatingMode || 'MANUAL',
      motor_state: data.motorState || 'STOPPED',
      speed_left: data.speedLeft || 0,
      speed_right: data.speedRight || 0,
      front_distance_cm: data.frontDistanceCm !== undefined ? parseFloat(data.frontDistanceCm) : 120.0,
      obstacle_detected: data.obstacleDetected ? 1 : 0,
      person_detected: data.personDetected ? 1 : 0,
      tracking_active: data.trackingActive ? 1 : 0,
      tracking_id: data.trackingId || 0,
      target_pos_x: data.targetPosX || 0,
      wifi_rssi: data.wifiRssi || -58,
      battery_volts: data.batteryVolts !== undefined ? parseFloat(data.batteryVolts) : 12.6,
      emergency_stopped: data.emergencyStopped ? 1 : 0
    };

    let isEStopActive = memoryRobot.emergencyStopActive;
    let activeAdId = memoryRobot.activeAdId || null;
    let displayPageId = memoryRobot.activePageId || 1;
    let commandsToDispatch = [];

    // Optional D1 persistence if DB is attached
    if (env.DB) {
      try {
        await env.DB.prepare(`
          UPDATE devices SET 
            last_seen = CURRENT_TIMESTAMP, 
            status = 'online', 
            ip_address = ?,
            firmware_version = ?
          WHERE id = ?
        `).bind(ip, data.firmwareVersion || '1.0.0', devAuth.deviceId).run();

        const telemId = generateRandomHex(16);
        await env.DB.prepare(`
          INSERT INTO robot_telemetry (
            id, device_id, operating_mode, motor_state, speed_left, speed_right,
            front_distance_cm, obstacle_detected, person_detected, tracking_active,
            tracking_id, target_pos_x, wifi_rssi, battery_volts, emergency_stopped, error_flags
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          telemId, devAuth.deviceId, data.operatingMode || 'MANUAL', data.motorState || 'STOPPED',
          data.speedLeft || 0, data.speedRight || 0,
          data.frontDistanceCm !== undefined ? parseFloat(data.frontDistanceCm) : 0.0,
          data.obstacleDetected ? 1 : 0, data.personDetected ? 1 : 0,
          data.trackingActive ? 1 : 0, data.trackingId || 0, data.targetPosX || 0,
          data.wifiRssi || 0, data.batteryVolts !== undefined ? parseFloat(data.batteryVolts) : null,
          data.emergencyStopped ? 1 : 0, data.errorFlags || 'NONE'
        ).run();

        const activeSetting = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'active_ad_id'").first();
        const pageSetting = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'active_ad_page_id'").first();
        const estopSetting = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'emergency_stop_active'").first();

        if (estopSetting?.value) isEStopActive = estopSetting.value === 'true';
        if (activeSetting?.value) activeAdId = activeSetting.value;
        if (pageSetting?.value) displayPageId = parseInt(pageSetting.value);

        const pendingCommands = await env.DB.prepare(`
          SELECT id, command_type, payload_json, expires_at 
          FROM robot_commands 
          WHERE device_id = ? AND status = 'PENDING' AND expires_at > ?
          ORDER BY created_at ASC
        `).bind(devAuth.deviceId, nowIso).all();

        if (pendingCommands?.results?.length > 0) {
          commandsToDispatch = pendingCommands.results;
          for (const cmd of pendingCommands.results) {
            await env.DB.prepare("UPDATE robot_commands SET status = 'DISPATCHED' WHERE id = ?").bind(cmd.id).run();
          }
        }
      } catch (dbErr) {
        // Fall back to memory dispatch
      }
    }

    // Merge in-memory queued commands if DB didn't supply them
    if (commandsToDispatch.length === 0 && memoryRobot.pendingCommands.length > 0) {
      commandsToDispatch = memoryRobot.pendingCommands.splice(0, memoryRobot.pendingCommands.length);
    }

    return jsonResponse({
      status: 'OK',
      timestamp: nowIso,
      emergencyStopActive: isEStopActive,
      activeAdvertisement: {
        adId: activeAdId,
        displayPageId: displayPageId
      },
      commands: commandsToDispatch
    });
  } catch (err) {
    return jsonResponse({ error: 'Heartbeat processing failed: ' + err.message }, 500);
  }
}

/**
 * POST /api/robot/command/ack (ESP32 acknowledges command completion)
 */
export async function handleCommandAck(request, env) {
  const devAuth = await authenticateDevice(request, env);
  if (!devAuth) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { commandId, status, message } = await request.json();
  if (!commandId) return jsonResponse({ error: 'Command ID required' }, 400);

  if (env.DB) {
    try {
      await env.DB.prepare(`
        UPDATE robot_commands SET 
          status = ?, 
          executed_at = CURRENT_TIMESTAMP, 
          ack_message = ? 
        WHERE id = ? AND device_id = ?
      `).bind(status || 'COMPLETED', message || 'Executed', commandId, devAuth.deviceId).run();
    } catch (e) {}
  }

  return jsonResponse({ success: true });
}

/**
 * POST /api/robot/command (Admin manual control or mode dispatch)
 */
export async function handleDispatchCommand(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { commandType, payload, ttlSeconds } = await request.json();
  if (!commandType) return jsonResponse({ error: 'commandType is required' }, 400);

  // Check if E-stop is active: If so, reject movement commands
  if (memoryRobot.emergencyStopActive && commandType === 'MOVE') {
    return jsonResponse({ error: 'Emergency Stop is currently active. Reset Emergency Stop before dispatching movement.' }, 403);
  }

  const ttl = ttlSeconds ? parseInt(ttlSeconds) : 5; // Default 5s TTL for movement
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  const commandId = `cmd_${generateRandomHex(8)}`;

  const cmdObj = {
    id: commandId,
    command_type: commandType,
    payload_json: JSON.stringify(payload || {}),
    expires_at: expiresAt
  };

  memoryRobot.pendingCommands.push(cmdObj);

  if (env.DB) {
    try {
      await env.DB.prepare(`
        INSERT INTO robot_commands (id, device_id, command_type, payload_json, status, expires_at)
        VALUES (?, ?, ?, ?, 'PENDING', ?)
      `).bind(commandId, DEFAULT_MAIN_ROBOT_ID, commandType, JSON.stringify(payload || {}), expiresAt).run();
    } catch (e) {}
  }

  return jsonResponse({
    success: true,
    commandId,
    commandType,
    expiresAt
  });
}

/**
 * POST /api/robot/emergency-stop (Emergency Stop trigger)
 */
export async function handleEmergencyStop(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  const commandId = `estop_${generateRandomHex(8)}`;

  memoryRobot.emergencyStopActive = true;
  memoryRobot.telemetry.operating_mode = 'EMERGENCY_STOP';
  memoryRobot.telemetry.emergency_stopped = 1;
  memoryRobot.pendingCommands = [{
    id: commandId,
    command_type: 'EMERGENCY_STOP',
    payload_json: '{}',
    expires_at: expiresAt
  }];

  if (env.DB) {
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('emergency_stop_active', 'true')"),
        env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('robot_operating_mode', 'EMERGENCY_STOP')"),
        env.DB.prepare("UPDATE robot_commands SET status = 'EXPIRED' WHERE status = 'PENDING' AND command_type = 'MOVE'"),
        env.DB.prepare(`
          INSERT INTO robot_commands (id, device_id, command_type, payload_json, status, expires_at)
          VALUES (?, ?, 'EMERGENCY_STOP', '{}', 'PENDING', ?)
        `).bind(commandId, DEFAULT_MAIN_ROBOT_ID, expiresAt)
      ]);
    } catch (e) {}
  }

  return jsonResponse({
    success: true,
    message: 'EMERGENCY STOP ACTIVATED. All motors commanded to stop immediately.',
    emergencyStopActive: true,
    commandId
  });
}

/**
 * POST /api/robot/emergency-stop/reset (Reset emergency stop state)
 */
export async function handleResetEmergencyStop(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const commandId = `reset_${generateRandomHex(8)}`;
  const expiresAt = new Date(Date.now() + 60000).toISOString();

  memoryRobot.emergencyStopActive = false;
  memoryRobot.telemetry.operating_mode = 'MANUAL';
  memoryRobot.telemetry.emergency_stopped = 0;
  memoryRobot.pendingCommands.push({
    id: commandId,
    command_type: 'RESET_ESTOP',
    payload_json: '{}',
    expires_at: expiresAt
  });

  if (env.DB) {
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('emergency_stop_active', 'false')"),
        env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('robot_operating_mode', 'MANUAL')"),
        env.DB.prepare(`
          INSERT INTO robot_commands (id, device_id, command_type, payload_json, status, expires_at)
          VALUES (?, ?, 'RESET_ESTOP', '{}', 'PENDING', ?)
        `).bind(commandId, DEFAULT_MAIN_ROBOT_ID, expiresAt)
      ]);
    } catch (e) {}
  }

  return jsonResponse({
    success: true,
    message: 'Emergency Stop cleared. Robot operating mode restored to MANUAL.',
    emergencyStopActive: false
  });
}

/**
 * GET /api/robot/status (Admin telemetry and health view)
 */
export async function handleGetRobotStatus(request, env) {
  try {
    let device = null;
    let latestTelem = null;
    let estopVal = memoryRobot.emergencyStopActive;

    if (env.DB) {
      try {
        device = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(DEFAULT_MAIN_ROBOT_ID).first();
        latestTelem = await env.DB.prepare(`
          SELECT * FROM robot_telemetry WHERE device_id = ? ORDER BY created_at DESC LIMIT 1
        `).bind(DEFAULT_MAIN_ROBOT_ID).first();
        const estopRow = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'emergency_stop_active'").first();
        if (estopRow?.value) estopVal = estopRow.value === 'true';
      } catch (dbErr) {}
    }

    // Determine if robot is online (heartbeat received within last 30 seconds)
    let isOnline = false;
    if (device?.last_seen) {
      const diffSeconds = (Date.now() - new Date(device.last_seen).getTime()) / 1000;
      isOnline = diffSeconds <= 30;
    } else if (memoryRobot.lastSeen > 0) {
      const diffSeconds = (Date.now() - memoryRobot.lastSeen) / 1000;
      isOnline = diffSeconds <= 30;
    }

    return jsonResponse({
      online: isOnline,
      device: {
        id: DEFAULT_MAIN_ROBOT_ID,
        name: device?.device_name || 'SevenSemi ESP32-S3 Main Controller',
        status: isOnline ? 'online' : 'offline',
        lastSeen: device?.last_seen || (memoryRobot.lastSeen ? new Date(memoryRobot.lastSeen).toISOString() : null),
        firmwareVersion: device?.firmware_version || memoryRobot.firmwareVersion || '1.0.0',
        ipAddress: device?.ip_address || memoryRobot.ipAddress || null
      },
      telemetry: latestTelem || memoryRobot.telemetry,
      emergencyStopActive: estopVal,
      activeAdId: memoryRobot.activeAdId
    });
  } catch (err) {
    return jsonResponse({
      online: (Date.now() - memoryRobot.lastSeen) <= 30000,
      device: {
        id: DEFAULT_MAIN_ROBOT_ID,
        name: 'SevenSemi ESP32-S3 Main Controller',
        status: (Date.now() - memoryRobot.lastSeen) <= 30000 ? 'online' : 'offline',
        lastSeen: memoryRobot.lastSeen ? new Date(memoryRobot.lastSeen).toISOString() : null,
        firmwareVersion: memoryRobot.firmwareVersion
      },
      telemetry: memoryRobot.telemetry,
      emergencyStopActive: memoryRobot.emergencyStopActive
    });
  }
}

/**
 * POST /api/camera/heartbeat (ESP32-S3 AI Camera status)
 */
export async function handleCameraHeartbeat(request, env) {
  const devAuth = await authenticateDevice(request, env);
  const data = await request.json();
  const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
  const deviceId = devAuth?.deviceId || request.headers.get('X-Device-Id') || DEFAULT_CAM_ID;

  memoryCamera.lastSeen = Date.now();
  memoryCamera.ipAddress = data.ip || ip;
  memoryCamera.fps = data.fps || 25;
  memoryCamera.resolution = data.resolution || '1280x720';
  memoryCamera.streamActive = true;
  memoryCamera.streamUrl = data.stream_url || data.streamUrl || `http://${data.ip || ip}:81/stream`;

  if (env.DB) {
    try {
      await env.DB.prepare(`
        UPDATE devices SET 
          last_seen = CURRENT_TIMESTAMP, 
          status = 'online', 
          ip_address = ? 
        WHERE id = ?
      `).bind(ip, deviceId).run();

      await env.DB.prepare(`
        INSERT INTO camera_status (id, device_id, is_connected, fps, detections_count, stream_active, stream_url)
        VALUES (?, ?, 1, ?, ?, ?, ?)
      `).bind(
        generateRandomHex(16),
        deviceId,
        data.fps || 0,
        data.detectionsCount || 0,
        data.streamActive ? 1 : 0,
        data.streamUrl || null
      ).run();
    } catch (e) {}
  }

  return jsonResponse({ status: 'OK' });
}

/**
 * GET /api/camera/status
 */
export async function handleGetCameraStatus(request, env) {
  let device = null;
  let latestStatus = null;
  if (env.DB) {
    try {
      device = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(DEFAULT_CAM_ID).first();
      latestStatus = await env.DB.prepare(`
        SELECT * FROM camera_status WHERE device_id = ? ORDER BY updated_at DESC LIMIT 1
      `).bind(DEFAULT_CAM_ID).first();
    } catch (e) {}
  }

  let isOnline = false;
  if (device && device.last_seen) {
    const diffSeconds = (Date.now() - new Date(device.last_seen).getTime()) / 1000;
    isOnline = diffSeconds <= 20;
  } else if (memoryCamera.lastSeen > 0) {
    const diffSeconds = (Date.now() - memoryCamera.lastSeen) / 1000;
    isOnline = diffSeconds <= 20;
  }

  return jsonResponse({
    online: isOnline,
    device: {
      id: DEFAULT_CAM_ID,
      name: 'ESP32-S3 AI Vision Camera',
      status: isOnline ? 'online' : 'offline',
      lastSeen: device?.last_seen || (memoryCamera.lastSeen ? new Date(memoryCamera.lastSeen).toISOString() : null)
    },
    camera: latestStatus || {
      is_connected: isOnline ? 1 : 0,
      fps: isOnline ? memoryCamera.fps : 0,
      detections_count: 0,
      stream_active: isOnline ? 1 : 0,
      stream_url: isOnline ? memoryCamera.streamUrl : null
    }
  });
}
