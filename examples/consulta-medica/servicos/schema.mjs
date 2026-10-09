import { z } from "zod";

// A tipagem que o pipeline entrega preenchida
export const ConsultaSchema = z.object({
  sintomas: z.array(z.string()),
  diagnostico: z.object({ hipotese: z.string(), cid: z.string() }),
  conduta: z.string(),
});
