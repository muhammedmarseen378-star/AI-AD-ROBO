# Cloudflare Deployment & Step-by-Step Help Guide
## Autonomous AI Advertisement Robot Platform (2026)

---

### 1. Overview of Platform Updates

| Feature | Details |
| :--- | :--- |
| **Login Credentials** | Email: `nttf.ttc.m3b.group1.project@gmail.com`<br>Password: `group_1@nttf` |
| **Manual Email Typing** | Email field is fully editable with clean placeholders. |
| **Password View Toggle** | Click the eye icon (**👁️ / 🙈**) to reveal or hide your password. |
| **Persistent Auto-Login** | Once signed in, you are automatically remembered across browser tabs. |
| **1-Click Log Out** | Dedicated Sign Out buttons in both the top header bar and sidebar. |
| **Category Management** | Dedicated **🏷️ Categories** section managing all 21 enterprise categories. |
| **Live Camera Feed** | **Online**: Displays live video HUD with AI tracking.<br>**Offline**: Displays animated **"NO SIGNAL"** screen with broadcast color bars. |
| **Groq AI Engine** | Directly supports **GroqCloud** keys (starts with `gsk_`) and models like `llama-3.3-70b-versatile`. |

---

### 2. Cloudflare Project Structure

To deploy to Cloudflare, upload the contents of the **`Cloudflare`** directory:

```
Cloudflare/
├── Workers/
│   ├── src/
│   │   ├── index.js          # Main router & request dispatcher
│   │   ├── ui.js             # Embedded high-performance static UI bundle
│   │   ├── grok.js           # Groq AI engine (supports gsk_...)
│   │   ├── products.js       # Product & Category CRUD
│   │   ├── advertisements.js # Advertisement rotations & active broadcast
│   │   ├── robot.js          # Robot telemetry & camera monitoring
│   │   ├── auth.js           # Admin authentication & session security
│   │   └── scheduler.js      # Cron scheduler for ad rotation
│   ├── package.json
│   └── wrangler.toml
├── D1_Database/
│   ├── schema.sql            # Master 19-table database schema
│   └── seed.sql              # Initial admin & category seed data
├── package.json
└── wrangler.toml
```

---

### 3. Deploying via GitHub to Cloudflare Workers

1. **Commit and Push:**
   Push your repository to GitHub (`muhammedmarseen378-star/AI-ADVERTISING-ROBOT`).

2. **Open Cloudflare Dashboard:**
   - Go to [dash.cloudflare.com](https://dash.cloudflare.com).
   - In the left sidebar, navigate to **Compute (Workers) -> Workers & Pages**.

3. **Deploy the Worker:**
   - Select your existing Worker `advertising-robot` (or click **Create Application** -> **Worker**).
   - Under **Settings** -> **Build**:
     - **Build Command**: Leave empty or `npm run deploy`
     - **Root Directory**: `Cloudflare/Workers` (or `Cloudflare`)

4. **Link D1 Database (Optional / Zero Error Guarantee):**
   - The platform operates with **100% resilient mock data** even if D1 is not bound.
   - To link a persistent cloud database:
     1. Go to **Storage & Databases** -> **D1 SQL Database**.
     2. Create a database named `ai_ad_robot_db`.
     3. Go to Worker -> **Settings** -> **Bindings**.
     4. Add **D1 Database Binding**:
        - **Variable Name**: `DB`
        - **D1 Database**: Select `ai_ad_robot_db`
     5. Execute `schema.sql` and `seed.sql` inside the D1 Console tab.

---

### 4. Configuring Groq AI in Admin Console

1. Log into your Admin Dashboard: `nttf.ttc.m3b.group1.project@gmail.com` / `group_1@nttf`.
2. Click **⚡ Groq AI Config** in the sidebar.
3. Paste your Groq API key (starts with `gsk_`).
4. Select model: `Llama 3.3 70B (Versatile - Recommended Default)`.
5. Click **Save & Test Groq Key**. The platform will verify the connection directly with GroqCloud!

---

### 5. Camera Vision: Live Stream vs. NO SIGNAL

1. In the top navigation bar or sidebar, click **📷 Camera Vision** (or **🎥 View Live Feed**).
2. **If Camera is Online**: You will see the active live video feed, AI person detection box, crosshair target, and 25 FPS metric.
3. **If Camera is Offline**: You will see the realistic broadcast **"NO SIGNAL"** screen with animated SMPTE color bars and alert badge.
4. You can use the **🔄 Toggle Online / Offline Signal** button at any time to demonstrate both states!

---

### 6. ESP32 Robot Hardware Communication & Manual Products

1. **ESP32 Telemetry Connection:**
   - Your ESP32-S3 main controller (`ESP32_Code/Main_Controller`) sends telemetry every 3 seconds to `/api/robot/heartbeat`.
   - Headers: `X-Device-Id: ESP32_MAIN_ROBOT_01`, `X-Device-Key: SevenSemi_ESP32_Secret_2026`.
   - The website dashboard reflects live HC-SR04 ultrasonic distance, motor states, person tracking, and battery levels.
2. **Website Motor Controls & Emergency Stop:**
   - Pressing the D-Pad buttons (Forward, Reverse, Left, Right) or Emergency Stop in the dashboard queues instant commands for the ESP32 to execute.
3. **Manual Product Addition Only:**
   - All dummy and pre-loaded products have been removed.
   - Click **"+ Add Product"** in the **Products** section to manually create and manage your products. Every item is saved to local storage and synced to the cloud!
