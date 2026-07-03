import {
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  type DocumentReference,
  type DocumentData,
  type SetOptions,
  type WithFieldValue,
  type UpdateData,
  type CollectionReference,
} from "firebase/firestore";
import { usePendingWritesStore } from "../store/pendingWritesSlice";

const { increment, decrement } = usePendingWritesStore.getState();

export async function safeSetDoc<AppModelType, DbModelType extends DocumentData>(
  reference: DocumentReference<AppModelType, DbModelType>,
  data: WithFieldValue<AppModelType>,
  options?: SetOptions,
): Promise<void> {
  increment();
  try {
    if (options) {
      await setDoc(reference, data, options);
    } else {
      await setDoc(reference, data);
    }
  } finally {
    decrement();
  }
}

export async function safeUpdateDoc<AppModelType, DbModelType extends DocumentData>(
  reference: DocumentReference<AppModelType, DbModelType>,
  data: UpdateData<DbModelType>,
): Promise<void> {
  increment();
  try {
    await updateDoc(reference, data);
  } finally {
    decrement();
  }
}

export async function safeAddDoc<AppModelType, DbModelType extends DocumentData>(
  reference: CollectionReference<AppModelType, DbModelType>,
  data: WithFieldValue<AppModelType>,
): Promise<DocumentReference<AppModelType, DbModelType>> {
  increment();
  try {
    return await addDoc(reference, data);
  } finally {
    decrement();
  }
}

export async function safeDeleteDoc(
  reference: DocumentReference<unknown, DocumentData>,
): Promise<void> {
  increment();
  try {
    await deleteDoc(reference);
  } finally {
    decrement();
  }
}
