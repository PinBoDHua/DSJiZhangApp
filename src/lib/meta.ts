import type { Cycle, JobColor, PayType } from '../types';

export const PAY_TYPE_LABEL: Record<PayType, string> = {
  hourly: '时薪',
  daily: '日薪',
  monthly: '月薪',
};

export const PAY_TYPE_UNIT: Record<PayType, string> = {
  hourly: '小时',
  daily: '天',
  monthly: '月',
};

export const PAY_TYPE_RATE_LABEL: Record<PayType, string> = {
  hourly: '时薪',
  daily: '日薪',
  monthly: '月薪',
};

export const CYCLE_LABEL: Record<Cycle, string> = {
  daily: '日结',
  weekly: '周结',
  monthly: '月结',
};

export const CYCLE_HINT: Record<Cycle, string> = {
  daily: '当天对账',
  weekly: '每周汇总',
  monthly: '整月汇总',
};

export interface JobColorMeta {
  key: JobColor;
  label: string;
  main: string;
  soft: string;
  ink: string;
}

export const JOB_COLORS: JobColorMeta[] = [
  { key: 'pine', label: '松绿', main: '#266A4E', soft: '#E4F0E8', ink: '#174733' },
  { key: 'amber', label: '琥珀', main: '#C48128', soft: '#F9ECD8', ink: '#7C4D0E' },
  { key: 'clay', label: '陶土', main: '#B55F47', soft: '#F7E6DF', ink: '#7B3928' },
  { key: 'sky', label: '雾蓝', main: '#44708C', soft: '#E6EFF4', ink: '#28495D' },
  { key: 'plum', label: '梅紫', main: '#7C5874', soft: '#F1E7EE', ink: '#53374D' },
  { key: 'olive', label: '橄榄', main: '#75803F', soft: '#EFF1DF', ink: '#4C5424' },
];

export function jobColor(color: JobColor): JobColorMeta {
  return JOB_COLORS.find((item) => item.key === color) ?? JOB_COLORS[0];
}

export function rateLabel(payType: PayType, rate: number): string {
  const value = Number.isInteger(rate) ? rate.toString() : rate.toFixed(2).replace(/\.?0+$/, '');
  return `¥${value}/${PAY_TYPE_UNIT[payType] === '小时' ? '时' : PAY_TYPE_UNIT[payType]}`;
}

export function cycleLabel(cycle: Cycle): string {
  return CYCLE_LABEL[cycle];
}
