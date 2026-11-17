import { describe, expect, it } from 'vitest';
import { saveFeedback, saveMessage } from './fileFeedback';

describe('保存结果文案（UI-22）', () => {
  it("'native' 才算已保存：成功语气且可记备份", () => {
    const feedback = saveFeedback('native', '考勤 CSV');
    expect(feedback.message).toBe('考勤 CSV 已保存到「下载/Xinshi」');
    expect(feedback.tone).toBe('success');
    expect(feedback.backedUp).toBe(true);
  });

  it("'shared' 分享面板不算已保存：必须请用户确认且不可 markBackedUp", () => {
    const feedback = saveFeedback('shared', '结算流水 CSV');
    expect(feedback.message).toBe('结算流水 CSV：已打开系统分享面板，请确认文件已保存');
    expect(feedback.message).not.toContain('已保存到');
    expect(feedback.tone).toBe('info');
    expect(feedback.backedUp).toBe(false);
  });

  it("'web' 触发浏览器下载：提示确认保存，按已保存处理", () => {
    const feedback = saveFeedback('web', '完整工记 CSV');
    expect(feedback.message).toBe('完整工记 CSV：已触发下载，请确认文件已保存');
    expect(feedback.tone).toBe('info');
    expect(feedback.backedUp).toBe(true);
  });

  it('主题名会拼进文案', () => {
    expect(saveFeedback('shared', '批量模板').message).toContain('批量模板');
    expect(saveFeedback('native', 'Excel 对账表').message).toContain('Excel 对账表');
  });

  it('saveMessage 只返回文案', () => {
    expect(saveMessage('shared', '考勤 CSV')).toBe(
      '考勤 CSV：已打开系统分享面板，请确认文件已保存',
    );
  });
});
