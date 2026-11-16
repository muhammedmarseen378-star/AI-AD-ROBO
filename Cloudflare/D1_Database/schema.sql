-- ============================================================================
-- AI ADVERTISEMENT ROBOT - CLOUDFLARE D1 DATABASE SCHEMA
-- Mechatronics Engineering Final Year Project
-- Administrator Account: nttf.ttc.m3b.group1.project@gmail.com
-- Database: SQLite-compatible Cloudflare D1
-- ============================================================================

-- 1. Admins Table
CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'superadmin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Admin Sessions Table
CREATE TABLE IF NOT EXISTS admin_sessions (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
);

-- 3. Product Categories Table
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Products Table
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category_id TEXT NOT NULL,
    brand TEXT,
    model TEXT,
    price REAL,
    currency TEXT DEFAULT 'INR',
    description TEXT,
    description_ml TEXT, -- Malayalam description
    features_json TEXT,  -- JSON array of bullet features
    specs_json TEXT,     -- JSON object of key-value technical specs
    promo_info TEXT,     -- Verified promotional offers
    availability TEXT DEFAULT 'In Stock',
    faq_json TEXT,       -- JSON array of {q: "", a: ""}
    image_url TEXT,      -- R2 image reference or URL
    notes TEXT,
    is_verified INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- 5. Advertisements Table
CREATE TABLE IF NOT EXISTS advertisements (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    product_id TEXT,
    category_id TEXT,
    poster_url TEXT NOT NULL,
    short_desc TEXT,
    short_desc_ml TEXT,
    detailed_desc TEXT,
    detailed_desc_ml TEXT,
    price REAL,
    features TEXT,
    promo_info TEXT,
    priority INTEGER DEFAULT 1, -- 1=Normal, 2=High, 3=Urgent/Override
    status TEXT NOT NULL DEFAULT 'draft', -- 'draft', 'scheduled', 'active', 'paused', 'completed', 'expired'
    display_page_id INTEGER DEFAULT 1,    -- Corresponding DWIN HMI Page ID (1-5)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

-- 6. Advertisement Schedules Table
CREATE TABLE IF NOT EXISTS advertisement_schedules (
    id TEXT PRIMARY KEY,
    advertisement_id TEXT NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    duration_sec INTEGER DEFAULT 30,
    priority INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    days_of_week TEXT DEFAULT '1,2,3,4,5,6,7',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (advertisement_id) REFERENCES advertisements(id) ON DELETE CASCADE
);

-- 7. Advertisement History Table
CREATE TABLE IF NOT EXISTS advertisement_history (
    id TEXT PRIMARY KEY,
    advertisement_id TEXT,
    activation_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    previous_ad_id TEXT,
    next_ad_id TEXT,
    trigger_type TEXT NOT NULL, -- 'SCHEDULED', 'PLAY_NOW', 'MANUAL_OVERRIDE', 'FALLBACK'
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. AI Knowledge Base Table
CREATE TABLE IF NOT EXISTS ai_knowledge (
    id TEXT PRIMARY KEY,
    category TEXT,
    topic TEXT,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    language TEXT DEFAULT 'en', -- 'en', 'ml'
    source TEXT DEFAULT 'verified_product',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. Customer Voice Questions Table
CREATE TABLE IF NOT EXISTS customer_questions (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    language TEXT DEFAULT 'en-IN',
    recognized_text TEXT NOT NULL,
    ai_response TEXT NOT NULL,
    referenced_product_id TEXT,
    latency_ms INTEGER,
    status TEXT DEFAULT 'answered',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 10. AI Logs Table
CREATE TABLE IF NOT EXISTS ai_logs (
    id TEXT PRIMARY KEY,
    model_used TEXT NOT NULL,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    request_type TEXT NOT NULL, -- 'PRODUCT_RESEARCH', 'VOICE_QA', 'COPYWRITING', 'TEST'
    status TEXT NOT NULL,        -- 'SUCCESS', 'RATE_LIMITED', 'ERROR'
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 11. Devices Table (ESP32-S3 Main Controller, AI Camera)
CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    device_name TEXT NOT NULL,
    device_type TEXT NOT NULL, -- 'MAIN_CONTROLLER', 'AI_CAMERA'
    api_key_hash TEXT NOT NULL,
    firmware_version TEXT DEFAULT '1.0.0',
    ip_address TEXT,
    last_seen TIMESTAMP,
    status TEXT DEFAULT 'offline', -- 'online', 'offline', 'error'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 12. Device Auth Tokens Table
CREATE TABLE IF NOT EXISTS device_auth (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

-- 13. Robot Telemetry Table
CREATE TABLE IF NOT EXISTS robot_telemetry (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    operating_mode TEXT DEFAULT 'MANUAL', -- 'MANUAL', 'AUTONOMOUS', 'EMERGENCY_STOP'
    motor_state TEXT DEFAULT 'STOPPED',   -- 'FORWARD', 'REVERSE', 'LEFT', 'RIGHT', 'STOPPED'
    speed_left INTEGER DEFAULT 0,
    speed_right INTEGER DEFAULT 0,
    front_distance_cm REAL DEFAULT 0.0,
    obstacle_detected INTEGER DEFAULT 0,
    person_detected INTEGER DEFAULT 0,
    tracking_active INTEGER DEFAULT 0,
    tracking_id INTEGER DEFAULT 0,
    target_pos_x INTEGER DEFAULT 0,
    wifi_rssi INTEGER DEFAULT 0,
    battery_volts REAL,                  -- NULL unless actual voltage sensor installed
    emergency_stopped INTEGER DEFAULT 0,
    error_flags TEXT DEFAULT 'NONE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

-- 14. Sensor Status Table
CREATE TABLE IF NOT EXISTS sensor_status (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    sensor_name TEXT NOT NULL, -- 'HC-SR04', 'INMP441', 'MPU6050', 'MAX98357A', 'DWIN_HMI'
    is_healthy INTEGER DEFAULT 1,
    last_read_value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

-- 15. Camera Status Table
CREATE TABLE IF NOT EXISTS camera_status (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    is_connected INTEGER DEFAULT 0,
    fps REAL DEFAULT 0.0,
    detections_count INTEGER DEFAULT 0,
    stream_active INTEGER DEFAULT 0,
    stream_url TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

-- 16. System Settings Table (Key-Value configuration including encrypted Grok API key)
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    is_encrypted INTEGER DEFAULT 0,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 17. Activity Logs Table
CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    actor TEXT NOT NULL, -- 'admin:nttf.ttc.m3b.group1.project@gmail.com', 'system_cron', 'esp32_device'
    action TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 18. Error Logs Table
CREATE TABLE IF NOT EXISTS error_logs (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL, -- 'WORKER_API', 'SCHEDULER', 'GROK_API', 'ESP32_MAIN', 'AI_CAMERA'
    error_code TEXT,
    error_message TEXT NOT NULL,
    stack_trace TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 19. Robot Commands Table (Manual and autonomous dispatch with strict TTL)
CREATE TABLE IF NOT EXISTS robot_commands (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    command_type TEXT NOT NULL, -- 'MOVE', 'STOP', 'EMERGENCY_STOP', 'RESET_ESTOP', 'SET_MODE', 'SYNC_AD'
    payload_json TEXT,
    status TEXT DEFAULT 'PENDING', -- 'PENDING', 'ACKNOWLEDGED', 'COMPLETED', 'EXPIRED', 'REJECTED'
    expires_at TIMESTAMP NOT NULL,
    executed_at TIMESTAMP,
    ack_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

-- Indexes for high-frequency queries
CREATE INDEX IF NOT EXISTS idx_schedules_times ON advertisement_schedules(start_time, end_time, is_active);
CREATE INDEX IF NOT EXISTS idx_telemetry_device_time ON robot_telemetry(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commands_pending ON robot_commands(device_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_ads_status ON advertisements(status, priority);
CREATE INDEX IF NOT EXISTS idx_activity_logs_date ON activity_logs(created_at DESC);
