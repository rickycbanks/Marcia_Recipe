import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { badRequest, toErrorResponse } from "./errors";
import { logger } from "./logger";
import { assertSameOrigin } from "./authorization/origin";

export const PRIVATE_NO_STORE = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate",
} as const;

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, {
    ...init,
    headers: { ...PRIVATE_NO_STORE, ...(init?.headers ?? {}) },
  });
}

export function jsonError(err: unknown): NextResponse {
  const { status, body } = toErrorResponse(err);
  if (status >= 500) logger.error("API error", { err: String(err) });
  return NextResponse.json(body, { status, headers: PRIVATE_NO_STORE });
}

/**
 * Uniform wrapper for API route handlers: applies CSRF origin validation for
 * mutations, catches thrown AppErrors into safe JSON responses, and marks
 * every response private/no-store. Generic over the route's context shape.
 */
export function apiHandler<C>(
  handler: (request: Request, context: C) => Promise<Response>,
): (request: Request, context: C) => Promise<Response> {
  return async (request, context) => {
    try {
      assertSameOrigin(request);
      return await handler(request, context);
    } catch (err) {
      return jsonError(err);
    }
  };
}

/** Parse and validate a JSON request body against a Zod schema. */
export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw badRequest(result.error.issues[0]?.message ?? "Invalid request body");
  }
  return result.data;
}
