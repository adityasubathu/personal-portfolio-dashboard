export type TriggerStatus = 'ok' | 'watch' | 'action' | 'breach' | 'manual'

export interface TriggerResult {
  key: string
  label: string
  section: string
  mode: 'auto' | 'manual_input' | 'manual_ack'
  status: TriggerStatus
  summary: string
  detail: Record<string, unknown>
  cta: string | null
  threshold: Record<string, unknown> | null
}

export interface SectionResult {
  section: string
  triggers: TriggerResult[]
}

export interface PolicyTrackerResponse {
  generated_at: string
  sections: SectionResult[]
  action_count: number
}
