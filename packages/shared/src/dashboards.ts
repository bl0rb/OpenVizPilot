import { z } from 'zod';

/** Configuration identity only: never a Tableau permission or a data-access grant. */
export const registeredDashboardKeySchema = z.string().regex(/^dashboard:[0-9a-f-]{36}$/).refine(
  (key) => z.uuid().safeParse(key.slice('dashboard:'.length)).success,
);
export const dashboardRegistrationSchema = z.object({
  dashboardKey: registeredDashboardKeySchema,
  name: z.string().trim().min(1).max(200),
}).strict();
export type DashboardRegistration = z.infer<typeof dashboardRegistrationSchema>;
export interface RegisteredDashboard extends DashboardRegistration {
  firstSeenAt: string;
  lastSeenAt: string;
}
