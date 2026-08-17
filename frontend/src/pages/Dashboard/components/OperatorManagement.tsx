import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  List,
  ListItem,
  Typography,
} from '@mui/material'
import { Business, Refresh, Search, SwapHoriz } from '@mui/icons-material'
import { api, type OperatorInfo } from '@/api/current'

interface OperatorManagementProps {
  refreshInterval: number
  refreshKey: number
}

function operatorStatus(status: string) {
  if (status === 'current') return { label: '当前', color: 'success' as const }
  if (status === 'available') return { label: '已发现', color: 'primary' as const }
  if (status === 'forbidden') return { label: '禁止', color: 'default' as const }
  return { label: status || '未知', color: 'default' as const }
}

export function OperatorManagement({ refreshInterval, refreshKey }: OperatorManagementProps) {
  const [operators, setOperators] = useState<OperatorInfo[]>([])
  const [selectionMode, setSelectionMode] = useState<'auto' | 'manual'>('auto')
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [registering, setRegistering] = useState<string | null>(null)
  const [switchDialogOpen, setSwitchDialogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const loadOperators = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    try {
      const response = await api.getOperators()
      if (response.status === 'ok' && response.data) {
        setOperators(response.data.operators)
        setSelectionMode(response.data.selection_mode)
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
    setSelectionMode('manual')
    setScanning(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await api.scanOperators()
      if (response.status === 'ok' && response.data) {
        setOperators(response.data.operators)
        setSelectionMode(response.data.selection_mode)
        setSuccess(`扫描完成，找到 ${response.data.operators.length} 个运营商`)
      } else {
        setError(response.message || '运营商扫描失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '运营商扫描失败')
    } finally {
      setScanning(false)
    }
  }, [])

  const registerOperator = useCallback(async (operator: OperatorInfo) => {
    const mccmnc = `${operator.mcc}${operator.mnc}`
    setRegistering(mccmnc)
    setError(null)
    setSuccess(null)
    try {
      const response = await api.registerOperatorManual(mccmnc)
      if (response.status === 'ok') {
        setSuccess(`已手动选择 ${operator.name || mccmnc}`)
        await loadOperators(true)
        setSwitchDialogOpen(false)
      } else {
        setError(response.message || '运营商注册失败')
        await loadOperators(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '运营商注册失败')
      await loadOperators(true)
    } finally {
      setRegistering(null)
    }
  }, [loadOperators])

  const registerAutomatically = useCallback(async () => {
    setRegistering('auto')
    setError(null)
    setSuccess(null)
    try {
      const response = await api.registerOperatorAuto()
      if (response.status === 'ok') {
        setSelectionMode('auto')
        setSuccess('已开启自动选择运营商')
        await loadOperators(true)
        setSwitchDialogOpen(false)
      } else {
        setError(response.message || '自动选择运营商失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '自动选择运营商失败')
    } finally {
      setRegistering(null)
    }
  }, [loadOperators])

  useEffect(() => {
    void loadOperators()
    if (refreshInterval <= 0) return
    const interval = window.setInterval(() => void loadOperators(true), refreshInterval)
    return () => window.clearInterval(interval)
  }, [refreshInterval, refreshKey, loadOperators])

  const currentOperator = operators.find((operator) => operator.status === 'current')

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', pb: '16px !important' }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" gap={1} mb={1.25}>
          <Box display="flex" alignItems="center" gap={1}>
            <Business color="primary" />
            <Typography variant="subtitle1" fontWeight={700}>运营商管理</Typography>
          </Box>
          <Box display="flex" gap={0.5}>
            <Button aria-label="刷新运营商" size="small" onClick={() => void loadOperators()} disabled={loading || scanning || registering !== null}>
              <Refresh fontSize="small" />
            </Button>
            <Button size="small" variant="outlined" startIcon={<SwapHoriz />} onClick={() => setSwitchDialogOpen(true)} disabled={loading || registering !== null}>
              切换
            </Button>
          </Box>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 1, py: 0 }} onClose={() => setError(null)}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 1, py: 0 }} onClose={() => setSuccess(null)}>{success}</Alert>}

        {loading ? (
          <Box display="flex" alignItems="center" justifyContent="center" flex={1}><CircularProgress size={24} /></Box>
        ) : !currentOperator ? (
          <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" gap={0.5} flex={1}>
            <Typography variant="body2" color="text.secondary">当前未注册运营商</Typography>
            <Typography variant="caption" color="text.disabled">点击右上角“切换”扫描并注册运营商</Typography>
          </Box>
        ) : (
          <Box display="flex" flexDirection="column" justifyContent="center" flex={1} minHeight={0}>
            <Box display="flex" alignItems="center" gap={0.75}>
              <Typography variant="body1" fontWeight={700} noWrap>{currentOperator.name || '未知运营商'}</Typography>
              <Chip label="当前" color="success" size="small" sx={{ height: 21, fontSize: '0.72rem' }} />
            </Box>
            <Typography variant="body2" color="text.secondary" noWrap mt={0.5}>
              {currentOperator.mcc}-{currentOperator.mnc} · {currentOperator.technologies?.join(', ') || '未知制式'}
            </Typography>
          </Box>
        )}
      </CardContent>

      <Dialog open={switchDialogOpen} onClose={() => setSwitchDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>切换运营商</DialogTitle>
        <DialogContent dividers>
          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
          <Box display="flex" gap={1} mb={2}>
            <Button
              fullWidth
              variant={selectionMode === 'auto' ? 'contained' : 'outlined'}
              onClick={() => void registerAutomatically()}
              disabled={scanning || registering !== null}
            >
              自动选择
            </Button>
            <Button
              fullWidth
              variant={selectionMode === 'manual' ? 'contained' : 'outlined'}
              onClick={() => void scanOperators()}
              disabled={scanning || registering !== null}
            >
              手动选择
            </Button>
          </Box>
          {scanning && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              正在扫描附近运营商，可能需要约 2 分钟，期间蜂窝网络可能暂时中断
            </Alert>
          )}
          {selectionMode === 'auto' ? (
            <Alert severity="info">自动选择已开启，运营商由基带自动选择。如需切换，请选择“手动选择”并扫描附近网络。</Alert>
          ) : !scanning && operators.length === 0 ? (
            <Alert severity="info">暂无运营商信息，请先扫描附近网络</Alert>
          ) : (
            <List disablePadding>
              {operators.map((operator, index) => {
                const status = operatorStatus(operator.status)
                const mccmnc = `${operator.mcc}${operator.mnc}`
                const canRegister = operator.status !== 'current' && operator.status !== 'forbidden'
                return (
                  <Box key={`${operator.mcc}-${operator.mnc}-${operator.path}`}>
                    {index > 0 && <Divider component="li" />}
                    <ListItem disableGutters sx={{ py: 1.25 }}>
                      <Box minWidth={0} flex={1}>
                        <Box display="flex" alignItems="center" gap={0.75}>
                          <Typography variant="body1" fontWeight={700} noWrap>{operator.name || '未知运营商'}</Typography>
                          <Chip label={status.label} color={status.color} size="small" />
                        </Box>
                        <Typography variant="body2" color="text.secondary" noWrap mt={0.25}>
                          {operator.mcc}-{operator.mnc} · {operator.technologies?.join(', ') || '未知制式'}
                        </Typography>
                      </Box>
                      {canRegister && (
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => void registerOperator(operator)}
                          disabled={scanning || registering !== null}
                          sx={{ ml: 2, flexShrink: 0 }}
                        >
                          {registering === mccmnc ? <CircularProgress size={18} color="inherit" /> : '选择'}
                        </Button>
                      )}
                    </ListItem>
                  </Box>
                )
              })}
            </List>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3 }}>
          <Box display="flex" gap={1}>
            <Button onClick={() => setSwitchDialogOpen(false)}>取消</Button>
            {selectionMode === 'manual' && <Button variant="outlined" startIcon={scanning ? <CircularProgress size={16} /> : <Search />} onClick={() => void scanOperators()} disabled={scanning || registering !== null}>
              {scanning ? '扫描中' : '扫描运营商'}
            </Button>}
          </Box>
        </DialogActions>
      </Dialog>
    </Card>
  )
}
