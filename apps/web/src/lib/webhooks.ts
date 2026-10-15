/** How a call of the project's CI webhook went, as the settings and the run page show it. */
export interface WebhookDelivery {
  id: string;
  event: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  attempts: number;
  responseCode: number | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** A delivery's outcome in words: the response code, or why it failed. */
export function describeDelivery(d: WebhookDelivery): string {
  if (d.status === 'SUCCEEDED') return `HTTP ${d.responseCode}`;
  return d.error ?? 'No answer yet';
}
