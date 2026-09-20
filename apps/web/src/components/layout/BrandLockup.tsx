import Image from 'next/image';
import Link from 'next/link';

type BrandLockupProps = {
  area: 'owner' | 'worker';
  compact?: boolean;
  onNavigate?: () => void;
};

const areaDetails = {
  owner: {
    href: '/dashboard',
    label: 'ניהול עסק',
    ariaLabel: 'מעבר ללוח הבקרה',
  },
  worker: {
    href: '/worker',
    label: 'אזור העובדות',
    ariaLabel: 'מעבר למסך המשמרות',
  },
} satisfies Record<BrandLockupProps['area'], { href: string; label: string; ariaLabel: string }>;

export function BrandLockup({ area, compact = false, onNavigate }: BrandLockupProps) {
  const details = areaDetails[area];

  return (
    <Link
      href={details.href}
      onClick={onNavigate}
      aria-label={details.ariaLabel}
      className={`group flex min-w-0 items-center rounded-2xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-500 ${
        compact ? 'gap-2.5 py-1' : 'gap-3.5'
      }`}
    >
      <span
        className={`flex shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#ded9d0] bg-white shadow-[0_3px_12px_rgba(38,38,38,0.07)] transition-transform group-hover:scale-[1.02] ${
          compact ? 'h-11 w-11 rounded-xl' : 'h-16 w-16'
        }`}
      >
        <Image
          src="/so-logo-cropped.jpg"
          alt=""
          width={compact ? 44 : 64}
          height={compact ? 44 : 64}
          className="h-full w-full object-cover"
          priority
        />
      </span>
      <span className="min-w-0">
        <span
          dir="ltr"
          className={`block whitespace-nowrap text-left font-semibold text-gray-950 ${
            compact ? 'text-[12px] tracking-[0.15em]' : 'text-[13px] tracking-[0.17em]'
          }`}
        >
          SPACE &amp; ORDER
        </span>
        <span className={`mt-1 block text-right text-gray-500 ${compact ? 'text-xs' : 'text-sm'}`}>
          {details.label}
        </span>
      </span>
    </Link>
  );
}
