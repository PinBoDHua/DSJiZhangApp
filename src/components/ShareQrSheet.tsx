import { useMemo, useState } from 'react';
import { Copy, Download } from 'lucide-react';
import type { Settlement } from '../types';
import { createSettlementQrFor, qrToPngBlob } from '../lib/shareQr';
import { formatDateShort } from '../lib/date';
import { saveBlobFile } from '../lib/native';
import { saveFeedback } from '../lib/fileFeedback';
import { copyText } from '../lib/clipboard';
import { useStore } from '../store';
import { Sheet } from './Sheet';
import { Money, usePrivacy } from './Money';

interface ShareQrSheetProps {
  settlement: Settlement;
  onClose: () => void;
}

export function ShareQrSheet({ settlement, onClose }: ShareQrSheetProps) {
  const { toast } = useStore();
  // UI-06：二维码 / 复制摘要里的金额始终是明文，隐藏金额时必须在顶部提示。
  const hiddenAmounts = usePrivacy();
  const [saving, setSaving] = useState(false);
  const qr = useMemo(() => createSettlementQrFor(settlement), [settlement]);

  const save = async () => {
    setSaving(true);
    try {
      const blob = await qrToPngBlob(qr.qr);
      const result = await saveBlobFile(
        blob,
        `薪时结算二维码-${settlement.jobName}-${settlement.periodEnd}.png`,
      );
      const feedback = saveFeedback(result, '二维码图片');
      toast(feedback.message, feedback.tone);
    } catch {
      toast('二维码保存失败，请稍后再试', 'error');
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    const ok = await copyText(qr.text);
    toast(ok ? '结算摘要已复制' : '复制失败，请手动截图', ok ? 'success' : 'error');
  };

  return (
    <Sheet
      open
      title="分享结算二维码"
      subtitle="对方扫码可看到这张结算单的摘要"
      onClose={onClose}
    >
      <div className="sheet-body share-qr-body">
        {hiddenAmounts ? (
          <p className="export-plaintext-hint" role="note">
            当前已隐藏金额，导出 / 分享内容仍包含明文金额
          </p>
        ) : null}
        <div className="share-qr-card">
          <img src={qr.dataUrl} alt="结算单二维码" />
        </div>
        <div className="share-qr-meta">
          <strong>{settlement.jobName}</strong>
          <span>
            {formatDateShort(settlement.periodStart)} –{' '}
            {formatDateShort(settlement.periodEnd)}
          </span>
          <b><Money value={settlement.net} symbol /></b>
          <span className="share-qr-code">校验码 {qr.checksum}</span>
        </div>
        <p className="share-qr-hint">
          二维码只包含工作、周期、应发 / 已收 / 待收和单号，不含完整工记。
          发给老板前请先核对金额。
        </p>
      </div>
      <div className="sheet-footer">
        <button type="button" className="btn btn--soft" onClick={copy}>
          <Copy size={16} />
          复制摘要
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={save}
          disabled={saving}
        >
          <Download size={16} />
          {saving ? '保存中' : '保存二维码'}
        </button>
      </div>
    </Sheet>
  );
}
