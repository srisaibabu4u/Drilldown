// Time limits per open status (days). A request still in that status after this
// many days is "overdue" and shows up in the lead's alerts. Keep in step with
// SLA_DAYS in src/team.ts.
export const SLA_DAYS = { new: 3, documents_pending: 7, applied: 30 } as const
