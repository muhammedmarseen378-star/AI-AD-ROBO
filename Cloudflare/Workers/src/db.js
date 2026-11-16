// ============================================================================
// Cloudflare D1 Database Auto-Initialization & Resilience Module
// Automatically provisions all SQLite tables on Cloudflare Workers startup
// ============================================================================

let isInitialized = false;

export async function ensureDatabase(env) {
  if (isInitialized || !env || !env.DB) return;

  try {
    await env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS admins (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          salt TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'superadmin',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS admin_sessions (
          id TEXT PRIMARY KEY,
          admin_id TEXT NOT NULL,
          token_hash TEXT UNIQUE NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          ip_address TEXT,
          user_agent TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS categories (
          id TEXT PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          slug TEXT UNIQUE NOT NULL,
          description TEXT,
          display_order INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS products (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          category_id TEXT NOT NULL,
          brand TEXT,
          model TEXT,
          price REAL,
          currency TEXT DEFAULT 'INR',
          description TEXT,
          description_ml TEXT,
          features_json TEXT,
          specs_json TEXT,
          promo_info TEXT,
          availability TEXT DEFAULT 'In Stock',
          faq_json TEXT,
          image_url TEXT,
          notes TEXT,
          is_verified INTEGER DEFAULT 1,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `),
      env.DB.prepare(`
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
          priority INTEGER DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'draft',
          display_page_id INTEGER DEFAULT 1,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS advertisement_schedules (
          id TEXT PRIMARY KEY,
          advertisement_id TEXT NOT NULL,
          start_time TIMESTAMP NOT NULL,
          end_time TIMESTAMP NOT NULL,
          duration_sec INTEGER DEFAULT 0,
          priority INTEGER DEFAULT 1,
          is_active INTEGER DEFAULT 1,
          days_of_week TEXT DEFAULT '1,2,3,4,5,6,7',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS advertisement_history (
          id TEXT PRIMARY KEY,
          advertisement_id TEXT,
          activation_time TIMESTAMP NOT NULL,
          end_time TIMESTAMP,
          previous_ad_id TEXT,
          next_ad_id TEXT,
          trigger_type TEXT NOT NULL,
          details TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS activity_logs (
          id TEXT PRIMARY KEY,
          actor TEXT,
          action TEXT,
          details TEXT,
          ip_address TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS system_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS robot_commands (
          id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          command_type TEXT NOT NULL,
          payload_json TEXT,
          status TEXT DEFAULT 'PENDING',
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS media_files (
          id TEXT PRIMARY KEY,
          mime_type TEXT NOT NULL,
          data_base64 TEXT NOT NULL,
          file_size INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `)
    ]);

    isInitialized = true;
  } catch (err) {
    console.warn('[D1] Auto-init batch notice:', err.message);
  }
}
