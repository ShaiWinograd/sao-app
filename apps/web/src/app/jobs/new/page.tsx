import { redirect } from 'next/navigation';

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  const createDate = date ?? new Date().toISOString().slice(0, 10);
  redirect(`/dashboard?createDate=${encodeURIComponent(createDate)}#owner-shift-grid`);
}
