import { AlertTriangle, CheckCircle2, CircleDot, Clock, Info } from 'lucide-react';
import type { StatusTone } from '@workforce/shared';

type ToneStyle = {
  className: string;
  Icon: typeof CheckCircle2;
};

// Semantic status styling per UI_VISUAL_DESIGN_SPEC §2.4.
// Every badge pairs a color with an icon + text — never color alone.
const TONE_STYLES: Record<StatusTone, ToneStyle> = {
  success: { className: 'bg-success-bg text-success', Icon: CheckCircle2 },
  warning: { className: 'bg-warning-bg text-warning', Icon: Clock },
  error: { className: 'bg-danger-bg text-danger', Icon: AlertTriangle },
  info: { className: 'bg-info-bg text-info', Icon: Info },
  neutral: { className: 'bg-gray-100 text-gray-600', Icon: CircleDot },
};

export function StatusBadge({
  tone,
  label,
  className = '',
}: {
  tone: StatusTone;
  label: string;
  className?: string;
}) {
  const { className: toneClass, Icon } = TONE_STYLES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${toneClass} ${className}`}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden />
      {label}
    </span>
  );
}
