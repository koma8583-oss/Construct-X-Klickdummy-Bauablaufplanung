import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export interface ProjectCalendar {
  id?: string;
  projectId: string;
  monHours: string;
  tueHours: string;
  wedHours: string;
  thuHours: string;
  friHours: string;
  satHours: string;
  sunHours: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdateProjectCalendarBody {
  monHours: number;
  tueHours: number;
  wedHours: number;
  thuHours: number;
  friHours: number;
  satHours: number;
  sunHours: number;
}

export const getGetProjectCalendarQueryKey = (projectId: string) =>
  ["/projects", projectId, "calendar"] as const;

export function useGetProjectCalendar(
  projectId: string,
  options?: { query?: UseQueryOptions<ProjectCalendar, Error> },
) {
  return useQuery<ProjectCalendar, Error>({
    queryKey: getGetProjectCalendarQueryKey(projectId),
    queryFn: ({ signal }) =>
      customFetch<ProjectCalendar>(`/api/projects/${projectId}/calendar`, {
        signal,
      }),
    enabled: Boolean(projectId),
    ...options?.query,
  });
}

export function useUpdateProjectCalendar(
  options?: {
    mutation?: UseMutationOptions<
      ProjectCalendar,
      Error,
      { projectId: string; data: UpdateProjectCalendarBody }
    >;
  },
) {
  const queryClient = useQueryClient();

  return useMutation<
    ProjectCalendar,
    Error,
    { projectId: string; data: UpdateProjectCalendarBody }
  >({
    mutationFn: ({ projectId, data }) =>
      customFetch<ProjectCalendar>(`/api/projects/${projectId}/calendar`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: (calendar, variables, onMutateResult, mutationContext) => {
      queryClient.setQueryData(
        getGetProjectCalendarQueryKey(variables.projectId),
        calendar,
      );
      options?.mutation?.onSuccess?.(
        calendar,
        variables,
        onMutateResult,
        mutationContext,
      );
    },
    ...options?.mutation,
  });
}

/**
 * Legacy project-plan helper for creating an initial dependency without
 * rescheduling the just-created plan. The server already owns this behavior;
 * it is kept here until the option is represented in the generated contract.
 */
export function useCreateTaktDependencySkipReschedule() {
  return useMutation<
    unknown,
    Error,
    {
      projectId: string;
      data: {
        predecessorId: string;
        successorId: string;
        type: "EA" | "AA" | "EE";
        lagDays: number;
      };
    }
  >({
    mutationFn: ({ projectId, data }) =>
      customFetch(
        `/api/projects/${projectId}/takt-dependencies?skipReschedule=true`,
        {
          method: "POST",
          body: JSON.stringify(data),
        },
      ),
  });
}