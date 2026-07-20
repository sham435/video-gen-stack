import { AbsoluteFill, interpolate, useCurrentFrame, spring } from 'remotion'
import { COLORS } from '../config'
import { Footer } from './Footer'

export const SceneComparison: React.FC<{ headline: string; source: string }> = ({ headline, source }) => {
  const frame = useCurrentFrame()
  const vsScale = spring({ frame: Math.max(0, frame - 15), fps: 60, config: { damping: 8 } })
  const leftSlide = spring({ frame: Math.max(0, frame - 5), fps: 60, config: { damping: 14 } })
  const rightSlide = spring({ frame: Math.max(0, frame - 20), fps: 60, config: { damping: 14 } })

  return (
    <AbsoluteFill style={{ background: `linear-gradient(135deg, ${COLORS.bg}, ${COLORS.bg3})` }}>
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `linear-gradient(rgba(59,130,246,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.03) 1px, transparent 1px)`,
        backgroundSize: '40px 40px',
      }} />

      <div style={{ position: 'absolute', top: 80, left: '50%', transform: 'translateX(-50%)' }}>
        <div style={{ fontSize: 14, color: COLORS.primary, letterSpacing: 4, fontWeight: 700, textAlign: 'center', marginBottom: 4 }}>COMPARISON</div>
        <div style={{ height: 2, width: 60, background: COLORS.primary, margin: '0 auto', borderRadius: 1 }} />
      </div>

      {/* VS badge */}
      <div style={{
        position: 'absolute', left: '50%', top: '45%',
        transform: 'translate(-50%, -50%)',
        width: 50, height: 50, borderRadius: '50%',
        background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.accent})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, fontWeight: 800, color: '#fff',
        scale: `${vsScale}`,
        boxShadow: `0 0 40px ${COLORS.primary}50`,
        zIndex: 10,
      }}>VS</div>

      {/* Before */}
      <div style={{
        position: 'absolute', left: 60, top: 180, width: 380,
        opacity: leftSlide, transform: `translateX(${(1 - leftSlide) * -30}px)`,
        padding: 24, borderRadius: 16,
        background: 'rgba(239,68,68,0.06)',
        border: '1px solid rgba(239,68,68,0.15)',
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.textMuted, marginBottom: 20, letterSpacing: 1 }}>iOS 26</div>
        {['Cloud-based Siri', 'Limited context', 'Old UI framework', 'No developer APIs'].map((item, i) => (
          <div key={i} style={{
            padding: '10px 14px', marginBottom: 8,
            background: 'rgba(239,68,68,0.08)',
            borderRadius: 8,
            fontSize: 18, color: COLORS.textMuted,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ color: COLORS.danger }}>✕</span> {item}
          </div>
        ))}
      </div>

      {/* After */}
      <div style={{
        position: 'absolute', right: 60, top: 180, width: 380,
        opacity: rightSlide, transform: `translateX(${(1 - rightSlide) * 30}px)`,
        padding: 24, borderRadius: 16,
        background: 'rgba(16,185,129,0.06)',
        border: '1px solid rgba(16,185,129,0.15)',
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.accent, marginBottom: 20, letterSpacing: 1 }}>iOS 27</div>
        {['Apple Intelligence', 'Context-aware AI', 'Modern UI system', 'Open SDK'].map((item, i) => (
          <div key={i} style={{
            padding: '10px 14px', marginBottom: 8,
            background: 'rgba(16,185,129,0.08)',
            borderRadius: 8,
            fontSize: 18, color: COLORS.text,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ color: COLORS.success }}>✓</span> {item}
          </div>
        ))}
      </div>

      <Footer category="TECHNOLOGY" source={source} />
    </AbsoluteFill>
  )
}
