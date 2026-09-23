'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { canViewSensitiveFinancials } from '../../lib/viewer-access';
import { useViewerRole } from '../../lib/use-viewer-role';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/ui/PageHeader';

type WorkerRole = 'ראש צוות' | 'עובדת';

type Worker = {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  role: WorkerRole;
  hourlyWage: number;
  vatIncluded: boolean;
  phone: string;
  email: string;
  isActive: boolean;
  homeAddress: string;
  birthday: string;
  bankNumber: string;
  bankBranch: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  lastActivityAt: string;
  skills: string[];
  pendingUpdate?: {
    role: WorkerRole;
    hourlyWage: number;
    vatIncluded: boolean;
    phone: string;
    email: string;
    effectiveFrom: string;
  };
};

type ApiWorker = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  skills: string[];
  isActive: boolean;
  paymentMethod: string;
  homeAddress?: string | null;
  birthday?: string | null;
  bankNumber?: string | null;
  bankBranch?: string | null;
  bankAccountNumber?: string | null;
  bankAccountHolder?: string | null;
  hourlyWage?: number;
  createdAt?: string;
};

function mapSkillsToRole(skills: string[]): WorkerRole {
  if (skills.includes('SHIFT_LEADER')) return 'ראש צוות';
  return 'עובדת';
}

function mapRoleToSkills(role: WorkerRole, existingSkills: string[]): string[] {
  const nonLeaderSkills = existingSkills.filter((s) => s !== 'SHIFT_LEADER');
  if (role === 'ראש צוות') return ['SHIFT_LEADER', ...nonLeaderSkills];
  return nonLeaderSkills.length > 0 ? nonLeaderSkills : ['GENERAL_WORKER'];
}

function mapApiWorker(worker: ApiWorker): Worker {
  return {
    id: worker.id,
    firstName: worker.firstName,
    lastName: worker.lastName,
    name: `${worker.firstName} ${worker.lastName}`.trim(),
    role: mapSkillsToRole(worker.skills),
    hourlyWage: Number(worker.hourlyWage ?? 0),
    vatIncluded: false,
    phone: worker.phone,
    email: worker.email,
    isActive: worker.isActive,
    homeAddress: worker.homeAddress ?? '',
    birthday: worker.birthday?.slice(0, 10) ?? '',
    bankNumber: worker.bankNumber ?? '',
    bankBranch: worker.bankBranch ?? '',
    bankAccountNumber: worker.bankAccountNumber ?? '',
    bankAccountHolder: worker.bankAccountHolder ?? '',
    lastActivityAt: worker.createdAt ?? new Date().toISOString(),
    skills: worker.skills,
  };
}

const WORKER_APP_INSTALL_URL = process.env.NEXT_PUBLIC_WORKER_APP_INSTALL_URL ?? 'https://spaceorder.app/install';
const HOURLY_WAGE_OPTIONS = [50, 60, 70, 80, 90, 100] as const;

function normalizePhone(value: string) {
  return value.replace(/\D/g, '');
}

function isValidIsraeliPhone(value: string) {
  const normalized = normalizePhone(value);
  return normalized.startsWith('0') && (normalized.length === 9 || normalized.length === 10);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isHebrewNamePart(value: string) {
  return /^(?=.*[\u0590-\u05FF])[\u0590-\u05FF\s'"׳״-]+$/u.test(value.trim());
}

function firstDayOfNextMonthDateKey() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

function formatActivityTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

export default function WorkersPage() {
  const searchParams = useSearchParams();
  const viewerRole = useViewerRole();
  const canEditWages = canViewSensitiveFinancials(viewerRole);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [archivedWorkers, setArchivedWorkers] = useState<Worker[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [workersView, setWorkersView] = useState<'active' | 'archive'>('active');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | WorkerRole>('all');
  const [newName, setNewName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newRole, setNewRole] = useState<WorkerRole>('עובדת');
  const [newHourlyWage, setNewHourlyWage] = useState(70);
  const [newVatIncluded, setNewVatIncluded] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [inviteChannel, setInviteChannel] = useState<'whatsapp' | 'email'>('whatsapp');
  const [message, setMessage] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingWorkerId, setEditingWorkerId] = useState<string | null>(null);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editRole, setEditRole] = useState<WorkerRole>('עובדת');
  const [editHourlyWage, setEditHourlyWage] = useState(60);
  const [editVatIncluded, setEditVatIncluded] = useState(false);
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editHomeAddress, setEditHomeAddress] = useState('');
  const [editBirthday, setEditBirthday] = useState('');
  const [editBankNumber, setEditBankNumber] = useState('');
  const [editBankBranch, setEditBankBranch] = useState('');
  const [editBankAccountNumber, setEditBankAccountNumber] = useState('');
  const [editBankAccountHolder, setEditBankAccountHolder] = useState('');
  const [editApplyImmediately, setEditApplyImmediately] = useState(false);
  const [editEffectiveFrom, setEditEffectiveFrom] = useState(firstDayOfNextMonthDateKey());
  const [teamMenuOpen, setTeamMenuOpen] = useState(false);
  const [teamAction, setTeamAction] = useState<'reinvite' | 'archive' | 'restore' | null>(null);
  const [teamWorkerId, setTeamWorkerId] = useState('');
  const [teamEmail, setTeamEmail] = useState('');
  const [teamBusy, setTeamBusy] = useState(false);

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (searchParams.get('action') === 'invite') {
      setIsCreateModalOpen(true);
    }
  }, [searchParams]);

  async function loadData() {
    setIsLoading(true);
    setDataError('');
    try {
      const res = await api.get<ApiWorker[]>('/workers?status=all');
      const mapped = res.data.map(mapApiWorker);
      setWorkers(mapped.filter((worker) => worker.isActive));
      setArchivedWorkers(mapped.filter((worker) => !worker.isActive));
    } catch {
      setDataError('לא ניתן לטעון את רשימת העובדים. בדקי שה-API זמין.');
    } finally {
      setIsLoading(false);
    }
  }

  const filteredWorkers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return workers.filter((worker) => {
      const matchRole = roleFilter === 'all' || worker.role === roleFilter;
      const matchSearch =
        !term || worker.name.toLowerCase().includes(term) || worker.phone.includes(term) || worker.email.toLowerCase().includes(term);
      return matchRole && matchSearch;
    });
  }, [workers, search, roleFilter]);

  const filteredArchivedWorkers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return archivedWorkers.filter((worker) => {
      const matchRole = roleFilter === 'all' || worker.role === roleFilter;
      const matchSearch =
        !term || worker.name.toLowerCase().includes(term) || worker.phone.includes(term) || worker.email.toLowerCase().includes(term);
      return matchRole && matchSearch;
    });
  }, [archivedWorkers, search, roleFilter]);

  const stats = useMemo(() => {
    const teamLeads = workers.filter((worker) => worker.role === 'ראש צוות').length;
    const averageWage =
      Math.round((workers.reduce((sum, worker) => sum + worker.hourlyWage, 0) / Math.max(1, workers.length)) * 10) / 10;
    return { teamLeads, averageWage };
  }, [workers]);

  const addWorkerAndSendInvite = async () => {
    const firstName = newName.trim();
    const lastName = newLastName.trim();
    if (!isHebrewNamePart(firstName) || !isHebrewNamePart(lastName)) {
      setMessage('יש להזין שם פרטי ושם משפחה מלאים בעברית.');
      return;
    }
    if (!isValidIsraeliPhone(newPhone)) {
      setMessage('מספר הטלפון לא תקין.');
      return;
    }
    const email = newEmail.trim();
    if (!isValidEmail(email)) {
      setMessage('יש להזין כתובת אימייל תקינה.');
      return;
    }
    if (!HOURLY_WAGE_OPTIONS.includes(newHourlyWage as (typeof HOURLY_WAGE_OPTIONS)[number])) {
      setMessage('יש לבחור שכר שעתי מהרשימה בלבד.');
      return;
    }
    const wage = newHourlyWage;
    try {
      const created = await api.post<{ id: string }>('/workers', {
        firstName,
        lastName,
        phone: newPhone.trim(),
        email,
        hourlyWage: wage,
        dailyPaymentAmount: wage * 8,
        paymentMethod: 'BANK_TRANSFER',
        skills: mapRoleToSkills(newRole, []),
      });
      let inviteSent = true;
      try {
        await api.post(`/workers/${created.data.id}/link-login`, { email });
      } catch {
        inviteSent = false;
      }
      setIsCreateModalOpen(false);
      setNewName('');
      setNewLastName('');
      setNewPhone('');
      setNewEmail('');
      setNewRole('עובדת');
      setNewHourlyWage(70);
      setMessage(inviteSent ? 'העובדת נוספה ונשלחה אליה הזמנה.' : 'העובדת נוספה, אך שליחת ההזמנה נכשלה. אפשר לנסות שוב מניהול הצוות.');
      await loadData();
    } catch {
      setMessage('הוספת העובדת נכשלה. ייתכן שהאימייל כבר קיים במערכת.');
    }
  };

  const openEditWorker = (worker: Worker) => {
    setEditingWorkerId(worker.id);
    setEditFirstName(worker.firstName);
    setEditLastName(worker.lastName);
    setEditRole(worker.role);
    setEditHourlyWage(worker.hourlyWage);
    setEditVatIncluded(worker.vatIncluded);
    setEditPhone(worker.phone);
    setEditEmail(worker.email);
    setEditHomeAddress(worker.homeAddress);
    setEditBirthday(worker.birthday);
    setEditBankNumber(worker.bankNumber);
    setEditBankBranch(worker.bankBranch);
    setEditBankAccountNumber(worker.bankAccountNumber);
    setEditBankAccountHolder(worker.bankAccountHolder);
    setEditApplyImmediately(false);
    setEditEffectiveFrom(firstDayOfNextMonthDateKey());
    setMessage('');
  };

  const saveWorkerUpdate = async () => {
    if (!editingWorkerId) return;
    if (!isHebrewNamePart(editFirstName) || !isHebrewNamePart(editLastName)) {
      setMessage('יש להזין שם פרטי ושם משפחה מלאים בעברית.');
      return;
    }
    if (canEditWages && !HOURLY_WAGE_OPTIONS.includes(editHourlyWage as (typeof HOURLY_WAGE_OPTIONS)[number])) {
      setMessage('יש לבחור שכר שעתי מהרשימה בלבד לפני שמירה.');
      return;
    }
    if (!isValidIsraeliPhone(editPhone)) {
      setMessage('מספר הטלפון לא תקין.');
      return;
    }
    if (!isValidEmail(editEmail)) {
      setMessage('כתובת האימייל לא תקינה.');
      return;
    }
    if (!window.confirm('אישור שינוי פרטי עובדת. להמשיך?')) return;

    const editingWorker = workers.find((w) => w.id === editingWorkerId);
    const updatedSkills = mapRoleToSkills(editRole, editingWorker?.skills ?? []);
    const patchBody: Record<string, unknown> = {
      firstName: editFirstName.trim(),
      lastName: editLastName.trim(),
      phone: editPhone.trim(),
      email: editEmail.trim(),
      homeAddress: editHomeAddress.trim(),
      birthday: editBirthday,
      skills: updatedSkills,
    };
    if (canEditWages) {
      patchBody.hourlyWage = editHourlyWage;
      patchBody.bankNumber = editBankNumber.trim();
      patchBody.bankBranch = editBankBranch.trim();
      patchBody.bankAccountNumber = editBankAccountNumber.trim();
      patchBody.bankAccountHolder = editBankAccountHolder.trim();
    }

    try {
      await api.patch(`/workers/${editingWorkerId}`, patchBody);
      setWorkers((prev) =>
        prev.map((worker) => {
          if (worker.id !== editingWorkerId) return worker;
          const updatedName = `${editFirstName.trim()} ${editLastName.trim()}`;
          if (editApplyImmediately) {
            return {
              ...worker,
              firstName: editFirstName.trim(),
              lastName: editLastName.trim(),
              name: updatedName,
              role: editRole,
              hourlyWage: canEditWages ? editHourlyWage : worker.hourlyWage,
              vatIncluded: editVatIncluded,
              phone: editPhone.trim(),
              email: editEmail.trim(),
              homeAddress: editHomeAddress.trim(),
              birthday: editBirthday,
              bankNumber: editBankNumber.trim(),
              bankBranch: editBankBranch.trim(),
              bankAccountNumber: editBankAccountNumber.trim(),
              bankAccountHolder: editBankAccountHolder.trim(),
              skills: updatedSkills,
              lastActivityAt: new Date().toISOString(),
              pendingUpdate: undefined,
            };
          }
          return {
            ...worker,
            firstName: editFirstName.trim(),
            lastName: editLastName.trim(),
            name: updatedName,
            pendingUpdate: {
              role: editRole,
              hourlyWage: canEditWages ? editHourlyWage : worker.hourlyWage,
              vatIncluded: editVatIncluded,
              phone: editPhone.trim(),
              email: editEmail.trim(),
              effectiveFrom: editEffectiveFrom,
            },
          };
        }),
      );
      setMessage(
        editApplyImmediately
          ? 'השינוי הוחל מיידית לפי בקשה מפורשת.'
          : `השינוי תוזמן לתוקף מתאריך ${editEffectiveFrom}.`,
      );
    } catch {
      setMessage('שמירת השינוי נכשלה. ודאי שה-API זמין.');
    }
    setEditingWorkerId(null);
  };

  const openTeamAction = (action: 'reinvite' | 'archive' | 'restore') => {
    const candidates = action === 'restore' ? archivedWorkers : workers;
    setTeamAction(action);
    setTeamWorkerId(candidates[0]?.id ?? '');
    setTeamEmail(candidates[0]?.email ?? '');
    setTeamMenuOpen(false);
    setMessage('');
  };

  const runTeamAction = async () => {
    const candidates = teamAction === 'restore' ? archivedWorkers : workers;
    const selected = candidates.find((worker) => worker.id === teamWorkerId);
    if (!selected || !teamAction) return;
    setTeamBusy(true);
    try {
      if (teamAction === 'reinvite') {
        const email = teamEmail.trim();
        if (!isValidEmail(email)) {
          setMessage('כתובת האימייל לא תקינה.');
          return;
        }
        await api.post(`/workers/${selected.id}/link-login`, { email });
        setMessage(`נשלחה הזמנה ל-${selected.name}.`);
      } else if (teamAction === 'archive') {
        if (!window.confirm(`להעביר את ${selected.name} לארכיון עובדים?`)) return;
        await api.delete(`/workers/${selected.id}`);
        setMessage(`${selected.name} הועברה לארכיון עובדים.`);
      } else {
        await api.patch(`/workers/${selected.id}`, { isActive: true });
        setMessage(`${selected.name} חזרה לרשימת העובדים הפעילים.`);
      }
      setTeamAction(null);
      await loadData();
    } catch {
      setMessage('ביצוע הפעולה נכשל. נסי שוב.');
    } finally {
      setTeamBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {dataError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{dataError}</div>
      )}
      <PageHeader
        eyebrow="THE PEOPLE WHO MAKE SPACE"
        title="הצוות"
        description="האנשים, התפקידים והפרטים שמחזיקים את העבודה יחד."
        action={
          <div className="relative">
            <button
              type="button"
              onClick={() => setTeamMenuOpen((open) => !open)}
              aria-expanded={teamMenuOpen}
              className="inline-flex min-h-10 items-center bg-primary-700 px-4 py-2 text-xs font-semibold text-white hover:bg-primary-800"
            >
              ניהול צוות
            </button>
            {teamMenuOpen && (
              <div className="absolute left-0 top-12 z-30 w-52 border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 text-right shadow-xl">
                <button
                  type="button"
                  onClick={() => {
                    setTeamMenuOpen(false);
                    setMessage('');
                    setIsCreateModalOpen(true);
                  }}
                  className="block w-full px-3 py-2 text-right text-xs hover:bg-[var(--color-surface-muted)]"
                >
                  הוספת והזמנת עובדת
                </button>
                <button type="button" onClick={() => openTeamAction('reinvite')} className="block w-full px-3 py-2 text-right text-xs hover:bg-[var(--color-surface-muted)]">
                  שליחת הזמנה מחדש
                </button>
                <button type="button" onClick={() => openTeamAction('archive')} className="block w-full px-3 py-2 text-right text-xs hover:bg-[var(--color-surface-muted)]">
                  העברה לארכיון
                </button>
                <button type="button" onClick={() => openTeamAction('restore')} className="block w-full px-3 py-2 text-right text-xs hover:bg-[var(--color-surface-muted)]">
                  שחזור מהארכיון
                </button>
              </div>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-3 divide-x divide-x-reverse divide-[var(--color-border)] border-y border-[var(--color-border)]">
        <div className="px-4 py-3">
          <p className="font-display text-2xl font-medium text-[var(--color-calendar-sage)]">{workers.length}</p>
          <p className="mt-1 text-xs text-gray-500">סה״כ עובדים</p>
        </div>
        <div className="px-4 py-3">
          <p className="font-display text-2xl font-medium text-[var(--color-calendar-sage)]">{stats.teamLeads}</p>
          <p className="mt-1 text-xs text-gray-500">ראשי צוות</p>
        </div>
        <div className="px-4 py-3">
          <p className="font-display text-2xl font-medium text-[var(--color-calendar-sage)]">{canEditWages ? `₪${stats.averageWage}` : 'מוסתר'}</p>
          <p className="mt-1 text-xs text-gray-500">שכר שעתי ממוצע</p>
          <p className="text-xs text-gray-500 mt-1">פעילות כרגע: {workers.length}</p>
        </div>
      </div>

      <div className="border-b border-[var(--color-border)] pb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-right"
              placeholder="חיפוש לפי שם או טלפון"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as 'all' | WorkerRole)}
            className="rounded-lg border border-gray-300 bg-[var(--color-surface)] px-3 py-2 text-sm"
          >
            <option value="all">כל התפקידים</option>
            <option value="ראש צוות">ראש צוות</option>
            <option value="עובדת">עובדת</option>
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-5 border-b border-[var(--color-border)]">
          <button
            type="button"
            onClick={() => setWorkersView('active')}
            className={`min-h-10 border-b-2 px-1 py-2 text-xs ${workersView === 'active' ? 'border-primary-700 text-primary-800' : 'border-transparent text-gray-700'}`}
          >
            עובדים פעילים ({workers.length})
          </button>
          <button
            type="button"
            onClick={() => setWorkersView('archive')}
            className={`min-h-10 border-b-2 px-1 py-2 text-xs ${workersView === 'archive' ? 'border-primary-700 text-primary-800' : 'border-transparent text-gray-700'}`}
          >
            ארכיון עובדים ({archivedWorkers.length})
          </button>
        </div>
      </div>

      <div className="overflow-hidden border-y border-[var(--color-border)] bg-[var(--color-surface-muted)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-right">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)]">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600">שם</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600">תפקיד</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600">שכר שעתי</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600 text-center">מע״מ</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600">טלפון</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600">אימייל</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600">פעילות אחרונה</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-500">טוען עובדים...</td>
                </tr>
              ) : (workersView === 'active' ? filteredWorkers : filteredArchivedWorkers).map((worker) => (
                <tr key={worker.id} className="hover:bg-primary-50/40">
                  <td className="px-4 py-3 text-sm font-semibold text-gray-900">
                    {workersView === 'active' ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEditWorker(worker)}
                          className="text-primary-700 hover:text-primary-800 hover:underline underline-offset-2"
                        >
                          {worker.name}
                        </button>
                        <Link
                          href={`/workers/${worker.id}`}
                          className="text-[11px] text-gray-400 hover:text-primary-600"
                        >
                          פרופיל
                        </Link>
                      </div>
                    ) : (
                      worker.name
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{worker.role}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{canEditWages ? `₪${worker.hourlyWage}` : 'מוסתר'}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 text-center">
                    {worker.vatIncluded ? <span className="font-medium text-emerald-700">כן</span> : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{worker.phone}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{worker.email}</td>
                  <td className="px-4 py-3 text-sm">
                    <p className="text-gray-700">{formatActivityTimestamp(worker.lastActivityAt)}</p>
                    {worker.pendingUpdate && (
                      <p className="text-[11px] text-amber-700 mt-1">
                        שינוי מתוזמן: {worker.pendingUpdate.effectiveFrom}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
              {!isLoading && (workersView === 'active' ? filteredWorkers.length : filteredArchivedWorkers.length) === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-500">
                    {workersView === 'active'
                      ? 'לא נמצאו עובדים פעילים לפי החיפוש/סינון.'
                      : 'ארכיון העובדים ריק או שלא נמצאו תוצאות לפי החיפוש/סינון.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingWorkerId && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-xl overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setEditingWorkerId(null)}
                className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                סגירה
              </button>
              <h3 className="text-sm font-semibold text-gray-900">עריכת עובדת</h3>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="text-sm">
                  <span className="text-gray-600">שם פרטי במערכת</span>
                  <input
                    value={editFirstName}
                    onChange={(e) => setEditFirstName(e.target.value)}
                    className="mt-1 w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-right"
                    placeholder="שם פרטי בעברית"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-gray-600">שם משפחה במערכת</span>
                  <input
                    value={editLastName}
                    onChange={(e) => setEditLastName(e.target.value)}
                    className="mt-1 w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-right"
                    placeholder="שם משפחה בעברית"
                  />
                </label>
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-right"
                  placeholder="טלפון"
                />
                <input
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-right"
                  placeholder="אימייל"
                />
                <label className="text-xs text-gray-600">
                  כתובת מגורים
                  <input
                    value={editHomeAddress}
                    onChange={(e) => setEditHomeAddress(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right"
                  />
                </label>
                <label className="text-xs text-gray-600">
                  תאריך לידה
                  <input
                    type="date"
                    value={editBirthday}
                    onChange={(e) => setEditBirthday(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <select value={editRole} onChange={(e) => setEditRole(e.target.value as WorkerRole)} className="rounded-lg border border-gray-300 bg-[var(--color-surface)] px-3 py-2 text-sm">
                  <option value="ראש צוות">ראש צוות</option>
                  <option value="עובדת">עובדת</option>
                </select>
                {canEditWages ? (
                  <select
                    value={editHourlyWage}
                    onChange={(e) => setEditHourlyWage(Number(e.target.value))}
                    className="rounded-lg border border-gray-300 bg-[var(--color-surface)] px-3 py-2 text-sm"
                  >
                    {HOURLY_WAGE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        ₪{option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">שכר מוסתר למשתמש זה</div>
                )}
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={editVatIncluded} onChange={(e) => setEditVatIncluded(e.target.checked)} className="rounded border-gray-300" />
                  כולל מע״מ
                </label>
              </div>
              {canEditWages && (
                <fieldset className="grid grid-cols-2 gap-3 border-y border-[var(--color-border)] py-3">
                  <legend className="px-2 text-xs font-semibold text-gray-700">חשבון בנק</legend>
                  <input value={editBankAccountHolder} onChange={(e) => setEditBankAccountHolder(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="שם בעלת החשבון" />
                  <input value={editBankNumber} onChange={(e) => setEditBankNumber(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="מספר בנק" />
                  <input value={editBankBranch} onChange={(e) => setEditBankBranch(e.target.value.replace(/\D/g, '').slice(0, 5))} inputMode="numeric" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="מספר סניף" />
                  <input value={editBankAccountNumber} onChange={(e) => setEditBankAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 20))} inputMode="numeric" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="מספר חשבון" />
                </fieldset>
              )}
              <div className="rounded-lg border border-gray-200 p-3 bg-gray-50 space-y-2">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={editApplyImmediately}
                    onChange={(e) => setEditApplyImmediately(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  להחיל מיידית (רק אם צוין ספציפית)
                </label>
                <label className="text-xs text-gray-700 space-y-1 block">
                  <span className="block">תוקף השינוי (ברירת מחדל: חודש הבא)</span>
                  <input
                    type="date"
                    value={editEffectiveFrom}
                    onChange={(e) => setEditEffectiveFrom(e.target.value)}
                    disabled={editApplyImmediately}
                    className="w-full rounded-lg border border-gray-300 bg-[var(--color-surface)] px-3 py-2 text-sm disabled:bg-gray-100"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => void saveWorkerUpdate()}
                className="w-full rounded-lg bg-primary-600 text-white px-4 py-2 text-sm font-medium hover:bg-primary-700"
              >
                שמירת שינוי
              </button>
            </div>
          </div>
        </div>
      )}

      {teamAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setTeamAction(null)}>
          <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">
                {teamAction === 'reinvite' ? 'שליחת הזמנה מחדש' : teamAction === 'archive' ? 'העברה לארכיון' : 'שחזור מהארכיון'}
              </h3>
              <button type="button" onClick={() => setTeamAction(null)} className="text-xs text-gray-500">סגירה</button>
            </div>
            <label className="block text-xs text-gray-600">
              עובדת
              <select
                value={teamWorkerId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  const source = teamAction === 'restore' ? archivedWorkers : workers;
                  setTeamWorkerId(nextId);
                  setTeamEmail(source.find((worker) => worker.id === nextId)?.email ?? '');
                }}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-[var(--color-surface)] px-3 py-2 text-sm"
              >
                {(teamAction === 'restore' ? archivedWorkers : workers).map((worker) => (
                  <option key={worker.id} value={worker.id}>{worker.name}</option>
                ))}
              </select>
            </label>
            {teamAction === 'reinvite' && (
              <label className="mt-3 block text-xs text-gray-600">
                אימייל להזמנה
                <input value={teamEmail} onChange={(e) => setTeamEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </label>
            )}
            <button
              type="button"
              onClick={() => void runTeamAction()}
              disabled={teamBusy || !teamWorkerId}
              className="mt-4 w-full rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {teamBusy ? 'מבצעת…' : 'אישור'}
            </button>
          </div>
        </div>
      )}

      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                סגירה
              </button>
              <h3 className="text-sm font-semibold text-gray-900">הוספת עובדת חדשה</h3>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  <span className="text-gray-600">שם פרטי במערכת</span>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    placeholder="שם פרטי בעברית"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-gray-600">שם משפחה במערכת</span>
                  <input
                    type="text"
                    value={newLastName}
                    onChange={(e) => setNewLastName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    placeholder="שם משפחה בעברית"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  <span className="text-gray-600">טלפון</span>
                  <input
                    type="tel"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    placeholder="050-0000000"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-gray-600">אימייל *</span>
                  <input
                    type="email"
                    required
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    placeholder="worker@example.com"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  <span className="text-gray-600">תפקיד</span>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as WorkerRole)}
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-[var(--color-surface)] px-3 py-2 text-sm"
                  >
                    <option value="עובדת">עובדת</option>
                    <option value="ראש צוות">ראש צוות</option>
                  </select>
                </label>
                {canEditWages && (
                  <label className="text-sm">
                    <span className="text-gray-600">שכר שעתי (₪)</span>
                    <select
                      value={newHourlyWage}
                      onChange={(e) => setNewHourlyWage(Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-gray-300 bg-[var(--color-surface)] px-3 py-2 text-sm"
                    >
                      {HOURLY_WAGE_OPTIONS.map((wage) => (
                        <option key={wage} value={wage}>{wage}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <p className="text-xs text-gray-400">לאחר השמירה תישלח לעובדת הזמנה להתחברות.</p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void addWorkerAndSendInvite()}
                  className="flex-1 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
                >
                  הוספת עובדת
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="rounded-lg border border-gray-300 bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-gray-700 hover:bg-[var(--color-surface-muted)]"
                >
                  ביטול
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {message && (
        <p className={`text-sm mt-2 ${message.includes('נוספה ונשלח') || message.includes('נוספה בהצלחה') || message.includes('תוזמן') || message.includes('הוחל') || message.includes('חזרה') || message.includes('הועברה') ? 'text-emerald-700' : 'text-rose-700'}`}>
          {message}
        </p>
      )}
    </div>
  );
}
