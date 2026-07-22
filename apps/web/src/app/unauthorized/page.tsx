'use client';

import { useClerk } from '@clerk/nextjs';

// Standalone unauthorized screen: no app navigation, no business data. Shown to
// an authenticated user who is not authorized to use the system (not a
// pre-registered worker and not an invited owner/admin).
export default function UnauthorizedPage() {
  const { signOut } = useClerk();

  return (
    <main
      dir="rtl"
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-50 px-6 text-center"
    >
      <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-lg font-semibold text-gray-900">אין הרשאה</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          אין לך הרשאה להשתמש במערכת. יש לפנות לבעלת העסק.
        </p>
        <button
          type="button"
          onClick={() => signOut({ redirectUrl: '/sign-in' })}
          className="mt-6 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          התנתקות
        </button>
      </div>
    </main>
  );
}
