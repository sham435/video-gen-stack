import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PROFILES = JSON.parse(fs.readFileSync(path.join(__dirname, 'profiles.json'), 'utf-8'))

const PROFILE_BASE = {
  crisp: { sharpen: 1.3, denoise: 0.2, contrast: 1.15, saturation: 1.1 },
  vibrant: { sharpen: 1.5, denoise: 0.1, contrast: 1.25, saturation: 1.3 },
  cinema: { sharpen: 1.0, denoise: 0.35, contrast: 1.2, saturation: 0.92 },
  soft: { sharpen: 0.8, denoise: 0.5, contrast: 1.0, saturation: 1.05 },
  hd: { sharpen: 1.2, denoise: 0.25, contrast: 1.12, saturation: 1.0 },
}

export class EnhancementProfileManager {
  static getCategoryProfile(category) {
    const key = (category || 'default').toLowerCase()
    return PROFILES[key] || PROFILES.default
  }

  static getProfileFor(category) {
    const cat = this.getCategoryProfile(category)
    const base = PROFILE_BASE[cat.profile] || PROFILE_BASE.hd
    return {
      profile: cat.profile,
      sharpen: cat.sharpen ?? base.sharpen,
      denoise: cat.denoise ?? base.denoise,
      contrast: cat.contrast ?? base.contrast,
      saturation: cat.saturation ?? base.saturation,
    }
  }

  static getProfiles() {
    return PROFILES
  }

  static get PROFILE_BASE() { return PROFILE_BASE }
}
