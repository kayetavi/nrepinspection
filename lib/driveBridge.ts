import { extractGoogleDriveFolderId, normalizeReportUrl } from './reportUtils';

export type ActiveCloudProviderMode =
  | 'google_drive'
  | 'onedrive'
  | 'both'
  | 'supabase_storage';

export type OneDriveConnectionMode = 'webhook_bridge' | 'graph_token';

export interface DriveBridgeConfig {
  // Active cloud storage switcher mode
  activeProvider: ActiveCloudProviderMode;

  // 1. Google Drive Bridge Settings (preserved 100% intact)
  enabled: boolean;
  bridgeScriptUrl: string;
  targetFolderUrl: string;
  targetFolderId: string;
  organizeByUnitSubfolder: boolean;
  lastTestedAt?: string;
  lastTestStatus?: 'ok' | 'error';
  lastTestMessage?: string;

  // 2. Microsoft OneDrive Bridge Settings (new)
  onedriveEnabled: boolean;
  onedriveMode: OneDriveConnectionMode;
  onedriveBridgeUrl: string;
  onedriveAccessToken: string;
  onedriveTargetFolderUrl: string;
  onedriveFolderPath: string;
  onedriveOrganizeByUnitSubfolder: boolean;
  onedriveLastTestedAt?: string;
  onedriveLastTestStatus?: 'ok' | 'error';
  onedriveLastTestMessage?: string;

  // Audit metadata
  updatedBy?: string;
  updatedAt?: string;
}

export const DEFAULT_DRIVE_BRIDGE_CONFIG: DriveBridgeConfig = {
  activeProvider: 'google_drive',
  enabled: false,
  bridgeScriptUrl: process.env.GOOGLE_DRIVE_BRIDGE_URL || '',
  targetFolderUrl: process.env.GOOGLE_DRIVE_FOLDER_URL || '',
  targetFolderId: extractGoogleDriveFolderId(process.env.GOOGLE_DRIVE_FOLDER_URL || '') || '',
  organizeByUnitSubfolder: true,

  onedriveEnabled: false,
  onedriveMode: 'webhook_bridge',
  onedriveBridgeUrl: process.env.ONEDRIVE_BRIDGE_URL || '',
  onedriveAccessToken: process.env.ONEDRIVE_ACCESS_TOKEN || '',
  onedriveTargetFolderUrl: process.env.ONEDRIVE_FOLDER_URL || '',
  onedriveFolderPath: '/NREP_Inspection_Reports',
  onedriveOrganizeByUnitSubfolder: true,
};

const CONFIG_BUCKET = 'inspection-reports';
const CONFIG_STORAGE_PATH = '_system/drive_bridge_config.json';

export function resolveEffectiveActiveProvider(config: Partial<DriveBridgeConfig>): ActiveCloudProviderMode {
  const gReady = Boolean(config.enabled && config.bridgeScriptUrl);
  const oReady = Boolean(
    config.onedriveEnabled &&
      ((config.onedriveMode === 'graph_token' && config.onedriveAccessToken) ||
        (config.onedriveMode !== 'graph_token' && config.onedriveBridgeUrl))
  );

  if (
    config.activeProvider === 'google_drive' ||
    config.activeProvider === 'onedrive' ||
    config.activeProvider === 'both' ||
    config.activeProvider === 'supabase_storage'
  ) {
    return config.activeProvider;
  }

  if (gReady && oReady) return 'both';
  if (oReady) return 'onedrive';
  if (gReady) return 'google_drive';
  return 'supabase_storage';
}

export async function loadDriveBridgeConfig(sbAdmin: any): Promise<DriveBridgeConfig> {
  if (!sbAdmin) return { ...DEFAULT_DRIVE_BRIDGE_CONFIG };

  try {
    const { data, error } = await sbAdmin.storage
      .from(CONFIG_BUCKET)
      .download(CONFIG_STORAGE_PATH);

    if (!error && data) {
      const text = await data.text();
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        const folderUrl = String(parsed.targetFolderUrl || DEFAULT_DRIVE_BRIDGE_CONFIG.targetFolderUrl || '').trim();
        const folderId =
          extractGoogleDriveFolderId(folderUrl) ||
          String(parsed.targetFolderId || DEFAULT_DRIVE_BRIDGE_CONFIG.targetFolderId || '').trim();
        const bridgeUrl = String(parsed.bridgeScriptUrl || DEFAULT_DRIVE_BRIDGE_CONFIG.bridgeScriptUrl || '').trim();
        const gEnabled = Boolean(parsed.enabled && bridgeUrl);

        const onedriveMode: OneDriveConnectionMode =
          parsed.onedriveMode === 'graph_token' ? 'graph_token' : 'webhook_bridge';
        const onedriveBridgeUrl = String(
          parsed.onedriveBridgeUrl || DEFAULT_DRIVE_BRIDGE_CONFIG.onedriveBridgeUrl || ''
        ).trim();
        const onedriveAccessToken = String(
          parsed.onedriveAccessToken || DEFAULT_DRIVE_BRIDGE_CONFIG.onedriveAccessToken || ''
        ).trim();
        const onedriveTargetFolderUrl = String(
          parsed.onedriveTargetFolderUrl || DEFAULT_DRIVE_BRIDGE_CONFIG.onedriveTargetFolderUrl || ''
        ).trim();
        const rawFolderPath = String(
          parsed.onedriveFolderPath || DEFAULT_DRIVE_BRIDGE_CONFIG.onedriveFolderPath || '/NREP_Inspection_Reports'
        ).trim();
        const onedriveFolderPath = rawFolderPath.startsWith('/') ? rawFolderPath : `/${rawFolderPath}`;
        const hasOneDriveCreds =
          onedriveMode === 'graph_token' ? Boolean(onedriveAccessToken) : Boolean(onedriveBridgeUrl);
        const onedriveEnabled = Boolean(parsed.onedriveEnabled && hasOneDriveCreds);

        const loaded: DriveBridgeConfig = {
          activeProvider: parsed.activeProvider || (gEnabled ? 'google_drive' : onedriveEnabled ? 'onedrive' : 'supabase_storage'),
          enabled: gEnabled,
          bridgeScriptUrl: bridgeUrl,
          targetFolderUrl: folderUrl,
          targetFolderId: folderId,
          organizeByUnitSubfolder: parsed.organizeByUnitSubfolder !== false,
          lastTestedAt: parsed.lastTestedAt,
          lastTestStatus: parsed.lastTestStatus,
          lastTestMessage: parsed.lastTestMessage,

          onedriveEnabled,
          onedriveMode,
          onedriveBridgeUrl,
          onedriveAccessToken,
          onedriveTargetFolderUrl,
          onedriveFolderPath,
          onedriveOrganizeByUnitSubfolder: parsed.onedriveOrganizeByUnitSubfolder !== false,
          onedriveLastTestedAt: parsed.onedriveLastTestedAt,
          onedriveLastTestStatus: parsed.onedriveLastTestStatus,
          onedriveLastTestMessage: parsed.onedriveLastTestMessage,

          updatedBy: parsed.updatedBy,
          updatedAt: parsed.updatedAt,
        };

        return loaded;
      }
    }
  } catch {
    // Fall back to default config if not created yet
  }

  const defaultGEnabled = Boolean(DEFAULT_DRIVE_BRIDGE_CONFIG.bridgeScriptUrl);
  return {
    ...DEFAULT_DRIVE_BRIDGE_CONFIG,
    enabled: defaultGEnabled,
    activeProvider: defaultGEnabled ? 'google_drive' : 'supabase_storage',
  };
}

export async function saveDriveBridgeConfig(
  sbAdmin: any,
  config: Partial<DriveBridgeConfig>,
  actorEmail: string
): Promise<DriveBridgeConfig> {
  const current = await loadDriveBridgeConfig(sbAdmin);

  // Google Drive fields
  const nextFolderUrl =
    config.targetFolderUrl !== undefined ? config.targetFolderUrl.trim() : current.targetFolderUrl;
  const nextFolderId =
    extractGoogleDriveFolderId(nextFolderUrl) ||
    (config.targetFolderId !== undefined ? config.targetFolderId.trim() : current.targetFolderId);
  const nextBridgeUrl =
    config.bridgeScriptUrl !== undefined ? config.bridgeScriptUrl.trim() : current.bridgeScriptUrl;
  const nextGEnabled =
    config.enabled !== undefined ? Boolean(config.enabled && nextBridgeUrl) : Boolean(current.enabled && nextBridgeUrl);

  // Microsoft OneDrive fields
  const nextOneDriveMode: OneDriveConnectionMode =
    config.onedriveMode !== undefined ? config.onedriveMode : current.onedriveMode;
  const nextOneDriveBridgeUrl =
    config.onedriveBridgeUrl !== undefined ? config.onedriveBridgeUrl.trim() : current.onedriveBridgeUrl;
  const nextOneDriveToken =
    config.onedriveAccessToken !== undefined ? config.onedriveAccessToken.trim() : current.onedriveAccessToken;
  const nextOneDriveFolderUrl =
    config.onedriveTargetFolderUrl !== undefined
      ? config.onedriveTargetFolderUrl.trim()
      : current.onedriveTargetFolderUrl;
  const rawOneDrivePath =
    config.onedriveFolderPath !== undefined
      ? config.onedriveFolderPath.trim() || '/NREP_Inspection_Reports'
      : current.onedriveFolderPath || '/NREP_Inspection_Reports';
  const nextOneDrivePath = rawOneDrivePath.startsWith('/') ? rawOneDrivePath : `/${rawOneDrivePath}`;
  const hasOneDriveCreds =
    nextOneDriveMode === 'graph_token' ? Boolean(nextOneDriveToken) : Boolean(nextOneDriveBridgeUrl);
  const nextOneDriveEnabled =
    config.onedriveEnabled !== undefined
      ? Boolean(config.onedriveEnabled && hasOneDriveCreds)
      : Boolean(current.onedriveEnabled && hasOneDriveCreds);

  const nextActiveProvider: ActiveCloudProviderMode =
    config.activeProvider !== undefined
      ? config.activeProvider
      : current.activeProvider || (nextGEnabled ? 'google_drive' : nextOneDriveEnabled ? 'onedrive' : 'supabase_storage');

  const updated: DriveBridgeConfig = {
    ...current,
    ...config,
    activeProvider: nextActiveProvider,
    bridgeScriptUrl: nextBridgeUrl,
    targetFolderUrl: nextFolderUrl,
    targetFolderId: nextFolderId,
    enabled: nextGEnabled,
    organizeByUnitSubfolder:
      config.organizeByUnitSubfolder !== undefined
        ? Boolean(config.organizeByUnitSubfolder)
        : current.organizeByUnitSubfolder,

    onedriveEnabled: nextOneDriveEnabled,
    onedriveMode: nextOneDriveMode,
    onedriveBridgeUrl: nextOneDriveBridgeUrl,
    onedriveAccessToken: nextOneDriveToken,
    onedriveTargetFolderUrl: nextOneDriveFolderUrl,
    onedriveFolderPath: nextOneDrivePath,
    onedriveOrganizeByUnitSubfolder:
      config.onedriveOrganizeByUnitSubfolder !== undefined
        ? Boolean(config.onedriveOrganizeByUnitSubfolder)
        : current.onedriveOrganizeByUnitSubfolder,

    updatedBy: actorEmail,
    updatedAt: new Date().toISOString(),
  };

  // Ensure bucket exists
  try {
    const { data: buckets } = await sbAdmin.storage.listBuckets();
    const exists = (buckets || []).some((b: any) => b.name === CONFIG_BUCKET || b.id === CONFIG_BUCKET);
    if (!exists) {
      await sbAdmin.storage.createBucket(CONFIG_BUCKET, {
        public: true,
        fileSizeLimit: 20 * 1024 * 1024,
      });
    }
  } catch {}

  const payloadBuffer = Buffer.from(JSON.stringify(updated, null, 2), 'utf-8');
  const { error } = await sbAdmin.storage
    .from(CONFIG_BUCKET)
    .upload(CONFIG_STORAGE_PATH, payloadBuffer, {
      contentType: 'application/json',
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to save Cloud Drive Bridge configuration: ${error.message}`);
  }

  return updated;
}

export interface DriveBridgeUploadResult {
  ok: boolean;
  fileId?: string;
  fileName?: string;
  viewUrl?: string;
  embedUrl?: string;
  folderName?: string;
  error?: string;
}

export function validateBridgeScriptUrl(url: string): { valid: boolean; reason?: string } {
  const trimmed = (url || '').trim();
  if (!trimmed) {
    return { valid: false, reason: 'Google Apps Script Web App URL is empty.' };
  }
  if (trimmed.includes('drive.google.com/drive/folders/')) {
    return {
      valid: false,
      reason:
        'You pasted a Google Drive Folder link into the Bridge Script URL box. Please put the Folder link in Box 1, and the deployed Apps Script Web App URL (ending in /exec) in Box 2.',
    };
  }
  if (trimmed.includes('/d/') && trimmed.includes('/edit')) {
    return {
      valid: false,
      reason:
        'You pasted the Apps Script Code Editor link (/edit) instead of the deployed Web App URL (/exec). Open your script, click the top-right blue "Deploy" -> "New deployment" button, select "Web app" (Execute as: Me, Who has access: Anyone), and copy the Web app URL ending in "/exec".',
    };
  }
  if (trimmed.endsWith('/dev')) {
    return {
      valid: false,
      reason:
        'You pasted the Test (/dev) URL which only works inside your browser session. Please copy the Production Web App URL ending in "/exec" from Deploy -> New deployment.',
    };
  }
  if (!trimmed.startsWith('https://script.google.com/macros/s/')) {
    return {
      valid: false,
      reason:
        'Invalid Bridge URL format. A deployed Google Apps Script Web App URL must start with "https://script.google.com/macros/s/..." and end with "/exec".',
    };
  }
  return { valid: true };
}

export function validateOneDriveBridgeConfig(params: {
  mode: OneDriveConnectionMode;
  bridgeUrl: string;
  accessToken: string;
}): { valid: boolean; reason?: string } {
  const { mode, bridgeUrl, accessToken } = params;
  if (mode === 'graph_token') {
    const cleanToken = (accessToken || '').trim();
    if (!cleanToken) {
      return { valid: false, reason: 'Please paste your Microsoft Graph API Access Token.' };
    }
    if (cleanToken.length < 20) {
      return { valid: false, reason: 'The Microsoft Graph Access Token appears too short.' };
    }
    return { valid: true };
  }

  const cleanUrl = (bridgeUrl || '').trim();
  if (!cleanUrl) {
    return {
      valid: false,
      reason: 'Please paste your Microsoft OneDrive Power Automate / Webhook Bridge URL.',
    };
  }
  if (!/^https?:\/\//i.test(cleanUrl)) {
    return {
      valid: false,
      reason: 'OneDrive Webhook Bridge URL must start with https://',
    };
  }
  if (
    (/1drv\.ms/i.test(cleanUrl) || /onedrive\.live\.com/i.test(cleanUrl)) &&
    !cleanUrl.includes('invoke') &&
    !cleanUrl.includes('webhook') &&
    !cleanUrl.includes('api')
  ) {
    return {
      valid: false,
      reason:
        'You pasted a standard OneDrive folder share link into the Webhook URL box. Put your OneDrive Folder link in Box 1, and paste your Power Automate HTTP POST URL in Box 2 (or switch to Microsoft Graph Token mode).',
    };
  }
  return { valid: true };
}

/**
 * Uploads a file buffer directly to the Admin's Google Drive folder via the configured Apps Script Bridge.
 */
export async function uploadFileViaDriveBridge(params: {
  bridgeConfig: DriveBridgeConfig;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  unitName?: string;
  equipmentTag?: string;
  stageLabel?: string;
}): Promise<DriveBridgeUploadResult> {
  const { bridgeConfig, fileBuffer, fileName, mimeType, unitName, equipmentTag, stageLabel } = params;

  if (!bridgeConfig.enabled || !bridgeConfig.bridgeScriptUrl) {
    return { ok: false, error: 'Google Drive Bridge is not enabled or configured.' };
  }

  const urlCheck = validateBridgeScriptUrl(bridgeConfig.bridgeScriptUrl);
  if (!urlCheck.valid) {
    return { ok: false, error: urlCheck.reason };
  }

  try {
    const base64Data = fileBuffer.toString('base64');
    const cleanUnit = bridgeConfig.organizeByUnitSubfolder && unitName ? unitName.trim() : '';

    const response = await fetch(bridgeConfig.bridgeScriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify({
        action: 'upload',
        folderId: bridgeConfig.targetFolderId || '',
        unitSubfolder: cleanUnit,
        fileName,
        mimeType: mimeType || 'application/pdf',
        base64Data,
        equipmentTag: equipmentTag || '',
        stageLabel: stageLabel || '',
      }),
      redirect: 'follow',
    });

    const text = await response.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      if (text.includes('accounts.google.com') || text.includes('Sign in')) {
        return {
          ok: false,
          error:
            'Google asked for a Sign-In page. In Apps Script -> Deploy -> Manage deployments, change "Who has access" from "Anyone with Google account" to "Anyone".',
        };
      }
      if (text.includes('Authorization is required') || text.includes('permission')) {
        return {
          ok: false,
          error:
            'Google Drive permission not authorized yet in Apps Script. Open your script editor, click the "Run" button at the top once, and click "Review permissions" -> "Allow".',
        };
      }
      if (text.includes('Script function not found: doPost')) {
        return {
          ok: false,
          error:
            'doPost function not found in your deployed Web App. Save your script (Ctrl+S) and create a "New deployment" under Deploy.',
        };
      }
      return {
        ok: false,
        error: `Google Drive Bridge returned non-JSON response (HTTP ${response.status}). Make sure the Apps Script Web App URL ends with "/exec" and is deployed with "Who has access: Anyone".`,
      };
    }

    if (!response.ok || !json?.ok) {
      return {
        ok: false,
        error: json?.error || `Google Drive Bridge error (HTTP ${response.status})`,
      };
    }

    const fileId = String(json.fileId || '').trim();
    const viewUrl =
      json.viewUrl ||
      (fileId ? `https://drive.google.com/file/d/${fileId}/view?usp=sharing` : '');
    const embedUrl =
      json.embedUrl ||
      (fileId ? `https://drive.google.com/file/d/${fileId}/preview` : viewUrl);

    return {
      ok: true,
      fileId,
      fileName: json.fileName || fileName,
      viewUrl,
      embedUrl,
      folderName: json.folderName,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Failed to reach Google Drive Bridge URL',
    };
  }
}

/**
 * Uploads a file buffer directly to the Admin's Microsoft OneDrive folder via either:
 * 1. Power Automate / Logic App HTTP Webhook Bridge (`webhook_bridge`)
 * 2. Microsoft Graph API Bearer Token (`graph_token`)
 */
export async function uploadFileViaOneDriveBridge(params: {
  bridgeConfig: DriveBridgeConfig;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  unitName?: string;
  equipmentTag?: string;
  stageLabel?: string;
}): Promise<DriveBridgeUploadResult> {
  const { bridgeConfig, fileBuffer, fileName, mimeType, unitName, equipmentTag, stageLabel } = params;

  if (!bridgeConfig.onedriveEnabled) {
    return { ok: false, error: 'Microsoft OneDrive Bridge is not enabled.' };
  }

  const baseFolder = (bridgeConfig.onedriveFolderPath || '/NREP_Inspection_Reports')
    .trim()
    .replace(/\/+$/, '');
  const cleanUnit =
    bridgeConfig.onedriveOrganizeByUnitSubfolder && unitName
      ? unitName.trim().replace(/[\\/:*?"<>|]/g, '-')
      : '';
  const targetFolderPath = cleanUnit
    ? `${baseFolder.startsWith('/') ? baseFolder : `/${baseFolder}`}/${cleanUnit}`
    : baseFolder.startsWith('/')
    ? baseFolder
    : `/${baseFolder}`;

  // MODE A: Direct Microsoft Graph API Token Upload
  if (bridgeConfig.onedriveMode === 'graph_token') {
    const token = (bridgeConfig.onedriveAccessToken || '').trim().replace(/^Bearer\s+/i, '');
    if (!token) {
      return { ok: false, error: 'Microsoft Graph Access Token is missing.' };
    }

    try {
      const encodedFolderPath = targetFolderPath
        .split('/')
        .filter(Boolean)
        .map((seg) => encodeURIComponent(seg))
        .join('/');
      const encodedFile = encodeURIComponent(fileName);
      const uploadEndpoint = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedFolderPath}/${encodedFile}:/content`;

      const putRes = await fetch(uploadEndpoint, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': mimeType || 'application/pdf',
        },
        body: new Uint8Array(fileBuffer),
      });

      const putJson = await putRes.json().catch(() => null);
      if (!putRes.ok || !putJson?.id) {
        const graphErr =
          putJson?.error?.message ||
          `Microsoft Graph OneDrive upload failed (HTTP ${putRes.status}). Check if your Graph token is valid and has Files.ReadWrite permission.`;
        return { ok: false, error: graphErr };
      }

      const itemId = String(putJson.id);
      let viewUrl = String(putJson.webUrl || '');

      // Create an embeddable / shareable view link via Microsoft Graph createLink
      try {
        const shareRes = await fetch(
          `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(itemId)}/createLink`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              type: 'view',
              scope: 'anonymous',
            }),
          }
        );
        const shareJson = await shareRes.json().catch(() => null);
        if (shareRes.ok && shareJson?.link?.webUrl) {
          viewUrl = String(shareJson.link.webUrl);
        }
      } catch {
        // Keep webUrl if anonymous link creation is restricted by org policy
      }

      const norm = normalizeReportUrl(viewUrl || bridgeConfig.onedriveTargetFolderUrl || '');
      return {
        ok: true,
        fileId: itemId,
        fileName: putJson.name || fileName,
        viewUrl: norm.viewUrl || viewUrl,
        embedUrl: norm.embedUrl || viewUrl,
        folderName: targetFolderPath,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message || 'Failed to upload to Microsoft OneDrive via Graph API',
      };
    }
  }

  // MODE B: Power Automate / Webhook Bridge URL Upload
  const webhookUrl = (bridgeConfig.onedriveBridgeUrl || '').trim();
  if (!webhookUrl) {
    return { ok: false, error: 'Microsoft OneDrive Webhook Bridge URL is empty.' };
  }

  try {
    const base64Data = fileBuffer.toString('base64');
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'upload',
        folderPath: targetFolderPath,
        unitSubfolder: cleanUnit,
        fileName,
        mimeType: mimeType || 'application/pdf',
        base64Data,
        equipmentTag: equipmentTag || '',
        stageLabel: stageLabel || '',
      }),
      redirect: 'follow',
    });

    const text = await response.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      if (response.ok) {
        // Some Power Automate HTTP Response steps return 200/202 plain text or empty body when accepted
        const fallbackUrl =
          bridgeConfig.onedriveTargetFolderUrl || 'https://onedrive.live.com';
        const norm = normalizeReportUrl(fallbackUrl);
        return {
          ok: true,
          fileId: `od_${Date.now()}`,
          fileName,
          viewUrl: norm.viewUrl || fallbackUrl,
          embedUrl: norm.embedUrl || fallbackUrl,
          folderName: targetFolderPath,
        };
      }
      return {
        ok: false,
        error: `OneDrive Webhook Bridge returned non-JSON error (HTTP ${response.status}). Check your Power Automate flow URL.`,
      };
    }

    if (!response.ok || json?.ok === false) {
      return {
        ok: false,
        error: json?.error || `OneDrive Webhook Bridge error (HTTP ${response.status})`,
      };
    }

    const fileId = String(json?.fileId || json?.itemId || json?.id || `od_${Date.now()}`).trim();
    const rawViewUrl = String(
      json?.viewUrl ||
        json?.webUrl ||
        json?.shareUrl ||
        bridgeConfig.onedriveTargetFolderUrl ||
        'https://onedrive.live.com'
    ).trim();
    const norm = normalizeReportUrl(rawViewUrl);

    return {
      ok: true,
      fileId,
      fileName: json?.fileName || fileName,
      viewUrl: norm.viewUrl || rawViewUrl,
      embedUrl: json?.embedUrl || norm.embedUrl || rawViewUrl,
      folderName: json?.folderName || targetFolderPath,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Failed to reach Microsoft OneDrive Bridge URL',
    };
  }
}

/**
 * Tests the Microsoft OneDrive connection (either Graph Token or Webhook Bridge URL).
 */
export async function testOneDriveBridgeConnection(config: {
  mode: OneDriveConnectionMode;
  bridgeUrl: string;
  accessToken: string;
  folderPath: string;
}): Promise<{ ok: boolean; message: string }> {
  const check = validateOneDriveBridgeConfig(config);
  if (!check.valid) {
    return { ok: false, message: check.reason || 'Invalid OneDrive configuration' };
  }

  if (config.mode === 'graph_token') {
    const token = config.accessToken.trim().replace(/^Bearer\s+/i, '');
    try {
      const res = await fetch('https://graph.microsoft.com/v1.0/me/drive', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        return {
          ok: false,
          message:
            json?.error?.message ||
            `Microsoft Graph authentication failed (HTTP ${res.status}). Ensure your token is valid and includes Files.ReadWrite scope.`,
        };
      }
      const ownerName =
        json?.owner?.user?.displayName || json?.name || 'Microsoft OneDrive';
      return {
        ok: true,
        message: `Connected to Microsoft OneDrive (${ownerName}) · Target Path: ${config.folderPath || '/NREP_Inspection_Reports'}`,
      };
    } catch (err: any) {
      return {
        ok: false,
        message: err?.message || 'Failed to connect to Microsoft Graph OneDrive API',
      };
    }
  }

  // Webhook Bridge test (`action: 'ping'`)
  try {
    const res = await fetch(config.bridgeUrl.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ping',
        folderPath: config.folderPath || '/NREP_Inspection_Reports',
      }),
      redirect: 'follow',
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}

    if (res.ok && json?.ok !== false) {
      return {
        ok: true,
        message:
          json?.message ||
          `Connected to Microsoft OneDrive Bridge (Target Path: ${config.folderPath || '/NREP_Inspection_Reports'})`,
      };
    }

    return {
      ok: false,
      message:
        json?.error ||
        `OneDrive Webhook Bridge test returned HTTP ${res.status}. Verify your Power Automate HTTP POST trigger URL.`,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: err?.message || 'Could not reach Microsoft OneDrive Webhook Bridge URL',
    };
  }
}

/**
 * Extracts a Google Drive File ID from a viewUrl / embedUrl.
 */
export function extractGoogleDriveFileId(url?: string | null): string | null {
  const trimmed = (url || '').trim();
  if (!trimmed) return null;
  const dMatch = trimmed.match(/\/(?:file|document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/i);
  if (dMatch?.[1]) return dMatch[1];
  const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/i);
  if (idMatch?.[1]) return idMatch[1];
  return null;
}

/**
 * Deletes (moves to Trash) a file in the Admin's Google Drive folder via the configured Apps Script Bridge
 * when an engineer or admin deletes the report from inside the NREP app.
 */
export async function deleteFileViaDriveBridge(params: {
  bridgeConfig: DriveBridgeConfig;
  fileId: string;
}): Promise<{ ok: boolean; trashedInDrive?: boolean; error?: string }> {
  const { bridgeConfig, fileId } = params;
  if (!fileId) {
    return { ok: false, error: 'Missing Google Drive fileId' };
  }
  if (!bridgeConfig.enabled || !bridgeConfig.bridgeScriptUrl) {
    return { ok: false, error: 'Google Drive Bridge is not configured' };
  }

  const urlCheck = validateBridgeScriptUrl(bridgeConfig.bridgeScriptUrl);
  if (!urlCheck.valid) {
    return { ok: false, error: urlCheck.reason };
  }

  try {
    const response = await fetch(bridgeConfig.bridgeScriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify({
        action: 'delete',
        fileId,
      }),
      redirect: 'follow',
    });

    const text = await response.text();
    const json = JSON.parse(text);
    if (response.ok && json?.ok) {
      return { ok: true, trashedInDrive: true };
    }
    return {
      ok: false,
      error:
        json?.error ||
        'Apps Script did not recognize delete action. Re-deploy the updated Apps Script template to enable App -> Drive file deletion.',
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Failed to call Google Drive Bridge for file deletion',
    };
  }
}

/**
 * Deletes a file in the Admin's Microsoft OneDrive folder when deleted from the NREP app.
 */
export async function deleteFileViaOneDriveBridge(params: {
  bridgeConfig: DriveBridgeConfig;
  itemId?: string;
  viewUrl?: string;
}): Promise<{ ok: boolean; deletedInOneDrive?: boolean; error?: string }> {
  const { bridgeConfig, itemId, viewUrl } = params;
  if (!bridgeConfig.onedriveEnabled) {
    return { ok: false, error: 'Microsoft OneDrive Bridge is not enabled' };
  }

  if (bridgeConfig.onedriveMode === 'graph_token') {
    const token = (bridgeConfig.onedriveAccessToken || '').trim().replace(/^Bearer\s+/i, '');
    if (!token || !itemId) {
      return { ok: false, error: 'Missing Graph token or OneDrive itemId for deletion' };
    }
    try {
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(itemId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (res.ok || res.status === 204 || res.status === 404) {
        return { ok: true, deletedInOneDrive: true };
      }
      return { ok: false, error: `OneDrive Graph delete returned HTTP ${res.status}` };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to delete item in OneDrive' };
    }
  }

  // Webhook mode
  const webhookUrl = (bridgeConfig.onedriveBridgeUrl || '').trim();
  if (!webhookUrl) {
    return { ok: false, error: 'OneDrive Webhook URL not configured' };
  }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'delete',
        fileId: itemId || '',
        viewUrl: viewUrl || '',
      }),
      redirect: 'follow',
    });
    if (res.ok) {
      return { ok: true, deletedInOneDrive: true };
    }
    return { ok: false, error: `OneDrive Webhook delete returned HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to call OneDrive Webhook for delete' };
  }
}

/**
 * Verifies whether an attached cloud report (Google Drive, Microsoft OneDrive, or Supabase Storage) is still live
 * and has NOT been deleted or moved to Trash in Google Drive / OneDrive / Cloud Storage.
 */
export async function checkCloudReportExists(params: {
  provider: string;
  viewUrl: string;
}): Promise<{ exists: boolean; reason?: string }> {
  const { provider, viewUrl } = params;
  const cleanUrl = (viewUrl || '').trim();
  if (!cleanUrl) {
    return { exists: false, reason: 'Empty report URL' };
  }

  try {
    // 1. Check Google Drive file liveness & Trash state
    if (provider === 'google_drive' || /drive\.google\.com/i.test(cleanUrl)) {
      const fileId = extractGoogleDriveFileId(cleanUrl);
      if (!fileId) {
        return { exists: true };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      try {
        const checkUrl = `https://drive.google.com/file/d/${fileId}/view`;
        const res = await fetch(checkUrl, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          cache: 'no-store',
        });

        if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 410) {
          return {
            exists: false,
            reason: `Google Drive file (${fileId}) was deleted or removed (HTTP ${res.status})`,
          };
        }

        if (res.ok) {
          const html = await res.text();
          if (
            /isItemTrashed['"]?\s*:\s*true/i.test(html) ||
            html.includes('is in the owner&#39;s trash') ||
            html.includes("is in the owner's trash") ||
            html.includes('Sorry, the file you have requested does not exist') ||
            html.includes('Page Not Found')
          ) {
            return {
              exists: false,
              reason: `Google Drive file (${fileId}) was moved to Trash in Google Drive`,
            };
          }
        }
        return { exists: true };
      } finally {
        clearTimeout(timeout);
      }
    }

    // 2. Check Microsoft OneDrive / SharePoint link liveness
    if (
      provider === 'onedrive' ||
      /1drv\.ms|onedrive\.live\.com|sharepoint\.com/i.test(cleanUrl)
    ) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      try {
        const res = await fetch(cleanUrl, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          cache: 'no-store',
        });
        if (res.status === 404 || res.status === 410) {
          return {
            exists: false,
            reason: `Microsoft OneDrive file was deleted or removed (HTTP ${res.status})`,
          };
        }
        if (res.ok) {
          const html = await res.text();
          if (
            html.includes("This item might not exist or is no longer available") ||
            html.includes("item might have been deleted") ||
            html.includes("404 FILE NOT FOUND")
          ) {
            return {
              exists: false,
              reason: 'Microsoft OneDrive file was deleted in OneDrive',
            };
          }
        }
        return { exists: true };
      } finally {
        clearTimeout(timeout);
      }
    }

    // 3. Check Supabase Storage file liveness
    if (provider === 'supabase_storage' || /supabase\.co\/storage\/v1\/object/i.test(cleanUrl)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch(cleanUrl, {
          method: 'HEAD',
          signal: controller.signal,
          cache: 'no-store',
        });
        if (res.status === 400 || res.status === 404) {
          return {
            exists: false,
            reason: `Cloud Storage file was deleted (HTTP ${res.status})`,
          };
        }
        return { exists: true };
      } finally {
        clearTimeout(timeout);
      }
    }

    return { exists: true };
  } catch {
    return { exists: true };
  }
}

/**
 * Ready-to-copy Google Apps Script code for the Admin's personal Google Drive.
 */
export const GOOGLE_APPS_SCRIPT_BRIDGE_CODE = `// ============================================================================
// NREP EQUIPMENT DASHBOARD — TWO-WAY GOOGLE DRIVE UPLOAD & DELETE BRIDGE
// 1. Click "Save" (Ctrl+S), then click "Run" at the top once to Authorize Drive Access
// 2. Click top-right "Deploy" -> "New deployment" (or "Manage deployments" -> Edit -> New version)
// 3. Select type: "Web app", Execute as: "Me", Who has access: "Anyone" -> Click "Deploy"
// 4. Copy the Web App URL (ending in /exec) and paste it in the NREP App!
// ============================================================================

function authorizeDriveAccess() {
  // Run this function once in the editor to grant Google Drive read/write/trash permission
  var root = DriveApp.getRootFolder();
  Logger.log('Drive Access Authorized successfully for: ' + root.getName());
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents || '{}');
    var action = payload.action || 'upload';

    // 1. Delete / Trash file in Google Drive when deleted from NREP App
    if (action === 'delete') {
      var targetFileId = (payload.fileId || '').trim();
      if (!targetFileId) {
        return ContentService.createTextOutput(JSON.stringify({
          ok: false,
          error: 'Missing fileId for delete action'
        })).setMimeType(ContentService.MimeType.JSON);
      }
      var existingFile = DriveApp.getFileById(targetFileId);
      existingFile.setTrashed(true);
      return ContentService.createTextOutput(JSON.stringify({
        ok: true,
        fileId: targetFileId,
        trashed: true,
        message: 'Moved file to Google Drive Trash: ' + existingFile.getName()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var folderId = (payload.folderId || '').trim();
    var rootFolder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder();

    // 2. Connection Test (Ping)
    if (action === 'ping') {
      return ContentService.createTextOutput(JSON.stringify({
        ok: true,
        folderName: rootFolder.getName(),
        folderUrl: rootFolder.getUrl(),
        message: 'Connected to Google Drive folder: ' + rootFolder.getName()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 3. Direct File Upload from NREP App -> Google Drive
    var targetFolder = rootFolder;
    var unitSubfolder = (payload.unitSubfolder || '').trim();
    if (unitSubfolder) {
      var safeUnitName = unitSubfolder.replace(/[\\\\/:*?"<>|]/g, '-');
      var subIter = rootFolder.getFoldersByName(safeUnitName);
      targetFolder = subIter.hasNext() ? subIter.next() : rootFolder.createFolder(safeUnitName);
    }

    var decodedBytes = Utilities.base64Decode(payload.base64Data);
    var mimeType = payload.mimeType || 'application/pdf';
    var fileName = payload.fileName || ('NREP_Report_' + new Date().getTime() + '.pdf');
    var blob = Utilities.newBlob(decodedBytes, mimeType, fileName);

    var file = targetFolder.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {}

    var fileId = file.getId();
    return ContentService.createTextOutput(JSON.stringify({
      ok: true,
      fileId: fileId,
      fileName: file.getName(),
      folderName: targetFolder.getName(),
      viewUrl: 'https://drive.google.com/file/d/' + fileId + '/view?usp=sharing',
      embedUrl: 'https://drive.google.com/file/d/' + fileId + '/preview'
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      error: String(err && err.message ? err.message : err)
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({
    ok: true,
    status: 'NREP Google Drive Two-Way Upload & Delete Bridge is active'
  })).setMimeType(ContentService.MimeType.JSON);
}`;

/**
 * Ready-to-copy Microsoft Power Automate HTTP Request JSON Schema & Setup Guide
 * so Admin can connect Microsoft OneDrive / SharePoint in 1 minute just like Google Drive.
 */
export const ONEDRIVE_POWER_AUTOMATE_BRIDGE_TEMPLATE = `// ============================================================================
// NREP EQUIPMENT DASHBOARD — MICROSOFT ONEDRIVE / SHAREPOINT BRIDGE SCHEMA
// ============================================================================
// HOW TO CONNECT YOUR ONEDRIVE IN 3 EASY STEPS (Power Automate Webhook Mode):
// 1. Open https://make.powerautomate.com -> Create -> "Instant cloud flow"
// 2. Choose Trigger: "When an HTTP request is received" (Who can trigger: Anyone)
//    Paste the JSON Schema below into "Request Body JSON Schema":
// 3. Add Action 1: OneDrive for Business (or OneDrive) -> "Create file"
//      - Folder Path: @{triggerBody()?['folderPath']}
//      - File Name:   @{triggerBody()?['fileName']}
//      - File Content: @{base64ToBinary(triggerBody()?['base64Data'])}
//    Add Action 2: OneDrive -> "Create share link"
//      - File: @{outputs('Create_file')?['body/Id']} (Link type: View, Scope: Anyone)
//    Add Action 3: "Response" (Status Code: 200, Headers: Content-Type = application/json)
//      - Body:
//        {
//          "ok": true,
//          "fileId": "@{outputs('Create_file')?['body/Id']}",
//          "fileName": "@{outputs('Create_file')?['body/Name']}",
//          "viewUrl": "@{outputs('Create_share_link')?['body/WebUrl']}"
//        }
// 4. Save the Flow, copy the generated "HTTP POST URL", and paste it in the NREP App!
// ============================================================================

{
  "type": "object",
  "properties": {
    "action": { "type": "string" },
    "folderPath": { "type": "string" },
    "unitSubfolder": { "type": "string" },
    "fileName": { "type": "string" },
    "mimeType": { "type": "string" },
    "base64Data": { "type": "string" },
    "equipmentTag": { "type": "string" },
    "stageLabel": { "type": "string" },
    "fileId": { "type": "string" }
  }
}`;
