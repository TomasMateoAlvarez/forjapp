import type { NextFunction, Request, Response } from "express";

// Express 4 no espera promesas devueltas por un handler: si un handler async
// tira una excepción (o un await rechaza), se pierde en un unhandledRejection
// en vez de llegar al middleware de errores centralizado. Envolver cada
// handler con esto reenvía cualquier rechazo a `next(err)`, igual que ya
// pasaba antes con los `throw` síncronos de node:sqlite.
export function asyncHandler<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Req, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
