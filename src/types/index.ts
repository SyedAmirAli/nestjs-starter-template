// import { Express } from 'express';

/**
 * Prisma returns `@db.BigInt` columns as JS BigInt. Express/Nest JSON responses use
 * `JSON.stringify`, which throws on BigInt unless a `toJSON` hook exists.
 */
 
(BigInt.prototype as any).toJSON = function (this: bigint) {
    const n = Number(this);
    return Number.isSafeInteger(n) ? n : this.toString();
};

declare global {
    type MulterFile = Express.Multer.File;
}
