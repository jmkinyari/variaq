// Registry of Data hub importers by dataset kind (see lib/ingest/kinds.js).
// Contract: { options: [{key,label,type,required,choices?,default?,placeholder?}], run({ws,user,records,fileName,options,cleanReport}) → {message, redirect, targetId?, imported} }
import "server-only";
import { IMPORTERS as CORE } from "./core";
import { TAX_IMPORTERS } from "./tax";
import { BUDGET_IMPORTERS } from "./budget";

export const IMPORTERS = { ...CORE, ...TAX_IMPORTERS, ...BUDGET_IMPORTERS };
/** Option metadata only (safe to send to the browser). */
export const importerOptions = () => Object.fromEntries(Object.entries(IMPORTERS).map(([k, v]) => [k, v.options || []]));
