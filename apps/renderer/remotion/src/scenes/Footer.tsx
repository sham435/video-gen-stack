import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { COLORS } from '../config'

export const Footer: React.FC<{
  category?: string
  source?: string
  publishedAt?: string
  showAttribution?: boolean
}> = ({ category = 'TECHNOLOGY', source, publishedAt, showAttribution = true }) => {
  const frame = useCurrentFrame()
  const opacity = interpolate(frame, [0, 15], [0, 1])

  return (
    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, opacity }}>
      {/* Glass bar */}
      <div style={{
        height: 56,
        background: 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 40px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ color: COLORS.primary, fontSize: 13, fontWeight: 700, letterSpacing: 1.5 }}>{category}</span>
          <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>|</span>
          <span style={{ color: COLORS.danger, fontSize: 12, fontWeight: 700, letterSpacing: 1.5 }}>LIVE</span>
          <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>|</span>
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>{publishedAt || 'Jul 20, 2026'}</span>
          {source && (
            <>
              <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>|</span>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>{source}</span>
            </>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: COLORS.accent, fontSize: 12, fontWeight: 600, letterSpacing: 1 }}>AI SUMMARY</span>
          {showAttribution && (
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>Powered by NewsAPI.org</span>
          )}
        </div>
      </div>
    </div>
  )
}
