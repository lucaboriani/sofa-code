import { defineCollection } from 'astro:content';
import { roomSchema } from './schema';

const rooms = defineCollection({ type: 'data', schema: roomSchema });

export const collections = { rooms };
