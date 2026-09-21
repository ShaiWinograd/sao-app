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
      className={`group flex min-w-0 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-500 ${
        compact ? 'items-center gap-3 py-1' : 'w-full flex-col items-center gap-2 py-1'
      }`}
    >
      <span
        className={`flex shrink-0 items-center justify-center transition-transform group-hover:scale-[1.02] ${
          compact ? 'h-[52px] w-[52px]' : 'h-24 w-24'
        }`}
      >
        <Image
          src="/so-logo-transparent.png"
          alt=""
          width={compact ? 52 : 96}
          height={compact ? 52 : 96}
          className="h-full w-full object-contain"
          priority
        />
      </span>
      <span
        dir="ltr"
        className={`whitespace-nowrap text-left text-[12px] font-semibold tracking-[0.13em] text-gray-950 ${
          compact ? 'block' : 'sr-only'
        }`}
      >
        SPACE &amp; ORDER
      </span>
    </Link>
  );
}
