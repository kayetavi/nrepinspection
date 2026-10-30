export interface EquipmentItem {
  id: string; // Document ID (usually EquipmentTagNo or auto ID)
  Unit: string;
  AreaPackage?: string;
  SystemNo: string;
  EquipmentTagNo: string;
  EquipmentDescription?: string;
  EquipmentType?: string;
  RFINo?: string;
  FormatIStatus?: string;
  FormatIDate?: string;
  FormatIIStatus?: string;
  FormatIIDate?: string;
  FormatIIIStatus?: string;
  FormatIIIDate?: string;
  CategoryAStatus?: string;
  InternalInspectionStatus?: string;
  MediaFillingClearance?: string;
  PunchPointsCategoryClosed?: string;
  FinalSystemAcceptance?: string;
  LastInspectionDate?: string;
  ResponsibleAgency?: string;
  Remarks?: string;
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

export const UNITS = [
  'Boilers & HRSG',
  'DM/CPU',
  'N2U',
  'CA/IA',
  'CT',
  'RWDU',
  'RW Filter Package',
  'Raw Water Reservoir',
  'FW Pump House',
  'ETP',
];

export const STATUS_COLUMNS: { key: keyof EquipmentItem; label: string; short: string }[] = [
  { key: 'FormatIStatus', label: 'Format-I Status', short: 'Format-I' },
  { key: 'FormatIIStatus', label: 'Format-II Status', short: 'Format-II' },
  { key: 'FormatIIIStatus', label: 'Format-III Status', short: 'Format-III' },
  { key: 'CategoryAStatus', label: 'Category-A Status', short: 'Cat-A' },
  { key: 'InternalInspectionStatus', label: 'Internal Inspection', short: 'Internal Insp.' },
  { key: 'MediaFillingClearance', label: 'Media Filling Clearance', short: 'Media Fill' },
  { key: 'FinalSystemAcceptance', label: 'Final System Acceptance', short: 'Final Accept.' },
];

export const STATUS_OPTIONS = [
  '',
  'Not Started',
  'Pending',
  'Received',
  'Issued',
  'Accepted',
  'Open',
  'Closed',
  'In Progress',
  'Completed',
  'Cleared',
  'On Hold',
  'Not Applicable',
];

export const DONE_KEYWORDS = ['received', 'issued', 'accepted', 'closed', 'completed', 'cleared'];
export const IN_PROGRESS_KEYWORDS = ['pending', 'open', 'in progress', 'on hold'];

export function isDone(status?: string): boolean {
  if (!status) return false;
  return DONE_KEYWORDS.includes(status.trim().toLowerCase());
}

export function isInProgress(status?: string): boolean {
  if (!status) return false;
  return IN_PROGRESS_KEYWORDS.includes(status.trim().toLowerCase());
}

export function getEquipmentOverallStatus(item: EquipmentItem): 'Completed' | 'In progress' | 'Not started' {
  if (item.FinalSystemAcceptance && item.FinalSystemAcceptance.trim().toLowerCase() === 'accepted') {
    return 'Completed';
  }
  const hasActiveStage = STATUS_COLUMNS.some((col) => {
    const val = (item[col.key] as string) || '';
    const lc = val.trim().toLowerCase();
    return lc !== '' && lc !== 'not started';
  });
  return hasActiveStage ? 'In progress' : 'Not started';
}

export function calculateProgress(items: EquipmentItem[]): number {
  let doneCount = 0;
  let totalApplicable = 0;

  items.forEach((item) => {
    STATUS_COLUMNS.forEach((col) => {
      const val = (item[col.key] as string) || '';
      const lc = val.trim().toLowerCase();
      if (lc === 'not applicable') return;
      totalApplicable++;
      if (isDone(lc)) doneCount++;
    });
  });

  return totalApplicable ? Math.round((doneCount / totalApplicable) * 100) : 0;
}

export const SAMPLE_EQUIPMENT_DATA: Omit<EquipmentItem, 'id'>[] = [
  {
    Unit: 'DM/CPU',
    AreaPackage: 'DM',
    SystemNo: '1U59-PRS-01 (Raw Water System)',
    EquipmentTagNo: '1U59-TT-4831',
    EquipmentDescription: 'Equalization Tank',
    EquipmentType: 'Tank',
    FormatIStatus: 'Received',
    FormatIDate: '2025-08-21',
    FormatIIStatus: 'Issued',
    FormatIIDate: '2026-03-27',
    FormatIIIStatus: 'Accepted',
    FormatIIIDate: '2026-04-23',
    CategoryAStatus: 'Closed',
    InternalInspectionStatus: 'Completed',
    MediaFillingClearance: 'Not Applicable',
    PunchPointsCategoryClosed: 'A',
    FinalSystemAcceptance: 'Pending',
    LastInspectionDate: '2026-04-23',
    ResponsibleAgency: 'Ion Exchange',
    Remarks: 'Hydrostatic test complete. Calibration certificate verified.',
  },
  {
    Unit: 'DM/CPU',
    AreaPackage: 'DM',
    SystemNo: '1U59-PRS-01 (Raw Water System)',
    EquipmentTagNo: '1U59-TT-5133A',
    EquipmentDescription: 'Degasser Water Storage Tank A',
    EquipmentType: 'Tank',
    FormatIStatus: 'Received',
    FormatIIStatus: 'Pending',
    CategoryAStatus: 'Open',
    InternalInspectionStatus: 'In Progress',
    MediaFillingClearance: 'Not Started',
    FinalSystemAcceptance: 'Pending',
    ResponsibleAgency: 'Ion Exchange',
  },
  {
    Unit: 'DM/CPU',
    AreaPackage: 'DM',
    SystemNo: '1U59-PRS-01 (Raw Water System)',
    EquipmentTagNo: '1U59-TT-5133B',
    EquipmentDescription: 'Degasser Water Storage Tank B',
    EquipmentType: 'Tank',
    FormatIStatus: 'Received',
    FormatIIStatus: 'Issued',
    CategoryAStatus: 'Closed',
    InternalInspectionStatus: 'Completed',
    FinalSystemAcceptance: 'Pending',
    ResponsibleAgency: 'Ion Exchange',
  },
  {
    Unit: 'DM/CPU',
    AreaPackage: 'DM',
    SystemNo: '1U59-PRS-01 (Raw Water System)',
    EquipmentTagNo: '1U59-TT-5133C',
    EquipmentDescription: 'Degasser Water Storage Tank C',
    EquipmentType: 'Tank',
    FormatIStatus: 'Not Started',
    FinalSystemAcceptance: 'Not Started',
    ResponsibleAgency: 'Ion Exchange',
  },
  {
    Unit: 'DM/CPU',
    AreaPackage: 'DM',
    SystemNo: '1U59-PRS-01 (Raw Water System)',
    EquipmentTagNo: '1U59-TT-5133D',
    EquipmentDescription: 'Degasser Water Storage Tank D',
    EquipmentType: 'Tank',
    FormatIStatus: 'Not Started',
    FinalSystemAcceptance: 'Not Started',
    ResponsibleAgency: 'Ion Exchange',
  },
  {
    Unit: 'DM/CPU',
    AreaPackage: 'DM',
    SystemNo: '1U59-PRS-02 (Chemical Storage)',
    EquipmentTagNo: '1U59-TT-8631',
    EquipmentDescription: 'BULK ACID STORAGE TANK',
    EquipmentType: 'Tank',
    FormatIStatus: 'Received',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Pending',
    CategoryAStatus: 'Closed',
    InternalInspectionStatus: 'Completed',
    ResponsibleAgency: 'Bridge & Roof',
  },
  {
    Unit: 'DM/CPU',
    AreaPackage: 'DM',
    SystemNo: '1U59-PRS-02 (Chemical Storage)',
    EquipmentTagNo: '1U59-TT-8731',
    EquipmentDescription: 'BULK ALKALI STORAGE TANK',
    EquipmentType: 'Tank',
    FormatIStatus: 'Received',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Accepted',
    FinalSystemAcceptance: 'Accepted',
    ResponsibleAgency: 'Bridge & Roof',
  },
  {
    Unit: 'DM/CPU',
    AreaPackage: 'DM',
    SystemNo: '1U59-PRS-03 (Treated Water)',
    EquipmentTagNo: '1U59-TT-4633',
    EquipmentDescription: 'DM WATER STORAGE TANK #1',
    EquipmentType: 'Tank',
    FormatIStatus: 'Received',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Accepted',
    InternalInspectionStatus: 'Completed',
    MediaFillingClearance: 'Cleared',
    FinalSystemAcceptance: 'Accepted',
    ResponsibleAgency: 'NRL / BHEL',
  },
  {
    Unit: 'DM/CPU',
    AreaPackage: 'DM',
    SystemNo: '1U59-PRS-03 (Treated Water)',
    EquipmentTagNo: '1U59-TT-4634',
    EquipmentDescription: 'DM WATER STORAGE TANK #2',
    EquipmentType: 'Tank',
    FormatIStatus: 'Received',
    FormatIIStatus: 'Issued',
    InternalInspectionStatus: 'In Progress',
    FinalSystemAcceptance: 'Pending',
    ResponsibleAgency: 'NRL / BHEL',
  },
  {
    Unit: 'Boilers & HRSG',
    AreaPackage: 'HRSG-1',
    SystemNo: '1U51-STM-01 (High Pressure Steam)',
    EquipmentTagNo: '1U51-DR-1001',
    EquipmentDescription: 'HP STEAM DRUM #1',
    EquipmentType: 'Vessel',
    FormatIStatus: 'Received',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Accepted',
    CategoryAStatus: 'Closed',
    InternalInspectionStatus: 'Completed',
    FinalSystemAcceptance: 'Accepted',
    ResponsibleAgency: 'L&T Energy',
  },
  {
    Unit: 'Boilers & HRSG',
    AreaPackage: 'HRSG-1',
    SystemNo: '1U51-STM-02 (Feedwater Loop)',
    EquipmentTagNo: '1U51-PM-1021A',
    EquipmentDescription: 'MAIN BOILER FEED PUMP A',
    EquipmentType: 'Pump',
    FormatIStatus: 'Received',
    FormatIIStatus: 'Issued',
    InternalInspectionStatus: 'Completed',
    FinalSystemAcceptance: 'Pending',
    ResponsibleAgency: 'KSB Pumps',
  },
  {
    Unit: 'N2U',
    AreaPackage: 'Air Separation',
    SystemNo: '1U53-NIT-01 (Cold Box & Liquid Storage)',
    EquipmentTagNo: '1U53-TK-201',
    EquipmentDescription: 'LIQUID NITROGEN STORAGE VESSEL',
    EquipmentType: 'Cryogenic Vessel',
    FormatIStatus: 'Received',
    FormatIIStatus: 'In Progress',
    CategoryAStatus: 'Open',
    FinalSystemAcceptance: 'Pending',
    ResponsibleAgency: 'Linde India',
  },
  {
    Unit: 'CA/IA',
    AreaPackage: 'Compressor House',
    SystemNo: '1U54-AIR-01 (Instrument Air Distribution)',
    EquipmentTagNo: '1U54-CP-301A',
    EquipmentDescription: 'OIL-FREE SCREW AIR COMPRESSOR A',
    EquipmentType: 'Compressor',
    FormatIStatus: 'Received',
    FormatIIStatus: 'Issued',
    FormatIIIStatus: 'Accepted',
    InternalInspectionStatus: 'Completed',
    FinalSystemAcceptance: 'Accepted',
    ResponsibleAgency: 'Atlas Copco',
  },
  {
    Unit: 'ETP',
    AreaPackage: 'Biological Treatment',
    SystemNo: '1U58-ETP-01 (Aeration & Clarifier)',
    EquipmentTagNo: '1U58-CL-401',
    EquipmentDescription: 'SECONDARY CLARIFIER DRIVE & RAKE',
    EquipmentType: 'Clarifier',
    FormatIStatus: 'Received',
    FormatIIStatus: 'Pending',
    InternalInspectionStatus: 'In Progress',
    FinalSystemAcceptance: 'Pending',
    ResponsibleAgency: 'Thermax Ltd',
  },
];
