"use client";

import { useMemo, useState, useCallback } from "react";
import { Label } from "@workspace/ui/components/ui/label";
import { AgentToolsManager } from "./agent-tools-manager";
import type { ModelProvidersResult } from "@/hooks/use-workspace-scoped-actions";
import {
  AgentConfigurationForm,
  type AgentConfigData,
} from "./agent-configuration-form";

interface Agent {
  id?: string;
  name?: string;
  description?: string;
  instructions?: string;
  status: "published" | "draft" | "archived";
  model?: string;
  reasoning_effort?: string;
}

interface AgentSetupTabProps {
  agent: Agent | null;
  draft: AgentConfigData | null;
  onChange: (draft: Partial<AgentConfigData>) => void;
  isSaving: boolean;
  workspaceId: string;
  onAgentUpdated?: () => void;
  modelProviders: ModelProvidersResult;
}

export function AgentSetupTab({
  agent,
  draft,
  onChange,
  workspaceId,
  modelProviders,
}: AgentSetupTabProps) {
  const [nameError, setNameError] = useState("");
  const isReadOnly = agent?.status === "published";
  const modelOptions = useMemo(
    () => modelProviders.providers.flatMap((provider) => provider.models ?? []),
    [modelProviders.providers],
  );

  const handleNameValidation = useCallback(
    (isValid: boolean, error: string) => {
      setNameError(error);
    },
    [],
  );

  return (
    <div className="space-y-6">
      <AgentConfigurationForm
        data={draft}
        onChange={onChange}
        showNameField={true}
        showDescriptionField={true}
        showInstructionsPreview={true}
        isReadOnly={isReadOnly}
        variant="full"
        instructionsMinHeight="400px"
        validateName={true}
        nameError={nameError}
        onNameValidation={handleNameValidation}
        modelOptions={modelOptions.length > 0 ? modelOptions : undefined}
      />

      {/* Tools Section */}
      <div className="space-y-4">
        <Label>Tools</Label>
        {agent?.id && (
          <AgentToolsManager
            agentId={agent.id}
            workspaceId={workspaceId}
            agent={agent}
          />
        )}
      </div>
    </div>
  );
}
