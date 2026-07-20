import { AbsoluteFill, interpolate, useCurrentFrame, spring } from 'remotion'
import { COLORS } from '../config'
import { Footer } from './Footer'

export const SceneHeadline: React.FC<{ headline: string; source: string; publishedAt: string }> = ({
  headline, source, publishedAt,
}) => {
  const frame = useCurrentFrame()
  const titleSlide = spring({ frame, fps: 60, config: { damping: 14 } })
  const barWidth = interpolate(frame, [0, 20], [0, 4])
  const infoOpacity = interpolate(frame, [15, 30], [0, 1])

  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${COLORS.bg2}, ${COLORS.bg})` }}>
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `
          linear-gradient(rgba(59,130,246,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(59,130,246,0.03) 1px, transparent 1px)
        `,
        backgroundSize: '40px 40px',
      }} />

      {/* Light sweep */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(90deg, transparent 0%, ${COLORS.primary}06 50%, transparent 100%)`,
        transform: `translateX(${interpolate(frame, [0, 75], [-100, 100])}%)`,
      }} />

      {/* Blue accent bar */}
      <div style={{
        position: 'absolute', left: 60, top: 200,
        width: barWidth, height: 80,
        background: COLORS.accent, borderRadius: 2,
        boxShadow: `0 0 20px ${COLORS.accent}40`,
      }} />

      {/* Headline */}
      <div style={{
        position: 'absolute', left: 80, top: 200, right: 80,
        transform: `translateY(${(1 - titleSlide) * 40}px)`,
        opacity: titleSlide,
      }}>
        <div style={{
          fontSize: 72, fontWeight: 800, color: COLORS.text,
          lineHeight: 1.1, letterSpacing: -0.5,
          maxWidth: 900,
        }}>{headline}</div>
        <div style={{ marginTop: 8, height: 3, width: 80, background: `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.accent})`, borderRadius: 2 }} />
      </div>

      {/* Key points */}
      <div style={{ position: 'absolute', left: 80, bottom: 160, opacity: infoOpacity }}>
        {['AI-first architecture', 'On-device processing', 'New developer APIs'].map((point, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            marginBottom: 12, opacity: interpolate(frame, [20 + i * 8, 30 + i * 8], [0, 1]),
            transform: `translateX(${interpolate(frame, [20 + i * 8, 30 + i * 8], [-20, 0])}px)`,
          }}>
            <span style={{ color: COLORS.success, fontSize: 18 }}>◆</span>
            <span style={{ color: COLORS.text, fontSize: 26, fontWeight: 500 }}>{point}</span>
          </div>
        ))}
      </div>

      <Footer category="TECHNOLOGY" source={source} publishedAt={publishedAt} />
    </AbsoluteFill>
  )
}
