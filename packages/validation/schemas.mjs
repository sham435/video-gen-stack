import { z } from 'zod'

// Shared request-body schemas. Every POST/PATCH that touches DB writes or paid
// providers validates against these to stop SQL/type pollution and garbage in.

export const generateSchema = z.object({
  modelId: z.string().min(1).max(100),
  prompt: z.string().min(3).max(4000),
  provider: z.enum(['local', 'gemini', 'fal.ai', 'huggingface', 'colab', 'replicate']).optional(),
  duration: z.number().int().min(1).max(120).optional(),
  aspectRatio: z.enum(['16:9', '1:1', '4:5']).optional(),
  imageUrl: z.string().url().optional().or(z.literal('')),
  segments: z.array(z.object({ prompt: z.string().max(1000), duration: z.number().min(0.5).max(30).optional() })).max(10).optional(),
  segmentDuration: z.number().int().min(1).max(60).optional(),
})

export const newsVideoSchema = z.object({
  topic: z.string().min(1).max(300).optional(),
  category: z.string().min(1).max(60).optional().default('technology'),
  duration: z.number().int().min(1).max(120).optional(),
  aspectRatio: z.string().max(20).optional(),
  provider: z.string().max(40).optional(),
})

export const cronJobSchema = z.object({
  name: z.string().min(1).max(100),
  category: z.string().max(60).optional(),
  schedule: z.string().regex(/^[\d*,/ -]+$/, 'invalid cron expression').default('*/30 * * * *'),
})

export const publishSchema = z.object({
  videoUrl: z.string().min(1).max(2000),
  title: z.string().max(300).optional(),
  description: z.string().max(2000).optional(),
  platforms: z.array(z.enum(['tiktok', 'youtube', 'linkedin'])).max(4).optional(),
})

/** Shared middleware: validate req.body against a zod schema */
export function validateBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body', issues: parsed.error.issues })
    }
    req.body = parsed.data
    next()
  }
}