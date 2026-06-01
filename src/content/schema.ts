import { z } from 'zod';

export const roomSchema = z.object({
  slug: z.enum(['neural', 'tunnel', 'swarm']),
  title: z.string(),
  subtitle: z.string().optional(),
  description: z.string(),
  tags: z.array(z.string()),
  year: z.number().int(),
  accent: z.enum(['cyan', 'purple', 'red']),
  hasAudio: z.boolean(),
  order: z.number().int()
});
