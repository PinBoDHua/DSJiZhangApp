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
  const [saveBusy, setSaveBusy] = useState(false);
  const [options, setOptions] = useState<PayslipOptions>(loadPayslipOptions);
  const [renderOptions, setRenderOptions] = useState<PayslipOptions>(options);
  const [rendering, setRendering] = useState(true);
  const [templateId, setTemplateId] = useState<PayslipTemplateId>(() =>
    matchPayslipTemplate(loadPayslipOptions()),
  );
  const blobRef = useRef<Blob | null>(null);

  // 页脚备注逐字输入时不要每键都重绘 canvas；防抖后再渲染，选项切换也合并抖动。
  useEffect(() => {
    const timer = window.setTimeout(() => setRenderOptions(options), 280);
    return () => window.clearTimeout(timer);
  }, [options]);

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
    setRendering(true);
    if (!blobRef.current) setLoading(true);
    setError('');
    createPayslipBlob(settlement, accent, renderOptions)
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
        setRendering(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('图片生成失败，请稍后再试');
        setLoading(false);
        setRendering(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [settlement, accent, renderOptions]);

  // 选项变更到重绘完成之间，blob 还是旧版：此时保存 / 分享会导出旧图，先禁用。
  const stale = rendering || options !== renderOptions;

  const save = async () => {
    if (!blobRef.current || saveBusy || stale) return;
    setSaveBusy(true);
    try {
      const result = await saveBlobFile(blobRef.current, payslipFileName(settlement));
      toast(
        result === 'native'
          ? '图片已保存到「下载/Xinshi」'
          : '工资条已保存',
      );
    } catch {
      toast('保存失败，请稍后再试', 'error');
    } finally {
      setSaveBusy(false);
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
    if (!blobRef.current || stale) return;
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
          <div className="payslip-skeleton" aria-busy="true" aria-label="正在生成工资条">
            <div className="skeleton skeleton--eyebrow" />
            <div className="skeleton skeleton--title" />
            <div className="skeleton skeleton--hero" />
            <div className="skeleton skeleton--row" />
            <div className="skeleton skeleton--row skeleton--short" />
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
          <button type="button" className="btn btn--soft" onClick={share} disabled={loading || stale}>
            <Share2 size={16} />
            分享
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--soft"
          onClick={savePdf}
          disabled={loading || !url || pdfBusy || stale}
        >
          <FileText size={16} />
          {pdfBusy ? '生成中' : 'PDF'}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={save}
          disabled={!url || saveBusy || stale}
        >
          <Download size={16} />
          {saveBusy ? '保存中' : stale ? '更新中' : isNativeApp() ? '保存文件' : '保存图片'}
        </button>
      </div>
    </Sheet>
  );
}
