'use client';

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { useAuth } from '@/lib/auth-context';
import { useEquipment } from '@/lib/equipment-context';
import {
  EquipmentItem,
  UNITS,
  UTILITY_SUB_UNITS,
  MSP_SUB_UNITS,
  resolveMspSubUnit,
  STATUS_COLUMNS,
  PROGRESS_STAGE_COLUMNS,
  STATUS_OPTIONS,
  StatusColumnConfig,
  isDone,
  isInProgress,
  getEquipmentOverallStatus,
  calculateProgress,
  isAllUnitsScope,
  getUserAllowedUnits,
  filterEquipmentByUserScope,
  getEquipmentHierarchyChain,
  formatEquipmentHierarchyPath,
  cleanHierarchyField,
} from '@/lib/types';
import AdminPanel, { AdminTabKey, AdminSubAction } from './AdminPanel';
import EquipmentEditModal from './EquipmentEditModal';
import InspectionReportModal from './InspectionReportModal';
import CloudFolderSyncModal from './CloudFolderSyncModal';
import {
  UploadProgressPopup,
  SweetSuccessPopup,
  SweetSuccessMetaItem,
  SweetWarningDeletePopup,
} from './SweetPopupModal';
import {
  parseEquipmentDocumentField,
  serializeEquipmentDocumentField,
  formatDocumentDrawingForExcel,
  getProviderBadgeMeta,
} from '@/lib/reportUtils';
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
  MessageSquare,
  MessageCircle,
  ChevronRight,
  FolderSync,
  FileText,
  Upload,
  FolderTree,
  FileSpreadsheet,
  Download,
  Database,
  Lock,
  Table2,
  Save,
  Trash2,
  RotateCcw,
} from 'lucide-react';

type ViewLevel = 'p' | 'u' | 's' | 'e' | 'tools' | 'admin';

export interface HierarchyTreeNode {
  id: string;
  key: string;
  name: string;
  pathLabel: string;
  levelType: 'subunit' | 'system' | 'subsystem';
  levelBadge: 'Sub-Unit' | 'System' | 'Sub-System';
  unitName: string;
  subUnitName: string;
  systemName: string;
  subSystemName: string;
  items: EquipmentItem[];
  directItems: EquipmentItem[];
  children: HierarchyTreeNode[];
  ancestorIds: string[];
}

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
  const canAccessLiveDatabase =
    isAdmin || profile?.role === 'lead_engineer';
  const {
    equipment: rawEquipment,
    unitsConfig,
    loading,
    error,
    updateEquipmentField,
    saveEquipment,
    deleteEquipment,
    importFromExcel,
    resetToSampleData,
    refreshEquipment,
    auditLogs,
  } = useEquipment();

  // Dynamically scope units and equipment according to the user's Assigned Scope (assignedUnits)
  const isUnitScoped = useMemo(
    () => !isAllUnitsScope(profile?.assignedUnits),
    [profile?.assignedUnits]
  );

  const equipment = useMemo(
    () => filterEquipmentByUserScope(rawEquipment, profile),
    [rawEquipment, profile, unitsConfig]
  );

  // Navigation route & hierarchy state
  const [viewLevel, setViewLevel] = useState<ViewLevel>('p');
  const [selectedUnitName, setSelectedUnitName] = useState<string | null>(null);
  const [selectedSystemName, setSelectedSystemName] = useState<string | null>(null);
  const [selectedEquipmentTag, setSelectedEquipmentTag] = useState<string | null>(null);

  // Admin & Live Database Sidebar Hierarchy state
  const [adminTreeExpanded, setAdminTreeExpanded] = useState(false);
  const [expandedAdminSections, setExpandedAdminSections] = useState<Set<string>>(
    () => new Set(['1', '2', '3', '5', '6', '7'])
  );
  const [adminActiveTab, setAdminActiveTab] = useState<AdminTabKey>('database');
  const [adminSubAction, setAdminSubAction] = useState<{
    action: AdminSubAction;
    ts: number;
  } | null>(null);

  const toggleAdminSection = (sectionId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedAdminSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const openAdminSheet = (
    tab: AdminTabKey,
    subAction?: AdminSubAction,
    closeDrawer = true
  ) => {
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', '#admin');
    }
    setViewLevel('admin');
    setAdminActiveTab(tab);
    if (subAction) {
      setAdminSubAction((prev) => ({ action: subAction, ts: (prev?.ts || 0) + 1 }));
    }
    if (closeDrawer) {
      setTreeOpen(false);
    }
  };

  // Drawer tree state (All units, sub-units, systems, sub-systems, and equipment collapsed by default)
  const [treeOpen, setTreeOpen] = useState(false);
  const [hierarchyOpen, setHierarchyOpen] = useState(false);
  const [treeFilter, setTreeFilter] = useState('');
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(() => new Set());
  const [expandedSystems, setExpandedSystems] = useState<Set<string>>(() => new Set());
  const [hierUnitDropdown, setHierUnitDropdown] = useState<string>('');
  const [hierSubUnitDropdown, setHierSubUnitDropdown] = useState<string>('');
  const [hierSystemDropdown, setHierSystemDropdown] = useState<string>('');
  const [hierSubSystemDropdown, setHierSubSystemDropdown] = useState<string>('');

  // Global search & drop-down
  const [globalSearch, setGlobalSearch] = useState('');
  const [showGlobalResults, setShowGlobalResults] = useState(false);
  const [searchBoxOpen, setSearchBoxOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // In-place direct equipment editing & Modals
  const [editingEquipment, setEditingEquipment] = useState<EquipmentItem | null>(null);
  const [reportModalState, setReportModalState] = useState<{
    item: EquipmentItem;
    tab?: 'view' | 'attach';
    viewOnly?: boolean;
  } | null>(null);
  const [showCloudSyncModal, setShowCloudSyncModal] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [excelNotice, setExcelNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [uploadingExcelFile, setUploadingExcelFile] = useState<string | null>(null);
  const [dashboardSweetSuccess, setDashboardSweetSuccess] = useState<{
    title: string;
    message: string;
    badgeText?: string;
    metaItems?: SweetSuccessMetaItem[];
  } | null>(null);

  // Auto-hide Excel notification popup after 3 seconds
  useEffect(() => {
    if (!excelNotice) return;
    const timer = setTimeout(() => {
      setExcelNotice(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [excelNotice]);

  // KPI expanded details drilldown
  const [kpiFilter, setKpiFilter] = useState<string | null>(null);
  const [kpiSearch, setKpiSearch] = useState('');
  const [kpiTypeFilter, setKpiTypeFilter] = useState('');

  // Table inner search filters & pagination
  const [systemSearch, setSystemSearch] = useState('');
  const [systemStatusFilter, setSystemStatusFilter] = useState('');
  const [systemTypeFilter, setSystemTypeFilter] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [equipPage, setEquipPage] = useState(1);
  const [equipPageSize, setEquipPageSize] = useState(15);

  const getAvailableEquipmentTypes = (items: EquipmentItem[]) => {
    const counts = new Map<string, number>();
    items.forEach((item) => {
      const t = (item.EquipmentType || '').trim();
      if (t) {
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    });
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([type, count]) => ({ type, count }));
  };

  // Unit-wise Remarks modal & filter state
  const [remarksModalUnit, setRemarksModalUnit] = useState<string | null>(null);
  const [remarksFilterSearch, setRemarksFilterSearch] = useState('');
  const [stageDrilldownModal, setStageDrilldownModal] = useState<{
    col: StatusColumnConfig;
    items: EquipmentItem[];
  } | null>(null);
  const [stageDrilldownSearch, setStageDrilldownSearch] = useState('');
  const [greenToast, setGreenToast] = useState<{ message: string; visible: boolean } | null>(null);

  const showGreenToast = (message: string) => {
    setGreenToast({ message, visible: true });
    setTimeout(() => {
      setGreenToast((prev) => (prev?.message === message ? null : prev));
    }, 3500);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setEquipPage(1);
    }, 0);
    return () => clearTimeout(timer);
  }, [
    viewLevel,
    selectedUnitName,
    selectedSystemName,
    systemSearch,
    systemStatusFilter,
    systemTypeFilter,
    kpiFilter,
    kpiSearch,
    kpiTypeFilter,
  ]);

  const renderPaginationBar = (totalItems: number) => {
    if (totalItems <= 0) return null;
    const effectiveSize = equipPageSize > 0 ? equipPageSize : totalItems;
    const totalPages = Math.max(1, Math.ceil(totalItems / effectiveSize));
    const currentPage = Math.min(equipPage, totalPages);
    const startIdx = (currentPage - 1) * effectiveSize;
    const endIdx = Math.min(startIdx + effectiveSize, totalItems);

    const getVisiblePages = () => {
      const pages: number[] = [];
      const maxButtons = 5;
      let start = Math.max(1, currentPage - 2);
      const end = Math.min(totalPages, start + maxButtons - 1);
      if (end - start + 1 < maxButtons) {
        start = Math.max(1, end - maxButtons + 1);
      }
      for (let p = start; p <= end; p++) pages.push(p);
      return pages;
    };

    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
          marginTop: '10px',
          padding: '9px 12px',
          background: '#f8fafc',
          border: '1px solid var(--bd)',
          borderRadius: '8px',
          fontSize: '12px',
          color: 'var(--tx)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--mu)', fontWeight: 500 }}>
            Showing <b style={{ color: 'var(--tx)' }}>{startIdx + 1}–{endIdx}</b> of{' '}
            <b style={{ color: 'var(--tx)' }}>{totalItems}</b> equipment
          </span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--mu)', fontSize: '11.5px' }}>
            <span>Rows:</span>
            <select
              value={equipPageSize}
              onChange={(e) => {
                setEquipPageSize(Number(e.target.value));
                setEquipPage(1);
              }}
              style={{
                padding: '3px 7px',
                fontSize: '11.5px',
                fontWeight: 600,
                borderRadius: '5px',
                border: '1px solid #cbd5e1',
                background: '#fff',
                color: 'var(--tx)',
                cursor: 'pointer',
              }}
            >
              <option value={10}>10 / page</option>
              <option value={15}>15 / page</option>
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
              <option value={0}>Show All</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setEquipPage(Math.max(1, currentPage - 1))}
            style={{
              padding: '4px 10px',
              fontSize: '11.5px',
              fontWeight: 600,
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: currentPage <= 1 ? '#f1f5f9' : '#ffffff',
              color: currentPage <= 1 ? '#94a3b8' : '#0f172a',
              cursor: currentPage <= 1 ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            ← Previous
          </button>

          {getVisiblePages().map((p) => {
            const isActive = p === currentPage;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setEquipPage(p)}
                style={{
                  minWidth: '28px',
                  height: '28px',
                  padding: '0 7px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: isActive ? '1px solid #0284c7' : '1px solid #cbd5e1',
                  background: isActive ? '#0284c7' : '#ffffff',
                  color: isActive ? '#ffffff' : '#334155',
                  cursor: 'pointer',
                }}
              >
                {p}
              </button>
            );
          })}

          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => setEquipPage(Math.min(totalPages, currentPage + 1))}
            style={{
              padding: '4px 10px',
              fontSize: '11.5px',
              fontWeight: 600,
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: currentPage >= totalPages ? '#f1f5f9' : '#ffffff',
              color: currentPage >= totalPages ? '#94a3b8' : '#0f172a',
              cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            Next →
          </button>
        </div>
      </div>
    );
  };

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
    setHierarchyOpen(false);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      document.getElementById('main')?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Canonical Units list dynamically scoped by the user's Assigned Scope (assignedUnits) and deduplicated case-insensitively
  const allUnitsList = useMemo(() => {
    const allowed = getUserAllowedUnits(profile);
    const map = new Map<string, string>();
    allowed.forEach((u) => map.set(u.toUpperCase(), u));
    equipment.forEach((i) => {
      const u = (i.Unit || '').trim();
      if (u) {
        const upper = u.toUpperCase();
        if (!map.has(upper)) {
          map.set(upper, u);
        }
      }
    });
    return Array.from(map.values());
  }, [profile, equipment, unitsConfig]);

  // 4-Level Skip-Aware Hierarchy Tree Data Structure:
  // Unit -> [Sub-Unit] -> [System] -> [Sub-System] -> Equipment
  // Any level left blank in Excel or UI is automatically skipped so the item/node attaches directly to the previous filled level.
  const treeData = useMemo(() => {
    return allUnitsList.map((unitName, uIdx) => {
      const unitItems = equipment.filter(
        (i) => (i.Unit || '').trim().toUpperCase() === unitName.trim().toUpperCase()
      );
      const rootChildren: HierarchyTreeNode[] = [];
      const directItems: EquipmentItem[] = [];
      const nodeMap = new Map<string, HierarchyTreeNode>();

      // Pre-seed canonical Sub-Units for UTILITY and MSP so they remain available in dropdowns and structure views
      if (unitName === 'UTILITY') {
        UTILITY_SUB_UNITS.forEach((su) => {
          const key = `subunit:${su.toUpperCase()}`;
          const node: HierarchyTreeNode = {
            id: '',
            key,
            name: su,
            pathLabel: su,
            levelType: 'subunit',
            levelBadge: 'Sub-Unit',
            unitName,
            subUnitName: su,
            systemName: '',
            subSystemName: '',
            items: [],
            directItems: [],
            children: [],
            ancestorIds: [],
          };
          nodeMap.set(key, node);
          rootChildren.push(node);
        });
      } else if (unitName === 'MSP') {
        MSP_SUB_UNITS.forEach((su) => {
          const key = `subunit:${su.toUpperCase()}`;
          const node: HierarchyTreeNode = {
            id: '',
            key,
            name: su,
            pathLabel: su,
            levelType: 'subunit',
            levelBadge: 'Sub-Unit',
            unitName,
            subUnitName: su,
            systemName: '',
            subSystemName: '',
            items: [],
            directItems: [],
            children: [],
            ancestorIds: [],
          };
          nodeMap.set(key, node);
          rootChildren.push(node);
        });
      }

      unitItems.forEach((item) => {
        const chain = getEquipmentHierarchyChain(item);
        const subSteps = chain.slice(1); // Skip 'unit' step at index 0

        if (subSteps.length === 0) {
          // Sub-Unit, System, and Sub-System are all blank -> attach directly under Unit!
          directItems.push(item);
          return;
        }

        let currentList = rootChildren;
        let pathKeyPrefix = '';
        let pathLabelParts: string[] = [];
        let accSubUnit = '';
        let accSystem = '';
        let accSubSystem = '';
        let lastNode: HierarchyTreeNode | null = null;

        subSteps.forEach((step) => {
          const stepType = step.level as 'subunit' | 'system' | 'subsystem';
          const stepBadge = step.label as 'Sub-Unit' | 'System' | 'Sub-System';
          if (stepType === 'subunit') accSubUnit = step.value;
          if (stepType === 'system') accSystem = step.value;
          if (stepType === 'subsystem') accSubSystem = step.value;

          const nodeKey = pathKeyPrefix
            ? `${pathKeyPrefix}::${stepType}:${step.value.toUpperCase()}`
            : `${stepType}:${step.value.toUpperCase()}`;
          pathKeyPrefix = nodeKey;
          pathLabelParts = [...pathLabelParts, step.value];

          let node = nodeMap.get(nodeKey);
          if (!node) {
            node = {
              id: '',
              key: nodeKey,
              name: step.value,
              pathLabel: pathLabelParts.join(' › '),
              levelType: stepType,
              levelBadge: stepBadge,
              unitName,
              subUnitName: accSubUnit,
              systemName: accSystem,
              subSystemName: accSubSystem,
              items: [],
              directItems: [],
              children: [],
              ancestorIds: [],
            };
            nodeMap.set(nodeKey, node);
            currentList.push(node);
          }
          node.items.push(item);
          currentList = node.children;
          lastNode = node;
        });

        if (lastNode) {
          (lastNode as HierarchyTreeNode).directItems.push(item);
        }
      });

      // Assign stable sequential IDs (#system-u-s) and ancestorIds in pre-order traversal
      const flatSystems: HierarchyTreeNode[] = [];
      let sCounter = 0;
      const assignIds = (nodes: HierarchyTreeNode[], parentAncestorIds: string[]) => {
        nodes.forEach((n) => {
          sCounter++;
          n.id = `system-${uIdx + 1}-${sCounter}`;
          n.ancestorIds = [...parentAncestorIds, n.id];
          flatSystems.push(n);
          if (n.children.length > 0) {
            assignIds(n.children, n.ancestorIds);
          }
        });
      };
      assignIds(rootChildren, []);

      // Top-level unique hierarchy nodes under the Unit (e.g. unique Systems in DHDT: TEST, PTEST;
      // or unique Sub-Units in MSP/Utility). Child Sub-Systems (e.g. TEST-2, TEST-3) are nested inside
      // their parent System and shown when clicking into that System.
      const tableSystems = rootChildren;

      return {
        name: unitName,
        id: `unit-${uIdx + 1}`,
        items: unitItems,
        directItems,
        children: rootChildren,
        systems: flatSystems,
        tableSystems,
      };
    });
  }, [allUnitsList, equipment]);

  // Dedicated helper to extract unique systems strictly from the System column (SystemNo).
  // Only equipment where the System column is populated (via Excel or manual edit) is counted.
  // Units and Sub-Units are NEVER counted as systems.
  const getUniqueSystemsFromList = useCallback((itemList: EquipmentItem[]) => {
    const map = new Map<
      string,
      {
        key: string;
        systemName: string;
        unit: string;
        subUnit?: string;
        items: EquipmentItem[];
      }
    >();

    itemList.forEach((item) => {
      const rawSys = (item.SystemNo || '').trim();
      const cleanSys = cleanHierarchyField(rawSys, item.Unit);
      if (!cleanSys) return; // Skip if no system is specified in System column

      const unitName = (item.Unit || 'UNKNOWN').trim();
      const key = `${unitName.toUpperCase()}::${cleanSys.toUpperCase()}`;

      const existing = map.get(key);
      if (existing) {
        existing.items.push(item);
        if (!existing.subUnit && item.SubUnit && cleanHierarchyField(item.SubUnit, item.Unit)) {
          existing.subUnit = item.SubUnit.trim();
        }
      } else {
        map.set(key, {
          key,
          systemName: cleanSys,
          unit: unitName,
          subUnit: item.SubUnit && cleanHierarchyField(item.SubUnit, item.Unit) ? item.SubUnit.trim() : undefined,
          items: [item],
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      if (a.unit !== b.unit) return a.unit.localeCompare(b.unit);
      return a.systemName.localeCompare(b.systemName, undefined, { numeric: true });
    });
  }, []);

  const overallUniqueSystems = useMemo(() => {
    return getUniqueSystemsFromList(equipment);
  }, [equipment, getUniqueSystemsFromList]);

  // Handle URL hash routing
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.slice(1);
      setKpiFilter(null);
      setKpiSearch('');
      setKpiTypeFilter('');
      setSystemTypeFilter('');
      setTreeOpen(false);
      setHierarchyOpen(false);
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
          setSelectedSystemName(s.id);
          setSelectedEquipmentTag(null);
          return;
        }
      }

      const eqMatch = hash.match(/^eq-(.+)$/);
      if (eqMatch) {
        const tag = decodeURIComponent(eqMatch[1]);
        const item = equipment.find((i) => i.EquipmentTagNo === tag || i.id === tag);
        if (item) {
          const u = treeData.find((unitObj) => unitObj.name.toLowerCase() === (item.Unit || '').trim().toLowerCase());
          const ownerNode = u?.systems.find((s) => s.directItems.some((d) => d.id === item.id));
          setViewLevel('e');
          setSelectedUnitName(item.Unit);
          setSelectedSystemName(ownerNode ? ownerNode.id : null);
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

  // Current active unit, hierarchy node (Sub-Unit / System / Sub-System), & equipment objects
  const activeUnit = useMemo(
    () =>
      treeData.find(
        (u) => u.name.toUpperCase() === (selectedUnitName || '').trim().toUpperCase()
      ),
    [treeData, selectedUnitName]
  );
  const activeSystem = useMemo(
    () =>
      activeUnit?.systems.find(
        (s) =>
          s.id === selectedSystemName ||
          s.key === selectedSystemName ||
          s.name === selectedSystemName
      ),
    [activeUnit, selectedSystemName]
  );
  const activeEquipment = useMemo(
    () =>
      equipment.find(
        (i) => i.EquipmentTagNo === selectedEquipmentTag || i.id === selectedEquipmentTag
      ),
    [equipment, selectedEquipmentTag]
  );

  // Consolidated inline Equipment Detail & Edit state (eliminates duplicate Edit modal on viewLevel === 'e')
  const [eqForm, setEqForm] = useState<EquipmentItem | null>(null);
  const [eqDrawingRef, setEqDrawingRef] = useState<string>('');
  const [savingEqForm, setSavingEqForm] = useState(false);
  const [eqSaveNotice, setEqSaveNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [confirmDeleteEq, setConfirmDeleteEq] = useState(false);
  const [deletingEq, setDeletingEq] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeEquipment) {
        setEqForm({
          ...activeEquipment,
          SubUnit: cleanHierarchyField(activeEquipment.SubUnit),
          SystemNo: cleanHierarchyField(activeEquipment.SystemNo),
          SubSystem: cleanHierarchyField(activeEquipment.SubSystem),
          FormatIVStatus: activeEquipment.FormatIVStatus || 'Not Issued',
          FormatIVDate: activeEquipment.FormatIVDate || '',
          FormatVStatus: activeEquipment.FormatVStatus || 'Not Issued',
          FormatVDate: activeEquipment.FormatVDate || '',
          PMI: activeEquipment.PMI || 'No',
        });
        const parsedDoc = parseEquipmentDocumentField(activeEquipment.DocumentDrawing);
        setEqDrawingRef(parsedDoc.drawingRef || '');
        setEqSaveNotice(null);
        setConfirmDeleteEq(false);
      } else {
        setEqForm(null);
        setEqDrawingRef('');
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [activeEquipment]);

  // Scope equipment calculation
  const scopeItems = useMemo(() => {
    if (viewLevel === 'p') return equipment;
    if (viewLevel === 'u' && selectedUnitName) {
      return equipment.filter(
        (i) => (i.Unit || '').trim().toUpperCase() === selectedUnitName.trim().toUpperCase()
      );
    }
    if (viewLevel === 's' && activeSystem) {
      return activeSystem.items;
    }
    return equipment;
  }, [viewLevel, selectedUnitName, activeSystem, equipment]);

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

  // Stage-wise pending counts helper
  const getPendingStageCount = (items: EquipmentItem[], colKey: keyof EquipmentItem) => {
    return items.filter((r) => {
      const val = ((r[colKey] as string) || '').trim().toLowerCase();
      return val !== 'not applicable' && !isDone(val);
    }).length;
  };

  // Stage-wise completed / done counts helper (work done: Issued, Yes, Accept)
  const getDoneStageCount = (items: EquipmentItem[], colKey: keyof EquipmentItem) => {
    return items.filter((r) => {
      const val = ((r[colKey] as string) || '').trim();
      return isDone(val);
    }).length;
  };

  // Excel Upload Handler matching revised 18-column schema
  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingExcelFile(file.name);
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
        else obj.Unit = curUnit || 'RPTU';

        // Note: Sub-Unit, System No., and Sub-System are intentionally NOT filled with placeholders
        // when left blank in Excel. Any blank hierarchy level automatically skips to the previous filled parent!

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
      const okMsg = `${rows.length} equipment loaded and synced with Supabase Cloud! (${res.added} added, ${res.updated} updated)`;
      setExcelNotice({
        type: 'ok',
        text: okMsg,
      });
      setDashboardSweetSuccess({
        title: 'Excel File Uploaded Successfully!',
        badgeText: 'Live Cloud Sync Complete',
        message: okMsg,
        metaItems: [
          { label: 'Excel File', value: file.name, highlight: 'blue' },
          { label: 'Total Rows Processed', value: `${rows.length} Equipment`, highlight: 'green' },
          { label: 'Added / Updated', value: `${res.added} Added · ${res.updated} Updated` },
        ],
      });
    } catch (err: any) {
      setExcelNotice({
        type: 'err',
        text: 'Upload failed: ' + (err.message || 'Invalid Excel file'),
      });
    } finally {
      setUploadingExcelFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Excel Download Handler (23 Columns — Unit, Sub-Unit, System No., Sub-System, Tag, Description, Type, Format-I to V Status & Dates, Internal Inspection, Base Line UTG, PMI, Final Acceptance, Document/Drawing, Remarks)
  const handleExcelDownload = () => {
    const H = [
      'Unit',
      'Sub-Unit',
      'System No.',
      'Sub-System',
      'Equipment Tag No.',
      'Equipment Description',
      'Equipment Type',
      'Format-I Status',
      'Format-I Date',
      'Format-II Status',
      'Format-II Date',
      'Format-III Status',
      'Format-III Date',
      'Format-IV Status',
      'Format-IV Date',
      'Format-V Status',
      'Format-V Date',
      'Internal Inspection Status',
      'Base Line UTG',
      'PMI',
      'Final System Acceptance',
      'Document/Drawing',
      'Remarks',
    ];

    const data = equipment.map((r) => [
      r.Unit || '',
      r.SubUnit || '',
      r.SystemNo || '',
      r.SubSystem || '',
      r.EquipmentTagNo || '',
      r.EquipmentDescription || '',
      r.EquipmentType || '',
      r.FormatIStatus || '',
      r.FormatIDate || '',
      r.FormatIIStatus || '',
      r.FormatIIDate || '',
      r.FormatIIIStatus || '',
      r.FormatIIIDate || '',
      r.FormatIVStatus || '',
      r.FormatIVDate || '',
      r.FormatVStatus || '',
      r.FormatVDate || '',
      r.InternalInspectionStatus || '',
      r.BaseLineUTG || '',
      r.PMI || '',
      r.FinalSystemAcceptance || '',
      formatDocumentDrawingForExcel(r.DocumentDrawing),
      r.Remarks || '',
    ]);

    const ws = XLSX.utils.aoa_to_sheet([['NREP EQUIPMENT MASTER LIST'], H, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Equipment Master');
    XLSX.writeFile(wb, 'NREP_Inspection_Equipment_Tracker_updated.xlsx');
  };

  // Excel Template Download Handler (23 Columns + Picklist Guide Sheet)
  const handleDownloadTemplate = () => {
    const H = [
      'Unit',
      'Sub-Unit',
      'System No.',
      'Sub-System',
      'Equipment Tag No.',
      'Equipment Description',
      'Equipment Type',
      'Format-I Status',
      'Format-I Date',
      'Format-II Status',
      'Format-II Date',
      'Format-III Status',
      'Format-III Date',
      'Format-IV Status',
      'Format-IV Date',
      'Format-V Status',
      'Format-V Date',
      'Internal Inspection Status',
      'Base Line UTG',
      'PMI',
      'Final System Acceptance',
      'Document/Drawing',
      'Remarks',
    ];

    const sampleRows = [
      [
        'RPTU',
        '',
        '',
        '',
        '1P30-RB-2221',
        '1St Lc-Fining Reactor (Direct under Unit — Sub-Unit/System/Sub-System skipped)',
        'Reactor',
        'Issued',
        '2026-01-12',
        'Issued',
        '2026-02-05',
        'Issued',
        '2026-02-20',
        'Issued',
        '2026-03-02',
        'Issued',
        '2026-03-15',
        'Yes',
        'Yes',
        'Yes',
        'Accepted',
        'NRL-RPTU-GA-2221 Rev.2',
        'Sub-Unit, System & Sub-System left blank -> automatically placed directly under RPTU',
      ],
      [
        'MSP',
        'NHT',
        'NHT-SYS-01',
        'NHT-SUB-01A',
        'MSP-V-2101',
        'NHT Reactor Effluent Separator (Full 4-Level Hierarchy)',
        'Vessel',
        'Issued',
        '2026-02-10',
        'Not Issued',
        '',
        'Not Issued',
        '',
        'Not Issued',
        '',
        'Not Issued',
        '',
        'No',
        'No',
        'No',
        'Not Accepted',
        'NRL-MSP-NHT-2101 Rev.1',
        'Full hierarchy: MSP > NHT > NHT-SYS-01 > NHT-SUB-01A',
      ],
      [
        'UTILITY',
        'DM-CPU',
        'DM-SYS-01',
        'CPU-TRAIN-A',
        '1U59-TT-4831',
        'Equalization Tank',
        'Tank',
        'Issued',
        '2025-08-21',
        'Issued',
        '2026-03-27',
        'Issued',
        '2026-04-23',
        'Issued',
        '2026-05-04',
        'Issued',
        '2026-05-12',
        'Yes',
        'Yes',
        'Yes',
        'Accepted',
        'NRL-UTIL-DM-4831 Rev.2',
        'Hydrostatic test & PMI complete',
      ],
    ];

    const ws = XLSX.utils.aoa_to_sheet([
      [
        'NREP EQUIPMENT LIST - TEMPLATE (Refer to the "Picklist" sheet tab below for allowed values, formats & skip-level hierarchy instructions)',
      ],
      H,
      ...sampleRows,
    ]);

    ws['!cols'] = [
      { wch: 14 }, // Unit
      { wch: 18 }, // Sub-Unit
      { wch: 18 }, // System No.
      { wch: 18 }, // Sub-System
      { wch: 20 }, // Equipment Tag No.
      { wch: 36 }, // Equipment Description
      { wch: 18 }, // Equipment Type
      { wch: 16 }, // Format-I Status
      { wch: 15 }, // Format-I Date
      { wch: 16 }, // Format-II Status
      { wch: 15 }, // Format-II Date
      { wch: 16 }, // Format-III Status
      { wch: 15 }, // Format-III Date
      { wch: 16 }, // Format-IV Status
      { wch: 15 }, // Format-IV Date
      { wch: 16 }, // Format-V Status
      { wch: 15 }, // Format-V Date
      { wch: 24 }, // Internal Inspection Status
      { wch: 16 }, // Base Line UTG
      { wch: 14 }, // PMI
      { wch: 24 }, // Final System Acceptance
      { wch: 28 }, // Document/Drawing
      { wch: 36 }, // Remarks
    ];

    // Sheet 2: "Picklist" — Complete Column-by-Column Filling Guide & Valid Dropdown Options
    const picklistAoa: any[][] = [
      ['NREP EQUIPMENT UPLOAD TEMPLATE — PICKLIST & COLUMN FILLING GUIDE (23 COLUMNS)'],
      [
        'Important: Fill your equipment data in the "Equipment Master" sheet (Sheet 1). Do NOT rename the 23 column headers in Row 2. Smart Skip-Level Rule: Hierarchy is Unit > Sub-Unit > System No. > Sub-System. Any column left blank will automatically skip to the previous filled column (e.g. if Sub-Unit, System No., and Sub-System are all left blank, the equipment is placed directly under the Unit!).',
      ],
      [],
      ['PART 1: COLUMN-BY-COLUMN FORMAT & FILLING INSTRUCTIONS (23 COLUMNS)'],
      [
        'Col No.',
        'Excel Column',
        'Column Header Name (Exact)',
        'Mandatory / Optional',
        'Data Format',
        'Allowed Picklist Values / Options',
        'Example Value',
        'How to Fill (Easy Instructions)',
      ],
      [
        '1',
        'Column A',
        'Unit',
        'Mandatory (Level 1)',
        'Picklist (Exact Text)',
        UNITS.join(', '),
        UNITS[0] || 'RPTU',
        `Select one of the official NREP Project Units (${UNITS.join(', ')}).`,
      ],
      [
        '2',
        'Column B',
        'Sub-Unit',
        'Optional (Level 2 — Auto-Skip if Blank)',
        'Picklist / Text',
        'UTILITY: DM-CPU, N2U, CA-IA, BOILERS AND HRSG, COOLING TOWER, RWDU, RW FILTER, RW RESERVOIR | MSP: NHT, CCR, ISOM | Or any Sub-Unit / Leave Blank to skip',
        'NHT',
        'Agar Sub-Unit hai toh bharein. Agar khali (blank) chhod denge toh app automatically Sub-Unit skip karke seedha Unit ke andar System ya Equipment dikhayega.',
      ],
      [
        '3',
        'Column C',
        'System No.',
        'Optional (Level 3 — Auto-Skip if Blank)',
        'Text / System Code',
        'Any System No. (e.g. RPTU-SYS-01, NHT-SYS-01) OR Leave Blank to skip directly to Unit / Sub-Unit',
        'NHT-SYS-01',
        'System No. likhein. Agar khali (blank) chhod denge toh automatic previous level (Sub-Unit ya Unit) ke andar chala jayega.',
      ],
      [
        '4',
        'Column D',
        'Sub-System',
        'Optional (Level 4 — Auto-Skip if Blank)',
        'Text / Sub-System Code',
        'Any Sub-System name/code under System (e.g. NHT-SUB-01A, CPU-TRAIN-A) OR Leave Blank to skip',
        'NHT-SUB-01A',
        'System ke andar agar Sub-System hai toh yahan likhein. Agar khali (blank) rakhenge toh automatic previous level (System, Sub-Unit, ya Unit) mein jud jayega.',
      ],
      [
        '5',
        'Column E',
        'Equipment Tag No.',
        'Mandatory (Unique Key)',
        'Text / Tag Code',
        'Unique Equipment Tag No. (No duplicate tags)',
        'RPTU-R-1001A',
        'Har equipment ka unique Tag No. likhein. Yahi Tag No. record update karne aur PDF report link karne ke kaam aata hai.',
      ],
      [
        '6',
        'Column F',
        'Equipment Description',
        'Recommended',
        'Free Text',
        'Equipment service name / description',
        'RPTU Ebullated Bed Reactor #1',
        'Equipment ka poora naam ya description likhein.',
      ],
      [
        '7',
        'Column G',
        'Equipment Type',
        'Recommended',
        'Picklist / Text',
        'Vessel, Column, Reactor, Heat Exchanger, Tank, Drum, Filter, Boiler, Heater, Pump, Package, Silo',
        'Reactor',
        'Equipment ka type likhein (jaise Vessel, Column, Tank, Heat Exchanger, Reactor, etc.).',
      ],
      [
        '8',
        'Column H',
        'Format-I Status',
        'Mandatory',
        'Picklist (2 Options)',
        'Issued, Not Issued',
        'Issued',
        'Agar Format-I complete/issue ho gaya hai toh "Issued" likhein, warna "Not Issued" likhein.',
      ],
      [
        '9',
        'Column I',
        'Format-I Date',
        'Optional',
        'Date (YYYY-MM-DD)',
        'YYYY-MM-DD (or DD-MM-YYYY Excel Date) — Leave blank if Not Issued',
        '2026-01-12',
        'Format-I issue hone ki date YYYY-MM-DD format mein likhein (jaise 2026-01-12). Agar Not Issued hai toh blank chhod dein.',
      ],
      [
        '10',
        'Column J',
        'Format-II Status',
        'Mandatory',
        'Picklist (2 Options)',
        'Issued, Not Issued',
        'Issued',
        'Agar Format-II complete/issue ho gaya hai toh "Issued" likhein, warna "Not Issued" likhein.',
      ],
      [
        '11',
        'Column K',
        'Format-II Date',
        'Optional',
        'Date (YYYY-MM-DD)',
        'YYYY-MM-DD (or DD-MM-YYYY Excel Date) — Leave blank if Not Issued',
        '2026-02-05',
        'Format-II issue hone ki date YYYY-MM-DD format mein likhein. Agar Not Issued hai toh blank chhod dein.',
      ],
      [
        '12',
        'Column L',
        'Format-III Status',
        'Mandatory',
        'Picklist (2 Options)',
        'Issued, Not Issued',
        'Not Issued',
        'Agar Format-III complete/issue ho gaya hai toh "Issued" likhein, warna "Not Issued" likhein.',
      ],
      [
        '13',
        'Column M',
        'Format-III Date',
        'Optional',
        'Date (YYYY-MM-DD)',
        'YYYY-MM-DD (or DD-MM-YYYY Excel Date) — Leave blank if Not Issued',
        '2026-02-20',
        'Format-III issue hone ki date YYYY-MM-DD format mein likhein. Agar Not Issued hai toh blank chhod dein.',
      ],
      [
        '14',
        'Column N',
        'Format-IV Status',
        'Mandatory',
        'Picklist (2 Options)',
        'Issued, Not Issued',
        'Not Issued',
        'Agar Format-IV complete/issue ho gaya hai toh "Issued" likhein, warna "Not Issued" likhein.',
      ],
      [
        '15',
        'Column O',
        'Format-IV Date',
        'Optional',
        'Date (YYYY-MM-DD)',
        'YYYY-MM-DD (or DD-MM-YYYY Excel Date) — Leave blank if Not Issued',
        '2026-03-02',
        'Format-IV issue hone ki date YYYY-MM-DD format mein likhein. Agar Not Issued hai toh blank chhod dein.',
      ],
      [
        '16',
        'Column P',
        'Format-V Status',
        'Mandatory',
        'Picklist (2 Options)',
        'Issued, Not Issued',
        'Not Issued',
        'Agar Format-V complete/issue ho gaya hai toh "Issued" likhein, warna "Not Issued" likhein.',
      ],
      [
        '17',
        'Column Q',
        'Format-V Date',
        'Optional',
        'Date (YYYY-MM-DD)',
        'YYYY-MM-DD (or DD-MM-YYYY Excel Date) — Leave blank if Not Issued',
        '2026-03-15',
        'Format-V issue hone ki date YYYY-MM-DD format mein likhein. Agar Not Issued hai toh blank chhod dein.',
      ],
      [
        '18',
        'Column R',
        'Internal Inspection Status',
        'Mandatory',
        'Picklist (2 Options)',
        'Yes, No',
        'Yes',
        'Agar Internal Inspection complete ho chuka hai toh "Yes" likhein, warna "No" likhein.',
      ],
      [
        '19',
        'Column S',
        'Base Line UTG',
        'Mandatory (Info Only — Excluded from %)',
        'Picklist (2 Options)',
        'Yes, No',
        'Yes',
        'Agar Base Line Ultrasonic Thickness Gauging (UTG) complete ho chuka hai toh "Yes" likhein, warna "No" likhein.',
      ],
      [
        '20',
        'Column T',
        'PMI',
        'Mandatory (Info Only — Excluded from %)',
        'Picklist (2 Options)',
        'Yes, No',
        'Yes',
        'Agar Positive Material Identification (PMI) complete ho chuka hai toh "Yes" likhein, warna "No" likhein.',
      ],
      [
        '21',
        'Column U',
        'Final System Acceptance',
        'Mandatory',
        'Picklist (2 Options)',
        'Accepted, Not Accepted',
        'Accepted',
        'Agar Final System Acceptance complete hai toh "Accepted" likhein, warna "Not Accepted" likhein.',
      ],
      [
        '22',
        'Column V',
        'Document/Drawing',
        'Optional',
        'Text / URL',
        'Drawing Ref No. OR Google Drive / OneDrive share link (https://...)',
        'NRL-RPTU-GA-1001A Rev.2',
        'Drawing number likhein ya Google Drive / OneDrive report ka link paste karein.',
      ],
      [
        '23',
        'Column W',
        'Remarks',
        'Optional',
        'Free Text',
        'Any inspection notes, pending status, or observations',
        'Hydrostatic test complete',
        'Equipment se juda koi bhi remark ya comment yahan likhein.',
      ],
      [],
      ['PART 2: READY-TO-COPY PICKLIST VALUES (COPY & PASTE INTO "Equipment Master" SHEET)'],
      [
        'Unit Picklist (7 Units)',
        'UTILITY Sub-Unit Picklist (8 Sub-Units)',
        'MSP Sub-Unit Picklist (3 Sub-Units)',
        'Format-I / II / III / IV / V Status',
        'Internal Insp., Base Line UTG & PMI',
        'Final System Acceptance',
        'Common Equipment Types',
      ],
      ['RPTU', 'DM-CPU', 'NHT', 'Issued', 'Yes', 'Accepted', 'Vessel'],
      ['MSP', 'N2U', 'CCR', 'Not Issued', 'No', 'Not Accepted', 'Column'],
      ['PFCCU', 'CA-IA', 'ISOM', '', '', '', 'Reactor'],
      ['CDU/VDU', 'BOILERS AND HRSG', '', '', '', '', 'Heat Exchanger'],
      ['DHDT', 'COOLING TOWER', '', '', '', '', 'Tank'],
      ['SRB', 'RWDU', '', '', '', '', 'Drum'],
      ['UTILITY', 'RW FILTER', '', '', '', '', 'Filter'],
      ['', 'RW RESERVOIR', '', '', '', '', 'Boiler'],
      ['', '', '', '', '', '', 'Heater'],
      ['', '', '', '', '', '', 'Pump'],
      ['', '', '', '', '', '', 'Package'],
      ['', '', '', '', '', '', 'Silo'],
    ];

    const picklistWs = XLSX.utils.aoa_to_sheet(picklistAoa);
    picklistWs['!cols'] = [
      { wch: 24 },
      { wch: 34 },
      { wch: 30 },
      { wch: 34 },
      { wch: 32 },
      { wch: 58 },
      { wch: 28 },
      { wch: 64 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Equipment Master');
    XLSX.utils.book_append_sheet(wb, picklistWs, 'Picklist');
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

  const getStageDate = (item: EquipmentItem, colKey: keyof EquipmentItem) => {
    if (colKey === 'FormatIStatus') return item.FormatIDate || item.updatedAt || '—';
    if (colKey === 'FormatIIStatus') return item.FormatIIDate || item.updatedAt || '—';
    if (colKey === 'FormatIIIStatus') return item.FormatIIIDate || item.updatedAt || '—';
    if (colKey === 'FormatIVStatus') return item.FormatIVDate || item.updatedAt || '—';
    if (colKey === 'FormatVStatus') return item.FormatVDate || item.updatedAt || '—';
    return item.updatedAt || '—';
  };

  // Stage-wise horizontal bars with hyperlinks for equipment drilldown, dates & user IDs
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
            <div
              key={col.key}
              className="sr"
              onClick={() => {
                setStageDrilldownSearch('');
                setStageDrilldownModal({ col, items });
              }}
              style={{
                cursor: 'pointer',
                borderRadius: '5px',
                padding: '3px 6px',
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = '#e0f2fe';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = 'transparent';
              }}
              title={`Click to view equipment list, dates & user IDs for ${col.label}`}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  color: '#0284c7',
                  fontWeight: 600,
                  textDecoration: 'underline',
                }}
                title={`${col.label} (${col.doneValue} / ${col.pendingValue}) — Click for equipment hyperlink list`}
              >
                <span>{col.short}</span>
              </span>
              <div className="sb" style={{ cursor: 'pointer' }}>
                {done > 0 && (
                  <i
                    title={`${col.doneValue}: ${done} (${pct}%) — Click for details`}
                    style={{ width: `${(done / t) * 100}%`, background: 'var(--gr)' }}
                  />
                )}
                {pending > 0 && (
                  <i
                    title={`${col.pendingValue}: ${pending} (${100 - pct}%) — Click for details`}
                    style={{ width: `${(pending / t) * 100}%`, background: 'var(--am)' }}
                  />
                )}
              </div>
              <b style={{ minWidth: '58px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#0f172a' }}>
                {done}/{items.length} ({pct}%)
              </b>
            </div>
          );
        })}
        <div className="lg" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', fontSize: '11px' }}>
          <span>
            <i style={{ background: 'var(--gr)' }}></i>Done (Issued / Yes / Accept) · <b style={{ color: '#0284c7' }}>Click any stage bar for equipment hyperlink list, dates &amp; user IDs</b>
          </span>
          <span>
            <i style={{ background: 'var(--am)' }}></i>Pending
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

  // Helper renderer for Document/Drawing & Live Inspection Reports column
  const renderDocumentDrawing = (docVal?: string, equipItem?: EquipmentItem) => {
    const { drawingRef, reports } = parseEquipmentDocumentField(docVal);

    if (reports.length > 0 && equipItem) {
      const primaryBadge = getProviderBadgeMeta(reports[0].provider);
      return (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setReportModalState({ item: equipItem, tab: 'view' })}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              fontSize: '11px',
              fontWeight: 700,
              borderRadius: '5px',
              background: primaryBadge.bg,
              color: primaryBadge.color,
              border: `1px solid ${primaryBadge.border}`,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            title={`View ${reports.length} live report(s) inside app modal (${primaryBadge.label})`}
          >
            <span>📄 View Live ({reports.length})</span>
          </button>
          {isEditor && (
            <button
              type="button"
              onClick={() => setReportModalState({ item: equipItem, tab: 'attach' })}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '3px 6px',
                fontSize: '10.5px',
                fontWeight: 700,
                borderRadius: '4px',
                background: '#f0fdf4',
                color: '#15803d',
                border: '1px solid #86efac',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              title="Attach Google Drive / OneDrive report link or upload PDF"
            >
              + Report
            </button>
          )}
        </div>
      );
    }

    if (drawingRef) {
      return (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
          <span
            title={drawingRef}
            style={{
              display: 'inline-block',
              fontSize: '11px',
              fontWeight: 600,
              color: '#0f172a',
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              padding: '2px 6px',
              borderRadius: '4px',
              maxWidth: '150px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            📄 {drawingRef}
          </span>
          {isEditor && equipItem && (
            <button
              type="button"
              onClick={() => setReportModalState({ item: equipItem, tab: 'attach' })}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px 6px',
                fontSize: '10.5px',
                fontWeight: 700,
                borderRadius: '4px',
                background: '#eff6ff',
                color: '#0284c7',
                border: '1px solid #bae6fd',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              title="Attach Google Drive / OneDrive report or upload PDF"
            >
              ⬆️ Attach
            </button>
          )}
        </div>
      );
    }

    if (isEditor && equipItem) {
      return (
        <button
          type="button"
          onClick={() => setReportModalState({ item: equipItem, tab: 'attach' })}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '3px 8px',
            fontSize: '11px',
            fontWeight: 600,
            borderRadius: '4px',
            background: '#f8fafc',
            color: '#0284c7',
            border: '1px dashed #94a3b8',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
          title="Upload PDF/Image report or attach Google Drive / OneDrive link"
        >
          ⬆️ Upload / Link
        </button>
      );
    }

    return <span style={{ color: 'var(--mu)' }}>—</span>;
  };

  // Unit-wise Progress & Completion Bar Chart (Kitna Hua vs Kitna Baki)
  const renderUnitWiseProgressBarChart = () => {
    const filtered = treeData.filter((u) => !unitChartSearch || u.name.toLowerCase().includes(unitChartSearch.toLowerCase()));

    const unitStats = filtered.map((u) => {
      // Stage metrics (excludes Base Line UTG and PMI from percentage calculation)
      let totalApplicableStages = 0;
      let doneStages = 0;
      let openStages = 0;
      let notStartedStages = 0;
      u.items.forEach((item) => {
        PROGRESS_STAGE_COLUMNS.forEach((col) => {
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
          title="Open menu & workspaces"
          aria-label="Open menu & workspaces"
          onClick={() => {
            setTreeOpen((prev) => !prev);
            setHierarchyOpen(false);
          }}
        >
          ☰
        </button>
        {/* Hierarchy Symbol Button Between Menu and Home */}
        <button
          id="hb"
          className={`ib ${hierarchyOpen ? 'on' : ''}`}
          title="Units, Sub-Units & Equipment Hierarchy"
          aria-label="Units, Sub-Units & Equipment Hierarchy"
          onClick={() => {
            setHierarchyOpen((prev) => !prev);
            setTreeOpen(false);
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '12.5px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <FolderTree size={15} />
          <span>Hierarchy</span>
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
          NRL · NREP Inspection Monitor
          <small id="meta">
            {equipment.length} equipment · {treeData.length} units ·{' '}
            {overallUniqueSystems.length} systems
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
              padding: '5px 9px',
              height: '28px',
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
                        {formatEquipmentHierarchyPath(eq)}
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


        {/* User Status & Assigned Scope Badge (Logout moved to footer right corner) */}
        {(profile || user) && (
          <span id="who" style={{ fontSize: '12px', opacity: 0.95, display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span>{profile?.displayName || user?.email?.split('@')[0] || profile?.email}</span>
            <span>·</span>
            <span
              style={{
                fontWeight: 700,
                textTransform: 'uppercase',
                color: isAdmin ? '#fbbf24' : isEditor ? '#86efac' : '#94a3b8',
              }}
            >
              {profile?.role === 'editor' || profile?.role === 'engineer'
                ? 'inspector'
                : profile?.role === 'lead_engineer'
                ? 'lead engineer'
                : profile?.role || 'viewer'}
            </span>
            <span
              style={{
                fontSize: '10.5px',
                fontWeight: 700,
                padding: '1px 7px',
                borderRadius: '999px',
                background: isUnitScoped ? 'rgba(56, 189, 248, 0.22)' : 'rgba(255, 255, 255, 0.14)',
                color: isUnitScoped ? '#7dd3fc' : '#e2e8f0',
                border: isUnitScoped
                  ? '1px solid rgba(56, 189, 248, 0.45)'
                  : '1px solid rgba(255, 255, 255, 0.25)',
              }}
              title="Assigned Unit Scope"
            >
              Scope: {isUnitScoped ? allUnitsList.join(', ') : 'All Units'}
            </span>
          </span>
        )}
      </header>

      {/* FLYOUT DRAWER BACKDROP (CLOSES BOTH MENU & HIERARCHY DRAWERS) */}
      <div
        id="bk"
        className={(treeOpen || hierarchyOpen) ? 'show' : ''}
        onClick={() => {
          setTreeOpen(false);
          setHierarchyOpen(false);
        }}
      />
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

        {/* Vertical Sidebar Navigation: Tasks & Workspaces */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: '16px' }}>

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

          {/* 1. Project Overview (Scoped Units or All Units) */}
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
              {isUnitScoped
                ? `NREP Scope (${allUnitsList.join(', ')})`
                : `NREP Project (All ${treeData.length} Units)`}
            </a>
            {renderPill(equipment)}
          </div>

          {/* 3. Excel & Data Tools (Opens in Right Pane) */}
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

          {/* 3. Admin & Live Database Console (Hierarchical Tree in Drawer -> Opens Dedicated Sheets in Right Pane) */}
          {canAccessLiveDatabase && (
            <div style={{ marginTop: '4px' }}>
              {/* Root Node: Admin & Live Database */}
              <div
                className={`tn ${viewLevel === 'admin' ? 'on' : ''}`}
                onClick={() => setAdminTreeExpanded((prev) => !prev)}
                style={{ fontWeight: 700, cursor: 'pointer' }}
              >
                <span
                  className={`tg ${adminTreeExpanded ? 'open' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAdminTreeExpanded((prev) => !prev);
                  }}
                  title={adminTreeExpanded ? 'Collapse Admin Hierarchy' : 'Expand Admin Hierarchy'}
                >
                  ▸
                </span>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setAdminTreeExpanded((prev) => !prev);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
                >
                  <span>⚙️</span>
                  <span>Admin</span>
                </a>
                <span className="pill p-ip">6 Sheets</span>
              </div>

              {/* Hierarchical Tree Branches */}
              {adminTreeExpanded && (
                <div
                  style={{
                    marginLeft: '11px',
                    paddingLeft: '8px',
                    borderLeft: '1.5px solid #cbd5e1',
                    marginTop: '2px',
                    marginBottom: '6px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                  }}
                >
                  {/* ├─ 1  Live Database */}
                  <div>
                    <div
                      className={`tn ${viewLevel === 'admin' && adminActiveTab === 'database' ? 'on' : ''}`}
                      style={{ padding: '4px 6px', fontSize: '11.5px' }}
                      onClick={() => openAdminSheet('database')}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: '10px',
                          color: '#64748b',
                          marginRight: '2px',
                        }}
                      >
                        ├─ 1
                      </span>
                      <a
                        href="#admin"
                        onClick={(e) => {
                          e.preventDefault();
                          openAdminSheet('database');
                        }}
                        style={{ fontWeight: 600 }}
                      >
                        Live Database
                      </a>
                      <span className="pill p-ok">{equipment.length}</span>
                    </div>
                  </div>

                  {/* ├─ 2  Project Structure */}
                  <div>
                    <div
                      className={`tn ${viewLevel === 'admin' && adminActiveTab === 'structure' ? 'on' : ''}`}
                      style={{ padding: '4px 6px', fontSize: '11.5px' }}
                      onClick={() => openAdminSheet('structure')}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: '10px',
                          color: '#64748b',
                          marginRight: '2px',
                        }}
                      >
                        ├─ 2
                      </span>
                      <a
                        href="#admin"
                        onClick={(e) => {
                          e.preventDefault();
                          openAdminSheet('structure');
                        }}
                        style={{ fontWeight: 600 }}
                      >
                        Project Structure
                      </a>
                      <span className="pill p-na">7 Units</span>
                    </div>
                  </div>

                  {/* ├─ 3  Users & Roles */}
                  {isAdmin && (
                    <div>
                      <div
                        className={`tn ${viewLevel === 'admin' && (adminActiveTab === 'users' || adminActiveTab === 'add') ? 'on' : ''}`}
                        style={{ padding: '4px 6px', fontSize: '11.5px' }}
                        onClick={() => openAdminSheet('users')}
                      >
                        <span
                          style={{
                            fontFamily: 'var(--mono)',
                            fontSize: '10px',
                            color: '#64748b',
                            marginRight: '2px',
                          }}
                        >
                          ├─ 3
                        </span>
                        <a
                          href="#admin"
                          onClick={(e) => {
                            e.preventDefault();
                            openAdminSheet('users');
                          }}
                          style={{ fontWeight: 600 }}
                        >
                          Users &amp; Roles
                        </a>
                        <span className="pill p-ip">RBAC</span>
                      </div>
                    </div>
                  )}

                  {/* ├─ 5  Cloud Report Sync & Drive Switcher (3 modules) */}
                  <div>
                    <div
                      className={`tn ${viewLevel === 'admin' && adminActiveTab === 'cloud' ? 'on' : ''}`}
                      style={{ padding: '4px 6px', fontSize: '11.5px' }}
                      onClick={() => openAdminSheet('cloud')}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: '10px',
                          color: '#64748b',
                          marginRight: '2px',
                        }}
                      >
                        ├─ 5
                      </span>
                      <a
                        href="#admin"
                        onClick={(e) => {
                          e.preventDefault();
                          openAdminSheet('cloud');
                        }}
                        style={{ fontWeight: 600, whiteSpace: 'normal', lineHeight: 1.2 }}
                      >
                        Cloud Report Sync &amp; Drive Switcher (3 modules)
                      </a>
                    </div>
                  </div>

                  {/* ├─ 6  Audit Trail */}
                  <div>
                    <div
                      className={`tn ${viewLevel === 'admin' && adminActiveTab === 'audit' ? 'on' : ''}`}
                      style={{ padding: '4px 6px', fontSize: '11.5px' }}
                      onClick={() => openAdminSheet('audit')}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: '10px',
                          color: '#64748b',
                          marginRight: '2px',
                        }}
                      >
                        ├─ 6
                      </span>
                      <a
                        href="#admin"
                        onClick={(e) => {
                          e.preventDefault();
                          openAdminSheet('audit');
                        }}
                        style={{ fontWeight: 600 }}
                      >
                        Audit Trail ({auditLogs.length})
                      </a>
                    </div>
                  </div>

                  {/* └─ 7  Storage & Capacity */}
                  <div>
                    <div
                      className={`tn ${viewLevel === 'admin' && adminActiveTab === 'storage' ? 'on' : ''}`}
                      style={{ padding: '4px 6px', fontSize: '11.5px' }}
                      onClick={() => openAdminSheet('storage')}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: '10px',
                          color: '#64748b',
                          marginRight: '2px',
                        }}
                      >
                        └─ 7
                      </span>
                      <a
                        href="#admin"
                        onClick={(e) => {
                          e.preventDefault();
                          openAdminSheet('storage');
                        }}
                        style={{ fontWeight: 600 }}
                      >
                        Storage &amp; Capacity
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
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
          {canAccessLiveDatabase ? (
            <button
              type="button"
              onClick={() => openAdminSheet('database')}
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

      {/* 2. DEDICATED FLYOUT HIERARCHY DRAWER (UNIT > SUB-UNIT > SYSTEM > SUB-SYSTEM > EQUIPMENT) */}
      <nav id="hierarchy-tree" className={hierarchyOpen ? 'show' : ''} style={{ display: 'flex', flexDirection: 'column' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <FolderTree size={16} style={{ color: 'var(--ac)' }} />
            <span style={{ fontWeight: 700, fontSize: '11.5px', color: 'var(--tx)', letterSpacing: '0.3px' }}>
              UNIT › SUB-UNIT › SYSTEM › SUB-SYSTEM
            </span>
          </div>
          <button
            className="tg"
            onClick={() => setHierarchyOpen(false)}
            aria-label="Close hierarchy"
            style={{ width: 'auto', fontSize: '16px', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {/* Search input for filtering units, sub-units, systems, sub-systems & equipment */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--bd)' }}>
          <input
            id="tq-hierarchy"
            placeholder="🔍 Search unit, sub-unit, system, sub-system, tag…"
            value={treeFilter}
            onChange={(e) => setTreeFilter(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
        </div>

        {/* Scrollable Hierarchy Tree Wrapper */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: '16px' }}>
          {/* Section Header for Expand / Collapse All */}
          <div
            style={{
              padding: '10px 14px 6px',
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
              Interactive Hierarchy Tree
            </span>
            <button
              type="button"
              onClick={() => {
                const allUnitIds = treeData.map((u) => u.id);
                const allSysIds = treeData.flatMap((u) => u.systems.map((s) => s.id));
                if (expandedUnits.size > 0 || expandedSystems.size > 0) {
                  setExpandedUnits(new Set());
                  setExpandedSystems(new Set());
                } else {
                  setExpandedUnits(new Set(allUnitIds));
                  setExpandedSystems(new Set(allSysIds));
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
              title="Expand or Collapse all Units, Sub-Units, Systems & Sub-Systems"
            >
              {expandedUnits.size > 0 || expandedSystems.size > 0 ? 'Collapse All' : 'Expand All'}
            </button>
          </div>

          {/* Recursive 4-Level Skip-Aware Tree Renderer */}
          {(() => {
            const tf = treeFilter.trim().toLowerCase();
            const hasDropdownFilter = Boolean(
              hierUnitDropdown || hierSubUnitDropdown || hierSystemDropdown || hierSubSystemDropdown
            );

            const itemMatchesSearchAndDropdown = (eq: EquipmentItem, unitMatches: boolean) => {
              if (hierSubUnitDropdown && (eq.SubUnit || '') !== hierSubUnitDropdown) return false;
              if (hierSystemDropdown && (eq.SystemNo || '') !== hierSystemDropdown) return false;
              if (hierSubSystemDropdown && (eq.SubSystem || '') !== hierSubSystemDropdown) return false;
              if (!tf) return true;
              return (
                unitMatches ||
                eq.EquipmentTagNo.toLowerCase().includes(tf) ||
                (eq.EquipmentDescription || '').toLowerCase().includes(tf) ||
                (eq.SubUnit || '').toLowerCase().includes(tf) ||
                (eq.SystemNo || '').toLowerCase().includes(tf) ||
                (eq.SubSystem || '').toLowerCase().includes(tf)
              );
            };

            const nodeMatchesRecursive = (node: HierarchyTreeNode, unitMatches: boolean): boolean => {
              if (hierSubUnitDropdown && node.levelType === 'subunit' && node.name !== hierSubUnitDropdown) {
                return false;
              }
              if (hierSystemDropdown && node.levelType === 'system' && node.name !== hierSystemDropdown) {
                return false;
              }
              if (hierSubSystemDropdown && node.levelType === 'subsystem' && node.name !== hierSubSystemDropdown) {
                return false;
              }
              const selfTextMatches = !tf || unitMatches || node.name.toLowerCase().includes(tf);
              const anyDirectEqMatches = node.directItems.some((eq) =>
                itemMatchesSearchAndDropdown(eq, unitMatches || selfTextMatches)
              );
              const anyChildMatches = node.children.some((c) =>
                nodeMatchesRecursive(c, unitMatches || selfTextMatches)
              );
              if (hierSubSystemDropdown && node.levelType !== 'subsystem') {
                return anyChildMatches;
              }
              if (hierSystemDropdown && node.levelType === 'subunit') {
                return anyChildMatches;
              }
              if (!tf && !hasDropdownFilter) return true;
              return (selfTextMatches && !hierSubSystemDropdown && !(hierSystemDropdown && node.levelType === 'subunit')) || anyDirectEqMatches || anyChildMatches;
            };

            const renderHierarchyNode = (
              u: (typeof treeData)[number],
              node: HierarchyTreeNode,
              depth: number,
              unitMatches: boolean
            ): React.ReactNode => {
              if (!nodeMatchesRecursive(node, unitMatches)) return null;

              const isNodeExpanded = expandedSystems.has(node.id);
              const selfMatches = !tf || unitMatches || node.name.toLowerCase().includes(tf);
              const visibleDirectItems = node.directItems.filter((eq) =>
                itemMatchesSearchAndDropdown(eq, selfMatches)
              );

              const badgeColors =
                node.levelType === 'subunit'
                  ? { bg: '#e0f2fe', color: '#0369a1', border: '#bae6fd' }
                  : node.levelType === 'system'
                  ? { bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' }
                  : { bg: '#eef2ff', color: '#3730a3', border: '#c7d2fe' };

              return (
                <React.Fragment key={node.id}>
                  <div
                    className={`tn l2 ${
                      viewLevel === 's' && selectedUnitName === u.name && activeSystem?.id === node.id
                        ? 'on'
                        : ''
                    }`}
                    style={{ paddingLeft: `${14 + depth * 14}px` }}
                    onClick={() => {
                      setExpandedSystems((prev) => {
                        const next = new Set(prev);
                        if (next.has(node.id)) next.delete(node.id);
                        else next.add(node.id);
                        return next;
                      });
                    }}
                  >
                    <button
                      type="button"
                      className="tg"
                      title={isNodeExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedSystems((prev) => {
                          const next = new Set(prev);
                          if (next.has(node.id)) next.delete(node.id);
                          else next.add(node.id);
                          return next;
                        });
                      }}
                    >
                      {isNodeExpanded ? '▾' : '▸'}
                    </button>
                    <a
                      href={`#${node.id}`}
                      title={`${node.levelBadge}: ${node.pathLabel} (${node.items.length} Equipment)`}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}
                    >
                      <span
                        style={{
                          fontSize: '8.5px',
                          fontWeight: 700,
                          padding: '0px 4px',
                          borderRadius: '3px',
                          background: badgeColors.bg,
                          color: badgeColors.color,
                          border: `1px solid ${badgeColors.border}`,
                          textTransform: 'uppercase',
                        }}
                      >
                        {node.levelBadge}
                      </span>
                      <span style={{ fontWeight: 600 }}>{node.name}</span>
                      <span style={{ fontSize: '9.5px', color: 'var(--mu)' }}>
                        ({node.items.length} eq)
                      </span>
                    </a>
                    {renderPill(node.items)}
                  </div>

                  {/* Child Hierarchy Nodes (e.g. System under Sub-Unit, or Sub-System under System) */}
                  {isNodeExpanded &&
                    node.children.map((child) =>
                      renderHierarchyNode(u, child, depth + 1, selfMatches)
                    )}

                  {/* Direct Equipment attached at this node (when lower hierarchy levels are blank/skipped) */}
                  {isNodeExpanded &&
                    visibleDirectItems.map((eq) => (
                      <div
                        key={eq.id}
                        className={`tn l3 ${
                          viewLevel === 'e' && selectedEquipmentTag === eq.EquipmentTagNo ? 'on' : ''
                        }`}
                        style={{ paddingLeft: `${26 + depth * 14}px` }}
                        onClick={() => {
                          window.location.hash = `eq-${encodeURIComponent(eq.EquipmentTagNo)}`;
                          setTreeOpen(false);
                          setHierarchyOpen(false);
                        }}
                      >
                        <span style={{ fontSize: '10px', color: 'var(--ac)', flexShrink: 0 }}>•</span>
                        <a
                          href={`#eq-${encodeURIComponent(eq.EquipmentTagNo)}`}
                          title={`${eq.EquipmentTagNo} — ${eq.EquipmentDescription || ''}`}
                          onClick={() => {
                            setTreeOpen(false);
                            setHierarchyOpen(false);
                          }}
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
            };

            return treeData
              .filter((u) => !hierUnitDropdown || u.name === hierUnitDropdown)
              .map((u) => {
                const unitMatches = !tf || u.name.toLowerCase().includes(tf);
                const visibleDirectUnitEquip =
                  !hierSubUnitDropdown && !hierSystemDropdown && !hierSubSystemDropdown
                    ? u.directItems.filter((eq) => itemMatchesSearchAndDropdown(eq, unitMatches))
                    : [];
                const visibleChildren = u.children.filter((c) => nodeMatchesRecursive(c, unitMatches));

                if ((tf || hasDropdownFilter) && !unitMatches && visibleDirectUnitEquip.length === 0 && visibleChildren.length === 0) {
                  return null;
                }

                const isUnitExpanded = expandedUnits.has(u.id);

                return (
                  <React.Fragment key={u.id}>
                    {/* LEVEL 1: MAIN UNIT ROW */}
                    <div
                      className={`tn l1 ${viewLevel === 'u' && selectedUnitName === u.name ? 'on' : ''}`}
                      onClick={() => {
                        setExpandedUnits((prev) => {
                          const next = new Set(prev);
                          if (next.has(u.id)) next.delete(u.id);
                          else next.add(u.id);
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
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}
                      >
                        <span>{u.name}</span>
                        {u.children.length > 0 && (
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
                            {u.children.length} {u.children[0]?.levelBadge || 'Sub-Unit'}
                            {u.children.length > 1 ? 's' : ''}
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: '9.5px',
                            fontWeight: 600,
                            color: 'var(--mu)',
                          }}
                        >
                          ({u.items.length} eq)
                        </span>
                      </a>
                      {renderPill(u.items)}
                    </div>

                    {/* Child Hierarchy Nodes (Sub-Unit > System > Sub-System) */}
                    {isUnitExpanded &&
                      u.children.map((child) => renderHierarchyNode(u, child, 1, unitMatches))}

                    {/* Direct Equipment under Unit (when Sub-Unit, System, and Sub-System were all skipped/blank) */}
                    {isUnitExpanded &&
                      visibleDirectUnitEquip.map((eq) => (
                        <div
                          key={eq.id}
                          className={`tn l2 ${
                            viewLevel === 'e' && selectedEquipmentTag === eq.EquipmentTagNo ? 'on' : ''
                          }`}
                          onClick={() => {
                            window.location.hash = `eq-${encodeURIComponent(eq.EquipmentTagNo)}`;
                            setTreeOpen(false);
                            setHierarchyOpen(false);
                          }}
                        >
                          <span style={{ fontSize: '10px', color: 'var(--ac)', flexShrink: 0 }}>•</span>
                          <a
                            href={`#eq-${encodeURIComponent(eq.EquipmentTagNo)}`}
                            title={`${eq.EquipmentTagNo} — ${eq.EquipmentDescription || ''}`}
                            onClick={() => {
                              setTreeOpen(false);
                              setHierarchyOpen(false);
                            }}
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
              });
          })()}
        </div>

        {/* Hierarchy Drawer Sticky Bottom Summary */}
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
          <span style={{ color: 'var(--mu)', fontSize: '10.5px' }}>
            Skip-Aware 4-Level Hierarchy
          </span>
          <button
            type="button"
            onClick={() => {
              goToHome();
              setHierarchyOpen(false);
            }}
            style={{
              padding: '3px 8px',
              fontSize: '10.5px',
              fontWeight: 600,
              background: 'var(--ac)',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            ⌂ Back to Home
          </button>
        </div>
      </nav>

      {/* MAIN VIEWPORT MATCHING REFERENCE HTML */}
      <main id="main" className={`nrep-main ${viewLevel === 'admin' ? '!p-0 !max-w-none w-full' : ''}`}>
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
                          <span style={{ color: '#67b7f7' }}>
                            {isUnitScoped ? `${allUnitsList.join(', ')} Unit Status` : 'Overall Status'}
                          </span>
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
              const totalSystems = overallUniqueSystems.length;
              const compPct = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;
              const progPct = stats.total ? Math.round((stats.inProgress / stats.total) * 100) : 0;
              const notStartPct = stats.total ? Math.round((stats.notStarted / stats.total) * 100) : 0;

              return (
                <div className="kp">
                  {renderProfessionalKpiCard({
                    label: isUnitScoped ? 'Assigned Unit' : 'Units',
                    value: isUnitScoped && treeData.length === 1 ? treeData[0].name : treeData.length,
                    subtext: isUnitScoped ? `Scoped to ${allUnitsList.join(', ')}` : 'Process & utility units',
                    badgeText: isUnitScoped ? 'Assigned' : 'Scope',
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
                    subtext: `${totalSystems} unique systems in System column`,
                    badgeText: 'Active',
                    pctBar: 100,
                    theme: 'indigo',
                    icon: <Layers size={13} />,
                    active: kpiFilter === 'systems',
                    onClick: () => {
                      setKpiSearch('');
                      setKpiFilter(kpiFilter === 'systems' ? null : 'systems');
                    },
                    title: 'Click to drill down into unique Systems from System column',
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
                      ? `Systems Breakdown (${overallUniqueSystems.length} unique systems)`
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
                            <th style={{ minWidth: '150px' }}>Stage Progress</th>
                            {STATUS_COLUMNS.map((col) => (
                              <th
                                key={col.key}
                                className="ct"
                                title={`Work completed / issued count (${col.doneValue})`}
                                style={{ minWidth: '82px', textAlign: 'center' }}
                              >
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1px', width: '100%' }}>
                                  <span style={{ textAlign: 'center' }}>{col.short}</span>
                                  <span style={{ fontSize: '9px', textTransform: 'none', color: '#0369a1', fontWeight: 700, textAlign: 'center' }}>
                                    ({col.doneValue})
                                  </span>
                                </div>
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
                                      {u.name === 'MSP' && (
                                        <span
                                          style={{
                                            fontSize: '9.5px',
                                            fontWeight: 700,
                                            padding: '1px 5px',
                                            borderRadius: '4px',
                                            background: '#f0fdf4',
                                            color: '#166534',
                                            border: '1px solid #bbf7d0',
                                          }}
                                        >
                                          3 Sub-Units
                                        </span>
                                      )}
                                    </a>
                                  </td>
                                  <td><b>{s.total}</b></td>
                                  <td><span style={{ color: '#166534', fontWeight: 600 }}>{s.completed}</span></td>
                                  <td><span style={{ color: '#0369a1', fontWeight: 600 }}>{s.inProgress}</span></td>
                                  <td><span style={{ color: '#64748b' }}>{n}</span></td>
                                  <td>{renderMiniProgressBar(u.items)}</td>
                                  {STATUS_COLUMNS.map((col) => {
                                    const done = getDoneStageCount(u.items, col.key);
                                    const total = u.items.length;
                                    const isAllDone = total > 0 && done === total;
                                    const isPartDone = done > 0 && !isAllDone;
                                    return (
                                      <td
                                        key={col.key}
                                        className="ct"
                                        style={{ textAlign: 'center' }}
                                        title={`${u.name} — ${col.short}: ${done} of ${total} completed (${col.doneValue})`}
                                      >
                                        <span
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            minWidth: '24px',
                                            height: '20px',
                                            padding: '0 6px',
                                            borderRadius: '4px',
                                            fontSize: '11px',
                                            fontWeight: 700,
                                            background: isAllDone ? '#dcfce7' : isPartDone ? '#e0f2fe' : '#f1f5f9',
                                            color: isAllDone ? '#166534' : isPartDone ? '#0284c7' : '#64748b',
                                            border: isAllDone
                                              ? '1px solid #bbf7d0'
                                              : isPartDone
                                              ? '1px solid #bae6fd'
                                              : '1px solid #e2e8f0',
                                          }}
                                        >
                                          {done}
                                        </span>
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                    <div className="note" style={{ marginTop: '8px' }}>
                      Stage columns show work completed/issued counts (Format-I/II/III/IV/V = Issued, Internal Insp. = Yes, Base Line UTG = Yes, PMI = Yes, Final Accept. = Accepted).
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
                            <th style={{ minWidth: '150px' }}>Stage Progress</th>
                            {STATUS_COLUMNS.map((col) => (
                              <th
                                key={col.key}
                                className="ct"
                                title={`Work completed / issued count (${col.doneValue})`}
                                style={{ minWidth: '82px', textAlign: 'center' }}
                              >
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1px', width: '100%' }}>
                                  <span style={{ textAlign: 'center' }}>{col.short}</span>
                                  <span style={{ fontSize: '9px', textTransform: 'none', color: '#0369a1', fontWeight: 700, textAlign: 'center' }}>
                                    ({col.doneValue})
                                  </span>
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {overallUniqueSystems
                            .filter((sys) => {
                              if (!kpiSearch) return true;
                              const q = kpiSearch.toLowerCase();
                              return (
                                sys.systemName.toLowerCase().includes(q) ||
                                sys.unit.toLowerCase().includes(q) ||
                                (sys.subUnit && sys.subUnit.toLowerCase().includes(q))
                              );
                            })
                            .map((sys) => {
                              const c = sys.items.filter((r) => getEquipmentOverallStatus(r) === 'Completed').length;
                              const p = sys.items.filter((r) => getEquipmentOverallStatus(r) === 'In progress').length;
                              const n = sys.items.length - c - p;
                              return (
                                <tr key={sys.key}>
                                  <td>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                      <span style={{ fontWeight: 700, color: 'var(--tx)' }}>
                                        {sys.unit} › {sys.systemName}
                                      </span>
                                      {sys.subUnit && (
                                        <span style={{ fontSize: '10px', color: '#0369a1', fontWeight: 600 }}>
                                          Sub-Unit: {sys.subUnit}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td><b>{sys.items.length}</b></td>
                                  <td><span style={{ color: '#166534', fontWeight: 600 }}>{c}</span></td>
                                  <td><span style={{ color: '#0369a1', fontWeight: 600 }}>{p}</span></td>
                                  <td><span style={{ color: '#64748b' }}>{n}</span></td>
                                  <td>{renderMiniProgressBar(sys.items)}</td>
                                  {STATUS_COLUMNS.map((col) => {
                                    const done = getDoneStageCount(sys.items, col.key);
                                    const total = sys.items.length;
                                    const isAllDone = total > 0 && done === total;
                                    const isPartDone = done > 0 && !isAllDone;
                                    return (
                                      <td
                                        key={col.key}
                                        className="ct"
                                        style={{ textAlign: 'center' }}
                                        title={`${sys.unit} › ${sys.systemName} — ${col.short}: ${done} of ${total} completed (${col.doneValue})`}
                                      >
                                        <span
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            minWidth: '24px',
                                            height: '20px',
                                            padding: '0 6px',
                                            borderRadius: '4px',
                                            fontSize: '11px',
                                            fontWeight: 700,
                                            background: isAllDone ? '#dcfce7' : isPartDone ? '#e0f2fe' : '#f1f5f9',
                                            color: isAllDone ? '#166534' : isPartDone ? '#0284c7' : '#64748b',
                                            border: isAllDone
                                              ? '1px solid #bbf7d0'
                                              : isPartDone
                                              ? '1px solid #bae6fd'
                                              : '1px solid #e2e8f0',
                                          }}
                                        >
                                          {done}
                                        </span>
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                    <div className="note" style={{ marginTop: '8px' }}>
                      Stage columns show work completed/issued counts (Format-I/II/III/IV/V = Issued, Internal Insp. = Yes, Base Line UTG = Yes, PMI = Yes, Final Accept. = Accepted).
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
                    {(() => {
                      const statusScopedKpiItems = equipment.filter(
                        (r) => kpiFilter === 'all' || getEquipmentOverallStatus(r) === kpiFilter
                      );
                      const availableTypes = getAvailableEquipmentTypes(statusScopedKpiItems);
                      const filteredKpiEquip = statusScopedKpiItems.filter((r) => {
                        if (kpiTypeFilter && (r.EquipmentType || '').trim() !== kpiTypeFilter) return false;
                        if (!kpiSearch) return true;
                        const q = kpiSearch.toLowerCase();
                        return (
                          r.EquipmentTagNo?.toLowerCase().includes(q) ||
                          r.EquipmentDescription?.toLowerCase().includes(q) ||
                          r.EquipmentType?.toLowerCase().includes(q) ||
                          r.Unit?.toLowerCase().includes(q) ||
                          r.SystemNo?.toLowerCase().includes(q) ||
                          r.BaseLineUTG?.toLowerCase().includes(q) ||
                          r.PMI?.toLowerCase().includes(q) ||
                          r.DocumentDrawing?.toLowerCase().includes(q)
                        );
                      });
                      const effectiveSize = equipPageSize > 0 ? equipPageSize : filteredKpiEquip.length || 1;
                      const safePage = Math.min(equipPage, Math.max(1, Math.ceil(filteredKpiEquip.length / effectiveSize)));
                      const pagedKpiEquip =
                        equipPageSize > 0
                          ? filteredKpiEquip.slice((safePage - 1) * effectiveSize, safePage * effectiveSize)
                          : filteredKpiEquip;

                      return (
                        <>
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
                            <input
                              className="tsf"
                              style={{ maxWidth: '340px', margin: 0 }}
                              placeholder="🔍 Search tag, description, type, unit, system…"
                              value={kpiSearch}
                              onChange={(e) => setKpiSearch(e.target.value)}
                            />
                            <select
                              value={kpiTypeFilter}
                              onChange={(e) => setKpiTypeFilter(e.target.value)}
                              style={{
                                padding: '6px 10px',
                                fontSize: '12px',
                                borderRadius: '6px',
                                border: '1px solid var(--bd)',
                                background: '#ffffff',
                                color: 'var(--tx)',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                              title="Filter by Equipment Type"
                            >
                              <option value="">All Types ({availableTypes.length})</option>
                              {availableTypes.map(({ type, count }) => (
                                <option key={type} value={type}>
                                  {type} ({count})
                                </option>
                              ))}
                            </select>
                            <span style={{ fontSize: '12px', color: 'var(--mu)' }}>
                              Showing {filteredKpiEquip.length} equipment
                            </span>
                          </div>

                          <div
                            className="tw"
                            style={{
                              maxHeight: '420px',
                              overflowY: 'auto',
                              overflowX: 'auto',
                              border: '1px solid var(--bd)',
                              borderRadius: '8px',
                            }}
                          >
                            <table className="nrep-table">
                              <thead style={{ position: 'sticky', top: 0, zIndex: 4, background: '#f8fafc', boxShadow: '0 1px 0 var(--bd)' }}>
                                <tr>
                                  <th>Tag No.</th>
                                  <th>Description</th>
                                  <th>Type</th>
                                  <th>Unit</th>
                                  <th>System</th>
                                  <th>Status</th>
                                  <th>Progress</th>
                                  <th>Base Line UTG</th>
                                  <th>PMI</th>
                                  <th>Document/Drawing</th>
                                </tr>
                              </thead>
                              <tbody>
                                {pagedKpiEquip.map((r) => (
                                  <tr key={r.id}>
                                    <td>
                                      <a href={`#eq-${encodeURIComponent(r.EquipmentTagNo)}`}>
                                        <b>{r.EquipmentTagNo}</b>
                                      </a>
                                    </td>
                                    <td>{r.EquipmentDescription || '—'}</td>
                                    <td>{r.EquipmentType || '—'}</td>
                                    <td>{r.Unit}</td>
                                    <td>{r.SystemNo}</td>
                                    <td>{renderStatusChip(getEquipmentOverallStatus(r))}</td>
                                    <td>{calculateProgress([r])}%</td>
                                    <td>{renderStatusChip(r.BaseLineUTG)}</td>
                                    <td>{renderStatusChip(r.PMI)}</td>
                                    <td>{renderDocumentDrawing(r.DocumentDrawing, r)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {renderPaginationBar(filteredKpiEquip.length)}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* When NO KPI filter is active: show the standard full home page overview */}
            {!kpiFilter && (
              <>
                {/* Level 1 Dual Containers: Unit-wise Status & Completed Work Progress + Unit-wise Remarks & Comments */}
                <div className="unit-overview-dual-row">
                  {/* Container 1: Unit-wise Status & Stage Completed Progress (Compacted) */}
                  <div className="cd" style={{ margin: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <h3 style={{ margin: 0 }}>Unit-wise status and stage completed (level 1 of hierarchy)</h3>
                        <span style={{ fontSize: '11px', color: 'var(--mu)' }}>
                          Stage columns show completed work / issued count
                        </span>
                      </div>
                      <input
                        className="tsf"
                        style={{ maxWidth: '200px', margin: 0, padding: '4px 8px', fontSize: '12px' }}
                        placeholder="🔍 Search unit…"
                        value={tableSearch}
                        onChange={(e) => setTableSearch(e.target.value)}
                      />
                    </div>

                    <div className="tw" style={{ flex: 1, maxHeight: '380px', overflowY: 'auto' }}>
                      <table className="nrep-table">
                        <thead style={{ position: 'sticky', top: 0, zIndex: 4, background: 'var(--tr)' }}>
                          <tr>
                            <th>Unit</th>
                            <th>Equip.</th>
                            <th>Completed</th>
                            <th>In prog.</th>
                            <th>Not started</th>
                            <th style={{ minWidth: '155px' }}>Stage Progress</th>
                            {STATUS_COLUMNS.map((col) => (
                              <th
                                key={col.key}
                                className="ct"
                                title={`Work completed / issued count (${col.doneValue})`}
                                style={{ minWidth: '82px', textAlign: 'center' }}
                              >
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1px', width: '100%' }}>
                                  <span style={{ textAlign: 'center' }}>{col.short}</span>
                                  <span style={{ fontSize: '9px', textTransform: 'none', color: '#0369a1', fontWeight: 700, textAlign: 'center' }}>
                                    ({col.doneValue})
                                  </span>
                                </div>
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
                                      {u.name === 'MSP' && (
                                        <span
                                          style={{
                                            fontSize: '9.5px',
                                            fontWeight: 700,
                                            padding: '1px 5px',
                                            borderRadius: '4px',
                                            background: '#f0fdf4',
                                            color: '#166534',
                                            border: '1px solid #bbf7d0',
                                          }}
                                        >
                                          3 Sub-Units
                                        </span>
                                      )}
                                    </a>
                                  </td>
                                  <td><b>{u.items.length}</b></td>
                                  <td><span style={{ color: '#166534', fontWeight: 600 }}>{c}</span></td>
                                  <td><span style={{ color: '#0369a1', fontWeight: 600 }}>{p}</span></td>
                                  <td><span style={{ color: '#64748b' }}>{n}</span></td>
                                  <td>{renderMiniProgressBar(u.items)}</td>
                                  {STATUS_COLUMNS.map((col) => {
                                    const done = getDoneStageCount(u.items, col.key);
                                    const total = u.items.length;
                                    const isAllDone = total > 0 && done === total;
                                    const isPartDone = done > 0 && !isAllDone;
                                    return (
                                      <td
                                        key={col.key}
                                        className="ct"
                                        style={{ textAlign: 'center' }}
                                        title={`${u.name} — ${col.short}: ${done} of ${total} completed (${col.doneValue})`}
                                      >
                                        <span
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            minWidth: '24px',
                                            height: '20px',
                                            padding: '0 6px',
                                            borderRadius: '4px',
                                            fontSize: '11px',
                                            fontWeight: 700,
                                            background: isAllDone ? '#dcfce7' : isPartDone ? '#e0f2fe' : '#f1f5f9',
                                            color: isAllDone ? '#166534' : isPartDone ? '#0284c7' : '#64748b',
                                            border: isAllDone
                                              ? '1px solid #bbf7d0'
                                              : isPartDone
                                              ? '1px solid #bae6fd'
                                              : '1px solid #e2e8f0',
                                          }}
                                        >
                                          {done}
                                        </span>
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                    <div className="note" style={{ marginTop: '8px' }}>
                      Stage columns show work completed/issued counts (Format-I/II/III/IV/V = Issued, Internal Insp. = Yes, Base Line UTG = Yes, PMI = Yes, Final Accept. = Accepted). Percentage is rolled up across hierarchy.
                    </div>
                  </div>

                  {/* Container 2: Unit-wise Remarks & Comments Summary (Compact Width) */}
                  <div
                    className="cd unit-remarks-container"
                    style={{
                      margin: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      padding: '11px 10px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px', gap: '4px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <MessageSquare size={13} color="#0284c7" />
                          <h3 style={{ margin: 0, fontSize: '12px', whiteSpace: 'nowrap' }}>Remarks &amp; Notes</h3>
                        </div>
                        <span style={{ fontSize: '10.5px', color: 'var(--mu)' }}>
                          Click unit to view comments
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: '10px',
                          background: '#fef3c7',
                          color: '#b45309',
                          border: '1px solid #fde68a',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {equipment.filter((r) => (r.Remarks || '').trim().length > 0).length} active
                      </span>
                    </div>

                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '380px', overflowY: 'auto', paddingRight: '2px' }}>
                      {treeData.map((u) => {
                        const unitComments = u.items.filter((r) => (r.Remarks || '').trim().length > 0);
                        const count = unitComments.length;
                        return (
                          <div
                            key={u.id}
                            className="unit-remarks-card"
                            onClick={() => {
                              setRemarksFilterSearch('');
                              setRemarksModalUnit(u.name);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '7px 9px',
                              borderRadius: '5px',
                              border: count > 0 ? '1px solid #cbd5e1' : '1px solid #e2e8f0',
                              background: count > 0 ? '#ffffff' : '#f8fafc',
                              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.02)',
                            }}
                            title={`Click to view ${count} equipment comments in ${u.name}`}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontWeight: 700, fontSize: '12px', color: '#0f172a' }}>{u.name}</span>
                                {u.name === 'UTILITY' && (
                                  <span
                                    style={{
                                      fontSize: '8.5px',
                                      fontWeight: 700,
                                      padding: '0px 4px',
                                      borderRadius: '3px',
                                      background: '#e0f2fe',
                                      color: '#0369a1',
                                      border: '1px solid #bae6fd',
                                    }}
                                  >
                                    8 Sub
                                  </span>
                                )}
                                {u.name === 'MSP' && (
                                  <span
                                    style={{
                                      fontSize: '8.5px',
                                      fontWeight: 700,
                                      padding: '0px 4px',
                                      borderRadius: '3px',
                                      background: '#f0fdf4',
                                      color: '#166534',
                                      border: '1px solid #bbf7d0',
                                    }}
                                  >
                                    3 Sub
                                  </span>
                                )}
                              </div>
                              <span style={{ fontSize: '10px', color: 'var(--mu)' }}>
                                {u.items.length} equip.
                              </span>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '2px',
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  padding: '1px 6px',
                                  borderRadius: '10px',
                                  background: count > 0 ? '#fef3c7' : '#f1f5f9',
                                  color: count > 0 ? '#92400e' : '#64748b',
                                  border: count > 0 ? '1px solid #fde68a' : '1px solid #e2e8f0',
                                }}
                              >
                                💬 {count}
                              </span>
                              <ChevronRight size={12} color="#64748b" />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div
                      style={{
                        marginTop: '6px',
                        paddingTop: '6px',
                        borderTop: '1px solid var(--bd)',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setRemarksFilterSearch('');
                          setRemarksModalUnit('ALL');
                        }}
                        style={{
                          width: '100%',
                          justifyContent: 'center',
                          fontSize: '11px',
                          fontWeight: 600,
                          padding: '4px 8px',
                          background: '#e0f2fe',
                          color: '#0369a1',
                          border: '1px solid #bae6fd',
                          borderRadius: '5px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <MessageSquare size={11} />
                        View All ({equipment.filter((r) => (r.Remarks || '').trim().length > 0).length})
                      </button>
                    </div>
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

            {(() => {
              const unitUniqueSystems = getUniqueSystemsFromList(activeUnit.items);
              const compPct = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;
              const progPct = stats.total ? Math.round((stats.inProgress / stats.total) * 100) : 0;
              const notStartPct = stats.total ? Math.round((stats.notStarted / stats.total) * 100) : 0;

              return (
                <div className="kp">
                  {renderProfessionalKpiCard({
                    label: 'Systems',
                    value: unitUniqueSystems.length,
                    subtext: `${unitUniqueSystems.length} unique in System col`,
                    badgeText: 'Unit Scope',
                    pctBar: 100,
                    theme: 'indigo',
                    icon: <Layers size={13} />,
                    active: kpiFilter === 'systems',
                    onClick: () => {
                      setKpiSearch('');
                      setKpiFilter(kpiFilter === 'systems' ? null : 'systems');
                    },
                    title: 'Click to see unique systems in this unit (System column)',
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
                      ? `Systems in ${activeUnit.name} (${getUniqueSystemsFromList(activeUnit.items).length} unique systems)`
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
                </div>

                {kpiFilter === 'systems' && (() => {
                  const unitUniqueSystems = getUniqueSystemsFromList(activeUnit.items);
                  return (
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
                              <th style={{ minWidth: '150px' }}>Stage Progress</th>
                              {STATUS_COLUMNS.map((col) => (
                                <th
                                  key={col.key}
                                  className="ct"
                                  title={`Work completed / issued count (${col.doneValue})`}
                                  style={{ minWidth: '82px', textAlign: 'center' }}
                                >
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1px', width: '100%' }}>
                                    <span style={{ textAlign: 'center' }}>{col.short}</span>
                                    <span style={{ fontSize: '9px', textTransform: 'none', color: '#0369a1', fontWeight: 700, textAlign: 'center' }}>
                                      ({col.doneValue})
                                    </span>
                                  </div>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {unitUniqueSystems
                              .filter(
                                (sys) =>
                                  !kpiSearch ||
                                  sys.systemName.toLowerCase().includes(kpiSearch.toLowerCase()) ||
                                  (sys.subUnit && sys.subUnit.toLowerCase().includes(kpiSearch.toLowerCase()))
                              )
                              .map((sys) => {
                                const c = sys.items.filter((r) => getEquipmentOverallStatus(r) === 'Completed').length;
                                const p = sys.items.filter((r) => getEquipmentOverallStatus(r) === 'In progress').length;
                                const n = sys.items.length - c - p;
                                return (
                                  <tr key={sys.key}>
                                    <td>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        <span style={{ fontWeight: 700, color: 'var(--tx)' }}>
                                          {sys.systemName}
                                        </span>
                                        {sys.subUnit && (
                                          <span style={{ fontSize: '10px', color: '#0369a1', fontWeight: 600 }}>
                                            Sub-Unit: {sys.subUnit}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td><b>{sys.items.length}</b></td>
                                    <td><span style={{ color: '#166534', fontWeight: 600 }}>{c}</span></td>
                                    <td><span style={{ color: '#0369a1', fontWeight: 600 }}>{p}</span></td>
                                    <td><span style={{ color: '#64748b' }}>{n}</span></td>
                                    <td>{renderMiniProgressBar(sys.items)}</td>
                                    {STATUS_COLUMNS.map((col) => {
                                      const done = getDoneStageCount(sys.items, col.key);
                                      const total = sys.items.length;
                                      const isAllDone = total > 0 && done === total;
                                      const isPartDone = done > 0 && !isAllDone;
                                      return (
                                        <td
                                          key={col.key}
                                          className="ct"
                                          style={{ textAlign: 'center' }}
                                          title={`${sys.systemName} — ${col.short}: ${done} of ${total} completed (${col.doneValue})`}
                                        >
                                          <span
                                            style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              minWidth: '24px',
                                              height: '20px',
                                              padding: '0 6px',
                                              borderRadius: '4px',
                                              fontSize: '11px',
                                              fontWeight: 700,
                                              background: isAllDone ? '#dcfce7' : isPartDone ? '#e0f2fe' : '#f1f5f9',
                                              color: isAllDone ? '#166534' : isPartDone ? '#0284c7' : '#64748b',
                                              border: isAllDone
                                                ? '1px solid #bbf7d0'
                                                : isPartDone
                                                ? '1px solid #bae6fd'
                                                : '1px solid #e2e8f0',
                                            }}
                                          >
                                            {done}
                                          </span>
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                      <div className="note" style={{ marginTop: '8px' }}>
                        Stage columns show work completed/issued counts (Format-I/II/III = Issued, Internal Insp. = Yes, Base Line UTG = Yes, Final Accept. = Accepted).
                      </div>
                    </div>
                  );
                })()}

                {kpiFilter === 'prog' && (
                  <div>{renderStageWiseBars(activeUnit.items)}</div>
                )}

                {['all', 'Completed', 'In progress', 'Not started'].includes(kpiFilter) && (
                  <div>
                    {(() => {
                      const statusScopedUnitKpiItems = activeUnit.items.filter(
                        (r) => kpiFilter === 'all' || getEquipmentOverallStatus(r) === kpiFilter
                      );
                      const availableTypes = getAvailableEquipmentTypes(statusScopedUnitKpiItems);
                      const filteredUnitKpiEquip = statusScopedUnitKpiItems.filter((r) => {
                        if (kpiTypeFilter && (r.EquipmentType || '').trim() !== kpiTypeFilter) return false;
                        if (!kpiSearch) return true;
                        const q = kpiSearch.toLowerCase();
                        return (
                          r.EquipmentTagNo?.toLowerCase().includes(q) ||
                          r.EquipmentDescription?.toLowerCase().includes(q) ||
                          r.EquipmentType?.toLowerCase().includes(q) ||
                          r.SystemNo?.toLowerCase().includes(q) ||
                          r.BaseLineUTG?.toLowerCase().includes(q) ||
                          r.PMI?.toLowerCase().includes(q) ||
                          r.DocumentDrawing?.toLowerCase().includes(q)
                        );
                      });
                      const effectiveSize = equipPageSize > 0 ? equipPageSize : filteredUnitKpiEquip.length || 1;
                      const safePage = Math.min(equipPage, Math.max(1, Math.ceil(filteredUnitKpiEquip.length / effectiveSize)));
                      const pagedUnitKpiEquip =
                        equipPageSize > 0
                          ? filteredUnitKpiEquip.slice((safePage - 1) * effectiveSize, safePage * effectiveSize)
                          : filteredUnitKpiEquip;

                      return (
                        <>
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
                            <input
                              className="tsf"
                              style={{ maxWidth: '340px', margin: 0 }}
                              placeholder="🔍 Search tag, description, type, system…"
                              value={kpiSearch}
                              onChange={(e) => setKpiSearch(e.target.value)}
                            />
                            <select
                              value={kpiTypeFilter}
                              onChange={(e) => setKpiTypeFilter(e.target.value)}
                              style={{
                                padding: '6px 10px',
                                fontSize: '12px',
                                borderRadius: '6px',
                                border: '1px solid var(--bd)',
                                background: '#ffffff',
                                color: 'var(--tx)',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                              title="Filter by Equipment Type"
                            >
                              <option value="">All Types ({availableTypes.length})</option>
                              {availableTypes.map(({ type, count }) => (
                                <option key={type} value={type}>
                                  {type} ({count})
                                </option>
                              ))}
                            </select>
                            <span style={{ fontSize: '12px', color: 'var(--mu)' }}>
                              Showing {filteredUnitKpiEquip.length} equipment
                            </span>
                          </div>

                          <div
                            className="tw"
                            style={{
                              maxHeight: '420px',
                              overflowY: 'auto',
                              overflowX: 'auto',
                              border: '1px solid var(--bd)',
                              borderRadius: '8px',
                            }}
                          >
                            <table className="nrep-table">
                              <thead style={{ position: 'sticky', top: 0, zIndex: 4, background: '#f8fafc', boxShadow: '0 1px 0 var(--bd)' }}>
                                <tr>
                                  <th>Tag No.</th>
                                  <th>Description</th>
                                  <th>Type</th>
                                  <th>System</th>
                                  <th>Status</th>
                                  <th>Progress</th>
                                  <th>Base Line UTG</th>
                                  <th>PMI</th>
                                  <th>Document/Drawing</th>
                                </tr>
                              </thead>
                              <tbody>
                                {pagedUnitKpiEquip.map((r) => (
                                  <tr key={r.id}>
                                    <td>
                                      <a href={`#eq-${encodeURIComponent(r.EquipmentTagNo)}`}>
                                        <b>{r.EquipmentTagNo}</b>
                                      </a>
                                    </td>
                                    <td>{r.EquipmentDescription || '—'}</td>
                                    <td>{r.EquipmentType || '—'}</td>
                                    <td>{r.SystemNo}</td>
                                    <td>{renderStatusChip(getEquipmentOverallStatus(r))}</td>
                                    <td>{calculateProgress([r])}%</td>
                                    <td>{renderStatusChip(r.BaseLineUTG)}</td>
                                    <td>{renderStatusChip(r.PMI)}</td>
                                    <td>{renderDocumentDrawing(r.DocumentDrawing, r)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {renderPaginationBar(filteredUnitKpiEquip.length)}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* When NO KPI filter is active in Unit view: show Sub-Units (for UTILITY/MSP) + Equipment list + unit overview charts below */}
            {!kpiFilter && (
              <>
                {/* If Unit has Sub-Units, Systems, or Sub-Systems: Display the Hierarchy Nodes Matrix Table */}
                {activeUnit.children.length > 0 && (
                  <div className="cd">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                      <h3 style={{ margin: 0 }}>
                        Sub-Units / Systems / Sub-Systems in {activeUnit.name} (Click any level to open its Equipment)
                      </h3>
                    </div>
                    <div className="tw">
                      <table className="nrep-table">
                        <thead>
                          <tr>
                            <th>Hierarchy Path ({activeUnit.name})</th>
                            <th>Level</th>
                            <th>Equip.</th>
                            <th>Completed</th>
                            <th>In prog.</th>
                            <th>Not started</th>
                            <th style={{ minWidth: '150px' }}>Stage Progress</th>
                            {STATUS_COLUMNS.map((col) => (
                              <th
                                key={col.key}
                                className="ct"
                                title={`Work completed / issued count (${col.doneValue})`}
                                style={{ minWidth: '82px', textAlign: 'center' }}
                              >
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1px', width: '100%' }}>
                                  <span style={{ textAlign: 'center' }}>{col.short}</span>
                                  <span style={{ fontSize: '9px', textTransform: 'none', color: '#0369a1', fontWeight: 700, textAlign: 'center' }}>
                                    ({col.doneValue})
                                  </span>
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {activeUnit.tableSystems.map((sys) => {
                            const c = sys.items.filter((r) => getEquipmentOverallStatus(r) === 'Completed').length;
                            const p = sys.items.filter((r) => getEquipmentOverallStatus(r) === 'In progress').length;
                            const n = sys.items.length - c - p;
                            return (
                              <tr key={sys.id}>
                                <td>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <a href={`#${sys.id}`}>
                                      <b>{sys.name}</b>
                                    </a>
                                    {sys.children.length > 0 && (
                                      <span style={{ fontSize: '10px', color: '#0369a1', fontWeight: 600 }}>
                                        ↳ {sys.children.length} {sys.children[0]?.levelBadge || 'Sub-System'}
                                        {sys.children.length > 1 ? 's' : ''}: {sys.children.map((ch) => ch.name).join(', ')}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td>
                                  <span className="c a" style={{ fontSize: '10px', fontWeight: 700 }}>
                                    {sys.levelBadge}
                                  </span>
                                </td>
                                <td><b>{sys.items.length}</b></td>
                                <td><span style={{ color: '#166534', fontWeight: 600 }}>{c}</span></td>
                                <td><span style={{ color: '#0369a1', fontWeight: 600 }}>{p}</span></td>
                                <td><span style={{ color: '#64748b' }}>{n}</span></td>
                                <td>{renderMiniProgressBar(sys.items)}</td>
                                {STATUS_COLUMNS.map((col) => {
                                  const done = getDoneStageCount(sys.items, col.key);
                                  const total = sys.items.length;
                                  const isAllDone = total > 0 && done === total;
                                  const isPartDone = done > 0 && !isAllDone;
                                  return (
                                    <td
                                      key={col.key}
                                      className="ct"
                                      style={{ textAlign: 'center' }}
                                      title={`${sys.pathLabel} — ${col.short}: ${done} of ${total} completed (${col.doneValue})`}
                                    >
                                      <span
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          minWidth: '24px',
                                          height: '20px',
                                          padding: '0 6px',
                                          borderRadius: '4px',
                                          fontSize: '11px',
                                          fontWeight: 700,
                                          background: isAllDone ? '#dcfce7' : isPartDone ? '#e0f2fe' : '#f1f5f9',
                                          color: isAllDone ? '#166534' : isPartDone ? '#0284c7' : '#64748b',
                                          border: isAllDone
                                            ? '1px solid #bbf7d0'
                                            : isPartDone
                                            ? '1px solid #bae6fd'
                                            : '1px solid #e2e8f0',
                                        }}
                                      >
                                        {done}
                                      </span>
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

                {/* Direct Equipment Table inside the Unit */}
                <div className="cd">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
                    <h3 style={{ margin: 0 }}>
                      {`Equipment List in ${activeUnit.name} (${activeUnit.items.length} Equipment)`}
                    </h3>
                    {isEditor && (
                      <button
                        type="button"
                        onClick={() =>
                          setEditingEquipment({
                            id: '',
                            Unit: activeUnit.name,
                            SubUnit: '',
                            SystemNo: '',
                            SubSystem: '',
                            EquipmentTagNo: '',
                            EquipmentDescription: '',
                            EquipmentType: '',
                            FormatIStatus: 'Not Issued',
                            FormatIIStatus: 'Not Issued',
                            FormatIIIStatus: 'Not Issued',
                            FormatIVStatus: 'Not Issued',
                            FormatVStatus: 'Not Issued',
                            InternalInspectionStatus: 'No',
                            BaseLineUTG: 'No',
                            PMI: 'No',
                            FinalSystemAcceptance: 'Not Accepted',
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

                  {(() => {
                    const availableUnitTypes = getAvailableEquipmentTypes(activeUnit.items);
                    return (
                      <div className="tools">
                        <input
                          placeholder="🔍 Search tag, description, type, sub-unit, system, sub-system, Base Line UTG, PMI, remarks…"
                          value={systemSearch}
                          onChange={(e) => setSystemSearch(e.target.value)}
                        />
                        <select
                          value={systemTypeFilter}
                          onChange={(e) => setSystemTypeFilter(e.target.value)}
                          title="Filter by Equipment Type (e.g. Vessel, Exchanger)"
                        >
                          <option value="">All Types ({availableUnitTypes.length})</option>
                          {availableUnitTypes.map(({ type, count }) => (
                            <option key={type} value={type}>
                              {type} ({count})
                            </option>
                          ))}
                        </select>
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
                    );
                  })()}

                  {activeUnit.items.length === 0 ? (
                    <div className="empty">No equipment in {activeUnit.name} yet. Click &quot;+ Add Equipment&quot; above to add records.</div>
                  ) : (
                    (() => {
                      const filteredUnitItems = activeUnit.items.filter((r) => {
                        const q = systemSearch.toLowerCase();
                        const matchesSearch =
                          !q || Object.values(r).join(' ').toLowerCase().includes(q);
                        const matchesFilter =
                          !systemStatusFilter || getEquipmentOverallStatus(r) === systemStatusFilter;
                        const matchesType =
                          !systemTypeFilter || (r.EquipmentType || '').trim() === systemTypeFilter;
                        return matchesSearch && matchesFilter && matchesType;
                      });

                      if (filteredUnitItems.length === 0) {
                        return <div className="empty">No matching equipment found in {activeUnit.name}.</div>;
                      }

                      const effectiveSize = equipPageSize > 0 ? equipPageSize : filteredUnitItems.length || 1;
                      const safePage = Math.min(equipPage, Math.max(1, Math.ceil(filteredUnitItems.length / effectiveSize)));
                      const pagedUnitItems =
                        equipPageSize > 0
                          ? filteredUnitItems.slice((safePage - 1) * effectiveSize, safePage * effectiveSize)
                          : filteredUnitItems;

                      return (
                        <>
                          <div
                            className="tw"
                            style={{
                              maxHeight: '420px',
                              overflowY: 'auto',
                              overflowX: 'auto',
                              border: '1px solid var(--bd)',
                              borderRadius: '8px',
                            }}
                          >
                            <table className="nrep-table">
                              <thead style={{ position: 'sticky', top: 0, zIndex: 4, background: '#f8fafc', boxShadow: '0 1px 0 var(--bd)' }}>
                                <tr>
                                  <th>Tag No.</th>
                                  <th>Hierarchy (Sub-Unit › System › Sub-System)</th>
                                  <th>Description</th>
                                  <th>Type</th>
                                  <th>Status</th>
                                  <th>Progress</th>
                                  {STATUS_COLUMNS.map((col) => (
                                    <th key={col.key}>{col.short}</th>
                                  ))}
                                  <th>Document/Drawing</th>
                                </tr>
                              </thead>
                              <tbody>
                                {pagedUnitItems.map((r) => {
                                  const overall = getEquipmentOverallStatus(r);
                                  const eqPct = calculateProgress([r]);
                                  const subChain = getEquipmentHierarchyChain(r).slice(1);
                                  return (
                                    <tr key={r.id}>
                                      <td>
                                        <a href={`#eq-${encodeURIComponent(r.EquipmentTagNo)}`}>
                                          <b>{r.EquipmentTagNo}</b>
                                        </a>
                                      </td>
                                      <td>
                                        {subChain.length > 0 ? (
                                          <span className="c a" style={{ fontWeight: 700 }}>
                                            {subChain.map((s) => s.value).join(' › ')}
                                          </span>
                                        ) : (
                                          <span style={{ color: 'var(--mu)', fontSize: '11px' }}>
                                            Direct in {r.Unit}
                                          </span>
                                        )}
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
                                            {renderStatusChip(val)}
                                          </td>
                                        );
                                      })}
                                      <td>{renderDocumentDrawing(r.DocumentDrawing, r)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          {renderPaginationBar(filteredUnitItems.length)}
                        </>
                      );
                    })()
                  )}
                </div>

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
              </>
            )}
          </>
        )}

        {/* LEVEL 3: SUB-UNIT / SYSTEM / SUB-SYSTEM VIEW WITH EQUIPMENT TABLE */}
        {viewLevel === 's' && activeUnit && activeSystem && (
          <>
            <div className="bc">
              <a href="#" onClick={goToHome}>NREP Project</a> › <a href={`#${activeUnit.id}`}>{activeUnit.name}</a>
              {activeSystem.ancestorIds.map((ancId, idx) => {
                const ancNode = activeUnit.systems.find((s) => s.id === ancId);
                if (!ancNode) return null;
                const isLast = idx === activeSystem.ancestorIds.length - 1;
                return (
                  <React.Fragment key={ancId}>
                    {' › '}
                    {isLast ? (
                      <span>{ancNode.name}</span>
                    ) : (
                      <a href={`#${ancNode.id}`}>{ancNode.name}</a>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
              <h2 className="t" style={{ margin: 0 }}>
                {`${activeSystem.levelBadge}: ${activeSystem.name} (${activeUnit.name}${activeSystem.pathLabel !== activeSystem.name ? ` › ${activeSystem.pathLabel}` : ''})`}
              </h2>
              {isEditor && (
                <button
                  type="button"
                  onClick={() =>
                    setEditingEquipment({
                      id: '',
                      Unit: activeUnit.name,
                      SubUnit: activeSystem.subUnitName || '',
                      SystemNo: activeSystem.systemName || '',
                      SubSystem: activeSystem.subSystemName || '',
                      EquipmentTagNo: '',
                      EquipmentDescription: '',
                      EquipmentType: '',
                      FormatIStatus: 'Not Issued',
                      FormatIIStatus: 'Not Issued',
                      FormatIIIStatus: 'Not Issued',
                      FormatIVStatus: 'Not Issued',
                      FormatVStatus: 'Not Issued',
                      InternalInspectionStatus: 'No',
                      BaseLineUTG: 'No',
                      PMI: 'No',
                      FinalSystemAcceptance: 'Not Accepted',
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
              const childLevelPlural = activeSystem.children.length > 0
                ? `${activeSystem.children[0]?.levelBadge || 'Sub-System'}s`
                : 'Sub-Systems';
              const toggleKpi = (filter: string) => {
                setKpiSearch('');
                setKpiTypeFilter('');
                setKpiFilter(kpiFilter === filter ? null : filter);
              };

              return (
                <div className="kp">
                  {activeSystem.children.length > 0 &&
                    renderProfessionalKpiCard({
                      label: childLevelPlural,
                      value: activeSystem.children.length,
                      subtext: `In ${activeSystem.name}`,
                      badgeText: `${activeSystem.levelBadge} Scope`,
                      pctBar: 100,
                      theme: 'indigo',
                      icon: <Layers size={13} />,
                      active: kpiFilter === 'systems',
                      onClick: () => toggleKpi('systems'),
                      title: `Show ${childLevelPlural.toLowerCase()} in ${activeSystem.name}`,
                    })}

                  {renderProfessionalKpiCard({
                    label: 'Equipment',
                    value: stats.total,
                    subtext: `${activeSystem.levelBadge} equipment tags`,
                    badgeText: '100%',
                    pctBar: 100,
                    theme: 'cyan',
                    icon: <Cpu size={13} />,
                    active: kpiFilter === 'all',
                    onClick: () => toggleKpi('all'),
                    title: `Show all equipment in ${activeSystem.name}`,
                  })}

                  {renderProfessionalKpiCard({
                    label: 'Completed',
                    value: stats.completed,
                    subtext: `${compPct}% of ${activeSystem.levelBadge.toLowerCase()} tags`,
                    badgeText: `${compPct}%`,
                    pctBar: compPct,
                    theme: 'green',
                    icon: <CheckCircle2 size={13} />,
                    active: kpiFilter === 'Completed',
                    onClick: () => toggleKpi('Completed'),
                    title: 'Show completed equipment',
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
                    onClick: () => toggleKpi('In progress'),
                    title: 'Show in-progress equipment',
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
                    onClick: () => toggleKpi('Not started'),
                    title: 'Show not-started equipment',
                  })}

                  {renderProfessionalKpiCard({
                    label: 'Stage Progress',
                    value: `${stats.progressPct}%`,
                    subtext: `6-stage ${activeSystem.levelBadge.toLowerCase()} progress`,
                    badgeText: 'Live',
                    pctBar: stats.progressPct,
                    theme: 'blue',
                    icon: <TrendingUp size={13} />,
                    active: kpiFilter === 'prog',
                    onClick: () => toggleKpi('prog'),
                    title: `Show stage-wise breakdown in ${activeSystem.name}`,
                  })}
                </div>
              );
            })()}

            {/* Interactive KPI Drill-Down Card inside System / Sub-System View */}
            {kpiFilter && (
              <div id="kd" className="cd on">
                <div className="kdh">
                  <h3>
                    {kpiFilter === 'systems' &&
                      `${activeSystem.children[0]?.levelBadge || 'Sub-System'}s in ${activeSystem.name} (${activeSystem.children.length})`}
                    {kpiFilter === 'prog' && `Stage-wise Progress in ${activeSystem.name} (${stats.progressPct}% overall)`}
                    {kpiFilter === 'all' && `All Equipment in ${activeSystem.name} (${activeSystem.items.length})`}
                    {['Completed', 'In progress', 'Not started'].includes(kpiFilter) &&
                      `${kpiFilter} Equipment in ${activeSystem.name} (${
                        activeSystem.items.filter((r) => getEquipmentOverallStatus(r) === kpiFilter).length
                      })`}
                  </h3>
                </div>

                {kpiFilter === 'systems' && (
                  <div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
                      <input
                        className="tsf"
                        style={{ maxWidth: '340px', margin: 0 }}
                        placeholder={`🔍 Search ${(activeSystem.children[0]?.levelBadge || 'sub-system').toLowerCase()}s in ${activeSystem.name}…`}
                        value={kpiSearch}
                        onChange={(e) => setKpiSearch(e.target.value)}
                      />
                    </div>
                    <div className="tw">
                      <table className="nrep-table">
                        <thead>
                          <tr>
                            <th>{activeSystem.children[0]?.levelBadge || 'Sub-System'}</th>
                            <th>Level</th>
                            <th>Equip.</th>
                            <th>Completed</th>
                            <th>In prog.</th>
                            <th>Not started</th>
                            <th style={{ minWidth: '150px' }}>Stage Progress</th>
                            {STATUS_COLUMNS.map((col) => (
                              <th
                                key={col.key}
                                className="ct"
                                title={`Work completed / issued count (${col.doneValue})`}
                                style={{ minWidth: '82px', textAlign: 'center' }}
                              >
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1px', width: '100%' }}>
                                  <span style={{ textAlign: 'center' }}>{col.short}</span>
                                  <span style={{ fontSize: '9px', textTransform: 'none', color: '#0369a1', fontWeight: 700, textAlign: 'center' }}>
                                    ({col.doneValue})
                                  </span>
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {activeSystem.children
                            .filter(
                              (ch) =>
                                !kpiSearch ||
                                ch.name.toLowerCase().includes(kpiSearch.toLowerCase()) ||
                                ch.pathLabel.toLowerCase().includes(kpiSearch.toLowerCase())
                            )
                            .map((ch) => {
                              const c = ch.items.filter((r) => getEquipmentOverallStatus(r) === 'Completed').length;
                              const p = ch.items.filter((r) => getEquipmentOverallStatus(r) === 'In progress').length;
                              const n = ch.items.length - c - p;
                              return (
                                <tr key={ch.id}>
                                  <td>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                      <a href={`#${ch.id}`}>
                                        <b>{ch.name}</b>
                                      </a>
                                      {ch.children.length > 0 && (
                                        <span style={{ fontSize: '10px', color: '#0369a1', fontWeight: 600 }}>
                                          ↳ {ch.children.length} {ch.children[0]?.levelBadge || 'Sub-System'}
                                          {ch.children.length > 1 ? 's' : ''}: {ch.children.map((sub) => sub.name).join(', ')}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td>
                                    <span className="c a" style={{ fontSize: '10px', fontWeight: 700 }}>
                                      {ch.levelBadge}
                                    </span>
                                  </td>
                                  <td><b>{ch.items.length}</b></td>
                                  <td><span style={{ color: '#166534', fontWeight: 600 }}>{c}</span></td>
                                  <td><span style={{ color: '#0369a1', fontWeight: 600 }}>{p}</span></td>
                                  <td><span style={{ color: '#64748b' }}>{n}</span></td>
                                  <td>{renderMiniProgressBar(ch.items)}</td>
                                  {STATUS_COLUMNS.map((col) => {
                                    const done = getDoneStageCount(ch.items, col.key);
                                    const total = ch.items.length;
                                    const isAllDone = total > 0 && done === total;
                                    const isPartDone = done > 0 && !isAllDone;
                                    return (
                                      <td
                                        key={col.key}
                                        className="ct"
                                        style={{ textAlign: 'center' }}
                                        title={`${ch.name} — ${col.short}: ${done} of ${total} completed (${col.doneValue})`}
                                      >
                                        <span
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            minWidth: '24px',
                                            height: '20px',
                                            padding: '0 6px',
                                            borderRadius: '4px',
                                            fontSize: '11px',
                                            fontWeight: 700,
                                            background: isAllDone ? '#dcfce7' : isPartDone ? '#e0f2fe' : '#f1f5f9',
                                            color: isAllDone ? '#166534' : isPartDone ? '#0284c7' : '#64748b',
                                            border: isAllDone
                                              ? '1px solid #bbf7d0'
                                              : isPartDone
                                              ? '1px solid #bae6fd'
                                              : '1px solid #e2e8f0',
                                          }}
                                        >
                                          {done}
                                        </span>
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
                  <div>{renderStageWiseBars(activeSystem.items)}</div>
                )}

                {['all', 'Completed', 'In progress', 'Not started'].includes(kpiFilter) && (
                  <div>
                    {(() => {
                      const statusScopedSysKpiItems = activeSystem.items.filter(
                        (r) => kpiFilter === 'all' || getEquipmentOverallStatus(r) === kpiFilter
                      );
                      const availableTypes = getAvailableEquipmentTypes(statusScopedSysKpiItems);
                      const filteredSysKpiEquip = statusScopedSysKpiItems.filter((r) => {
                        if (kpiTypeFilter && (r.EquipmentType || '').trim() !== kpiTypeFilter) return false;
                        if (!kpiSearch) return true;
                        const q = kpiSearch.toLowerCase();
                        return (
                          r.EquipmentTagNo?.toLowerCase().includes(q) ||
                          r.EquipmentDescription?.toLowerCase().includes(q) ||
                          r.EquipmentType?.toLowerCase().includes(q) ||
                          r.SystemNo?.toLowerCase().includes(q) ||
                          r.SubSystem?.toLowerCase().includes(q) ||
                          r.BaseLineUTG?.toLowerCase().includes(q) ||
                          r.PMI?.toLowerCase().includes(q) ||
                          r.DocumentDrawing?.toLowerCase().includes(q)
                        );
                      });
                      const effectiveSize = equipPageSize > 0 ? equipPageSize : filteredSysKpiEquip.length || 1;
                      const safePage = Math.min(equipPage, Math.max(1, Math.ceil(filteredSysKpiEquip.length / effectiveSize)));
                      const pagedSysKpiEquip =
                        equipPageSize > 0
                          ? filteredSysKpiEquip.slice((safePage - 1) * effectiveSize, safePage * effectiveSize)
                          : filteredSysKpiEquip;

                      return (
                        <>
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
                            <input
                              className="tsf"
                              style={{ maxWidth: '340px', margin: 0 }}
                              placeholder="🔍 Search tag, description, type, sub-system…"
                              value={kpiSearch}
                              onChange={(e) => setKpiSearch(e.target.value)}
                            />
                            <select
                              value={kpiTypeFilter}
                              onChange={(e) => setKpiTypeFilter(e.target.value)}
                              style={{
                                padding: '6px 10px',
                                fontSize: '12px',
                                borderRadius: '6px',
                                border: '1px solid var(--bd)',
                                background: '#ffffff',
                                color: 'var(--tx)',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                              title="Filter by Equipment Type"
                            >
                              <option value="">All Types ({availableTypes.length})</option>
                              {availableTypes.map(({ type, count }) => (
                                <option key={type} value={type}>
                                  {type} ({count})
                                </option>
                              ))}
                            </select>
                            <span style={{ fontSize: '12px', color: 'var(--mu)' }}>
                              Showing {filteredSysKpiEquip.length} equipment
                            </span>
                          </div>

                          <div
                            className="tw"
                            style={{
                              maxHeight: '420px',
                              overflowY: 'auto',
                              overflowX: 'auto',
                              border: '1px solid var(--bd)',
                              borderRadius: '8px',
                            }}
                          >
                            <table className="nrep-table">
                              <thead style={{ position: 'sticky', top: 0, zIndex: 4, background: '#f8fafc', boxShadow: '0 1px 0 var(--bd)' }}>
                                <tr>
                                  <th>Tag No.</th>
                                  <th>Description</th>
                                  <th>Type</th>
                                  {activeSystem.children.length > 0 && <th>Sub-System</th>}
                                  <th>Status</th>
                                  <th>Progress</th>
                                  <th>Base Line UTG</th>
                                  <th>PMI</th>
                                  <th>Document/Drawing</th>
                                </tr>
                              </thead>
                              <tbody>
                                {pagedSysKpiEquip.map((r) => (
                                  <tr key={r.id}>
                                    <td>
                                      <a href={`#eq-${encodeURIComponent(r.EquipmentTagNo)}`}>
                                        <b>{r.EquipmentTagNo}</b>
                                      </a>
                                    </td>
                                    <td>{r.EquipmentDescription || '—'}</td>
                                    <td>{r.EquipmentType || '—'}</td>
                                    {activeSystem.children.length > 0 && <td>{r.SubSystem || r.SystemNo || '—'}</td>}
                                    <td>{renderStatusChip(getEquipmentOverallStatus(r))}</td>
                                    <td>{calculateProgress([r])}%</td>
                                    <td>{renderStatusChip(r.BaseLineUTG)}</td>
                                    <td>{renderStatusChip(r.PMI)}</td>
                                    <td>{renderDocumentDrawing(r.DocumentDrawing, r)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {renderPaginationBar(filteredSysKpiEquip.length)}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Default System / Sub-System Overview when no KPI filter is active */}
            {!kpiFilter && (
              <>
                {/* Child Systems / Sub-Systems Matrix Table (if this System/Sub-Unit has child nodes) */}
                {activeSystem.children.length > 0 && (
                  <div className="cd" style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                      <h3 style={{ margin: 0 }}>
                        {activeSystem.children[0]?.levelBadge || 'Sub-System'}s in {activeSystem.name} ({activeSystem.children.length}) — Click any row to open its details
                      </h3>
                    </div>
                    <div className="tw">
                      <table className="nrep-table">
                        <thead>
                          <tr>
                            <th>{activeSystem.children[0]?.levelBadge || 'Sub-System'} ({activeSystem.name})</th>
                            <th>Level</th>
                            <th>Equip.</th>
                            <th>Completed</th>
                            <th>In prog.</th>
                            <th>Not started</th>
                            <th style={{ minWidth: '150px' }}>Stage Progress</th>
                            {STATUS_COLUMNS.map((col) => (
                              <th
                                key={col.key}
                                className="ct"
                                title={`Work completed / issued count (${col.doneValue})`}
                                style={{ minWidth: '82px', textAlign: 'center' }}
                              >
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1px', width: '100%' }}>
                                  <span style={{ textAlign: 'center' }}>{col.short}</span>
                                  <span style={{ fontSize: '9px', textTransform: 'none', color: '#0369a1', fontWeight: 700, textAlign: 'center' }}>
                                    ({col.doneValue})
                                  </span>
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {activeSystem.children.map((ch) => {
                            const c = ch.items.filter((r) => getEquipmentOverallStatus(r) === 'Completed').length;
                            const p = ch.items.filter((r) => getEquipmentOverallStatus(r) === 'In progress').length;
                            const n = ch.items.length - c - p;
                            return (
                              <tr key={ch.id}>
                                <td>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <a href={`#${ch.id}`}>
                                      <b>{ch.name}</b>
                                    </a>
                                    {ch.children.length > 0 && (
                                      <span style={{ fontSize: '10px', color: '#0369a1', fontWeight: 600 }}>
                                        ↳ {ch.children.length} {ch.children[0]?.levelBadge || 'Sub-System'}
                                        {ch.children.length > 1 ? 's' : ''}: {ch.children.map((sub) => sub.name).join(', ')}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td>
                                  <span className="c a" style={{ fontSize: '10px', fontWeight: 700 }}>
                                    {ch.levelBadge}
                                  </span>
                                </td>
                                <td><b>{ch.items.length}</b></td>
                                <td><span style={{ color: '#166534', fontWeight: 600 }}>{c}</span></td>
                                <td><span style={{ color: '#0369a1', fontWeight: 600 }}>{p}</span></td>
                                <td><span style={{ color: '#64748b' }}>{n}</span></td>
                                <td>{renderMiniProgressBar(ch.items)}</td>
                                {STATUS_COLUMNS.map((col) => {
                                  const done = getDoneStageCount(ch.items, col.key);
                                  const total = ch.items.length;
                                  const isAllDone = total > 0 && done === total;
                                  const isPartDone = done > 0 && !isAllDone;
                                  return (
                                    <td
                                      key={col.key}
                                      className="ct"
                                      style={{ textAlign: 'center' }}
                                      title={`${ch.name} — ${col.short}: ${done} of ${total} completed (${col.doneValue})`}
                                    >
                                      <span
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          minWidth: '24px',
                                          height: '20px',
                                          padding: '0 6px',
                                          borderRadius: '4px',
                                          fontSize: '11px',
                                          fontWeight: 700,
                                          background: isAllDone ? '#dcfce7' : isPartDone ? '#e0f2fe' : '#f1f5f9',
                                          color: isAllDone ? '#166534' : isPartDone ? '#0284c7' : '#64748b',
                                          border: isAllDone
                                            ? '1px solid #bbf7d0'
                                            : isPartDone
                                            ? '1px solid #bae6fd'
                                            : '1px solid #e2e8f0',
                                        }}
                                      >
                                        {done}
                                      </span>
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

                <div className="cd">
                  <h3>Equipment in {activeSystem.name} ({activeSystem.items.length}) — click a tag for full detail</h3>
                  {(() => {
                    const availableSysTypes = getAvailableEquipmentTypes(activeSystem.items);
                    return (
                      <div className="tools">
                        <input
                          id="q"
                          placeholder="Search tag, description, type, sub-system, Base Line UTG, Document/Drawing, remarks…"
                          value={systemSearch}
                          onChange={(e) => setSystemSearch(e.target.value)}
                        />
                        <select
                          id="tf"
                          value={systemTypeFilter}
                          onChange={(e) => setSystemTypeFilter(e.target.value)}
                          title="Filter by Equipment Type (e.g. Vessel, Exchanger)"
                        >
                          <option value="">All Types ({availableSysTypes.length})</option>
                          {availableSysTypes.map(({ type, count }) => (
                            <option key={type} value={type}>
                              {type} ({count})
                            </option>
                          ))}
                        </select>
                        <select
                          id="sf"
                          value={systemStatusFilter}
                          onChange={(e) => setSystemStatusFilter(e.target.value)}
                        >
                          <option value="">All Statuses</option>
                          <option value="Completed">Completed</option>
                          <option value="In progress">In progress</option>
                          <option value="Not started">Not started</option>
                        </select>
                      </div>
                    );
                  })()}

                  <div id="eqt">
                    {activeSystem.items.length === 0 ? (
                      <div className="empty">No matching equipment.</div>
                    ) : (
                      (() => {
                        const filteredSysItems = activeSystem.items.filter((r) => {
                          const q = systemSearch.toLowerCase();
                          const matchesSearch =
                            !q || Object.values(r).join(' ').toLowerCase().includes(q);
                          const matchesFilter =
                            !systemStatusFilter || getEquipmentOverallStatus(r) === systemStatusFilter;
                          const matchesType =
                            !systemTypeFilter || (r.EquipmentType || '').trim() === systemTypeFilter;
                          return matchesSearch && matchesFilter && matchesType;
                        });

                        if (filteredSysItems.length === 0) {
                          return <div className="empty">No matching equipment.</div>;
                        }

                        const effectiveSize = equipPageSize > 0 ? equipPageSize : filteredSysItems.length || 1;
                        const safePage = Math.min(equipPage, Math.max(1, Math.ceil(filteredSysItems.length / effectiveSize)));
                        const pagedSysItems =
                          equipPageSize > 0
                            ? filteredSysItems.slice((safePage - 1) * effectiveSize, safePage * effectiveSize)
                            : filteredSysItems;

                        return (
                          <>
                            <div
                              className="tw"
                              style={{
                                maxHeight: '420px',
                                overflowY: 'auto',
                                overflowX: 'auto',
                                border: '1px solid var(--bd)',
                                borderRadius: '8px',
                              }}
                            >
                              <table className="nrep-table">
                                <thead style={{ position: 'sticky', top: 0, zIndex: 4, background: '#f8fafc', boxShadow: '0 1px 0 var(--bd)' }}>
                                  <tr>
                                    <th>Tag No.</th>
                                    <th>Description</th>
                                    <th>Type</th>
                                    {activeSystem.children.length > 0 && <th>Sub-System</th>}
                                    <th>Status</th>
                                    <th>Progress</th>
                                    {STATUS_COLUMNS.map((col) => (
                                      <th key={col.key}>{col.short}</th>
                                    ))}
                                    <th>Document/Drawing</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {pagedSysItems.map((r) => {
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
                                        {activeSystem.children.length > 0 && <td>{r.SubSystem || '—'}</td>}
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
                                              {renderStatusChip(val)}
                                            </td>
                                          );
                                        })}
                                        <td>{renderDocumentDrawing(r.DocumentDrawing, r)}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            {renderPaginationBar(filteredSysItems.length)}
                          </>
                        );
                      })()
                    )}
                  </div>
                </div>

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
              </>
            )}
          </>
        )}

        {/* LEVEL 4: CONSOLIDATED EQUIPMENT DETAIL & INLINE EDITOR (SINGLE UNIFIED VIEW) */}
        {viewLevel === 'e' && activeEquipment && (() => {
          const currentEq = eqForm || activeEquipment;
          const { reports: attachedReports } = parseEquipmentDocumentField(activeEquipment.DocumentDrawing);

          const stageDateFieldMap: Partial<Record<keyof EquipmentItem, keyof EquipmentItem>> = {
            FormatIStatus: 'FormatIDate',
            FormatIIStatus: 'FormatIIDate',
            FormatIIIStatus: 'FormatIIIDate',
            FormatIVStatus: 'FormatIVDate',
            FormatVStatus: 'FormatVDate',
          };

          const unitSubUnitsDatalist = Array.from(
            new Set([
              ...(currentEq.Unit === 'MSP' ? MSP_SUB_UNITS : []),
              ...(currentEq.Unit === 'Utility' ? UTILITY_SUB_UNITS : []),
              ...equipment
                .filter((i) => i.Unit === currentEq.Unit)
                .map((i) => cleanHierarchyField(i.SubUnit))
                .filter(Boolean),
            ])
          );

          const unitSystemsDatalist = Array.from(
            new Set(
              equipment
                .filter(
                  (i) =>
                    i.Unit === currentEq.Unit &&
                    (!cleanHierarchyField(currentEq.SubUnit) ||
                      cleanHierarchyField(i.SubUnit) === cleanHierarchyField(currentEq.SubUnit))
                )
                .map((i) => cleanHierarchyField(i.SystemNo))
                .filter(Boolean)
            )
          );

          const unitSubSystemsDatalist = Array.from(
            new Set(
              equipment
                .filter(
                  (i) =>
                    i.Unit === currentEq.Unit &&
                    (!cleanHierarchyField(currentEq.SystemNo) ||
                      cleanHierarchyField(i.SystemNo) === cleanHierarchyField(currentEq.SystemNo))
                )
                .map((i) => cleanHierarchyField(i.SubSystem))
                .filter(Boolean)
            )
          );

          const parsedOriginalDoc = parseEquipmentDocumentField(activeEquipment.DocumentDrawing);
          const hasUnsavedEqChanges =
            eqDrawingRef.trim() !== (parsedOriginalDoc.drawingRef || '').trim() ||
            (currentEq.EquipmentTagNo || '').trim() !== (activeEquipment.EquipmentTagNo || '').trim() ||
            (currentEq.Unit || '').trim() !== (activeEquipment.Unit || '').trim() ||
            cleanHierarchyField(currentEq.SubUnit) !== cleanHierarchyField(activeEquipment.SubUnit) ||
            cleanHierarchyField(currentEq.SystemNo) !== cleanHierarchyField(activeEquipment.SystemNo) ||
            cleanHierarchyField(currentEq.SubSystem) !== cleanHierarchyField(activeEquipment.SubSystem) ||
            (currentEq.EquipmentType || '') !== (activeEquipment.EquipmentType || '') ||
            (currentEq.EquipmentDescription || '') !== (activeEquipment.EquipmentDescription || '') ||
            (currentEq.Remarks || '') !== (activeEquipment.Remarks || '') ||
            (currentEq.FormatIStatus || 'Not Issued') !== (activeEquipment.FormatIStatus || 'Not Issued') ||
            (currentEq.FormatIIStatus || 'Not Issued') !== (activeEquipment.FormatIIStatus || 'Not Issued') ||
            (currentEq.FormatIIIStatus || 'Not Issued') !== (activeEquipment.FormatIIIStatus || 'Not Issued') ||
            (currentEq.FormatIVStatus || 'Not Issued') !== (activeEquipment.FormatIVStatus || 'Not Issued') ||
            (currentEq.FormatVStatus || 'Not Issued') !== (activeEquipment.FormatVStatus || 'Not Issued') ||
            (currentEq.InternalInspectionStatus || 'No') !== (activeEquipment.InternalInspectionStatus || 'No') ||
            (currentEq.BaseLineUTG || 'No') !== (activeEquipment.BaseLineUTG || 'No') ||
            (currentEq.PMI || 'No') !== (activeEquipment.PMI || 'No') ||
            (currentEq.FinalSystemAcceptance || 'Not Accepted') !== (activeEquipment.FinalSystemAcceptance || 'Not Accepted') ||
            (currentEq.FormatIDate || '') !== (activeEquipment.FormatIDate || '') ||
            (currentEq.FormatIIDate || '') !== (activeEquipment.FormatIIDate || '') ||
            (currentEq.FormatIIIDate || '') !== (activeEquipment.FormatIIIDate || '') ||
            (currentEq.FormatIVDate || '') !== (activeEquipment.FormatIVDate || '') ||
            (currentEq.FormatVDate || '') !== (activeEquipment.FormatVDate || '');

          const handleInlineFormChange = (field: keyof EquipmentItem, value: string) => {
            setEqSaveNotice(null);
            setEqForm((prev) => {
              const base = prev || activeEquipment;
              return { ...base, [field]: value };
            });
          };

          const handleSaveFullEquipment = async () => {
            if (!isEditor) {
              setDashboardSweetSuccess({
                title: 'Access Denied',
                message: 'You need Editor or Admin permissions to save changes.',
                badgeText: 'Permission Required',
              });
              return;
            }
            const target = currentEq;
            if (!target.EquipmentTagNo.trim()) {
              setDashboardSweetSuccess({
                title: 'Validation Error',
                message: 'Equipment Tag No. is required.',
                badgeText: 'Required Field',
              });
              return;
            }
            setSavingEqForm(true);
            setEqSaveNotice(null);
            try {
              const cleanedSubUnit = cleanHierarchyField(target.SubUnit);
              const cleanedSystem = cleanHierarchyField(target.SystemNo);
              const cleanedSubSystem = cleanHierarchyField(target.SubSystem);
              const serializedDoc = serializeEquipmentDocumentField(eqDrawingRef.trim(), attachedReports);

              const payload: EquipmentItem = {
                ...target,
                EquipmentTagNo: target.EquipmentTagNo.trim(),
                Unit: (target.Unit || 'PFCCU').trim(),
                SubUnit: cleanedSubUnit,
                SystemNo: cleanedSystem,
                SubSystem: cleanedSubSystem,
                DocumentDrawing: serializedDoc,
              };

              await saveEquipment(payload);
              setDashboardSweetSuccess({
                title: 'Equipment Saved Successfully!',
                message: 'Equipment data sheet & dashboard updated and synced to cloud database.',
                badgeText: 'Live Cloud Sync Complete',
                metaItems: [
                  { label: 'Tag No.', value: payload.EquipmentTagNo, highlight: 'blue' },
                  { label: 'Unit', value: payload.Unit, highlight: 'green' },
                ],
              });
              if (payload.EquipmentTagNo !== activeEquipment.EquipmentTagNo && typeof window !== 'undefined') {
                window.location.hash = `#eq-${encodeURIComponent(payload.EquipmentTagNo)}`;
              }
            } catch (err: any) {
              setDashboardSweetSuccess({
                title: 'Save Failed',
                message: err?.message || 'Failed to save equipment details.',
                badgeText: 'Error',
              });
            } finally {
              setSavingEqForm(false);
            }
          };

          const handleMarkAllStagesDone = () => {
            if (!isEditor) return;
            setEqSaveNotice(null);
            setEqForm({
              ...currentEq,
              FormatIStatus: 'Issued',
              FormatIIStatus: 'Issued',
              FormatIIIStatus: 'Issued',
              FormatIVStatus: 'Issued',
              FormatVStatus: 'Issued',
              InternalInspectionStatus: 'Yes',
              BaseLineUTG: 'Yes',
              PMI: 'Yes',
              FinalSystemAcceptance: 'Accepted',
            });
          };

          return (
            <>
              <div className="bc">
                <a href="#" onClick={goToHome}>NREP Project</a> ›{' '}
                <a href={`#${activeUnit?.id || ''}`}>{activeEquipment.Unit}</a>
                {activeUnit && activeSystem && activeSystem.ancestorIds.map((ancId) => {
                  const ancNode = activeUnit.systems.find((s) => s.id === ancId);
                  if (!ancNode) return null;
                  return (
                    <React.Fragment key={ancId}>
                      {' › '}
                      <a href={`#${ancNode.id}`}>{ancNode.name}</a>
                    </React.Fragment>
                  );
                })}
                {' › '}
                {activeEquipment.EquipmentTagNo}
              </div>

              {/* SINGLE CONSOLIDATED EQUIPMENT DETAIL & EDIT CARD */}
              <div className="cd" style={{ padding: '18px 20px' }}>
                {/* Top Header Bar: Tag, Hierarchy Path, Progress Badge & Stage Preset Helpers */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '12px',
                    paddingBottom: '14px',
                    marginBottom: '16px',
                    borderBottom: '1px solid #e2e8f0',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <h2 className="t" style={{ margin: 0, fontSize: '20px' }}>
                        {activeEquipment.EquipmentTagNo}
                      </h2>
                      {renderStatusChip(getEquipmentOverallStatus(activeEquipment))}
                      <span className="pl g" style={{ fontSize: '12px', fontWeight: 700 }}>
                        {calculateProgress([activeEquipment])}% Completed
                      </span>
                      {hasUnsavedEqChanges && (
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: '#fffbeb',
                            color: '#b45309',
                            border: '1px solid #fcd34d',
                          }}
                        >
                          Unsaved changes — click Save Changes below
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '12px', color: '#475569', fontWeight: 500 }}>
                      <span style={{ fontWeight: 700, color: '#0369a1' }}>
                        {formatEquipmentHierarchyPath(activeEquipment)}
                      </span>
                      {activeEquipment.EquipmentDescription ? ` · ${activeEquipment.EquipmentDescription}` : ''}
                      {activeEquipment.EquipmentType ? ` · ${activeEquipment.EquipmentType}` : ''}
                    </div>
                  </div>

                  {isEditor && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={handleMarkAllStagesDone}
                        disabled={savingEqForm}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          padding: '6px 11px',
                          fontSize: '11.5px',
                          fontWeight: 700,
                          borderRadius: '6px',
                          background: '#f0fdf4',
                          color: '#15803d',
                          border: '1px solid #86efac',
                          cursor: 'pointer',
                        }}
                        title="Set all inspection stages to Done in form (click Save Changes below to update)"
                      >
                        <Check size={13} />
                        All Done
                      </button>
                    </div>
                  )}
                </div>

                {eqSaveNotice && (
                  <div
                    style={{
                      marginBottom: '14px',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      background: eqSaveNotice.type === 'ok' ? '#f0fdf4' : '#fef2f2',
                      color: eqSaveNotice.type === 'ok' ? '#15803d' : '#b91c1c',
                      border: `1px solid ${eqSaveNotice.type === 'ok' ? '#bbf7d0' : '#fecaca'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>{eqSaveNotice.type === 'ok' ? '✓ ' : '⚠ '}{eqSaveNotice.text}</span>
                    <button
                      type="button"
                      onClick={() => setEqSaveNotice(null)}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'inherit' }}
                    >
                      ✕
                    </button>
                  </div>
                )}

                {/* SECTION 1: IDENTIFICATION & 4-LEVEL HIERARCHY (Unit > Sub-Unit > System > Sub-System) */}
                <div style={{ marginBottom: '18px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '6px',
                      marginBottom: '8px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: '#475569',
                      }}
                    >
                      1. Identification &amp; Hierarchy (Unit › Sub-Unit › System › Sub-System)
                    </span>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>
                      Blank hierarchy levels automatically attach to the previous filled level
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))',
                      gap: '10px',
                      background: '#f8fafc',
                      padding: '12px',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                        Equipment Tag No.
                      </label>
                      {isEditor ? (
                        <input
                          type="text"
                          value={currentEq.EquipmentTagNo || ''}
                          onChange={(e) => handleInlineFormChange('EquipmentTagNo', e.target.value)}
                          style={{
                            width: '100%',
                            padding: '6px 9px',
                            fontSize: '12.5px',
                            fontWeight: 700,
                            border: '1px solid #cbd5e1',
                            borderRadius: '5px',
                            background: '#ffffff',
                          }}
                        />
                      ) : (
                        <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>{currentEq.EquipmentTagNo}</div>
                      )}
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                        1. Unit
                      </label>
                      {isEditor ? (
                        <select
                          value={currentEq.Unit || ''}
                          onChange={(e) => handleInlineFormChange('Unit', e.target.value)}
                          style={{
                            width: '100%',
                            padding: '6px 9px',
                            fontSize: '12.5px',
                            fontWeight: 600,
                            border: '1px solid #cbd5e1',
                            borderRadius: '5px',
                            background: '#ffffff',
                          }}
                        >
                          {allUnitsList.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{currentEq.Unit}</div>
                      )}
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                        2. Sub-Unit <span style={{ fontWeight: 400, color: '#94a3b8' }}>(Optional)</span>
                      </label>
                      {isEditor ? (
                        <>
                          <input
                            type="text"
                            list="eq-detail-subunits"
                            value={currentEq.SubUnit || ''}
                            onChange={(e) => handleInlineFormChange('SubUnit', e.target.value)}
                            placeholder="Skip to attach to Unit"
                            style={{
                              width: '100%',
                              padding: '6px 9px',
                              fontSize: '12.5px',
                              border: '1px solid #cbd5e1',
                              borderRadius: '5px',
                              background: '#ffffff',
                            }}
                          />
                          <datalist id="eq-detail-subunits">
                            {unitSubUnitsDatalist.map((su) => (
                              <option key={su} value={su} />
                            ))}
                          </datalist>
                        </>
                      ) : (
                        <div style={{ fontSize: '13px', color: '#0f172a' }}>{cleanHierarchyField(currentEq.SubUnit) || '—'}</div>
                      )}
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                        3. System <span style={{ fontWeight: 400, color: '#94a3b8' }}>(Optional)</span>
                      </label>
                      {isEditor ? (
                        <>
                          <input
                            type="text"
                            list="eq-detail-systems"
                            value={currentEq.SystemNo || ''}
                            onChange={(e) => handleInlineFormChange('SystemNo', e.target.value)}
                            placeholder="Skip to attach to previous"
                            style={{
                              width: '100%',
                              padding: '6px 9px',
                              fontSize: '12.5px',
                              border: '1px solid #cbd5e1',
                              borderRadius: '5px',
                              background: '#ffffff',
                            }}
                          />
                          <datalist id="eq-detail-systems">
                            {unitSystemsDatalist.map((sys) => (
                              <option key={sys} value={sys} />
                            ))}
                          </datalist>
                        </>
                      ) : (
                        <div style={{ fontSize: '13px', color: '#0f172a' }}>
                          {cleanHierarchyField(currentEq.SystemNo) || '—'}
                        </div>
                      )}
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                        4. Sub-System <span style={{ fontWeight: 400, color: '#94a3b8' }}>(Optional)</span>
                      </label>
                      {isEditor ? (
                        <>
                          <input
                            type="text"
                            list="eq-detail-subsystems"
                            value={currentEq.SubSystem || ''}
                            onChange={(e) => handleInlineFormChange('SubSystem', e.target.value)}
                            placeholder="Skip to attach to previous"
                            style={{
                              width: '100%',
                              padding: '6px 9px',
                              fontSize: '12.5px',
                              border: '1px solid #cbd5e1',
                              borderRadius: '5px',
                              background: '#ffffff',
                            }}
                          />
                          <datalist id="eq-detail-subsystems">
                            {unitSubSystemsDatalist.map((subSys) => (
                              <option key={subSys} value={subSys} />
                            ))}
                          </datalist>
                        </>
                      ) : (
                        <div style={{ fontSize: '13px', color: '#0f172a' }}>{cleanHierarchyField(currentEq.SubSystem) || '—'}</div>
                      )}
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                        Equipment Type
                      </label>
                      {isEditor ? (
                        <input
                          type="text"
                          value={currentEq.EquipmentType || ''}
                          onChange={(e) => handleInlineFormChange('EquipmentType', e.target.value)}
                          placeholder="e.g. Static / Vessel / Column"
                          style={{
                            width: '100%',
                            padding: '6px 9px',
                            fontSize: '12.5px',
                            border: '1px solid #cbd5e1',
                            borderRadius: '5px',
                            background: '#ffffff',
                          }}
                        />
                      ) : (
                        <div style={{ fontSize: '13px', color: '#0f172a' }}>{currentEq.EquipmentType || '—'}</div>
                      )}
                    </div>

                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                        Equipment Description
                      </label>
                      {isEditor ? (
                        <input
                          type="text"
                          value={currentEq.EquipmentDescription || ''}
                          onChange={(e) => handleInlineFormChange('EquipmentDescription', e.target.value)}
                          placeholder="Equipment service / description"
                          style={{
                            width: '100%',
                            padding: '6px 9px',
                            fontSize: '12.5px',
                            border: '1px solid #cbd5e1',
                            borderRadius: '5px',
                            background: '#ffffff',
                          }}
                        />
                      ) : (
                        <div style={{ fontSize: '13px', color: '#0f172a' }}>{currentEq.EquipmentDescription || '—'}</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* SECTION 2: CONSOLIDATED 9 INSPECTION STAGES + INLINE FORMAT DATES (ZERO DUPLICATION) */}
                <div style={{ marginBottom: '18px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '6px',
                      marginBottom: '8px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: '#475569',
                      }}
                    >
                      2. Inspection Stages &amp; Format Issue Dates
                    </span>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>
                      Progress % is calculated from the 7 core stages (Base Line UTG &amp; PMI are excluded from %)
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
                      gap: '10px',
                    }}
                  >
                    {STATUS_COLUMNS.map((col) => {
                      const val = (currentEq[col.key] as string) || col.pendingValue;
                      const done = isDone(val);
                      const dateField = stageDateFieldMap[col.key];
                      const dateVal = dateField ? ((currentEq[dateField] as string) || '') : '';
                      const isExcludedFromPct = col.key === 'BaseLineUTG' || col.key === 'PMI';

                      return (
                        <div
                          key={col.key}
                          style={{
                            borderRadius: '8px',
                            padding: '10px 12px',
                            border: done ? '1px solid #86efac' : '1px solid #fcd34d',
                            borderLeft: done ? '4px solid #16a34a' : '4px solid #f59e0b',
                            background: done ? '#f0fdf4' : '#fffbeb',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            gap: '8px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                            <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#0f172a' }}>{col.label}</span>
                            {isExcludedFromPct && (
                              <span
                                style={{
                                  fontSize: '9.5px',
                                  fontWeight: 600,
                                  padding: '1px 5px',
                                  borderRadius: '4px',
                                  background: 'rgba(15, 23, 42, 0.07)',
                                  color: '#475569',
                                }}
                                title="Tracked for records; excluded from % progress calculation"
                              >
                                Info
                              </span>
                            )}
                          </div>

                          <div>
                            {isEditor ? (
                              <select
                                value={val}
                                onChange={(e) => handleInlineFormChange(col.key, e.target.value)}
                                style={{
                                  width: '100%',
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  padding: '5px 8px',
                                  borderRadius: '5px',
                                  border: done ? '1px solid #4ade80' : '1px solid #fbbf24',
                                  background: '#ffffff',
                                  color: done ? '#15803d' : '#b45309',
                                  cursor: 'pointer',
                                }}
                              >
                                {col.options.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <div
                                style={{
                                  fontSize: '12.5px',
                                  fontWeight: 700,
                                  color: done ? '#15803d' : '#b45309',
                                }}
                              >
                                {val}
                              </div>
                            )}
                          </div>

                          {dateField && (
                            <div style={{ borderTop: '1px dashed rgba(100, 116, 139, 0.25)', paddingTop: '6px' }}>
                              <label
                                style={{
                                  display: 'block',
                                  fontSize: '10px',
                                  fontWeight: 600,
                                  color: '#475569',
                                  marginBottom: '3px',
                                }}
                              >
                                Issue Date
                              </label>
                              {isEditor ? (
                                <input
                                  type="date"
                                  value={dateVal}
                                  onChange={(e) => handleInlineFormChange(dateField, e.target.value)}
                                  style={{
                                    width: '100%',
                                    fontSize: '11.5px',
                                    padding: '4px 6px',
                                    borderRadius: '4px',
                                    border: '1px solid #cbd5e1',
                                    background: '#ffffff',
                                    color: '#0f172a',
                                  }}
                                />
                              ) : (
                                <div style={{ fontSize: '11.5px', color: '#334155', fontWeight: 600 }}>
                                  {dateVal || '—'}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* SECTION 3: DOCUMENT / DRAWING, LIVE INSPECTION REPORTS & REMARKS */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
                    gap: '14px',
                    background: '#f8fafc',
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '11px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: '#475569',
                        marginBottom: '6px',
                      }}
                    >
                      3. Document / Drawing Ref. &amp; Live Inspection Reports
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {isEditor ? (
                        <input
                          type="text"
                          value={eqDrawingRef}
                          onChange={(e) => {
                            setEqSaveNotice(null);
                            setEqDrawingRef(e.target.value);
                          }}
                          placeholder="Drawing / Document Reference No. or URL"
                          style={{
                            width: '100%',
                            padding: '6px 9px',
                            fontSize: '12.5px',
                            border: '1px solid #cbd5e1',
                            borderRadius: '5px',
                            background: '#ffffff',
                          }}
                        />
                      ) : (
                        <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#0f172a' }}>
                          {eqDrawingRef ? `📄 ${eqDrawingRef}` : 'No drawing reference specified'}
                        </div>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        {isEditor && (
                          <button
                            type="button"
                            onClick={() => setReportModalState({ item: activeEquipment, tab: 'attach' })}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              padding: '5px 10px',
                              fontSize: '11.5px',
                              fontWeight: 600,
                              borderRadius: '5px',
                              background: '#ffffff',
                              color: '#0284c7',
                              border: '1px dashed #0284c7',
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                            title="Upload PDF/Image report or attach Google Drive / OneDrive link"
                          >
                            ⬆️ Upload / Link
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setReportModalState({
                              item: activeEquipment,
                              tab: 'view',
                              viewOnly: true,
                            })
                          }
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '5px 10px',
                            fontSize: '11.5px',
                            fontWeight: 600,
                            borderRadius: '5px',
                            background: '#0f172a',
                            color: '#ffffff',
                            border: '1px solid #334155',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                          title="View uploaded inspection reports for this equipment"
                        >
                          <FileText size={12} />
                          <span>Live Inspection Reports ({attachedReports.length})</span>
                        </button>

                        {eqDrawingRef && /^https?:\/\//i.test(eqDrawingRef) && (
                          <a
                            className="btn"
                            href={eqDrawingRef}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '5px 10px',
                              fontSize: '11.5px',
                              fontWeight: 600,
                              borderRadius: '5px',
                            }}
                          >
                            Open Drawing URL ↗
                          </a>
                        )}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '11px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: '#475569',
                        marginBottom: '6px',
                      }}
                    >
                      4. Remarks / Inspection Notes
                    </label>
                    {isEditor ? (
                      <textarea
                        rows={3}
                        value={currentEq.Remarks || ''}
                        onChange={(e) => handleInlineFormChange('Remarks', e.target.value)}
                        placeholder="Add remarks, observations, or inspection notes…"
                        style={{
                          width: '100%',
                          padding: '6px 9px',
                          fontSize: '12.5px',
                          border: '1px solid #cbd5e1',
                          borderRadius: '5px',
                          background: '#ffffff',
                          resize: 'vertical',
                        }}
                      />
                    ) : (
                      <div style={{ fontSize: '12.5px', color: '#0f172a', whiteSpace: 'pre-wrap' }}>
                        {currentEq.Remarks || '—'}
                      </div>
                    )}
                  </div>
                </div>

                {/* BOTTOM FOOTER INSIDE CONSOLIDATED CARD: METADATA, DELETE (ADMIN) & SINGLE SAVE BUTTON */}
                <div
                  style={{
                    marginTop: '14px',
                    paddingTop: '12px',
                    borderTop: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '10px',
                  }}
                >
                  <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                    {activeEquipment.updatedAt
                      ? `Last updated: ${new Date(activeEquipment.updatedAt).toLocaleString()}`
                      : 'Synced with live database'}
                    {activeEquipment.updatedBy ? ` by ${activeEquipment.updatedBy}` : ''}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {canAccessLiveDatabase && (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteEq(true)}
                        disabled={deletingEq}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          padding: '7px 14px',
                          fontSize: '12.5px',
                          fontWeight: 600,
                          borderRadius: '6px',
                          background: '#fef2f2',
                          color: '#dc2626',
                          border: '1px solid #fecaca',
                          cursor: 'pointer',
                        }}
                      >
                        <Trash2 size={14} />
                        Delete Equipment
                      </button>
                    )}

                    {isEditor && (
                      <button
                        type="button"
                        onClick={() => handleSaveFullEquipment()}
                        disabled={savingEqForm}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '7px 16px',
                          fontSize: '12.5px',
                          fontWeight: 700,
                          borderRadius: '6px',
                          background: '#0284c7',
                          color: '#ffffff',
                          border: '1px solid #0284c7',
                          cursor: 'pointer',
                          boxShadow: hasUnsavedEqChanges
                            ? '0 0 0 3px rgba(2, 132, 199, 0.25)'
                            : '0 1px 2px rgba(2, 132, 199, 0.2)',
                        }}
                      >
                        <Save size={14} />
                        {savingEqForm ? 'Saving…' : 'Save Changes'}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* SweetAlert Warning Delete Confirmation Popup */}
              <SweetWarningDeletePopup
                open={confirmDeleteEq}
                title="Delete Equipment?"
                targetName={activeEquipment.EquipmentTagNo}
                targetType="Equipment Record"
                description={`Are you sure you want to permanently delete "${activeEquipment.EquipmentTagNo}" from ${activeEquipment.Unit}?`}
                warningNote="This will remove the equipment record from the live database."
                confirmLabel="Yes, Delete Equipment"
                cancelLabel="Cancel"
                loading={deletingEq}
                onCancel={() => setConfirmDeleteEq(false)}
                onConfirm={async () => {
                  setDeletingEq(true);
                  try {
                    await deleteEquipment(activeEquipment.id);
                    setConfirmDeleteEq(false);
                    if (typeof window !== 'undefined') {
                      window.location.hash = activeSystem ? `#${activeSystem.id}` : `#${activeUnit?.id || ''}`;
                    }
                  } catch (err: any) {
                    setEqSaveNotice({ type: 'err', text: err?.message || 'Failed to delete equipment.' });
                    setConfirmDeleteEq(false);
                  } finally {
                    setDeletingEq(false);
                  }
                }}
              />

              {/* Sibling navigation */}
              {(() => {
                const siblings = activeSystem ? activeSystem.items : activeUnit ? activeUnit.items : [];
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
                    <a href={`#${activeSystem?.id || activeUnit?.id || ''}`}>
                      {activeSystem ? `Back to ${activeSystem.name}` : `Back to ${activeEquipment.Unit}`}
                    </a>
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
          );
        })()}

        {/* TASK VIEW: EXCEL & DATA MANAGEMENT TOOLS IN RIGHT PANE */}
        {viewLevel === 'tools' && (
          <div className="max-w-[1220px] mx-auto space-y-5 py-1">
            {/* Breadcrumb Navigation */}
            <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
              <a
                href="#"
                onClick={goToHome}
                className="text-sky-700 hover:text-sky-900 hover:underline font-semibold"
              >
                NREP Project
              </a>
              <span aria-hidden="true">›</span>
              <span className="text-slate-700 font-semibold">Excel &amp; Data Management Suite</span>
            </div>

            {/* Executive Hero Banner */}
            <div
              className="rounded-2xl p-5 sm:p-6 text-white relative overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, #09192f 0%, #0f294a 55%, #1e3a8a 100%)',
                boxShadow:
                  '0 20px 40px -15px rgba(15, 23, 42, 0.35), 0 0 0 1px rgba(56, 189, 248, 0.22)',
              }}
            >
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                    style={{
                      background:
                        'linear-gradient(135deg, rgba(56, 189, 248, 0.24) 0%, rgba(16, 185, 129, 0.16) 100%)',
                      border: '1px solid rgba(56, 189, 248, 0.4)',
                      boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.2)',
                    }}
                  >
                    <FileSpreadsheet className="w-5 h-5 text-sky-300" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-widest text-sky-300/90 mb-1">
                      NRL Data Synchronization &amp; Spreadsheet Engine
                    </div>
                    <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-white m-0">
                      Excel &amp; Data Management Tools
                    </h1>
                    <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed m-0">
                      Synchronize field inspection spreadsheets with the live Supabase Cloud database, generate standardized 18-column templates, or export complete audit-ready equipment registers.
                    </p>
                  </div>
                </div>

                {/* Live Unboxed Telemetry Summary */}
                <div className="flex items-center gap-5 pt-3 md:pt-0 border-t md:border-t-0 border-white/10 shrink-0">
                  <div>
                    <div className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">
                      Live Register
                    </div>
                    <div className="text-lg font-extrabold font-mono text-white tabular-nums">
                      {equipment.length} <span className="text-xs font-normal text-sky-300">Tags</span>
                    </div>
                  </div>
                  <div className="h-7 w-px bg-white/15" />
                  <div>
                    <div className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">
                      Completed
                    </div>
                    <div className="text-lg font-extrabold font-mono text-emerald-400 tabular-nums">
                      {stats.completed}{' '}
                      <span className="text-xs font-normal text-slate-300">
                        ({stats.progressPct}%)
                      </span>
                    </div>
                  </div>
                  <div className="h-7 w-px bg-white/15" />
                  <div>
                    <div className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">
                      Active Scope
                    </div>
                    <div className="text-lg font-extrabold font-mono text-sky-300 tabular-nums">
                      {treeData.length} <span className="text-xs font-normal text-slate-300">Units</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Status Notice Popup Window (Auto-hides after 3 seconds) */}
            {excelNotice && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-200"
                onClick={() => setExcelNotice(null)}
              >
                <div
                  className={`relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border-2 transition-all ${
                    excelNotice.type === 'ok'
                      ? 'border-emerald-500/40'
                      : 'border-rose-500/50'
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => setExcelNotice(null)}
                    className="absolute top-3.5 right-3.5 w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                    aria-label="Close notification"
                  >
                    <X className="w-4 h-4" />
                  </button>

                  <div className="flex flex-col items-center text-center">
                    <div
                      className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3.5 shadow-sm ${
                        excelNotice.type === 'ok'
                          ? 'bg-emerald-100 text-emerald-600 border border-emerald-200'
                          : 'bg-rose-100 text-rose-600 border border-rose-200'
                      }`}
                    >
                      {excelNotice.type === 'ok' ? (
                        <CheckCircle2 className="w-6 h-6" />
                      ) : (
                        <Lock className="w-6 h-6" />
                      )}
                    </div>

                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider mb-2 ${
                        excelNotice.type === 'ok'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}
                    >
                      {excelNotice.type === 'ok' ? 'Upload Synced' : 'Permission / Upload Error'}
                    </span>

                    <h3 className="text-base font-extrabold text-slate-900 mb-1.5">
                      {excelNotice.type === 'ok' ? 'Upload Successful' : 'Upload Blocked'}
                    </h3>

                    <p
                      className={`text-xs font-semibold leading-relaxed px-3 py-2.5 rounded-xl border w-full ${
                        excelNotice.type === 'ok'
                          ? 'bg-emerald-50/70 text-emerald-900 border-emerald-200'
                          : 'bg-rose-50/80 text-rose-900 border-rose-200'
                      }`}
                    >
                      {excelNotice.text}
                    </p>

                    <div className="mt-4 flex items-center justify-between w-full gap-3">
                      <span className="text-[11px] text-slate-400 font-medium">
                        Auto-closing in 3 seconds...
                      </span>
                      <button
                        type="button"
                        onClick={() => setExcelNotice(null)}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold text-white shadow-xs transition-colors cursor-pointer ${
                          excelNotice.type === 'ok'
                            ? 'bg-emerald-600 hover:bg-emerald-700'
                            : 'bg-rose-600 hover:bg-rose-700'
                        }`}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 4-Column Executive Tool Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Card 01: Live Spreadsheet Import (Primary Focal Card) */}
              <div
                className="rounded-xl bg-white p-5 flex flex-col justify-between transition-all"
                style={{
                  border: '1px solid #bae6fd',
                  background: 'linear-gradient(180deg, #f0f9ff 0%, #ffffff 65%)',
                  boxShadow: '0 4px 20px -4px rgba(2, 132, 199, 0.1)',
                }}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-sky-700">
                      01 · Live Database Upsert
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      .xlsx · .xlsm · .xls
                    </span>
                  </div>

                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-sky-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                      <Upload className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 m-0">
                        Import &amp; Sync Excel Spreadsheet
                      </h3>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed m-0">
                        Upload an updated master spreadsheet. Existing equipment tags are updated automatically and new tags are inserted directly into Supabase Cloud.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-sky-100">
                  {isEditor ? (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full py-2.5 px-4 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-2 cursor-pointer transition-all shadow-xs"
                      style={{
                        background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                      }}
                    >
                      <Upload className="w-4 h-4" />
                      <span>Choose Excel File to Import</span>
                    </button>
                  ) : (
                    <div className="py-2 px-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium flex items-center justify-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                      <span>Editor or Admin role required to import Excel files</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Card 02: Export Live Database to Excel */}
              <div className="rounded-xl bg-white p-5 border border-slate-200/90 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-emerald-700">
                      02 · Full Register Snapshot
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {equipment.length} Active Records
                    </span>
                  </div>

                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                      <Database className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 m-0">
                        Export Live Database to Excel
                      </h3>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed m-0">
                        Download a complete, timestamped Excel register of all <b>{equipment.length}</b> equipment tags including 6-stage statuses, Base Line UTG, dates, drawings, and remarks.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleExcelDownload}
                    className="w-full py-2.5 px-4 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-2 cursor-pointer transition-all shadow-xs"
                    style={{
                      background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                    }}
                  >
                    <Download className="w-4 h-4" />
                    <span>Export All {equipment.length} Records (.xlsx)</span>
                  </button>
                </div>
              </div>

              {/* Card 03: Download Standardized 23-Column Blank Template */}
              <div className="rounded-xl bg-white p-5 border border-slate-200/90 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                      <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-600">
                      03 · Standardized Schema + Picklist
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      2 Sheets · 23 Columns
                    </span>
                  </div>

                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 text-slate-800 flex items-center justify-center shrink-0">
                      <FileSpreadsheet className="w-5 h-5 text-sky-700" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 m-0">
                        Download Standardized Excel Template
                      </h3>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed m-0">
                        Includes Sheet 1 (<b>Equipment Master</b> with all 23 column headers &amp; sample rows) and Sheet 2 (<b>Picklist</b> with valid Unit › Sub-Unit › System › Sub-System skip-level hierarchy rules, Format-I to Format-V, Base Line UTG, PMI, and filling guide).
                      </p>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleDownloadTemplate}
                    className="w-full py-2.5 px-4 rounded-lg text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200/80 border border-slate-300 flex items-center justify-center gap-2 cursor-pointer transition-colors"
                  >
                    <Download className="w-4 h-4 text-slate-700" />
                    <span>Download Template + Picklist (.xlsx)</span>
                  </button>
                </div>
              </div>

              {/* Card 04: Direct Bulk Report Upload & Google Drive Sync */}
              <div className="rounded-xl bg-white p-5 border border-slate-200/90 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-indigo-700">
                      04 · Cloud Report Bridge
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      PDF · PNG · JPG
                    </span>
                  </div>

                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center justify-center shrink-0">
                      <FolderSync className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 m-0">
                        Direct Bulk Report Upload to Cloud Drive
                      </h3>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed m-0">
                        Drag and drop multiple signed <b>PDF or Photo</b> inspection reports directly from your PC or phone into the central <b>Google Drive / OneDrive</b> folder.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100">
                  {isEditor ? (
                    <button
                      type="button"
                      onClick={() => setShowCloudSyncModal(true)}
                      className="w-full py-2.5 px-4 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-2 cursor-pointer transition-all shadow-xs"
                      style={{
                        background: 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)',
                      }}
                    >
                      <FolderSync className="w-4 h-4" />
                      <span>Open Direct Bulk Upload &amp; Drive Sync</span>
                    </button>
                  ) : (
                    <div className="py-2 px-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium flex items-center justify-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                      <span>Authorized Engineer or Admin role required</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 23-Column Schema & Formatting Specification Matrix */}
            <div className="rounded-xl bg-white border border-slate-200/90 shadow-2xs overflow-hidden">
              <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Table2 className="w-4 h-4 text-sky-700" />
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 m-0">
                    Standardized 23-Column Excel Schema Specification
                  </h3>
                </div>
                <span className="text-[11px] font-mono text-slate-500">
                  Worksheet: Equipment Master · Primary Key: Equipment Tag No.
                </span>
              </div>

              <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold text-slate-900">
                    01. 4-Level Skip-Aware Hierarchy &amp; Identity (7 Columns)
                  </div>
                  <p className="text-slate-600 leading-relaxed m-0">
                    Maps each record to its Unit › Sub-Unit › System › Sub-System (any blank column automatically skips to the previous level):
                  </p>
                  <div className="font-mono text-[11px] text-sky-900 pt-1 leading-relaxed">
                    Unit · Sub-Unit · System No. · Sub-System · Equipment Tag No. · Equipment Description · Equipment Type
                  </div>
                </div>

                <div className="space-y-1.5 md:border-l md:border-slate-200 md:pl-5">
                  <div className="text-[11px] font-bold text-slate-900">
                    02. 9-Stage Inspection Pipeline &amp; Dates (14 Columns)
                  </div>
                  <p className="text-slate-600 leading-relaxed m-0">
                    Tracks live completion percentages across all 7 core quality milestones (plus Base Line UTG &amp; PMI):
                  </p>
                  <div className="font-mono text-[11px] text-emerald-900 pt-1 leading-relaxed">
                    Format-I Status &amp; Date · Format-II Status &amp; Date · Format-III Status &amp; Date · Format-IV Status &amp; Date · Format-V Status &amp; Date · Internal Inspection Status · Base Line UTG · PMI · Final System Acceptance
                  </div>
                </div>

                <div className="space-y-1.5 md:border-l md:border-slate-200 md:pl-5">
                  <div className="text-[11px] font-bold text-slate-900">
                    03. Engineering Closeout &amp; Cloud Links (2 Columns)
                  </div>
                  <p className="text-slate-600 leading-relaxed m-0">
                    Stores reference drawings, cloud report URLs, and field remarks:
                  </p>
                  <div className="font-mono text-[11px] text-indigo-900 pt-1 leading-relaxed">
                    Document/Drawing · Remarks
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TASK VIEW: ADMIN & LIVE DATABASE CONSOLE IN RIGHT PANE */}
        {viewLevel === 'admin' && (
          <AdminPanel
            inline
            onClose={goToHome}
            activeTabOverride={adminActiveTab}
            onTabChange={setAdminActiveTab}
            subActionTrigger={adminSubAction}
          />
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
            showGreenToast('Inspection Details saved successfully');
          }}
          onDelete={canAccessLiveDatabase ? deleteEquipment : undefined}
        />
      )}

      {/* LIVE IN-APP INSPECTION REPORT VIEWER & UPLOADER MODAL */}
      {reportModalState && (
        <InspectionReportModal
          item={reportModalState.item}
          canEdit={isEditor}
          initialTab={reportModalState.tab}
          viewOnly={Boolean(reportModalState.viewOnly)}
          onClose={() => setReportModalState(null)}
          onUpdated={async () => {
            await refreshEquipment();
            showGreenToast('Inspection Details saved successfully');
          }}
          onOpenCloudSync={() => setShowCloudSyncModal(true)}
        />
      )}

      {/* GOOGLE DRIVE / ONEDRIVE LIVE FOLDER SYNCHRONIZATION MODAL */}
      {showCloudSyncModal && (
        <CloudFolderSyncModal
          equipment={equipment}
          scopeLabel={isUnitScoped ? allUnitsList.join(', ') : 'All Project Units'}
          onClose={() => setShowCloudSyncModal(false)}
          onSynced={async () => {
            await refreshEquipment();
          }}
        />
      )}

      {/* INTERACTIVE UNIT-WISE REMARKS & COMMENTS MODAL */}
      {remarksModalUnit && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(3px)',
            zIndex: 120,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => setRemarksModalUnit(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '12px',
              width: '100%',
              maxWidth: '820px',
              maxHeight: '88vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.28)',
              border: '1px solid #cbd5e1',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '14px 18px',
                background: 'linear-gradient(180deg, #0b2545 0%, #134074 100%)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '3px solid #0284c7',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    background: 'rgba(2, 132, 199, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MessageSquare size={18} color="#38bdf8" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '15.5px', fontWeight: 700, color: '#ffffff', letterSpacing: '0.2px' }}>
                    Equipment Remarks &amp; Comments
                  </h3>
                  <span style={{ fontSize: '11px', color: '#bae6fd' }}>
                    {remarksModalUnit === 'ALL' ? 'Showing all project units' : `Filtering by Unit: ${remarksModalUnit}`}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRemarksModalUnit(null)}
                style={{
                  background: 'rgba(255, 255, 255, 0.15)',
                  border: '1px solid rgba(255, 255, 255, 0.25)',
                  color: '#ffffff',
                  borderRadius: '6px',
                  width: '30px',
                  height: '30px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 700,
                }}
                title="Close"
              >
                ✕
              </button>
            </div>

            {/* Quick Unit Switcher Pills */}
            <div
              style={{
                padding: '8px 16px',
                background: '#f8fafc',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                overflowX: 'auto',
              }}
            >
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginRight: '2px', flexShrink: 0 }}>
                Unit:
              </span>
              <button
                type="button"
                onClick={() => setRemarksModalUnit('ALL')}
                style={{
                  padding: '3px 10px',
                  fontSize: '11.5px',
                  borderRadius: '999px',
                  border: remarksModalUnit === 'ALL' ? '1px solid #0284c7' : '1px solid #cbd5e1',
                  background: remarksModalUnit === 'ALL' ? '#0284c7' : '#ffffff',
                  color: remarksModalUnit === 'ALL' ? '#ffffff' : '#334155',
                  fontWeight: remarksModalUnit === 'ALL' ? 700 : 500,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                All Units ({equipment.filter((i) => (i.Remarks || '').trim().length > 0).length})
              </button>
              {allUnitsList.map((uName) => {
                const count = equipment.filter(
                  (i) => i.Unit === uName && (i.Remarks || '').trim().length > 0
                ).length;
                const isActive = remarksModalUnit === uName;
                return (
                  <button
                    key={uName}
                    type="button"
                    onClick={() => setRemarksModalUnit(uName)}
                    style={{
                      padding: '3px 10px',
                      fontSize: '11.5px',
                      borderRadius: '999px',
                      border: isActive ? '1px solid #0284c7' : '1px solid #cbd5e1',
                      background: isActive ? '#0284c7' : '#ffffff',
                      color: isActive ? '#ffffff' : '#334155',
                      fontWeight: isActive ? 700 : 500,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    {uName} ({count})
                  </button>
                );
              })}
            </div>

            {/* Search Input Filter */}
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #e2e8f0', background: '#ffffff' }}>
              <input
                type="text"
                className="tsf"
                style={{ width: '100%', margin: 0, padding: '7px 12px', fontSize: '12.5px', boxSizing: 'border-box' }}
                placeholder="🔍 Search comments, equipment tag, description, sub-unit, or system…"
                value={remarksFilterSearch}
                onChange={(e) => setRemarksFilterSearch(e.target.value)}
              />
            </div>

            {/* Equipment Comments List */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                background: '#f8fafc',
              }}
            >
              {(() => {
                const itemsWithRemarks = equipment.filter((i) => {
                  if (!(i.Remarks || '').trim()) return false;
                  if (remarksModalUnit !== 'ALL' && i.Unit !== remarksModalUnit) return false;
                  if (!remarksFilterSearch) return true;
                  const q = remarksFilterSearch.toLowerCase();
                  return (
                    i.EquipmentTagNo?.toLowerCase().includes(q) ||
                    i.EquipmentDescription?.toLowerCase().includes(q) ||
                    i.Remarks?.toLowerCase().includes(q) ||
                    i.Unit?.toLowerCase().includes(q) ||
                    i.SystemNo?.toLowerCase().includes(q) ||
                    i.SubUnit?.toLowerCase().includes(q)
                  );
                });

                if (itemsWithRemarks.length === 0) {
                  return (
                    <div
                      style={{
                        textAlign: 'center',
                        padding: '40px 16px',
                        color: '#64748b',
                        fontSize: '13px',
                        background: '#ffffff',
                        borderRadius: '8px',
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      <MessageSquare size={34} color="#94a3b8" style={{ margin: '0 auto 10px', display: 'block' }} />
                      <p style={{ margin: 0, fontWeight: 700, fontSize: '14px', color: '#334155' }}>
                        No remarks found for this selection
                      </p>
                      <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                        {remarksFilterSearch
                          ? 'Try modifying your search term or select "All Units".'
                          : 'Equipment in this unit currently has no remarks.'}
                      </p>
                    </div>
                  );
                }

                return itemsWithRemarks.map((eq) => {
                  const overallSt = getEquipmentOverallStatus(eq);
                  return (
                    <div
                      key={eq.id}
                      style={{
                        border: '1px solid #cbd5e1',
                        borderRadius: '8px',
                        padding: '12px 14px',
                        background: '#ffffff',
                        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                      }}
                    >
                      {/* Header row */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: '6px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <a
                            href={`#eq-${encodeURIComponent(eq.EquipmentTagNo)}`}
                            onClick={() => setRemarksModalUnit(null)}
                            style={{
                              fontWeight: 700,
                              fontSize: '14px',
                              color: '#0284c7',
                              textDecoration: 'none',
                            }}
                          >
                            {eq.EquipmentTagNo}
                          </a>
                          {eq.EquipmentDescription && (
                            <span style={{ fontSize: '12.5px', color: '#475569' }}>
                              — {eq.EquipmentDescription}
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            style={{
                              fontSize: '10.5px',
                              padding: '2px 7px',
                              borderRadius: '4px',
                              background: '#f1f5f9',
                              color: '#334155',
                              fontWeight: 600,
                              border: '1px solid #e2e8f0',
                            }}
                          >
                            {formatEquipmentHierarchyPath(eq)}
                          </span>
                          <span
                            className={`c ${
                              overallSt === 'Completed' ? 'cg' : overallSt === 'In progress' ? 'ca' : 'cs'
                            }`}
                            style={{ fontSize: '10.5px' }}
                          >
                            {overallSt}
                          </span>
                        </div>
                      </div>

                      {/* Comment / Remark callout */}
                      <div
                        style={{
                          background: '#f0f9ff',
                          border: '1px solid #bae6fd',
                          borderLeft: '4px solid #0284c7',
                          borderRadius: '6px',
                          padding: '9px 13px',
                          fontSize: '13px',
                          color: '#0c4a6e',
                          lineHeight: 1.5,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          fontStyle: 'italic',
                        }}
                      >
                        &ldquo;{eq.Remarks}&rdquo;
                      </div>

                      {/* Action footer */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: '11px',
                          color: '#64748b',
                        }}
                      >
                        <span>
                          {eq.updatedAt ? `Updated: ${new Date(eq.updatedAt).toLocaleDateString()}` : ''}
                          {eq.updatedBy ? ` by ${eq.updatedBy}` : ''}
                        </span>
                        <a
                          href={`#eq-${encodeURIComponent(eq.EquipmentTagNo)}`}
                          onClick={() => setRemarksModalUnit(null)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: '#0284c7',
                            fontWeight: 700,
                            textDecoration: 'none',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            background: '#e0f2fe',
                          }}
                        >
                          Open Equipment Details ↗
                        </a>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '10px 16px',
                background: '#ffffff',
                borderTop: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                Tip: Click any equipment tag to view its full inspection stages.
              </span>
              <button
                type="button"
                onClick={() => setRemarksModalUnit(null)}
                style={{
                  padding: '6px 16px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  color: '#0f172a',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stage Drilldown Modal with Hyperlinks, Completion Dates & User IDs */}
      {stageDrilldownModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => setStageDrilldownModal(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #cbd5e1',
              width: '100%',
              maxWidth: '860px',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '14px 18px',
                background: '#f8fafc',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>Stage Drilldown: {stageDrilldownModal.col.label}</span>
                  <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px', background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' }}>
                    Required: {stageDrilldownModal.col.doneValue}
                  </span>
                </h3>
                <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                  Equipment items that completed this stage, along with completion dates and user IDs.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setStageDrilldownModal(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '18px',
                  cursor: 'pointer',
                  color: '#64748b',
                  padding: '4px',
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Search & Summary Bar */}
            <div style={{ padding: '10px 18px', borderBottom: '1px solid #e2e8f0', background: '#ffffff', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                placeholder="🔍 Search tag, description, unit, system, date, user ID…"
                value={stageDrilldownSearch}
                onChange={(e) => setStageDrilldownSearch(e.target.value)}
                style={{ flex: 1, minWidth: '260px', padding: '6px 10px', fontSize: '12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
                {stageDrilldownModal.items.filter((item) => {
                  const val = (item[stageDrilldownModal.col.key] as string) || '';
                  if (!isDone(val)) return false;
                  if (!stageDrilldownSearch) return true;
                  const q = stageDrilldownSearch.toLowerCase();
                  const dateVal = getStageDate(item, stageDrilldownModal.col.key);
                  const userVal = item.updatedBy || 'System / Admin';
                  return (
                    item.EquipmentTagNo?.toLowerCase().includes(q) ||
                    item.EquipmentDescription?.toLowerCase().includes(q) ||
                    item.Unit?.toLowerCase().includes(q) ||
                    item.SystemNo?.toLowerCase().includes(q) ||
                    dateVal.toLowerCase().includes(q) ||
                    userVal.toLowerCase().includes(q)
                  );
                }).length} completed of {stageDrilldownModal.items.length} total
              </span>
            </div>

            {/* Modal Equipment Table */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 18px' }}>
              <table className="nrep-table" style={{ width: '100%', fontSize: '12px' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 2 }}>
                  <tr>
                    <th>Tag No.</th>
                    <th>Description</th>
                    <th>Unit / System Path</th>
                    <th>Status</th>
                    <th>Completion / Issue Date</th>
                    <th>User ID / By</th>
                  </tr>
                </thead>
                <tbody>
                  {stageDrilldownModal.items
                    .filter((item) => {
                      const val = (item[stageDrilldownModal.col.key] as string) || '';
                      if (!isDone(val)) return false;
                      if (!stageDrilldownSearch) return true;
                      const q = stageDrilldownSearch.toLowerCase();
                      const dateVal = getStageDate(item, stageDrilldownModal.col.key);
                      const userVal = item.updatedBy || 'System / Admin';
                      return (
                        item.EquipmentTagNo?.toLowerCase().includes(q) ||
                        item.EquipmentDescription?.toLowerCase().includes(q) ||
                        item.Unit?.toLowerCase().includes(q) ||
                        item.SystemNo?.toLowerCase().includes(q) ||
                        dateVal.toLowerCase().includes(q) ||
                        userVal.toLowerCase().includes(q)
                      );
                    })
                    .map((item) => {
                      const dateVal = getStageDate(item, stageDrilldownModal.col.key);
                      const userVal = item.updatedBy || 'System / Admin';
                      const statusVal = (item[stageDrilldownModal.col.key] as string) || '—';
                      return (
                        <tr key={item.id}>
                          <td>
                            <a
                              href={`#eq-${encodeURIComponent(item.EquipmentTagNo)}`}
                              onClick={() => setStageDrilldownModal(null)}
                              style={{ fontWeight: 700, color: '#0284c7', textDecoration: 'underline' }}
                            >
                              🔗 {item.EquipmentTagNo}
                            </a>
                          </td>
                          <td>{item.EquipmentDescription || '—'}</td>
                          <td>
                            <span style={{ fontSize: '11px', color: '#334155' }}>
                              {formatEquipmentHierarchyPath(item)}
                            </span>
                          </td>
                          <td>
                            <span className="c cg" style={{ fontSize: '10.5px' }}>
                              {statusVal}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '11.5px', color: '#0f172a', fontWeight: 600 }}>
                              📅 {dateVal}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontSize: '11.5px', color: '#0369a1', fontWeight: 600 }}>
                              👤 {userVal}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div style={{ padding: '12px 18px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                💡 Click any Equipment Tag No. hyperlink to open its full inspection details.
              </span>
              <button
                type="button"
                onClick={() => setStageDrilldownModal(null)}
                style={{ padding: '6px 16px', fontSize: '12px', fontWeight: 600, borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', cursor: 'pointer' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Real-Time Animated Upload Progress Popup for Excel Upload */}
      <UploadProgressPopup
        open={Boolean(uploadingExcelFile)}
        title="Uploading & Syncing Excel Master Data..."
        fileName={uploadingExcelFile || ''}
        destinationLabel="Supabase Cloud Database"
      />

      {/* SweetAlert-Style Success Popup for Dashboard Excel Upload */}
      <SweetSuccessPopup
        open={Boolean(dashboardSweetSuccess)}
        title={dashboardSweetSuccess?.title || 'Success!'}
        message={dashboardSweetSuccess?.message || ''}
        badgeText={dashboardSweetSuccess?.badgeText}
        metaItems={dashboardSweetSuccess?.metaItems}
        confirmLabel="OK, Awesome!"
        onClose={() => setDashboardSweetSuccess(null)}
      />

      {/* Mint-Green Popup Toast Window matching reference screenshot image_073d974d */}
      {greenToast?.visible && (
        <div
          role="status"
          className="fixed top-6 right-6 z-[9999] flex items-center justify-between gap-5 px-4 py-3 rounded-[3px] shadow-lg text-white select-none transition-all duration-200 animate-in fade-in slide-in-from-top-2"
          style={{
            backgroundColor: '#7de2a4',
            minWidth: '330px',
            maxWidth: '92vw',
          }}
        >
          <span className="font-bold text-white text-[13px] tracking-tight antialiased">
            {greenToast.message}
          </span>
          <button
            type="button"
            onClick={() => setGreenToast(null)}
            className="text-gray-600 hover:text-gray-900 transition-colors p-0.5 cursor-pointer ml-3 flex items-center justify-center"
            aria-label="Close notification"
          >
            <X className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>
      )}
    </>
  );
}
