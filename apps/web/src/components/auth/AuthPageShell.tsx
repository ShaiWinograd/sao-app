export function AuthPageShell({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-[var(--color-background)] px-4 py-10"
      dir="rtl"
    >
      <div className="w-full max-w-md">
        <header className="mb-7 text-center">
          <p className="font-display text-3xl font-semibold tracking-tight text-gray-900">Space &amp; Order</p>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">ניהול צוות ולוח שנה</p>
        </header>

        <section className="border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5 shadow-[0_18px_45px_rgba(41,39,36,0.08)] sm:p-7">
          {children}
        </section>

        <p className="mt-5 text-center text-xs leading-5 text-[var(--color-text-secondary)]">{footer}</p>
      </div>
    </main>
  );
}
