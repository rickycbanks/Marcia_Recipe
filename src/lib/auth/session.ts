import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { audit } from "@/lib/audit/log";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { LOGIN_RATE_LIMIT } from "@/lib/validation/constants";
import { findAccountByUsername, normalizeUsername } from "@/lib/storage/repositories/accounts";
import { verifyPassword, verifyPasswordDummy } from "./passwords";
import { checkRateLimit, clientAddress } from "./rateLimit";

/**
 * Auth.js (next-auth v5) configuration:
 * - Credentials provider, JWT sessions, NO database adapter
 * - the JWT carries ONLY the account id (sub) and sessionVersion (sv)
 * - capabilities are never stored in the token; every protected operation
 *   reloads the account file and re-checks (see authorization/guards.ts).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: getEnv().authSecret,
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login" },
  useSecureCookies: getEnv().APP_ORIGIN?.startsWith("https://") ?? getEnv().NODE_ENV === "production",
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: getEnv().APP_ORIGIN?.startsWith("https://") ?? getEnv().NODE_ENV === "production",
      },
    },
  },
  providers: [
    Credentials({
      name: "Username & password",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        const username = normalizeUsername(String(credentials?.username ?? ""));
        const password = String(credentials?.password ?? "");
        const address = clientAddress(request);

        // Throttle by normalized username AND client address before doing any work.
        const limit = checkRateLimit(
          `login:${username}:${address}`,
          LOGIN_RATE_LIMIT.maxAttempts,
          LOGIN_RATE_LIMIT.windowMs,
        );
        if (!limit.allowed) {
          await audit({ type: "auth.login.throttled", actorAccountId: null, clientAddress: address, detail: { username } });
          return null;
        }

        const account = username ? await findAccountByUsername(username).catch(() => null) : null;
        if (!account) {
          // Uniform timing + generic failure: never reveal whether the username exists.
          await verifyPasswordDummy(password);
          await audit({ type: "auth.login.failure", actorAccountId: null, clientAddress: address, detail: { username } });
          return null;
        }
        if (account.disabledAt !== null) {
          await verifyPasswordDummy(password);
          await audit({ type: "auth.login.failure", actorAccountId: account.id, clientAddress: address, detail: { reason: "disabled" } });
          return null;
        }
        const ok = await verifyPassword(password, account.password);
        if (!ok) {
          await audit({ type: "auth.login.failure", actorAccountId: account.id, clientAddress: address, detail: {} });
          return null;
        }
        await audit({ type: "auth.login.success", actorAccountId: account.id, clientAddress: address, detail: {} });
        return { id: account.id, sessionVersion: account.sessionVersion };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.sv = user.sessionVersion;
      }
      return token;
    },
    session({ session, token }) {
      // The JWT only ever carries the account id (sub) and sessionVersion (sv).
      session.user = { id: token.sub ?? "" } as unknown as typeof session.user;
      session.sessionVersion = typeof token.sv === "number" ? token.sv : -1;
      return session;
    },
  },
  logger: {
    error(error) {
      logger.error("Auth.js error", { name: error.name, message: error.message });
    },
    warn(code) {
      logger.warn("Auth.js warning", { code });
    },
    debug() {},
  },
});
