import { useState } from 'react';
import { ArrowLeft, Check, FileText, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Logo, Wordmark } from './Logo';
import { PrivacyPolicy } from './PrivacyPolicy';
import { isNativeApp } from '../lib/native';
import { PRIVACY_VERSION } from '../lib/compliance';

interface PrivacyGateProps {
  onAgree: () => void;
}

export function PrivacyGate({ onAgree }: PrivacyGateProps) {
  const [showPolicy, setShowPolicy] = useState(false);
  const [declined, setDeclined] = useState(false);

  const decline = () => {
    setDeclined(true);
    if (isNativeApp()) {
      void import('@capacitor/app')
        .then(({ App }) => App.exitApp())
        .catch(() => {
          // 退不出去时停在说明页，不影响数据
        });
    }
  };

  if (showPolicy) {
    return (
      <div className="privacy-gate">
        <div className="privacy-gate-sheet">
          <header className="privacy-gate-head">
            <button
              type="button"
              className="icon-button icon-button--back"
              onClick={() => setShowPolicy(false)}
              aria-label="返回"
            >
              <ArrowLeft size={21} />
            </button>
            <div>
              <h1>隐私政策</h1>
              <p>版本 {PRIVACY_VERSION}</p>
            </div>
          </header>
          <div className="privacy-gate-scroll">
            <PrivacyPolicy />
          </div>
          <div className="privacy-gate-foot">
            <button type="button" className="btn btn--primary btn--block" onClick={onAgree}>
              同意并继续
            </button>
            <button type="button" className="btn btn--ghost btn--block" onClick={decline}>
              不同意
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="privacy-gate">
      <div className="privacy-gate-card">
        <div className="privacy-gate-brand">
          <Logo size={38} />
          <Wordmark />
        </div>

        {declined ? (
          <div className="privacy-declined" role="alert">
            <span className="privacy-gate-icon">
              <LockKeyhole size={22} />
            </span>
            <h1>需要同意隐私政策才能使用</h1>
            <p>
              薪时不在服务器保存任何东西，但账本会写在这台设备上。请你先阅读并同意
              隐私政策，再开始记工。
            </p>
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => setDeclined(false)}
            >
              重新阅读并同意
            </button>
          </div>
        ) : (
          <>
            <div className="privacy-gate-copy">
              <p className="eyebrow">上架合规 · 隐私优先</p>
              <h1>先说明白，再开始记工</h1>
              <p>
                薪时不登录、不上传、不联网也能用。为了让你放心，先说明白数据在哪里、
                要什么权限、怎么删。
              </p>
            </div>

            <ul className="privacy-points">
              <li>
                <ShieldCheck size={17} />
                <span>
                  <strong>不收集、不上传</strong>
                  <em>账本、工时、工资只存在这台设备</em>
                </span>
              </li>
              <li>
                <FileText size={17} />
                <span>
                  <strong>你主动导出才会离开</strong>
                  <em>备份、搬家包、工资条由你决定发给谁</em>
                </span>
              </li>
              <li>
                <LockKeyhole size={17} />
                <span>
                  <strong>通知权限可选</strong>
                  <em>拒绝也不影响记工与结算</em>
                </span>
              </li>
            </ul>

            <div className="privacy-gate-actions">
              <button type="button" className="btn btn--primary btn--block" onClick={onAgree}>
                <Check size={17} />
                同意并继续
              </button>
              <button type="button" className="btn btn--ghost btn--block" onClick={decline}>
                不同意
              </button>
              <button
                type="button"
                className="privacy-link-button"
                onClick={() => setShowPolicy(true)}
              >
                查看完整隐私政策
              </button>
            </div>

            <p className="privacy-gate-note">
              同意后会记住这个版本；政策更新时会重新询问。你可以在「我的 → 数据与安全」
              随时查看、导出或清空数据。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
