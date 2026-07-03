import { useState, useRef, useCallback } from "react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../config/firebase";
import { useNetworkStore } from "../store/networkSlice";
import { usePhotoUploadQueue } from "../hooks/usePhotoUploadQueue";
import { compressImage, blobToBase64 } from "../lib/imageCompressor";
import { Camera, Upload, X, CloudOff } from "lucide-react";

interface PhotoMetadata {
  centerId: string;
  serviceId: string;
  type: "inspection" | "paymentSlip" | "vehicle";
  fieldPath: string;
  fieldKey: string;
}

interface OfflineAwarePhotoInputProps {
  storagePath: string;
  metadata: PhotoMetadata;
  onUrl: (url: string) => void;
  label?: string;
  disabled?: boolean;
}

export default function OfflineAwarePhotoInput({
  storagePath,
  metadata,
  onUrl,
  label,
  disabled,
}: OfflineAwarePhotoInputProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isPending, setIsPending] = useState(false);
  const [fileSize, setFileSize] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const status = useNetworkStore((s) => s.status);
  const { enqueuePhoto } = usePhotoUploadQueue();

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;

      try {
        const compressed = await compressImage(file);
        setFileSize(formatSize(compressed.size));

        if (status !== "offline" && navigator.onLine) {
          setUploading(true);
          setProgress(10);

          const storageRef = ref(storage, storagePath);
          setProgress(30);
          await uploadBytes(storageRef, compressed);
          setProgress(70);
          const downloadUrl = await getDownloadURL(storageRef);
          setProgress(100);

          setPreview(downloadUrl);
          setUploading(false);
          onUrl(downloadUrl);
        } else {
          const base64 = await blobToBase64(compressed);
          setPreview(base64);
          setIsPending(true);

          const queueId = await enqueuePhoto({
            storagePath,
            base64Data: base64,
            mimeType: "image/jpeg",
            metadata,
            createdAt: Date.now(),
          });

          onUrl(`pending:${queueId}`);
        }
      } catch {
        setUploading(false);
      }
    },
    [status, storagePath, metadata, onUrl, enqueuePhoto],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleRemove = () => {
    setPreview(null);
    setIsPending(false);
    setFileSize(null);
    setProgress(0);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium text-gray-300">{label}</label>
      )}

      {preview ? (
        <div className="relative inline-block">
          <img
            src={preview}
            alt="Photo preview"
            className="w-32 h-32 object-cover rounded-lg border border-white/10"
          />
          {isPending && (
            <div className="absolute bottom-0 inset-x-0 bg-amber-500/90 text-white text-[10px] text-center py-0.5 rounded-b-lg flex items-center justify-center gap-1">
              <CloudOff className="w-3 h-3" />
              Will upload when online
            </div>
          )}
          {!disabled && (
            <button
              onClick={handleRemove}
              className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center"
            >
              <X className="w-3 h-3 text-white" />
            </button>
          )}
          {fileSize && (
            <span className="block text-[11px] text-gray-500 mt-1">{fileSize}</span>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-white/10 text-gray-300 hover:bg-white/5 transition disabled:opacity-50"
          >
            {uploading ? (
              <>
                <div className="w-4 h-4 border-2 border-[#F97316] border-t-transparent rounded-full animate-spin" />
                <span>{progress}%</span>
              </>
            ) : (
              <>
                <Camera className="w-4 h-4" />
                <span>Take Photo</span>
              </>
            )}
          </button>
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-white/10 text-gray-300 hover:bg-white/5 transition disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            <span>Upload</span>
          </button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        onChange={handleChange}
        className="hidden"
      />
    </div>
  );
}
