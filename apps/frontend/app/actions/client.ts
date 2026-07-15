function unsupported(method: string): never {
  throw new Error(`${method} is not available in the Flue test harness. Use app/actions/workflow.ts instead.`);
}

export const client = {
  scheduleWorkflow: (..._args: unknown[]) => unsupported("scheduleWorkflow"),
  getWorkflowResult: (..._args: unknown[]) => unsupported("getWorkflowResult"),
  scheduleAgent: (..._args: unknown[]) => unsupported("scheduleAgent"),
  sendAgentEvent: (..._args: unknown[]) => unsupported("sendAgentEvent"),
};
