import { doc, writeBatch, serverTimestamp, type Firestore } from "firebase/firestore";
import type { Department, StaffMember } from "../types/auth";
import { staffDisplayName } from "./jobTechnicians";

/**
 * A department's member list is the source of truth for who's on the team;
 * each member's StaffMember.departmentId/departmentName is a denormalised
 * mirror so job cards and staff lists can show a department without a join.
 * Both writes go in one batch so the two never drift apart.
 */
export async function addStaffToDepartment(
  db: Firestore,
  centerId: string,
  dept: Department,
  staff: StaffMember,
): Promise<void> {
  if (dept.memberStaffIds.includes(staff.id)) return;
  const batch = writeBatch(db);
  batch.update(doc(db, "servicecenters", centerId, "departments", dept.id), {
    memberStaffIds: [...dept.memberStaffIds, staff.id],
    memberStaffNames: [...dept.memberStaffNames, staffDisplayName(staff)],
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, "servicecenters", centerId, "staff", staff.id), {
    departmentId: dept.id,
    departmentName: dept.name,
  });
  await batch.commit();
}

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
  const batch = writeBatch(db);
  const wasHead = dept.headStaffId === staffId;
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
  await batch.commit();
}

/** Names the department head. Must already be a member of the department. */
export async function setDepartmentHead(
  db: Firestore,
  centerId: string,
  dept: Department,
  staff: StaffMember | null,
): Promise<void> {
  await writeBatch(db)
    .update(doc(db, "servicecenters", centerId, "departments", dept.id), {
      headStaffId: staff?.id ?? null,
      headStaffName: staff ? staffDisplayName(staff) : null,
      updatedAt: serverTimestamp(),
    })
    .commit();
}
