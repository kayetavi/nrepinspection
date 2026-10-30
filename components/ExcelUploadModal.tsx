'use client';

import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useEquipment } from '@/lib/equipment-context';
import { useAuth } from '@/lib/auth-context';
import { UploadCloud, CheckCircle2, AlertCircle, FileSpreadsheet, X } from 'lucide-react';

interface ExcelUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ExcelUploadModal({ isOpen, onClose }: ExcelUploadModalProps) {
  const { importFromExcel } = useEquipment();
  const { isEditor } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ added: number; updated: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { cellDates: true });
      const ws = wb.Sheets['Equipment Master'] || wb.Sheets[wb.SheetNames[0]];

      if (!ws) {
        throw new Error('Could not find a valid sheet in this workbook.');
      }

      // Convert sheet to json array of arrays to find header row dynamically
      const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
      const headerIndex = aoa.findIndex((r) =>
        r && r.some((c: any) => String(c).trim().toLowerCase() === 'equipment tag no.')
      );

      if (headerIndex < 0) {
        throw new Error(
          'Header row with "Equipment Tag No." not found. Please verify the Excel structure.'
        );
      }

      const headers: string[] = aoa[headerIndex].map((h) => String(h || '').trim());
      const tagIndex = headers.findIndex((h) => h.toLowerCase() === 'equipment tag no.');
      const docIndex = headers.findIndex((h) => /^(document\s*\/\s*drawing|document|drawing)/i.test(h));

      const rows: any[] = [];
      let currentUnit = '';
      let currentSystem = '';

      for (let r = headerIndex + 1; r < aoa.length; r++) {
        const row = aoa[r];
        if (!row || !row[tagIndex]) continue;

        const rowObj: any = {};
        headers.forEach((header, colIndex) => {
          if (!header || header === 'Sl. No.' || header === 'Punch Points Pending') return;
          let val = row[colIndex];
          if (val == null || val === '') return;
          if (val instanceof Date) {
            val = new Date(val.getTime() - val.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
          }
          rowObj[header] = String(val).trim();
        });

        // Hierarchical inheritance like the original template
        if (rowObj['Unit']) currentUnit = rowObj['Unit'];
        else rowObj['Unit'] = currentUnit || 'Unassigned';

        if (rowObj['System No.']) currentSystem = rowObj['System No.'];
        else rowObj['System No.'] = currentSystem || 'General System';

        // Check cell hyperlink if present on Tag or Document/Drawing cell
        const docCell = docIndex >= 0 ? ws[XLSX.utils.encode_cell({ r, c: docIndex })] : null;
        const tagCell = ws[XLSX.utils.encode_cell({ r, c: tagIndex })];
        if (docCell && docCell.l && docCell.l.Target) {
          rowObj['Document/Drawing'] = docCell.l.Target;
        } else if (docIndex >= 0 && rowObj[headers[docIndex]]) {
          rowObj['Document/Drawing'] = rowObj[headers[docIndex]];
        } else if (tagCell && tagCell.l && tagCell.l.Target && !rowObj['Document/Drawing']) {
          rowObj['Document/Drawing'] = tagCell.l.Target;
        }

        rows.push(rowObj);
      }

      if (rows.length === 0) {
        throw new Error('No equipment rows could be extracted from this spreadsheet.');
      }

      const syncResult = await importFromExcel(rows);
      setResult(syncResult);
    } catch (err: any) {
      setError(err.message || 'Failed to process Excel spreadsheet.');
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-sky-950 text-white px-6 py-4 flex items-center justify-between border-b border-sky-900">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-sky-800 text-sky-200">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold">Upload Excel Equipment Master</h3>
              <p className="text-xs text-sky-200">Seamless real-time synchronization to Cloud Firestore</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-sky-300 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            Upload an updated Equipment Master spreadsheet (<span className="font-mono">.xlsx</span>,{' '}
            <span className="font-mono">.xlsm</span>, <span className="font-mono">.xls</span>). Existing items with
            matching Equipment Tag numbers will be seamlessly updated, and new assets will be registered into the
            cloud database.
          </p>

          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-300 hover:border-sky-600 rounded-xl p-8 text-center cursor-pointer transition-colors bg-slate-50 hover:bg-sky-50/50 group"
          >
            <UploadCloud className="w-10 h-10 text-slate-400 group-hover:text-sky-600 mx-auto mb-2 transition-colors" />
            <div className="text-xs font-semibold text-slate-800">
              {loading ? 'Processing & Syncing to Cloud Firestore...' : 'Click to select spreadsheet or drop file here'}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Accepts standard NRL NREP inspection template formats</div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".xlsx,.xlsm,.xls"
              className="hidden"
            />
          </div>

          {result && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Cloud Sync Completed Successfully:</span>
                <div className="mt-0.5">
                  Added <b className="font-mono">{result.added}</b> new equipment and updated{' '}
                  <b className="font-mono">{result.updated}</b> existing assets in Firestore.
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Sync Error:</span>
                <div className="mt-0.5">{error}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 text-xs font-medium"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
