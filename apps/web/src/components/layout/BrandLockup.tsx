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
    ariaLabel: 'מעבר ללוח הבקרה',
  },
  worker: {
    href: '/worker',
    ariaLabel: 'מעבר למסך המשמרות',
  },
} satisfies Record<BrandLockupProps['area'], { href: string; ariaLabel: string }>;

export function BrandLockup({ area, compact = false, onNavigate }: BrandLockupProps) {
  const details = areaDetails[area];

  return (
    <Link
      href={details.href}
      onClick={onNavigate}
      aria-label={details.ariaLabel}
      className={`group flex min-w-0 items-center rounded-2xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-500 ${
        compact ? 'gap-3 py-1' : 'gap-3'
      }`}
    >
      <span
        className={`flex shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#ded9d0] bg-white shadow-[0_3px_12px_rgba(38,38,38,0.07)] transition-transform group-hover:scale-[1.02] ${
          compact ? 'h-[52px] w-[52px] rounded-xl' : 'h-20 w-20'
        }`}
      >
        <Image
          src="/so-logo-cropped.jpg"
          alt=""
          width={compact ? 52 : 80}
          height={compact ? 52 : 80}
          className="h-full w-full object-cover"
          priority
        />
      </span>
      <span
        dir="ltr"
        className={`block whitespace-nowrap text-left font-semibold text-gray-950 ${
          compact ? 'text-[12px] tracking-[0.13em]' : 'text-[12px] tracking-[0.11em]'
        }`}
      >
        SPACE &amp; ORDER
      </span>
    </Link>
  );
}
