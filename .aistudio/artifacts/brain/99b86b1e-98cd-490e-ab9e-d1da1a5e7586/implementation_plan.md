# Multi-Cloud Inspection Report Bridge — Google Drive + Microsoft OneDrive Switcher & Dual-Sync Plan

Add full **Microsoft OneDrive Direct Upload & Two-Way Sync** alongside the existing **Google Drive Bridge**, with a 1-click **Admin Cloud Storage Switcher** so the Admin can shift active report storage between **Google Drive**, **Microsoft OneDrive**, or **Both (Dual-Cloud Backup)** at any time while keeping all existing Google Drive settings and links 100% intact.

## User Review & Critical Decisions

> [!IMPORTANT]
> - **Active Cloud Drive Switcher (1-Click Shift Anytime)**: The Admin can switch the active report upload destination at any time between **Google Drive**, **Microsoft OneDrive**, **Both (Google Drive + OneDrive Dual-Backup)**, or **Built-in Cloud Storage** without losing saved credentials or breaking previously uploaded report links.
> - **Zero-Login Engineer Experience**: Just like the Google Drive Bridge, field engineers never need a Microsoft 365 or Google account. All uploads and deletions route through the central Admin Cloud Bridge configuration.
> - **Two Easy OneDrive Setup Modes**: The Admin can connect their Microsoft OneDrive folder using either a **Power Automate HTTP Webhook Bridge URL** (recommended for business/SharePoint/OneDrive accounts, with a 1-click copyable flow schema) or a **Microsoft Graph Token + Target Folder Path** (for instant direct API uploads & deletions), complete with a **Test & Save OneDrive Connection** button.

---

## 1. Overview & Core Concept

Currently, the NREP Equipment Dashboard allows engineers to upload PDF/Image inspection reports directly into the Admin's Google Drive folder via the Google Apps Script Bridge, with two-way deletion sync and real-time SweetAlert-style progress and confirmation popups.

This enhancement introduces a **Multi-Cloud Drive Bridge Architecture** that preserves the existing Google Drive workflow 100% intact while adding first-class **Microsoft OneDrive** support:

1. **Instant Cloud Provider Switcher ("Drive Shift")**:
   - Inside the **Cloud Folder Sync & Direct Upload** modal (and visible as a live status badge inside the Equipment Inspection Report modal), the Admin can select the active storage mode with a single click:
     - **Google Drive (Primary)** — Uploads directly to the Admin's Google Drive folder (`NREP_Reports / <Unit Name>`).
     - **Microsoft OneDrive (Primary)** — Uploads directly to the Admin's Microsoft OneDrive folder (`/NREP_Reports/<Unit Name>`).
     - **Both (Dual-Cloud Backup: Google Drive + OneDrive)** — Uploads every inspection report simultaneously to both Google Drive and Microsoft OneDrive so both cloud folders stay mirrored automatically.
2. **Easy Microsoft OneDrive Bridge Setup**:
   - **Option A — Power Automate / Webhook Bridge URL**: Works identically to the Google Apps Script Web App URL. The Admin pastes their Power Automate HTTP Trigger URL and target OneDrive folder path, with a 1-click **Copy OneDrive Bridge JSON Schema & Setup Guide** button.
   - **Option B — Microsoft Graph Direct API Token + Folder Path**: Allows direct REST uploads (`PUT /me/drive/root:/{folderPath}/{unitSubfolder}/{fileName}:/content`), automatic share link creation (`/createLink`), and direct file deletion (`DELETE /me/drive/items/{itemId}`).
3. **Two-Way Sync & Real-Time Sweet Popups**:
   - The real-time `UploadProgressPopup` and `SweetSuccessPopup` dynamically display whether the report is being transmitted to **Google Drive**, **Microsoft OneDrive**, or **Both Clouds (Google Drive + OneDrive)**.
   - Deleting a report in the app (after confirming the `SweetWarningDeletePopup`) automatically deletes/trashes the file in Google Drive, Microsoft OneDrive, or both depending on where it is stored.

---

## 2. User Experience & Visual Design

- ** Aesthetic & Industrial Precision**:
  - Maintains the high-contrast slate/indigo/emerald industrial dashboard palette (`#0F172A` / `#FFFFFF` surfaces, crisp `1px` borders, `tabular-nums` telemetry counters).
  - Uses distinct provider color coding: **Emerald/Green** for Google Drive, **Sky/Cobalt Blue (`#0078D4`)** for Microsoft OneDrive, and **Indigo/Violet Gradient** for Dual-Cloud (Both) mode.
- **Cloud Drive Switcher Bar**:
  - At the top of the **Direct Cloud Upload Bridge** tab in `CloudFolderSyncModal`, a prominent 3-card interactive selector lets the Admin switch the active mode (`Google Drive Only`, `Microsoft OneDrive Only`, `Both: Google Drive + OneDrive`) and immediately save or test either provider.
  - Each provider card displays a live connection indicator (`Connected & Verified`, `Not Configured`, or `Attention Needed`) and the last tested timestamp.
- **Equipment Inspection Report Modal (`InspectionReportModal`)**:
  - Displays the active cloud target badge in the upload header (e.g., *"Direct to Admin Google Drive"*, *"Direct to Admin Microsoft OneDrive"*, or *"Dual Sync: Google Drive + OneDrive"*), plus a quick **"Switch Cloud Drive"** shortcut for Admin users.
  - Existing reports show a clear provider badge (`Google Drive`, `OneDrive`, or `Dual Cloud`) and open cleanly in the embedded previewer or external cloud viewer.

---

## 3. Key Product Decisions & Trade-Offs

- **Preserving Existing Reports When Switching Drives**:
  - *Decision*: Every uploaded `InspectionReportItem` stores its own `provider` (`google_drive`, `onedrive`, `supabase_storage`) and optional secondary backup metadata (`secondaryViewUrl`, `secondaryFileId`).
  - *Rationale*: If the Admin uses Google Drive for 3 months and then shifts to Microsoft OneDrive next month, all older Google Drive reports remain viewable and deletable from Google Drive while all new uploads go to Microsoft OneDrive.
- **Dual-Mode OneDrive Connection (Webhook Bridge URL + Graph Token)**:
  - *Decision*: Support both a webhook URL (Power Automate / Logic Apps HTTP endpoint) and a direct Microsoft Graph access token in the OneDrive setup panel.
  - *Rationale*: Corporate Microsoft 365 tenants often prefer a no-code Power Automate HTTP Webhook flow (which never expires and works just like Google Apps Script), while individual OneDrive users may prefer pasting a Graph token and folder path for instant testing.
- **Graceful Failover**:
  - *Decision*: In `Both` mode, if one cloud bridge succeeds and the other experiences a temporary network issue, the report still saves using the successful cloud link and logs a clear notice in the popup, with built-in Cloud Storage as the final safety net.

---

## 4. Technical Architecture & Data Strategy

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                   ENGINEER / ADMIN BROWSER (NREP APP)                        │
│  ┌────────────────────────────┐        ┌──────────────────────────────────┐  │
│  │ InspectionReportModal /    │        │ CloudFolderSyncModal (Admin)     │  │
│  │ Bulk Dropzone              │        │ • Active Drive Switcher:         │  │
│  │ • Real-Time Progress Popup │        │   [Google Drive] [OneDrive]      │  │
│  │ • Sweet Success Popup      │        │   [Both Clouds (Dual-Backup)]    │  │
│  │ • Delete Warning Popup     │        │ • Independent Setup & Test Cards │  │
│  └─────────────┬──────────────┘        └─────────────────┬────────────────┘  │
└────────────────┼─────────────────────────────────────────┼───────────────────┘
                 │ POST / DELETE /api/reports              │ GET / POST / PUT
                 ▼                                         ▼ /api/drive-bridge
┌──────────────────────────────────────────────────────────────────────────────┐
│                  NEXT.JS SERVERLESS MULTI-CLOUD ROUTER                       │
│  • Reads central DriveBridgeConfig (`activeProvider`: google_drive |         │
│    onedrive | both | supabase_storage)                                       │
│  • Routes Upload, Ping Test, Delete & Liveness Reconcile to active target(s) │
└───────┬─────────────────────────────────┬────────────────────────────────┬───┘
        │                                 │                                │
        ▼                                 ▼                                ▼
┌───────────────────────┐     ┌───────────────────────────┐    ┌───────────────────────┐
│  GOOGLE DRIVE BRIDGE  │     │ MICROSOFT ONEDRIVE BRIDGE │    │ SUPABASE CLOUD BACKUP │
│  • Apps Script (/exec)│     │ • Power Automate Webhook  │    │ • Automatic failover  │
│  • Auto Unit Folders  │     │   OR Microsoft Graph API  │    │   if cloud bridge     │
│  • Two-Way Trash Sync │     │ • Auto Unit Subfolders    │    │   is offline          │
└───────────────────────┘     └───────────────────────────┘    └───────────────────────┘
```

### Multi-Cloud Configuration Schema (`DriveBridgeConfig`)
- `activeProvider`: `'google_drive' | 'onedrive' | 'both' | 'supabase_storage'` (defaults to `'google_drive'` when Google Drive is enabled so current behavior is untouched).
- **Google Drive settings** (unchanged): `enabled`, `bridgeScriptUrl`, `targetFolderUrl`, `targetFolderId`, `organizeByUnitSubfolder`, `lastTestedAt`, `lastTestStatus`, `lastTestMessage`.
- **Microsoft OneDrive settings** (new):
  - `onedriveEnabled`: `boolean`
  - `onedriveMode`: `'webhook_bridge' | 'graph_token'`
  - `onedriveBridgeUrl`: `string` (Power Automate / Logic App HTTP POST URL)
  - `onedriveAccessToken`: `string` (Microsoft Graph API Bearer token when using `graph_token` mode)
  - `onedriveTargetFolderUrl`: `string` (OneDrive folder web link for quick "Open OneDrive Folder" access)
  - `onedriveFolderPath`: `string` (e.g., `/NREP_Inspection_Reports`, auto-creating `/<Unit Name>` subfolders when `onedriveOrganizeByUnitSubfolder` is enabled)
  - `onedriveOrganizeByUnitSubfolder`: `boolean`
  - `onedriveLastTestedAt`, `onedriveLastTestStatus`, `onedriveLastTestMessage`
