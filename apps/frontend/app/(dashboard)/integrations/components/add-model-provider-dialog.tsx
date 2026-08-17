"use client";

import { useMemo, useState } from "react";
import { Button } from "@workspace/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/ui/dialog";
import { Input } from "@workspace/ui/components/ui/input";
import { Label } from "@workspace/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/ui/select";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import {
  useWorkspaceScopedActions,
  type ModelProviderStatus,
} from "@/hooks/use-workspace-scoped-actions";

interface AddModelProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: ModelProviderStatus[];
  onSuccess?: () => void | Promise<void>;
}

export function AddModelProviderDialog({
  open,
  onOpenChange,
  providers,
  onSuccess,
}: AddModelProviderDialogProps) {
  const { createModelProviderConnection } = useWorkspaceScopedActions();
  const configurableProviders = useMemo(
    () => providers.filter((provider) => provider.credential_required !== false),
    [providers],
  );
  const [providerId, setProviderId] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiProtocol, setApiProtocol] = useState("openai-completions");
  const [defaultModel, setDefaultModel] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProvider = configurableProviders.find(
    (provider) => provider.provider_id === providerId,
  );
  const isCustom = providerId === "custom";
  const availableModels = selectedProvider?.models ?? [];

  const reset = () => {
    setProviderId("");
    setTokenName("");
    setApiKey("");
    setBaseUrl("");
    setApiProtocol("openai-completions");
    setDefaultModel("");
    setShowKey(false);
    setError(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const handleSave = async () => {
    if (!providerId || !apiKey.trim()) return;
    if (isCustom && !baseUrl.trim()) {
      setError("Base URL is required for custom providers");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await createModelProviderConnection({
        provider_id: providerId,
        api_key: apiKey,
        token_name: tokenName || undefined,
        custom_provider_id: isCustom ? "custom" : undefined,
        base_url: isCustom ? baseUrl : undefined,
        api_protocol: isCustom ? apiProtocol : undefined,
        default_model: defaultModel || undefined,
      });
      if (!result.success) {
        setError(result.error || "Failed to save provider");
        return;
      }
      await onSuccess?.();
      handleOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add model provider</DialogTitle>
          <DialogDescription>
            Store a workspace model provider key. Secrets are encrypted and are
            never returned by the API.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="model-provider">Provider</Label>
            <Select
              value={providerId}
              onValueChange={(nextProviderId) => {
                setProviderId(nextProviderId);
                setDefaultModel("");
              }}
            >
              <SelectTrigger id="model-provider">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {configurableProviders.map((provider) => (
                  <SelectItem key={provider.provider_id} value={provider.provider_id}>
                    {provider.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="model-provider-token-name">Name</Label>
            <Input
              id="model-provider-token-name"
              value={tokenName}
              onChange={(event) => setTokenName(event.target.value)}
              placeholder={selectedProvider ? `${selectedProvider.label} key` : "Production key"}
            />
          </div>

          {isCustom && (
            <>
              <div className="space-y-2">
                <Label htmlFor="model-provider-base-url">Base URL</Label>
                <Input
                  id="model-provider-base-url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://api.example.com/v1"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model-provider-api">API protocol</Label>
                <Select value={apiProtocol} onValueChange={setApiProtocol}>
                  <SelectTrigger id="model-provider-api">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai-completions">
                      OpenAI-compatible chat
                    </SelectItem>
                    <SelectItem value="openai-responses">
                      OpenAI Responses
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {selectedProvider && (
            <div className="space-y-2">
              <Label htmlFor="model-provider-default-model">Default model ID</Label>
              <Input
                id="model-provider-default-model"
                value={defaultModel}
                onChange={(event) => setDefaultModel(event.target.value)}
                placeholder={`${providerId}/your-model-id`}
                list="model-provider-model-options"
                autoComplete="off"
                spellCheck={false}
              />
              <datalist id="model-provider-model-options">
                {availableModels.map((model) => (
                  <option key={model.value} value={model.value} label={model.label} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">
                Choose a discovered model or enter any model ID supported by this provider.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="model-provider-key">API key</Label>
            <div className="relative">
              <Input
                id="model-provider-key"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="Enter provider API key"
                autoComplete="off"
                spellCheck={false}
                className="pr-10 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey((value) => !value)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={showKey ? "Hide key" : "Show key"}
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!providerId || !apiKey.trim() || saving}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save provider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
