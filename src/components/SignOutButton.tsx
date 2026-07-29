"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      type="button"
      className="btn-secondary text-sm"
      onClick={() => {
        // Clear any client-side state, then end the session server-side.
        try {
          localStorage.removeItem("search-index-cache");
        } catch {
          /* ignore */
        }
        void signOut({ callbackUrl: "/" });
      }}
    >
      Sign out
    </button>
  );
}
