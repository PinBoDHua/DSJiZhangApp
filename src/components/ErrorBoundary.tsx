import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Logo } from './Logo';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * 根级错误边界：渲染异常时不再白屏。
 * 账本数据存在 localStorage，刷新页面即可重试；错误信息只写到控制台和折叠区。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('薪时页面渲染失败', error, info.componentStack);
  }

  private retry = () => {
    window.location.reload();
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
            如果反复出现，请先不要清空浏览器数据，把下面的错误信息发给开发者。
          </p>
          <div className="error-boundary-actions">
            <button type="button" className="btn btn--primary btn--block" onClick={this.retry}>
              重新加载
            </button>
          </div>
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
