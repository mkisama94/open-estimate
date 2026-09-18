import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsPkg from "ajv-formats";
import type { Assessment, FunctionalProcess } from "./types.js";

const addFormats = (addFormatsPkg as any).default || addFormatsPkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ValidationErrorDetail {
  pointer: string;
  code: string;
  message: string;
}

export class SemanticValidationError extends Error {
  public errors: ValidationErrorDetail[];
  constructor(message: string, errors: ValidationErrorDetail[]) {
    super(message);
    this.name = "SemanticValidationError";
    this.errors = errors;
  }
}

// Load Schema
const schemaPath = path.resolve(__dirname, "../../contracts/oes-ph1.schema.json");
const schemaJson = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

const ajv = new Ajv2020({
  allErrors: true,
  strict: false
});
addFormats(ajv);

const validateAssessmentSchema = ajv.compile(schemaJson.definitions.Assessment);

/**
 * Validates Assessment against JSON Schema and semantic rules strictly.
 */
export function validateAssessment(assessment: any): Assessment {
  const errors: ValidationErrorDetail[] = [];

  // 1. JSON Schema Validation
  const valid = validateAssessmentSchema(assessment);
  if (!valid && validateAssessmentSchema.errors) {
    for (const err of validateAssessmentSchema.errors) {
      errors.push({
        pointer: err.instancePath || "/",
        code: "SCHEMA_INVALID",
        message: `${err.message || "Schema validation failed"} (${err.schemaPath})`
      });
    }
  }

  // If basic schema fails, return immediately before running semantic checks that assume shape
  if (errors.length > 0) {
    sortErrors(errors);
    throw new SemanticValidationError("Schema validation failed", errors);
  }

  const typed = assessment as Assessment;

  // 2. Semantic Checks

  // Manifest and files
  const manifestFileMap = new Map<string, typeof typed.input.manifest.files[0]>();
  for (const f of typed.input.manifest.files) {
    manifestFileMap.set(f.path, f);
  }

  // IDs uniqueness
  const componentMap = new Map<string, typeof typed.components[0]>();
  for (let i = 0; i < typed.components.length; i++) {
    const c = typed.components[i];
    if (componentMap.has(c.component_id)) {
      errors.push({
        pointer: `/components/${i}/component_id`,
        code: "DUPLICATE_ID",
        message: `Duplicate component_id "${c.component_id}"`
      });
    }
    componentMap.set(c.component_id, c);
  }

  const userMap = new Map<string, typeof typed.functional_users[0]>();
  for (let i = 0; i < typed.functional_users.length; i++) {
    const u = typed.functional_users[i];
    if (userMap.has(u.user_id)) {
      errors.push({
        pointer: `/functional_users/${i}/user_id`,
        code: "DUPLICATE_ID",
        message: `Duplicate user_id "${u.user_id}"`
      });
    }
    userMap.set(u.user_id, u);
  }

  const storeMap = new Map<string, typeof typed.persistent_stores[0]>();
  for (let i = 0; i < typed.persistent_stores.length; i++) {
    const s = typed.persistent_stores[i];
    if (storeMap.has(s.store_id)) {
      errors.push({
        pointer: `/persistent_stores/${i}/store_id`,
        code: "DUPLICATE_ID",
        message: `Duplicate store_id "${s.store_id}"`
      });
    }
    storeMap.set(s.store_id, s);
  }

  const ooiMap = new Map<string, typeof typed.objects_of_interest[0]>();
  for (let i = 0; i < typed.objects_of_interest.length; i++) {
    const o = typed.objects_of_interest[i];
    if (ooiMap.has(o.object_of_interest_id)) {
      errors.push({
        pointer: `/objects_of_interest/${i}/object_of_interest_id`,
        code: "DUPLICATE_ID",
        message: `Duplicate object_of_interest_id "${o.object_of_interest_id}"`
      });
    }
    ooiMap.set(o.object_of_interest_id, o);
  }

  const dataGroupMap = new Map<string, typeof typed.data_groups[0]>();
  for (let i = 0; i < typed.data_groups.length; i++) {
    const dg = typed.data_groups[i];
    if (dataGroupMap.has(dg.data_group_id)) {
      errors.push({
        pointer: `/data_groups/${i}/data_group_id`,
        code: "DUPLICATE_ID",
        message: `Duplicate data_group_id "${dg.data_group_id}"`
      });
    }
    dataGroupMap.set(dg.data_group_id, dg);

    if (!ooiMap.has(dg.object_of_interest_id)) {
      errors.push({
        pointer: `/data_groups/${i}/object_of_interest_id`,
        code: "UNRESOLVED_REFERENCE",
        message: `Referenced object_of_interest_id "${dg.object_of_interest_id}" not found`
      });
    }
  }

  const evidenceMap = new Map<string, typeof typed.evidence[0]>();
  for (let i = 0; i < typed.evidence.length; i++) {
    const ev = typed.evidence[i];
    if (evidenceMap.has(ev.evidence_id)) {
      errors.push({
        pointer: `/evidence/${i}/evidence_id`,
        code: "DUPLICATE_ID",
        message: `Duplicate evidence_id "${ev.evidence_id}"`
      });
    }
    evidenceMap.set(ev.evidence_id, ev);

    const file = manifestFileMap.get(ev.file_path);
    if (!file) {
      errors.push({
        pointer: `/evidence/${i}/file_path`,
        code: "UNRESOLVED_REFERENCE",
        message: `Evidence file_path "${ev.file_path}" not found in manifest`
      });
    } else {
      if (file.disposition === "excluded") {
        errors.push({
          pointer: `/evidence/${i}/file_path`,
          code: "EXCLUDED_EVIDENCE_SOURCE",
          message: `Evidence file_path "${ev.file_path}" is an excluded file`
        });
      }
      if (ev.line_start > ev.line_end) {
        errors.push({
          pointer: `/evidence/${i}/line_start`,
          code: "INVALID_LINE_RANGE",
          message: `line_start (${ev.line_start}) must be <= line_end (${ev.line_end})`
        });
      }
      if (ev.line_end > file.line_count) {
        errors.push({
          pointer: `/evidence/${i}/line_end`,
          code: "LINE_RANGE_OUT_OF_BOUNDS",
          message: `line_end (${ev.line_end}) exceeds file line_count (${file.line_count})`
        });
      }
    }
  }

  // Functional processes validation
  const processMap = new Map<string, FunctionalProcess>();
  for (let pIdx = 0; pIdx < typed.functional_processes.length; pIdx++) {
    const proc = typed.functional_processes[pIdx];
    if (processMap.has(proc.process_id)) {
      errors.push({
        pointer: `/functional_processes/${pIdx}/process_id`,
        code: "DUPLICATE_ID",
        message: `Duplicate process_id "${proc.process_id}"`
      });
    }
    processMap.set(proc.process_id, proc);

    const comp = componentMap.get(proc.component_id);
    if (!comp) {
      errors.push({
        pointer: `/functional_processes/${pIdx}/component_id`,
        code: "UNRESOLVED_REFERENCE",
        message: `Referenced component_id "${proc.component_id}" not found`
      });
    }

    if (!userMap.has(proc.trigger_user_id)) {
      errors.push({
        pointer: `/functional_processes/${pIdx}/trigger_user_id`,
        code: "UNRESOLVED_REFERENCE",
        message: `Referenced trigger_user_id "${proc.trigger_user_id}" not found`
      });
    }

    const movementMap = new Map<string, typeof proc.movements[0]>();
    const movementKeys = new Set<string>();
    const ooiMovementTypeCount = new Map<string, number>();

    let hasEntry = false;
    let hasExitOrWrite = false;
    let triggerMovementValid = false;

    for (let mIdx = 0; mIdx < proc.movements.length; mIdx++) {
      const mov = proc.movements[mIdx];
      const mPointer = `/functional_processes/${pIdx}/movements/${mIdx}`;

      if (movementMap.has(mov.movement_id)) {
        errors.push({
          pointer: `${mPointer}/movement_id`,
          code: "DUPLICATE_ID",
          message: `Duplicate movement_id "${mov.movement_id}"`
        });
      }
      movementMap.set(mov.movement_id, mov);

      const dg = dataGroupMap.get(mov.data_group_id);
      if (!dg) {
        errors.push({
          pointer: `${mPointer}/data_group_id`,
          code: "UNRESOLVED_REFERENCE",
          message: `Referenced data_group_id "${mov.data_group_id}" not found`
        });
      }

      if (mov.type === "Entry" || mov.type === "Exit") {
        if (!mov.peer_id) {
          errors.push({
            pointer: `${mPointer}/peer_id`,
            code: "INVALID_PROCESS",
            message: `${mov.type} movement must have peer_id`
          });
        } else if (!userMap.has(mov.peer_id)) {
          errors.push({
            pointer: `${mPointer}/peer_id`,
            code: "UNRESOLVED_REFERENCE",
            message: `peer_id "${mov.peer_id}" not found in functional_users`
          });
        }
        if (mov.store_id !== null) {
          errors.push({
            pointer: `${mPointer}/store_id`,
            code: "INVALID_PROCESS",
            message: `${mov.type} movement must have null store_id`
          });
        }
      } else if (mov.type === "Read" || mov.type === "Write") {
        if (!mov.store_id) {
          errors.push({
            pointer: `${mPointer}/store_id`,
            code: "INVALID_PROCESS",
            message: `${mov.type} movement must have store_id`
          });
        } else if (!storeMap.has(mov.store_id)) {
          errors.push({
            pointer: `${mPointer}/store_id`,
            code: "UNRESOLVED_REFERENCE",
            message: `store_id "${mov.store_id}" not found in persistent_stores`
          });
        }
        if (mov.peer_id !== null) {
          errors.push({
            pointer: `${mPointer}/peer_id`,
            code: "INVALID_PROCESS",
            message: `${mov.type} movement must have null peer_id`
          });
        }
      }

      // Check duplicate logical movement within process
      const logicalKey = `${mov.type}:${mov.data_group_id}:${mov.peer_id || ""}:${mov.store_id || ""}:${mov.semantic_variant_key || ""}`;
      if (movementKeys.has(logicalKey)) {
        errors.push({
          pointer: mPointer,
          code: "DUPLICATE_MOVEMENT",
          message: `Duplicate logical movement "${logicalKey}" in process "${proc.process_id}"`
        });
      }
      movementKeys.add(logicalKey);

      // Check distinctness requirement
      if (dg) {
        const ooiKey = `${dg.object_of_interest_id}:${mov.type}`;
        const prevCount = ooiMovementTypeCount.get(ooiKey) || 0;
        ooiMovementTypeCount.set(ooiKey, prevCount + 1);
        if (prevCount >= 1 && mov.distinctness_basis === "default") {
          errors.push({
            pointer: `${mPointer}/distinctness_basis`,
            code: "DISTINCTNESS_REQUIRED",
            message: `Multiple ${mov.type} movements for object_of_interest "${dg.object_of_interest_id}" requires non-default distinctness_basis and reason`
          });
        }
      }

      // Check evidence refs
      for (const evRef of mov.evidence_refs) {
        if (!evidenceMap.has(evRef)) {
          errors.push({
            pointer: `${mPointer}/evidence_refs`,
            code: "UNRESOLVED_REFERENCE",
            message: `evidence_ref "${evRef}" not found`
          });
        }
      }

      if (mov.type === "Entry") hasEntry = true;
      if (mov.type === "Exit" || mov.type === "Write") hasExitOrWrite = true;
      if (mov.movement_id === proc.trigger_movement_id) {
        if (mov.type === "Entry" && mov.peer_id === proc.trigger_user_id) {
          triggerMovementValid = true;
        }
      }
    }

    // Rules for accepted processes
    if (proc.status === "accepted") {
      if (comp && comp.status !== "measured") {
        errors.push({
          pointer: `/functional_processes/${pIdx}/component_id`,
          code: "INVALID_PROCESS",
          message: `Accepted process must belong to a measured component (component "${proc.component_id}" status is "${comp.status}")`
        });
      }

      if (!triggerMovementValid) {
        errors.push({
          pointer: `/functional_processes/${pIdx}/trigger_movement_id`,
          code: "INVALID_PROCESS",
          message: `trigger_movement_id "${proc.trigger_movement_id}" must be an Entry movement within this process and its peer_id must match trigger_user_id`
        });
      }

      if (proc.movements.length < 2) {
        errors.push({
          pointer: `/functional_processes/${pIdx}/movements`,
          code: "INVALID_PROCESS",
          message: `Accepted process must have at least 2 movements (has ${proc.movements.length})`
        });
      }

      if (!hasEntry || !hasExitOrWrite) {
        errors.push({
          pointer: `/functional_processes/${pIdx}/movements`,
          code: "INVALID_PROCESS",
          message: `Accepted process must include Entry and at least one Exit or Write movement`
        });
      }
    }
  }

  if (errors.length > 0) {
    sortErrors(errors);
    throw new SemanticValidationError("Semantic validation failed", errors);
  }

  return typed;
}

function sortErrors(errors: ValidationErrorDetail[]): void {
  errors.sort((a, b) => {
    if (a.pointer < b.pointer) return -1;
    if (a.pointer > b.pointer) return 1;
    if (a.code < b.code) return -1;
    if (a.code > b.code) return 1;
    return 0;
  });
}
