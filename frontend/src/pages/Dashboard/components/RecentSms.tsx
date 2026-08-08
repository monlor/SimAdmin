import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  Typography,
} from '@mui/material'
import { ArrowForward, CallMade, CallReceived, Sms as SmsIcon } from '@mui/icons-material'
import { api, type SmsMessage } from '@/api/current'

interface RecentSmsProps {
  refreshInterval: number
  refreshKey: number
}

function smsTimestampMillis(timestamp: string): number {
  const normalized = timestamp.includes(' ') ? timestamp.replace(' ', 'T') : timestamp
  const value = new Date(normalized).getTime()
  return Number.isNaN(value) ? 0 : value
}

function formatSmsTime(timestamp: string): string {
  const normalized = timestamp.includes(' ') ? timestamp.replace(' ', 'T') : timestamp
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return timestamp

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function RecentSms({ refreshInterval, refreshKey }: RecentSmsProps) {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<SmsMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [selectedMessage, setSelectedMessage] = useState<SmsMessage | null>(null)

  const loadMessages = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    try {
      const response = await api.getSmsList({ limit: 5, offset: 0 })
      if (response.status === 'ok' && response.data) {
        setMessages([...response.data.messages].sort((a, b) => smsTimestampMillis(b.timestamp) - smsTimestampMillis(a.timestamp) || b.id - a.id))
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
    void loadMessages()
    if (refreshInterval <= 0) return

    const interval = window.setInterval(() => void loadMessages(true), refreshInterval)
    return () => window.clearInterval(interval)
  }, [refreshInterval, refreshKey, loadMessages])

  return (
    <Card sx={{ height: { xs: 'auto', md: 232 } }}>
      <CardContent sx={{ height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', pb: '16px !important' }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" gap={1} mb={1.25}>
          <Box display="flex" alignItems="center" gap={1}>
            <SmsIcon color="primary" />
            <Typography variant="subtitle1" fontWeight={700}>最新短信</Typography>
          </Box>
          <Button size="small" endIcon={<ArrowForward />} onClick={() => void navigate('/sms')}>
            查看全部
          </Button>
        </Box>

        {loading && messages.length === 0 ? (
          <Box display="flex" justifyContent="center" alignItems="center" minHeight={180}>
            <CircularProgress size={24} />
          </Box>
        ) : loadFailed && messages.length === 0 ? (
          <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" gap={1} minHeight={180}>
            <Typography variant="body2" color="text.secondary">暂时无法加载短信</Typography>
            <Button size="small" onClick={() => void loadMessages()}>重试</Button>
          </Box>
        ) : messages.length === 0 ? (
          <Box display="flex" alignItems="center" justifyContent="center" minHeight={180}>
            <Typography variant="body2" color="text.secondary">暂无短信</Typography>
          </Box>
        ) : (
          <List disablePadding sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pr: 0.5 }}>
            {messages.map((message, index) => {
              const incoming = message.direction === 'incoming'
              return (
                <Box key={message.id}>
                  {index > 0 && <Divider component="li" />}
                  <ListItemButton sx={{ px: 0.5, py: 0.75 }} onClick={() => setSelectedMessage(message)}>
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 32,
                        height: 32,
                        mr: 1.25,
                        borderRadius: '50%',
                        bgcolor: incoming ? 'primary.light' : 'action.hover',
                        color: incoming ? 'primary.contrastText' : 'text.secondary',
                        flex: '0 0 auto',
                      }}
                    >
                      {incoming ? <CallReceived fontSize="small" /> : <CallMade fontSize="small" />}
                    </Box>
                    <Box minWidth={0} flexGrow={1}>
                      <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
                        <Typography variant="body2" fontWeight={700} noWrap>{message.phone_number || '未知号码'}</Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>{formatSmsTime(message.timestamp)}</Typography>
                      </Box>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          display: '-webkit-box',
                          overflow: 'hidden',
                          WebkitBoxOrient: 'vertical',
                          WebkitLineClamp: 2,
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {message.content || '（无内容）'}
                      </Typography>
                    </Box>
                  </ListItemButton>
                </Box>
              )
            })}
          </List>
        )}
      </CardContent>

      <Dialog open={selectedMessage !== null} onClose={() => setSelectedMessage(null)} fullWidth maxWidth="sm">
        <DialogTitle>{selectedMessage?.direction === 'incoming' ? '收到短信' : '已发送短信'}</DialogTitle>
        <DialogContent dividers>
          <Box display="grid" gridTemplateColumns="auto 1fr" columnGap={2} rowGap={1} mb={2}>
            <Typography variant="body2" color="text.secondary">号码</Typography>
            <Typography variant="body2">{selectedMessage?.phone_number || '未知号码'}</Typography>
            <Typography variant="body2" color="text.secondary">时间</Typography>
            <Typography variant="body2">{selectedMessage ? formatSmsTime(selectedMessage.timestamp) : '-'}</Typography>
            <Typography variant="body2" color="text.secondary">状态</Typography>
            <Typography variant="body2">{selectedMessage?.status || '-'}</Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>短信内容</Typography>
          <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {selectedMessage?.content || '（无内容）'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedMessage(null)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}
