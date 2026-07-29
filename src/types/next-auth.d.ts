import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    id: string;
    sessionVersion: number;
  }

  interface Session {
    user: { id: string };
    sessionVersion: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** Session version captured at login; compared against the account file per request. */
    sv?: number;
  }
}

export type { DefaultSession };
