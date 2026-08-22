import type {
  PluginContext,
  RequestContext,
  SendRequest,
  UniversalResponse,
} from "@hyperttp/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RateLimiter, withRateLimit } from "../src/index.js";
import type { RateLimitOptions } from "../src/index.js";

function setup(options: Partial<RateLimitOptions> = {}) {
  const plugin = withRateLimit(options);
  const context = {
    config: { rateLimit: { enabled: true, maxRequests: 10, windowMs: 60_000 } },
    core: {},
  } as unknown as PluginContext;
  plugin.setup?.(context);
  return { plugin, context };
}

const request: SendRequest = { protocol: "rpc", input: { operation: "read" } };
const requestContext: RequestContext = {
  requestId: "test",
  startTime: 0,
  meta: {},
  state: {},
};

function response(overrides: Partial<UniversalResponse> = {}): UniversalResponse {
  return {
    protocol: "rest",
    ok: false,
    status: 429,
    headers: {},
    data: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("protocol-neutral rate-limit callbacks", () => {
  it("uses a request token weight callback", async () => {
    const getRequestWeight = vi.fn(() => 3);
    const wait = vi.spyOn(RateLimiter.prototype, "wait");
    const { plugin } = setup({ getRequestWeight });

    await plugin.onRequest?.(request, undefined, requestContext);

    expect(getRequestWeight).toHaveBeenCalledWith(request, requestContext);
    expect(wait).toHaveBeenCalledWith(3, undefined);
  });

  it("lets custom protocols decide response and error penalties", async () => {
    const getResponsePenalty = vi.fn(() => 750);
    const getErrorPenalty = vi.fn(() => 1250);
    const penalize = vi.spyOn(RateLimiter.prototype, "penalize");
    const { plugin } = setup({ getResponsePenalty, getErrorPenalty });
    const customResponse = response({ protocol: "rpc", status: 7 });
    const error = new Error("busy");

    await plugin.onResponse?.(customResponse, request, undefined, requestContext);
    await plugin.onError?.(error, request, undefined, requestContext);

    expect(getResponsePenalty).toHaveBeenCalledWith(customResponse, request, requestContext);
    expect(getErrorPenalty).toHaveBeenCalledWith(error, request, requestContext);
    expect(penalize).toHaveBeenNthCalledWith(1, 750);
    expect(penalize).toHaveBeenNthCalledWith(2, 1250);
  });

  it("allows a custom decision callback to suppress the REST default", async () => {
    const penalize = vi.spyOn(RateLimiter.prototype, "penalize");
    const { plugin } = setup({ getResponsePenalty: () => false });

    await plugin.onResponse?.(response({ headers: { "retry-after": "9" } }));

    expect(penalize).not.toHaveBeenCalled();
  });
});

describe("REST defaults", () => {
  it("penalizes HTTP 429 responses using Retry-After", async () => {
    const penalize = vi.spyOn(RateLimiter.prototype, "penalize");
    const { plugin } = setup();

    await plugin.onResponse?.(response({ headers: { "Retry-After": "3" } }));

    expect(penalize).toHaveBeenCalledWith(3000);
  });

  it("uses the two-second fallback for HTTP 429 errors", async () => {
    const penalize = vi.spyOn(RateLimiter.prototype, "penalize");
    const { plugin } = setup();
    const restResponse = response();

    await plugin.onError?.({ status: 429, response: restResponse });

    expect(penalize).toHaveBeenCalledWith(2000);
  });

  it("does not apply the HTTP default to a custom protocol status", async () => {
    const penalize = vi.spyOn(RateLimiter.prototype, "penalize");
    const { plugin } = setup();

    await plugin.onResponse?.(response({ protocol: "rpc", status: 429 }));

    expect(penalize).not.toHaveBeenCalled();
  });
});
