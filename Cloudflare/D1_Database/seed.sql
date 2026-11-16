-- ============================================================================
-- AI ADVERTISEMENT ROBOT - INITIAL SEED DATA
-- Mechatronics Engineering Final Year Project
-- Administrator Account: nttf.ttc.m3b.group1.project@gmail.com
-- Password: group_1@nttf
-- ============================================================================

-- 1. Insert Pre-Configured Administrator Account (PBKDF2 SHA-256 with 100,000 iterations)
INSERT OR REPLACE INTO admins (id, email, password_hash, salt, role, updated_at) VALUES
('admin_nttf_01', 'nttf.ttc.m3b.group1.project@gmail.com', '62c2f5d5065463bbd80c4f8fb45b1230932b52142cf0bf1e045f565b81bb47de', 'cff010e1adc068af906840353003ce1f', 'superadmin', CURRENT_TIMESTAMP);

-- 2. Insert Default 21 Product Categories
INSERT OR IGNORE INTO categories (id, name, slug, description, display_order) VALUES
('cat_01', 'Food & Beverage', 'food-beverage', 'Packaged food, culinary items, snacks, and beverages', 1),
('cat_02', 'College / Education', 'college-education', 'College programs, technical training, admissions, and academic courses', 2),
('cat_03', 'Computer / Laptop', 'computer-laptop', 'Laptops, workstations, PC accessories, and computing peripherals', 3),
('cat_04', 'Mobile / Smartphone', 'mobile-smartphone', 'Flagship smartphones, budget devices, tablets, and mobile gadgets', 4),
('cat_05', 'Electronics', 'electronics', 'Consumer electronics, microcontrollers, smart gadgets, and IoT hardware', 5),
('cat_06', 'Automobile', 'automobile', 'Two-wheelers, four-wheelers, EV mobility, and automotive spares', 6),
('cat_07', 'Hotel / Resort', 'hotel-resort', 'Hospitality suites, destination stays, and luxury resort packages', 7),
('cat_08', 'Restaurant / Cafe', 'restaurant-cafe', 'Fine dining, cafe specials, buffet offerings, and culinary experiences', 8),
('cat_09', 'Clothing / Fashion', 'clothing-fashion', 'Apparel, traditional wear, formal clothing, and fashion trends', 9),
('cat_10', 'Home Appliances', 'home-appliances', 'Smart appliances, air purifiers, refrigerators, and smart home tech', 10),
('cat_11', 'Healthcare / Pharmacy', 'healthcare-pharmacy', 'Wellness products, healthcare monitoring kits, and diagnostics', 11),
('cat_12', 'Fitness / Gym', 'fitness-gym', 'Gym memberships, sports equipment, supplements, and fitness gear', 12),
('cat_13', 'Salon / Beauty', 'salon-beauty', 'Personal grooming, hair styling, skincare, and beauty spa services', 13),
('cat_14', 'Retail / Shopping', 'retail-shopping', 'Supermarkets, department stores, retail discounts, and hypermarkets', 14),
('cat_15', 'Finance / Banking', 'finance-banking', 'Student loans, banking solutions, insurance, and investment accounts', 15),
('cat_16', 'Travel / Tourism', 'travel-tourism', 'Holiday itineraries, Kerala tourism, travel bookings, and stays', 16),
('cat_17', 'Real Estate', 'real-estate', 'Commercial spaces, campus housing, apartments, and land developments', 17),
('cat_18', 'Service / Repair', 'service-repair', 'Electronics servicing, mechatronic prototyping, and maintenance', 18),
('cat_19', 'Training / Coaching', 'training-coaching', 'GATE coaching, technical workshops, robotics training, and coding', 19),
('cat_20', 'Gaming / Entertainment', 'gaming-entertainment', 'Gaming consoles, e-sports arenas, VR experiences, and gaming gear', 20),
('cat_21', 'Other / Custom', 'other-custom', 'Custom products, event announcements, and specialized equipment', 21);

-- Default System Settings
INSERT OR IGNORE INTO system_settings (key, value, is_encrypted, description) VALUES
('grok_api_configured', 'false', 0, 'Indicates if a valid Grok API key is saved'),
('grok_active_model', 'grok-2-1212', 0, 'Currently active verified xAI Grok model ID'),
('grok_api_masked_key', '', 0, 'Masked key for UI display e.g. xai-••••••••••••abcd'),
('grok_last_tested_at', '', 0, 'ISO timestamp of last successful Grok API test'),
('grok_last_error', '', 0, 'Last API error message if test or generation failed'),
('stt_provider', 'google-cloud-stt', 0, 'Selected Speech-to-Text provider with Malayalam (ml-IN) support'),
('tts_provider', 'google-cloud-tts', 0, 'Selected Text-to-Speech provider with Malayalam (ml-IN) neural voice'),
('voice_assistant_enabled', 'true', 0, 'Global toggle for AI voice assistant interaction'),
('wake_word', 'Hey Robot', 0, 'Fixed wake word for acoustic activation'),
('timezone', 'Asia/Kolkata', 0, 'Official robot and scheduling timezone'),
('robot_operating_mode', 'MANUAL', 0, 'Current state: MANUAL, AUTONOMOUS, EMERGENCY_STOP'),
('emergency_stop_active', 'false', 0, 'Global emergency stop lock flag'),
('robot_device_id', 'ESP32_MAIN_ROBOT_01', 0, 'Authorized Main ESP32-S3 hardware identifier'),
('camera_device_id', 'ESP32_CAM_AI_01', 0, 'Authorized ESP32-S3 AI Camera identifier'),
('active_ad_id', 'ad_demo_01', 0, 'Currently active advertisement ID on DWIN HMI and Kiosk'),
('active_ad_page_id', '1', 0, 'DWIN HMI screen page ID (1-5) corresponding to active ad');

-- Default Authorized Devices
-- SHA-256 of default device pre-shared key 'SevenSemi_ESP32_Secret_2026'
INSERT OR IGNORE INTO devices (id, device_name, device_type, api_key_hash, firmware_version, status) VALUES
('ESP32_MAIN_ROBOT_01', 'SevenSemi Main Controller', 'MAIN_CONTROLLER', '35ac1c6dbdf39e504068593847525287f3484f932bf5a92a5d2b7e29bbef24b8', '1.0.0', 'offline'),
('ESP32_CAM_AI_01', 'ESP32-S3 AI Vision Camera', 'AI_CAMERA', '81b7e46247c4e51be58a0bb385f541be5e9d99723528b12f676046e7f828bb23', '1.0.0', 'offline');

-- Products and Advertisements will be added manually by the administrator via the Admin Dashboard.
