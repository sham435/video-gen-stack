// SDCPPProvider — local AI hero art via stable-diffusion.cpp (Metal).
//
// Spawns the sd-cli binary to render a prompt → 8-bit PNG on disk, with no
// network, no credits, no watermark. Deterministic via seed (article title
// hash) so identical input re-renders identically.
//
// Env:
//   SDCPP_BIN   path to stable-diffusion.cpp build/bin/sd-cli
//               (default ~/stable-diffusion.cpp/build/bin/sd-cli)
//   SDCPP_MODEL path to an sd-1.5 GGUF (default
//               ~/stable-diffusion.cpp/models/sd1.5_q4_0.gguf)
//
// available() returns false when the binary or model is missing → callers
// fall through to the next hero source (Pexels → SD → FAL), never block.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const HOME = os.homedir()
const DEFAULT_BIN = path.join(HOME, 'stable-diffusion.cpp', 'build', 'bin', 'sd-cli')
const DEFAULT_MODEL = path.join(HOME, 'stable-diffusion.cpp', 'models', 'sd1.5_q4_0.gguf')

export class SDCPPProvider {
  constructor(options = {}) {
    this.bin = options.bin || process.env.SDCPP_BIN || DEFAULT_BIN
    this.model = options.model || process.env.SDCPP_MODEL || DEFAULT_MODEL
    this.timeoutMs = options.timeoutMs || 240000
  }

  available() {
    return fs.existsSync(this.bin) && fs.existsSync(this.model)
  }

  /** argv for sd-cli given a spec — pure for testing. */
  buildArgs({ prompt, negative = '', width = 768, height = 768, seed = 42, steps = 20, cfg = 7.0, outPath }) {
    return [
      '-m', this.model,
      '-p', prompt,
      '-n', negative,
      '-W', String(width),
      '-H', String(height),
      '--steps', String(steps),
      '--cfg-scale', String(cfg),
      '-s', String(seed),
      '--sampling-method', 'euler_a',
      '-o', outPath,
    ]
  }

  /**
   * Render one image. Returns {path, width, height, seed} or null when the
   * binary/model are unavailable or the process fails (never throws).
   */
  generate({ prompt, negative = '', width = 768, height = 768, seed = 42, steps = 20, cfg = 7.0, outPath = path.join(os.tmpdir(), `sd-hero-${Date.now()}.png`) } = {}) {
    if (!prompt || !this.available()) return null
    const args = this.buildArgs({ prompt, negative, width, height, steps, cfg, seed, outPath })
    try {
      execFileSync(this.bin, args, { stdio: 'pipe', timeout: this.timeoutMs })
    } catch { return null }
    try {
      const st = fs.statSync(outPath)
      if (!st.size || st.size < 10 * 1024) return null
    } catch { return null }
    return { path: outPath, width, height, seed }
  }
}