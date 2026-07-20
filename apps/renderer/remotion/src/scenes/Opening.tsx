import { AbsoluteFill, interpolate, useCurrentFrame, spring } from 'remotion'
import { COLORS } from '../config'

export const Opening: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame()
  const scale = interpolate(frame, [0, 30], [1.1, 1], { extrapolateRight: 'clamp' })
  const opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' })
  const logoScale = spring({ frame: frame - 20, fps: 30, config: { damping: 10 } })

  return (
    <AbsoluteFill style={{ background: `linear-gradient(135deg, ${COLORS.bg}, ${COLORS.bg2}, ${COLORS.bg3})` }}>
      {/* Grid */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `linear-gradient(rgba(59,130,246,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.04) 1px, transparent 1px)`,
        backgroundSize: '40px 40px',
        transform: `scale(${scale})`,
      }} />

      {/* Particles */}
      {Array.from({ length: 20 }).map((_, i) => (
        <div key={i} style={{
          position: 'absolute',
          width: 2 + Math.random() * 3,
          height: 2 + Math.random() * 3,
          borderRadius: '50%',
          background: COLORS.primary,
          opacity: 0.3 + Math.random() * 0.3,
          left: `${Math.random() * 100}%`,
          top: `${Math.random() * 100}%`,
          transform: `translateY(${interpolate(frame, [0, 150], [0, -30 + Math.random() * -60])}px)`,
        }} />
      ))}

      {/* Logo */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: `translate(-50%, -50%) scale(${logoScale})`,
        opacity,
        textAlign: 'center',
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: 20,
          background: COLORS.primary, margin: '0 auto 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 36, fontWeight: 800, color: '#fff',
          boxShadow: `0 0 60px ${COLORS.primary}40`,
        }}>T</div>
        <div style={{
          fontSize: 48, fontWeight: 800, color: COLORS.text,
          letterSpacing: 8, fontFamily: 'Inter',
        }}>NEWS TODAY</div>
        <div style={{
          marginTop: 16, height: 3, width: 100,
          background: `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.accent})`,
          margin: '16px auto 0',
          borderRadius: 2,
        }} />
      </div>
    </AbsoluteFill>
  )
}
