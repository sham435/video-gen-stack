import { AbsoluteFill, interpolate, useCurrentFrame, spring } from 'remotion'
import { COLORS } from '../config'

const oldItems = ['Siri', 'Cloud AI', 'Old UI', 'Limited Context']
const newItems = ['Apple Intelligence', 'On-Device AI', 'Modern UI', 'Context-Aware']

export const Comparison: React.FC = () => {
  const frame = useCurrentFrame()
  const leftSlide = spring({ frame: Math.max(0, frame - 10), fps: 30, config: { damping: 12 } })
  const rightSlide = spring({ frame: Math.max(0, frame - 20), fps: 30, config: { damping: 12 } })

  return (
    <AbsoluteFill style={{ background: `linear-gradient(135deg, ${COLORS.bg}, ${COLORS.bg2})` }}>
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `linear-gradient(rgba(59,130,246,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.03) 1px, transparent 1px)`,
        backgroundSize: '40px 40px',
      }} />

      <div style={{ position: 'absolute', top: 80, left: '50%', transform: 'translateX(-50%)', fontSize: 36, fontWeight: 700, color: COLORS.primary, letterSpacing: 4 }}>
        BEFORE vs AFTER
      </div>

      {/* Left column */}
      <div style={{
        position: 'absolute', left: 80, top: 180, width: 380,
        opacity: leftSlide, transform: `translateX(${(1 - leftSlide) * -40}px)`,
      }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: COLORS.textMuted, marginBottom: 24, letterSpacing: 2 }}>iOS 26</div>
        {oldItems.map((item, i) => (
          <div key={i} style={{
            padding: '14px 20px', marginBottom: 12,
            background: `${COLORS.danger}15`,
            border: `1px solid ${COLORS.danger}30`,
            borderRadius: 10,
            fontSize: 22, color: COLORS.textMuted,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ color: COLORS.danger }}>✕</span> {item}
          </div>
        ))}
      </div>

      {/* VS */}
      <div style={{
        position: 'absolute', left: '50%', top: '50%',
        transform: 'translate(-50%, -50%)',
        width: 60, height: 60, borderRadius: '50%',
        background: COLORS.primary,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 20, fontWeight: 800, color: '#fff',
        opacity: interpolate(frame, [15, 30], [0, 1]),
        boxShadow: `0 0 40px ${COLORS.primary}40`,
      }}>VS</div>

      {/* Right column */}
      <div style={{
        position: 'absolute', right: 80, top: 180, width: 380,
        opacity: rightSlide, transform: `translateX(${(1 - rightSlide) * 40}px)`,
      }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: COLORS.accent, marginBottom: 24, letterSpacing: 2 }}>iOS 27</div>
        {newItems.map((item, i) => (
          <div key={i} style={{
            padding: '14px 20px', marginBottom: 12,
            background: `${COLORS.success}15`,
            border: `1px solid ${COLORS.success}30`,
            borderRadius: 10,
            fontSize: 22, color: COLORS.text,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ color: COLORS.success }}>✓</span> {item}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  )
}
