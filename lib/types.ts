export interface EquipmentItem {
  id: string; // Document ID (usually EquipmentTagNo or auto ID)
  Unit: string;
  SubUnit?: string;
  SystemNo: string;
  SubSystem?: string;
  EquipmentTagNo: string;
  EquipmentDescription?: string;
  EquipmentType?: string;
  FormatIStatus?: string;
  FormatIDate?: string;
  FormatIIStatus?: string;
  FormatIIDate?: string;
  FormatIIIStatus?: string;
  FormatIIIDate?: string;
  FormatIVStatus?: string;
  FormatIVDate?: string;
  FormatVStatus?: string;
  FormatVDate?: string;
  InternalInspectionStatus?: string;
  BaseLineUTG?: string;
  PMI?: string;
  FinalSystemAcceptance?: string;
  DocumentDrawing?: string;
  Remarks?: string;
  // Legacy optional fields kept only for safe backward-compatible normalization
  AreaPackage?: string;
  RFINo?: string;
  CategoryAStatus?: string;
  MediaFillingClearance?: string;
  LastInspectionDate?: string;
  ResponsibleAgency?: string;
  Link?: string;
  updatedBy?: string;
  updatedAt?: string;
}

export type HierarchyLevelType = 'unit' | 'subunit' | 'system' | 'subsystem';

export interface HierarchyStep {
  level: HierarchyLevelType;
  label: string;
  value: string;
}

/**
 * Cleans a raw hierarchy field (Sub-Unit, System, or Sub-System).
 * Returns '' if the field is blank or a legacy auto-placeholder (e.g. "System not assigned", "RPTU Main System"),
 * allowing the hierarchy engine to automatically skip blank levels to the previous parent level.
 */
export function cleanHierarchyField(raw?: string | null, unitName?: string): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  const lc = trimmed.toLowerCase();
  if (
    lc === '—' ||
    lc === '-' ||
    lc === 'n/a' ||
    lc === 'na' ||
    lc === 'none' ||
    lc === 'null' ||
    lc === 'undefined' ||
    lc === 'unassigned' ||
    lc === 'system not assigned' ||
    lc === 'sub-unit not assigned' ||
    lc === 'sub-system not assigned' ||
    lc === 'subsystem not assigned' ||
    lc === 'main system' ||
    lc.endsWith(' main system')
  ) {
    return '';
  }
  if (unitName && lc === `${unitName.trim().toLowerCase()} main system`) {
    return '';
  }
  return trimmed;
}

/**
 * Returns the ordered chain of non-empty hierarchy levels for an equipment item:
 * Unit -> [Sub-Unit] -> [System] -> [Sub-System].
 * Any level left blank is automatically skipped.
 */
export function getEquipmentHierarchyChain(
  item: Pick<EquipmentItem, 'Unit' | 'SubUnit' | 'SystemNo' | 'SubSystem'>
): HierarchyStep[] {
  const unitVal = (item.Unit || '').trim() || 'RPTU';
  const chain: HierarchyStep[] = [{ level: 'unit', label: 'Unit', value: unitVal }];

  const subUnitVal = cleanHierarchyField(item.SubUnit, unitVal);
  if (subUnitVal) {
    chain.push({ level: 'subunit', label: 'Sub-Unit', value: subUnitVal });
  }

  const systemVal = cleanHierarchyField(item.SystemNo, unitVal);
  if (systemVal && systemVal.toUpperCase() !== subUnitVal.toUpperCase()) {
    chain.push({ level: 'system', label: 'System', value: systemVal });
  }

  const subSystemVal = cleanHierarchyField(item.SubSystem, unitVal);
  if (
    subSystemVal &&
    subSystemVal.toUpperCase() !== systemVal.toUpperCase() &&
    subSystemVal.toUpperCase() !== subUnitVal.toUpperCase()
  ) {
    chain.push({ level: 'subsystem', label: 'Sub-System', value: subSystemVal });
  }

  return chain;
}

/**
 * Formats the hierarchy path string (e.g. "MSP › NHT › SYS-01 › SUB-01" or simply "RPTU" if Sub-Unit/System/Sub-System are blank).
 */
export function formatEquipmentHierarchyPath(
  item: Pick<EquipmentItem, 'Unit' | 'SubUnit' | 'SystemNo' | 'SubSystem'>,
  separator = ' › '
): string {
  return getEquipmentHierarchyChain(item)
    .map((s) => s.value)
    .join(separator);
}

export type UserRole =
  | 'admin'
  | 'lead_engineer'
  | 'engineer'
  | 'inspector'
  | 'editor'
  | 'viewer';
export type UserStatus = 'approved' | 'pending' | 'suspended';

export const VALID_USER_ROLES: UserRole[] = [
  'admin',
  'lead_engineer',
  'engineer',
  'inspector',
  'editor',
  'viewer',
];

export function isWriteCapableRole(role?: string | null): boolean {
  return (
    role === 'admin' ||
    role === 'lead_engineer' ||
    role === 'engineer' ||
    role === 'inspector' ||
    role === 'editor'
  );
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  password?: string;
  assignedUnits?: string;
  createdAt: string;
  lastLoginAt: string;
}

export interface AuditLogItem {
  id: string;
  action: string;
  target: string;
  userEmail: string;
  timestamp: string;
  details?: string;
}

export interface ProjectUnitsConfig {
  units: string[];
  utilitySubUnits: string[];
  mspSubUnits: string[];
  updatedBy?: string;
  updatedAt?: string;
}

// Top-Level Project Units (Dynamically synchronized from Supabase Server _system/units_config.json)
export const UNITS: string[] = [
  'RPTU',
  'MSP',
  'PFCCU',
  'CDU/VDU',
  'DHDT',
  'SRB',
  'DCU Rev',
  'UTILITY',
];

/**
 * Synchronizes the in-memory UNITS, UTILITY_SUB_UNITS, and MSP_SUB_UNITS arrays
 * with the authoritative configuration fetched from Supabase Server.
 */
export function applyDynamicUnitsConfig(config?: Partial<ProjectUnitsConfig> | null): void {
  if (!config) return;
  if (Array.isArray(config.units) && config.units.length > 0) {
    const cleanUnits = Array.from(
      new Set(config.units.map((u) => String(u || '').trim()).filter(Boolean))
    );
    if (cleanUnits.length > 0) {
      UNITS.splice(0, UNITS.length, ...cleanUnits);
    }
  }
  if (Array.isArray(config.utilitySubUnits) && config.utilitySubUnits.length > 0) {
    const cleanUtil = Array.from(
      new Set(config.utilitySubUnits.map((u) => String(u || '').trim()).filter(Boolean))
    );
    if (cleanUtil.length > 0) {
      UTILITY_SUB_UNITS.splice(0, UTILITY_SUB_UNITS.length, ...cleanUtil);
    }
  }
  if (Array.isArray(config.mspSubUnits) && config.mspSubUnits.length > 0) {
    const cleanMsp = Array.from(
      new Set(config.mspSubUnits.map((u) => String(u || '').trim()).filter(Boolean))
    );
    if (cleanMsp.length > 0) {
      MSP_SUB_UNITS.splice(0, MSP_SUB_UNITS.length, ...cleanMsp);
    }
  }
}

/**
 * Returns true if the assignedUnits string represents unrestricted access to all project units.
 */
export function isAllUnitsScope(assignedUnits?: string | null): boolean {
  if (!assignedUnits) return true;
  const normalized = assignedUnits.trim().toLowerCase();
  return normalized === '' || normalized === 'all' || normalized === 'all units';
}

/**
 * Resolves the canonical list of top-level UNITS that a user profile is scoped to view/manage.
 */
export function getUserAllowedUnits(profile?: UserProfile | null): string[] {
  if (!profile || isAllUnitsScope(profile.assignedUnits)) {
    return [...UNITS];
  }
  const raw = (profile.assignedUnits || '').trim();
  const tokens = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const matched = new Set<string>();
  tokens.forEach((token) => {
    const upper = token.toUpperCase();
    const exactUnit = UNITS.find((u) => u.toUpperCase() === upper);
    if (exactUnit) {
      matched.add(exactUnit);
    } else if (upper === 'CDU' || upper === 'VDU' || upper === 'CDU-VDU') {
      matched.add('CDU/VDU');
    } else if (upper === 'DCU REV' || upper === 'DCU' || upper === 'DCUREV' || upper === 'DCU-REV') {
      matched.add('DCU Rev');
    } else if (MSP_SUB_UNITS.some((su) => su.toUpperCase() === upper)) {
      matched.add('MSP');
    } else if (UTILITY_SUB_UNITS.some((su) => su.toUpperCase() === upper)) {
      matched.add('UTILITY');
    } else {
      // Allow any custom dynamic unit assigned to the user
      matched.add(token);
    }
  });

  if (matched.size === 0) return [...UNITS];
  const ordered = UNITS.filter((u) => matched.has(u));
  matched.forEach((m) => {
    if (!ordered.some((o) => o.toUpperCase() === m.toUpperCase())) {
      ordered.push(m);
    }
  });
  return ordered;
}

export type ReportProvider =
  | 'google_drive'
  | 'onedrive'
  | 'supabase_storage'
  | 'external_link';

export type ReportStageKey =
  | 'FormatIStatus'
  | 'FormatIIStatus'
  | 'FormatIIIStatus'
  | 'FormatIVStatus'
  | 'FormatVStatus'
  | 'InternalInspectionStatus'
  | 'BaseLineUTG'
  | 'PMI'
  | 'FinalSystemAcceptance'
  | 'General';

export interface InspectionReportAttachment {
  id: string;
  title: string;
  stage: ReportStageKey;
  stageLabel: string;
  provider: ReportProvider;
  viewUrl: string;
  embedUrl: string;
  fileId?: string;
  onedriveItemId?: string;
  secondaryProvider?: ReportProvider;
  secondaryViewUrl?: string;
  secondaryEmbedUrl?: string;
  storagePath?: string;
  mimeType?: string;
  sizeBytes?: number;
  uploadedBy: string;
  uploadedAt: string;
}

/**
 * Checks whether a user profile is authorized to access/modify a given equipment Unit.
 */
export function canUserAccessUnit(
  profile?: UserProfile | null,
  unit?: string | null
): boolean {
  if (!profile || isAllUnitsScope(profile.assignedUnits)) {
    return true;
  }
  if (!unit) return true;
  const allowedSet = new Set(getUserAllowedUnits(profile).map((u) => u.toUpperCase()));
  return allowedSet.has(unit.trim().toUpperCase());
}

/**
 * Filters an equipment array according to the user's assigned unit scope.
 */
export function filterEquipmentByUserScope(
  items: EquipmentItem[],
  profile?: UserProfile | null
): EquipmentItem[] {
  if (!profile || isAllUnitsScope(profile.assignedUnits)) {
    return items;
  }
  const allowedSet = new Set(getUserAllowedUnits(profile).map((u) => u.toUpperCase()));
  return items.filter((item) => allowedSet.has((item.Unit || '').trim().toUpperCase()));
}

// 8 Sub-Units inside UTILITY (Equipment under UTILITY resides inside these sub-units)
export const UTILITY_SUB_UNITS = [
  'DM-CPU',
  'N2U',
  'CA-IA',
  'BOILERS AND HRSG',
  'COOLING TOWER',
  'RWDU',
  'RW FILTER',
  'RW RESERVOIR',
];

// 3 Sub-Units inside MSP (Equipment under MSP resides inside NHT, CCR, ISOM)
export const MSP_SUB_UNITS = [
  'NHT',
  'CCR',
  'ISOM',
];

/**
 * Resolves any raw sub-unit / package string into one of the canonical MSP_SUB_UNITS
 */
export function resolveMspSubUnit(raw?: string): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  if (!s) return null;

  if (MSP_SUB_UNITS.includes(s)) return s;

  if (s.includes('NHT') || s.includes('NAPHTHA')) {
    return 'NHT';
  }
  if (s.includes('CCR') || s.includes('REFORM')) {
    return 'CCR';
  }
  if (s.includes('ISOM') || s.includes('ISOMER')) {
    return 'ISOM';
  }

  return null;
}

/**
 * Resolves any raw sub-unit / legacy unit string into one of the 8 canonical UTILITY_SUB_UNITS
 */
export function resolveUtilitySubUnit(raw?: string): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  if (!s) return null;

  if (UTILITY_SUB_UNITS.includes(s)) return s;

  if (s === 'DM/CPU' || s === 'DM-CPU' || s === 'DM' || s === 'CPU' || s.includes('DM-CPU') || s.includes('DM/CPU')) {
    return 'DM-CPU';
  }
  if (s === 'N2U' || s.includes('N2U') || s.includes('NITROGEN')) {
    return 'N2U';
  }
  if (s === 'CA/IA' || s === 'CA-IA' || s.includes('CA-IA') || s.includes('CA/IA') || s.includes('INSTRUMENT AIR') || s.includes('COMPRESSED AIR')) {
    return 'CA-IA';
  }
  if (s === 'BOILERS & HRSG' || s === 'BOILERS AND HRSG' || s.includes('BOILER') || s.includes('HRSG')) {
    return 'BOILERS AND HRSG';
  }
  if (s === 'CT' || s === 'COOLING TOWER' || s.includes('COOLING TOWER')) {
    return 'COOLING TOWER';
  }
  if (s === 'RWDU' || s.includes('RWDU') || s.includes('DESILTING')) {
    return 'RWDU';
  }
  if (s === 'RW FILTER PACKAGE' || s === 'RW FILTER' || s.includes('RW FILTER') || s.includes('WATER FILTER')) {
    return 'RW FILTER';
  }
  if (
    s === 'RAW WATER RESERVOIR' ||
    s === 'RW RESERVOIR' ||
    s === 'FW PUMP HOUSE' ||
    s === 'ETP' ||
    s.includes('RESERVOIR')
  ) {
    return 'RW RESERVOIR';
  }

  return null;
}

export interface StatusColumnConfig {
  key: keyof EquipmentItem;
  label: string;
  short: string;
  options: [string, string];
  doneValue: string;
  pendingValue: string;
}

export const STATUS_COLUMNS: StatusColumnConfig[] = [
  {
    key: 'FormatIStatus',
    label: 'Format-I Status',
    short: 'Format-I',
    options: ['Issued', 'Not Issued'],
    doneValue: 'Issued',
    pendingValue: 'Not Issued',
  },
  {
    key: 'FormatIIStatus',
    label: 'Format-II Status',
    short: 'Format-II',
    options: ['Issued', 'Not Issued'],
    doneValue: 'Issued',
    pendingValue: 'Not Issued',
  },
  {
    key: 'FormatIIIStatus',
    label: 'Format-III Status',
    short: 'Format-III',
    options: ['Issued', 'Not Issued'],
    doneValue: 'Issued',
    pendingValue: 'Not Issued',
  },
  {
    key: 'FormatIVStatus',
    label: 'Format-IV Status',
    short: 'Format-IV',
    options: ['Issued', 'Not Issued'],
    doneValue: 'Issued',
    pendingValue: 'Not Issued',
  },
  {
    key: 'FormatVStatus',
    label: 'Format-V Status',
    short: 'Format-V',
    options: ['Issued', 'Not Issued'],
    doneValue: 'Issued',
    pendingValue: 'Not Issued',
  },
  {
    key: 'InternalInspectionStatus',
    label: 'Internal Inspection Status',
    short: 'Internal Insp.',
    options: ['Yes', 'No'],
    doneValue: 'Yes',
    pendingValue: 'No',
  },
  {
    key: 'BaseLineUTG',
    label: 'Base Line UTG',
    short: 'Base Line UTG',
    options: ['Yes', 'No'],
    doneValue: 'Yes',
    pendingValue: 'No',
  },
  {
    key: 'PMI',
    label: 'PMI',
    short: 'PMI',
    options: ['Yes', 'No'],
    doneValue: 'Yes',
    pendingValue: 'No',
  },
  {
    key: 'FinalSystemAcceptance',
    label: 'Final System Acceptance',
    short: 'Final Accept.',
    options: ['Accepted', 'Not Accepted'],
    doneValue: 'Accepted',
    pendingValue: 'Not Accepted',
  },
];

// Core inspection stages considered for percentage & completion status calculation
// (Excludes Base Line UTG, PMI, and Internal Inspection as requested)
export const PROGRESS_STAGE_COLUMNS: StatusColumnConfig[] = STATUS_COLUMNS.filter(
  (col) =>
    col.key !== 'BaseLineUTG' &&
    col.key !== 'PMI' &&
    col.key !== 'InternalInspectionStatus'
);

// Fallback generic list for legacy imports if needed
export const STATUS_OPTIONS = ['Issued', 'Not Issued', 'Yes', 'No', 'Accepted', 'Not Accepted'];

export function getStageOptions(colKey: keyof EquipmentItem): [string, string] {
  const found = STATUS_COLUMNS.find((c) => c.key === colKey);
  return found ? found.options : ['Yes', 'No'];
}

const POSITIVE_STAGE_KEYWORDS = new Set([
  'issued',
  'yes',
  'accept',
  'accepted',
  'received',
  'completed',
  'closed',
  'cleared',
  'verified',
  'done',
]);

/**
 * Normalizes any raw stage status string into the exact allowed dropdown option for that column:
 * - FormatIStatus, FormatIIStatus, FormatIIIStatus, FormatIVStatus, FormatVStatus -> 'Issued' | 'Not Issued'
 * - InternalInspectionStatus, BaseLineUTG, PMI -> 'Yes' | 'No'
 * - FinalSystemAcceptance -> 'Accepted' | 'Not Accepted'
 */
export function normalizeStageValue(colKey: keyof EquipmentItem, raw?: string): string {
  const lc = (raw || '').trim().toLowerCase();
  const isPositive =
    POSITIVE_STAGE_KEYWORDS.has(lc) ||
    (!lc.startsWith('not ') &&
      (lc.includes('completed') || lc.includes('accepted') || lc === 'issued' || lc === 'yes'));

  if (
    colKey === 'FormatIStatus' ||
    colKey === 'FormatIIStatus' ||
    colKey === 'FormatIIIStatus' ||
    colKey === 'FormatIVStatus' ||
    colKey === 'FormatVStatus'
  ) {
    return isPositive ? 'Issued' : 'Not Issued';
  }
  if (colKey === 'InternalInspectionStatus' || colKey === 'BaseLineUTG' || colKey === 'PMI') {
    return isPositive ? 'Yes' : 'No';
  }
  if (colKey === 'FinalSystemAcceptance') {
    return isPositive ? 'Accepted' : 'Not Accepted';
  }
  return raw || '';
}

export function isDone(status?: string): boolean {
  if (!status) return false;
  const lc = status.trim().toLowerCase();
  if (lc.startsWith('not ') || lc === 'no' || lc === 'pending' || lc === 'open') {
    return false;
  }
  if (POSITIVE_STAGE_KEYWORDS.has(lc)) return true;
  if (lc.includes('completed') || lc.includes('verified') || lc.includes('accepted') || lc.includes('done')) {
    return true;
  }
  return false;
}

export function isInProgress(status?: string): boolean {
  if (!status) return false;
  const lc = status.trim().toLowerCase();
  if (
    lc === 'not issued' ||
    lc === 'no' ||
    lc === 'not accept' ||
    lc === 'not accepted' ||
    lc === 'pending' ||
    lc === 'open' ||
    lc === 'in progress' ||
    lc === 'on hold'
  ) {
    return true;
  }
  return false;
}

/**
 * Normalizes any equipment record (from Supabase or Excel).
 * Supports 4-level dynamic hierarchy: Unit -> Sub-Unit -> System -> Sub-System -> Equipment.
 * Any level left blank stays '' so that blank levels automatically skip to the previous parent level.
 */
export function normalizeEquipmentRecord(
  item: Partial<EquipmentItem> & { id?: string; EquipmentTagNo?: string }
): EquipmentItem {
  const tag = (item.EquipmentTagNo || item.id || 'UNKNOWN-TAG').trim();
  const docId = item.id || tag.replace(/[^a-zA-Z0-9_-]/g, '_');

  const rawUnit = (item.Unit || '').trim();
  const upperUnit = rawUnit.toUpperCase();

  let canonicalUnit = 'RPTU';
  let inferredSubFromUnit = '';

  if (upperUnit === 'RPTU') {
    canonicalUnit = 'RPTU';
  } else if (upperUnit === 'MSP' || upperUnit === 'MS BLOCK' || upperUnit === 'MS PLANT') {
    canonicalUnit = 'MSP';
  } else if (upperUnit === 'PFCCU' || upperUnit === 'PFCC' || upperUnit === 'FCCU') {
    canonicalUnit = 'PFCCU';
  } else if (upperUnit === 'CDU/VDU' || upperUnit === 'CDU-VDU' || upperUnit === 'CDU' || upperUnit === 'VDU') {
    canonicalUnit = 'CDU/VDU';
  } else if (upperUnit === 'DHDT' || upperUnit === 'DHT') {
    canonicalUnit = 'DHDT';
  } else if (upperUnit === 'SRB' || upperUnit === 'SRU') {
    canonicalUnit = 'SRB';
  } else if (upperUnit === 'DCU REV' || upperUnit === 'DCU' || upperUnit === 'DCUREV' || upperUnit === 'DCU-REV') {
    canonicalUnit = 'DCU Rev';
  } else if (upperUnit === 'UTILITY' || upperUnit === 'UTILITIES') {
    canonicalUnit = 'UTILITY';
  } else {
    const fromLegacyUtility = resolveUtilitySubUnit(rawUnit);
    const fromLegacyMsp = resolveMspSubUnit(rawUnit);
    if (fromLegacyUtility) {
      canonicalUnit = 'UTILITY';
      inferredSubFromUnit = fromLegacyUtility;
    } else if (fromLegacyMsp) {
      canonicalUnit = 'MSP';
      inferredSubFromUnit = fromLegacyMsp;
    } else {
      const matchedCanonical = UNITS.find((u) => u.toUpperCase() === upperUnit);
      if (matchedCanonical) {
        canonicalUnit = matchedCanonical;
      } else {
        canonicalUnit = rawUnit || UNITS[0] || 'RPTU';
      }
    }
  }

  // Clean Sub-Unit: only populate if provided (or inferred from legacy Unit/System), never force a default when left blank
  const cleanedRawSub =
    cleanHierarchyField(item.SubUnit, canonicalUnit) ||
    cleanHierarchyField(item.AreaPackage, canonicalUnit) ||
    inferredSubFromUnit;

  let canonicalSubUnit = '';
  if (cleanedRawSub) {
    if (canonicalUnit === 'UTILITY') {
      canonicalSubUnit = resolveUtilitySubUnit(cleanedRawSub) || cleanedRawSub;
    } else if (canonicalUnit === 'MSP') {
      canonicalSubUnit = resolveMspSubUnit(cleanedRawSub) || cleanedRawSub;
    } else {
      canonicalSubUnit = cleanedRawSub;
    }
  } else if (canonicalUnit === 'UTILITY' && item.SystemNo && resolveUtilitySubUnit(item.SystemNo)) {
    canonicalSubUnit = resolveUtilitySubUnit(item.SystemNo) || '';
  } else if (canonicalUnit === 'MSP' && item.SystemNo && resolveMspSubUnit(item.SystemNo)) {
    canonicalSubUnit = resolveMspSubUnit(item.SystemNo) || '';
  }

  // Clean SystemNo: keep '' if blank or if it was a placeholder or auto-duplicated from SubUnit
  const cleanedRawSys = cleanHierarchyField(item.SystemNo, canonicalUnit);
  const systemNo =
    cleanedRawSys && cleanedRawSys.toUpperCase() !== canonicalSubUnit.toUpperCase()
      ? cleanedRawSys
      : '';

  // Clean SubSystem: read from item.SubSystem or from repurposed DB column PunchPointsCategoryClosed
  const rawLegacyCol = (item as any).PunchPointsCategoryClosed;
  const legacySubSys =
    typeof rawLegacyCol === 'string' &&
    !['yes', 'no', 'open', 'closed', 'pending', 'completed', 'not applicable', 'not started'].includes(
      rawLegacyCol.trim().toLowerCase()
    )
      ? rawLegacyCol
      : '';
  const cleanedRawSubSys = cleanHierarchyField(item.SubSystem ?? legacySubSys, canonicalUnit);
  const subSystem =
    cleanedRawSubSys &&
    cleanedRawSubSys.toUpperCase() !== systemNo.toUpperCase() &&
    cleanedRawSubSys.toUpperCase() !== canonicalSubUnit.toUpperCase()
      ? cleanedRawSubSys
      : '';

  const formatIVStatus = normalizeStageValue(
    'FormatIVStatus',
    item.FormatIVStatus ?? item.CategoryAStatus
  );
  const formatIVDate = item.FormatIVDate ?? item.LastInspectionDate ?? '';
  const formatVStatus = normalizeStageValue(
    'FormatVStatus',
    item.FormatVStatus ?? item.MediaFillingClearance
  );
  const formatVDate = item.FormatVDate ?? item.ResponsibleAgency ?? '';
  const pmiStatus = normalizeStageValue('PMI', item.PMI ?? item.RFINo);

  return {
    id: docId,
    Unit: canonicalUnit,
    SubUnit: canonicalSubUnit,
    SystemNo: systemNo,
    SubSystem: subSystem,
    EquipmentTagNo: tag,
    EquipmentDescription: item.EquipmentDescription ?? '',
    EquipmentType: item.EquipmentType ?? '',
    FormatIStatus: normalizeStageValue('FormatIStatus', item.FormatIStatus),
    FormatIDate: item.FormatIDate ?? '',
    FormatIIStatus: normalizeStageValue('FormatIIStatus', item.FormatIIStatus),
    FormatIIDate: item.FormatIIDate ?? '',
    FormatIIIStatus: normalizeStageValue('FormatIIIStatus', item.FormatIIIStatus),
    FormatIIIDate: item.FormatIIIDate ?? '',
    FormatIVStatus: formatIVStatus,
    FormatIVDate: formatIVDate,
    FormatVStatus: formatVStatus,
    FormatVDate: formatVDate,
    InternalInspectionStatus: normalizeStageValue('InternalInspectionStatus', item.InternalInspectionStatus),
    BaseLineUTG: normalizeStageValue('BaseLineUTG', item.BaseLineUTG),
    PMI: pmiStatus,
    FinalSystemAcceptance: normalizeStageValue('FinalSystemAcceptance', item.FinalSystemAcceptance),
    DocumentDrawing: item.DocumentDrawing ?? item.Link ?? '',
    Remarks: item.Remarks ?? '',
    updatedBy: item.updatedBy ?? 'System',
    updatedAt: item.updatedAt ?? '',
  };
}

/**
 * Converts a normalized `EquipmentItem` into the exact column payload expected by `public.equipment`
 * in Supabase PostgreSQL, storing `FormatIVStatus`, `FormatIVDate`, `FormatVStatus`, `FormatVDate`,
 * `PMI`, and `SubSystem` inside the existing schema columns (`CategoryAStatus`, `LastInspectionDate`,
 * `MediaFillingClearance`, `ResponsibleAgency`, `RFINo`, `PunchPointsCategoryClosed`) so zero manual DB migration is required.
 */
export function toDatabaseEquipmentRow(item: EquipmentItem): Record<string, any> {
  return {
    id: item.id,
    Unit: item.Unit,
    SubUnit: item.SubUnit ?? '',
    SystemNo: item.SystemNo ?? '',
    SubSystem: item.SubSystem ?? '',
    EquipmentTagNo: item.EquipmentTagNo,
    EquipmentDescription: item.EquipmentDescription ?? '',
    EquipmentType: item.EquipmentType ?? '',
    FormatIStatus: item.FormatIStatus ?? 'Not Issued',
    FormatIDate: item.FormatIDate ?? '',
    FormatIIStatus: item.FormatIIStatus ?? 'Not Issued',
    FormatIIDate: item.FormatIIDate ?? '',
    FormatIIIStatus: item.FormatIIIStatus ?? 'Not Issued',
    FormatIIIDate: item.FormatIIIDate ?? '',
    FormatIVStatus: item.FormatIVStatus ?? 'Not Issued',
    FormatIVDate: item.FormatIVDate ?? '',
    FormatVStatus: item.FormatVStatus ?? 'Not Issued',
    FormatVDate: item.FormatVDate ?? '',
    InternalInspectionStatus: item.InternalInspectionStatus ?? 'No',
    BaseLineUTG: item.BaseLineUTG ?? 'No',
    PMI: item.PMI ?? 'No',
    FinalSystemAcceptance: item.FinalSystemAcceptance ?? 'Not Accepted',
    DocumentDrawing: item.DocumentDrawing ?? '',
    Remarks: item.Remarks ?? '',
    // Legacy fallback columns for backward compatibility
    PunchPointsCategoryClosed: item.SubSystem ?? '',
    CategoryAStatus: item.FormatIVStatus ?? 'Not Issued',
    LastInspectionDate: item.FormatIVDate ?? '',
    MediaFillingClearance: item.FormatVStatus ?? 'Not Issued',
    ResponsibleAgency: item.FormatVDate ?? '',
    RFINo: item.PMI ?? 'No',
    updatedBy: item.updatedBy ?? 'System',
    updatedAt: item.updatedAt ?? '',
  };
}

/**
 * Calculates overall equipment status strictly from its progress stage dropdowns
 * (Format-I to Format-V, Internal Insp., Final Accept. — excluding Base Line UTG and PMI):
 * - 'Completed': All progress stages are Done (Issued / Yes / Accepted)
 * - 'In progress': At least 1 progress stage is Done, but not all
 * - 'Not started': 0 progress stages are Done
 */
export function getEquipmentOverallStatus(item: EquipmentItem): 'Completed' | 'In progress' | 'Not started' {
  let doneStages = 0;
  PROGRESS_STAGE_COLUMNS.forEach((col) => {
    const val = (item[col.key] as string) || '';
    if (isDone(val)) doneStages++;
  });

  if (doneStages === PROGRESS_STAGE_COLUMNS.length) {
    return 'Completed';
  }
  if (doneStages > 0) {
    return 'In progress';
  }
  return 'Not started';
}

/**
 * Calculates percentage completion (0% to 100%) for any hierarchy scope
 * (single Equipment, Sub-Unit, Unit, or Entire Project) based on the progress stages
 * (Format-I, Format-II, Format-III, Format-IV, Format-V, Internal Insp., Final Accept. — excluding Base Line UTG and PMI).
 */
export function calculateProgress(items: EquipmentItem[]): number {
  if (!items || items.length === 0) return 0;
  let doneCount = 0;
  let totalCount = 0;

  items.forEach((item) => {
    PROGRESS_STAGE_COLUMNS.forEach((col) => {
      const val = (item[col.key] as string) || '';
      totalCount++;
      if (isDone(val)) doneCount++;
    });
  });

  return totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
}

// No hardcoded equipment data — all equipment data is stored and synced live in Supabase
export const SAMPLE_EQUIPMENT_DATA: Omit<EquipmentItem, 'id'>[] = [];
