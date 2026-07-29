import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import type { passwordRecordSchema } from "@/lib/validation/schemas";

interface ScryptOptions {
  N: number;
  r: number;
  p: number;
}

/** The promisified scrypt typing drops the options argument — wrap manually. */
function scrypt(password: string | Buffer, salt: string | Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) =>
      err ? reject(err) : resolve(derivedKey),
    );
  });
}

/** OWASP-recommended scrypt parameters for interactive logins. */
const SCRYPT_PARAMS: ScryptOptions = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export type PasswordRecord = z.infer<typeof passwordRecordSchema>;

export async function hashPassword(password: string): Promise<PasswordRecord> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
  return {
    algo: "scrypt",
    ...SCRYPT_PARAMS,
    salt: salt.toString("base64"),
    hash: derived.toString("base64"),
  };
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  try {
    const salt = Buffer.from(record.salt, "base64");
    const expected = Buffer.from(record.hash, "base64");
    const derived = await scrypt(password, salt, expected.length, {
      N: record.N,
      r: record.r,
      p: record.p,
    });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Verify against a fixed dummy record so login timing does not reveal whether
 * a username exists.
 */
export async function verifyPasswordDummy(password: string): Promise<void> {
  const salt = Buffer.alloc(SALT_BYTES, 7);
  await scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
}
