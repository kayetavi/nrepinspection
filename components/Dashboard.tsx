'use client';

import React, { useMemo, useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useAuth } from '@/lib/auth-context';
import { useEquipment } from '@/lib/equipment-context';
import {
  EquipmentItem,
  UNITS,
  UTILITY_SUB_UNITS,
  STATUS_COLUMNS,
  STATUS_OPTIONS,
  isDone,
  isInProgress,
  getEquipmentOverallStatus,
  calculateProgress,
} from '@/lib/types';
import AdminPanel from './AdminPanel';
import EquipmentEditModal from './EquipmentEditModal';
import {
  Factory,
  Layers,
  Cpu,
  CheckCircle2,
  Clock,
  CircleDashed,
  TrendingUp,
  Calendar,
  Check,
  Search,
  X,
} from 'lucide-react';

type ViewLevel = 'p' | 'u' | 's' | 'e' | 'tools' | 'admin';

export default function Dashboard() {
  const {
    user,
    profile,
    isAdmin,
    isEditor,
    isApproved,
    setGuestMode,
    signOut,
    signInWithGoogle,
  } = useAuth();
  const {
    equipment,
    loading,
    error,
    updateEquipmentField,
    saveEquipment,
    deleteEquipment,
    importFromExcel,
    resetToSampleData,
  } = useEquipment();

  // Navigation route & hierarchy state
  const [viewLevel, setViewLevel] = useState<ViewLevel>('p');
  const [selectedUnitName, setSelectedUnitName] = useState<string | null>(null);
  const [selectedSystemName, setSelectedSystemName] = useState<string | null>(null);
  const [selectedEquipmentTag, setSelectedEquipmentTag] = useState<string | null>(null);

  // Drawer tree state (UTILITY and its first Sub-Unit DM-CPU expanded by default so the full revised hierarchy is immediately visible)
  const [treeOpen, setTreeOpen] = useState(false);
  const [treeFilter, setTreeFilter] = useState('');
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(() => new Set(['unit-1', 'unit-7']));
  const [expandedSystems, setExpandedSystems] = useState<Set<string>>(() => new Set(['system-7-1']));

  // Global search & drop-down
  const [globalSearch, setGlobalSearch] = useState('');
  const [showGlobalResults, setShowGlobalResults] = useState(false);
  const [searchBoxOpen, setSearchBoxOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // In-place direct equipment editing & Modals
  const [editingEquipment, setEditingEquipment] = useState<EquipmentItem | null>(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [excelNotice, setExcelNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // KPI expanded details drilldown
  const [kpiFilter, setKpiFilter] = useState<string | null>(null);
  const [kpiSearch, setKpiSearch] = useState('');

  // Table inner search filters
  const [systemSearch, setSystemSearch] = useState('');
  const [systemStatusFilter, setSystemStatusFilter] = useState('');
  const [tableSearch, setTableSearch] = useState('');

  // Unit-wise progress bar chart states
  const [unitSortBy, setUnitSortBy] = useState<'progress-desc' | 'progress-asc' | 'name' | 'pending-desc'>('progress-desc');
  const [unitMetricType, setUnitMetricType] = useState<'stage' | 'equip'>('stage');
  const [unitChartSearch, setUnitChartSearch] = useState('');
  const [unitChartLayout, setUnitChartLayout] = useState<'vertical-twin' | 'vertical-stacked'>('vertical-twin');
  const [hoveredUnitPillar, setHoveredUnitPillar] = useState<string | null>(null);

  // Hidden file input for Excel upload
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Return strictly to Home (Level 1 Project Overview)
  const goToHome = (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    try {
      if (typeof window !== 'undefined' && window.location.hash) {
        history.replaceState(null, '', window.location.pathname);
      }
    } catch (err) {}
    if (typeof window !== 'undefined') {
      window.location.hash = '';
    }
    setViewLevel('p');
    setSelectedUnitName(null);
    setSelectedSystemName(null);
    setSelectedEquipmentTag(null);
    setKpiFilter(null);
    setKpiSearch('');
    setTreeOpen(false);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      document.getElementById('main')?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Canonical 7 Units list: RPTU, MSP, PFCCU, CDU/VDU, DHDT, SRB, UTILITY
  const allUnitsList = useMemo(() => {
    return [...UNITS];
  }, []);

  // Tree data structure:
  // - 7 Top-Level Units: RPTU, MSP, PFCCU, CDU/VDU, DHDT, SRB, UTILITY
  // - First 6 Units (RPTU, MSP, PFCCU, CDU/VDU, DHDT, SRB): Equipment resides directly inside the Unit
  // - 7th Unit (UTILITY): 8 Sub-Units (DM-CPU, N2U, CA-IA, BOILERS AND HRSG, COOLING TOWER, RWDU, RW FILTER, RW RESERVOIR) -> Equipment resides inside each Sub-Unit
  const treeData = useMemo(() => {
    return allUnitsList.map((unitName, uIdx) => {
      const unitItems = equipment.filter((i) => i.Unit === unitName);

      if (unitName === 'UTILITY') {
        const subUnitsList = [...UTILITY_SUB_UNITS];
        unitItems.forEach((item) => {
          const su = item.SubUnit || item.AreaPackage || item.SystemNo;
          if (su && !subUnitsList.includes(su)) {
            subUnitsList.push(su);
          }
        });
        return {
          name: unitName,
          id: `unit-${uIdx + 1}`,
          items: unitItems,
          systems: subUnitsList.map((subName, sIdx) => ({
            name: subName,
            id: `system-${uIdx + 1}-${sIdx + 1}`,
            items: unitItems.filter(
              (i) => (i.SubUnit || i.AreaPackage || i.SystemNo) === subName
            ),
          })),
        };
      }

      const uniqueSystems = [...new Set(unitItems.map((i) => i.SystemNo).filter(Boolean))];
      return {
        name: unitName,
        id: `unit-${uIdx + 1}`,
        items: unitItems,
        systems: uniqueSystems.map((sysName, sIdx) => ({
          name: sysName,
          id: `system-${uIdx + 1}-${sIdx + 1}`,
          items: unitItems.filter((i) => i.SystemNo === sysName),
        })),
      };
    });
  }, [allUnitsList, equipment]);

  // Handle URL hash routing
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.slice(1);
      setKpiFilter(null);
      setKpiSearch('');
      document.getElementById('main')?.scrollTo({ top: 0, behavior: 'smooth' });

      // Default or empty hash always stays cleanly on Home (level 'p')
      if (!hash || hash === 'home' || hash === 'lg' || hash === 'login' || hash === '#') {
        setViewLevel('p');
        setSelectedUnitName(null);
        setSelectedSystemName(null);
        setSelectedEquipmentTag(null);
        return;
      }

      if (hash === 'tools') {
        setViewLevel('tools');
        setSelectedUnitName(null);
        setSelectedSystemName(null);
        setSelectedEquipmentTag(null);
        return;
      }

      if (hash === 'admin') {
        setViewLevel('admin');
        setSelectedUnitName(null);
        setSelectedSystemName(null);
        setSelectedEquipmentTag(null);
        return;
      }

      const unitMatch = hash.match(/^unit-(\d+)$/);
      if (unitMatch) {
        const u = treeData[parseInt(unitMatch[1], 10) - 1];
        if (u) {
          setViewLevel('u');
          setSelectedUnitName(u.name);
          setSelectedSystemName(null);
          setSelectedEquipmentTag(null);
          setExpandedUnits((prev) => new Set([...prev, u.id]));
          return;
        }
      }

      const sysMatch = hash.match(/^system-(\d+)-(\d+)$/);
      if (sysMatch) {
        const u = treeData[parseInt(sysMatch[1], 10) - 1];
        const s = u?.systems[parseInt(sysMatch[2], 10) - 1];
        if (u && s) {
          setViewLevel('s');
          setSelectedUnitName(u.name);
          setSelectedSystemName(s.name);
          setSelectedEquipmentTag(null);
          setExpandedUnits((prev) => new Set([...prev, u.id]));
          setExpandedSystems((prev) => new Set([...prev, s.id]));
          return;
        }
      }

      const eqMatch = hash.match(/^eq-(.+)$/);
      if (eqMatch) {
        const tag = decodeURIComponent(eqMatch[1]);
        const item = equipment.find((i) => i.EquipmentTagNo === tag || i.id === tag);
        if (item) {
          setViewLevel('e');
          setSelectedUnitName(item.Unit);
          setSelectedSystemName(item.Unit === 'UTILITY' ? (item.SubUnit || item.AreaPackage || item.SystemNo) : item.SystemNo);
          setSelectedEquipmentTag(item.EquipmentTagNo);
          return;
        }
      }

      // If unrecognized or invalid hash, default cleanly to Home
      setViewLevel('p');
      setSelectedUnitName(null);
      setSelectedSystemName(null);
      setSelectedEquipmentTag(null);
    };

    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [treeData, equipment]);

  // Click outside to close search dropdown and collapse empty search box
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target || !document.body.contains(target)) return;
      if (searchContainerRef.current && !searchContainerRef.current.contains(target)) {
        setShowGlobalResults(false);
        if (!searchInputRef.current?.value.trim()) {
          setSearchBoxOpen(false);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-focus search input when search box opens
  useEffect(() => {
    if (searchBoxOpen) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [searchBoxOpen]);

  // Scope equipment calculation
  const scopeItems = useMemo(() => {
    if (viewLevel === 'p') return equipment;
    if (viewLevel === 'u' && selectedUnitName) return equipment.filter((i) => i.Unit === selectedUnitName);
    if (viewLevel === 's' && selectedUnitName && selectedSystemName) {
      return equipment.filter((i) => {
        if (i.Unit !== selectedUnitName) return false;
        if (selectedUnitName === 'UTILITY') {
          return (i.SubUnit || i.AreaPackage || i.SystemNo) === selectedSystemName;
        }
        return i.SystemNo === selectedSystemName;
      });
    }
    return equipment;
  }, [viewLevel, selectedUnitName, selectedSystemName, equipment]);

  // Stats for the current scope
  const stats = useMemo(() => {
    const total = scopeItems.length;
    let completed = 0;
    let inProgress = 0;

    scopeItems.forEach((i) => {
      const st = getEquipmentOverallStatus(i);
      if (st === 'Completed') completed++;
      else if (st === 'In progress') inProgress++;
    });

    const notStarted = total - completed - inProgress;
    const progressPct = calculateProgress(scopeItems);

    return { total, completed, inProgress, notStarted, progressPct };
  }, [scopeItems]);

  // Live Date & Time tracker for Banner (updates when equipment changes or clock ticks)
  const [liveNow, setLiveNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setLiveNow(new Date());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const bannerLastUpdated = useMemo(() => {
    let latestMs = liveNow.getTime();
    equipment.forEach((item) => {
      if (item.updatedAt) {
        const parsed = Date.parse(item.updatedAt);
        if (!isNaN(parsed) && parsed > latestMs) {
          latestMs = parsed;
        }
      }
    });
    const d = new Date(latestMs);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = String(d.getDate()).padStart(2, '0');
    const mon = months[d.getMonth()];
    const yr = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return {
      dateStr: `${day} ${mon} ${yr}`,
      timeStr: `${hh}:${mm}`,
    };
  }, [equipment, liveNow]);

  // Professional KPI Card Renderer
  const renderProfessionalKpiCard = (opts: {
    label: string;
    value: string | number;
    subtext: string;
    pctBar?: number;
    badgeText?: string;
    theme: 'navy' | 'indigo' | 'cyan' | 'green' | 'amber' | 'slate' | 'blue';
    icon: React.ReactNode;
    active?: boolean;
    onClick?: () => void;
    title?: string;
  }) => {
    const palette: Record<
      typeof opts.theme,
      { accent: string; iconBg: string; iconColor: string; valueColor: string; barColor: string; badgeBg: string; badgeColor: string }
    > = {
      navy: {
        accent: '#0f2942',
        iconBg: '#eef2f6',
        iconColor: '#0f2942',
        valueColor: '#0f172a',
        barColor: '#0f2942',
        badgeBg: '#e2e8f0',
        badgeColor: '#1e293b',
      },
      indigo: {
        accent: '#1d4ed8',
        iconBg: '#eff6ff',
        iconColor: '#1d4ed8',
        valueColor: '#1e3a8a',
        barColor: '#2563eb',
        badgeBg: '#dbeafe',
        badgeColor: '#1d4ed8',
      },
      cyan: {
        accent: '#0369a1',
        iconBg: '#f0f9ff',
        iconColor: '#0284c7',
        valueColor: '#0c4a6e',
        barColor: '#0284c7',
        badgeBg: '#e0f2fe',
        badgeColor: '#0369a1',
      },
      green: {
        accent: '#16a34a',
        iconBg: '#dcfce7',
        iconColor: '#15803d',
        valueColor: '#15803d',
        barColor: '#16a34a',
        badgeBg: '#dcfce7',
        badgeColor: '#166534',
      },
      amber: {
        accent: '#d97706',
        iconBg: '#fef3c7',
        iconColor: '#b45309',
        valueColor: '#b45309',
        barColor: '#f59e0b',
        badgeBg: '#fef3c7',
        badgeColor: '#92400e',
      },
      slate: {
        accent: '#64748b',
        iconBg: '#f1f5f9',
        iconColor: '#475569',
        valueColor: '#334155',
        barColor: '#64748b',
        badgeBg: '#f1f5f9',
        badgeColor: '#475569',
      },
      blue: {
        accent: '#0284c7',
        iconBg: '#e0f2fe',
        iconColor: '#0284c7',
        valueColor: '#0369a1',
        barColor: '#0ea5e9',
        badgeBg: '#e0f2fe',
        badgeColor: '#0369a1',
      },
    };

    const p = palette[opts.theme];

    return (
      <button
        type="button"
        className={`k ${opts.active ? 'act' : ''}`}
        onClick={opts.onClick}
        title={opts.title}
        style={{
          borderTop: `3px solid ${p.accent}`,
          padding: '8px 11px 7px',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '4px',
          background: opts.active
            ? 'linear-gradient(180deg, #f0f9ff 0%, #e0f2fe 100%)'
            : 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
        }}
      >
        {/* Top Row: Label + Icon */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', width: '100%' }}>
          <span
            style={{
              fontSize: '9.5px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: '#526077',
              margin: 0,
              lineHeight: 1.15,
            }}
          >
            {opts.label}
          </span>
          <div
            style={{
              width: '22px',
              height: '22px',
              borderRadius: '5px',
              background: p.iconBg,
              color: p.iconColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {opts.icon}
          </div>
        </div>

        {/* Middle Row: Big Number + Optional Share Badge */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '4px', width: '100%' }}>
          <b
            style={{
              fontSize: '20px',
              fontWeight: 800,
              color: p.valueColor,
              lineHeight: 1.05,
              margin: 0,
              letterSpacing: '-0.02em',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {opts.value}
          </b>
          {opts.badgeText && (
            <span
              style={{
                fontSize: '9px',
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: '4px',
                background: p.badgeBg,
                color: p.badgeColor,
                textTransform: 'none',
                letterSpacing: 0,
              }}
            >
              {opts.badgeText}
            </span>
          )}
        </div>

        {/* Bottom Row: Mini Progress Bar + Subtext */}
        <div style={{ width: '100%' }}>
          {typeof opts.pctBar === 'number' && (
            <div
              style={{
                width: '100%',
                height: '3px',
                background: '#e2e8f0',
                borderRadius: '999px',
                overflow: 'hidden',
                marginBottom: '3px',
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, Math.max(0, opts.pctBar))}%`,
                  height: '100%',
                  background: p.barColor,
                  borderRadius: '999px',
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
          )}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '9.5px',
              color: opts.active ? '#0284c7' : '#64748b',
              fontWeight: opts.active ? 700 : 500,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            <span style={{ fontSize: '9.5px', textTransform: 'none', letterSpacing: 0, color: 'inherit', fontWeight: 'inherit' }}>
              {opts.subtext}
            </span>
            {opts.active && (
              <span style={{ fontSize: '8.5px', textTransform: 'uppercase', color: '#0284c7', fontWeight: 800 }}>
                ● Active
              </span>
            )}
          </div>
        </div>
      </button>
    );
  };

  // Current active unit & system objects
  const activeUnit = treeData.find((u) => u.name === selectedUnitName);
  const activeSystem = activeUnit?.systems.find((s) => s.name === selectedSystemName);
  const activeEquipment = equipment.find(
    (i) => i.EquipmentTagNo === selectedEquipmentTag || i.id === selectedEquipmentTag
  );

  // Stage-wise pending counts helper
  const getPendingStageCount = (items: EquipmentItem[], colKey: keyof EquipmentItem) => {
    return items.filter((r) => {
      const val = ((r[colKey] as string) || '').trim().toLowerCase();
      return val !== 'not applicable' && !isDone(val);
    }).length;
  };

  // Excel Upload Handler matching revised 18-column schema
  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { cellDates: true });
      const ws = wb.Sheets['Equipment Master'] || wb.Sheets[wb.SheetNames[0]];

      const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
      const headerIndex = aoa.findIndex((r) =>
        r && r.some((c: any) => String(c).trim().toLowerCase() === 'equipment tag no.')
      );

      if (headerIndex < 0) {
        throw new Error('Header row with "Equipment Tag No." not found.');
      }

      const headers: string[] = aoa[headerIndex].map((h) => String(h || '').trim());
      const tagIndex = headers.findIndex((h) => h.toLowerCase() === 'equipment tag no.');
      const docDrawIndex = headers.findIndex((h) => /^(document\s*\/?\s*drawing|drawing|document)/i.test(h));

      const rows: any[] = [];
      let curUnit = '';
      let curSys = '';

      for (let r = headerIndex + 1; r < aoa.length; r++) {
        const row = aoa[r];
        if (!row || !row[tagIndex]) continue;

        const obj: any = {};
        headers.forEach((k, c) => {
          if (!k || k === 'Sl. No.' || k === 'Punch Points Pending') return;
          let v = row[c];
          if (v == null || v === '') return;
          if (v instanceof Date) {
            v = new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
          }
          obj[k] = String(v).trim();
        });

        if (obj.Unit) curUnit = obj.Unit;
        else obj.Unit = curUnit || 'Unassigned';

        if (obj['System No.']) curSys = obj['System No.'];
        else obj['System No.'] = curSys || 'System not assigned';

        // Support hyperlinks on Document/Drawing cell or Equipment Tag No. cell
        const docCell = docDrawIndex >= 0 ? ws[XLSX.utils.encode_cell({ r, c: docDrawIndex })] : null;
        const tagCell = ws[XLSX.utils.encode_cell({ r, c: tagIndex })];
        if (docCell && docCell.l && docCell.l.Target && !obj['Document/Drawing']) {
          obj['Document/Drawing'] = docCell.l.Target;
        } else if (tagCell && tagCell.l && tagCell.l.Target && !obj['Document/Drawing']) {
          obj['Document/Drawing'] = tagCell.l.Target;
        }

        rows.push(obj);
      }

      const res = await importFromExcel(rows);
      setExcelNotice({
        type: 'ok',
        text: `${rows.length} equipment loaded and synced with Cloud Firestore! (${res.added} added, ${res.updated} updated)`,
      });
    } catch (err: any) {
      setExcelNotice({
        type: 'err',
        text: 'Upload failed: ' + (err.message || 'Invalid Excel file'),
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Excel Download Handler (Revised 18 Columns — removed Area/Package, RFI No., Category-A Status, Media Filling Clearance, Last Inspection Date, Responsible Agency/Person, Link; added Base Line UTG & Document/Drawing)
  const handleExcelDownload = () => {
    const H = [
      'Unit',
      'Sub-Unit',
      'System No.',
      'Equipment Tag No.',
      'Equipment Description',
      'Equipment Type',
      'Format-I Status',
      'Format-I Date',
      'Format-II Status',
      'Format-II Date',
      'Format-III Status',
      'Format-III Date',
      'Internal Inspection Status',
      'Base Line UTG',
      'Punch Points Category Closed',
      'Final System Acceptance',
      'Document/Drawing',
      'Remarks',
    ];

    const data = equipment.map((r) => [
      r.Unit || '',
      r.Unit === 'UTILITY' ? (r.SubUnit || r.SystemNo || '') : '',
      r.SystemNo || '',
      r.EquipmentTagNo || '',
      r.EquipmentDescription || '',
      r.EquipmentType || '',
      r.FormatIStatus || '',
      r.FormatIDate || '',
      r.FormatIIStatus || '',
      r.FormatIIDate || '',
      r.FormatIIIStatus || '',
      r.FormatIIIDate || '',
      r.InternalInspectionStatus || '',
      r.BaseLineUTG || '',
      r.PunchPointsCategoryClosed || '',
      r.FinalSystemAcceptance || '',
      r.DocumentDrawing || '',
      r.Remarks || '',
    ]);

    const ws = XLSX.utils.aoa_to_sheet([['NREP EQUIPMENT MASTER LIST'], H, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Equipment Master');
    XLSX.writeFile(wb, 'NREP_Inspection_Equipment_Tracker_updated.xlsx');
  };

  // Excel Template Download Handler (Revised 18 Columns)
  const handleDownloadTemplate = () => {
    const H = [
      'Unit',
      'Sub-Unit',
      'System No.',
      'Equipment Tag No.',
      'Equipment Description',
      'Equipment Type',
      'Format-I Status',
      'Format-I Date',
      'Format-II Status',
      'Format-II Date',
      'Format-III Status',
      'Format-III Date',
      'Internal Inspection Status',
      'Base Line UTG',
      'Punch Points Category Closed',
      'Final System Acceptance',
      'Document/Drawing',
      'Remarks',
    ];

    const sampleRows = [
      [
        'RPTU',
        '',
        'RPTU-SYS-01',
        'RPTU-R-1001A',
        'RPTU Ebullated Bed Reactor #1',
        'Reactor',
        'Issued',
        '2026-01-12',
        'Issued',
        '2026-02-05',
        'Issued',
        '2026-02-20',
        'Yes',
        'Yes',
        'A',
        'Accept',
        'NRL-RPTU-GA-1001A Rev.2',
        'Internal inspection completed',
      ],
      [
        'UTILITY',
        'DM-CPU',
        'DM-CPU',
        '1U59-TT-4831',
        'Equalization Tank',
        'Tank',
        'Issued',
        '2025-08-21',
        'Issued',
        '2026-03-27',
        'Issued',
        '2026-04-23',
        'Yes',
        'Yes',
        'A',
        'Accept',
        'NRL-UTIL-DM-4831 Rev.2',
        'Hydrostatic test complete',
      ],
    ];

    const ws = XLSX.utils.aoa_to_sheet([['NREP EQUIPMENT LIST - TEMPLATE (Units: RPTU, MSP, PFCCU, CDU/VDU, DHDT, SRB, UTILITY)'], H, ...sampleRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Equipment Master');
    XLSX.writeFile(wb, 'NREP_Equipment_Upload_Template.xlsx');
  };

  // Search Results Filtering
  const globalSearchResults = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    if (q.length < 1) return null;

    const matchedUnits = treeData.filter((u) => u.name.toLowerCase().includes(q)).slice(0, 5);
    const matchedSystems = treeData
      .flatMap((u) => u.systems.map((s) => ({ u, s })))
      .filter((x) => x.s.name.toLowerCase().includes(q))
      .slice(0, 6);
    const matchedEquipment = equipment.filter((eq) =>
      Object.values(eq).join(' ').toLowerCase().includes(q)
    );

    return { matchedUnits, matchedSystems, matchedEquipment };
  }, [globalSearch, treeData, equipment]);

  // Donut Ring Chart SVG
  const renderDonutChart = (s: {
    total: number;
    completed: number;
    inProgress: number;
    notStarted: number;
    progressPct?: number;
  }) => {
    const t = s.total || 1;
    const slices = [
      { val: s.completed, color: 'var(--gr)' },
      { val: s.inProgress, color: 'var(--am)' },
      { val: s.notStarted, color: 'var(--bd)' },
    ];

    let accumulated = 0;
    const circleElements = slices.map((sl, idx) => {
      const len = (sl.val / t) * 100;
      const el = (
        <circle
          key={idx}
          r="15.9155"
          cx="18"
          cy="18"
          fill="none"
          stroke={sl.color}
          strokeWidth="5"
          strokeDasharray={`${len} ${100 - len}`}
          strokeDashoffset={-accumulated}
        />
      );
      accumulated += len;
      return el;
    });

    const displayPct = s.progressPct !== undefined ? s.progressPct : Math.round((s.completed / t) * 100);

    return (
      <>
        <div className="dn">
          <svg viewBox="0 0 36 36" width="140" height="140">
            <g transform="rotate(-90 18 18)">{circleElements}</g>
            <text x="18" y="19" textAnchor="middle" fontSize="6" fontWeight="700" fill="currentColor">
              {displayPct}%
            </text>
            <text x="18" y="23.5" textAnchor="middle" fontSize="2.2" fill="currentColor">
              stage progress
            </text>
          </svg>
          <div className="dl">
            <div>
              <b>{s.completed}</b>Completed (100%)
            </div>
            <div>
              <b>{s.inProgress}</b>In progress
            </div>
            <div>
              <b>{s.notStarted}</b>Not started (0%)
            </div>
          </div>
        </div>
        <div className="lg">
          <span>
            <i style={{ background: 'var(--gr)' }}></i>Completed
          </span>
          <span>
            <i style={{ background: 'var(--am)' }}></i>In progress
          </span>
          <span>
            <i style={{ background: 'var(--bd)' }}></i>Not started
          </span>
        </div>
      </>
    );
  };

  // Stage-wise horizontal bars
  const renderStageWiseBars = (items: EquipmentItem[]) => {
    const t = items.length || 1;

    return (
      <>
        {STATUS_COLUMNS.map((col) => {
          let done = 0;
          let pending = 0;

          items.forEach((r) => {
            const val = (r[col.key] as string) || '';
            if (isDone(val)) done++;
            else pending++;
          });

          const pct = items.length ? Math.round((done / t) * 100) : 0;

          return (
            <div key={col.key} className="sr">
              <span title={`${col.label} (${col.doneValue} / ${col.pendingValue})`}>{col.short}</span>
              <div className="sb">
                {done > 0 && (
                  <i
                    title={`${col.doneValue}: ${done} (${pct}%)`}
                    style={{ width: `${(done / t) * 100}%`, background: 'var(--gr)' }}
                  />
                )}
                {pending > 0 && (
                  <i
                    title={`${col.pendingValue}: ${pending} (${100 - pct}%)`}
                    style={{ width: `${(pending / t) * 100}%`, background: 'var(--am)' }}
                  />
                )}
              </div>
              <b style={{ minWidth: '58px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {done}/{items.length} ({pct}%)
              </b>
            </div>
          );
        })}
        <div className="lg">
          <span>
            <i style={{ background: 'var(--gr)' }}></i>Done (Issued / Yes / Accept)
          </span>
          <span>
            <i style={{ background: 'var(--am)' }}></i>Pending (Not Issued / No / Not accept)
          </span>
        </div>
      </>
    );
  };

  // Segmented bar for matrix table rows showing exact dropdown-calculated progress %
  const renderMiniProgressBar = (items: EquipmentItem[]) => {
    const pct = calculateProgress(items);
    const remPct = Math.max(0, 100 - pct);

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 800,
            minWidth: '34px',
            textAlign: 'right',
            color: pct === 100 ? '#15803d' : pct > 0 ? '#0369a1' : '#64748b',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {pct}%
        </span>
        <div className="sb" style={{ flex: 1 }}>
          {pct > 0 && (
            <i
              title={`Completed Stages: ${pct}%`}
              style={{ width: `${pct}%`, background: 'var(--gr)' }}
            />
          )}
          {remPct > 0 && (
            <i
              title={`Pending Stages: ${remPct}%`}
              style={{ width: `${remPct}%`, background: pct > 0 ? 'var(--am)' : 'var(--sl)' }}
            />
          )}
        </div>
      </div>
    );
  };

  // Helper pill for percentage
  const renderPill = (items: EquipmentItem[]) => {
    if (!items.length) return <span className="pl">–</span>;
    const p = calculateProgress(items);
    return <span className={`pl ${p === 100 ? 'g' : p > 0 ? 'a' : ''}`}>{p}%</span>;
  };

  // Helper chip for equipment status
  const renderStatusChip = (status?: string) => {
    if (!status) return <span className="c">Not started</span>;
    const done = isDone(status);
    const prog = isInProgress(status);
    return <span className={`c ${done ? 'g' : prog ? 'a' : ''}`}>{status}</span>;
  };

  // Helper renderer for Document/Drawing column (supports drawing numbers, document refs, or URLs)
  const renderDocumentDrawing = (docVal?: string) => {
    const val = (docVal || '').trim();
    if (!val) return <span style={{ color: 'var(--mu)' }}>—</span>;
    if (/^https?:\/\//i.test(val)) {
      return (
        <a
          href={val}
          target="_blank"
          rel="noopener noreferrer"
          title={val}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontWeight: 600,
            fontSize: '11px',
            color: 'var(--ac)',
          }}
        >
          📄 Open Doc/Drawing ↗
        </a>
      );
    }
    return (
      <span
        title={val}
        style={{
          display: 'inline-block',
          fontSize: '11px',
          fontWeight: 600,
          color: '#0f172a',
          background: '#f1f5f9',
          border: '1px solid #cbd5e1',
          padding: '2px 6px',
          borderRadius: '4px',
          maxWidth: '190px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        📄 {val}
      </span>
    );
  };

  // Unit-wise Progress & Completion Bar Chart (Kitna Hua vs Kitna Baki)
  const renderUnitWiseProgressBarChart = () => {
    const filtered = treeData.filter((u) => !unitChartSearch || u.name.toLowerCase().includes(unitChartSearch.toLowerCase()));

    const unitStats = filtered.map((u) => {
      // Stage metrics
      let totalApplicableStages = 0;
      let doneStages = 0;
      let openStages = 0;
      let notStartedStages = 0;
      u.items.forEach((item) => {
        STATUS_COLUMNS.forEach((col) => {
          const val = ((item[col.key] as string) || '').trim().toLowerCase();
          if (val === 'not applicable') return;
          totalApplicableStages++;
          if (!val || val === 'not started') notStartedStages++;
          else if (isDone(val)) doneStages++;
          else openStages++;
        });
      });
      const stageDonePct = totalApplicableStages ? Math.round((doneStages / totalApplicableStages) * 100) : 0;
      const stageOpenPct = totalApplicableStages ? Math.round((openStages / totalApplicableStages) * 100) : 0;
      const stageNotStartedPct = Math.max(0, 100 - stageDonePct - stageOpenPct);
      const stageBakiPct = 100 - stageDonePct;
      const stageBakiCount = totalApplicableStages - doneStages;

      // Equipment metrics
      const totalEq = u.items.length || 1;
      let completedEq = 0;
      let inProgEq = 0;
      u.items.forEach((r) => {
        const st = getEquipmentOverallStatus(r);
        if (st === 'Completed') completedEq++;
        else if (st === 'In progress') inProgEq++;
      });
      const notStartedEq = u.items.length - completedEq - inProgEq;
      const eqDonePct = Math.round((completedEq / totalEq) * 100);
      const eqInProgPct = Math.round((inProgEq / totalEq) * 100);
      const eqNotStartedPct = Math.max(0, 100 - eqDonePct - eqInProgPct);
      const eqBakiPct = 100 - eqDonePct;
      const eqBakiCount = u.items.length - completedEq;

      const isStage = unitMetricType === 'stage';
      const donePct = isStage ? stageDonePct : eqDonePct;
      const inProgPct = isStage ? stageOpenPct : eqInProgPct;
      const notStartedPct = isStage ? stageNotStartedPct : eqNotStartedPct;
      const bakiPct = isStage ? stageBakiPct : eqBakiPct;
      const doneCount = isStage ? doneStages : completedEq;
      const inProgCount = isStage ? openStages : inProgEq;
      const notStartedCount = isStage ? notStartedStages : notStartedEq;
      const bakiCount = isStage ? stageBakiCount : eqBakiCount;
      const totalCount = isStage ? totalApplicableStages : u.items.length;

      return {
        unit: u,
        donePct,
        inProgPct,
        notStartedPct,
        bakiPct,
        doneCount,
        inProgCount,
        notStartedCount,
        bakiCount,
        totalCount,
        stageDonePct,
        stageBakiPct,
        completedEq,
        bakiEq: eqBakiCount,
        totalEq: u.items.length,
      };
    });

    unitStats.sort((a, b) => {
      if (unitSortBy === 'progress-desc') return b.donePct - a.donePct;
      if (unitSortBy === 'progress-asc') return a.donePct - b.donePct;
      if (unitSortBy === 'pending-desc') return b.bakiPct - a.bakiPct;
      return a.unit.name.localeCompare(b.unit.name);
    });

    const pillarAreaHeight = 156;
    const topLabelHeadroom = 18;

    return (
      <div className="cd" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        {/* Card Header with Title, Layout Switcher, Metric Switcher, and Sort */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
            marginBottom: '10px',
            borderBottom: '1px solid var(--bd)',
            paddingBottom: '8px',
          }}
        >
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: '12.5px',
                fontWeight: 700,
                color: 'var(--tx)',
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '6px',
                textTransform: 'none',
                letterSpacing: '0.2px',
              }}
            >
              <span>📊 Unit-Wise Vertical Pillar Chart</span>
              <span
                style={{
                  fontSize: '10.5px',
                  fontWeight: 600,
                  color: 'var(--ac)',
                  background: 'var(--tr)',
                  border: '1px solid var(--bd)',
                  padding: '1px 7px',
                  borderRadius: '12px',
                }}
              >
                Completed vs Remaining
              </span>
            </h3>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {/* View Layout Toggle: Vertical Pillars (Default) vs Stacked Pillar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: 'var(--tr)',
                padding: '2px',
                borderRadius: '6px',
                border: '1px solid var(--bd)',
                gap: '2px',
              }}
            >
              <button
                type="button"
                onClick={() => setUnitChartLayout('vertical-twin')}
                style={{
                  padding: '3px 7px',
                  fontSize: '11px',
                  fontWeight: unitChartLayout === 'vertical-twin' ? 700 : 500,
                  background: unitChartLayout === 'vertical-twin' ? 'var(--ac)' : 'transparent',
                  color: unitChartLayout === 'vertical-twin' ? '#fff' : 'var(--tx)',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  transition: 'all 0.15s ease',
                }}
                title="Vertical Side-by-Side Pillars: Completed vs Remaining"
              >
                <span>🏛️</span>
                <span>Pillars</span>
              </button>

              <button
                type="button"
                onClick={() => setUnitChartLayout('vertical-stacked')}
                style={{
                  padding: '3px 7px',
                  fontSize: '11px',
                  fontWeight: unitChartLayout === 'vertical-stacked' ? 700 : 500,
                  background: unitChartLayout === 'vertical-stacked' ? 'var(--ac)' : 'transparent',
                  color: unitChartLayout === 'vertical-stacked' ? '#fff' : 'var(--tx)',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  transition: 'all 0.15s ease',
                }}
                title="Vertical Stacked 100% Pillar"
              >
                <span>📊</span>
                <span>Stacked</span>
              </button>
            </div>

            <input
              type="text"
              placeholder="🔍 Unit..."
              value={unitChartSearch}
              onChange={(e) => setUnitChartSearch(e.target.value)}
              style={{
                padding: '3px 7px',
                fontSize: '11px',
                width: '90px',
                borderRadius: '4px',
                border: '1px solid var(--bd)',
              }}
            />

            <select
              value={unitMetricType}
              onChange={(e) => setUnitMetricType(e.target.value as any)}
              title="Select metric"
              style={{
                padding: '3px 6px',
                fontSize: '11px',
                borderRadius: '4px',
                border: '1px solid var(--bd)',
                background: 'var(--cd)',
              }}
            >
              <option value="stage">Stage %</option>
              <option value="equip">Equip %</option>
            </select>

            <select
              value={unitSortBy}
              onChange={(e) => setUnitSortBy(e.target.value as any)}
              title="Sort units"
              style={{
                padding: '3px 6px',
                fontSize: '11px',
                borderRadius: '4px',
                border: '1px solid var(--bd)',
                background: 'var(--cd)',
              }}
            >
              <option value="progress-desc">Done ↓</option>
              <option value="progress-asc">Done ↑</option>
              <option value="pending-desc">Pending ↓</option>
              <option value="name">A-Z</option>
            </select>
          </div>
        </div>

        {/* MAIN CHART BODY */}
        {unitStats.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px', color: 'var(--mu)', fontSize: '13px', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            No matching units found.
          </div>
        ) : (
          /* VERTICAL PILLAR / COLUMN CHART */
          <div
            style={{
              background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)',
              border: '1px solid var(--bd)',
              borderRadius: '8px',
              padding: '10px 10px 10px 6px',
              position: 'relative',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            {/* Container with Y-Axis and Columns */}
            <div
              style={{
                display: 'flex',
                overflowX: 'auto',
                paddingBottom: '4px',
                position: 'relative',
              }}
            >
              {/* Left Y-Axis */}
              <div
                style={{
                  width: '36px',
                  minWidth: '36px',
                  marginTop: `${topLabelHeadroom}px`,
                  height: `${pillarAreaHeight}px`,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  alignItems: 'flex-end',
                  paddingRight: '6px',
                  borderRight: '2px solid var(--bd)',
                  fontSize: '10px',
                  fontWeight: 600,
                  color: 'var(--mu)',
                  userSelect: 'none',
                  lineHeight: 1,
                }}
              >
                <span>100%</span>
                <span>75%</span>
                <span>50%</span>
                <span>25%</span>
                <span>0%</span>
              </div>

              {/* Chart Plot Area with Grid Lines and Vertical Pillars */}
              <div
                style={{
                  position: 'relative',
                  flex: 1,
                  minWidth: `${Math.max(420, unitStats.length * (unitChartLayout === 'vertical-twin' ? 54 : 46))}px`,
                }}
              >
                {/* Horizontal Dashed Grid Lines aligned with Y-Axis marks */}
                <div
                  style={{
                    position: 'absolute',
                    top: `${topLabelHeadroom}px`,
                    left: 0,
                    right: 0,
                    height: '1px',
                    borderTop: '1px dashed var(--bd)',
                    pointerEvents: 'none',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: `${topLabelHeadroom + pillarAreaHeight * 0.25}px`,
                    left: 0,
                    right: 0,
                    height: '1px',
                    borderTop: '1px dashed var(--bd)',
                    pointerEvents: 'none',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: `${topLabelHeadroom + pillarAreaHeight * 0.5}px`,
                    left: 0,
                    right: 0,
                    height: '1px',
                    borderTop: '1px dashed var(--bd)',
                    pointerEvents: 'none',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: `${topLabelHeadroom + pillarAreaHeight * 0.75}px`,
                    left: 0,
                    right: 0,
                    height: '1px',
                    borderTop: '1px dashed var(--bd)',
                    pointerEvents: 'none',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: `${topLabelHeadroom + pillarAreaHeight}px`,
                    left: 0,
                    right: 0,
                    height: '2px',
                    borderTop: '2px solid var(--bd)',
                    pointerEvents: 'none',
                  }}
                />

                {/* Vertical Pillars Track */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    height: `${topLabelHeadroom + pillarAreaHeight}px`,
                    padding: '0 6px',
                    gap: '6px',
                    position: 'relative',
                    zIndex: 2,
                  }}
                >
                  {unitStats.map((item, idx) => {
                    const doneHeight = Math.max(4, Math.round((item.donePct / 100) * pillarAreaHeight));
                    const bakiHeight = Math.max(4, Math.round((item.bakiPct / 100) * pillarAreaHeight));
                    const isHovered = hoveredUnitPillar === item.unit.id;
                    const showTooltipOnLeft = unitStats.length > 2 && idx >= Math.ceil(unitStats.length / 2);

                    return (
                      <div
                        key={item.unit.id}
                        onMouseEnter={() => setHoveredUnitPillar(item.unit.id)}
                        onMouseLeave={() => setHoveredUnitPillar(null)}
                        style={{
                          flex: '1 1 0px',
                          maxWidth: '88px',
                          minWidth: unitChartLayout === 'vertical-twin' ? '48px' : '40px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          height: '100%',
                          position: 'relative',
                          zIndex: isHovered ? 60 : 1,
                          cursor: 'pointer',
                          background: isHovered ? 'rgba(20, 89, 143, 0.08)' : 'transparent',
                          borderRadius: '6px 6px 0 0',
                          padding: '0 2px',
                          transition: 'background 0.15s ease',
                        }}
                        onClick={() => {
                          if (typeof window !== 'undefined') {
                            window.location.hash = item.unit.id;
                          }
                        }}
                      >
                        {/* Interactive Hover Tooltip Popover - Positioned cleanly inside chart viewport */}
                        {isHovered && (
                          <div
                            style={{
                              position: 'absolute',
                              top: '14px',
                              ...(showTooltipOnLeft
                                ? { right: 'calc(100% + 6px)', left: 'auto' }
                                : { left: 'calc(100% + 6px)', right: 'auto' }),
                              background: '#0f172a',
                              color: '#fff',
                              borderRadius: '7px',
                              padding: '8px 11px',
                              fontSize: '11px',
                              lineHeight: '1.45',
                              boxShadow: '0 10px 25px -4px rgba(15, 23, 42, 0.55), 0 4px 10px -2px rgba(15, 23, 42, 0.3)',
                              zIndex: 200,
                              whiteSpace: 'nowrap',
                              pointerEvents: 'none',
                              border: '1px solid rgba(56, 189, 248, 0.35)',
                            }}
                          >
                            <div
                              style={{
                                fontWeight: 700,
                                fontSize: '12px',
                                marginBottom: '4px',
                                color: '#38bdf8',
                                borderBottom: '1px solid rgba(255,255,255,0.12)',
                                paddingBottom: '3px',
                              }}
                            >
                              {item.unit.name}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginBottom: '2px' }}>
                              <span style={{ color: '#4ade80' }}>● Completed:</span>
                              <b>{item.donePct}% ({item.doneCount}/{item.totalCount})</b>
                            </div>
                            {item.inProgPct > 0 && (
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginBottom: '2px' }}>
                                <span style={{ color: '#facc15' }}>● In Progress:</span>
                                <b>{item.inProgPct}% ({item.inProgCount})</b>
                              </div>
                            )}
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginBottom: '4px' }}>
                              <span style={{ color: '#f87171' }}>● Remaining:</span>
                              <b>{item.bakiPct}% ({item.bakiCount})</b>
                            </div>
                            <div
                              style={{
                                fontSize: '10px',
                                color: '#cbd5e1',
                                borderTop: '1px solid rgba(255,255,255,0.14)',
                                paddingTop: '3px',
                              }}
                            >
                              Equipment: <b>{item.completedEq}/{item.totalEq}</b> done · Click to open
                            </div>
                          </div>
                        )}

                        {unitChartLayout === 'vertical-twin' ? (
                          /* TWIN VERTICAL PILLARS (COMPLETED vs REMAINING) */
                          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '100%' }}>
                            {/* 1. Completed Pillar (Green) */}
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'flex-end',
                                height: '100%',
                              }}
                            >
                              <span
                                style={{
                                  fontSize: '9.5px',
                                  fontWeight: 800,
                                  color: item.donePct > 0 ? 'var(--gr)' : 'var(--mu)',
                                  marginBottom: '3px',
                                  lineHeight: 1,
                                }}
                              >
                                {item.donePct}%
                              </span>
                              <div
                                style={{
                                  width: '18px',
                                  height: `${doneHeight}px`,
                                  background:
                                    item.donePct === 0
                                      ? '#cbd5e1'
                                      : 'linear-gradient(180deg, #22c55e 0%, #15803d 100%)',
                                  borderRadius: '3px 3px 0 0',
                                  boxShadow:
                                    item.donePct > 0 && isHovered
                                      ? '0 0 8px rgba(34, 197, 94, 0.55)'
                                      : item.donePct > 0
                                      ? '0 1px 3px rgba(21, 128, 61, 0.25)'
                                      : 'none',
                                  transition: 'height 0.3s ease, box-shadow 0.15s ease',
                                }}
                              />
                            </div>

                            {/* 2. Remaining Pillar (Red / Coral) */}
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'flex-end',
                                height: '100%',
                              }}
                            >
                              <span
                                style={{
                                  fontSize: '9.5px',
                                  fontWeight: 800,
                                  color: item.bakiPct === 0 ? 'var(--mu)' : '#dc2626',
                                  marginBottom: '3px',
                                  lineHeight: 1,
                                }}
                              >
                                {item.bakiPct}%
                              </span>
                              <div
                                style={{
                                  width: '18px',
                                  height: `${bakiHeight}px`,
                                  background:
                                    item.bakiPct === 0
                                      ? '#cbd5e1'
                                      : 'linear-gradient(180deg, #f87171 0%, #dc2626 100%)',
                                  borderRadius: '3px 3px 0 0',
                                  boxShadow:
                                    item.bakiPct > 0 && isHovered
                                      ? '0 0 8px rgba(220, 38, 38, 0.55)'
                                      : item.bakiPct > 0
                                      ? '0 1px 3px rgba(220, 38, 38, 0.25)'
                                      : 'none',
                                  transition: 'height 0.3s ease, box-shadow 0.15s ease',
                                }}
                              />
                            </div>
                          </div>
                        ) : (
                          /* VERTICAL STACKED 100% PILLAR */
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'flex-end',
                              height: '100%',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '9.5px',
                                fontWeight: 800,
                                color: 'var(--tx)',
                                marginBottom: '3px',
                                lineHeight: 1,
                              }}
                            >
                              {item.donePct}%
                            </span>
                            <div
                              style={{
                                width: '28px',
                                height: `${pillarAreaHeight}px`,
                                background: 'var(--slb)',
                                borderRadius: '4px 4px 0 0',
                                overflow: 'hidden',
                                display: 'flex',
                                flexDirection: 'column-reverse',
                                border: '1px solid var(--bd)',
                                boxShadow: isHovered ? '0 0 8px rgba(20, 89, 143, 0.3)' : 'none',
                                transition: 'box-shadow 0.15s ease',
                              }}
                            >
                              {/* Bottom Done slice */}
                              <div
                                style={{
                                  height: `${(item.donePct / 100) * pillarAreaHeight}px`,
                                  background: 'var(--gr)',
                                  color: '#fff',
                                  fontSize: '9px',
                                  fontWeight: 700,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  overflow: 'hidden',
                                }}
                              >
                                {item.donePct >= 16 ? `${item.donePct}%` : ''}
                              </div>
                              {/* Middle In Progress slice */}
                              {item.inProgPct > 0 && (
                                <div
                                  style={{
                                    height: `${(item.inProgPct / 100) * pillarAreaHeight}px`,
                                    background: 'var(--am)',
                                    color: '#fff',
                                    fontSize: '9px',
                                    fontWeight: 700,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    overflow: 'hidden',
                                  }}
                                >
                                  {item.inProgPct >= 16 ? `${item.inProgPct}%` : ''}
                                </div>
                              )}
                              {/* Top Remaining slice */}
                              {item.notStartedPct > 0 && (
                                <div
                                  style={{
                                    height: `${(item.notStartedPct / 100) * pillarAreaHeight}px`,
                                    background: '#cbd5e1',
                                    color: '#334155',
                                    fontSize: '9px',
                                    fontWeight: 700,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    overflow: 'hidden',
                                  }}
                                >
                                  {item.notStartedPct >= 18 ? `${item.notStartedPct}%` : ''}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Bottom Unit Names and Badges Row */}
                <div
                  style={{
                    display: 'flex',
                    padding: '6px 6px 0 6px',
                    gap: '6px',
                  }}
                >
                  {unitStats.map((item) => (
                    <div
                      key={item.unit.id}
                      style={{
                        flex: '1 1 0px',
                        maxWidth: '88px',
                        minWidth: unitChartLayout === 'vertical-twin' ? '48px' : '40px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        textAlign: 'center',
                      }}
                    >
                      <a
                        href={`#${item.unit.id}`}
                        style={{
                          fontSize: '10.5px',
                          fontWeight: 700,
                          color: 'var(--ac)',
                          textDecoration: 'none',
                          width: '100%',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'block',
                          lineHeight: 1.2,
                        }}
                        title={`Click to open ${item.unit.name}`}
                      >
                        {item.unit.name}
                      </a>
                      <span
                        style={{
                          fontSize: '9px',
                          color: 'var(--mu)',
                          background: 'var(--tr)',
                          border: '1px solid var(--bd)',
                          padding: '0px 4px',
                          borderRadius: '3px',
                          marginTop: '2px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.totalEq} eq.
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="lg" style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--bd)' }}>
          <span>
            <i style={{ background: 'var(--gr)' }}></i><b>% Completed</b> (Work Done)
          </span>
          {unitChartLayout !== 'vertical-twin' && (
            <span>
              <i style={{ background: 'var(--am)' }}></i><b>% In Progress</b> (Work Ongoing)
            </span>
          )}
          <span>
            <i style={{ background: '#dc2626' }}></i><b>% Remaining</b> (Work Pending)
          </span>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* HEADER MATCHING THE ORIGINAL HTML */}
      <header className="nrep-header">
        <button
          id="mb"
          className="ib"
          title="Open units menu"
          aria-label="Open units menu"
          onClick={() => setTreeOpen(true)}
        >
          ☰
        </button>
        <button
          id="hm"
          className="ib"
          title="Overall project summary"
          onClick={goToHome}
        >
          ⌂ Home
        </button>
        <h1>
          NRL · NREP Inspection &amp; Acceptance Monitor
          <small id="meta">
            {equipment.length} equipment · {treeData.length} units ·{' '}
            {treeData.reduce((acc, u) => acc + u.systems.length, 0)} systems
          </small>
        </h1>

        {/* Compact Search Icon -> Opens Compact Search Input on Click */}
        <div className="gs" ref={searchContainerRef}>
          <button
            type="button"
            id="gs-btn"
            title="Search tag, equipment, system, unit"
            aria-label="Open search"
            onClick={(e) => {
              e.stopPropagation();
              setSearchBoxOpen(true);
              setShowGlobalResults(true);
              setTimeout(() => searchInputRef.current?.focus(), 20);
            }}
            style={{
              padding: '6px 9px',
              height: '30px',
              display: searchBoxOpen ? 'none' : 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '5px',
            }}
          >
            <Search size={15} />
          </button>

          <div
            style={{
              position: 'relative',
              display: searchBoxOpen ? 'flex' : 'none',
              alignItems: 'center',
            }}
          >
            <Search
              size={13}
              style={{
                position: 'absolute',
                left: '9px',
                color: 'rgba(255, 255, 255, 0.7)',
                pointerEvents: 'none',
              }}
            />
            <input
              ref={searchInputRef}
              id="gs"
              placeholder="Search tag, unit…"
              value={globalSearch}
              onChange={(e) => {
                setGlobalSearch(e.target.value);
                setShowGlobalResults(true);
              }}
              onFocus={() => setShowGlobalResults(true)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setGlobalSearch('');
                  setShowGlobalResults(false);
                  setSearchBoxOpen(false);
                } else if (e.key === 'Enter' && globalSearchResults) {
                  if (globalSearchResults.matchedEquipment.length > 0) {
                    window.location.hash = `#eq-${encodeURIComponent(globalSearchResults.matchedEquipment[0].EquipmentTagNo)}`;
                    setShowGlobalResults(false);
                    setGlobalSearch('');
                    setSearchBoxOpen(false);
                  } else if (globalSearchResults.matchedUnits.length > 0) {
                    window.location.hash = `#${globalSearchResults.matchedUnits[0].id}`;
                    setShowGlobalResults(false);
                    setGlobalSearch('');
                    setSearchBoxOpen(false);
                  } else if (globalSearchResults.matchedSystems.length > 0) {
                    window.location.hash = `#${globalSearchResults.matchedSystems[0].s.id}`;
                    setShowGlobalResults(false);
                    setGlobalSearch('');
                    setSearchBoxOpen(false);
                  }
                }
              }}
              autoComplete="off"
            />
            <button
              type="button"
              title="Close search"
              aria-label="Close search"
              onClick={(e) => {
                e.stopPropagation();
                setGlobalSearch('');
                setShowGlobalResults(false);
                setSearchBoxOpen(false);
              }}
              style={{
                position: 'absolute',
                right: '4px',
                border: 'none',
                background: 'transparent',
                padding: '2px 4px',
                color: 'rgba(255, 255, 255, 0.75)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={13} />
            </button>
          </div>

          {searchBoxOpen && showGlobalResults && globalSearchResults && (
            <div id="gr" className="show">
              {globalSearchResults.matchedUnits.length > 0 && (
                <>
                  <div className="gh">Units</div>
                  {globalSearchResults.matchedUnits.map((u) => (
                    <a
                      key={u.id}
                      href={`#${u.id}`}
                      onClick={() => {
                        setShowGlobalResults(false);
                        setGlobalSearch('');
                        setSearchBoxOpen(false);
                      }}
                    >
                      {u.name}
                    </a>
                  ))}
                </>
              )}

              {globalSearchResults.matchedSystems.length > 0 && (
                <>
                  <div className="gh">Systems</div>
                  {globalSearchResults.matchedSystems.map(({ u, s }) => (
                    <a
                      key={s.id}
                      href={`#${s.id}`}
                      onClick={() => {
                        setShowGlobalResults(false);
                        setGlobalSearch('');
                        setSearchBoxOpen(false);
                      }}
                    >
                      {s.name}
                      <small>{u.name}</small>
                    </a>
                  ))}
                </>
              )}

              {globalSearchResults.matchedEquipment.length > 0 && (
                <>
                  <div className="gh">Equipment ({globalSearchResults.matchedEquipment.length})</div>
                  {globalSearchResults.matchedEquipment.slice(0, 12).map((eq) => (
                    <a
                      key={eq.id}
                      href={`#eq-${encodeURIComponent(eq.EquipmentTagNo)}`}
                      onClick={() => {
                        setShowGlobalResults(false);
                        setGlobalSearch('');
                        setSearchBoxOpen(false);
                      }}
                    >
                      <b>{eq.EquipmentTagNo}</b> {eq.EquipmentDescription}
                      <small>
                        {eq.Unit} › {eq.SystemNo}
                      </small>
                    </a>
                  ))}
                  {globalSearchResults.matchedEquipment.length > 12 && (
                    <div className="gh">
                      +{globalSearchResults.matchedEquipment.length - 12} more — refine search
                    </div>
                  )}
                </>
              )}

              {globalSearchResults.matchedUnits.length === 0 &&
                globalSearchResults.matchedSystems.length === 0 &&
                globalSearchResults.matchedEquipment.length === 0 && (
                  <div className="empty">No results found</div>
                )}
            </div>
          )}
        </div>

        {/* Hidden Excel File Input used by Tools tab */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleExcelUpload}
          accept=".xlsx,.xlsm,.xls"
          hidden
        />

        {/* User Status Badge (Logout moved to footer right corner) */}
        {(profile || user) && (
          <span id="who" style={{ fontSize: '12px', opacity: 0.9 }}>
            {profile?.displayName || user?.email?.split('@')[0] || profile?.email} ·{' '}
            <span
              style={{
                fontWeight: 700,
                textTransform: 'uppercase',
                color: isAdmin ? '#fbbf24' : isEditor ? '#86efac' : '#94a3b8',
              }}
            >
              {profile?.role || 'viewer'}
            </span>
          </span>
        )}
      </header>

      {/* FLYOUT TREE DRAWER WITH HIERARCHY, TOOLS & ADMIN TABS */}
      <div id="bk" className={treeOpen ? 'show' : ''} onClick={() => setTreeOpen(false)} />
      <nav id="tree" className={treeOpen ? 'show' : ''} style={{ display: 'flex', flexDirection: 'column' }}>
        {/* Drawer Header */}
        <div
          className="th"
          style={{
            padding: '12px 14px 10px',
            borderBottom: '1px solid var(--bd)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontWeight: 700, fontSize: '12px', color: 'var(--tx)', letterSpacing: '0.4px' }}>
            NREP NAVIGATOR &amp; TOOLS
          </span>
          <button
            className="tg"
            onClick={() => setTreeOpen(false)}
            aria-label="Close menu"
            style={{ width: 'auto', fontSize: '16px', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {/* Vertical Sidebar Navigation: Tasks, 7 Units, 8 UTILITY Sub-Units & Equipment */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: '16px' }}>
          <div style={{ padding: '10px 12px 8px' }}>
            <input
              id="tq"
              placeholder="🔍 Search unit, sub-unit, equipment…"
              value={treeFilter}
              onChange={(e) => setTreeFilter(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          <div
            style={{
              padding: '4px 14px 4px',
              fontSize: '10px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.6px',
              color: 'var(--mu)',
            }}
          >
            Workspace &amp; Tasks
          </div>

          {/* 1. Project Overview (All Units) */}
          <div
            className={`tn ${viewLevel === 'p' ? 'on' : ''}`}
            onClick={goToHome}
          >
            <span className="tg">▣</span>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                goToHome();
              }}
            >
              NREP Project (All 7 Units)
            </a>
            {renderPill(equipment)}
          </div>

          {/* 2. Excel & Data Tools (Opens in Right Pane) */}
          <div
            className={`tn ${viewLevel === 'tools' ? 'on' : ''}`}
            onClick={() => {
              window.location.hash = 'tools';
              setViewLevel('tools');
              setTreeOpen(false);
            }}
          >
            <span className="tg">🛠️</span>
            <a
              href="#tools"
              onClick={(e) => {
                e.preventDefault();
                window.location.hash = 'tools';
                setViewLevel('tools');
                setTreeOpen(false);
              }}
            >
              Excel &amp; Data Tools
            </a>
            <span className="pill p-na">Import / Export</span>
          </div>

          {/* 3. Admin & Live Database Console (Opens in Right Pane) */}
          {(isAdmin || isEditor) && (
            <div
              className={`tn ${viewLevel === 'admin' ? 'on' : ''}`}
              onClick={() => {
                window.location.hash = 'admin';
                setViewLevel('admin');
                setTreeOpen(false);
              }}
            >
              <span className="tg">⚙️</span>
              <a
                href="#admin"
                onClick={(e) => {
                  e.preventDefault();
                  window.location.hash = 'admin';
                  setViewLevel('admin');
                  setTreeOpen(false);
                }}
              >
                Admin &amp; Live Database
              </a>
              <span className="pill p-ip">Edit / Delete</span>
            </div>
          )}

          {/* Section Header for 7 Units + 8 UTILITY Sub-Units + Equipment */}
          <div
            style={{
              padding: '12px 14px 6px',
              marginTop: '4px',
              borderTop: '1px solid var(--bd)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '6px',
            }}
          >
            <span
              style={{
                fontSize: '10px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.6px',
                color: 'var(--mu)',
              }}
            >
              Units, Sub-Units &amp; Equipment
            </span>
            <button
              type="button"
              onClick={() => {
                const allUnitIds = treeData.map((u) => u.id);
                const utilitySysIds = treeData.find((u) => u.name === 'UTILITY')?.systems.map((s) => s.id) || [];
                if (expandedUnits.size >= allUnitIds.length) {
                  setExpandedUnits(new Set(['unit-7']));
                  setExpandedSystems(new Set());
                } else {
                  setExpandedUnits(new Set(allUnitIds));
                  setExpandedSystems(new Set(utilitySysIds));
                }
              }}
              style={{
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '4px',
                border: '1px solid var(--bd)',
                background: 'var(--tr)',
                color: 'var(--ac)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              title="Expand or Collapse all Units & Sub-Units"
            >
              {expandedUnits.size >= treeData.length ? 'Collapse All' : 'Expand All'}
            </button>
          </div>

          {/* 7 Main Units -> (For UTILITY: 8 Sub-Units -> Equipment) | (For RPTU, MSP, PFCCU, CDU/VDU, DHDT, SRB: Equipment directly inside) */}
          {treeData.map((u) => {
            const tf = treeFilter.trim().toLowerCase();
            const isUtility = u.name === 'UTILITY';
            const unitMatches = u.name.toLowerCase().includes(tf);

            // For non-UTILITY units: filter equipment directly inside the unit
            const matchedUnitEquip = u.items.filter(
              (eq) =>
                unitMatches ||
                eq.EquipmentTagNo.toLowerCase().includes(tf) ||
                (eq.EquipmentDescription || '').toLowerCase().includes(tf)
            );

            // For UTILITY: filter sub-units and equipment inside each sub-unit
            const matchedSubUnits = u.systems.filter((s) => {
              const subMatches = unitMatches || s.name.toLowerCase().includes(tf);
              const eqMatches = s.items.some(
                (eq) =>
                  eq.EquipmentTagNo.toLowerCase().includes(tf) ||
                  (eq.EquipmentDescription || '').toLowerCase().includes(tf)
              );
              return subMatches || eqMatches;
            });

            if (tf) {
              if (isUtility && !unitMatches && matchedSubUnits.length === 0) return null;
              if (!isUtility && !unitMatches && matchedUnitEquip.length === 0) return null;
            }

            const isUnitExpanded = tf ? true : expandedUnits.has(u.id);

            return (
              <React.Fragment key={u.id}>
                {/* LEVEL 1: MAIN UNIT ROW (RPTU, MSP, PFCCU, CDU/VDU, DHDT, SRB, UTILITY) */}
                <div
                  className={`tn l1 ${viewLevel === 'u' && selectedUnitName === u.name ? 'on' : ''}`}
                  onClick={() => {
                    window.location.hash = u.id;
                    setExpandedUnits((prev) => {
                      const next = new Set(prev);
                      next.add(u.id);
                      return next;
                    });
                  }}
                >
                  <button
                    type="button"
                    className="tg"
                    title={isUnitExpanded ? `Collapse ${u.name}` : `Expand ${u.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedUnits((prev) => {
                        const next = new Set(prev);
                        if (next.has(u.id)) next.delete(u.id);
                        else next.add(u.id);
                        return next;
                      });
                    }}
                  >
                    {isUnitExpanded ? '▾' : '▸'}
                  </button>
                  <a
                    href={`#${u.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedUnits((prev) => new Set([...prev, u.id]));
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <span>{u.name}</span>
                    {isUtility ? (
                      <span
                        style={{
                          fontSize: '9.5px',
                          fontWeight: 700,
                          padding: '0px 5px',
                          borderRadius: '4px',
                          background: '#e0f2fe',
                          color: '#0369a1',
                          border: '1px solid #bae6fd',
                        }}
                      >
                        8 Sub-Units
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: '9.5px',
                          fontWeight: 600,
                          color: 'var(--mu)',
                        }}
                      >
                        ({u.items.length} eq)
                      </span>
                    )}
                  </a>
                  {renderPill(u.items)}
                </div>

                {/* IF UNIT IS UTILITY: SHOW 8 SUB-UNITS (DM-CPU, N2U, CA-IA, BOILERS AND HRSG, COOLING TOWER, RWDU, RW FILTER, RW RESERVOIR) -> AND EQUIPMENT INSIDE EACH SUB-UNIT */}
                {isUnitExpanded &&
                  isUtility &&
                  (tf ? matchedSubUnits : u.systems).map((s) => {
                    const isSubExpanded = tf ? true : expandedSystems.has(s.id);
                    const subEquipList = tf
                      ? s.items.filter(
                          (eq) =>
                            unitMatches ||
                            s.name.toLowerCase().includes(tf) ||
                            eq.EquipmentTagNo.toLowerCase().includes(tf) ||
                            (eq.EquipmentDescription || '').toLowerCase().includes(tf)
                        )
                      : s.items;

                    return (
                      <React.Fragment key={s.id}>
                        {/* LEVEL 2 (UNDER UTILITY): SUB-UNIT ROW */}
                        <div
                          className={`tn l2 ${
                            viewLevel === 's' &&
                            selectedUnitName === u.name &&
                            selectedSystemName === s.name
                              ? 'on'
                              : ''
                          }`}
                          onClick={() => {
                            window.location.hash = s.id;
                            setExpandedSystems((prev) => new Set([...prev, s.id]));
                          }}
                        >
                          <button
                            type="button"
                            className="tg"
                            title={isSubExpanded ? `Collapse ${s.name}` : `Expand equipment in ${s.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedSystems((prev) => {
                                const next = new Set(prev);
                                if (next.has(s.id)) next.delete(s.id);
                                else next.add(s.id);
                                return next;
                              });
                            }}
                          >
                            {isSubExpanded ? '▾' : '▸'}
                          </button>
                          <a
                            href={`#${s.id}`}
                            title={`${s.name} (${s.items.length} Equipment)`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedSystems((prev) => new Set([...prev, s.id]));
                            }}
                            style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
                          >
                            <span style={{ fontWeight: 600 }}>{s.name}</span>
                            <span style={{ fontSize: '9.5px', color: 'var(--mu)' }}>
                              ({s.items.length} eq)
                            </span>
                          </a>
                          {renderPill(s.items)}
                        </div>

                        {/* LEVEL 3 (UNDER UTILITY SUB-UNIT): EQUIPMENT ITEMS INSIDE THIS SUB-UNIT */}
                        {isSubExpanded &&
                          subEquipList.map((eq) => (
                            <div
                              key={eq.id}
                              className={`tn l3 ${
                                viewLevel === 'e' && selectedEquipmentTag === eq.EquipmentTagNo ? 'on' : ''
                              }`}
                              onClick={() => {
                                window.location.hash = `eq-${encodeURIComponent(eq.EquipmentTagNo)}`;
                                setTreeOpen(false);
                              }}
                            >
                              <span style={{ fontSize: '10px', color: 'var(--ac)', flexShrink: 0 }}>•</span>
                              <a
                                href={`#eq-${encodeURIComponent(eq.EquipmentTagNo)}`}
                                title={`${eq.EquipmentTagNo} — ${eq.EquipmentDescription || ''}`}
                                onClick={() => setTreeOpen(false)}
                              >
                                <b style={{ fontSize: '11px' }}>{eq.EquipmentTagNo}</b>
                                {eq.EquipmentDescription ? (
                                  <span style={{ color: 'var(--mu)', fontSize: '10.5px', marginLeft: '4px' }}>
                                    · {eq.EquipmentDescription}
                                  </span>
                                ) : null}
                              </a>
                              {renderPill([eq])}
                            </div>
                          ))}
                      </React.Fragment>
                    );
                  })}

                {/* IF UNIT IS ONE OF THE 6 PROCESS UNITS (RPTU, MSP, PFCCU, CDU/VDU, DHDT, SRB): SHOW EQUIPMENT DIRECTLY INSIDE THE UNIT */}
                {isUnitExpanded &&
                  !isUtility &&
                  (tf ? matchedUnitEquip : u.items).map((eq) => (
                    <div
                      key={eq.id}
                      className={`tn l2 ${
                        viewLevel === 'e' && selectedEquipmentTag === eq.EquipmentTagNo ? 'on' : ''
                      }`}
                      onClick={() => {
                        window.location.hash = `eq-${encodeURIComponent(eq.EquipmentTagNo)}`;
                        setTreeOpen(false);
                      }}
                    >
                      <span style={{ fontSize: '10px', color: 'var(--ac)', flexShrink: 0 }}>•</span>
                      <a
                        href={`#eq-${encodeURIComponent(eq.EquipmentTagNo)}`}
                        title={`${eq.EquipmentTagNo} — ${eq.EquipmentDescription || ''}`}
                        onClick={() => setTreeOpen(false)}
                      >
                        <b style={{ fontSize: '11.5px' }}>{eq.EquipmentTagNo}</b>
                        {eq.EquipmentDescription ? (
                          <span style={{ color: 'var(--mu)', fontSize: '10.5px', marginLeft: '4px' }}>
                            · {eq.EquipmentDescription}
                          </span>
                        ) : null}
                      </a>
                      {renderPill([eq])}
                    </div>
                  ))}
              </React.Fragment>
            );
          })}
        </div>

        {/* Drawer Sticky Bottom Footer */}
        <div
          style={{
            borderTop: '1px solid var(--bd)',
            background: 'var(--tr)',
            padding: '10px 12px',
            fontSize: '11px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <span style={{ color: 'var(--mu)', display: 'block', fontSize: '9.5px', textTransform: 'uppercase' }}>Logged in as</span>
            <b style={{ color: 'var(--tx)', fontSize: '11.5px' }}>{profile?.displayName || user?.email?.split('@')[0] || 'User'}</b>
          </div>
          {(isAdmin || isEditor) ? (
            <button
              type="button"
              onClick={() => {
                window.location.hash = 'admin';
                setViewLevel('admin');
                setTreeOpen(false);
              }}
              style={{
                padding: '4px 8px',
                fontSize: '11px',
                fontWeight: 600,
                background: 'var(--ac)',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              ⚙ Admin DB
            </button>
          ) : (
            <span style={{ color: 'var(--mu)', fontSize: '10.5px' }}>{profile?.role || 'viewer'}</span>
          )}
        </div>
      </nav>

      {/* MAIN VIEWPORT MATCHING REFERENCE HTML */}
      <main id="main" className="nrep-main">
        {/* LEVEL 1: PROJECT OVERALL STATUS */}
        {viewLevel === 'p' && (
          <>
            {/* NREP PROJECT HERO BANNER WITH LIVE PROGRESS BAR & LIVE DATE/TIME (NARROW COMPACT PROFESSIONAL LAYOUT) */}
            <div className="nrep-hero-banner">
              <div className="nrep-hero-overlay">
                {/* Top Section: NRL Logo + Title + On Track Badge + Live Date */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '10px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      flexWrap: 'wrap',
                    }}
                  >
                    {/* NRL Logo + Vertical Divider */}
                    <img
                      src="/assets/nrl-banner-logo.png"
                      alt="NRL Logo"
                      style={{
                        height: '34px',
                        width: 'auto',
                        objectFit: 'contain',
                        display: 'block',
                        filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.35))',
                      }}
                    />

                    <div
                      style={{
                        width: '1px',
                        height: '30px',
                        background: 'rgba(255, 255, 255, 0.24)',
                        flexShrink: 0,
                      }}
                    />

                    {/* Title + Status Badge + Live Timestamp */}
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '8px',
                        }}
                      >
                        <div
                          style={{
                            fontSize: 'clamp(15.5px, 1.65vw, 20px)',
                            fontWeight: 800,
                            color: '#ffffff',
                            lineHeight: 1.15,
                            letterSpacing: '-0.02em',
                            textShadow: '0 2px 8px rgba(0, 0, 0, 0.45)',
                          }}
                        >
                          NREP Project –{' '}
                          <span style={{ color: '#67b7f7' }}>Overall Status</span>
                        </div>

                        {/* Live Status Badge */}
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            background:
                              stats.progressPct === 100
                                ? 'linear-gradient(135deg, #059669 0%, #10b981 100%)'
                                : 'linear-gradient(135deg, #16a34a 0%, #10b981 100%)',
                            color: '#ffffff',
                            padding: '2px 9px 2px 5px',
                            borderRadius: '999px',
                            fontSize: '11px',
                            fontWeight: 700,
                            boxShadow: '0 2px 8px rgba(16, 185, 129, 0.35), inset 0 1px 1px rgba(255,255,255,0.25)',
                            letterSpacing: '0.01em',
                          }}
                        >
                          <span
                            style={{
                              width: '14px',
                              height: '14px',
                              borderRadius: '50%',
                              background: '#ffffff',
                              color: '#16a34a',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            <Check size={10} strokeWidth={3.5} />
                          </span>
                          <span>{stats.progressPct === 100 ? 'Completed' : 'On Track'}</span>
                        </span>
                      </div>

                      {/* Live Date & Time Row */}
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '11px',
                          color: '#cbd5e1',
                          marginTop: '2px',
                          textShadow: '0 1px 5px rgba(0,0,0,0.55)',
                        }}
                      >
                        <Calendar size={12} style={{ color: '#93c5fd', flexShrink: 0 }} />
                        <span>Last Updated:</span>
                        <strong
                          style={{
                            color: '#ffffff',
                            fontWeight: 700,
                            letterSpacing: '0.02em',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {bannerLastUpdated.dateStr} &nbsp;|&nbsp; {bannerLastUpdated.timeStr}
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom Section: Live Project Progress Bar */}
                <div style={{ marginTop: '7px', width: '100%', maxWidth: '760px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '3px',
                      gap: '8px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '11.5px',
                        fontWeight: 700,
                        color: '#ffffff',
                        letterSpacing: '-0.01em',
                        textShadow: '0 1px 5px rgba(0,0,0,0.5)',
                      }}
                    >
                      Project Progress
                    </span>
                    <span
                      style={{
                        fontSize: '10.5px',
                        color: '#bae6fd',
                        fontWeight: 600,
                        textShadow: '0 1px 4px rgba(0,0,0,0.65)',
                      }}
                    >
                      {stats.completed} Completed · {stats.inProgress} In Progress · {stats.notStarted} Remaining (of {stats.total} Equipment)
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                    }}
                  >
                    {/* Progress Track */}
                    <div
                      style={{
                        flex: 1,
                        height: '8px',
                        background: 'rgba(148, 163, 184, 0.34)',
                        borderRadius: '999px',
                        overflow: 'hidden',
                        boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.45)',
                        border: '1px solid rgba(255, 255, 255, 0.14)',
                        backdropFilter: 'blur(4px)',
                      }}
                      title={`Overall Stage Progress: ${stats.progressPct}%`}
                    >
                      {/* Live Animated Progress Fill */}
                      <div
                        style={{
                          width: `${Math.min(100, Math.max(0, stats.progressPct))}%`,
                          height: '100%',
                          background: 'linear-gradient(90deg, #0284c7 0%, #1d8cf8 50%, #38bdf8 100%)',
                          borderRadius: '999px',
                          boxShadow: '0 0 10px rgba(56, 189, 248, 0.75)',
                          transition: 'width 0.45s cubic-bezier(0.22, 1, 0.36, 1)',
                        }}
                      />
                    </div>

                    {/* Live Percentage Number */}
                    <div
                      style={{
                        fontSize: 'clamp(15px, 1.4vw, 18px)',
                        fontWeight: 800,
                        color: '#ffffff',
                        fontVariantNumeric: 'tabular-nums',
                        minWidth: '40px',
                        textAlign: 'right',
                        lineHeight: 1,
                        textShadow: '0 2px 8px rgba(0, 0, 0, 0.6)',
                      }}
                    >
                      {stats.progressPct}%
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Professional Executive KPI Cards Strip */}
            {(() => {
              const totalSystems = treeData.reduce((acc, u) => acc + u.systems.length, 0);
              const compPct = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;
              const progPct = stats.total ? Math.round((stats.inProgress / stats.total) * 100) : 0;
              const notStartPct = stats.total ? Math.round((stats.notStarted / stats.total) * 100) : 0;

              return (
                <div className="kp">
                  {renderProfessionalKpiCard({
                    label: 'Units',
                    value: treeData.length,
                    subtext: 'Process & utility units',
                    badgeText: 'Scope',
                    pctBar: 100,
                    theme: 'navy',
                    icon: <Factory size={13} />,
                    active: kpiFilter === 'units',
                    onClick: () => {
                      setKpiSearch('');
                      setKpiFilter(kpiFilter === 'units' ? null : 'units');
                    },
                    title: 'Click to drill down into Units breakdown',
                  })}

                  {renderProfessionalKpiCard({
                    label: 'Systems',
                    value: totalSystems,
                    subtext: `Across ${treeData.length} project units`,
                    badgeText: 'Active',
                    pctBar: 100,
                    theme: 'indigo',
                    icon: <Layers size={13} />,
                    active: kpiFilter === 'systems',
                    onClick: () => {
                      setKpiSearch('');
                      setKpiFilter(kpiFilter === 'systems' ? null : 'systems');
                    },
                    title: 'Click to drill down into Systems breakdown',
                  })}

                  {renderProfessionalKpiCard({
                    label: 'Equipment',
                    value: stats.total,
                    subtext: 'Total monitored tags',
                    badgeText: '100%',
                    pctBar: 100,
                    theme: 'cyan',
                    icon: <Cpu size={13} />,
                    active: kpiFilter === 'all',
                    onClick: () => {
                      setKpiSearch('');
                      setKpiFilter(kpiFilter === 'all' ? null : 'all');
                    },
                    title: 'Click to view all equipment tags',
                  })}

                  {renderProfessionalKpiCard({
                    label: 'Completed',
                    value: stats.completed,
                    subtext: `${compPct}% of total equipment`,
                    badgeText: `${compPct}%`,
                    pctBar: compPct,
                    theme: 'green',
                    icon: <CheckCircle2 size={13} />,
                    active: kpiFilter === 'Completed',
                    onClick: () => {
                      setKpiSearch('');
                      setKpiFilter(kpiFilter === 'Completed' ? null : 'Completed');
                    },
                    title: 'Click to filter completed equipment',
                  })}

                  {renderProfessionalKpiCard({
                    label: 'In Progress',
                    value: stats.inProgress,
                    subtext: `${progPct}% under inspection`,
                    badgeText: `${progPct}%`,
                    pctBar: progPct,
                    theme: 'amber',
                    icon: <Clock size={13} />,
                    active: kpiFilter === 'In progress',
                    onClick: () => {
                      setKpiSearch('');
                      setKpiFilter(kpiFilter === 'In progress' ? null : 'In progress');
                    },
                    title: 'Click to filter in-progress equipment',
                  })}

                  {renderProfessionalKpiCard({
                    label: 'Not Started',
                    value: stats.notStarted,
                    subtext: `${notStartPct}% pending start`,
                    badgeText: `${notStartPct}%`,
                    pctBar: notStartPct,
                    theme: 'slate',
                    icon: <CircleDashed size={13} />,
                    active: kpiFilter === 'Not started',
                    onClick: () => {
                      setKpiSearch('');
                      setKpiFilter(kpiFilter === 'Not started' ? null : 'Not started');
                    },
                    title: 'Click to filter not-started equipment',
                  })}

                  {renderProfessionalKpiCard({
                    label: 'Stage Progress',
                    value: `${stats.progressPct}%`,
                    subtext: '7-stage weighted index',
                    badgeText: 'Live',
                    pctBar: stats.progressPct,
                    theme: 'blue',
                    icon: <TrendingUp size={13} />,
                    active: kpiFilter === 'prog',
                    onClick: () => {
                      setKpiSearch('');
                      setKpiFilter(kpiFilter === 'prog' ? null : 'prog');
                    },
                    title: 'Click to view stage-wise and unit-wise progress charts',
                  })}
                </div>
              );
            })()}

            {/* When a KPI card is clicked: HIDE default home data and show ONLY this drilldown card */}
            {kpiFilter && (
              <div id="kd" className="cd" style={{ borderTop: '3px solid var(--ac)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '13px', color: 'var(--tx)' }}>
                    {kpiFilter === 'units'
                      ? `Units Breakdown (${treeData.length} units)`
                      : kpiFilter === 'systems'
                      ? `Systems Breakdown (${treeData.reduce((acc, u) => acc + u.systems.length, 0)} systems)`
                      : kpiFilter === 'prog'
                      ? 'Stage-Wise Status Overview — All Units'
                      : kpiFilter === 'Completed'
                      ? `Completed Equipment (${stats.completed})`
                      : kpiFilter === 'In progress'
                      ? `Equipment In Progress (${stats.inProgress})`
                      : kpiFilter === 'Not started'
                      ? `Equipment Not Started (${stats.notStarted})`
                      : `All Equipment (${stats.total})`}
                  </h3>
                  <button
                    className="x"
                    onClick={() => {
                      setKpiFilter(null);
                      setKpiSearch('');
                    }}
                    title="Close filter and restore home page overview"
                    style={{ fontWeight: 600, padding: '4px 10px', fontSize: '12px' }}
                  >
                    ✕ Close &amp; Show Full Overview
                  </button>
                </div>

                {kpiFilter === 'units' && (
                  <div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
                      <input
                        className="tsf"
                        style={{ maxWidth: '340px', margin: 0 }}
                        placeholder="🔍 Search units…"
                        value={kpiSearch}
                        onChange={(e) => setKpiSearch(e.target.value)}
                      />
                      <span style={{ fontSize: '12px', color: 'var(--mu)' }}>
                        Showing {treeData.filter((u) => !kpiSearch || u.name.toLowerCase().includes(kpiSearch.toLowerCase())).length} of {treeData.length} units
                      </span>
                    </div>
                    <div className="tw">
                      <table className="nrep-table">
                        <thead>
                          <tr>
                            <th>Unit</th>
                            <th>Equip.</th>
                            <th>Completed</th>
                            <th>In prog.</th>
                            <th>Not started</th>
                            <th style={{ minWidth: '150px' }}>Status</th>
                            {STATUS_COLUMNS.map((col) => (
                              <th key={col.key} className="ct">
                                {col.short}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {treeData
                            .filter((u) => !kpiSearch || u.name.toLowerCase().includes(kpiSearch.toLowerCase()))
                            .map((u) => {
                              const s = {
                                total: u.items.length,
                                completed: u.items.filter((r) => getEquipmentOverallStatus(r) === 'Completed').length,
                                inProgress: u.items.filter((r) => getEquipmentOverallStatus(r) === 'In progress').length,
                              };
                              const n = s.total - s.completed - s.inProgress;
                              return (
                                <tr key={u.id}>
                                  <td>
                                    <a href={`#${u.id}`}>
                                      <b>{u.name}</b>
                                    </a>
                                  </td>
                                  <td>{s.total}</td>
                                  <td>{s.completed}</td>
                                  <td>{s.inProgress}</td>
                                  <td>{n}</td>
                                  <td>{renderMiniProgressBar(u.items)}</td>
                                  {STATUS_COLUMNS.map((col) => {
                                    const pend = getPendingStageCount(u.items, col.key);
                                    return (
                                      <td key={col.key} className={pend ? 'pn' : 'pz'}>
                                        {pend}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {kpiFilter === 'systems' && (
                  <div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
                      <input
                        className="tsf"
                        style={{ maxWidth: '340px', margin: 0 }}
                        placeholder="🔍 Search systems or unit…"
                        value={kpiSearch}
                        onChange={(e) => setKpiSearch(e.target.value)}
                      />
                    </div>
                    <div className="tw">
                      <table className="nrep-table">
                        <thead>
                          <tr>
                            <th>System</th>
                            <th>Equip.</th>
                            <th>Completed</th>
                            <th>In prog.</th>
                            <th>Not started</th>
                            <th style={{ minWidth: '150px' }}>Status</th>
                            {STATUS_COLUMNS.map((col) => (
                              <th key={col.key} className="ct">
                                {col.short}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {treeData
                            .flatMap((u) => u.systems.map((sys) => ({ u, sys })))
                            .filter(({ u, sys }) => {
                              if (!kpiSearch) return true;
                              const q = kpiSearch.toLowerCase();
                              return sys.name.toLowerCase().includes(q) || u.name.toLowerCase().includes(q);
                            })
                            .map(({ u, sys }) => {
                              const c = sys.items.filter((r) => getEquipmentOverallStatus(r) === 'Completed').length;
                              const p = sys.items.filter((r) => getEquipmentOverallStatus(r) === 'In progress').length;
                              const n = sys.items.length - c - p;
                              return (
                                <tr key={sys.id}>
                                  <td>
                                    <a href={`#${sys.id}`}>
                                      <b>{u.name} › {sys.name}</b>
                                    </a>
                                  </td>
                                  <td>{sys.items.length}</td>
                                  <td>{c}</td>
                                  <td>{p}</td>
                                  <td>{n}</td>
                                  <td>{renderMiniProgressBar(sys.items)}</td>
                                  {STATUS_COLUMNS.map((col) => {
                                    const pend = getPendingStageCount(sys.items, col.key);
                                    return (
                                      <td key={col.key} className={pend ? 'pn' : 'pz'}>
                                        {pend}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {kpiFilter === 'prog' && (
                  <div>
                    <div style={{ marginBottom: '16px' }}>
                      <h4 style={{ margin: '0 0 10px', fontSize: '13px', color: 'var(--mu)', textTransform: 'uppercase' }}>Overall Stage Progress</h4>
                      {renderStageWiseBars(equipment)}
                    </div>
                    {renderUnitWiseProgressBarChart()}
                  </div>
                )}

                {['all', 'Completed', 'In progress', 'Not started'].includes(kpiFilter) && (
                  <div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
                      <input
                        className="tsf"
                        style={{ maxWidth: '340px', margin: 0 }}
                        placeholder="🔍 Search tag, description, unit, system…"
                        value={kpiSearch}
                        onChange={(e) => setKpiSearch(e.target.value)}
                      />
                      <span style={{ fontSize: '12px', color: 'var(--mu)' }}>
                        Showing {
                          equipment.filter((r) => {
                            const matchesFilter = kpiFilter === 'all' || getEquipmentOverallStatus(r) === kpiFilter;
                            if (!matchesFilter) return false;
                            if (!kpiSearch) return true;
                            const q = kpiSearch.toLowerCase();
                            return (
                              r.EquipmentTagNo?.toLowerCase().includes(q) ||
                              r.EquipmentDescription?.toLowerCase().includes(q) ||
                              r.Unit?.toLowerCase().includes(q) ||
                              r.SystemNo?.toLowerCase().includes(q)
                            );
                          }).length
                        } equipment
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setKpiFilter(null);
                          setKpiSearch('');
                        }}
                        style={{
                          marginLeft: 'auto',
                          fontSize: '12px',
                          padding: '4px 10px',
                          background: 'var(--tr)',
                          borderColor: 'var(--bd)',
                        }}
                      >
                        ✕ Close &amp; Show Full Home Overview
                      </button>
                    </div>

                    <div className="tw">
                      <table className="nrep-table">
                        <thead>
                          <tr>
                            <th>Tag No.</th>
                            <th>Description</th>
                            <th>Unit</th>
                            <th>System</th>
                            <th>Status</th>
                            <th>Progress</th>
                            <th>Base Line UTG</th>
                            <th>Document/Drawing</th>
                            {isEditor && <th style={{ textAlign: 'center' }}>Action</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {equipment
                            .filter((r) => {
                              const matchesFilter = kpiFilter === 'all' || getEquipmentOverallStatus(r) === kpiFilter;
                              if (!matchesFilter) return false;
                              if (!kpiSearch) return true;
                              const q = kpiSearch.toLowerCase();
                              return (
                                r.EquipmentTagNo?.toLowerCase().includes(q) ||
                                r.EquipmentDescription?.toLowerCase().includes(q) ||
                                r.Unit?.toLowerCase().includes(q) ||
                                r.SystemNo?.toLowerCase().includes(q) ||
                                r.BaseLineUTG?.toLowerCase().includes(q) ||
                                r.DocumentDrawing?.toLowerCase().includes(q)
                              );
                            })
                            .map((r) => (
                              <tr key={r.id}>
                                <td>
                                  <a href={`#eq-${encodeURIComponent(r.EquipmentTagNo)}`}>
                                    <b>{r.EquipmentTagNo}</b>
                                  </a>
                                </td>
                                <td>{r.EquipmentDescription || '—'}</td>
                                <td>{r.Unit}</td>
                                <td>{r.SystemNo}</td>
                                <td>{renderStatusChip(getEquipmentOverallStatus(r))}</td>
                                <td>{calculateProgress([r])}%</td>
                                <td>{renderStatusChip(r.BaseLineUTG)}</td>
                                <td>{renderDocumentDrawing(r.DocumentDrawing)}</td>
                                {isEditor && (
                                  <td style={{ textAlign: 'center' }}>
                                    <button
                                      type="button"
                                      onClick={() => setEditingEquipment(r)}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '3px',
                                        padding: '3px 8px',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        background: 'var(--tr)',
                                        color: 'var(--ac)',
                                        border: '1px solid var(--bd)',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                      }}
                                      title={`Edit ${r.EquipmentTagNo}`}
                                    >
                                      <span>✏️</span> Edit
                                    </button>
                                  </td>
                                )}
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* When NO KPI filter is active: show the standard full home page overview */}
            {!kpiFilter && (
              <>
                {/* Unit-wise Matrix Table */}
                <div className="cd">
                  <h3>Unit-wise status and pending (level 1 of hierarchy)</h3>
                  <input
                    className="tsf"
                    placeholder="🔍 Search in this table…"
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                  />
                  <div className="tw">
                    <table className="nrep-table">
                      <thead>
                        <tr>
                          <th>Unit</th>
                          <th>Equip.</th>
                          <th>Completed</th>
                          <th>In prog.</th>
                          <th>Not started</th>
                          <th style={{ minWidth: '175px' }}>Stage Progress</th>
                          {STATUS_COLUMNS.map((col) => (
                            <th key={col.key} className="ct" title={`Pending equipment count (${col.pendingValue})`}>
                              {col.short}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {treeData
                          .filter((u) => !tableSearch || u.name.toLowerCase().includes(tableSearch.toLowerCase()))
                          .map((u) => {
                            const c = u.items.filter((r) => getEquipmentOverallStatus(r) === 'Completed').length;
                            const p = u.items.filter((r) => getEquipmentOverallStatus(r) === 'In progress').length;
                            const n = u.items.length - c - p;
                            return (
                              <tr key={u.id}>
                                <td>
                                  <a href={`#${u.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    <b>{u.name}</b>
                                    {u.name === 'UTILITY' && (
                                      <span
                                        style={{
                                          fontSize: '9.5px',
                                          fontWeight: 700,
                                          padding: '1px 5px',
                                          borderRadius: '4px',
                                          background: '#e0f2fe',
                                          color: '#0369a1',
                                          border: '1px solid #bae6fd',
                                        }}
                                      >
                                        8 Sub-Units
                                      </span>
                                    )}
                                  </a>
                                </td>
                                <td>{u.items.length}</td>
                                <td>{c}</td>
                                <td>{p}</td>
                                <td>{n}</td>
                                <td>{renderMiniProgressBar(u.items)}</td>
                                {STATUS_COLUMNS.map((col) => {
                                  const pend = getPendingStageCount(u.items, col.key);
                                  return (
                                    <td key={col.key} className={pend ? 'pn' : 'pz'}>
                                      {pend}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                  <div className="note">
                    Percentage is calculated from the 6 stage dropdowns (Format-I/II/III = Issued, Internal Insp. = Yes, Base Line UTG = Yes, Final Accept. = Accept) rolled up across the hierarchy. Stage columns show pending equipment count.
                  </div>
                </div>

                {/* 3-Column Overview Row: Overall equipment status | Unit-Wise Vertical Pillar Chart | Stage-wise status — all units */}
                <div className="g3-overview">
                  <div className="cd overall-status-cd">
                    <h3>Overall equipment status</h3>
                    <div className="overall-status-body">
                      {renderDonutChart(stats)}
                    </div>
                  </div>
                  {renderUnitWiseProgressBarChart()}
                  <div className="cd">
                    <h3>Stage-wise status — all units</h3>
                    {renderStageWiseBars(equipment)}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* LEVEL 2: UNIT STATUS */}
        {viewLevel === 'u' && activeUnit && (
          <>
            <div className="bc">
              <a href="#" onClick={goToHome}>NREP Project</a> › {activeUnit.name}
            </div>
            <h2 className="t">Unit: {activeUnit.name}</h2>

            {(() => {
              const compPct = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;
              const progPct = stats.total ? Math.round((stats.inProgress / stats.total) * 100) : 0;
              const notStartPct = stats.total ? Math.round((stats.notStarted / stats.total) * 100) : 0;

              return (
                <div className="kp">
                  {renderProfessionalKpiCard({
                    label: 'Systems',
                    value: activeUnit.systems.length,
                    subtext: `In ${activeUnit.name}`,
                    badgeText: 'Unit Scope',
                    pctBar: 100,
                    theme: 'indigo',
                    icon: <Layers size={13} />,
                    active: kpiFilter === 'systems',
                    onClick: () => {
                      setKpiSearch('');
                      setKpiFilter(kpiFilter === 'systems' ? null : 'systems');
                    },
                    title: 'Click to see systems in this unit',
                  })}

                  {renderProfessionalKpiCard({
                    label: 'Equipment',
                    value: stats.total,
                    subtext: 'Unit equipment tags',
                    badgeText: '100%',
                    pctBar: 100,
                    theme: 'cyan',
                    icon: <Cpu size={13} />,
                    active: kpiFilter === 'all',
                    onClick: () => {
                      setKpiSearch('');
                      setKpiFilter(kpiFilter === 'all' ? null : 'all');
                    },
                    title: 'Click to see all equipment in this unit',
                  })}

                  {renderProfessionalKpiCard({
                    label: 'Completed',
                    value: stats.completed,
                    subtext: `${compPct}% of unit equipment`,
                    badgeText: `${compPct}%`,
                    pctBar: compPct,
                    theme: 'green',
                    icon: <CheckCircle2 size={13} />,
                    active: kpiFilter === 'Completed',
                    onClick: () => {
                      setKpiSearch('');
                      setKpiFilter(kpiFilter === 'Completed' ? null : 'Completed');
                    },
                    title: 'Click to see completed equipment in this unit',
                  })}

                  {renderProfessionalKpiCard({
                    label: 'In Progress',
                    value: stats.inProgress,
                    subtext: `${progPct}% under inspection`,
                    badgeText: `${progPct}%`,
                    pctBar: progPct,
                    theme: 'amber',
                    icon: <Clock size={13} />,
                    active: kpiFilter === 'In progress',
                    onClick: () => {
                      setKpiSearch('');
                      setKpiFilter(kpiFilter === 'In progress' ? null : 'In progress');
                    },
                    title: 'Click to see in progress equipment in this unit',
                  })}

                  {renderProfessionalKpiCard({
                    label: 'Not Started',
                    value: stats.notStarted,
                    subtext: `${notStartPct}% pending start`,
                    badgeText: `${notStartPct}%`,
                    pctBar: notStartPct,
                    theme: 'slate',
                    icon: <CircleDashed size={13} />,
                    active: kpiFilter === 'Not started',
                    onClick: () => {
                      setKpiSearch('');
                      setKpiFilter(kpiFilter === 'Not started' ? null : 'Not started');
                    },
                    title: 'Click to see not started equipment in this unit',
                  })}

                  {renderProfessionalKpiCard({
                    label: 'Stage Progress',
                    value: `${stats.progressPct}%`,
                    subtext: '7-stage unit progress',
                    badgeText: 'Live',
                    pctBar: stats.progressPct,
                    theme: 'blue',
                    icon: <TrendingUp size={13} />,
                    active: kpiFilter === 'prog',
                    onClick: () => {
                      setKpiSearch('');
                      setKpiFilter(kpiFilter === 'prog' ? null : 'prog');
                    },
                    title: 'Click to see stage progress for this unit',
                  })}
                </div>
              );
            })()}

            {/* When a KPI card is clicked in Unit view: show drilldown and HIDE default unit overview */}
            {kpiFilter && (
              <div id="kd" className="cd" style={{ borderTop: '3px solid var(--ac)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '13px', color: 'var(--tx)' }}>
                    {kpiFilter === 'systems'
                      ? `Systems in ${activeUnit.name} (${activeUnit.systems.length})`
                      : kpiFilter === 'prog'
                      ? `Stage-Wise Status — ${activeUnit.name}`
                      : kpiFilter === 'Completed'
                      ? `Completed Equipment in ${activeUnit.name} (${stats.completed})`
                      : kpiFilter === 'In progress'
                      ? `Equipment In Progress in ${activeUnit.name} (${stats.inProgress})`
                      : kpiFilter === 'Not started'
                      ? `Equipment Not Started in ${activeUnit.name} (${stats.notStarted})`
                      : `All Equipment in ${activeUnit.name} (${stats.total})`}
                  </h3>
                  <button
                    className="x"
                    onClick={() => {
                      setKpiFilter(null);
                      setKpiSearch('');
                    }}
                    title="Close filter and restore unit overview"
                    style={{ fontWeight: 600, padding: '4px 10px', fontSize: '12px' }}
                  >
                    ✕ Close &amp; Show Unit Overview
                  </button>
                </div>

                {kpiFilter === 'systems' && (
                  <div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
                      <input
                        className="tsf"
                        style={{ maxWidth: '340px', margin: 0 }}
                        placeholder="🔍 Search systems in this unit…"
                        value={kpiSearch}
                        onChange={(e) => setKpiSearch(e.target.value)}
                      />
                    </div>
                    <div className="tw">
                      <table className="nrep-table">
                        <thead>
                          <tr>
                            <th>System</th>
                            <th>Equip.</th>
                            <th>Completed</th>
                            <th>In prog.</th>
                            <th>Not started</th>
                            <th style={{ minWidth: '150px' }}>Status</th>
                            {STATUS_COLUMNS.map((col) => (
                              <th key={col.key} className="ct">
                                {col.short}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {activeUnit.systems
                            .filter((sys) => !kpiSearch || sys.name.toLowerCase().includes(kpiSearch.toLowerCase()))
                            .map((sys) => {
                              const c = sys.items.filter((r) => getEquipmentOverallStatus(r) === 'Completed').length;
                              const p = sys.items.filter((r) => getEquipmentOverallStatus(r) === 'In progress').length;
                              const n = sys.items.length - c - p;
                              return (
                                <tr key={sys.id}>
                                  <td>
                                    <a href={`#${sys.id}`}>
                                      <b>{sys.name}</b>
                                    </a>
                                  </td>
                                  <td>{sys.items.length}</td>
                                  <td>{c}</td>
                                  <td>{p}</td>
                                  <td>{n}</td>
                                  <td>{renderMiniProgressBar(sys.items)}</td>
                                  {STATUS_COLUMNS.map((col) => {
                                    const pend = getPendingStageCount(sys.items, col.key);
                                    return (
                                      <td key={col.key} className={pend ? 'pn' : 'pz'}>
                                        {pend}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {kpiFilter === 'prog' && (
                  <div>{renderStageWiseBars(activeUnit.items)}</div>
                )}

                {['all', 'Completed', 'In progress', 'Not started'].includes(kpiFilter) && (
                  <div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
                      <input
                        className="tsf"
                        style={{ maxWidth: '340px', margin: 0 }}
                        placeholder="🔍 Search tag, description, system…"
                        value={kpiSearch}
                        onChange={(e) => setKpiSearch(e.target.value)}
                      />
                      <span style={{ fontSize: '12px', color: 'var(--mu)' }}>
                        Showing {
                          activeUnit.items.filter((r) => {
                            const matchesFilter = kpiFilter === 'all' || getEquipmentOverallStatus(r) === kpiFilter;
                            if (!matchesFilter) return false;
                            if (!kpiSearch) return true;
                            const q = kpiSearch.toLowerCase();
                            return (
                              r.EquipmentTagNo?.toLowerCase().includes(q) ||
                              r.EquipmentDescription?.toLowerCase().includes(q) ||
                              r.SystemNo?.toLowerCase().includes(q)
                            );
                          }).length
                        } equipment
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setKpiFilter(null);
                          setKpiSearch('');
                        }}
                        style={{
                          marginLeft: 'auto',
                          fontSize: '12px',
                          padding: '4px 10px',
                          background: 'var(--tr)',
                          borderColor: 'var(--bd)',
                        }}
                      >
                        ✕ Close &amp; Show Unit Overview
                      </button>
                    </div>

                    <div className="tw">
                      <table className="nrep-table">
                        <thead>
                          <tr>
                            <th>Tag No.</th>
                            <th>Description</th>
                            <th>System</th>
                            <th>Status</th>
                            <th>Progress</th>
                            <th>Base Line UTG</th>
                            <th>Document/Drawing</th>
                            {isEditor && <th style={{ textAlign: 'center' }}>Action</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {activeUnit.items
                            .filter((r) => {
                              const matchesFilter = kpiFilter === 'all' || getEquipmentOverallStatus(r) === kpiFilter;
                              if (!matchesFilter) return false;
                              if (!kpiSearch) return true;
                              const q = kpiSearch.toLowerCase();
                              return (
                                r.EquipmentTagNo?.toLowerCase().includes(q) ||
                                r.EquipmentDescription?.toLowerCase().includes(q) ||
                                r.SystemNo?.toLowerCase().includes(q) ||
                                r.BaseLineUTG?.toLowerCase().includes(q) ||
                                r.DocumentDrawing?.toLowerCase().includes(q)
                              );
                            })
                            .map((r) => (
                              <tr key={r.id}>
                                <td>
                                  <a href={`#eq-${encodeURIComponent(r.EquipmentTagNo)}`}>
                                    <b>{r.EquipmentTagNo}</b>
                                  </a>
                                </td>
                                <td>{r.EquipmentDescription || '—'}</td>
                                <td>{r.SystemNo}</td>
                                <td>{renderStatusChip(getEquipmentOverallStatus(r))}</td>
                                <td>{calculateProgress([r])}%</td>
                                <td>{renderStatusChip(r.BaseLineUTG)}</td>
                                <td>{renderDocumentDrawing(r.DocumentDrawing)}</td>
                                {isEditor && (
                                  <td style={{ textAlign: 'center' }}>
                                    <button
                                      type="button"
                                      onClick={() => setEditingEquipment(r)}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '3px',
                                        padding: '3px 8px',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        background: 'var(--tr)',
                                        color: 'var(--ac)',
                                        border: '1px solid var(--bd)',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                      }}
                                      title={`Edit ${r.EquipmentTagNo}`}
                                    >
                                      <span>✏️</span> Edit
                                    </button>
                                  </td>
                                )}
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* When NO KPI filter is active in Unit view: show unit overview + Sub-Units (for UTILITY) + Equipment list */}
            {!kpiFilter && (
              <>
                <div className="g2">
                  <div className="cd overall-status-cd">
                    <h3>Equipment status</h3>
                    <div className="overall-status-body">
                      {renderDonutChart(stats)}
                    </div>
                  </div>
                  <div className="cd">
                    <h3>Stage-wise status — {activeUnit.name}</h3>
                    {renderStageWiseBars(activeUnit.items)}
                  </div>
                </div>

                {/* For UTILITY: Display the 8 Sub-Units Matrix Table (DM-CPU, N2U, CA-IA, BOILERS AND HRSG, COOLING TOWER, RWDU, RW FILTER, RW RESERVOIR) */}
                {activeUnit.name === 'UTILITY' && (
                  <div className="cd">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                      <h3 style={{ margin: 0 }}>
                        Sub-Units in UTILITY (8 Sub-Units — Click a Sub-Unit to open its Equipment)
                      </h3>
                    </div>
                    <div className="tw">
                      <table className="nrep-table">
                        <thead>
                          <tr>
                            <th>Sub-Unit (UTILITY)</th>
                            <th>Equip.</th>
                            <th>Completed</th>
                            <th>In prog.</th>
                            <th>Not started</th>
                            <th style={{ minWidth: '150px' }}>Status</th>
                            {STATUS_COLUMNS.map((col) => (
                              <th key={col.key} className="ct">
                                {col.short}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {activeUnit.systems.map((sys) => {
                            const c = sys.items.filter((r) => getEquipmentOverallStatus(r) === 'Completed').length;
                            const p = sys.items.filter((r) => getEquipmentOverallStatus(r) === 'In progress').length;
                            const n = sys.items.length - c - p;
                            return (
                              <tr key={sys.id}>
                                <td>
                                  <a href={`#${sys.id}`}>
                                    <b>{sys.name}</b>
                                  </a>
                                </td>
                                <td>{sys.items.length}</td>
                                <td>{c}</td>
                                <td>{p}</td>
                                <td>{n}</td>
                                <td>{renderMiniProgressBar(sys.items)}</td>
                                {STATUS_COLUMNS.map((col) => {
                                  const pend = getPendingStageCount(sys.items, col.key);
                                  return (
                                    <td key={col.key} className={pend ? 'pn' : 'pz'}>
                                      {pend}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Direct Equipment Table inside the Unit (for RPTU, MSP, PFCCU, CDU/VDU, DHDT, SRB and also UTILITY) */}
                <div className="cd">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
                    <h3 style={{ margin: 0 }}>
                      {activeUnit.name === 'UTILITY'
                        ? 'All Equipment in UTILITY (Across 8 Sub-Units)'
                        : `Equipment List in ${activeUnit.name} (${activeUnit.items.length} Equipment)`}
                    </h3>
                    {isEditor && (
                      <button
                        type="button"
                        onClick={() =>
                          setEditingEquipment({
                            id: '',
                            Unit: activeUnit.name,
                            SubUnit: activeUnit.name === 'UTILITY' ? UTILITY_SUB_UNITS[0] : '',
                            SystemNo: activeUnit.name === 'UTILITY' ? UTILITY_SUB_UNITS[0] : `${activeUnit.name} Main System`,
                            EquipmentTagNo: '',
                            EquipmentDescription: '',
                            EquipmentType: '',
                            FormatIStatus: 'Not Issued',
                            FormatIIStatus: 'Not Issued',
                            FormatIIIStatus: 'Not Issued',
                            InternalInspectionStatus: 'No',
                            BaseLineUTG: 'No',
                            FinalSystemAcceptance: 'Not accept',
                            DocumentDrawing: '',
                            Remarks: '',
                          })
                        }
                        style={{
                          padding: '5px 12px',
                          fontSize: '11.5px',
                          fontWeight: 700,
                          background: 'var(--ac)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '5px',
                          cursor: 'pointer',
                        }}
                      >
                        ➕ Add Equipment to {activeUnit.name}
                      </button>
                    )}
                  </div>

                  <div className="tools">
                    <input
                      placeholder="🔍 Search tag, description, sub-unit, Base Line UTG, Document/Drawing, remarks…"
                      value={systemSearch}
                      onChange={(e) => setSystemSearch(e.target.value)}
                    />
                    <select
                      value={systemStatusFilter}
                      onChange={(e) => setSystemStatusFilter(e.target.value)}
                    >
                      <option value="">All Statuses</option>
                      <option value="Completed">Completed</option>
                      <option value="In progress">In progress</option>
                      <option value="Not started">Not started</option>
                    </select>
                  </div>

                  {activeUnit.items.length === 0 ? (
                    <div className="empty">No equipment in {activeUnit.name} yet. Click &quot;+ Add Equipment&quot; above to add records.</div>
                  ) : (
                    <div className="tw">
                      <table className="nrep-table">
                        <thead>
                          <tr>
                            <th>Tag No.</th>
                            {activeUnit.name === 'UTILITY' && <th>Sub-Unit</th>}
                            <th>Description</th>
                            <th>Type</th>
                            <th>Status</th>
                            <th>Progress</th>
                            {STATUS_COLUMNS.map((col) => (
                              <th key={col.key}>{col.short}</th>
                            ))}
                            <th>Document/Drawing</th>
                            {isEditor && <th style={{ textAlign: 'center' }}>Action</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {activeUnit.items
                            .filter((r) => {
                              const q = systemSearch.toLowerCase();
                              const matchesSearch =
                                !q || Object.values(r).join(' ').toLowerCase().includes(q);
                              const matchesFilter =
                                !systemStatusFilter || getEquipmentOverallStatus(r) === systemStatusFilter;
                              return matchesSearch && matchesFilter;
                            })
                            .map((r) => {
                              const overall = getEquipmentOverallStatus(r);
                              const eqPct = calculateProgress([r]);
                              return (
                                <tr key={r.id}>
                                  <td>
                                    <a href={`#eq-${encodeURIComponent(r.EquipmentTagNo)}`}>
                                      <b>{r.EquipmentTagNo}</b>
                                    </a>
                                  </td>
                                  {activeUnit.name === 'UTILITY' && (
                                    <td>
                                      <span className="c a" style={{ fontWeight: 700 }}>
                                        {r.SubUnit || r.SystemNo}
                                      </span>
                                    </td>
                                  )}
                                  <td>{r.EquipmentDescription || '—'}</td>
                                  <td>{r.EquipmentType || '—'}</td>
                                  <td>{renderStatusChip(overall === 'Not started' ? '' : overall)}</td>
                                  <td>
                                    <span className={`pl ${eqPct === 100 ? 'g' : eqPct > 0 ? 'a' : ''}`}>
                                      {eqPct}%
                                    </span>
                                  </td>
                                  {STATUS_COLUMNS.map((col) => {
                                    const val = (r[col.key] as string) || col.pendingValue;
                                    return (
                                      <td key={col.key}>
                                        {isEditor ? (
                                          <select
                                            value={val}
                                            style={{
                                              fontSize: '11px',
                                              padding: '3px 6px',
                                              borderRadius: '4px',
                                              border: '1px solid #cbd5e1',
                                              background: isDone(val) ? '#f0fdf4' : '#fffbeb',
                                              color: isDone(val) ? '#15803d' : '#b45309',
                                              fontWeight: 600,
                                              cursor: 'pointer',
                                            }}
                                            title={`Change ${col.label}`}
                                            onChange={async (e) => {
                                              try {
                                                await updateEquipmentField(r.id, col.key, e.target.value);
                                              } catch (err: any) {
                                                console.error(err.message);
                                              }
                                            }}
                                          >
                                            {col.options.map((opt) => (
                                              <option key={opt} value={opt}>
                                                {opt}
                                              </option>
                                            ))}
                                          </select>
                                        ) : (
                                          renderStatusChip(val)
                                        )}
                                      </td>
                                    );
                                  })}
                                  <td>{renderDocumentDrawing(r.DocumentDrawing)}</td>
                                  {isEditor && (
                                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                      <button
                                        type="button"
                                        className="btn btn-sm"
                                        style={{
                                          padding: '3px 8px',
                                          fontSize: '11px',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '4px',
                                          background: '#f0f7ff',
                                          color: '#0284c7',
                                          borderColor: '#bae6fd',
                                          borderRadius: '4px',
                                          cursor: 'pointer',
                                        }}
                                        title="Edit equipment record"
                                        onClick={() => setEditingEquipment(r)}
                                      >
                                        Edit
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* LEVEL 3: SUB-UNIT / SYSTEM VIEW WITH EQUIPMENT TABLE */}
        {viewLevel === 's' && activeUnit && activeSystem && (
          <>
            <div className="bc">
              <a href="#" onClick={goToHome}>NREP Project</a> › <a href={`#${activeUnit.id}`}>{activeUnit.name}</a> › {activeSystem.name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
              <h2 className="t" style={{ margin: 0 }}>
                {activeUnit.name === 'UTILITY' ? `Sub-Unit: ${activeSystem.name} (UTILITY)` : activeSystem.name}
              </h2>
              {isEditor && (
                <button
                  type="button"
                  onClick={() =>
                    setEditingEquipment({
                      id: '',
                      Unit: activeUnit.name,
                      SubUnit: activeUnit.name === 'UTILITY' ? activeSystem.name : '',
                      SystemNo: activeSystem.name,
                      EquipmentTagNo: '',
                      EquipmentDescription: '',
                      EquipmentType: '',
                      FormatIStatus: 'Not Issued',
                      FormatIIStatus: 'Not Issued',
                      FormatIIIStatus: 'Not Issued',
                      InternalInspectionStatus: 'No',
                      BaseLineUTG: 'No',
                      FinalSystemAcceptance: 'Not accept',
                      DocumentDrawing: '',
                      Remarks: '',
                    })
                  }
                  style={{
                    padding: '6px 14px',
                    fontSize: '12px',
                    fontWeight: 700,
                    background: 'var(--ac)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  ➕ Add Equipment to {activeSystem.name}
                </button>
              )}
            </div>

            {(() => {
              const compPct = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;
              const progPct = stats.total ? Math.round((stats.inProgress / stats.total) * 100) : 0;
              const notStartPct = stats.total ? Math.round((stats.notStarted / stats.total) * 100) : 0;

              return (
                <div className="kp">
                  {renderProfessionalKpiCard({
                    label: 'Equipment',
                    value: stats.total,
                    subtext: 'System equipment tags',
                    badgeText: '100%',
                    pctBar: 100,
                    theme: 'cyan',
                    icon: <Cpu size={13} />,
                    active: systemStatusFilter === '',
                    onClick: () => setSystemStatusFilter(''),
                    title: 'Show all equipment in system',
                  })}

                  {renderProfessionalKpiCard({
                    label: 'Completed',
                    value: stats.completed,
                    subtext: `${compPct}% of system tags`,
                    badgeText: `${compPct}%`,
                    pctBar: compPct,
                    theme: 'green',
                    icon: <CheckCircle2 size={13} />,
                    active: systemStatusFilter === 'Completed',
                    onClick: () => setSystemStatusFilter(systemStatusFilter === 'Completed' ? '' : 'Completed'),
                    title: 'Filter completed equipment',
                  })}

                  {renderProfessionalKpiCard({
                    label: 'In Progress',
                    value: stats.inProgress,
                    subtext: `${progPct}% under inspection`,
                    badgeText: `${progPct}%`,
                    pctBar: progPct,
                    theme: 'amber',
                    icon: <Clock size={13} />,
                    active: systemStatusFilter === 'In progress',
                    onClick: () => setSystemStatusFilter(systemStatusFilter === 'In progress' ? '' : 'In progress'),
                    title: 'Filter in progress equipment',
                  })}

                  {renderProfessionalKpiCard({
                    label: 'Not Started',
                    value: stats.notStarted,
                    subtext: `${notStartPct}% pending start`,
                    badgeText: `${notStartPct}%`,
                    pctBar: notStartPct,
                    theme: 'slate',
                    icon: <CircleDashed size={13} />,
                    active: systemStatusFilter === 'Not started',
                    onClick: () => setSystemStatusFilter(systemStatusFilter === 'Not started' ? '' : 'Not started'),
                    title: 'Filter not started equipment',
                  })}

                  {renderProfessionalKpiCard({
                    label: 'Stage Progress',
                    value: `${stats.progressPct}%`,
                    subtext: '6-stage system progress',
                    badgeText: 'Live',
                    pctBar: stats.progressPct,
                    theme: 'blue',
                    icon: <TrendingUp size={13} />,
                    active: false,
                    title: 'Overall stage progress in system',
                  })}
                </div>
              );
            })()}

            <div className="g2">
              <div className="cd overall-status-cd">
                <h3>Equipment status</h3>
                <div className="overall-status-body">
                  {renderDonutChart(stats)}
                </div>
              </div>
              <div className="cd">
                <h3>Stage-wise status</h3>
                {renderStageWiseBars(activeSystem.items)}
              </div>
            </div>

            <div className="cd">
              <h3>Equipment list (level 3) — click a tag for full detail</h3>
              <div className="tools">
                <input
                  id="q"
                  placeholder="Search tag, description, Base Line UTG, Document/Drawing, remarks…"
                  value={systemSearch}
                  onChange={(e) => setSystemSearch(e.target.value)}
                />
                <select
                  id="sf"
                  value={systemStatusFilter}
                  onChange={(e) => setSystemStatusFilter(e.target.value)}
                >
                  <option value="">All</option>
                  <option value="Completed">Completed</option>
                  <option value="In progress">In progress</option>
                  <option value="Not started">Not started</option>
                </select>
              </div>

              <div id="eqt">
                {activeSystem.items.length === 0 ? (
                  <div className="empty">No matching equipment.</div>
                ) : (
                  <div className="tw">
                    <table className="nrep-table">
                      <thead>
                        <tr>
                          <th>Tag No.</th>
                          <th>Description</th>
                          <th>Type</th>
                          <th>Status</th>
                          <th>Progress</th>
                          {STATUS_COLUMNS.map((col) => (
                            <th key={col.key}>{col.short}</th>
                          ))}
                          <th>Document/Drawing</th>
                          {isEditor && <th style={{ textAlign: 'center' }}>Action</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {activeSystem.items
                          .filter((r) => {
                            const q = systemSearch.toLowerCase();
                            const matchesSearch =
                              !q || Object.values(r).join(' ').toLowerCase().includes(q);
                            const matchesFilter =
                              !systemStatusFilter || getEquipmentOverallStatus(r) === systemStatusFilter;
                            return matchesSearch && matchesFilter;
                          })
                          .map((r) => {
                            const overall = getEquipmentOverallStatus(r);
                            const eqPct = calculateProgress([r]);
                            return (
                              <tr key={r.id}>
                                <td>
                                  <a href={`#eq-${encodeURIComponent(r.EquipmentTagNo)}`}>
                                    <b>{r.EquipmentTagNo}</b>
                                  </a>
                                </td>
                                <td>{r.EquipmentDescription || '—'}</td>
                                <td>{r.EquipmentType || '—'}</td>
                                <td>{renderStatusChip(overall === 'Not started' ? '' : overall)}</td>
                                <td>
                                  <span className={`pl ${eqPct === 100 ? 'g' : eqPct > 0 ? 'a' : ''}`}>
                                    {eqPct}%
                                  </span>
                                </td>
                                {STATUS_COLUMNS.map((col) => {
                                  const val = (r[col.key] as string) || col.pendingValue;
                                  return (
                                    <td key={col.key}>
                                      {isEditor ? (
                                        <select
                                          value={val}
                                          style={{
                                            fontSize: '11px',
                                            padding: '3px 6px',
                                            borderRadius: '4px',
                                            border: '1px solid #cbd5e1',
                                            background: isDone(val) ? '#f0fdf4' : '#fffbeb',
                                            color: isDone(val) ? '#15803d' : '#b45309',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                          }}
                                          title={`Change ${col.label}`}
                                          onChange={async (e) => {
                                            try {
                                              await updateEquipmentField(r.id, col.key, e.target.value);
                                            } catch (err: any) {
                                              console.error(err.message);
                                            }
                                          }}
                                        >
                                          {col.options.map((opt) => (
                                            <option key={opt} value={opt}>
                                              {opt}
                                            </option>
                                          ))}
                                        </select>
                                      ) : (
                                        renderStatusChip(val)
                                      )}
                                    </td>
                                  );
                                })}
                                <td>{renderDocumentDrawing(r.DocumentDrawing)}</td>
                                {isEditor && (
                                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                    <button
                                      type="button"
                                      className="btn btn-sm"
                                      style={{
                                        padding: '3px 8px',
                                        fontSize: '11px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        background: '#f0f7ff',
                                        color: '#0284c7',
                                        borderColor: '#bae6fd',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                      }}
                                      title="Edit equipment record"
                                      onClick={() => setEditingEquipment(r)}
                                    >
                                      Edit
                                    </button>
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* LEVEL 4: EQUIPMENT DETAIL (MATCHING REFERENCE pageE()) */}
        {viewLevel === 'e' && activeEquipment && (
          <>
            <div className="bc">
              <a href="#" onClick={goToHome}>NREP Project</a> ›{' '}
              <a href={`#${activeUnit?.id || ''}`}>{activeEquipment.Unit}</a> ›{' '}
              <a href={`#${activeSystem?.id || ''}`}>{activeEquipment.SystemNo}</a> ›{' '}
              {activeEquipment.EquipmentTagNo}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
              <h2 className="t" style={{ margin: 0 }}>{activeEquipment.EquipmentTagNo}</h2>
              {isEditor && (
                <button
                  type="button"
                  className="btn"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: '#0284c7',
                    color: '#ffffff',
                    border: '1px solid #0284c7',
                    fontWeight: 600,
                    fontSize: '13px',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                  }}
                  onClick={() => setEditingEquipment(activeEquipment)}
                >
                  Edit Equipment Details
                </button>
              )}
            </div>

            {/* Title card with 6-step pipeline */}
            <div className="cd">
              <h3>
                {activeEquipment.EquipmentDescription || ''} · {activeEquipment.EquipmentType || ''} ·{' '}
                {renderStatusChip(getEquipmentOverallStatus(activeEquipment))} ·{' '}
                <span className="pl g" style={{ fontSize: '11.5px' }}>
                  {calculateProgress([activeEquipment])}% Completed
                </span>
              </h3>

              <div className="pipe">
                {STATUS_COLUMNS.map((col) => {
                  const val = (activeEquipment[col.key] as string) || col.pendingValue;
                  const done = isDone(val);
                  const borderCls = done ? 'g' : 'a';

                  return (
                    <div key={col.key} className={`st ${borderCls}`}>
                      <span>{col.short}</span>
                      {isEditor ? (
                        <select
                          value={val}
                          style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            padding: '3px 6px',
                            borderRadius: '4px',
                            border: '1px solid #94a3b8',
                            background: done ? '#f0fdf4' : '#fffbeb',
                            color: done ? '#15803d' : '#b45309',
                            cursor: 'pointer',
                          }}
                          onChange={async (e) => {
                            try {
                              await updateEquipmentField(activeEquipment.id, col.key, e.target.value);
                            } catch (err: any) {
                              console.error(err.message);
                            }
                          }}
                        >
                          {col.options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <b>{val}</b>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Details Grid */}
            <div className="cd">
              <h3>Details</h3>
              <div className="dg">
                <div>
                  <label>Base Line UTG</label>
                  <div>
                    {isEditor ? (
                      <select
                        value={activeEquipment.BaseLineUTG || 'No'}
                        onChange={(e) => updateEquipmentField(activeEquipment.id, 'BaseLineUTG', e.target.value)}
                        style={{ width: '100%', padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#f8fafc', fontWeight: 600 }}
                      >
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                    ) : (
                      activeEquipment.BaseLineUTG || 'No'
                    )}
                  </div>
                </div>

                <div>
                  <label>Document/Drawing</label>
                  <div>
                    {isEditor ? (
                      <input
                        type="text"
                        defaultValue={activeEquipment.DocumentDrawing || ''}
                        placeholder="Drawing No. or Document URL"
                        onBlur={(e) => updateEquipmentField(activeEquipment.id, 'DocumentDrawing', e.target.value)}
                        style={{ width: '100%', padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#f8fafc' }}
                      />
                    ) : (
                      renderDocumentDrawing(activeEquipment.DocumentDrawing)
                    )}
                  </div>
                </div>

                <div>
                  <label>Format-I date</label>
                  <div>
                    {isEditor ? (
                      <input
                        type="date"
                        defaultValue={activeEquipment.FormatIDate || ''}
                        onBlur={(e) => updateEquipmentField(activeEquipment.id, 'FormatIDate', e.target.value)}
                        style={{ width: '100%', padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#f8fafc' }}
                      />
                    ) : (
                      activeEquipment.FormatIDate || '—'
                    )}
                  </div>
                </div>

                <div>
                  <label>Format-II date</label>
                  <div>
                    {isEditor ? (
                      <input
                        type="date"
                        defaultValue={activeEquipment.FormatIIDate || ''}
                        onBlur={(e) => updateEquipmentField(activeEquipment.id, 'FormatIIDate', e.target.value)}
                        style={{ width: '100%', padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#f8fafc' }}
                      />
                    ) : (
                      activeEquipment.FormatIIDate || '—'
                    )}
                  </div>
                </div>

                <div>
                  <label>Format-III date</label>
                  <div>
                    {isEditor ? (
                      <input
                        type="date"
                        defaultValue={activeEquipment.FormatIIIDate || ''}
                        onBlur={(e) => updateEquipmentField(activeEquipment.id, 'FormatIIIDate', e.target.value)}
                        style={{ width: '100%', padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#f8fafc' }}
                      />
                    ) : (
                      activeEquipment.FormatIIIDate || '—'
                    )}
                  </div>
                </div>

                <div>
                  <label>Punch points category closed</label>
                  <div>
                    {isEditor ? (
                      <input
                        type="text"
                        defaultValue={activeEquipment.PunchPointsCategoryClosed || ''}
                        onBlur={(e) =>
                          updateEquipmentField(activeEquipment.id, 'PunchPointsCategoryClosed', e.target.value)
                        }
                        style={{ width: '100%', padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#f8fafc' }}
                      />
                    ) : (
                      activeEquipment.PunchPointsCategoryClosed || '—'
                    )}
                  </div>
                </div>

                <div>
                  <label>Remarks</label>
                  <div>
                    {isEditor ? (
                      <input
                        type="text"
                        defaultValue={activeEquipment.Remarks || ''}
                        onBlur={(e) => updateEquipmentField(activeEquipment.id, 'Remarks', e.target.value)}
                        style={{ width: '100%', padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#f8fafc' }}
                      />
                    ) : (
                      activeEquipment.Remarks || '—'
                    )}
                  </div>
                </div>
              </div>

              {activeEquipment.DocumentDrawing && /^https?:\/\//i.test(activeEquipment.DocumentDrawing) && (
                <p style={{ marginTop: '14px' }}>
                  <a className="btn" href={activeEquipment.DocumentDrawing} target="_blank" rel="noopener noreferrer">
                    Open Document / Drawing ↗
                  </a>
                </p>
              )}
            </div>

            {/* Sibling navigation */}
            {(() => {
              const siblings = activeSystem ? activeSystem.items : [];
              const currIdx = siblings.findIndex((x) => x.id === activeEquipment.id);
              const prev = currIdx > 0 ? siblings[currIdx - 1] : null;
              const next = currIdx >= 0 && currIdx < siblings.length - 1 ? siblings[currIdx + 1] : null;

              return (
                <div className="nv">
                  <span>
                    {prev && (
                      <a href={`#eq-${encodeURIComponent(prev.EquipmentTagNo)}`}>
                        ← {prev.EquipmentTagNo}
                      </a>
                    )}
                  </span>
                  <a href={`#${activeSystem?.id || ''}`}>Back to system</a>
                  <span>
                    {next && (
                      <a href={`#eq-${encodeURIComponent(next.EquipmentTagNo)}`}>
                        {next.EquipmentTagNo} →
                      </a>
                    )}
                  </span>
                </div>
              );
            })()}
          </>
        )}

        {/* TASK VIEW: EXCEL & DATA MANAGEMENT TOOLS IN RIGHT PANE */}
        {viewLevel === 'tools' && (
          <div style={{ maxWidth: '1180px', margin: '0 auto' }}>
            <div className="bc">
              <a href="#" onClick={goToHome}>
                NREP Project
              </a>{' '}
              › Excel &amp; Data Tools
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px',
                marginBottom: '16px',
              }}
            >
              <div>
                <h1 style={{ margin: 0 }}>🛠️ Excel &amp; Data Management Tools</h1>
                <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: 'var(--mu)' }}>
                  Import updated Excel spreadsheets, download standardized 18-column templates (including Base Line UTG &amp; Document/Drawing), or export the live database ({equipment.length} equipment records).
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {(isAdmin || isEditor) && (
                  <button
                    type="button"
                    onClick={() => {
                      window.location.hash = 'admin';
                      setViewLevel('admin');
                    }}
                    style={{
                      background: 'var(--ac)',
                      color: '#fff',
                      border: 'none',
                      padding: '8px 14px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ⚙️ Open Live Database Editor
                  </button>
                )}
                <button
                  type="button"
                  onClick={goToHome}
                  style={{
                    background: 'var(--cd)',
                    color: 'var(--tx)',
                    border: '1px solid var(--bd)',
                    padding: '8px 14px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  ← Back to Dashboard
                </button>
              </div>
            </div>

            {excelNotice && (
              <div
                style={{
                  marginBottom: '16px',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: excelNotice.type === 'ok' ? '#dcfce7' : '#fee2e2',
                  color: excelNotice.type === 'ok' ? '#166534' : '#991b1b',
                  border: `1px solid ${excelNotice.type === 'ok' ? '#86efac' : '#fca5a5'}`,
                }}
              >
                <span>{excelNotice.text}</span>
                <button
                  type="button"
                  onClick={() => setExcelNotice(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    fontWeight: 700,
                  }}
                >
                  ✕
                </button>
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: '16px',
                marginBottom: '18px',
              }}
            >
              {/* Card 1: Upload Excel */}
              <div
                className="card"
                style={{
                  border: '1.5px dashed var(--ac)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  padding: '20px',
                }}
              >
                <div>
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>📊</div>
                  <h3 style={{ margin: '0 0 6px', fontSize: '15px', color: 'var(--tx)' }}>
                    Upload Updated Excel File
                  </h3>
                  <p style={{ fontSize: '12px', color: 'var(--mu)', lineHeight: 1.5, margin: '0 0 16px' }}>
                    Upload an <b>.xlsx</b>, <b>.xlsm</b>, or <b>.xls</b> spreadsheet. Existing equipment tags are updated automatically and new tags are added to Cloud Firestore.
                  </p>
                </div>
                {isEditor ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      width: '100%',
                      background: 'var(--ac)',
                      color: '#fff',
                      border: 'none',
                      padding: '10px 14px',
                      fontSize: '12.5px',
                      fontWeight: 700,
                      borderRadius: '6px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                    }}
                  >
                    <span>⬆️</span> Choose Excel File to Upload
                  </button>
                ) : (
                  <div
                    style={{
                      fontSize: '11.5px',
                      color: 'var(--am)',
                      background: 'var(--amb)',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      textAlign: 'center',
                    }}
                  >
                    🔒 Editor or Admin role required to upload Excel files.
                  </div>
                )}
              </div>

              {/* Card 2: Download Blank Template */}
              <div
                className="card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  padding: '20px',
                }}
              >
                <div>
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>📋</div>
                  <h3 style={{ margin: '0 0 6px', fontSize: '15px', color: 'var(--tx)' }}>
                    Download Blank Excel Template
                  </h3>
                  <p style={{ fontSize: '12px', color: 'var(--mu)', lineHeight: 1.5, margin: '0 0 16px' }}>
                    Download the standard NREP Excel template containing all 18 required column headers (including <b>Base Line UTG</b> and <b>Document/Drawing</b>) and sample rows.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  style={{
                    width: '100%',
                    background: 'var(--tr)',
                    color: 'var(--tx)',
                    border: '1px solid var(--bd)',
                    padding: '10px 14px',
                    fontSize: '12.5px',
                    fontWeight: 700,
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  <span>📥</span> Download Blank Template (.xlsx)
                </button>
              </div>

              {/* Card 3: Export Current Live Database */}
              <div
                className="card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  padding: '20px',
                }}
              >
                <div>
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>💾</div>
                  <h3 style={{ margin: '0 0 6px', fontSize: '15px', color: 'var(--tx)' }}>
                    Export Live Database to Excel
                  </h3>
                  <p style={{ fontSize: '12px', color: 'var(--mu)', lineHeight: 1.5, margin: '0 0 16px' }}>
                    Export all <b>{equipment.length}</b> equipment records with current inspection statuses, Base Line UTG, Document/Drawing, dates, and remarks.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleExcelDownload}
                  style={{
                    width: '100%',
                    background: '#059669',
                    color: '#fff',
                    border: 'none',
                    padding: '10px 14px',
                    fontSize: '12.5px',
                    fontWeight: 700,
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  <span>⬇️</span> Export All {equipment.length} Records (.xlsx)
                </button>
              </div>
            </div>

            <div className="card" style={{ padding: '18px 20px' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '13.5px', color: 'var(--tx)' }}>
                💡 Excel Formatting &amp; Column Guidelines (18 Columns)
              </h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: '12px',
                  fontSize: '12px',
                  color: 'var(--mu)',
                  lineHeight: 1.6,
                }}
              >
                <div>
                  • <b>Worksheet Name:</b> <code>Equipment Master</code> (or first sheet)
                  <br />• <b>Primary Key Column:</b> <code>Equipment Tag No.</code>
                </div>
                <div>
                  • <b>6 Tracked Stages:</b> Format-I, Format-II, Format-III, Internal Inspection Status, Base Line UTG, Final System Acceptance
                </div>
                <div>
                  • <b>Template Columns:</b> <code>Unit</code>, <code>Sub-Unit</code>, <code>System No.</code>, <code>Equipment Tag No.</code>, <code>Equipment Description</code>, <code>Equipment Type</code>, <code>Format-I/II/III Status &amp; Date</code>, <code>Internal Inspection Status</code>, <code>Base Line UTG</code>, <code>Punch Points Category Closed</code>, <code>Final System Acceptance</code>, <code>Document/Drawing</code>, <code>Remarks</code>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TASK VIEW: ADMIN & LIVE DATABASE CONSOLE IN RIGHT PANE */}
        {viewLevel === 'admin' && (
          <AdminPanel inline onClose={goToHome} />
        )}
      </main>

      {/* CLEAN EXECUTIVE FOOTER WITH LEFT NRL LOGO, CENTER COPYRIGHT, AND RIGHT LOGOUT BUTTON */}
      <footer className="nrep-footer">
        {/* Left Corner: NRL Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <img
            src="/assets/nrl-banner-logo.png"
            alt="NRL Logo"
            style={{
              height: '28px',
              width: 'auto',
              objectFit: 'contain',
              display: 'block',
            }}
          />
        </div>

        {/* Center: Copyright Notice */}
        <div
          style={{
            fontWeight: 600,
            letterSpacing: '0.02em',
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.92)',
          }}
        >
          © 2026 Numaligarh Refinery Limited (NRL)
        </div>

        {/* Right Corner: Logout / Sign In Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          {(profile || user) ? (
            <button id="lo" onClick={() => signOut()} title="Sign out of your account">
              ⏻ Logout
            </button>
          ) : (
            <button id="lo" onClick={() => setGuestMode(false)}>
              Sign In
            </button>
          )}
        </div>
      </footer>

      {/* ADMIN PANEL MODAL (FALLBACK IF OPENED AS MODAL) */}
      {showAdminPanel && <AdminPanel onClose={() => setShowAdminPanel(false)} />}

      {/* DIRECT IN-PLACE EQUIPMENT EDIT MODAL */}
      {editingEquipment && (
        <EquipmentEditModal
          item={editingEquipment}
          onClose={() => setEditingEquipment(null)}
          onSave={async (updatedItem) => {
            await saveEquipment(updatedItem);
          }}
          onDelete={isAdmin ? deleteEquipment : undefined}
        />
      )}
    </>
  );
}
