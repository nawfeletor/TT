# Changelog

All notable changes to Nawfy are documented here.

## [1.0.0] - Initial Release

### Features
- Stream YouTube audio directly via yt-dlp (no browser needed)
- Two-layer audio cache (RAM + disk, 6hr TTL) — repeat plays are instant
- Pre-fetch next track silently while current track plays
- True gapless crossfade between tracks (two audio elements)
- Fade in from silence at track start (configurable 0–10s)
- Position resume for podcasts and long mixes
- 8-band Web Audio API equalizer with 8 presets
- Playback speed control (0.5× – 2×)
- Volume normalisation (Web Audio GainNode ×1.4)
- Synced lyrics from lrclib.net with auto-scroll and click-to-seek
- Cinema / Party mode — full-screen album art with visualizer and lyrics
- Floating always-on-top mini player
- Download audio to disk via yt-dlp (native file dialog)
- Metadata editor — fix title, artist, thumbnail per track
- Track notes — personal notes attached to any track
- BPM tap tempo (T key)
- Smart playlists — auto-update by rules (liked, play count, artist, date)
- Mood presets — Chill, Focus, Energy, Party, Sleep (sets EQ + speed + crossfade)
- Drag-to-reorder playlist tracks
- Multi-column sort (title, duration, date added, play count)
- Keyboard-navigable track list (↑↓ + Enter)
- 10 accent colour themes (Crimson, Violet, Ocean, Forest, Amber, Rose, Copper, Slate, Jade, Bone)
- 7-day listen time chart
- Play history scrobble log
- Alarm clock (plays chosen track at set time)
- Sleep timer with visual countdown bar
- Duplicate detection and one-click removal
- Import / Export library as JSON
- System tray with playback controls
- Global media keys support
- Windows installer (NSIS) + portable build
- Linux AppImage + .deb build
