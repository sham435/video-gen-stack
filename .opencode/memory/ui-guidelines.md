# UI/UX Design Guidelines

## Design System

### Colors
- **Brand Red**: `#E10600` — Primary accent, breaking banners, CTAs
- **Brand Cyan**: `#00E5FF` — Secondary accent, highlights, borders
- **Brand Gold**: `#FFD700` — Tertiary accent, premium indicators
- **Background**: `#050505` — Near-black (video) / `#0a0a0a` (dashboard)
- **Text Primary**: `#FFFFFF` — Main content
- **Text Secondary**: `rgba(255,255,255,0.7)` — Supporting text

### Category Colors
Each of the 13 categories has a unique color palette defined in `design-system/tokens/colors.json`. Example:
- Gaming: Electric purple/cyan
- AI: Neon blue/magenta  
- Cybersecurity: Red/dark blue
- Space: Deep blue/silver

### Typography
| Usage | Font | Weight | Size |
|-------|------|--------|------|
| Hero headline | Anton | 900 | 130px |
| Breaking banner | Anton | 900 | 120px |
| Caption (video) | Inter | 800 | 52px |
| Body text | Inter | 600 | 42px |
| Badge/ticker | Inter | 600 | 28px |

### Safe Areas
- Video frame: 1080x1920
- Text safe zone: 90% width center (972px)
- Banner vertical: 15% from top
- Footer: 5% from bottom

## Dashboard UI Patterns

### AI Command Center (`/`)
- Dark theme with neon accents
- Cards with glass-morphism effect
- Auto-refresh every 15 seconds
- Priority badges: High (red), Medium (gold), Low (cyan)

### Video Studio (`/studio`)
- Queue view with status badges
- Session detail panel on selection
- Status state machine: Generated → Ready for Review → Editing → Approved → Published
- Analyzer panel with per-scene scoring

### Engineering Intelligence (`/engineering`)
- PR review card with score (0-100)
- Release notes timeline
- Technical debt list with priority sort
- Repository health radar chart

## Video Overlay Components

### BreakingBanner
- Red banner at 15% from top
- "BREAKING" in 120px Anton, white
- Subtitle text in 72px Anton, red
- Glow effect on text, scanlines on banner

### HeadlineCard
- Article title in 72px, gradient overlay
- Bottom-aligned at 60% of frame
- Fade-in with camera push

### DynamicCaption
- Word-by-word highlight (52px Inter, white)
- Active word in cyan (`#00E5FF`)
- Centered at 60% frame height

### DataPanel
- Semi-transparent dark panel with cyan border
- Stats/numbers in bold gold
- Animated counter effect on load

### NewsTicker
- Bottom scroll: "LIVE · HEADLINE · HEADLINE ·"
- Red separator dots
- Continuous horizontal scroll

## Animation Guidelines
- Transitions: 300-500ms
- Motions: purposeful, support narrative
- Glitch effects: use sparingly (5% chance per frame)
- Particle effects: for transitions only
- Shake: 2-3 frames max