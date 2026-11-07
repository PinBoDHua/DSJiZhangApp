import { useState } from 'react';
import { AlertTriangle, Download, RefreshCw } from 'lucide-react';
import type { LoadStateFailure } from '../lib/storage';
import { saveTextFile } from '../lib/native';
import { Logo } from './Logo';

const RAW_FILE_NAME = '薪时原始账本-待恢复.txt';

export function StorageRecovery({ failure }: { failure: LoadStateFailure }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  // 原生壳里的 <a download> 不会触发系统下载，必须走 SaveFile 插件才能真的落盘。
  const exportRaw = async () => {
    if (busy) return;
    setBusy(true);
    setStatus('');
    try {
      const result = await saveTextFile(RAW_FILE_NAME, failure.raw, 'text/plain;charset=utf-8');
      setStatus(
        result === 'native'
          ? `已保存到「下载/Xinshi/${RAW_FILE_NAME}」`
          : '已开始下载原始账本，请确认文件保存成功',
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `导出失败：${error.message}。请勿清除站点数据，联系开发者处理。`
          : '导出失败，请勿清除站点数据，联系开发者处理。',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="error-boundary">
      <div className="error-boundary-card" role="alert">
        <div className="error-boundary-brand">
          <Logo size={38} />
          <span>薪时 XINSHI</span>
        </div>
        <AlertTriangle size={30} color="var(--danger)" />
        <h1>账本需要人工恢复</h1>
        <p>
          检测到一个已存在的账本无法读取。为防止空数据或旧缓存覆盖它，应用已停止写入。
          请先导出原始内容，再联系开发者恢复；不要直接清除站点数据。
        </p>
        <details className="error-boundary-detail">
          <summary>读取详情</summary>
          <code>{failure.key}：{failure.message}</code>
        </details>
        <div className="error-boundary-actions">
          {failure.raw ? (
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => void exportRaw()}
              disabled={busy}
            >
              <Download size={16} />
              {busy ? '正在导出…' : '导出原始账本'}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--soft btn--block"
            onClick={() => window.location.reload()}
          >
            <RefreshCw size={16} />
            重新检测
          </button>
        </div>
        {status ? <p className="error-boundary-status">{status}</p> : null}
        <p className="error-boundary-foot">原始数据仍保留在本机 · 尚未执行清空或覆盖</p>
      </div>
    </div>
  );
}
