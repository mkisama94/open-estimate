export type Disposition = "analyzed" | "supporting" | "unread" | "excluded";
export type MovementType = "Entry" | "Exit" | "Read" | "Write";
export type ProcessStatus = "accepted" | "unresolved";
export type ComponentStatus = "measured" | "excluded" | "unresolved";
export type UserCategory = "person" | "external_system" | "timer" | "device";
export type StorageType = "relational_db" | "document_db" | "key_value" | "file_storage" | "queue" | "cache" | "other";
export type EvidenceType = "source" | "schema" | "configuration" | "test" | "documentation" | "other";
export type DistinctnessBasis = "default" | "functional_variant" | "multi_group" | "distinct_event";
export type FindingCategory = "applicability_limit" | "ambiguity" | "unread_code" | "suspicious_directive" | "inferred_logic" | "coverage_gap";
export type FindingSeverity = "info" | "warning" | "blocking";
export type MeasurementStatus = "COMPLETE" | "PARTIAL" | "UNSUPPORTED" | "INCOMPLETE";
export type ModelMetadataSource = "user_reported" | "host_provided" | "unknown";

export interface ManifestFileEntry {
  path: string;
  sha256: string;
  bytes: number;
  line_count: number;
  disposition: Disposition;
  exclusion_reason: string | null;
}

export interface SourceManifest {
  domain: "oes/source-manifest/v1";
  files: ManifestFileEntry[];
}

export interface AssessorInfo {
  model_id: string | null;
  model_name: string;
  model_metadata_source: ModelMetadataSource;
  host: string;
  skill_id: string;
  skill_version: string;
  skill_sha256: string;
  started_at: string;
  finished_at: string;
  context_isolation: "not_enforced";
}

export interface AssessmentInput {
  repository_label: string;
  snapshot_type: "worktree" | "git_commit";
  commit: string | null;
  dirty: boolean;
  manifest_hash: string;
  manifest: SourceManifest;
  analysis_complete: boolean;
  source_binding: "client_reported";
}

export interface AssessmentScope {
  aggregation: "single_application_boundary";
  measurement_purpose: "as_built_functional_size";
  perspective: string;
  description: string;
}

export interface Component {
  component_id: string;
  name: string;
  status: ComponentStatus;
  scope_impact: boolean;
  path_prefixes: string[];
  reason: string;
}

export interface FunctionalUser {
  user_id: string;
  name: string;
  category: UserCategory;
  description: string;
}

export interface PersistentStore {
  store_id: string;
  name: string;
  storage_type: StorageType;
  description: string;
}

export interface ObjectOfInterest {
  object_of_interest_id: string;
  name: string;
  description: string;
}

export interface DataGroup {
  data_group_id: string;
  object_of_interest_id: string;
  name: string;
  attributes: string[];
  description: string;
}

export interface Evidence {
  evidence_id: string;
  file_path: string;
  line_start: number;
  line_end: number;
  symbol: string | null;
  evidence_type: EvidenceType;
  description: string;
}

export interface DataMovement {
  movement_id: string;
  type: MovementType;
  data_group_id: string;
  peer_id: string | null;
  store_id: string | null;
  semantic_variant_key: string | null;
  distinctness_basis: DistinctnessBasis;
  distinctness_reason: string | null;
  evidence_refs: string[];
}

export interface FunctionalProcess {
  process_id: string;
  component_id: string;
  name: string;
  description: string;
  trigger_movement_id: string;
  trigger_user_id: string;
  status: ProcessStatus;
  inferred: boolean;
  decision_reason: string;
  movements: DataMovement[];
}

export interface Finding {
  finding_id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  message: string;
  evidence_refs: string[];
}

export interface HumanAmendment {
  amendment_id: string;
  target_pointer: string;
  previous_hash: string;
  reason: string;
}

export interface Assessment {
  assessment_id: string;
  assessor: AssessorInfo;
  input: AssessmentInput;
  scope: AssessmentScope;
  components: Component[];
  functional_users: FunctionalUser[];
  persistent_stores: PersistentStore[];
  objects_of_interest: ObjectOfInterest[];
  data_groups: DataGroup[];
  evidence: Evidence[];
  functional_processes: FunctionalProcess[];
  findings: Finding[];
  human_amendments: HumanAmendment[];
}

export interface QuartileValues {
  p25: string | null;
  median: string | null;
  p75: string | null;
}

export interface MeasurementCounts {
  entry: number;
  exit: number;
  read: number;
  write: number;
  total_processes: number;
  accepted_processes: number;
}

export interface MeasurementResult {
  status: MeasurementStatus;
  cfp: number | null;
  counts: MeasurementCounts;
}

export interface EffortEstimate {
  status: "AVAILABLE" | "BENCHMARK_UNAVAILABLE" | "OUTSIDE_REFERENCE_RANGE" | "UNSUPPORTED";
  hours_per_cfp: QuartileValues | null;
  person_hours: QuartileValues | null;
}

export interface ReferenceUsdEstimate {
  status: "AVAILABLE" | "WAGE_UNAVAILABLE" | "UNSUPPORTED";
  hourly_wage_usd: string | null;
  amount_usd: QuartileValues | null;
}

export interface LocalizedReferenceEstimate {
  status: "AVAILABLE" | "FX_UNAVAILABLE" | "FX_STALE" | "UNSUPPORTED";
  currency: string;
  currency_per_usd: string | null;
  amount: QuartileValues | null;
}

export interface AssessmentFeatures {
  entry_count: number;
  exit_count: number;
  read_count: number;
  write_count: number;
  process_count: number;
  data_group_count: number;
  inferred_movement_count: number;
  unresolved_process_count: number;
  measured_component_count: number;
  excluded_component_count: number;
  source_line_count: number;
  languages: string[];
}

export interface Report {
  domain: "open-estimate/report/ph1/v1";
  assessment_id: string;
  assessment_hash: string;
  profile_set_id: string | null;
  measurement: MeasurementResult;
  assurance: {
    assessment_class: "COMMUNITY";
    context_isolation: "not_enforced";
    semantic_assessment: "NOT_INDEPENDENTLY_VERIFIED";
  };
  effort: EffortEstimate;
  reference_usd: ReferenceUsdEstimate;
  localized_reference: LocalizedReferenceEstimate;
  features: AssessmentFeatures;
  limitation_codes: string[];
  generated_at: string;
}

export interface CalculationContext {
  locale: string;
  display_currency?: string;
  benchmarkProfile?: {
    id: string;
    sample_size: number;
    hours_per_cfp: { p25: string; median: string; p75: string };
    min_cfp: number;
    max_cfp: number;
    is_test?: boolean;
  } | null;
  wageProfile?: {
    id: string;
    hourly_wage_usd: string;
    is_test?: boolean;
  } | null;
  fxRate?: {
    currency: string;
    currency_per_usd: string;
  } | null;
}
