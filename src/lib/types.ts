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

export interface Profile {
  id: string
  instrument: string | null
  display_name: string | null
  role: AppRole
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
