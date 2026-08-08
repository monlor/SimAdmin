import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  List,
  ListItemButton,
  Typography,
} from '@mui/material'
import { ArrowForward, Description } from '@mui/icons-material'
import { api, type NotificationLogEntry } from '@/api/current'

interface NotificationLogsProps {
  refreshInterval: number
  refreshKey: number
}

function formatLogTime(timestamp: string): string {
  const normalized = timestamp.includes(' ') ? timestamp.replace(' ', 'T') : timestamp
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return timestamp
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

function statusChip(status: NotificationLogEntry['status']) {
  if (status === 'success') return { label: '成功', color: 'success' as const }
  if (status === 'failed') return { label: '失败', color: 'error' as const }
  if (status === 'quiet_hours') return { label: '免打扰', color: 'warning' as const }
  if (status === 'unmatched') return { label: '未匹配', color: 'default' as const }
  return { label: '未转发', color: 'default' as const }
}

export function NotificationLogs({ refreshInterval, refreshKey }: NotificationLogsProps) {
  const navigate = useNavigate()
  const [logs, setLogs] = useState<NotificationLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  const loadLogs = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    try {
      const response = await api.getNotificationLogs({ limit: 5 })
      if (response.status === 'ok' && response.data) {
        setLogs(response.data.logs)
        setLoadFailed(false)
      } else {
        setLoadFailed(true)
      }
    } catch {
      setLoadFailed(true)
    } finally {
      if (!background) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadLogs()
    if (refreshInterval <= 0) return
    const interval = window.setInterval(() => void loadLogs(true), refreshInterval)
    return () => window.clearInterval(interval)
  }, [refreshInterval, refreshKey, loadLogs])

  return (
    <Card sx={{ height: { xs: 'auto', md: 280 } }}>
      <CardContent sx={{ height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', pb: '16px !important' }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" gap={1} mb={1.25}>
          <Box display="flex" alignItems="center" gap={1}>
            <Description color="primary" />
            <Typography variant="subtitle1" fontWeight={700}>日志</Typography>
          </Box>
          <Button size="small" endIcon={<ArrowForward />} onClick={() => void navigate('/notifications')}>查看全部</Button>
        </Box>

        {loading ? (
          <Box display="flex" alignItems="center" justifyContent="center" flex={1}><CircularProgress size={24} /></Box>
        ) : loadFailed ? (
          <Box display="flex" alignItems="center" justifyContent="center" flex={1}>
            <Typography variant="body2" color="text.secondary">暂时无法加载日志</Typography>
          </Box>
        ) : logs.length === 0 ? (
          <Box display="flex" alignItems="center" justifyContent="center" flex={1}>
            <Typography variant="body2" color="text.secondary">暂无日志</Typography>
          </Box>
        ) : (
          <List disablePadding sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pr: 0.5 }}>
            {logs.map((log, index) => {
              const status = statusChip(log.status)
              return (
                <Box key={log.id}>
                  {index > 0 && <Divider component="li" />}
                  <ListItemButton sx={{ px: 0.5, py: 0.75 }} onClick={() => void navigate('/notifications')}>
                    <Box minWidth={0} flex={1}>
                      <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
                        <Typography variant="body2" fontWeight={700} noWrap>{log.summary || log.rule_name || '通知转发'}</Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>{formatLogTime(log.created_at)}</Typography>
                      </Box>
                      <Box display="flex" alignItems="center" gap={0.75} mt={0.25}>
                        <Chip label={status.label} color={status.color} size="small" sx={{ height: 19, fontSize: '0.68rem' }} />
                        <Typography variant="caption" color="text.secondary" noWrap>{log.channel_name || log.rule_name || '默认通道'}</Typography>
                      </Box>
                    </Box>
                  </ListItemButton>
                </Box>
              )
            })}
          </List>
        )}
      </CardContent>
    </Card>
  )
}
