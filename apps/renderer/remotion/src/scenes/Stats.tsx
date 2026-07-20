import { AbsoluteFill, interpolate, useCurrentFrame, spring } from 'remotion'
import { COLORS } from '../config'

export const Stats: React.FC = () => {
  const frame = useCurrentFrame()
  const barWidth = interpolate(frame, [30, 90], [0, 75])
  const numberOpacity = interpolate(frame, [20, 40], [0, 1])
  const count = Math.round(interpolate(frame, [20, 80], [0, 75]))

  return (
    <AbsoluteFill style={{ background: `linear-gradient(135deg, ${COLORS.bg2}, ${COLORS.bg})` }}>
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `linear-gradient(rgba(59,130,246,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.03) 1px, transparent 1px)`,
        backgroundSize: '40px 40px',
      }} />

      <div style={{ position: 'absolute', left: 80, top: 120 }}>
        <div style={{ fontSize: 36, fontWeight: 700, color: COLORS.primary, marginBottom: 8 }}>
          Performance
        </div>
        <div style={{ fontSize: 18, color: COLORS.textMuted }}>
          Apple Intelligence Benchmark Results
        </div>
      </div>

      {/* Animated counter */}
      <div style={{
        position: 'absolute', left: 80, top: 260,
        opacity: numberOpacity,
      }}>
        <span style={{ fontSize: 96, fontWeight: 800, color: COLORS.accent, fontFamily: 'Inter' }}>
          {count}%
        </span>
        <div style={{ fontSize: 24, color: COLORS.text, marginTop: 8 }}>
          Faster Processing Speed
        </div>
      </div>

      {/* Bar chart */}
      <div style={{
        position: 'absolute', left: 80, bottom: 120,
        width: 600,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ color: COLORS.textMuted, fontSize: 16 }}>Apple Intelligence</span>
          <span style={{ color: COLORS.accent, fontSize: 16, fontWeight: 700 }}>75%</span>
        </div>
        <div style={{ height: 8, background: COLORS.border, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${barWidth}%`, height: '100%', background: `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.accent})`, borderRadius: 4 }} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20, marginBottom: 6 }}>
          <span style={{ color: COLORS.textMuted, fontSize: 16 }}>Previous Generation</span>
          <span style={{ color: COLORS.textMuted, fontSize: 16, fontWeight: 700 }}>42%</span>
        </div>
        <div style={{ height: 8, background: COLORS.border, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{
            width: `${interpolate(frame, [50, 100], [0, 42])}%`, height: '100%',
            background: COLORS.textMuted, borderRadius: 4, opacity: 0.5,
          }} />
        </div>
      </div>

      {/* Floating card */}
      <div style={{
        position: 'absolute', right: 80, top: 260, width: 280,
        padding: 20, borderRadius: 16,
        background: COLORS.card, border: `1px solid ${COLORS.border}`,
        backdropFilter: 'blur(10px)',
        opacity: interpolate(frame, [40, 55], [0, 1]),
        transform: `translateY(${interpolate(frame, [0, 150], [0, -10])}px)`,
      }}>
        <div style={{ color: COLORS.textMuted, fontSize: 14, marginBottom: 8 }}>ON-DEVICE AI</div>
        <div style={{ color: COLORS.success, fontSize: 20, fontWeight: 700 }}>+78% Efficiency</div>
        <div style={{ color: COLORS.textMuted, fontSize: 14, marginTop: 4 }}>vs cloud-based processing</div>
      </div>
    </AbsoluteFill>
  )
}
