import type { HyperPlugin } from "@hyperttp/types";
import { RateLimiter } from "./utils/RateLimiter.js";
import type { RateLimitOptions } from "./types/limiter.js";
declare module "@hyperttp/types" {
    interface HyperClientOptions {
        rateLimit?: RateLimitOptions;
    }
    interface PluginContext {
        rateLimiter?: RateLimiter;
    }
}
export declare function withRateLimit(options?: Partial<RateLimitOptions>): HyperPlugin;
//# sourceMappingURL=plugin.d.ts.map