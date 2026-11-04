import { useEffect, useRef, useState } from 'react';
import { Download, FileText, Image as ImageIcon, Share2 } from 'lucide-react';
import type { Settlement } from '../types';
import { createPayslipBlob, downloadPayslipPdf, payslipFileName } from '../lib/payslip';
import { formatMoney } from '../lib/money';
import { useStore } from '../store';
import { Sheet } from './Sheet';

interface PayslipSheetProps {
  settlement: Settlement;
  accent: string;
  onClose: () => void;
}

export function PayslipSheet({ settlement, accent, onClose }: PayslipSheetProps) {
  const { toast } = useStore();
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [shareable, setShareable] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const blobRef = useRef<Blob | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    setLoading(true);
    setError('');
    createPayslipBlob(settlement, accent)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        blobRef.current = blob;
        setUrl(objectUrl);
        const nextFile = new File([blob], payslipFileName(settlement), { type: 'image/png' });
        setFile(nextFile);
        setShareable(
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
  }, [settlement, accent]);

  const save = () => {
    if (!url) return;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = payslipFileName(settlement);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    toast('工资条已保存');
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
      await downloadPayslipPdf(blobRef.current, settlement);
      toast('PDF 已保存');
    } catch {
      toast('PDF 生成失败，请稍后再试', 'error');
    } finally {
      setPdfBusy(false);
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
          保存图片
        </button>
      </div>
    </Sheet>
  );
}
