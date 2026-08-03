// Make this a module so `declare global` is valid.
export {};

// express-serve-static-core declares:
//   export interface Request<...> extends http.IncomingMessage, Express.Request {}
// Augmenting global Express.Request therefore adds user? to every req object.
declare global {
  namespace Express {
    interface Request {
      /** Populated by requireJwt middleware after successful Bearer token verification */
      user?: {
        userId: string;
        orgId: string | null;
        orgType: "AG" | "AN" | null;
        hubAdmin: boolean;
        /** Fine-grained role assignments (e.g. AG_ADMIN, AN_DISPATCHER). Empty = legacy / unassigned. */
        roles: string[];
      };
    }
  }
}
