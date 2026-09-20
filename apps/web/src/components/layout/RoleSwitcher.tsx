'use client';

import { type AppViewerRole } from '../../lib/viewer-access';
import { useViewerRole, useCanSwitchRole, writeRoleOverride } from '../../lib/use-viewer-role';

// Preview switcher for owners and unconfigured development accounts.
// Delegated admin access is intentionally not exposed in the pilot UI.
export default function RoleSwitcher() {
  const viewerRole = useViewerRole();
  const canSwitch = useCanSwitchRole();

  if (!canSwitch) {
    return null;
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
      <option value="WORKER">עובד/ת (תצוגת עובדת)</option>
    </select>
  );
}
