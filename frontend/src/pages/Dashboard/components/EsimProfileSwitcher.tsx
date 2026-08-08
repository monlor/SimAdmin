import { useEffect, useMemo, useState } from 'react'
import { CircularProgress, FormControl, InputLabel, MenuItem, Select, type SelectChangeEvent } from '@mui/material'
import type { EsimProfile } from '@/api/types'
import { api } from '@/api/current'

interface EsimProfileSwitcherProps {
  onError: (message: string) => void
  onSwitched: () => void
}

function profileIsActive(profile: EsimProfile) {
  return ['active', 'enabled', '1'].includes(profile.state.toLowerCase())
}

function profileLabel(profile: EsimProfile) {
  return profile.name.trim() || profile.provider.trim() || `Profile ${profile.iccid.slice(-6)}`
}

function commandSucceeded(response?: { code: number, status: string }) {
  if (!response) return false
  const status = response.status.toLowerCase()
  return response.code === 0 && (!status || status === 'success' || status === 'ok')
}

/** Dashboard status-bar switcher. It deliberately loads only live profiles so a stale
 * cache for a removed eUICC can never be selected. */
export function EsimProfileSwitcher({ onError, onSwitched }: EsimProfileSwitcherProps) {
  const [profiles, setProfiles] = useState<EsimProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [switchingIccid, setSwitchingIccid] = useState<string | null>(null)

  const activeIccid = useMemo(
    () => profiles.find(profileIsActive)?.iccid ?? '',
    [profiles],
  )

  useEffect(() => {
    let cancelled = false

    const loadProfiles = async () => {
      try {
        const response = await api.getEsimProfiles()
        if (!cancelled) setProfiles(response.data?.profiles ?? [])
      } catch {
        // eSIM is optional on the dashboard. Its unavailable state should not
        // turn a healthy physical-SIM dashboard into an error screen.
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadProfiles()
    return () => { cancelled = true }
  }, [])

  const handleChange = async (event: SelectChangeEvent<string>) => {
    const targetIccid = event.target.value
    if (!targetIccid || targetIccid === activeIccid || switchingIccid) return

    setSwitchingIccid(targetIccid)
    try {
      const response = await api.enableEsimProfile(targetIccid)
      if (!commandSucceeded(response.data)) {
        throw new Error(response.data?.msg || 'eSIM Profile 切换失败')
      }

      setProfiles((current) => current.map((profile) => ({
        ...profile,
        state: profile.iccid === targetIccid ? 'enabled' : profileIsActive(profile) ? 'disabled' : profile.state,
      })))
      onSwitched()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setSwitchingIccid(null)
    }
  }

  if (loading || profiles.length === 0) return null

  const selectedProfile = profiles.find((profile) => profile.iccid === activeIccid)
  const disabled = switchingIccid !== null

  return (
    <FormControl fullWidth size="small" sx={{ width: { xs: '100%', md: 260 }, flexShrink: 0 }}>
      <InputLabel id="dashboard-esim-profile-label">eSIM 快速切换</InputLabel>
      <Select
        labelId="dashboard-esim-profile-label"
        value={activeIccid}
        label="eSIM 快速切换"
        onChange={(event) => void handleChange(event)}
        disabled={disabled}
        renderValue={() => switchingIccid ? '切换中…' : selectedProfile ? profileLabel(selectedProfile) : '选择 Profile'}
        endAdornment={switchingIccid ? <CircularProgress size={16} sx={{ mr: 3.5 }} /> : undefined}
        sx={{ '& .MuiSelect-select': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }}
      >
        {!activeIccid && <MenuItem value="" disabled>选择 Profile</MenuItem>}
        {profiles.map((profile) => {
          const active = profile.iccid === activeIccid
          return (
            <MenuItem key={profile.iccid} value={profile.iccid} disabled={active}>
              {profileLabel(profile)}{active ? '（当前）' : ''}
            </MenuItem>
          )
        })}
      </Select>
    </FormControl>
  )
}
