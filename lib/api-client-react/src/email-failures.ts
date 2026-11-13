import { useQuery } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export interface EmailFailure {
  id: number;
  recipientAddress: string;
  eventName: string | null;
  errorMessage: string;
  occurredAt: string;
}

export interface EmailFailuresResult {
  count: number;
  failures: EmailFailure[];
}

export const getEmailFailuresQueryKey = () => ["/api/diagnostics/email-failures"] as const;

export const getEmailFailures = (): Promise<EmailFailuresResult> =>
  customFetch<EmailFailuresResult>("/api/diagnostics/email-failures");

export const useEmailFailures = () =>
  useQuery({
    queryKey: getEmailFailuresQueryKey(),
    queryFn: ({ signal }) => getEmailFailures(),
    refetchOnMount: "always",
  });
