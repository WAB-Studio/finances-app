import { z } from "zod";

// Messages are catalogue keys, not sentences: the form translates them, and
// the server re-runs these exact schemas on the same input (RNF-10).
const memberNameSchema = z
  .string()
  .trim()
  .min(1, { error: "members.errors.nameRequired" })
  .max(80, { error: "members.errors.nameTooLong" });

export const createMemberSchema = z.object({
  fundId: z.uuid(),
  name: memberNameSchema,
});

export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const updateMemberSchema = z.object({
  fundId: z.uuid(),
  memberId: z.uuid(),
  name: memberNameSchema,
});

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

// Archiving a member forces a decision on each of their accounts (RF-12):
// keep the account and pass it to the fund, or archive it alongside them.
export const archiveMemberSchema = z.object({
  fundId: z.uuid(),
  memberId: z.uuid(),
  accounts: z.array(
    z.object({
      accountId: z.uuid(),
      decision: z.enum(["archive", "fund"]),
    }),
  ),
});

export type ArchiveMemberInput = z.infer<typeof archiveMemberSchema>;

export const restoreMemberSchema = z.object({
  fundId: z.uuid(),
  memberId: z.uuid(),
});

export type RestoreMemberInput = z.infer<typeof restoreMemberSchema>;

export const deleteMemberSchema = z.object({
  fundId: z.uuid(),
  memberId: z.uuid(),
});

export type DeleteMemberInput = z.infer<typeof deleteMemberSchema>;
