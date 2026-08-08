import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Typography,
} from '@mui/material'
import type { AutomationLogEntry } from '../../api/contracts'

type AutomationLogDetailDialogProps = {
  log: AutomationLogEntry | null
  onClose: () => void
}

const taskTypeLabel = (taskType: string) => {
  if (taskType === 'restart_baseband') return '基带维护'
  if (taskType === 'reboot_device') return '系统操作'
  if (taskType === 'backup_data') return '备份数据'
  if (taskType === 'send_sms') return '短信发送'
  return taskType
}

const statusMeta = (status: string) => {
  if (status === 'running') return { label: '执行中', color: 'warning' as const }
  if (status === 'success') return { label: '成功', color: 'success' as const }
  return { label: '失败', color: 'error' as const }
}

export default function AutomationLogDetailDialog({
  log,
  onClose,
}: AutomationLogDetailDialogProps) {
  const lines = log?.detail.split('\n').filter((line) => line.trim().length > 0) ?? []
  const status = statusMeta(log?.status ?? 'failed')

  return (
    <Dialog
      open={Boolean(log)}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      slotProps={{ paper: { sx: { borderRadius: 2.5, minHeight: 460 } } }}
    >
      <DialogTitle sx={{ pb: 1.5 }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" gap={2}>
          <Box minWidth={0}>
            <Typography variant="h6" fontWeight={700} noWrap>
              {log?.task_name ?? '任务执行详情'}
            </Typography>
            <Typography variant="body2" color="text.secondary" mt={0.5}>
              完整执行日志
            </Typography>
          </Box>
          <Chip label={status.label} color={status.color} size="small" variant="outlined" />
        </Box>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ pt: 2.5 }}>
        <Box
          display="grid"
          gridTemplateColumns={{ xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }}
          gap={2}
          mb={3}
        >
          <Box>
            <Typography variant="caption" color="text.secondary">任务类型</Typography>
            <Typography variant="body2" mt={0.25}>{taskTypeLabel(log?.task_type ?? '')}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">开始时间</Typography>
            <Typography variant="body2" mt={0.25}>{log?.created_at ?? '-'}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">日志编号</Typography>
            <Typography variant="body2" mt={0.25}>#{log?.id ?? '-'}</Typography>
          </Box>
        </Box>

        <Box
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            bgcolor: 'action.hover',
            p: { xs: 1.5, sm: 2 },
            maxHeight: '52vh',
            overflowY: 'auto',
          }}
        >
          {lines.map((line, index) => (
            <Box
              key={`${index}-${line}`}
              display="grid"
              gridTemplateColumns="20px minmax(0, 1fr)"
              columnGap={1.25}
              sx={{ position: 'relative', pb: index === lines.length - 1 ? 0 : 2 }}
            >
              <Box display="flex" justifyContent="center" sx={{ position: 'relative' }}>
                {index < lines.length - 1 && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 10,
                      bottom: -18,
                      width: 1,
                      bgcolor: 'divider',
                    }}
                  />
                )}
                <Box
                  sx={{
                    mt: '6px',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: index === lines.length - 1 ? `${status.color}.main` : 'primary.main',
                    zIndex: 1,
                  }}
                />
              </Box>
              <Typography
                component="pre"
                variant="body2"
                sx={{
                  m: 0,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  lineHeight: 1.65,
                }}
              >
                {line}
              </Typography>
            </Box>
          ))}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button variant="contained" onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}
