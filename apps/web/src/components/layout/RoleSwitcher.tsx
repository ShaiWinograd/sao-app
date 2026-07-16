'use client';

import { viewerRoleLabel, type AppViewerRole } from '../../lib/viewer-access';
import { useViewerRole, useCanSwitchRole, writeRoleOverride } from '../../lib/use-viewer-role';

// Dev/preview role switcher. Lets an owner (or an unconfigured dev account) view
// the app as owner, admin, or worker. Real staff with an explicit Clerk role
// cannot switch. Selecting WORKER navigates into the worker app; owner/admin go
// to the business dashboard. A real admin/worker just sees their role label.
export default function RoleSwitcher() {
  const viewerRole = useViewerRole();
  const canSwitch = useCanSwitchRole();

  if (!canSwitch) {
    return <p className="text-xs text-gray-500">{viewerRoleLabel(viewerRole)}</p>;
  }

  return (
    <select
      value={viewerRole}
      onChange={(e) => {
        const role = e.target.value as AppViewerRole;
        writeRoleOverride(role);
        window.location.href = role === 'WORKER' ? '/worker' : '/dashboard';
      }}
      title="תצוגת תפקיד (לפיתוח/בדיקה)"
      className="mt-0.5 w-full rounded border border-gray-200 bg-white px-1 py-0.5 text-[11px] text-gray-600"
    >
      <option value="OWNER">בעל/ת עסק (גישה מלאה)</option>
      <option value="ADMIN">מנהל/ת (תצוגת אדמין)</option>
      <option value="WORKER">עובד/ת (תצוגת עובדת)</option>
    </select>
  );
}
