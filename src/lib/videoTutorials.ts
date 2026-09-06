/**
 * Video walkthroughs shown on the Help & Support page.
 *
 * Every tutorial is recorded in all three app languages, so each entry keeps
 * one YouTube id per language code. The Help page picks the id that matches
 * the active language and falls back to English when a recording is missing.
 *
 * Titles/descriptions are not stored here — they live in the translation files
 * under `help.videos.items.<id>` so each language phrases them naturally.
 */

export type VideoLanguage = "en" | "si" | "ta";

export interface VideoTutorial {
  /** Matches the translation key under `help.videos.items`. */
  id: string;
  /** YouTube video id per language. */
  youtubeIds: Record<VideoLanguage, string>;
}

/** Ordered to follow the setup flow a new service centre actually walks through. */
export const VIDEO_TUTORIALS: readonly VideoTutorial[] = [
  {
    id: "profile",
    youtubeIds: { en: "n2W4Aledb4o", si: "WgQr3zQPebk", ta: "MgPlOt13Kps" },
  },
  {
    id: "staff",
    youtubeIds: { en: "phxz85EhWz4", si: "982yVyhfyis", ta: "DEIMCsQW7K4" },
  },
  {
    id: "customer",
    youtubeIds: { en: "2x9hyaiNlWA", si: "8RCRmOsZqm4", ta: "8WYJJj6UwLQ" },
  },
  {
    id: "vehicle",
    youtubeIds: { en: "AJuW_vTyzzw", si: "Vd-6fj4TNzE", ta: "Vj4XDXP74k8" },
  },
  {
    id: "supplier",
    youtubeIds: { en: "JBOfN0lvEBA", si: "LrNhmb4Hua4", ta: "mt1zJPms37s" },
  },
  {
    id: "inventory",
    youtubeIds: { en: "lMGx4uOBCRc", si: "w-R6ZvIU0dU", ta: "dJRlEzdGHVQ" },
  },
] as const;

const FALLBACK_LANGUAGE: VideoLanguage = "en";

/** Normalises an i18next language tag (e.g. "si-LK") to one we have videos for. */
export function toVideoLanguage(language: string | undefined): VideoLanguage {
  const base = (language ?? "").split("-")[0];
  return base === "si" || base === "ta" ? base : FALLBACK_LANGUAGE;
}

/** YouTube id for a tutorial in the given language, falling back to English. */
export function videoIdFor(video: VideoTutorial, language: VideoLanguage): string {
  return video.youtubeIds[language] || video.youtubeIds[FALLBACK_LANGUAGE];
}

/** Watch page link — used for the "open on YouTube" escape hatch. */
export function youtubeWatchUrl(videoId: string): string {
  return `https://youtu.be/${videoId}`;
}

/**
 * Privacy-friendly embed. `autoplay` is safe because the iframe is only ever
 * mounted after the user clicks the poster.
 */
export function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;
}

/** Poster image. `hqdefault` exists for every video, unlike maxres. */
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}
