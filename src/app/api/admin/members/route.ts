import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { AppRole } from '@/lib/types'

function canChangeRole(actorRole: AppRole, targetRole: AppRole, newRole: AppRole): boolean {
  if (actorRole === 'master') return true
  if (actorRole === 'admin') {
    return (
      ['member', 'worship_leader'].includes(targetRole) &&
      ['member', 'worship_leader'].includes(newRole)
    )
  }
  return false
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: actorProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const actorRole = (actorProfile?.role ?? 'member') as AppRole
  if (!['master', 'admin'].includes(actorRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id, role: newRole } = await request.json() as { id: string; role: AppRole }

  if (id === user.id) {
    return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 })
  }

  const { data: targetProfile } = await supabase.from('profiles').select('role').eq('id', id).single()
  const targetRole = (targetProfile?.role ?? 'member') as AppRole

  if (!canChangeRole(actorRole, targetRole, newRole)) {
    return NextResponse.json({ error: 'Insufficient permissions for this role change' }, { status: 403 })
  }

  const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: actorProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const actorRole = (actorProfile?.role ?? 'member') as AppRole
  if (!['master', 'admin'].includes(actorRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await request.json() as { id: string }

  if (id === user.id) {
    return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 })
  }

  const { data: targetProfile } = await supabase.from('profiles').select('role').eq('id', id).single()
  const targetRole = (targetProfile?.role ?? 'member') as AppRole

  if (actorRole === 'admin' && ['master', 'admin'].includes(targetRole)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  // Deleting only the profile row leaves the auth user able to log in and
  // read everything. Real removal deletes the auth user (profile cascades).
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY is not configured — cannot fully remove a member. Add it to the environment and retry.' },
      { status: 500 }
    )
  }

  const adminClient = createAdminClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await adminClient.auth.admin.deleteUser(id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
