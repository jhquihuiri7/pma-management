"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ApiError, apiErrorMessage } from "@/lib/api-client";

export type ConfirmedMutationOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; error: unknown; busy?: boolean };

export interface ConfirmedMutationCallbacks<T> {
  onConfirmed?: (data: T) => void | Promise<void>;
  onRejected?: (error: unknown) => void | Promise<void>;
}

/**
 * Framework-agnostic core used by the hook and unit tests. Confirmation means
 * the supplied operation resolved; callers must use `api`/`checkedApiFetch` so
 * HTTP failures reject rather than resolve as a raw Response.
 */
export async function executeConfirmedMutation<T>(
  operation: () => Promise<T>,
  callbacks: ConfirmedMutationCallbacks<T> = {}
): Promise<ConfirmedMutationOutcome<T>> {
  let data: T;
  try {
    data = await operation();
  } catch (error) {
    try {
      await callbacks.onRejected?.(error);
    } catch {
      // A presentation callback must never mask the mutation's real failure.
    }
    return { ok: false, error };
  }

  try {
    await callbacks.onConfirmed?.(data);
    return { ok: true, data };
  } catch (error) {
    try {
      await callbacks.onRejected?.(error);
    } catch {
      // Keep the original callback error and let the caller recover normally.
    }
    return { ok: false, error };
  }
}

interface UseConfirmedMutationOptions<TArgs, TData> {
  mutation: (args: TArgs, signal: AbortSignal) => Promise<TData>;
  successMessage?: string | ((data: TData, args: TArgs) => string | undefined);
  errorMessage?: string | ((error: unknown, args: TArgs) => string);
  onConfirmed?: (data: TData, args: TArgs) => void | Promise<void>;
  onRejected?: (error: unknown, args: TArgs) => void | Promise<void>;
}

export function useConfirmedMutation<TArgs = void, TData = void>(
  options: UseConfirmedMutationOptions<TArgs, TData>
) {
  const optionsRef = useRef(options);
  const pendingRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const [isPending, setIsPending] = useState(false);

  optionsRef.current = options;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const mutate = useCallback(async (args: TArgs): Promise<ConfirmedMutationOutcome<TData>> => {
    if (pendingRef.current) {
      return {
        ok: false,
        busy: true,
        error: new ApiError(0, "Ya hay una operación en curso", undefined, "abort"),
      };
    }

    pendingRef.current = true;
    if (mountedRef.current) setIsPending(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    const current = optionsRef.current;

    try {
      return await executeConfirmedMutation(
        () => current.mutation(args, controller.signal),
        {
          onConfirmed: async (data) => {
            await current.onConfirmed?.(data, args);
            const message = typeof current.successMessage === "function"
              ? current.successMessage(data, args)
              : current.successMessage;
            if (message) toast.success(message);
          },
          onRejected: async (error) => {
            if (!(error instanceof ApiError && error.kind === "abort")) {
              const message = typeof current.errorMessage === "function"
                ? current.errorMessage(error, args)
                : apiErrorMessage(error, current.errorMessage);
              toast.error(message);
            }
            await current.onRejected?.(error, args);
          },
        }
      );
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      pendingRef.current = false;
      if (mountedRef.current) setIsPending(false);
    }
  }, []);

  const abort = useCallback(() => controllerRef.current?.abort(), []);

  return { mutate, isPending, abort };
}
