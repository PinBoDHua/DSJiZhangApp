import { useEffect, useRef, useState } from 'react';
import { Download, FileText, Image as ImageIcon, Share2, SlidersHorizontal } from 'lucide-react';
import type { Settlement } from '../types';
import { createPayslipBlob, downloadPayslipPdf, payslipFileName } from '../lib/payslip';
import { downloadPayslipTextPdf } from '../lib/payslipText';
import {
  loadPayslipOptions,
  matchPayslipTemplate,
  optionsForTemplate,
  PAYSLIP_TEMPLATES,
  savePayslipOptions,
  type PayslipOptions,
  type PayslipTemplateId,
} from '../lib/payslipOptions';
import { formatMoney } from '../lib/money';
import { isNativeApp, saveBlobFile } from '../lib/native';
import { useStore } from '../store';
import { Sheet } from './Sheet';

interface PayslipSheetProps {
  settlement: Settlement;
  accent: string;
  onClose: () => void;
}

type PayslipBoolKey =
  | 'showOvertime'
  | 'showBonus'
  | 'showDeduction'
  | 'showOverRest'
  | 'showAdvance'
  | 'showRestDates'
  | 'showEntryDetails';

const PAYSLIP_TOGGLES: Array<{ key: PayslipBoolKey; label: string }> = [
  { key: 'showOvertime', label: '加班工资' },
  { key: 'showBonus', label: '奖金补贴' },
  { key: 'showDeduction', label: '扣款' },
  { key: 'showOverRest', label: '超休扣款' },
  { key: 'showAdvance', label: '借支抵扣' },
  { key: 'showRestDates', label: '休息日期' },
  { key: 'showEntryDetails', label: '工记明细' },
];

export function PayslipSheet({ settlement, accent, onClose }: PayslipSheetProps) {
  const { state, toast } = useStore();
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [shareable, setShareable] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [textBusy, setTextBusy] = useState(false);
  const [options, setOptions] = useState<PayslipOptions>(loadPayslipOptions);
  const [templateId, setTemplateId] = useState<PayslipTemplateId>(() =>
    matchPayslipTemplate(loadPayslipOptions()),
  );
  const blobRef = useRef<Blob | null>(null);

  const updateOption = (patch: Partial<PayslipOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    setTemplateId(matchPayslipTemplate(next));
    savePayslipOptions(next);
  };

  const applyTemplate = (id: string) => {
    if (id === 'custom') return;
    const next = optionsForTemplate(id as Exclude<PayslipTemplateId, 'custom'>);
    setTemplateId(id as PayslipTemplateId);
    setOptions(next);
    savePayslipOptions(next);
  };

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    if (!blobRef.current) setLoading(true);
    setError('');
    createPayslipBlob(settlement, accent, options)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        blobRef.current = blob;
        setUrl(objectUrl);
        const nextFile = new File([blob], payslipFileName(settlement), { type: 'image/png' });
        setFile(nextFile);
        setShareable(
          !isNativeApp() &&
            typeof navigator.canShare === 'function' &&
            navigator.canShare({ files: [nextFile] }),
        );
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('图片生成失败，请稍后再试');
        setLoading(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [settlement, accent, options]);

  const save = async () => {
    if (!blobRef.current) return;
    try {
      const result = await saveBlobFile(blobRef.current, payslipFileName(settlement));
      toast(
        result === 'native'
          ? '图片已保存到「下载/Xinshi」'
          : '工资条已保存',
      );
    } catch {
      toast('保存失败，请稍后再试', 'error');
    }
  };

  const share = async () => {
    if (!file) return;
    try {
      await navigator.share({
        files: [file],
        title: '薪时工资条',
        text: `${settlement.jobName} · 应发净额 ${formatMoney(settlement.net, {
          symbol: true,
        })}`,
      });
    } catch (shareError) {
      if (shareError instanceof Error && shareError.name === 'AbortError') return;
      toast('分享失败，可以长按图片保存', 'error');
    }
  };

  const savePdf = async () => {
    if (!blobRef.current) return;
    setPdfBusy(true);
    try {
      const result = await downloadPayslipPdf(blobRef.current, settlement);
      toast(result === 'native' ? 'PDF 已保存到「下载/Xinshi」' : 'PDF 已保存');
    } catch {
      toast('PDF 生成失败，请稍后再试', 'error');
    } finally {
      setPdfBusy(false);
    }
  };

  const saveTextPdf = async () => {
    setTextBusy(true);
    try {
      const entries = state.entries.filter((entry) =>
        settlement.entryIds.includes(entry.id),
      );
      const result = await downloadPayslipTextPdf(settlement, options, entries);
      toast(
        result === 'native'
          ? '文字版 PDF 已保存到「下载/Xinshi」'
          : '文字版 PDF 已保存',
      );
    } catch {
      toast('文字版 PDF 生成失败，请稍后再试', 'error');
    } finally {
      setTextBusy(false);
    }
  };

  return (
    <Sheet open title="工资条图片" subtitle="发给老板对账，或留作记录" onClose={onClose}>
      <div className="sheet-body payslip-body">
        {loading ? (
          <div className="payslip-loading">
            <span className="payslip-spinner" />
            <p>正在生成工资条…</p>
          </div>
        ) : error ? (
          <div className="payslip-loading">
            <ImageIcon size={26} />
            <p>{error}</p>
          </div>
        ) : (
          <>
            <img className="payslip-image" src={url} alt="薪时工资条预览" />
            <div className="payslip-note">
              <ImageIcon size={15} />
              <span>
                长按图片也可以保存或转发。金额仅供参考，实际以约定结算为准。
              </span>
            </div>
            <button
              type="button"
              className="text-link payslip-text-pdf"
              onClick={() => void saveTextPdf()}
              disabled={textBusy}
            >
              <FileText size={14} />
              {textBusy ? '正在生成文字版…' : '文字版 PDF（可选中 · 含工记明细）'}
            </button>
            <details className="payslip-options">
              <summary>
                <SlidersHorizontal size={14} />
                自定义明细行
              </summary>
              <label className="field payslip-template">
                <span className="field-label">模板</span>
                <select
                  className="text-input"
                  value={templateId}
                  onChange={(event) => applyTemplate(event.target.value)}
                >
                  {PAYSLIP_TEMPLATES.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.label}
                    </option>
                  ))}
                  <option value="custom" disabled>
                    自定义
                  </option>
                </select>
              </label>
              <div className="payslip-option-grid">
                {PAYSLIP_TOGGLES.map((item) => (                  <label className="payslip-option" key={item.key}>
                    <input
                      type="checkbox"
                      checked={options[item.key]}
                      onChange={(event) =>
                        updateOption({ [item.key]: event.target.checked })
                      }
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
              <label className="field">
                <span className="field-label">页脚备注（选填）</span>
                <input
                  className="text-input"
                  value={options.footerNote}
                  maxLength={30}
                  onChange={(event) => updateOption({ footerNote: event.target.value })}
                  placeholder="例如：已核对，现金结清"
                />
              </label>
              <p className="field-hint">只影响工资条图片 / PDF，不改结算金额。</p>
            </details>
          </>
        )}
      </div>
      <div className="sheet-footer payslip-footer">
        {shareable ? (
          <button type="button" className="btn btn--soft" onClick={share} disabled={loading}>
            <Share2 size={16} />
            分享
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--soft"
          onClick={savePdf}
          disabled={loading || !url || pdfBusy}
        >
          <FileText size={16} />
          {pdfBusy ? '生成中' : 'PDF'}
        </button>
        <button type="button" className="btn btn--primary" onClick={save} disabled={!url}>
          <Download size={16} />
          {isNativeApp() ? '保存文件' : '保存图片'}
        </button>
      </div>
    </Sheet>
  );
}
