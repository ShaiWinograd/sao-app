'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Briefcase, Check, Mail, MessageCircle, Plus, Search, Users, Wallet } from 'lucide-react';
import { canViewSensitiveFinancials } from '../../lib/viewer-access';
import { useViewerRole } from '../../lib/use-viewer-role';
import { api } from '../../lib/api';

type WorkerRole = 'ראש צוות' | 'עובדת';

type Worker = {
  id: string;
  name: string;
  role: WorkerRole;
  hourlyWage: number;
  vatIncluded: boolean;
  phone: string;
  email: string;
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
    name: `${worker.firstName} ${worker.lastName}`.trim(),
    role: mapSkillsToRole(worker.skills),
    hourlyWage: 0,
    vatIncluded: false,
    phone: worker.phone,
    email: worker.email,
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
  const [editRole, setEditRole] = useState<WorkerRole>('עובדת');
  const [editHourlyWage, setEditHourlyWage] = useState(60);
  const [editVatIncluded, setEditVatIncluded] = useState(false);
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editApplyImmediately, setEditApplyImmediately] = useState(false);
  const [editEffectiveFrom, setEditEffectiveFrom] = useState(firstDayOfNextMonthDateKey());
  const [linkEmail, setLinkEmail] = useState('');
  const [linkMsg, setLinkMsg] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    setIsLoading(true);
    setDataError('');
    try {
      const res = await api.get<ApiWorker[]>('/workers');
      setWorkers(res.data.map(mapApiWorker));
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
    if (!firstName) {
      setMessage('יש להזין שם פרטי.');
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
      await api.post('/workers', {
        firstName,
        lastName: newLastName.trim(),
        phone: newPhone.trim(),
        email,
        hourlyWage: wage,
        dailyPaymentAmount: wage * 8,
        paymentMethod: 'BANK_TRANSFER',
        skills: mapRoleToSkills(newRole, []),
      });
      setIsCreateModalOpen(false);
      setNewName('');
      setNewLastName('');
      setNewPhone('');
      setNewEmail('');
      setNewRole('עובדת');
      setNewHourlyWage(70);
      setMessage('העובדת נוספה בהצלחה.');
      await loadData();
    } catch {
      setMessage('הוספת העובדת נכשלה. ייתכן שהאימייל כבר קיים במערכת.');
    }
  };

  const openEditWorker = (worker: Worker) => {
    setEditingWorkerId(worker.id);
    setEditRole(worker.role);
    setEditHourlyWage(worker.hourlyWage);
    setEditVatIncluded(worker.vatIncluded);
    setEditPhone(worker.phone);
    setEditEmail(worker.email);
    setEditApplyImmediately(false);
    setEditEffectiveFrom(firstDayOfNextMonthDateKey());
    setLinkEmail(worker.email);
    setLinkMsg(null);
    setMessage('');
  };

  const saveWorkerUpdate = async () => {
    if (!editingWorkerId) return;
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
      phone: editPhone.trim(),
      email: editEmail.trim(),
      skills: updatedSkills,
    };
    if (canEditWages) {
      patchBody.hourlyWage = editHourlyWage;
    }

    try {
      await api.patch(`/workers/${editingWorkerId}`, patchBody);
      setWorkers((prev) =>
        prev.map((worker) => {
          if (worker.id !== editingWorkerId) return worker;
          if (editApplyImmediately) {
            return {
              ...worker,
              role: editRole,
              hourlyWage: canEditWages ? editHourlyWage : worker.hourlyWage,
              vatIncluded: editVatIncluded,
              phone: editPhone.trim(),
              email: editEmail.trim(),
              skills: updatedSkills,
              lastActivityAt: new Date().toISOString(),
              pendingUpdate: undefined,
            };
          }
          return {
            ...worker,
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

  const linkLogin = async () => {
    if (!editingWorkerId) return;
    const email = linkEmail.trim();
    if (!isValidEmail(email)) {
      setLinkMsg('כתובת האימייל לא תקינה.');
      return;
    }
    setLinkBusy(true);
    setLinkMsg(null);
    try {
      const res = await api.post<{ linked: boolean; pendingFirstLogin?: boolean }>(
        `/workers/${editingWorkerId}/link-login`,
        { email },
      );
      setLinkMsg(
        res.data.linked
          ? 'החשבון קושר בהצלחה. המשתמשת תתחבר כעובדת.'
          : 'אין עדיין חשבון עם אימייל זה — הקישור יתבצע אוטומטית בהתחברות הראשונה.',
      );
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setLinkMsg(status === 409 ? 'האימייל כבר משויך לעובדת אחרת.' : 'הקישור נכשל. נסי שוב.');
    } finally {
      setLinkBusy(false);
    }
  };

  const moveWorkerToArchive = async (workerId: string) => {
    const workerToArchive = workers.find((worker) => worker.id === workerId);
    if (!workerToArchive) return;
    if (!window.confirm(`להעביר את ${workerToArchive.name} לארכיון עובדים?`)) return;
    try {
      await api.delete(`/workers/${workerId}`);
      setWorkers((prev) => prev.filter((worker) => worker.id !== workerId));
      setArchivedWorkers((prev) => [workerToArchive, ...prev]);
      setMessage(`${workerToArchive.name} הועברה לארכיון עובדים.`);
    } catch {
      setMessage('ביצוע הפעולה נכשל. ודאי שה-API זמין.');
    }
  };

  const restoreWorkerFromArchive = (workerId: string) => {
    const workerToRestore = archivedWorkers.find((worker) => worker.id === workerId);
    if (!workerToRestore) return;
    if (!window.confirm(`להחזיר את ${workerToRestore.name} מארכיון עובדים לרשימה הפעילה?`)) return;
    setArchivedWorkers((prev) => prev.filter((worker) => worker.id !== workerId));
    setWorkers((prev) => [{ ...workerToRestore, lastActivityAt: new Date().toISOString() }, ...prev]);
    setMessage(`${workerToRestore.name} חזרה לרשימת העובדים הפעילים.`);
  };

  return (
    <div className="space-y-6">
      {dataError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{dataError}</div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">עובדים</h1>
          <p className="text-gray-600 mt-1">ניהול צוות העובדות, תפקידים ושכר שעתי</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setMessage('');
            setIsCreateModalOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          <Plus className="w-4 h-4" />
          עובדת חדשה
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">סה״כ עובדים</p>
            <Users className="w-4 h-4 text-gray-500" />
          </div>
          <p className="text-2xl font-bold text-gray-900 mt-1">{workers.length}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">ראשי צוות</p>
            <Briefcase className="w-4 h-4 text-gray-500" />
          </div>
          <p className="text-2xl font-bold text-gray-900 mt-1">{stats.teamLeads}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">שכר שעתי ממוצע</p>
            <Wallet className="w-4 h-4 text-gray-500" />
          </div>
          <p className="text-2xl font-bold text-gray-900 mt-1">{canEditWages ? `₪${stats.averageWage}` : 'מוסתר'}</p>
          <p className="text-xs text-gray-500 mt-1">פעילות כרגע: {workers.length}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative md:col-span-2">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-300 pr-9 pl-3 py-2 text-sm text-right"
              placeholder="חיפוש לפי שם או טלפון"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as 'all' | WorkerRole)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
          >
            <option value="all">כל התפקידים</option>
            <option value="ראש צוות">ראש צוות</option>
            <option value="עובדת">עובדת</option>
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setWorkersView('active')}
            className={`px-3 py-1.5 text-xs rounded-md ${workersView === 'active' ? 'bg-primary-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
          >
            עובדים פעילים ({workers.length})
          </button>
          <button
            type="button"
            onClick={() => setWorkersView('archive')}
            className={`px-3 py-1.5 text-xs rounded-md ${workersView === 'archive' ? 'bg-primary-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
          >
            ארכיון עובדים ({archivedWorkers.length})
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-right">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600">שם</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600">תפקיד</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600">שכר שעתי</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600 text-center">מע״מ</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600">טלפון</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600">אימייל</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600">פעילות אחרונה</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600">פעולה</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-sm text-gray-500">טוען עובדים...</td>
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
                    {worker.vatIncluded ? <Check className="mx-auto h-4 w-4 text-emerald-600" /> : <span className="text-gray-300">—</span>}
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
                  <td className="px-4 py-3 text-sm">
                    {workersView === 'active' ? (
                      <button
                        type="button"
                        onClick={() => void moveWorkerToArchive(worker.id)}
                        className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        העברה לארכיון
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => restoreWorkerFromArchive(worker.id)}
                        className="rounded-md border border-emerald-300 px-2.5 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50"
                      >
                        החזרה לרשימה
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!isLoading && (workersView === 'active' ? filteredWorkers.length : filteredArchivedWorkers.length) === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-sm text-gray-500">
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
          <div className="w-full max-w-xl rounded-lg border border-gray-200 bg-white shadow-xl overflow-hidden">
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
                <select value={editRole} onChange={(e) => setEditRole(e.target.value as WorkerRole)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
                  <option value="ראש צוות">ראש צוות</option>
                  <option value="עובדת">עובדת</option>
                </select>
                {canEditWages ? (
                  <select
                    value={editHourlyWage}
                    onChange={(e) => setEditHourlyWage(Number(e.target.value))}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
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
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white disabled:bg-gray-100"
                  />
                </label>
              </div>
              <div className="rounded-lg border border-gray-200 p-3 space-y-2">
                <p className="text-xs font-semibold text-gray-700">קישור לחשבון התחברות</p>
                <p className="text-[11px] text-gray-500">משייך את פרופיל העובדת לחשבון ההתחברות עם האימייל הזה ומגדיר אותו כעובדת.</p>
                <div className="flex items-center gap-2">
                  <input
                    value={linkEmail}
                    onChange={(e) => setLinkEmail(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-right"
                    placeholder="אימייל ההתחברות"
                  />
                  <button
                    type="button"
                    onClick={() => void linkLogin()}
                    disabled={linkBusy}
                    className="rounded-lg border border-primary-200 text-primary-700 px-3 py-2 text-xs font-medium hover:bg-primary-50 disabled:opacity-50 whitespace-nowrap"
                  >
                    קישור
                  </button>
                </div>
                {linkMsg && <p className="text-[11px] text-gray-600">{linkMsg}</p>}
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

      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl rounded-lg border border-gray-200 bg-white shadow-xl overflow-hidden">
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
                  <span className="text-gray-600">שם פרטי</span>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    placeholder="שם פרטי"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-gray-600">שם משפחה</span>
                  <input
                    type="text"
                    value={newLastName}
                    onChange={(e) => setNewLastName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    placeholder="שם משפחה (רשות)"
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
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
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
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                    >
                      {HOURLY_WAGE_OPTIONS.map((wage) => (
                        <option key={wage} value={wage}>{wage}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <p className="text-xs text-gray-400">
                העובדת נוספת לניהול הצוות. חשבון התחברות לאפליקציה יופק בהמשך.
              </p>
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
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
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
