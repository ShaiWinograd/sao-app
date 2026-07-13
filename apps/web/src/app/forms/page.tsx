'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardList, Clock3, Image as ImageIcon, Plus, Settings2 } from 'lucide-react';
import { useAuth } from '@clerk/nextjs';
import { calculateEndShiftSubmissionWindow, mapHebrewEndShiftStatusToApi, requiresManagerNoteForEndShift } from '@workforce/shared';
import { api, authHeaders } from '../../lib/api';
import {
  type EndShiftFormLink,
  type EndShiftFormStatus,
  type EndShiftJobType,
  getCaseNameForCustomerAndDate,
} from '../../lib/case-hub';

type QuestionType = 'yes_no' | 'multi' | 'checkbox' | 'number' | 'short_text' | 'long_text' | 'photo' | 'date';
type Visibility = 'worker' | 'admin' | 'owner';

type FormQuestion = {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  visibility: Visibility;
};

type FormTemplate = {
  id: string;
  jobType: EndShiftJobType;
  title: string;
  questions: FormQuestion[];
};

type ApiShiftOption = {
  shiftId: string;
  workerName: string;
  customerName: string;
  caseName: string;
  shiftDateLabel: string;
  shiftDateKey: string;
  jobType: EndShiftJobType;
  formSubmitted: boolean;
  clockOutAt: string;
};

type ApiJob = {
  id: string;
  date: string;
  plannedEnd?: string | null;
  jobType: 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION';
  customer: { firstName: string; lastName: string };
  case?: { name: string } | null;
  shifts: Array<{
    id: string;
    formStatus: 'NOT_SUBMITTED' | 'SUBMITTED' | 'WAIVED';
    clockOut?: string | null;
    worker: { firstName: string; lastName: string };
  }>;
};

type ApiRecentSubmission = {
  id: string;
  shiftId: string;
  completionStatus: 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'NOT_COMPLETED';
  submittedAt: string;
  managerNote: string | null;
  workerName: string;
  customerName: string;
  caseName: string;
  jobType: 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION';
  shiftDate: string;
};

const initialTemplates: FormTemplate[] = [];

function questionTypeLabel(type: QuestionType) {
  if (type === 'yes_no') return 'כן/לא';
  if (type === 'multi') return 'בחירה מרובה';
  if (type === 'checkbox') return 'תיבת סימון';
  if (type === 'number') return 'מספר';
  if (type === 'short_text') return 'טקסט קצר';
  if (type === 'long_text') return 'טקסט ארוך';
  if (type === 'photo') return 'תמונה';
  return 'תאריך';
}

function visibilityLabel(visibility: Visibility) {
  if (visibility === 'worker') return 'עובדת';
  if (visibility === 'admin') return 'אדמין';
  return 'בעלים';
}

function toDateTimeLocalValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function mapApiSubmissionToLink(submission: ApiRecentSubmission): EndShiftFormLink {
  const status: EndShiftFormStatus =
    submission.completionStatus === 'COMPLETED'
      ? 'הושלם'
      : submission.completionStatus === 'PARTIALLY_COMPLETED'
        ? 'הושלם חלקית'
        : 'חסר מידע';
  const jobType: EndShiftJobType =
    submission.jobType === 'PACKING'
      ? 'אריזה'
      : submission.jobType === 'UNPACKING'
        ? 'פריקה'
        : 'סידור בית';
  return {
    id: submission.id,
    workerName: submission.workerName,
    jobType,
    customerName: submission.customerName,
    caseName: submission.caseName,
    shiftDate: new Date(submission.shiftDate).toLocaleDateString('he-IL'),
    completedAt: new Date(submission.submittedAt).toLocaleString('he-IL'),
    status,
    hasPhotos: false,
    followUp: Boolean(submission.managerNote),
  };
}

export default function FormsPage() {
  const { getToken } = useAuth();
  const [templates, setTemplates] = useState<FormTemplate[]>(initialTemplates);
  const [submissions, setSubmissions] = useState<EndShiftFormLink[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [newQuestionLabel, setNewQuestionLabel] = useState('');
  const [newQuestionType, setNewQuestionType] = useState<QuestionType>('yes_no');
  const [newVisibility, setNewVisibility] = useState<Visibility>('worker');
  const [newRequired, setNewRequired] = useState(true);

  const [submitWorkerName, setSubmitWorkerName] = useState('יעל כהן');
  const [submitCustomerName, setSubmitCustomerName] = useState('');
  const [submitShiftDate, setSubmitShiftDate] = useState('2026-07-05');
  const [submitJobType, setSubmitJobType] = useState<EndShiftJobType>('אריזה');
  const [submitStatus, setSubmitStatus] = useState<EndShiftFormStatus>('הושלם');
  const [submitClockOutAt, setSubmitClockOutAt] = useState(() => toDateTimeLocalValue(new Date()));
  const [submitPhotos, setSubmitPhotos] = useState(false);
  const [submitFollowUp, setSubmitFollowUp] = useState(false);
  const [submitManagerNote, setSubmitManagerNote] = useState('');
  const [selectedApiShiftId, setSelectedApiShiftId] = useState('');
  const [apiShiftOptions, setApiShiftOptions] = useState<ApiShiftOption[]>([]);
  const [apiNotice, setApiNotice] = useState('');
  const [message, setMessage] = useState('');

  const loadShiftOptions = useCallback(async () => {
    try {
      const auth = await authHeaders(getToken);
      const response = await api.get<ApiJob[]>('/jobs', auth);
      const options: ApiShiftOption[] = response.data.flatMap((job) => {
        const customerName = `${job.customer.firstName} ${job.customer.lastName}`.trim();
        const shiftDate = new Date(job.date);
        const shiftDateLabel = shiftDate.toLocaleDateString('he-IL');
        const shiftDateKey = toDateKey(shiftDate);
        const caseName = job.case?.name ?? getCaseNameForCustomerAndDate(customerName, shiftDateLabel);
        const jobType: EndShiftJobType =
          job.jobType === 'PACKING' ? 'אריזה' : job.jobType === 'UNPACKING' ? 'פריקה' : 'סידור בית';
        return job.shifts.map((shift) => ({
          shiftId: shift.id,
          workerName: `${shift.worker.firstName} ${shift.worker.lastName}`.trim(),
          customerName,
          caseName,
          shiftDateLabel,
          shiftDateKey,
          jobType,
          formSubmitted: shift.formStatus === 'SUBMITTED',
          clockOutAt: toDateTimeLocalValue(new Date(shift.clockOut ?? job.plannedEnd ?? job.date)),
        }));
      });
      setApiShiftOptions(options);
      if (!submitCustomerName && options.length > 0) {
        setSubmitCustomerName(options[0].customerName);
      }
      setApiNotice('');
    } catch (error) {
      setApiNotice('לא ניתן למשוך משמרות מהשרת כרגע.');
      console.error('Failed to load shifts for forms submission', error);
    }
  }, [getToken, submitCustomerName]);

  const loadRecentSubmissions = useCallback(async () => {
    try {
      const auth = await authHeaders(getToken);
      const response = await api.get<ApiRecentSubmission[]>('/forms/recent?limit=30', auth);
      const mapped = response.data.map(mapApiSubmissionToLink);
      setSubmissions(mapped);
    } catch (error) {
      console.error('Failed to load recent forms submissions', error);
    }
  }, [getToken]);

  const loadTemplates = useCallback(async () => {
    try {
      const auth = await authHeaders(getToken);
      const response = await api.get<FormTemplate[]>('/forms/templates', auth);
      setTemplates(response.data);
      if (response.data.length > 0) {
        setSelectedTemplateId((prev) => prev || response.data[0].id);
      }
    } catch (error) {
      setTemplates([]);
      setSelectedTemplateId('');
      console.error('Failed to load form templates', error);
    }
  }, [getToken]);

  useEffect(() => {
    void loadTemplates();
    void loadShiftOptions();
    void loadRecentSubmissions();
  }, [loadRecentSubmissions, loadShiftOptions, loadTemplates]);

  useEffect(() => {
    if (!selectedApiShiftId) return;
    const selected = apiShiftOptions.find((item) => item.shiftId === selectedApiShiftId);
    if (!selected) return;
    setSubmitWorkerName(selected.workerName);
    setSubmitCustomerName(selected.customerName);
    setSubmitShiftDate(selected.shiftDateKey);
    setSubmitClockOutAt(selected.clockOutAt);
    setSubmitJobType(selected.jobType);
  }, [selectedApiShiftId, apiShiftOptions]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? templates[0] ?? null,
    [templates, selectedTemplateId],
  );

  const followUpCount = submissions.filter((submission) => submission.followUp).length;

  const addQuestion = () => {
    if (!selectedTemplate) {
      setMessage('אין תבנית זמינה לעדכון כרגע.');
      return;
    }
    const trimmedLabel = newQuestionLabel.trim();
    if (!trimmedLabel) {
      setMessage('יש להזין כותרת לשאלה חדשה.');
      return;
    }
    setTemplates((prev) =>
      prev.map((template) =>
        template.id === selectedTemplate.id
          ? {
              ...template,
              questions: [
                ...template.questions,
                {
                  id: `q-${Date.now()}`,
                  label: trimmedLabel,
                  type: newQuestionType,
                  required: newRequired,
                  visibility: newVisibility,
                },
              ],
            }
          : template,
      ),
    );
    setNewQuestionLabel('');
    setNewQuestionType('yes_no');
    setNewVisibility('worker');
    setNewRequired(true);
    setMessage('השאלה נוספה לתבנית בהצלחה.');
  };

  const submitEndShiftForm = async () => {
    if (!submitWorkerName.trim() || !submitCustomerName.trim()) {
      setMessage('יש לבחור עובדת ולקוח לפני שליחה.');
      return;
    }
    const [year, month, day] = submitShiftDate.split('-');
    if (!year || !month || !day) {
      setMessage('יש לבחור תאריך משמרת תקין.');
      return;
    }
    if (!selectedApiShiftId) {
      setMessage('יש לבחור משמרת קיימת כדי לשמור טופס לשרת.');
      return;
    }
    if (!submitClockOutAt) {
      setMessage('יש להזין זמן יציאה מהמשמרת.');
      return;
    }
    const windowState = calculateEndShiftSubmissionWindow(submitClockOutAt);
    if (!windowState) {
      setMessage('זמן היציאה אינו תקין.');
      return;
    }
    if (windowState.isExpired) {
      setMessage('עברו יותר משעתיים מזמן היציאה. יש לפנות למנהלת לאישור חריג.');
      return;
    }

    const completionStatus = mapHebrewEndShiftStatusToApi(submitStatus);
    const normalizedManagerNote = submitManagerNote.trim();
    if (requiresManagerNoteForEndShift(completionStatus) && !normalizedManagerNote) {
      setMessage('בטופס שהושלם חלקית או חסר מידע חובה להזין הערת מנהלת/עובדת.');
      return;
    }

    const shiftDate = `${day}/${month}/${year}`;
    const caseName = getCaseNameForCustomerAndDate(submitCustomerName, shiftDate);
    try {
      const auth = await authHeaders(getToken);
      await api.post('/forms/submit', {
        shiftId: selectedApiShiftId,
        completionStatus,
        answers: [],
        managerNote:
          normalizedManagerNote ||
          (submitFollowUp ? 'נדרש מעקב' : undefined),
      }, auth);
    } catch (error) {
      setMessage('שמירה לשרת נכשלה. לא נשמר טופס עד לפתרון התקלה.');
      console.error('Failed to submit end-of-shift form to API', error);
      return;
    }

    setMessage(`הטופס נשמר וקושר אוטומטית ל-${caseName}.`);
    setSubmitPhotos(false);
    setSubmitFollowUp(false);
    setSubmitManagerNote('');
    setSubmitStatus('הושלם');
    setSubmitClockOutAt(toDateTimeLocalValue(new Date()));
    setSelectedApiShiftId('');
    await Promise.all([loadRecentSubmissions(), loadShiftOptions()]);
  };

  const customerOptions = useMemo(
    () => Array.from(new Set(apiShiftOptions.map((option) => option.customerName))).sort((a, b) => a.localeCompare(b, 'he')),
    [apiShiftOptions],
  );
  const submissionWindow = useMemo(() => {
    if (!submitClockOutAt) return null;
    return calculateEndShiftSubmissionWindow(submitClockOutAt);
  }, [submitClockOutAt]);
  const minutesRemainingForSubmission = submissionWindow?.remainingMinutes ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">טפסי סיום משמרת</h1>
          <p className="text-sm text-gray-500">ניהול תבניות ושליחה שמקושרת אוטומטית לתיק לקוח.</p>
        </div>
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-800">
          <div>תבניות פעילות: {templates.length}</div>
          <div>טפסים עם מעקב: {followUpCount}</div>
        </div>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold mb-3">שליחת טופס סיום משמרת</h2>
        <div className="grid gap-2 md:grid-cols-4">
          <select value={selectedApiShiftId} onChange={(event) => setSelectedApiShiftId(event.target.value)} className="rounded-xl border border-gray-300 px-3 py-2 text-sm bg-white md:col-span-2">
            <option value="">בחירת משמרת קיימת (מומלץ)</option>
            {apiShiftOptions.map((shift) => (
              <option key={shift.shiftId} value={shift.shiftId} disabled={shift.formSubmitted}>
                {shift.workerName} • {shift.customerName} • {shift.shiftDateLabel} • {shift.jobType}
                {shift.formSubmitted ? ' (טופס כבר הוגש)' : ''}
              </option>
            ))}
          </select>
          <input value={submitWorkerName} onChange={(event) => setSubmitWorkerName(event.target.value)} className="rounded-xl border border-gray-300 px-3 py-2 text-sm text-right" placeholder="שם עובדת" />
          <select value={submitCustomerName} onChange={(event) => setSubmitCustomerName(event.target.value)} className="rounded-xl border border-gray-300 px-3 py-2 text-sm bg-white">
            <option value="" disabled>
              בחירת לקוח
            </option>
            {customerOptions.map((customer) => (
              <option key={customer} value={customer}>
                {customer}
              </option>
            ))}
          </select>
          <input type="date" value={submitShiftDate} onChange={(event) => setSubmitShiftDate(event.target.value)} className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          <label className="inline-flex items-center gap-2 rounded-xl border border-gray-300 px-3 py-2 text-sm">
            <Clock3 className="h-3.5 w-3.5 text-gray-500" />
            <input
              type="datetime-local"
              value={submitClockOutAt}
              onChange={(event) => setSubmitClockOutAt(event.target.value)}
              className="bg-transparent outline-none"
            />
          </label>
          <select value={submitJobType} onChange={(event) => setSubmitJobType(event.target.value as EndShiftJobType)} className="rounded-xl border border-gray-300 px-3 py-2 text-sm bg-white">
            <option value="אריזה">אריזה</option>
            <option value="פריקה">פריקה</option>
            <option value="סידור בית">סידור בית</option>
          </select>
          <select value={submitStatus} onChange={(event) => setSubmitStatus(event.target.value as EndShiftFormStatus)} className="rounded-xl border border-gray-300 px-3 py-2 text-sm bg-white">
            <option value="הושלם">הושלם</option>
            <option value="הושלם חלקית">הושלם חלקית</option>
            <option value="חסר מידע">חסר מידע</option>
          </select>
          <label className="inline-flex items-center gap-2 rounded-xl border border-gray-300 px-3 py-2 text-sm">
            <input type="checkbox" checked={submitPhotos} onChange={(event) => setSubmitPhotos(event.target.checked)} />
            כולל תמונות
          </label>
          <label className="inline-flex items-center gap-2 rounded-xl border border-gray-300 px-3 py-2 text-sm">
            <input type="checkbox" checked={submitFollowUp} onChange={(event) => setSubmitFollowUp(event.target.checked)} />
            דורש מעקב
          </label>
          <input
            value={submitManagerNote}
            onChange={(event) => setSubmitManagerNote(event.target.value)}
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm md:col-span-2"
            placeholder="הערת מנהלת/עובדת (חובה בהשלמה חלקית או חסר מידע)"
          />
          <button type="button" onClick={submitEndShiftForm} className="inline-flex items-center justify-center gap-1 rounded-lg bg-primary-600 px-3 py-2 text-xs font-medium text-white hover:bg-primary-700">
            <Plus className="w-3.5 h-3.5" />
            שליחת טופס וקישור לתיק
          </button>
        </div>
        {minutesRemainingForSubmission !== null && (
          <div
            className={`mt-2 rounded-lg border px-3 py-2 text-xs ${
              minutesRemainingForSubmission < 0
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : minutesRemainingForSubmission <= 30
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {minutesRemainingForSubmission < 0
              ? 'חלון השליחה (שעתיים מהיציאה) פג. נדרש אישור מנהלת.'
              : `נותרו ${minutesRemainingForSubmission} דקות לשליחת הטופס במסגרת חלון השעתיים.`}
          </div>
        )}
        {apiNotice ? <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{apiNotice}</div> : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm lg:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <Settings2 className="w-4 h-4 text-gray-500" />
            <h2 className="text-lg font-semibold">בונה תבניות</h2>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => setSelectedTemplateId(template.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  selectedTemplate?.id === template.id
                    ? 'border-primary-300 bg-primary-50 text-primary-700'
                    : 'border-gray-200 bg-white text-gray-700'
                }`}
              >
                {template.jobType}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-gray-500 border-b border-gray-100">
                  <th className="px-2 py-2 font-medium">שאלה</th>
                  <th className="px-2 py-2 font-medium">סוג</th>
                  <th className="px-2 py-2 font-medium">חובה</th>
                  <th className="px-2 py-2 font-medium">גלוי ל</th>
                </tr>
              </thead>
              <tbody>
                {(selectedTemplate?.questions ?? []).map((question) => (
                  <tr key={question.id} className="border-b border-gray-50 last:border-b-0">
                    <td className="px-2 py-2">{question.label}</td>
                    <td className="px-2 py-2">{questionTypeLabel(question.type)}</td>
                    <td className="px-2 py-2">{question.required ? 'כן' : 'לא'}</td>
                    <td className="px-2 py-2">{visibilityLabel(question.visibility)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-4">
            <input value={newQuestionLabel} onChange={(event) => setNewQuestionLabel(event.target.value)} placeholder="כותרת שאלה" className="rounded-xl border border-gray-300 px-3 py-2 text-sm md:col-span-2" />
            <select value={newQuestionType} onChange={(event) => setNewQuestionType(event.target.value as QuestionType)} className="rounded-xl border border-gray-300 px-3 py-2 text-sm">
              <option value="yes_no">כן/לא</option>
              <option value="multi">בחירה מרובה</option>
              <option value="checkbox">תיבת סימון</option>
              <option value="number">מספר</option>
              <option value="short_text">טקסט קצר</option>
              <option value="long_text">טקסט ארוך</option>
              <option value="photo">תמונה</option>
              <option value="date">תאריך</option>
            </select>
            <select value={newVisibility} onChange={(event) => setNewVisibility(event.target.value as Visibility)} className="rounded-xl border border-gray-300 px-3 py-2 text-sm">
              <option value="worker">עובדת</option>
              <option value="admin">אדמין</option>
              <option value="owner">בעלים</option>
            </select>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={newRequired} onChange={(event) => setNewRequired(event.target.checked)} />
              שדה חובה
            </label>
            <button type="button" onClick={addQuestion} className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700">
              <Plus className="w-3.5 h-3.5" />
              הוספת שאלה
            </button>
          </div>
        </article>

        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <ClipboardList className="w-4 h-4 text-gray-500" />
            <h2 className="text-lg font-semibold">הגשות אחרונות</h2>
          </div>
          <div className="space-y-3">
            {submissions.slice(0, 8).map((submission) => (
              <div key={submission.id} className="rounded-xl border border-gray-200 p-3">
                <div className="text-sm font-semibold text-gray-900">{submission.workerName}</div>
                <div className="text-xs text-gray-600">
                  {submission.jobType} • {submission.customerName}
                </div>
                <div className="text-xs text-gray-500">{submission.caseName}</div>
                <div className="text-xs text-gray-600">תאריך משמרת: {submission.shiftDate}</div>
                <div className="text-xs text-gray-600">הוגש: {submission.completedAt}</div>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1">{submission.status}</span>
                  {submission.hasPhotos ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-blue-700">
                      <ImageIcon className="w-3 h-3" />
                      כולל תמונות
                    </span>
                  ) : null}
                  {submission.followUp ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">נדרש מעקב</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">
                      <CheckCircle2 className="w-3 h-3" />
                      ללא מעקב
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      {message ? <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">{message}</div> : null}
    </div>
  );
}
