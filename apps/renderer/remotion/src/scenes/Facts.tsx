import { AbsoluteFill, interpolate, useCurrentFrame, spring } from 'remotion'
import { COLORS } from '../config'

const facts = [
  { icon: '🤖', text: 'Siri becomes AI-first' },
  { icon: '📱', text: 'Runs completely on-device' },
  { icon: '⚡', text: '5x faster response times' },
  { icon: '🔧', text: 'New developer SDK released' },
  { icon: '🧠', text: 'Context-aware intelligence' },
]

export const Facts: React.FC = () => {
  const frame = useCurrentFrame()

  return (
    <AbsoluteFill style={{ background: `linear-gradient(135deg, ${COLORS.bg}, ${COLORS.bg3})` }}>
      {/* Grid */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `linear-gradient(rgba(59,130,246,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.03) 1px, transparent 1px)`,
        backgroundSize: '40px 40px',
      }} />

      <div style={{ position: 'absolute', left: 80, top: 100 }}>
        <div style={{ fontSize: 36, fontWeight: 700, color: COLORS.primary, marginBottom: 40 }}>
          Key Updates
        </div>

        {facts.map((fact, i) => {
          const delay = i * 8
          const slide = spring({ frame: Math.max(0, frame - delay), fps: 30, config: { damping: 14 } })
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 20,
              marginBottom: 28,
              opacity: slide,
              transform: `translateX(${(1 - slide) * 30}px)`,
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: 12,
                background: `${COLORS.primary}20`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22,
              }}>{fact.icon}</div>
              <div style={{
                fontSize: 30, fontWeight: 600, color: COLORS.text,
              }}>
                {fact.text}
              </div>
            </div>
          )
        })}
      </div>

      {/* Progress line */}
      <div style={{
        position: 'absolute', left: 80, bottom: 100,
        width: 200, height: 3,
        background: COLORS.border,
        borderRadius: 2, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${interpolate(frame, [0, 150], [0, 100])}%`,
          background: `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.accent})`,
          borderRadius: 2,
        }} />
      </div>
    </AbsoluteFill>
  )
}
