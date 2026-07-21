export type DayOfWeek = 'THURSDAY' | 'SATURDAY'

export interface Service {
  id: string
  service_date: string // ISO date YYYY-MM-DD
  day_of_week: DayOfWeek
  source_filename: string
  uploaded_at: string
  instruments: string[]
}

export interface Song {
  id: string
  service_id: string
  order_index: number
  title: string
  scale: string | null
  medley_group: string | null
  reference_links: string[]
}

export interface Section {
  id: string
  song_id: string
  order_index: number
  label: string
  comments: string
}

export interface Instruction {
  id: string
  section_id: string
  instrument: string
  text: string
  is_intro: boolean
}

export interface SessionState {
  service_id: string
  current_song_index: number
  current_section_index: number
  updated_at: string
  updated_by: string | null
}

export interface UserNote {
  id: string
  user_id: string
  section_id: string
  instrument: string
  note_text: string
}

export type AppRole = 'master' | 'admin' | 'worship_leader' | 'member'

// Team tags — a separate, softer axis from role (see v9_profiles_teams.sql).
export type AppTeam = 'worship' | 'sound' | 'media'
export const TEAMS: AppTeam[] = ['worship', 'sound', 'media']
export const TEAM_LABELS: Record<AppTeam, string> = {
  worship: 'Worship',
  sound: 'Sound',
  media: 'Media',
}

export interface Profile {
  id: string
  instrument: string | null
  display_name: string | null
  role: AppRole
  preferred_key: string | null // global transpose preference; null = actual key
  teams: AppTeam[]
  profile_completed_at: string | null
}

// Safe, everyone-readable subset (public_profiles view) — no email/role.
export interface PublicProfile {
  id: string
  display_name: string | null
  instrument: string | null
  teams: AppTeam[]
}

// Enriched types for UI
export interface SongWithSections extends Song {
  sections: SectionWithInstructions[]
}

export interface SectionWithInstructions extends Section {
  instructions: Instruction[]
}

export interface ServiceWithSongs extends Service {
  songs: SongWithSections[]
}
