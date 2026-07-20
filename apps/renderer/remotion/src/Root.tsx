import { Composition, Sequence, useCurrentFrame, interpolate } from 'remotion'
import { SceneOpening } from './scenes/SceneOpening'
import { SceneHeadline } from './scenes/SceneHeadline'
import { SceneComparison } from './scenes/SceneComparison'

const FPS = 60
const SCENE_LENGTH = 5 * FPS
const TOTAL_DURATION = 4 * SCENE_LENGTH

// Transition wrapper
const Scene: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame()
  const inOpacity = interpolate(frame, [0, 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const outOpacity = interpolate(frame, [SCENE_LENGTH - 10, SCENE_LENGTH], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const blur = interpolate(frame, [0, 10], [8, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const outBlur = interpolate(frame, [SCENE_LENGTH - 10, SCENE_LENGTH], [0, 8], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  return (
    <div style={{
      opacity: Math.min(inOpacity, outOpacity),
      filter: `blur(${blur + outBlur}px)`,
      width: '100%', height: '100%',
    }}>
      {children}
    </div>
  )
}

export const TechNews: React.FC<{
  headline?: string
  source?: string
  publishedAt?: string
}> = ({
  headline = 'Apple Replaces Siri With Next-Gen AI in iOS 27',
  source = 'Geeky Gadgets',
  publishedAt = 'Jul 20, 2026',
}) => {
  return (
    <>
      <Sequence from={0} durationInFrames={SCENE_LENGTH}>
        <Scene>
          <SceneOpening headline={headline} source={source} publishedAt={publishedAt} />
        </Scene>
      </Sequence>
      <Sequence from={1 * SCENE_LENGTH} durationInFrames={SCENE_LENGTH}>
        <Scene>
          <SceneHeadline headline={headline} source={source} publishedAt={publishedAt} />
        </Scene>
      </Sequence>
      <Sequence from={2 * SCENE_LENGTH} durationInFrames={SCENE_LENGTH}>
        <Scene>
          <SceneComparison headline={headline} source={source} />
        </Scene>
      </Sequence>
      <Sequence from={3 * SCENE_LENGTH} durationInFrames={SCENE_LENGTH}>
        <Scene>
          <SceneOpening headline={headline} source={source} publishedAt={publishedAt} />
        </Scene>
      </Sequence>
    </>
  )
}

export const Root: React.FC = () => {
  return (
    <Composition
      id="TechNews"
      component={TechNews}
      durationInFrames={TOTAL_DURATION}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{
        headline: 'Apple Replaces Siri With Next-Gen AI',
        source: 'Geeky Gadgets',
        publishedAt: 'Jul 20, 2026',
      }}
    />
  )
}
