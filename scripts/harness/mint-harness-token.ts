// Lands the one-time token row the harness consumes to mint a session, which is
// the only way back in once a refresh-token family is revoked. Touches nothing
// but the synthetic harness identity. GoTrue verifies `type=magiclink` against
// `auth.users.recovery_token`, while `newestTokenHash` reads `one_time_tokens`,
// so both have to carry the same hash.
import { randomBytes, randomUUID } from "node:crypto";

import { fixtureSql } from "./fixtures";

const email = process.argv[2] ?? "harness@example.invalid";

void (async () => {
  try {
    const [user] = await fixtureSql<{ id: string }[]>`
      select id from auth.users where email = ${email}`;
    if (!user) throw new Error(`no auth.users row for ${email}`);

    const hash = randomBytes(32).toString("hex");

    await fixtureSql`
      update auth.users
      set recovery_token = ${hash}, recovery_sent_at = now(), updated_at = now()
      where id = ${user.id}`;

    await fixtureSql`
      delete from auth.one_time_tokens
      where user_id = ${user.id} and token_type = 'recovery_token'`;

    await fixtureSql`
      insert into auth.one_time_tokens
        (id, user_id, token_type, token_hash, relates_to, created_at, updated_at)
      values
        (${randomUUID()}, ${user.id}, 'recovery_token', ${hash}, ${email}, now(), now())`;

    console.log(`landed a recovery token for ${email} (${user.id})`);
    process.exit(0);
  } catch (error) {
    console.error(`FAILED  ${(error as Error).message}`);
    process.exit(1);
  }
})();
