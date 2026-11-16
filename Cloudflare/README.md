# Cloudflare Serverless Backend - AI Advertisement Robot
**Final Year Project:** NTTF TTC Mechatronics Engineering - Group 1  
**Project Email:** `nttf.ttc.m3b.group1.project@gmail.com`  
**Admin Password:** `group_1@nttf`  

---

## 📁 Folder Contents

```
Cloudflare/
├── index.js                      # Root entrypoint re-export
├── package.json                  # Worker build dependencies & scripts
├── wrangler.toml                 # Cloudflare Worker configuration
├── D1_Database/
│   ├── schema.sql                # Master 19-table D1 relational schema
│   └── seed.sql                  # Initial seed data (categories, admin account, initial ads)
├── Workers/
│   ├── package.json              # Sub-package config
│   ├── wrangler.toml             # Standalone worker config
│   └── src/
│       ├── index.js              # Main API router, CORS preflight & Cron handler
│       ├── auth.js               # Administrator login, PBKDF2 verification, rate limiter
│       ├── crypto.js             # AES-256-GCM encryption & PBKDF2 hashing
│       ├── grok.js               # xAI Grok integration, model selection & copilot
│       ├── products.js           # 21-category product management
│       ├── advertisements.js     # Ad rotation, priority play & scheduling
│       ├── scheduler.js          # Cron advertisement rotation engine (Asia/Kolkata)
│       ├── robot.js              # ESP32-S3 telemetry, heartbeats & emergency stop
│       └── media.js              # Cloudflare R2 media upload and streaming
```

---

## 🚀 How to Upload & Deploy to Cloudflare

### Method 1: Uploading the `Cloudflare` Folder to GitHub (Recommended)
1. In your GitHub repository (`muhammedmarseen378-star/AI-ADVERTISING-ROBOT`), commit/upload the `Cloudflare` folder.
2. Open your [Cloudflare Dashboard](https://dash.cloudflare.com/) -> **Compute (Workers & Pages)** -> Click **`ai-advertising-robot`**.
3. Go to **Settings** -> **Builds** -> **Build settings**.
4. Change **Root directory** from `/` to:
   ```
   /Cloudflare
   ```
5. Click **Save and Deploy**. Cloudflare will automatically detect `wrangler.toml` and deploy successfully!

---

### Method 2: If Root Directory in Cloudflare is `/`
If you leave Root directory as `/`:
Ensure that the root of your GitHub repository contains:
- `wrangler.toml` (which points to `Cloudflare/Workers/src/index.js`)
- `package.json`
- `index.js`
All these files have already been prepared for you in the repository root.

---

## 🔑 Administrator Authentication
- **Email:** `nttf.ttc.m3b.group1.project@gmail.com`
- **Password:** `group_1@nttf`
- **Role:** `superadmin`
- **Protection:** PBKDF2 SHA-256 with 100,000 iterations, rate limited to 5 attempts per 15 minutes.
