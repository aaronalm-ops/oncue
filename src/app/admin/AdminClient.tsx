'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { AppRole } from '@/lib/types'

interface Member {
  id: string
  display_name: string | null
  email: string | null
  instrument: string | null
  role: AppRole
}

interface Props {
  members: Member[]
  actorRole: AppRole
  actorId: string
  serviceCount: number
}

const ROLE_ORDER: Record<AppRole, number> = {
  master: 0, admin: 1, worship_leader: 2, member: 3,
}

function RoleBadge({ role }: { role: AppRole }) {
  if (role === 'admin') {
    return (
      <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-900/40 text-purple-400 border border-purple-800/40">
        Admin
      </span>
    )
  }
  if (role === 'worship_leader') {
    return (
      <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-900/40 text-indigo-400 border border-indigo-800/40">
        Worship Leader
      </span>
    )
  }
  return null
}

function getActions(
  member: Member,
  actorRole: AppRole,
  actorId: string,
): { label: string; role?: AppRole; delete?: true }[] {
  if (member.id === actorId) return []

  if (actorRole === 'master') {
    const actions: { label: string; role?: AppRole; delete?: true }[] = []
    if (member.role === 'member') {
      actions.push({ label: 'Promote to Worship Leader', role: 'worship_leader' })
      actions.push({ label: 'Promote to Admin', role: 'admin' })
    } else if (member.role === 'worship_leader') {
      actions.push({ label: 'Promote to Admin', role: 'admin' })
      actions.push({ label: 'Demote to Member', role: 'member' })
    } else if (member.role === 'admin') {
      actions.push({ label: 'Demote to Worship Leader', role: 'worship_leader' })
      actions.push({ label: 'Demote to Member', role: 'member' })
    }
    if (member.role !== 'master') actions.push({ label: 'Remove Member', delete: true })
    return actions
  }

  if (actorRole === 'admin') {
    if (member.role === 'member') {
      return [
        { label: 'Promote to Worship Leader', role: 'worship_leader' },
        { label: 'Remove Member', delete: true },
      ]
    }
    if (member.role === 'worship_leader') {
      return [
        { label: 'Demote to Member', role: 'member' },
        { label: 'Remove Member', delete: true },
      ]
    }
  }

  return []
}

export default function AdminClient({ members: initial, actorRole, actorId, serviceCount }: Props) {
  const [members, setMembers] = useState(initial)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sorted = [...members].sort((a, b) => {
    const d = ROLE_ORDER[a.role] - ROLE_ORDER[b.role]
    if (d !== 0) return d
    return (a.display_name ?? a.email ?? '').localeCompare(b.display_name ?? b.email ?? '')
  })

  async function changeRole(id: string, newRole: AppRole) {
    setLoading(id)
    setOpenMenu(null)
    setError(null)
    const res = await fetch('/api/admin/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, role: newRole }),
    })
    setLoading(null)
    if (res.ok) {
      setMembers(m => m.map(mb => mb.id === id ? { ...mb, role: newRole } : mb))
    } else {
      const data = await res.json()
      setError(data.error ?? 'Failed to update role')
    }
  }

  async function removeMember(id: string) {
    setLoading(id)
    setConfirmDelete(null)
    setError(null)
    const res = await fetch('/api/admin/members', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setLoading(null)
    if (res.ok) {
      setMembers(m => m.filter(mb => mb.id !== id))
    } else {
      const data = await res.json()
      setError(data.error ?? 'Failed to remove member')
    }
  }

  const pendingMember = members.find(m => m.id === confirmDelete)

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-4 pt-10 pb-24">

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link
            href="/services"
            className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center active:bg-zinc-800 transition-colors"
          >
            <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold tracking-tight">Admin</h1>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mb-8">
          <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800">
            <p className="text-2xl font-bold">{members.length}</p>
            <p className="text-xs text-zinc-500 mt-0.5">Members</p>
          </div>
          <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800">
            <p className="text-2xl font-bold">{serviceCount}</p>
            <p className="text-xs text-zinc-500 mt-0.5">Services</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-red-950/40 border border-red-900/40 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Members list */}
        <h2 className="text-xs text-zinc-600 uppercase tracking-widest mb-3">Members</h2>
        <div className="flex flex-col gap-2">
          {sorted.map(member => {
            const actions = getActions(member, actorRole, actorId)
            const name = member.display_name ?? member.email ?? 'Unknown'
            const initials = name.split(' ').map(w => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase()
            const isLoading = loading === member.id
            const isYou = member.id === actorId
            const subtitle = [
              member.instrument
                ? member.instrument.charAt(0) + member.instrument.slice(1).toLowerCase()
                : null,
              member.email,
            ].filter(Boolean).join(' · ')

            return (
              <div
                key={member.id}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 flex items-center gap-3"
              >
                <div className="w-9 h-9 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-zinc-300">{initials || '?'}</span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold truncate">{name}</span>
                    {isYou && <span className="text-[10px] text-zinc-600">(you)</span>}
                    <RoleBadge role={member.role} />
                  </div>
                  {subtitle && (
                    <p className="text-xs text-zinc-500 mt-0.5 truncate">{subtitle}</p>
                  )}
                </div>

                {!isYou && actions.length > 0 && (
                  <div className="relative shrink-0">
                    <button
                      onClick={() => setOpenMenu(openMenu === member.id ? null : member.id)}
                      disabled={isLoading}
                      className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center active:bg-zinc-700 disabled:opacity-50 transition-colors"
                    >
                      {isLoading ? (
                        <svg className="w-3.5 h-3.5 text-zinc-400 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5 text-zinc-400" fill="currentColor" viewBox="0 0 24 24">
                          <circle cx="5" cy="12" r="2" />
                          <circle cx="12" cy="12" r="2" />
                          <circle cx="19" cy="12" r="2" />
                        </svg>
                      )}
                    </button>

                    {openMenu === member.id && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setOpenMenu(null)} />
                        <div className="absolute right-0 top-10 z-20 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-52 overflow-hidden">
                          {actions.map((action, i) => (
                            <button
                              key={i}
                              onClick={() => {
                                if (action.delete) {
                                  setOpenMenu(null)
                                  setConfirmDelete(member.id)
                                } else if (action.role) {
                                  changeRole(member.id, action.role)
                                }
                              }}
                              className={`w-full text-left px-4 py-3 text-sm ${action.delete ? 'text-red-400' : 'text-white'} active:bg-zinc-800 transition-colors`}
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Delete confirmation sheet */}
      {confirmDelete && pendingMember && (
        <>
          <div className="fixed inset-0 bg-black/70 z-30" onClick={() => setConfirmDelete(null)} />
          <div className="fixed inset-x-4 bottom-8 z-40 bg-zinc-900 border border-zinc-700 rounded-2xl p-5">
            <p className="text-sm font-semibold mb-1">
              Remove {pendingMember.display_name ?? pendingMember.email ?? 'this member'}?
            </p>
            <p className="text-xs text-zinc-500 mb-5">
              They&apos;ll lose access to OnCue. Their notes will be deleted.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2.5 rounded-xl bg-zinc-800 text-sm text-white active:bg-zinc-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => removeMember(confirmDelete)}
                className="flex-1 py-2.5 rounded-xl bg-red-950/50 border border-red-900/40 text-sm text-red-400 active:bg-red-950 transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
