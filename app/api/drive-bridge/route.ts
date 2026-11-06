import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient, verifyAuthenticatedCaller } from '@/lib/server-auth';
import {
  ActiveCloudProviderMode,
  OneDriveConnectionMode,
  loadDriveBridgeConfig,
  saveDriveBridgeConfig,
  validateBridgeScriptUrl,
  validateOneDriveBridgeConfig,
  testOneDriveBridgeConnection,
  GOOGLE_APPS_SCRIPT_BRIDGE_CODE,
  ONEDRIVE_POWER_AUTOMATE_BRIDGE_TEMPLATE,
} from '@/lib/driveBridge';
import { extractGoogleDriveFolderId } from '@/lib/reportUtils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const caller = await verifyAuthenticatedCaller(req);
  const sbAdmin = getSupabaseAdminClient();
  if (!sbAdmin) {
    return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 500 });
  }

  const config = await loadDriveBridgeConfig(sbAdmin);

  return NextResponse.json({
    ok: true,
    config: {
      activeProvider: config.activeProvider,

      // Google Drive settings
      enabled: Boolean(config.enabled && config.bridgeScriptUrl),
      hasBridgeUrl: Boolean(config.bridgeScriptUrl),
      bridgeScriptUrl: caller.isAdmin ? config.bridgeScriptUrl : '',
      targetFolderUrl: config.targetFolderUrl,
      targetFolderId: config.targetFolderId,
      organizeByUnitSubfolder: config.organizeByUnitSubfolder,
      lastTestedAt: config.lastTestedAt,
      lastTestStatus: config.lastTestStatus,
      lastTestMessage: config.lastTestMessage,

      // Microsoft OneDrive settings
      onedriveEnabled: Boolean(config.onedriveEnabled),
      onedriveMode: config.onedriveMode || 'webhook_bridge',
      hasOneDriveCreds: Boolean(
        config.onedriveMode === 'graph_token'
          ? config.onedriveAccessToken
          : config.onedriveBridgeUrl
      ),
      onedriveBridgeUrl: caller.isAdmin ? config.onedriveBridgeUrl : '',
      onedriveAccessToken: caller.isAdmin ? config.onedriveAccessToken : '',
      onedriveTargetFolderUrl: config.onedriveTargetFolderUrl,
      onedriveFolderPath: config.onedriveFolderPath || '/NREP_Inspection_Reports',
      onedriveOrganizeByUnitSubfolder: config.onedriveOrganizeByUnitSubfolder,
      onedriveLastTestedAt: config.onedriveLastTestedAt,
      onedriveLastTestStatus: config.onedriveLastTestStatus,
      onedriveLastTestMessage: config.onedriveLastTestMessage,

      updatedBy: config.updatedBy,
      updatedAt: config.updatedAt,
    },
    scriptTemplate: caller.isAdmin ? GOOGLE_APPS_SCRIPT_BRIDGE_CODE : undefined,
    onedriveTemplate: caller.isAdmin ? ONEDRIVE_POWER_AUTOMATE_BRIDGE_TEMPLATE : undefined,
  });
}

export async function POST(req: NextRequest) {
  const caller = await verifyAuthenticatedCaller(req);
  if (!caller.authenticated || !caller.profile || !caller.isAdmin) {
    return NextResponse.json(
      { ok: false, error: 'Only Administrators can configure the Central Cloud Drive Upload Bridge.' },
      { status: 403 }
    );
  }

  const sbAdmin = getSupabaseAdminClient();
  if (!sbAdmin) {
    return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 500 });
  }

  try {
    const body = await req.json();
    const action = String(body.action || 'save');
    const providerTarget = String(body.providerTarget || 'google_drive');

    // -------------------------------------------------------------------------
    // 1. INSTANT CLOUD PROVIDER SWITCH ("Shift Drive Anytime")
    // -------------------------------------------------------------------------
    if (action === 'switch_provider') {
      const requestedProvider = String(body.activeProvider || 'google_drive') as ActiveCloudProviderMode;
      const validProviders: ActiveCloudProviderMode[] = [
        'google_drive',
        'onedrive',
        'both',
        'supabase_storage',
      ];
      const nextProvider: ActiveCloudProviderMode = validProviders.includes(requestedProvider)
        ? requestedProvider
        : 'google_drive';

      const saved = await saveDriveBridgeConfig(
        sbAdmin,
        { activeProvider: nextProvider },
        caller.profile.email
      );

      const providerLabel =
        nextProvider === 'google_drive'
          ? 'Google Drive (Primary)'
          : nextProvider === 'onedrive'
          ? 'Microsoft OneDrive (Primary)'
          : nextProvider === 'both'
          ? 'Dual-Cloud Sync (Both Google Drive + Microsoft OneDrive)'
          : 'Built-in App Cloud Storage';

      try {
        await sbAdmin.from('audit_logs').insert({
          id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          action: 'SWITCH_ACTIVE_CLOUD_DRIVE',
          target: providerLabel,
          userEmail: caller.profile.email,
          timestamp: new Date().toISOString(),
          details: `Switched active inspection report upload destination to: ${providerLabel}`,
        });
      } catch {}

      return NextResponse.json({
        ok: true,
        config: saved,
        message: `Active Cloud Drive switched to ${providerLabel}! All new engineer uploads will now follow this mode.`,
      });
    }

    // -------------------------------------------------------------------------
    // 2. SAVE / TEST MICROSOFT ONEDRIVE BRIDGE CONFIGURATION
    // -------------------------------------------------------------------------
    if (providerTarget === 'onedrive') {
      const onedriveMode: OneDriveConnectionMode =
        body.onedriveMode === 'graph_token' ? 'graph_token' : 'webhook_bridge';
      const onedriveBridgeUrl = String(body.onedriveBridgeUrl ?? '').trim();
      const onedriveAccessToken = String(body.onedriveAccessToken ?? '').trim();
      const onedriveTargetFolderUrl = String(body.onedriveTargetFolderUrl ?? '').trim();
      const rawFolderPath = String(body.onedriveFolderPath ?? '/NREP_Inspection_Reports').trim();
      const onedriveFolderPath = rawFolderPath.startsWith('/') ? rawFolderPath : `/${rawFolderPath}`;
      const onedriveOrganizeByUnitSubfolder = body.onedriveOrganizeByUnitSubfolder !== false;

      const hasCreds =
        onedriveMode === 'graph_token' ? Boolean(onedriveAccessToken) : Boolean(onedriveBridgeUrl);
      const onedriveEnabled =
        body.onedriveEnabled !== undefined ? Boolean(body.onedriveEnabled && hasCreds) : hasCreds;

      if (hasCreds) {
        const check = validateOneDriveBridgeConfig({
          mode: onedriveMode,
          bridgeUrl: onedriveBridgeUrl,
          accessToken: onedriveAccessToken,
        });
        if (!check.valid) {
          return NextResponse.json({ ok: false, error: check.reason }, { status: 400 });
        }
      }

      let onedriveLastTestedAt: string | undefined = undefined;
      let onedriveLastTestStatus: 'ok' | 'error' | undefined = undefined;
      let onedriveLastTestMessage: string | undefined = undefined;

      if (action === 'test' || (hasCreds && body.testConnection)) {
        if (!hasCreds) {
          return NextResponse.json(
            {
              ok: false,
              error:
                onedriveMode === 'graph_token'
                  ? 'Please paste your Microsoft Graph API Access Token first.'
                  : 'Please paste your Microsoft OneDrive Power Automate / Webhook Bridge URL first.',
            },
            { status: 400 }
          );
        }

        onedriveLastTestedAt = new Date().toISOString();
        const testRes = await testOneDriveBridgeConnection({
          mode: onedriveMode,
          bridgeUrl: onedriveBridgeUrl,
          accessToken: onedriveAccessToken,
          folderPath: onedriveFolderPath,
        });

        onedriveLastTestStatus = testRes.ok ? 'ok' : 'error';
        onedriveLastTestMessage = testRes.message;
      }

      const requestedActiveProvider = body.activeProvider as ActiveCloudProviderMode | undefined;

      const saved = await saveDriveBridgeConfig(
        sbAdmin,
        {
          onedriveEnabled: Boolean(onedriveEnabled && hasCreds),
          onedriveMode,
          onedriveBridgeUrl,
          onedriveAccessToken,
          onedriveTargetFolderUrl,
          onedriveFolderPath,
          onedriveOrganizeByUnitSubfolder,
          ...(requestedActiveProvider ? { activeProvider: requestedActiveProvider } : {}),
          ...(onedriveLastTestedAt
            ? {
                onedriveLastTestedAt,
                onedriveLastTestStatus,
                onedriveLastTestMessage,
              }
            : {}),
        },
        caller.profile.email
      );

      try {
        await sbAdmin.from('audit_logs').insert({
          id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          action: 'CONFIGURE_ONEDRIVE_BRIDGE',
          target: saved.onedriveFolderPath || 'Microsoft OneDrive Bridge',
          userEmail: caller.profile.email,
          timestamp: new Date().toISOString(),
          details: `Updated Central Microsoft OneDrive Upload Bridge (Mode: ${saved.onedriveMode}, Enabled: ${saved.onedriveEnabled}, Active Provider: ${saved.activeProvider})`,
        });
      } catch {}

      if (onedriveLastTestStatus === 'error') {
        return NextResponse.json(
          {
            ok: false,
            error: onedriveLastTestMessage || 'Microsoft OneDrive connection test failed',
            config: saved,
          },
          { status: 400 }
        );
      }

      return NextResponse.json({
        ok: true,
        config: saved,
        message:
          onedriveLastTestMessage ||
          (saved.onedriveEnabled
            ? 'Central Microsoft OneDrive Direct Upload Bridge saved and ready!'
            : 'Microsoft OneDrive configuration saved.'),
      });
    }

    // -------------------------------------------------------------------------
    // 3. SAVE / TEST GOOGLE DRIVE BRIDGE CONFIGURATION (Existing Flow Intact)
    // -------------------------------------------------------------------------
    const bridgeScriptUrl = String(body.bridgeScriptUrl ?? '').trim();
    const targetFolderUrl = String(body.targetFolderUrl ?? '').trim();
    const targetFolderId = extractGoogleDriveFolderId(targetFolderUrl) || '';
    const organizeByUnitSubfolder = body.organizeByUnitSubfolder !== false;
    const enabled = body.enabled !== undefined ? Boolean(body.enabled) : Boolean(bridgeScriptUrl);
    const requestedActiveProvider = body.activeProvider as ActiveCloudProviderMode | undefined;

    if (bridgeScriptUrl) {
      const urlCheck = validateBridgeScriptUrl(bridgeScriptUrl);
      if (!urlCheck.valid) {
        return NextResponse.json(
          { ok: false, error: urlCheck.reason },
          { status: 400 }
        );
      }
    }

    let lastTestedAt: string | undefined = undefined;
    let lastTestStatus: 'ok' | 'error' | undefined = undefined;
    let lastTestMessage: string | undefined = undefined;

    if (action === 'test' || (bridgeScriptUrl && body.testConnection)) {
      if (!bridgeScriptUrl) {
        return NextResponse.json(
          { ok: false, error: 'Please paste your Google Apps Script Web App URL first.' },
          { status: 400 }
        );
      }

      lastTestedAt = new Date().toISOString();
      try {
        const pingRes = await fetch(bridgeScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'ping',
            folderId: targetFolderId,
          }),
          redirect: 'follow',
        });

        const text = await pingRes.text();
        let pingJson: any = null;
        try {
          pingJson = JSON.parse(text);
        } catch {
          if (text.includes('accounts.google.com') || text.includes('Sign in')) {
            throw new Error(
              'Google returned a Sign-In page. In Apps Script -> Deploy -> Manage deployments, change "Who has access" from "Anyone with Google account" to "Anyone".'
            );
          }
          if (text.includes('Authorization is required') || text.includes('permission')) {
            throw new Error(
              'Google Drive permission not authorized yet in Apps Script. Open your script editor, click the "Run" button at the top once, and click "Review permissions" -> "Allow".'
            );
          }
          throw new Error(
            'Bridge URL did not return valid JSON. Make sure you deployed the Apps Script as a Web App (ending in /exec) with "Who has access: Anyone".'
          );
        }

        if (!pingRes.ok || !pingJson?.ok) {
          throw new Error(pingJson?.error || `Google Drive Bridge test failed (HTTP ${pingRes.status})`);
        }

        lastTestStatus = 'ok';
        lastTestMessage =
          pingJson.message ||
          `Connected to Google Drive Folder "${pingJson.folderName || 'Root'}"`;
      } catch (pingErr: any) {
        lastTestStatus = 'error';
        lastTestMessage = pingErr?.message || 'Failed to connect to Google Drive Bridge';
      }
    }

    const saved = await saveDriveBridgeConfig(
      sbAdmin,
      {
        enabled: Boolean(enabled && bridgeScriptUrl),
        bridgeScriptUrl,
        targetFolderUrl,
        targetFolderId,
        organizeByUnitSubfolder,
        ...(requestedActiveProvider ? { activeProvider: requestedActiveProvider } : {}),
        ...(lastTestedAt ? { lastTestedAt, lastTestStatus, lastTestMessage } : {}),
      },
      caller.profile.email
    );

    try {
      await sbAdmin.from('audit_logs').insert({
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        action: 'CONFIGURE_DRIVE_BRIDGE',
        target: saved.targetFolderId || 'Google Drive Bridge',
        userEmail: caller.profile.email,
        timestamp: new Date().toISOString(),
        details: `Updated Central Google Drive Direct Upload Bridge (Enabled: ${saved.enabled}, Unit Subfolders: ${saved.organizeByUnitSubfolder}, Active Provider: ${saved.activeProvider})`,
      });
    } catch {}

    if (lastTestStatus === 'error') {
      return NextResponse.json(
        {
          ok: false,
          error: lastTestMessage || 'Connection test failed',
          config: saved,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      config: saved,
      message:
        lastTestMessage ||
        (saved.enabled
          ? 'Central Google Drive Direct Upload Bridge saved and active!'
          : 'Configuration saved (Direct uploads currently using Cloud Storage).'),
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to save Cloud Drive Bridge configuration' },
      { status: 500 }
    );
  }
}
