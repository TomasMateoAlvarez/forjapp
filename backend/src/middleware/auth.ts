import { Request, Response, NextFunction } from "express";
import { getUserByToken } from "../auth/tokens.js";

// Reemplaza a middleware/clientId.ts: si viene un "Authorization: Bearer <token>"
// válido, la identidad la da el usuario autenticado (req.userId / req.clientId
// = String(user.id)) y se ignora cualquier X-Client-Id que mande el cliente.
// Si no viene token, cae al modo legacy: X-Client-Id tal como antes, para no
// romper instalaciones existentes sin cuenta creada.
declare module "express-serve-static-core" {
  interface Request {
    clientId: string;
    userId?: number;
  }
}

export function requireIdentity(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    getUserByToken(token)
      .then((user) => {
        if (!user) {
          res.status(401).json({ error: "Token inválido o expirado" });
          return;
        }
        req.userId = user.id;
        req.clientId = String(user.id);
        next();
      })
      .catch(next);
    return;
  }

  const header = req.header("X-Client-Id");
  if (!header || !header.trim()) {
    res.status(400).json({ error: "Falta el header X-Client-Id (o Authorization: Bearer <token>)" });
    return;
  }
  req.clientId = header.trim();
  next();
}
