import { useEffect, useState, useCallback, useRef } from "react";
import {
  enqueuePhoto as enqueue,
  processQueue,
  getPendingCount,
  clearCompleted,
} from "../lib/photoUploadQueue";
import type { QueuedUpload } from "../lib/photoUploadQueue";

export function usePhotoUploadQueue() {
  const [pendingCount, setPendingCount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);

  const refreshCount = useCallback(async () => {
    try {
      const count = await getPendingCount();
      setPendingCount(count);
    } catch { /* silent */ }
  }, []);

  const process = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);
    try {
      await processQueue();
      await clearCompleted();
      await refreshCount();
    } catch { /* silent */ }
    processingRef.current = false;
    setIsProcessing(false);
  }, [refreshCount]);

  useEffect(() => {
    refreshCount();

    const onOnline = () => { process(); };
    window.addEventListener("online", onOnline);

    if (navigator.onLine) {
      process();
    }

    return () => {
      window.removeEventListener("online", onOnline);
    };
  }, [process, refreshCount]);

  const enqueuePhoto = useCallback(
    async (item: Omit<QueuedUpload, "id" | "attempts" | "status">) => {
      const id = await enqueue(item);
      await refreshCount();
      return id;
    },
    [refreshCount],
  );

  return { pendingCount, isProcessing, enqueuePhoto, processQueue: process };
}
