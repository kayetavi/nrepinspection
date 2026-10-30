'use client';

import React, { useMemo, useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useAuth } from '@/lib/auth-context';
import { useEquipment } from '@/lib/equipment-context';
import {
  EquipmentItem,
  UNITS,
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

type ViewLevel = 'p' | 'u' | 's' | 'e';

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

  // Drawer tree state & active tab
  const [treeOpen, setTreeOpen] = useState(false);
  const [treeTab, setTreeTab] = useState<'hierarchy' | 'tools' | 'admin'>('hierarchy');
  const [treeFilter, setTreeFilter] = useState('');
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());

  // Global search & drop-down
  const [globalSearch, setGlobalSearch] = useState('');
  const [showGlobalResults, setShowGlobalResults] = useState(false);
  const [searchBoxOpen, setSearchBoxOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // In-place direct equipment editing & Modals
  const [editingEquipment, setEditingEquipment] = useState<EquipmentItem | null>(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);

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
  const [unitChartLayout, setUnitChartLayout] = useState<'vertical-twin' | 'vertical-stacked' | 'horizontal'>('vertical-twin');
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
    }
  };

  // Units list containing standard plus any dynamic units in rows
  const allUnitsList = useMemo(() => {
    const list = [...UNITS];
    equipment.forEach((item) => {
      if (item.Unit && !list.includes(item.Unit)) {
        list.push(item.Unit);
      }
    });
    return list;
  }, [equipment]);

  // Tree data structure
  const treeData = useMemo(() => {
    return allUnitsList.map((unitName, uIdx) => {
      const unitItems = equipment.filter((i) => i.Unit === unitName);
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

      // Default or empty hash always stays cleanly on Home (level 'p')
      if (!hash || hash === 'home' || hash === 'lg' || hash === 'login' || hash === '#') {
        setViewLevel('p');
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
          setSelectedSystemName(item.SystemNo);
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
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowGlobalResults(false);
        if (!searchInputRef.current?.value.trim()) {
          setSearchBoxOpen(false);
        }
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Scope equipment calculation
  const scopeItems = useMemo(() => {
    if (viewLevel === 'p') return equipment;
    if (viewLevel === 'u' && selectedUnitName) return equipment.filter((i) => i.Unit === selectedUnitName);
    if (viewLevel === 's' && selectedUnitName && selectedSystemName) {
      return equipment.filter((i) => i.Unit === selectedUnitName && i.SystemNo === selectedSystemName);
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

  // Excel Upload Handler matching reference HTML
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
      const linkIndex = headers.findIndex((h) => /^(link|hyperlink|url)/i.test(h));

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

        const cell = ws[XLSX.utils.encode_cell({ r, c: tagIndex })];
        if (cell && cell.l && cell.l.Target) obj.Link = cell.l.Target;
        else if (linkIndex >= 0 && obj[headers[linkIndex]]) obj.Link = obj[headers[linkIndex]];

        rows.push(obj);
      }

      const res = await importFromExcel(rows);
      window.location.hash = '';
      alert(`${rows.length} equipment loaded and synced with Cloud Firestore! (${res.added} added, ${res.updated} updated)`);
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Excel Download Handler
  const handleExcelDownload = () => {
    const H = [
      'Unit',
      'Area / Package',
      'System No.',
      'Equipment Tag No.',
      'Equipment Description',
      'Equipment Type',
      'RFI No.',
      'Format-I Status',
      'Format-I Date',
      'Format-II Status',
      'Format-II Date',
      'Format-III Status',
      'Format-III Date',
      'Category-A Status',
      'Internal Inspection Status',
      'Media Filling Clearance',
      'Punch Points Category Closed',
      'Final System Acceptance',
      'Last Inspection Date',
      'Responsible Agency / Person',
      'Remarks',
      'Link',
    ];

    const data = equipment.map((r) => [
      r.Unit || '',
      r.AreaPackage || '',
      r.SystemNo || '',
      r.EquipmentTagNo || '',
      r.EquipmentDescription || '',
      r.EquipmentType || '',
      r.RFINo || '',
      r.FormatIStatus || '',
      r.FormatIDate || '',
      r.FormatIIStatus || '',
      r.FormatIIDate || '',
      r.FormatIIIStatus || '',
      r.FormatIIIDate || '',
      r.CategoryAStatus || '',
      r.InternalInspectionStatus || '',
      r.MediaFillingClearance || '',
      r.PunchPointsCategoryClosed || '',
      r.FinalSystemAcceptance || '',
      r.LastInspectionDate || '',
      r.ResponsibleAgency || '',
      r.Remarks || '',
      r.Link || '',
    ]);

    const ws = XLSX.utils.aoa_to_sheet([['NREP UTILITY EQUIPMENT LIST'], H, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Equipment Master');
    XLSX.writeFile(wb, 'NREP_Inspection_Equipment_Tracker_updated.xlsx');
  };

  // Excel Template Download Handler
  const handleDownloadTemplate = () => {
    const H = [
      'Unit',
      'Area / Package',
      'System No.',
      'Equipment Tag No.',
      'Equipment Description',
      'Equipment Type',
      'RFI No.',
      'Format-I Status',
      'Format-I Date',
      'Format-II Status',
      'Format-II Date',
      'Format-III Status',
      'Format-III Date',
      'Category-A Status',
      'Internal Inspection Status',
      'Media Filling Clearance',
      'Punch Points Category Closed',
      'Final System Acceptance',
      'Last Inspection Date',
      'Responsible Agency / Person',
      'Remarks',
      'Link',
    ];

    const sampleRows = [
      [
        'Unit-1 (Crude Distillation)',
        'ISBL Area A',
        'System-01 (Cooling Water)',
        '01-P-101A',
        'Crude Feed Pump A',
        'Pump',
        'RFI-CDU-001',
        'Completed',
        '2026-03-15',
        'Completed',
        '2026-03-20',
        'In progress',
        '',
        'Not started',
        'Not started',
        'Not started',
        'Not started',
        'Not started',
        '2026-03-20',
        'L&T Commissioning Team',
        'Vibration check completed',
        'https://example.com/docs/01-P-101A.pdf',
      ],
      [
        'Unit-1 (Crude Distillation)',
        'ISBL Area A',
        'System-01 (Cooling Water)',
        '01-P-101B',
        'Crude Feed Pump B',
        'Pump',
        'RFI-CDU-002',
        'In progress',
        '2026-03-18',
        'Not started',
        '',
        'Not started',
        '',
        'Not started',
        'Not started',
        'Not started',
        'Not started',
        'Not started',
        '2026-03-18',
        'L&T Commissioning Team',
        'Alignment under progress',
        '',
      ],
    ];

    const ws = XLSX.utils.aoa_to_sheet([['NREP UTILITY EQUIPMENT LIST - TEMPLATE'], H, ...sampleRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Equipment Master');
    XLSX.writeFile(wb, 'NREP_Equipment_Upload_Template.xlsx');
  };

  // Search Results Filtering
  const globalSearchResults = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    if (q.length < 2) return null;

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
  const renderDonutChart = (s: { total: number; completed: number; inProgress: number; notStarted: number }) => {
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

    const completedPct = Math.round((s.completed / t) * 100);

    return (
      <>
        <div className="dn">
          <svg viewBox="0 0 36 36" width="140" height="140">
            <g transform="rotate(-90 18 18)">{circleElements}</g>
            <text x="18" y="19" textAnchor="middle" fontSize="6" fontWeight="700" fill="currentColor">
              {completedPct}%
            </text>
            <text x="18" y="23.5" textAnchor="middle" fontSize="2.4" fill="currentColor">
              completed
            </text>
          </svg>
          <div className="dl">
            <div>
              <b>{s.completed}</b>Completed
            </div>
            <div>
              <b>{s.inProgress}</b>In progress
            </div>
            <div>
              <b>{s.notStarted}</b>Not started
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
        {STATUS_COLUMNS.map((col, idx) => {
          let done = 0;
          let open = 0;
          let notStarted = 0;
          let na = 0;

          items.forEach((r) => {
            const val = ((r[col.key] as string) || '').trim().toLowerCase();
            if (!val || val === 'not started') notStarted++;
            else if (val === 'not applicable') na++;
            else if (isDone(val)) done++;
            else open++;
          });

          const totalApplicable = t - na;

          return (
            <div key={col.key} className="sr">
              <span>{col.short}</span>
              <div className="sb">
                {done > 0 && (
                  <i
                    title={`Done: ${done}`}
                    style={{ width: `${(done / t) * 100}%`, background: 'var(--gr)' }}
                  />
                )}
                {open > 0 && (
                  <i
                    title={`Pending / Open: ${open}`}
                    style={{ width: `${(open / t) * 100}%`, background: 'var(--am)' }}
                  />
                )}
                {notStarted > 0 && (
                  <i
                    title={`Not started: ${notStarted}`}
                    style={{ width: `${(notStarted / t) * 100}%`, background: 'var(--sl)' }}
                  />
                )}
                {na > 0 && (
                  <i
                    title={`N/A: ${na}`}
                    style={{ width: `${(na / t) * 100}%`, background: 'var(--bd)' }}
                  />
                )}
              </div>
              <b>
                {done}/{totalApplicable}
              </b>
            </div>
          );
        })}
        <div className="lg">
          <span>
            <i style={{ background: 'var(--gr)' }}></i>Done
          </span>
          <span>
            <i style={{ background: 'var(--am)' }}></i>Pending / Open
          </span>
          <span>
            <i style={{ background: 'var(--sl)' }}></i>Not started
          </span>
          <span>
            <i style={{ background: 'var(--bd)' }}></i>N/A
          </span>
        </div>
      </>
    );
  };

  // Segmented bar for matrix table rows
  const renderMiniProgressBar = (items: EquipmentItem[]) => {
    const t = items.length || 1;
    let d = 0;
    let p = 0;
    items.forEach((r) => {
      const st = getEquipmentOverallStatus(r);
      if (st === 'Completed') d++;
      else if (st === 'In progress') p++;
    });
    const n = t - d - p;

    return (
      <div className="sb">
        {d > 0 && <i title={`Completed: ${d}`} style={{ width: `${(d / t) * 100}%`, background: 'var(--gr)' }} />}
        {p > 0 && <i title={`In progress: ${p}`} style={{ width: `${(p / t) * 100}%`, background: 'var(--am)' }} />}
        {n > 0 && <i title={`Not started: ${n}`} style={{ width: `${(n / t) * 100}%`, background: 'var(--sl)' }} />}
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

    // Overview summary metrics
    const totalUnits = treeData.length;
    const completedUnits = treeData.filter((u) => calculateProgress(u.items) === 100).length;
    const avgProgress = totalUnits
      ? Math.round(treeData.reduce((acc, u) => acc + calculateProgress(u.items), 0) / totalUnits)
      : 0;

    const pillarAreaHeight = 220;

    return (
      <div className="cd" style={{ marginBottom: '14px' }}>
        {/* Card Header with Title, Layout Switcher, Metric Switcher, and Sort */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
            marginBottom: '14px',
            borderBottom: '1px solid var(--bd)',
            paddingBottom: '12px',
          }}
        >
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: '13.5px',
                fontWeight: 700,
                color: 'var(--tx)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                textTransform: 'none',
                letterSpacing: '0.2px',
              }}
            >
              <span>📊 Unit-Wise Vertical Pillar Chart</span>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'var(--ac)',
                  background: 'var(--tr)',
                  border: '1px solid var(--bd)',
                  padding: '2px 8px',
                  borderRadius: '12px',
                }}
              >
                Completed vs Remaining
              </span>
            </h3>
            <div style={{ fontSize: '11.5px', color: 'var(--mu)', marginTop: '3px' }}>
              Vertical pillar / column chart showing percentage completed (% Completed) vs percentage remaining (% Remaining) for every unit.
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {/* View Layout Toggle: Vertical Pillars (Default) vs Stacked Pillar vs Horizontal */}
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
                  padding: '4px 9px',
                  fontSize: '11.5px',
                  fontWeight: unitChartLayout === 'vertical-twin' ? 700 : 500,
                  background: unitChartLayout === 'vertical-twin' ? 'var(--ac)' : 'transparent',
                  color: unitChartLayout === 'vertical-twin' ? '#fff' : 'var(--tx)',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  transition: 'all 0.15s ease',
                }}
                title="Vertical Side-by-Side Pillars: Completed vs Remaining"
              >
                <span>🏛️</span>
                <span>Vertical Pillars (Completed vs Remaining)</span>
              </button>

              <button
                type="button"
                onClick={() => setUnitChartLayout('vertical-stacked')}
                style={{
                  padding: '4px 9px',
                  fontSize: '11.5px',
                  fontWeight: unitChartLayout === 'vertical-stacked' ? 700 : 500,
                  background: unitChartLayout === 'vertical-stacked' ? 'var(--ac)' : 'transparent',
                  color: unitChartLayout === 'vertical-stacked' ? '#fff' : 'var(--tx)',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  transition: 'all 0.15s ease',
                }}
                title="Vertical Stacked 100% Pillar"
              >
                <span>📊</span>
                <span>Stacked Pillars</span>
              </button>

              <button
                type="button"
                onClick={() => setUnitChartLayout('horizontal')}
                style={{
                  padding: '4px 9px',
                  fontSize: '11.5px',
                  fontWeight: unitChartLayout === 'horizontal' ? 700 : 500,
                  background: unitChartLayout === 'horizontal' ? 'var(--ac)' : 'transparent',
                  color: unitChartLayout === 'horizontal' ? '#fff' : 'var(--tx)',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  transition: 'all 0.15s ease',
                }}
                title="Horizontal Bars"
              >
                <span>📋</span>
                <span>Horizontal Bars</span>
              </button>
            </div>

            <input
              type="text"
              placeholder="🔍 Search unit..."
              value={unitChartSearch}
              onChange={(e) => setUnitChartSearch(e.target.value)}
              style={{
                padding: '4px 8px',
                fontSize: '12px',
                width: '130px',
                borderRadius: '4px',
                border: '1px solid var(--bd)',
              }}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--mu)' }}>
              <span>Metric:</span>
              <select
                value={unitMetricType}
                onChange={(e) => setUnitMetricType(e.target.value as any)}
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  borderRadius: '4px',
                  border: '1px solid var(--bd)',
                  background: 'var(--cd)',
                }}
              >
                <option value="stage">Stage Inspection Progress %</option>
                <option value="equip">Equipment Acceptance %</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--mu)' }}>
              <span>Sort:</span>
              <select
                value={unitSortBy}
                onChange={(e) => setUnitSortBy(e.target.value as any)}
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  borderRadius: '4px',
                  border: '1px solid var(--bd)',
                  background: 'var(--cd)',
                }}
              >
                <option value="progress-desc">Highest % Done ↓</option>
                <option value="progress-asc">Lowest % Done (Most Remaining) ↑</option>
                <option value="pending-desc">Highest % Remaining ↓</option>
                <option value="name">Unit Name (A-Z)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Quick Summary Pill Strip */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '8px',
            marginBottom: '14px',
          }}
        >
          <div style={{ background: 'var(--tr)', padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--bd)' }}>
            <span style={{ fontSize: '10.5px', color: 'var(--mu)', textTransform: 'uppercase', display: 'block' }}>Total Units</span>
            <b style={{ fontSize: '15px', color: 'var(--tx)' }}>{totalUnits} Units</b>
          </div>
          <div style={{ background: 'var(--tr)', padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--bd)' }}>
            <span style={{ fontSize: '10.5px', color: 'var(--mu)', textTransform: 'uppercase', display: 'block' }}>Avg Unit Progress</span>
            <b style={{ fontSize: '15px', color: 'var(--ac)' }}>{avgProgress}% Done</b>
          </div>
          <div style={{ background: 'var(--tr)', padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--bd)' }}>
            <span style={{ fontSize: '10.5px', color: 'var(--mu)', textTransform: 'uppercase', display: 'block' }}>100% Completed</span>
            <b style={{ fontSize: '15px', color: 'var(--gr)' }}>{completedUnits} / {totalUnits}</b>
          </div>
          <div style={{ background: 'var(--tr)', padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--bd)' }}>
            <span style={{ fontSize: '10.5px', color: 'var(--mu)', textTransform: 'uppercase', display: 'block' }}>Work Pending</span>
            <b style={{ fontSize: '15px', color: '#dc2626' }}>{totalUnits - completedUnits} Units</b>
          </div>
        </div>

        {/* MAIN CHART BODY */}
        {unitStats.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px', color: 'var(--mu)', fontSize: '13px' }}>
            No matching units found.
          </div>
        ) : unitChartLayout === 'vertical-twin' || unitChartLayout === 'vertical-stacked' ? (
          /* VERTICAL PILLAR / COLUMN CHART */
          <div
            style={{
              background: 'var(--cd)',
              border: '1px solid var(--bd)',
              borderRadius: '8px',
              padding: '16px 12px 14px 10px',
              position: 'relative',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px',
                fontSize: '11px',
                color: 'var(--mu)',
                paddingLeft: '44px',
              }}
            >
              <span>
                💡 <b>Pillar Chart:</b> Vertical height directly represents percentage (0% to 100%). Hover for complete details or click unit name to open.
              </span>
              <span>
                Showing <b>{unitStats.length}</b> units
              </span>
            </div>

            {/* Scrollable Container with Y-Axis and Columns */}
            <div
              style={{
                display: 'flex',
                overflowX: 'auto',
                paddingBottom: '10px',
                position: 'relative',
              }}
            >
              {/* Left Y-Axis */}
              <div
                style={{
                  width: '42px',
                  minWidth: '42px',
                  height: `${pillarAreaHeight}px`,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  alignItems: 'flex-end',
                  paddingRight: '6px',
                  borderRight: '2px solid var(--bd)',
                  fontSize: '10.5px',
                  fontWeight: 600,
                  color: 'var(--mu)',
                  userSelect: 'none',
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
                  minWidth: `${Math.max(600, unitStats.length * (unitChartLayout === 'vertical-twin' ? 84 : 68))}px`,
                }}
              >
                {/* Horizontal Dashed Grid Lines aligned with Y-Axis marks */}
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
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
                    top: `${pillarAreaHeight * 0.25}px`,
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
                    top: `${pillarAreaHeight * 0.5}px`,
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
                    top: `${pillarAreaHeight * 0.75}px`,
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
                    top: `${pillarAreaHeight}px`,
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
                    height: `${pillarAreaHeight}px`,
                    padding: '0 12px',
                    gap: unitChartLayout === 'vertical-twin' ? '14px' : '12px',
                    position: 'relative',
                    zIndex: 2,
                  }}
                >
                  {unitStats.map((item) => {
                    const doneHeight = Math.max(4, Math.round((item.donePct / 100) * pillarAreaHeight));
                    const bakiHeight = Math.max(4, Math.round((item.bakiPct / 100) * pillarAreaHeight));
                    const isHovered = hoveredUnitPillar === item.unit.id;

                    return (
                      <div
                        key={item.unit.id}
                        onMouseEnter={() => setHoveredUnitPillar(item.unit.id)}
                        onMouseLeave={() => setHoveredUnitPillar(null)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          height: '100%',
                          minWidth: unitChartLayout === 'vertical-twin' ? '72px' : '58px',
                          position: 'relative',
                          cursor: 'pointer',
                          background: isHovered ? 'rgba(20, 89, 143, 0.05)' : 'transparent',
                          borderRadius: '6px 6px 0 0',
                          padding: '0 4px',
                          transition: 'background 0.15s ease',
                        }}
                        onClick={() => {
                          if (typeof window !== 'undefined') {
                            window.location.hash = item.unit.id;
                          }
                        }}
                      >
                        {/* Interactive Hover Tooltip Popover */}
                        {isHovered && (
                          <div
                            style={{
                              position: 'absolute',
                              bottom: `${Math.max(doneHeight, bakiHeight) + 12}px`,
                              left: '50%',
                              transform: 'translateX(-50%)',
                              background: '#0f172a',
                              color: '#fff',
                              borderRadius: '6px',
                              padding: '8px 12px',
                              fontSize: '11px',
                              lineHeight: '1.4',
                              boxShadow: '0 10px 25px -5px rgba(0,0,0,0.4)',
                              zIndex: 100,
                              whiteSpace: 'nowrap',
                              pointerEvents: 'none',
                              border: '1px solid rgba(255,255,255,0.1)',
                            }}
                          >
                            <div style={{ fontWeight: 700, fontSize: '12px', marginBottom: '4px', color: '#38bdf8' }}>
                              {item.unit.name}
                            </div>
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '2px' }}>
                              <span style={{ color: '#4ade80' }}>● % Completed:</span>
                              <b>{item.donePct}% ({item.doneCount}/{item.totalCount})</b>
                            </div>
                            {item.inProgPct > 0 && (
                              <div style={{ display: 'flex', gap: '8px', marginBottom: '2px' }}>
                                <span style={{ color: '#facc15' }}>● % In Progress:</span>
                                <b>{item.inProgPct}% ({item.inProgCount})</b>
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
                              <span style={{ color: '#f87171' }}>● % Remaining:</span>
                              <b>{item.bakiPct}% ({item.bakiCount} remaining)</b>
                            </div>
                            <div style={{ fontSize: '10px', color: '#94a3b8', borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: '3px' }}>
                              Equipment: {item.completedEq} of {item.totalEq} completed · Click to open
                            </div>
                          </div>
                        )}

                        {unitChartLayout === 'vertical-twin' ? (
                          /* TWIN VERTICAL PILLARS (COMPLETED vs REMAINING) */
                          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '100%' }}>
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
                                  fontSize: '10.5px',
                                  fontWeight: 800,
                                  color: 'var(--gr)',
                                  marginBottom: '3px',
                                  lineHeight: 1,
                                }}
                              >
                                {item.donePct}%
                              </span>
                              <div
                                style={{
                                  width: '26px',
                                  height: `${doneHeight}px`,
                                  background: 'linear-gradient(180deg, #22c55e 0%, #15803d 100%)',
                                  borderRadius: '4px 4px 0 0',
                                  boxShadow: isHovered
                                    ? '0 0 10px rgba(34, 197, 94, 0.6)'
                                    : '0 2px 5px rgba(21, 128, 61, 0.25)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'flex-end',
                                  paddingBottom: '3px',
                                  transition: 'height 0.3s ease, box-shadow 0.15s ease',
                                }}
                              >
                                {doneHeight >= 32 && (
                                  <span
                                    style={{
                                      fontSize: '9px',
                                      fontWeight: 800,
                                      color: '#ffffff',
                                      textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                                      writingMode: 'horizontal-tb',
                                    }}
                                  >
                                    DONE
                                  </span>
                                )}
                              </div>
                              <span style={{ fontSize: '9.5px', fontWeight: 600, color: 'var(--gr)', marginTop: '2px' }}>
                                Done
                              </span>
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
                                  fontSize: '10.5px',
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
                                  width: '26px',
                                  height: `${bakiHeight}px`,
                                  background:
                                    item.bakiPct === 0
                                      ? '#cbd5e1'
                                      : 'linear-gradient(180deg, #f87171 0%, #dc2626 100%)',
                                  borderRadius: '4px 4px 0 0',
                                  boxShadow:
                                    item.bakiPct > 0 && isHovered
                                      ? '0 0 10px rgba(220, 38, 38, 0.6)'
                                      : item.bakiPct > 0
                                      ? '0 2px 5px rgba(220, 38, 38, 0.25)'
                                      : 'none',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'flex-end',
                                  paddingBottom: '3px',
                                  transition: 'height 0.3s ease, box-shadow 0.15s ease',
                                }}
                              >
                                {bakiHeight >= 32 && item.bakiPct > 0 && (
                                  <span
                                    style={{
                                      fontSize: '9px',
                                      fontWeight: 800,
                                      color: '#ffffff',
                                      textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                                    }}
                                  >
                                    REMAIN
                                  </span>
                                )}
                              </div>
                              <span
                                style={{
                                  fontSize: '9.5px',
                                  fontWeight: 600,
                                  color: item.bakiPct === 0 ? 'var(--mu)' : '#dc2626',
                                  marginTop: '2px',
                                }}
                              >
                                Pending
                              </span>
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
                                fontSize: '10.5px',
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
                                width: '36px',
                                height: `${pillarAreaHeight}px`,
                                background: 'var(--slb)',
                                borderRadius: '5px 5px 0 0',
                                overflow: 'hidden',
                                display: 'flex',
                                flexDirection: 'column-reverse',
                                border: '1px solid var(--bd)',
                                boxShadow: isHovered ? '0 0 10px rgba(20, 89, 143, 0.3)' : 'none',
                                transition: 'box-shadow 0.15s ease',
                              }}
                            >
                              {/* Bottom Done slice */}
                              <div
                                style={{
                                  height: `${(item.donePct / 100) * pillarAreaHeight}px`,
                                  background: 'var(--gr)',
                                  color: '#fff',
                                  fontSize: '9.5px',
                                  fontWeight: 700,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  overflow: 'hidden',
                                }}
                                title={`${item.donePct}% Done`}
                              >
                                {item.donePct >= 14 ? `${item.donePct}%` : ''}
                              </div>
                              {/* Middle In Progress slice */}
                              {item.inProgPct > 0 && (
                                <div
                                  style={{
                                    height: `${(item.inProgPct / 100) * pillarAreaHeight}px`,
                                    background: 'var(--am)',
                                    color: '#fff',
                                    fontSize: '9.5px',
                                    fontWeight: 700,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    overflow: 'hidden',
                                  }}
                                  title={`${item.inProgPct}% In Progress`}
                                >
                                  {item.inProgPct >= 14 ? `${item.inProgPct}%` : ''}
                                </div>
                              )}
                              {/* Top Remaining slice */}
                              {item.notStartedPct > 0 && (
                                <div
                                  style={{
                                    height: `${(item.notStartedPct / 100) * pillarAreaHeight}px`,
                                    background: '#cbd5e1',
                                    color: '#334155',
                                    fontSize: '9.5px',
                                    fontWeight: 700,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    overflow: 'hidden',
                                  }}
                                  title={`${item.notStartedPct}% Remaining`}
                                >
                                  {item.notStartedPct >= 18 ? `${item.notStartedPct}%` : ''}
                                </div>
                              )}
                            </div>
                            <span style={{ fontSize: '9.5px', color: 'var(--mu)', marginTop: '2px' }}>
                              {item.bakiPct}% Remaining
                            </span>
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
                    padding: '8px 12px 0 12px',
                    gap: unitChartLayout === 'vertical-twin' ? '14px' : '12px',
                  }}
                >
                  {unitStats.map((item) => (
                    <div
                      key={item.unit.id}
                      style={{
                        minWidth: unitChartLayout === 'vertical-twin' ? '72px' : '58px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        textAlign: 'center',
                      }}
                    >
                      <a
                        href={`#${item.unit.id}`}
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          color: 'var(--ac)',
                          textDecoration: 'none',
                          maxWidth: unitChartLayout === 'vertical-twin' ? '72px' : '58px',
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
                          fontSize: '9.5px',
                          color: 'var(--mu)',
                          background: 'var(--tr)',
                          border: '1px solid var(--bd)',
                          padding: '1px 4px',
                          borderRadius: '3px',
                          marginTop: '3px',
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
        ) : (
          /* HORIZONTAL BARS VIEW */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {unitStats.map((item) => (
              <div
                key={item.unit.id}
                style={{
                  background: 'var(--tr)',
                  border: '1px solid var(--bd)',
                  borderRadius: '6px',
                  padding: '9px 12px',
                }}
              >
                {/* Header row: Unit name, Systems, and Badges for % Done vs % Baki */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '6px',
                    marginBottom: '6px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <a
                      href={`#${item.unit.id}`}
                      style={{ fontWeight: 700, fontSize: '13px', color: 'var(--ac)' }}
                      title={`Click to drilldown to ${item.unit.name}`}
                    >
                      {item.unit.name}
                    </a>
                    <span
                      style={{
                        fontSize: '11px',
                        color: 'var(--mu)',
                        background: 'var(--cd)',
                        padding: '1px 6px',
                        borderRadius: '3px',
                        border: '1px solid var(--bd)',
                      }}
                    >
                      {item.totalEq} equip. · {item.unit.systems.length} systems
                    </span>
                  </div>

                  {/* Highlights of Percentage Completed & Percentage Remaining */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px' }}>
                    <span
                      style={{
                        color: 'var(--gr)',
                        background: 'var(--grb)',
                        padding: '2px 7px',
                        borderRadius: '4px',
                        fontWeight: 700,
                      }}
                      title={`${item.doneCount} of ${item.totalCount} completed`}
                    >
                      ✓ {item.donePct}% Completed
                    </span>

                    {item.inProgPct > 0 && (
                      <span
                        style={{
                          color: 'var(--am)',
                          background: 'var(--amb)',
                          padding: '2px 7px',
                          borderRadius: '4px',
                          fontWeight: 700,
                        }}
                        title={`${item.inProgCount} of ${item.totalCount} in progress`}
                      >
                        ⏳ {item.inProgPct}% In Progress
                      </span>
                    )}

                    <span
                      style={{
                        color: item.bakiPct === 0 ? 'var(--gr)' : '#b91c1c',
                        background: item.bakiPct === 0 ? 'var(--grb)' : '#fee2e2',
                        padding: '2px 7px',
                        borderRadius: '4px',
                        fontWeight: 700,
                      }}
                      title={`${item.bakiCount} remaining / pending`}
                    >
                      {item.bakiPct === 0 ? '🎉 0% Remaining (All Done)' : `✕ ${item.bakiPct}% Remaining (Pending)`}
                    </span>
                  </div>
                </div>

                {/* Visual Stacked Progress Bar */}
                <div
                  style={{
                    height: '18px',
                    background: 'var(--slb)',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    display: 'flex',
                    border: '1px solid rgba(0,0,0,0.06)',
                  }}
                  title={`${item.unit.name}: ${item.donePct}% Completed, ${item.inProgPct}% In Progress, ${item.bakiPct}% Remaining (${item.doneCount}/${item.totalCount})`}
                >
                  {/* Done / Completed Bar */}
                  {item.donePct > 0 && (
                    <div
                      style={{
                        width: `${item.donePct}%`,
                        background: 'var(--gr)',
                        color: '#fff',
                        fontSize: '10.5px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        transition: 'width 0.3s ease',
                      }}
                    >
                      {item.donePct >= 12 ? `${item.donePct}%` : ''}
                    </div>
                  )}

                  {/* In Progress Bar */}
                  {item.inProgPct > 0 && (
                    <div
                      style={{
                        width: `${item.inProgPct}%`,
                        background: 'var(--am)',
                        color: '#fff',
                        fontSize: '10.5px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        transition: 'width 0.3s ease',
                      }}
                    >
                      {item.inProgPct >= 12 ? `${item.inProgPct}%` : ''}
                    </div>
                  )}

                  {/* Remaining Bar */}
                  {item.notStartedPct > 0 && (
                    <div
                      style={{
                        width: `${item.notStartedPct}%`,
                        background: '#cbd5e1',
                        color: '#334155',
                        fontSize: '10.5px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        transition: 'width 0.3s ease',
                      }}
                    >
                      {item.notStartedPct >= 15 ? `${item.notStartedPct}% Remaining` : ''}
                    </div>
                  )}
                </div>

                {/* Sub-detail counts */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: '4px',
                    fontSize: '11px',
                    color: 'var(--mu)',
                  }}
                >
                  <span>
                    Status: <b>{item.completedEq}</b> completed · <b>{item.totalEq - item.completedEq}</b> remaining of{' '}
                    <b>{item.totalEq}</b> total equipment
                  </span>
                  <span>
                    Inspection Stages: <b>{item.doneCount}</b>/{item.totalCount} ({item.donePct}%) done
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="lg" style={{ marginTop: '14px', paddingTop: '10px', borderTop: '1px solid var(--bd)' }}>
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
          {!searchBoxOpen ? (
            <button
              type="button"
              id="gs-btn"
              title="Search tag, equipment, system, unit"
              aria-label="Open search"
              onClick={() => {
                setSearchBoxOpen(true);
                setTimeout(() => searchInputRef.current?.focus(), 20);
              }}
              style={{
                padding: '6px 9px',
                height: '30px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '5px',
              }}
            >
              <Search size={15} />
            </button>
          ) : (
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
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
                  }
                }}
                autoComplete="off"
              />
              <button
                type="button"
                title="Close search"
                aria-label="Close search"
                onClick={() => {
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
          )}

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

        {/* Segmented Sidebar Tabs: Units, Tools, and Admin */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--bd)',
            background: 'var(--tr)',
            padding: '6px 8px',
            gap: '4px',
          }}
        >
          <button
            type="button"
            onClick={() => setTreeTab('hierarchy')}
            style={{
              flex: 1,
              padding: '6px 6px',
              fontSize: '11px',
              fontWeight: treeTab === 'hierarchy' ? 700 : 500,
              background: treeTab === 'hierarchy' ? 'var(--cd)' : 'transparent',
              color: treeTab === 'hierarchy' ? 'var(--ac)' : 'var(--tx)',
              border: treeTab === 'hierarchy' ? '1px solid var(--bd)' : '1px solid transparent',
              borderRadius: '5px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
            }}
          >
            <span>📁</span>
            <span>Units</span>
          </button>

          <button
            type="button"
            onClick={() => setTreeTab('tools')}
            style={{
              flex: 1,
              padding: '6px 6px',
              fontSize: '11px',
              fontWeight: treeTab === 'tools' ? 700 : 500,
              background: treeTab === 'tools' ? 'var(--cd)' : 'transparent',
              color: treeTab === 'tools' ? 'var(--ac)' : 'var(--tx)',
              border: treeTab === 'tools' ? '1px solid var(--bd)' : '1px solid transparent',
              borderRadius: '5px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
            }}
          >
            <span>🛠️</span>
            <span>Tools</span>
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={() => setTreeTab('admin')}
              style={{
                flex: 1,
                padding: '6px 6px',
                fontSize: '11px',
                fontWeight: treeTab === 'admin' ? 700 : 500,
                background: treeTab === 'admin' ? 'var(--cd)' : 'transparent',
                color: treeTab === 'admin' ? 'var(--ac)' : 'var(--tx)',
                border: treeTab === 'admin' ? '1px solid var(--bd)' : '1px solid transparent',
                borderRadius: '5px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              <span>⚙️</span>
              <span>Admin</span>
            </button>
          )}
        </div>

        {/* TAB 1: UNITS & SYSTEMS HIERARCHY */}
        {treeTab === 'hierarchy' && (
          <div style={{ flex: 1, overflowY: 'auto', paddingBottom: '16px' }}>
            <div style={{ padding: '10px 12px 6px' }}>
              <input
                id="tq"
                placeholder="🔍 Search unit / system…"
                value={treeFilter}
                onChange={(e) => setTreeFilter(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>

            {/* Project root */}
            <div
              className={`tn ${viewLevel === 'p' ? 'on' : ''}`}
              onClick={goToHome}
            >
              <span className="tg"></span>
              <a href="#" onClick={(e) => { e.preventDefault(); goToHome(); }}>▣ NREP Project (All Units)</a>
              {renderPill(equipment)}
            </div>

            {/* Units and systems tree */}
            {treeData.map((u) => {
              const tf = treeFilter.toLowerCase();
              const unitMatches = u.name.toLowerCase().includes(tf);
              const matchedSystems = u.systems.filter(
                (s) => unitMatches || s.name.toLowerCase().includes(tf)
              );

              if (tf && !unitMatches && !matchedSystems.length) return null;

              const isExpanded = tf ? true : expandedUnits.has(u.id);

              return (
                <React.Fragment key={u.id}>
                  <div
                    className={`tn l1 ${viewLevel === 'u' && selectedUnitName === u.name ? 'on' : ''}`}
                  >
                    <button
                      className="tg"
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
                      {isExpanded ? '▾' : '▸'}
                    </button>
                    <a
                      href={`#${u.id}`}
                      onClick={() => setTreeOpen(false)}
                    >
                      {u.name}
                    </a>
                    {renderPill(u.items)}
                  </div>

                  {isExpanded &&
                    (tf ? matchedSystems : u.systems).map((s) => (
                      <div
                        key={s.id}
                        className={`tn l2 ${
                          viewLevel === 's' &&
                          selectedUnitName === u.name &&
                          selectedSystemName === s.name
                            ? 'on'
                            : ''
                        }`}
                      >
                        <a
                          href={`#${s.id}`}
                          title={s.name}
                          onClick={() => setTreeOpen(false)}
                        >
                          {s.name}
                        </a>
                        {renderPill(s.items)}
                      </div>
                    ))}
                </React.Fragment>
              );
            })}
          </div>
        )}

        {/* TAB 2: EXCEL & DATA MANAGEMENT TOOLS */}
        {treeTab === 'tools' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 12px 20px' }}>
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--tx)', marginBottom: '3px' }}>
                🛠️ Excel &amp; Data Tools
              </div>
              <div style={{ fontSize: '11px', color: 'var(--mu)', lineHeight: 1.4 }}>
                All Excel spreadsheet imports, exports, and blank template downloads are centralized here.
              </div>
            </div>

            {/* 1. Upload Excel Card */}
            <div
              style={{
                background: 'var(--tr)',
                border: '1px dashed var(--ac)',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '12px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '24px', marginBottom: '4px' }}>📊</div>
              <b style={{ fontSize: '12.5px', color: 'var(--tx)', display: 'block', marginBottom: '4px' }}>
                Upload Updated Excel File
              </b>
              <span style={{ fontSize: '11px', color: 'var(--mu)', display: 'block', marginBottom: '10px', lineHeight: 1.3 }}>
                Upload .xlsx, .xlsm, or .xls file. Automatically parses and updates Cloud Firestore database.
              </span>
              {isEditor ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    width: '100%',
                    background: 'var(--ac)',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 12px',
                    fontSize: '12px',
                    fontWeight: 700,
                    borderRadius: '5px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  <span>⬆️</span> Choose Excel to Upload
                </button>
              ) : (
                <div style={{ fontSize: '11px', color: 'var(--am)', background: 'var(--amb)', padding: '5px', borderRadius: '4px' }}>
                  🔒 Editor role required to upload Excel files.
                </div>
              )}
            </div>

            {/* 2. Download Excel Template Card */}
            <div
              style={{
                background: 'var(--cd)',
                border: '1px solid var(--bd)',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '12px',
              }}
            >
              <b style={{ fontSize: '12px', color: 'var(--tx)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span>📋</span> Download Blank Excel Template
              </b>
              <p style={{ fontSize: '11px', color: 'var(--mu)', margin: '0 0 10px', lineHeight: 1.35 }}>
                Standard blank Excel template with all 22 required column headers and sample equipment rows.
              </p>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                style={{
                  width: '100%',
                  background: 'var(--tr)',
                  border: '1px solid var(--bd)',
                  padding: '7px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  borderRadius: '5px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  color: 'var(--tx)',
                }}
              >
                <span>📥</span> Download Template (.xlsx)
              </button>
            </div>

            {/* 3. Export Current Database */}
            <div
              style={{
                background: 'var(--cd)',
                border: '1px solid var(--bd)',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '12px',
              }}
            >
              <b style={{ fontSize: '12px', color: 'var(--tx)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span>💾</span> Export Current Database
              </b>
              <p style={{ fontSize: '11px', color: 'var(--mu)', margin: '0 0 10px', lineHeight: 1.35 }}>
                Export all {equipment.length} equipment with updated inspection stages, dates, and remarks to Excel.
              </p>
              <button
                type="button"
                onClick={handleExcelDownload}
                style={{
                  width: '100%',
                  background: 'var(--tr)',
                  border: '1px solid var(--bd)',
                  padding: '7px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  borderRadius: '5px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  color: 'var(--tx)',
                }}
              >
                <span>⬇️</span> Export All Equipment (.xlsx)
              </button>
            </div>

            {/* 4. Column Guidelines Info */}
            <div
              style={{
                background: 'var(--tr)',
                border: '1px solid var(--bd)',
                borderRadius: '6px',
                padding: '10px',
                fontSize: '10.5px',
                color: 'var(--mu)',
                lineHeight: 1.45,
              }}
            >
              <b style={{ color: 'var(--tx)', display: 'block', marginBottom: '3px' }}>💡 Excel Formatting Guide:</b>
              <div>• Sheet name: <b>Equipment Master</b></div>
              <div>• Key column: <b>Equipment Tag No.</b></div>
              <div>• Status values: <b>Completed</b>, <b>In progress</b>, <b>Not started</b>, <b>Not applicable</b></div>
            </div>
          </div>
        )}

        {/* TAB 3: ADMIN TOOLS (FOR ADMINS ONLY) */}
        {treeTab === 'admin' && isAdmin && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 12px 20px' }}>
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--tx)', marginBottom: '3px' }}>
                ⚙️ Admin Administration
              </div>
              <div style={{ fontSize: '11px', color: 'var(--mu)', lineHeight: 1.4 }}>
                Manage team access, assign passwords, configure user roles, and audit system activities.
              </div>
            </div>

            {/* Launch Admin Console */}
            <button
              type="button"
              onClick={() => {
                setTreeOpen(false);
                setShowAdminPanel(true);
              }}
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
                marginBottom: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 2px 6px rgba(20, 89, 143, 0.3)',
              }}
            >
              <span>⚙️</span>
              <span>Open Full Admin Panel</span>
            </button>

            {/* Admin Capabilities Summary */}
            <div
              style={{
                background: 'var(--tr)',
                border: '1px solid var(--bd)',
                borderRadius: '6px',
                padding: '10px 12px',
                marginBottom: '14px',
                fontSize: '11px',
                lineHeight: 1.5,
              }}
            >
              <b style={{ color: 'var(--tx)', display: 'block', marginBottom: '4px' }}>Admin Capabilities:</b>
              <div>✓ Assign user passwords &amp; credentials</div>
              <div>✓ Change user roles (Admin / Editor / Viewer)</div>
              <div>✓ Approve or revoke team access</div>
              <div>✓ View live Firestore audit logs</div>
            </div>

            {/* Reset Database Button */}
            <div
              style={{
                background: '#fee2e2',
                border: '1px solid #fecaca',
                borderRadius: '6px',
                padding: '10px 12px',
              }}
            >
              <b style={{ fontSize: '11.5px', color: '#991b1b', display: 'block', marginBottom: '3px' }}>
                Reset Database
              </b>
              <span style={{ fontSize: '10.5px', color: '#7f1d1d', display: 'block', marginBottom: '8px', lineHeight: 1.3 }}>
                Restore all records to default factory sample data.
              </span>
              <button
                type="button"
                onClick={() => {
                  if (confirm('Return to sample data? All local modifications will be reset.')) {
                    resetToSampleData();
                    setTreeOpen(false);
                  }
                }}
                style={{
                  background: '#dc2626',
                  color: '#fff',
                  border: 'none',
                  padding: '6px 12px',
                  fontSize: '11px',
                  fontWeight: 700,
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                ↺ Reset to Sample Data
              </button>
            </div>
          </div>
        )}

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
          {isAdmin ? (
            <button
              type="button"
              onClick={() => {
                setTreeOpen(false);
                setShowAdminPanel(true);
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
              ⚙ Admin
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
                            <th>Last insp.</th>
                            <th>Link</th>
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
                                r.SystemNo?.toLowerCase().includes(q)
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
                                <td>{r.LastInspectionDate || '—'}</td>
                                <td>
                                  {r.Link ? (
                                    <a href={r.Link} target="_blank" rel="noopener noreferrer">
                                      Open ↗
                                    </a>
                                  ) : (
                                    ''
                                  )}
                                </td>
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
                {/* 2-Column Grid with Ring and Stage Bars */}
                <div className="g2">
                  <div className="cd">
                    <h3>Overall equipment status</h3>
                    {renderDonutChart(stats)}
                  </div>
                  <div className="cd">
                    <h3>Stage-wise status — all units</h3>
                    {renderStageWiseBars(equipment)}
                  </div>
                </div>

                {/* Unit-wise Progress & Completion Bar Chart (Completed vs Remaining) */}
                {renderUnitWiseProgressBarChart()}

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
                          <th style={{ minWidth: '150px' }}>Status</th>
                          {STATUS_COLUMNS.map((col) => (
                            <th key={col.key} className="ct" title="Pending equipment count">
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
                                  <a href={`#${u.id}`}>
                                    <b>{u.name}</b>
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
                    Stage columns show the number of equipment still pending (not done and not N/A). Click a name to drill
                    down.
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
                            <th>Last insp.</th>
                            <th>Link</th>
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
                                r.SystemNo?.toLowerCase().includes(q)
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
                                <td>{r.LastInspectionDate || '—'}</td>
                                <td>
                                  {r.Link ? (
                                    <a href={r.Link} target="_blank" rel="noopener noreferrer">
                                      Open ↗
                                    </a>
                                  ) : (
                                    ''
                                  )}
                                </td>
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

            {/* When NO KPI filter is active in Unit view: show standard unit overview */}
            {!kpiFilter && (
              <>
                <div className="g2">
                  <div className="cd">
                    <h3>Equipment status</h3>
                    {renderDonutChart(stats)}
                  </div>
                  <div className="cd">
                    <h3>Stage-wise status</h3>
                    {renderStageWiseBars(activeUnit.items)}
                  </div>
                </div>

                <div className="cd">
                  <h3>Systems in this unit (level 2)</h3>
                  {activeUnit.systems.length === 0 ? (
                    <div className="empty">No equipment in this unit yet. Add rows in Excel and upload.</div>
                  ) : (
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
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* LEVEL 3: SYSTEM VIEW WITH EQUIPMENT TABLE */}
        {viewLevel === 's' && activeUnit && activeSystem && (
          <>
            <div className="bc">
              <a href="#" onClick={goToHome}>NREP Project</a> › <a href={`#${activeUnit.id}`}>{activeUnit.name}</a> › {activeSystem.name}
            </div>
            <h2 className="t">{activeSystem.name}</h2>

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
                    subtext: '7-stage system progress',
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
              <div className="cd">
                <h3>Equipment status</h3>
                {renderDonutChart(stats)}
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
                  placeholder="Search tag, description, agency, remarks…"
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
                          {STATUS_COLUMNS.map((col) => (
                            <th key={col.key}>{col.short}</th>
                          ))}
                          <th>Last insp.</th>
                          <th>Link</th>
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
                                {STATUS_COLUMNS.map((col) => {
                                  const val = (r[col.key] as string) || '';
                                  return (
                                    <td key={col.key}>
                                      {isEditor ? (
                                        <select
                                          value={val}
                                          style={{
                                            fontSize: '11px',
                                            padding: '2px 4px',
                                            borderRadius: '4px',
                                            border: '1px solid #cbd5e1',
                                            background:
                                              val === 'Completed'
                                                ? '#f0fdf4'
                                                : val === 'In progress'
                                                ? '#fffbeb'
                                                : '#ffffff',
                                            color:
                                              val === 'Completed'
                                                ? '#15803d'
                                                : val === 'In progress'
                                                ? '#b45309'
                                                : '#475569',
                                            fontWeight: val ? 600 : 400,
                                            cursor: 'pointer',
                                          }}
                                          title={`Change ${col.label}`}
                                          onChange={async (e) => {
                                            try {
                                              await updateEquipmentField(r.id, col.key, e.target.value);
                                            } catch (err: any) {
                                              alert(err.message);
                                            }
                                          }}
                                        >
                                          {STATUS_OPTIONS.map((opt) => (
                                            <option key={opt} value={opt}>
                                              {opt || '—'}
                                            </option>
                                          ))}
                                        </select>
                                      ) : val ? (
                                        renderStatusChip(val)
                                      ) : (
                                        <span className="c">—</span>
                                      )}
                                    </td>
                                  );
                                })}
                                <td>{r.LastInspectionDate || '—'}</td>
                                <td>
                                  {r.Link ? (
                                    <a href={r.Link} target="_blank" rel="noopener noreferrer">
                                      Open ↗
                                    </a>
                                  ) : (
                                    ''
                                  )}
                                </td>
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

            {/* Title card with 7-step pipeline */}
            <div className="cd">
              <h3>
                {activeEquipment.EquipmentDescription || ''} · {activeEquipment.EquipmentType || ''} ·{' '}
                {renderStatusChip(getEquipmentOverallStatus(activeEquipment))}
              </h3>

              <div className="pipe">
                {STATUS_COLUMNS.map((col) => {
                  const val = (activeEquipment[col.key] as string) || '';
                  const done = isDone(val);
                  const prog = isInProgress(val);
                  const borderCls = done ? 'g' : prog ? 'a' : '';

                  return (
                    <div key={col.key} className={`st ${borderCls}`}>
                      <span>{col.short}</span>
                      {isEditor ? (
                        <select
                          value={val}
                          style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            padding: '3px 4px',
                            borderRadius: '4px',
                            border: '1px solid #94a3b8',
                            background:
                              val === 'Completed'
                                ? '#f0fdf4'
                                : val === 'In progress'
                                ? '#fffbeb'
                                : '#ffffff',
                            color:
                              val === 'Completed'
                                ? '#15803d'
                                : val === 'In progress'
                                ? '#b45309'
                                : '#334155',
                            cursor: 'pointer',
                          }}
                          onChange={async (e) => {
                            try {
                              await updateEquipmentField(activeEquipment.id, col.key, e.target.value);
                            } catch (err: any) {
                              alert(err.message);
                            }
                          }}
                        >
                          {STATUS_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt || '— Not started'}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <b>{val || 'Not started'}</b>
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
                  <label>RFI No.</label>
                  <div>
                    {isEditor ? (
                      <input
                        type="text"
                        defaultValue={activeEquipment.RFINo || ''}
                        onBlur={(e) => updateEquipmentField(activeEquipment.id, 'RFINo', e.target.value)}
                        style={{ width: '100%', padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#f8fafc' }}
                      />
                    ) : (
                      activeEquipment.RFINo || '—'
                    )}
                  </div>
                </div>

                <div>
                  <label>Area / Package</label>
                  <div>
                    {isEditor ? (
                      <input
                        type="text"
                        defaultValue={activeEquipment.AreaPackage || ''}
                        onBlur={(e) => updateEquipmentField(activeEquipment.id, 'AreaPackage', e.target.value)}
                        style={{ width: '100%', padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#f8fafc' }}
                      />
                    ) : (
                      activeEquipment.AreaPackage || '—'
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
                  <label>Last inspection</label>
                  <div>
                    {isEditor ? (
                      <input
                        type="date"
                        defaultValue={activeEquipment.LastInspectionDate || ''}
                        onBlur={(e) => updateEquipmentField(activeEquipment.id, 'LastInspectionDate', e.target.value)}
                        style={{ width: '100%', padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#f8fafc' }}
                      />
                    ) : (
                      activeEquipment.LastInspectionDate || '—'
                    )}
                  </div>
                </div>

                <div>
                  <label>Responsible agency / person</label>
                  <div>
                    {isEditor ? (
                      <input
                        type="text"
                        defaultValue={activeEquipment.ResponsibleAgency || ''}
                        onBlur={(e) => updateEquipmentField(activeEquipment.id, 'ResponsibleAgency', e.target.value)}
                        style={{ width: '100%', padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#f8fafc' }}
                      />
                    ) : (
                      activeEquipment.ResponsibleAgency || '—'
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

                <div>
                  <label>Document link (URL)</label>
                  <div>
                    {isEditor ? (
                      <input
                        type="text"
                        defaultValue={activeEquipment.Link || ''}
                        onBlur={(e) => updateEquipmentField(activeEquipment.id, 'Link', e.target.value)}
                        style={{ width: '100%', padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#f8fafc' }}
                      />
                    ) : (
                      activeEquipment.Link || '—'
                    )}
                  </div>
                </div>
              </div>

              <p style={{ marginTop: '14px' }}>
                {activeEquipment.Link ? (
                  <a className="btn" href={activeEquipment.Link} target="_blank" rel="noopener noreferrer">
                    Open linked document ↗
                  </a>
                ) : (
                  <span className="note">No link yet.</span>
                )}
              </p>
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

      {/* ADMIN PANEL */}
      {showAdminPanel && <AdminPanel onClose={() => setShowAdminPanel(false)} />}

      {/* DIRECT IN-PLACE EQUIPMENT EDIT MODAL */}
      {editingEquipment && (
        <EquipmentEditModal
          item={editingEquipment}
          onClose={() => setEditingEquipment(null)}
          onSave={async (updatedItem) => {
            await saveEquipment(updatedItem);
          }}
        />
      )}
    </>
  );
}
