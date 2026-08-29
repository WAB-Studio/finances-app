import { z } from "zod";

// Messages are catalogue keys, not sentences: the form translates them, and
// the server re-runs these exact schemas on the same input (RNF-10). The group
// is resolved from the session (RF-55), so it never travels in the payload.
const memberNameSchema = z
  .string()
  .trim()
  .min(1, { error: "members.errors.nameRequired" })
  .max(80, { error: "members.errors.nameTooLong" });

export const createMemberSchema = z.object({
  name: memberNameSchema,
});

export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const updateMemberSchema = z.object({
  memberId: z.uuid(),
  name: memberNameSchema,
});

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

// Accounts no longer hang off a member (RF-61), so archiving one carries no
// per-account decision: it only flags the member.
export const archiveMemberSchema = z.object({
  memberId: z.uuid(),
});

export type ArchiveMemberInput = z.infer<typeof archiveMemberSchema>;

export const restoreMemberSchema = z.object({
  memberId: z.uuid(),
});

export type RestoreMemberInput = z.infer<typeof restoreMemberSchema>;

export const deleteMemberSchema = z.object({
  memberId: z.uuid(),
});

export type DeleteMemberInput = z.infer<typeof deleteMemberSchema>;
