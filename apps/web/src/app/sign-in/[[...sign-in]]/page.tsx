import { SignIn } from '@clerk/nextjs';
import { AuthPageShell } from '../../../components/auth/AuthPageShell';

export default function SignInPage() {
  return (
    <AuthPageShell footer="הכניסה מיועדת לחשבונות צוות קיימים. עובדות חדשות מצטרפות באמצעות הזמנה.">
      <SignIn
        routing="path"
        path="/sign-in"
        forceRedirectUrl="/"
        appearance={{
          elements: {
            rootBox: 'w-full',
            card: 'w-full bg-transparent shadow-none border-0 p-0',
            formButtonPrimary:
              'bg-[var(--color-calendar-sage)] hover:bg-[#394d3e] text-white font-medium py-2.5 px-4 w-full transition-colors',
            formFieldInput:
              'w-full border border-[var(--color-border-strong)] bg-[var(--color-background)] px-3 py-2.5 text-right focus:border-[var(--color-calendar-sage)] focus:ring-1 focus:ring-[var(--color-calendar-sage)]',
            formFieldLabel: 'text-right text-gray-700 text-sm font-medium',
            dividerLine: 'bg-[var(--color-border)]',
            dividerText: 'text-[var(--color-text-secondary)]',
            socialButtonsBlockButton:
              'border border-[var(--color-border-strong)] bg-transparent font-medium text-gray-700 hover:bg-[var(--color-surface-muted)] transition-colors',
            headerTitle: 'hidden',
            headerSubtitle: 'hidden',
            footer: 'bg-transparent',
          },
          layout: {
            socialButtonsPlacement: 'bottom',
            socialButtonsVariant: 'blockButton',
          },
        }}
      />
    </AuthPageShell>
  );
}
