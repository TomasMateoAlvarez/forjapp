import { app, dbReady } from "./app.js";

// Render inyecta PORT en runtime — nunca asumir 4000 fuera de desarrollo local.
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

dbReady
  .then(() => {
    app.listen(PORT, () => {
      console.log(`FORJA backend corriendo en http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("No se pudo inicializar la base de datos:", err);
    process.exit(1);
  });
