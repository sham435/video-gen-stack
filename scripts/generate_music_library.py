#!/usr/bin/env python3
"""
Batch generate NEWS-MONSTER music library using MusicGen via MLX (Apple Silicon).
Usage (project venv):
  python3.14 -m venv .venv-music
  .venv-music/bin/pip install mlx-audiocraft
  .venv-music/bin/python scripts/generate_music_library.py --output assets/music --count 24
"""
import argparse
import json
import os
import sys
from pathlib import Path

# Import MLX MusicGen (mlx-audiocraft — pip package, NOT mlx-audio which is TTS/STT only)
try:
    from mlx_audiocraft import MusicGen
    import mlx.core as mx
    import numpy as np
    import soundfile as sf
except ImportError as e:
    print(f"Missing dependencies: {e}")
    print("Install: .venv-music/bin/pip install mlx-audiocraft")
    sys.exit(1)

# Mood specs matching MoodAnalyzer categories
CATEGORY_SPECS = {
    "tech_reveal": {
        "mood": "curious",
        "emotion": "wonder",
        "tempo": "medium",
        "bpm": 110,
        "instruments": ["synth pads", "arpeggiator", "orchestral hybrid", "sub bass"],
        "prompt_base": "Original cinematic electronic score, hybrid orchestra and electronic sound design, minimal futuristic pulses, no vocals, strong ending impact."
    },
    "emotional_story": {
        "mood": "emotional",
        "emotion": "nostalgia",
        "tempo": "slow",
        "bpm": 80,
        "instruments": ["piano", "vinyl texture", "ambient guitar", "soft strings"],
        "prompt_base": "Original cinematic lo-fi composition, warm piano, soft vinyl texture, ambient guitar, nostalgic and emotional, suitable for documentary storytelling."
    },
    "shorts_intro": {
        "mood": "urgent",
        "emotion": "excitement",
        "tempo": "fast",
        "bpm": 140,
        "instruments": ["cinematic bass", "percussion hits", "dark synth", "brass stabs"],
        "prompt_base": "Original trailer-style music, fast rising tension, dark cinematic bass, percussion hits, modern short-form video energy, no recognizable melody."
    },
    "luxury_future": {
        "mood": "triumphant",
        "emotion": "awe",
        "tempo": "medium",
        "bpm": 95,
        "instruments": ["deep synth layers", "massive orchestral atmosphere", "sub bass", "choir pads"],
        "prompt_base": "Original futuristic orchestral-scale soundtrack, deep synth layers, massive atmosphere, premium documentary feeling, no recognizable melodies."
    },
    "breaking_news": {
        "mood": "tense",
        "emotion": "urgency",
        "tempo": "fast",
        "bpm": 130,
        "instruments": ["driving percussion", "brass stabs", "mission-control tension", "ostinato strings"],
        "prompt_base": "Original urgent cinematic score, driving percussion, brass stabs, mission-control tension, no vocals."
    },
    "general": {
        "mood": "neutral",
        "emotion": "calm",
        "tempo": "medium",
        "bpm": 100,
        "instruments": ["ambient pads", "light percussion", "subtle piano"],
        "prompt_base": "Original ambient cinematic underscore, neutral and unobtrusive, supports narration without competing."
    }
}

# MoodAnalyzer categories → production MusicFamily keys (MusicFamily.mjs).
# MusicGen tracks drop into the SAME 4 families so pickMusicTrack/_avoidRecent
# work unchanged; indices continue after the existing 48-track mp3 pool.
CATEGORY_FAMILY = {
    "tech_reveal": "cinematic-tech-reveal",
    "emotional_story": "emotional-story",
    "shorts_intro": "action-energy",
    "breaking_news": "action-energy",
    "luxury_future": "luxury-future",
    "general": "cinematic-tech-reveal",
}

MANIFEST_PATH = None  # set from --output
BPM = {s["bpm"] for s in CATEGORY_SPECS.values()}  # unused; kept for clarity

def build_prompt(spec):
    """Build generation prompt matching MusicPromptGenerator.mjs logic"""
    parts = [
        spec["prompt_base"],
        f"Mood: {spec['mood']}, emotional tone: {spec['emotion']}.",
        f"Tempo: {spec['tempo']} (~{spec['bpm']} BPM).",
        f"Instrumentation: {', '.join(spec['instruments'])}.",
        "No copyrighted melody, no sampled material, fully original composition."
    ]
    return " ".join(parts)

def next_track_index(output_dir):
    """Continue after existing nm-track-* files (keeps the mp3 pool intact)."""
    output_dir = Path(output_dir)
    max_idx = 0
    if output_dir.exists():
        for f in output_dir.iterdir():
            m = __import__("re").match(r"nm-track-(\d+)", f.name)
            if m:
                max_idx = max(max_idx, int(m.group(1)))
    return max_idx + 1

def merge_manifest(output_dir, new_entries):
    """Append new wav tracks to assets/music/manifest.json (union with old mp3s)."""
    output_dir = Path(output_dir)
    manifest_path = output_dir / "manifest.json"
    manifest = {}
    if manifest_path.exists():
        try:
            import json as _json
            with open(manifest_path) as fh:
                manifest = _json.load(fh)
        except Exception:
            manifest = {}
    tracks = list(manifest.get("tracks", []))
    tracks.extend(new_entries)
    manifest["engine"] = "newsmonster-musicgen-v2+mlx"
    manifest["total"] = len(tracks)
    manifest["tracks"] = tracks
    with open(manifest_path, "w") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
    print(f"  Manifest: {manifest_path} now has {len(tracks)} tracks")

def generate_tracks(model, specs, output_dir, tracks_per_category, model_size="small", seed=42, duration=30.0):
    """Generate tracks for each category"""
    mx.random.seed(seed)
    
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    sample_rate = getattr(model, "sample_rate", 32000)
    categories = list(specs.keys())
    total = len(categories) * tracks_per_category
    print(f"Generating {total} tracks ({tracks_per_category} per category × {len(categories)} categories) @ {sample_rate}Hz, {duration:.0f}s...")
    
    track_idx = next_track_index(output_dir)
    new_entries = []
    for cat_idx, (category, spec) in enumerate(specs.items()):
        family = CATEGORY_FAMILY[category]
        base_prompt = build_prompt(spec)
        for i in range(tracks_per_category):
            # Add slight variation per track
            variation = ["Variation A", "Variation B", "Variation C", "Variation D"][i % 4]
            prompt = f"{base_prompt} {variation}."
            num = cat_idx * tracks_per_category + i + 1
            
            print(f"  [{num}/{total}] {category} → {family} (idx {track_idx}) - {variation}...")
            
            try:
                # mlx-audiocraft: duration controlled via set_generation_params
                model.set_generation_params(
                    duration=duration,
                    temperature=1.0,
                    top_k=250,
                    cfg_coef=3.0,
                )
                audio = model.generate([prompt], progress=True)
                # audio: list of np arrays, each (channels, samples) — take mono
                wav = np.array(audio[0])
                if wav.ndim == 2:
                    wav = wav[0]  # drop channel dim (mono)
                
                # Normalize to -1 dB peak to avoid clipping
                peak = np.max(np.abs(wav))
                if peak > 0:
                    wav = wav / peak * 0.891  # -1 dB
                
                filename = output_dir / f"nm-track-{track_idx:02d}-{family}.wav"
                sf.write(filename, wav, sample_rate, subtype='PCM_24')
                dur_sec = round(len(wav) / sample_rate, 1)
                new_entries.append({
                    "index": track_idx,
                    "family": family,
                    "bpm": spec["bpm"],
                    "root": None,
                    "file": filename.name,
                    "duration": dur_sec,
                })
                print(f"    → {filename.name} ({dur_sec}s)")
                track_idx += 1
                
            except Exception as e:
                print(f"    ✗ Failed: {e}", flush=True)
    
    if new_entries:
        merge_manifest(output_dir, new_entries)

def main():
    parser = argparse.ArgumentParser(description="Generate NEWS-MONSTER music library with MusicGen (MLX)")
    parser.add_argument("--output", default="assets/music", help="Output directory")
    parser.add_argument("--count", type=int, default=24, help="Total tracks (divided by 6 categories)")
    parser.add_argument("--model", default="small", choices=["small", "medium", "large"], help="MusicGen model size")
    parser.add_argument("--duration", type=float, default=30.0, help="Seconds per track (MusicGen max ~30s)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility")
    parser.add_argument("--dry-run", action="store_true", help="Show prompts without generating")
    args = parser.parse_args()
    
    if args.count % 6 != 0:
        print("Warning: count should be divisible by 6 categories for even distribution")
    
    tracks_per_category = args.count // 6
    
    if args.dry_run:
        for cat, spec in CATEGORY_SPECS.items():
            for i in range(tracks_per_category):
                v = ["A", "B", "C", "D"][i % 4]
                print(f"{cat}-{v}: {build_prompt(spec)} {v}.")
        return
    
    print(f"Loading MusicGen-{args.model} (this may take a moment on first run)...")
    model = MusicGen.get_pretrained(f"facebook/musicgen-{args.model}")
    print("Model loaded.")
    
    generate_tracks(model, CATEGORY_SPECS, args.output, tracks_per_category, args.model, args.seed, args.duration)
    print(f"\n✓ Library generated in {args.output}")

if __name__ == "__main__":
    main()