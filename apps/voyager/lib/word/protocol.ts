import { z } from "zod";

// Shared with the two route handlers, so the body a client `fetch` sends is
// exactly the body each handler accepts — one schema, not two hand-kept in
// sync. Loaded by client components too, so no `server-only` here
// (docs/TRAPS.md, "server-only resolves under Next and nowhere else").

export const photoRequestSchema = z.object({
  headword: z.string().min(1).max(64),
});
export type PhotoRequest = z.infer<typeof photoRequestSchema>;

export const photoResponseSchema = z.object({
  url: z.url(),
  width: z.int().positive(),
  height: z.int().positive(),
  author: z.string().min(1),
  licence: z.enum(["by", "by-sa", "cc0", "pdm"]),
  licenceUrl: z.url(),
  sourceUrl: z.url(),
});
export type WordPhoto = z.infer<typeof photoResponseSchema>;

export const textRequestSchema = z.object({
  headword: z.string().min(1).max(64),
  needDefinition: z.boolean(),
});
export type TextRequest = z.infer<typeof textRequestSchema>;

export const textResponseSchema = z.object({
  definition: z.string().min(1).nullable(),
  example: z.object({
    en: z.string().min(1),
    es: z.string().min(1),
  }),
});
export type WordText = z.infer<typeof textResponseSchema>;

export const PHOTO_ENDPOINT = "/api/word/photo";
export const TEXT_ENDPOINT = "/api/word/text";
