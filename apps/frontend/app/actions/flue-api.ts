import { cookies } from "next/headers";

const API_BASE =
  process.env.FLUE_API_URL ||
  process.env.NEXT_PUBLIC_FLUE_API_URL ||
  "http://localhost:8787/api";

type WorkflowInput = Record<string, unknown>;

async function cookieStore() {
  return await cookies();
}

async function getToken() {
  return (await cookieStore()).get("flueSession")?.value;
}

async function setToken(token: string) {
  (await cookieStore()).set("flueSession", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

function qs(params: Record<string, unknown>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const value = search.toString();
  return value ? `?${value}` : "";
}

async function request(path: string, init: RequestInit = {}) {
  const token = await getToken();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data?.error || `Flue API ${response.status}`);
  }
  return data;
}

function body(input: WorkflowInput) {
  return JSON.stringify(input);
}

function workspaceId(input: WorkflowInput) {
  const id = input.workspace_id || input.workspaceId;
  if (!id) throw new Error("workspace_id is required for this action");
  return String(id);
}

function agentId(input: WorkflowInput) {
  const id = input.agent_id || input.agentId || input.parent_agent_id;
  if (!id) throw new Error("agent_id is required for this action");
  return String(id);
}

function taskId(input: WorkflowInput) {
  const id = input.task_id || input.taskId;
  if (!id) throw new Error("task_id is required for this action");
  return String(id);
}

function metricId(input: WorkflowInput) {
  const id = input.metric_id || input.metricDefinitionId || input.metric_definition_id;
  if (!id) throw new Error("metric id is required for this action");
  return String(id);
}

function normalizeSignup(input: WorkflowInput) {
  const email = String(input.email || "");
  return {
    name: String(input.name || email.split("@")[0] || "User"),
    email,
    password: input.password,
    workspaceName: input.workspace_name || input.workspaceName,
  };
}

export async function executeFlueWorkflow(workflowName: string, input: WorkflowInput) {
  switch (workflowName) {
    case "UserLoginWorkflow": {
      const data = await request("/auth/login", { method: "POST", body: body(input) });
      if (data.token) await setToken(data.token);
      return data;
    }
    case "UserSignupWorkflow": {
      const data = await request("/auth/signup", { method: "POST", body: body(normalizeSignup(input)) });
      if (data.token) await setToken(data.token);
      return data;
    }
    case "RequestPasswordResetWorkflow":
      return request("/auth/forgot-password", { method: "POST", body: body(input) });
    case "ResetPasswordWorkflow":
      return request("/auth/reset-password", {
        method: "POST",
        body: body({ token: input.token, password: input.new_password || input.password }),
      });

    case "WorkspacesReadWorkflow":
      return request("/workspaces");
    case "WorkspacesCreateWorkflow":
      return request("/workspaces", { method: "POST", body: body({ name: input.name }) });
    case "WorkspacesGetByIdWorkflow":
      return request(`/workspaces/${input.workspace_id}`);
    case "WorkspacesUpdateWorkflow":
      return request(`/workspaces/${input.workspace_id}`, { method: "PATCH", body: body(input) });
    case "WorkspacesDeleteWorkflow":
      return request(`/workspaces/${input.workspace_id}`, { method: "DELETE" });

    case "UsersGetByWorkspaceWorkflow":
      return request(`/workspaces/${workspaceId(input)}/members`);
    case "UserWorkspacesDeleteWorkflow":
      return request(`/workspaces/${workspaceId(input)}/members/${input.user_id}`, { method: "DELETE" });
    case "TeamsReadWorkflow":
      return request(`/workspaces/${workspaceId(input)}/teams`);
    case "TeamsCreateWorkflow":
      return request(`/workspaces/${workspaceId(input)}/teams`, { method: "POST", body: body(input) });
    case "TeamsUpdateWorkflow":
      return request(`/workspaces/${workspaceId(input)}/teams/${input.team_id}`, { method: "PATCH", body: body(input) });
    case "TeamsDeleteWorkflow":
      return request(`/workspaces/${workspaceId(input)}/teams/${input.team_id}`, { method: "DELETE" });

    case "WorkspaceInvitesCreateWorkflow":
      return request(`/workspaces/${workspaceId(input)}/invites`, {
        method: "POST",
        body: body({ email: input.invited_email, role: input.role }),
      });
    case "WorkspaceInvitesGetByTokenWorkflow":
      return request(`/invites/${input.token}`);
    case "WorkspaceInvitesAcceptWorkflow":
      return request(`/invites/${input.token}/accept`, { method: "POST" });
    case "WorkspaceInvitesDeclineWorkflow":
      return request(`/invites/${input.token}/decline`, { method: "POST" });
    case "WorkspaceInvitesListPendingWorkflow":
      return request(`/workspaces/${workspaceId(input)}/invites`);
    case "WorkspaceInvitesRevokeWorkflow":
      return request(`/workspaces/${workspaceId(input)}/invites/${input.invite_id}`, { method: "DELETE" });

    case "AgentsReadWorkflow":
    case "AgentsReadAllWorkflow":
    case "AgentsReadTableWorkflow":
      return request(`/workspaces/${workspaceId(input)}/agents${qs({
        status: input.status,
        type: input.type,
      })}`);
    case "AgentsCreateWorkflow":
      return request(`/workspaces/${workspaceId(input)}/agents`, { method: "POST", body: body(input) });
    case "AgentsGetByIdWorkflow":
      return request(`/workspaces/${workspaceId(input)}/agents/${agentId(input)}`);
    case "AgentsGetVersionsWorkflow":
      return request(`/workspaces/${workspaceId(input)}/agents/${agentId(input)}/versions`);
    case "AgentsCloneWorkflow":
      return request(`/workspaces/${workspaceId(input)}/agents/${input.source_agent_id || input.agent_id}/clone`, { method: "POST" });
    case "AgentsUpdateWorkflow":
    case "AgentsUpdateStatusWorkflow":
      return request(`/workspaces/${workspaceId(input)}/agents/${agentId(input)}`, { method: "PATCH", body: body(input) });
    case "AgentsDeleteWorkflow":
      return request(`/workspaces/${workspaceId(input)}/agents/${agentId(input)}`, { method: "DELETE" });

    case "AgentSubagentsReadWorkflow":
      return request(`/workspaces/${workspaceId(input)}/agents/${agentId(input)}/subagents`);
    case "AgentSubagentsGetAvailableWorkflow":
      return request(`/workspaces/${workspaceId(input)}/agents/${agentId(input)}/subagents/available`);
    case "AgentSubagentsCreateWorkflow":
      return request(`/workspaces/${workspaceId(input)}/agents/${input.parent_agent_id}/subagents`, {
        method: "POST",
        body: body({ subagent_id: input.subagent_id }),
      });
    case "AgentSubagentsToggleWorkflow":
      return request(`/workspaces/${workspaceId(input)}/subagent-links/${input.link_id || input.id}`, { method: "PATCH", body: body(input) });
    case "AgentSubagentsDeleteWorkflow":
      return request(`/workspaces/${workspaceId(input)}/subagent-links/${input.link_id || input.id}`, { method: "DELETE" });

    case "AgentToolsReadByAgentWorkflow":
    case "AgentToolsReadRecordsByAgentWorkflow":
      return request(`/workspaces/${workspaceId(input)}/agents/${agentId(input)}/tools`);
    case "AgentToolsCreateWorkflow":
      return request(`/workspaces/${workspaceId(input)}/agents/${agentId(input)}/tools`, { method: "POST", body: body(input) });
    case "AgentToolsUpdateWorkflow":
      return request(`/workspaces/${workspaceId(input)}/agent-tools/${input.agent_tool_id}`, { method: "PATCH", body: body(input) });
    case "AgentToolsDeleteWorkflow":
      return request(`/workspaces/${workspaceId(input)}/agent-tools/${input.agent_tool_id}`, { method: "DELETE" });

    case "McpServersReadWorkflow":
      return request(`/workspaces/${workspaceId(input)}/mcp-servers`);
    case "McpServersGetByIdWorkflow": {
      const data = await request(`/mcp-servers/${input.mcp_server_id}`);
      return data.mcp_server;
    }
    case "McpServersCreateWorkflow":
      return request(`/workspaces/${workspaceId(input)}/mcp-servers`, { method: "POST", body: body(input) });
    case "McpServersUpdateWorkflow":
      return request(`/workspaces/${workspaceId(input)}/mcp-servers/${input.mcp_server_id}`, { method: "PATCH", body: body(input) });
    case "McpServersDeleteWorkflow":
      return request(`/workspaces/${workspaceId(input)}/mcp-servers/${input.mcp_server_id}`, { method: "DELETE" });
    case "GetRemoteMcpDirectoryWorkflow":
      return request(`/remote-mcp-directory${qs({ query: input.query })}`);
    case "OAuthTokensGetByWorkspaceWorkflow":
      return request(`/workspaces/${workspaceId(input)}/oauth-connections`);
    case "BearerTokenCreateWorkflow":
      return request(`/workspaces/${workspaceId(input)}/oauth-connections`, { method: "POST", body: body(input) });
    case "OAuthTokenDeleteWorkflow":
      return request(`/workspaces/${workspaceId(input)}/oauth-connections/${input.token_id}`, { method: "DELETE" });
    case "OAuthTokenSetDefaultByIdWorkflow":
      return request(`/workspaces/${workspaceId(input)}/oauth-connections/${input.token_id}/default`, { method: "POST", body: body(input) });

    case "TasksReadWorkflow":
      return request(`/workspaces/${workspaceId(input)}/tasks${qs({
        status: input.status,
        agent_id: input.agent_id,
        scheduled: input.scheduled,
      })}`);
    case "TasksCreateWorkflow":
      return request(`/workspaces/${workspaceId(input)}/tasks`, { method: "POST", body: body(input) });
    case "TasksGetByIdWorkflow":
      return request(`/workspaces/${workspaceId(input)}/tasks/${taskId(input)}`);
    case "TasksUpdateWorkflow":
      return request(`/workspaces/${workspaceId(input)}/tasks/${taskId(input)}`, { method: "PATCH", body: body(input) });
    case "TasksDeleteWorkflow":
      return request(`/workspaces/${workspaceId(input)}/tasks/${taskId(input)}`, { method: "DELETE" });
    case "TasksGetStatsWorkflow":
      return request(`/workspaces/${workspaceId(input)}/tasks/stats`);
    case "GetTaskMetricsWorkflow":
      return request(`/workspaces/${workspaceId(input)}/tasks/${taskId(input)}/metrics`);
    case "GetTaskTracesWorkflow":
      return request(`/workspaces/${workspaceId(input)}/tasks/${taskId(input)}/traces`);
    case "FeedbackSubmissionWorkflow":
      return request(`/workspaces/${workspaceId(input)}/tasks/${taskId(input)}/feedback`, { method: "POST", body: body(input) });

    case "DatasetsReadWorkflow":
      return request(`/workspaces/${workspaceId(input)}/datasets`);
    case "DatasetsCreateWorkflow":
      return request(`/workspaces/${workspaceId(input)}/datasets`, { method: "POST", body: body(input) });
    case "DatasetsGetByIdWorkflow":
      return request(`/workspaces/${workspaceId(input)}/datasets/${input.dataset_id}`);
    case "DatasetsUpdateWorkflow":
      return request(`/workspaces/${workspaceId(input)}/datasets/${input.dataset_id}`, { method: "PATCH", body: body(input) });
    case "MetricsReadWorkflow":
    case "ListMetricDefinitionsWorkflow":
      return request(`/workspaces/${workspaceId(input)}/metrics`);
    case "CreateMetricDefinitionWorkflow":
    case "CreateMetricWithRetroactiveWorkflow":
      return request(`/workspaces/${workspaceId(input)}/metrics`, { method: "POST", body: body({
        ...input,
        retroactive: input.run_retroactive,
      }) });
    case "UpdateMetricDefinitionWorkflow":
      return request(`/workspaces/${workspaceId(input)}/metrics/${metricId(input)}`, { method: "PATCH", body: body(input) });
    case "DeleteMetricDefinitionWorkflow":
      return request(`/workspaces/${workspaceId(input)}/metrics/${metricId(input)}`, { method: "DELETE" });
    case "GetAnalyticsMetrics":
      return request(`/workspaces/${workspaceId(input)}/analytics/overview${qs({ days: 30 })}`);
    case "GetTasksByMetricWorkflow":
      return request(`/workspaces/${workspaceId(input)}/analytics/tasks-by-metric${qs({
        metric: input.metric_name,
        days: 30,
      })}`);
    case "GetFeedbackAnalyticsWorkflow":
      return request(`/workspaces/${workspaceId(input)}/analytics/feedback${qs({ days: 30 })}`);

    default:
      throw new Error(`No Flue REST adapter for ${workflowName}`);
  }
}

export function encodeWorkflowRequest(workflowName: string, input: WorkflowInput) {
  return Buffer.from(JSON.stringify({ workflowName, input })).toString("base64url");
}

export function decodeWorkflowRequest(value: string): { workflowName: string; input: WorkflowInput } {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}
