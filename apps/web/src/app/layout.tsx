import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { heIL } from '@clerk/localizations';
import { ClerkTokenProvider } from '../components/ClerkTokenProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'מערכת ניהול צוות ולוח שנה | Space & Order',
  description: 'ניהול עובדים, משמרות, לקוחות וחיוב לעסק ארגון ומעבר דירה',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      localization={heIL}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
    >
      <html lang="he" dir="rtl">
        <head>
          {/* Assistant + Heebo for Hebrew-first UI */}
          <link
            href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700&family=Heebo:wght@400;500;600;700&display=swap"
            rel="stylesheet"
          />
          {/* Open Sans remains available for mixed Latin-heavy content */}
          <link
            href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&display=swap"
            rel="stylesheet"
          />
        </head>
        <body className="antialiased bg-[var(--color-background)] text-[var(--color-text-primary)]">
          <ClerkTokenProvider />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
