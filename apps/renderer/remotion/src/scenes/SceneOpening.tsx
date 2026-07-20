import { AbsoluteFill, interpolate, useCurrentFrame, spring } from 'remotion'
import { COLORS } from '../config'
import { Footer } from './Footer'

export const SceneOpening: React.FC<{ headline: string; source: string; publishedAt: string }> = ({
  headline, source, publishedAt,
}) => {
  const frame = useCurrentFrame()
  const zoom = interpolate(frame, [0, 75], [1.2, 1], { extrapolateRight: 'clamp' })
  const titleOpacity = interpolate(frame, [15, 40], [0, 1])
  const titleSlide = spring({ frame: frame - 20, fps: 60, config: { damping: 12 } })
  const subOpacity = interpolate(frame, [30, 50], [0, 1])
  const glow = interpolate(frame, [0, 75], [0, 1])

  return (
    <AbsoluteFill style={{ background: `linear-gradient(135deg, ${COLORS.bg}, ${COLORS.bg2})` }}>
      {/* Tech grid with zoom */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `
          linear-gradient(rgba(59,130,246,0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(59,130,246,0.04) 1px, transparent 1px)
        `,
        backgroundSize: '40px 40px',
        transform: `scale(${zoom})`,
        opacity: interpolate(frame, [0, 30], [0.3, 0.6]),
      }} />

      {/* Animated particles */}
      {Array.from({ length: 25 }).map((_, i) => (
        <div key={i} style={{
          position: 'absolute',
          width: 2 + (i % 3), height: 2 + (i % 3),
          borderRadius: '50%',
          background: i % 2 === 0 ? COLORS.primary : COLORS.accent,
          opacity: interpolate(frame, [0, 75], [0.1, 0.2 + (i % 5) * 0.05]),
          left: `${5 + (i * 3.8) % 90}%`,
          top: `${10 + (i * 7.3) % 80}%`,
          transform: `translateY(${interpolate(frame, [0, 75], [0, -(20 + i * 3)])}px)`,
        }} />
      ))}

      {/* Title */}
      <div style={{
        position: 'absolute', left: 80, top: 240, right: 80,
        opacity: titleOpacity,
        transform: `translateY(${(1 - titleSlide) * 30}px)`,
      }}>
        <div style={{
          display: 'inline-block',
          background: COLORS.primary,
          padding: '4px 14px', borderRadius: 4,
          fontSize: 13, fontWeight: 700, color: '#fff',
          letterSpacing: 2, marginBottom: 20,
        }}>
          TECHNOLOGY
        </div>
        <div style={{
          fontSize: 72, fontWeight: 800, color: COLORS.text,
          lineHeight: 1.1, letterSpacing: -1,
          fontFamily: 'Inter',
          textShadow: `0 2px 40px rgba(0,0,0,0.3)`,
        }}>
          {headline}
        </div>
      </div>

      {/* Right side visual */}
      <div style={{
        position: 'absolute', right: 60, top: '50%',
        transform: 'translateY(-50%)',
        width: 380, height: 380,
        borderRadius: 24,
        background: `linear-gradient(135deg, ${COLORS.primary}12, ${COLORS.accent}08)`,
        border: `1px solid ${COLORS.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(12px)',
        opacity: interpolate(frame, [10, 35], [0, 1]),
        boxShadow: `0 0 80px ${COLORS.primary}15`,
      }}>
        <div style={{
          width: 120, height: 120, borderRadius: '50%',
          border: `2px solid ${COLORS.primary}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 56, color: `${COLORS.primary}50`,
          animation: 'pulse 3s infinite',
        }}>📡</div>
      </div>

      {/* Glow accent */}
      <div style={{
        position: 'absolute', top: '20%', left: '10%',
        width: 600, height: 600,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${COLORS.primary}06, transparent 70%)`,
        opacity: glow,
      }} />

      <Footer category="TECHNOLOGY" source={source} publishedAt={publishedAt} />
    </AbsoluteFill>
  )
}
