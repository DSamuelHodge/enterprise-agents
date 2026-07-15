/** Row types mirroring migrations/0001_initial.sql (D1/SQLite). */

export interface WorkspaceRow {
  id: string;
  name: string;
  is_admin: number;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserWorkspaceRow {
  id: string;
  user_id: string;
  workspace_id: string;
  role: 'owner' | 'admin' | 'member';
  created_at: string;
}

export interface TeamRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  created_at: string;
  updated_at: string;
}

export interface McpServerRow {
  id: string;
  workspace_id: string;
  server_label: string;
  server_url: string | null;
  local: number;
  server_description: string | null;
  headers: string | null; // JSON
  require_approval: string | null; // JSON
  created_at: string;
  updated_at: string;
}

export type AgentStatus = 'published' | 'draft' | 'archived';
export type AgentType = 'interactive' | 'pipeline';

export interface AgentRow {
  id: string;
  workspace_id: string;
  team_id: string | null;
  name: string;
  description: string | null;
  instructions: string | null;
  status: AgentStatus;
  parent_agent_id: string | null;
  type: AgentType;
  model: string;
  reasoning_effort: 'none' | 'low' | 'medium' | 'high' | null;
  is_public: number;
  build_task_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentSubagentRow {
  id: string;
  parent_agent_id: string;
  subagent_id: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface DatasetRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  storage_type: 'analytics_engine' | 'd1';
  storage_config: string; // JSON
  build_task_id: string | null;
  last_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ToolType =
  | 'file_search'
  | 'web_search'
  | 'mcp'
  | 'code_interpreter'
  | 'image_generation'
  | 'local_shell';

export interface AgentToolRow {
  id: string;
  agent_id: string;
  tool_type: ToolType;
  mcp_server_id: string | null;
  tool_name: string | null;
  custom_description: string | null;
  require_approval: number;
  config: string | null; // JSON
  allowed_tools: string | null; // JSON array
  execution_order: number | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface UserOauthConnectionRow {
  id: string;
  user_id: string;
  workspace_id: string;
  mcp_server_id: string;
  auth_type: 'oauth' | 'bearer';
  access_token: string; // encrypted
  refresh_token: string | null; // encrypted
  token_type: string;
  token_name: string | null;
  expires_at: string | null;
  scope: string | null; // JSON array
  resource_server: string | null;
  audience: string | null;
  is_default: number;
  provider_metadata: string; // JSON
  connected_at: string;
  last_refreshed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type TaskStatus = 'in_progress' | 'in_review' | 'closed' | 'completed' | 'failed';

export interface TaskRow {
  id: string;
  workspace_id: string;
  team_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  agent_id: string;
  assigned_to_id: string | null;
  flue_agent_id: string | null;
  agent_state: string | null; // JSON
  parent_task_id: string | null;
  flue_parent_agent_id: string | null;
  task_metadata: string; // JSON
  slack_thread_ts: string | null; // generated
  view_specs: string; // JSON
  pattern_specs: string; // JSON
  schedule_spec: string | null; // JSON
  schedule_task_id: string | null;
  is_scheduled: number;
  schedule_status: 'active' | 'inactive' | 'paused' | null;
  schedule_next_run_at: string | null;
  flue_schedule_id: string | null;
  created_at: string;
  updated_at: string;
}

export type MetricType = 'llm_judge' | 'python_code' | 'formula';

export interface MetricDefinitionRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  category: string;
  metric_type: MetricType;
  config: string; // JSON
  is_active: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceInviteRow {
  id: string;
  workspace_id: string;
  invited_email: string;
  invited_by_user_id: string | null;
  role: 'owner' | 'admin' | 'member';
  token: string;
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
  created_at: string;
  accepted_at: string | null;
  declined_at: string | null;
  revoked_at: string | null;
  accepted_by_user_id: string | null;
}

export interface ChannelIntegrationRow {
  id: string;
  workspace_id: string;
  channel_type: 'slack';
  external_id: string;
  credentials: string; // JSON, values encrypted
  created_at: string;
}

export interface ChannelRow {
  id: string;
  channel_integration_id: string;
  external_channel_id: string;
  external_channel_name: string | null;
  agent_id: string;
  welcome_pending: number;
  connected_by_user_id: string | null;
  created_at: string;
}
