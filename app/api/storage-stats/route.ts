import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient, verifyAuthenticatedCaller } from '@/lib/server-auth';
import { UNITS } from '@/lib/types';

export const dynamic = 'force-dynamic';

export interface TableStorageStat {
  tableName: string;
  schema: string;
  description: string;
  rowCount: number;
  columnCount: number;
  rawJsonBytes: number;
  indexedStorageBytes: number;
  avgBytesPerRow: number;
  status: 'online' | 'empty' | 'unavailable';
}

export interface UnitStorageStat {
  unit: string;
  rowCount: number;
  rawBytes: number;
  indexedBytes: number;
  sharePercent: number;
}

export interface BucketStorageStat {
  id: string;
  name: string;
  public: boolean;
  fileCount: number;
  usedBytes: number;
  createdAt: string;
}

export async function GET(req: NextRequest) {
  const startTime = Date.now();
  try {
    const caller = await verifyAuthenticatedCaller(req);
    if (!caller) {
      return NextResponse.json(
        { ok: false, error: 'Authentication required' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const canViewStorage =
      caller.isAdmin ||
      caller.canReadAuditLogs ||
      caller.profile?.role === 'lead_engineer';

    if (!canViewStorage) {
      return NextResponse.json(
        { ok: false, error: 'Administrator or Lead Engineer privileges required to inspect Supabase storage telemetry' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const sbAdmin = getSupabaseAdminClient();
    const rawUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
    const projectRefMatch = rawUrl.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
    const projectRef = projectRefMatch ? projectRefMatch[1] : 'connected-instance';

    if (!sbAdmin) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Supabase Admin Client is not configured on the server.',
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Parallel live queries against actual Supabase tables, Auth, and Storage
    const [
      equipRes,
      usersRes,
      adminsRes,
      auditRes,
      authUsersRes,
      bucketsRes,
    ] = await Promise.all([
      sbAdmin.from('equipment').select('*', { count: 'exact' }),
      sbAdmin.from('users').select('*', { count: 'exact' }),
      sbAdmin.from('admins').select('*', { count: 'exact' }),
      sbAdmin.from('audit_logs').select('*', { count: 'exact' }),
      sbAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      sbAdmin.storage.listBuckets(),
    ]);

    const pingMs = Math.max(1, Date.now() - startTime);

    // Helper to compute exact UTF-8 payload size + PostgreSQL tuple/index overhead per row
    // PostgreSQL heap tuple header is 24 bytes + 4 bytes item pointer + ~64 bytes B-Tree PK/index entry per row
    const PG_ROW_OVERHEAD_BYTES = 92;

    const buildTableStat = (
      tableName: string,
      schema: string,
      description: string,
      rows: any[] | null | undefined,
      exactCount: number | null | undefined,
      hasError: boolean
    ): TableStorageStat => {
      if (hasError || !rows) {
        return {
          tableName,
          schema,
          description,
          rowCount: 0,
          columnCount: 0,
          rawJsonBytes: 0,
          indexedStorageBytes: 0,
          avgBytesPerRow: 0,
          status: 'unavailable',
        };
      }

      const rowCount = typeof exactCount === 'number' ? exactCount : rows.length;
      const columnCount = rows.length > 0 ? Object.keys(rows[0]).length : 0;

      // Measure exact UTF-8 byte footprint of every row returned from Supabase
      let rawJsonBytes = 0;
      for (const row of rows) {
        rawJsonBytes += Buffer.byteLength(JSON.stringify(row), 'utf8');
      }

      // If table has more rows than returned in a single page, scale proportionally
      if (rows.length > 0 && rowCount > rows.length) {
        rawJsonBytes = Math.round((rawJsonBytes / rows.length) * rowCount);
      }

      const indexedStorageBytes =
        rowCount > 0 ? rawJsonBytes + rowCount * PG_ROW_OVERHEAD_BYTES : 0;
      const avgBytesPerRow = rowCount > 0 ? Math.round(indexedStorageBytes / rowCount) : 0;

      return {
        tableName,
        schema,
        description,
        rowCount,
        columnCount,
        rawJsonBytes,
        indexedStorageBytes,
        avgBytesPerRow,
        status: rowCount > 0 ? 'online' : 'empty',
      };
    };

    const equipmentRows = Array.isArray(equipRes.data) ? equipRes.data : [];
    const usersRows = Array.isArray(usersRes.data) ? usersRes.data : [];
    const adminsRows = Array.isArray(adminsRes.data) ? adminsRes.data : [];
    const auditRows = Array.isArray(auditRes.data) ? auditRes.data : [];
    const authUserRows = authUsersRes?.data?.users || [];

    const tables: TableStorageStat[] = [
      buildTableStat(
        'equipment',
        'public',
        'Live inspection & stage status records across all 7 NRL units',
        equipmentRows,
        equipRes.count,
        Boolean(equipRes.error)
      ),
      buildTableStat(
        'audit_logs',
        'public',
        'Immutable security & equipment mutation audit trail logs',
        auditRows,
        auditRes.count,
        Boolean(auditRes.error)
      ),
      buildTableStat(
        'users',
        'public',
        'Application user profiles, role assignments & unit scopes',
        usersRows,
        usersRes.count,
        Boolean(usersRes.error)
      ),
      buildTableStat(
        'admins',
        'public',
        'Designated administrator whitelist & privilege registry',
        adminsRows,
        adminsRes.count,
        Boolean(adminsRes.error)
      ),
      buildTableStat(
        'users',
        'auth',
        'Supabase Auth identity accounts, JWT metadata & credentials',
        authUserRows,
        authUserRows.length,
        Boolean(authUsersRes?.error)
      ),
    ];

    // Calculate per-unit equipment storage breakdown from live `public.equipment` rows
    const unitMap = new Map<string, { rowCount: number; rawBytes: number }>();
    for (const u of UNITS) {
      unitMap.set(u, { rowCount: 0, rawBytes: 0 });
    }

    for (const row of equipmentRows) {
      const unitName = String(row.Unit || row.unit || 'UNASSIGNED').trim() || 'UNASSIGNED';
      const rowBytes = Buffer.byteLength(JSON.stringify(row), 'utf8');
      const current = unitMap.get(unitName) || { rowCount: 0, rawBytes: 0 };
      current.rowCount += 1;
      current.rawBytes += rowBytes;
      unitMap.set(unitName, current);
    }

    const totalEquipIndexedBytes =
      tables.find((t) => t.tableName === 'equipment' && t.schema === 'public')?.indexedStorageBytes || 0;

    const unitBreakdown: UnitStorageStat[] = Array.from(unitMap.entries()).map(([unit, stat]) => {
      const indexedBytes = stat.rowCount > 0 ? stat.rawBytes + stat.rowCount * PG_ROW_OVERHEAD_BYTES : 0;
      const sharePercent =
        totalEquipIndexedBytes > 0
          ? Number(((indexedBytes / totalEquipIndexedBytes) * 100).toFixed(1))
          : 0;
      return {
        unit,
        rowCount: stat.rowCount,
        rawBytes: stat.rawBytes,
        indexedBytes,
        sharePercent,
      };
    });

    // Inspect real Supabase Object Storage buckets and files
    const rawBuckets = Array.isArray(bucketsRes.data) ? bucketsRes.data : [];
    const buckets: BucketStorageStat[] = [];

    for (const b of rawBuckets) {
      let fileCount = 0;
      let usedBytes = 0;
      try {
        const { data: files } = await sbAdmin.storage.from(b.name).list('', {
          limit: 1000,
          offset: 0,
        });
        if (Array.isArray(files)) {
          for (const f of files) {
            // Skip folder placeholders that have no id/metadata
            if (f.id || f.metadata) {
              fileCount += 1;
              const size = Number(f.metadata?.size || 0);
              if (!Number.isNaN(size) && size > 0) {
                usedBytes += size;
              }
            }
          }
        }
      } catch {
        // Ignore individual bucket listing error
      }
      buckets.push({
        id: b.id || b.name,
        name: b.name,
        public: Boolean(b.public),
        fileCount,
        usedBytes,
        createdAt: b.created_at || '',
      });
    }

    // Aggregate totals
    const totalRows = tables.reduce((acc, t) => acc + t.rowCount, 0);
    const databaseRawPayloadBytes = tables.reduce((acc, t) => acc + t.rawJsonBytes, 0);
    const databaseUsedBytes = tables.reduce((acc, t) => acc + t.indexedStorageBytes, 0);

    // Standard Supabase Free Plan Quotas:
    // - PostgreSQL Database Space: 500 MB (524,288,000 bytes)
    // - Supabase Object Storage Space: 1 GB (1,073,741,824 bytes)
    const databaseQuotaBytes = 500 * 1024 * 1024; // 524,288,000 bytes (500 MB)
    const databaseRemainingBytes = Math.max(0, databaseQuotaBytes - databaseUsedBytes);
    const databaseUsedPercent = Number(((databaseUsedBytes / databaseQuotaBytes) * 100).toFixed(4));

    const storageQuotaBytes = 1024 * 1024 * 1024; // 1,073,741,824 bytes (1 GB)
    const storageUsedBytes = buckets.reduce((acc, b) => acc + b.usedBytes, 0);
    const storageRemainingBytes = Math.max(0, storageQuotaBytes - storageUsedBytes);
    const storageUsedPercent = Number(((storageUsedBytes / storageQuotaBytes) * 100).toFixed(4));
    const totalStorageFiles = buckets.reduce((acc, b) => acc + b.fileCount, 0);

    return NextResponse.json(
      {
        ok: true,
        measuredAt: new Date().toISOString(),
        pingMs,
        projectRef,
        supabaseHost: rawUrl ? new URL(rawUrl).host : 'supabase.co',
        database: {
          planTier: 'Supabase Cloud PostgreSQL (500 MB Quota)',
          quotaBytes: databaseQuotaBytes,
          usedBytes: databaseUsedBytes,
          rawPayloadBytes: databaseRawPayloadBytes,
          remainingBytes: databaseRemainingBytes,
          usedPercent: databaseUsedPercent,
          remainingPercent: Number((100 - databaseUsedPercent).toFixed(4)),
          totalRows,
          tableCount: tables.length,
        },
        objectStorage: {
          planTier: 'Supabase Object Storage (1 GB Quota)',
          quotaBytes: storageQuotaBytes,
          usedBytes: storageUsedBytes,
          remainingBytes: storageRemainingBytes,
          usedPercent: storageUsedPercent,
          remainingPercent: Number((100 - storageUsedPercent).toFixed(4)),
          bucketCount: buckets.length,
          totalFiles: totalStorageFiles,
        },
        tables,
        unitBreakdown,
        buckets,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || 'Failed to inspect live Supabase storage telemetry',
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
