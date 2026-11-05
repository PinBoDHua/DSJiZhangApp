import { SubPage } from '../components/SubPage';
import { PrivacyPolicy } from '../components/PrivacyPolicy';
import { PRIVACY_VERSION } from '../lib/compliance';

export function Privacy({ onBack }: { onBack: () => void }) {
  return (
    <SubPage title="隐私政策" subtitle={`版本 ${PRIVACY_VERSION}`} onBack={onBack}>
      <PrivacyPolicy />
    </SubPage>
  );
}
