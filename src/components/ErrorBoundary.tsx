import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { Logo } from './Logo';
import { saveTextFile } from '../lib/native';
import { LEGACY_STORAGE_KEYS, STORAGE_KEY } from '../lib/storage';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
  exportBusy: boolean;
  exportStatus: string;
}

/**
 * 根级错误边界：渲染异常时不再白屏。
 * 账本数据存在 localStorage，刷新页面即可重试；错误信息只写到控制台和折叠区。
 * 若崩溃源于数据本身，反复刷新会陷入循环，所以提供「导出账本数据」逃生口。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '', exportBusy: false, exportStatus: '' };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
      exportBusy: false,
      exportStatus: '',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('薪时页面渲染失败', error, info.componentStack);
  }

  private retry = () => {
    window.location.reload();
  };

  private exportRaw = async () => {
    if (this.state.exportBusy) return;
    this.setState({ exportBusy: true, exportStatus: '' });
    try {
      let raw = '';
      for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
        const value = localStorage.getItem(key);
        if (value) {
          raw = value;
          break;
        }
      }
      if (!raw) {
        this.setState({ exportStatus: '本机没有读到原始账本数据' });
        return;
      }
      const result = await saveTextFile('薪时原始账本-待恢复.txt', raw, 'text/plain;charset=utf-8');
      this.setState({
        exportStatus:
          result === 'native'
            ? '已保存到「下载/Xinshi/薪时原始账本-待恢复.txt」'
            : '已开始下载原始账本，请确认文件保存成功',
      });
    } catch (error) {
      this.setState({
        exportStatus:
          error instanceof Error
            ? `导出失败：${error.message}。请勿清除站点数据。`
            : '导出失败，请勿清除站点数据。',
      });
    } finally {
      this.setState({ exportBusy: false });
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="error-boundary">
        <div className="error-boundary-card" role="alert">
          <div className="error-boundary-brand">
            <Logo size={38} />
            <span>薪时 XINSHI</span>
          </div>
          <h1>账本还在，页面出错了</h1>
          <p>
            这是一次页面渲染异常，不是账本丢失。你的记录仍在本地存储里，刷新页面可以重新打开；
            如果反复出现，请先导出账本数据留底，再把下面的错误信息发给开发者。
          </p>
          <div className="error-boundary-actions">
            <button type="button" className="btn btn--primary btn--block" onClick={this.retry}>
              重新加载
            </button>
            <button
              type="button"
              className="btn btn--soft btn--block"
              onClick={() => void this.exportRaw()}
              disabled={this.state.exportBusy}
            >
              <Download size={16} />
              {this.state.exportBusy ? '正在导出…' : '导出账本数据'}
            </button>
          </div>
          {this.state.exportStatus ? (
            <p className="error-boundary-status">{this.state.exportStatus}</p>
          ) : null}
          <details className="error-boundary-detail">
            <summary>错误信息</summary>
            <code>{this.state.message || '未知错误'}</code>
          </details>
          <p className="error-boundary-foot">数据只在这台设备上 · 不上传服务器</p>
        </div>
      </div>
    );
  }
}
