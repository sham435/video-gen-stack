import { AbsoluteFill, interpolate, useCurrentFrame, spring } from 'remotion'
import { COLORS } from '../config'

export const Headline: React.FC<{ title: string; source: string; category: string }> = ({ title, source, category }) => {
  const frame = useCurrentFrame()
  const titleSlide = spring({ frame, fps: 30, config: { damping: 12 } })
  const barWidth = interpolate(frame, [0, 20], [0, 4])
  const infoOpacity = interpolate(frame, [20, 35], [0, 1])

  return (
    <AbsoluteFill style={{ background: `linear-gradient(135deg, ${COLORS.bg}, ${COLORS.bg2})` }}>
      {/* Grid */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `linear-gradient(rgba(59,130,246,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.03) 1px, transparent 1px)`,
        backgroundSize: '40px 40px',
      }} />

      {/* Light sweep */}
      <div style={{
        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
        background: `linear-gradient(90deg, transparent 0%, ${COLORS.primary}08 50%, transparent 100%)`,
        transform: `translateX(${interpolate(frame, [0, 150], [-100, 100])}%)`,
      }} />

      {/* Blue accent bar */}
      <div style={{
        position: 'absolute', left: 60, top: 180,
        width: barWidth, height: 80,
        background: COLORS.accent, borderRadius: 2,
      }} />

      {/* Headline */}
      <div style={{
        position: 'absolute', left: 80, top: 180,
        maxWidth: 700,
        transform: `translateY(${(1 - titleSlide) * 40}px)`,
        opacity: titleSlide,
      }}>
        <div style={{
          fontSize: 72, fontWeight: 800, color: COLORS.text,
          lineHeight: 1.1, fontFamily: 'Inter',
          textShadow: '0 2px 20px rgba(0,0,0,0.3)',
        }}>
          {title}
        </div>
      </div>

      {/* Bottom info bar */}
      <div style={{
        position: 'absolute', left: 60, bottom: 80,
        display: 'flex', alignItems: 'center', gap: 16,
        opacity: infoOpacity,
      }}>
        <span style={{ color: COLORS.primary, fontSize: 14, fontWeight: 700, letterSpacing: 2 }}>{category?.toUpperCase()}</span>
        <span style={{ color: COLORS.danger, fontSize: 14, fontWeight: 700, letterSpacing: 2 }}>LIVE</span>
        <span style={{ color: COLORS.textMuted, fontSize: 14 }}>|</span>
        <span style={{ color: COLORS.textMuted, fontSize: 14 }}>July 2026</span>
        <span style={{ color: COLORS.textMuted, fontSize: 14 }}>|</span>
        <span style={{ color: COLORS.accent, fontSize: 14, fontWeight: 600 }}>AI GENERATED</span>
      </div>

      {/* Source */}
      <div style={{
        position: 'absolute', left: 60, bottom: 40,
        opacity: infoOpacity,
        color: COLORS.textMuted, fontSize: 16,
      }}>
        Source: {source}
      </div>

      {/* Right visual placeholder */}
      <div style={{
        position: 'absolute', right: 60, top: '50%',
        transform: 'translateY(-50%)',
        width: 400, height: 400,
        borderRadius: 20,
        background: `linear-gradient(135deg, ${COLORS.primary}15, ${COLORS.accent}08)`,
        border: `1px solid ${COLORS.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(10px)',
        opacity: interpolate(frame, [10, 30], [0, 1]),
      }}>
        <div style={{
          width: 100, height: 100, borderRadius: 24,
          border: `2px solid ${COLORS.primary}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 48, color: `${COLORS.primary}60`,
        }}>📰</div>
      </div>
    </AbsoluteFill>
  )
}
