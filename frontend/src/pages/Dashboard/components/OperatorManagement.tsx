import { useCallback, useEffect, useState } from 'react'
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  List,
  ListItem,
  Typography,
} from '@mui/material'
import { Business, Refresh, Search } from '@mui/icons-material'
import { api, type OperatorInfo } from '@/api/current'

interface OperatorManagementProps {
  refreshInterval: number
  refreshKey: number
}

function operatorStatus(status: string) {
  if (status === 'current') return { label: '当前', color: 'success' as const }
  if (status === 'available') return { label: '可用', color: 'primary' as const }
  if (status === 'forbidden') return { label: '不可用', color: 'default' as const }
  return { label: status || '未知', color: 'default' as const }
}

export function OperatorManagement({ refreshInterval, refreshKey }: OperatorManagementProps) {
  const [operators, setOperators] = useState<OperatorInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadOperators = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    try {
      const response = await api.getOperators()
      if (response.status === 'ok' && response.data) {
        setOperators(response.data.operators)
        setError(null)
      } else if (!background) {
        setError(response.message || '无法读取运营商信息')
      }
    } catch (err) {
      if (!background) setError(err instanceof Error ? err.message : '无法读取运营商信息')
    } finally {
      if (!background) setLoading(false)
    }
  }, [])

  const scanOperators = useCallback(async () => {
    setScanning(true)
    setError(null)
    try {
      const response = await api.scanOperators()
      if (response.status === 'ok' && response.data) {
        setOperators(response.data.operators)
      } else {
        setError(response.message || '运营商扫描失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '运营商扫描失败')
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => {
    void loadOperators()
    if (refreshInterval <= 0) return
    const interval = window.setInterval(() => void loadOperators(true), refreshInterval)
    return () => window.clearInterval(interval)
  }, [refreshInterval, refreshKey, loadOperators])

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', pb: '16px !important' }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" gap={1} mb={1.25}>
          <Box display="flex" alignItems="center" gap={1}>
            <Business color="primary" />
            <Typography variant="subtitle1" fontWeight={700}>运营商管理</Typography>
          </Box>
          <Box display="flex" gap={0.5}>
            <Button size="small" onClick={() => void loadOperators()} disabled={loading || scanning}>
              <Refresh fontSize="small" />
            </Button>
            <Button size="small" variant="outlined" startIcon={scanning ? <CircularProgress size={14} /> : <Search />} onClick={() => void scanOperators()} disabled={scanning}>
              {scanning ? '扫描中' : '扫描'}
            </Button>
          </Box>
        </Box>

        {loading ? (
          <Box display="flex" alignItems="center" justifyContent="center" flex={1}><CircularProgress size={24} /></Box>
        ) : error ? (
          <Box display="flex" alignItems="center" justifyContent="center" flex={1}>
            <Typography variant="body2" color="error">{error}</Typography>
          </Box>
        ) : operators.length === 0 ? (
          <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" gap={0.5} flex={1}>
            <Typography variant="body2" color="text.secondary">暂无运营商信息</Typography>
            <Typography variant="caption" color="text.disabled">可扫描附近可用运营商</Typography>
          </Box>
        ) : (
          <List disablePadding sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pr: 0.5 }}>
            {operators.map((operator, index) => {
              const status = operatorStatus(operator.status)
              return (
                <Box key={`${operator.mcc}-${operator.mnc}-${operator.path}`}>
                  {index > 0 && <Divider component="li" />}
                  <ListItem disableGutters sx={{ py: 0.75 }}>
                    <Box minWidth={0} flex={1}>
                      <Box display="flex" alignItems="center" gap={0.75}>
                        <Typography variant="body2" fontWeight={700} noWrap>{operator.name || '未知运营商'}</Typography>
                        <Chip label={status.label} color={status.color} size="small" sx={{ height: 19, fontSize: '0.68rem' }} />
                      </Box>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {operator.mcc}-{operator.mnc} · {operator.technologies?.join(', ') || '未知制式'}
                      </Typography>
                    </Box>
                  </ListItem>
                </Box>
              )
            })}
          </List>
        )}
      </CardContent>
    </Card>
  )
}
