import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// Parchea el prototipo de ZodType con `.openapi(...)`. Se importa por su
// efecto de lado antes que cualquier otro archivo de este directorio use
// `.openapi()` — nunca se importa desde app.ts/index.ts, así que el server
// real no se ve afectado por esto en absoluto (solo corre en el script de
// generación, `npm run openapi:generate`).
extendZodWithOpenApi(z);
