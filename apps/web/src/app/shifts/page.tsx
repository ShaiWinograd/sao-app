import { redirect } from 'next/navigation';

export default function ShiftsPage() {
  redirect('/jobs?view=shifts&range=week');
}
