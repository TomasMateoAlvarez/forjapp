import { Request, Response, NextFunction } from "express";

// Multi-tenancy simple por instalación: cada cliente (web/iOS) genera y
// persiste un client_id propio y lo manda en todas las llamadas. No es
// autenticación (no hay login/password) — solo aísla los datos de cada
// instalación para que un futuro despliegue compartido no mezcle historiales.
declare module "express-serve-static-core" {
  interface Request {
    clientId: string;
  }
}

export function requireClientId(req: Request, res: Response, next: NextFunction) {
  const header = req.header("X-Client-Id");
  if (!header || !header.trim()) {
    return res.status(400).json({ error: "Falta el header X-Client-Id" });
  }
  req.clientId = header.trim();
  next();
}
