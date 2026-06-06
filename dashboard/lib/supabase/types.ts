export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: Record<string, never>
    Views: Record<string, never>
    Functions: {
      create_or_rotate_project_api_key: {
        Args: {
          p_project_id: string
          p_project_name: string
          p_key_id: string
          p_key_hash: string
        }
        Returns: {
          result_project_id: string
          result_created_at: string
        }[]
      }
      dashboard_list_sessions: {
        Args: {
          p_project_id: string
        }
        Returns: {
          id: string
          created_at: string
          ended_at: string | null
          trace_count: number
          tool_call_count: number
          errored_count: number
          total_cost_usd: string
          total_input_tokens: number
          total_output_tokens: number
        }[]
      }
      dashboard_get_session: {
        Args: {
          p_project_id: string
          p_session_id: string
        }
        Returns: {
          id: string
          created_at: string
          ended_at: string | null
          total_cost_usd: string
          total_input_tokens: number
          total_output_tokens: number
        }[]
      }
      dashboard_list_traces: {
        Args: {
          p_project_id: string
          p_session_id: string
        }
        Returns: DashboardTrace[]
      }
      dashboard_get_trace: {
        Args: {
          p_project_id: string
          p_trace_id: string
        }
        Returns: DashboardTrace[]
      }
      dashboard_list_session_tool_calls: {
        Args: {
          p_project_id: string
          p_session_id: string
        }
        Returns: DashboardToolCall[]
      }
      dashboard_list_trace_tool_calls: {
        Args: {
          p_project_id: string
          p_trace_id: string
        }
        Returns: DashboardToolCall[]
      }
      dashboard_list_trace_spans: {
        Args: {
          p_project_id: string
          p_trace_id: string
        }
        Returns: DashboardSpan[]
      }
      dashboard_list_trace_events: {
        Args: {
          p_project_id: string
          p_trace_id: string
        }
        Returns: DashboardTraceEvent[]
      }
      dashboard_session_cost: {
        Args: {
          p_project_id: string
          p_session_id: string
        }
        Returns: DashboardSessionCost[]
      }
      dashboard_project_cost_summary: {
        Args: {
          p_project_id: string
          p_since: string
        }
        Returns: DashboardProjectCostSummary[]
      }
      dashboard_list_eval_datasets: {
        Args: {
          p_project_id: string
        }
        Returns: DashboardEvalDataset[]
      }
      dashboard_get_eval_dataset: {
        Args: {
          p_project_id: string
          p_dataset_id: string
        }
        Returns: DashboardEvalDataset[]
      }
      dashboard_create_eval_dataset: {
        Args: {
          p_id: string
          p_project_id: string
          p_name: string
          p_file_name: string
          p_file_format: string
          p_content_type: string
          p_byte_size: number
          p_storage_path: string
          p_case_count: number | null
        }
        Returns: DashboardEvalDataset[]
      }
      dashboard_delete_eval_dataset: {
        Args: {
          p_project_id: string
          p_dataset_id: string
        }
        Returns: {
          storage_path: string
        }[]
      }
      dashboard_update_eval_dataset: {
        Args: {
          p_project_id: string
          p_dataset_id: string
          p_file_format: string
          p_content_type: string
          p_byte_size: number
          p_case_count: number | null
        }
        Returns: DashboardEvalDataset[]
      }
      dashboard_create_eval_run: {
        Args: {
          p_id: string
          p_project_id: string
          p_dataset_id: string
          p_status: EvalRunStatus
          p_total_cases: number
          p_evaluated_cases: number
          p_not_evaluated_cases: number
          p_passed_cases: number
          p_failed_cases: number
          p_pass_rate: number
          p_skipped_grades: number
          p_result: Json | null
          p_error: Json | null
        }
        Returns: DashboardEvalRun[]
      }
      dashboard_list_eval_runs: {
        Args: {
          p_project_id: string
          p_dataset_id: string
        }
        Returns: DashboardEvalRunSummary[]
      }
      dashboard_get_eval_run: {
        Args: {
          p_project_id: string
          p_dataset_id: string
          p_run_id: string
        }
        Returns: DashboardEvalRun[]
      }
      dashboard_list_provider_keys: {
        Args: {
          p_project_id: string
        }
        Returns: DashboardProviderKey[]
      }
      dashboard_upsert_provider_key: {
        Args: {
          p_project_id: string
          p_provider: string
          p_encrypted_api_key: string
          p_key_hint: string
        }
        Returns: DashboardProviderKey[]
      }
      dashboard_delete_provider_key: {
        Args: {
          p_project_id: string
          p_provider: string
        }
        Returns: undefined
      }
      dashboard_get_provider_key: {
        Args: {
          p_project_id: string
          p_provider: string
        }
        Returns: DashboardEncryptedProviderKey[]
      }
      dashboard_list_prompts: {
        Args: {
          p_project_id: string
        }
        Returns: DashboardPrompt[]
      }
      dashboard_get_prompt: {
        Args: {
          p_project_id: string
          p_prompt_id: string
        }
        Returns: DashboardPromptDetail[]
      }
      dashboard_create_prompt: {
        Args: {
          p_project_id: string
          p_name: string
          p_slug: string
          p_description: string | null
          p_created_by: string | null
        }
        Returns: DashboardPrompt[]
      }
      dashboard_create_prompt_version: {
        Args: {
          p_project_id: string
          p_prompt_id: string
          p_content: string
          p_model: string | null
          p_temperature: number | null
          p_max_tokens: number | null
          p_variables: Json
          p_parent_version_id: string | null
          p_change_note: string | null
          p_created_by: string | null
        }
        Returns: DashboardPromptVersion[]
      }
      dashboard_set_prompt_label: {
        Args: {
          p_project_id: string
          p_prompt_id: string
          p_label: string
          p_version_id: string
          p_change_note: string | null
          p_deployed_by: string | null
        }
        Returns: DashboardPrompt[]
      }
      dashboard_resolve_prompt_label: {
        Args: {
          p_project_id: string
          p_slug: string
          p_label: string
        }
        Returns: DashboardResolvedPrompt[]
      }
      dashboard_resolve_prompt: {
        Args: {
          p_project_id: string
          p_slug: string
          p_label: string
          p_version: number | null
        }
        Returns: DashboardResolvedPrompt[]
      }
      dashboard_list_trace_prompt_links: {
        Args: {
          p_project_id: string
          p_trace_id: string
        }
        Returns: DashboardTracePromptLink[]
      }
      dashboard_list_scores: {
        Args: {
          p_project_id: string
          p_trace_id: string
        }
        Returns: DashboardScore[]
      }
      dashboard_create_score: {
        Args: {
          p_id: string
          p_project_id: string
          p_trace_id: string
          p_span_id: string | null
          p_name: string
          p_value: number
          p_data_type: ScoreDataType
          p_string_value: string | null
          p_source: ScoreSource
          p_comment: string | null
          p_created_by: string | null
        }
        Returns: DashboardScore[]
      }
      dashboard_list_alert_rules: {
        Args: { p_project_id: string }
        Returns: DashboardAlertRule[]
      }
      dashboard_upsert_alert_rule: {
        Args: {
          p_id: string
          p_project_id: string
          p_kind: AlertRuleKind
          p_threshold: number | null
          p_enabled: boolean
        }
        Returns: DashboardAlertRule[]
      }
      dashboard_delete_alert_rule: {
        Args: { p_project_id: string; p_id: string }
        Returns: undefined
      }
      dashboard_list_webhooks: {
        Args: { p_project_id: string }
        Returns: DashboardWebhook[]
      }
      dashboard_create_webhook: {
        Args: { p_id: string; p_project_id: string; p_url: string }
        Returns: DashboardWebhook[]
      }
      dashboard_delete_webhook: {
        Args: { p_project_id: string; p_id: string }
        Returns: undefined
      }
    }
  }
}

export interface DashboardTrace {
  id: string
  session_id: string
  run_id: string
  created_at: string
  ended_at: string | null
  name: string
  status: string
  error: Json | null
  cost_usd: string
  input_tokens: number
  output_tokens: number
  model: string | null
}

export interface DashboardToolCall {
  id: string
  trace_id: string
  name: string
  params: Json
  output: Json
  error: Json | null
  created_at: string
}

export type DashboardSpanKind = 'agent' | 'workflow' | 'model' | 'tool' | 'custom'

export type DashboardSpanStatus = 'running' | 'ok' | 'error'

export interface DashboardSpan {
  id: string
  trace_id: string
  parent_span_id: string | null
  kind: DashboardSpanKind
  name: string
  started_at: string
  ended_at: string | null
  status: DashboardSpanStatus
  error: Json | null
  iteration: number | null
  attributes: Json
}

export type DashboardTraceEventType =
  | 'user_input'
  | 'system_message'
  | 'assistant_message'
  | 'reasoning'
  | 'tool_arguments'
  | 'tool_result'
  | 'final_response'
  | 'custom'

export interface DashboardTraceEvent {
  id: string
  trace_id: string
  span_id: string | null
  type: DashboardTraceEventType
  content: Json
  attributes: Json
  created_at: string
}

export interface DashboardSessionCost {
  cost_usd: string
  input_tokens: number
  output_tokens: number
  model_call_count: number
}

export interface DashboardModelCostBreakdown {
  model: string
  cost_usd: string
}

export interface DashboardProjectCostSummary {
  cost_usd: string
  input_tokens: number
  output_tokens: number
  run_count: number
  by_model: DashboardModelCostBreakdown[] | null
}

export interface DashboardEvalDataset {
  id: string
  project_id: string
  name: string
  file_name: string
  file_format: string
  content_type: string
  byte_size: number
  storage_path: string
  case_count: number | null
  created_at: string
}

export interface EvalDatasetSummary {
  id: string
  name: string
  fileName: string
  fileFormat: string
  byteSize: number
  caseCount: number | null
  createdAt: string
}

export type EvalRunStatus = 'passed' | 'failed' | 'not_evaluated' | 'error'

export interface DashboardEvalRunSummary {
  id: string
  project_id: string
  dataset_id: string
  status: EvalRunStatus
  total_cases: number
  evaluated_cases: number
  not_evaluated_cases: number
  passed_cases: number
  failed_cases: number
  pass_rate: number
  skipped_grades: number
  created_at: string
}

export interface DashboardEvalRun extends DashboardEvalRunSummary {
  result: Json | null
  error: Json | null
}

export interface DashboardProviderKey {
  provider: string
  key_hint: string
  created_at: string
  updated_at: string
}

export interface DashboardEncryptedProviderKey {
  encrypted_api_key: string
}

export interface DashboardPrompt {
  id: string
  project_id: string
  name: string
  slug: string
  description: string | null
  current_version_id: string | null
  labels: Json
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface DashboardPromptVersion {
  id: string
  prompt_id: string
  project_id: string
  version_number: number
  content: string
  model: string | null
  temperature: number | null
  max_tokens: number | null
  variables: Json
  parent_version_id: string | null
  change_note: string | null
  content_hash: string
  created_by: string | null
  created_at: string
}

export interface DashboardPromptLabelHistory {
  id: number
  project_id: string
  prompt_id: string
  label: string
  version_id: string
  deployed_at: string
  deployed_by: string | null
  change_note: string | null
}

export interface DashboardPromptDetail extends DashboardPrompt {
  versions: DashboardPromptVersion[] | null
  label_history: DashboardPromptLabelHistory[] | null
}

export interface DashboardResolvedPrompt {
  prompt_id: string
  prompt_version_id: string
  version_number: number
  content: string
  model: string | null
  temperature: number | null
  max_tokens: number | null
  variables: Json
  content_hash: string
}

export interface DashboardTracePromptLink {
  id: number
  project_id: string
  trace_id: string
  span_id: string
  prompt_id: string
  prompt_name: string
  prompt_slug: string
  prompt_version_id: string
  version_number: number
  content_hash: string
  labels: Json
  variable_values: Json
  linked_at: string
}

export type ScoreDataType = 'numeric' | 'categorical' | 'boolean'

export type ScoreSource = 'human' | 'api' | 'auto'

export interface DashboardScore {
  id: string
  project_id: string
  trace_id: string
  span_id: string | null
  name: string
  value: number
  data_type: ScoreDataType
  string_value: string | null
  source: ScoreSource
  comment: string | null
  created_by: string | null
  created_at: string
}

export type AlertRuleKind = 'error_rate' | 'latency_p95' | 'token_budget'

export interface DashboardAlertRule {
  id: string
  project_id: string
  kind: AlertRuleKind
  threshold: number | null
  enabled: boolean
  created_at: string
  updated_at: string
}

export type WebhookStatus = 'active' | 'paused'

export interface DashboardWebhook {
  id: string
  project_id: string
  url: string
  status: WebhookStatus
  created_at: string
}

export interface EvalRunSummary {
  id: string
  datasetId: string
  status: EvalRunStatus
  totalCases: number
  evaluatedCases: number
  notEvaluatedCases: number
  passedCases: number
  failedCases: number
  passRate: number
  skippedGrades: number
  createdAt: string
}

export interface EvalRunDetail extends EvalRunSummary {
  result: Json | null
  error: Json | null
}

export type DashboardSession =
  Database['public']['Functions']['dashboard_list_sessions']['Returns'][number]

export type DashboardSessionDetail =
  Database['public']['Functions']['dashboard_get_session']['Returns'][number]

export type DashboardTraceWithToolCalls = DashboardTrace & {
  tool_calls: DashboardToolCall[]
}
