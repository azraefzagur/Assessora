import type { Session, Membership } from './types.ts';
declare module 'express-serve-static-core' {
  interface Request {
    session: Session;
    membership?: Membership;
  }
}
export {};
