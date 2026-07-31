export const PROMPT_VERSION = '1.0.0'

export const CATEGORY_TEMPLATES = {
  technology: `Ultra realistic close-up of futuristic technology,
dramatic cinematic lighting, sleek metallic surfaces,
glowing blue and purple neon accents,
high contrast, 8K quality, shallow depth of field`,

  ai: `Futuristic AI visualization, glowing neural network
nodes floating in dark space, ethereal blue and violet light,
cinematic volumetric lighting, digital particles,
ultra detailed, 8K, high contrast thumbnail style`,

  apple: `Premium product photography style, minimalist
elegant composition, soft dramatic lighting,
sleek metallic and glass surfaces, clean background,
cinematic quality, high-end magazine aesthetic`,

  samsung: `Dynamic product showcase, vibrant AMOLED colors,
sleek modern design, dramatic rim lighting,
deep blacks, high contrast, premium look,
ultra realistic product photography`,

  gaming: `Epic gaming moment, dramatic dynamic lighting,
intense color grading, particle effects,
cinematic composition, bold vibrant palette,
high energy, ultra realistic render quality`,

  security: `Dark dramatic scene, red alert ambiance,
cyber security visual, glowing data streams,
sinister atmospheric lighting,
high contrast, cinematic thriller style`,

  science: `Scientific visualization, clean bright lab environment,
precise detailed macro photography,
blueprint inspired overlay elements,
educational yet dramatic composition`,

  health: `Clean medical professional aesthetic,
soft natural lighting, warm tones,
trustworthy clinical environment,
sharp detailed photography style`,

  business: `Professional corporate aesthetic,
clean geometric composition, premium feel,
warm gold and navy tones,
financial district backdrop, sharp modern`,

  entertainment: `Vibrant entertainment scene, dynamic composition,
festive colorful lighting, crowd energy,
cinematic wide shot, bold typography ready,
high energy thumbnail aesthetic`,

  sports: `Peak action moment frozen in time,
dynamic motion, dramatic stadium lighting,
intense emotion, high speed photography,
cinematic sports broadcast quality`,

  default: `Cinematic high contrast scene,
dramatic lighting, ultra realistic,
professional photography quality,
8K detail, bold colors,
high click-through YouTube thumbnail design`
}

export const PLATFORM_SIZES = {
  youtube: { width: 1280, height: 720, label: 'YouTube Thumbnail' },
  facebook: { width: 1200, height: 630, label: 'Facebook Thumbnail' },
  x: { width: 1600, height: 900, label: 'X/Twitter Thumbnail' },
  linkedin: { width: 1200, height: 627, label: 'LinkedIn Thumbnail' },
  tiktok: { width: 1080, height: 1920, label: 'TikTok Cover', safeTitleY: 'top 30%' },
}

export const STYLE_PRESETS = {
  cinematic: `cinematic lighting, film grain, anamorphic look,
dramatic shadows, rich color grading, movie poster quality`,

  minimal: `clean minimal composition, lots of negative space,
soft even lighting, pastel tones, simple background,
modern minimalist aesthetic`,

  vibrant: `extremely vibrant colors, neon glow effects,
high saturation, punchy contrast, energetic composition,
eye-catching thumbnail style`,

  dark: `dark moody atmosphere, low key lighting,
deep shadows, rim light on subject,
noir aesthetic, dramatic contrast`,

  news: `journalistic photography style, natural lighting,
documentary feel, authentic capture,
news broadcast aesthetic, clean text overlay area`,
}

export function buildPrompt(story, platform, style) {
  const category = (story.category || story.topic || 'default').toLowerCase()
  const scene = CATEGORY_TEMPLATES[category] || CATEGORY_TEMPLATES.default
  const size = PLATFORM_SIZES[platform] || PLATFORM_SIZES.youtube
  const preset = STYLE_PRESETS[style] || STYLE_PRESETS.cinematic

  const lines = [
    `Create a ${size.label.toLowerCase()} for a news video.`,
    ``,
    `Title:`,
    `${story.title}`,
    ``,
    `Category:`,
    `${category}`,
    ``,
    `Scene Description:`,
    scene,
    ``,
    `Style:`,
    preset,
    ``,
    `Requirements:`,
    `- ${size.width}x${size.height} resolution`,
    `- Ultra realistic photography style`,
    `- High contrast for text overlay readability`,
    `- Large area reserved for bold headline text`,
    `- No watermarks or logos`,
    `- Center composition with clear focal point`,
    `- Professional thumbnail quality`,
  ]

  if (size.safeTitleY) {
    lines.push(`- Title safe area: ${size.safeTitleY}`)
  }

  return lines.join('\n')
}

export function computeCacheKey(story, platform, style) {
  const input = [
    story.title || '',
    story.category || story.topic || 'default',
    PROMPT_VERSION,
    style || 'cinematic',
    platform || 'youtube',
  ].join('::')
  return input
}
