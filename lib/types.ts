export interface EquipmentItem {
  id: string; // Document ID (usually EquipmentTagNo or auto ID)
  Unit: string;
  SubUnit?: string;
  SystemNo: string;
  EquipmentTagNo: string;
  EquipmentDescription?: string;
  EquipmentType?: string;
  FormatIStatus?: string;
  FormatIDate?: string;
  FormatIIStatus?: string;
  FormatIIDate?: string;
  FormatIIIStatus?: string;
  FormatIIIDate?: string;
  InternalInspectionStatus?: string;
  BaseLineUTG?: string;
  PunchPointsCategoryClosed?: string;
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

export type UserRole = 'admin' | 'editor' | 'viewer';
export type UserStatus = 'approved' | 'pending' | 'suspended';

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

// 7 Revised Top-Level Project Units
export const UNITS = [
  'RPTU',
  'MSP',
  'PFCCU',
  'CDU/VDU',
  'DHDT',
  'SRB',
  'UTILITY',
];

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
    key: 'FinalSystemAcceptance',
    label: 'Final System Acceptance',
    short: 'Final Accept.',
    options: ['Accept', 'Not accept'],
    doneValue: 'Accept',
    pendingValue: 'Not accept',
  },
];

// Fallback generic list for legacy imports if needed
export const STATUS_OPTIONS = ['Issued', 'Not Issued', 'Yes', 'No', 'Accept', 'Not accept'];

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
 * - FormatIStatus, FormatIIStatus, FormatIIIStatus -> 'Issued' | 'Not Issued'
 * - InternalInspectionStatus, BaseLineUTG -> 'Yes' | 'No'
 * - FinalSystemAcceptance -> 'Accept' | 'Not accept'
 */
export function normalizeStageValue(colKey: keyof EquipmentItem, raw?: string): string {
  const lc = (raw || '').trim().toLowerCase();
  const isPositive =
    POSITIVE_STAGE_KEYWORDS.has(lc) ||
    (!lc.startsWith('not ') &&
      (lc.includes('completed') || lc.includes('accepted') || lc === 'issued' || lc === 'yes'));

  if (colKey === 'FormatIStatus' || colKey === 'FormatIIStatus' || colKey === 'FormatIIIStatus') {
    return isPositive ? 'Issued' : 'Not Issued';
  }
  if (colKey === 'InternalInspectionStatus' || colKey === 'BaseLineUTG') {
    return isPositive ? 'Yes' : 'No';
  }
  if (colKey === 'FinalSystemAcceptance') {
    return isPositive ? 'Accept' : 'Not accept';
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
 * Normalizes any equipment record (from Firestore, Excel, or legacy state)
 * so its Unit is one of the 7 canonical UNITS, if Unit === 'UTILITY'
 * its SubUnit is one of the 8 canonical UTILITY_SUB_UNITS, and all 6 stage
 * columns use their exact dropdown values.
 */
export function normalizeEquipmentRecord(
  item: Partial<EquipmentItem> & { id?: string; EquipmentTagNo?: string }
): EquipmentItem {
  const tag = (item.EquipmentTagNo || item.id || 'UNKNOWN-TAG').trim();
  const docId = item.id || tag.replace(/[^a-zA-Z0-9_-]/g, '_');

  const rawUnit = (item.Unit || '').trim();
  const upperUnit = rawUnit.toUpperCase();

  let canonicalUnit = 'UTILITY';
  let canonicalSubUnit = '';

  // Check if rawUnit directly matches one of the 6 main process units
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
  } else if (upperUnit === 'UTILITY' || upperUnit === 'UTILITIES') {
    canonicalUnit = 'UTILITY';
    canonicalSubUnit =
      resolveUtilitySubUnit(item.SubUnit) ||
      resolveUtilitySubUnit(item.AreaPackage) ||
      resolveUtilitySubUnit(item.SystemNo) ||
      'DM-CPU';
  } else {
    const fromLegacyUnit = resolveUtilitySubUnit(rawUnit);
    if (fromLegacyUnit) {
      canonicalUnit = 'UTILITY';
      canonicalSubUnit = fromLegacyUnit;
    } else if (UNITS.includes(rawUnit)) {
      canonicalUnit = rawUnit;
    } else {
      const inferredSub =
        resolveUtilitySubUnit(item.SubUnit) ||
        resolveUtilitySubUnit(item.AreaPackage) ||
        resolveUtilitySubUnit(item.SystemNo);
      if (inferredSub) {
        canonicalUnit = 'UTILITY';
        canonicalSubUnit = inferredSub;
      } else {
        canonicalUnit = rawUnit || 'RPTU';
      }
    }
  }

  const systemNo =
    canonicalUnit === 'UTILITY'
      ? item.SystemNo && !resolveUtilitySubUnit(item.SystemNo)
        ? item.SystemNo
        : canonicalSubUnit
      : item.SystemNo || `${canonicalUnit} Main System`;

  return {
    id: docId,
    Unit: canonicalUnit,
    SubUnit: canonicalUnit === 'UTILITY' ? canonicalSubUnit : '',
    SystemNo: systemNo,
    EquipmentTagNo: tag,
    EquipmentDescription: item.EquipmentDescription ?? '',
    EquipmentType: item.EquipmentType ?? '',
    FormatIStatus: normalizeStageValue('FormatIStatus', item.FormatIStatus),
    FormatIDate: item.FormatIDate ?? '',
    FormatIIStatus: normalizeStageValue('FormatIIStatus', item.FormatIIStatus),
    FormatIIDate: item.FormatIIDate ?? '',
    FormatIIIStatus: normalizeStageValue('FormatIIIStatus', item.FormatIIIStatus),
    FormatIIIDate: item.FormatIIIDate ?? '',
    InternalInspectionStatus: normalizeStageValue('InternalInspectionStatus', item.InternalInspectionStatus),
    BaseLineUTG: normalizeStageValue('BaseLineUTG', item.BaseLineUTG),
    PunchPointsCategoryClosed: item.PunchPointsCategoryClosed ?? '',
    FinalSystemAcceptance: normalizeStageValue('FinalSystemAcceptance', item.FinalSystemAcceptance),
    DocumentDrawing: item.DocumentDrawing ?? item.Link ?? '',
    Remarks: item.Remarks ?? '',
    updatedBy: item.updatedBy ?? 'System',
    updatedAt: item.updatedAt ?? '',
  };
}

/**
 * Calculates overall equipment status strictly from its stage dropdowns:
 * - 'Completed': All stages are Done (Issued / Yes / Accept)
 * - 'In progress': At least 1 stage is Done, but not all stages
 * - 'Not started': 0 stages are Done (all are Not Issued / No / Not accept)
 */
export function getEquipmentOverallStatus(item: EquipmentItem): 'Completed' | 'In progress' | 'Not started' {
  let doneStages = 0;
  STATUS_COLUMNS.forEach((col) => {
    const val = (item[col.key] as string) || '';
    if (isDone(val)) doneStages++;
  });

  if (doneStages === STATUS_COLUMNS.length) {
    return 'Completed';
  }
  if (doneStages > 0) {
    return 'In progress';
  }
  return 'Not started';
}

/**
 * Calculates percentage completion (0% to 100%) for any hierarchy scope
 * (single Equipment, Sub-Unit, Unit, or Entire Project) based on the stage dropdowns.
 */
export function calculateProgress(items: EquipmentItem[]): number {
  if (!items || items.length === 0) return 0;
  let doneCount = 0;
  let totalCount = 0;

  items.forEach((item) => {
    STATUS_COLUMNS.forEach((col) => {
      const val = (item[col.key] as string) || '';
      totalCount++;
      if (isDone(val)) doneCount++;
    });
  });

  return totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
}

export const SAMPLE_EQUIPMENT_DATA: Omit<EquipmentItem, 'id'>[] = [
  // ============================================================================
  // 1. RPTU (Residue Processing & Treating Unit)
  // ============================================================================
  {
    Unit: 'RPTU',
    SubUnit: '',
    SystemNo: 'RPTU-SYS-01 (High Pressure Reaction Loop)',
    EquipmentTagNo: 'RPTU-R-1001A',
    EquipmentDescription: 'RPTU Ebullated Bed Reactor #1',
    EquipmentType: 'Reactor',
    FormatIStatus: 'Issued',
    FormatIDate: '2026-01-12',
    FormatIIStatus: 'Issued',
    FormatIIDate: '2026-02-05',
    FormatIIIStatus: 'Issued',
    FormatIIIDate: '2026-02-20',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    PunchPointsCategoryClosed: 'A',
    FinalSystemAcceptance: 'Accept',
    DocumentDrawing: 'NRL-RPTU-GA-1001A Rev.2',
    Remarks: 'Internal catalyst support grid and hydrotest accepted.',
  },
  {
    Unit: 'RPTU',
    SubUnit: '',
    SystemNo: 'RPTU-SYS-02 (Hot High Pressure Separator)',
    EquipmentTagNo: 'RPTU-V-1004',
    EquipmentDescription: 'Hot High Pressure Separator Vessel',
    EquipmentType: 'Vessel',
    FormatIStatus: 'Issued',
    FormatIDate: '2026-01-18',
    FormatIIStatus: 'Issued',
    FormatIIDate: '2026-02-14',
    FormatIIIStatus: 'Not Issued',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'No',
    FinalSystemAcceptance: 'Not accept',
    DocumentDrawing: 'NRL-RPTU-GA-1004 Rev.1',
    Remarks: 'Demister pad installation under inspection.',
  },
  {
    Unit: 'RPTU',
    SubUnit: '',
    SystemNo: 'RPTU-SYS-03 (Atmospheric Fractionator)',
    EquipmentTagNo: 'RPTU-C-1010',
    EquipmentDescription: 'RPTU Product Fractionator Column',
    EquipmentType: 'Column',
    FormatIStatus: 'Not Issued',
    FormatIIStatus: 'Not Issued',
    FormatIIIStatus: 'Not Issued',
    InternalInspectionStatus: 'No',
    BaseLineUTG: 'No',
    FinalSystemAcceptance: 'Not accept',
    DocumentDrawing: 'NRL-RPTU-DW-1010 Rev.0',
  },

  // ============================================================================
  // 2. MSP (Motor Spirit Plant)
  // ============================================================================
  {
    Unit: 'MSP',
    SubUnit: '',
    SystemNo: 'MSP-SYS-01 (Reformer Reactor & Regeneration)',
    EquipmentTagNo: 'MSP-R-2101',
    EquipmentDescription: 'CCR Platforming Stacked Reactor',
    EquipmentType: 'Reactor',
    FormatIStatus: 'Issued',
    FormatIDate: '2026-01-15',
    FormatIIStatus: 'Issued',
    FormatIIDate: '2026-02-10',
    FormatIIIStatus: 'Issued',
    FormatIIIDate: '2026-03-01',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    PunchPointsCategoryClosed: 'A',
    FinalSystemAcceptance: 'Accept',
    DocumentDrawing: 'NRL-MSP-GA-2101 Rev.3',
    Remarks: 'Center pipe scallop screen & catalyst loading clearance signed.',
  },
  {
    Unit: 'MSP',
    SubUnit: '',
    SystemNo: 'MSP-SYS-02 (Penex Isomerization Loop)',
    EquipmentTagNo: 'MSP-C-2205',
    EquipmentDescription: 'Reformate Splitter Column',
    EquipmentType: 'Column',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Issued',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    FinalSystemAcceptance: 'Not accept',
    DocumentDrawing: 'NRL-MSP-GA-2205 Rev.1',
  },
  {
    Unit: 'MSP',
    SubUnit: '',
    SystemNo: 'MSP-SYS-03 (Naphtha Hydrotreater)',
    EquipmentTagNo: 'MSP-E-2012A',
    EquipmentDescription: 'Combined Feed / Effluent Heat Exchanger A',
    EquipmentType: 'Heat Exchanger',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Not Issued',
    FormatIIIStatus: 'Not Issued',
    InternalInspectionStatus: 'No',
    BaseLineUTG: 'No',
    FinalSystemAcceptance: 'Not accept',
    DocumentDrawing: 'NRL-MSP-EX-2012A Rev.0',
  },

  // ============================================================================
  // 3. PFCCU (Petrochemical Fluidized Catalytic Cracking Unit)
  // ============================================================================
  {
    Unit: 'PFCCU',
    SubUnit: '',
    SystemNo: 'PFCCU-SYS-01 (Converter & Riser System)',
    EquipmentTagNo: 'PFCCU-R-3101',
    EquipmentDescription: 'PFCCU Reactor-Regenerator Converter Assembly',
    EquipmentType: 'Reactor',
    FormatIStatus: 'Issued',
    FormatIDate: '2026-01-22',
    FormatIIStatus: 'Issued',
    FormatIIDate: '2026-02-18',
    FormatIIIStatus: 'Issued',
    FormatIIIDate: '2026-03-12',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    PunchPointsCategoryClosed: 'A',
    FinalSystemAcceptance: 'Accept',
    DocumentDrawing: 'NRL-PFCCU-GA-3101 Rev.2',
    Remarks: 'Cyclone diplegs, refractory dry-out and air distributor verified.',
  },
  {
    Unit: 'PFCCU',
    SubUnit: '',
    SystemNo: 'PFCCU-SYS-02 (Main Fractionator & Overhead)',
    EquipmentTagNo: 'PFCCU-C-3201',
    EquipmentDescription: 'PFCCU Main Fractionator Column',
    EquipmentType: 'Column',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Not Issued',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    FinalSystemAcceptance: 'Not accept',
    DocumentDrawing: 'NRL-PFCCU-GA-3201 Rev.1',
  },
  {
    Unit: 'PFCCU',
    SubUnit: '',
    SystemNo: 'PFCCU-SYS-03 (Gas Concentration Section)',
    EquipmentTagNo: 'PFCCU-K-3301',
    EquipmentDescription: 'Two-Stage Centrifugal Wet Gas Compressor',
    EquipmentType: 'Compressor',
    FormatIStatus: 'Not Issued',
    FormatIIStatus: 'Not Issued',
    FormatIIIStatus: 'Not Issued',
    InternalInspectionStatus: 'No',
    BaseLineUTG: 'No',
    FinalSystemAcceptance: 'Not accept',
    DocumentDrawing: 'NRL-PFCCU-CM-3301 Rev.0',
  },

  // ============================================================================
  // 4. CDU/VDU (Crude & Vacuum Distillation Unit)
  // ============================================================================
  {
    Unit: 'CDU/VDU',
    SubUnit: '',
    SystemNo: 'CDU-SYS-01 (Atmospheric Crude Column)',
    EquipmentTagNo: 'CDU-C-4101',
    EquipmentDescription: 'Atmospheric Crude Distillation Column',
    EquipmentType: 'Column',
    FormatIStatus: 'Issued',
    FormatIDate: '2026-01-10',
    FormatIIStatus: 'Issued',
    FormatIIDate: '2026-02-02',
    FormatIIIStatus: 'Issued',
    FormatIIIDate: '2026-02-25',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    PunchPointsCategoryClosed: 'A',
    FinalSystemAcceptance: 'Accept',
    DocumentDrawing: 'NRL-CDU-GA-4101 Rev.3',
    Remarks: 'All 48 valve trays and structured packing sections inspected and boxed up.',
  },
  {
    Unit: 'CDU/VDU',
    SubUnit: '',
    SystemNo: 'VDU-SYS-02 (Vacuum Column & Ejector)',
    EquipmentTagNo: 'VDU-C-4201',
    EquipmentDescription: 'Vacuum Distillation Column',
    EquipmentType: 'Column',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Issued',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    FinalSystemAcceptance: 'Not accept',
    DocumentDrawing: 'NRL-VDU-GA-4201 Rev.2',
  },
  {
    Unit: 'CDU/VDU',
    SubUnit: '',
    SystemNo: 'CDU-SYS-03 (Two-Stage Crude Desalter)',
    EquipmentTagNo: 'CDU-V-4105A',
    EquipmentDescription: 'First Stage Electrostatic Desalter Vessel',
    EquipmentType: 'Vessel',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Not Issued',
    InternalInspectionStatus: 'No',
    BaseLineUTG: 'No',
    FinalSystemAcceptance: 'Not accept',
    DocumentDrawing: 'NRL-CDU-VS-4105A Rev.1',
  },

  // ============================================================================
  // 5. DHDT (Diesel Hydrotreating Unit)
  // ============================================================================
  {
    Unit: 'DHDT',
    SubUnit: '',
    SystemNo: 'DHDT-SYS-01 (Hydrotreating Reactor Train)',
    EquipmentTagNo: 'DHDT-R-5101',
    EquipmentDescription: 'DHDT Main Hydrotreating Reactor',
    EquipmentType: 'Reactor',
    FormatIStatus: 'Issued',
    FormatIDate: '2026-01-20',
    FormatIIStatus: 'Issued',
    FormatIIDate: '2026-02-15',
    FormatIIIStatus: 'Issued',
    FormatIIIDate: '2026-03-05',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    PunchPointsCategoryClosed: 'A',
    FinalSystemAcceptance: 'Accept',
    DocumentDrawing: 'NRL-DHDT-GA-5101 Rev.2',
    Remarks: 'Quench zone distributor and thermowell nozzles verified.',
  },
  {
    Unit: 'DHDT',
    SubUnit: '',
    SystemNo: 'DHDT-SYS-02 (Product Stripper & Dryer)',
    EquipmentTagNo: 'DHDT-C-5201',
    EquipmentDescription: 'Diesel Product Stripper Column',
    EquipmentType: 'Column',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Not Issued',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    FinalSystemAcceptance: 'Not accept',
    DocumentDrawing: 'NRL-DHDT-GA-5201 Rev.1',
  },
  {
    Unit: 'DHDT',
    SubUnit: '',
    SystemNo: 'DHDT-SYS-03 (Recycle & Make-up H2 Gas)',
    EquipmentTagNo: 'DHDT-K-5301A',
    EquipmentDescription: 'Make-Up Hydrogen Reciprocating Compressor A',
    EquipmentType: 'Compressor',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Not Issued',
    FormatIIIStatus: 'Not Issued',
    InternalInspectionStatus: 'No',
    BaseLineUTG: 'No',
    FinalSystemAcceptance: 'Not accept',
    DocumentDrawing: 'NRL-DHDT-CM-5301A Rev.0',
  },

  // ============================================================================
  // 6. SRB (Sulfur Recovery Block)
  // ============================================================================
  {
    Unit: 'SRB',
    SubUnit: '',
    SystemNo: 'SRB-SYS-01 (Thermal Reactor & Waste Heat Boiler)',
    EquipmentTagNo: 'SRB-R-6101A',
    EquipmentDescription: 'Claus Main Reaction Furnace & WHB Train A',
    EquipmentType: 'Reactor / WHB',
    FormatIStatus: 'Issued',
    FormatIDate: '2026-02-01',
    FormatIIStatus: 'Issued',
    FormatIIDate: '2026-02-22',
    FormatIIIStatus: 'Issued',
    FormatIIIDate: '2026-03-15',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    PunchPointsCategoryClosed: 'A',
    FinalSystemAcceptance: 'Accept',
    DocumentDrawing: 'NRL-SRB-GA-6101A Rev.2',
    Remarks: 'Refractory lining holiday test and ferrule installation completed.',
  },
  {
    Unit: 'SRB',
    SubUnit: '',
    SystemNo: 'SRB-SYS-02 (Tail Gas Treating Unit)',
    EquipmentTagNo: 'SRB-C-6202',
    EquipmentDescription: 'Tail Gas Amine Absorber Column',
    EquipmentType: 'Column',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Not Issued',
    InternalInspectionStatus: 'No',
    BaseLineUTG: 'No',
    FinalSystemAcceptance: 'Not accept',
    DocumentDrawing: 'NRL-SRB-GA-6202 Rev.1',
  },

  // ============================================================================
  // 7. UTILITY -> Sub-Unit 1: DM-CPU
  // ============================================================================
  {
    Unit: 'UTILITY',
    SubUnit: 'DM-CPU',
    SystemNo: 'DM-CPU',
    EquipmentTagNo: '1U59-TT-4831',
    EquipmentDescription: 'Equalization Tank',
    EquipmentType: 'Tank',
    FormatIStatus: 'Issued',
    FormatIDate: '2025-08-21',
    FormatIIStatus: 'Issued',
    FormatIIDate: '2026-03-27',
    FormatIIIStatus: 'Issued',
    FormatIIIDate: '2026-04-23',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    PunchPointsCategoryClosed: 'A',
    FinalSystemAcceptance: 'Accept',
    DocumentDrawing: 'NRL-UTIL-DM-4831 Rev.2',
    Remarks: 'Hydrostatic test complete. Calibration certificate verified.',
  },
  {
    Unit: 'UTILITY',
    SubUnit: 'DM-CPU',
    SystemNo: 'DM-CPU',
    EquipmentTagNo: '1U59-TT-5133A',
    EquipmentDescription: 'Degasser Water Storage Tank A',
    EquipmentType: 'Tank',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Not Issued',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    FinalSystemAcceptance: 'Not accept',
    DocumentDrawing: 'NRL-UTIL-DM-5133A Rev.1',
  },
  {
    Unit: 'UTILITY',
    SubUnit: 'DM-CPU',
    SystemNo: 'DM-CPU',
    EquipmentTagNo: '1U59-TT-4633',
    EquipmentDescription: 'DM Water Storage Tank #1',
    EquipmentType: 'Tank',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Issued',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    FinalSystemAcceptance: 'Accept',
    DocumentDrawing: 'NRL-UTIL-DM-4633 Rev.2',
  },
  {
    Unit: 'UTILITY',
    SubUnit: 'DM-CPU',
    SystemNo: 'DM-CPU',
    EquipmentTagNo: '1U59-MB-4201A',
    EquipmentDescription: 'Condensate Polishing Mixed Bed Vessel A',
    EquipmentType: 'Vessel',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Not Issued',
    FormatIIIStatus: 'Not Issued',
    InternalInspectionStatus: 'No',
    BaseLineUTG: 'No',
    FinalSystemAcceptance: 'Not accept',
    DocumentDrawing: 'NRL-UTIL-DM-4201A Rev.0',
  },

  // ============================================================================
  // 7. UTILITY -> Sub-Unit 2: N2U
  // ============================================================================
  {
    Unit: 'UTILITY',
    SubUnit: 'N2U',
    SystemNo: 'N2U',
    EquipmentTagNo: '1U53-TK-201',
    EquipmentDescription: 'Liquid Nitrogen Cryogenic Storage Vessel',
    EquipmentType: 'Cryogenic Vessel',
    FormatIStatus: 'Issued',
    FormatIDate: '2026-02-11',
    FormatIIStatus: 'Issued',
    FormatIIDate: '2026-03-02',
    FormatIIIStatus: 'Issued',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    FinalSystemAcceptance: 'Accept',
    DocumentDrawing: 'NRL-UTIL-N2U-201 Rev.2',
    Remarks: 'Vacuum perlite insulation & cold box pressure test completed.',
  },
  {
    Unit: 'UTILITY',
    SubUnit: 'N2U',
    SystemNo: 'N2U',
    EquipmentTagNo: '1U53-CP-101A',
    EquipmentDescription: 'Main Air Separation Centrifugal Compressor A',
    EquipmentType: 'Compressor',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Not Issued',
    FormatIIIStatus: 'Not Issued',
    InternalInspectionStatus: 'No',
    BaseLineUTG: 'No',
    FinalSystemAcceptance: 'Not accept',
    DocumentDrawing: 'NRL-UTIL-N2U-101A Rev.1',
  },

  // ============================================================================
  // 7. UTILITY -> Sub-Unit 3: CA-IA
  // ============================================================================
  {
    Unit: 'UTILITY',
    SubUnit: 'CA-IA',
    SystemNo: 'CA-IA',
    EquipmentTagNo: '1U54-CP-301A',
    EquipmentDescription: 'Oil-Free Screw Instrument Air Compressor A',
    EquipmentType: 'Compressor',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Issued',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    FinalSystemAcceptance: 'Accept',
    DocumentDrawing: 'NRL-UTIL-CAIA-301A Rev.2',
  },
  {
    Unit: 'UTILITY',
    SubUnit: 'CA-IA',
    SystemNo: 'CA-IA',
    EquipmentTagNo: '1U54-AD-302A',
    EquipmentDescription: 'Heatless Regenerative Instrument Air Dryer A',
    EquipmentType: 'Air Dryer',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Not Issued',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    FinalSystemAcceptance: 'Not accept',
    DocumentDrawing: 'NRL-UTIL-CAIA-302A Rev.1',
  },

  // ============================================================================
  // 7. UTILITY -> Sub-Unit 4: BOILERS AND HRSG
  // ============================================================================
  {
    Unit: 'UTILITY',
    SubUnit: 'BOILERS AND HRSG',
    SystemNo: 'BOILERS AND HRSG',
    EquipmentTagNo: '1U51-DR-1001',
    EquipmentDescription: 'HP Steam Drum #1 (HRSG-1)',
    EquipmentType: 'Vessel',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Issued',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    FinalSystemAcceptance: 'Accept',
    DocumentDrawing: 'NRL-UTIL-BLR-1001 Rev.3',
  },
  {
    Unit: 'UTILITY',
    SubUnit: 'BOILERS AND HRSG',
    SystemNo: 'BOILERS AND HRSG',
    EquipmentTagNo: '1U51-PM-1021A',
    EquipmentDescription: 'Main Boiler Feed Water Pump A',
    EquipmentType: 'Pump',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Not Issued',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'No',
    FinalSystemAcceptance: 'Not accept',
    DocumentDrawing: 'NRL-UTIL-BLR-1021A Rev.1',
  },

  // ============================================================================
  // 7. UTILITY -> Sub-Unit 5: COOLING TOWER
  // ============================================================================
  {
    Unit: 'UTILITY',
    SubUnit: 'COOLING TOWER',
    SystemNo: 'COOLING TOWER',
    EquipmentTagNo: '1U52-CT-201A',
    EquipmentDescription: 'Induced Draft Cooling Tower Cell #1 Fan & Gearbox',
    EquipmentType: 'Cooling Tower',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Issued',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    FinalSystemAcceptance: 'Accept',
    DocumentDrawing: 'NRL-UTIL-CT-201A Rev.2',
  },
  {
    Unit: 'UTILITY',
    SubUnit: 'COOLING TOWER',
    SystemNo: 'COOLING TOWER',
    EquipmentTagNo: '1U52-PM-202A',
    EquipmentDescription: 'Cooling Water Vertical Turbine Circulation Pump A',
    EquipmentType: 'Pump',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Not Issued',
    FormatIIIStatus: 'Not Issued',
    InternalInspectionStatus: 'No',
    BaseLineUTG: 'No',
    FinalSystemAcceptance: 'Not accept',
    DocumentDrawing: 'NRL-UTIL-CT-202A Rev.0',
  },

  // ============================================================================
  // 7. UTILITY -> Sub-Unit 6: RWDU
  // ============================================================================
  {
    Unit: 'UTILITY',
    SubUnit: 'RWDU',
    SystemNo: 'RWDU',
    EquipmentTagNo: '1U55-CL-101',
    EquipmentDescription: 'Raw Water Desilting Clariflocculator Mechanism',
    EquipmentType: 'Clarifier',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Issued',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    FinalSystemAcceptance: 'Accept',
    DocumentDrawing: 'NRL-UTIL-RWDU-101 Rev.2',
  },
  {
    Unit: 'UTILITY',
    SubUnit: 'RWDU',
    SystemNo: 'RWDU',
    EquipmentTagNo: '1U55-PM-102A',
    EquipmentDescription: 'Desilted Water Transfer Pump A',
    EquipmentType: 'Pump',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Not Issued',
    InternalInspectionStatus: 'No',
    BaseLineUTG: 'No',
    FinalSystemAcceptance: 'Not accept',
    DocumentDrawing: 'NRL-UTIL-RWDU-102A Rev.1',
  },

  // ============================================================================
  // 7. UTILITY -> Sub-Unit 7: RW FILTER
  // ============================================================================
  {
    Unit: 'UTILITY',
    SubUnit: 'RW FILTER',
    SystemNo: 'RW FILTER',
    EquipmentTagNo: '1U56-FL-201A',
    EquipmentDescription: 'Dual Media Pressure Sand Filter Vessel A',
    EquipmentType: 'Filter Vessel',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Issued',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    FinalSystemAcceptance: 'Accept',
    DocumentDrawing: 'NRL-UTIL-RWF-201A Rev.2',
  },
  {
    Unit: 'UTILITY',
    SubUnit: 'RW FILTER',
    SystemNo: 'RW FILTER',
    EquipmentTagNo: '1U56-BL-203A',
    EquipmentDescription: 'Filter Backwash Air Scouring Blower A',
    EquipmentType: 'Blower',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Not Issued',
    FormatIIIStatus: 'Not Issued',
    InternalInspectionStatus: 'No',
    BaseLineUTG: 'No',
    FinalSystemAcceptance: 'Not accept',
    DocumentDrawing: 'NRL-UTIL-RWF-203A Rev.1',
  },

  // ============================================================================
  // 7. UTILITY -> Sub-Unit 8: RW RESERVOIR
  // ============================================================================
  {
    Unit: 'UTILITY',
    SubUnit: 'RW RESERVOIR',
    SystemNo: 'RW RESERVOIR',
    EquipmentTagNo: '1U57-PM-301A',
    EquipmentDescription: 'Raw Water Reservoir Vertical Intake Pump A',
    EquipmentType: 'Pump',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Issued',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    FinalSystemAcceptance: 'Accept',
    DocumentDrawing: 'NRL-UTIL-RWR-301A Rev.2',
  },
  {
    Unit: 'UTILITY',
    SubUnit: 'RW RESERVOIR',
    SystemNo: 'RW RESERVOIR',
    EquipmentTagNo: '1U57-TK-302',
    EquipmentDescription: 'Raw Water Reservoir Surge Protection Vessel',
    EquipmentType: 'Vessel',
    FormatIStatus: 'Issued',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Not Issued',
    InternalInspectionStatus: 'Yes',
    BaseLineUTG: 'Yes',
    FinalSystemAcceptance: 'Not accept',
    DocumentDrawing: 'NRL-UTIL-RWR-302 Rev.1',
  },
];
