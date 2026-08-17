"use client";

import { Badge } from "@workspace/ui/components/ui/badge";
import { Button } from "@workspace/ui/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/ui/table";
import { Cloud, Key, Plus, RefreshCw, Star, Trash2 } from "lucide-react";
import type {
  ModelProviderConnection,
  ModelProviderStatus,
} from "../../../../hooks/use-workspace-scoped-actions";

interface ModelProviderConnectionsTableProps {
  providers: ModelProviderStatus[];
  connections: ModelProviderConnection[];
  onAdd: () => void;
  onDelete: (connectionId: string) => void;
  onRefresh: (providerId: string) => void | Promise<void>;
}

export function ModelProviderConnectionsTable({
  providers,
  connections,
  onAdd,
  onDelete,
  onRefresh,
}: ModelProviderConnectionsTableProps) {
  const providerById = new Map(providers.map((provider) => [provider.provider_id, provider]));
  const managedCloudflare = providerById.get("cloudflare");

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Model providers</h2>
          <p className="text-sm text-muted-foreground">
            Workspace credentials and the managed Cloudflare AI Gateway path used by agents.
          </p>
        </div>
        <Button size="sm" onClick={onAdd}>
          <Plus className="mr-1 h-4 w-4" />
          Add provider
        </Button>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Credential</TableHead>
              <TableHead>Default model</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {managedCloudflare && (
              <TableRow>
                <TableCell>
                  <div className="flex items-center gap-2 font-medium">
                    <Cloud className="h-4 w-4" />
                    {managedCloudflare.label}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">Worker binding</Badge>
                </TableCell>
                <TableCell>
                  {managedCloudflare.models?.find((model) => model.value.includes("kimi-k2.6"))?.label ?? "Configured in Worker"}
                </TableCell>
                <TableCell>
                  <Badge variant={managedCloudflare.configured ? "default" : "destructive"}>
                    {managedCloudflare.configured ? "Ready" : "Unavailable"}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">Built in</TableCell>
              </TableRow>
            )}

            {connections.map((connection) => {
              const provider = providerById.get(connection.provider_id);
              return (
                <TableRow key={connection.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      <Key className="h-4 w-4" />
                      {connection.provider_label ?? provider?.label ?? connection.provider_id}
                    </div>
                    {connection.token_name && (
                      <div className="text-xs text-muted-foreground">{connection.token_name}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">Encrypted key</Badge>
                  </TableCell>
                  <TableCell>{connection.default_model ?? "Provider default"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Badge variant="default">Ready</Badge>
                      {connection.is_default && <Star className="h-4 w-4 text-yellow-600" aria-label="Default connection" />}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRefresh(connection.provider_id)}
                        aria-label={`Refresh ${connection.provider_label ?? connection.provider_id} models`}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete(connection.id)}
                      aria-label={`Remove ${connection.provider_label ?? connection.provider_id} provider`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}

            {!managedCloudflare && connections.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No model providers are available.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
