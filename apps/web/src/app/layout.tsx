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
          {/* Open Sans for English content */}
          <link
            href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&display=swap"
            rel="stylesheet"
          />
          {/* Noto Sans Hebrew - perfect match for Open Sans */}
          <link
            href="https://fonts.googleapis.com/css2?family=Noto+Sans+Hebrew:wght@400;500;600;700&display=swap"
            rel="stylesheet"
          />
          <style>{`
            * {
              font-family: 'Noto Sans Hebrew', 'Open Sans', sans-serif;
            }
            html[lang="en"] * {
              font-family: 'Open Sans', sans-serif;
            }
          `}</style>
        </head>
        <body className="bg-gray-50 text-gray-900 antialiased">
          <ClerkTokenProvider />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
