import { AlertTriangle, Download, RefreshCw } from 'lucide-react';
import type { LoadStateFailure } from '../lib/storage';
import { downloadText } from '../lib/storage';
import { Logo } from './Logo';

export function StorageRecovery({ failure }: { failure: LoadStateFailure }) {
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
              onClick={() => downloadText('薪时原始账本-待恢复.txt', failure.raw, 'text/plain;charset=utf-8')}
            >
              <Download size={16} />
              导出原始账本
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
        <p className="error-boundary-foot">原始数据仍保留在本机 · 尚未执行清空或覆盖</p>
      </div>
    </div>
  );
}
