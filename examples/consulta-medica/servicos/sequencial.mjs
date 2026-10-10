import { iniciarSequencialPeloAmbiente } from "agent-base";
import { ConsultaSchema } from "./schema.mjs";

await iniciarSequencialPeloAmbiente({ schema: ConsultaSchema });
