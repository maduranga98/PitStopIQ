import { memo } from "react";
import { Play, ExternalLink } from "lucide-react";
import {
  youtubeEmbedUrl,
  youtubeThumbnailUrl,
  youtubeWatchUrl,
} from "../../lib/videoTutorials";

export interface VideoCardData {
  id: string;
  /** 1-based position, shown as a step badge. */
  index: number;
  title: string;
  description: string;
  videoId: string;
}

interface Props {
  videos: VideoCardData[];
  /** Only this card mounts an iframe, so one video plays at a time. */
  playingId: string | null;
  onPlay: (id: string) => void;
  playLabel: string;
  youtubeLabel: string;
}

function VideoCard({
  video, playing, onPlay, playLabel, youtubeLabel,
}: {
  video: VideoCardData;
  playing: boolean;
  onPlay: () => void;
  playLabel: string;
  youtubeLabel: string;
}) {
  return (
    <article className="group border border-white/10 rounded-xl bg-[#162032] overflow-hidden hover:border-[#F97316]/40 transition">
      <div className="relative aspect-video bg-black">
        {playing ? (
          <iframe
            src={youtubeEmbedUrl(video.videoId)}
            title={video.title}
            className="absolute inset-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={onPlay}
            aria-label={`${playLabel} — ${video.title}`}
            className="absolute inset-0 w-full h-full"
          >
            <img
              src={youtubeThumbnailUrl(video.videoId)}
              alt=""
              loading="lazy"
              decoding="async"
              // hqdefault is 4:3 with black bars; cropping keeps the card tidy.
              className="w-full h-full object-cover scale-[1.35] transition duration-300 group-hover:scale-[1.42]"
            />
            <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/20" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="w-12 h-12 rounded-full bg-[#F97316] flex items-center justify-center shadow-lg shadow-black/40 transition group-hover:scale-110">
                <Play className="w-5 h-5 text-white translate-x-[1px]" fill="currentColor" />
              </span>
            </span>
            <span className="absolute top-2 left-2 w-6 h-6 rounded-md bg-black/70 text-[11px] font-bold text-white flex items-center justify-center">
              {video.index}
            </span>
          </button>
        )}
      </div>

      <div className="p-4 space-y-1.5">
        <h3 className="text-sm font-medium text-white leading-snug">{video.title}</h3>
        <p className="text-xs text-gray-400 leading-relaxed">{video.description}</p>
        <a
          href={youtubeWatchUrl(video.videoId)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 pt-1 text-xs text-gray-500 hover:text-[#F97316] transition"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          {youtubeLabel}
        </a>
      </div>
    </article>
  );
}

function VideoTutorials({ videos, playingId, onPlay, playLabel, youtubeLabel }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {videos.map(video => (
        <VideoCard
          key={video.id}
          video={video}
          playing={playingId === video.id}
          onPlay={() => onPlay(video.id)}
          playLabel={playLabel}
          youtubeLabel={youtubeLabel}
        />
      ))}
    </div>
  );
}

export default memo(VideoTutorials);
