'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { ArrowRight, MapPin, Clock, CalendarDays, Users, Phone, Navigation, FileText, Star } from 'lucide-react';
import { api, authHeaders } from '../../../../lib/api';
import {
  type WorkerJob,
  jobTypeLabel,
  jobTypeClasses,
  formatTime,
  customerName,
  attendanceBadge,
  missingFormBadge,
} from '../../../../lib/worker';

type ShiftDetail = {
  id: string;
  jobId: string;
  slotId?: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  attendanceStatus: string;
  joinRequestStatus: string;
  formStatus: string;
  actualStart?: string | null;
  actualEnd?: string | null;
  job: WorkerJob & {
    jobNotes?: string | null;
    customer?: { firstName?: string; lastName?: string; phone?: string | null } | null;
  };
};

export default function WorkerShiftDetailPage() {
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : '';
  const { getToken } = useAuth();
  const [shift, setShift] = useState<ShiftDetail | null>(null);
  const [job, setJob] = useState<WorkerJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const auth = await authHeaders(getToken);
        const shiftRes = await api.get<ShiftDetail>(`/shifts/${id}`, auth);
        setShift(shiftRes.data);
        if (shiftRes.data?.jobId) {
          try {
            const jobRes = await api.get<WorkerJob>(`/jobs/${shiftRes.data.jobId}`, auth);
            setJob(jobRes.data);
          } catch {
            /* roster is best-effort */
          }
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, getToken]);

  const isLead = useMemo(() => {
    if (!shift || !job) return false;
    return (job.slots ?? []).some((s) => s.requiredSkill === 'SHIFT_LEADER' && s.filledByShiftId === shift.id);
  }, [shift, job]);

  const roster = useMemo(() => {
    return (job?.shifts ?? [])
      .filter((s) => s.joinRequestStatus === 'APPROVED')
      .map((s) => `${s.worker?.firstName ?? ''} ${s.worker?.lastName ?? ''}`.trim())
      .filter(Boolean);
  }, [job]);

  if (loading) return <p className="text-sm text-gray-400">טוען…</p>;

  if (notFound || !shift) {
    return (
      <div className="max-w-2xl">
        <BackLink />
        <p className="mt-3 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">המשמרת לא נמצאה.</p>
      </div>
    );
  }

  const att = attendanceBadge(shift.attendanceStatus);
  const missingForm = missingFormBadge(shift);
  const address = shift.job.address?.fullAddress ?? '';
  const mapsHref = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;
  const phone = shift.job.customer?.phone;

  return (
    <div className="max-w-2xl space-y-4">
      <BackLink />

      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${jobTypeClasses(shift.job.jobType)}`}>
            {jobTypeLabel(shift.job.jobType)}
          </span>
          {isLead && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              <Star className="w-3.5 h-3.5" />
              ראש צוות
            </span>
          )}
        </div>

        <h1 className="text-lg font-bold text-gray-900">{customerName(shift.job.customer)}</h1>

        <div className="space-y-1.5 text-sm text-gray-700">
          <p className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-gray-400" />
            {new Date(shift.scheduledStart).toLocaleDateString('he-IL', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
          </p>
          <p className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400" />
            {formatTime(shift.scheduledStart)}–{formatTime(shift.scheduledEnd)}
          </p>
          <p className="flex items-start gap-2">
            <MapPin className="w-4 h-4 text-gray-400 mt-0.5" />
            <span>
              {address || 'כתובת תתעדכן'}
              {shift.job.address?.apartmentDetails ? ` · ${shift.job.address.apartmentDetails}` : ''}
            </span>
          </p>
          {isLead && phone && (
            <p className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-gray-400" />
              <a href={`tel:${phone}`} className="text-primary-700 hover:underline">{phone}</a>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {shift.joinRequestStatus === 'PENDING' ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700">ממתין לאישור</span>
          ) : (
            <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${att.className}`}>{att.label}</span>
          )}
          {missingForm && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700">טופס חסר</span>
          )}
        </div>

        {mapsHref && (
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
          >
            <Navigation className="w-3.5 h-3.5" />
            ניווט לכתובת
          </a>
        )}
      </div>

      {/* Access / instructions */}
      {(shift.job.address?.parkingNotes || shift.job.address?.accessNotes || shift.job.address?.elevatorNotes || shift.job.workerVisibleNotes) && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
          <h2 className="text-sm font-semibold text-gray-900">הנחיות</h2>
          {shift.job.workerVisibleNotes && <NoteRow label="הערות לעבודה" value={shift.job.workerVisibleNotes} />}
          {shift.job.address?.parkingNotes && <NoteRow label="חניה" value={shift.job.address.parkingNotes} />}
          {shift.job.address?.accessNotes && <NoteRow label="גישה" value={shift.job.address.accessNotes} />}
          {shift.job.address?.elevatorNotes && <NoteRow label="מעלית" value={shift.job.address.elevatorNotes} />}
        </div>
      )}

      {/* Roster */}
      {roster.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-2">
            <Users className="w-4 h-4 text-gray-400" />
            צוות המשמרת
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {roster.map((name, i) => (
              <span key={i} className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[11px] text-gray-700">{name}</span>
            ))}
          </div>
        </div>
      )}

      {/* Actions (attendance + forms in P3, drop/swap in P4) */}
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-center">
        <FileText className="mx-auto w-5 h-5 text-gray-300" />
        <p className="mt-1.5 text-xs text-gray-500">כניסה/יציאה, טופס סיום ובקשות החלפה יתווספו בשלבים הבאים.</p>
      </div>
    </div>
  );
}

function NoteRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <span className="text-xs font-medium text-gray-500">{label}: </span>
      <span className="text-gray-700">{value}</span>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/worker/calendar" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
      <ArrowRight className="w-4 h-4" />
      חזרה ליומן
    </Link>
  );
}
