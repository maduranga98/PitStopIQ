import { doc, serverTimestamp, type Firestore } from "firebase/firestore";
import type { Department, StaffMember } from "../types/auth";
import { staffDisplayName } from "./jobTechnicians";
import { invalidateRefData } from "./refData";
import { safeWriteBatch } from "./firestoreWrite";

/**
 * A department's member list is the source of truth for who's on the team;
 * each member's StaffMember.departmentId/departmentName is a denormalised
 * mirror so job cards and staff lists can show a department without a join.
 * Both writes always go in one batch so the two never drift apart.
 */

/**
 * Drops the staff member from the department roster. If they were the head,
 * the head slot is cleared rather than reassigned — silently promoting
 * someone else to "head" would be a surprising side effect of a removal.
 */
export async function removeStaffFromDepartment(
  db: Firestore,
  centerId: string,
  dept: Department,
  staffId: string,
): Promise<void> {
  const idx = dept.memberStaffIds.indexOf(staffId);
  if (idx === -1) return;
  const wasHead = dept.headStaffId === staffId;
  await safeWriteBatch(`department ${dept.name}`, (batch) => {
    batch.update(doc(db, "servicecenters", centerId, "departments", dept.id), {
      memberStaffIds: dept.memberStaffIds.filter((id) => id !== staffId),
      memberStaffNames: dept.memberStaffNames.filter((_, i) => i !== idx),
      ...(wasHead ? { headStaffId: null, headStaffName: null } : {}),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, "servicecenters", centerId, "staff", staffId), {
      departmentId: null,
      departmentName: null,
    });
  });
  invalidateRefData(centerId, "staff");
}

/** Names the department head. Must already be a member of the department. */
export async function setDepartmentHead(
  db: Firestore,
  centerId: string,
  dept: Department,
  staff: StaffMember | null,
): Promise<void> {
  await safeWriteBatch(`department ${dept.name}`, (batch) => {
    batch.update(doc(db, "servicecenters", centerId, "departments", dept.id), {
      headStaffId: staff?.id ?? null,
      headStaffName: staff ? staffDisplayName(staff) : null,
      updatedAt: serverTimestamp(),
    });
  });
}

/**
 * Moves a staff member to `nextDept` (or out of every department when it is
 * null) from the member's own side — the Employee form and profile assign this
 * way, while the Departments page works from the roster side.
 *
 * Both ends are written in one batch: the old department's roster loses them,
 * the new one gains them, and their denormalised departmentId/Name follows. A
 * no-op returns without a write so saving an unchanged form costs nothing.
 */
export async function assignStaffDepartment(
  db: Firestore,
  centerId: string,
  staff: StaffMember,
  nextDept: Department | null,
  allDepartments: Department[],
): Promise<void> {
  // The roster is the source of truth, so find the current department by
  // membership rather than the mirrored field, which may be stale.
  const current =
    allDepartments.find((d) => d.memberStaffIds.includes(staff.id)) ??
    (staff.departmentId ? allDepartments.find((d) => d.id === staff.departmentId) ?? null : null);
  if ((current?.id ?? null) === (nextDept?.id ?? null)) return;

  const name = staffDisplayName(staff);
  await safeWriteBatch(`department for ${name}`, (batch) => {
    if (current) {
      const idx = current.memberStaffIds.indexOf(staff.id);
      batch.update(doc(db, "servicecenters", centerId, "departments", current.id), {
        memberStaffIds: current.memberStaffIds.filter((id) => id !== staff.id),
        memberStaffNames: current.memberStaffNames.filter((_, i) => i !== idx),
        // Leaving the department vacates the head slot — it is never silently
        // handed to someone else.
        ...(current.headStaffId === staff.id ? { headStaffId: null, headStaffName: null } : {}),
        updatedAt: serverTimestamp(),
      });
    }
    if (nextDept) {
      batch.update(doc(db, "servicecenters", centerId, "departments", nextDept.id), {
        memberStaffIds: [...nextDept.memberStaffIds, staff.id],
        memberStaffNames: [...nextDept.memberStaffNames, name],
        updatedAt: serverTimestamp(),
      });
    }
    batch.update(doc(db, "servicecenters", centerId, "staff", staff.id), {
      departmentId: nextDept?.id ?? null,
      departmentName: nextDept?.name ?? null,
    });
  });
  invalidateRefData(centerId, "staff");
}
